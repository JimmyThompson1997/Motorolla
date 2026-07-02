from __future__ import annotations

import io
import json
from unittest import mock

import urllib.error

from pucky_vm.clerk_auth import ClerkAuthClient


class _FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def test_fetch_jwks_prefers_public_frontend_endpoint() -> None:
    calls: list[str] = []

    def fake_urlopen(request, timeout=0):
        calls.append(str(request.full_url))
        if str(request.full_url).endswith("/.well-known/jwks.json"):
            return _FakeResponse({"keys": [{"kid": "public-key"}]})
        raise AssertionError(f"unexpected urlopen request: {request.full_url}")

    client = ClerkAuthClient(
        secret_key="sk_test_example",
        frontend_api_url="https://clerk.example.com",
    )

    with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
        payload = client._fetch_jwks()

    assert payload["keys"][0]["kid"] == "public-key"
    assert calls == ["https://clerk.example.com/.well-known/jwks.json"]


def test_fetch_jwks_falls_back_to_backend_api_when_public_endpoint_fails() -> None:
    calls: list[tuple[str, str]] = []

    def fake_urlopen(request, timeout=0):
        url = str(request.full_url)
        auth = str(request.headers.get("Authorization") or "")
        calls.append((url, auth))
        if url.endswith("/.well-known/jwks.json"):
            raise urllib.error.HTTPError(url, 403, "Forbidden", hdrs=None, fp=io.BytesIO(b"blocked"))
        if url == "https://api.clerk.com/v1/jwks":
            return _FakeResponse({"keys": [{"kid": "backend-key"}]})
        raise AssertionError(f"unexpected urlopen request: {url}")

    client = ClerkAuthClient(
        secret_key="sk_test_example",
        frontend_api_url="https://clerk.example.com",
    )

    with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
        payload = client._fetch_jwks()

    assert payload["keys"][0]["kid"] == "backend-key"
    assert calls == [
        ("https://clerk.example.com/.well-known/jwks.json", ""),
        ("https://api.clerk.com/v1/jwks", "Bearer sk_test_example"),
    ]
