from tools.smoke_pucky_runtime_context import compile_runtime_report, validate_runtime_report


class _FakeService:
    def _base_runtime_context(self):
        return {
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
                "connected_apps": [{"slug": "gmail"}],
                "app_universe": [{"slug": "gmail"}, {"slug": "slack"}],
                "available_apps": [{"slug": "slack"}],
            },
            "reply_card": {
                "icons": [
                    {"name": "mail", "accent": "#72c2ff"},
                ]
            },
            "action_log": {
                "rows": [
                    {"surface": "codex_runtime", "action": "thread/start"},
                ]
            },
        }


def test_compile_runtime_report_counts_required_runtime_blocks():
    report = compile_runtime_report(_FakeService())

    validate_runtime_report(report, require_composio=True)
    assert report["agent_runtime_action_count"] == 18
    assert report["connected_app_count"] == 1
    assert report["app_universe_count"] == 2
    assert report["available_app_count"] == 1
    assert report["reply_icon_count"] == 1
    assert report["action_log_count"] == 1
