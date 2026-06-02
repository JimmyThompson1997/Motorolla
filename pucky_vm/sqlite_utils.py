from __future__ import annotations

import sqlite3
from typing import Any

DEFAULT_SQLITE_TIMEOUT_SECONDS = 5.0
DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5000
SQLITE_LOCK_RETRY_DELAYS_SECONDS: tuple[float, ...] = (0.1, 0.25, 0.5)
SQLITE_LOCK_TOKENS = (
    "database is locked",
    "database table is locked",
    "database schema is locked",
)


def configure_sqlite_connection(
    conn: sqlite3.Connection,
    *,
    wal: bool = False,
    busy_timeout_ms: int = DEFAULT_SQLITE_BUSY_TIMEOUT_MS,
) -> sqlite3.Connection:
    try:
        conn.execute(f"PRAGMA busy_timeout={max(0, int(busy_timeout_ms))}")
    except Exception:
        pass
    if wal:
        try:
            conn.execute("PRAGMA journal_mode=WAL")
        except Exception:
            pass
    return conn


def sqlite_lock_error(exc: BaseException | None) -> bool:
    if exc is None:
        return False
    if not isinstance(exc, sqlite3.OperationalError):
        return False
    message = str(exc).strip().lower()
    return any(token in message for token in SQLITE_LOCK_TOKENS)


def sqlite_retry_timeout_seconds(timeout: float | None = None) -> float:
    if timeout is None:
        return DEFAULT_SQLITE_TIMEOUT_SECONDS
    try:
        value = float(timeout)
    except Exception:
        return DEFAULT_SQLITE_TIMEOUT_SECONDS
    return max(0.1, value)


def sqlite_retry_busy_timeout_ms(timeout_ms: Any = None) -> int:
    if timeout_ms is None:
        return DEFAULT_SQLITE_BUSY_TIMEOUT_MS
    try:
        value = int(timeout_ms)
    except Exception:
        return DEFAULT_SQLITE_BUSY_TIMEOUT_MS
    return max(100, value)
