from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


DEFAULT_COMPOSIO_BASE_URL = "https://backend.composio.dev/api/v3"
COMPOSIO_HTTP_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/136.0.0.0 Safari/537.36"
)

USER_ENTERED_AUTH_SCHEMES = {
    "API_KEY",
    "BASIC",
    "BEARER_TOKEN",
    "GOOGLE_SERVICE_ACCOUNT",
    "SERVICE_ACCOUNT",
    "BASIC_WITH_JWT",
    "CALCOM_AUTH",
}
UTILITY_SLUG_DENYLIST = {
    "composio",
    "bravesearch",
    "tavily",
    "exa",
    "firecrawl",
    "fetchurl",
    "openrouter",
    "huggingface",
    "markdown2doc",
    "doc2markdown",
    "mem0",
    "resend",
    "postman",
    "postgres",
    "supabase",
    "vercel",
    "cloudflare",
}


def _safe_slug(value: object) -> str:
    return str(value or "").strip().lower()


def _safe_name(value: object, *, fallback: str = "") -> str:
    text = str(value or "").strip()
    return text or fallback


def _slug_matches_app(slug: str, name: str) -> bool:
    compact_slug = "".join(ch for ch in slug.lower() if ch.isalnum())
    compact_name = "".join(ch for ch in name.lower() if ch.isalnum())
    if not compact_slug or not compact_name:
        return False
    if compact_slug in UTILITY_SLUG_DENYLIST:
        return False
    return True


class ComposioClient:
    def __init__(self, api_key: str, base_url: str = DEFAULT_COMPOSIO_BASE_URL) -> None:
        self.api_key = str(api_key or "").strip()
        self.base_url = str(base_url or DEFAULT_COMPOSIO_BASE_URL).rstrip("/")
        self._toolkits_cache: tuple[float, list[dict[str, Any]]] | None = None
        self._connected_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._toolkits_cache_ttl_s = 600.0
        self._connected_cache_ttl_s = 20.0

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def invalidate_connected_cache(self, user_id: str) -> None:
        self._connected_cache.pop(str(user_id or "").strip(), None)

    def list_apps(self) -> dict[str, Any]:
        apps = self._cached_toolkits(force=False)
        return {
            "ok": True,
            "apps": apps,
            "count": len(apps),
            "connectable_count": sum(1 for item in apps if item.get("connectable")),
            "nonconnectable_count": sum(1 for item in apps if not item.get("connectable")),
        }

    def list_connected_apps(self, user_id: str, *, force: bool = False) -> dict[str, Any]:
        user_key = str(user_id or "").strip()
        if not user_key:
            return {"connected_apps": []}
        if not force:
            cached = self._connected_cache.get(user_key)
            if cached and (time.time() - cached[0]) < self._connected_cache_ttl_s:
                return {"connected_apps": list(cached[1])}
        toolkit_meta = {item["slug"]: item for item in self._cached_toolkits(force=False)}
        payload = self._request_json(
            "GET",
            "/connected_accounts",
            query={"user_ids": [user_key], "limit": 1000},
        )
        accounts = list(payload.get("items") or [])
        connected_apps: list[dict[str, Any]] = []
        for item in accounts:
            if not isinstance(item, dict):
                continue
            toolkit = item.get("toolkit")
            if isinstance(toolkit, dict):
                slug = _safe_slug(toolkit.get("slug"))
                name = _safe_name(toolkit.get("name"))
            else:
                slug = _safe_slug(item.get("toolkit_slug") or item.get("app"))
                name = _safe_name(item.get("toolkit_name") or item.get("name"), fallback=slug.title())
            if not slug:
                continue
            meta = toolkit_meta.get(slug, {})
            connected_apps.append(
                {
                    "slug": slug,
                    "name": _safe_name(meta.get("name"), fallback=name or slug.title()),
                    "logo": _safe_name(meta.get("logo"), fallback=item.get("logo") or ""),
                    "status": _safe_name(item.get("status"), fallback="unknown").lower(),
                    "id": _safe_name(item.get("id")),
                    "instance_name": _safe_name(item.get("alias") or item.get("name") or ""),
                }
            )
        self._connected_cache[user_key] = (time.time(), connected_apps)
        return {"connected_apps": connected_apps}

    def start_oauth(self, user_id: str, app_slug: str, redirect_url: str | None = None) -> dict[str, Any]:
        user_key = str(user_id or "").strip()
        slug = _safe_slug(app_slug)
        if not user_key:
            return {"ok": False, "error": "user_id_required"}
        if not slug:
            return {"ok": False, "error": "app_slug_required"}
        apps = self._cached_toolkits(force=False)
        app = next((item for item in apps if item["slug"] == slug), None)
        if app is None:
            return {"ok": False, "error": f"unknown_toolkit:{slug}"}
        if not app.get("connectable"):
            reason = _safe_name(app.get("connectability_reason"), fallback="Toolkit requires manual setup")
            return {"ok": False, "error": reason}

        configs = list(self._list_auth_configs(slug).get("items") or [])
        enabled = [item for item in configs if _safe_name(item.get("status")).upper() == "ENABLED"]
        preferred_enabled = [
            item for item in enabled
            if bool(item.get("is_composio_managed")) or _safe_name(item.get("type")).lower() == "default"
        ]
        chosen = preferred_enabled[0] if preferred_enabled else (enabled[0] if enabled else None)

        if chosen is None and configs:
            first_id = _safe_name(configs[0].get("id"))
            if first_id:
                try:
                    self._request_json("PATCH", f"/auth_configs/{urllib.parse.quote(first_id, safe='')}/enable")
                    refreshed = list(self._list_auth_configs(slug).get("items") or [])
                    enabled = [item for item in refreshed if _safe_name(item.get("status")).upper() == "ENABLED"]
                    preferred_enabled = [
                        item for item in enabled
                        if bool(item.get("is_composio_managed")) or _safe_name(item.get("type")).lower() == "default"
                    ]
                    chosen = preferred_enabled[0] if preferred_enabled else (enabled[0] if enabled else None)
                except Exception:
                    chosen = None

        if chosen is None:
            created = self._request_json(
                "POST",
                "/auth_configs",
                payload={
                    "toolkit": {"slug": slug},
                    "auth_config": {
                        "type": "use_composio_managed_auth",
                        "credentials": {},
                        "restrict_to_following_tools": [],
                    },
                },
            )
            chosen = created.get("auth_config") if isinstance(created.get("auth_config"), dict) else created

        auth_config_id = _safe_name(chosen.get("id") if isinstance(chosen, dict) else "")
        if not auth_config_id:
            return {"ok": False, "error": "auth_config_unavailable"}

        body = {"auth_config_id": auth_config_id, "user_id": user_key}
        if redirect_url:
            body["callback_url"] = str(redirect_url).strip()
        try:
            link = self._request_json("POST", "/connected_accounts/link", payload=body)
        except RuntimeError:
            if not redirect_url:
                raise
            body.pop("callback_url", None)
            link = self._request_json("POST", "/connected_accounts/link", payload=body)
        self.invalidate_connected_cache(user_key)
        auth_url = _safe_name(link.get("redirect_url"))
        if not auth_url:
            return {"ok": False, "error": "composio_auth_url_missing"}
        return {
            "ok": True,
            "auth_url": auth_url,
            "redirect_url": auth_url,
            "connection_id": _safe_name(link.get("connected_account_id") or link.get("id")),
            "auth_config_id": auth_config_id,
        }

    def delete_connection(self, user_id: str, connection_id: str) -> dict[str, Any]:
        user_key = str(user_id or "").strip()
        connection_key = str(connection_id or "").strip()
        if not user_key or not connection_key:
            return {"ok": False, "error": "missing_connection_id", "status_code": 400}
        owned = self._request_json(
            "GET",
            "/connected_accounts",
            query={"user_ids": [user_key], "connected_account_ids": [connection_key], "limit": 1},
        )
        if not list(owned.get("items") or []):
            return {"ok": False, "error": "forbidden", "status_code": 403}
        self._request_json("DELETE", f"/connected_accounts/{urllib.parse.quote(connection_key, safe='')}")
        self.invalidate_connected_cache(user_key)
        return {"ok": True, "deleted": connection_key}

    def _list_auth_configs(self, toolkit_slug: str) -> dict[str, Any]:
        return self._request_json(
            "GET",
            "/auth_configs",
            query={"toolkit_slug": toolkit_slug, "show_disabled": "true", "limit": 1000},
        )

    def _cached_toolkits(self, *, force: bool) -> list[dict[str, Any]]:
        if not force and self._toolkits_cache and (time.time() - self._toolkits_cache[0]) < self._toolkits_cache_ttl_s:
            return list(self._toolkits_cache[1])
        items = self._list_all_toolkits()
        apps: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            slug = _safe_slug(item.get("slug"))
            name = _safe_name(item.get("name"), fallback=slug.title())
            if not slug or not _slug_matches_app(slug, name):
                continue
            auth_schemes = [str(value).strip().upper() for value in list(item.get("auth_schemes") or []) if str(value).strip()]
            managed_auth_schemes = [
                str(value).strip().upper() for value in list(item.get("composio_managed_auth_schemes") or []) if str(value).strip()
            ]
            connectable = bool(managed_auth_schemes) or bool(USER_ENTERED_AUTH_SCHEMES.intersection(auth_schemes))
            meta = item.get("meta") if isinstance(item.get("meta"), dict) else {}
            apps.append(
                {
                    "slug": slug,
                    "name": name,
                    "logo": _safe_name(meta.get("logo")),
                    "description": _safe_name(meta.get("description")),
                    "tools_count": int(meta.get("tools_count") or 0),
                    "auth_schemes": auth_schemes,
                    "managed_auth_schemes": managed_auth_schemes,
                    "connectable": connectable,
                    "connectability_reason": "" if connectable else "Requires manual setup",
                    "app_url": _safe_name(meta.get("app_url")),
                    "categories": [
                        _safe_name(category.get("name"))
                        for category in list(meta.get("categories") or [])
                        if isinstance(category, dict) and _safe_name(category.get("name"))
                    ],
                }
            )
        apps.sort(key=lambda record: (0 if record["connectable"] else 1, str(record["name"]).lower()))
        self._toolkits_cache = (time.time(), apps)
        return list(apps)

    def _list_all_toolkits(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        cursor = ""
        seen_cursors: set[str] = set()
        while True:
            query: dict[str, Any] = {
                "managed_by": "composio",
                "sort_by": "usage",
                "limit": 200,
                "include_deprecated": "false",
            }
            if cursor:
                query["cursor"] = cursor
            page = self._request_json("GET", "/toolkits", query=query)
            page_items = [item for item in list(page.get("items") or []) if isinstance(item, dict)]
            items.extend(page_items)
            next_cursor = _safe_name(page.get("next_cursor"))
            if not next_cursor or next_cursor in seen_cursors:
                break
            seen_cursors.add(next_cursor)
            cursor = next_cursor
        return items

    def _request_json(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        query: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not self.configured:
            raise RuntimeError("Composio is not configured")
        body = None
        headers = {
            "Accept": "application/json",
            "User-Agent": COMPOSIO_HTTP_USER_AGENT,
            "x-api-key": self.api_key,
        }
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        url = self.base_url + path
        if query:
            parts: list[tuple[str, str]] = []
            for key, value in query.items():
                if value is None:
                    continue
                if isinstance(value, (list, tuple)):
                    for item in value:
                        if item is None:
                            continue
                        parts.append((str(key), str(item)))
                else:
                    parts.append((str(key), str(value)))
            if parts:
                url += "?" + urllib.parse.urlencode(parts, doseq=True)
        request = urllib.request.Request(url, data=body, method=method.upper(), headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                data = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Composio {method.upper()} {path} failed: {exc.code} {detail}".strip()) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Composio {method.upper()} {path} failed: {exc.reason}") from exc
        if not data:
            return {}
        decoded = json.loads(data.decode("utf-8"))
        if isinstance(decoded, dict):
            return decoded
        if isinstance(decoded, list):
            return {"items": decoded}
        raise RuntimeError(f"Unexpected Composio response for {path}")
