from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Any

from .sqlite_utils import (
    configure_sqlite_connection,
    sqlite_retry_busy_timeout_ms,
    sqlite_retry_timeout_seconds,
)

DEFAULT_RECENT_LIMIT = 150
LOW_SIGNAL_ACTIONS = (
    "GET /api/feed",
    "GET /api/card-icons",
    "GET /healthz",
)
PROMPT_VISIBLE_SURFACES = (
    "agent_runtime",
    "apk_broker",
    "codex_runtime",
    "codex_tool",
    "composio",
)


class ActionLedger:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def record(
        self,
        *,
        user_id: str,
        surface: str,
        action: str,
        status: str,
        thread_id: str = "",
        thread_title: str = "",
        tool: str = "",
        target: str = "",
        timestamp: str | None = None,
    ) -> None:
        user_key = _clean(user_id)
        surface_key = _clean(surface)
        action_key = _clean(action)
        if not user_key or not surface_key or not action_key:
            return
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO action_log (
                    timestamp, user_id, thread_id, thread_title, surface, action, tool, target, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    _clean(timestamp) or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    user_key,
                    _clean(thread_id),
                    _clean(thread_title),
                    surface_key,
                    action_key,
                    _clean(tool) or action_key,
                    _clean(target),
                    _clean(status) or "unknown",
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
        prompt_visible_only: bool = True,
    ) -> list[dict[str, str]]:
        user_key = _clean(user_id)
        if not user_key:
            return []
        row_limit = max(1, min(1000, int(limit or DEFAULT_RECENT_LIMIT)))
        conn = self._connect()
        try:
            conn.row_factory = sqlite3.Row
            if prompt_visible_only:
                rows = conn.execute(
                    """
                    SELECT timestamp, thread_id, thread_title, surface, action, tool, target, status
                    FROM action_log
                    WHERE user_id = ?
                      AND action NOT IN (?, ?, ?)
                      AND tool NOT IN (?, ?, ?)
                      AND target NOT IN (?, ?, ?)
                      AND (
                        surface IN (?, ?, ?, ?, ?)
                        OR (surface = 'pucky_http' AND action NOT LIKE 'GET %')
                      )
                    ORDER BY id DESC
                    LIMIT ?
                    """,
                    (
                        user_key,
                        *LOW_SIGNAL_ACTIONS,
                        *LOW_SIGNAL_ACTIONS,
                        "/api/feed",
                        "/api/card-icons",
                        "/healthz",
                        *PROMPT_VISIBLE_SURFACES,
                        row_limit,
                    ),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT timestamp, thread_id, thread_title, surface, action, tool, target, status
                    FROM action_log
                    WHERE user_id = ?
                    ORDER BY id DESC
                    LIMIT ?
                    """,
                    (user_key, row_limit),
                ).fetchall()
        finally:
            conn.close()
        return [dict(row) for row in rows]

    def _ensure_schema(self) -> None:
        conn = self._connect()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS action_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    thread_id TEXT NOT NULL DEFAULT '',
                    thread_title TEXT NOT NULL DEFAULT '',
                    surface TEXT NOT NULL,
                    action TEXT NOT NULL,
                    tool TEXT NOT NULL DEFAULT '',
                    target TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT ''
                )
                """
            )
            if not _has_column(conn, "action_log", "target"):
                conn.execute("ALTER TABLE action_log ADD COLUMN target TEXT NOT NULL DEFAULT ''")
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_action_log_user_id_id
                ON action_log(user_id, id DESC)
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


def _clean(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = " ".join(text.split())
    text = _redact(text)
    return text[:500]


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(str(row[1]) == column for row in rows)


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
