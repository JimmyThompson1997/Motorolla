from __future__ import annotations

import hashlib
import re
import secrets
import sqlite3
import time
import uuid
from pathlib import Path

from .sqlite_utils import (
    configure_sqlite_connection,
    sqlite_retry_busy_timeout_ms,
    sqlite_retry_timeout_seconds,
)


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _utc_stamp(epoch_seconds: float | None = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch_seconds or time.time()))


def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")


def _hash_text(value: str) -> str:
    return hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()


def normalize_email(value: str) -> str:
    email = str(value or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise ValueError("invalid_email")
    return email


class AuthStore:
    def __init__(
        self,
        path: str | Path,
        *,
        otp_ttl_seconds: int = 15 * 60,
        session_ttl_seconds: int = 30 * 24 * 60 * 60,
    ) -> None:
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.otp_ttl_seconds = max(60, int(otp_ttl_seconds or 15 * 60))
        self.session_ttl_seconds = max(300, int(session_ttl_seconds or 30 * 24 * 60 * 60))
        self._ensure_schema()

    def issue_code(self, email: str, *, code: str | None = None) -> dict[str, str]:
        clean_email = normalize_email(email)
        now = time.time()
        otp_code = str(code or f"{secrets.randbelow(1_000_000):06d}").strip()
        challenge_id = f"otp_{uuid.uuid4().hex[:12]}"
        expires_at = now + self.otp_ttl_seconds
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO otp_challenges (
                    challenge_id, email, code_hash, created_at, expires_at, fulfilled_at, attempts
                ) VALUES (?, ?, ?, ?, ?, '', 0)
                """,
                (
                    challenge_id,
                    clean_email,
                    _hash_text(otp_code),
                    _utc_stamp(now),
                    _utc_stamp(expires_at),
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return {
            "challenge_id": challenge_id,
            "email": clean_email,
            "code": otp_code,
            "expires_at": _utc_stamp(expires_at),
        }

    def verify_code(self, email: str, code: str) -> dict[str, str]:
        clean_email = normalize_email(email)
        clean_code = str(code or "").strip()
        if not clean_code:
            raise ValueError("invalid_code")
        conn = self._connect()
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT challenge_id, code_hash, expires_at, fulfilled_at, attempts
                FROM otp_challenges
                WHERE email = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (clean_email,),
            ).fetchone()
            if row is None:
                raise ValueError("invalid_code")
            if str(row["fulfilled_at"] or "").strip():
                raise ValueError("invalid_code")
            if _utc_stamp() > str(row["expires_at"] or ""):
                raise ValueError("expired_code")
            if _hash_text(clean_code) != str(row["code_hash"] or ""):
                conn.execute(
                    "UPDATE otp_challenges SET attempts = ? WHERE challenge_id = ?",
                    (int(row["attempts"] or 0) + 1, str(row["challenge_id"] or "")),
                )
                conn.commit()
                raise ValueError("invalid_code")
            conn.execute(
                "UPDATE otp_challenges SET fulfilled_at = ? WHERE challenge_id = ?",
                (_utc_stamp(), str(row["challenge_id"] or "")),
            )
            conn.commit()
        finally:
            conn.close()
        return self.ensure_user_workspace(clean_email)

    def ensure_user_workspace(self, email: str) -> dict[str, str]:
        clean_email = normalize_email(email)
        user_id = f"usr_{_hash_text(clean_email)[:12]}"
        workspace_id = f"ws_{_hash_text(f'workspace:{clean_email}')[:12]}"
        local_part = clean_email.split("@", 1)[0]
        workspace_slug = (_slugify(local_part) or "workspace")[:32]
        workspace_slug = f"{workspace_slug}-{workspace_id[-6:]}"
        now = _utc_stamp()
        conn = self._connect()
        try:
            conn.row_factory = sqlite3.Row
            with conn:
                conn.execute(
                    """
                    INSERT INTO users (user_id, email, created_at, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        email = excluded.email,
                        updated_at = excluded.updated_at
                    """,
                    (user_id, clean_email, now, now),
                )
                conn.execute(
                    """
                    INSERT INTO workspaces (workspace_id, owner_user_id, email, slug, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(workspace_id) DO UPDATE SET
                        email = excluded.email,
                        slug = excluded.slug,
                        updated_at = excluded.updated_at
                    """,
                    (workspace_id, user_id, clean_email, workspace_slug, now, now),
                )
            return {
                "user_id": user_id,
                "workspace_id": workspace_id,
                "workspace_slug": workspace_slug,
                "email": clean_email,
            }
        finally:
            conn.close()

    def create_session(self, *, user_id: str, workspace_id: str, email: str) -> dict[str, str]:
        clean_user_id = str(user_id or "").strip()
        clean_workspace_id = str(workspace_id or "").strip()
        clean_email = normalize_email(email)
        if not clean_user_id or not clean_workspace_id:
            raise ValueError("session_identity_required")
        session_id = f"ses_{uuid.uuid4().hex[:16]}"
        secret = secrets.token_urlsafe(24)
        token = f"{session_id}.{secret}"
        now = time.time()
        expires_at = now + self.session_ttl_seconds
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO sessions (
                    session_id, user_id, workspace_id, email, secret_hash, created_at, expires_at, revoked_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, '')
                """,
                (
                    session_id,
                    clean_user_id,
                    clean_workspace_id,
                    clean_email,
                    _hash_text(secret),
                    _utc_stamp(now),
                    _utc_stamp(expires_at),
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return {
            "session_id": session_id,
            "token": token,
            "user_id": clean_user_id,
            "workspace_id": clean_workspace_id,
            "email": clean_email,
            "expires_at": _utc_stamp(expires_at),
        }

    def resolve_session(self, token: str) -> dict[str, str] | None:
        session_id, secret = self._split_token(token)
        if not session_id or not secret:
            return None
        conn = self._connect()
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT session_id, user_id, workspace_id, email, secret_hash, expires_at, revoked_at
                FROM sessions
                WHERE session_id = ?
                LIMIT 1
                """,
                (session_id,),
            ).fetchone()
        finally:
            conn.close()
        if row is None:
            return None
        if str(row["revoked_at"] or "").strip():
            return None
        if _utc_stamp() > str(row["expires_at"] or ""):
            return None
        if _hash_text(secret) != str(row["secret_hash"] or ""):
            return None
        return {
            "session_id": str(row["session_id"] or ""),
            "user_id": str(row["user_id"] or ""),
            "workspace_id": str(row["workspace_id"] or ""),
            "email": str(row["email"] or ""),
            "expires_at": str(row["expires_at"] or ""),
        }

    def revoke_session(self, token: str) -> bool:
        session_id, secret = self._split_token(token)
        if not session_id or not secret:
            return False
        session = self.resolve_session(token)
        if session is None:
            return False
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE sessions SET revoked_at = ? WHERE session_id = ?",
                (_utc_stamp(), session_id),
            )
            conn.commit()
            return True
        finally:
            conn.close()

    def _split_token(self, token: str) -> tuple[str, str]:
        clean = str(token or "").strip()
        if "." not in clean:
            return "", ""
        session_id, secret = clean.split(".", 1)
        return session_id.strip(), secret.strip()

    def _ensure_schema(self) -> None:
        conn = self._connect()
        try:
            with conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id TEXT NOT NULL UNIQUE,
                        email TEXT NOT NULL UNIQUE,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS workspaces (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        workspace_id TEXT NOT NULL UNIQUE,
                        owner_user_id TEXT NOT NULL UNIQUE,
                        email TEXT NOT NULL,
                        slug TEXT NOT NULL UNIQUE,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS otp_challenges (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        challenge_id TEXT NOT NULL UNIQUE,
                        email TEXT NOT NULL,
                        code_hash TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        fulfilled_at TEXT NOT NULL DEFAULT '',
                        attempts INTEGER NOT NULL DEFAULT 0
                    )
                    """
                )
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS sessions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL UNIQUE,
                        user_id TEXT NOT NULL,
                        workspace_id TEXT NOT NULL,
                        email TEXT NOT NULL,
                        secret_hash TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        revoked_at TEXT NOT NULL DEFAULT ''
                    )
                    """
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_otp_email_id ON otp_challenges(email, id DESC)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)")
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
