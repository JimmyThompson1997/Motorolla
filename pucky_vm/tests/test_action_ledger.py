from pucky_vm.action_ledger import ActionLedger


def test_action_ledger_keeps_normalized_last_500_per_user(tmp_path):
    ledger = ActionLedger(tmp_path / "actions.sqlite")
    for index in range(505):
        ledger.record(
            user_id="user-a",
            timestamp=f"2026-05-31T00:{index % 60:02d}:00Z",
            thread_id=f"thread-{index}",
            thread_title=f"Thread {index}",
            surface="codex_runtime",
            action="turn/start",
            tool="turn/start",
            status="ok",
        )
    ledger.record(
        user_id="user-b",
        timestamp="2026-05-31T01:00:00Z",
        surface="pucky_http",
        action="GET /healthz",
        status="200",
    )

    rows = ledger.last_500("user-a")

    assert len(rows) == 500
    assert rows[0] == {
        "timestamp": "2026-05-31T00:24:00Z",
        "thread_id": "thread-504",
        "thread_title": "Thread 504",
        "surface": "codex_runtime",
        "action": "turn/start",
        "tool": "turn/start",
        "status": "ok",
    }
    assert all(row["thread_id"] != "thread-0" for row in rows)
    assert ledger.last_500("user-b")[0]["action"] == "GET /healthz"
