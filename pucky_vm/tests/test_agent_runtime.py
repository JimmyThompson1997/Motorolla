from __future__ import annotations

import base64
from pathlib import Path

from pucky_vm.server import AGENT_RUNTIME_ACTIONS, Config, PuckyVoiceService, reply_output_schema


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

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def start(self) -> None:
        return None

    def send_turn(self, text: str, *, thread_id: str | None = None):
        raise AssertionError("not used")

    def set_thread_title(self, title: str, *, thread_id: str | None = None) -> None:
        return None

    def runtime_call(self, method: str, params: dict[str, object] | None = None, *, timeout: float | None = None) -> dict[str, object]:
        self.calls.append({"method": method, "params": params or {}, "timeout": timeout})
        return {"echo_method": method, "echo_params": params or {}}

    def thread_origin(self, thread_id: str | None = None, *, retries: int = 5, delay: float = 0.15) -> dict[str, str]:
        return {}


class _FakeComposio:
    configured = False

    def list_apps(self) -> dict[str, object]:
        return {"apps": []}

    def list_connected_apps(self, user_id: str, *, force: bool = False) -> dict[str, object]:
        return {"connected_apps": []}

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
        codex_turn_timeout=7,
        developer_instructions="strict json contract",
        feed_db_path=str(tmp_path / "feed.sqlite"),
        codex_base_instructions="Base runtime map.",
        action_ledger_path=str(tmp_path / "actions.sqlite"),
    )


def _service(tmp_path: Path, codex: _FakeCodex | None = None) -> PuckyVoiceService:
    return PuckyVoiceService(
        _config(tmp_path),
        stt=_FakeSTT(),
        tts=_FakeTTS(),
        codex=codex or _FakeCodex(),
        composio=_FakeComposio(),
    )


def test_agent_runtime_catalog_returns_full_allowlisted_universe(tmp_path: Path) -> None:
    service = _service(tmp_path)

    catalog = service.agent_runtime_catalog()

    names = [item["name"] for item in catalog["actions"]]
    assert catalog["schema"] == "pucky.agent_runtime.catalog.v1"
    assert catalog["call"] == "agent.runtime.call"
    assert names == [item["name"] for item in AGENT_RUNTIME_ACTIONS]
    assert "thread/fork" in names
    assert "turn/steer" in names
    assert "review/start" in names


def test_agent_runtime_call_forwards_only_allowlisted_methods(tmp_path: Path) -> None:
    codex = _FakeCodex()
    service = _service(tmp_path, codex)

    ok = service.agent_runtime_call({"method": "thread/read", "params": {"threadId": "thread-1"}})
    rejected = service.agent_runtime_call({"method": "shell.exec", "params": {}})

    assert ok["ok"] is True
    assert ok["result"] == {"echo_method": "thread/read", "echo_params": {"threadId": "thread-1"}}
    assert codex.calls == [{"method": "thread/read", "params": {"threadId": "thread-1"}, "timeout": 7}]
    assert rejected["ok"] is False
    assert rejected["error"] == "unsupported_agent_runtime_action"


def test_reply_card_icons_have_icon_owned_accent_without_reply_accent_field(tmp_path: Path) -> None:
    service = _service(tmp_path)

    schema = reply_output_schema()
    before = service.card_icons()
    upserted = service.upsert_card_icon(
        {
            "name": "sparkles",
            "label": "Sparkles",
            "accent": "#aabbcc",
            "filled_svg": '<path d="M1 1h2v2H1z"/>',
            "outline_svg": '<path d="M1 1h2v2H1z"/>',
        }
    )

    assert "card_accent" not in schema["properties"]
    assert "accent" not in schema["properties"]
    assert any(icon["name"] == "mail" and icon["accent"] == "#72c2ff" for icon in before["icons"])
    assert upserted["icon"]["accent"] == "#aabbcc"
    assert any(icon["name"] == "sparkles" and icon["accent"] == "#aabbcc" for icon in upserted["icons"])


def test_feed_sync_derives_accent_from_card_icon(tmp_path: Path) -> None:
    service = _service(tmp_path)
    service.feed.upsert_turn_result(
        turn_id="turn-1",
        session_id="turn-1",
        reply_mode="card_only",
        reply_text="Done",
        title="Battery",
        summary="Done",
        icon="bolt",
        origin={},
        telemetry={},
        transcript_messages=[],
        request_audio_mime_type="",
        request_audio_base64="",
        audio_mime_type="audio/wav",
        audio_base64=base64.b64encode(b"audio").decode("ascii"),
        html_mime_type="",
        html_base64="",
    )

    payload = service.feed_sync("", 10)

    item = payload["items"][0]
    assert item["icon"] == "bolt"
    assert item["accent"] == "#50d86a"
    assert item["card"]["accent"] == "#50d86a"
