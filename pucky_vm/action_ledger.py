from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Any


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
                    timestamp, user_id, thread_id, thread_title, surface, action, tool, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    _clean(timestamp) or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    user_key,
                    _clean(thread_id),
                    _clean(thread_title),
                    surface_key,
                    action_key,
                    _clean(tool) or action_key,
                    _clean(status) or "unknown",
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def last_500(self, user_id: str) -> list[dict[str, str]]:
        user_key = _clean(user_id)
        if not user_key:
            return []
        conn = self._connect()
        try:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT timestamp, thread_id, thread_title, surface, action, tool, status
                FROM action_log
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT 500
                """,
                (user_key,),
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
                    status TEXT NOT NULL DEFAULT ''
                )
                """
            )
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
        return sqlite3.connect(str(self.path), timeout=0.05)


def _clean(value: Any) -> str:
    return str(value or "").strip()
