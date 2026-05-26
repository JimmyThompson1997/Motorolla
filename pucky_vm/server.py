from __future__ import annotations

import base64
import hashlib
import html
import hmac
import importlib.util
import json
import mimetypes
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass
from http import HTTPStatus
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Protocol
from urllib.parse import parse_qs, quote, unquote, urlsplit

from .codex_app_server import CodexAppServerClient, command_from_env
from .composio import DEFAULT_COMPOSIO_BASE_URL, ComposioClient
from .feed_store import FeedStore
from .providers import DeepgramSTT, KokoroTTS
from .ui_bundle import UI_SRC, build_ui_bundle, bundle_config_script


DEFAULT_DEVELOPER_INSTRUCTIONS = (
    "You are Pucky, a concise voice assistant. Return only strict JSON with keys "
    "reply_text, card_title, card_icon, and html. reply_text is the spoken user-facing answer. "
    "card_title is a short title. card_icon must be one of clock, bolt, calendar, moon, mail. "
    "html is either null or an object with title and content, where content is a complete HTML document. "
    "Do not include markdown fences or any text outside the JSON object."
)
ALLOWED_CONTENT_TYPES = {"audio/mp4", "audio/wav", "audio/x-wav", "audio/mpeg", "application/octet-stream"}
ALLOWED_CARD_ICONS = {"clock", "bolt", "calendar", "moon", "mail"}
DEFAULT_CARD_ICON = "mail"
REPLY_MODE_CARD_ONLY = "card_only"
REPLY_MODE_CARD_AND_SPOKEN = "card_and_spoken"
MAX_CARD_TITLE_CHARS = 64
BROKER_MODULE_PATH = Path(__file__).resolve().parents[1] / "pucky-apk" / "fly-broker" / "pucky_fly_broker.py"

_BROKER_MODULE = None
_BROKER_DB_PATH: str | None = None


class STTProvider(Protocol):
    def transcribe(self, audio: bytes, content_type: str) -> str: ...


class TTSProvider(Protocol):
    def synthesize(self, text: str) -> tuple[bytes, str]: ...


class CodexProvider(Protocol):
    @property
    def ready(self) -> bool: ...

    @property
    def thread_id(self) -> str | None: ...

    def start(self) -> None: ...

    def send_turn(self, text: str) -> str: ...

    def set_thread_title(self, title: str) -> None: ...

    def thread_origin(self, *, retries: int = 5, delay: float = 0.15) -> dict[str, str]: ...


class ComposioProvider(Protocol):
    @property
    def configured(self) -> bool: ...

    def list_apps(self) -> dict[str, object]: ...

    def list_connected_apps(self, user_id: str, *, force: bool = False) -> dict[str, object]: ...

    def invalidate_connected_cache(self, user_id: str) -> None: ...

    def start_oauth(self, user_id: str, app_slug: str, redirect_url: str | None = None) -> dict[str, object]: ...

    def delete_connection(self, user_id: str, connection_id: str) -> dict[str, object]: ...


@dataclass(frozen=True)
class ReplyEnvelope:
    reply_text: str
    card_title: str
    card_icon: str
    html_title: str = ""
    html_content: str = ""


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    pucky_api_token: str
    deepgram_api_key: str
    deepinfra_api_key: str
    max_audio_bytes: int
    max_html_bytes: int
    tts_voice: str
    tts_response_format: str
    tts_speed: float
    codex_command: list[str]
    codex_cwd: str | None
    codex_startup_timeout: float
    codex_turn_timeout: float
    developer_instructions: str
    feed_db_path: str
    turn_status_ttl_seconds: float = 900.0
    codex_home: str | None = None
    codex_sandbox: str = "danger-full-access"
    codex_approval_policy: str = "never"
    codex_model: str | None = None
    codex_reasoning_effort: str | None = None
    composio_api_key: str = ""
    composio_base_url: str = DEFAULT_COMPOSIO_BASE_URL
    composio_default_user_id: str = "jimmythompson323"
    connect_portal_secret: str = ""
    connect_portal_ttl_seconds: int = 12 * 60 * 60
    composio_default_auth_mode: str = "webview"

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            host=os.environ.get("PUCKY_HOST", "0.0.0.0"),
            port=int(os.environ.get("PORT", os.environ.get("PUCKY_PORT", "8080"))),
            pucky_api_token=os.environ.get("PUCKY_API_TOKEN", ""),
            deepgram_api_key=os.environ.get("DEEPGRAM_API_KEY", ""),
            deepinfra_api_key=os.environ.get("DEEPINFRA_API_KEY", ""),
            max_audio_bytes=int(os.environ.get("PUCKY_MAX_AUDIO_BYTES", str(32 * 1024 * 1024))),
            max_html_bytes=int(os.environ.get("PUCKY_MAX_HTML_BYTES", str(512 * 1024))),
            tts_voice=os.environ.get("PUCKY_TTS_VOICE", "af_heart"),
            tts_response_format=os.environ.get("PUCKY_TTS_FORMAT", "wav"),
            tts_speed=float(os.environ.get("PUCKY_TTS_SPEED", "1.0")),
            codex_command=command_from_env(os.environ.get("CODEX_APP_SERVER_COMMAND")),
            codex_cwd=os.environ.get("PUCKY_CODEX_CWD") or None,
            codex_startup_timeout=float(os.environ.get("PUCKY_CODEX_STARTUP_TIMEOUT", "60")),
            codex_turn_timeout=float(os.environ.get("PUCKY_CODEX_TURN_TIMEOUT", "300")),
            developer_instructions=os.environ.get("PUCKY_CODEX_DEVELOPER_INSTRUCTIONS") or DEFAULT_DEVELOPER_INSTRUCTIONS,
            feed_db_path=os.environ.get("PUCKY_FEED_DB_PATH", str((Path.cwd() / "pucky_feed.sqlite3").resolve())),
            turn_status_ttl_seconds=float(os.environ.get("PUCKY_TURN_STATUS_TTL_SECONDS", "900")),
            codex_home=os.environ.get("CODEX_HOME") or None,
            codex_sandbox=os.environ.get("PUCKY_CODEX_SANDBOX", "danger-full-access"),
            codex_approval_policy=os.environ.get("PUCKY_CODEX_APPROVAL_POLICY", "never"),
            codex_model=os.environ.get("PUCKY_CODEX_MODEL") or None,
            codex_reasoning_effort=os.environ.get("PUCKY_CODEX_REASONING_EFFORT") or None,
            composio_api_key=os.environ.get("COMPOSIO_API_KEY", "").strip(),
            composio_base_url=os.environ.get("COMPOSIO_BASE_URL", DEFAULT_COMPOSIO_BASE_URL).strip() or DEFAULT_COMPOSIO_BASE_URL,
            composio_default_user_id=os.environ.get("PUCKY_COMPOSIO_USER_ID", "jimmythompson323").strip() or "jimmythompson323",
            connect_portal_secret=(
                os.environ.get("PUCKY_CONNECT_PORTAL_SECRET", "").strip()
                or os.environ.get("PUCKY_API_TOKEN", "").strip()
            ),
            connect_portal_ttl_seconds=max(300, int(os.environ.get("PUCKY_CONNECT_PORTAL_TTL_SECONDS", str(12 * 60 * 60)))),
            composio_default_auth_mode=os.environ.get("PUCKY_COMPOSIO_PORTAL_AUTH_MODE", "webview").strip().lower() or "webview",
        )


def _load_broker_module():
    global _BROKER_MODULE
    if _BROKER_MODULE is None:
        spec = importlib.util.spec_from_file_location("pucky_embedded_broker", BROKER_MODULE_PATH)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Unable to load broker module from {BROKER_MODULE_PATH}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _BROKER_MODULE = module
    return _BROKER_MODULE


def ensure_broker_initialized(db_path: str | None = None):
    global _BROKER_DB_PATH
    broker = _load_broker_module()
    resolved = str(db_path or os.environ.get("PUCKY_DB_PATH") or broker.DEFAULT_DB_PATH)
    if getattr(broker, "DB", None) is not None and _BROKER_DB_PATH == resolved:
        return broker
    existing = getattr(broker, "DB", None)
    if existing is not None:
        try:
            existing.close()
        except Exception:
            pass
        broker.DB = None
    broker.DEVICES.clear()
    broker.init_db(resolved)
    _BROKER_DB_PATH = resolved
    return broker


def reset_broker_for_tests(db_path: str):
    broker = ensure_broker_initialized(db_path)
    broker.DEVICES.clear()
    return broker


def _base64url_encode_bytes(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _base64url_encode_json(payload: dict[str, object]) -> str:
    return _base64url_encode_bytes(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))


def _base64url_decode_text(value: str) -> bytes:
    token = str(value or "").strip()
    if not token:
        raise ValueError("empty token segment")
    padding = "=" * (-len(token) % 4)
    return base64.urlsafe_b64decode(token + padding)


def _encode_signed_token(header: dict[str, object], payload: dict[str, object], secret: str) -> str:
    encoded_header = _base64url_encode_json(header)
    encoded_payload = _base64url_encode_json(payload)
    signing_input = f"{encoded_header}.{encoded_payload}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{encoded_header}.{encoded_payload}.{_base64url_encode_bytes(signature)}"


def _decode_signed_token(token: str, secret: str) -> dict[str, object] | None:
    if not token or not secret:
        return None
    parts = str(token).split(".")
    if len(parts) != 3:
        return None
    header_segment, payload_segment, signature_segment = parts
    signing_input = f"{header_segment}.{payload_segment}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    try:
        provided = _base64url_decode_text(signature_segment)
        payload = json.loads(_base64url_decode_text(payload_segment).decode("utf-8"))
    except Exception:
        return None
    if not hmac.compare_digest(expected, provided):
        return None
    if not isinstance(payload, dict):
        return None
    try:
        if int(payload.get("exp") or 0) < int(time.time()):
            return None
    except Exception:
        return None
    return payload


class PuckyVoiceService:
    def __init__(
        self,
        config: Config,
        *,
        stt: STTProvider | None = None,
        tts: TTSProvider | None = None,
        codex: CodexProvider | None = None,
        composio: ComposioProvider | None = None,
    ) -> None:
        self.config = config
        self.stt = stt or DeepgramSTT(config.deepgram_api_key)
        self.tts = tts or KokoroTTS(
            config.deepinfra_api_key,
            voice=config.tts_voice,
            response_format=config.tts_response_format,
            speed=config.tts_speed,
        )
        self.codex = codex or CodexAppServerClient(
            command=config.codex_command,
            cwd=config.codex_cwd,
            startup_timeout=config.codex_startup_timeout,
            turn_timeout=config.codex_turn_timeout,
            developer_instructions=config.developer_instructions,
            codex_home=config.codex_home,
            sandbox=config.codex_sandbox,
            approval_policy=config.codex_approval_policy,
            model=config.codex_model,
            reasoning_effort=config.codex_reasoning_effort,
        )
        self.feed = FeedStore(config.feed_db_path)
        self.composio = composio or ComposioClient(config.composio_api_key, config.composio_base_url)
        self._turn_lock = threading.Lock()
        self._turn_status_lock = threading.Lock()
        self._turn_statuses: dict[str, dict[str, object]] = {}
        self._links_interactions: dict[str, set[str]] = {}

    def start(self) -> None:
        self.codex.start()

    def health(self) -> dict[str, object]:
        return {
            "ok": self.codex.ready,
            "codex_app_server": "ready" if self.codex.ready else "not_ready",
            "thread": "per_turn",
            "feed_store": "ready",
            "feed_items_count": self.feed.count_items(),
            "deepgram_key": "present" if self.config.deepgram_api_key else "missing",
            "deepinfra_key": "present" if self.config.deepinfra_api_key else "missing",
            "pucky_api_token": "present" if self.config.pucky_api_token else "missing",
            "composio": "present" if self.config.composio_api_key else "missing",
        }

    def composio_user_id(self) -> str:
        return self.config.composio_default_user_id

    def composio_auth_mode(self, value: str | None = None) -> str:
        candidate = str(value or self.config.composio_default_auth_mode or "webview").strip().lower()
        return "browser" if candidate == "browser" else "webview"

    def _portal_token_secret(self) -> str:
        return str(self.config.connect_portal_secret or "").strip()

    def _mint_links_portal_token(self, *, user_id: str, ttl_seconds: int | None = None) -> str:
        secret = self._portal_token_secret()
        if not secret:
            return ""
        now = int(time.time())
        payload = {
            "typ": "pucky_connect_portal",
            "iat": now,
            "exp": now + max(60, int(ttl_seconds or self.config.connect_portal_ttl_seconds)),
            "user_id": str(user_id or "").strip(),
        }
        header = {"alg": "HS256", "typ": "JWT"}
        return _encode_signed_token(header, payload, secret)

    def _verify_links_portal_token(self, token: str) -> dict[str, object] | None:
        payload = _decode_signed_token(str(token or "").strip(), self._portal_token_secret())
        if not payload:
            return None
        if str(payload.get("typ") or "") != "pucky_connect_portal":
            return None
        return payload

    def _resolve_links_portal_user(self, token: str) -> str:
        payload = self._verify_links_portal_token(token)
        if not payload:
            raise ValueError("invalid_or_expired_connect_link")
        user_id = str(payload.get("user_id") or "").strip()
        if not user_id:
            raise ValueError("invalid_connect_link")
        return user_id

    def _record_links_interaction(self, user_id: str, slug: str) -> None:
        user_key = str(user_id or "").strip()
        slug_key = str(slug or "").strip().lower()
        if not user_key or not slug_key:
            return
        self._links_interactions.setdefault(user_key, set()).add(slug_key)

    def links_portal_url(self, base_url: str, *, auth_mode: str | None = None) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        token = self._mint_links_portal_token(user_id=self.composio_user_id())
        if not token:
            return {"ok": False, "error": "connect_portal_token_unavailable"}
        mode = self.composio_auth_mode(auth_mode)
        url = f"{base_url.rstrip('/')}/links/connect/apps?token={quote(token, safe='')}&auth_mode={quote(mode, safe='')}"
        return {
            "ok": True,
            "schema": "pucky.links_portal_url.v1",
            "url": url,
            "portal_url": url,
            "auth_mode": mode,
            "user_id": self.composio_user_id(),
        }

    def links_my_apps(self, token: str) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        user_id = self._resolve_links_portal_user(token)
        apps_payload = self.composio.list_apps()
        connected_payload = self.composio.list_connected_apps(user_id, force=False)
        app_meta = {
            str(item.get("slug") or "").lower(): item
            for item in list(apps_payload.get("apps") or [])
            if isinstance(item, dict) and str(item.get("slug") or "").strip()
        }
        counts_by_slug: dict[str, dict[str, int]] = {}
        details_by_slug: dict[str, list[dict[str, object]]] = {}
        for item in list(connected_payload.get("connected_apps") or []):
            if not isinstance(item, dict):
                continue
            slug = str(item.get("slug") or "").strip().lower()
            if not slug:
                continue
            status = str(item.get("status") or "").strip().lower()
            bucket = counts_by_slug.setdefault(slug, {"total": 0, "active": 0, "pending": 0, "expired": 0})
            bucket["total"] += 1
            if status == "active":
                bucket["active"] += 1
            elif status in {"initiated", "initializing", "pending"}:
                bucket["pending"] += 1
            elif status == "expired":
                bucket["expired"] += 1
            details_by_slug.setdefault(slug, []).append(
                {
                    "id": str(item.get("id") or "").strip(),
                    "status": status,
                    "instance_name": str(item.get("instance_name") or "").strip(),
                }
            )
        rows: list[dict[str, object]] = []
        for slug, counts in counts_by_slug.items():
            meta = app_meta.get(slug, {})
            active = int(counts.get("active") or 0)
            pending = int(counts.get("pending") or 0)
            expired = int(counts.get("expired") or 0)
            state = "connected" if active > 0 else ("needs-attention" if (pending > 0 or expired > 0) else "interacted")
            rows.append(
                {
                    "slug": slug,
                    "name": str(meta.get("name") or slug.title()),
                    "logo": str(meta.get("logo") or ""),
                    "state": state,
                    "counts": {
                        "total": int(counts.get("total") or 0),
                        "active": active,
                        "pending": pending,
                        "expired": expired,
                    },
                    "details": list(details_by_slug.get(slug) or []),
                }
            )
        for slug in sorted(self._links_interactions.get(user_id, set())):
            if slug in counts_by_slug:
                continue
            meta = app_meta.get(slug, {})
            rows.append(
                {
                    "slug": slug,
                    "name": str(meta.get("name") or slug.title()),
                    "logo": str(meta.get("logo") or ""),
                    "state": "interacted",
                    "counts": {"total": 0, "active": 0, "pending": 0, "expired": 0},
                    "details": [],
                }
            )
        rows.sort(key=lambda row: (0 if row["state"] == "connected" else 1 if row["state"] == "needs-attention" else 2, str(row["name"]).lower()))
        return {
            "ok": True,
            "schema": "pucky.links_my_apps.v1",
            "user_id": user_id,
            "apps": rows,
            "summary": {
                "connected": sum(1 for row in rows if row["state"] == "connected"),
                "needs_attention": sum(1 for row in rows if row["state"] == "needs-attention"),
                "interacted": sum(1 for row in rows if row["state"] == "interacted"),
            },
        }

    def links_all_apps(self, token: str, *, query: str = "", offset: int = 0, limit: int = 60) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        user_id = self._resolve_links_portal_user(token)
        apps_payload = self.composio.list_apps()
        my_payload = self.links_my_apps(token)
        rows = []
        my_counts = {
            str(item.get("slug") or "").strip().lower(): item
            for item in list(my_payload.get("apps") or [])
            if isinstance(item, dict) and str(item.get("slug") or "").strip()
        }
        needle = str(query or "").strip().lower()
        for item in list(apps_payload.get("apps") or []):
            if not isinstance(item, dict) or not bool(item.get("connectable")):
                continue
            slug = str(item.get("slug") or "").strip()
            name = str(item.get("name") or slug).strip()
            if not slug:
                continue
            if needle and needle not in slug.lower() and needle not in name.lower():
                continue
            current = my_counts.get(slug.lower(), {})
            state = str(current.get("state") or "not-connected")
            counts = current.get("counts") if isinstance(current.get("counts"), dict) else {"total": 0, "active": 0, "pending": 0, "expired": 0}
            rows.append(
                {
                    "slug": slug,
                    "name": name,
                    "logo": str(item.get("logo") or ""),
                    "description": str(item.get("description") or ""),
                    "state": state,
                    "counts": counts,
                }
            )
        rows.sort(key=lambda row: (0 if row["state"] == "connected" else 1 if row["state"] == "needs-attention" else 2, str(row["name"]).lower()))
        total = len(rows)
        page = rows[offset : offset + limit]
        return {
            "ok": True,
            "schema": "pucky.links_all_apps.v1",
            "user_id": user_id,
            "apps": page,
            "q": needle,
            "offset": offset,
            "limit": limit,
            "count": len(page),
            "total": total,
            "has_more": offset + len(page) < total,
        }

    def links_app_details(self, token: str, slug: str) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        key = str(slug or "").strip().lower()
        if not key:
            raise ValueError("slug_required")
        my_payload = self.links_my_apps(token)
        item = next((app for app in list(my_payload.get("apps") or []) if isinstance(app, dict) and str(app.get("slug") or "").lower() == key), None)
        return {
            "ok": True,
            "schema": "pucky.links_app_details.v1",
            "slug": key,
            "details": list(item.get("details") or []) if isinstance(item, dict) else [],
        }

    def links_refresh_my_apps(self, token: str) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        user_id = self._resolve_links_portal_user(token)
        self.composio.invalidate_connected_cache(user_id)
        connected = self.composio.list_connected_apps(user_id, force=True)
        return {
            "ok": True,
            "schema": "pucky.links_refresh.v1",
            "user_id": user_id,
            "connected_count": len(list(connected.get("connected_apps") or [])),
        }

    def links_disconnect(self, token: str, connection_id: str) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        user_id = self._resolve_links_portal_user(token)
        result = self.composio.delete_connection(user_id, connection_id)
        if result.get("ok"):
            return {"ok": True, "schema": "pucky.links_disconnect.v1", "deleted": result.get("deleted")}
        return result

    def links_start_oauth(
        self,
        token: str,
        *,
        app_slug: str,
        base_url: str,
        auth_mode: str | None = None,
        redirect_url: str | None = None,
    ) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        user_id = self._resolve_links_portal_user(token)
        slug = str(app_slug or "").strip().lower()
        if not slug:
            raise ValueError("app_required")
        self._record_links_interaction(user_id, slug)
        mode = self.composio_auth_mode(auth_mode)
        callback_url = str(redirect_url or "").strip()
        if not callback_url and mode == "webview":
            callback_url = (
                f"{base_url.rstrip('/')}/links/connect/apps?token={quote(token, safe='')}"
                f"&auth_mode=webview&tab=my&just_connected={quote(slug, safe='')}"
            )
        result = self.composio.start_oauth(user_id, slug, callback_url or None)
        if result.get("ok"):
            return {
                "ok": True,
                "schema": "pucky.links_oauth_start.v1",
                "user_id": user_id,
                "slug": slug,
                "auth_mode": mode,
                "auth_url": str(result.get("auth_url") or ""),
                "redirect_url": str(result.get("redirect_url") or ""),
                "connection_id": str(result.get("connection_id") or ""),
            }
        return result

    def turn_status(self, turn_id: str) -> dict[str, object] | None:
        clean_turn_id = str(turn_id or "").strip()
        if not clean_turn_id:
            return None
        now = time.time()
        with self._turn_status_lock:
            self._prune_turn_statuses_locked(now)
            status = self._turn_statuses.get(clean_turn_id)
            if status is None:
                return None
            public = dict(status)
            public.pop("_updated_epoch", None)
            return public

    def handle_audio_turn(
        self,
        audio: bytes,
        content_type: str,
        turn_id: str | None = None,
        reply_mode: str | None = None,
    ) -> dict[str, object]:
        if not audio:
            raise ValueError("audio body is empty")
        turn_id = _normalize_turn_id(turn_id)
        reply_mode = _normalize_reply_mode(reply_mode)
        session_id = turn_id
        total_start = time.perf_counter()
        telemetry: dict[str, object] = {
            "event": "pucky.turn.completed",
            "session_id": session_id,
            "turn_id": turn_id,
            "upload_received_ms": 0,
            "content_type": content_type,
            "request_audio_bytes": len(audio),
            "reply_mode": reply_mode,
            "stt_provider": "deepgram",
            "stt_model": getattr(self.stt, "model", ""),
            "tts_provider": "deepinfra",
            "tts_model": getattr(self.tts, "model", ""),
            "tts_voice": getattr(self.tts, "voice", ""),
            "tts_format": getattr(self.tts, "response_format", ""),
            "tts_speed": getattr(self.tts, "speed", ""),
        }
        stage = "upload_received"
        self._update_turn_status(turn_id, "upload_received", "running", telemetry)
        with self._turn_lock:
            try:
                stage = "stt_running"
                telemetry["stt_start_ms"] = _elapsed_ms(total_start)
                self._update_turn_status(turn_id, "stt_running", "running", telemetry)
                start = time.perf_counter()
                transcript = self.stt.transcribe(audio, content_type)
                telemetry["stt_ms"] = _elapsed_ms(start)
                telemetry["stt_end_ms"] = _elapsed_ms(total_start)
                telemetry["transcript_chars"] = len(transcript)
                telemetry["user_transcript"] = transcript

                stage = "codex_running"
                telemetry["codex_start_ms"] = _elapsed_ms(total_start)
                self._update_turn_status(turn_id, "codex_running", "running", telemetry)
                start = time.perf_counter()
                raw_reply = self.codex.send_turn(transcript)
                telemetry["codex_ms"] = _elapsed_ms(start)
                telemetry["codex_end_ms"] = _elapsed_ms(total_start)
                telemetry["codex_thread_id"] = self.codex.thread_id or ""
                telemetry["raw_reply_chars"] = len(raw_reply)

                stage = "envelope"
                envelope = parse_reply_envelope(raw_reply)
                telemetry["envelope_parse"] = "ok"
                telemetry["reply_chars"] = len(envelope.reply_text)
                telemetry["card_icon"] = envelope.card_icon
                telemetry["has_html"] = bool(envelope.html_content)
                try:
                    self.codex.set_thread_title(envelope.card_title)
                    telemetry["codex_thread_title_synced"] = True
                except Exception:
                    telemetry["codex_thread_title_synced"] = False
                try:
                    origin = self.codex.thread_origin()
                except Exception:
                    origin = {}
                if not isinstance(origin, dict):
                    origin = {}
                origin = _normalize_origin(origin, telemetry.get("codex_thread_id"))
                telemetry["origin_thread_id"] = origin.get("thread_id", "")
                telemetry["origin_model"] = origin.get("model", "")

                reply_audio = b""
                audio_mime_type = ""
                stage = "tts_running"
                telemetry["tts_start_ms"] = _elapsed_ms(total_start)
                self._update_turn_status(turn_id, "tts_running", "running", telemetry)
                start = time.perf_counter()
                reply_audio, audio_mime_type = self.tts.synthesize(envelope.reply_text)
                telemetry["tts_ms"] = _elapsed_ms(start)
                telemetry["tts_end_ms"] = _elapsed_ms(total_start)
                telemetry["tts_status"] = "ok"
                telemetry["reply_audio_bytes"] = len(reply_audio)
                telemetry["audio_mime_type"] = audio_mime_type
            except Exception as exc:
                telemetry["event"] = "pucky.turn.failed"
                telemetry["status"] = "failed"
                telemetry["stage"] = stage
                telemetry["error_type"] = exc.__class__.__name__
                telemetry["total_ms"] = _elapsed_ms(total_start)
                self._update_turn_status(turn_id, "failed", "failed", telemetry)
                _log_json(telemetry)
                raise
        card: dict[str, object] = {
            "title": envelope.card_title,
            "summary": envelope.reply_text,
            "icon": envelope.card_icon,
            "origin": origin,
        }
        html_mime_type = ""
        html_base64 = ""
        if envelope.html_content:
            html_bytes = envelope.html_content.encode("utf-8")
            if len(html_bytes) <= self.config.max_html_bytes:
                html_mime_type = "text/html"
                html_base64 = base64.b64encode(html_bytes).decode("ascii")
                card["html_mime_type"] = html_mime_type
                card["html_base64"] = html_base64
        telemetry["total_ms"] = _elapsed_ms(total_start)
        telemetry["status"] = "ok"
        telemetry["feed_db_path"] = self.feed.db_path
        audio_base64 = base64.b64encode(reply_audio).decode("ascii") if reply_audio else ""
        result = self.feed.upsert_turn_result(
            turn_id=turn_id,
            session_id=session_id,
            reply_mode=reply_mode,
            reply_text=envelope.reply_text,
            title=envelope.card_title,
            summary=envelope.reply_text,
            icon=envelope.card_icon,
            origin=origin,
            telemetry=_public_turn_telemetry(telemetry),
            audio_mime_type=audio_mime_type,
            audio_base64=audio_base64,
            html_mime_type=html_mime_type,
            html_base64=html_base64,
        )
        card_id = str(result.get("card_id") or "")
        telemetry["card_id"] = card_id
        verified = self.feed.get_item(card_id)
        if verified is None:
            telemetry["feed_persisted"] = False
            telemetry["status"] = "failed"
            telemetry["stage"] = "feed_persist"
            telemetry["error_type"] = "RuntimeError"
            self._update_turn_status(turn_id, "failed", "failed", telemetry)
            _log_json(telemetry)
            raise RuntimeError("feed_persist_failed")
        telemetry["feed_persisted"] = True
        result = verified
        result["card"] = card
        result["telemetry"] = _public_turn_telemetry(telemetry)
        telemetry["response_bytes"] = len(json.dumps(result, separators=(",", ":")).encode("utf-8"))
        result["telemetry"] = _public_turn_telemetry(telemetry)
        self._update_turn_status(turn_id, "completed", "ok", telemetry)
        _log_json(telemetry)
        return result

    def feed_sync(self, cursor: str | None, limit: int) -> dict[str, object]:
        return self.feed.list_feed(cursor, limit)

    def feed_action(self, client_action_id: str, card_id: str, action: str) -> dict[str, object]:
        return self.feed.apply_action(
            client_action_id=client_action_id,
            card_id=card_id,
            action=action,
        )

    def _update_turn_status(self, turn_id: str, stage: str, status: str, telemetry: dict[str, object]) -> None:
        now = time.time()
        public = _public_turn_status(telemetry)
        public.update(
            {
                "schema": "pucky.turn_remote_status.v1",
                "turn_id": turn_id,
                "stage": stage,
                "status": status,
                "updated_at": _iso_time(now),
                "expires_at": _iso_time(now + max(1.0, float(self.config.turn_status_ttl_seconds))),
                "_updated_epoch": now,
                "upload_received": stage == "upload_received",
                "stt_running": stage == "stt_running",
                "codex_running": stage == "codex_running",
                "tts_running": stage == "tts_running",
                "completed": stage == "completed",
                "failed": stage == "failed" or status == "failed",
            }
        )
        with self._turn_status_lock:
            self._prune_turn_statuses_locked(now)
            self._turn_statuses[turn_id] = public

    def _prune_turn_statuses_locked(self, now: float) -> None:
        ttl = max(1.0, float(self.config.turn_status_ttl_seconds))
        expired = [
            turn_id
            for turn_id, status in self._turn_statuses.items()
            if now - float(status.get("_updated_epoch", now)) > ttl
        ]
        for turn_id in expired:
            self._turn_statuses.pop(turn_id, None)


def parse_reply_envelope(raw: str) -> ReplyEnvelope:
    clean = (raw or "").strip()
    if not clean:
        return ReplyEnvelope("", "Pucky", DEFAULT_CARD_ICON)
    try:
        data = json.loads(_strip_json_fence(clean))
    except Exception:
        return ReplyEnvelope(clean, fallback_title(clean), DEFAULT_CARD_ICON)
    if not isinstance(data, dict):
        return ReplyEnvelope(clean, fallback_title(clean), DEFAULT_CARD_ICON)
    reply_text = str(data.get("reply_text") or "").strip() or clean
    card_title = (str(data.get("card_title") or "").strip() or fallback_title(reply_text))[:MAX_CARD_TITLE_CHARS].strip() or "Pucky"
    html_title = ""
    html_content = ""
    html = data.get("html")
    if isinstance(html, dict):
        html_title = str(html.get("title") or "").strip()
        html_content = str(html.get("content") or "").strip()
    return ReplyEnvelope(reply_text, card_title, normalize_card_icon(data.get("card_icon")), html_title, html_content)


def normalize_card_icon(value: object) -> str:
    icon = str(value or "").strip().lower()
    return icon if icon in ALLOWED_CARD_ICONS else DEFAULT_CARD_ICON


def fallback_title(text: str) -> str:
    clean = re.sub(r"\s+", " ", (text or "").strip())
    return (clean[:MAX_CARD_TITLE_CHARS].strip() if clean else "Pucky") or "Pucky"


def _elapsed_ms(start: float) -> int:
    return round((time.perf_counter() - start) * 1000)


def _iso_time(epoch_seconds: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch_seconds))


def _normalize_turn_id(raw: str | None) -> str:
    value = str(raw or "").strip()
    if not value:
        return "pucky_" + uuid.uuid4().hex
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,96}", value):
        raise ValueError("turn_id is invalid")
    return value


def _normalize_reply_mode(raw: str | None) -> str:
    value = str(raw or "").strip().lower()
    if value in {REPLY_MODE_CARD_AND_SPOKEN, "spoken", "voice", "card_voice"}:
        return REPLY_MODE_CARD_AND_SPOKEN
    return REPLY_MODE_CARD_ONLY


def _log_json(payload: dict[str, object]) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def _public_turn_status(telemetry: dict[str, object]) -> dict[str, object]:
    allowed = (
        "session_id",
        "content_type",
        "request_audio_bytes",
        "reply_mode",
        "upload_received_ms",
        "stt_start_ms",
        "stt_end_ms",
        "stt_ms",
        "transcript_chars",
        "user_transcript",
        "codex_start_ms",
        "codex_end_ms",
        "codex_ms",
        "codex_thread_id",
        "origin_thread_id",
        "raw_reply_chars",
        "reply_chars",
        "tts_start_ms",
        "tts_end_ms",
        "tts_ms",
        "reply_audio_bytes",
        "audio_mime_type",
        "tts_status",
        "response_bytes",
        "total_ms",
        "card_id",
        "feed_persisted",
        "error_type",
    )
    return {key: telemetry[key] for key in allowed if key in telemetry}


def _public_turn_telemetry(telemetry: dict[str, object]) -> dict[str, object]:
    allowed = (
        "turn_id",
        "session_id",
        "status",
        "content_type",
        "request_audio_bytes",
        "reply_mode",
        "upload_received_ms",
        "stt_start_ms",
        "stt_end_ms",
        "stt_ms",
        "transcript_chars",
        "codex_start_ms",
        "codex_end_ms",
        "codex_ms",
        "codex_thread_id",
        "origin_thread_id",
        "origin_model",
        "raw_reply_chars",
        "reply_chars",
        "tts_start_ms",
        "tts_end_ms",
        "tts_ms",
        "reply_audio_bytes",
        "audio_mime_type",
        "tts_status",
        "response_bytes",
        "total_ms",
        "card_id",
        "feed_persisted",
    )
    return {key: telemetry[key] for key in allowed if key in telemetry}


def _normalize_origin(origin: dict[str, object], fallback_thread_id: object) -> dict[str, str]:
    normalized = {
        "runtime": "codex",
        "thread_id": str(origin.get("thread_id") or fallback_thread_id or "").strip(),
        "thread_title": str(origin.get("thread_title") or "").strip(),
        "rollout_path": str(origin.get("rollout_path") or "").strip(),
        "source": str(origin.get("source") or "").strip(),
        "model": str(origin.get("model") or "").strip(),
        "model_provider": str(origin.get("model_provider") or "").strip(),
        "reasoning_effort": str(origin.get("reasoning_effort") or "").strip(),
        "sandbox_policy": str(origin.get("sandbox_policy") or "").strip(),
        "approval_mode": str(origin.get("approval_mode") or "").strip(),
    }
    return normalized


def _request_base_url(handler) -> str:
    proto = str(handler.headers.get("X-Forwarded-Proto") or "http").split(",", 1)[0].strip() or "http"
    host = str(handler.headers.get("X-Forwarded-Host") or handler.headers.get("Host") or "").split(",", 1)[0].strip()
    if not host:
        host = f"{handler.server.server_address[0]}:{handler.server.server_address[1]}"
    return f"{proto}://{host}"


def _links_portal_document(*, token: str, auth_mode: str, back_url: str, just_connected: str = "") -> str:
    token_q = quote(token, safe="")
    back_q = html.escape(back_url, quote=True)
    connected_label = html.escape(just_connected, quote=True)
    initial_mode = "browser" if auth_mode == "browser" else "webview"
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Pucky Links</title>
    <style>
      :root {{
        color-scheme: dark;
        --bg: #060d15;
        --panel: #111927;
        --panel-2: #0b1320;
        --line: rgba(245, 249, 255, 0.1);
        --text: #f5f9ff;
        --muted: #9db1c7;
        --soft: rgba(245, 249, 255, 0.05);
        --accent: #72c2ff;
        --accent-soft: rgba(114, 194, 255, 0.12);
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        background: radial-gradient(circle at top, rgba(114, 194, 255, 0.08), transparent 40%), var(--bg);
        color: var(--text);
        font-family: Inter, Segoe UI, Arial, sans-serif;
      }}
      .shell {{
        min-height: 100vh;
        padding: 14px 14px 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }}
      .hero, .toolbar, .card, .msg {{
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--panel);
      }}
      .hero {{
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }}
      .hero-top {{
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: flex-start;
      }}
      .back {{
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 34px;
        min-height: 34px;
        border-radius: 12px;
        border: 1px solid var(--line);
        color: var(--text);
        text-decoration: none;
        background: var(--panel-2);
      }}
      .hero h1 {{
        margin: 0;
        font-size: 22px;
        line-height: 1;
        font-weight: 850;
      }}
      .hero p {{
        margin: 5px 0 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.35;
      }}
      .tabs, .mode-row {{
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }}
      .tab, .mode-pill, .btn {{
        min-height: 32px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--soft);
        color: var(--text);
        font-size: 11px;
        font-weight: 780;
        padding: 0 12px;
        text-decoration: none;
      }}
      .tab.active, .mode-pill.active {{
        background: var(--accent-soft);
        border-color: rgba(114, 194, 255, 0.34);
      }}
      .toolbar {{
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }}
      .toolbar-row {{
        display: flex;
        gap: 8px;
        align-items: center;
      }}
      .toolbar-row.wrap {{ flex-wrap: wrap; }}
      .search {{
        flex: 1 1 auto;
        min-width: 0;
        min-height: 36px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--panel-2);
        color: var(--text);
        padding: 0 12px;
        font-size: 13px;
      }}
      .msg {{
        display: none;
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.35;
      }}
      .msg.show {{ display: block; }}
      .msg.error {{ border-color: rgba(255, 111, 111, 0.4); color: #ffd7d7; }}
      .msg.ok {{ border-color: rgba(80, 216, 106, 0.35); color: #d8ffe1; }}
      .summary {{
        color: var(--muted);
        font-size: 11px;
        line-height: 1.35;
      }}
      .grid {{
        display: flex;
        flex-direction: column;
        gap: 8px;
      }}
      .card {{
        overflow: hidden;
      }}
      .card-main {{
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr) auto;
        gap: 10px;
        align-items: center;
        padding: 11px 12px;
      }}
      .logo {{
        width: 38px;
        height: 38px;
        border-radius: 12px;
        background: var(--panel-2);
        display: grid;
        place-items: center;
        color: var(--muted);
        overflow: hidden;
      }}
      .logo img {{
        width: 100%;
        height: 100%;
        object-fit: contain;
        padding: 6px;
      }}
      .meta {{
        min-width: 0;
      }}
      .name {{
        font-size: 14px;
        font-weight: 800;
        line-height: 1.05;
      }}
      .slug {{
        margin-top: 2px;
        color: var(--muted);
        font-size: 10px;
        line-height: 1.2;
      }}
      .status, .tools {{
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 6px;
      }}
      .pill {{
        border-radius: 999px;
        border: 1px solid var(--line);
        padding: 2px 7px;
        font-size: 10px;
        line-height: 1.2;
      }}
      .pill.active {{ color: #d8ffe1; border-color: rgba(80, 216, 106, 0.34); }}
      .pill.pending {{ color: #ffe9b0; border-color: rgba(255, 176, 0, 0.34); }}
      .pill.expired {{ color: #ffd7d7; border-color: rgba(255, 111, 111, 0.34); }}
      .pill.muted {{ color: var(--muted); }}
      .btn {{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        white-space: nowrap;
      }}
      .details {{
        display: none;
        border-top: 1px solid var(--line);
        background: var(--panel-2);
        padding: 10px 12px;
      }}
      .card.open .details {{ display: block; }}
      .detail-row {{
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        gap: 8px;
        align-items: center;
        padding: 6px 0;
        border-top: 1px solid rgba(245, 249, 255, 0.06);
      }}
      .detail-row:first-child {{ border-top: 0; }}
      .detail-id {{
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11px;
      }}
      .detail-status {{
        color: var(--muted);
        font-size: 10px;
      }}
      .empty {{
        border: 1px dashed var(--line);
        border-radius: 18px;
        padding: 16px 14px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.4;
      }}
      .hide {{ display: none !important; }}
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <div class="hero-top">
          <div>
            <h1>Links</h1>
            <p>Browse your connected apps, search the catalog, and hand off app auth through Composio.</p>
          </div>
          <a class="back" href="{back_q}" aria-label="Back to Pucky">&lt;</a>
        </div>
        <div class="tabs">
          <button id="tab-my" class="tab active" type="button">My Apps</button>
          <button id="tab-all" class="tab" type="button">All Apps</button>
        </div>
      </section>
      <section class="toolbar">
        <div class="toolbar-row wrap">
          <button id="refresh-my" class="btn" type="button">Refresh My Apps</button>
          <div class="mode-row" aria-label="Auth handoff mode">
            <button id="mode-webview" class="mode-pill" type="button">This view</button>
            <button id="mode-browser" class="mode-pill" type="button">Browser</button>
          </div>
        </div>
        <div class="toolbar-row">
          <input id="search" class="search hide" type="search" placeholder="Search all apps">
          <button id="all-more" class="btn hide" type="button">Load more</button>
        </div>
        <div id="portal-msg" class="msg" aria-live="polite"></div>
        <div id="summary" class="summary">Loading...</div>
      </section>
      <section id="my-grid" class="grid"></section>
      <section id="all-grid" class="grid hide"></section>
      <div id="all-sentinel" class="hide" style="height: 1px;"></div>
    </main>
    <script>
      const token = '{token_q}';
      const initialAuthMode = '{initial_mode}';
      const justConnected = '{connected_label}';
      const pending = new Map();
      let seq = 0;
      let authMode = initialAuthMode === 'browser' ? 'browser' : 'webview';
      const tabMy = document.getElementById('tab-my');
      const tabAll = document.getElementById('tab-all');
      const myGrid = document.getElementById('my-grid');
      const allGrid = document.getElementById('all-grid');
      const summary = document.getElementById('summary');
      const search = document.getElementById('search');
      const msg = document.getElementById('portal-msg');
      const refreshMy = document.getElementById('refresh-my');
      const allMore = document.getElementById('all-more');
      const allSentinel = document.getElementById('all-sentinel');
      const modeWebview = document.getElementById('mode-webview');
      const modeBrowser = document.getElementById('mode-browser');

      window.Pucky = window.Pucky || {{}};
      if (typeof window.Pucky.request !== 'function') {{
        window.Pucky.request = function request(payload) {{
          const command = payload && payload.command;
          const args = payload && payload.args ? payload.args : {{}};
          if (window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === 'function') {{
            const id = String(++seq);
            const message = JSON.stringify({{ id, command, args }});
            return new Promise((resolve, reject) => {{
              pending.set(id, {{ resolve, reject }});
              window.PuckyAndroid.postMessage(message);
              setTimeout(() => {{
                if (pending.has(id)) {{
                  pending.delete(id);
                  reject(new Error('Pucky native bridge timed out'));
                }}
              }}, 15000);
            }});
          }}
          if (command === 'browser.open') {{
            const url = String(args.url || '').trim();
            if (!url) throw new Error('browser.open requires url');
            try {{
              window.open(url, '_blank', 'noopener,noreferrer');
            }} catch (_err) {{
              window.location.assign(url);
            }}
            return Promise.resolve({{ launched: true, uri: url }});
          }}
          return Promise.reject(new Error('Pucky bridge unavailable'));
        }};
      }}
      if (typeof window.Pucky.__resolve !== 'function') {{
        window.Pucky.__resolve = function resolve(id, payload) {{
          const slot = pending.get(String(id));
          if (!slot) return;
          pending.delete(String(id));
          if (payload && payload.ok) slot.resolve(payload.result || {{}});
          else slot.reject(new Error((payload && payload.error) || 'Native command failed'));
        }};
      }}

      function showMessage(text, kind) {{
        msg.className = 'msg show ' + (kind || '');
        msg.textContent = String(text || '');
      }}
      function hideMessage() {{
        msg.className = 'msg';
        msg.textContent = '';
      }}
      function setAuthMode(next) {{
        authMode = next === 'browser' ? 'browser' : 'webview';
        modeWebview.classList.toggle('active', authMode === 'webview');
        modeBrowser.classList.toggle('active', authMode === 'browser');
        try {{
          const url = new URL(window.location.href);
          url.searchParams.set('auth_mode', authMode);
          window.history.replaceState(null, '', url.toString());
        }} catch (_err) {{}}
      }}
      function pills(counts) {{
        const parts = [];
        const current = counts && typeof counts === 'object' ? counts : {{}};
        if ((current.active || 0) > 0) parts.push("<span class='pill active'>" + current.active + " active</span>");
        if ((current.pending || 0) > 0) parts.push("<span class='pill pending'>" + current.pending + " pending</span>");
        if ((current.expired || 0) > 0) parts.push("<span class='pill expired'>" + current.expired + " expired</span>");
        if (!parts.length) parts.push("<span class='pill muted'>not connected</span>");
        return parts.join('');
      }}
      function buildConnectHref(slug) {{
        return '/links/connect/apps?token=' + token + '&app=' + encodeURIComponent(slug) + '&auth_mode=' + encodeURIComponent(authMode);
      }}
      function detailBlock(details) {{
        const list = Array.isArray(details) ? details : [];
        if (!list.length) {{
          return "<div class='detail-status'>No connection details.</div>";
        }}
        const stale = list.filter(item => ['expired', 'initiated', 'initializing', 'pending'].includes(String(item.status || '').toLowerCase())).map(item => item.id).filter(Boolean);
        const active = list.filter(item => String(item.status || '').toLowerCase() === 'active').map(item => item.id).filter(Boolean);
        const tools = [];
        if (stale.length) tools.push("<button class='btn bulk' data-ids='" + stale.join(',') + "'>Remove stale (" + stale.length + ")</button>");
        if (active.length) tools.push("<button class='btn bulk' data-ids='" + active.join(',') + "'>Disconnect active (" + active.length + ")</button>");
        return (tools.length ? "<div class='tools'>" + tools.join('') + "</div>" : '') + list.map(item =>
          "<div class='detail-row'><span class='detail-id'>" + (item.instance_name || item.id || '') + "</span><span class='detail-status'>" + (item.status || '') + "</span><button class='btn del' data-id='" + (item.id || '') + "'>Remove</button></div>"
        ).join('');
      }}
      function cardHtml(app, showDetails) {{
        const logo = app.logo ? "<img src='" + app.logo + "' alt=''>" : "o";
        const counts = app.counts && typeof app.counts === 'object' ? app.counts : {{}};
        const label = (counts.total || 0) > 0 ? 'Reconnect' : 'Connect';
        const description = showDetails ? '' : ("<div class='slug'>" + (app.description || '') + "</div>");
        const detailHtml = showDetails ? "<div class='details' data-loaded='" + ((app.details || []).length ? '1' : '0') + "'>" + ((app.details || []).length ? detailBlock(app.details) : "<div class='detail-status'>Loading details...</div>") + "</div>" : '';
        return "<article class='card' data-slug='" + app.slug + "'><div class='card-main'><div class='logo'>" + logo + "</div><div class='meta'><div class='name'>" + (app.name || app.slug) + "</div><div class='slug'>" + (app.slug || '') + "</div>" + description + "<div class='status'>" + pills(counts) + "</div></div><a class='btn connect-btn' href='#' data-slug='" + app.slug + "'>" + label + "</a></div>" + detailHtml + "</article>";
      }}
      async function apiJson(url, options) {{
        const response = await fetch(url, options || {{ cache: 'no-store' }});
        const payload = await response.json().catch(() => ({{}}));
        if (!response.ok || payload.ok === false) {{
          throw new Error(String((payload && (payload.error || payload.detail || payload.message)) || 'Request failed'));
        }}
        return payload;
      }}
      async function disconnectOne(id) {{
        await apiJson('/api/links/composio/disconnect?token=' + encodeURIComponent(token) + '&connection_id=' + encodeURIComponent(id), {{ method: 'POST' }});
      }}
      let allOffset = 0;
      let allLimit = 24;
      let allHasMore = false;
      let allQuery = '';
      let allLoaded = false;
      let allLoading = false;
      let searchTimer = null;
      async function loadMy() {{
        const t0 = Date.now();
        const payload = await apiJson('/api/links/composio/my-apps?token=' + encodeURIComponent(token));
        const list = Array.isArray(payload.apps) ? payload.apps : [];
        myGrid.innerHTML = list.length ? list.map(item => cardHtml(item, true)).join('') : "<div class='empty'>No connected or interacted apps yet.</div>";
        summary.textContent = 'My Apps loaded in ' + (Date.now() - t0) + 'ms. Connected ' + (payload.summary?.connected || 0) + ', needs attention ' + (payload.summary?.needs_attention || 0) + ', interacted ' + (payload.summary?.interacted || 0) + '.';
      }}
      async function loadDetails(card) {{
        const slug = card.getAttribute('data-slug');
        const details = card.querySelector('.details');
        if (!slug || !details || details.getAttribute('data-loaded') === '1') return;
        const payload = await apiJson('/api/links/composio/app-details?token=' + encodeURIComponent(token) + '&slug=' + encodeURIComponent(slug));
        const list = Array.isArray(payload.details) ? payload.details : [];
        details.innerHTML = detailBlock(list);
        details.setAttribute('data-loaded', '1');
      }}
      async function loadAll(query, reset) {{
        if (allLoading) return;
        allLoading = true;
        summary.textContent = 'Loading apps...';
        const t0 = Date.now();
        try {{
          if (reset) {{
            allOffset = 0;
            allQuery = String(query || '');
            allGrid.innerHTML = '';
            allHasMore = false;
          }}
          const payload = await apiJson('/api/links/composio/all-apps?token=' + encodeURIComponent(token) + '&offset=' + allOffset + '&limit=' + allLimit + (allQuery ? '&q=' + encodeURIComponent(allQuery) : ''));
          const list = Array.isArray(payload.apps) ? payload.apps : [];
          if (reset && !list.length) {{
            allGrid.innerHTML = "<div class='empty'>No apps match your search.</div>";
          }} else if (list.length) {{
            allGrid.insertAdjacentHTML('beforeend', list.map(item => cardHtml(item, false)).join(''));
          }}
          allOffset += list.length;
          allHasMore = !!payload.has_more;
          allMore.classList.toggle('hide', !allHasMore);
          allSentinel.classList.toggle('hide', !allHasMore);
          allLoaded = true;
          summary.textContent = 'All Apps loaded in ' + (Date.now() - t0) + 'ms. Showing ' + allOffset + ' / ' + (payload.total || allOffset) + '.';
        }} finally {{
          allLoading = false;
        }}
      }}
      function nearBottom() {{
        const doc = document.documentElement;
        return (window.innerHeight + window.scrollY) >= (doc.scrollHeight - 220);
      }}
      async function maybeAutoLoadAll() {{
        if (!tabAll.classList.contains('active') || !allHasMore || allLoading) return;
        try {{
          await loadAll(allQuery, false);
        }} catch (error) {{
          showMessage(error.message || 'Load failed', 'error');
        }}
      }}
      document.body.addEventListener('click', async event => {{
        const connect = event.target.closest('.connect-btn');
        if (connect) {{
          event.preventDefault();
          hideMessage();
          const slug = connect.getAttribute('data-slug');
          if (!slug) return;
          const href = buildConnectHref(slug);
          if (authMode === 'browser') {{
            try {{
              await window.Pucky.request({{ command: 'browser.open', args: {{ url: new URL(href, window.location.href).toString() }} }});
              showMessage('Opened ' + slug + ' in the browser. Return here after auth to refresh status.', 'ok');
            }} catch (error) {{
              showMessage(error.message || 'Could not open browser auth', 'error');
            }}
            return;
          }}
          window.location.assign(href);
          return;
        }}
        const main = event.target.closest('.card-main');
        if (main && !event.target.closest('.btn')) {{
          const card = main.parentElement;
          card.classList.toggle('open');
          if (card.classList.contains('open') && myGrid.contains(card)) {{
            try {{
              await loadDetails(card);
            }} catch (error) {{
              showMessage(error.message || 'Failed loading details', 'error');
            }}
          }}
          return;
        }}
        const del = event.target.closest('.del');
        if (del) {{
          event.preventDefault();
          const id = del.getAttribute('data-id');
          if (!id) return;
          const prev = del.textContent;
          del.textContent = 'Removing...';
          del.disabled = true;
          try {{
            await disconnectOne(id);
            await loadMy();
            showMessage('Connection removed.', 'ok');
          }} catch (error) {{
            showMessage(error.message || 'Disconnect failed', 'error');
          }} finally {{
            del.textContent = prev;
            del.disabled = false;
          }}
          return;
        }}
        const bulk = event.target.closest('.bulk');
        if (bulk) {{
          event.preventDefault();
          const ids = String(bulk.getAttribute('data-ids') || '').split(',').map(value => value.trim()).filter(Boolean);
          if (!ids.length) return;
          const prev = bulk.textContent;
          bulk.textContent = 'Updating...';
          bulk.disabled = true;
          let ok = 0;
          try {{
            for (const id of ids) {{
              try {{
                await disconnectOne(id);
                ok += 1;
              }} catch (_err) {{}}
            }}
            await loadMy();
            showMessage('Updated ' + ok + '/' + ids.length + ' connection(s).', ok === ids.length ? 'ok' : 'error');
          }} catch (error) {{
            showMessage(error.message || 'Bulk update failed', 'error');
          }} finally {{
            bulk.textContent = prev;
            bulk.disabled = false;
          }}
        }}
      }});
      function showMyTab() {{
        tabMy.classList.add('active');
        tabAll.classList.remove('active');
        myGrid.classList.remove('hide');
        allGrid.classList.add('hide');
        search.classList.add('hide');
        allMore.classList.add('hide');
        allSentinel.classList.add('hide');
      }}
      function showAllTab() {{
        tabAll.classList.add('active');
        tabMy.classList.remove('active');
        allGrid.classList.remove('hide');
        myGrid.classList.add('hide');
        search.classList.remove('hide');
        allMore.classList.toggle('hide', !allHasMore);
        allSentinel.classList.toggle('hide', !allHasMore);
      }}
      tabMy.addEventListener('click', async () => {{
        showMyTab();
        hideMessage();
        try {{
          await loadMy();
        }} catch (error) {{
          showMessage(error.message || 'Load failed', 'error');
        }}
      }});
      tabAll.addEventListener('click', async () => {{
        showAllTab();
        hideMessage();
        try {{
          if (!allLoaded) {{
            await loadAll('', true);
          }}
        }} catch (error) {{
          showMessage(error.message || 'Load failed', 'error');
        }}
      }});
      refreshMy.addEventListener('click', async () => {{
        hideMessage();
        refreshMy.disabled = true;
        const prev = refreshMy.textContent;
        refreshMy.textContent = 'Refreshing...';
        try {{
          const payload = await apiJson('/api/links/composio/my-apps/refresh?token=' + encodeURIComponent(token), {{ method: 'POST' }});
          await loadMy();
          if (tabAll.classList.contains('active')) {{
            allLoaded = false;
            await loadAll(search.value || '', true);
          }}
          showMessage('My Apps refreshed. Connected count: ' + (payload.connected_count || 0) + '.', 'ok');
        }} catch (error) {{
          showMessage(error.message || 'Refresh failed', 'error');
        }} finally {{
          refreshMy.textContent = prev;
          refreshMy.disabled = false;
        }}
      }});
      allMore.addEventListener('click', async () => {{
        allMore.disabled = true;
        const prev = allMore.textContent;
        allMore.textContent = 'Loading...';
        try {{
          await loadAll(allQuery, false);
        }} catch (error) {{
          showMessage(error.message || 'Load failed', 'error');
        }} finally {{
          allMore.textContent = prev;
          allMore.disabled = false;
        }}
      }});
      search.addEventListener('input', () => {{
        clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {{
          try {{
            await loadAll(search.value || '', true);
          }} catch (error) {{
            showMessage(error.message || 'Search failed', 'error');
          }}
        }}, 220);
      }});
      modeWebview.addEventListener('click', () => setAuthMode('webview'));
      modeBrowser.addEventListener('click', () => setAuthMode('browser'));
      window.addEventListener('scroll', () => {{
        if (nearBottom()) maybeAutoLoadAll();
      }}, {{ passive: true }});
      setAuthMode(initialAuthMode);
      if (justConnected) {{
        showMessage('Connection flow finished for ' + justConnected + '. Refreshing your app states...', 'ok');
      }}
      loadMy().catch(error => showMessage(error.message || 'Failed loading My Apps', 'error'));
    </script>
  </body>
</html>"""


def make_handler(service: PuckyVoiceService):
    broker = _load_broker_module()

    class Handler(broker.Handler):
        server_version = "PuckyVoice/0.1"

        def do_OPTIONS(self) -> None:
            self.send_response(int(HTTPStatus.NO_CONTENT))
            self._cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:
            parsed = urlsplit(self.path)
            path = parsed.path
            if path == "/healthz":
                self._json(HTTPStatus.OK, service.health())
                return
            if path == "/api/links/composio/portal-url":
                query = parse_qs(parsed.query)
                payload = service.links_portal_url(
                    _request_base_url(self),
                    auth_mode=query.get("auth_mode", [""])[0],
                )
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/links/connect/apps":
                query = parse_qs(parsed.query)
                token = query.get("token", [""])[0]
                app = query.get("app", [""])[0]
                auth_mode = query.get("auth_mode", [""])[0]
                just_connected = query.get("just_connected", [""])[0]
                redirect_url = query.get("redirect_url", [""])[0]
                base_url = _request_base_url(self)
                if app:
                    try:
                        payload = service.links_start_oauth(
                            token,
                            app_slug=app,
                            base_url=base_url,
                            auth_mode=auth_mode,
                            redirect_url=redirect_url or None,
                        )
                    except ValueError as exc:
                        self._html(HTTPStatus.BAD_REQUEST, f"<h3>{html.escape(str(exc))}</h3>")
                        return
                    if payload.get("ok") and str(payload.get("auth_url") or "").strip():
                        self.send_response(int(HTTPStatus.TEMPORARY_REDIRECT))
                        self._cors_headers()
                        self.send_header("Location", str(payload.get("auth_url") or "").strip())
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                    detail = html.escape(str(payload.get("error") or "Unable to start connection"))
                    self._html(HTTPStatus.BAD_GATEWAY, f"<h3>Unable to start app connection.</h3><p>{detail}</p>")
                    return
                try:
                    service._resolve_links_portal_user(token)
                except ValueError:
                    self._html(HTTPStatus.UNAUTHORIZED, "<h3>Invalid or expired connect link.</h3>")
                    return
                back_url = f"{base_url.rstrip('/')}/ui/pucky/latest/?route=feed"
                self._html(
                    HTTPStatus.OK,
                    _links_portal_document(
                        token=token,
                        auth_mode=service.composio_auth_mode(auth_mode),
                        back_url=back_url,
                        just_connected=just_connected,
                    ),
                )
                return
            if path == "/api/links/composio/my-apps":
                query = parse_qs(parsed.query)
                try:
                    payload = service.links_my_apps(query.get("token", [""])[0])
                except ValueError as exc:
                    self._json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": str(exc)})
                    return
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/api/links/composio/all-apps":
                query = parse_qs(parsed.query)
                try:
                    payload = service.links_all_apps(
                        query.get("token", [""])[0],
                        query=query.get("q", [""])[0],
                        offset=int(query.get("offset", ["0"])[0]),
                        limit=int(query.get("limit", ["60"])[0]),
                    )
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                    return
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/api/links/composio/app-details":
                query = parse_qs(parsed.query)
                try:
                    payload = service.links_app_details(query.get("token", [""])[0], query.get("slug", [""])[0])
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                    return
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/api/links/composio/oauth/start":
                query = parse_qs(parsed.query)
                try:
                    payload = service.links_start_oauth(
                        query.get("token", [""])[0],
                        app_slug=query.get("app", [""])[0],
                        base_url=_request_base_url(self),
                        auth_mode=query.get("auth_mode", [""])[0],
                        redirect_url=query.get("redirect_url", [""])[0] or None,
                    )
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                    return
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/api/feed":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                query = parse_qs(parsed.query)
                cursor = query.get("cursor", [""])[0]
                limit = query.get("limit", ["20"])[0]
                try:
                    payload = service.feed_sync(cursor, int(limit))
                except Exception as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "feed_sync_failed", "detail": str(exc)})
                    return
                self._json(HTTPStatus.OK, payload)
                return
            if path == "/api/turn/status":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                turn_id = parse_qs(parsed.query).get("turn_id", [""])[0].strip()
                if not turn_id:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "missing_turn_id"})
                    return
                status = service.turn_status(turn_id)
                if status is None:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "turn_not_found"})
                    return
                self._json(HTTPStatus.OK, status)
                return
            if path == "/ui/pucky/latest/manifest.json":
                result = build_ui_bundle()
                self._json(HTTPStatus.OK, result["manifest"])
                return
            if path == "/ui/pucky/latest/bundle.zip":
                result = build_ui_bundle()
                self._file(Path(str(result["bundle_path"])), "application/zip")
                return
            if path == "/ui/pucky/fixtures/reply_cards.json":
                self._file(UI_SRC / "fixtures" / "reply_cards.json", "application/json")
                return
            if path == "/ui/pucky/latest" or path == "/ui/pucky/latest/":
                self._file(UI_SRC / "index.html", "text/html; charset=utf-8")
                return
            if path == "/ui/pucky/latest/pucky-config.js":
                self._text(HTTPStatus.OK, bundle_config_script(), "application/javascript; charset=utf-8")
                return
            if path.startswith("/ui/pucky/latest/"):
                relative = unquote(path.removeprefix("/ui/pucky/latest/")).lstrip("/")
                self._safe_ui_file(relative)
                return
            super().do_GET()

        def do_POST(self) -> None:
            parsed = urlsplit(self.path)
            path = parsed.path
            if path == "/api/links/composio/my-apps/refresh":
                query = parse_qs(parsed.query)
                try:
                    result = service.links_refresh_my_apps(query.get("token", [""])[0])
                except ValueError as exc:
                    self._json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": str(exc)})
                    return
                status = HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, result)
                return
            if path == "/api/links/composio/disconnect":
                query = parse_qs(parsed.query)
                try:
                    result = service.links_disconnect(query.get("token", [""])[0], query.get("connection_id", [""])[0])
                except ValueError as exc:
                    self._json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": str(exc)})
                    return
                status_code = int(result.get("status_code") or (HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_GATEWAY))
                self._json(HTTPStatus(status_code), result)
                return
            if path == "/api/feed/actions":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                try:
                    payload = json.loads(self._read_body(256 * 1024).decode("utf-8"))
                    result = service.feed_action(
                        str(payload.get("client_action_id") or ""),
                        str(payload.get("card_id") or ""),
                        str(payload.get("action") or ""),
                    )
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except KeyError:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "card_not_found"})
                    return
                except Exception as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "feed_action_failed", "detail": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            if path != "/api/turn":
                super().do_POST()
                return
            if not self._is_authorized():
                self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            content_type = self.headers.get("Content-Type", "application/octet-stream").split(";", 1)[0].strip()
            if content_type not in ALLOWED_CONTENT_TYPES:
                self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "unsupported_content_type"})
                return
            try:
                result = service.handle_audio_turn(
                    self._read_body(service.config.max_audio_bytes),
                    content_type,
                    self.headers.get("X-Pucky-Turn-Id", ""),
                    self.headers.get("X-Pucky-Reply-Mode", ""),
                )
            except ValueError as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            except Exception as exc:
                self.log_error("turn failed: %s", exc)
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "turn_failed", "detail": str(exc)})
                return
            self._json(HTTPStatus.OK, result)

        def log_message(self, fmt: str, *args: object) -> None:
            print(f"{self.address_string()} - {fmt % args}", flush=True)

        def _read_body(self, limit: int) -> bytes:
            length_text = self.headers.get("Content-Length")
            if length_text:
                length = int(length_text)
                if length > limit:
                    raise ValueError("audio body is too large")
                return self.rfile.read(length)
            data = self.rfile.read(limit + 1)
            if len(data) > limit:
                raise ValueError("audio body is too large")
            return data

        def _is_authorized(self) -> bool:
            return bool(service.config.pucky_api_token) and self.headers.get("Authorization", "") == f"Bearer {service.config.pucky_api_token}"

        def _json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(int(status))
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _text(self, status: HTTPStatus, text: str, content_type: str) -> None:
            body = text.encode("utf-8")
            self.send_response(int(status))
            self._cors_headers()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _html(self, status: HTTPStatus, html_text: str) -> None:
            self._text(status, html_text, "text/html; charset=utf-8")

        def _safe_ui_file(self, relative: str) -> None:
            try:
                root = UI_SRC.resolve()
                target = (root / relative).resolve()
                if root != target and root not in target.parents:
                    self._json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                    return
                if not target.is_file():
                    self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                    return
                self._file(target)
            except Exception as exc:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "ui_file_failed", "detail": str(exc)})

        def _file(self, path: Path, content_type: str | None = None) -> None:
            if not path.exists() or not path.is_file():
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            body = path.read_bytes()
            guessed = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self.send_response(int(HTTPStatus.OK))
            self._cors_headers()
            self.send_header("Content-Type", guessed)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _cors_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    return Handler


def serve(service: PuckyVoiceService) -> None:
    service.start()
    ensure_broker_initialized()
    server = ThreadingHTTPServer((service.config.host, service.config.port), make_handler(service))
    print(f"Pucky voice service listening on {service.config.host}:{service.config.port}", flush=True)
    server.serve_forever()


def main() -> int:
    config = Config.from_env()
    missing = [name for name, value in (("PUCKY_API_TOKEN", config.pucky_api_token), ("DEEPGRAM_API_KEY", config.deepgram_api_key), ("DEEPINFRA_API_KEY", config.deepinfra_api_key)) if not value]
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")
    serve(PuckyVoiceService(config))
    return 0


def _strip_json_fence(text: str) -> str:
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text
