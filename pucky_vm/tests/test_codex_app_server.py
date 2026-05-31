from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from pucky_vm.codex_app_server import CodexAppServerClient


FAKE_APP_SERVER = r"""
import json
import os
import sys

thread_count = 0
turn_count = 0
capture_path = os.environ.get("CAPTURE_PATH", "")
invalid_thread_id = os.environ.get("INVALID_THREAD_ID", "")

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
                    "status": "ok",
                    "thread_id": "",
                },
                actions,
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
