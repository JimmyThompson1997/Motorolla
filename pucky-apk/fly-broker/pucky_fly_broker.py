#!/usr/bin/env python3
import base64
import hashlib
import hmac
import json
import os
import socket
import sqlite3
import struct
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
DEFAULT_DB_PATH = "/data/pucky/broker.sqlite3"
DEFAULT_ADB_WATCHDOG_STATUS_PATH = "/data/pucky/adb-watchdog-status.json"

LOCK = threading.RLock()
DEVICES = {}
DB = None


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def compact_json(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def decode_json(text, fallback):
    if text is None:
        return fallback
    try:
        return json.loads(text)
    except Exception:
        return fallback


def read_json_file(path, fallback):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return fallback


def init_db(path):
    global DB
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    DB = sqlite3.connect(path, check_same_thread=False)
    DB.row_factory = sqlite3.Row
    with LOCK:
        DB.execute("PRAGMA journal_mode=WAL")
        DB.execute("PRAGMA busy_timeout=5000")
        DB.executescript(
            """
            CREATE TABLE IF NOT EXISTS devices (
                device_id TEXT PRIMARY KEY,
                online INTEGER NOT NULL DEFAULT 0,
                last_seen TEXT,
                hello_json TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS commands (
                id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                type TEXT NOT NULL,
                args_json TEXT NOT NULL,
                ttl_ms INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL,
                ack_json TEXT,
                result_json TEXT,
                error_json TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                event TEXT NOT NULL,
                device_id TEXT,
                command_id TEXT,
                payload_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS capabilities (
                device_id TEXT NOT NULL,
                capability_id TEXT NOT NULL,
                status TEXT,
                permission TEXT,
                direct_control TEXT,
                last_tested_at TEXT,
                last_result_json TEXT,
                PRIMARY KEY(device_id, capability_id)
            );

            CREATE TABLE IF NOT EXISTS permissions (
                device_id TEXT NOT NULL,
                permission TEXT NOT NULL,
                granted INTEGER,
                can_request INTEGER,
                last_checked_at TEXT,
                notes TEXT,
                PRIMARY KEY(device_id, permission)
            );

            CREATE TABLE IF NOT EXISTS artifacts (
                artifact_id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                command_id TEXT,
                kind TEXT,
                mime_type TEXT,
                device_path TEXT,
                broker_path TEXT,
                bytes INTEGER,
                sha256 TEXT,
                created_at TEXT NOT NULL,
                uploaded_at TEXT,
                deleted_at TEXT,
                metadata_json TEXT
            );

            CREATE TABLE IF NOT EXISTS test_runs (
                test_run_id TEXT PRIMARY KEY,
                device_id TEXT,
                suite TEXT NOT NULL,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                status TEXT NOT NULL,
                summary_json TEXT
            );

            CREATE TABLE IF NOT EXISTS replies (
                reply_id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                command_id TEXT,
                prompt_id TEXT,
                text TEXT NOT NULL,
                received_at TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
            CREATE INDEX IF NOT EXISTS idx_commands_device ON commands(device_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_artifacts_device ON artifacts(device_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_test_runs_device ON test_runs(device_id, started_at);
            CREATE INDEX IF NOT EXISTS idx_replies_device ON replies(device_id, received_at);
            """
        )
        DB.execute("UPDATE devices SET online = 0, updated_at = ?", (now(),))
        DB.commit()


def record(entry):
    item = {"timestamp": now(), **entry}
    event = str(item.get("event") or "event")
    command = item.get("command") if isinstance(item.get("command"), dict) else {}
    command_id = item.get("command_id") or command.get("id")
    device_id = item.get("device_id") or command.get("device_id")
    with LOCK:
        DB.execute(
            """
            INSERT INTO events(timestamp, event, device_id, command_id, payload_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (item["timestamp"], event, device_id, command_id, compact_json(item)),
        )
        DB.commit()
    print(compact_json(item), flush=True)


def command_to_row(command):
    return (
        command["id"],
        command["device_id"],
        command["type"],
        compact_json(command.get("args") or {}),
        int(command.get("ttl_ms") or 30000),
        command.get("created_at") or now(),
        command.get("status") or "queued",
        compact_json(command["ack"]) if command.get("ack") is not None else None,
        compact_json(command["result"]) if command.get("result") is not None else None,
        compact_json(command["error"]) if command.get("error") is not None else None,
        now(),
    )


def persist_command(command):
    with LOCK:
        DB.execute(
            """
            INSERT INTO commands(
                id, device_id, type, args_json, ttl_ms, created_at, status,
                ack_json, result_json, error_json, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                device_id = excluded.device_id,
                type = excluded.type,
                args_json = excluded.args_json,
                ttl_ms = excluded.ttl_ms,
                created_at = excluded.created_at,
                status = excluded.status,
                ack_json = excluded.ack_json,
                result_json = excluded.result_json,
                error_json = excluded.error_json,
                updated_at = excluded.updated_at
            """,
            command_to_row(command),
        )
        DB.commit()


def command_from_row(row):
    if row is None:
        return None
    command = {
        "id": row["id"],
        "device_id": row["device_id"],
        "type": row["type"],
        "args": decode_json(row["args_json"], {}),
        "ttl_ms": row["ttl_ms"],
        "created_at": row["created_at"],
        "status": row["status"],
        "updated_at": row["updated_at"],
    }
    ack = decode_json(row["ack_json"], None)
    result = decode_json(row["result_json"], None)
    error = decode_json(row["error_json"], None)
    if ack is not None:
        command["ack"] = ack
    if result is not None:
        command["result"] = result
    if error is not None:
        command["error"] = error
    return command


def get_command(command_id):
    with LOCK:
        row = DB.execute("SELECT * FROM commands WHERE id = ?", (command_id,)).fetchone()
    return command_from_row(row)


def update_command_from_device(message):
    command_id = message.get("id")
    if not command_id:
        return None
    command = get_command(command_id)
    if not command:
        return None
    status = message.get("status")
    if status:
        command["status"] = status
    if message.get("schema") == "pucky.command_ack.v1":
        command["ack"] = message
    elif message.get("schema") == "pucky.command_result.v1":
        command["result"] = message
        if status == "failed":
            command["error"] = message.get("error")
    if message.get("schema") == "pucky.command_result.v1":
        ingest_command_result(command, message)
    persist_command(command)
    return command


def list_from_value(value):
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        items = []
        for key, item in value.items():
            if isinstance(item, dict):
                copy = dict(item)
                copy.setdefault("id", key)
                items.append(copy)
            else:
                items.append({"id": key, "value": item})
        return items
    return []


def bool_to_int(value):
    if value is None:
        return None
    if isinstance(value, str):
        if value.strip().lower() in ("true", "yes", "1", "granted"):
            return 1
        if value.strip().lower() in ("false", "no", "0", "denied"):
            return 0
    return 1 if bool(value) else 0


def stable_artifact_id(device_id, command_id, kind, device_path):
    seed = "|".join([device_id or "", command_id or "", kind or "", device_path or ""])
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
    return "art_" + digest


def ingest_command_result(command, message):
    result = message.get("result")
    if not isinstance(result, dict):
        return
    command_type = command.get("type") or message.get("type") or ""
    device_id = command.get("device_id")
    command_id = command.get("id") or message.get("id")
    if command_type == "capabilities.get":
        ingest_capabilities(device_id, result)
    if command_type == "permissions.get":
        ingest_permissions(device_id, result)
    ingest_artifacts(device_id, command_id, command_type, result)


def ingest_capabilities(device_id, result):
    values = result.get("capabilities")
    if values is None:
        values = result.get("capability_map")
    timestamp = result.get("timestamp") or result.get("reported_at") or now()
    rows = []
    for item in list_from_value(values):
        if not isinstance(item, dict):
            continue
        capability_id = (
            item.get("capability_id")
            or item.get("id")
            or item.get("command")
            or item.get("type")
            or item.get("name")
        )
        if not capability_id:
            continue
        rows.append(
            (
                device_id,
                str(capability_id),
                item.get("status") or item.get("state") or item.get("support"),
                json_or_text(item.get("permission") or item.get("permissions")),
                json_or_text(item.get("direct_control")),
                item.get("last_tested_at") or timestamp,
                compact_json(item),
            )
        )
    if not rows:
        return
    with LOCK:
        DB.executemany(
            """
            INSERT INTO capabilities(
                device_id, capability_id, status, permission, direct_control,
                last_tested_at, last_result_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id, capability_id) DO UPDATE SET
                status = excluded.status,
                permission = excluded.permission,
                direct_control = excluded.direct_control,
                last_tested_at = excluded.last_tested_at,
                last_result_json = excluded.last_result_json
            """,
            rows,
        )
        DB.commit()
    record({"event": "capability_reported", "device_id": device_id, "count": len(rows)})


def ingest_permissions(device_id, result):
    values = result.get("permissions")
    timestamp = result.get("timestamp") or result.get("checked_at") or now()
    rows = []
    for item in list_from_value(values):
        if not isinstance(item, dict):
            continue
        permission = item.get("permission") or item.get("name") or item.get("id")
        if not permission:
            continue
        granted = item.get("granted")
        if granted is None and "value" in item:
            granted = item.get("value")
        rows.append(
            (
                device_id,
                str(permission),
                bool_to_int(granted),
                bool_to_int(item.get("can_request")),
                item.get("last_checked_at") or timestamp,
                item.get("notes") or item.get("note") or "",
            )
        )
    if not rows:
        return
    with LOCK:
        DB.executemany(
            """
            INSERT INTO permissions(
                device_id, permission, granted, can_request, last_checked_at, notes
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id, permission) DO UPDATE SET
                granted = excluded.granted,
                can_request = excluded.can_request,
                last_checked_at = excluded.last_checked_at,
                notes = excluded.notes
            """,
            rows,
        )
        DB.commit()
    record({"event": "permission_reported", "device_id": device_id, "count": len(rows)})


def ingest_artifacts(device_id, command_id, command_type, result):
    artifacts = []
    if isinstance(result.get("artifacts"), list):
        artifacts.extend([item for item in result["artifacts"] if isinstance(item, dict)])
    if result.get("artifact_id") or result.get("path") or result.get("device_path"):
        artifacts.append(result)
    rows = []
    for item in artifacts:
        kind = item.get("kind")
        if not kind and command_type == "photo.capture":
            kind = "photo"
        if not kind:
            kind = "artifact"
        device_path = item.get("device_path") or item.get("path")
        artifact_id = item.get("artifact_id") or stable_artifact_id(device_id, command_id, kind, device_path)
        rows.append(
            (
                artifact_id,
                device_id,
                command_id,
                kind,
                item.get("mime_type"),
                device_path,
                item.get("broker_path"),
                item.get("bytes"),
                item.get("sha256"),
                item.get("created_at") or now(),
                item.get("uploaded_at"),
                item.get("deleted_at"),
                compact_json(item),
            )
        )
    if not rows:
        return
    with LOCK:
        DB.executemany(
            """
            INSERT INTO artifacts(
                artifact_id, device_id, command_id, kind, mime_type, device_path,
                broker_path, bytes, sha256, created_at, uploaded_at, deleted_at,
                metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(artifact_id) DO UPDATE SET
                device_id = excluded.device_id,
                command_id = excluded.command_id,
                kind = excluded.kind,
                mime_type = excluded.mime_type,
                device_path = excluded.device_path,
                broker_path = excluded.broker_path,
                bytes = excluded.bytes,
                sha256 = excluded.sha256,
                uploaded_at = excluded.uploaded_at,
                deleted_at = excluded.deleted_at,
                metadata_json = excluded.metadata_json
            """,
            rows,
        )
        DB.commit()
    record({"event": "artifact_created", "device_id": device_id, "count": len(rows)})


def json_or_text(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return compact_json(value)
    return str(value)


def set_device(device_id, online, hello=None):
    timestamp = now()
    with LOCK:
        current = DB.execute(
            "SELECT hello_json FROM devices WHERE device_id = ?",
            (device_id,),
        ).fetchone()
        hello_json = compact_json(hello) if hello is not None else (current["hello_json"] if current else None)
        DB.execute(
            """
            INSERT INTO devices(device_id, online, last_seen, hello_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(device_id) DO UPDATE SET
                online = excluded.online,
                last_seen = excluded.last_seen,
                hello_json = excluded.hello_json,
                updated_at = excluded.updated_at
            """,
            (device_id, 1 if online else 0, timestamp, hello_json, timestamp),
        )
        DB.commit()


def list_devices():
    with LOCK:
        rows = DB.execute(
            "SELECT * FROM devices ORDER BY updated_at DESC, device_id ASC"
        ).fetchall()
        live_ids = set(DEVICES.keys())
    devices = []
    for row in rows:
        devices.append(
            {
                "device_id": row["device_id"],
                "online": row["device_id"] in live_ids and bool(row["online"]),
                "last_seen": row["last_seen"],
                "hello": decode_json(row["hello_json"], None),
                "updated_at": row["updated_at"],
            }
        )
    return devices


def get_device(device_id):
    for device in list_devices():
        if device["device_id"] == device_id:
            return device
    return None


def history(limit, device_id=None):
    limit = max(1, min(1000, int(limit or 200)))
    with LOCK:
        if device_id:
            rows = DB.execute(
                "SELECT payload_json FROM events WHERE device_id = ? ORDER BY id DESC LIMIT ?",
                (device_id, limit),
            ).fetchall()
        else:
            rows = DB.execute(
                "SELECT payload_json FROM events ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return [decode_json(row["payload_json"], {}) for row in reversed(rows)]


def list_capabilities(device_id):
    with LOCK:
        rows = DB.execute(
            """
            SELECT * FROM capabilities
            WHERE device_id = ?
            ORDER BY capability_id ASC
            """,
            (device_id,),
        ).fetchall()
    return [
        {
            "device_id": row["device_id"],
            "capability_id": row["capability_id"],
            "status": row["status"],
            "permission": decode_json(row["permission"], row["permission"]),
            "direct_control": decode_json(row["direct_control"], row["direct_control"]),
            "last_tested_at": row["last_tested_at"],
            "last_result": decode_json(row["last_result_json"], None),
        }
        for row in rows
    ]


def list_permissions(device_id):
    with LOCK:
        rows = DB.execute(
            """
            SELECT * FROM permissions
            WHERE device_id = ?
            ORDER BY permission ASC
            """,
            (device_id,),
        ).fetchall()
    return [
        {
            "device_id": row["device_id"],
            "permission": row["permission"],
            "granted": None if row["granted"] is None else bool(row["granted"]),
            "can_request": None if row["can_request"] is None else bool(row["can_request"]),
            "last_checked_at": row["last_checked_at"],
            "notes": row["notes"],
        }
        for row in rows
    ]


def list_artifacts(device_id):
    with LOCK:
        rows = DB.execute(
            """
            SELECT * FROM artifacts
            WHERE device_id = ? AND deleted_at IS NULL
            ORDER BY created_at DESC, artifact_id ASC
            """,
            (device_id,),
        ).fetchall()
    return [artifact_from_row(row) for row in rows]


def get_artifact(device_id, artifact_id):
    with LOCK:
        row = DB.execute(
            "SELECT * FROM artifacts WHERE device_id = ? AND artifact_id = ?",
            (device_id, artifact_id),
        ).fetchone()
    return artifact_from_row(row) if row else None


def artifact_from_row(row):
    return {
        "artifact_id": row["artifact_id"],
        "device_id": row["device_id"],
        "command_id": row["command_id"],
        "kind": row["kind"],
        "mime_type": row["mime_type"],
        "device_path": row["device_path"],
        "broker_path": row["broker_path"],
        "bytes": row["bytes"],
        "sha256": row["sha256"],
        "created_at": row["created_at"],
        "uploaded_at": row["uploaded_at"],
        "deleted_at": row["deleted_at"],
        "metadata": decode_json(row["metadata_json"], None),
    }


def create_test_run(body):
    timestamp = now()
    test_run_id = body.get("test_run_id") or "tr_" + str(uuid.uuid4())
    started_at = body.get("started_at") or timestamp
    completed_at = body.get("completed_at")
    status = body.get("status") or "running"
    summary = body.get("summary") or {}
    with LOCK:
        DB.execute(
            """
            INSERT INTO test_runs(
                test_run_id, device_id, suite, started_at, completed_at, status,
                summary_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(test_run_id) DO UPDATE SET
                device_id = excluded.device_id,
                suite = excluded.suite,
                completed_at = excluded.completed_at,
                status = excluded.status,
                summary_json = excluded.summary_json
            """,
            (
                test_run_id,
                body.get("device_id"),
                body.get("suite") or "unknown",
                started_at,
                completed_at,
                status,
                compact_json(summary),
            ),
        )
        DB.commit()
    run = get_test_run(test_run_id)
    record({"event": "test_run_recorded", "device_id": body.get("device_id"), "test_run_id": test_run_id, "suite": run["suite"], "status": run["status"]})
    return run


def get_test_run(test_run_id):
    with LOCK:
        row = DB.execute(
            "SELECT * FROM test_runs WHERE test_run_id = ?",
            (test_run_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "test_run_id": row["test_run_id"],
        "device_id": row["device_id"],
        "suite": row["suite"],
        "started_at": row["started_at"],
        "completed_at": row["completed_at"],
        "status": row["status"],
        "summary": decode_json(row["summary_json"], {}),
    }


def create_reply(device_id, body):
    timestamp = body.get("received_at") or now()
    reply_id = body.get("reply_id") or "reply_" + str(uuid.uuid4())
    text = str(body.get("text") or "")
    payload = {
        "schema": body.get("schema") or "pucky.reply.v1",
        "reply_id": reply_id,
        "device_id": device_id,
        "command_id": body.get("command_id"),
        "prompt_id": body.get("prompt_id"),
        "text": text,
        "received_at": timestamp,
    }
    extra = body.get("extra")
    if isinstance(extra, dict):
        payload["extra"] = extra
    with LOCK:
        DB.execute(
            """
            INSERT INTO replies(
                reply_id, device_id, command_id, prompt_id, text, received_at,
                payload_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(reply_id) DO UPDATE SET
                device_id = excluded.device_id,
                command_id = excluded.command_id,
                prompt_id = excluded.prompt_id,
                text = excluded.text,
                received_at = excluded.received_at,
                payload_json = excluded.payload_json
            """,
            (
                reply_id,
                device_id,
                body.get("command_id"),
                body.get("prompt_id"),
                text,
                timestamp,
                compact_json(payload),
            ),
        )
        DB.commit()
    record({
        "event": "reply_received",
        "device_id": device_id,
        "command_id": body.get("command_id"),
        "reply_id": reply_id,
        "prompt_id": body.get("prompt_id"),
    })
    return payload


def list_replies(device_id, limit=50, since_id=None):
    limit = max(1, min(200, int(limit or 50)))
    with LOCK:
        if since_id:
            marker = DB.execute(
                "SELECT received_at FROM replies WHERE device_id = ? AND reply_id = ?",
                (device_id, since_id),
            ).fetchone()
            if marker:
                rows = DB.execute(
                    """
                    SELECT payload_json FROM replies
                    WHERE device_id = ? AND received_at > ?
                    ORDER BY received_at ASC, reply_id ASC
                    LIMIT ?
                    """,
                    (device_id, marker["received_at"], limit),
                ).fetchall()
            else:
                rows = DB.execute(
                    """
                    SELECT payload_json FROM replies
                    WHERE device_id = ?
                    ORDER BY received_at DESC, reply_id DESC
                    LIMIT ?
                    """,
                    (device_id, limit),
                ).fetchall()
                rows = list(reversed(rows))
        else:
            rows = DB.execute(
                """
                SELECT payload_json FROM replies
                WHERE device_id = ?
                ORDER BY received_at DESC, reply_id DESC
                LIMIT ?
                """,
                (device_id, limit),
            ).fetchall()
            rows = list(reversed(rows))
    return [decode_json(row["payload_json"], {}) for row in rows]


def ws_send(sock, message):
    payload = message.encode("utf-8")
    header = bytearray([0x81])
    length = len(payload)
    if length < 126:
        header.append(length)
    elif length < 65536:
        header.append(126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(127)
        header.extend(struct.pack("!Q", length))
    sock.sendall(bytes(header) + payload)


def ws_send_pong(sock, payload):
    if len(payload) >= 126:
        payload = payload[:125]
    header = bytearray([0x8A, len(payload)])
    sock.sendall(bytes(header) + payload)


def recv_exact(sock, n):
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise ConnectionError("socket closed")
        data += chunk
    return data


def ws_recv(sock):
    first = recv_exact(sock, 2)
    opcode = first[0] & 0x0F
    masked = bool(first[1] & 0x80)
    length = first[1] & 0x7F
    if length == 126:
        length = struct.unpack("!H", recv_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", recv_exact(sock, 8))[0]
    mask = recv_exact(sock, 4) if masked else b"\x00\x00\x00\x00"
    payload = bytearray(recv_exact(sock, length))
    if masked:
        for i in range(length):
            payload[i] ^= mask[i % 4]
    if opcode == 8:
        raise ConnectionError("websocket close")
    if opcode == 9:
        ws_send_pong(sock, bytes(payload))
        return None
    if opcode == 10:
        return None
    return payload.decode("utf-8", errors="replace")


def bearer_token(headers):
    value = headers.get("Authorization") or ""
    if not value.lower().startswith("bearer "):
        return ""
    return value[7:].strip()


def compare_token(actual, expected):
    if not expected:
        return True
    return hmac.compare_digest(actual or "", expected)


def query_token(path):
    parsed = urlparse(path)
    values = parse_qs(parsed.query).get("token") or []
    return values[0] if values else ""


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/health":
            return self.send_json({"ok": True, "devices_online": len(DEVICES)})
        if not self.require_operator():
            return
        if path == "/v1/adb/status":
            status_path = os.environ.get("PUCKY_ADB_WATCHDOG_STATUS", DEFAULT_ADB_WATCHDOG_STATUS_PATH)
            status = read_json_file(status_path, {
                "state": "missing",
                "status_path": status_path,
                "error": "watchdog status file not found",
            })
            return self.send_json(status)
        if path == "/devices":
            return self.send_json({"devices": list_devices()})
        if path == "/v1/devices":
            return self.send_json({"devices": list_devices()})
        if path == "/history":
            limit = (parse_qs(parsed.query).get("limit") or ["200"])[0]
            return self.send_json({"history": history(limit)})
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "v1" and parts[1] == "commands":
            command = get_command(unquote(parts[2]))
            return self.send_json(command if command else {"error": "NOT_FOUND"}, 200 if command else 404)
        if len(parts) == 3 and parts[0] == "v1" and parts[1] == "test-runs":
            run = get_test_run(unquote(parts[2]))
            return self.send_json(run if run else {"error": "NOT_FOUND"}, 200 if run else 404)
        if len(parts) >= 3 and parts[0] == "v1" and parts[1] == "devices":
            device_id = unquote(parts[2])
            if len(parts) == 3:
                device = get_device(device_id)
                return self.send_json(device if device else {"error": "NOT_FOUND"}, 200 if device else 404)
            if len(parts) == 4 and parts[3] == "capabilities":
                return self.send_json({"device_id": device_id, "capabilities": list_capabilities(device_id)})
            if len(parts) == 4 and parts[3] == "permissions":
                return self.send_json({"device_id": device_id, "permissions": list_permissions(device_id)})
            if len(parts) == 4 and parts[3] == "history":
                limit = (parse_qs(parsed.query).get("limit") or ["200"])[0]
                return self.send_json({"device_id": device_id, "history": history(limit, device_id)})
            if len(parts) == 4 and parts[3] == "replies":
                query = parse_qs(parsed.query)
                limit = (query.get("limit") or ["50"])[0]
                since_id = (query.get("since_id") or [""])[0] or None
                return self.send_json({
                    "device_id": device_id,
                    "replies": list_replies(device_id, limit=limit, since_id=since_id),
                })
            if len(parts) == 4 and parts[3] == "artifacts":
                return self.send_json({"device_id": device_id, "artifacts": list_artifacts(device_id)})
            if len(parts) == 5 and parts[3] == "artifacts":
                artifact = get_artifact(device_id, unquote(parts[4]))
                return self.send_json(artifact if artifact else {"error": "NOT_FOUND"}, 200 if artifact else 404)
            if len(parts) == 5 and parts[3] == "commands":
                command = get_command(unquote(parts[4]))
                return self.send_json(command if command else {"error": "NOT_FOUND"}, 200 if command else 404)
        if len(parts) == 4 and parts[0] == "devices" and parts[2] == "commands":
            command = get_command(unquote(parts[3]))
            return self.send_json(command if command else {"error": "NOT_FOUND"}, 200 if command else 404)
        return self.send_json({"error": "NOT_FOUND"}, 404)

    def do_POST(self):
        path = urlparse(self.path).path
        parts = path.strip("/").split("/")
        if len(parts) == 4 and parts[0] == "v1" and parts[1] == "devices" and parts[3] == "events":
            if not self.require_device():
                return
            body = self.read_json()
            if body is None:
                return self.send_json({"error": "INVALID_JSON"}, 400)
            device_id = unquote(parts[2])
            body_device_id = body.get("device_id")
            if body_device_id and str(body_device_id) != device_id:
                return self.send_json({"error": "DEVICE_ID_MISMATCH"}, 400)
            body.setdefault("schema", "pucky.keyword_triggered.v1")
            body["device_id"] = device_id
            event_name = body.get("type") or body.get("event") or "device_event"
            body["event"] = event_name
            record({"event": event_name, "device_id": device_id, "payload": body})
            return self.send_json({"ok": True, "event": body}, 201)
        if len(parts) == 4 and parts[0] == "v1" and parts[1] == "devices" and parts[3] == "replies":
            if not self.require_device():
                return
            body = self.read_json()
            if body is None:
                return self.send_json({"error": "INVALID_JSON"}, 400)
            device_id = unquote(parts[2])
            return self.send_json({"reply": create_reply(device_id, body)}, 201)
        if not self.require_operator():
            return
        if len(parts) == 2 and parts[0] == "v1" and parts[1] == "test-runs":
            body = self.read_json()
            if body is None:
                return self.send_json({"error": "INVALID_JSON"}, 400)
            return self.send_json({"test_run": create_test_run(body)}, 201)
        old_command_path = len(parts) == 3 and parts[0] == "devices" and parts[2] == "commands"
        v1_command_path = len(parts) == 4 and parts[0] == "v1" and parts[1] == "devices" and parts[3] == "commands"
        if old_command_path or v1_command_path:
            body = self.read_json()
            if body is None:
                return self.send_json({"error": "INVALID_JSON"}, 400)
            device_id = unquote(parts[2] if v1_command_path else parts[1])
            command = {
                "id": body.get("id") or "cmd_" + str(uuid.uuid4()),
                "type": body.get("type") or "ping",
                "args": body.get("args") or {},
                "ttl_ms": body.get("ttl_ms") or 30000,
                "created_at": body.get("created_at") or now(),
                "device_id": device_id,
                "status": "queued",
            }
            persist_command(command)
            record({"event": "command_queued", "command": command})
            with LOCK:
                device = DEVICES.get(device_id)
            if not device:
                command["status"] = "device_offline"
                persist_command(command)
                record({"event": "command_offline", "command": command})
                return self.send_json({"error": "DEVICE_OFFLINE", "command": command}, 409)
            try:
                ws_send(device["socket"], compact_json({
                    "schema": "pucky.command.v1",
                    "id": command["id"],
                    "type": command["type"],
                    "args": command["args"],
                    "created_at": command["created_at"],
                    "ttl_ms": command["ttl_ms"],
                }))
            except Exception as exc:
                command["status"] = "send_failed"
                command["error"] = {"message": str(exc)}
                persist_command(command)
                record({"event": "command_send_failed", "command": command})
                return self.send_json({"error": "SEND_FAILED", "command": command}, 502)
            command["status"] = "sent"
            persist_command(command)
            record({"event": "command_sent", "command": command})
            return self.send_json({"command": command}, 202)
        return self.send_json({"error": "NOT_FOUND"}, 404)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("content-length", "0")
        self.end_headers()

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("content-length", "0")
        self.end_headers()

    def parse_request(self):
        ok = super().parse_request()
        if not ok:
            return False
        if self.headers.get("Upgrade", "").lower() == "websocket":
            self.handle_websocket()
            return False
        return True

    def handle_websocket(self):
        parsed = urlparse(self.path)
        path = parsed.path
        parts = path.strip("/").split("/")
        if len(parts) != 4 or parts[0] != "v1" or parts[1] != "devices" or parts[3] != "connect":
            self.send_error(404)
            return
        if not self.require_device():
            return
        device_id = unquote(parts[2])
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        sock = self.connection
        with LOCK:
            DEVICES[device_id] = {"socket": sock, "last_seen": now(), "hello": None}
        set_device(device_id, True)
        record({"event": "device_connected", "device_id": device_id})
        try:
            while True:
                text = ws_recv(sock)
                if text is None:
                    continue
                try:
                    message = json.loads(text)
                except Exception:
                    message = {"schema": "unknown", "raw": text}
                with LOCK:
                    device = DEVICES.get(device_id)
                    if device:
                        device["last_seen"] = now()
                        if message.get("schema") == "pucky.hello.v1":
                            device["hello"] = message
                            set_device(device_id, True, message)
                        else:
                            set_device(device_id, True)
                update_command_from_device(message)
                record({"event": "device_message", "device_id": device_id, "message": message})
        except Exception as exc:
            record({"event": "device_closed", "device_id": device_id, "error": str(exc)})
            with LOCK:
                current = DEVICES.get(device_id)
                if current and current.get("socket") is sock:
                    DEVICES.pop(device_id, None)
            set_device(device_id, False)
            try:
                sock.close()
            except Exception:
                pass

    def require_operator(self):
        expected = os.environ.get("PUCKY_OPERATOR_TOKEN", "operator-dev-token")
        if compare_token(bearer_token(self.headers), expected):
            return True
        self.send_json({"error": "UNAUTHORIZED"}, 401)
        return False

    def require_device(self):
        expected = os.environ.get("PUCKY_DEVICE_TOKEN", "dev-token")
        actual = bearer_token(self.headers) or query_token(self.path)
        if compare_token(actual, expected):
            return True
        self.send_json({"error": "UNAUTHORIZED"}, 401)
        return False

    def read_json(self):
        size = int(self.headers.get("content-length", "0"))
        if size <= 0:
            return {}
        try:
            return json.loads(self.rfile.read(size).decode("utf-8"))
        except Exception:
            return None

    def send_json(self, body, status=200):
        payload = json.dumps(body, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    db_path = os.environ.get("PUCKY_DB_PATH", DEFAULT_DB_PATH)
    init_db(db_path)
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    record({"event": "fly_broker_listening", "port": port, "db_path": db_path})
    server.serve_forever()
