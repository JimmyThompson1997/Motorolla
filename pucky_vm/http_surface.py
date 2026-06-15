from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit


def _normalized_public_base_url(value: object) -> str:
    clean = str(value or "").strip()
    if not clean:
        return ""
    parsed = urlsplit(clean)
    scheme = parsed.scheme.lower()
    netloc = parsed.netloc.strip()
    if scheme not in {"http", "https"} or not netloc:
        return ""
    return urlunsplit((scheme, netloc, "", "", ""))


def request_base_url(
    headers: Any,
    server_address: tuple[str, int],
    *,
    public_base_url: str | None = None,
) -> str:
    normalized = _normalized_public_base_url(public_base_url)
    if normalized:
        return normalized
    host = str(server_address[0] or "").strip() or "127.0.0.1"
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    return f"http://{host}:{int(server_address[1])}"


def parse_content_length(length_text: str | None, limit: int) -> int | None:
    clean = str(length_text or "").strip()
    if not clean:
        return None
    try:
        length = int(clean)
    except Exception:
        raise ValueError("invalid_content_length")
    if length < 0:
        raise ValueError("invalid_content_length")
    if length > limit:
        raise ValueError("audio body is too large")
    return length


def is_bearer_authorized(expected_token: str, authorization_header: str) -> bool:
    return bool(str(expected_token or "").strip()) and str(authorization_header or "") == f"Bearer {expected_token}"


def cors_header_items() -> tuple[tuple[str, str], ...]:
    return (
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type, Authorization"),
    )


def json_body(payload: dict[str, object]) -> bytes:
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def text_body(text: str) -> bytes:
    return text.encode("utf-8")


def inline_content_disposition(filename: str) -> str:
    return f"inline; filename*=UTF-8''{quote(filename)}"
