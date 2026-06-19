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
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field
from email.message import EmailMessage
from http import HTTPStatus
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Protocol
from urllib.parse import parse_qs, quote, unquote, urlsplit

from .action_ledger import ActionLedger
from .attachment_manifest import normalize_attachment
from .codex_app_server import CodexAppServerClient, CodexTurnResult, command_from_env
from .composio import DEFAULT_COMPOSIO_BASE_URL, ComposioClient
from .feed_store import FeedStore
from .http_handler import make_handler as _build_http_handler
from .http_surface import (
    cors_header_items,
    inline_content_disposition,
    is_any_bearer_authorized,
    is_bearer_authorized,
    json_body,
    parse_content_length,
    request_base_url,
    text_body,
)
from .links_portal import _decode_signed_token, _encode_signed_token, _links_auth_label
from .prompt_context import (
    BASE_INSTRUCTIONS_FILE_ENV,
    DEFAULT_MEETING_DEVELOPER_INSTRUCTIONS_PATH,
    MEETING_DEVELOPER_INSTRUCTIONS_FILE_ENV,
    OPTIONAL_PUCKY_BASE_PLACEHOLDERS,
    PUCKY_BASE_PLACEHOLDERS,
    REQUIRED_PUCKY_BASE_PLACEHOLDERS,
    compose_pucky_base_instructions,
    load_codex_base_instructions_file,
    load_optional_instruction_file,
)
from .providers import DeepgramSTT, KokoroTTS
from .sqlite_utils import SQLITE_LOCK_RETRY_DELAYS_SECONDS, sqlite_lock_error
from .ui_runtime_surface import latest_ui_bundle_path, latest_ui_manifest, runtime_reply_cards_fixture_text
from .ui_bundle import UI_SRC, bundle_config_script
from .workspace_store import SELF_CONTACT_ID, WORKSPACE_COLLECTIONS, WorkspaceStore, _normalize_reminder_metadata


DEFAULT_DEVELOPER_INSTRUCTIONS = (
    "You are Pucky, a concise voice assistant. Return only strict JSON with keys "
    "reply_text, card_title, card_icon, html, and attachments. reply_text is the spoken user-facing answer. "
    "card_title is a short title. card_icon is a lowercase slug using only letters, numbers, and underscores. "
    "html is either null or an object with title and content, where content is a complete HTML document. "
    "attachments is either null or an array of objects with path, mime_type, title, optional kind, "
    "optional viewer_path, optional preview_path, and optional text. If you create a browser-displayable file, "
    "do not only mention its filesystem path in reply_text. You must return it in attachments. "
    "If the result is inline HTML, html must not be null. "
    "Available reply-card icons can be listed from {local_api_base}/api/card-icons. "
    "If none fit, you may add one by POSTing JSON to {local_api_base}/api/card-icons with Authorization: "
    "Bearer from the local PUCKY_API_TOKEN environment variable, then use that slug in card_icon. "
    "Do not include markdown fences or any text outside the JSON object."
)
ALLOWED_CONTENT_TYPES = {"audio/mp4", "audio/wav", "audio/x-wav", "audio/mpeg", "application/octet-stream"}
DEFAULT_CARD_ICON = "mail"
DEFAULT_CARD_ICON_ACCENT = "#72c2ff"
REPLY_MODE_CARD_ONLY = "card_only"
REPLY_MODE_CARD_AND_SPOKEN = "card_and_spoken"
DEFAULT_OPENAI_TURN_MODEL = "gpt-5.4-mini"
DEFAULT_OPENAI_TURN_REASONING_EFFORT = "low"
OPENAI_TURN_MODELS = ("gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano")
OPENAI_TURN_REASONING_EFFORTS = ("none", "low", "medium", "high", "xhigh")
REMINDER_POLL_INTERVAL_SECONDS = 15.0
MAX_CARD_TITLE_CHARS = 64
MAX_CARD_ICON_NAME_CHARS = 48
CARD_ICON_NAME_RE = re.compile(r"^[a-z0-9_]{1,48}$")
CARD_ICON_ACCENT_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
DISPLAYABLE_ATTACHMENT_PATH_RE = re.compile(r"(/[^\\s\"'<>()[\\]{}]+)")
BROKER_MODULE_PATH = Path(__file__).resolve().parents[1] / "pucky-apk" / "fly-broker" / "pucky_fly_broker.py"
AGENT_RUNTIME_ACTIONS: tuple[dict[str, str], ...] = (
    {"name": "initialize", "kind": "lifecycle"},
    {"name": "thread/start", "kind": "mutation"},
    {"name": "thread/resume", "kind": "lifecycle"},
    {"name": "thread/fork", "kind": "mutation"},
    {"name": "thread/list", "kind": "read"},
    {"name": "thread/loaded/list", "kind": "read"},
    {"name": "thread/read", "kind": "read"},
    {"name": "thread/name/set", "kind": "mutation"},
    {"name": "thread/archive", "kind": "mutation"},
    {"name": "thread/unarchive", "kind": "mutation"},
    {"name": "thread/compact/start", "kind": "mutation"},
    {"name": "thread/rollback", "kind": "mutation"},
    {"name": "thread/metadata/update", "kind": "mutation"},
    {"name": "thread/unsubscribe", "kind": "lifecycle"},
    {"name": "turn/start", "kind": "streaming"},
    {"name": "turn/steer", "kind": "streaming"},
    {"name": "turn/interrupt", "kind": "mutation"},
    {"name": "review/start", "kind": "streaming"},
)
AGENT_RUNTIME_ACTION_NAMES = {item["name"] for item in AGENT_RUNTIME_ACTIONS}
COMPOSIO_LIST_CONNECTED_APPS_INPUT_SCHEMA = {
    "type": "object",
    "properties": {},
    "additionalProperties": False,
}
COMPOSIO_LIST_CONNECTED_APPS_TOOL = {
    "type": "function",
    "name": "composio_list_connected_apps",
    "title": "composio_list_connected_apps",
    "description": "List all active Composio app connections that are already authorized for this session.",
    "strict": True,
    "parameters": COMPOSIO_LIST_CONNECTED_APPS_INPUT_SCHEMA,
    "inputSchema": COMPOSIO_LIST_CONNECTED_APPS_INPUT_SCHEMA,
}
COMPOSIO_CHECK_CONNECTION_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "app_slug": {"type": "string"},
    },
    "required": ["app_slug"],
    "additionalProperties": False,
}
COMPOSIO_CHECK_CONNECTION_TOOL = {
    "type": "function",
    "name": "composio_check_connection",
    "title": "composio_check_connection",
    "description": "Check whether one Composio app currently has an active accessible connection.",
    "strict": True,
    "parameters": COMPOSIO_CHECK_CONNECTION_INPUT_SCHEMA,
    "inputSchema": COMPOSIO_CHECK_CONNECTION_INPUT_SCHEMA,
}
COMPOSIO_EXECUTE_ACTION_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "action_slug": {"type": "string"},
        "parameters": {"type": "object", "additionalProperties": True},
        "connected_account_id": {"type": ["string", "null"]},
    },
    "required": ["action_slug", "parameters"],
    "additionalProperties": False,
}
COMPOSIO_EXECUTE_ACTION_TOOL = {
    "type": "function",
    "name": "composio_execute_action",
    "title": "composio_execute_action",
    "description": "Execute one live Composio action. The backend resolves the right connected account, validates inputs, and returns structured errors when it cannot proceed.",
    "strict": True,
    "parameters": COMPOSIO_EXECUTE_ACTION_INPUT_SCHEMA,
    "inputSchema": COMPOSIO_EXECUTE_ACTION_INPUT_SCHEMA,
}
COMPOSIO_DYNAMIC_TOOLS: tuple[dict[str, object], ...] = (
    COMPOSIO_LIST_CONNECTED_APPS_TOOL,
    COMPOSIO_CHECK_CONNECTION_TOOL,
    COMPOSIO_EXECUTE_ACTION_TOOL,
)
MEETING_DEEPGRAM_TRANSCRIBE_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "meeting_id": {"type": "string"},
    },
    "required": ["meeting_id"],
    "additionalProperties": False,
}
MEETING_DEEPGRAM_TRANSCRIBE_TOOL = {
    "type": "function",
    "name": "meeting_deepgram_transcribe",
    "title": "meeting_deepgram_transcribe",
    "description": "Transcribe one stored meeting recording with Deepgram diarization and return structured speaker turns plus a transcript attachment draft.",
    "strict": True,
    "parameters": MEETING_DEEPGRAM_TRANSCRIBE_INPUT_SCHEMA,
    "inputSchema": MEETING_DEEPGRAM_TRANSCRIBE_INPUT_SCHEMA,
}
MEETING_RECORD_UPDATE_INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "meeting_id": {"type": "string"},
        "title": {"type": ["string", "null"]},
        "recording_title": {"type": ["string", "null"]},
        "transcript_text": {"type": ["string", "null"]},
        "speaker_turns": {
            "type": ["array", "null"],
            "items": {
                "type": "object",
                "additionalProperties": True,
            },
        },
        "summary_html": {"type": ["string", "null"]},
    },
    "required": ["meeting_id"],
    "additionalProperties": False,
}
MEETING_RECORD_UPDATE_TOOL = {
    "type": "function",
    "name": "meeting_record_update",
    "title": "meeting_record_update",
    "description": "Update persisted meeting metadata, transcript, and summary artifacts after a meeting has been processed.",
    "strict": True,
    "parameters": MEETING_RECORD_UPDATE_INPUT_SCHEMA,
    "inputSchema": MEETING_RECORD_UPDATE_INPUT_SCHEMA,
}
MEETING_DYNAMIC_TOOLS: tuple[dict[str, object], ...] = (
    MEETING_DEEPGRAM_TRANSCRIBE_TOOL,
    MEETING_RECORD_UPDATE_TOOL,
)


class _StagedOperationError(RuntimeError):
    def __init__(self, stage: str, original: BaseException) -> None:
        self.stage = str(stage or "").strip() or "unknown"
        self.original = original
        super().__init__(str(original))


def _truthy_query(value: object) -> bool:
    return str(value or "").strip().lower() not in ("", "0", "false", "no", "off")


def _run_staged_operation(
    stage: str,
    operation: Callable[[], object],
    *,
    sqlite_retry: bool = False,
) -> object:
    delays = SQLITE_LOCK_RETRY_DELAYS_SECONDS if sqlite_retry else ()
    for attempt in range(len(delays) + 1):
        try:
            return operation()
        except Exception as exc:
            if sqlite_retry and sqlite_lock_error(exc) and attempt < len(delays):
                time.sleep(delays[attempt])
                continue
            raise _StagedOperationError(stage, exc) from exc
    raise RuntimeError("unreachable")


def _unwrap_staged_exception(exc: BaseException, *, fallback_stage: str) -> tuple[str, BaseException]:
    if isinstance(exc, _StagedOperationError):
        stage = str(exc.stage or fallback_stage).strip() or fallback_stage
        return stage, exc.original
    stage = str(fallback_stage or "unknown").strip() or "unknown"
    return stage, exc


def _failure_reason_from_exception(exc: BaseException) -> str:
    message = str(exc).strip()
    return message or exc.__class__.__name__

_BROKER_MODULE = None
_BROKER_DB_PATH: str | None = None
DEFAULT_CARD_ICONS = {
    "clock": {
        "name": "clock",
        "label": "Clock",
        "accent": "#ffb000",
        "filled_svg": '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm0 17c-3.86 0-7-3.14-7-7s3.14-7 7-7 7 3.14 7 7-3.14 7-7 7Zm1-12h-2v6l5 3 1-1.73-4-2.27V7Z"/>',
        "outline_svg": '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.3v5.1l3.8 2.2"/>',
    },
    "bolt": {
        "name": "bolt",
        "label": "Bolt",
        "accent": "#50d86a",
        "filled_svg": '<path d="M7 2h10l-3.2 7H20L9 22l2.3-8H5l2-12Z"/>',
        "outline_svg": '<path d="M13.5 2.8 5.7 13.2h5.7L9.9 21.2l8.4-10.4h-5.8l1-8Z"/>',
    },
    "calendar": {
        "name": "calendar",
        "label": "Calendar",
        "accent": "#3a84ff",
        "filled_svg": '<path d="M7 2h2v2h6V2h2v2h1c1.1 0 2 .9 2 2v14c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h1V2Zm11 8H6v10h12V10Z"/>',
        "outline_svg": '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3"/>',
    },
    "moon": {
        "name": "moon",
        "label": "Moon",
        "accent": "#8b63ff",
        "filled_svg": '<path d="M21 14.4C19.7 18.8 15.6 22 10.8 22 5.4 22 1 17.6 1 12.2 1 7.4 4.2 3.3 8.6 2c-.8 1.3-1.2 2.8-1.2 4.4 0 5.6 4.6 10.2 10.2 10.2 1.6 0 3.1-.4 4.4-1.2Z"/>',
        "outline_svg": '<path d="M20.8 14.8A8.8 8.8 0 1 1 9.2 3.2a7.3 7.3 0 0 0 11.6 11.6Z"/>',
    },
    "mail": {
        "name": "mail",
        "label": "Mail",
        "accent": "#72c2ff",
        "filled_svg": '<path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z"/>',
        "outline_svg": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4.2 7 7.8 5.8L19.8 7"/><path d="m4.4 18 5.7-5.1"/><path d="m19.6 18-5.7-5.1"/>',
    },
}


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

    @property
    def last_turn_routing(self) -> dict[str, str | bool]: ...

    def send_turn(
        self,
        text: str,
        *,
        thread_id: str | None = None,
        output_schema: dict[str, object] | None = None,
    ) -> CodexTurnResult: ...

    def set_thread_title(self, title: str, *, thread_id: str | None = None) -> None: ...

    def runtime_call(self, method: str, params: dict[str, object] | None = None, *, timeout: float | None = None) -> dict[str, object]: ...

    def thread_origin(self, thread_id: str | None = None, *, retries: int = 5, delay: float = 0.15) -> dict[str, str]: ...


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
    recording_title: str = ""
    transcript_text: str = ""
    html_title: str = ""
    html_content: str = ""
    attachments: tuple[dict[str, object], ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    pucky_api_token: str
    deepgram_api_key: str
    deepinfra_api_key: str
    max_audio_bytes: int
    max_html_bytes: int
    max_attachment_count: int
    max_attachment_bytes: int
    max_attachment_viewer_bytes: int
    tts_voice: str
    tts_response_format: str
    tts_speed: float
    codex_command: list[str]
    codex_cwd: str | None
    codex_startup_timeout: float
    codex_turn_timeout: float
    developer_instructions: str
    feed_db_path: str
    codex_base_instructions: str | None = None
    action_ledger_path: str = ""
    workspace_db_path: str = ""
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
    meeting_artifact_link_secret: str = ""
    meeting_artifact_link_ttl_seconds: int = 365 * 24 * 60 * 60
    composio_default_auth_mode: str = "browser"
    proof_reply_delay_enabled: bool = False
    meeting_developer_instructions: str | None = None
    self_email: str = ""
    self_phone_number: str = ""
    public_base_url: str | None = None
    pucky_web_ui_token: str = ""

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            host=os.environ.get("PUCKY_HOST", "0.0.0.0"),
            port=int(os.environ.get("PORT", os.environ.get("PUCKY_PORT", "8080"))),
            pucky_api_token=os.environ.get("PUCKY_API_TOKEN", ""),
            pucky_web_ui_token=os.environ.get("PUCKY_WEB_UI_TOKEN", "").strip(),
            deepgram_api_key=os.environ.get("DEEPGRAM_API_KEY", ""),
            deepinfra_api_key=os.environ.get("DEEPINFRA_API_KEY", ""),
            max_audio_bytes=int(os.environ.get("PUCKY_MAX_AUDIO_BYTES", str(32 * 1024 * 1024))),
            max_html_bytes=int(os.environ.get("PUCKY_MAX_HTML_BYTES", str(512 * 1024))),
            max_attachment_count=max(1, int(os.environ.get("PUCKY_MAX_ATTACHMENT_COUNT", "4"))),
            max_attachment_bytes=max(1, int(os.environ.get("PUCKY_MAX_ATTACHMENT_BYTES", str(8 * 1024 * 1024)))),
            max_attachment_viewer_bytes=max(
                1, int(os.environ.get("PUCKY_MAX_ATTACHMENT_VIEWER_BYTES", str(16 * 1024 * 1024)))
            ),
            tts_voice=os.environ.get("PUCKY_TTS_VOICE", "af_heart"),
            tts_response_format=os.environ.get("PUCKY_TTS_FORMAT", "wav"),
            tts_speed=float(os.environ.get("PUCKY_TTS_SPEED", "1.0")),
            codex_command=command_from_env(os.environ.get("CODEX_APP_SERVER_COMMAND")),
            codex_cwd=os.environ.get("PUCKY_CODEX_CWD") or None,
            codex_startup_timeout=float(os.environ.get("PUCKY_CODEX_STARTUP_TIMEOUT", "60")),
            codex_turn_timeout=float(os.environ.get("PUCKY_CODEX_TURN_TIMEOUT", "300")),
            developer_instructions=(
                (os.environ.get("PUCKY_CODEX_DEVELOPER_INSTRUCTIONS") or DEFAULT_DEVELOPER_INSTRUCTIONS)
                .replace("{local_api_base}", f"http://127.0.0.1:{int(os.environ.get('PORT', os.environ.get('PUCKY_PORT', '8080')))}")
            ),
            feed_db_path=os.environ.get("PUCKY_FEED_DB_PATH", str((Path.cwd() / "pucky_feed.sqlite3").resolve())),
            codex_base_instructions=load_codex_base_instructions_file(os.environ.get(BASE_INSTRUCTIONS_FILE_ENV)),
            action_ledger_path=os.environ.get(
                "PUCKY_ACTION_LEDGER_PATH",
                str((Path.cwd() / "pucky_action_ledger.sqlite3").resolve()),
            ),
            workspace_db_path=os.environ.get(
                "PUCKY_WORKSPACE_DB_PATH",
                str((Path.cwd() / "pucky_workspace.sqlite3").resolve()),
            ),
            turn_status_ttl_seconds=float(os.environ.get("PUCKY_TURN_STATUS_TTL_SECONDS", "900")),
            codex_home=os.environ.get("CODEX_HOME") or None,
            codex_sandbox=os.environ.get("PUCKY_CODEX_SANDBOX", "danger-full-access"),
            codex_approval_policy=os.environ.get("PUCKY_CODEX_APPROVAL_POLICY", "never"),
            codex_model=os.environ.get("PUCKY_CODEX_MODEL", DEFAULT_OPENAI_TURN_MODEL).strip() or DEFAULT_OPENAI_TURN_MODEL,
            codex_reasoning_effort=os.environ.get("PUCKY_CODEX_REASONING_EFFORT", DEFAULT_OPENAI_TURN_REASONING_EFFORT).strip() or DEFAULT_OPENAI_TURN_REASONING_EFFORT,
            composio_api_key=os.environ.get("COMPOSIO_API_KEY", "").strip(),
            composio_base_url=os.environ.get("COMPOSIO_BASE_URL", DEFAULT_COMPOSIO_BASE_URL).strip() or DEFAULT_COMPOSIO_BASE_URL,
            composio_default_user_id=os.environ.get("PUCKY_COMPOSIO_USER_ID", "jimmythompson323").strip() or "jimmythompson323",
            connect_portal_secret=os.environ.get("PUCKY_CONNECT_PORTAL_SECRET", "").strip(),
            connect_portal_ttl_seconds=max(300, int(os.environ.get("PUCKY_CONNECT_PORTAL_TTL_SECONDS", str(12 * 60 * 60)))),
            meeting_artifact_link_secret=os.environ.get("PUCKY_MEETING_ARTIFACT_LINK_SECRET", "").strip(),
            meeting_artifact_link_ttl_seconds=max(
                3600,
                int(os.environ.get("PUCKY_MEETING_ARTIFACT_LINK_TTL_SECONDS", str(365 * 24 * 60 * 60))),
            ),
            composio_default_auth_mode=os.environ.get("PUCKY_COMPOSIO_PORTAL_AUTH_MODE", "browser").strip().lower() or "browser",
            proof_reply_delay_enabled=(
                os.environ.get("PUCKY_PROOF_REPLY_DELAY_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}
            ),
            meeting_developer_instructions=load_optional_instruction_file(
                os.environ.get(MEETING_DEVELOPER_INSTRUCTIONS_FILE_ENV) or str(DEFAULT_MEETING_DEVELOPER_INSTRUCTIONS_PATH),
                env_name=MEETING_DEVELOPER_INSTRUCTIONS_FILE_ENV,
            ),
            self_email=os.environ.get("PUCKY_SELF_EMAIL", "").strip(),
            self_phone_number=os.environ.get("PUCKY_SELF_PHONE_NUMBER", "").strip(),
            public_base_url=os.environ.get("PUCKY_PUBLIC_BASE_URL") or None,
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


def _compact_composio_app(item: dict[str, object]) -> dict[str, object]:
    row: dict[str, object] = {}
    for key in ("slug", "name", "status", "id", "instance_name"):
        value = str(item.get(key) or "").strip()
        if value:
            row[key] = value
    if "connectable" in item:
        row["connectable"] = bool(item.get("connectable"))
    if "active_account_count" in item:
        row["active_account_count"] = int(item.get("active_account_count") or 0)
    if "connected_account_ids" in item:
        ids = [str(value or "").strip() for value in list(item.get("connected_account_ids") or []) if str(value or "").strip()]
        if ids:
            row["connected_account_ids"] = ids
    return row


def _unique_active_connected_apps(accounts: list[dict[str, object]]) -> list[dict[str, object]]:
    by_slug: dict[str, dict[str, object]] = {}
    for account in accounts:
        slug = str(account.get("slug") or "").strip().lower()
        if not slug:
            continue
        row = by_slug.setdefault(
            slug,
            {
                "slug": slug,
                "name": str(account.get("name") or slug.title()).strip(),
                "status": "active",
                "active_account_count": 0,
                "connected_account_ids": [],
            },
        )
        row["active_account_count"] = int(row.get("active_account_count") or 0) + 1
        account_id = str(account.get("id") or "").strip()
        if account_id:
            ids = list(row.get("connected_account_ids") or [])
            ids.append(account_id)
            row["connected_account_ids"] = ids
    return sorted((_compact_composio_app(row) for row in by_slug.values()), key=lambda item: str(item.get("name") or item.get("slug") or ""))


def _infer_composio_app_slug_from_action(action_slug: str) -> str:
    clean = str(action_slug or "").strip().lower()
    if "_" not in clean:
        return clean
    return clean.split("_", 1)[0]


def _coerce_json_object(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return dict(value)
    text = str(value or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except Exception:
        return {}
    return dict(parsed) if isinstance(parsed, dict) else {}


def _group_active_connected_accounts(accounts: list[dict[str, object]]) -> list[dict[str, object]]:
    grouped: dict[str, dict[str, object]] = {}
    for account in accounts:
        slug = str(account.get("slug") or "").strip().lower()
        if not slug:
            continue
        row = grouped.setdefault(
            slug,
            {
                "app_slug": slug,
                "app_name": str(account.get("name") or slug.title()).strip() or slug.title(),
                "status": "active",
                "connected_account_ids": [],
                "display_names": [],
            },
        )
        account_id = str(account.get("id") or "").strip()
        if account_id:
            ids = list(row.get("connected_account_ids") or [])
            if account_id not in ids:
                ids.append(account_id)
                row["connected_account_ids"] = ids
        display_name = str(account.get("instance_name") or "").strip()
        if display_name:
            names = list(row.get("display_names") or [])
            if display_name not in names:
                names.append(display_name)
                row["display_names"] = names
    normalized: list[dict[str, object]] = []
    for row in grouped.values():
        connected_ids = [str(value) for value in list(row.get("connected_account_ids") or []) if str(value).strip()]
        display_names = [str(value) for value in list(row.get("display_names") or []) if str(value).strip()]
        normalized.append(
            {
                "app_slug": str(row.get("app_slug") or ""),
                "app_name": str(row.get("app_name") or ""),
                "status": str(row.get("status") or "active"),
                "connected_account_ids": connected_ids,
                "display_name": display_names[0] if display_names else str(row.get("app_name") or ""),
                "display_names": display_names,
            }
        )
    normalized.sort(key=lambda item: (str(item.get("app_name") or ""), str(item.get("app_slug") or "")))
    return normalized


def agent_runtime_catalog_payload() -> dict[str, object]:
    return {
        "schema": "pucky.agent_runtime.catalog.v1",
        "call": "agent.runtime.call",
        "actions": [dict(item) for item in AGENT_RUNTIME_ACTIONS],
    }


class PuckyVoiceService:
    def __init__(
        self,
        config: Config,
        *,
        stt: STTProvider | None = None,
        tts: TTSProvider | None = None,
        codex: CodexProvider | None = None,
        meeting_codex: CodexProvider | None = None,
        composio: ComposioProvider | None = None,
    ) -> None:
        self.config = config
        ledger_path = config.action_ledger_path or str(Path(config.feed_db_path).with_suffix(".actions.sqlite3"))
        self.action_ledger = ActionLedger(ledger_path)
        self.stt = stt or DeepgramSTT(config.deepgram_api_key)
        self.tts = tts or KokoroTTS(
            config.deepinfra_api_key,
            voice=config.tts_voice,
            response_format=config.tts_response_format,
            speed=config.tts_speed,
        )
        self.codex = codex or self._build_codex_client(meeting=False)
        self.meeting_codex = meeting_codex or self._build_codex_client(meeting=True)
        self.feed = FeedStore(config.feed_db_path)
        workspace_path = config.workspace_db_path or str(Path(config.feed_db_path).with_name("pucky_workspace.sqlite3"))
        self.workspace = WorkspaceStore(workspace_path)
        self.composio = composio or ComposioClient(
            config.composio_api_key,
            config.composio_base_url,
            action_logger=self._record_composio_action,
        )
        self._hydrate_self_contact_from_config()
        self._turn_lock = threading.Lock()
        self._turn_status_lock = threading.Lock()
        self._turn_statuses: dict[str, dict[str, object]] = {}
        self._links_interactions: dict[str, set[str]] = {}
        self._links_catalog_cache: tuple[str, dict[str, object]] | None = None
        self._card_icon_lock = threading.Lock()
        self._card_icons_path = Path(self.config.feed_db_path).with_name("pucky_card_icons.json")
        self._meetings_lock = threading.Lock()
        self._meetings_dir = Path(self.config.feed_db_path).with_name("pucky_meetings")
        self._meetings_index_path = self._meetings_dir / "meetings.json"
        self._meeting_agent_state_lock = threading.Lock()
        self._meeting_agent_state_by_id: dict[str, dict[str, object]] = {}
        self._reminder_poll_lock = threading.Lock()
        self._reminder_stop_event = threading.Event()
        self._reminder_poll_thread: threading.Thread | None = None

    def _build_codex_client(self, *, meeting: bool) -> CodexAppServerClient:
        role = "meeting" if meeting else "default"
        developer_instructions = (
            self.config.meeting_developer_instructions or self.config.developer_instructions
            if meeting
            else self.config.developer_instructions
        )
        tools_provider = self.meeting_codex_tools_for_thread if meeting else self.codex_tools_for_thread
        return CodexAppServerClient(
            command=self.config.codex_command,
            cwd=self.config.codex_cwd,
            startup_timeout=self.config.codex_startup_timeout,
            turn_timeout=self.config.codex_turn_timeout,
            developer_instructions=developer_instructions,
            base_instructions_provider=self.codex_base_instructions_for_thread,
            output_schema=reply_output_schema(),
            codex_home=self.config.codex_home,
            sandbox=self.config.codex_sandbox,
            approval_policy=self.config.codex_approval_policy,
            model=self.config.codex_model,
            reasoning_effort=self.config.codex_reasoning_effort,
            action_logger=lambda event, role=role: self._record_codex_action(event, role=role),
            tools_provider=tools_provider,
            dynamic_tool_handler=self.handle_codex_dynamic_tool_call,
        )

    def start(self) -> None:
        self.codex.start()
        if self.meeting_codex is not self.codex:
            self.meeting_codex.start()
        if self._reminder_poll_thread is None or not self._reminder_poll_thread.is_alive():
            self._reminder_stop_event.clear()
            self._reminder_poll_thread = threading.Thread(
                target=self._reminder_poll_loop,
                name="pucky-reminder-poll",
                daemon=True,
            )
            self._reminder_poll_thread.start()

    def health(self) -> dict[str, object]:
        return {
            "ok": bool(self.codex.ready and self.meeting_codex.ready),
            "codex_app_server": "ready" if self.codex.ready else "not_ready",
            "meeting_codex_app_server": "ready" if self.meeting_codex.ready else "not_ready",
            "thread": "per_turn",
            "feed_store": "ready",
            "feed_items_count": self.feed.count_items(),
            "workspace_store": "ready",
            "workspace_items_count": self.workspace.count_items(),
            "deepgram_key": "present" if self.config.deepgram_api_key else "missing",
            "deepinfra_key": "present" if self.config.deepinfra_api_key else "missing",
            "pucky_api_token": "present" if self.config.pucky_api_token else "missing",
            "composio": "present" if self.config.composio_api_key else "missing",
        }

    def _reminder_poll_loop(self) -> None:
        while not self._reminder_stop_event.is_set():
            try:
                self.process_due_reminders()
            except Exception as exc:
                self.record_action(
                    surface="reminders",
                    action="poll",
                    tool="notify.show",
                    target="reminder_poll",
                    status=f"error:{str(exc)[:120]}",
                )
            self._reminder_stop_event.wait(REMINDER_POLL_INTERVAL_SECONDS)

    def workspace_upsert_record(self, collection: str, payload: dict[str, object]) -> dict[str, object]:
        clean_collection = str(collection or "").strip()
        if clean_collection == "reminders":
            payload = self._prepare_reminder_write_payload(payload, existing=None)
        return self.workspace.upsert_record(clean_collection, payload)

    def workspace_patch_record(self, collection: str, record_id: str, payload: dict[str, object]) -> dict[str, object] | None:
        clean_collection = str(collection or "").strip()
        if clean_collection != "reminders":
            return self.workspace.patch_record(clean_collection, record_id, payload)
        existing = self.workspace.get_record(clean_collection, record_id, include_deleted=True)
        if existing is None:
            return None
        return self.workspace.patch_record(
            clean_collection,
            record_id,
            self._prepare_reminder_write_payload(payload, existing=existing),
        )

    def _prepare_reminder_write_payload(
        self,
        payload: dict[str, object],
        *,
        existing: dict[str, object] | None,
    ) -> dict[str, object]:
        if not isinstance(payload, dict):
            raise ValueError("workspace_payload_must_be_object")
        reminder = dict(payload)
        incoming_metadata = payload.get("metadata")
        if incoming_metadata is not None and not isinstance(incoming_metadata, dict):
            raise ValueError("reminder_metadata_must_be_object")
        merged_metadata = dict(existing.get("metadata") or {}) if isinstance(existing, dict) and isinstance(existing.get("metadata"), dict) else {}
        if isinstance(incoming_metadata, dict):
            merged_metadata.update(incoming_metadata)
        status = str(
            reminder.get("status")
            or (existing.get("status") if isinstance(existing, dict) else "")
            or "open"
        ).strip().lower() or "open"
        normalized = _normalize_reminder_metadata(merged_metadata, status=status)
        self._validate_reminder_metadata(normalized)
        reminder["metadata"] = normalized
        return reminder

    def _validate_reminder_metadata(self, metadata: dict[str, object]) -> None:
        recipients = self._reminder_recipients_from_metadata(metadata)
        recipient_ids = {str(item.get("id") or "").strip() for item in recipients}
        if not recipient_ids:
            raise ValueError("reminder_requires_at_least_one_recipient")
        destinations = self._reminder_destinations_from_metadata(metadata)
        if not destinations:
            raise ValueError("reminder_requires_at_least_one_destination")
        allowed_channels = {"phone_notification", "email", "sms", "call", "connected_app"}
        for destination in destinations:
            channel = str(destination.get("channel") or "").strip().lower()
            if channel not in allowed_channels:
                raise ValueError(f"unsupported_reminder_destination:{channel or 'missing'}")
            refs = self._reminder_destination_recipient_refs(metadata, destination)
            if not refs:
                raise ValueError(f"reminder_destination_requires_recipient:{channel}")
            for recipient in refs:
                recipient_id = str(recipient.get("id") or "").strip()
                if recipient_id not in recipient_ids:
                    raise ValueError(f"unknown_reminder_recipient:{recipient_id}")
            if channel == "email":
                self._require_connected_app("gmail", destination)
                for recipient in refs:
                    if not self._resolve_reminder_email_target(recipient, destination):
                        raise ValueError(f"reminder_email_target_missing:{recipient.get('id')}")
            elif channel in {"sms", "call"}:
                for recipient in refs:
                    if not self._resolve_reminder_phone_target(recipient, destination):
                        raise ValueError(f"reminder_phone_target_missing:{recipient.get('id')}")
            elif channel == "connected_app":
                app_slug = str(destination.get("app_slug") or "").strip().lower()
                if not app_slug:
                    raise ValueError("reminder_connected_app_slug_required")
                if not str(destination.get("endpoint") or "").strip():
                    raise ValueError("reminder_connected_app_endpoint_required")
                self._require_connected_app(app_slug, destination)

    def _reminder_recipients_from_metadata(self, metadata: dict[str, object]) -> list[dict[str, object]]:
        values = metadata.get("recipients") if isinstance(metadata, dict) else []
        return [item for item in list(values or []) if isinstance(item, dict)]

    def _reminder_destinations_from_metadata(self, metadata: dict[str, object]) -> list[dict[str, object]]:
        values = metadata.get("destinations") if isinstance(metadata, dict) else []
        return [item for item in list(values or []) if isinstance(item, dict)]

    def _reminder_recipient_by_id(self, metadata: dict[str, object], recipient_id: str) -> dict[str, object] | None:
        clean_id = str(recipient_id or "").strip()
        if not clean_id:
            return None
        for recipient in self._reminder_recipients_from_metadata(metadata):
            if str(recipient.get("id") or "").strip() == clean_id:
                return recipient
        return None

    def _reminder_contact_record(self, recipient: dict[str, object]) -> dict[str, object] | None:
        if str(recipient.get("kind") or "").strip().lower() != "contact":
            return None
        contact_id = str(recipient.get("contact_id") or recipient.get("id") or "").strip()
        if not contact_id:
            return None
        return self.workspace.get_record("contacts", contact_id)

    def _reminder_destination_recipient_refs(
        self,
        metadata: dict[str, object],
        destination: dict[str, object],
    ) -> list[dict[str, object]]:
        refs: list[dict[str, object]] = []
        recipient_ids = [str(value).strip() for value in list(destination.get("recipient_ids") or []) if str(value).strip()]
        if not recipient_ids:
            recipient_ids = [str(item.get("id") or "").strip() for item in self._reminder_recipients_from_metadata(metadata)]
        for recipient_id in recipient_ids:
            recipient = self._reminder_recipient_by_id(metadata, recipient_id)
            if recipient is not None:
                refs.append(recipient)
        return refs

    def _contact_endpoint_value(self, contact: dict[str, object], labels: tuple[str, ...]) -> str:
        metadata = contact.get("metadata") if isinstance(contact.get("metadata"), dict) else {}
        endpoints = list(metadata.get("endpoints") or []) if isinstance(metadata.get("endpoints"), list) else []
        for endpoint in endpoints:
            if not isinstance(endpoint, dict):
                continue
            label = str(endpoint.get("label") or endpoint.get("type") or "").strip().lower()
            if not label:
                continue
            if any(term in label for term in labels):
                value = str(endpoint.get("value") or endpoint.get("address") or endpoint.get("number") or "").strip()
                if value:
                    return value
        return ""

    def _self_contact_record(self) -> dict[str, object]:
        return self.workspace.ensure_self_contact()

    def _fill_self_contact_delivery_fields(self, *, email: str = "", phone: str = "") -> None:
        next_email = str(email or "").strip()
        next_phone = str(phone or "").strip()
        if not next_email and not next_phone:
            return
        contact = self._self_contact_record()
        metadata = contact.get("metadata") if isinstance(contact.get("metadata"), dict) else {}
        current_email = str(metadata.get("email") or "").strip()
        current_phone = str(metadata.get("phone") or "").strip()
        endpoints = [item for item in list(metadata.get("endpoints") or []) if isinstance(item, dict)]
        preserved: list[dict[str, object]] = []
        stripped_email_or_phone = False
        for endpoint in endpoints:
            label = str(endpoint.get("label") or endpoint.get("type") or "").strip().lower()
            if label in {"email", "gmail", "mail", "phone", "sms", "text", "mobile", "call"}:
                stripped_email_or_phone = True
                continue
            preserved.append(dict(endpoint))
        if next_email:
            preserved.append({"label": "Email", "value": next_email})
        if next_phone:
            preserved.append({"label": "Phone", "value": next_phone})
        next_metadata = dict(metadata)
        changed = False
        if next_email and next_email != current_email:
            next_metadata["email"] = next_email
            changed = True
        if next_phone and next_phone != current_phone:
            next_metadata["phone"] = next_phone
            changed = True
        if stripped_email_or_phone or changed:
            next_metadata["endpoints"] = preserved
            changed = True
        if changed:
            self.workspace.patch_record("contacts", SELF_CONTACT_ID, {"metadata": next_metadata})

    def _hydrate_self_contact_from_config(self) -> None:
        self._fill_self_contact_delivery_fields(
            email=str(self.config.self_email or "").strip(),
            phone=str(self.config.self_phone_number or "").strip(),
        )

    def _resolve_reminder_email_target(self, recipient: dict[str, object], destination: dict[str, object]) -> str:
        explicit = str(destination.get("address") or "").strip()
        if explicit:
            return explicit
        if str(recipient.get("kind") or "").strip().lower() == "self":
            me = self._self_contact_record()
            metadata = me.get("metadata") if isinstance(me.get("metadata"), dict) else {}
            direct = str(metadata.get("email") or "").strip() or self._contact_endpoint_value(me, ("email", "gmail", "mail"))
            if direct:
                return direct
            fallback = str(self.config.self_email or "").strip() or self._resolve_connected_gmail_self_email(destination)
            if fallback:
                self._fill_self_contact_delivery_fields(email=fallback)
            return fallback
        contact = self._reminder_contact_record(recipient)
        if not contact:
            return ""
        metadata = contact.get("metadata") if isinstance(contact.get("metadata"), dict) else {}
        direct = str(metadata.get("email") or "").strip()
        return direct or self._contact_endpoint_value(contact, ("email", "gmail", "mail"))

    def _resolve_reminder_phone_target(self, recipient: dict[str, object], destination: dict[str, object]) -> str:
        explicit = str(destination.get("address") or "").strip()
        if explicit:
            return explicit
        if str(recipient.get("kind") or "").strip().lower() == "self":
            me = self._self_contact_record()
            metadata = me.get("metadata") if isinstance(me.get("metadata"), dict) else {}
            direct = str(metadata.get("phone") or "").strip() or self._contact_endpoint_value(me, ("phone", "sms", "text", "mobile", "call"))
            if direct:
                return direct
            fallback = str(self.config.self_phone_number or "").strip()
            if fallback:
                self._fill_self_contact_delivery_fields(phone=fallback)
            return fallback
        contact = self._reminder_contact_record(recipient)
        if not contact:
            return ""
        metadata = contact.get("metadata") if isinstance(contact.get("metadata"), dict) else {}
        direct = str(metadata.get("phone") or "").strip()
        return direct or self._contact_endpoint_value(contact, ("phone", "sms", "text", "mobile", "call"))

    def _resolve_connected_gmail_self_email(self, destination: dict[str, object]) -> str:
        try:
            connected_account_id, _ = self._require_connected_app("gmail", destination)
        except Exception:
            return ""
        email = self._gmail_account_primary_email(connected_account_id)
        if email:
            self._fill_self_contact_delivery_fields(email=email)
        return email

    def _gmail_account_primary_email(self, connected_account_id: str) -> str:
        clean_account_id = str(connected_account_id or "").strip()
        if not clean_account_id:
            return ""
        for tool_slug in ("GMAIL_GET_PROFILE", "GMAIL_LIST_SEND_AS"):
            try:
                payload = self.composio.execute_tool(
                    tool_slug=tool_slug,
                    connected_account_id=clean_account_id,
                    user_id=self.composio_user_id(),
                    arguments={},
                )
            except Exception:
                continue
            email = self._first_email_like_value(payload)
            if email:
                return email
        return ""

    def _first_email_like_value(self, payload: object) -> str:
        queue: list[object] = [payload]
        seen: set[int] = set()
        while queue:
            item = queue.pop(0)
            if item is None:
                continue
            marker = id(item)
            if marker in seen:
                continue
            seen.add(marker)
            if isinstance(item, dict):
                for key in ("email", "emailAddress", "email_address", "sendAsEmail", "send_as_email", "address"):
                    value = str(item.get(key) or "").strip()
                    if "@" in value:
                        return value
                queue.extend(item.values())
                continue
            if isinstance(item, list):
                queue.extend(item)
                continue
            value = str(item).strip()
            if "@" in value and " " not in value:
                return value
        return ""

    def _require_connected_app(self, app_slug: str, destination: dict[str, object]) -> tuple[str, dict[str, object]]:
        clean_slug = str(app_slug or "").strip().lower()
        if not clean_slug:
            raise ValueError("reminder_connected_app_slug_required")
        if not self.composio.configured:
            raise ValueError(f"reminder_destination_not_configured:{clean_slug}")
        apps = self._connected_apps_snapshot(force=True)
        match = next((item for item in apps if str(item.get("app_slug") or "").strip().lower() == clean_slug), None)
        if not isinstance(match, dict):
            raise ValueError(f"reminder_destination_not_connected:{clean_slug}")
        requested_account_id = str(destination.get("connected_account_id") or "").strip()
        account_ids = [str(item).strip() for item in list(match.get("connected_account_ids") or []) if str(item).strip()]
        if requested_account_id:
            if requested_account_id not in account_ids:
                raise ValueError(f"reminder_destination_forbidden_account:{clean_slug}")
            return requested_account_id, match
        if len(account_ids) != 1:
            raise ValueError(f"reminder_destination_ambiguous_account:{clean_slug}")
        return account_ids[0], match

    def _reminder_target_device_id(self, reminder: dict[str, object]) -> tuple[str, str]:
        metadata = reminder.get("metadata") if isinstance(reminder.get("metadata"), dict) else {}
        preferred = str(metadata.get("notification_device_id") or "").strip()
        if not preferred:
            me = self._self_contact_record()
            me_metadata = me.get("metadata") if isinstance(me.get("metadata"), dict) else {}
            preferred = str(me_metadata.get("notification_device_id") or me_metadata.get("preferred_reminder_device_id") or "").strip()
        broker = ensure_broker_initialized()
        devices = [item for item in broker.list_devices() if bool(item.get("online"))]
        if preferred:
            for device in devices:
                if str(device.get("device_id") or "") == preferred:
                    return preferred, ""
            return "", "preferred_device_offline"
        if devices:
            return str(devices[0].get("device_id") or "").strip(), ""
        return "", "no_online_device"

    def _queue_device_command(self, device_id: str, command_type: str, args: dict[str, object]) -> dict[str, object]:
        broker = ensure_broker_initialized()
        clean_device_id = str(device_id or "").strip()
        if not clean_device_id:
            raise RuntimeError("missing_device_id")
        command = {
            "id": f"cmd_{uuid.uuid4()}",
            "type": str(command_type or "").strip() or "ping",
            "args": args if isinstance(args, dict) else {},
            "ttl_ms": 30000,
            "created_at": broker.now(),
            "device_id": clean_device_id,
            "status": "queued",
        }
        broker.persist_command(command)
        broker.record({"event": "command_queued", "command": command})
        with broker.LOCK:
            device = broker.DEVICES.get(clean_device_id)
        if not device:
            command["status"] = "device_offline"
            broker.persist_command(command)
            broker.record({"event": "command_offline", "command": command})
            raise RuntimeError("DEVICE_OFFLINE")
        try:
            broker.ws_send(device["socket"], broker.compact_json({
                "schema": "pucky.command.v1",
                "id": command["id"],
                "type": command["type"],
                "args": command["args"],
                "created_at": command["created_at"],
                "ttl_ms": command["ttl_ms"],
            }))
        except Exception as exc:
            command["status"] = "send_failed"
            command["error"] = {"message": str(exc)}
            broker.persist_command(command)
            broker.record({"event": "command_send_failed", "command": command})
            raise RuntimeError(str(exc)) from exc
        latest = broker.get_command(str(command.get("id") or "")) or {}
        latest_status = str(latest.get("status") or "").strip().lower()
        if latest_status in {"completed", "failed", "rejected", "device_offline", "send_failed"}:
            broker.record({"event": "command_result_arrived_before_sent", "command": latest})
            return latest
        if latest_status and latest_status != "queued":
            broker.record({"event": "command_status_updated_before_sent", "command": latest})
            return latest
        command["status"] = "sent"
        broker.persist_command(command)
        broker.record({"event": "command_sent", "command": command})
        return command

    def _browser_phone_role_error_payload(
        self,
        error_code: str,
        *,
        device_id: str = "",
        detail: str = "",
    ) -> dict[str, object]:
        return {
            "schema": "pucky.phone_role_status.v1",
            "state": "unavailable",
            "role_held": False,
            "eligible": False,
            "default_dialer_package": "",
            "default_dialer_label": "",
            "source": "browser_live_api",
            "device_id": str(device_id or "").strip(),
            "read_only": True,
            "error_code": str(error_code or "").strip() or "broker_command_failed",
            "detail": str(detail or "").strip(),
        }

    def _normalize_browser_phone_role_payload(
        self,
        payload: dict[str, object],
        *,
        device_id: str,
    ) -> dict[str, object]:
        raw = payload if isinstance(payload, dict) else {}
        return {
            "schema": "pucky.phone_role_status.v1",
            "state": str(raw.get("state") or "unknown").strip() or "unknown",
            "role_held": bool(raw.get("role_held")),
            "eligible": bool(raw.get("eligible")),
            "default_dialer_package": str(raw.get("default_dialer_package") or "").strip(),
            "default_dialer_label": str(raw.get("default_dialer_label") or "").strip(),
            "source": "browser_live_api",
            "device_id": str(device_id or "").strip(),
            "read_only": True,
            "error_code": "",
            "role_available": bool(raw.get("role_available")),
            "package_name": str(raw.get("package_name") or "").strip(),
            "stock_incall_ui_replaced_when_held": bool(
                raw.get("stock_incall_ui_replaced_when_held", True)
            ),
        }

    def _resolve_browser_phone_role_device(self, requested_device_id: str = "") -> tuple[str, str]:
        broker = ensure_broker_initialized()
        clean_requested = str(requested_device_id or "").strip()
        devices = broker.list_devices()
        if clean_requested:
            for item in devices:
                if str(item.get("device_id") or "").strip() == clean_requested:
                    return clean_requested, "" if bool(item.get("online")) else "device_offline"
            return clean_requested, "device_offline"
        online = [item for item in devices if bool(item.get("online"))]
        if len(online) == 1:
            return str(online[0].get("device_id") or "").strip(), ""
        return "", "device_context_unavailable"

    def browser_phone_role_status(self, requested_device_id: str = "") -> tuple[HTTPStatus, dict[str, object]]:
        device_id, resolution_error = self._resolve_browser_phone_role_device(requested_device_id)
        if resolution_error == "device_context_unavailable":
            return HTTPStatus.CONFLICT, self._browser_phone_role_error_payload(
                "device_context_unavailable",
                detail="Provide device_id or keep exactly one online device available.",
            )
        if resolution_error == "device_offline":
            return HTTPStatus.SERVICE_UNAVAILABLE, self._browser_phone_role_error_payload(
                "device_offline",
                device_id=device_id or requested_device_id,
                detail="Selected device is offline.",
            )
        try:
            queued = self._queue_device_command(device_id, "phone.role.status", {})
        except RuntimeError as exc:
            detail = str(exc)
            if detail == "DEVICE_OFFLINE":
                return HTTPStatus.SERVICE_UNAVAILABLE, self._browser_phone_role_error_payload(
                    "device_offline",
                    device_id=device_id,
                    detail="Selected device is offline.",
                )
            return HTTPStatus.BAD_GATEWAY, self._browser_phone_role_error_payload(
                "broker_command_failed",
                device_id=device_id,
                detail=detail,
            )
        result = self._await_device_command_result(str(queued.get("id") or ""), timeout_ms=2_000, interval_ms=100) or queued
        status = str(result.get("status") or "").strip().lower()
        if status == "completed":
            payload = result.get("result") if isinstance(result.get("result"), dict) else result
            if isinstance(payload, dict) and isinstance(payload.get("result"), dict):
                payload = payload.get("result")
            if isinstance(payload, dict):
                return HTTPStatus.OK, self._normalize_browser_phone_role_payload(payload, device_id=device_id)
        if status == "device_offline":
            return HTTPStatus.SERVICE_UNAVAILABLE, self._browser_phone_role_error_payload(
                "device_offline",
                device_id=device_id,
                detail="Selected device went offline before returning a result.",
            )
        return HTTPStatus.BAD_GATEWAY, self._browser_phone_role_error_payload(
            "broker_command_failed",
            device_id=device_id,
            detail=str(result.get("error") or result.get("status") or "broker command failed"),
        )

    def _await_device_command_result(
        self,
        command_id: str,
        *,
        timeout_ms: int = 1_200,
        interval_ms: int = 100,
    ) -> dict[str, object] | None:
        clean_command_id = str(command_id or "").strip()
        if not clean_command_id:
            return None
        broker = ensure_broker_initialized()
        deadline = time.time() + max(0.1, timeout_ms / 1000.0)
        while time.time() < deadline:
            command = broker.get_command(clean_command_id)
            if isinstance(command, dict) and str(command.get("status") or "").strip().lower() in {
                "completed",
                "failed",
                "rejected",
                "device_offline",
                "send_failed",
            }:
                return command
            time.sleep(max(0.05, interval_ms / 1000.0))
        return broker.get_command(clean_command_id)

    def _default_reminder_notification_payload(
        self,
        reminder: dict[str, object],
        destination: dict[str, object] | None = None,
    ) -> dict[str, object]:
        reminder_id = str(reminder.get("id") or reminder.get("record_id") or "").strip()
        title = str(reminder.get("title") or "Reminder").strip() or "Reminder"
        summary = str(reminder.get("summary") or "").strip()
        text = summary or "Reminder due now."
        return {
            "id": f"reminder_{reminder_id or uuid.uuid4().hex[:12]}",
            "title": title,
            "text": text,
            "big_text": summary or title,
            "surface": {"mode": "heads_up"},
            "importance": "high",
            "category": "reminder",
            "default_sound": True,
            "vibration_pattern_ms": [0, 120, 80, 180],
            "auto_cancel": True,
            "only_alert_once": True,
        }

    def _reminder_notification_payload(
        self,
        reminder: dict[str, object],
        destination: dict[str, object] | None = None,
    ) -> dict[str, object]:
        metadata = reminder.get("metadata") if isinstance(reminder.get("metadata"), dict) else {}
        custom = (
            _coerce_json_object(destination.get("notification_payload"))
            if isinstance(destination, dict)
            else {}
        ) or _coerce_json_object(metadata.get("notification_payload"))
        payload = custom if custom else self._default_reminder_notification_payload(reminder, destination)
        payload.setdefault("id", f"reminder_{str(reminder.get('id') or reminder.get('record_id') or uuid.uuid4().hex[:12]).strip()}")
        payload.setdefault("title", str(reminder.get("title") or "Reminder").strip() or "Reminder")
        summary = str(reminder.get("summary") or "").strip()
        payload.setdefault("text", summary or "Reminder due now.")
        if summary and not str(payload.get("big_text") or "").strip():
            payload["big_text"] = summary
        return payload

    def _reminder_is_due_for_delivery(self, reminder: dict[str, object], now_ms: int) -> bool:
        if not isinstance(reminder, dict):
            return False
        if bool(reminder.get("archived")) or bool(reminder.get("deleted")):
            return False
        if str(reminder.get("status") or "").strip().lower() == "done":
            return False
        due_at_ms = int(reminder.get("due_at_ms") or 0)
        if due_at_ms <= 0 or due_at_ms > now_ms:
            return False
        metadata = reminder.get("metadata") if isinstance(reminder.get("metadata"), dict) else {}
        return int(metadata.get("last_fired_due_at_ms") or 0) != due_at_ms

    def _reminder_delivery_patch(
        self,
        reminder: dict[str, object],
        *,
        delivery_state: str,
        now_ms: int,
        delivery_results: list[dict[str, object]] | None = None,
        device_id: str = "",
        error: str = "",
        command_id: str = "",
        requested_mode: str = "",
        effective_mode: str = "",
        degraded_to: str = "",
        warnings: list[str] | None = None,
        mark_fired: bool = False,
    ) -> dict[str, object] | None:
        metadata = reminder.get("metadata") if isinstance(reminder.get("metadata"), dict) else {}
        due_at_ms = int(reminder.get("due_at_ms") or 0)
        normalized_error = str(error or "").strip()
        result_rows = [row for row in list(delivery_results or []) if isinstance(row, dict)]
        primary_phone_result = next(
            (row for row in result_rows if str(row.get("channel") or "").strip().lower() == "phone_notification"),
            {},
        )
        payload = {
            "metadata": {
                "delivery_state": delivery_state,
                "last_delivery_error": normalized_error,
                "notification_device_id": device_id or str(primary_phone_result.get("device_id") or metadata.get("notification_device_id") or "").strip(),
                "last_notification_command_id": command_id or str(primary_phone_result.get("command_id") or metadata.get("last_notification_command_id") or "").strip(),
                "last_delivery_mode_requested": requested_mode or str(primary_phone_result.get("requested_mode") or metadata.get("last_delivery_mode_requested") or "").strip(),
                "last_delivery_mode_effective": effective_mode or str(primary_phone_result.get("effective_mode") or metadata.get("last_delivery_mode_effective") or "").strip(),
                "last_delivery_degraded_to": degraded_to or str(primary_phone_result.get("degraded_to") or metadata.get("last_delivery_degraded_to") or "").strip(),
                "last_delivery_warnings": list(warnings or primary_phone_result.get("warnings") or []),
                "last_delivery_results": result_rows,
                "snoozed_until_ms": 0,
            }
        }
        if mark_fired:
            payload["metadata"]["last_fired_at_ms"] = now_ms
            payload["metadata"]["last_fired_due_at_ms"] = due_at_ms
        return self.workspace.patch_record("reminders", str(reminder.get("id") or reminder.get("record_id") or ""), payload)

    def _reminder_recipient_display_name(self, recipient: dict[str, object]) -> str:
        label = str(recipient.get("label") or "").strip()
        if label:
            return label
        if str(recipient.get("kind") or "").strip().lower() == "self":
            return "Me"
        contact = self._reminder_contact_record(recipient)
        if isinstance(contact, dict):
            return str(contact.get("title") or contact.get("display_name") or recipient.get("id") or "Contact").strip()
        return str(recipient.get("id") or "Contact").strip() or "Contact"

    def _reminder_human_due_label(self, reminder: dict[str, object]) -> str:
        due_at_ms = int(reminder.get("due_at_ms") or 0)
        if due_at_ms <= 0:
            return "Any time"
        now_ms = self.workspace.now_ms()
        if due_at_ms <= now_ms:
            return "Now"
        struct = time.localtime(due_at_ms / 1000)
        if due_at_ms - now_ms < 24 * 60 * 60 * 1000:
            return time.strftime("%-I:%M %p", struct)
        return time.strftime("%a %-I:%M %p", struct)

    def _render_reminder_template(self, value: object, context: dict[str, object]) -> object:
        if isinstance(value, str):
            rendered = value
            for key, raw in context.items():
                rendered = rendered.replace(f"{{{{{key}}}}}", str(raw or ""))
            return rendered
        if isinstance(value, list):
            return [self._render_reminder_template(item, context) for item in value]
        if isinstance(value, dict):
            return {
                str(key): self._render_reminder_template(item, context)
                for key, item in value.items()
            }
        return value

    def _reminder_template_context(
        self,
        reminder: dict[str, object],
        target: dict[str, object],
    ) -> dict[str, object]:
        recipient = target.get("recipient") if isinstance(target.get("recipient"), dict) else {}
        return {
            "id": str(reminder.get("id") or "").strip(),
            "title": str(reminder.get("title") or "Reminder").strip() or "Reminder",
            "summary": str(reminder.get("summary") or "").strip(),
            "due_label": self._reminder_human_due_label(reminder),
            "recipient_id": str(recipient.get("id") or "").strip(),
            "recipient_name": self._reminder_recipient_display_name(recipient),
            "recipient_value": str(target.get("target") or "").strip(),
            "channel": str(target.get("channel") or "").strip(),
        }

    def _reminder_plain_text_body(self, reminder: dict[str, object], target: dict[str, object]) -> str:
        context = self._reminder_template_context(reminder, target)
        summary = str(context.get("summary") or "").strip()
        due_label = str(context.get("due_label") or "").strip()
        lines = [str(context.get("title") or "Reminder")]
        if summary:
            lines.append(summary)
        if due_label:
            lines.append(f"Due: {due_label}")
        return "\n".join(lines)

    def _reminder_delivery_targets(self, reminder: dict[str, object]) -> list[dict[str, object]]:
        metadata = reminder.get("metadata") if isinstance(reminder.get("metadata"), dict) else {}
        destinations = self._reminder_destinations_from_metadata(metadata)
        targets: list[dict[str, object]] = []
        for destination in destinations:
            refs = self._reminder_destination_recipient_refs(metadata, destination)
            for recipient in refs:
                channel = str(destination.get("channel") or "").strip().lower()
                target: dict[str, object] = {
                    "channel": channel,
                    "recipient": recipient,
                    "recipient_id": str(recipient.get("id") or "").strip(),
                    "recipient_label": self._reminder_recipient_display_name(recipient),
                    "destination": destination,
                    "target": "",
                    "device_id": "",
                    "connected_account_id": "",
                    "app_slug": str(destination.get("app_slug") or "").strip().lower(),
                }
                if channel == "phone_notification":
                    device_id, device_error = self._reminder_target_device_id(reminder)
                    if device_error:
                        raise RuntimeError(device_error)
                    target["device_id"] = device_id
                elif channel == "email":
                    address = self._resolve_reminder_email_target(recipient, destination)
                    if not address:
                        raise RuntimeError(f"missing_email_target:{target['recipient_id']}")
                    connected_account_id, _ = self._require_connected_app("gmail", destination)
                    target["target"] = address
                    target["connected_account_id"] = connected_account_id
                    target["app_slug"] = "gmail"
                elif channel in {"sms", "call"}:
                    number = self._resolve_reminder_phone_target(recipient, destination)
                    if not number:
                        raise RuntimeError(f"missing_phone_target:{target['recipient_id']}")
                    device_id, device_error = self._reminder_target_device_id(reminder)
                    if device_error:
                        raise RuntimeError(device_error)
                    target["target"] = number
                    target["device_id"] = device_id
                elif channel == "connected_app":
                    connected_account_id, _ = self._require_connected_app(str(destination.get("app_slug") or "").strip(), destination)
                    target["connected_account_id"] = connected_account_id
                    target["target"] = str(destination.get("endpoint") or "").strip()
                else:
                    raise RuntimeError(f"unsupported_reminder_destination:{channel}")
                targets.append(target)
        return targets

    def _send_reminder_phone_notification(self, reminder: dict[str, object], target: dict[str, object]) -> dict[str, object]:
        device_id = str(target.get("device_id") or "").strip()
        destination = target.get("destination") if isinstance(target.get("destination"), dict) else {}
        payload = self._reminder_notification_payload(reminder, destination)
        requested_mode = str(
            (_coerce_json_object(payload.get("surface")).get("mode"))
            or payload.get("surface_mode")
            or "shade"
        ).strip() or "shade"
        command = self._queue_device_command(device_id, "notify.show", payload)
        final_command = self._await_device_command_result(str(command.get("id") or "")) or command
        command_status = str(final_command.get("status") or command.get("status") or "").strip().lower()
        command_result = final_command.get("result") if isinstance(final_command.get("result"), dict) else {}
        result_body = command_result.get("result") if isinstance(command_result.get("result"), dict) else command_result
        effective_mode = str(result_body.get("effective_surface_mode") or result_body.get("requested_surface_mode") or "").strip()
        degraded_to = str(result_body.get("degraded_to") or "").strip()
        warnings = [str(item).strip() for item in list(result_body.get("warnings") or []) if str(item).strip()]
        if command_status in {"failed", "rejected", "device_offline", "send_failed"}:
            error = str((((final_command.get("error") or {}) if isinstance(final_command.get("error"), dict) else {}).get("message")) or command_status or "failed").strip()
            return {
                "channel": "phone_notification",
                "recipient_id": str(target.get("recipient_id") or "").strip(),
                "recipient_label": str(target.get("recipient_label") or "").strip(),
                "device_id": device_id,
                "ok": False,
                "status": command_status,
                "detail": error,
                "command_id": str(command.get("id") or "").strip(),
                "requested_mode": requested_mode,
                "effective_mode": effective_mode,
                "degraded_to": degraded_to,
                "warnings": warnings,
                "fired_at_ms": self.workspace.now_ms(),
            }
        return {
            "channel": "phone_notification",
            "recipient_id": str(target.get("recipient_id") or "").strip(),
            "recipient_label": str(target.get("recipient_label") or "").strip(),
            "device_id": device_id,
            "ok": True,
            "status": "sent",
            "detail": "",
            "command_id": str(command.get("id") or "").strip(),
            "requested_mode": requested_mode,
            "effective_mode": effective_mode,
            "degraded_to": degraded_to,
            "warnings": warnings,
            "fired_at_ms": self.workspace.now_ms(),
        }

    def _send_reminder_email(self, reminder: dict[str, object], target: dict[str, object]) -> dict[str, object]:
        address = str(target.get("target") or "").strip()
        connected_account_id = str(target.get("connected_account_id") or "").strip()
        context = self._reminder_template_context(reminder, target)
        subject = str(context.get("title") or "Reminder")
        plain_body = self._reminder_plain_text_body(reminder, target)
        message = EmailMessage()
        if str(self.config.self_email or "").strip():
            message["From"] = str(self.config.self_email or "").strip()
        message["To"] = address
        message["Subject"] = subject
        message.set_content(plain_body)
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii").rstrip("=")
        try:
            result = self.composio.execute_proxy(
                connected_account_id=connected_account_id,
                endpoint="/gmail/v1/users/me/messages/send",
                method="POST",
                body={"raw": raw},
            )
            adapter = "proxy"
        except Exception as exc:
            try:
                result = self.composio.execute_tool(
                    tool_slug="GMAIL_SEND_EMAIL",
                    connected_account_id=connected_account_id,
                    user_id=self.composio_user_id(),
                    arguments={
                        "recipient_email": address,
                        "subject": subject,
                        "body": plain_body,
                    },
                )
                adapter = "tool"
            except Exception as tool_exc:
                detail = f"{exc}; fallback:{tool_exc}" if str(tool_exc) else str(exc)
                return {
                    "channel": "email",
                    "recipient_id": str(target.get("recipient_id") or "").strip(),
                    "recipient_label": str(target.get("recipient_label") or "").strip(),
                    "target": address,
                    "connected_account_id": connected_account_id,
                    "app_slug": "gmail",
                    "ok": False,
                    "status": "failed",
                    "detail": detail,
                    "fired_at_ms": self.workspace.now_ms(),
                }
        return {
            "channel": "email",
            "recipient_id": str(target.get("recipient_id") or "").strip(),
            "recipient_label": str(target.get("recipient_label") or "").strip(),
            "target": address,
            "connected_account_id": connected_account_id,
            "app_slug": "gmail",
            "ok": True,
            "status": "sent",
            "detail": "",
            "adapter": adapter,
            "result": result,
            "fired_at_ms": self.workspace.now_ms(),
        }

    def _send_reminder_sms(self, reminder: dict[str, object], target: dict[str, object]) -> dict[str, object]:
        device_id = str(target.get("device_id") or "").strip()
        number = str(target.get("target") or "").strip()
        body = self._reminder_plain_text_body(reminder, target)
        command = self._queue_device_command(device_id, "phone.sms.send", {"to": number, "body": body})
        final_command = self._await_device_command_result(str(command.get("id") or "")) or command
        command_status = str(final_command.get("status") or command.get("status") or "").strip().lower()
        if command_status in {"failed", "rejected", "device_offline", "send_failed"}:
            error = str((((final_command.get("error") or {}) if isinstance(final_command.get("error"), dict) else {}).get("message")) or command_status or "failed").strip()
            return {
                "channel": "sms",
                "recipient_id": str(target.get("recipient_id") or "").strip(),
                "recipient_label": str(target.get("recipient_label") or "").strip(),
                "target": number,
                "device_id": device_id,
                "ok": False,
                "status": command_status,
                "detail": error,
                "command_id": str(command.get("id") or "").strip(),
                "fired_at_ms": self.workspace.now_ms(),
            }
        return {
            "channel": "sms",
            "recipient_id": str(target.get("recipient_id") or "").strip(),
            "recipient_label": str(target.get("recipient_label") or "").strip(),
            "target": number,
            "device_id": device_id,
            "ok": True,
            "status": "sent",
            "detail": "",
            "command_id": str(command.get("id") or "").strip(),
            "fired_at_ms": self.workspace.now_ms(),
        }

    def _send_reminder_call(self, _reminder: dict[str, object], target: dict[str, object]) -> dict[str, object]:
        device_id = str(target.get("device_id") or "").strip()
        number = str(target.get("target") or "").strip()
        command = self._queue_device_command(device_id, "phone.calls.place", {"number": number})
        final_command = self._await_device_command_result(str(command.get("id") or "")) or command
        command_status = str(final_command.get("status") or command.get("status") or "").strip().lower()
        if command_status in {"failed", "rejected", "device_offline", "send_failed"}:
            error = str((((final_command.get("error") or {}) if isinstance(final_command.get("error"), dict) else {}).get("message")) or command_status or "failed").strip()
            return {
                "channel": "call",
                "recipient_id": str(target.get("recipient_id") or "").strip(),
                "recipient_label": str(target.get("recipient_label") or "").strip(),
                "target": number,
                "device_id": device_id,
                "ok": False,
                "status": command_status,
                "detail": error,
                "command_id": str(command.get("id") or "").strip(),
                "fired_at_ms": self.workspace.now_ms(),
            }
        return {
            "channel": "call",
            "recipient_id": str(target.get("recipient_id") or "").strip(),
            "recipient_label": str(target.get("recipient_label") or "").strip(),
            "target": number,
            "device_id": device_id,
            "ok": True,
            "status": "sent",
            "detail": "",
            "command_id": str(command.get("id") or "").strip(),
            "fired_at_ms": self.workspace.now_ms(),
        }

    def _send_reminder_connected_app(self, reminder: dict[str, object], target: dict[str, object]) -> dict[str, object]:
        destination = target.get("destination") if isinstance(target.get("destination"), dict) else {}
        endpoint = str(destination.get("endpoint") or "").strip()
        method = str(destination.get("method") or "POST").strip().upper() or "POST"
        raw_query = list(destination.get("query") or []) if isinstance(destination.get("query"), list) else []
        parameters = dict(destination.get("parameters") or {}) if isinstance(destination.get("parameters"), dict) else {}
        context = self._reminder_template_context(reminder, target)
        rendered_query = self._render_reminder_template(raw_query, context)
        rendered_body = self._render_reminder_template(parameters, context)
        if not rendered_body:
            rendered_body = {"text": self._reminder_plain_text_body(reminder, target)}
        try:
            result = self.composio.execute_proxy(
                connected_account_id=str(target.get("connected_account_id") or "").strip(),
                endpoint=endpoint,
                method=method,
                parameters=rendered_query if isinstance(rendered_query, list) else None,
                body=rendered_body if isinstance(rendered_body, dict) else None,
            )
        except Exception as exc:
            return {
                "channel": "connected_app",
                "recipient_id": str(target.get("recipient_id") or "").strip(),
                "recipient_label": str(target.get("recipient_label") or "").strip(),
                "target": endpoint,
                "connected_account_id": str(target.get("connected_account_id") or "").strip(),
                "app_slug": str(target.get("app_slug") or "").strip(),
                "ok": False,
                "status": "failed",
                "detail": str(exc),
                "fired_at_ms": self.workspace.now_ms(),
            }
        return {
            "channel": "connected_app",
            "recipient_id": str(target.get("recipient_id") or "").strip(),
            "recipient_label": str(target.get("recipient_label") or "").strip(),
            "target": endpoint,
            "connected_account_id": str(target.get("connected_account_id") or "").strip(),
            "app_slug": str(target.get("app_slug") or "").strip(),
            "ok": True,
            "status": "sent",
            "detail": "",
            "result": result,
            "fired_at_ms": self.workspace.now_ms(),
        }

    def _send_reminder_target(self, reminder: dict[str, object], target: dict[str, object]) -> dict[str, object]:
        channel = str(target.get("channel") or "").strip().lower()
        if channel == "phone_notification":
            return self._send_reminder_phone_notification(reminder, target)
        if channel == "email":
            return self._send_reminder_email(reminder, target)
        if channel == "sms":
            return self._send_reminder_sms(reminder, target)
        if channel == "call":
            return self._send_reminder_call(reminder, target)
        if channel == "connected_app":
            return self._send_reminder_connected_app(reminder, target)
        return {
            "channel": channel,
            "recipient_id": str(target.get("recipient_id") or "").strip(),
            "recipient_label": str(target.get("recipient_label") or "").strip(),
            "target": str(target.get("target") or "").strip(),
            "ok": False,
            "status": "failed",
            "detail": f"unsupported_reminder_destination:{channel}",
            "fired_at_ms": self.workspace.now_ms(),
        }

    def process_due_reminders(self) -> dict[str, object]:
        if not self._reminder_poll_lock.acquire(blocking=False):
            return {"schema": "pucky.reminder_delivery_poll.v1", "skipped": True, "reason": "already_running"}
        try:
            now_ms = self.workspace.now_ms()
            reminders = list(self.workspace.list_records("reminders", limit=500).get("items") or [])
            processed: list[dict[str, object]] = []
            for reminder in reminders:
                if not self._reminder_is_due_for_delivery(reminder, now_ms):
                    continue
                reminder_id = str(reminder.get("id") or "")
                try:
                    targets = self._reminder_delivery_targets(reminder)
                except Exception as exc:
                    error = str(exc).strip() or "reminder_target_resolution_failed"
                    existing_meta = reminder.get("metadata") if isinstance(reminder.get("metadata"), dict) else {}
                    if str(existing_meta.get("delivery_state") or "") != "failed" or str(existing_meta.get("last_delivery_error") or "") != error:
                        self._reminder_delivery_patch(reminder, delivery_state="failed", now_ms=now_ms, error=error)
                    self.record_action(surface="reminders", action="deliver", tool="reminder.delivery", target=reminder_id or "reminder", status=f"failed:{error[:80]}")
                    processed.append({"id": reminder_id, "ok": False, "error": error})
                    continue
                delivery_results: list[dict[str, object]] = []
                for target in targets:
                    try:
                        result = self._send_reminder_target(reminder, target)
                    except Exception as exc:
                        result = {
                            "channel": str(target.get("channel") or "").strip(),
                            "recipient_id": str(target.get("recipient_id") or "").strip(),
                            "recipient_label": str(target.get("recipient_label") or "").strip(),
                            "target": str(target.get("target") or target.get("device_id") or "").strip(),
                            "ok": False,
                            "status": "failed",
                            "detail": str(exc),
                            "app_slug": str(target.get("app_slug") or "").strip(),
                            "connected_account_id": str(target.get("connected_account_id") or "").strip(),
                            "fired_at_ms": self.workspace.now_ms(),
                        }
                    delivery_results.append(result)
                    status = "sent" if bool(result.get("ok")) else f"failed:{str(result.get('detail') or result.get('status') or 'failed')[:80]}"
                    self.record_action(
                        surface="reminders",
                        action="deliver",
                        tool=f"reminder.{str(result.get('channel') or 'delivery')}",
                        target=f"{reminder_id}:{str(result.get('recipient_id') or 'recipient')}",
                        status=status,
                    )
                any_success = any(bool(row.get("ok")) for row in delivery_results)
                first_phone_result = next(
                    (row for row in delivery_results if str(row.get("channel") or "").strip().lower() == "phone_notification"),
                    {},
                )
                self._reminder_delivery_patch(
                    reminder,
                    delivery_state="sent" if any_success else "failed",
                    now_ms=now_ms,
                    delivery_results=delivery_results,
                    device_id=str(first_phone_result.get("device_id") or ""),
                    error="" if any_success else str(next((row.get("detail") for row in delivery_results if not bool(row.get("ok")) and str(row.get("detail") or "").strip()), "delivery_failed")),
                    command_id=str(first_phone_result.get("command_id") or ""),
                    requested_mode=str(first_phone_result.get("requested_mode") or ""),
                    effective_mode=str(first_phone_result.get("effective_mode") or ""),
                    degraded_to=str(first_phone_result.get("degraded_to") or ""),
                    warnings=list(first_phone_result.get("warnings") or []) if isinstance(first_phone_result.get("warnings"), list) else [],
                    mark_fired=any_success,
                )
                processed.append({"id": reminder_id, "ok": any_success, "targets": delivery_results})
            return {
                "schema": "pucky.reminder_delivery_poll.v1",
                "ok": True,
                "count": len(processed),
                "processed": processed,
                "now_ms": now_ms,
            }
        finally:
            self._reminder_poll_lock.release()

    def composio_user_id(self) -> str:
        return self.config.composio_default_user_id

    def composio_auth_mode(self, value: str | None = None) -> str:
        candidate = str(value or self.config.composio_default_auth_mode or "webview").strip().lower()
        return "browser" if candidate == "browser" else "webview"

    def agent_runtime_catalog(self) -> dict[str, object]:
        return agent_runtime_catalog_payload()

    def agent_runtime_call(self, payload: dict[str, object]) -> dict[str, object]:
        method = str(payload.get("method") or payload.get("action") or "").strip()
        if method not in AGENT_RUNTIME_ACTION_NAMES:
            return {
                "ok": False,
                "schema": "pucky.agent_runtime.call.v1",
                "error": "unsupported_agent_runtime_action",
                "method": method,
            }
        params = payload.get("params")
        if params is None:
            params = {}
        if not isinstance(params, dict):
            return {
                "ok": False,
                "schema": "pucky.agent_runtime.call.v1",
                "error": "params_must_be_object",
                "method": method,
            }
        runtime_call = getattr(self.codex, "runtime_call", None)
        if not callable(runtime_call):
            return {
                "ok": False,
                "schema": "pucky.agent_runtime.call.v1",
                "error": "codex_runtime_call_unavailable",
                "method": method,
            }
        try:
            result = runtime_call(method, params, timeout=self.config.codex_turn_timeout)
        except TypeError:
            result = runtime_call(method, params)
        except Exception as exc:
            self.record_action(
                surface="agent_runtime",
                action=method,
                tool="agent.runtime.call",
                target=method,
                status="error",
                thread_id=str(params.get("threadId") or ""),
            )
            return {
                "ok": False,
                "schema": "pucky.agent_runtime.call.v1",
                "error": str(exc),
                "method": method,
            }
        self.record_action(
            surface="agent_runtime",
            action=method,
            tool="agent.runtime.call",
            target=method,
            status="ok",
            thread_id=str(params.get("threadId") or ""),
        )
        return {
            "ok": True,
            "schema": "pucky.agent_runtime.call.v1",
            "method": method,
            "result": result if isinstance(result, dict) else {},
        }

    def codex_tools_for_thread(self) -> list[dict[str, object]]:
        return [json.loads(json.dumps(tool)) for tool in COMPOSIO_DYNAMIC_TOOLS]

    def meeting_codex_tools_for_thread(self) -> list[dict[str, object]]:
        tools = COMPOSIO_DYNAMIC_TOOLS + MEETING_DYNAMIC_TOOLS
        return [json.loads(json.dumps(tool)) for tool in tools]

    def handle_codex_dynamic_tool_call(
        self,
        tool: str,
        arguments: object,
        *,
        call_id: str = "",
        thread_id: str = "",
        turn_id: str = "",
    ) -> dict[str, object]:
        tool_name = str(tool or "").strip()
        payload = _coerce_json_object(arguments)
        if tool_name == "composio_list_connected_apps":
            result = self.composio_list_connected_apps_tool()
        elif tool_name == "composio_check_connection":
            result = self.composio_check_connection_tool(str(payload.get("app_slug") or ""))
        elif tool_name == "composio_execute_action":
            result = self.composio_execute_action_tool(payload)
        elif tool_name == "meeting_deepgram_transcribe":
            result = self.meeting_deepgram_transcribe_tool(payload, thread_id=thread_id, turn_id=turn_id)
        elif tool_name == "meeting_record_update":
            result = self.meeting_record_update_tool(payload, thread_id=thread_id, turn_id=turn_id)
        else:
            raise RuntimeError(f"unsupported dynamic tool: {tool_name or '<empty>'}")
        if tool_name.startswith("meeting_"):
            self.record_action(
                surface="meeting_tool",
                action=tool_name,
                tool=tool_name,
                target=str(payload.get("meeting_id") or tool_name),
                status="ok" if bool(result.get("ok")) else "error",
                thread_id=thread_id,
            )
        return {
            "success": bool(result.get("ok")),
            "contentItems": [
                {
                    "type": "inputText",
                    "text": json.dumps(result, sort_keys=True),
                }
            ],
        }

    def _remember_meeting_agent_state(self, meeting_id: str, updates: dict[str, object]) -> dict[str, object]:
        clean_meeting_id = _safe_meeting_id(meeting_id)
        if not clean_meeting_id:
            return {}
        with self._meeting_agent_state_lock:
            current = dict(self._meeting_agent_state_by_id.get(clean_meeting_id) or {})
            for key, value in updates.items():
                if value is None:
                    current.pop(key, None)
                else:
                    current[key] = value
            self._meeting_agent_state_by_id[clean_meeting_id] = current
            return dict(current)

    def _apply_meeting_agent_state(self, record: dict[str, object]) -> dict[str, object]:
        meeting_id = _safe_meeting_id(record.get("meeting_id"))
        agent = dict(record.get("agent") or {}) if isinstance(record.get("agent"), dict) else {}
        if meeting_id:
            with self._meeting_agent_state_lock:
                cached = dict(self._meeting_agent_state_by_id.get(meeting_id) or {})
            if cached:
                agent.update(cached)
        if agent:
            record["agent"] = agent
        elif "agent" not in record:
            record["agent"] = {}
        return dict(record.get("agent") or {})

    def _persist_meeting_agent_state(self, meeting_id: str, updates: dict[str, object]) -> dict[str, object]:
        merged = self._remember_meeting_agent_state(meeting_id, updates)
        record = self._meeting_record_by_id(meeting_id)
        if isinstance(record, dict):
            record["agent"] = dict(record.get("agent") or {}) if isinstance(record.get("agent"), dict) else {}
            record["agent"].update(merged)
            self._upsert_meeting(record)
        return merged

    def composio_list_connected_apps_tool(self) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        try:
            apps = self._connected_apps_snapshot(force=True)
        except Exception as exc:
            result = {"ok": False, "error": str(exc)}
        else:
            result = {
                "ok": True,
                "data": {
                    "apps": apps,
                    "count": len(apps),
                    "user_id": self.composio_user_id(),
                },
            }
        self.record_action(
            surface="composio_tool",
            action="connected_apps.list",
            tool="composio_list_connected_apps",
            target="connected_apps.list",
            status="ok" if bool(result.get("ok")) else "error",
        )
        return result

    def composio_check_connection_tool(self, app_slug: str) -> dict[str, object]:
        clean_app_slug = str(app_slug or "").strip().lower()
        if not clean_app_slug:
            return {
                "ok": False,
                "error": "app_slug_required",
                "suggested_next_step": "Provide app_slug, for example gmail or googlecalendar.",
            }
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        try:
            apps = self._connected_apps_snapshot(force=True)
        except Exception as exc:
            result = {"ok": False, "error": str(exc)}
        else:
            match = next((item for item in apps if str(item.get("app_slug") or "") == clean_app_slug), None)
            result = {
                "ok": True,
                "data": {
                    "app_slug": clean_app_slug,
                    "connected": bool(match),
                    "connection_count": len(list(match.get("connected_account_ids") or [])) if isinstance(match, dict) else 0,
                    "connected_account_ids": list(match.get("connected_account_ids") or []) if isinstance(match, dict) else [],
                    "display_names": list(match.get("display_names") or []) if isinstance(match, dict) else [],
                },
            }
        self.record_action(
            surface="composio_tool",
            action="check_connection",
            tool="composio_check_connection",
            target=clean_app_slug,
            status="ok" if bool(result.get("ok")) else "error",
        )
        return result

    def composio_execute_action_tool(self, payload: dict[str, object]) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        action_slug = str(payload.get("action_slug") or "").strip()
        if not action_slug:
            return {
                "ok": False,
                "error": "action_slug_required",
                "suggested_next_step": "Provide one Composio action slug, for example GMAIL_FETCH_EMAILS.",
            }
        arguments = payload.get("parameters")
        if arguments is None:
            arguments = {}
        if not isinstance(arguments, dict):
            return {"ok": False, "error": "parameters_must_be_object"}
        app_slug = _infer_composio_app_slug_from_action(action_slug)
        if not app_slug:
            return {
                "ok": False,
                "error": "cannot_infer_toolkit",
                "data": {"action_slug": action_slug},
            }
        tool_meta: dict[str, object] = {}
        try:
            tool_meta = self.composio.get_tool(action_slug)
        except Exception:
            tool_meta = {}
        if not tool_meta:
            return {
                "ok": False,
                "error": "cannot_infer_toolkit",
                "data": {"action_slug": action_slug, "app_slug": app_slug},
            }
        parameter_schema = tool_meta.get("input_parameters") if isinstance(tool_meta.get("input_parameters"), dict) else {}
        if not parameter_schema and isinstance(tool_meta.get("parameters"), dict):
            parameter_schema = dict(tool_meta.get("parameters") or {})
        required = [str(value) for value in list(parameter_schema.get("required") or []) if str(value).strip()]
        missing = [name for name in required if name not in arguments]
        if missing:
            return {
                "ok": False,
                "error": "missing_required_parameters",
                "data": {"app_slug": app_slug, "action_slug": action_slug, "missing_parameters": missing},
                "suggested_next_step": f"Provide values for: {', '.join(missing)}",
            }
        try:
            apps = self._connected_apps_snapshot(force=True)
        except Exception as exc:
            result = {"ok": False, "error": str(exc)}
        else:
            matching_app = next((item for item in apps if str(item.get("app_slug") or "") == app_slug), None)
            candidate_ids = list(matching_app.get("connected_account_ids") or []) if isinstance(matching_app, dict) else []
            requested_connection_id = str(payload.get("connected_account_id") or "").strip()
            if requested_connection_id:
                if requested_connection_id not in candidate_ids:
                    result = {
                        "ok": False,
                        "error": "forbidden_connected_account",
                        "data": {
                            "app_slug": app_slug,
                            "action_slug": action_slug,
                            "connected_account_id": requested_connection_id,
                        },
                    }
                else:
                    resolved_connection_id = requested_connection_id
                    result = self._execute_composio_action(
                        action_slug=action_slug,
                        app_slug=app_slug,
                        connected_account_id=resolved_connection_id,
                        arguments=dict(arguments),
                        connection=matching_app if isinstance(matching_app, dict) else {},
                    )
            elif not candidate_ids:
                result = {
                    "ok": False,
                    "error": "no_active_connection",
                    "data": {"app_slug": app_slug, "action_slug": action_slug},
                    "suggested_next_step": "Use composio_list_connected_apps to inspect what is connected now.",
                }
            elif len(candidate_ids) > 1:
                result = {
                    "ok": False,
                    "error": "multiple_active_connections",
                    "data": {
                        "app_slug": app_slug,
                        "action_slug": action_slug,
                        "candidate_connected_account_ids": candidate_ids,
                        "display_names": list(matching_app.get("display_names") or []) if isinstance(matching_app, dict) else [],
                    },
                    "suggested_next_step": "Call composio_execute_action again with one connected_account_id.",
                }
            else:
                resolved_connection_id = candidate_ids[0]
                result = self._execute_composio_action(
                    action_slug=action_slug,
                    app_slug=app_slug,
                    connected_account_id=resolved_connection_id,
                    arguments=dict(arguments),
                    connection=matching_app if isinstance(matching_app, dict) else {},
                )
        self.record_action(
            surface="composio_tool",
            action="action.execute",
            tool="composio_execute_action",
            target=action_slug or app_slug,
            status="ok" if bool(result.get("ok")) else "error",
        )
        return result

    def _connected_apps_snapshot(self, *, force: bool) -> list[dict[str, object]]:
        payload = self.composio.list_connected_apps(self.composio_user_id(), force=force)
        accounts = [
            _compact_composio_app(item)
            for item in list(payload.get("connected_apps") or [])
            if isinstance(item, dict)
        ]
        return _group_active_connected_accounts(accounts)

    def _execute_composio_action(
        self,
        *,
        action_slug: str,
        app_slug: str,
        connected_account_id: str,
        arguments: dict[str, object],
        connection: dict[str, object],
    ) -> dict[str, object]:
        normalized_arguments = self._apply_composio_safe_defaults(action_slug, arguments)
        try:
            result = self.composio.execute_tool(
                tool_slug=action_slug,
                connected_account_id=connected_account_id,
                user_id=self.composio_user_id(),
                arguments=normalized_arguments,
            )
        except Exception as exc:
            return {
                "ok": False,
                "error": str(exc),
                "data": {
                    "action_slug": action_slug,
                    "app_slug": app_slug,
                    "connected_account_id": connected_account_id,
                },
            }
        return {
            "ok": True,
            "data": {
                "action_slug": action_slug,
                "app_slug": app_slug,
                "connected_account_id": connected_account_id,
                "connection": {
                    "app_slug": str(connection.get("app_slug") or app_slug),
                    "app_name": str(connection.get("app_name") or app_slug.title()),
                    "display_name": str(connection.get("display_name") or connection.get("app_name") or app_slug.title()),
                },
                "result": result,
            },
        }

    def _apply_composio_safe_defaults(self, action_slug: str, arguments: dict[str, object]) -> dict[str, object]:
        normalized = dict(arguments)
        if str(action_slug or "").strip().upper() == "GMAIL_FETCH_EMAILS":
            max_results = normalized.get("max_results")
            if not isinstance(max_results, int) or max_results < 3:
                normalized["max_results"] = 3
            normalized.setdefault("verbose", False)
            normalized.setdefault("include_payload", False)
        return normalized

    def record_action(
        self,
        *,
        surface: str,
        action: str,
        status: str,
        thread_id: str = "",
        thread_title: str = "",
        tool: str = "",
        target: str = "",
    ) -> None:
        try:
            self.action_ledger.record(
                user_id=self.composio_user_id(),
                thread_id=thread_id,
                thread_title=thread_title,
                surface=surface,
                action=action,
                tool=tool,
                target=target,
                status=status,
            )
        except Exception:
            pass

    def _record_codex_action(self, event: dict[str, object], *, role: str = "default") -> None:
        thread_id = str(event.get("thread_id") or "")
        thread_title = str(event.get("thread_title") or "")
        if thread_id and not thread_title:
            codex_client = self.meeting_codex if role == "meeting" else self.codex
            thread_origin = getattr(codex_client, "thread_origin", None)
            if callable(thread_origin):
                try:
                    origin = thread_origin(thread_id, retries=1, delay=0.0)
                    if isinstance(origin, dict):
                        thread_title = str(origin.get("thread_title") or "")
                except Exception:
                    thread_title = ""
        self.record_action(
            surface=str(event.get("surface") or "codex_runtime"),
            action=str(event.get("action") or ""),
            tool=str(event.get("tool") or event.get("action") or ""),
            target=str(event.get("target") or event.get("action") or ""),
            status=str(event.get("status") or ""),
            thread_id=thread_id,
            thread_title=thread_title,
        )

    def _record_composio_action(self, event: dict[str, object]) -> None:
        self.record_action(
            surface=str(event.get("surface") or "composio"),
            action=str(event.get("action") or ""),
            tool=str(event.get("tool") or event.get("action") or ""),
            target=str(event.get("target") or event.get("action") or ""),
            status=str(event.get("status") or ""),
        )

    def codex_base_instructions_for_thread(self) -> str | None:
        base = str(self.config.codex_base_instructions or "")
        include_inventory = any(placeholder in base for placeholder in OPTIONAL_PUCKY_BASE_PLACEHOLDERS)
        runtime_context = self._base_runtime_context(include_composio_inventory=include_inventory)
        return compose_pucky_base_instructions(self.config.codex_base_instructions, runtime_context)

    def _base_runtime_context(self, *, include_composio_inventory: bool | None = None) -> dict[str, object]:
        if include_composio_inventory is None:
            include_composio_inventory = True
        composio_context = self._composio_runtime_context(include_inventory=include_composio_inventory)
        return {
            "schema": "pucky.runtime_context.v1",
            "agent_runtime": self.agent_runtime_catalog(),
            "action_log": {
                "schema": "action_log.recent.v1",
                "limit": 150,
                "rows": self.action_ledger.recent(self.composio_user_id(), limit=150, prompt_visible_only=True),
            },
            "composio": composio_context,
            "reply_card": self._reply_card_runtime_context(),
            "user_facing_app_html": {
                "kind": "editable HTML/JS/CSS served directly by the VM at /ui/pucky/latest/",
                "official_web_url": "/ui/pucky/latest/",
                "source_of_truth": "pucky_vm/ui_src",
                "verification_path": "Open /ui/pucky/latest/ in the hosted browser and verify live data routes there.",
            },
            "android_apk": {
                "areas": [
                    "device status",
                    "permissions",
                    "battery/network/location",
                    "sensors",
                    "camera/photo/torch",
                    "notifications",
                    "audio/media/player",
                    "voice/wake/speech",
                    "files/artifacts",
                    "contacts/SMS/calls/calendar/settings",
                    "UI/feed/web shell",
                ],
                "list_devices": "GET /v1/devices",
                "authorization": "Authorization: Bearer env:PUCKY_API_TOKEN",
                "meta_list": "command.catalog",
                "capability_summary": "capabilities.get",
                "command_execution": "POST /v1/devices/{device_id}/commands",
                "location_guidance": (
                    "For weather or local-context requests, discover an online device first, "
                    "start with capabilities.get, then call location.get when location capability "
                    "and permission are available."
                ),
            },
        }

    def _composio_runtime_context(self, *, include_inventory: bool) -> dict[str, object]:
        user_id = self.composio_user_id()
        context: dict[str, object] = {
            "schema": "pucky.composio.runtime_context.v1",
            "configured": bool(self.composio.configured),
            "user_id": user_id,
            "base_url": self.config.composio_base_url,
            "inventory_prefetched": bool(include_inventory),
            "resources": {
                "api_key": "env:COMPOSIO_API_KEY",
                "base_url": "env:COMPOSIO_BASE_URL",
                "user_id": "env:PUCKY_COMPOSIO_USER_ID",
            },
            "connected_apps": [],
            "connected_app_diagnostics": {
                "active_account_rows": 0,
                "unique_active_app_count": 0,
                "status_counts": {},
            },
            "app_universe": [],
            "available_apps": [],
        }
        if not self.composio.configured or not include_inventory:
            return context
        try:
            connected_payload = self.composio.list_connected_apps(user_id, force=False)
            self.record_action(
                surface="composio",
                action="connected_accounts.list",
                tool="GET",
                target="/connected_accounts",
                status="ok",
            )
            apps_payload = self.composio.list_apps()
            self.record_action(
                surface="composio",
                action="toolkits.list",
                tool="GET",
                target="/toolkits",
                status="ok",
            )
        except Exception as exc:
            self.record_action(
                surface="composio",
                action="runtime_context",
                tool="runtime_context",
                target="Composio runtime context",
                status="error",
            )
            context["error"] = str(exc)[:240]
            return context
        active_accounts = [
            _compact_composio_app(item)
            for item in list(connected_payload.get("connected_apps") or [])
            if isinstance(item, dict)
        ]
        status_counts: dict[str, int] = {}
        for item in active_accounts:
            status = str(item.get("status") or "unknown").strip().lower() or "unknown"
            status_counts[status] = status_counts.get(status, 0) + 1
        connected_apps = _unique_active_connected_apps(active_accounts)
        connected_slugs = {
            str(item.get("slug") or "").strip().lower()
            for item in connected_apps
            if str(item.get("slug") or "").strip()
        }
        available_apps = []
        for item in list(apps_payload.get("apps") or []):
            if not isinstance(item, dict) or not bool(item.get("connectable")):
                continue
            slug = str(item.get("slug") or "").strip().lower()
            if not slug or slug in connected_slugs:
                continue
            available_apps.append(_compact_composio_app(item))
        context["connected_apps"] = connected_apps
        context["connected_app_diagnostics"] = {
            "active_account_rows": len(active_accounts),
            "unique_active_app_count": len(connected_apps),
            "status_counts": status_counts,
        }
        context["app_universe"] = [
            _compact_composio_app(item)
            for item in list(apps_payload.get("apps") or [])
            if isinstance(item, dict) and bool(item.get("connectable"))
        ]
        context["available_apps"] = available_apps
        return context

    def _reply_card_runtime_context(self) -> dict[str, object]:
        return {
            "schema": "pucky.reply_card.runtime_context.v1",
            "format": {
                "reply_text": "spoken answer and feed tile summary",
                "card_title": "feed tile title",
                "card_icon": "selects icon and icon-owned accent color",
                "html": "optional rich page",
                "attachments": "optional files with path, mime_type, title, and viewer metadata",
            },
            "icons_endpoint": "GET /api/card-icons",
            "icon_upsert_endpoint": "POST /api/card-icons",
            "icons": [
                {
                    "name": icon["name"],
                    "label": icon["label"],
                    "accent": icon.get("accent", DEFAULT_CARD_ICON_ACCENT),
                }
                for icon in self._load_card_icons().values()
            ],
        }

    def _portal_token_secret(self) -> str:
        return str(self.config.connect_portal_secret or "").strip()

    def _meeting_artifact_link_secret(self) -> str:
        return str(self.config.meeting_artifact_link_secret or "").strip()

    def _mint_meeting_artifact_link_token(
        self,
        *,
        resource_type: str,
        resource_id: str,
        ttl_seconds: int | None = None,
    ) -> str:
        secret = self._meeting_artifact_link_secret()
        if not secret:
            return ""
        clean_type = str(resource_type or "").strip().lower()
        clean_id = str(resource_id or "").strip()
        if clean_type not in {"artifact", "meeting_audio"} or not clean_id:
            return ""
        now = int(time.time())
        payload = {
            "typ": "pucky_meeting_artifact_link",
            "iat": now,
            "exp": now + max(3600, int(ttl_seconds or self.config.meeting_artifact_link_ttl_seconds)),
            "resource_type": clean_type,
            "resource_id": clean_id,
        }
        header = {"alg": "HS256", "typ": "JWT"}
        return _encode_signed_token(header, payload, secret)

    def _verify_meeting_artifact_link_token(
        self,
        token: str,
        *,
        resource_type: str,
        resource_id: str,
    ) -> bool:
        payload = _decode_signed_token(str(token or "").strip(), self._meeting_artifact_link_secret())
        if not payload:
            return False
        if str(payload.get("typ") or "") != "pucky_meeting_artifact_link":
            return False
        if str(payload.get("resource_type") or "").strip().lower() != str(resource_type or "").strip().lower():
            return False
        if str(payload.get("resource_id") or "").strip() != str(resource_id or "").strip():
            return False
        return True

    def meeting_artifact_signed_url(self, artifact_id: str, *, base_url: str = "") -> str:
        clean = str(artifact_id or "").strip()
        token = self._mint_meeting_artifact_link_token(resource_type="artifact", resource_id=clean)
        if not clean or not token:
            return ""
        prefix = str(base_url or "").rstrip("/")
        path = f"/api/shared/artifacts/{quote(clean, safe='')}?token={quote(token, safe='')}"
        return f"{prefix}{path}" if prefix else path

    def meeting_audio_signed_url(self, meeting_id: str, *, base_url: str = "") -> str:
        clean = _safe_meeting_id(meeting_id)
        token = self._mint_meeting_artifact_link_token(resource_type="meeting_audio", resource_id=clean)
        if not clean or not token:
            return ""
        prefix = str(base_url or "").rstrip("/")
        path = f"/api/shared/meetings/{quote(clean, safe='')}/audio?token={quote(token, safe='')}"
        return f"{prefix}{path}" if prefix else path

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

    def _resolve_links_read_user(self, token: str, *, allow_default_user: bool = False) -> str:
        clean_token = str(token or "").strip()
        if clean_token:
            return self._resolve_links_portal_user(clean_token)
        if allow_default_user:
            user_id = self.composio_user_id()
            if user_id:
                return user_id
            raise ValueError("connect_user_unavailable")
        raise ValueError("invalid_or_expired_connect_link")

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
            "token": token,
            "auth_mode": mode,
            "user_id": self.composio_user_id(),
        }

    def links_my_apps(self, token: str, *, allow_default_user: bool = False) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        user_id = self._resolve_links_read_user(token, allow_default_user=allow_default_user)
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

    def _links_catalog_snapshot(self) -> tuple[dict[str, object], str]:
        apps_payload = self.composio.list_apps()
        source_apps = list(apps_payload.get("apps") or [])
        digest = hashlib.sha1(
            json.dumps(source_apps, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:16]
        if self._links_catalog_cache and self._links_catalog_cache[0] == digest:
            return self._links_catalog_cache[1], f'W/"{digest}"'

        rows: list[dict[str, object]] = []
        for item in source_apps:
            if not isinstance(item, dict) or not bool(item.get("connectable")):
                continue
            slug = str(item.get("slug") or "").strip()
            name = str(item.get("name") or slug).strip()
            if not slug:
                continue
            auth_schemes = [str(value).strip().upper() for value in list(item.get("auth_schemes") or []) if str(value).strip()]
            managed_auth_schemes = [
                str(value).strip().upper()
                for value in list(item.get("managed_auth_schemes") or [])
                if str(value).strip()
            ]
            rows.append(
                {
                    "slug": slug,
                    "name": name,
                    "logo": str(item.get("logo") or ""),
                    "auth_schemes": auth_schemes,
                    "managed_auth_schemes": managed_auth_schemes,
                    "auth_label": _links_auth_label(managed_auth_schemes, auth_schemes),
                }
            )
        rows.sort(key=lambda row: str(row["name"]).lower())
        generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        payload = {
            "ok": True,
            "schema": "pucky.links_catalog.v1",
            "apps": rows,
            "total": len(rows),
            "generated_at": generated_at,
            "catalog_version": digest,
        }
        self._links_catalog_cache = (digest, payload)
        return payload, f'W/"{digest}"'

    def links_catalog(self, token: str, *, allow_default_user: bool = False) -> tuple[dict[str, object], dict[str, str]]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}, {}
        self._resolve_links_read_user(token, allow_default_user=allow_default_user)
        payload, etag = self._links_catalog_snapshot()
        return payload, {
            "Cache-Control": "private, max-age=600",
            "ETag": etag,
        }

    def links_all_apps(
        self,
        token: str,
        *,
        query: str = "",
        offset: int = 0,
        limit: int = 60,
        allow_default_user: bool = False,
    ) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        user_id = self._resolve_links_read_user(token, allow_default_user=allow_default_user)
        catalog_payload, _ = self._links_catalog_snapshot()
        my_payload = self.links_my_apps(token, allow_default_user=allow_default_user)
        rows = []
        my_counts = {
            str(item.get("slug") or "").strip().lower(): item
            for item in list(my_payload.get("apps") or [])
            if isinstance(item, dict) and str(item.get("slug") or "").strip()
        }
        needle = str(query or "").strip().lower()
        for item in list(catalog_payload.get("apps") or []):
            if not isinstance(item, dict):
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
                    "auth_schemes": list(item.get("auth_schemes") or []),
                    "managed_auth_schemes": list(item.get("managed_auth_schemes") or []),
                    "auth_label": str(item.get("auth_label") or ""),
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

    def links_app_details(self, token: str, slug: str, *, allow_default_user: bool = False) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        key = str(slug or "").strip().lower()
        if not key:
            raise ValueError("slug_required")
        my_payload = self.links_my_apps(token, allow_default_user=allow_default_user)
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

    def card_icons(self) -> dict[str, object]:
        return {
            "schema": "pucky.card_icon_registry.v1",
            "icons": list(self._load_card_icons().values()),
        }

    def upsert_card_icon(self, payload: dict[str, object]) -> dict[str, object]:
        icon = _normalize_card_icon_record(payload)
        with self._card_icon_lock:
            registry = self._load_runtime_card_icons_locked()
            registry[icon["name"]] = icon
            self._persist_runtime_card_icons_locked(registry)
        return {
            "schema": "pucky.card_icon_upsert.v1",
            "ok": True,
            "icon": icon,
            "icons": list(self._load_card_icons().values()),
        }

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

    def artifact(self, artifact_id: str) -> dict[str, object] | None:
        return self.feed.get_artifact(artifact_id)

    def media_manifest(self, *, scopes: list[str] | tuple[str, ...], limit: int = 50, base_url: str = "") -> dict[str, object]:
        safe_limit = max(1, min(100, int(limit or 50)))
        clean_scopes = [
            scope
            for scope in (str(item or "").strip().lower() for item in scopes)
            if scope in {"meetings", "feed"}
        ]
        if not clean_scopes:
            clean_scopes = ["meetings", "feed"]
        root = str(base_url or "").rstrip("/")
        items: list[dict[str, object]] = []

        for scope in clean_scopes:
            if len(items) >= safe_limit:
                break
            if scope == "meetings":
                items.extend(self._meeting_media_manifest_items(root, safe_limit - len(items)))
            elif scope == "feed":
                items.extend(self._feed_media_manifest_items(root, safe_limit - len(items)))

        return {
            "schema": "pucky.media_manifest.v1",
            "ok": True,
            "scopes": clean_scopes,
            "limit": safe_limit,
            "count": len(items),
            "items": items[:safe_limit],
        }

    def _meeting_media_manifest_items(self, base_url: str, limit: int) -> list[dict[str, object]]:
        out: list[dict[str, object]] = []
        for meeting in sorted(
            self._load_meetings(),
            key=lambda item: str(item.get("updated_at") or item.get("stopped_at") or item.get("started_at") or ""),
            reverse=True,
        ):
            if len(out) >= limit:
                break
            meeting_id = _safe_meeting_id(meeting.get("meeting_id"))
            if not meeting_id:
                continue
            audio_path = self._meeting_audio_artifact_path(meeting)
            if audio_path is None:
                continue
            body = audio_path.read_bytes()
            title = str(meeting.get("recording_title") or meeting.get("title") or "Meeting Audio").strip()
            out.append(
                {
                    "media_id": f"meeting:{meeting_id}:audio",
                    "owner_type": "meeting",
                    "owner_id": meeting_id,
                    "kind": "audio",
                    "title": title or "Meeting Audio",
                    "url": f"{base_url}/api/meetings/{quote(meeting_id, safe='')}/audio" if base_url else f"/api/meetings/{quote(meeting_id, safe='')}/audio",
                    "mime_type": str(meeting.get("mime_type") or "audio/mp4"),
                    "bytes": len(body),
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "updated_at": str(meeting.get("updated_at") or meeting.get("stopped_at") or meeting.get("started_at") or ""),
                }
            )
        return out

    def _feed_media_manifest_items(self, base_url: str, limit: int) -> list[dict[str, object]]:
        out: list[dict[str, object]] = []
        for artifact in self.feed.list_media_artifacts(limit):
            if len(out) >= limit:
                break
            artifact_id = str(artifact.get("artifact_id") or "").strip()
            if not artifact_id:
                continue
            try:
                body = base64.b64decode(str(artifact.get("content_base64") or ""), validate=True)
            except Exception:
                continue
            out.append(
                {
                    "media_id": f"feed:{artifact_id}",
                    "owner_type": "feed",
                    "owner_id": str(artifact.get("card_id") or ""),
                    "kind": str(artifact.get("kind") or "artifact"),
                    "title": str(artifact.get("title") or artifact_id),
                    "url": f"{base_url}/api/artifacts/{quote(artifact_id, safe='')}" if base_url else f"/api/artifacts/{quote(artifact_id, safe='')}",
                    "mime_type": str(artifact.get("mime_type") or "application/octet-stream"),
                    "bytes": len(body),
                    "sha256": hashlib.sha256(body).hexdigest(),
                    "updated_at": str(artifact.get("updated_at") or ""),
                }
            )
        return out

    def meetings_list(self, *, include_archived: bool = False, compact: bool = False) -> dict[str, object]:
        meetings = [
            self._normalize_meeting_for_client(item, compact=compact)
            for item in self._load_meetings()
            if include_archived or not bool(item.get("archived"))
        ]
        return {
            "schema": "pucky.meetings.v1",
            "ok": True,
            "compact": compact,
            "include_archived": include_archived,
            "count": len(meetings),
            "meetings": meetings,
        }

    def meeting_detail(self, meeting_id: str) -> dict[str, object]:
        clean_id = _safe_meeting_id(meeting_id)
        if not clean_id:
            raise KeyError(meeting_id)
        for meeting in self._load_meetings():
            if str(meeting.get("meeting_id") or "") == clean_id:
                return {
                    "schema": "pucky.meeting_detail.v1",
                    "ok": True,
                    "meeting": self._normalize_meeting_for_client(meeting, compact=False),
                }
        raise KeyError(meeting_id)

    def meeting_action(self, client_action_id: str, meeting_id: str, action: str) -> dict[str, object]:
        clean_action = str(action or "").strip().lower()
        if clean_action != "archive":
            raise ValueError("meeting action must be archive")
        clean_id = _safe_meeting_id(meeting_id)
        if not clean_id:
            raise KeyError(meeting_id)
        for meeting in self._load_meetings():
            if str(meeting.get("meeting_id") or "") == clean_id:
                updated = dict(meeting)
                updated["archived"] = True
                updated["updated_at"] = _iso_time(time.time())
                if client_action_id:
                    updated["last_action_id"] = str(client_action_id)
                self._upsert_meeting(updated)
                return {
                    "schema": "pucky.meeting_action_result.v1",
                    "ok": True,
                    "action": clean_action,
                    "meeting": self._normalize_meeting_for_client(updated, compact=False),
                    "meetings": self.meetings_list(compact=True),
                }
        raise KeyError(meeting_id)

    def meeting_audio(self, meeting_id: str) -> tuple[bytes, str, str] | None:
        clean_id = _safe_meeting_id(meeting_id)
        for meeting in self._load_meetings():
            if str(meeting.get("meeting_id") or "") != clean_id:
                continue
            path = self._meeting_audio_artifact_path(meeting)
            if path is not None:
                return path.read_bytes(), str(meeting.get("mime_type") or "audio/mp4"), path.name
        return None

    def _meeting_audio_artifact_path(self, record: dict[str, object]) -> Path | None:
        meeting_id = _safe_meeting_id(record.get("meeting_id"))
        latest = self._meeting_record_by_id(meeting_id) if meeting_id else None
        direct = Path(str(record.get("audio_path") or ""))
        latest_path = Path(str(latest.get("audio_path") or "")) if isinstance(latest, dict) else Path()
        suffix = direct.suffix or latest_path.suffix or (".wav" if "wav" in str(record.get("mime_type") or "").lower() else ".m4a")
        candidates: list[Path] = []
        for path in (direct, latest_path):
            if str(path).strip():
                candidates.append(path)
        if self._meetings_dir.exists():
            canonical_basename = str(record.get("canonical_basename") or "").strip()
            if not canonical_basename and meeting_id:
                canonical_basename = _meeting_canonical_basename(
                    record,
                    str(record.get("recording_title") or record.get("title") or "Meeting Recording"),
                )
            search_patterns: list[str] = []
            if canonical_basename:
                search_patterns.append(f"{canonical_basename}*{suffix}")
            if meeting_id:
                search_patterns.append(f"{meeting_id}*{suffix}")
            for pattern in search_patterns:
                matches = sorted(
                    self._meetings_dir.glob(pattern),
                    key=lambda path: path.stat().st_mtime,
                    reverse=True,
                )
                candidates.extend(matches)
        seen: set[str] = set()
        for candidate in candidates:
            key = str(candidate)
            if not key or key in seen:
                continue
            seen.add(key)
            if candidate.is_file():
                record["audio_path"] = str(candidate)
                if isinstance(latest, dict):
                    latest["audio_path"] = str(candidate)
                return candidate
        return None

    def meeting_deepgram_transcribe_tool(
        self,
        payload: dict[str, object],
        *,
        thread_id: str = "",
        turn_id: str = "",
    ) -> dict[str, object]:
        meeting_id = _safe_meeting_id(payload.get("meeting_id"))
        if not meeting_id:
            return {
                "ok": False,
                "schema": "pucky.meeting_deepgram_transcribe.v1",
                "error": "meeting_id_required",
            }
        record = self._meeting_record_by_id(meeting_id)
        if not isinstance(record, dict):
            return {
                "ok": False,
                "schema": "pucky.meeting_deepgram_transcribe.v1",
                "meeting_id": meeting_id,
                "error": "meeting_not_found",
            }
        audio_path = Path(str(record.get("audio_path") or ""))
        if not audio_path.is_file():
            return {
                "ok": False,
                "schema": "pucky.meeting_deepgram_transcribe.v1",
                "meeting_id": meeting_id,
                "error": "meeting_audio_missing",
            }
        mime_type = str(record.get("mime_type") or "application/octet-stream")
        try:
            result = self.stt.transcribe_with_metadata(audio_path.read_bytes(), mime_type)
        except Exception as exc:
            now = _iso_time(time.time())
            agent = self._persist_meeting_agent_state(
                meeting_id,
                {
                    "label": "Meeting Mode Agent",
                    "transcription_owner": "meeting_agent_tool",
                    "transcription_tool": "meeting_deepgram_transcribe",
                    "last_meeting_tool_name": "meeting_deepgram_transcribe",
                    "last_meeting_tool_at": now,
                    "last_meeting_tool_call_at": now,
                    "last_meeting_tool_thread_id": thread_id,
                    "last_meeting_tool_turn_id": turn_id,
                    "last_tool_error": str(exc),
                },
            )
            return {
                "ok": False,
                "schema": "pucky.meeting_deepgram_transcribe.v1",
                "meeting_id": meeting_id,
                "error": str(exc),
                "agent": agent,
            }
        transcript_text = str(result.get("transcript") or "").strip()
        speaker_turns = _normalize_meeting_speaker_turns(result.get("speaker_turns"), {})
        attachment_text = _canonical_meeting_transcript_text(
            transcript_text=transcript_text,
            speaker_turns=speaker_turns,
        )
        now = _iso_time(time.time())
        agent = self._persist_meeting_agent_state(
            meeting_id,
            {
                "label": "Meeting Mode Agent",
                "transcription_owner": "meeting_agent_tool",
                "transcription_tool": "meeting_deepgram_transcribe",
                "transcription_provider": str(result.get("provider") or "deepgram"),
                "transcription_model": str(result.get("model") or getattr(self.stt, "model", "")),
                "diarization_requested": bool(result.get("diarization_requested", True)),
                "diarization_status": _meeting_diarization_status_from_text(attachment_text, speaker_turns),
                "tool_transcript_chars": len(transcript_text),
                "tool_transcript_attachment_chars": len(attachment_text),
                "transcript_attachment_present": True,
                "transcript_attachment_chars": len(attachment_text),
                "tool_speaker_turn_count": len(speaker_turns),
                "last_meeting_tool_name": "meeting_deepgram_transcribe",
                "last_meeting_tool_at": now,
                "last_meeting_tool_call_at": now,
                "last_meeting_tool_thread_id": thread_id,
                "last_meeting_tool_turn_id": turn_id,
                "last_tool_error": "",
            },
        )
        record["tool_transcript_text"] = transcript_text
        record["tool_transcript_attachment_text"] = attachment_text
        record["tool_speaker_turns"] = speaker_turns
        record["updated_at"] = now
        _run_staged_operation(
            "meeting_index_write",
            lambda: self._upsert_meeting(record),
            sqlite_retry=True,
        )
        return {
            "ok": True,
            "schema": "pucky.meeting_deepgram_transcribe.v1",
            "meeting_id": meeting_id,
            "provider": str(result.get("provider") or "deepgram"),
            "model": str(result.get("model") or getattr(self.stt, "model", "")),
            "diarization_requested": bool(result.get("diarization_requested", True)),
            "diarization_status": _meeting_diarization_status_from_text(attachment_text, speaker_turns),
            "transcript": transcript_text,
            "transcript_chars": len(transcript_text),
            "speaker_turns": speaker_turns,
            "transcript_attachment_text": attachment_text,
            "audio_path": str(audio_path),
            "mime_type": mime_type,
            "agent": agent,
        }

    def meeting_record_update_tool(
        self,
        payload: dict[str, object],
        *,
        thread_id: str = "",
        turn_id: str = "",
    ) -> dict[str, object]:
        meeting_id = _safe_meeting_id(payload.get("meeting_id"))
        if not meeting_id:
            return {
                "ok": False,
                "schema": "pucky.meeting_record_update.v1",
                "error": "meeting_id_required",
            }
        record = self._meeting_record_by_id(meeting_id)
        if not isinstance(record, dict):
            return {
                "ok": False,
                "schema": "pucky.meeting_record_update.v1",
                "meeting_id": meeting_id,
                "error": "meeting_not_found",
            }
        current_item = self.feed.get_item(str(record.get("card_id") or "")) if str(record.get("card_id") or "").strip() else None
        feed_item = current_item if isinstance(current_item, dict) else (record.get("feed_item") if isinstance(record.get("feed_item"), dict) else {})
        title = str(payload.get("title") or "").strip()
        recording_title = str(payload.get("recording_title") or "").strip()
        summary_html = str(payload.get("summary_html") or "").strip()
        transcript_override = str(payload.get("transcript_text") or "").replace("\r\n", "\n").strip()
        speaker_turns_payload = payload.get("speaker_turns")
        speaker_labels = _normalize_meeting_speaker_labels(record.get("speaker_labels"))
        incoming_turns = _normalize_meeting_speaker_turns(speaker_turns_payload, speaker_labels) if isinstance(speaker_turns_payload, list) else []
        existing_turns = _normalize_meeting_speaker_turns(record.get("speaker_turns"), speaker_labels)
        transcript_text = transcript_override or str(record.get("transcript_text") or "").strip()
        speaker_turns = incoming_turns or existing_turns
        canonical_transcript = _canonical_meeting_transcript_text(
            transcript_text=transcript_text,
            speaker_turns=speaker_turns,
        )
        if title:
            record["title"] = title
        if recording_title:
            record["recording_title"] = recording_title
            record["recording_title_source"] = "meeting_record_update"
        elif title and not str(record.get("recording_title") or "").strip():
            record["recording_title"] = title
            record["recording_title_source"] = "meeting_record_update_title_fallback"
        canonical_basename = _meeting_canonical_basename(
            record,
            str(record.get("recording_title") or record.get("title") or "Meeting Recording"),
        )
        record["canonical_basename"] = canonical_basename
        self._apply_meeting_basename_sync(record, canonical_basename, owner="meeting_record_update", rename_transcript=True)
        transcript_artifact_id = f"pucky_card_{meeting_id}:meeting_transcript"
        transcript_html_artifact_id = f"pucky_card_{meeting_id}:meeting_transcript_html"
        summary_artifact_id = f"pucky_card_{meeting_id}:html"
        transcript_href = self.meeting_artifact_signed_url(transcript_html_artifact_id)
        transcript_plain_href = self.meeting_artifact_signed_url(transcript_artifact_id)
        audio_href = self.meeting_audio_signed_url(meeting_id)
        if canonical_transcript:
            transcript_path = str(
                self._write_meeting_text_artifact(meeting_id, canonical_basename, "transcript.txt", canonical_transcript)
            )
            transcript_html_path = str(
                self._write_meeting_text_artifact(
                    meeting_id,
                    canonical_basename,
                    "transcript.html",
                    _meeting_transcript_html_document(record, canonical_transcript),
                )
            )
            previous = Path(str(record.get("transcript_path") or ""))
            if previous.is_file() and previous != Path(transcript_path):
                try:
                    previous.unlink()
                except Exception:
                    pass
            previous_html = Path(str(record.get("transcript_html_path") or ""))
            if previous_html.is_file() and previous_html != Path(transcript_html_path):
                try:
                    previous_html.unlink()
                except Exception:
                    pass
            record["transcript_path"] = transcript_path
            record["transcript_html_path"] = transcript_html_path
            record["transcript_text"] = canonical_transcript
            record["transcript_status"] = "completed"
            record["transcript_error"] = ""
            record["transcript_result"] = {
                "schema": "pucky.meeting_transcript_attachment.v1",
                "title": "Transcript (Plain Text)",
                "kind": "text",
                "html_title": "Transcript",
                "diarization_status": _meeting_diarization_status_from_text(canonical_transcript, speaker_turns),
            }
            record["diarization_requested"] = True
            record["diarization_status"] = _meeting_diarization_status_from_text(canonical_transcript, speaker_turns)
            record["speaker_turns"] = speaker_turns
            record["speaker_labels"] = {
                str(item.get("speaker") or "").strip(): str(item.get("speaker") or "").strip()
                for item in speaker_turns
                if str(item.get("speaker") or "").strip()
            }
        transcript_messages = self._updated_meeting_transcript_messages(
            feed_item,
            record=record,
            meeting_id=meeting_id,
            canonical_basename=canonical_basename,
            transcript_text=canonical_transcript,
            transcript_path=str(record.get("transcript_path") or ""),
            transcript_html_path=str(record.get("transcript_html_path") or ""),
        )
        html_base64 = str(feed_item.get("html_base64") or "")
        if summary_html:
            finalized_summary_html = _meeting_summary_html_with_vm_links(summary_html, transcript_href, audio_href)
            html_base64 = base64.b64encode(finalized_summary_html.encode("utf-8")).decode("ascii")
        if isinstance(feed_item, dict) and str(record.get("card_id") or "").strip():
            assistant_audio_b64 = str(feed_item.get("audio_base64") or "")
            request_audio_b64 = ""
            audio_path = Path(str(record.get("audio_path") or ""))
            if audio_path.is_file():
                request_audio_b64 = base64.b64encode(audio_path.read_bytes()).decode("ascii")
            updated_item = self.feed.upsert_turn_result(
                turn_id=meeting_id,
                session_id=meeting_id,
                reply_mode=str(feed_item.get("reply_mode") or REPLY_MODE_CARD_ONLY),
                reply_text=str(feed_item.get("summary") or record.get("summary") or ""),
                title=str(record.get("title") or feed_item.get("title") or "Meeting"),
                summary=str(feed_item.get("summary") or record.get("summary") or ""),
                icon=str(feed_item.get("icon") or "mic"),
                origin=feed_item.get("origin") if isinstance(feed_item.get("origin"), dict) else {},
                telemetry=feed_item.get("telemetry") if isinstance(feed_item.get("telemetry"), dict) else {},
                transcript_messages=transcript_messages,
                request_audio_mime_type=str(record.get("mime_type") or "audio/mp4"),
                request_audio_base64=request_audio_b64,
                audio_mime_type=str(feed_item.get("audio_mime_type") or "audio/wav"),
                audio_base64=assistant_audio_b64,
                html_mime_type="text/html" if html_base64 else "",
                html_base64=html_base64,
            )
            record["feed_item"] = self._decorate_feed_item(updated_item)
            record["card"] = record["feed_item"].get("card") if isinstance(record["feed_item"].get("card"), dict) else {}
        now = _iso_time(time.time())
        agent = self._persist_meeting_agent_state(
            meeting_id,
            {
                "label": "Meeting Mode Agent",
                "last_meeting_tool_name": "meeting_record_update",
                "last_meeting_tool_at": now,
                "last_meeting_tool_call_at": now,
                "last_meeting_tool_thread_id": thread_id,
                "last_meeting_tool_turn_id": turn_id,
                "title_quality": _meeting_title_quality(record.get("title"), meeting_id),
                "recording_title": str(record.get("recording_title") or ""),
                "recording_title_source": str(record.get("recording_title_source") or ""),
                "recording_title_quality": _meeting_title_quality(record.get("recording_title"), meeting_id),
                "diarization_requested": True,
                "transcript_attachment_present": True,
                "transcript_attachment_chars": len(canonical_transcript),
            },
        )
        record["updated_at"] = now
        record["agent"] = agent
        self._apply_meeting_agent_state_to_feed_item(record)
        self._upsert_meeting(record)
        return {
            "ok": True,
            "schema": "pucky.meeting_record_update.v1",
            "meeting_id": meeting_id,
            "meeting": self._normalize_meeting_for_client(record, compact=False),
            "agent": agent,
        }

    def meeting_ingest(self, payload: dict[str, object], *, base_url: str = "") -> dict[str, object]:
        meeting_id = _safe_meeting_id(payload.get("meeting_id"))
        if not meeting_id:
            raise ValueError("meeting_id_required")
        mime_type = str(payload.get("mime_type") or "audio/mp4").strip() or "audio/mp4"
        audio_b64 = str(payload.get("audio_base64") or "").strip()
        if not audio_b64:
            raise ValueError("audio_base64_required")
        audio = base64.b64decode(audio_b64)
        if not audio:
            raise ValueError("audio_empty")
        if len(audio) > self.config.max_audio_bytes:
            raise ValueError("audio_too_large")

        self._meetings_dir.mkdir(parents=True, exist_ok=True)
        extension = ".wav" if "wav" in mime_type.lower() else ".m4a"
        audio_path = self._meetings_dir / f"{meeting_id}{extension}"
        audio_path.write_bytes(audio)
        audio_url = f"{base_url.rstrip('/')}/api/meetings/{quote(meeting_id, safe='')}/audio" if base_url else ""

        now = _iso_time(time.time())
        record: dict[str, object] = {
            "schema": "pucky.meeting.v1",
            "meeting_id": meeting_id,
            "state": "processing",
            "created_at": now,
            "updated_at": now,
            "started_at": str(payload.get("started_at") or ""),
            "stopped_at": str(payload.get("stopped_at") or ""),
            "duration_ms": int(payload.get("duration_ms") or 0),
            "device_id": str(payload.get("device_id") or ""),
            "device_path": str(payload.get("device_path") or ""),
            "mime_type": mime_type,
            "audio_bytes": len(audio),
            "audio_path": str(audio_path),
            "audio_url": audio_url,
            "metadata": {key: value for key, value in payload.items() if key != "audio_base64"},
            "transcript_status": "pending",
            "transcript_error": "",
            "transcript_text": "",
            "transcript_result": {},
            "diarization_requested": True,
            "diarization_status": "pending",
            "speaker_turns": [],
            "agent": {
                "label": "Meeting Mode Agent",
                "transcription_owner": "meeting_agent",
                "basename_sync_status": "pending",
            },
            "archived": False,
            "failure_stage": "",
        }
        _run_staged_operation(
            "meeting_index_write",
            lambda: self._upsert_meeting(record),
            sqlite_retry=True,
        )
        placeholder = _run_staged_operation(
            "meeting_processing_card_upsert",
            lambda: self._upsert_meeting_processing_card(record, audio, mime_type),
            sqlite_retry=True,
        )
        record["card_id"] = str(placeholder.get("card_id") or "")
        record["card"] = placeholder.get("card") if isinstance(placeholder.get("card"), dict) else {}
        record["feed_item"] = placeholder
        _run_staged_operation(
            "meeting_index_write",
            lambda: self._upsert_meeting(record),
            sqlite_retry=True,
        )
        threading.Thread(
            target=self._process_meeting_record,
            args=(dict(record), audio, mime_type),
            name=f"pucky-meeting-{meeting_id}",
            daemon=True,
        ).start()
        return {
            "schema": "pucky.meeting_ingest.v1",
            "ok": True,
            "state": "processing",
            "meeting_id": meeting_id,
            "audio_path": str(audio_path),
            "audio_bytes": len(audio),
            "meeting": record,
            "card": record.get("card") if isinstance(record.get("card"), dict) else {},
            "agent": {},
        }

    def _upsert_meeting_processing_card(
        self,
        record: dict[str, object],
        audio: bytes,
        mime_type: str,
    ) -> dict[str, object]:
        meeting_id = str(record.get("meeting_id") or "")
        title = "Processing meeting recording"
        summary = "Transcribing, diarizing, and checking for follow-up instructions..."
        origin = _normalize_origin(
            {
                "runtime": "pucky",
                "thread_id": meeting_id,
                "source": "meeting_recording",
                "meeting_id": meeting_id,
                "card_kind": "meeting_processing",
                "meeting_state": "processing",
            },
            meeting_id,
        )
        telemetry = {
            "event": "pucky.meeting.processing_placeholder",
            "status": "processing",
            "stage": "meeting_agent_queued",
            "meeting_id": meeting_id,
            "request_audio_bytes": len(audio),
            "content_type": mime_type,
        }
        item = self.feed.upsert_turn_result(
            turn_id=meeting_id,
            session_id=meeting_id,
            reply_mode=REPLY_MODE_CARD_ONLY,
            reply_text=summary,
            title=title,
            summary=summary,
            icon="mic",
            origin=origin,
            telemetry=telemetry,
            transcript_messages=[
                _user_transcript_message(
                    text="Meeting recording uploaded for processing.",
                    created_at=str(record.get("created_at") or _iso_time(time.time())),
                    turn_id=meeting_id,
                    request_audio_mime_type=mime_type,
                    has_request_audio=True,
                    request_audio_attachment=_meeting_request_audio_attachment(record),
                ),
                _assistant_transcript_message(
                    text=summary,
                    created_at=str(record.get("created_at") or _iso_time(time.time())),
                    attachments=[],
                ),
            ],
            request_audio_mime_type=mime_type,
            request_audio_base64=base64.b64encode(audio).decode("ascii"),
            audio_mime_type="",
            audio_base64="",
            html_mime_type="",
            html_base64="",
        )
        item = self._decorate_feed_item(item)
        item["card"] = {
            "title": title,
            "summary": summary,
            "icon": "mic",
            "accent": item.get("accent") or self._card_icon_accent("mic"),
            "origin": origin,
            "card_kind": "meeting_processing",
            "meeting_state": "processing",
        }
        item["card_kind"] = "meeting_processing"
        item["meeting_state"] = "processing"
        return item

    def _upsert_meeting_missing_result_card(
        self,
        record: dict[str, object],
        audio: bytes,
        mime_type: str,
    ) -> dict[str, object]:
        meeting_id = str(record.get("meeting_id") or "")
        title = "Meeting needs review"
        summary = "The meeting agent replied, but did not return a usable Meeting Transcript attachment yet."
        origin = _normalize_origin(
            {
                "runtime": "pucky",
                "thread_id": meeting_id,
                "source": "meeting_recording",
                "meeting_id": meeting_id,
            },
            meeting_id,
        )
        item = self.feed.upsert_turn_result(
            turn_id=meeting_id,
            session_id=meeting_id,
            reply_mode=REPLY_MODE_CARD_ONLY,
            reply_text=summary,
            title=title,
            summary=summary,
            icon="mic",
            origin=origin,
            telemetry={
                "event": "pucky.meeting.missing_agent_result",
                "status": "blocked",
                "stage": "meeting_transcript_validation",
                "meeting_id": meeting_id,
            },
            transcript_messages=[
                _user_transcript_message(
                    text="Meeting recording",
                    created_at=str(record.get("created_at") or _iso_time(time.time())),
                    turn_id=meeting_id,
                    request_audio_mime_type=mime_type,
                    has_request_audio=True,
                    request_audio_attachment=_meeting_request_audio_attachment(record),
                ),
                _assistant_transcript_message(
                    text=summary,
                    created_at=_iso_time(time.time()),
                    attachments=[],
                ),
            ],
            request_audio_mime_type=mime_type,
            request_audio_base64=base64.b64encode(audio).decode("ascii"),
            audio_mime_type="",
            audio_base64="",
            html_mime_type="",
            html_base64="",
            force_unread=True,
        )
        item = self._decorate_feed_item(item)
        item["card"] = {
            "title": title,
            "summary": summary,
            "icon": "mic",
            "accent": item.get("accent") or self._card_icon_accent("mic"),
            "origin": origin,
        }
        return item

    def _upsert_meeting_failed_card(
        self,
        record: dict[str, object],
        audio: bytes,
        mime_type: str,
    ) -> dict[str, object]:
        meeting_id = str(record.get("meeting_id") or "")
        card = self._meeting_failed_card_payload(record)
        summary = str(card.get("summary") or "Processing stopped.")
        origin = dict(card.get("origin") or {})
        failure_stage = str(card.get("failure_stage") or "")
        item = self.feed.upsert_turn_result(
            turn_id=meeting_id,
            session_id=meeting_id,
            reply_mode=REPLY_MODE_CARD_ONLY,
            reply_text=summary,
            title=str(card.get("title") or "Meeting processing failed"),
            summary=summary,
            icon=str(card.get("icon") or "mic"),
            origin=origin,
            telemetry={
                "event": "pucky.meeting.agent_failed",
                "status": "failed",
                "stage": "meeting_agent_failed",
                "meeting_id": meeting_id,
                "failure_reason": str(record.get("failure_reason") or ""),
                "failure_stage": failure_stage,
                "request_audio_bytes": len(audio),
                "content_type": mime_type,
            },
            transcript_messages=[
                _user_transcript_message(
                    text="Meeting recording",
                    created_at=str(record.get("created_at") or _iso_time(time.time())),
                    turn_id=meeting_id,
                    request_audio_mime_type=mime_type,
                    has_request_audio=True,
                    request_audio_attachment=_meeting_request_audio_attachment(record),
                ),
                _assistant_transcript_message(
                    text=summary,
                    created_at=_iso_time(time.time()),
                    attachments=[],
                ),
            ],
            request_audio_mime_type=mime_type,
            request_audio_base64=base64.b64encode(audio).decode("ascii"),
            audio_mime_type="",
            audio_base64="",
            html_mime_type="",
            html_base64="",
            force_unread=True,
        )
        item = self._decorate_feed_item(item)
        item["card"] = dict(card)
        item["card_kind"] = "meeting_failed"
        item["meeting_state"] = "failed"
        item["failure_stage"] = failure_stage
        return item

    def _process_meeting_record(self, record: dict[str, object], audio: bytes, mime_type: str) -> None:
        record["updated_at"] = _iso_time(time.time())
        record["transcript_status"] = "agent_pending"
        record["transcript_error"] = ""
        record["transcript_text"] = ""
        record["transcript_result"] = {}
        record["diarization_requested"] = True
        record["diarization_status"] = "agent_pending"
        record["speaker_turns"] = []
        record["failure_stage"] = ""
        _run_staged_operation(
            "meeting_index_write",
            lambda: self._upsert_meeting(record),
            sqlite_retry=True,
        )

        prompt = _meeting_agent_handoff_prompt(record)
        total_start = time.perf_counter()
        meeting_id = str(record.get("meeting_id") or "")
        telemetry: dict[str, object] = {
            "event": "pucky.meeting.agent_handoff",
            "session_id": meeting_id,
            "turn_id": meeting_id,
            "content_type": mime_type,
            "request_audio_bytes": len(audio),
            "reply_mode": REPLY_MODE_CARD_ONLY,
            "transcription_owner": "meeting_agent",
            "tts_provider": "deepinfra",
            "tts_model": getattr(self.tts, "model", ""),
            "tts_voice": getattr(self.tts, "voice", ""),
            "tts_format": getattr(self.tts, "response_format", ""),
            "tts_speed": getattr(self.tts, "speed", ""),
            "stage": "codex_running",
            "transcript_chars": len(prompt),
            "user_transcript": prompt,
        }
        telemetry.update(_normalize_thread_request(mode="", thread_id="", source="meeting_recording", card_id=""))
        try:
            result = self._handle_transcript_turn(
                turn_id=meeting_id,
                session_id=meeting_id,
                reply_mode=REPLY_MODE_CARD_ONLY,
                transcript=prompt,
                telemetry=telemetry,
                total_start=total_start,
                request_audio_mime_type=mime_type,
                request_audio_base64=base64.b64encode(audio).decode("ascii"),
                request_audio_attachment=_meeting_request_audio_attachment(record),
                output_schema=meeting_reply_output_schema(),
                developer_instructions=self.config.meeting_developer_instructions or self.config.developer_instructions,
                display_transcript_text="Meeting recording",
                force_unread=True,
                codex_client=self.meeting_codex,
                attachment_builder=lambda envelope: self._prepare_meeting_reply_attachments(
                    meeting_id=meeting_id,
                    record=record,
                    envelope=envelope,
                ),
                codex_stage="meeting_agent_call",
                feed_persist_stage="feed_persist",
            )
            record["state"] = "completed"
            record["updated_at"] = _iso_time(time.time())
            record["card_id"] = str(result.get("card_id") or "")
            record["card"] = result.get("card") if isinstance(result.get("card"), dict) else {}
            record["feed_item"] = result
            record["failure_reason"] = ""
            record["failure_stage"] = ""
            self._apply_meeting_agent_reply(record, result)
            self._apply_meeting_agent_state(record)
            self._apply_meeting_agent_state_to_feed_item(record)
            if record.get("transcript_status") == "missing_transcript_attachment":
                record["state"] = "completed_with_missing_result"
                record["failure_reason"] = "meeting_agent_missing_transcript_attachment"
                record["failure_stage"] = "meeting_transcript_validation"
                blocker = _run_staged_operation(
                    "meeting_missing_result_card_upsert",
                    lambda: self._upsert_meeting_missing_result_card(record, audio, mime_type),
                    sqlite_retry=True,
                )
                record["card_id"] = str(blocker.get("card_id") or "")
                record["card"] = blocker.get("card") if isinstance(blocker.get("card"), dict) else {}
                record["feed_item"] = blocker
        except Exception as exc:
            stage = exc.stage if isinstance(exc, _StagedOperationError) else "meeting_agent_call"
            root = exc.original if isinstance(exc, _StagedOperationError) else exc
            record["state"] = "failed"
            record["updated_at"] = _iso_time(time.time())
            record["failure_stage"] = str(stage or "meeting_agent_call")
            record["failure_reason"] = f"{root.__class__.__name__}: {root}"
            record["transcript_status"] = "failed"
            record["transcript_error"] = str(record["failure_reason"])
            record["diarization_status"] = "failed"
            try:
                failed = _run_staged_operation(
                    "meeting_failed_card_upsert",
                    lambda: self._upsert_meeting_failed_card(record, audio, mime_type),
                    sqlite_retry=True,
                )
                record["card_id"] = str(failed.get("card_id") or "")
                record["card"] = failed.get("card") if isinstance(failed.get("card"), dict) else {}
                record["feed_item"] = failed
            except Exception as failed_exc:
                failed_stage = failed_exc.stage if isinstance(failed_exc, _StagedOperationError) else "meeting_failed_card_upsert"
                record["failed_card_error"] = str(
                    failed_exc.original if isinstance(failed_exc, _StagedOperationError) else failed_exc
                )
                record["failed_card_stage"] = str(failed_stage or "meeting_failed_card_upsert")
            result = {}
        self._apply_meeting_agent_state(record)
        self._apply_meeting_agent_state_to_feed_item(record)
        _run_staged_operation(
            "meeting_index_write",
            lambda: self._upsert_meeting(record),
            sqlite_retry=True,
        )

    @staticmethod
    def _apply_meeting_agent_reply(record: dict[str, object], result: dict[str, object]) -> None:
        transcript_attachment = _meeting_transcript_attachment_payload(result)
        if not transcript_attachment:
            transcript_text = str(result.get("transcript_text") or "").replace("\r\n", "\n").strip()
            if transcript_text:
                transcript_attachment = {
                    "title": "Transcript (Plain Text)",
                    "kind": "text",
                    "text": transcript_text,
                }
        if not transcript_attachment:
            transcript_attachment = _meeting_fallback_transcript_attachment(record)
        if not transcript_attachment:
            record["transcript_status"] = "missing_transcript_attachment"
            record["transcript_error"] = "Meeting Transcript attachment missing or empty."
            record["diarization_status"] = "missing_transcript_attachment"
            record["speaker_turns"] = []
            return
        transcript_text = _meeting_transcript_text_from_attachment(transcript_attachment)
        parsed_turns = _parse_meeting_transcript_turns(transcript_text)
        card = result.get("card") if isinstance(result.get("card"), dict) else {}
        title = str(card.get("title") or result.get("title") or record.get("title") or "").strip()
        if title:
            record["title"] = title
        recording_title = str(result.get("recording_title") or record.get("recording_title") or "").strip()
        if recording_title:
            record["recording_title"] = recording_title
        if not str(record.get("recording_title_source") or "").strip():
            record["recording_title_source"] = "agent" if recording_title else "card_title_fallback"
        record["canonical_basename"] = _meeting_canonical_basename(
            record,
            str(record.get("recording_title") or title or record.get("title") or "Meeting Recording"),
        )
        record["transcript_status"] = "completed"
        record["transcript_error"] = ""
        record["transcript_text"] = transcript_text
        record["transcript_result"] = {
            "schema": "pucky.meeting_transcript_attachment.v1",
            "title": "Transcript (Plain Text)",
            "kind": str(transcript_attachment.get("kind") or "text"),
            "diarization_status": _meeting_diarization_status_from_text(transcript_text, parsed_turns),
        }
        record["diarization_requested"] = True
        record["diarization_status"] = _meeting_diarization_status_from_text(transcript_text, parsed_turns)
        record["speaker_turns"] = parsed_turns
        record["speaker_labels"] = {
            str(item.get("speaker") or "").strip(): str(item.get("speaker") or "").strip()
            for item in parsed_turns
            if str(item.get("speaker") or "").strip()
        }
        agent = dict(record.get("agent") or {}) if isinstance(record.get("agent"), dict) else {}
        agent.update(
            {
                "title_quality": _meeting_title_quality(record.get("title"), record.get("meeting_id")),
                "recording_title": str(record.get("recording_title") or ""),
                "recording_title_source": str(record.get("recording_title_source") or ""),
                "recording_title_quality": _meeting_title_quality(record.get("recording_title"), record.get("meeting_id")),
                "diarization_requested": True,
                "transcript_attachment_present": True,
                "transcript_attachment_chars": len(transcript_text),
            }
        )
        record["agent"] = agent

    def _apply_meeting_agent_state_to_feed_item(self, record: dict[str, object]) -> None:
        feed_item = record.get("feed_item")
        if not isinstance(feed_item, dict):
            return
        agent = dict(record.get("agent") or {}) if isinstance(record.get("agent"), dict) else {}
        if not agent:
            return
        telemetry = dict(feed_item.get("telemetry") or {}) if isinstance(feed_item.get("telemetry"), dict) else {}
        for source_key, target_key in (
            ("transcription_provider", "transcription_provider"),
            ("transcription_model", "transcription_model"),
            ("diarization_requested", "meeting_diarization_requested"),
            ("diarization_status", "meeting_diarization_status"),
            ("recording_title", "meeting_recording_title"),
            ("recording_title_source", "meeting_recording_title_source"),
            ("recording_title_quality", "meeting_recording_title_quality"),
            ("transcript_attachment_present", "meeting_transcript_attachment_present"),
            ("transcript_attachment_chars", "meeting_transcript_attachment_chars"),
            ("tool_transcript_chars", "meeting_tool_transcript_chars"),
            ("last_meeting_tool_name", "last_meeting_tool_name"),
            ("last_meeting_tool_at", "last_meeting_tool_at"),
            ("last_meeting_tool_call_at", "last_meeting_tool_call_at"),
            ("basename_sync_status", "basename_sync_status"),
            ("basename_sync_at", "basename_sync_at"),
            ("title_quality", "meeting_title_quality"),
        ):
            value = agent.get(source_key)
            if value not in (None, ""):
                telemetry[target_key] = value
        feed_item["telemetry"] = telemetry

    def _updated_meeting_transcript_messages(
        self,
        feed_item: dict[str, object],
        *,
        record: dict[str, object],
        meeting_id: str,
        canonical_basename: str,
        transcript_text: str,
        transcript_path: str,
        transcript_html_path: str,
    ) -> list[dict[str, object]]:
        messages = [dict(item) for item in list(feed_item.get("transcript_messages") or []) if isinstance(item, dict)]
        assistant = next((item for item in messages if str(item.get("role") or "") == "assistant"), None)
        if assistant is None:
            assistant = _assistant_transcript_message(
                text=str(feed_item.get("summary") or ""),
                created_at=_iso_time(time.time()),
                attachments=[],
            )
            messages.append(assistant)
        attachments = [dict(item) for item in list(assistant.get("attachments") or []) if isinstance(item, dict)]
        transcript_artifact_id = f"pucky_card_{meeting_id}:meeting_transcript"
        transcript_html_artifact_id = f"pucky_card_{meeting_id}:meeting_transcript_html"
        summary_artifact_id = f"pucky_card_{meeting_id}:html"
        transcript_plain_href = self.meeting_artifact_signed_url(transcript_artifact_id)
        transcript_href = self.meeting_artifact_signed_url(transcript_html_artifact_id)
        audio_href = self.meeting_audio_signed_url(meeting_id)
        summary_href = self.meeting_artifact_signed_url(summary_artifact_id)
        for attachment in attachments:
            attachment["meeting_id"] = meeting_id
            attachment["canonical_basename"] = canonical_basename
            attachment["recording_title"] = str(record.get("recording_title") or "")
            title = str(attachment.get("title") or "").strip().lower()
            kind = str(attachment.get("kind") or "").strip().lower()
            if kind == "text" and title in {"meeting transcript", "transcript", "transcript (plain text)"}:
                attachment["title"] = "Transcript (Plain Text)"
                attachment["text"] = transcript_text
                if transcript_path:
                    attachment["path"] = transcript_path
                attachment["artifact"] = transcript_artifact_id
                attachment["src"] = transcript_plain_href
                attachment["url"] = transcript_plain_href
            elif kind == "html" and title in {"meeting transcript html", "transcript"}:
                attachment["title"] = "Transcript"
                if transcript_html_path:
                    attachment["path"] = transcript_html_path
                attachment["artifact"] = transcript_html_artifact_id
                attachment["viewer_artifact"] = transcript_html_artifact_id
                attachment["html_artifact"] = transcript_html_artifact_id
                attachment["viewer_url"] = transcript_href
                attachment["html_url"] = transcript_href
            elif kind == "html" and str(attachment.get("id") or "").strip() == f"{meeting_id}:html":
                attachment["title"] = "Meeting Summary"
                attachment["artifact"] = summary_artifact_id
                attachment["viewer_artifact"] = summary_artifact_id
                attachment["html_artifact"] = summary_artifact_id
                attachment["viewer_url"] = summary_href
                attachment["html_url"] = summary_href
            elif title == "meeting audio":
                audio_path = str(record.get("audio_path") or "").strip()
                if audio_path:
                    attachment["path"] = audio_path
                if audio_href:
                    attachment["src"] = audio_href
                    attachment["url"] = audio_href
        assistant["attachments"] = attachments
        return messages

    def _apply_meeting_basename_sync(
        self,
        record: dict[str, object],
        canonical_basename: str,
        *,
        owner: str,
        rename_transcript: bool = False,
    ) -> None:
        audio_sync = self._rename_meeting_audio_artifact(record, canonical_basename)
        if rename_transcript:
            self._rename_meeting_text_artifact(record, "transcript_path", canonical_basename, "transcript.txt")
            self._rename_meeting_text_artifact(record, "transcript_html_path", canonical_basename, "transcript.html")
        now = _iso_time(time.time())
        agent = dict(record.get("agent") or {}) if isinstance(record.get("agent"), dict) else {}
        agent.update(
            {
                "label": "Meeting Mode Agent",
                "basename_sync_status": str(audio_sync.get("status") or "unchanged"),
                "basename_sync_at": now,
                "basename_sync_owner": owner,
            }
        )
        record["agent"] = agent
        meeting_id = _safe_meeting_id(record.get("meeting_id"))
        if meeting_id:
            self._remember_meeting_agent_state(meeting_id, agent)

    def _prepare_meeting_reply_attachments(
        self,
        *,
        meeting_id: str,
        record: dict[str, object],
        envelope: ReplyEnvelope,
    ) -> tuple[list[dict[str, object]], dict[str, object]]:
        prepared: list[dict[str, object]] = []
        requested_recording_title = str(envelope.recording_title or "").strip()
        existing_recording_title = str(record.get("recording_title") or "").strip()
        if requested_recording_title:
            recording_title = requested_recording_title
            recording_title_source = "agent"
        elif existing_recording_title:
            recording_title = existing_recording_title
            recording_title_source = "existing"
        elif str(envelope.card_title or "").strip():
            recording_title = str(envelope.card_title or "").strip()
            recording_title_source = "card_title_fallback"
        elif str(record.get("title") or "").strip():
            recording_title = str(record.get("title") or "").strip()
            recording_title_source = "existing_title_fallback"
        else:
            recording_title = "Meeting Recording"
            recording_title_source = "default_fallback"
        record["recording_title"] = recording_title
        record["recording_title_source"] = recording_title_source
        canonical_basename = _meeting_canonical_basename(record, recording_title)
        record["canonical_basename"] = canonical_basename
        self._apply_meeting_basename_sync(record, canonical_basename, owner="meeting_agent_recording_title", rename_transcript=False)
        transcript_source = _extract_named_meeting_transcript_attachment(envelope.attachments)
        if not transcript_source:
            transcript_text = str(envelope.transcript_text or "").replace("\r\n", "\n").strip()
            if transcript_text:
                transcript_source = {
                    "title": "Transcript (Plain Text)",
                    "kind": "text",
                    "text": transcript_text,
                }
        if not transcript_source:
            transcript_source = _meeting_fallback_transcript_attachment(record)
        if not transcript_source:
            latest_record = self._meeting_record_by_id(meeting_id)
            if isinstance(latest_record, dict):
                transcript_source = _meeting_fallback_transcript_attachment(latest_record)
                for key in (
                    "tool_transcript_text",
                    "tool_transcript_attachment_text",
                    "tool_speaker_turns",
                    "transcript_text",
                    "speaker_turns",
                    "speaker_labels",
                ):
                    if key not in record and key in latest_record:
                        record[key] = latest_record[key]
        transcript_text = _meeting_transcript_text_from_attachment(transcript_source)
        transcript_path = ""
        transcript_html_path = ""
        transcript_artifact_id = f"pucky_card_{meeting_id}:meeting_transcript"
        transcript_html_artifact_id = f"pucky_card_{meeting_id}:meeting_transcript_html"
        summary_artifact_id = f"pucky_card_{meeting_id}:html"
        transcript_href = self.meeting_artifact_signed_url(transcript_html_artifact_id)
        transcript_plain_href = self.meeting_artifact_signed_url(transcript_artifact_id)
        audio_href = self.meeting_audio_signed_url(meeting_id)
        finalized_summary_html = ""
        if transcript_source:
            transcript_path = str(self._write_meeting_text_artifact(meeting_id, canonical_basename, "transcript.txt", transcript_text))
            record["transcript_path"] = transcript_path
            transcript_html_path = str(
                self._write_meeting_text_artifact(
                    meeting_id,
                    canonical_basename,
                    "transcript.html",
                    _meeting_transcript_html_document(record, transcript_text),
                )
            )
            record["transcript_html_path"] = transcript_html_path
            prepared.append(
                normalize_attachment(
                    {
                        "id": f"{meeting_id}:transcript",
                        "path": transcript_path,
                        "artifact": transcript_artifact_id,
                        "src": transcript_plain_href,
                        "mime_type": "text/plain",
                        "title": "Transcript (Plain Text)",
                        "kind": "text",
                        "text": transcript_text,
                        "meeting_id": meeting_id,
                        "canonical_basename": canonical_basename,
                        "recording_title": recording_title,
                    }
                )
            )
            prepared.append(
                normalize_attachment(
                    {
                        "id": f"{meeting_id}:transcript_html",
                        "path": transcript_html_path,
                        "artifact": transcript_html_artifact_id,
                        "viewer_artifact": transcript_html_artifact_id,
                        "html_artifact": transcript_html_artifact_id,
                        "viewer_url": transcript_href,
                        "html_url": transcript_href,
                        "mime_type": "text/html",
                        "title": "Transcript",
                        "kind": "html",
                        "meeting_id": meeting_id,
                        "canonical_basename": canonical_basename,
                        "recording_title": recording_title,
                        "transcript_path": transcript_path,
                    }
                )
            )
        if envelope.html_content:
            html_title = "Meeting Summary"
            html_artifact = summary_artifact_id
            finalized_summary_html = _meeting_summary_html_with_vm_links(
                envelope.html_content,
                transcript_href,
                audio_href,
            )
            prepared.append(
                normalize_attachment(
                    {
                        "id": f"{meeting_id}:html",
                        "artifact": html_artifact,
                        "viewer_artifact": html_artifact,
                        "html_artifact": html_artifact,
                        "viewer_url": self.meeting_artifact_signed_url(html_artifact),
                        "html_url": self.meeting_artifact_signed_url(html_artifact),
                        "mime_type": "text/html",
                        "title": html_title,
                        "kind": "html",
                        "meeting_id": meeting_id,
                        "canonical_basename": canonical_basename,
                        "recording_title": recording_title,
                        "started_at": str(record.get("started_at") or record.get("created_at") or ""),
                        "mime_type_audio": str(record.get("mime_type") or ""),
                        "transcript_path": transcript_path,
                        "transcript_html_path": transcript_html_path,
                    }
                )
            )
        audio_attachment = _meeting_audio_attachment_payload(record, canonical_basename)
        if audio_attachment:
            if audio_href:
                audio_attachment["src"] = audio_href
                audio_attachment["url"] = audio_href
            prepared.append(
                normalize_attachment(
                    audio_attachment
                )
            )
        return prepared, {
            "fallback_from_reply_text": False,
            "transcript_path": transcript_path,
            "transcript_attachment_present": bool(transcript_source),
            "transcript_html_path": transcript_html_path,
            "transcript_html_attachment_present": bool(transcript_html_path),
            "recording_title": recording_title,
            "recording_title_source": recording_title_source,
            "canonical_basename": canonical_basename,
            "summary_html_content": finalized_summary_html,
        }

    def _write_meeting_text_artifact(self, meeting_id: str, canonical_basename: str, suffix: str, content: str) -> Path:
        self._meetings_dir.mkdir(parents=True, exist_ok=True)
        safe_suffix = re.sub(r"[^A-Za-z0-9._-]+", "-", str(suffix or "artifact.txt")).strip("-") or "artifact.txt"
        stem = canonical_basename or meeting_id
        path = self._meetings_dir / f"{stem}-{safe_suffix}"
        path.write_text(str(content or ""), encoding="utf-8")
        return path

    def _rename_meeting_audio_artifact(self, record: dict[str, object], canonical_basename: str) -> dict[str, object]:
        current = Path(str(record.get("audio_path") or ""))
        if not current.is_file():
            return {"status": "missing_audio", "changed": False, "path": str(current)}
        suffix = current.suffix or (".wav" if "wav" in str(record.get("mime_type") or "").lower() else ".m4a")
        target = current.with_name(f"{canonical_basename}{suffix}")
        if current == target:
            record["audio_path"] = str(current)
            return {"status": "unchanged", "changed": False, "path": str(current)}
        if target.exists():
            short_id = str(record.get("meeting_id") or "").rsplit("-", 1)[-1][:6] or "meeting"
            counter = 0
            while target.exists() and target != current:
                suffix_label = f"-{short_id}" if counter == 0 else f"-{short_id}-{counter}"
                target = current.with_name(f"{canonical_basename}{suffix_label}{suffix}")
                counter += 1
        current.rename(target)
        record["audio_path"] = str(target)
        return {"status": "renamed", "changed": True, "path": str(target)}

    def _rename_meeting_text_artifact(
        self,
        record: dict[str, object],
        key: str,
        canonical_basename: str,
        suffix: str,
    ) -> dict[str, object]:
        current = Path(str(record.get(key) or ""))
        if not current.is_file():
            return {"status": "missing_text_artifact", "changed": False, "path": str(current)}
        safe_suffix = re.sub(r"[^A-Za-z0-9._-]+", "-", str(suffix or "artifact.txt")).strip("-") or "artifact.txt"
        target = current.with_name(f"{canonical_basename}-{safe_suffix}")
        if current == target:
            record[key] = str(current)
            return {"status": "unchanged", "changed": False, "path": str(current)}
        if target.exists():
            short_id = str(record.get("meeting_id") or "").rsplit("-", 1)[-1][:6] or "meeting"
            counter = 0
            while target.exists() and target != current:
                suffix_label = f"-{short_id}" if counter == 0 else f"-{short_id}-{counter}"
                target = current.with_name(f"{canonical_basename}{suffix_label}-{safe_suffix}")
                counter += 1
        current.rename(target)
        record[key] = str(target)
        return {"status": "renamed", "changed": True, "path": str(target)}

    def _load_meetings(self) -> list[dict[str, object]]:
        with self._meetings_lock:
            if not self._meetings_index_path.exists():
                return []
            try:
                payload = json.loads(self._meetings_index_path.read_text(encoding="utf-8"))
            except Exception:
                return []
            rows = payload.get("meetings") if isinstance(payload, dict) else payload
            if not isinstance(rows, list):
                return []
            return [dict(item) for item in rows if isinstance(item, dict)]

    def _meeting_record_by_id(self, meeting_id: str) -> dict[str, object] | None:
        clean_id = _safe_meeting_id(meeting_id)
        if not clean_id:
            return None
        for meeting in self._load_meetings():
            if str(meeting.get("meeting_id") or "") == clean_id:
                return dict(meeting)
        return None

    def _meeting_failed_card_payload(self, meeting: dict[str, object]) -> dict[str, object]:
        meeting_id = str(meeting.get("meeting_id") or "")
        reason = str(meeting.get("failure_reason") or "unknown error").strip()
        failure_stage = str(meeting.get("failure_stage") or "").strip()
        if failure_stage and reason:
            summary = f"Processing stopped during {failure_stage}: {reason}"
        elif reason:
            summary = f"Processing stopped: {reason}"
        else:
            summary = "Processing stopped."
        origin = _normalize_origin(
            {
                "runtime": "pucky",
                "thread_id": meeting_id,
                "source": "meeting_recording",
                "meeting_id": meeting_id,
                "card_kind": "meeting_failed",
                "meeting_state": "failed",
                "failure_stage": failure_stage,
            },
            meeting_id,
        )
        return {
            "title": "Meeting processing failed",
            "summary": summary,
            "icon": "mic",
            "accent": self._card_icon_accent("mic"),
            "origin": origin,
            "card_kind": "meeting_failed",
            "meeting_state": "failed",
            "failure_stage": failure_stage,
        }

    def _normalize_meeting_for_client(self, meeting: dict[str, object], *, compact: bool) -> dict[str, object]:
        normalized = dict(meeting)
        self._apply_meeting_agent_state(normalized)
        card = normalized.get("card") if isinstance(normalized.get("card"), dict) else {}
        if isinstance(card, dict):
            normalized["card"] = dict(card)
        state = str(normalized.get("state") or "uploaded").strip().lower()
        meeting_id = str(normalized.get("meeting_id") or "").strip()
        if state == "failed":
            failed_card = self._meeting_failed_card_payload(normalized)
            normalized["card"] = failed_card
            normalized["card_kind"] = "meeting_failed"
            normalized["meeting_state"] = "failed"
            if meeting_id and not str(normalized.get("card_id") or "").strip():
                normalized["card_id"] = f"pucky_card_{meeting_id}"
            feed_item = normalized.get("feed_item") if isinstance(normalized.get("feed_item"), dict) else None
            if feed_item is not None:
                patched_feed = dict(feed_item)
                patched_feed["card"] = dict(failed_card)
                patched_feed["card_kind"] = "meeting_failed"
                patched_feed["meeting_state"] = "failed"
                origin = patched_feed.get("origin") if isinstance(patched_feed.get("origin"), dict) else {}
                patched_origin = dict(origin) if isinstance(origin, dict) else {}
                patched_origin["card_kind"] = "meeting_failed"
                patched_origin["meeting_state"] = "failed"
                failure_stage = str(failed_card.get("failure_stage") or "").strip()
                if failure_stage:
                    patched_origin["failure_stage"] = failure_stage
                else:
                    patched_origin.pop("failure_stage", None)
                patched_feed["origin"] = patched_origin
                normalized["feed_item"] = patched_feed
        return self._compact_meeting(normalized) if compact else normalized

    @staticmethod
    def _compact_meeting(meeting: dict[str, object]) -> dict[str, object]:
        keep = (
            "schema",
            "meeting_id",
            "state",
            "created_at",
            "updated_at",
            "started_at",
            "stopped_at",
            "duration_ms",
            "device_id",
            "device_path",
            "mime_type",
            "audio_bytes",
            "audio_path",
            "audio_url",
            "title",
            "recording_title",
            "recording_title_source",
            "canonical_basename",
            "transcript_status",
            "transcript_error",
            "transcript_path",
            "transcript_html_path",
            "diarization_requested",
            "diarization_status",
            "agent",
            "card_id",
            "card",
            "failure_stage",
            "failure_reason",
            "archived",
        )
        return {key: meeting[key] for key in keep if key in meeting}

    def _upsert_meeting(self, record: dict[str, object]) -> None:
        with self._meetings_lock:
            self._meetings_dir.mkdir(parents=True, exist_ok=True)
            rows: list[dict[str, object]] = []
            if self._meetings_index_path.exists():
                try:
                    payload = json.loads(self._meetings_index_path.read_text(encoding="utf-8"))
                    raw_rows = payload.get("meetings") if isinstance(payload, dict) else payload
                    if isinstance(raw_rows, list):
                        rows = [dict(item) for item in raw_rows if isinstance(item, dict)]
                except Exception:
                    rows = []
            meeting_id = str(record.get("meeting_id") or "")
            rows = [item for item in rows if str(item.get("meeting_id") or "") != meeting_id]
            rows.append(dict(record))
            rows = rows[-200:]
            payload = {"schema": "pucky.meetings_index.v1", "meetings": rows}
            self._meetings_index_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")

    def _card_icon_accent(self, icon: object) -> str:
        name = normalize_card_icon(icon)
        registry = self._load_card_icons()
        record = registry.get(name) or registry.get(DEFAULT_CARD_ICON) or {}
        return str(record.get("accent") or DEFAULT_CARD_ICON_ACCENT)

    def _decorate_feed_item(self, item: dict[str, object]) -> dict[str, object]:
        icon = item.get("icon")
        card = item.get("card")
        if isinstance(card, dict):
            icon = card.get("icon") or icon
        accent = self._card_icon_accent(icon)
        item["accent"] = accent
        if isinstance(card, dict):
            card["accent"] = accent
        return item

    def _reconcile_meeting_feed_item(self, item: dict[str, object]) -> dict[str, object]:
        origin = item.get("origin") if isinstance(item.get("origin"), dict) else {}
        if str(origin.get("card_kind") or item.get("card_kind") or "").strip() != "meeting_processing":
            return item

        meeting_id = _safe_meeting_id(origin.get("meeting_id") or item.get("turn_id") or item.get("session_id"))
        if not meeting_id:
            return item
        meeting = self._meeting_record_by_id(meeting_id)
        if not isinstance(meeting, dict):
            return item

        state = str(meeting.get("state") or "").strip().lower()
        if state == "failed":
            failed_card = self._meeting_failed_card_payload(meeting)
            reconciled = dict(item)
            reconciled["title"] = str(failed_card.get("title") or reconciled.get("title") or "")
            reconciled["summary"] = str(failed_card.get("summary") or reconciled.get("summary") or "")
            reconciled["reply_text"] = str(failed_card.get("summary") or reconciled.get("reply_text") or "")
            reconciled["icon"] = str(failed_card.get("icon") or reconciled.get("icon") or "")
            reconciled["card"] = dict(failed_card)
            reconciled["card_kind"] = "meeting_failed"
            reconciled["meeting_state"] = "failed"
            reconciled["failure_stage"] = str(failed_card.get("failure_stage") or "")
            reconciled["origin"] = dict(failed_card.get("origin") or {})
            return reconciled

        if state in {"completed", "completed_with_missing_result"}:
            persisted = meeting.get("feed_item") if isinstance(meeting.get("feed_item"), dict) else None
            if isinstance(persisted, dict):
                reconciled = dict(persisted)
                reconciled.setdefault("card_id", item.get("card_id"))
                reconciled.setdefault("turn_id", item.get("turn_id"))
                reconciled.setdefault("session_id", item.get("session_id"))
                reconciled["archived"] = item.get("archived", reconciled.get("archived", False))
                reconciled["read"] = item.get("read", reconciled.get("read", False))
                reconciled["deleted"] = item.get("deleted", reconciled.get("deleted", False))
                return reconciled
        return item

    def _decorate_feed_payload(self, payload: dict[str, object]) -> dict[str, object]:
        for item in list(payload.get("items") or []):
            if isinstance(item, dict):
                reconciled = dict(self._reconcile_meeting_feed_item(item))
                item.clear()
                item.update(reconciled)
                self._decorate_feed_item(item)
        return payload

    def _load_card_icons(self) -> dict[str, dict[str, str]]:
        with self._card_icon_lock:
            runtime = self._load_runtime_card_icons_locked()
        merged = {name: dict(icon) for name, icon in DEFAULT_CARD_ICONS.items()}
        for name, icon in runtime.items():
            merged[name] = dict(icon)
        return dict(sorted(merged.items(), key=lambda item: item[0]))

    def _load_runtime_card_icons_locked(self) -> dict[str, dict[str, str]]:
        path = self._card_icons_path
        if not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        icons = data.get("icons") if isinstance(data, dict) else data
        if not isinstance(icons, list):
            return {}
        registry: dict[str, dict[str, str]] = {}
        for item in icons:
            if not isinstance(item, dict):
                continue
            try:
                icon = _normalize_card_icon_record(item)
            except ValueError:
                continue
            registry[icon["name"]] = icon
        return registry

    def _persist_runtime_card_icons_locked(self, registry: dict[str, dict[str, str]]) -> None:
        self._card_icons_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema": "pucky.card_icon_registry.v1",
            "icons": [registry[name] for name in sorted(registry)],
        }
        self._card_icons_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    def handle_audio_turn(
        self,
        audio: bytes,
        content_type: str,
        turn_id: str | None = None,
        reply_mode: str | None = None,
        model: str | None = None,
        reasoning_effort: str | None = None,
        *,
        thread_mode: str | None = None,
        thread_id: str | None = None,
        thread_scope_source: str | None = None,
        thread_card_id: str | None = None,
        debug_fixture_transcript: str | None = None,
        proof_reply_delay_ms: str | int | None = None,
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
            "stage": "upload_received",
        }
        thread_request = _normalize_thread_request(
            mode=thread_mode,
            thread_id=thread_id,
            source=thread_scope_source,
            card_id=thread_card_id,
        )
        telemetry.update(thread_request)
        requested_model = _normalize_requested_turn_model(model, fallback="")
        requested_reasoning_effort = _normalize_requested_turn_reasoning_effort(reasoning_effort, fallback="")
        if requested_model:
            telemetry["requested_model"] = requested_model
        if requested_reasoning_effort:
            telemetry["requested_reasoning_effort"] = requested_reasoning_effort
        telemetry["proof_reply_delay_ms_requested"] = _normalize_proof_reply_delay_ms(proof_reply_delay_ms)
        telemetry["proof_reply_delay_enabled"] = bool(self.config.proof_reply_delay_enabled)
        self._update_turn_status(turn_id, "upload_received", "running", telemetry)
        try:
            telemetry["stage"] = "stt_running"
            telemetry["stt_start_ms"] = _elapsed_ms(total_start)
            self._update_turn_status(turn_id, "stt_running", "running", telemetry)
            start = time.perf_counter()
            transcript_override = str(debug_fixture_transcript or "").strip()
            transcript = transcript_override or self.stt.transcribe(audio, content_type)
            telemetry["stt_ms"] = _elapsed_ms(start)
            telemetry["stt_end_ms"] = _elapsed_ms(total_start)
            telemetry["debug_fixture_transcript_used"] = bool(transcript_override)
            telemetry["transcript_chars"] = len(transcript)
            telemetry["user_transcript"] = transcript
            return self._handle_transcript_turn(
                turn_id=turn_id,
                session_id=session_id,
                reply_mode=reply_mode,
                transcript=transcript,
                telemetry=telemetry,
                total_start=total_start,
                request_audio_mime_type=content_type,
                request_audio_base64=base64.b64encode(audio).decode("ascii"),
                model=requested_model or None,
                reasoning_effort=requested_reasoning_effort or None,
            )
        except Exception as exc:
            failed_stage, root = _unwrap_staged_exception(exc, fallback_stage="stt_running")
            telemetry["event"] = "pucky.turn.failed"
            telemetry["status"] = "failed"
            telemetry["stage"] = failed_stage
            telemetry["failed_stage"] = failed_stage
            telemetry["error_type"] = root.__class__.__name__
            telemetry["error_message"] = str(root).strip()
            telemetry["failure_reason"] = _failure_reason_from_exception(root)
            telemetry["total_ms"] = _elapsed_ms(total_start)
            self._update_turn_status(turn_id, "failed", "failed", telemetry)
            _log_json(telemetry)
            raise

    def handle_text_turn(
        self,
        text: str,
        turn_id: str | None = None,
        reply_mode: str | None = None,
        model: str | None = None,
        reasoning_effort: str | None = None,
        *,
        thread_mode: str | None = None,
        thread_id: str | None = None,
        thread_scope_source: str | None = None,
        thread_card_id: str | None = None,
        proof_reply_delay_ms: str | int | None = None,
    ) -> dict[str, object]:
        transcript = str(text or "").strip()
        if not transcript:
            raise ValueError("text body is empty")
        turn_id = _normalize_turn_id(turn_id)
        session_id = turn_id
        reply_mode = _normalize_reply_mode(reply_mode)
        total_start = time.perf_counter()
        telemetry: dict[str, object] = {
            "event": "pucky.turn.text",
            "session_id": session_id,
            "turn_id": turn_id,
            "content_type": "text/plain",
            "reply_mode": reply_mode,
            "input_text_chars": len(transcript),
            "transcript_chars": len(transcript),
            "user_transcript": transcript,
            "tts_provider": "deepinfra",
            "tts_model": getattr(self.tts, "model", ""),
            "tts_voice": getattr(self.tts, "voice", ""),
            "tts_format": getattr(self.tts, "response_format", ""),
            "tts_speed": getattr(self.tts, "speed", ""),
            "stage": "codex_running",
        }
        thread_request = _normalize_thread_request(
            mode=thread_mode,
            thread_id=thread_id,
            source=thread_scope_source,
            card_id=thread_card_id,
        )
        telemetry.update(thread_request)
        requested_model = _normalize_requested_turn_model(model, fallback="")
        requested_reasoning_effort = _normalize_requested_turn_reasoning_effort(reasoning_effort, fallback="")
        if requested_model:
            telemetry["requested_model"] = requested_model
        if requested_reasoning_effort:
            telemetry["requested_reasoning_effort"] = requested_reasoning_effort
        telemetry["proof_reply_delay_ms_requested"] = _normalize_proof_reply_delay_ms(proof_reply_delay_ms)
        telemetry["proof_reply_delay_enabled"] = bool(self.config.proof_reply_delay_enabled)
        self._update_turn_status(turn_id, "upload_received", "running", telemetry)
        try:
            return self._handle_transcript_turn(
                turn_id=turn_id,
                session_id=session_id,
                reply_mode=reply_mode,
                transcript=transcript,
                telemetry=telemetry,
                total_start=total_start,
                request_audio_mime_type="",
                request_audio_base64="",
                model=requested_model or None,
                reasoning_effort=requested_reasoning_effort or None,
            )
        except Exception as exc:
            failed_stage, root = _unwrap_staged_exception(exc, fallback_stage="codex_running")
            telemetry["event"] = "pucky.turn.failed"
            telemetry["status"] = "failed"
            telemetry["stage"] = failed_stage
            telemetry["failed_stage"] = failed_stage
            telemetry["error_type"] = root.__class__.__name__
            telemetry["error_message"] = str(root).strip()
            telemetry["failure_reason"] = _failure_reason_from_exception(root)
            telemetry["total_ms"] = _elapsed_ms(total_start)
            self._update_turn_status(turn_id, "failed", "failed", telemetry)
            _log_json(telemetry)
            raise

    def _handle_transcript_turn(
        self,
        *,
        turn_id: str,
        session_id: str,
        reply_mode: str,
        transcript: str,
        telemetry: dict[str, object],
        total_start: float,
        request_audio_mime_type: str,
        request_audio_base64: str,
        request_audio_attachment: dict[str, object] | None = None,
        output_schema: dict[str, object] | None = None,
        developer_instructions: str | None = None,
        display_transcript_text: str | None = None,
        model: str | None = None,
        reasoning_effort: str | None = None,
        force_unread: bool = False,
        codex_client: CodexProvider | None = None,
        attachment_builder: Callable[[ReplyEnvelope], tuple[list[dict[str, object]], dict[str, object]]] | None = None,
        codex_stage: str = "codex_turn",
        feed_persist_stage: str = "feed_persist",
    ) -> dict[str, object]:
        client = codex_client or self.codex
        telemetry["stage"] = "codex_running"
        telemetry["codex_start_ms"] = _elapsed_ms(total_start)
        self._update_turn_status(turn_id, "codex_running", "running", telemetry)
        start = time.perf_counter()
        requested_thread_id = str(telemetry.get("requested_thread_id") or "").strip()
        model_override = _normalize_requested_turn_model(model, fallback=self.config.codex_model or "")
        reasoning_override = _normalize_requested_turn_reasoning_effort(
            reasoning_effort,
            fallback=self.config.codex_reasoning_effort or "",
        )
        if requested_thread_id:
            reasoning_override = ""
            try:
                existing_origin = client.thread_origin(requested_thread_id, retries=1, delay=0.0)
            except Exception:
                existing_origin = {}
            if isinstance(existing_origin, dict):
                preserved_reasoning = _normalize_requested_turn_reasoning_effort(
                    existing_origin.get("reasoning_effort"),
                    fallback="",
                )
                if preserved_reasoning:
                    reasoning_override = preserved_reasoning
            model_override = ""
        def _send_turn() -> CodexTurnResult | str:
            try:
                return client.send_turn(
                    transcript,
                    thread_id=requested_thread_id or None,
                    model=model_override or None,
                    reasoning_effort=reasoning_override or None,
                    output_schema=output_schema,
                    developer_instructions=developer_instructions,
                )
            except TypeError as exc:
                message = str(exc)
                if all(
                    token not in message
                    for token in (
                        "thread_id",
                        "output_schema",
                        "model",
                        "reasoning_effort",
                        "developer_instructions",
                    )
                ):
                    raise
                fallback_candidates: list[dict[str, object]] = []
                rich_fallback: dict[str, object] = {}
                if requested_thread_id:
                    rich_fallback["thread_id"] = requested_thread_id
                if isinstance(output_schema, dict):
                    rich_fallback["output_schema"] = output_schema
                if developer_instructions:
                    rich_fallback["developer_instructions"] = developer_instructions
                if rich_fallback:
                    fallback_candidates.append(rich_fallback)
                legacy_fallback: dict[str, object] = {}
                if requested_thread_id:
                    legacy_fallback["thread_id"] = requested_thread_id
                if isinstance(output_schema, dict):
                    legacy_fallback["output_schema"] = output_schema
                if legacy_fallback and legacy_fallback not in fallback_candidates:
                    fallback_candidates.append(legacy_fallback)
                thread_only = {"thread_id": requested_thread_id} if requested_thread_id else {}
                if thread_only and thread_only not in fallback_candidates:
                    fallback_candidates.append(thread_only)
                if {} not in fallback_candidates:
                    fallback_candidates.append({})
                for fallback_kwargs in fallback_candidates:
                    try:
                        return client.send_turn(transcript, **fallback_kwargs)  # type: ignore[call-arg]
                    except TypeError as fallback_exc:
                        fallback_message = str(fallback_exc)
                        if "unexpected keyword argument" not in fallback_message:
                            raise
                        continue
                raise

        codex_result = _run_staged_operation(codex_stage, _send_turn, sqlite_retry=True)
        if isinstance(codex_result, str):
            codex_result = CodexTurnResult(
                reply_text=codex_result,
                used_thread_id=str(client.thread_id or requested_thread_id or ""),
                requested_thread_id=requested_thread_id,
                thread_mode="existing" if requested_thread_id else "new",
            )
        raw_reply = codex_result.reply_text
        telemetry["codex_ms"] = _elapsed_ms(start)
        telemetry["codex_end_ms"] = _elapsed_ms(total_start)
        telemetry["codex_thread_id"] = codex_result.used_thread_id
        telemetry["thread_mode"] = codex_result.thread_mode
        telemetry["thread_reused"] = codex_result.reused_existing_thread
        telemetry["thread_fallback_reason"] = codex_result.fallback_reason
        telemetry["raw_reply_chars"] = len(raw_reply)

        telemetry["stage"] = "envelope"
        envelope = parse_reply_envelope(raw_reply)
        telemetry["envelope_parse"] = "ok"
        telemetry["reply_chars"] = len(envelope.reply_text)
        telemetry["card_icon"] = envelope.card_icon
        telemetry["recording_title"] = envelope.recording_title
        telemetry["has_html"] = bool(envelope.html_content)
        try:
            client.set_thread_title(envelope.card_title, thread_id=codex_result.used_thread_id)
            telemetry["codex_thread_title_synced"] = True
        except Exception:
            telemetry["codex_thread_title_synced"] = False
        try:
            origin = client.thread_origin(codex_result.used_thread_id)
        except Exception:
            origin = {}
        if not isinstance(origin, dict):
            origin = {}
        origin = _normalize_origin(origin, telemetry.get("codex_thread_id"))
        telemetry["origin_thread_id"] = origin.get("thread_id", "")
        telemetry["origin_model"] = origin.get("model", "")
        telemetry["origin_reasoning_effort"] = origin.get("reasoning_effort", "")

        if attachment_builder is not None:
            attachments, attachment_meta = attachment_builder(envelope)
        else:
            attachments, attachment_meta = self._prepare_reply_attachments(
                turn_id=turn_id,
                envelope=envelope,
                reply_text=envelope.reply_text,
            )
        telemetry["attachment_count"] = len(attachments)
        telemetry["displayable_attachment_count"] = int(sum(1 for item in attachments if _attachment_is_displayable(item)))
        telemetry["attachment_fallback_from_reply_text"] = bool(attachment_meta.get("fallback_from_reply_text"))

        telemetry["stage"] = "tts_running"
        telemetry["tts_start_ms"] = _elapsed_ms(total_start)
        self._update_turn_status(turn_id, "tts_running", "running", telemetry)
        start = time.perf_counter()
        reply_audio, audio_mime_type = self.tts.synthesize(envelope.reply_text)
        telemetry["tts_ms"] = _elapsed_ms(start)
        telemetry["tts_end_ms"] = _elapsed_ms(total_start)
        telemetry["tts_status"] = "ok"
        telemetry["reply_audio_bytes"] = len(reply_audio)
        telemetry["audio_mime_type"] = audio_mime_type

        transcript_messages = [
            _user_transcript_message(
                text=(display_transcript_text if display_transcript_text is not None else transcript),
                created_at=_iso_time(time.time()),
                turn_id=turn_id,
                request_audio_mime_type=request_audio_mime_type,
                has_request_audio=bool(request_audio_base64),
                request_audio_attachment=request_audio_attachment,
            ),
            _assistant_transcript_message(
                text=envelope.reply_text,
                created_at=_iso_time(time.time()),
                attachments=attachments,
            )
        ]
        card: dict[str, object] = {
            "title": envelope.card_title,
            "summary": envelope.reply_text,
            "icon": envelope.card_icon,
            "accent": self._card_icon_accent(envelope.card_icon),
            "origin": origin,
        }
        html_mime_type = ""
        html_base64 = ""
        final_html_content = str(attachment_meta.get("summary_html_content") or envelope.html_content or "")
        if final_html_content:
            html_bytes = final_html_content.encode("utf-8")
            if len(html_bytes) <= self.config.max_html_bytes:
                html_mime_type = "text/html"
                html_base64 = base64.b64encode(html_bytes).decode("ascii")
                card["html_mime_type"] = html_mime_type
                card["html_base64"] = html_base64
        telemetry["total_ms"] = _elapsed_ms(total_start)
        telemetry["status"] = "ok"
        telemetry["feed_db_path"] = self.feed.db_path
        audio_base64 = base64.b64encode(reply_audio).decode("ascii") if reply_audio else ""
        result = _run_staged_operation(
            feed_persist_stage,
            lambda: self.feed.upsert_turn_result(
                turn_id=turn_id,
                session_id=session_id,
                reply_mode=reply_mode,
                reply_text=envelope.reply_text,
                title=envelope.card_title,
                summary=envelope.reply_text,
                icon=envelope.card_icon,
                origin=origin,
                telemetry=_public_turn_telemetry(telemetry),
                transcript_messages=transcript_messages,
                request_audio_mime_type=request_audio_mime_type,
                request_audio_base64=request_audio_base64,
                audio_mime_type=audio_mime_type,
                audio_base64=audio_base64,
                html_mime_type=html_mime_type,
                html_base64=html_base64,
                force_unread=force_unread,
            ),
            sqlite_retry=True,
        )
        card_id = str(result.get("card_id") or "")
        telemetry["card_id"] = card_id
        verified = _run_staged_operation(
            feed_persist_stage,
            lambda: self.feed.get_item(card_id),
            sqlite_retry=True,
        )
        if verified is None:
            telemetry["feed_persisted"] = False
            telemetry["status"] = "failed"
            telemetry["stage"] = "feed_persist"
            telemetry["error_type"] = "RuntimeError"
            self._update_turn_status(turn_id, "failed", "failed", telemetry)
            _log_json(telemetry)
            raise RuntimeError("feed_persist_failed")
        telemetry["feed_persisted"] = True
        result = self._decorate_feed_item(verified)
        result["card"] = card
        result["accent"] = card["accent"]
        if envelope.recording_title:
            result["recording_title"] = envelope.recording_title
        if envelope.transcript_text:
            result["transcript_text"] = envelope.transcript_text
        result["telemetry"] = _public_turn_telemetry(telemetry)
        self._apply_proof_reply_delay(telemetry)
        telemetry["total_ms"] = _elapsed_ms(total_start)
        telemetry["response_bytes"] = len(json.dumps(result, separators=(",", ":")).encode("utf-8"))
        result["telemetry"] = _public_turn_telemetry(telemetry)
        self._update_turn_status(turn_id, "completed", "ok", telemetry)
        _log_json(telemetry)
        return result

    def _apply_proof_reply_delay(self, telemetry: dict[str, object]) -> None:
        requested_ms = _normalize_proof_reply_delay_ms(telemetry.get("proof_reply_delay_ms_requested"))
        telemetry["proof_reply_delay_ms_requested"] = requested_ms
        telemetry["proof_reply_delay_ms_applied"] = 0
        telemetry["proof_reply_delay_enabled"] = bool(self.config.proof_reply_delay_enabled)
        if requested_ms <= 0:
            return
        if not self.config.proof_reply_delay_enabled:
            telemetry["proof_reply_delay_ignored"] = "disabled"
            return
        start = time.perf_counter()
        time.sleep(requested_ms / 1000.0)
        telemetry["proof_reply_delay_ms_applied"] = requested_ms
        telemetry["proof_reply_delay_elapsed_ms"] = _elapsed_ms(start)

    def _prepare_reply_attachments(
        self,
        *,
        turn_id: str,
        envelope: ReplyEnvelope,
        reply_text: str,
    ) -> tuple[list[dict[str, object]], dict[str, object]]:
        raw_items = [dict(item) for item in envelope.attachments]
        meta = {"fallback_from_reply_text": False}
        if not raw_items and self.config.codex_cwd:
            fallback_paths = _extract_displayable_paths_from_text(reply_text, self.config.codex_cwd)
            if fallback_paths:
                raw_items = [{"path": path, "title": Path(path).name} for path in fallback_paths]
                meta["fallback_from_reply_text"] = True
        prepared: list[dict[str, object]] = []
        if envelope.html_content:
            prepared.append(
                normalize_attachment(
                    {
                        "id": f"{turn_id}:html",
                        "artifact": f"pucky_card_{turn_id}:html",
                        "mime_type": "text/html",
                        "title": envelope.html_title or envelope.card_title or "HTML page",
                        "kind": "html",
                    }
                )
            )
        for index, item in enumerate(raw_items):
            normalized = self._prepare_one_reply_attachment(turn_id=turn_id, index=index, item=item)
            if normalized is not None:
                prepared.append(normalized)
            if len(prepared) >= self.config.max_attachment_count:
                break
        return prepared, meta

    def _prepare_one_reply_attachment(
        self,
        *,
        turn_id: str,
        index: int,
        item: dict[str, object],
    ) -> dict[str, object] | None:
        raw = dict(item or {})
        title = str(raw.get("title") or "").strip()
        mime_type = str(raw.get("mime_type") or "").strip().lower()
        kind = str(raw.get("kind") or "").strip().lower()
        text = str(raw.get("text") or "")
        resolved_path = _resolve_codex_path(self.config.codex_cwd, raw.get("path"))
        viewer_path = _resolve_codex_path(self.config.codex_cwd, raw.get("viewer_path"))
        preview_path = _resolve_codex_path(self.config.codex_cwd, raw.get("preview_path"))
        if not mime_type:
            mime_type = _guess_attachment_mime(resolved_path or viewer_path or preview_path or title)
        normalized: dict[str, object] = {
            "id": str(raw.get("id") or f"{turn_id}:attachment:{index + 1}"),
            "title": title or Path(str(resolved_path or viewer_path or preview_path or f'attachment-{index + 1}')).name,
            "mime_type": mime_type,
        }
        if kind:
            normalized["kind"] = kind
        if text:
            normalized["text"] = text
        if resolved_path:
            normalized["path"] = resolved_path
        if preview_path:
            normalized["preview_path"] = preview_path
        if viewer_path:
            if _requires_document_html_viewer(mime_type, resolved_path):
                normalized["document_html_path"] = viewer_path
            else:
                normalized["viewer_path"] = viewer_path
        if resolved_path:
            original_bytes = _read_limited_bytes(resolved_path, self.config.max_attachment_bytes)
            if original_bytes is not None:
                normalized["artifact"] = f"pucky_card_{turn_id}:attachment:{index + 1}:original"
                if _is_inline_text_mime(mime_type) and "text" not in normalized:
                    normalized["text"] = original_bytes.decode("utf-8", errors="replace")
        if preview_path:
            preview_bytes = _read_limited_bytes(preview_path, self.config.max_attachment_viewer_bytes)
            if preview_bytes is not None:
                normalized["preview_artifact"] = f"pucky_card_{turn_id}:attachment:{index + 1}:preview"
        if viewer_path:
            viewer_bytes = _read_limited_bytes(viewer_path, self.config.max_attachment_viewer_bytes)
            if viewer_bytes is not None:
                if _requires_document_html_viewer(mime_type, resolved_path):
                    normalized["document_html_artifact"] = f"pucky_card_{turn_id}:attachment:{index + 1}:viewer"
                else:
                    normalized["viewer_artifact"] = f"pucky_card_{turn_id}:attachment:{index + 1}:viewer"
        if not normalized.get("artifact") and not normalized.get("viewer_artifact") and not normalized.get("document_html_artifact") and not normalized.get("text"):
            return None
        return normalize_attachment(normalized)

    def feed_sync(
        self,
        cursor: str | None,
        limit: int,
        *,
        include_archived: bool = True,
        compact: bool = False,
        base_url: str = "",
    ) -> dict[str, object]:
        return self._decorate_feed_payload(
            self.feed.list_feed(cursor, limit, include_archived=include_archived, compact=compact, base_url=base_url)
        )

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
    recording_title = str(data.get("recording_title") or "").strip()[:MAX_CARD_TITLE_CHARS].strip()
    transcript_text = str(data.get("transcript_text") or "").replace("\r\n", "\n").strip()
    html_title = ""
    html_content = ""
    html = data.get("html")
    if isinstance(html, dict):
        html_title = str(html.get("title") or "").strip()
        html_content = str(html.get("content") or "").strip()
    attachments: list[dict[str, object]] = []
    if isinstance(data.get("attachments"), list):
        for item in data.get("attachments") or []:
            if isinstance(item, dict):
                attachments.append(dict(item))
    return ReplyEnvelope(
        reply_text,
        card_title,
        normalize_card_icon(data.get("card_icon")),
        recording_title,
        transcript_text,
        html_title,
        html_content,
        tuple(attachments),
    )


def normalize_card_icon(value: object) -> str:
    icon = str(value or "").strip().lower()
    return icon if CARD_ICON_NAME_RE.fullmatch(icon) else DEFAULT_CARD_ICON


def fallback_title(text: str) -> str:
    clean = re.sub(r"\s+", " ", (text or "").strip())
    return (clean[:MAX_CARD_TITLE_CHARS].strip() if clean else "Pucky") or "Pucky"


def reply_output_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "reply_text": {"type": "string"},
            "card_title": {"type": "string"},
            "card_icon": {"type": "string"},
            "recording_title": {"type": ["string", "null"]},
            "html": {
                "type": ["object", "null"],
                "additionalProperties": False,
                "properties": {
                    "title": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["title", "content"],
            },
            "attachments": {
                "type": ["array", "null"],
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "path": {"type": ["string", "null"]},
                        "mime_type": {"type": ["string", "null"]},
                        "title": {"type": ["string", "null"]},
                        "kind": {"type": ["string", "null"]},
                        "viewer_path": {"type": ["string", "null"]},
                        "preview_path": {"type": ["string", "null"]},
                        "text": {"type": ["string", "null"]},
                    },
                    "required": ["path", "mime_type", "title", "kind", "viewer_path", "preview_path", "text"],
                },
            },
        },
        "required": ["reply_text", "card_title", "card_icon", "recording_title", "html", "attachments"],
    }


def meeting_reply_output_schema() -> dict[str, object]:
    schema = reply_output_schema()
    properties = dict(schema.get("properties") or {})
    properties["transcript_text"] = {"type": ["string", "null"]}
    schema["properties"] = properties
    required = [str(item) for item in list(schema.get("required") or [])]
    if "transcript_text" not in required:
        required.append("transcript_text")
    schema["required"] = required
    return schema


def _normalize_card_icon_record(payload: dict[str, object]) -> dict[str, str]:
    name = normalize_card_icon(payload.get("name") or payload.get("slug") or payload.get("card_icon"))
    if name == DEFAULT_CARD_ICON and str(payload.get("name") or payload.get("slug") or payload.get("card_icon") or "").strip().lower() != DEFAULT_CARD_ICON:
        raise ValueError("invalid_card_icon_name")
    filled_svg = _sanitize_svg_fragment(payload.get("filled_svg") or payload.get("filled") or "")
    outline_svg = _sanitize_svg_fragment(payload.get("outline_svg") or payload.get("outline") or "")
    if not filled_svg and not outline_svg:
        raise ValueError("card_icon_svg_required")
    return {
        "name": name,
        "label": str(payload.get("label") or name.replace("_", " ").title()).strip() or name,
        "accent": normalize_card_icon_accent(payload.get("accent")),
        "filled_svg": filled_svg or outline_svg,
        "outline_svg": outline_svg or filled_svg,
    }


def normalize_card_icon_accent(value: object) -> str:
    accent = str(value or "").strip()
    return accent.lower() if CARD_ICON_ACCENT_RE.fullmatch(accent) else DEFAULT_CARD_ICON_ACCENT


def _sanitize_svg_fragment(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw.encode("utf-8")) > 16 * 1024:
        raise ValueError("card_icon_svg_too_large")
    lower = raw.lower()
    forbidden = ("<script", "<style", "onload=", "onclick=", "href=", "xlink:href", "foreignobject")
    if any(token in lower for token in forbidden):
        raise ValueError("card_icon_svg_contains_unsupported_content")
    tags = re.findall(r"<\s*/?\s*([a-zA-Z0-9:_-]+)", raw)
    allowed = {"path", "circle", "rect", "ellipse", "line", "polyline", "polygon", "g"}
    if any(tag.lower() not in allowed for tag in tags):
        raise ValueError("card_icon_svg_contains_unsupported_tags")
    return raw


def _assistant_transcript_message(
    *,
    text: str,
    created_at: str,
    attachments: list[dict[str, object]],
) -> dict[str, object]:
    message = {
        "role": "assistant",
        "text": text,
        "created_at": created_at,
    }
    if attachments:
        message["attachments"] = attachments
    return message


def _android_app_owned_path(path: object) -> str:
    value = str(path or "").strip()
    if not value:
        return ""
    if value.startswith("/data/user/0/com.pucky.device") or value.startswith("/data/data/com.pucky.device"):
        return value
    return ""


def _meeting_request_audio_attachment(record: dict[str, object]) -> dict[str, object]:
    attachment: dict[str, object] = {"title": "Meeting Audio"}
    device_path = _android_app_owned_path(record.get("device_path"))
    if device_path:
        attachment["title"] = "Meeting Audio"
        attachment["path"] = device_path
    return attachment


def _user_transcript_message(
    *,
    text: str,
    created_at: str,
    turn_id: str,
    request_audio_mime_type: str,
    has_request_audio: bool,
    request_audio_attachment: dict[str, object] | None = None,
) -> dict[str, object]:
    message: dict[str, object] = {
        "role": "user",
        "text": text,
        "created_at": created_at,
    }
    return message


def _resolve_codex_path(codex_cwd: str | None, raw: object) -> str:
    clean = str(raw or "").strip()
    if not clean:
        return ""
    path = Path(clean)
    if not path.is_absolute():
        return ""
    try:
        resolved = path.resolve()
    except Exception:
        return ""
    if codex_cwd:
        root = Path(codex_cwd).resolve()
        if resolved != root and root not in resolved.parents:
            return ""
    if not resolved.exists() or not resolved.is_file():
        return ""
    return str(resolved)


def _extract_displayable_paths_from_text(reply_text: str, codex_cwd: str | None) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    candidates = []
    for match in DISPLAYABLE_ATTACHMENT_PATH_RE.findall(str(reply_text or "")):
        candidates.append(match)
    for token in re.split(r"[\s\"'<>]+", str(reply_text or "")):
        clean = token.strip(".,;:()[]{}")
        if clean:
            candidates.append(clean)
    for candidate in candidates:
        resolved = _resolve_codex_path(codex_cwd, candidate)
        if not resolved or resolved in seen:
            continue
        mime = _guess_attachment_mime(resolved)
        if _looks_browser_displayable(mime, resolved):
            seen.add(resolved)
            found.append(resolved)
    return found


def _safe_meeting_id(raw: object) -> str:
    value = str(raw or "").strip()
    if not re.fullmatch(r"meeting-[A-Za-z0-9._:-]{1,160}", value):
        return ""
    return value


def _meeting_agent_handoff_prompt(record: dict[str, object]) -> str:
    return f"""Meeting Mode Agent Handoff

Follow your meeting-specific developer instructions plus the shared base instructions. Use the meeting tools to do the transcript and diarization work.

Meeting metadata:
- meeting_id: {record.get("meeting_id")}
- audio_path: {record.get("audio_path")}
- audio_url: {record.get("audio_url") or ""}
- device_path: {record.get("device_path") or ""}
- mime_type: {record.get("mime_type") or ""}
- duration_ms: {record.get("duration_ms") or 0}
- audio_bytes: {record.get("audio_bytes") or 0}

Produce both a card_title for the feed tile and a separate recording_title for the canonical saved meeting audio/transcript basename. recording_title may differ from card_title. Use Deepgram for the meeting transcript and diarization. Relabel diarized speakers to real participant names when the transcript clearly supports that mapping, and keep distinct anonymous speakers separated as neutral labels when identities are unclear. Return the cleaned labeled transcript in transcript_text. The platform will publish the Transcript and Transcript (Plain Text) artifacts from transcript_text. Use due dates only when the meeting explicitly states them. The summary HTML is invalid unless it includes the literal placeholders {{{{PUCKY_MEETING_TRANSCRIPT_LINK}}}} and {{{{PUCKY_MEETING_AUDIO_LINK}}}} as standalone tokens. Do not wrap those placeholders in your own <a> tags, and do not replace them with raw VM URLs, /tmp paths, inline JavaScript, or custom playback UI.
""".strip()


def _guess_attachment_mime(value: str) -> str:
    guessed, _ = mimetypes.guess_type(str(value or ""))
    return (guessed or "application/octet-stream").lower()


def _is_inline_text_mime(mime_type: str) -> bool:
    mime = str(mime_type or "").lower()
    return mime in {
        "text/plain",
        "text/markdown",
        "application/json",
        "text/xml",
        "application/xml",
        "text/csv",
        "text/tab-separated-values",
    }


def _read_limited_bytes(path: str, limit: int) -> bytes | None:
    try:
        resolved = Path(path).resolve()
    except Exception:
        return None
    try:
        if resolved.stat().st_size > max(0, int(limit)):
            return None
    except Exception:
        return None
    try:
        return resolved.read_bytes()
    except Exception:
        return None


def _requires_document_html_viewer(mime_type: str, resolved_path: str) -> bool:
    mime = str(mime_type or "").lower()
    path = str(resolved_path or "").lower()
    return (
        mime == "application/pdf"
        or mime.endswith("wordprocessingml.document")
        or mime.endswith("presentationml.presentation")
        or mime.endswith("spreadsheetml.sheet")
        or path.endswith(".pdf")
        or path.endswith(".docx")
        or path.endswith(".pptx")
        or path.endswith(".xlsx")
    )


def _looks_browser_displayable(mime_type: str, resolved_path: str) -> bool:
    mime = str(mime_type or "").lower()
    path = str(resolved_path or "").lower()
    if mime.startswith("image/") or mime.startswith("video/") or mime.startswith("audio/"):
        return True
    if mime in {
        "text/html",
        "application/xhtml+xml",
        "text/plain",
        "text/markdown",
        "application/json",
        "text/xml",
        "application/xml",
        "text/csv",
        "text/tab-separated-values",
    }:
        return True
    return path.endswith((".html", ".htm", ".txt", ".md", ".json", ".xml", ".csv", ".tsv", ".png", ".jpg", ".jpeg", ".svg", ".mp4", ".webm", ".wav", ".mp3"))


def _attachment_is_displayable(item: dict[str, object]) -> bool:
    viewer = item.get("viewer") if isinstance(item.get("viewer"), dict) else {}
    viewer_type = str(viewer.get("type") or "").lower()
    return viewer_type in {"html_iframe", "table", "text", "image_gallery", "video_player", "audio_player", "document_html"}


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


def _normalize_requested_turn_model(raw: object, fallback: str) -> str:
    value = str(raw or "").strip().lower()
    if value in OPENAI_TURN_MODELS:
        return value
    return str(fallback or "").strip()


def _normalize_requested_turn_reasoning_effort(raw: object, fallback: str) -> str:
    value = str(raw or "").strip().lower()
    if value in OPENAI_TURN_REASONING_EFFORTS:
        return value
    return str(fallback or "").strip()


def _normalize_thread_request(
    *,
    mode: str | None,
    thread_id: str | None,
    source: str | None,
    card_id: str | None,
) -> dict[str, object]:
    clean_thread_id = str(thread_id or "").strip()
    clean_mode = str(mode or "").strip().lower()
    requested_mode = "existing" if clean_mode == "existing" and clean_thread_id else "new"
    return {
        "requested_thread_mode": requested_mode,
        "requested_thread_id": clean_thread_id if requested_mode == "existing" else "",
        "thread_scope_source": str(source or "").strip(),
        "thread_scope_card_id": str(card_id or "").strip(),
    }

def _normalize_proof_reply_delay_ms(value: object) -> int:
    if value is None:
        return 0
    text = str(value).strip()
    if not text:
        return 0
    try:
        parsed = int(text, 10)
    except (TypeError, ValueError) as exc:
        raise ValueError("proof_reply_delay_ms must be an integer") from exc
    return max(0, min(60_000, parsed))


def _normalize_proof_reply_delay_ms(value: object) -> int:
    if value is None:
        return 0
    text = str(value).strip()
    if not text:
        return 0
    try:
        parsed = int(text, 10)
    except (TypeError, ValueError) as exc:
        raise ValueError("proof_reply_delay_ms must be an integer") from exc
    return max(0, min(60_000, parsed))


def _normalize_meeting_speaker_labels(raw: object) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    labels: dict[str, str] = {}
    for key, value in raw.items():
        clean_key = str(key or "").strip()
        clean_value = str(value or "").strip()
        if clean_key and clean_value:
            labels[clean_key] = clean_value
    return labels


def _meeting_turn_seconds(turn: dict[str, object], *, seconds_key: str, millis_key: str) -> float | None:
    value = turn.get(seconds_key)
    if isinstance(value, (int, float)):
        return float(value)
    value = turn.get(millis_key)
    if isinstance(value, (int, float)):
        return float(value) / 1000.0
    return None


def _resolve_meeting_speaker_name(turn: dict[str, object], speaker_labels: dict[str, str]) -> str:
    for key in ("speaker", "label"):
        candidate = str(turn.get(key) or "").strip()
        if not candidate:
            continue
        if candidate in speaker_labels and speaker_labels[candidate]:
            return speaker_labels[candidate]
        if not re.fullmatch(r"speaker_\d+", candidate):
            return candidate
    for fallback in ("speaker", "label"):
        candidate = str(turn.get(fallback) or "").strip()
        if candidate:
            return candidate
    return "speaker"


def _normalize_meeting_speaker_turns(raw_turns: object, speaker_labels: dict[str, str]) -> list[dict[str, object]]:
    if not isinstance(raw_turns, list):
        return []
    normalized: list[dict[str, object]] = []
    for item in raw_turns:
        if not isinstance(item, dict):
            continue
        start = _meeting_turn_seconds(item, seconds_key="start", millis_key="start_ms")
        end = _meeting_turn_seconds(item, seconds_key="end", millis_key="end_ms")
        text = str(item.get("text") or "").strip()
        speaker = _resolve_meeting_speaker_name(item, speaker_labels)
        row = dict(item)
        row["speaker"] = speaker
        if item.get("label") or speaker:
            row["label"] = speaker
        if text:
            row["text"] = text
        if start is not None:
            row["start"] = start
            row["start_ms"] = round(start * 1000)
        if end is not None:
            row["end"] = end
            row["end_ms"] = round(end * 1000)
        normalized.append(row)
    return normalized


def _format_meeting_timestamp(seconds: float | None) -> str:
    if seconds is None:
        return ""
    total = max(0, int(round(seconds)))
    minutes = total // 60
    remainder = total % 60
    return f"{minutes:02d}:{remainder:02d}"


def _canonical_meeting_transcript_text(*, transcript_text: str, speaker_turns: list[dict[str, object]]) -> str:
    if speaker_turns:
        lines: list[str] = []
        for turn in speaker_turns:
            speaker = str(turn.get("speaker") or turn.get("label") or "speaker").strip() or "speaker"
            text = str(turn.get("text") or "").strip()
            if not text:
                continue
            start = _meeting_turn_seconds(turn, seconds_key="start", millis_key="start_ms")
            end = _meeting_turn_seconds(turn, seconds_key="end", millis_key="end_ms")
            start_label = _format_meeting_timestamp(start)
            end_label = _format_meeting_timestamp(end)
            if start_label and end_label:
                prefix = f"[{start_label}-{end_label}] "
            elif start_label:
                prefix = f"[{start_label}] "
            else:
                prefix = ""
            lines.append(f"{prefix}{speaker}: {text}")
        if lines:
            return "\n".join(lines)
    return str(transcript_text or "").strip()


def _extract_named_meeting_transcript_attachment(attachments: tuple[dict[str, object], ...]) -> dict[str, object]:
    for item in attachments:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip().lower()
        kind = str(item.get("kind") or "").strip().lower()
        if kind == "text" and title in {"meeting transcript", "transcript", "transcript (plain text)"}:
            return dict(item)
    return {}


def _meeting_transcript_attachment_payload(result: dict[str, object]) -> dict[str, object]:
    messages = result.get("transcript_messages") if isinstance(result.get("transcript_messages"), list) else []
    for message in messages:
        if not isinstance(message, dict) or str(message.get("role") or "") != "assistant":
            continue
        attachments = message.get("attachments") if isinstance(message.get("attachments"), list) else []
        for item in attachments:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip().lower()
            kind = str(item.get("kind") or "").strip().lower()
            if kind == "text" and title in {"meeting transcript", "transcript", "transcript (plain text)"}:
                return dict(item)
    return {}


def _meeting_transcript_text_from_attachment(item: dict[str, object]) -> str:
    if not isinstance(item, dict):
        return ""
    text = str(item.get("text") or "").replace("\r\n", "\n").strip()
    return text


def _meeting_fallback_transcript_attachment(record: dict[str, object]) -> dict[str, object]:
    def _build_payload(text_value: object, turns_value: object, speaker_labels: object) -> dict[str, object]:
        transcript_text = str(text_value or "").replace("\r\n", "\n").strip()
        labels = _normalize_meeting_speaker_labels(speaker_labels)
        turns = _normalize_meeting_speaker_turns(turns_value, labels)
        canonical = _canonical_meeting_transcript_text(
            transcript_text=transcript_text,
            speaker_turns=turns,
        )
        if not canonical:
            return {}
        return {
            "title": "Transcript (Plain Text)",
            "kind": "text",
            "text": canonical,
        }

    payload = _build_payload(
        record.get("transcript_text"),
        record.get("speaker_turns"),
        record.get("speaker_labels"),
    )
    if payload:
        return payload
    fallback_text = str(record.get("tool_transcript_attachment_text") or "").replace("\r\n", "\n").strip()
    if fallback_text:
        return {
            "title": "Transcript (Plain Text)",
            "kind": "text",
            "text": fallback_text,
        }
    return _build_payload(
        record.get("tool_transcript_text"),
        record.get("tool_speaker_turns"),
        record.get("speaker_labels"),
    )


def _meeting_summary_link_html(href: str, label: str, action: str, class_name: str) -> str:
    return (
        f'<a class="document-open-link {html.escape(class_name)}" '
        f'href="{html.escape(str(href or "").strip())}" '
        f'data-pucky-meeting-action="{html.escape(str(action or "").strip())}">'
        f"{html.escape(str(label or '').strip())}</a>"
    )


def _meeting_summary_html_with_vm_links(summary_html: str, transcript_href: str, audio_href: str) -> str:
    output = str(summary_html or "")
    if not output:
        return output
    transcript_link = _meeting_summary_link_html(
        transcript_href,
        "Open Transcript",
        "transcript",
        "pucky-meeting-transcript-link",
    )
    audio_link = _meeting_summary_link_html(
        audio_href,
        "Listen To Audio",
        "audio",
        "pucky-meeting-audio-link",
    )
    output = re.sub(
        r'<a\b[^>]*href=["\']\{\{PUCKY_MEETING_TRANSCRIPT_LINK\}\}["\'][^>]*>.*?</a>',
        transcript_link,
        output,
        flags=re.I | re.S,
    )
    output = re.sub(
        r'<a\b[^>]*href=["\']\{\{PUCKY_MEETING_AUDIO_LINK\}\}["\'][^>]*>.*?</a>',
        audio_link,
        output,
        flags=re.I | re.S,
    )
    output = output.replace(
        "{{PUCKY_MEETING_TRANSCRIPT_LINK}}",
        transcript_link,
    )
    output = output.replace(
        "{{PUCKY_MEETING_AUDIO_LINK}}",
        audio_link,
    )
    output = re.sub(
        r'<a\b[^>]*href=["\'](?:https?:\/\/[^"\']+)?\/api\/meetings\/[^"\']+\/audio(?:\?[^"\']*)?["\'][^>]*>.*?</a>',
        audio_link,
        output,
        flags=re.I | re.S,
    )
    return output


def _meeting_transcript_html_document(record: dict[str, object], transcript_text: str) -> str:
    title = str(record.get("recording_title") or record.get("title") or "Transcript").strip() or "Transcript"
    subtitle = "Transcript"
    rows: list[str] = []
    for raw_line in str(transcript_text or "").splitlines():
        clean_line = str(raw_line or "").strip()
        if not clean_line:
            continue
        match = MEETING_TRANSCRIPT_LINE_RE.match(clean_line)
        if match:
            start_label = str(match.group("start") or "").strip()
            end_label = str(match.group("end") or "").strip()
            timestamp = start_label
            if start_label and end_label:
                timestamp = f"{start_label}-{end_label}"
            timestamp_html = f'<span class="transcript-timestamp">{html.escape(timestamp)}</span>' if timestamp else ""
            speaker_html = f'<span class="transcript-speaker">{html.escape(str(match.group("speaker") or "").strip())}</span>'
            text_html = f'<span class="transcript-line-text">{html.escape(str(match.group("text") or "").strip())}</span>'
            rows.append(f'<p class="transcript-line">{timestamp_html}{speaker_html}{text_html}</p>')
            continue
        rows.append(f'<p class="transcript-line transcript-line-freeform">{html.escape(clean_line)}</p>')
    transcript_html = "\n".join(rows) if rows else '<p class="transcript-empty">Transcript unavailable.</p>'
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>{html.escape(title)} Transcript</title>
    <style>
      :root {{
        color-scheme: light;
        --page-bg: #f3f5f8;
        --card-bg: #ffffff;
        --text: #101820;
        --muted: #52606d;
        --accent: #b45309;
        --line-border: rgba(16, 24, 32, 0.08);
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        background: linear-gradient(180deg, #f8fafc 0%, var(--page-bg) 100%);
        color: var(--text);
        font: 16px/1.55 "Segoe UI", system-ui, sans-serif;
        padding: 20px;
      }}
      main {{
        max-width: 880px;
        margin: 0 auto;
        background: var(--card-bg);
        border-radius: 24px;
        box-shadow: 0 16px 60px rgba(15, 23, 42, 0.10);
        padding: 24px 20px 28px;
      }}
      h1 {{
        margin: 0;
        font-size: 28px;
        line-height: 1.1;
      }}
      .subtitle {{
        margin: 8px 0 22px;
        color: var(--muted);
        font-size: 14px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }}
      .transcript {{
        display: grid;
        gap: 12px;
      }}
      .transcript-line {{
        margin: 0;
        padding: 14px 16px;
        border: 1px solid var(--line-border);
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.96);
      }}
      .transcript-timestamp {{
        display: inline-block;
        min-width: 86px;
        margin-right: 10px;
        color: var(--accent);
        font-weight: 700;
      }}
      .transcript-speaker {{
        margin-right: 8px;
        font-weight: 800;
      }}
      .transcript-empty {{
        margin: 0;
        color: var(--muted);
      }}
    </style>
  </head>
  <body>
    <main>
      <h1>{html.escape(title)}</h1>
      <p class="subtitle">{html.escape(subtitle)}</p>
      <section class="transcript">{transcript_html}</section>
    </main>
  </body>
</html>
"""


MEETING_TRANSCRIPT_LINE_RE = re.compile(
    r"^\s*(?:\[(?P<start>\d{1,2}:\d{2}(?::\d{2})?)(?:-(?P<end>\d{1,2}:\d{2}(?::\d{2})?))?\]\s*)?(?P<speaker>[^:\n]{1,80}):\s*(?P<text>.+?)\s*$"
)


def _meeting_timestamp_to_seconds(label: str) -> float | None:
    clean = str(label or "").strip()
    if not clean:
        return None
    parts = clean.split(":")
    if len(parts) == 2:
        hours = 0
        minutes, seconds = parts
    elif len(parts) == 3:
        hours, minutes, seconds = parts
    else:
        return None
    try:
        return int(hours) * 3600 + int(minutes) * 60 + int(seconds)
    except Exception:
        return None


def _parse_meeting_transcript_turns(transcript_text: str) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for raw_line in str(transcript_text or "").splitlines():
        match = MEETING_TRANSCRIPT_LINE_RE.match(raw_line)
        if not match:
            continue
        speaker = str(match.group("speaker") or "").strip()
        text = str(match.group("text") or "").strip()
        if not speaker or not text:
            continue
        start = _meeting_timestamp_to_seconds(match.group("start") or "")
        end = _meeting_timestamp_to_seconds(match.group("end") or "")
        row: dict[str, object] = {
            "speaker": speaker,
            "label": speaker,
            "text": text,
            "confidence": None,
        }
        if start is not None:
            row["start"] = start
            row["start_ms"] = round(start * 1000)
        if end is not None:
            row["end"] = end
            row["end_ms"] = round(end * 1000)
        rows.append(row)
    return rows


def _meeting_diarization_status_from_text(transcript_text: str, speaker_turns: list[dict[str, object]]) -> str:
    if speaker_turns:
        return "speaker_turns"
    return "plain_transcript" if str(transcript_text or "").strip() else "no_transcript"


def _meeting_title_stem(title: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9]+", "_", str(title or "").strip()).strip("_")
    return clean[:72] or "Meeting_Recording"


def _meeting_date_label(record: dict[str, object]) -> str:
    for key in ("started_at", "created_at"):
        raw = str(record.get(key) or "").strip()
        if not raw:
            continue
        match = re.match(r"(\d{4})-(\d{2})-(\d{2})", raw)
        if match:
            year, month, day = match.groups()
            return f"{month}.{day}.{year[-2:]}"
    return ""


def _meeting_canonical_basename(record: dict[str, object], title: str) -> str:
    stem = _meeting_title_stem(title)
    date_label = _meeting_date_label(record)
    if date_label:
        date_token = _meeting_title_stem(date_label)
        if date_token and stem.lower().endswith(date_token.lower()):
            return stem
    return f"{stem}_{date_label}" if date_label else stem


def _meeting_title_quality(title: object, meeting_id: object) -> str:
    value = str(title or "").strip()
    if not value:
        return "machine_like"
    lower = value.lower()
    clean_meeting_id = str(meeting_id or "").strip().lower()
    if clean_meeting_id and lower == clean_meeting_id:
        return "machine_like"
    if re.fullmatch(r"meeting[-_][a-z0-9._:-]{6,}", lower):
        return "machine_like"
    if re.search(r"\b[0-9a-f]{8,}\b", lower):
        return "machine_like"
    return "human_like"


def _meeting_audio_attachment_payload(record: dict[str, object], canonical_basename: str) -> dict[str, object]:
    meeting_id = str(record.get("meeting_id") or "").strip()
    audio_path = str(record.get("audio_path") or "").strip()
    audio_url = str(record.get("audio_url") or "").strip()
    if not audio_path and not audio_url:
        return {}
    payload: dict[str, object] = {
        "id": f"{meeting_id}:audio" if meeting_id else "meeting-audio",
        "artifact": f"pucky_card_{meeting_id}:meeting_audio" if meeting_id else "",
        "title": "Meeting Audio",
        "kind": "audio",
        "mime_type": str(record.get("mime_type") or "audio/mp4"),
        "meeting_id": meeting_id,
        "canonical_basename": canonical_basename,
        "recording_title": str(record.get("recording_title") or ""),
    }
    if audio_path:
        payload["path"] = audio_path
    if audio_url:
        payload["url"] = audio_url
    return payload


def _log_json(payload: dict[str, object]) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def _public_turn_status(telemetry: dict[str, object]) -> dict[str, object]:
    allowed = (
        "session_id",
        "content_type",
        "request_audio_bytes",
        "input_text_chars",
        "reply_mode",
        "requested_model",
        "requested_reasoning_effort",
        "requested_thread_mode",
        "requested_thread_id",
        "thread_scope_source",
        "thread_scope_card_id",
        "proof_reply_delay_enabled",
        "proof_reply_delay_ms_requested",
        "proof_reply_delay_ms_applied",
        "proof_reply_delay_elapsed_ms",
        "proof_reply_delay_ignored",
        "thread_mode",
        "thread_reused",
        "thread_fallback_reason",
        "upload_received_ms",
        "stt_start_ms",
        "stt_end_ms",
        "stt_ms",
        "debug_fixture_transcript_used",
        "transcript_chars",
        "user_transcript",
        "codex_start_ms",
        "codex_end_ms",
        "codex_ms",
        "codex_thread_id",
        "origin_thread_id",
        "origin_reasoning_effort",
        "raw_reply_chars",
        "reply_chars",
        "tts_start_ms",
        "tts_end_ms",
        "tts_ms",
        "reply_audio_bytes",
        "audio_mime_type",
        "tts_status",
        "attachment_count",
        "displayable_attachment_count",
        "attachment_fallback_from_reply_text",
        "response_bytes",
        "total_ms",
        "card_id",
        "feed_persisted",
        "failed_stage",
        "error_type",
        "error_message",
        "failure_reason",
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
        "requested_model",
        "requested_reasoning_effort",
        "requested_thread_mode",
        "requested_thread_id",
        "thread_scope_source",
        "thread_scope_card_id",
        "proof_reply_delay_enabled",
        "proof_reply_delay_ms_requested",
        "proof_reply_delay_ms_applied",
        "proof_reply_delay_elapsed_ms",
        "proof_reply_delay_ignored",
        "thread_mode",
        "thread_reused",
        "thread_fallback_reason",
        "upload_received_ms",
        "stt_start_ms",
        "stt_end_ms",
        "stt_ms",
        "debug_fixture_transcript_used",
        "transcript_chars",
        "codex_start_ms",
        "codex_end_ms",
        "codex_ms",
        "codex_thread_id",
        "origin_thread_id",
        "origin_model",
        "origin_reasoning_effort",
        "raw_reply_chars",
        "reply_chars",
        "tts_start_ms",
        "tts_end_ms",
        "tts_ms",
        "reply_audio_bytes",
        "audio_mime_type",
        "tts_status",
        "attachment_count",
        "displayable_attachment_count",
        "attachment_fallback_from_reply_text",
        "response_bytes",
        "total_ms",
        "card_id",
        "feed_persisted",
        "failed_stage",
        "error_type",
        "error_message",
        "failure_reason",
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
    for key in ("meeting_id", "card_kind", "meeting_state", "failure_stage"):
        value = str(origin.get(key) or "").strip()
        if value:
            normalized[key] = value
    return normalized


def make_handler(service: PuckyVoiceService):
    return _build_http_handler(
        service,
        broker=_load_broker_module(),
        allowed_content_types=ALLOWED_CONTENT_TYPES,
    )


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
