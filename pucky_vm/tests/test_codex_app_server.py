from __future__ import annotations

import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from pucky_vm.codex_app_server import CodexAppServerClient


FAKE_APP_SERVER = r"""
import json
import sys

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
        thread_id = "thread-" + str(thread_count)
        send({"id": request_id, "result": {"thread": {"id": thread_id}}})
        send({"method": "thread/started", "params": {"thread": {"id": thread_id}}})
    elif method == "turn/start":
        turn_count += 1
        thread_id = message.get("params", {}).get("threadId", "")
        turn_id = "turn-" + str(turn_count)
        text = "Hello back " + str(turn_count)
        send({"id": request_id, "result": {"turn": {"id": turn_id}}})
        send({"method": "turn/started", "params": {"threadId": thread_id, "turn": {"id": turn_id}}})
        send({"method": "item/agentMessage/delta", "params": {"threadId": thread_id, "turnId": turn_id, "itemId": "item-1", "delta": text}})
        send({"method": "item/completed", "params": {"threadId": thread_id, "turnId": turn_id, "item": {"type": "agentMessage", "id": "item-1", "text": text}}})
        send({"method": "turn/completed", "params": {"threadId": thread_id, "turn": {"id": turn_id, "status": "completed", "items": []}}})
"""


class CodexAppServerClientTests(unittest.TestCase):
    def test_client_starts_new_thread_for_each_turn_and_collects_reply(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            script = Path(tempdir) / "fake_app_server.py"
            script.write_text(textwrap.dedent(FAKE_APP_SERVER), encoding="utf-8")
            client = CodexAppServerClient(
                command=[sys.executable, str(script)],
                startup_timeout=5,
                turn_timeout=5,
                developer_instructions="return json",
            )
            try:
                client.start()
                self.assertTrue(client.ready)
                self.assertIsNone(client.thread_id)
                self.assertEqual(client.send_turn("Pucky test"), "Hello back 1")
                self.assertEqual(client.thread_id, "thread-1")
                self.assertEqual(client.send_turn("Pucky again"), "Hello back 2")
                self.assertEqual(client.thread_id, "thread-2")
            finally:
                client.close()


if __name__ == "__main__":
    unittest.main()
