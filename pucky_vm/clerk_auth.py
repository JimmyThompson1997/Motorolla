from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.cookies import SimpleCookie
from typing import Any, Callable, Mapping


SHA256_DIGEST_INFO_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")
DEFAULT_API_URL = "https://api.clerk.com"
DEFAULT_API_VERSION = "v1"
DEFAULT_CACHE_TTL_SECONDS = 300


def _base64url_decode(value: str) -> bytes:
    text = str(value or "").strip()
    if not text:
        return b""
    padding = "=" * ((4 - (len(text) % 4)) % 4)
    return base64.urlsafe_b64decode(text + padding)


def _base64url_json(value: str) -> dict[str, Any]:
    raw = _base64url_decode(value)
    payload = json.loads(raw.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("invalid_json_segment")
    return payload


def _jwt_segments(token: str) -> tuple[dict[str, Any], dict[str, Any], bytes, bytes]:
    clean = str(token or "").strip()
    parts = clean.split(".")
    if len(parts) != 3:
        raise ValueError("invalid_token")
    header = _base64url_json(parts[0])
    payload = _base64url_json(parts[1])
    signing_input = f"{parts[0]}.{parts[1]}".encode("utf-8")
    signature = _base64url_decode(parts[2])
    return header, payload, signing_input, signature


def _rsa_pkcs1_v1_5_sha256_verify(message: bytes, signature: bytes, *, modulus: int, exponent: int) -> bool:
    if modulus <= 0 or exponent <= 0:
        return False
    size = (modulus.bit_length() + 7) // 8
    if size <= 0 or len(signature) != size:
        return False
    decrypted = pow(int.from_bytes(signature, "big"), exponent, modulus).to_bytes(size, "big")
    digest = hashlib.sha256(message).digest()
    expected_tail = SHA256_DIGEST_INFO_PREFIX + digest
    if len(decrypted) < len(expected_tail) + 11:
        return False
    if decrypted[:2] != b"\x00\x01":
        return False
    separator = decrypted.find(b"\x00", 2)
    if separator < 10:
        return False
    padding = decrypted[2:separator]
    if not padding or any(value != 0xFF for value in padding):
        return False
    return hmac.compare_digest(decrypted[separator + 1 :], expected_tail)


def derive_frontend_api_url(publishable_key: str) -> str:
    clean = str(publishable_key or "").strip()
    parts = clean.split("_")
    if len(parts) < 3:
        return ""
    try:
        domain = _base64url_decode(parts[2]).decode("utf-8").rstrip("$").strip()
    except Exception:
        return ""
    if not domain:
        return ""
    if domain.startswith("http://") or domain.startswith("https://"):
        return domain.rstrip("/")
    return f"https://{domain.rstrip('/')}"


def _primary_email_from_backend_user(payload: dict[str, Any]) -> str:
    direct = payload.get("primary_email_address")
    if isinstance(direct, dict):
        for key in ("email_address", "emailAddress"):
            value = str(direct.get(key) or "").strip()
            if value:
                return value
    primary_id = str(payload.get("primary_email_address_id") or payload.get("primaryEmailAddressId") or "").strip()
    candidates = payload.get("email_addresses") or payload.get("emailAddresses") or []
    if isinstance(candidates, list):
        for row in candidates:
            if not isinstance(row, dict):
                continue
            if primary_id and str(row.get("id") or "").strip() != primary_id:
                continue
            for key in ("email_address", "emailAddress"):
                value = str(row.get(key) or "").strip()
                if value:
                    return value
    return ""


@dataclass(frozen=True)
class ClerkSession:
    clerk_user_id: str
    session_id: str
    email: str
    token: str
    claims: dict[str, Any]
    auth_via: str


class ClerkAuthClient:
    def __init__(
        self,
        *,
        publishable_key: str = "",
        secret_key: str = "",
        frontend_api_url: str = "",
        api_url: str = DEFAULT_API_URL,
        api_version: str = DEFAULT_API_VERSION,
        clock_skew_seconds: int = 5,
        request_timeout_seconds: float = 10.0,
        jwks_fetcher: Callable[[], dict[str, Any]] | None = None,
    ) -> None:
        self.publishable_key = str(publishable_key or "").strip()
        self.secret_key = str(secret_key or "").strip()
        self._frontend_api_url = str(frontend_api_url or "").strip().rstrip("/")
        self.api_url = str(api_url or DEFAULT_API_URL).strip().rstrip("/") or DEFAULT_API_URL
        self.api_version = str(api_version or DEFAULT_API_VERSION).strip().strip("/") or DEFAULT_API_VERSION
        self.clock_skew_seconds = max(0, int(clock_skew_seconds or 5))
        self.request_timeout_seconds = max(1.0, float(request_timeout_seconds or 10.0))
        self._jwks_fetcher = jwks_fetcher
        self._jwks_cache: dict[str, tuple[dict[str, Any], float]] = {}

    @property
    def browser_auth_enabled(self) -> bool:
        return bool(self.publishable_key and self.frontend_api_url)

    @property
    def server_auth_enabled(self) -> bool:
        return bool(self.secret_key or self._jwks_fetcher)

    @property
    def frontend_api_url(self) -> str:
        explicit = self._frontend_api_url
        if explicit:
            return explicit
        return derive_frontend_api_url(self.publishable_key)

    def browser_config(self) -> dict[str, object]:
        return {
            "enabled": self.browser_auth_enabled,
            "publishable_key": self.publishable_key,
            "frontend_api_url": self.frontend_api_url,
        }

    def authenticate_headers(
        self,
        headers: Mapping[str, str],
        *,
        authorized_parties: list[str] | tuple[str, ...] | None = None,
    ) -> ClerkSession | None:
        token, auth_via = self._session_token_from_headers(headers)
        if not token:
            return None
        try:
            claims = self.verify_session_token(token, authorized_parties=authorized_parties)
        except ValueError:
            return None
        clerk_user_id = str(claims.get("sub") or "").strip()
        session_id = str(claims.get("sid") or "").strip()
        if not clerk_user_id or not session_id:
            raise ValueError("invalid_token")
        return ClerkSession(
            clerk_user_id=clerk_user_id,
            session_id=session_id,
            email=str(claims.get("email") or "").strip(),
            token=token,
            claims=claims,
            auth_via=auth_via,
        )

    def verify_session_token(
        self,
        token: str,
        *,
        authorized_parties: list[str] | tuple[str, ...] | None = None,
        audience: str | list[str] | tuple[str, ...] | None = None,
    ) -> dict[str, Any]:
        if not self.server_auth_enabled:
            raise ValueError("clerk_auth_not_configured")
        header, payload, signing_input, signature = _jwt_segments(token)
        if str(header.get("alg") or "").strip().upper() != "RS256":
            raise ValueError("token_invalid")
        kid = str(header.get("kid") or "").strip()
        if not kid:
            raise ValueError("token_invalid")
        jwk = self._public_jwk_for_kid(kid)
        try:
            modulus = int.from_bytes(_base64url_decode(str(jwk.get("n") or "")), "big")
            exponent = int.from_bytes(_base64url_decode(str(jwk.get("e") or "")), "big")
        except Exception as exc:
            raise ValueError("jwk_failed_to_resolve") from exc
        if not _rsa_pkcs1_v1_5_sha256_verify(signing_input, signature, modulus=modulus, exponent=exponent):
            self._evict_jwk(kid)
            jwk = self._public_jwk_for_kid(kid)
            modulus = int.from_bytes(_base64url_decode(str(jwk.get("n") or "")), "big")
            exponent = int.from_bytes(_base64url_decode(str(jwk.get("e") or "")), "big")
            if not _rsa_pkcs1_v1_5_sha256_verify(signing_input, signature, modulus=modulus, exponent=exponent):
                raise ValueError("token_invalid_signature")
        self._validate_claims(payload, authorized_parties=authorized_parties, audience=audience)
        return payload

    def fetch_primary_email(self, clerk_user_id: str) -> str:
        clean_user_id = str(clerk_user_id or "").strip()
        if not clean_user_id or not self.secret_key:
            return ""
        request = urllib.request.Request(
            f"{self.api_url}/{self.api_version}/users/{clean_user_id}",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self.secret_key}",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.request_timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception:
            return ""
        if not isinstance(payload, dict):
            return ""
        return _primary_email_from_backend_user(payload)

    def _validate_claims(
        self,
        payload: dict[str, Any],
        *,
        authorized_parties: list[str] | tuple[str, ...] | None = None,
        audience: str | list[str] | tuple[str, ...] | None = None,
    ) -> None:
        now = int(time.time())
        exp = int(payload.get("exp") or 0)
        nbf = int(payload.get("nbf") or 0)
        iat = int(payload.get("iat") or 0)
        skew = self.clock_skew_seconds
        if exp and exp < now - skew:
            raise ValueError("token_expired")
        if nbf and nbf > now + skew:
            raise ValueError("token_not_active_yet")
        if iat and iat > now + skew:
            raise ValueError("token_iat_in_the_future")
        allowed_parties = [str(item or "").strip() for item in list(authorized_parties or []) if str(item or "").strip()]
        if allowed_parties:
            azp = str(payload.get("azp") or "").strip()
            if azp not in allowed_parties:
                raise ValueError("token_invalid_authorized_parties")
        if audience:
            expected = audience if isinstance(audience, (list, tuple)) else [audience]
            expected_values = [str(item or "").strip() for item in expected if str(item or "").strip()]
            if expected_values:
                raw_aud = payload.get("aud")
                candidate_values: list[str] = []
                if isinstance(raw_aud, str):
                    candidate_values = [raw_aud]
                elif isinstance(raw_aud, list):
                    candidate_values = [str(item or "").strip() for item in raw_aud if str(item or "").strip()]
                if not candidate_values or not any(item in expected_values for item in candidate_values):
                    raise ValueError("token_invalid_audience")

    def _evict_jwk(self, kid: str) -> None:
        self._jwks_cache.pop(str(kid or "").strip(), None)

    def _public_jwk_for_kid(self, kid: str) -> dict[str, Any]:
        clean_kid = str(kid or "").strip()
        if not clean_kid:
            raise ValueError("jwk_kid_missing")
        cached = self._jwks_cache.get(clean_kid)
        if cached and cached[1] > time.time():
            return cached[0]
        payload = self._fetch_jwks()
        keys = payload.get("keys")
        if not isinstance(keys, list):
            raise ValueError("jwk_remote_invalid")
        for item in keys:
            if not isinstance(item, dict):
                continue
            if str(item.get("kid") or "").strip() != clean_kid:
                continue
            self._jwks_cache[clean_kid] = (item, time.time() + DEFAULT_CACHE_TTL_SECONDS)
            return item
        raise ValueError("jwk_kid_mismatch")

    def _fetch_jwks(self) -> dict[str, Any]:
        if callable(self._jwks_fetcher):
            payload = self._jwks_fetcher()
            if isinstance(payload, dict):
                return payload
            raise ValueError("jwk_remote_invalid")
        if not self.secret_key:
            raise ValueError("clerk_secret_key_missing")
        request = urllib.request.Request(
            f"{self.api_url}/{self.api_version}/jwks",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self.secret_key}",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.request_timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise ValueError("jwk_failed_to_load") from exc
        except Exception as exc:
            raise ValueError("jwk_failed_to_load") from exc
        if not isinstance(payload, dict):
            raise ValueError("jwk_remote_invalid")
        return payload

    def _session_token_from_headers(self, headers: Mapping[str, str]) -> tuple[str, str]:
        auth_header = str(headers.get("Authorization") or headers.get("authorization") or "").strip()
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
            if token and token.count(".") == 2:
                return token, "bearer"
        cookie_header = str(headers.get("Cookie") or headers.get("cookie") or "").strip()
        if cookie_header:
            cookies = SimpleCookie(cookie_header)
            for key, morsel in cookies.items():
                if str(key or "").startswith("__session"):
                    value = str(morsel.value or "").strip()
                    if value:
                        return value, "cookie"
        return "", ""
