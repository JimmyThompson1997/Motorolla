from __future__ import annotations

import json
from typing import Any

from pucky_vm.composio import COMPOSIO_HTTP_USER_AGENT, ComposioClient


class _FakeResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._payload

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def test_composio_client_sends_project_headers(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    def fake_urlopen(request, timeout: int = 0):  # type: ignore[no-untyped-def]
        captured["timeout"] = timeout
        captured["headers"] = {key.lower(): value for key, value in request.header_items()}
        captured["url"] = request.full_url
        captured["method"] = request.get_method()
        return _FakeResponse({"items": []})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    client = ComposioClient("test-key")
    payload = client.list_connected_apps("user-123", force=True)

    assert payload == {"connected_apps": []}
    assert captured["method"] == "GET"
    assert captured["timeout"] == 25
    assert captured["headers"]["accept"] == "application/json"
    assert captured["headers"]["x-api-key"] == "test-key"
    assert captured["headers"]["user-agent"] == COMPOSIO_HTTP_USER_AGENT
    assert captured["url"].startswith("https://backend.composio.dev/api/v3/connected_accounts?")
    assert "user_ids=user-123" in captured["url"]
    assert "statuses=ACTIVE" in captured["url"]
    assert "limit=1000" in captured["url"]


def test_composio_client_lists_only_active_connected_accounts_with_pagination(monkeypatch) -> None:
    client = ComposioClient("test-key")
    client._toolkits_cache = (  # type: ignore[attr-defined]
        9_999_999_999.0,
        [
            {"slug": "gmail", "name": "Gmail", "logo": "", "connectable": True},
            {"slug": "notion", "name": "Notion", "logo": "", "connectable": True},
            {"slug": "slack", "name": "Slack", "logo": "", "connectable": True},
        ],
    )
    seen: list[dict[str, Any]] = []

    def fake_request_json(method: str, path: str, payload: dict[str, Any] | None = None, query: dict[str, Any] | None = None) -> dict[str, Any]:
        assert method == "GET"
        assert path == "/connected_accounts"
        assert query is not None
        seen.append(dict(query))
        if query.get("statuses") != ["ACTIVE"]:
            return {
                "items": [
                    {"id": "expired-1", "status": "EXPIRED", "toolkit": {"slug": "slack", "name": "Slack"}},
                ]
            }
        if not query.get("cursor"):
            return {
                "items": [
                    {"id": "active-1", "status": "ACTIVE", "toolkit": {"slug": "gmail", "name": "Gmail"}},
                ],
                "next_cursor": "page-2",
            }
        return {
            "items": [
                {"id": "active-2", "status": "ACTIVE", "toolkit": {"slug": "notion", "name": "Notion"}},
            ],
            "next_cursor": "",
        }

    monkeypatch.setattr(client, "_request_json", fake_request_json)

    payload = client.list_connected_apps("user-123", force=True)

    assert seen == [
        {"user_ids": ["user-123"], "limit": 1000, "statuses": ["ACTIVE"]},
        {"user_ids": ["user-123"], "limit": 1000, "statuses": ["ACTIVE"], "cursor": "page-2"},
    ]
    assert payload["connected_apps"] == [
        {"slug": "gmail", "name": "Gmail", "logo": "", "status": "active", "id": "active-1", "instance_name": ""},
        {"slug": "notion", "name": "Notion", "logo": "", "status": "active", "id": "active-2", "instance_name": ""},
    ]


def test_composio_client_start_oauth_creates_managed_auth_config_then_links(monkeypatch) -> None:
    client = ComposioClient("test-key")
    client._toolkits_cache = (  # type: ignore[attr-defined]
        9_999_999_999.0,
        [
            {
                "slug": "gmail",
                "name": "Gmail",
                "logo": "",
                "description": "",
                "tools_count": 61,
                "auth_schemes": ["OAUTH2"],
                "managed_auth_schemes": ["OAUTH2"],
                "connectable": True,
                "connectability_reason": "",
                "app_url": "https://mail.google.com",
                "categories": ["email"],
            }
        ],
    )

    seen: list[tuple[str, str, dict[str, Any] | None]] = []

    def fake_request_json(method: str, path: str, payload: dict[str, Any] | None = None, query: dict[str, Any] | None = None) -> dict[str, Any]:
        seen.append((method, path, payload or query or None))
        if method == "GET" and path == "/auth_configs":
            return {"items": []}
        if method == "POST" and path == "/auth_configs":
            return {"auth_config": {"id": "ac_gmail_managed"}}
        if method == "POST" and path == "/connected_accounts/link":
            return {
                "connected_account_id": "ca_gmail_new",
                "redirect_url": "https://connect.composio.dev/link/test-gmail",
            }
        raise AssertionError(f"Unexpected request: {method} {path} {payload or query}")

    monkeypatch.setattr(client, "_request_json", fake_request_json)

    payload = client.start_oauth("user-123", "gmail", "https://pucky.fly.dev/links/connect/apps?token=abc")

    assert payload["ok"] is True
    assert payload["auth_config_id"] == "ac_gmail_managed"
    assert payload["connection_id"] == "ca_gmail_new"
    assert payload["auth_url"] == "https://connect.composio.dev/link/test-gmail"
    assert seen == [
        ("GET", "/auth_configs", {"toolkit_slug": "gmail", "show_disabled": "true", "limit": 1000}),
        (
            "POST",
            "/auth_configs",
            {
                "toolkit": {"slug": "gmail"},
                "auth_config": {
                    "type": "use_composio_managed_auth",
                    "credentials": {},
                    "restrict_to_following_tools": [],
                },
            },
        ),
        (
            "POST",
            "/connected_accounts/link",
            {
                "auth_config_id": "ac_gmail_managed",
                "user_id": "user-123",
                "callback_url": "https://pucky.fly.dev/links/connect/apps?token=abc",
            },
        ),
    ]
