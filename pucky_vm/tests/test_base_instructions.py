import os
from pathlib import Path

import pytest

from pucky_vm.server import Config, PuckyVoiceService


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
        codex_base_instructions="Base runtime map.",
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

    assert text is not None
    assert "Gmail" in text
    assert "Slack" in text
    assert "secret-api-key" not in text
    assert "env:COMPOSIO_API_KEY" in text
    assert "connected_accounts.list" in text
    assert "\"action_log\"" in text


def test_static_custom_base_file_is_generic_and_compact():
    repo = Path(__file__).resolve().parents[2]
    text = (repo / "docs" / "pucky-base-instructions-custom.md").read_text(encoding="utf-8")

    assert "agent.runtime.catalog" in text
    assert "agent.runtime.call(thread/start)" in text
    assert "/memory/MEMORY.md" in text
    assert "max 3000 chars" in text
    assert "max 1000 words" in text
    assert "created date" in text
    assert "last edited date" in text
    assert "command.catalog" in text
    assert "capabilities.get" in text
    assert "POST /v1/devices/{device_id}/commands" in text
    assert "Home/feed" not in text
    assert "Audiobooks" not in text
    assert "Always return strict JSON" not in text
    assert "Never store secrets" not in text
    assert not (repo / "docs" / "pucky-developer-instructions-custom.md").exists()
