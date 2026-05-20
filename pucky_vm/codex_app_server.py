from __future__ import annotations

import json
import os
import queue
import shlex
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class CodexAppServerError(RuntimeError):
    pass


@dataclass
class CodexAppServerClient:
    command: list[str] = field(default_factory=lambda: ["codex", "app-server", "--listen", "stdio://"])
    cwd: str | None = None
    startup_timeout: float = 30.0
    turn_timeout: float = 300.0
    developer_instructions: str | None = None

    def __post_init__(self) -> None:
        self._process: subprocess.Popen[str] | None = None
        self._next_id = 1
        self._pending: dict[int, queue.Queue[dict[str, Any]]] = {}
        self._notifications: queue.Queue[dict[str, Any]] = queue.Queue()
        self._lock = threading.RLock()
        self._turn_lock = threading.Lock()
        self._ready = False
        self._thread_id: str | None = None
        self._stderr: list[str] = []

    @property
    def ready(self) -> bool:
        return self._ready and self._process is not None and self._process.poll() is None

    @property
    def thread_id(self) -> str | None:
        return self._thread_id

    @property
    def stderr_tail(self) -> list[str]:
        return list(self._stderr[-20:])

    def start(self) -> None:
        if self.ready:
            return
        env = os.environ.copy()
        self._process = subprocess.Popen(
            self.command,
            cwd=self.cwd or None,
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

        self.request(
            "initialize",
            {
                "clientInfo": {
                    "name": "pucky_v0",
                    "title": "Pucky v0 Voice Turn",
                    "version": "0.1.0",
                }
            },
            timeout=self.startup_timeout,
        )
        self.notify("initialized", {})
        self._ready = True

    def close(self) -> None:
        proc = self._process
        self._process = None
        self._ready = False
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        if proc:
            for stream in (proc.stdin, proc.stdout, proc.stderr):
                try:
                    if stream:
                        stream.close()
                except OSError:
                    pass

    def send_turn(self, text: str) -> str:
        if not self.ready:
            raise CodexAppServerError("Codex app-server is not ready")
        clean = text.strip()
        if not clean:
            raise CodexAppServerError("cannot send an empty transcript to Codex")

        with self._turn_lock:
            thread_id = self._start_thread()
            self._thread_id = thread_id
            response = self.request(
                "turn/start",
                {
                    "threadId": thread_id,
                    "input": [
                        {
                            "type": "text",
                            "text": clean,
                            "text_elements": [],
                        }
                    ],
                },
                timeout=30.0,
            )
            turn_id = response.get("turn", {}).get("id")
            if not turn_id:
                raise CodexAppServerError("turn/start did not return a turn id")
            return self._wait_for_reply(str(turn_id))

    def _start_thread(self) -> str:
        params: dict[str, Any] = {
            "approvalPolicy": "never",
            "sandbox": "read-only",
        }
        if self.cwd:
            params["cwd"] = str(Path(self.cwd).resolve())
        if self.developer_instructions:
            params["developerInstructions"] = self.developer_instructions
        response = self.request("thread/start", params, timeout=self.startup_timeout)
        thread_id = response.get("thread", {}).get("id")
        if not thread_id:
            raise CodexAppServerError("thread/start did not return a thread id")
        return str(thread_id)

    def _wait_for_reply(self, turn_id: str) -> str:
        deadline = time.monotonic() + self.turn_timeout
        deltas: dict[str, list[str]] = {}
        completed_text = ""
        while time.monotonic() < deadline:
            remaining = max(0.1, min(1.0, deadline - time.monotonic()))
            try:
                message = self._notifications.get(timeout=remaining)
            except queue.Empty:
                continue
            method = message.get("method")
            params = message.get("params") or {}
            event_turn_id = params.get("turnId")
            if event_turn_id is None and isinstance(params.get("turn"), dict):
                event_turn_id = params["turn"].get("id")
            if event_turn_id != turn_id:
                continue
            if method == "item/agentMessage/delta":
                item_id = str(params.get("itemId") or "")
                deltas.setdefault(item_id, []).append(str(params.get("delta") or ""))
            elif method == "item/completed":
                item = params.get("item") or {}
                if item.get("type") == "agentMessage":
                    completed_text = str(item.get("text") or "").strip()
            elif method == "turn/completed":
                turn = params.get("turn") or {}
                status = turn.get("status")
                if status == "failed":
                    error = turn.get("error") or {}
                    raise CodexAppServerError(f"Codex turn failed: {error}")
                if completed_text:
                    return completed_text
                joined = "".join("".join(parts) for parts in deltas.values()).strip()
                if joined:
                    return joined
                raise CodexAppServerError("Codex turn completed without an assistant reply")
        raise CodexAppServerError("Timed out waiting for Codex reply")

    def request(self, method: str, params: dict[str, Any] | None = None, *, timeout: float) -> dict[str, Any]:
        with self._lock:
            request_id = self._next_id
            self._next_id += 1
            responses: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
            self._pending[request_id] = responses
            self._write({"id": request_id, "method": method, "params": params or {}})
        try:
            message = responses.get(timeout=timeout)
        except queue.Empty as exc:
            raise CodexAppServerError(f"Timed out waiting for {method}") from exc
        finally:
            with self._lock:
                self._pending.pop(request_id, None)
        if "error" in message:
            raise CodexAppServerError(f"{method} failed: {message['error']}")
        result = message.get("result")
        return result if isinstance(result, dict) else {}

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        self._write({"method": method, "params": params or {}})

    def _write(self, message: dict[str, Any]) -> None:
        proc = self._process
        if proc is None or proc.stdin is None or proc.poll() is not None:
            raise CodexAppServerError("Codex app-server process is not running")
        line = json.dumps(message, separators=(",", ":"))
        proc.stdin.write(line + "\n")
        proc.stdin.flush()

    def _read_stdout(self) -> None:
        proc = self._process
        if proc is None or proc.stdout is None:
            return
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            request_id = message.get("id")
            if request_id is not None and ("result" in message or "error" in message) and "method" not in message:
                with self._lock:
                    responses = self._pending.get(int(request_id))
                if responses is not None:
                    responses.put(message)
                continue
            if request_id is not None and "method" in message:
                self._respond_to_server_request(int(request_id), str(message.get("method") or ""))
                continue
            self._notifications.put(message)

    def _read_stderr(self) -> None:
        proc = self._process
        if proc is None or proc.stderr is None:
            return
        for line in proc.stderr:
            clean = line.rstrip()
            if clean:
                self._stderr.append(clean)
                del self._stderr[:-50]

    def _respond_to_server_request(self, request_id: int, method: str) -> None:
        try:
            self._write(
                {
                    "id": request_id,
                    "error": {
                        "code": -32601,
                        "message": f"Pucky v0 does not handle server request {method}",
                    },
                }
            )
        except CodexAppServerError:
            pass


def command_from_env(value: str | None) -> list[str]:
    if value:
        return shlex.split(value)
    return ["codex", "app-server", "--listen", "stdio://"]
