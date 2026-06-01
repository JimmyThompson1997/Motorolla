from pathlib import Path

import pytest

from tools.smoke_pucky_runtime_context import compile_runtime_report, run_tool_action_smoke, validate_runtime_report


class _FakeConfig:
    codex_base_instructions = """# Base

## Agent Runtime
Exact runtime actions:

{{PUCKY_AGENT_RUNTIME_CATALOG}}

## Action Log
Last 150 meaningful system-wide actions for this user:

{{PUCKY_ACTION_LOG_RECENT}}

## Connected Apps
Connected apps:

{{PUCKY_COMPOSIO_CONNECTED_APPS}}

Available apps:

{{PUCKY_COMPOSIO_AVAILABLE_APPS}}

## Reply Format
Current icon/color choices:

{{PUCKY_REPLY_CARD_ICONS}}
"""


class _FakeService:
    config = _FakeConfig()
    started = False

    class codex:
        @staticmethod
        def send_turn(text):
            class Result:
                used_thread_id = "thread-tool"
                thread_mode = "new"
                reply_text = '{"reply_text":"ok","card_title":"Smoke","card_icon":"mail","html":null,"attachments":null}'

            return Result()

    def start(self):
        self.started = True

    def _base_runtime_context(self):
        return {
            "schema": "pucky.runtime_context.v1",
            "agent_runtime": {
                "actions": [
                    {"name": "initialize"},
                    {"name": "thread/start"},
                    {"name": "thread/resume"},
                    {"name": "thread/fork"},
                    {"name": "thread/list"},
                    {"name": "thread/loaded/list"},
                    {"name": "thread/read"},
                    {"name": "thread/name/set"},
                    {"name": "thread/archive"},
                    {"name": "thread/unarchive"},
                    {"name": "thread/compact/start"},
                    {"name": "thread/rollback"},
                    {"name": "thread/metadata/update"},
                    {"name": "thread/unsubscribe"},
                    {"name": "turn/start"},
                    {"name": "turn/steer"},
                    {"name": "turn/interrupt"},
                    {"name": "review/start"},
                ]
            },
            "composio": {
                "configured": True,
                "connected_apps": [{"slug": "gmail", "active_account_count": 1}],
                "connected_app_diagnostics": {
                    "active_account_rows": 1,
                    "unique_active_app_count": 1,
                    "status_counts": {"active": 1},
                },
                "app_universe": [{"slug": "gmail"}, {"slug": "slack"}],
                "available_apps": [{"slug": "slack"}],
            },
            "reply_card": {
                "icons": [
                    {"name": "mail", "accent": "#72c2ff"},
                ]
            },
            "action_log": {
                "limit": 150,
                "rows": [
                    {"surface": "codex_runtime", "action": "thread/start", "tool": "thread/start", "target": "thread/start"},
                    {"surface": "codex_tool", "action": "shell_command", "tool": "shell_command", "target": "rg --version"},
                ]
            },
        }


class _NoBaseService(_FakeService):
    class config:
        codex_base_instructions = None


def test_compile_runtime_report_counts_required_runtime_blocks():
    report = compile_runtime_report(_FakeService())

    validate_runtime_report(report, require_composio=True)
    validate_runtime_report(report, require_composio=True, require_base=True)
    assert report["base_config_loaded"] is True
    assert report["compiled_present"] is True
    assert report["compiled_readable_sections_ok"] is True
    assert report["compiled_raw_runtime_json_present"] is False
    assert report["compiled_unresolved_placeholders"] == []
    assert report["thread_start_includes_base"] is True
    assert report["agent_runtime_action_count"] == 18
    assert report["connected_app_count"] == 1
    assert report["connected_active_account_row_count"] == 1
    assert report["connected_unique_active_app_count"] == 1
    assert report["connected_status_counts"] == {"active": 1}
    assert report["app_universe_count"] == 2
    assert report["available_app_count"] == 1
    assert report["reply_icon_count"] == 1
    assert report["action_log_row_count"] == 2
    assert report["action_log_limit"] == 150


def test_compile_runtime_report_fails_clearly_when_base_is_required_but_missing():
    report = compile_runtime_report(_NoBaseService())

    with pytest.raises(RuntimeError, match="base_config_loaded"):
        validate_runtime_report(report, require_base=True)


def test_tool_action_smoke_writes_compiled_prompt_and_requires_tool_row(tmp_path: Path):
    output = tmp_path / "compiled.md"

    report = run_tool_action_smoke(_FakeService(), text="run rg", compiled_output=str(output))

    assert report["schema"] == "pucky.runtime_tool_action_smoke.v1"
    assert report["matched_action"]["target"] == "rg --version"
    assert output.exists()
    assert "{{PUCKY_" not in output.read_text(encoding="utf-8")
