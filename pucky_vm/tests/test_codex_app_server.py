from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from pucky_vm.codex_app_server import CodexAppServerClient, compact_tool_target


FAKE_APP_SERVER = r"""
import json
import os
import sys

thread_count = 0
turn_count = 0
capture_path = os.environ.get("CAPTURE_PATH", "")
invalid_thread_id = os.environ.get("INVALID_THREAD_ID", "")
emit_tool_call = os.environ.get("EMIT_TOOL_CALL", "") == "1"

def record(message):
    if not capture_path:
        return
    with open(capture_path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(message) + "\n")

def send(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()

for line in sys.stdin:
    message = json.loads(line)
    record(message)
    request_id = message.get("id")
    method = message.get("method")
    if method == "initialize":
        send({"id": request_id, "result": {"capabilities": {}}})
    elif method == "initialized":
        continue
    elif method == "thread/start":
        thread_count += 1
        thread_id = "thread-" + str(thread_count)
        send({"id": request_id, "result": {"thread": {"id": thread_id}}})
        send({"method": "thread/started", "params": {"thread": {"id": thread_id}}})
    elif method == "thread/read":
        send({"id": request_id, "result": {"thread": {"id": message.get("params", {}).get("threadId", ""), "items": []}}})
    elif method == "thread/name/set":
        send({"id": request_id, "result": {"ok": True}})
    elif method == "turn/start":
        thread_id = message.get("params", {}).get("threadId", "")
        if invalid_thread_id and thread_id == invalid_thread_id:
            send({"id": request_id, "error": {"code": -32004, "message": "thread_not_found"}})
            continue
        turn_count += 1
        turn_id = "turn-" + str(turn_count)
        text = "Hello back " + str(turn_count)
        send({"id": request_id, "result": {"turn": {"id": turn_id}}})
        send({"method": "turn/started", "params": {"threadId": thread_id, "turn": {"id": turn_id}}})
        if emit_tool_call:
            args = json.dumps({"command": "rg --version", "workdir": "C:\\repo"})
            send({"method": "item/completed", "params": {"threadId": thread_id, "turnId": turn_id, "item": {"type": "function_call", "name": "shell_command", "arguments": args, "call_id": "call-tool-1"}}})
            send({"method": "item/completed", "params": {"threadId": thread_id, "turnId": turn_id, "item": {"type": "function_call_output", "call_id": "call-tool-1", "output": "ripgrep 14"}}})
        send({"method": "item/agentMessage/delta", "params": {"threadId": thread_id, "turnId": turn_id, "itemId": "item-1", "delta": text}})
        send({"method": "item/completed", "params": {"threadId": thread_id, "turnId": turn_id, "item": {"type": "agentMessage", "id": "item-1", "text": text}}})
        send({"method": "turn/completed", "params": {"threadId": thread_id, "turn": {"id": turn_id, "status": "completed", "items": []}}})
"""


def capture_messages(path: Path) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


class CodexAppServerClientTests(unittest.TestCase):
    def test_client_starts_new_thread_for_each_turn_and_collects_reply(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            script = Path(tempdir) / "fake_app_server.py"
            capture = Path(tempdir) / "capture.jsonl"
            script.write_text(textwrap.dedent(FAKE_APP_SERVER), encoding="utf-8")
            env = os.environ.copy()
            env["CAPTURE_PATH"] = str(capture)
            client = CodexAppServerClient(
                command=[sys.executable, str(script)],
                startup_timeout=5,
                turn_timeout=5,
                developer_instructions="return json",
                output_schema={"type": "object", "properties": {"reply_text": {"type": "string"}}},
                sandbox="danger-full-access",
                approval_policy="never",
                model="gpt-5.5",
                reasoning_effort="high",
            )
            try:
                original = os.environ.copy()
                os.environ.update(env)
                client.start()
                self.assertTrue(client.ready)
                self.assertIsNone(client.thread_id)
                first = client.send_turn("Pucky test")
                self.assertEqual(first.reply_text, "Hello back 1")
                self.assertEqual(first.used_thread_id, "thread-1")
                self.assertEqual(client.thread_id, "thread-1")
                client.set_thread_title("Quick Help", thread_id=first.used_thread_id)
                second = client.send_turn("Pucky again")
                self.assertEqual(second.reply_text, "Hello back 2")
                self.assertEqual(second.used_thread_id, "thread-2")
                self.assertEqual(client.thread_id, "thread-2")
            finally:
                client.close()
                os.environ.clear()
                os.environ.update(original)

            messages = capture_messages(capture)
            thread_start = next(msg for msg in messages if msg.get("method") == "thread/start")
            turn_start = next(msg for msg in messages if msg.get("method") == "turn/start")
            rename = next(msg for msg in messages if msg.get("method") == "thread/name/set")

            self.assertEqual(thread_start["params"]["approvalPolicy"], "never")
            self.assertEqual(thread_start["params"]["sandbox"], "danger-full-access")
            self.assertEqual(thread_start["params"]["model"], "gpt-5.5")
            self.assertEqual(thread_start["params"]["developerInstructions"], "return json")
            self.assertEqual(turn_start["params"]["threadId"], "thread-1")
            self.assertEqual(turn_start["params"]["effort"], "high")
            self.assertEqual(turn_start["params"]["outputSchema"]["type"], "object")
            self.assertEqual(turn_start["params"]["input"][0]["text"], "Pucky test")
            self.assertEqual(rename["params"], {"threadId": "thread-1", "name": "Quick Help"})

    def test_client_reuses_requested_thread_and_falls_back_once_on_rejected_thread(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            script = Path(tempdir) / "fake_app_server.py"
            capture = Path(tempdir) / "capture.jsonl"
            script.write_text(textwrap.dedent(FAKE_APP_SERVER), encoding="utf-8")
            env = os.environ.copy()
            env["CAPTURE_PATH"] = str(capture)
            env["INVALID_THREAD_ID"] = "thread-invalid"
            client = CodexAppServerClient(
                command=[sys.executable, str(script)],
                startup_timeout=5,
                turn_timeout=5,
            )
            try:
                original = os.environ.copy()
                os.environ.update(env)
                client.start()
                reused = client.send_turn("Continue please", thread_id="thread-existing")
                self.assertEqual(reused.reply_text, "Hello back 1")
                self.assertEqual(reused.used_thread_id, "thread-existing")
                self.assertEqual(reused.requested_thread_id, "thread-existing")
                self.assertEqual(reused.thread_mode, "existing")
                self.assertFalse(reused.fallback_reason)

                fallback = client.send_turn("Try fallback", thread_id="thread-invalid")
                self.assertEqual(fallback.reply_text, "Hello back 2")
                self.assertEqual(fallback.requested_thread_id, "thread-invalid")
                self.assertEqual(fallback.thread_mode, "new")
                self.assertEqual(fallback.used_thread_id, "thread-1")
                self.assertIn("thread_not_found", fallback.fallback_reason)
            finally:
                client.close()
                os.environ.clear()
                os.environ.update(original)

            messages = capture_messages(capture)
            methods = [str(msg.get("method")) for msg in messages if msg.get("method")]
            self.assertEqual(methods.count("thread/start"), 1)
            turn_starts = [msg for msg in messages if msg.get("method") == "turn/start"]
            self.assertEqual(turn_starts[0]["params"]["threadId"], "thread-existing")
            self.assertEqual(turn_starts[1]["params"]["threadId"], "thread-invalid")
            self.assertEqual(turn_starts[2]["params"]["threadId"], "thread-1")

    def test_thread_start_sends_base_instructions_separately_from_developer_instructions(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            script = Path(tempdir) / "fake_app_server.py"
            capture = Path(tempdir) / "capture.jsonl"
            script.write_text(textwrap.dedent(FAKE_APP_SERVER), encoding="utf-8")
            env = os.environ.copy()
            env["CAPTURE_PATH"] = str(capture)
            actions: list[dict[str, object]] = []
            client = CodexAppServerClient(
                command=[sys.executable, str(script)],
                startup_timeout=5,
                turn_timeout=5,
                developer_instructions="strict json contract",
                base_instructions_provider=lambda: "pucky base runtime map",
                action_logger=actions.append,
            )
            try:
                original = os.environ.copy()
                os.environ.update(env)
                client.start()
                client.send_turn("Pucky base")
            finally:
                client.close()
                os.environ.clear()
                os.environ.update(original)

            messages = capture_messages(capture)
            thread_start = next(msg for msg in messages if msg.get("method") == "thread/start")
            self.assertEqual(thread_start["params"]["baseInstructions"], "pucky base runtime map")
            self.assertEqual(thread_start["params"]["developerInstructions"], "strict json contract")
            self.assertIn(
                {
                    "timestamp": actions[1]["timestamp"],
                    "surface": "codex_runtime",
                    "action": "thread/start",
                    "tool": "thread/start",
                    "target": "thread/start",
                    "status": "ok",
                    "thread_id": "",
                },
                actions,
            )

    def test_runtime_call_forwards_raw_codex_method(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            script = Path(tempdir) / "fake_app_server.py"
            capture = Path(tempdir) / "capture.jsonl"
            script.write_text(textwrap.dedent(FAKE_APP_SERVER), encoding="utf-8")
            env = os.environ.copy()
            env["CAPTURE_PATH"] = str(capture)
            client = CodexAppServerClient(
                command=[sys.executable, str(script)],
                startup_timeout=5,
                turn_timeout=5,
            )
            try:
                original = os.environ.copy()
                os.environ.update(env)
                client.start()
                result = client.runtime_call("thread/read", {"threadId": "thread-smoke"})
            finally:
                client.close()
                os.environ.clear()
                os.environ.update(original)

            self.assertEqual(result["thread"]["id"], "thread-smoke")
            messages = capture_messages(capture)
            read = next(msg for msg in messages if msg.get("method") == "thread/read")
            self.assertEqual(read["params"], {"threadId": "thread-smoke"})

    def test_streamed_function_call_records_compact_tool_action(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            script = Path(tempdir) / "fake_app_server.py"
            capture = Path(tempdir) / "capture.jsonl"
            script.write_text(textwrap.dedent(FAKE_APP_SERVER), encoding="utf-8")
            env = os.environ.copy()
            env["CAPTURE_PATH"] = str(capture)
            env["EMIT_TOOL_CALL"] = "1"
            actions: list[dict[str, object]] = []
            client = CodexAppServerClient(
                command=[sys.executable, str(script)],
                startup_timeout=5,
                turn_timeout=5,
                action_logger=actions.append,
            )
            try:
                original = os.environ.copy()
                os.environ.update(env)
                client.start()
                client.send_turn("force tool")
            finally:
                client.close()
                os.environ.clear()
                os.environ.update(original)

            tool_rows = [row for row in actions if row.get("surface") == "codex_tool"]
            self.assertEqual(len(tool_rows), 1)
            self.assertEqual(tool_rows[0]["tool"], "shell_command")
            self.assertEqual(tool_rows[0]["target"], "rg cwd=C:\\repo")
            self.assertEqual(tool_rows[0]["status"], "ok")

    def test_rollout_jsonl_ingest_records_compact_tool_action_without_output(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            home = Path(tempdir) / "codex_home"
            home.mkdir()
            rollout = Path(tempdir) / "rollout.jsonl"
            rollout.write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "timestamp": "2026-06-01T01:00:00Z",
                                "type": "response_item",
                                "payload": {
                                    "type": "function_call",
                                    "name": "shell_command",
                                    "arguments": json.dumps(
                                        {"command": "curl -X POST https://backend.composio.dev/api/v3.1/tools/execute/proxy"}
                                    ),
                                    "call_id": "call-1",
                                },
                            }
                        ),
                        json.dumps(
                            {
                                "timestamp": "2026-06-01T01:00:01Z",
                                "type": "response_item",
                                "payload": {
                                    "type": "function_call_output",
                                    "call_id": "call-1",
                                    "output": "very long output",
                                },
                            }
                        ),
                    ]
                ),
                encoding="utf-8",
            )
            state_db = home / "state_5.sqlite"
            conn = sqlite3.connect(str(state_db))
            try:
                conn.execute(
                    """CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT, rollout_path TEXT, source TEXT, model TEXT, model_provider TEXT, reasoning_effort TEXT, sandbox_policy TEXT, approval_mode TEXT)"""
                )
                conn.execute(
                    """INSERT INTO threads (id, title, rollout_path, source, model, model_provider, reasoning_effort, sandbox_policy, approval_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    ("thread-rollout", "Gmail smoke", str(rollout), "test", "", "", "", "", ""),
                )
                conn.commit()
            finally:
                conn.close()
            actions: list[dict[str, object]] = []
            client = CodexAppServerClient(codex_home=str(home), action_logger=actions.append)

            self.assertEqual(client.ingest_thread_rollout_actions("thread-rollout"), 1)

            self.assertEqual(actions[0]["surface"], "codex_tool")
            self.assertEqual(actions[0]["thread_title"], "Gmail smoke")
            self.assertEqual(actions[0]["target"], "curl POST /tools/execute/proxy")
            self.assertNotIn("very long output", str(actions[0]))

    def test_compact_tool_target_extracts_shell_paths_and_composio_endpoints(self) -> None:
        self.assertEqual(
            compact_tool_target("shell_command", json.dumps({"command": "rg -n foo C:\\repo\\pucky_vm\\server.py"})),
            "rg C:\\repo\\pucky_vm\\server.py",
        )
        self.assertEqual(
            compact_tool_target(
                "shell_command",
                json.dumps({"command": "curl -X POST https://backend.composio.dev/api/v3.1/tools/execute/proxy"}),
            ),
            "curl POST /tools/execute/proxy",
        )

    def test_thread_origin_reads_metadata_from_local_codex_state_db(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            state_db = Path(tempdir) / "state_5.sqlite"
            conn = sqlite3.connect(str(state_db))
            try:
                conn.execute(
                    """
                    CREATE TABLE threads (
                        id TEXT PRIMARY KEY,
                        title TEXT,
                        rollout_path TEXT,
                        source TEXT,
                        model TEXT,
                        model_provider TEXT,
                        reasoning_effort TEXT,
                        sandbox_policy TEXT,
                        approval_mode TEXT
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO threads (
                        id, title, rollout_path, source, model, model_provider,
                        reasoning_effort, sandbox_policy, approval_mode
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "thread-42",
                        "Ski Gallery",
                        "/data/home/codex/sessions/rollout.jsonl",
                        "vscode",
                        "gpt-5.5",
                        "openai",
                        "high",
                        json.dumps({"type": "danger-full-access"}),
                        "never",
                    ),
                )
                conn.commit()
            finally:
                conn.close()

            client = CodexAppServerClient(codex_home=tempdir)
            client._thread_id = "thread-42"
            origin = client.thread_origin(retries=1, delay=0)

            self.assertEqual(origin["runtime"], "codex")
            self.assertEqual(origin["thread_id"], "thread-42")
            self.assertEqual(origin["thread_title"], "Ski Gallery")
            self.assertEqual(origin["rollout_path"], "/data/home/codex/sessions/rollout.jsonl")
            self.assertEqual(origin["source"], "vscode")
            self.assertEqual(origin["model"], "gpt-5.5")
            self.assertEqual(origin["model_provider"], "openai")
            self.assertEqual(origin["reasoning_effort"], "high")
            self.assertEqual(origin["sandbox_policy"], "danger-full-access")
            self.assertEqual(origin["approval_mode"], "never")


if __name__ == "__main__":
    unittest.main()
