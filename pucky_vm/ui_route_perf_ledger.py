from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from .sqlite_utils import (
    configure_sqlite_connection,
    sqlite_retry_busy_timeout_ms,
    sqlite_retry_timeout_seconds,
)

DEFAULT_RECENT_LIMIT = 250
MAX_COUNTER_KEYS = 64
COUNTER_FIELDS = (
    "bridge_calls_by_command",
    "fetches_by_key",
    "poll_ticks_by_lane",
    "cache_hits_by_key",
)
NUMERIC_FIELDS = (
    "wall_elapsed_ms",
    "route_ready_elapsed_ms",
    "bridge_total_ms",
    "render_count",
    "last_render_ms",
    "route_enter_at_ms",
    "route_data_start_at_ms",
    "route_data_end_at_ms",
    "route_ready_at_ms",
    "deferred_tasks_started",
    "deferred_tasks_completed",
    "unchanged_refresh_skips",
)
STRING_FIELDS = (
    "schema",
    "surface",
    "route",
    "sample_reason",
    "device_class",
    "app_version",
    "ui_version",
    "boot_phase",
    "route_ready_reason",
    "session_id",
    "run_id",
)


class UiRoutePerfLedger:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def record(
        self,
        *,
        user_id: str,
        payload: dict[str, Any],
        timestamp: str | None = None,
    ) -> None:
        user_key = _clean_string(user_id)
        event = _sanitize_event(payload)
        if not user_key or not event:
            return
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO ui_route_perf_log (
                    timestamp,
                    user_id,
                    run_id,
                    session_id,
                    surface,
                    route,
                    cold_start,
                    sample_reason,
                    payload_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    _clean_string(timestamp) or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    user_key,
                    _clean_string(event.get("run_id")),
                    _clean_string(event.get("session_id")),
                    _clean_string(event.get("surface")),
                    _clean_string(event.get("route")),
                    1 if bool(event.get("cold_start")) else 0,
                    _clean_string(event.get("sample_reason")),
                    json.dumps(event, separators=(",", ":"), sort_keys=True),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def recent(
        self,
        user_id: str,
        *,
        limit: int = DEFAULT_RECENT_LIMIT,
        run_id: str = "",
    ) -> list[dict[str, Any]]:
        user_key = _clean_string(user_id)
        if not user_key:
            return []
        row_limit = max(1, min(1000, int(limit or DEFAULT_RECENT_LIMIT)))
        conn = self._connect()
        try:
            conn.row_factory = sqlite3.Row
            if _clean_string(run_id):
                rows = conn.execute(
                    """
                    SELECT timestamp, payload_json
                    FROM ui_route_perf_log
                    WHERE user_id = ?
                      AND run_id = ?
                    ORDER BY id DESC
                    LIMIT ?
                    """,
                    (user_key, _clean_string(run_id), row_limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT timestamp, payload_json
                    FROM ui_route_perf_log
                    WHERE user_id = ?
                    ORDER BY id DESC
                    LIMIT ?
                    """,
                    (user_key, row_limit),
                ).fetchall()
        finally:
            conn.close()
        events: list[dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(str(row["payload_json"] or "{}"))
            except json.JSONDecodeError:
                payload = {}
            if not isinstance(payload, dict):
                payload = {}
            payload["received_at"] = _clean_string(row["timestamp"])
            events.append(payload)
        return events

    def _ensure_schema(self) -> None:
        conn = self._connect()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ui_route_perf_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    run_id TEXT NOT NULL DEFAULT '',
                    session_id TEXT NOT NULL DEFAULT '',
                    surface TEXT NOT NULL DEFAULT '',
                    route TEXT NOT NULL DEFAULT '',
                    cold_start INTEGER NOT NULL DEFAULT 0,
                    sample_reason TEXT NOT NULL DEFAULT '',
                    payload_json TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_ui_route_perf_log_user_id_id
                ON ui_route_perf_log(user_id, id DESC)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_ui_route_perf_log_user_id_run_id_id
                ON ui_route_perf_log(user_id, run_id, id DESC)
                """
            )
            conn.commit()
        finally:
            conn.close()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(
            str(self.path),
            timeout=sqlite_retry_timeout_seconds(),
        )
        return configure_sqlite_connection(
            conn,
            wal=True,
            busy_timeout_ms=sqlite_retry_busy_timeout_ms(),
        )


def _sanitize_event(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    event: dict[str, Any] = {}
    for key in STRING_FIELDS:
        text = _clean_string(payload.get(key))
        if text:
            event[key] = text
    for key in NUMERIC_FIELDS:
        value = _safe_number(payload.get(key))
        if value is not None:
            event[key] = value
    event["cold_start"] = bool(payload.get("cold_start"))
    for key in COUNTER_FIELDS:
        counters = _sanitize_counter_map(payload.get(key))
        if counters:
            event[key] = counters
    schema = _clean_string(event.get("schema"))
    if schema != "pucky.ui_route_perf_event.v1":
        return {}
    event["schema"] = schema
    event["surface"] = _clean_string(event.get("surface")) or "unknown"
    event["route"] = _clean_string(event.get("route")) or "home"
    event["sample_reason"] = _clean_string(event.get("sample_reason")) or "unknown"
    event["run_id"] = _clean_string(event.get("run_id"))
    event["session_id"] = _clean_string(event.get("session_id"))
    return event


def _sanitize_counter_map(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        return {}
    cleaned: dict[str, int] = {}
    for key, raw in value.items():
        name = _clean_string(key)
        if not name:
            continue
        number = _safe_number(raw)
        if number is None:
            continue
        cleaned[name] = max(0, int(number))
        if len(cleaned) >= MAX_COUNTER_KEYS:
            break
    return cleaned


def _safe_number(value: Any) -> int | float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    integer = int(number)
    return integer if abs(number - integer) < 0.0001 else round(number, 1)


def _clean_string(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = " ".join(text.split())
    text = _redact(text)
    return text[:500]


def _redact(text: str) -> str:
    import re

    text = re.sub(r"(?i)(authorization:\s*bearer\s+)[^\s'\"|]+", r"\1[redacted]", text)
    text = re.sub(r"(?i)((?:api[_-]?key|token|secret|password)=)[^&\s'\"|]+", r"\1[redacted]", text)
    text = re.sub(
        r"(?i)(\"?(?:api[_-]?key|token|secret|password)\"?\s*:\s*\")([^\"]+)(\")",
        r"\1[redacted]\3",
        text,
    )
    return text
