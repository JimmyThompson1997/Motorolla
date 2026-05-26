from __future__ import annotations

import json
from typing import Any

from pucky_vm.klavis import KLAVIS_HTTP_USER_AGENT, KlavisClient


class _FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._payload

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def test_klavis_client_sends_browser_like_headers(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_urlopen(request, timeout: int = 0):  # type: ignore[no-untyped-def]
        captured["timeout"] = timeout
        captured["headers"] = {key.lower(): value for key, value in request.header_items()}
        captured["url"] = request.full_url
        captured["method"] = request.get_method()
        return _FakeResponse({"integrations": []})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    client = KlavisClient("test-key")
    payload = client.get_user_integrations("user-123")

    assert payload == {"integrations": []}
    assert captured["method"] == "GET"
    assert captured["url"] == "https://api.klavis.ai/user/user-123/integrations"
    assert captured["timeout"] == 20
    assert captured["headers"]["accept"] == "application/json"
    assert captured["headers"]["authorization"] == "Bearer test-key"
    assert captured["headers"]["x-api-key"] == "test-key"
    assert captured["headers"]["user-agent"] == KLAVIS_HTTP_USER_AGENT


def test_klavis_client_json_post_preserves_headers_and_payload(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_urlopen(request, timeout: int = 0):  # type: ignore[no-untyped-def]
        captured["headers"] = {key.lower(): value for key, value in request.header_items()}
        captured["body"] = request.data.decode("utf-8")
        captured["method"] = request.get_method()
        return _FakeResponse({"instanceId": "instance-gmail"})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    client = KlavisClient("test-key")
    payload = client.create_instance(server_name="Gmail", user_id="user-123")

    assert payload == {"instanceId": "instance-gmail"}
    assert captured["method"] == "POST"
    assert captured["headers"]["content-type"] == "application/json"
    assert captured["headers"]["user-agent"] == KLAVIS_HTTP_USER_AGENT
    assert json.loads(captured["body"]) == {
        "serverName": "Gmail",
        "server_name": "Gmail",
        "userId": "user-123",
        "user_id": "user-123",
    }
