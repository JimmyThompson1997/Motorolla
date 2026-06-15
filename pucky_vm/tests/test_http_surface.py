from __future__ import annotations

import pytest

from pucky_vm import http_surface


def test_request_base_url_prefers_configured_public_base_url() -> None:
    headers = {
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "evil.example",
        "Host": "127.0.0.1:8080",
    }

    assert (
        http_surface.request_base_url(
            headers,
            ("127.0.0.1", 8080),
            public_base_url="https://pucky.fly.dev/",
        )
        == "https://pucky.fly.dev"
    )


def test_request_base_url_ignores_forwarded_headers_without_public_base_url() -> None:
    headers = {
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "evil.example",
        "Host": "also-evil.example",
    }

    assert http_surface.request_base_url(headers, ("127.0.0.1", 8080)) == "http://127.0.0.1:8080"


def test_parse_content_length_validates_bounds() -> None:
    assert http_surface.parse_content_length("12", 100) == 12
    assert http_surface.parse_content_length("", 100) is None

    with pytest.raises(ValueError, match="invalid_content_length"):
        http_surface.parse_content_length("-1", 100)

    with pytest.raises(ValueError, match="audio body is too large"):
        http_surface.parse_content_length("101", 100)


def test_authorization_and_cors_helpers_are_stable() -> None:
    assert http_surface.is_bearer_authorized("token-123", "Bearer token-123") is True
    assert http_surface.is_bearer_authorized("token-123", "Bearer wrong") is False
    assert dict(http_surface.cors_header_items())["Access-Control-Allow-Origin"] == "*"


def test_body_helpers_and_content_disposition_encode_expected_text() -> None:
    assert http_surface.json_body({"ok": True}) == b'{"ok":true}'
    assert http_surface.text_body("hello") == b"hello"
    assert http_surface.inline_content_disposition("proof notes.txt") == "inline; filename*=UTF-8''proof%20notes.txt"
