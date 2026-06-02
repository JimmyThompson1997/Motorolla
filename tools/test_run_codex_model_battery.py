from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path

import pytest

from tools import run_codex_model_battery as battery


FAKE_APP_SERVER = r"""
import json
import os
import sys

FAIL_TURN = os.environ.get("FAIL_TURN", "") == "1"
thread_count = 0
turn_count = 0

def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()

for line in sys.stdin:
    message = json.loads(line)
    request_id = message.get("id")
    method = message.get("method")
    if method == "initialize":
        send({"id": request_id, "result": {"capabilities": {}}})
    elif method == "initialized":
        continue
    elif method == "thread/start":
        thread_count += 1
        send({"id": request_id, "result": {"thread": {"id": f"thread-{thread_count}"}}})
    elif method == "turn/start":
        if FAIL_TURN:
            send({"id": request_id, "error": {"code": -32001, "message": "turn_failed"}})
            continue
        turn_count += 1
        turn_id = f"turn-{turn_count}"
        send({"id": request_id, "result": {"turn": {"id": turn_id}}})
        params = message.get("params", {})
        output_schema = params.get("outputSchema")
        if output_schema:
            reply = json.dumps({"risk_level": "high", "summary": "Missing keys should fail fast."})
        else:
            reply = "BATTERY-PERSIST Confirmed." if turn_count == 3 else f"Hello back {turn_count}"
        send({"method": "item/agentMessage/delta", "params": {"threadId": params.get("threadId", ""), "turnId": turn_id, "itemId": "item-1", "delta": reply}})
        send({"method": "item/completed", "params": {"threadId": params.get("threadId", ""), "turnId": turn_id, "item": {"type": "agentMessage", "id": "item-1", "text": reply}}})
        send({"method": "turn/completed", "params": {"threadId": params.get("threadId", ""), "turn": {"id": turn_id, "status": "completed", "items": []}}})
"""


def write_fake_server(tmp_path: Path) -> Path:
    script = tmp_path / "fake_app_server.py"
    script.write_text(textwrap.dedent(FAKE_APP_SERVER), encoding="utf-8")
    return script


def test_select_entries_skips_disabled_by_default() -> None:
    entries = [
        battery.ModelEntry(label="one", provider_mode="openai-compatible", model="a", enabled=True),
        battery.ModelEntry(label="two", provider_mode="openai-compatible", model="b", enabled=False),
    ]
    selected = battery.select_entries(entries, include_disabled=False, labels=None)
    assert [entry.label for entry in selected] == ["one"]


def test_build_entry_env_maps_openai_compatible_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPINFRA_API_KEY", "di-key")
    entry = battery.ModelEntry(
        label="deepseek-v4-pro",
        provider_mode="openai-compatible",
        model="deepseek-ai/DeepSeek-V4-Pro",
        base_url=battery.DEEPINFRA_OPENAI_BASE_URL,
        api_key_env="DEEPINFRA_API_KEY",
        provider_settings={"temperature": 0.1},
    )
    env = battery.build_entry_env(entry)
    assert env["PUCKY_CODEX_MODEL"] == "deepseek-ai/DeepSeek-V4-Pro"
    assert env["PUCKY_CODEX_PROVIDER"] == "openai"
    assert env["PUCKY_CODEX_PROVIDER_BASE_URL"] == battery.DEEPINFRA_OPENAI_BASE_URL
    assert env["PUCKY_CODEX_PROVIDER_API_KEY"] == "di-key"
    assert json.loads(env["PUCKY_CODEX_PROVIDER_SETTINGS"]) == {"temperature": 0.1}


def test_run_entry_writes_summary_for_fake_server(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    script = write_fake_server(tmp_path)
    monkeypatch.setenv("DEEPINFRA_API_KEY", "di-key")
    entry = battery.ModelEntry(
        label="deepseek-v4-pro",
        provider_mode="openai-compatible",
        model="deepseek-ai/DeepSeek-V4-Pro",
        base_url=battery.DEEPINFRA_OPENAI_BASE_URL,
        api_key_env="DEEPINFRA_API_KEY",
    )

    result = battery.run_entry(
        entry,
        repo_root=tmp_path,
        output_dir=tmp_path,
        startup_timeout=5,
        turn_timeout=5,
        command_builder=lambda: [sys.executable, str(script)],
    )

    assert result["status"] == "completed"
    assert len(result["prompt_results"]) == 4
    assert (tmp_path / "deepseek-v4-pro.json").exists()
    structured = next(prompt for prompt in result["prompt_results"] if prompt["id"] == "structured-output")
    assert structured["checks"]["json_keys_ok"] is True


def test_run_entry_reports_missing_key(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("DEEPINFRA_API_KEY", raising=False)
    entry = battery.ModelEntry(
        label="deepseek-v4-pro",
        provider_mode="openai-compatible",
        model="deepseek-ai/DeepSeek-V4-Pro",
        base_url=battery.DEEPINFRA_OPENAI_BASE_URL,
        api_key_env="DEEPINFRA_API_KEY",
    )

    result = battery.run_entry(
        entry,
        repo_root=tmp_path,
        output_dir=tmp_path,
        startup_timeout=5,
        turn_timeout=5,
        command_builder=lambda: [sys.executable, "-c", "print('unused')"],
    )

    assert result["status"] == "failed"
    assert "DEEPINFRA_API_KEY" in result["error"]
    assert result["prompt_results"] == []


def test_run_entry_reports_startup_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("DEEPINFRA_API_KEY", "di-key")
    entry = battery.ModelEntry(
        label="deepseek-v4-pro",
        provider_mode="openai-compatible",
        model="deepseek-ai/DeepSeek-V4-Pro",
        base_url=battery.DEEPINFRA_OPENAI_BASE_URL,
        api_key_env="DEEPINFRA_API_KEY",
    )

    result = battery.run_entry(
        entry,
        repo_root=tmp_path,
        output_dir=tmp_path,
        startup_timeout=1,
        turn_timeout=1,
        command_builder=lambda: ["command-that-does-not-exist"],
    )

    assert result["status"] == "failed"
    assert result["prompt_results"] == []


def test_run_entry_reports_turn_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    script = write_fake_server(tmp_path)
    monkeypatch.setenv("DEEPINFRA_API_KEY", "di-key")
    monkeypatch.setenv("FAIL_TURN", "1")
    entry = battery.ModelEntry(
        label="deepseek-v4-pro",
        provider_mode="openai-compatible",
        model="deepseek-ai/DeepSeek-V4-Pro",
        base_url=battery.DEEPINFRA_OPENAI_BASE_URL,
        api_key_env="DEEPINFRA_API_KEY",
    )

    result = battery.run_entry(
        entry,
        repo_root=tmp_path,
        output_dir=tmp_path,
        startup_timeout=5,
        turn_timeout=5,
        command_builder=lambda: [sys.executable, str(script)],
    )

    assert result["status"] == "failed"
    assert result["prompt_results"] == []
    assert "turn_failed" in result["error"]
