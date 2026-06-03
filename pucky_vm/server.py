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
from .http_surface import (
    cors_header_items,
    inline_content_disposition,
    is_bearer_authorized,
    json_body,
    parse_content_length,
    request_base_url,
    text_body,
)
from .providers import DeepgramSTT, KokoroTTS
from .sqlite_utils import SQLITE_LOCK_RETRY_DELAYS_SECONDS, sqlite_lock_error
from .ui_runtime_surface import latest_ui_bundle_path, latest_ui_manifest, runtime_reply_cards_fixture_text
from .ui_bundle import UI_SRC, bundle_config_script


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
BASE_INSTRUCTIONS_FILE_ENV = "PUCKY_CODEX_BASE_INSTRUCTIONS_FILE"
ALLOWED_CONTENT_TYPES = {"audio/mp4", "audio/wav", "audio/x-wav", "audio/mpeg", "application/octet-stream"}
DEFAULT_CARD_ICON = "mail"
DEFAULT_CARD_ICON_ACCENT = "#72c2ff"
REPLY_MODE_CARD_ONLY = "card_only"
REPLY_MODE_CARD_AND_SPOKEN = "card_and_spoken"
DEFAULT_OPENAI_TURN_MODEL = "gpt-5.4-mini"
DEFAULT_OPENAI_TURN_REASONING_EFFORT = "low"
OPENAI_TURN_MODELS = ("gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano")
OPENAI_TURN_REASONING_EFFORTS = ("none", "low", "medium", "high", "xhigh")
MAX_CARD_TITLE_CHARS = 64
MAX_CARD_ICON_NAME_CHARS = 48
CARD_ICON_NAME_RE = re.compile(r"^[a-z0-9_]{1,48}$")
CARD_ICON_ACCENT_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
DISPLAYABLE_ATTACHMENT_PATH_RE = re.compile(r"(/[^\\s\"'<>()[\\]{}]+)")
BROKER_MODULE_PATH = Path(__file__).resolve().parents[1] / "pucky-apk" / "fly-broker" / "pucky_fly_broker.py"
LINKS_AUTH_SCHEME_LABELS = {
    "OAUTH2": "OAuth",
    "API_KEY": "API key",
    "BASIC": "Basic",
    "BEARER_TOKEN": "Token",
    "NO_AUTH": "No auth",
}
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
REQUIRED_PUCKY_BASE_PLACEHOLDERS = (
    "{{PUCKY_AGENT_RUNTIME_CATALOG}}",
    "{{PUCKY_ACTION_LOG_RECENT}}",
    "{{PUCKY_REPLY_CARD_ICONS}}",
)
OPTIONAL_PUCKY_BASE_PLACEHOLDERS = (
    "{{PUCKY_COMPOSIO_CONNECTED_APPS}}",
    "{{PUCKY_COMPOSIO_AVAILABLE_APPS}}",
)
PUCKY_BASE_PLACEHOLDERS = REQUIRED_PUCKY_BASE_PLACEHOLDERS + OPTIONAL_PUCKY_BASE_PLACEHOLDERS
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


def load_codex_base_instructions_file(path: str | None) -> str | None:
    clean = str(path or "").strip()
    if not clean:
        return None
    resolved = Path(clean).expanduser()
    if not resolved.exists():
        raise RuntimeError(f"{BASE_INSTRUCTIONS_FILE_ENV} not found: {resolved}")
    text = resolved.read_text(encoding="utf-8").strip()
    if not text:
        raise RuntimeError(f"{BASE_INSTRUCTIONS_FILE_ENV} is empty: {resolved}")
    return text


def compose_pucky_base_instructions(base_text: str | None, runtime_context: dict[str, object]) -> str | None:
    base = str(base_text or "").strip()
    if not base:
        return None
    missing = [placeholder for placeholder in REQUIRED_PUCKY_BASE_PLACEHOLDERS if placeholder not in base]
    if missing:
        raise RuntimeError("Pucky base instructions missing runtime placeholders: " + ", ".join(missing))
    rendered = base
    replacements = {
        "{{PUCKY_AGENT_RUNTIME_CATALOG}}": _render_agent_runtime_catalog(runtime_context),
        "{{PUCKY_ACTION_LOG_RECENT}}": _render_action_log(runtime_context),
        "{{PUCKY_REPLY_CARD_ICONS}}": _render_reply_card_icons(runtime_context),
    }
    if "{{PUCKY_COMPOSIO_CONNECTED_APPS}}" in base:
        replacements["{{PUCKY_COMPOSIO_CONNECTED_APPS}}"] = _render_connected_apps(runtime_context)
    if "{{PUCKY_COMPOSIO_AVAILABLE_APPS}}" in base:
        replacements["{{PUCKY_COMPOSIO_AVAILABLE_APPS}}"] = _render_available_apps(runtime_context)
    for placeholder, value in replacements.items():
        rendered = rendered.replace(placeholder, value)
    unresolved = sorted(set(re.findall(r"\{\{PUCKY_[A-Z0-9_]+\}\}", rendered)))
    if unresolved:
        raise RuntimeError("Pucky base instructions unresolved runtime placeholders: " + ", ".join(unresolved))
    return rendered.strip()


def _prompt_value(value: object) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text.replace("|", "/")


def _runtime_block(context: dict[str, object], key: str) -> dict[str, object]:
    block = context.get(key)
    return block if isinstance(block, dict) else {}


def _render_agent_runtime_catalog(context: dict[str, object]) -> str:
    actions = list(_runtime_block(context, "agent_runtime").get("actions") or [])
    lines = []
    for item in actions:
        if not isinstance(item, dict):
            continue
        name = _prompt_value(item.get("name"))
        kind = _prompt_value(item.get("kind"))
        if name:
            lines.append(f"- {name}" + (f" | {kind}" if kind else ""))
    return "\n".join(lines) if lines else "- None"


def _render_action_log(context: dict[str, object]) -> str:
    rows = list(_runtime_block(context, "action_log").get("rows") or [])
    if not rows:
        return "- No actions recorded yet."
    lines = []
    for row in rows[:150]:
        if not isinstance(row, dict):
            continue
        thread_title = _prompt_value(row.get("thread_title"))
        thread_id = _prompt_value(row.get("thread_id"))
        if thread_title and thread_id:
            thread = f"{thread_title} ({thread_id})"
        else:
            thread = thread_title or thread_id or "-"
        parts = [
            _prompt_value(row.get("timestamp")),
            thread,
            _prompt_value(row.get("surface")),
            _prompt_value(row.get("tool")),
            _prompt_value(row.get("target") or row.get("action")),
            _prompt_value(row.get("status")),
        ]
        lines.append("- " + " | ".join(part or "-" for part in parts))
    return "\n".join(lines) if lines else "- No actions recorded yet."


def _render_connected_apps(context: dict[str, object]) -> str:
    composio = _runtime_block(context, "composio")
    apps = [item for item in list(composio.get("connected_apps") or []) if isinstance(item, dict)]
    diagnostics = composio.get("connected_app_diagnostics") if isinstance(composio.get("connected_app_diagnostics"), dict) else {}
    header = (
        f"Connected now: {int(diagnostics.get('unique_active_app_count') or len(apps))} active Composio apps "
        f"({int(diagnostics.get('active_account_rows') or 0)} active account rows)."
    )
    if not apps:
        return header + "\n- None"
    lines = [header]
    for app in apps:
        name = _prompt_value(app.get("name") or app.get("slug"))
        slug = _prompt_value(app.get("slug"))
        status = _prompt_value(app.get("status") or "active")
        count = int(app.get("active_account_count") or 1)
        ids = ", ".join(_prompt_value(item) for item in list(app.get("connected_account_ids") or []) if _prompt_value(item))
        account_label = "account" if count == 1 else "accounts"
        lines.append(f"- {name} ({slug}) | {status} | {count} {account_label}" + (f" | {ids}" if ids else ""))
    return "\n".join(lines)


def _render_available_apps(context: dict[str, object]) -> str:
    composio = _runtime_block(context, "composio")
    universe = [item for item in list(composio.get("app_universe") or []) if isinstance(item, dict)]
    available = [item for item in list(composio.get("available_apps") or []) if isinstance(item, dict)]
    lines = [f"Available to connect: {len(available)} of {len(universe)} connectable Composio apps."]
    if not available:
        lines.append("- None")
        return "\n".join(lines)
    for app in available:
        name = _prompt_value(app.get("name") or app.get("slug"))
        slug = _prompt_value(app.get("slug"))
        if name and slug:
            lines.append(f"- {name} | {slug}")
    return "\n".join(lines)


def _render_reply_card_icons(context: dict[str, object]) -> str:
    icons = [item for item in list(_runtime_block(context, "reply_card").get("icons") or []) if isinstance(item, dict)]
    lines = []
    for icon in icons:
        name = _prompt_value(icon.get("name"))
        label = _prompt_value(icon.get("label") or name)
        accent = _prompt_value(icon.get("accent"))
        if name:
            lines.append(f"- {name} | {label}" + (f" | {accent}" if accent else ""))
    return "\n".join(lines) if lines else "- None"

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
    html_title: str = ""
    html_content: str = ""
    attachments: tuple[dict[str, object], ...] = field(default_factory=tuple)
    meeting_result: dict[str, object] = field(default_factory=dict)


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
    composio_default_auth_mode: str = "browser"
    proof_reply_delay_enabled: bool = False

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            host=os.environ.get("PUCKY_HOST", "0.0.0.0"),
            port=int(os.environ.get("PORT", os.environ.get("PUCKY_PORT", "8080"))),
            pucky_api_token=os.environ.get("PUCKY_API_TOKEN", ""),
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
            turn_status_ttl_seconds=float(os.environ.get("PUCKY_TURN_STATUS_TTL_SECONDS", "900")),
            codex_home=os.environ.get("CODEX_HOME") or None,
            codex_sandbox=os.environ.get("PUCKY_CODEX_SANDBOX", "danger-full-access"),
            codex_approval_policy=os.environ.get("PUCKY_CODEX_APPROVAL_POLICY", "never"),
            codex_model=os.environ.get("PUCKY_CODEX_MODEL", DEFAULT_OPENAI_TURN_MODEL).strip() or DEFAULT_OPENAI_TURN_MODEL,
            codex_reasoning_effort=os.environ.get("PUCKY_CODEX_REASONING_EFFORT", DEFAULT_OPENAI_TURN_REASONING_EFFORT).strip() or DEFAULT_OPENAI_TURN_REASONING_EFFORT,
            composio_api_key=os.environ.get("COMPOSIO_API_KEY", "").strip(),
            composio_base_url=os.environ.get("COMPOSIO_BASE_URL", DEFAULT_COMPOSIO_BASE_URL).strip() or DEFAULT_COMPOSIO_BASE_URL,
            composio_default_user_id=os.environ.get("PUCKY_COMPOSIO_USER_ID", "jimmythompson323").strip() or "jimmythompson323",
            connect_portal_secret=(
                os.environ.get("PUCKY_CONNECT_PORTAL_SECRET", "").strip()
                or os.environ.get("PUCKY_API_TOKEN", "").strip()
            ),
            connect_portal_ttl_seconds=max(300, int(os.environ.get("PUCKY_CONNECT_PORTAL_TTL_SECONDS", str(12 * 60 * 60)))),
            composio_default_auth_mode=os.environ.get("PUCKY_COMPOSIO_PORTAL_AUTH_MODE", "browser").strip().lower() or "browser",
            proof_reply_delay_enabled=(
                os.environ.get("PUCKY_PROOF_REPLY_DELAY_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}
            ),
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


def _base64url_encode_bytes(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _base64url_encode_json(payload: dict[str, object]) -> str:
    return _base64url_encode_bytes(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))


def _base64url_decode_text(value: str) -> bytes:
    token = str(value or "").strip()
    if not token:
        raise ValueError("empty token segment")
    padding = "=" * (-len(token) % 4)
    return base64.urlsafe_b64decode(token + padding)


def _encode_signed_token(header: dict[str, object], payload: dict[str, object], secret: str) -> str:
    encoded_header = _base64url_encode_json(header)
    encoded_payload = _base64url_encode_json(payload)
    signing_input = f"{encoded_header}.{encoded_payload}".encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    return f"{encoded_header}.{encoded_payload}.{_base64url_encode_bytes(signature)}"


def _decode_signed_token(token: str, secret: str) -> dict[str, object] | None:
    if not token or not secret:
        return None
    parts = str(token).split(".")
    if len(parts) != 3:
        return None
    header_segment, payload_segment, signature_segment = parts
    signing_input = f"{header_segment}.{payload_segment}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    try:
        provided = _base64url_decode_text(signature_segment)
        payload = json.loads(_base64url_decode_text(payload_segment).decode("utf-8"))
    except Exception:
        return None
    if not hmac.compare_digest(expected, provided):
        return None
    if not isinstance(payload, dict):
        return None
    try:
        if int(payload.get("exp") or 0) < int(time.time()):
            return None
    except Exception:
        return None
    return payload


def _links_auth_label(managed_auth_schemes: list[str] | None, auth_schemes: list[str] | None) -> str:
    labels: list[str] = []
    seen: set[str] = set()
    for source in (list(managed_auth_schemes or []), list(auth_schemes or [])):
        for raw in source:
            key = str(raw or "").strip().upper()
            if not key or key in seen:
                continue
            label = LINKS_AUTH_SCHEME_LABELS.get(key)
            if not label:
                continue
            seen.add(key)
            labels.append(label)
    return " + ".join(labels)


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
        self.codex = codex or CodexAppServerClient(
            command=config.codex_command,
            cwd=config.codex_cwd,
            startup_timeout=config.codex_startup_timeout,
            turn_timeout=config.codex_turn_timeout,
            developer_instructions=config.developer_instructions,
            base_instructions_provider=self.codex_base_instructions_for_thread,
            output_schema=reply_output_schema(),
            codex_home=config.codex_home,
            sandbox=config.codex_sandbox,
            approval_policy=config.codex_approval_policy,
            model=config.codex_model,
            reasoning_effort=config.codex_reasoning_effort,
            action_logger=self._record_codex_action,
            tools_provider=self.codex_tools_for_thread,
            dynamic_tool_handler=self.handle_codex_dynamic_tool_call,
        )
        self.feed = FeedStore(config.feed_db_path)
        self.composio = composio or ComposioClient(
            config.composio_api_key,
            config.composio_base_url,
            action_logger=self._record_composio_action,
        )
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

    def start(self) -> None:
        self.codex.start()

    def health(self) -> dict[str, object]:
        return {
            "ok": self.codex.ready,
            "codex_app_server": "ready" if self.codex.ready else "not_ready",
            "thread": "per_turn",
            "feed_store": "ready",
            "feed_items_count": self.feed.count_items(),
            "deepgram_key": "present" if self.config.deepgram_api_key else "missing",
            "deepinfra_key": "present" if self.config.deepinfra_api_key else "missing",
            "pucky_api_token": "present" if self.config.pucky_api_token else "missing",
            "composio": "present" if self.config.composio_api_key else "missing",
        }

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
        else:
            raise RuntimeError(f"unsupported dynamic tool: {tool_name or '<empty>'}")
        return {
            "success": bool(result.get("ok")),
            "contentItems": [
                {
                    "type": "inputText",
                    "text": json.dumps(result, sort_keys=True),
                }
            ],
        }

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

    def _record_codex_action(self, event: dict[str, object]) -> None:
        thread_id = str(event.get("thread_id") or "")
        thread_title = str(event.get("thread_title") or "")
        if thread_id and not thread_title:
            thread_origin = getattr(self.codex, "thread_origin", None)
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
                "kind": "editable HTML/JS/CSS served by the VM and cached by the APK",
                "official_bundle_url": "/ui/pucky/latest/bundle.zip",
                "refresh_command": "ui.bundle.refresh",
                "shell_mode_command": "ui.shell.mode.set=web_cached",
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
                    "UI/feed/bundle",
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

    def links_my_apps(self, token: str) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        user_id = self._resolve_links_portal_user(token)
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

    def links_catalog(self, token: str) -> tuple[dict[str, object], dict[str, str]]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}, {}
        self._resolve_links_portal_user(token)
        payload, etag = self._links_catalog_snapshot()
        return payload, {
            "Cache-Control": "private, max-age=600",
            "ETag": etag,
        }

    def links_all_apps(self, token: str, *, query: str = "", offset: int = 0, limit: int = 60) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        user_id = self._resolve_links_portal_user(token)
        catalog_payload, _ = self._links_catalog_snapshot()
        my_payload = self.links_my_apps(token)
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

    def links_app_details(self, token: str, slug: str) -> dict[str, object]:
        if not self.composio.configured:
            return {"ok": False, "error": "composio_not_configured"}
        key = str(slug or "").strip().lower()
        if not key:
            raise ValueError("slug_required")
        my_payload = self.links_my_apps(token)
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
            path = Path(str(meeting.get("audio_path") or ""))
            if path.is_file():
                return path.read_bytes(), str(meeting.get("mime_type") or "audio/mp4"), path.name
        return None

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
        summary = "The meeting agent replied, but did not return structured transcript data yet."
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
                "stage": "meeting_result_validation",
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
            "stt_provider": "deepgram",
            "stt_model": getattr(self.stt, "model", ""),
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
                display_transcript_text="Meeting recording",
                force_unread=True,
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
            self._apply_meeting_agent_result(record, result)
            if record.get("transcript_status") == "missing_agent_result":
                record["state"] = "completed_with_missing_result"
                record["failure_reason"] = "meeting_agent_missing_result"
                record["failure_stage"] = "meeting_result_validation"
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
        _run_staged_operation(
            "meeting_index_write",
            lambda: self._upsert_meeting(record),
            sqlite_retry=True,
        )

    @staticmethod
    def _apply_meeting_agent_result(record: dict[str, object], result: dict[str, object]) -> None:
        meeting_result = result.get("meeting_result")
        if not isinstance(meeting_result, dict):
            record["transcript_status"] = "missing_agent_result"
            record["diarization_status"] = "missing_agent_result"
            return
        transcript_text = str(
            meeting_result.get("transcript_text")
            or meeting_result.get("transcript")
            or ""
        ).strip()
        raw_turns = meeting_result.get("speaker_turns")
        speaker_labels = _normalize_meeting_speaker_labels(meeting_result.get("speaker_labels"))
        speaker_turns = (
            _normalize_meeting_speaker_turns(raw_turns, speaker_labels)
            if isinstance(raw_turns, list)
            else []
        )
        canonical_transcript = _canonical_meeting_transcript_text(
            transcript_text=transcript_text,
            speaker_turns=speaker_turns,
        )
        normalized_result = dict(meeting_result)
        normalized_result["speaker_labels"] = dict(speaker_labels)
        normalized_result["speaker_turns"] = [dict(item) for item in speaker_turns]
        normalized_result["transcript_text"] = canonical_transcript
        record["meeting_result"] = dict(normalized_result)
        if normalized_result.get("title"):
            record["title"] = str(normalized_result.get("title") or "").strip()
        record["transcript_status"] = str(normalized_result.get("transcript_status") or ("completed" if canonical_transcript else "missing"))
        record["transcript_error"] = str(meeting_result.get("transcript_error") or "")
        record["transcript_text"] = canonical_transcript
        record["transcript_result"] = dict(normalized_result)
        record["diarization_requested"] = bool(normalized_result.get("diarization_requested", True))
        record["diarization_status"] = str(
            normalized_result.get("diarization_status")
            or ("speaker_turns" if speaker_turns else "no_speaker_turns")
        )
        record["speaker_turns"] = speaker_turns
        record["speaker_labels"] = dict(speaker_labels)
        for key in (
            "participants",
            "action_items",
            "pucky_directed_instructions",
            "executed_actions",
            "action_errors",
            "transcription_provider",
        ):
            if key in normalized_result:
                record[key] = normalized_result[key]

    def _prepare_meeting_reply_attachments(
        self,
        *,
        meeting_id: str,
        record: dict[str, object],
        envelope: ReplyEnvelope,
    ) -> tuple[list[dict[str, object]], dict[str, object]]:
        prepared: list[dict[str, object]] = []
        if envelope.html_content:
            prepared.append(
                normalize_attachment(
                    {
                        "id": f"{meeting_id}:html",
                        "artifact": f"pucky_card_{meeting_id}:html",
                        "mime_type": "text/html",
                        "title": envelope.html_title or envelope.card_title or "Meeting Summary",
                        "kind": "html",
                    }
                )
            )
        transcript_text = _canonical_meeting_transcript_text(
            transcript_text=str(
                envelope.meeting_result.get("transcript_text")
                or envelope.meeting_result.get("transcript")
                or ""
            ).strip(),
            speaker_turns=_normalize_meeting_speaker_turns(
                envelope.meeting_result.get("speaker_turns"),
                _normalize_meeting_speaker_labels(envelope.meeting_result.get("speaker_labels")),
            )
            if isinstance(envelope.meeting_result.get("speaker_turns"), list)
            else [],
        )
        transcript_path = ""
        if transcript_text:
            transcript_path = str(self._write_meeting_text_artifact(meeting_id, "transcript.txt", transcript_text))
            record["transcript_path"] = transcript_path
            prepared.append(
                normalize_attachment(
                    {
                        "id": f"{meeting_id}:transcript",
                        "path": transcript_path,
                        "artifact": f"pucky_card_{meeting_id}:meeting_transcript",
                        "mime_type": "text/plain",
                        "title": "Meeting Transcript",
                        "kind": "text",
                        "text": transcript_text,
                    }
                )
            )
        return prepared, {"fallback_from_reply_text": False, "transcript_path": transcript_path}

    def _write_meeting_text_artifact(self, meeting_id: str, suffix: str, content: str) -> Path:
        self._meetings_dir.mkdir(parents=True, exist_ok=True)
        safe_suffix = re.sub(r"[^A-Za-z0-9._-]+", "-", str(suffix or "artifact.txt")).strip("-") or "artifact.txt"
        path = self._meetings_dir / f"{meeting_id}-{safe_suffix}"
        path.write_text(str(content or ""), encoding="utf-8")
        return path

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
            "transcript_status",
            "transcript_error",
            "diarization_requested",
            "diarization_status",
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
            telemetry["event"] = "pucky.turn.failed"
            telemetry["status"] = "failed"
            telemetry["stage"] = str(telemetry.get("stage") or "stt_running")
            telemetry["error_type"] = exc.__class__.__name__
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
            telemetry["event"] = "pucky.turn.failed"
            telemetry["status"] = "failed"
            telemetry["stage"] = str(telemetry.get("stage") or "codex_running")
            telemetry["error_type"] = exc.__class__.__name__
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
        display_transcript_text: str | None = None,
        model: str | None = None,
        reasoning_effort: str | None = None,
        force_unread: bool = False,
        attachment_builder: Callable[[ReplyEnvelope], tuple[list[dict[str, object]], dict[str, object]]] | None = None,
        codex_stage: str = "codex_turn",
        feed_persist_stage: str = "feed_persist",
    ) -> dict[str, object]:
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
                existing_origin = self.codex.thread_origin(requested_thread_id, retries=1, delay=0.0)
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
                return self.codex.send_turn(
                    transcript,
                    thread_id=requested_thread_id or None,
                    model=model_override or None,
                    reasoning_effort=reasoning_override or None,
                    output_schema=output_schema,
                )
            except TypeError as exc:
                message = str(exc)
                if all(token not in message for token in ("thread_id", "output_schema", "model", "reasoning_effort")):
                    raise
                fallback_kwargs: dict[str, object] = {}
                if "thread_id" not in message and requested_thread_id:
                    fallback_kwargs["thread_id"] = requested_thread_id
                if "output_schema" not in message and isinstance(output_schema, dict):
                    fallback_kwargs["output_schema"] = output_schema
                return self.codex.send_turn(transcript, **fallback_kwargs)  # type: ignore[call-arg]

        codex_result = _run_staged_operation(codex_stage, _send_turn, sqlite_retry=True)
        if isinstance(codex_result, str):
            codex_result = CodexTurnResult(
                reply_text=codex_result,
                used_thread_id=str(self.codex.thread_id or requested_thread_id or ""),
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
        telemetry["has_html"] = bool(envelope.html_content)
        try:
            self.codex.set_thread_title(envelope.card_title, thread_id=codex_result.used_thread_id)
            telemetry["codex_thread_title_synced"] = True
        except Exception:
            telemetry["codex_thread_title_synced"] = False
        try:
            origin = self.codex.thread_origin(codex_result.used_thread_id)
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
        if envelope.html_content:
            html_bytes = envelope.html_content.encode("utf-8")
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
        if envelope.meeting_result:
            result["meeting_result"] = dict(envelope.meeting_result)
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
    ) -> dict[str, object]:
        return self._decorate_feed_payload(
            self.feed.list_feed(cursor, limit, include_archived=include_archived, compact=compact)
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
    meeting_result = data.get("meeting_result") if isinstance(data.get("meeting_result"), dict) else {}
    return ReplyEnvelope(
        reply_text,
        card_title,
        normalize_card_icon(data.get("card_icon")),
        html_title,
        html_content,
        tuple(attachments),
        dict(meeting_result),
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
        "required": ["reply_text", "card_title", "card_icon", "html", "attachments"],
    }


def meeting_reply_output_schema() -> dict[str, object]:
    schema = json.loads(json.dumps(reply_output_schema()))
    speaker_turn_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "speaker": {"type": ["string", "null"]},
            "label": {"type": ["string", "null"]},
            "text": {"type": ["string", "null"]},
            "start_ms": {"type": ["number", "null"]},
            "end_ms": {"type": ["number", "null"]},
            "start": {"type": ["number", "null"]},
            "end": {"type": ["number", "null"]},
            "confidence": {"type": ["number", "null"]},
        },
        "required": ["speaker", "label", "text", "start_ms", "end_ms", "start", "end", "confidence"],
    }
    action_schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "action": {"type": ["string", "null"]},
            "type": {"type": ["string", "null"]},
            "recipient": {"type": ["string", "null"]},
            "status": {"type": ["string", "null"]},
            "result": {"type": ["string", "null"]},
            "description": {"type": ["string", "null"]},
            "reason": {"type": ["string", "null"]},
            "blocked_on": {"type": ["string", "null"]},
            "draft": {"type": ["string", "null"]},
            "error": {"type": ["string", "null"]},
        },
        "required": ["action", "type", "recipient", "status", "result", "description", "reason", "blocked_on", "draft", "error"],
    }
    speaker_label_keys = [f"speaker_{index}" for index in range(10)]
    schema["properties"]["meeting_result"] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "title": {"type": ["string", "null"]},
            "transcript_status": {"type": ["string", "null"]},
            "transcript_text": {"type": ["string", "null"]},
            "diarization_requested": {"type": ["boolean", "null"]},
            "diarization_status": {"type": ["string", "null"]},
            "speaker_turns": {"type": ["array", "null"], "items": speaker_turn_schema},
            "speaker_labels": {
                "type": ["object", "null"],
                "additionalProperties": False,
                "properties": {
                    key: {"type": ["string", "null"]} for key in speaker_label_keys
                },
                "required": speaker_label_keys,
            },
            "participants": {"type": ["array", "null"], "items": {"type": "string"}},
            "action_items": {"type": ["array", "null"], "items": {"type": "string"}},
            "pucky_directed_instructions": {"type": ["array", "null"], "items": {"type": "string"}},
            "executed_actions": {"type": ["array", "null"], "items": action_schema},
            "action_errors": {"type": ["array", "null"], "items": action_schema},
            "transcription_provider": {"type": ["string", "null"]},
        },
        "required": [
            "title",
            "transcript_status",
            "transcript_text",
            "diarization_requested",
            "diarization_status",
            "speaker_turns",
            "speaker_labels",
            "participants",
            "action_items",
            "pucky_directed_instructions",
            "executed_actions",
            "action_errors",
            "transcription_provider",
        ],
    }
    schema["required"] = [*schema["required"], "meeting_result"]
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
    attachment: dict[str, object] = {"title": "Meeting audio"}
    device_path = _android_app_owned_path(record.get("device_path"))
    if device_path:
        attachment["title"] = "Your audio"
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
    if has_request_audio:
        attachment = {
            "id": f"{turn_id}:request_audio",
            "artifact": f"pucky_card_{turn_id}:request_audio",
            "mime_type": request_audio_mime_type or "audio/wav",
            "title": "Your audio",
            "kind": "audio",
        }
        if isinstance(request_audio_attachment, dict):
            for key, value in request_audio_attachment.items():
                if key in {"title", "path", "url", "src", "data_url"} and str(value or "").strip():
                    attachment[key] = value
        message["attachments"] = [
            normalize_attachment(attachment)
        ]
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
    return f"""Meeting Recording Agent Handoff

You are the Meeting Recording Agent. The platform has stored the audio file, but you own transcription, diarization, speaker naming, summary, action-item extraction, and Pucky-directed follow-up handling.

Meeting metadata:
- meeting_id: {record.get("meeting_id")}
- audio_path: {record.get("audio_path")}
- audio_url: {record.get("audio_url") or ""}
- device_path: {record.get("device_path") or ""}
- mime_type: {record.get("mime_type") or ""}
- duration_ms: {record.get("duration_ms") or 0}
- audio_bytes: {record.get("audio_bytes") or 0}

Required workflow:
- Use Deepgram or another available runtime transcription tool to transcribe the audio artifact.
- Request diarization / speaker turns. If speaker separation is unavailable, report an honest fallback.
- If speakers identify themselves or context makes names clear, relabel speaker_0 / speaker_1 to participant names; otherwise keep neutral speaker labels.
- Generate a concise human-facing meeting title, summary, participants, action items, and a diarized transcript.
- Explicitly inspect the transcript for instructions addressed to Pucky.
- Directly execute explicit and unambiguous Pucky-directed actions when the needed runtime/app tool and recipient are available. If a tool is unavailable, the request is ambiguous, or confirmation is required, include a clear draft or blocker instead of silently skipping it.
- Include links or attachments for the saved audio/transcript when useful.

Return only one strict JSON object, with the normal Pucky reply fields plus meeting_result:
{{
  "reply_text": "...",
  "card_title": "...",
  "card_icon": "mic",
  "html": {{"title": "...", "content": "..."}},
  "attachments": [],
  "meeting_result": {{
    "title": "...",
    "transcript_status": "completed",
    "transcript_text": "...",
    "diarization_requested": true,
    "diarization_status": "speaker_turns",
    "speaker_turns": [{{"speaker": "Jimmy", "start": 0.0, "end": 1.2, "text": "..."}}],
    "speaker_labels": {{"speaker_0": "Jimmy"}},
    "participants": [],
    "action_items": [],
    "pucky_directed_instructions": [],
    "executed_actions": [],
    "action_errors": [],
    "transcription_provider": "deepgram"
  }}
}}
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
        "error_type",
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


def _links_portal_document(*, token: str, auth_mode: str, back_url: str, just_connected: str = "") -> str:
    token_q = quote(token, safe="")
    back_q = html.escape(back_url, quote=True)
    connected_label = html.escape(just_connected, quote=True)
    initial_mode = "browser" if auth_mode == "browser" else "webview"
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>Pucky Links</title>
    <style>
      :root {{
        color-scheme: dark;
        --bg: #070d14;
        --panel: #0f1722;
        --panel-2: #101b29;
        --line: rgba(245, 249, 255, 0.09);
        --text: #f5f9ff;
        --muted: #90a4bb;
        --accent: #76c6ff;
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--text);
        font-family: Inter, Segoe UI, Arial, sans-serif;
      }}
      .shell {{
        min-height: 100vh;
        padding: 14px 14px 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }}
      .topbar,
      .msg,
      .section,
      .search-wrap {{
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--panel);
      }}
      .topbar {{
        padding: 12px;
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr);
        gap: 10px;
        align-items: start;
      }}
      .back {{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 34px;
        height: 34px;
        border-radius: 11px;
        border: 1px solid var(--line);
        text-decoration: none;
        color: var(--text);
        background: var(--panel-2);
      }}
      h1 {{
        margin: 0;
        font-size: 21px;
        line-height: 1;
        font-weight: 850;
      }}
      .subtle {{
        margin: 5px 0 0;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.35;
      }}
      .msg {{
        display: none;
        padding: 9px 11px;
        font-size: 12px;
        line-height: 1.35;
      }}
      .msg.show {{ display: block; }}
      .msg.ok {{ border-color: rgba(80, 216, 106, 0.32); color: #d8ffe1; }}
      .msg.error {{ border-color: rgba(255, 111, 111, 0.35); color: #ffd7d7; }}
      .search-wrap {{
        padding: 0 12px;
      }}
      .search {{
        width: 100%;
        min-height: 40px;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--text);
        font-size: 14px;
      }}
      .search::placeholder {{ color: var(--muted); }}
      .section {{
        padding: 10px 11px;
      }}
      .section-head {{
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }}
      .section-label {{
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
      }}
      .count {{
        color: var(--muted);
        font-size: 11px;
      }}
      .connected-strip {{
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }}
      .connected-chip {{
        min-height: 28px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: var(--panel-2);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        white-space: nowrap;
      }}
      .mark::before {{
        content: '\\2713';
        color: var(--accent);
        font-weight: 800;
      }}
      .list {{
        display: flex;
        flex-direction: column;
      }}
      .app-row {{
        width: 100%;
        border: 0;
        border-top: 1px solid rgba(245, 249, 255, 0.06);
        background: transparent;
        color: var(--text);
        min-height: 44px;
        padding: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        text-align: left;
        cursor: pointer;
      }}
      .app-row:first-child {{ border-top: 0; }}
      .app-row:disabled {{
        opacity: 0.7;
        cursor: progress;
      }}
      .app-name {{
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
        font-weight: 700;
      }}
      .status-mark {{
        min-width: 18px;
        text-align: right;
      }}
      .status-mark.mark::before {{
        content: '\\2713';
        color: var(--accent);
        font-weight: 800;
      }}
      .empty {{
        padding: 10px 0 4px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.4;
      }}
      .hide {{ display: none !important; }}
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <a class="back" href="{back_q}" aria-label="Back to Pucky">&lt;</a>
        <div>
          <h1>Links</h1>
          <p class="subtle">Quick search. Tap an app name to jump into the Composio connect flow.</p>
        </div>
      </header>
      <div id="portal-msg" class="msg" aria-live="polite"></div>
      <section id="connected-section" class="section hide">
        <div class="section-head">
          <span class="section-label">Connected</span>
        </div>
        <div id="connected-strip" class="connected-strip"></div>
      </section>
      <label class="search-wrap" for="search">
        <input id="search" class="search" type="search" placeholder="Search apps" autocomplete="off" spellcheck="false">
      </label>
      <section class="section">
        <div class="section-head">
          <span class="section-label">All Apps</span>
          <span id="count" class="count"></span>
        </div>
        <div id="app-list" class="list">
          <div class="empty">Loading apps...</div>
        </div>
      </section>
    </main>
    <script>
      const token = '{token_q}';
      const initialAuthMode = '{initial_mode}';
      const justConnected = '{connected_label}';
      const pending = new Map();
      let seq = 0;
      let authMode = initialAuthMode === 'browser' ? 'browser' : 'webview';
      let allApps = [];
      let connectedApps = [];
      let connectedSlugs = new Set();
      let lastRefreshAt = 0;

      const msg = document.getElementById('portal-msg');
      const connectedSection = document.getElementById('connected-section');
      const connectedStrip = document.getElementById('connected-strip');
      const searchInput = document.getElementById('search');
      const appList = document.getElementById('app-list');
      const count = document.getElementById('count');

      window.Pucky = window.Pucky || {{}};
      if (typeof window.Pucky.request !== 'function') {{
        window.Pucky.request = function request(payload) {{
          const command = payload && payload.command;
          const args = payload && payload.args ? payload.args : {{}};
          if (window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === 'function') {{
            const id = String(++seq);
            const message = JSON.stringify({{ id, command, args }});
            return new Promise((resolve, reject) => {{
              pending.set(id, {{ resolve, reject }});
              window.PuckyAndroid.postMessage(message);
              setTimeout(() => {{
                if (pending.has(id)) {{
                  pending.delete(id);
                  reject(new Error('Pucky native bridge timed out'));
                }}
              }}, 15000);
            }});
          }}
          if (command === 'browser.open') {{
            const url = String(args.url || '').trim();
            if (!url) throw new Error('browser.open requires url');
            try {{
              window.open(url, '_blank', 'noopener,noreferrer');
            }} catch (_err) {{
              window.location.assign(url);
            }}
            return Promise.resolve({{ launched: true, uri: url }});
          }}
          return Promise.reject(new Error('Pucky bridge unavailable'));
        }};
      }}
      if (typeof window.Pucky.__resolve !== 'function') {{
        window.Pucky.__resolve = function resolve(id, payload) {{
          const slot = pending.get(String(id));
          if (!slot) return;
          pending.delete(String(id));
          if (payload && payload.ok) slot.resolve(payload.result || {{}});
          else slot.reject(new Error((payload && payload.error) || 'Native command failed'));
        }};
      }}

      function showMessage(text, kind) {{
        msg.className = 'msg show ' + (kind || '');
        msg.textContent = String(text || '');
      }}

      function hideMessage() {{
        msg.className = 'msg';
        msg.textContent = '';
      }}

      function escapeHtml(value) {{
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }}

      function buildConnectHref(slug) {{
        return '/links/connect/apps?token=' + token + '&app=' + encodeURIComponent(slug) + '&auth_mode=' + encodeURIComponent(authMode);
      }}

      async function apiJson(url, options) {{
        const response = await fetch(url, options || {{ cache: 'no-store' }});
        const payload = await response.json().catch(() => ({{}}));
        if (!response.ok || payload.ok === false) {{
          throw new Error(String((payload && (payload.error || payload.detail || payload.message)) || 'Request failed'));
        }}
        return payload;
      }}

      function renderConnected() {{
        if (!connectedApps.length) {{
          connectedSection.classList.add('hide');
          connectedStrip.innerHTML = '';
          return;
        }}
        connectedSection.classList.remove('hide');
        connectedStrip.innerHTML = connectedApps
          .map(app => "<span class='connected-chip'><span class='mark'></span><span>" + escapeHtml(app.name || app.slug) + "</span></span>")
          .join('');
      }}

      function renderList(query) {{
        const needle = String(query || '').trim().toLowerCase();
        const filtered = needle
          ? allApps.filter(app => String(app.name || '').toLowerCase().includes(needle) || String(app.slug || '').toLowerCase().includes(needle))
          : allApps;
        count.textContent = filtered.length ? String(filtered.length) : '';
        if (!filtered.length) {{
          appList.innerHTML = "<div class='empty'>No apps match your search.</div>";
          return;
        }}
        appList.innerHTML = filtered.map(app => {{
          const active = connectedSlugs.has(String(app.slug || ''));
          return "<button class='app-row' type='button' data-slug='" + escapeHtml(app.slug || '') + "'>" +
            "<span class='app-name'>" + escapeHtml(app.name || app.slug || '') + "</span>" +
            "<span class='status-mark" + (active ? " mark" : "") + "'></span>" +
          "</button>";
        }}).join('');
      }}

      async function loadConnected() {{
        const payload = await apiJson('/api/links/composio/my-apps?token=' + encodeURIComponent(token));
        const list = Array.isArray(payload.apps) ? payload.apps : [];
        const active = [];
        const seen = new Set();
        for (const item of list) {{
          const slug = String(item.slug || '').trim();
          const counts = item && typeof item.counts === 'object' ? item.counts : {{}};
          if (!slug || seen.has(slug) || Number(counts.active || 0) <= 0) continue;
          seen.add(slug);
          active.push({{ slug, name: item.name || slug }});
        }}
        connectedApps = active.sort((a, b) => String(a.name || a.slug).localeCompare(String(b.name || b.slug)));
        connectedSlugs = new Set(connectedApps.map(app => app.slug));
        renderConnected();
        renderList(searchInput.value || '');
        lastRefreshAt = Date.now();
      }}

      async function loadAllApps() {{
        const found = [];
        let offset = 0;
        let hasMore = true;
        let pages = 0;
        while (hasMore && pages < 30) {{
          const payload = await apiJson('/api/links/composio/all-apps?token=' + encodeURIComponent(token) + '&offset=' + offset + '&limit=100');
          const list = Array.isArray(payload.apps) ? payload.apps : [];
          if (!list.length) break;
          found.push(...list.map(item => ({{
            slug: String(item.slug || '').trim(),
            name: String(item.name || item.slug || '').trim(),
          }})).filter(item => item.slug && item.name));
          offset += list.length;
          hasMore = !!payload.has_more;
          pages += 1;
        }}
        allApps = found.sort((a, b) => a.name.localeCompare(b.name));
        renderList(searchInput.value || '');
      }}

      async function connectApp(slug, button) {{
        if (!slug) return;
        const href = buildConnectHref(slug);
        if (authMode === 'browser') {{
          const externalUrl = new URL(href, window.location.href).toString();
          if (window.Pucky && typeof window.Pucky.request === 'function') {{
            try {{
              await window.Pucky.request({{ command: 'browser.open', args: {{ url: externalUrl }} }});
              showMessage('Opened ' + slug + ' in the browser. Come back here when you are done.', 'ok');
              return;
            }} catch (error) {{
              const detail = String(error && error.message ? error.message : error || '');
              if (!/browser\\.open/i.test(detail)) {{
                throw error;
              }}
            }}
          }}
          window.location.assign(href);
          return;
        }}
        window.location.assign(href);
      }}

      async function refreshConnectedSoon() {{
        const age = Date.now() - lastRefreshAt;
        if (age < 1200) return;
        try {{
          await loadConnected();
        }} catch (_err) {{}}
      }}

      document.body.addEventListener('click', async event => {{
        const row = event.target.closest('.app-row');
        if (!row) return;
        const slug = row.getAttribute('data-slug');
        if (!slug) return;
        hideMessage();
        row.disabled = true;
        try {{
          await connectApp(slug, row);
        }} catch (error) {{
          showMessage(error.message || 'Could not open auth flow', 'error');
        }} finally {{
          row.disabled = false;
        }}
      }});

      searchInput.addEventListener('input', () => {{
        renderList(searchInput.value || '');
      }});

      document.addEventListener('visibilitychange', () => {{
        if (!document.hidden) {{
          window.setTimeout(() => {{
            refreshConnectedSoon();
          }}, 280);
        }}
      }});

      window.addEventListener('focus', () => {{
        window.setTimeout(() => {{
          refreshConnectedSoon();
        }}, 280);
      }});

      async function boot() {{
        if (justConnected) {{
          showMessage('Connected ' + justConnected + '. Refreshing your list...', 'ok');
        }}
        await Promise.all([loadConnected(), loadAllApps()]);
      }}

      boot().catch(error => {{
        showMessage(error.message || 'Failed loading apps', 'error');
        appList.innerHTML = "<div class='empty'>Connections are temporarily unavailable.</div>";
      }});
    </script>
  </body>
</html>"""


def make_handler(service: PuckyVoiceService):
    broker = _load_broker_module()

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
            if path == "/healthz":
                self._json(HTTPStatus.OK, service.health())
                return
            if path == "/api/agent-runtime/catalog":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                self._json(HTTPStatus.OK, service.agent_runtime_catalog())
                return
            if path == "/api/links/composio/portal-url":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                query = parse_qs(parsed.query)
                payload = service.links_portal_url(
                    request_base_url(self.headers, self.server.server_address),
                    auth_mode=query.get("auth_mode", [""])[0],
                )
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/links/connect/apps":
                query = parse_qs(parsed.query)
                token = query.get("token", [""])[0]
                app = query.get("app", [""])[0]
                auth_mode = query.get("auth_mode", [""])[0]
                just_connected = query.get("just_connected", [""])[0]
                redirect_url = query.get("redirect_url", [""])[0]
                base_url = request_base_url(self.headers, self.server.server_address)
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
                back_url = f"{base_url.rstrip('/')}/ui/pucky/latest/?route=feed"
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
                try:
                    payload = service.links_my_apps(query.get("token", [""])[0])
                except ValueError as exc:
                    self._json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": str(exc)})
                    return
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/api/links/composio/catalog":
                query = parse_qs(parsed.query)
                try:
                    payload, headers = service.links_catalog(query.get("token", [""])[0])
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
                try:
                    payload = service.links_all_apps(
                        query.get("token", [""])[0],
                        query=query.get("q", [""])[0],
                        offset=int(query.get("offset", ["0"])[0]),
                        limit=int(query.get("limit", ["60"])[0]),
                    )
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                    return
                status = HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY
                self._json(status, payload)
                return
            if path == "/api/links/composio/app-details":
                query = parse_qs(parsed.query)
                try:
                    payload = service.links_app_details(query.get("token", [""])[0], query.get("slug", [""])[0])
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
                        base_url=request_base_url(self.headers, self.server.server_address),
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
            if path == "/api/meetings":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                query = parse_qs(parsed.query)
                include_archived = _truthy_query(query.get("include_archived", ["0"])[0])
                compact = _truthy_query(query.get("compact", ["0"])[0])
                self._json(HTTPStatus.OK, service.meetings_list(include_archived=include_archived, compact=compact))
                return
            if path.startswith("/api/meetings/") and path.endswith("/audio"):
                if not self._is_authorized():
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
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                meeting_id = unquote(path.removeprefix("/api/meetings/")).strip()
                try:
                    self._json(HTTPStatus.OK, service.meeting_detail(meeting_id))
                except KeyError:
                    self._json(HTTPStatus.NOT_FOUND, {"error": "meeting_not_found"})
                return
            if path.startswith("/api/artifacts/"):
                if not self._is_authorized():
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
                if not self._is_authorized():
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
            if path == "/ui/pucky/latest/manifest.json":
                self._json(HTTPStatus.OK, latest_ui_manifest())
                return
            if path == "/ui/pucky/latest/bundle.zip":
                self._file(latest_ui_bundle_path(), "application/zip")
                return
            if path == "/ui/pucky/fixtures/reply_cards.json":
                self._text(
                    HTTPStatus.OK,
                    runtime_reply_cards_fixture_text(),
                    "application/json; charset=utf-8",
                )
                return
            if path == "/ui/pucky/latest" or path == "/ui/pucky/latest/":
                self._file(UI_SRC / "index.html", "text/html; charset=utf-8")
                return
            if path == "/ui/pucky/latest/pucky-config.js":
                self._text(HTTPStatus.OK, bundle_config_script(), "application/javascript; charset=utf-8")
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
                    result = service.meeting_ingest(payload, base_url=request_base_url(self.headers, self.server.server_address))
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
            if path == "/api/turn/text":
                if not self._is_authorized():
                    self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                    return
                try:
                    payload = json.loads(self._read_body(256 * 1024).decode("utf-8"))
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
            if content_type not in ALLOWED_CONTENT_TYPES:
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

        def _is_authorized(self) -> bool:
            return is_bearer_authorized(service.config.pucky_api_token, self.headers.get("Authorization", ""))

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

        def _text(self, status: HTTPStatus, text: str, content_type: str) -> None:
            body = text_body(text)
            self.send_response(int(status))
            self._cors_headers()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _html(self, status: HTTPStatus, html_text: str) -> None:
            self._text(status, html_text, "text/html; charset=utf-8")

        def _bytes(self, status: HTTPStatus, body: bytes, content_type: str, *, filename: str = "") -> None:
            self.send_response(int(status))
            self._cors_headers()
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            if filename:
                self.send_header("Content-Disposition", inline_content_disposition(filename))
            self.end_headers()
            self.wfile.write(body)

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
                self._file(target)
            except Exception as exc:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "ui_file_failed", "detail": str(exc)})

        def _file(self, path: Path, content_type: str | None = None) -> None:
            if not path.exists() or not path.is_file():
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            body = path.read_bytes()
            guessed = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self.send_response(int(HTTPStatus.OK))
            self._cors_headers()
            self.send_header("Content-Type", guessed)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _cors_headers(self) -> None:
            for key, value in cors_header_items():
                self.send_header(key, value)

    return Handler


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
