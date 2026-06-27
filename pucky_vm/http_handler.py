from __future__ import annotations

import base64
import cgi
import html
import io
import json
import mimetypes
from http import HTTPStatus
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, unquote, urlsplit

from .http_surface import (
    cors_header_items,
    inline_content_disposition,
    is_any_bearer_authorized,
    json_body,
    parse_content_length,
    request_base_url,
    text_body,
)
from .links_portal import _links_portal_document
from .ui_bundle import UI_SRC, bundle_config_script
from .ui_runtime_surface import latest_ui_bundle_path, latest_ui_manifest, runtime_reply_cards_fixture_text
from .workspace_store import WORKSPACE_COLLECTIONS

if TYPE_CHECKING:
    from .server import PuckyVoiceService


def _truthy_query(value: object) -> bool:
    return str(value or "").strip().lower() not in ("", "0", "false", "no", "off")


PUBLIC_BROWSER_TASK_STATUSES = frozenset({"todo", "in_progress", "waiting", "done"})


def _multipart_form_payload(headers, body: bytes) -> tuple[dict[str, object], list[dict[str, object]]]:
    form = cgi.FieldStorage(
        fp=io.BytesIO(body),
        headers=headers,
        environ={
            "REQUEST_METHOD": "POST",
            "CONTENT_TYPE": str(headers.get("Content-Type") or ""),
            "CONTENT_LENGTH": str(len(body)),
        },
        keep_blank_values=True,
    )
    payload: dict[str, object] = {}
    files: list[dict[str, object]] = []
    for key in form.keys():
        field = form[key]
        items = field if isinstance(field, list) else [field]
        for item in items:
            if getattr(item, "filename", None):
                files.append(
                    {
                        "field_name": str(key or "").strip(),
                        "filename": str(item.filename or "").strip() or "attachment",
                        "content_type": str(item.type or "application/octet-stream").strip() or "application/octet-stream",
                        "content": item.file.read() if getattr(item, "file", None) is not None else b"",
                    }
                )
            else:
                payload[str(key or "").strip()] = item.value
    return payload, files


def make_handler(service: "PuckyVoiceService", *, broker: Any, allowed_content_types: set[str]):
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
            if path == "/favicon.ico":
                self.send_response(int(HTTPStatus.NO_CONTENT))
                self._cors_headers()
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            if path == "/healthz":
                self._json(HTTPStatus.OK, service.health())
                return
            if path == "/api/agent-runtime/catalog":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                self._json(HTTPStatus.OK, service.agent_runtime_catalog())
                return
            if path == "/api/ui/route-perf-events":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                query = parse_qs(parsed.query)
                try:
                    limit = int(query.get("limit", ["250"])[0])
                except ValueError:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_limit"})
                    return
                self._json(
                    HTTPStatus.OK,
                    service.recent_ui_route_perf_events(
                        run_id=query.get("run_id", [""])[0],
                        limit=limit,
                    ),
                )
                return
            if path == "/api/links/composio/portal-url":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                query = parse_qs(parsed.query)
                payload = service.links_portal_url(
                    self._request_base_url(),
                    auth_mode=query.get("auth_mode", [""])[0],
                )
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/api/device/phone-role-status":
                if not self._is_authorized():
                    self._json(
                        HTTPStatus.UNAUTHORIZED,
                        {
                            "schema": "pucky.phone_role_status.v1",
                            "state": "unavailable",
                            "role_held": False,
                            "eligible": False,
                            "default_dialer_package": "",
                            "default_dialer_label": "",
                            "source": "browser_live_api",
                            "device_id": "",
                            "read_only": True,
                            "error_code": "unauthorized",
                        },
                    )
                    return
                query = parse_qs(parsed.query)
                status, payload = service.browser_phone_role_status(query.get("device_id", [""])[0])
                self._json(status, payload)
                return
            if path == "/links/connect/apps":
                query = parse_qs(parsed.query)
                token = query.get("token", [""])[0]
                app = query.get("app", [""])[0]
                auth_mode = query.get("auth_mode", [""])[0]
                just_connected = query.get("just_connected", [""])[0]
                redirect_url = query.get("redirect_url", [""])[0]
                base_url = self._request_base_url()
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
                back_url = f"{base_url.rstrip('/')}/ui/pucky/latest/?route=connect"
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
                token = query.get("token", [""])[0]
                try:
                    payload = service.links_my_apps(
                        token,
                        allow_default_user=not str(token or "").strip(),
                    )
                except ValueError as exc:
                    self._json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": str(exc)})
                    return
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/api/links/composio/catalog":
                query = parse_qs(parsed.query)
                token = query.get("token", [""])[0]
                try:
                    payload, headers = service.links_catalog(
                        token,
                        allow_default_user=not str(token or "").strip(),
                    )
                except ValueError as exc:
                    self._json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": str(exc)})
                    return
                etag = str(headers.get("ETag") or "")
                if etag and self.headers.get("If-None-Match", "").strip() == etag:
                    self.send_response(int(HTTPStatus.NOT_MODIFIED))
                    self._cors_headers()
                    for key, value in headers.items():
                        if value:
                            self.send_header(key, value)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload, headers=headers)
                return
            if path == "/api/links/composio/all-apps":
                query = parse_qs(parsed.query)
                token = query.get("token", [""])[0]
                try:
                    payload = service.links_all_apps(
                        token,
                        query=query.get("q", [""])[0],
                        offset=int(query.get("offset", ["0"])[0]),
                        limit=int(query.get("limit", ["60"])[0]),
                        allow_default_user=not str(token or "").strip(),
                    )
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                    return
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/api/links/composio/app-details":
                query = parse_qs(parsed.query)
                token = query.get("token", [""])[0]
                try:
                    payload = service.links_app_details(
                        token,
                        query.get("slug", [""])[0],
                        allow_default_user=not str(token or "").strip(),
                    )
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
                        base_url=self._request_base_url(),
                        auth_mode=query.get("auth_mode", [""])[0],
                        redirect_url=query.get("redirect_url", [""])[0] or None,
                    )
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                    return
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/api/card-icons":
                self._json(HTTPStatus.OK, service.card_icons())
                return
            if path == "/api/media/manifest":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                query = parse_qs(parsed.query)
                raw_scopes = query.get("scope", ["meetings,feed"])[0]
                scopes = [item.strip() for item in raw_scopes.split(",")]
                try:
                    limit = int(query.get("limit", ["50"])[0])
                except ValueError:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid_limit"})
                    return
                self._json(
                    HTTPStatus.OK,
                    service.media_manifest(
                        scopes=scopes,
                        limit=limit,
                        base_url=self._request_base_url(),
                    ),
                )
                return
            if path == "/api/meetings":
                query = parse_qs(parsed.query)
                include_archived = _truthy_query(query.get("include_archived", ["0"])[0])
                compact = _truthy_query(query.get("compact", ["0"])[0])
                if not (self._allows_public_browser_user_read(path) or self._is_authorized()):
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                self._json(HTTPStatus.OK, service.meetings_list(include_archived=include_archived, compact=compact))
                return
            if path == "/api/app-badges":
                if not (self._allows_public_browser_user_read(path) or self._is_authorized()):
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                self._json(HTTPStatus.OK, service.app_badges())
                return
            if path.startswith("/api/shared/meetings/") and path.endswith("/audio"):
                query = parse_qs(parsed.query)
                meeting_id = unquote(path.removeprefix("/api/shared/meetings/").removesuffix("/audio")).strip()
                token = query.get("token", [""])[0]
                if not service._verify_meeting_artifact_link_token(
                    token,
                    resource_type="meeting_audio",
                    resource_id=meeting_id,
                ):
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                audio = service.meeting_audio(meeting_id)
                if audio is None:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "meeting_audio_not_found"})
                    return
                body, mime_type, filename = audio
                self._bytes(
                    HTTPStatus.OK,
                    body,
                    mime_type,
                    filename=filename,
                    headers={"X-Robots-Tag": "noindex, nofollow"},
                )
                return
            if path.startswith("/api/meetings/") and path.endswith("/audio"):
                if not (self._allows_public_browser_user_read(path) or self._is_authorized()):
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                meeting_id = unquote(path.removeprefix("/api/meetings/").removesuffix("/audio")).strip()
                audio = service.meeting_audio(meeting_id)
                if audio is None:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "meeting_audio_not_found"})
                    return
                body, mime_type, filename = audio
                self._bytes(HTTPStatus.OK, body, mime_type, filename=filename)
                return
            if path.startswith("/api/meetings/"):
                if not (self._allows_public_browser_user_read(path) or self._is_authorized()):
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                meeting_id = unquote(path.removeprefix("/api/meetings/")).strip()
                try:
                    self._json(HTTPStatus.OK, service.meeting_detail(meeting_id))
                except KeyError:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "meeting_not_found"})
                return
            if path.startswith("/api/shared/artifacts/"):
                query = parse_qs(parsed.query)
                artifact_id = unquote(path.removeprefix("/api/shared/artifacts/")).strip()
                token = query.get("token", [""])[0]
                if not service._verify_meeting_artifact_link_token(
                    token,
                    resource_type="artifact",
                    resource_id=artifact_id,
                ):
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                artifact = service.artifact(artifact_id)
                if artifact is None:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "artifact_not_found"})
                    return
                try:
                    body = base64.b64decode(str(artifact.get("content_base64") or ""))
                except Exception:
                    self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "artifact_decode_failed"})
                    return
                self._bytes(
                    HTTPStatus.OK,
                    body,
                    str(artifact.get("mime_type") or "application/octet-stream"),
                    filename=str(artifact.get("artifact_id") or "artifact"),
                    headers={"X-Robots-Tag": "noindex, nofollow"},
                )
                return
            if path.startswith("/api/artifacts/"):
                if not (self._allows_public_browser_user_read(path) or self._is_authorized()):
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                artifact_id = unquote(path.removeprefix("/api/artifacts/")).strip()
                artifact = service.artifact(artifact_id)
                if artifact is None:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "artifact_not_found"})
                    return
                try:
                    body = base64.b64decode(str(artifact.get("content_base64") or ""))
                except Exception:
                    self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "artifact_decode_failed"})
                    return
                self._bytes(
                    HTTPStatus.OK,
                    body,
                    str(artifact.get("mime_type") or "application/octet-stream"),
                    filename=str(artifact.get("artifact_id") or "artifact"),
                )
                return
            if path == "/api/feed":
                if not (self._allows_public_browser_user_read(path) or self._is_authorized()):
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                query = parse_qs(parsed.query)
                cursor = query.get("cursor", [""])[0]
                limit = query.get("limit", ["20"])[0]
                include_archived = _truthy_query(query.get("include_archived", ["1"])[0])
                compact = _truthy_query(query.get("compact", ["0"])[0])
                try:
                    payload = service.feed_sync(
                        cursor,
                        int(limit),
                        include_archived=include_archived,
                        compact=compact,
                        base_url=self._request_base_url(),
                    )
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
            if path.startswith("/api/workspace/"):
                self._handle_workspace_get(parsed)
                return
            if path == "/ui/pucky/latest/manifest.json":
                self._json(HTTPStatus.OK, latest_ui_manifest(), headers=self._ui_asset_headers("manifest.json"))
                return
            if path == "/ui/pucky/latest/bundle.zip":
                self._file(
                    latest_ui_bundle_path(),
                    "application/zip",
                    headers=self._ui_asset_headers("bundle.zip"),
                )
                return
            if path == "/ui/pucky/fixtures/reply_cards.json":
                self._text(
                    HTTPStatus.OK,
                    runtime_reply_cards_fixture_text(),
                    "application/json; charset=utf-8",
                )
                return
            if path == "/ui/pucky/latest" or path == "/ui/pucky/latest/":
                self._html(HTTPStatus.OK, self._ui_index_html(), headers=self._ui_asset_headers("index.html"))
                return
            if path == "/ui/pucky/latest/pucky-config.js":
                self._text(
                    HTTPStatus.OK,
                    bundle_config_script(),
                    "application/javascript; charset=utf-8",
                    headers=self._ui_asset_headers("pucky-config.js"),
                )
                return
            if path.startswith("/ui/pucky/latest/"):
                relative = unquote(path.removeprefix("/ui/pucky/latest/")).lstrip("/")
                self._safe_ui_file(relative)
                return
            super().do_GET()

        def do_POST(self) -> None:
            parsed = urlsplit(self.path)
            path = parsed.path
            if path == "/api/agent-runtime/call":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                try:
                    payload = json.loads(self._read_body(256 * 1024).decode("utf-8"))
                    if not isinstance(payload, dict):
                        raise ValueError("agent_runtime_payload_must_be_object")
                    result = service.agent_runtime_call(payload)
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except Exception as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "agent_runtime_call_failed", "detail": str(exc)})
                    return
                status = HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST
                self._json(status, result)
                return
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
            if path == "/api/card-icons":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                try:
                    payload = json.loads(self._read_body(256 * 1024).decode("utf-8"))
                    if not isinstance(payload, dict):
                        raise ValueError("card_icon_payload_must_be_object")
                    result = service.upsert_card_icon(payload)
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except Exception as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "card_icon_upsert_failed", "detail": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            if path == "/api/meetings":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                try:
                    payload = json.loads(self._read_body(service.config.max_audio_bytes * 2 + 512 * 1024).decode("utf-8"))
                    if not isinstance(payload, dict):
                        raise ValueError("meeting_payload_must_be_object")
                    result = service.meeting_ingest(payload, base_url=self._request_base_url())
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except Exception as exc:
                    self._json(HTTPStatus.BAD_GATEWAY, {"error": "meeting_ingest_failed", "detail": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            if path == "/api/meetings/actions":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                try:
                    payload = json.loads(self._read_body(256 * 1024).decode("utf-8"))
                    result = service.meeting_action(
                        str(payload.get("client_action_id") or ""),
                        str(payload.get("meeting_id") or ""),
                        str(payload.get("action") or ""),
                    )
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except KeyError:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "meeting_not_found"})
                    return
                except Exception as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "meeting_action_failed", "detail": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            if path == "/api/feed/actions":
                if not self._is_authorized():
                    self._drain_request_body(256 * 1024)
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
            if path == "/api/ui/route-perf-events":
                if not self._is_authorized():
                    self._drain_request_body(256 * 1024)
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                try:
                    payload = json.loads(self._read_body(256 * 1024).decode("utf-8"))
                    result = service.record_ui_route_perf_event(payload)
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except Exception as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "ui_route_perf_ingest_failed", "detail": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            if path.startswith("/api/workspace/"):
                self._handle_workspace_write(parsed, "POST")
                return
            if path == "/api/turn/text":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                try:
                    content_type = str(self.headers.get("Content-Type") or "").strip().lower()
                    if content_type.startswith("multipart/form-data"):
                        payload, uploaded_files = _multipart_form_payload(
                            self.headers,
                            self._read_body(32 * 1024 * 1024),
                        )
                    else:
                        payload = json.loads(self._read_body(256 * 1024).decode("utf-8"))
                        uploaded_files = []
                        if not isinstance(payload, dict):
                            raise ValueError("text_payload_must_be_object")
                    result = service.handle_text_turn(
                        str(payload.get("text") or ""),
                        str(payload.get("turn_id") or self.headers.get("X-Pucky-Turn-Id", "") or ""),
                        str(payload.get("reply_mode") or self.headers.get("X-Pucky-Reply-Mode", "") or ""),
                        model=str(payload.get("model") or self.headers.get("X-Pucky-Codex-Model", "") or ""),
                        reasoning_effort=str(
                            payload.get("reasoning_effort")
                            or self.headers.get("X-Pucky-Codex-Reasoning-Effort", "")
                            or ""
                        ),
                        thread_mode=str(payload.get("thread_mode") or self.headers.get("X-Pucky-Thread-Mode", "") or ""),
                        thread_id=str(payload.get("thread_id") or self.headers.get("X-Pucky-Thread-Id", "") or ""),
                        thread_scope_source=str(
                            payload.get("thread_scope_source")
                            or self.headers.get("X-Pucky-Thread-Scope-Source", "")
                            or ""
                        ),
                        thread_card_id=str(
                            payload.get("thread_card_id")
                            or self.headers.get("X-Pucky-Thread-Card-Id", "")
                            or ""
                        ),
                        proof_reply_delay_ms=(
                            payload.get("proof_reply_delay_ms")
                            or self.headers.get("X-Pucky-Proof-Reply-Delay-Ms", "")
                            or ""
                        ),
                        user_attachments=uploaded_files,
                    )
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except Exception as exc:
                    self.log_error("text turn failed: %s", exc)
                    self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "turn_failed", "detail": str(exc)})
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
            if content_type not in allowed_content_types:
                self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "unsupported_content_type"})
                return
            try:
                result = service.handle_audio_turn(
                    self._read_body(service.config.max_audio_bytes),
                    content_type,
                    self.headers.get("X-Pucky-Turn-Id", ""),
                    self.headers.get("X-Pucky-Reply-Mode", ""),
                    model=self.headers.get("X-Pucky-Codex-Model", ""),
                    reasoning_effort=self.headers.get("X-Pucky-Codex-Reasoning-Effort", ""),
                    thread_mode=self.headers.get("X-Pucky-Thread-Mode", ""),
                    thread_id=self.headers.get("X-Pucky-Thread-Id", ""),
                    thread_scope_source=self.headers.get("X-Pucky-Thread-Scope-Source", ""),
                    thread_card_id=self.headers.get("X-Pucky-Thread-Card-Id", ""),
                    debug_fixture_transcript=self.headers.get("X-Pucky-Debug-Fixture-Transcript", ""),
                    proof_reply_delay_ms=self.headers.get("X-Pucky-Proof-Reply-Delay-Ms", ""),
                )
            except ValueError as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            except Exception as exc:
                self.log_error("turn failed: %s", exc)
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "turn_failed", "detail": str(exc)})
                return
            self._json(HTTPStatus.OK, result)

        def do_PATCH(self) -> None:
            parsed = urlsplit(self.path)
            if parsed.path.startswith("/api/workspace/"):
                self._handle_workspace_write(parsed, "PATCH")
                return
            self.send_error(int(HTTPStatus.NOT_FOUND))

        def do_DELETE(self) -> None:
            parsed = urlsplit(self.path)
            if parsed.path.startswith("/api/workspace/"):
                self._handle_workspace_write(parsed, "DELETE")
                return
            self.send_error(int(HTTPStatus.NOT_FOUND))

        def _handle_workspace_get(self, parsed) -> None:
            if not (self._allows_public_browser_user_read(parsed.path) or self._is_authorized()):
                self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            parts = self._workspace_parts(parsed.path)
            query = parse_qs(parsed.query)
            if not parts:
                self._json(HTTPStatus.OK, {
                    "schema": "pucky.workspace.catalog.v1",
                    "collections": sorted(WORKSPACE_COLLECTIONS.keys()),
                })
                return
            if parts[0] == "assets" and len(parts) == 2:
                asset = service.workspace.get_asset(parts[1])
                if asset is None:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "asset_not_found"})
                    return
                self._json(HTTPStatus.OK, asset)
                return
            if parts[0] not in WORKSPACE_COLLECTIONS:
                self._json(HTTPStatus.NOT_FOUND, {"error": "workspace_collection_not_found"})
                return
            try:
                if len(parts) == 1:
                    payload = service.workspace.list_records(
                        parts[0],
                        include_archived=_truthy_query(query.get("include_archived", ["0"])[0]),
                        include_deleted=_truthy_query(query.get("include_deleted", ["0"])[0]),
                        date=query.get("date", [""])[0],
                        limit=int(query.get("limit", ["200"])[0]),
                    )
                    self._json(HTTPStatus.OK, payload)
                    return
                if len(parts) == 2:
                    record = service.workspace.get_record(
                        parts[0],
                        parts[1],
                        include_deleted=_truthy_query(query.get("include_deleted", ["0"])[0]),
                    )
                    if record is None:
                        self._json(HTTPStatus.NOT_FOUND, {"error": "workspace_record_not_found"})
                        return
                    self._json(HTTPStatus.OK, record)
                    return
            except ValueError as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            except Exception as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "workspace_read_failed", "detail": str(exc)})
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "workspace_route_not_found"})

        def _handle_workspace_write(self, parsed, method: str) -> None:
            parts = self._workspace_parts(parsed.path)
            if not parts:
                self._json(HTTPStatus.NOT_FOUND, {"error": "workspace_route_not_found"})
                return
            try:
                payload = {} if method == "DELETE" else self._read_json_payload(1024 * 1024)
                if not self._is_authorized():
                    public_browser_patch, public_browser_patch_code, public_browser_patch_error = self._public_browser_workspace_patch_result(parts, method, payload)
                    if public_browser_patch is None:
                        self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                        return
                    if not public_browser_patch:
                        self._json(
                            public_browser_patch_code or HTTPStatus.UNAUTHORIZED,
                            {
                                "error": public_browser_patch_error or "unauthorized"
                            },
                        )
                        return
                if parts[0] == "assets" and method == "POST":
                    result = service.workspace.create_asset(payload)
                    self._json(HTTPStatus.OK, result)
                    return
                if parts[0] == "links" and method == "POST":
                    result = service.workspace.upsert_link(payload)
                    self._json(HTTPStatus.OK, result)
                    return
                if parts[0] == "links" and method == "DELETE" and len(parts) == 2:
                    deleted = service.workspace.delete_link(parts[1])
                    self._json(HTTPStatus.OK if deleted else HTTPStatus.NOT_FOUND, {"ok": deleted})
                    return
                if parts[0] not in WORKSPACE_COLLECTIONS:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "workspace_collection_not_found"})
                    return
                if method == "POST" and len(parts) == 1:
                    result = service.workspace_upsert_record(parts[0], payload)
                    self._json(HTTPStatus.OK, result)
                    return
                if method == "PATCH" and len(parts) == 2:
                    result = service.workspace_patch_record(parts[0], parts[1], payload)
                    if result is None:
                        self._json(HTTPStatus.NOT_FOUND, {"error": "workspace_record_not_found"})
                        return
                    self._json(HTTPStatus.OK, result)
                    return
                if method == "DELETE" and len(parts) == 2:
                    result = service.workspace.delete_record(parts[0], parts[1])
                    if result is None:
                        self._json(HTTPStatus.NOT_FOUND, {"error": "workspace_record_not_found"})
                        return
                    self._json(HTTPStatus.OK, result)
                    return
            except ValueError as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            except Exception as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "workspace_write_failed", "detail": str(exc)})
                return
            self._json(HTTPStatus.BAD_REQUEST, {"error": "unsupported_workspace_write"})

        def _read_json_payload(self, limit: int) -> dict[str, object]:
            payload = json.loads(self._read_body(limit).decode("utf-8") or "{}")
            if not isinstance(payload, dict):
                raise ValueError("workspace_payload_must_be_object")
            return payload

        def _workspace_parts(self, path: str) -> list[str]:
            suffix = str(path or "").removeprefix("/api/workspace/").strip("/")
            if not suffix:
                return []
            return [unquote(part).strip() for part in suffix.split("/") if part.strip()]

        def _public_browser_workspace_patch_result(
            self,
            parts: list[str],
            method: str,
            payload: dict[str, object],
        ) -> tuple[bool | None, HTTPStatus | None, str | None]:
            if method != "PATCH" or len(parts) != 2:
                return None, None, None
            if parts[0] == "tasks":
                return self._public_browser_task_status_patch_result(payload)
            if parts[0] == "reminders":
                return self._public_browser_reminder_patch_result(payload)
            return None, None, None

        def _public_browser_task_status_patch_result(
            self,
            payload: dict[str, object],
        ) -> tuple[bool, HTTPStatus, str]:
            payload_keys = set(payload.keys())
            if payload_keys == {"archived"}:
                if not bool(payload.get("archived")):
                    return False, HTTPStatus.BAD_REQUEST, "workspace_task_public_status_patch_invalid"
                if not self._is_same_origin_ui_request():
                    return False, HTTPStatus.UNAUTHORIZED, "unauthorized"
                return True, HTTPStatus.OK, ""
            if payload_keys not in ({"status"}, {"checklist"}, {"checklist", "status"}):
                return False, HTTPStatus.BAD_REQUEST, "workspace_task_public_status_patch_invalid"
            if "status" in payload_keys:
                status = str(payload.get("status") or "").strip()
                if status not in PUBLIC_BROWSER_TASK_STATUSES:
                    return False, HTTPStatus.BAD_REQUEST, "workspace_task_public_status_patch_invalid"
            if "checklist" in payload_keys:
                checklist = payload.get("checklist")
                if not isinstance(checklist, list):
                    return False, HTTPStatus.BAD_REQUEST, "workspace_task_public_status_patch_invalid"
                if payload_keys == {"checklist", "status"}:
                    checklist_done_values = [
                        bool(item.get("done") or item.get("checked"))
                        for item in checklist
                        if isinstance(item, dict)
                    ]
                    if len(checklist_done_values) != len(checklist):
                        return False, HTTPStatus.BAD_REQUEST, "workspace_task_public_status_patch_invalid"
                    all_done = bool(checklist_done_values) and all(checklist_done_values)
                    any_pending = any(not item for item in checklist_done_values)
                    status = str(payload.get("status") or "").strip()
                    if status == "done":
                        if not all_done:
                            return False, HTTPStatus.BAD_REQUEST, "workspace_task_public_status_patch_invalid"
                    elif status == "in_progress":
                        if not checklist_done_values or not any_pending:
                            return False, HTTPStatus.BAD_REQUEST, "workspace_task_public_status_patch_invalid"
                    else:
                        return False, HTTPStatus.BAD_REQUEST, "workspace_task_public_status_patch_invalid"
            if not self._is_same_origin_ui_request():
                return False, HTTPStatus.UNAUTHORIZED, "unauthorized"
            return True, HTTPStatus.OK, ""

        def _public_browser_reminder_patch_result(
            self,
            payload: dict[str, object],
        ) -> tuple[bool, HTTPStatus, str]:
            payload_keys = set(payload.keys())
            if payload_keys == {"status"}:
                if str(payload.get("status") or "").strip() != "done":
                    return False, HTTPStatus.BAD_REQUEST, "workspace_reminder_public_patch_invalid"
                if not self._is_same_origin_ui_request():
                    return False, HTTPStatus.UNAUTHORIZED, "unauthorized"
                return True, HTTPStatus.OK, ""
            if payload_keys != {"due_at_ms", "metadata"}:
                return False, HTTPStatus.BAD_REQUEST, "workspace_reminder_public_patch_invalid"
            due_at_ms = payload.get("due_at_ms")
            metadata = payload.get("metadata")
            try:
                due_at_value = int(due_at_ms)
            except (TypeError, ValueError):
                return False, HTTPStatus.BAD_REQUEST, "workspace_reminder_public_patch_invalid"
            if due_at_value <= 0 or not isinstance(metadata, dict):
                return False, HTTPStatus.BAD_REQUEST, "workspace_reminder_public_patch_invalid"
            metadata_keys = set(metadata.keys())
            expected_metadata_keys = {
                "snoozed_until_ms",
                "delivery_state",
                "last_fired_at_ms",
                "last_fired_due_at_ms",
                "last_delivery_error",
            }
            if metadata_keys != expected_metadata_keys:
                return False, HTTPStatus.BAD_REQUEST, "workspace_reminder_public_patch_invalid"
            try:
                snoozed_until_ms = int(metadata.get("snoozed_until_ms"))
                last_fired_at_ms = int(metadata.get("last_fired_at_ms"))
                last_fired_due_at_ms = int(metadata.get("last_fired_due_at_ms"))
            except (TypeError, ValueError):
                return False, HTTPStatus.BAD_REQUEST, "workspace_reminder_public_patch_invalid"
            if snoozed_until_ms != due_at_value:
                return False, HTTPStatus.BAD_REQUEST, "workspace_reminder_public_patch_invalid"
            if str(metadata.get("delivery_state") or "").strip() != "pending":
                return False, HTTPStatus.BAD_REQUEST, "workspace_reminder_public_patch_invalid"
            if last_fired_at_ms != 0 or last_fired_due_at_ms != 0:
                return False, HTTPStatus.BAD_REQUEST, "workspace_reminder_public_patch_invalid"
            if str(metadata.get("last_delivery_error") or "") != "":
                return False, HTTPStatus.BAD_REQUEST, "workspace_reminder_public_patch_invalid"
            if not self._is_same_origin_ui_request():
                return False, HTTPStatus.UNAUTHORIZED, "unauthorized"
            return True, HTTPStatus.OK, ""

        def _is_same_origin_ui_request(self) -> bool:
            origin = self._origin_signature(self.headers.get("Origin", ""))
            referer = urlsplit(str(self.headers.get("Referer") or "").strip())
            expected = self._origin_signature(self._request_base_url())
            if origin is None or expected is None:
                return False
            if origin != expected:
                return False
            if self._origin_signature(str(self.headers.get("Referer") or "").strip()) != expected:
                return False
            if not referer.path.startswith("/ui/pucky/latest"):
                return False
            return True

        def _origin_signature(self, value: str) -> tuple[str, str, int] | None:
            parsed = urlsplit(str(value or "").strip())
            scheme = parsed.scheme.lower()
            host = str(parsed.hostname or "").strip().lower()
            if not scheme or not host:
                return None
            try:
                port = parsed.port
            except ValueError:
                return None
            if port is None:
                if scheme == "https":
                    port = 443
                elif scheme == "http":
                    port = 80
                else:
                    return None
            return (scheme, host, int(port))

        def _allows_public_browser_user_read(self, path: str) -> bool:
            value = str(path or "").strip()
            if value in {
                "/api/app-badges",
                "/api/feed",
                "/api/meetings",
                "/api/links/composio/my-apps",
                "/api/links/composio/catalog",
                "/api/links/composio/all-apps",
                "/api/links/composio/app-details",
            }:
                return True
            return (
                value.startswith("/api/workspace/")
                or value.startswith("/api/meetings/")
                or value.startswith("/api/artifacts/")
            )

        def log_message(self, fmt: str, *args: object) -> None:
            print(f"{self.address_string()} - {fmt % args}", flush=True)

        def _read_body(self, limit: int) -> bytes:
            length = parse_content_length(self.headers.get("Content-Length"), limit)
            if length is not None:
                return self.rfile.read(length)
            data = self.rfile.read(limit + 1)
            if len(data) > limit:
                raise ValueError("audio body is too large")
            return data

        def _drain_request_body(self, limit: int) -> None:
            try:
                self._read_body(limit)
            except ValueError:
                return

        def _is_authorized(self) -> bool:
            return is_any_bearer_authorized(
                (service.config.pucky_api_token,),
                self.headers.get("Authorization", ""),
            )

        def _request_base_url(self) -> str:
            return request_base_url(
                self.headers,
                self.server.server_address,
                public_base_url=service.config.public_base_url,
            )

        def _json(self, status: HTTPStatus, payload: dict[str, object], *, headers: dict[str, str] | None = None) -> None:
            body = json_body(payload)
            service.record_action(
                surface="pucky_http",
                action=f"{self.command} {urlsplit(self.path).path}",
                tool=self.command,
                target=urlsplit(self.path).path,
                status=str(int(status)),
            )
            self.send_response(int(status))
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            for key, value in (headers or {}).items():
                if value:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _text(
            self,
            status: HTTPStatus,
            text: str,
            content_type: str,
            *,
            headers: dict[str, str] | None = None,
        ) -> None:
            body = text_body(text)
            self.send_response(int(status))
            self._cors_headers()
            self.send_header("Content-Type", content_type)
            for key, value in (headers or {}).items():
                if value:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _html(self, status: HTTPStatus, html_text: str, *, headers: dict[str, str] | None = None) -> None:
            self._text(status, html_text, "text/html; charset=utf-8", headers=headers)

        def _bytes(
            self,
            status: HTTPStatus,
            body: bytes,
            content_type: str,
            *,
            filename: str = "",
            headers: dict[str, str] | None = None,
        ) -> None:
            self.send_response(int(status))
            self._cors_headers()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            if filename:
                self.send_header("Content-Disposition", inline_content_disposition(filename))
            for key, value in (headers or {}).items():
                if value:
                    self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def _ui_index_html(self) -> str:
            commit = str(latest_ui_manifest().get("source_commit_short") or "").strip()
            return (UI_SRC / "index.html").read_text(encoding="utf-8").replace("__PUCKY_BOOTSTRAP_COMMIT__", commit)

        def _ui_asset_headers(self, relative: str) -> dict[str, str]:
            name = Path(relative).name
            if name in {"index.html", "manifest.json"}:
                return {"Cache-Control": "no-cache"}
            return {"Cache-Control": "public, max-age=300, stale-while-revalidate=30"}

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
                self._file(target, headers=self._ui_asset_headers(relative))
            except Exception as exc:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "ui_file_failed", "detail": str(exc)})

        def _file(
            self,
            path: Path,
            content_type: str | None = None,
            *,
            headers: dict[str, str] | None = None,
        ) -> None:
            if not path.exists() or not path.is_file():
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            body = path.read_bytes()
            guessed = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self.send_response(int(HTTPStatus.OK))
            self._cors_headers()
            self.send_header("Content-Type", guessed)
            for key, value in (headers or {}).items():
                if value:
                    self.send_header(key, value)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _cors_headers(self) -> None:
            for key, value in cors_header_items():
                self.send_header(key, value)

    return Handler
