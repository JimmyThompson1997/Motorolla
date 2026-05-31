from __future__ import annotations

import json
import os
import queue
import shlex
import sqlite3
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable


class CodexAppServerError(RuntimeError):
    pass


@dataclass(frozen=True)
class CodexThreadOrigin:
    runtime: str = "codex"
    thread_id: str = ""
    thread_title: str = ""
    rollout_path: str = ""
    source: str = ""
    model: str = ""
    model_provider: str = ""
    reasoning_effort: str = ""
    sandbox_policy: str = ""
    approval_mode: str = ""

    def as_dict(self) -> dict[str, str]:
        return {
            "runtime": self.runtime,
            "thread_id": self.thread_id,
            "thread_title": self.thread_title,
            "rollout_path": self.rollout_path,
            "source": self.source,
            "model": self.model,
            "model_provider": self.model_provider,
            "reasoning_effort": self.reasoning_effort,
            "sandbox_policy": self.sandbox_policy,
            "approval_mode": self.approval_mode,
        }


@dataclass(frozen=True)
class CodexTurnResult:
    reply_text: str
    used_thread_id: str
    requested_thread_id: str = ""
    thread_mode: str = "new"
    fallback_reason: str = ""

    @property
    def reused_existing_thread(self) -> bool:
        return self.thread_mode == "existing" and bool(self.used_thread_id)

    def routing(self) -> dict[str, str | bool]:
        return {
            "requested_thread_id": self.requested_thread_id,
            "used_thread_id": self.used_thread_id,
            "thread_mode": self.thread_mode,
            "reused_existing_thread": self.reused_existing_thread,
            "fallback_reason": self.fallback_reason,
        }


@dataclass
class CodexAppServerClient:
    command: list[str] = field(default_factory=lambda: ["codex", "app-server", "--listen", "stdio://"])
    cwd: str | None = None
    startup_timeout: float = 30.0
    turn_timeout: float = 300.0
    developer_instructions: str | None = None
    base_instructions: str | None = None
    base_instructions_provider: Callable[[], str | None] | None = None
    output_schema: dict[str, Any] | None = None
    codex_home: str | None = None
    approval_policy: str = "never"
    sandbox: str = "danger-full-access"
    model: str | None = None
    reasoning_effort: str | None = None
    action_logger: Callable[[dict[str, object]], None] | None = None

    def __post_init__(self) -> None:
        self._process: subprocess.Popen[str] | None = None
        self._next_id = 1
        self._pending: dict[int, queue.Queue[dict[str, Any]]] = {}
        self._notifications: queue.Queue[dict[str, Any]] = queue.Queue()
        self._lock = threading.RLock()
        self._ready = False
        self._thread_id: str | None = None
        self._stderr: list[str] = []
        self._turn_notifications: dict[str, queue.Queue[dict[str, Any]]] = {}
        self._turn_backlog: dict[str, list[dict[str, Any]]] = {}
        self._last_turn_routing: dict[str, str | bool] = {
            "requested_thread_id": "",
            "used_thread_id": "",
            "thread_mode": "new",
            "reused_existing_thread": False,
            "fallback_reason": "",
        }

    @property
    def ready(self) -> bool:
        return self._ready and self._process is not None and self._process.poll() is None

    @property
    def thread_id(self) -> str | None:
        return self._thread_id

    @property
    def stderr_tail(self) -> list[str]:
        return list(self._stderr[-20:])

    @property
    def last_turn_routing(self) -> dict[str, str | bool]:
        with self._lock:
            return dict(self._last_turn_routing)

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

    def send_turn(self, text: str, *, thread_id: str | None = None) -> CodexTurnResult:
        if not self.ready:
            raise CodexAppServerError("Codex app-server is not ready")
        clean = text.strip()
        if not clean:
            raise CodexAppServerError("cannot send an empty transcript to Codex")
        requested_thread_id = _clean_optional(thread_id)
        fallback_reason = ""
        thread_mode = "existing" if requested_thread_id else "new"
        used_thread_id = requested_thread_id

        if not used_thread_id:
            used_thread_id = self._start_thread()
        try:
            turn_id = self._start_turn(used_thread_id, clean)
        except CodexAppServerError as exc:
            if not requested_thread_id:
                raise
            fallback_reason = str(exc)
            used_thread_id = self._start_thread()
            thread_mode = "new"
            turn_id = self._start_turn(used_thread_id, clean)
        self._thread_id = used_thread_id
        reply_text = self._wait_for_reply(turn_id)
        result = CodexTurnResult(
            reply_text=reply_text,
            used_thread_id=used_thread_id,
            requested_thread_id=requested_thread_id,
            thread_mode=thread_mode,
            fallback_reason=fallback_reason,
        )
        with self._lock:
            self._last_turn_routing = result.routing()
        return result

    def _start_turn(self, thread_id: str, text: str) -> str:
        response = self.request(
            "turn/start",
            {
                "threadId": thread_id,
                **({"effort": self.reasoning_effort} if _clean_optional(self.reasoning_effort) else {}),
                **({"outputSchema": self.output_schema} if isinstance(self.output_schema, dict) else {}),
                "input": [
                    {
                        "type": "text",
                        "text": text,
                        "text_elements": [],
                    }
                ],
            },
            timeout=30.0,
        )
        turn_id = response.get("turn", {}).get("id")
        if not turn_id:
            raise CodexAppServerError("turn/start did not return a turn id")
        return str(turn_id)

    def _start_thread(self) -> str:
        params: dict[str, Any] = {
            "approvalPolicy": self.approval_policy,
            "sandbox": self.sandbox,
        }
        if _clean_optional(self.model):
            params["model"] = _clean_optional(self.model)
        if self.cwd:
            params["cwd"] = str(Path(self.cwd).resolve())
        if self.developer_instructions:
            params["developerInstructions"] = self.developer_instructions
        base_instructions = self._base_instructions()
        if base_instructions:
            params["baseInstructions"] = base_instructions
        response = self.request("thread/start", params, timeout=self.startup_timeout)
        thread_id = response.get("thread", {}).get("id")
        if not thread_id:
            raise CodexAppServerError("thread/start did not return a thread id")
        return str(thread_id)

    def _base_instructions(self) -> str:
        if self.base_instructions_provider is not None:
            return _clean_optional(self.base_instructions_provider())
        return _clean_optional(self.base_instructions)

    def set_thread_title(self, title: str, *, thread_id: str | None = None) -> None:
        clean = _clean_optional(title)
        resolved_thread_id = _clean_optional(thread_id) or _clean_optional(self._thread_id)
        if not clean or not resolved_thread_id:
            return
        self.request(
            "thread/name/set",
            {"threadId": resolved_thread_id, "name": clean},
            timeout=self.startup_timeout,
        )

    def thread_origin(self, thread_id: str | None = None, *, retries: int = 5, delay: float = 0.15) -> dict[str, str]:
        return self._thread_origin(thread_id or self._thread_id or "", retries=retries, delay=delay).as_dict()

    def _thread_origin(self, thread_id: str, *, retries: int, delay: float) -> CodexThreadOrigin:
        clean_thread_id = _clean_optional(thread_id) or _clean_optional(self._thread_id)
        origin = CodexThreadOrigin(thread_id=clean_thread_id)
        if not clean_thread_id:
            return origin
        for attempt in range(max(1, retries)):
            row = self._thread_row(clean_thread_id)
            if row is not None:
                origin = CodexThreadOrigin(
                    thread_id=clean_thread_id,
                    thread_title=_clean_optional(row.get("title")),
                    rollout_path=_clean_optional(row.get("rollout_path")),
                    source=_clean_optional(row.get("source")),
                    model=_clean_optional(row.get("model")),
                    model_provider=_clean_optional(row.get("model_provider")),
                    reasoning_effort=_clean_optional(row.get("reasoning_effort")),
                    sandbox_policy=_normalize_sandbox_policy(row.get("sandbox_policy")),
                    approval_mode=_clean_optional(row.get("approval_mode")),
                )
                if origin.rollout_path or attempt == retries - 1:
                    return origin
            if attempt < retries - 1:
                time.sleep(max(0.0, delay))
        return origin

    def _thread_row(self, thread_id: str) -> dict[str, Any] | None:
        state_db = self._state_db_path()
        if state_db is None or not state_db.exists():
            return None
        try:
            conn = sqlite3.connect(str(state_db))
            conn.row_factory = sqlite3.Row
            try:
                row = conn.execute(
                    """
                    SELECT id, title, rollout_path, source, model, model_provider,
                           reasoning_effort, sandbox_policy, approval_mode
                    FROM threads
                    WHERE id = ?
                    """,
                    (thread_id,),
                ).fetchone()
            finally:
                conn.close()
        except Exception:
            return None
        return dict(row) if row is not None else None

    def _state_db_path(self) -> Path | None:
        home = _clean_optional(self.codex_home) or _clean_optional(os.environ.get("CODEX_HOME"))
        if home:
            return Path(home).expanduser().resolve() / "state_5.sqlite"
        return (Path.home() / ".codex" / "state_5.sqlite").resolve()

    def _wait_for_reply(self, turn_id: str) -> str:
        deadline = time.monotonic() + self.turn_timeout
        deltas: dict[str, list[str]] = {}
        completed_text = ""
        turn_queue: queue.Queue[dict[str, Any]] = queue.Queue()
        with self._lock:
            self._turn_notifications[turn_id] = turn_queue
            for message in self._turn_backlog.pop(turn_id, []):
                turn_queue.put(message)
        try:
            while time.monotonic() < deadline:
                remaining = max(0.1, min(1.0, deadline - time.monotonic()))
                try:
                    message = turn_queue.get(timeout=remaining)
                except queue.Empty:
                    continue
                method = message.get("method")
                params = message.get("params") or {}
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
        finally:
            with self._lock:
                self._turn_notifications.pop(turn_id, None)

    def _route_turn_notification(self, turn_id: str, message: dict[str, Any]) -> bool:
        clean_turn_id = _clean_optional(turn_id)
        if not clean_turn_id:
            return False
        with self._lock:
            turn_queue = self._turn_notifications.get(clean_turn_id)
            if turn_queue is not None:
                turn_queue.put(message)
                return True
            self._turn_backlog.setdefault(clean_turn_id, []).append(message)
            return True

    def request(self, method: str, params: dict[str, Any] | None = None, *, timeout: float) -> dict[str, Any]:
        clean_params = params or {}
        started_at = time.time()
        with self._lock:
            request_id = self._next_id
            self._next_id += 1
            responses: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
            self._pending[request_id] = responses
            self._write({"id": request_id, "method": method, "params": clean_params})
        try:
            message = responses.get(timeout=timeout)
        except queue.Empty as exc:
            self._record_action(method, clean_params, "timeout", started_at)
            raise CodexAppServerError(f"Timed out waiting for {method}") from exc
        finally:
            with self._lock:
                self._pending.pop(request_id, None)
        if "error" in message:
            self._record_action(method, clean_params, "error", started_at)
            raise CodexAppServerError(f"{method} failed: {message['error']}")
        result = message.get("result")
        self._record_action(method, clean_params, "ok", started_at)
        return result if isinstance(result, dict) else {}

    def _record_action(self, method: str, params: dict[str, Any], status: str, started_at: float) -> None:
        if self.action_logger is None:
            return
        try:
            self.action_logger(
                {
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_at)),
                    "surface": "codex_runtime",
                    "action": method,
                    "tool": method,
                    "status": status,
                    "thread_id": _clean_optional(params.get("threadId")),
                }
            )
        except Exception:
            pass

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
            params = message.get("params") or {}
            event_turn_id = params.get("turnId")
            if event_turn_id is None and isinstance(params.get("turn"), dict):
                event_turn_id = params["turn"].get("id")
            if self._route_turn_notification(str(event_turn_id or ""), message):
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


def _clean_optional(value: object) -> str:
    return str(value or "").strip()


def _normalize_sandbox_policy(value: object) -> str:
    clean = _clean_optional(value)
    if not clean:
        return ""
    try:
        parsed = json.loads(clean)
        if isinstance(parsed, dict):
            raw_type = _clean_optional(parsed.get("type"))
            if raw_type == "dangerFullAccess":
                return "danger-full-access"
            if raw_type == "workspaceWrite":
                return "workspace-write"
            if raw_type == "readOnly":
                return "read-only"
            if raw_type:
                return raw_type
    except Exception:
        pass
    return clean
