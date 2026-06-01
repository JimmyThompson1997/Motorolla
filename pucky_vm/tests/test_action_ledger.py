from pucky_vm.action_ledger import ActionLedger


def test_action_ledger_keeps_normalized_recent_rows_per_user(tmp_path):
    ledger = ActionLedger(tmp_path / "actions.sqlite")
    for index in range(155):
        ledger.record(
            user_id="user-a",
            timestamp=f"2026-05-31T00:{index % 60:02d}:00Z",
            thread_id=f"thread-{index}",
            thread_title=f"Thread {index}",
            surface="codex_runtime",
            action="turn/start",
            tool="turn/start",
            target="turn/start",
            status="ok",
        )
    ledger.record(
        user_id="user-b",
        timestamp="2026-05-31T01:00:00Z",
        surface="pucky_http",
        action="GET /healthz",
        tool="GET",
        target="/healthz",
        status="200",
    )

    rows = ledger.recent("user-a", limit=150)

    assert len(rows) == 150
    assert rows[0] == {
        "timestamp": "2026-05-31T00:34:00Z",
        "thread_id": "thread-154",
        "thread_title": "Thread 154",
        "surface": "codex_runtime",
        "action": "turn/start",
        "tool": "turn/start",
        "target": "turn/start",
        "status": "ok",
    }
    assert all(row["thread_id"] != "thread-0" for row in rows)
    assert ledger.recent("user-b", limit=150) == []
    assert ledger.recent("user-b", limit=150, prompt_visible_only=False)[0]["action"] == "GET /healthz"


def test_action_ledger_filters_http_noise_but_keeps_meaningful_surfaces(tmp_path):
    ledger = ActionLedger(tmp_path / "actions.sqlite")
    for action, target in [
        ("GET /api/feed", "/api/feed"),
        ("GET /api/card-icons", "/api/card-icons"),
        ("GET /healthz", "/healthz"),
    ]:
        ledger.record(user_id="u", surface="pucky_http", action=action, tool="GET", target=target, status="200")
    ledger.record(user_id="u", surface="pucky_http", action="POST /api/feed/actions", tool="POST", target="/api/feed/actions", status="200")
    ledger.record(user_id="u", surface="codex_tool", action="shell_command", tool="shell_command", target="rg server.py", status="ok")
    ledger.record(user_id="u", surface="composio", action="connected_accounts.list", tool="GET", target="/connected_accounts", status="ok")
    ledger.record(user_id="u", surface="apk_broker", action="phone.sms.send", tool="phone.sms.send", target="device=razr", status="ok")

    rows = ledger.recent("u", limit=150)

    assert [row["target"] for row in rows] == ["device=razr", "/connected_accounts", "rg server.py", "/api/feed/actions"]
