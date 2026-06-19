from __future__ import annotations

import re
from pathlib import Path


BASE_INSTRUCTIONS_FILE_ENV = "PUCKY_CODEX_BASE_INSTRUCTIONS_FILE"
MEETING_DEVELOPER_INSTRUCTIONS_FILE_ENV = "PUCKY_MEETING_CODEX_DEVELOPER_INSTRUCTIONS_FILE"
DEFAULT_MEETING_DEVELOPER_INSTRUCTIONS_PATH = (
    Path(__file__).resolve().parents[1] / "docs" / "pucky-meeting-developer-instructions.txt"
)
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


def load_optional_instruction_file(path: str | None, *, env_name: str) -> str | None:
    clean = str(path or "").strip()
    if not clean:
        return None
    resolved = Path(clean).expanduser()
    if not resolved.exists():
        return None
    text = resolved.read_text(encoding="utf-8").strip()
    if not text:
        raise RuntimeError(f"{env_name} is empty: {resolved}")
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
