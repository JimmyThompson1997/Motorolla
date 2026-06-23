from pucky_vm.ui_route_perf_ledger import UiRoutePerfLedger


def test_ui_route_perf_ledger_records_recent_run_slice(tmp_path):
    ledger = UiRoutePerfLedger(tmp_path / "ui-route-perf.sqlite3")
    for index in range(3):
        ledger.record(
            user_id="user-a",
            timestamp=f"2026-06-23T00:00:0{index}Z",
            payload={
                "schema": "pucky.ui_route_perf_event.v1",
                "surface": "android_webview",
                "route": "calendar",
                "run_id": "run-a",
                "session_id": f"session-{index}",
                "sample_reason": "debug_perf",
                "wall_elapsed_ms": 100 + index,
                "bridge_calls_by_command": {"pucky.turn.status": index + 1},
            },
        )
    ledger.record(
        user_id="user-a",
        timestamp="2026-06-23T00:00:10Z",
        payload={
            "schema": "pucky.ui_route_perf_event.v1",
            "surface": "hosted_browser",
            "route": "tasks",
            "run_id": "run-b",
            "session_id": "session-b",
            "sample_reason": "browser_sampled",
            "wall_elapsed_ms": 40,
        },
    )

    rows = ledger.recent("user-a", run_id="run-a", limit=10)

    assert [row["session_id"] for row in rows] == ["session-2", "session-1", "session-0"]
    assert rows[0]["bridge_calls_by_command"]["pucky.turn.status"] == 3
    assert rows[0]["received_at"] == "2026-06-23T00:00:02Z"


def test_ui_route_perf_ledger_redacts_and_ignores_unknown_schema(tmp_path):
    ledger = UiRoutePerfLedger(tmp_path / "ui-route-perf.sqlite3")
    ledger.record(
        user_id="user-a",
        payload={
            "schema": "unknown.schema",
            "surface": "android_webview",
            "route": "connect",
        },
    )
    ledger.record(
        user_id="user-a",
        payload={
            "schema": "pucky.ui_route_perf_event.v1",
            "surface": "android_webview",
            "route": "connect",
            "sample_reason": "debug_perf",
            "run_id": "run-x",
            "session_id": "session-x",
            "route_ready_reason": 'authorization: Bearer secret-token',
            "bridge_calls_by_command": {"pucky.config.get?token=abc": 2},
        },
    )

    rows = ledger.recent("user-a", limit=10)

    assert len(rows) == 1
    assert "[redacted]" in rows[0]["route_ready_reason"]
