import os
from pathlib import Path

import pytest

from pucky_vm.server import Config, PuckyVoiceService, compose_pucky_base_instructions


_BASE_TEMPLATE = """# Base

## Agent Runtime
Exact runtime actions:

{{PUCKY_AGENT_RUNTIME_CATALOG}}

## Action Log
Last 150 meaningful system-wide actions for this user:

{{PUCKY_ACTION_LOG_RECENT}}

## Memory
Memory.

## Connected Apps
API key resource = `env:COMPOSIO_API_KEY`

Connected apps:

{{PUCKY_COMPOSIO_CONNECTED_APPS}}

Available apps:

{{PUCKY_COMPOSIO_AVAILABLE_APPS}}

## User Facing App HTML
HTML.

## Android APK
APK.

## Reply Format
Current icon/color choices:

{{PUCKY_REPLY_CARD_ICONS}}
"""


class _FakeSTT:
    def transcribe(self, audio: bytes, content_type: str) -> str:
        return ""


class _FakeTTS:
    def synthesize(self, text: str) -> tuple[bytes, str]:
        return b"", "audio/wav"


class _FakeCodex:
    ready = True
    thread_id = None
    last_turn_routing = {}

    def start(self) -> None:
        return None

    def send_turn(self, text: str, *, thread_id: str | None = None):  # pragma: no cover - unused seam
        raise AssertionError("not used")

    def set_thread_title(self, title: str, *, thread_id: str | None = None) -> None:
        return None

    def thread_origin(self, thread_id: str | None = None, *, retries: int = 5, delay: float = 0.15) -> dict[str, str]:
        return {}


class _FakeComposio:
    configured = True

    def list_apps(self) -> dict[str, object]:
        return {
            "apps": [
                {"slug": "gmail", "name": "Gmail", "connectable": True},
                {"slug": "slack", "name": "Slack", "connectable": True},
                {"slug": "internal", "name": "Internal", "connectable": False},
            ]
        }

    def list_connected_apps(self, user_id: str, *, force: bool = False) -> dict[str, object]:
        return {
            "connected_apps": [
                {"slug": "gmail", "name": "Gmail", "status": "active", "id": "acct_1"},
            ]
        }

    def invalidate_connected_cache(self, user_id: str) -> None:
        return None

    def start_oauth(self, user_id: str, app_slug: str, redirect_url: str | None = None) -> dict[str, object]:
        return {}

    def delete_connection(self, user_id: str, connection_id: str) -> dict[str, object]:
        return {}


class _LargeFakeComposio(_FakeComposio):
    def list_apps(self) -> dict[str, object]:
        apps = [
            {"slug": "gmail", "name": "Gmail", "connectable": True},
            {"slug": "notion", "name": "Notion", "connectable": True},
        ]
        apps.extend({"slug": f"app-{index}", "name": f"App {index}", "connectable": True} for index in range(971))
        return {"apps": apps}

    def list_connected_apps(self, user_id: str, *, force: bool = False) -> dict[str, object]:
        return {
            "connected_apps": [
                {"slug": "gmail", "name": "Gmail", "status": "active", "id": "acct_gmail_1"},
                {"slug": "gmail", "name": "Gmail", "status": "active", "id": "acct_gmail_2"},
                {"slug": "notion", "name": "Notion", "status": "active", "id": "acct_notion_1"},
            ]
        }


def _config(tmp_path: Path) -> Config:
    return Config(
        host="127.0.0.1",
        port=0,
        pucky_api_token="token",
        deepgram_api_key="",
        deepinfra_api_key="",
        max_audio_bytes=1024,
        max_html_bytes=1024,
        max_attachment_count=1,
        max_attachment_bytes=1024,
        max_attachment_viewer_bytes=1024,
        tts_voice="voice",
        tts_response_format="wav",
        tts_speed=1.0,
        codex_command=[],
        codex_cwd=None,
        codex_startup_timeout=1,
        codex_turn_timeout=1,
        developer_instructions="strict json contract",
        feed_db_path=str(tmp_path / "feed.sqlite"),
        codex_base_instructions=_BASE_TEMPLATE,
        action_ledger_path=str(tmp_path / "actions.sqlite"),
        composio_api_key="secret-api-key",
        composio_base_url="https://composio.test/api/v3",
        composio_default_user_id="user-1",
    )


def test_base_instruction_file_env_loads_without_replacing_developer_instructions(tmp_path):
    base_file = tmp_path / "base.md"
    base_file.write_text("Custom base instructions", encoding="utf-8")
    original = os.environ.copy()
    try:
        os.environ["PUCKY_CODEX_BASE_INSTRUCTIONS_FILE"] = str(base_file)
        os.environ["PUCKY_CODEX_DEVELOPER_INSTRUCTIONS"] = "strict json only"
        config = Config.from_env()
    finally:
        os.environ.clear()
        os.environ.update(original)

    assert config.codex_base_instructions == "Custom base instructions"
    assert config.developer_instructions == "strict json only"


def test_missing_base_instruction_file_fails_clearly(tmp_path):
    original = os.environ.copy()
    try:
        os.environ["PUCKY_CODEX_BASE_INSTRUCTIONS_FILE"] = str(tmp_path / "missing.md")
        with pytest.raises(RuntimeError, match="PUCKY_CODEX_BASE_INSTRUCTIONS_FILE"):
            Config.from_env()
    finally:
        os.environ.clear()
        os.environ.update(original)


def test_runtime_context_injects_composio_summary_without_literal_api_key(tmp_path):
    service = PuckyVoiceService(
        _config(tmp_path),
        stt=_FakeSTT(),
        tts=_FakeTTS(),
        codex=_FakeCodex(),
        composio=_FakeComposio(),
    )

    text = service.codex_base_instructions_for_thread()
    context = service._base_runtime_context()

    assert text is not None
    assert "Gmail" in text
    assert "Slack" in text
    assert "secret-api-key" not in text
    assert "env:COMPOSIO_API_KEY" in text
    assert "## Injected Runtime Context" not in text
    assert "```json" not in text
    assert "{{PUCKY_" not in text
    assert "\"agent_runtime\"" not in text
    assert "\"app_universe\"" not in text
    assert "- thread/fork | mutation" in text
    assert "thread/fork" in text
    assert "- mail | Mail | #72c2ff" in text
    assert "- Gmail (gmail) | active | 1 account | acct_1" in text
    assert "Available to connect: 1 of 2 connectable Composio apps." in text
    assert "- Slack | slack" in text
    assert "GET | /connected_accounts | ok" in text
    assert context["composio"]["connected_apps"] == [
        {
            "slug": "gmail",
            "name": "Gmail",
            "status": "active",
            "active_account_count": 1,
            "connected_account_ids": ["acct_1"],
        }
    ]
    assert context["composio"]["connected_app_diagnostics"] == {
        "active_account_rows": 1,
        "unique_active_app_count": 1,
        "status_counts": {"active": 1},
    }
    assert context["composio"]["app_universe"] == [
        {"slug": "gmail", "name": "Gmail", "connectable": True},
        {"slug": "slack", "name": "Slack", "connectable": True},
    ]
    assert context["composio"]["available_apps"] == [
        {"slug": "slack", "name": "Slack", "connectable": True}
    ]
    assert "connect_account" not in context["composio"].get("endpoints", {})


def test_runtime_context_injects_full_app_universe_and_unique_active_connected_apps(tmp_path):
    service = PuckyVoiceService(
        _config(tmp_path),
        stt=_FakeSTT(),
        tts=_FakeTTS(),
        codex=_FakeCodex(),
        composio=_LargeFakeComposio(),
    )

    context = service._base_runtime_context()
    composio = context["composio"]

    assert len(composio["app_universe"]) == 973
    assert composio["connected_apps"] == [
        {
            "slug": "gmail",
            "name": "Gmail",
            "status": "active",
            "active_account_count": 2,
            "connected_account_ids": ["acct_gmail_1", "acct_gmail_2"],
        },
        {
            "slug": "notion",
            "name": "Notion",
            "status": "active",
            "active_account_count": 1,
            "connected_account_ids": ["acct_notion_1"],
        },
    ]
    assert composio["connected_app_diagnostics"] == {
        "active_account_rows": 3,
        "unique_active_app_count": 2,
        "status_counts": {"active": 3},
    }
    assert len(composio["available_apps"]) == 971
    assert all(item["slug"] not in {"gmail", "notion"} for item in composio["available_apps"])


def test_runtime_context_keeps_recent_action_log_separate_from_runtime_catalog(tmp_path):
    service = PuckyVoiceService(
        _config(tmp_path),
        stt=_FakeSTT(),
        tts=_FakeTTS(),
        codex=_FakeCodex(),
        composio=_FakeComposio(),
    )
    for index in range(155):
        service.action_ledger.record(
            user_id=service.composio_user_id(),
            timestamp=f"2026-05-31T00:{index % 60:02d}:00Z",
            surface="codex_runtime",
            action="turn/start",
            tool="turn/start",
            target="turn/start",
            status="ok",
            thread_id=f"thread-{index}",
        )
    service.action_ledger.record(
        user_id=service.composio_user_id(),
        timestamp="2026-05-31T01:00:00Z",
        surface="pucky_http",
        action="GET /api/feed",
        tool="GET",
        target="/api/feed",
        status="200",
    )

    context = service._base_runtime_context()
    text = service.codex_base_instructions_for_thread()

    assert len(context["action_log"]["rows"]) == 150
    assert context["action_log"]["schema"] == "action_log.recent.v1"
    assert context["action_log"]["limit"] == 150
    assert len(context["agent_runtime"]["actions"]) == 18
    thread_ids = {row["thread_id"] for row in context["action_log"]["rows"]}
    assert "thread-154" in thread_ids
    assert "thread-0" not in thread_ids
    assert "GET /api/feed" not in text
    assert "Last 150 meaningful system-wide actions" in text


def test_static_custom_base_file_is_generic_and_compact():
    repo = Path(__file__).resolve().parents[2]
    text = (repo / "docs" / "pucky-base-instructions-custom.md").read_text(encoding="utf-8")

    assert "You can start new agent sessions" in text
    assert "Exact runtime actions:" in text
    assert "Catalog kinds" in text
    assert "agent.runtime.catalog" in text
    assert "/memory/MEMORY.md" in text
    assert "max 3000 chars" in text
    assert "max 1000 words" in text
    assert "filename is the card title" in text
    assert "created date" in text
    assert "last edited date" in text
    assert "POST /connected_accounts/link" not in text
    assert "{{PUCKY_AGENT_RUNTIME_CATALOG}}" in text
    assert "{{PUCKY_ACTION_LOG_RECENT}}" in text
    assert "{{PUCKY_COMPOSIO_CONNECTED_APPS}}" in text
    assert "{{PUCKY_COMPOSIO_AVAILABLE_APPS}}" in text
    assert "{{PUCKY_REPLY_CARD_ICONS}}" in text
    assert "statuses=ACTIVE" in text
    assert "limit=1000&cursor=..." in text
    assert "limit=200" not in text
    assert "Raw Composio mode" not in text
    assert "Pucky uses Composio.dev" in text
    assert "command.catalog" in text
    assert "capabilities.get" in text
    assert "POST /v1/devices/{device_id}/commands" in text
    assert "Current device state and permissions" in text
    assert "## Reply Format" in text
    assert '"card_icon": "mail"' not in text
    assert "use `mail` only as a fallback" in text
    assert "reply_card.icons" in text
    assert "POST /api/card-icons" in text
    assert "directly edit VM-served HTML/JS/CSS" in text
    assert "headless Playwright smoke in a mobile viewport" in text
    assert "Home/feed" not in text
    assert "Audiobooks" not in text
    assert "Always return strict JSON" not in text
    assert "Never store secrets" not in text
    assert "Static base instructions should not hardcode" not in text
    assert not (repo / "docs" / "pucky-developer-instructions-custom.md").exists()
