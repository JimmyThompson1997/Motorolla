from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import quote


DEFAULT_KLAVIS_BASE_URL = "https://api.klavis.ai"
KLAVIS_HTTP_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/136.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class CuratedLinkApp:
    key: str
    name: str
    aliases: tuple[str, ...]


CURATED_LINK_APPS: tuple[CuratedLinkApp, ...] = (
    CuratedLinkApp("gmail", "Gmail", ("gmail",)),
    CuratedLinkApp("slack", "Slack", ("slack",)),
    CuratedLinkApp("github", "GitHub", ("github",)),
    CuratedLinkApp("gitlab", "GitLab", ("gitlab",)),
    CuratedLinkApp("linkedin", "LinkedIn", ("linkedin",)),
    CuratedLinkApp("notion", "Notion", ("notion",)),
    CuratedLinkApp("googledrive", "Google Drive", ("googledrive", "google drive")),
    CuratedLinkApp("googledocs", "Google Docs", ("googledocs", "google docs")),
    CuratedLinkApp("googlesheets", "Google Sheets", ("googlesheets", "google sheets")),
    CuratedLinkApp("googlecalendar", "Google Calendar", ("googlecalendar", "google calendar")),
    CuratedLinkApp("salesforce", "Salesforce", ("salesforce",)),
    CuratedLinkApp("stripe", "Stripe", ("stripe",)),
    CuratedLinkApp("shopify", "Shopify", ("shopify",)),
    CuratedLinkApp("dropbox", "Dropbox", ("dropbox",)),
    CuratedLinkApp("outlookmail", "Outlook Mail", ("outlookmail", "outlook mail")),
    CuratedLinkApp("outlookcalendar", "Outlook Calendar", ("outlookcalendar", "outlook calendar")),
    CuratedLinkApp("microsoftteams", "Microsoft Teams", ("microsoftteams", "microsoft teams")),
    CuratedLinkApp("hubspot", "HubSpot", ("hubspot",)),
    CuratedLinkApp("figma", "Figma", ("figma",)),
)

CURATED_LINK_LOOKUP = {
    re.sub(r"[^a-z0-9]+", "", alias.lower()): app
    for app in CURATED_LINK_APPS
    for alias in app.aliases
}
CURATED_LINK_ORDER = {app.key: index for index, app in enumerate(CURATED_LINK_APPS)}


def normalize_link_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def first_string(record: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def first_bool(record: dict[str, object], *keys: str) -> bool | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, bool):
            return value
    return None


def first_list(record: dict[str, object], *keys: str) -> list[object]:
    for key in keys:
        value = record.get(key)
        if isinstance(value, list):
            return value
    return []


def choose_curated_link_app(name: str) -> CuratedLinkApp | None:
    return CURATED_LINK_LOOKUP.get(normalize_link_key(name))


def tool_count(record: dict[str, object]) -> int:
    if isinstance(record.get("toolCount"), int):
        return int(record["toolCount"])
    if isinstance(record.get("tool_count"), int):
        return int(record["tool_count"])
    return len(first_list(record, "tools", "tool_list"))


def auth_type_for(record: dict[str, object]) -> str:
    explicit = first_string(record, "authType", "auth_type", "credentialType", "credential_type")
    if explicit:
        normalized = normalize_link_key(explicit)
        if "api" in normalized:
            return "api_key"
    auth_needed = first_bool(record, "authNeeded", "auth_needed", "requiresAuth", "requires_auth")
    if auth_needed is False:
        return "direct"
    return "oauth"


def curated_catalog(payload: dict[str, object] | list[object]) -> list[dict[str, object]]:
    if isinstance(payload, list):
        records = payload
    elif isinstance(payload, dict):
        raw = payload.get("servers")
        if isinstance(raw, list):
            records = raw
        else:
            data = payload.get("data")
            records = data if isinstance(data, list) else []
    else:
        records = []

    apps: list[dict[str, object]] = []
    for item in records:
        if not isinstance(item, dict):
            continue
        server_name = first_string(item, "serverName", "server_name", "name", "slug", "id")
        app = choose_curated_link_app(server_name)
        if app is None:
            continue
        description = first_string(item, "description", "summary", "tagline")
        apps.append(
            {
                "key": app.key,
                "name": app.name,
                "server_name": server_name,
                "description": description,
                "auth_type": auth_type_for(item),
                "tool_count": tool_count(item),
            }
        )
    apps.sort(key=lambda item: (CURATED_LINK_ORDER.get(str(item["key"]), 10_000), str(item["name"])))
    return apps


def integration_status_map(payload: dict[str, object] | list[object]) -> dict[str, dict[str, object]]:
    if isinstance(payload, list):
        records = payload
    elif isinstance(payload, dict):
        raw = payload.get("integrations")
        if isinstance(raw, list):
            records = raw
        else:
            data = payload.get("data")
            records = data if isinstance(data, list) else []
    else:
        records = []

    statuses: dict[str, dict[str, object]] = {}
    for item in records:
        if not isinstance(item, dict):
            continue
        server_name = first_string(item, "serverName", "server_name", "name", "slug", "app")
        curated = choose_curated_link_app(server_name)
        if curated is None:
            continue
        connected = first_bool(item, "is_authenticated", "isAuthenticated", "connected", "authenticated", "ready")
        state = "connected" if connected else "available"
        status_text = first_string(item, "status", "state")
        if status_text:
            normalized = normalize_link_key(status_text)
            if normalized in {"pending", "authpending"}:
                state = "pending"
            elif normalized in {"connected", "authenticated", "ready", "active"}:
                state = "connected"
        statuses[curated.key] = {
            "state": state,
            "server_name": server_name,
        }
    return statuses


class KlavisClient:
    def __init__(self, api_key: str, base_url: str = DEFAULT_KLAVIS_BASE_URL) -> None:
        self.api_key = str(api_key or "").strip()
        self.base_url = str(base_url or DEFAULT_KLAVIS_BASE_URL).rstrip("/")

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def list_servers(self) -> dict[str, object]:
        return self._request_json("GET", "/mcp-server/servers")

    def get_user_integrations(self, user_id: str) -> dict[str, object]:
        return self._request_json("GET", f"/user/{quote(str(user_id).strip(), safe='')}/integrations")

    def create_instance(self, *, server_name: str, user_id: str) -> dict[str, object]:
        return self._request_json(
            "POST",
            "/mcp-server/instance/create",
            {
                "serverName": server_name,
                "server_name": server_name,
                "userId": user_id,
                "user_id": user_id,
            },
        )

    def _request_json(self, method: str, path: str, payload: dict[str, object] | None = None) -> dict[str, object]:
        if not self.configured:
            raise RuntimeError("Klavis is not configured")
        body = None
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": KLAVIS_HTTP_USER_AGENT,
            "x-api-key": self.api_key,
        }
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base_url + path, data=body, method=method.upper(), headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                data = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Klavis {method.upper()} {path} failed: {exc.code} {detail}".strip()) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Klavis {method.upper()} {path} failed: {exc.reason}") from exc
        if not data:
            return {}
        decoded = json.loads(data.decode("utf-8"))
        if isinstance(decoded, dict):
            return decoded
        if isinstance(decoded, list):
            return {"data": decoded}
        raise RuntimeError(f"Unexpected Klavis response for {path}")
