from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl
from urllib.request import Request, urlopen


class KlavisError(RuntimeError):
    pass


@dataclass(frozen=True)
class KlavisApp:
    name: str
    description: str
    auth_needed: bool


@dataclass(frozen=True)
class KlavisConnection:
    server_name: str
    instance_id: str
    server_url: str
    oauth_url: str


def append_query_param(url: str, key: str, value: str) -> str:
    parsed = urlsplit(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query[key] = value
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


class KlavisClient:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = "https://api.klavis.ai",
        dashboard_url: str = "https://www.klavis.ai/home",
        user_id: str = "",
    ) -> None:
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.dashboard_url = dashboard_url.rstrip("/")
        self.user_id = user_id.strip()

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.user_id)

    def list_apps(self) -> list[KlavisApp]:
        payload = self._get_json("/mcp-server/servers")
        raw_servers = payload.get("servers")
        if not isinstance(raw_servers, list):
            raise KlavisError("Klavis server catalog payload is malformed")
        apps: list[KlavisApp] = []
        for item in raw_servers:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name:
                continue
            apps.append(
                KlavisApp(
                    name=name,
                    description=str(item.get("description") or item.get("summary") or "").strip(),
                    auth_needed=bool(item.get("authNeeded")),
                )
            )
        return sorted(apps, key=lambda item: item.name.lower())

    def list_statuses(self) -> dict[str, bool]:
        payload = self._get_json(f"/user/{self.user_id}/integrations")
        raw_integrations = payload.get("integrations")
        if not isinstance(raw_integrations, list):
            return {}
        statuses: dict[str, bool] = {}
        for item in raw_integrations:
            if not isinstance(item, dict):
                continue
            name = str(item.get("app_name") or item.get("serverName") or item.get("name") or "").strip()
            if not name:
                continue
            statuses[name] = bool(item.get("is_authenticated") or item.get("isAuthenticated"))
        return statuses

    def create_connection(self, server_name: str, *, callback_url: str = "") -> KlavisConnection:
        payload = self._post_json(
            "/mcp-server/instance/create",
            {
                "serverName": server_name,
                "userId": self.user_id,
                "connectionType": "StreamableHttp",
                "legacy": False,
                "isReadOnly": False,
            },
        )
        instance_id = str(payload.get("instanceId") or "").strip()
        server_url = str(payload.get("serverUrl") or "").strip()
        oauth_url = str(payload.get("oauthUrl") or "").strip()
        if not instance_id or not server_url or not oauth_url:
            raise KlavisError("Klavis instance create payload is malformed")
        if callback_url:
            oauth_url = append_query_param(oauth_url, "redirect_url", callback_url)
        return KlavisConnection(
            server_name=server_name,
            instance_id=instance_id,
            server_url=server_url,
            oauth_url=oauth_url,
        )

    def _get_json(self, path: str) -> dict[str, Any]:
        return self._request_json("GET", path)

    def _post_json(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        return self._request_json("POST", path, body=body)

    def _request_json(self, method: str, path: str, *, body: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.api_key:
            raise KlavisError("Klavis API key is missing")
        data = None
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(self.base_url + path, data=data, method=method, headers=headers)
        try:
            with urlopen(request, timeout=20) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise KlavisError(f"Klavis {method} {path} failed: {exc.code} {detail}") from exc
        except URLError as exc:
            raise KlavisError(f"Klavis {method} {path} failed: {exc.reason}") from exc
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise KlavisError(f"Klavis {method} {path} returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise KlavisError(f"Klavis {method} {path} returned malformed JSON")
        return payload
