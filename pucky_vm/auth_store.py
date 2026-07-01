from __future__ import annotations

import re
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


def normalize_email(value: str) -> str:
    email = str(value or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise ValueError("invalid_email")
    return email


def _optional_email(value: str) -> str:
    clean = str(value or "").strip()
    if not clean:
        return ""
    return normalize_email(clean)


class AuthStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def get_binding(self, clerk_user_id: str) -> dict[str, str] | None:
        clean_clerk_user_id = str(clerk_user_id or "").strip()
        if not clean_clerk_user_id:
            return None
        conn = self._connect()
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                """
                SELECT clerk_user_id, app_user_id, workspace_id, workspace_slug, primary_email,
                       legacy_claim_marker, legacy_workspace_migrated_at, created_at, updated_at
                FROM auth_bindings
                WHERE clerk_user_id = ?
                LIMIT 1
                """,
                (clean_clerk_user_id,),
            ).fetchone()
            return self._row_to_binding(row)
        finally:
            conn.close()

    def ensure_binding(
        self,
        *,
        clerk_user_id: str,
        primary_email: str,
        legacy_claim_email: str,
        legacy_claim_marker: str,
        legacy_app_user_id: str,
        legacy_workspace_id: str,
        legacy_workspace_slug: str,
    ) -> dict[str, str]:
        clean_clerk_user_id = str(clerk_user_id or "").strip()
        if not clean_clerk_user_id:
            raise ValueError("clerk_user_id_required")
        clean_email = _optional_email(primary_email)
        clean_legacy_email = _optional_email(legacy_claim_email)
        clean_legacy_marker = str(legacy_claim_marker or "").strip()
        clean_legacy_app_user_id = str(legacy_app_user_id or "").strip()
        clean_legacy_workspace_id = str(legacy_workspace_id or "").strip()
        clean_legacy_workspace_slug = str(legacy_workspace_slug or "").strip()
        now = _utc_stamp()
        conn = self._connect()
        try:
            conn.row_factory = sqlite3.Row
            with conn:
                existing = conn.execute(
                    """
                    SELECT clerk_user_id, app_user_id, workspace_id, workspace_slug, primary_email,
                           legacy_claim_marker, legacy_workspace_migrated_at, created_at, updated_at
                    FROM auth_bindings
                    WHERE clerk_user_id = ?
                    LIMIT 1
                    """,
                    (clean_clerk_user_id,),
                ).fetchone()
                if existing is not None:
                    if clean_email and clean_email != str(existing["primary_email"] or "").strip():
                        conn.execute(
                            """
                            UPDATE auth_bindings
                            SET primary_email = ?, updated_at = ?
                            WHERE clerk_user_id = ?
                            """,
                            (clean_email, now, clean_clerk_user_id),
                        )
                        existing = conn.execute(
                            """
                            SELECT clerk_user_id, app_user_id, workspace_id, workspace_slug, primary_email,
                                   legacy_claim_marker, legacy_workspace_migrated_at, created_at, updated_at
                            FROM auth_bindings
                            WHERE clerk_user_id = ?
                            LIMIT 1
                            """,
                            (clean_clerk_user_id,),
                        ).fetchone()
                    return self._row_to_binding(existing) or {}

                if clean_email and clean_legacy_email and clean_email == clean_legacy_email and clean_legacy_marker:
                    claimed = conn.execute(
                        """
                        SELECT clerk_user_id, app_user_id, workspace_id, workspace_slug, primary_email,
                               legacy_claim_marker, legacy_workspace_migrated_at, created_at, updated_at
                        FROM auth_bindings
                        WHERE legacy_claim_marker = ?
                        LIMIT 1
                        """,
                        (clean_legacy_marker,),
                    ).fetchone()
                    if claimed is None:
                        conn.execute(
                            """
                            INSERT INTO auth_bindings (
                                clerk_user_id, app_user_id, workspace_id, workspace_slug, primary_email,
                                legacy_claim_marker, legacy_workspace_migrated_at, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)
                            """,
                            (
                                clean_clerk_user_id,
                                clean_legacy_app_user_id,
                                clean_legacy_workspace_id,
                                clean_legacy_workspace_slug,
                                clean_email,
                                clean_legacy_marker,
                                now,
                                now,
                            ),
                        )
                        claimed = conn.execute(
                            """
                            SELECT clerk_user_id, app_user_id, workspace_id, workspace_slug, primary_email,
                                   legacy_claim_marker, legacy_workspace_migrated_at, created_at, updated_at
                            FROM auth_bindings
                            WHERE clerk_user_id = ?
                            LIMIT 1
                            """,
                            (clean_clerk_user_id,),
                        ).fetchone()
                    elif str(claimed["clerk_user_id"] or "").strip() != clean_clerk_user_id:
                        raise ValueError("legacy_workspace_already_claimed")
                    return self._row_to_binding(claimed) or {}

                for _ in range(12):
                    app_user_id = f"usr_{uuid.uuid4().hex[:12]}"
                    workspace_id = f"ws_{uuid.uuid4().hex[:12]}"
                    local_part = clean_email.split("@", 1)[0] if clean_email else "workspace"
                    workspace_slug = (_slugify(local_part) or "workspace")[:32]
                    workspace_slug = f"{workspace_slug}-{workspace_id[-6:]}"
                    try:
                        conn.execute(
                            """
                            INSERT INTO auth_bindings (
                                clerk_user_id, app_user_id, workspace_id, workspace_slug, primary_email,
                                legacy_claim_marker, legacy_workspace_migrated_at, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, '', '', ?, ?)
                            """,
                            (
                                clean_clerk_user_id,
                                app_user_id,
                                workspace_id,
                                workspace_slug,
                                clean_email,
                                now,
                                now,
                            ),
                        )
                        created = conn.execute(
                            """
                            SELECT clerk_user_id, app_user_id, workspace_id, workspace_slug, primary_email,
                                   legacy_claim_marker, legacy_workspace_migrated_at, created_at, updated_at
                            FROM auth_bindings
                            WHERE clerk_user_id = ?
                            LIMIT 1
                            """,
                            (clean_clerk_user_id,),
                        ).fetchone()
                        return self._row_to_binding(created) or {}
                    except sqlite3.IntegrityError:
                        continue
        finally:
            conn.close()
        raise RuntimeError("auth_binding_insert_failed")

    def mark_legacy_workspace_migrated(self, workspace_id: str) -> None:
        clean_workspace_id = str(workspace_id or "").strip()
        if not clean_workspace_id:
            return
        conn = self._connect()
        try:
            with conn:
                conn.execute(
                    """
                    UPDATE auth_bindings
                    SET legacy_workspace_migrated_at = ?, updated_at = ?
                    WHERE workspace_id = ? AND legacy_claim_marker <> ''
                    """,
                    (_utc_stamp(), _utc_stamp(), clean_workspace_id),
                )
        finally:
            conn.close()

    def _ensure_schema(self) -> None:
        conn = self._connect()
        try:
            with conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS auth_bindings (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        clerk_user_id TEXT NOT NULL UNIQUE,
                        app_user_id TEXT NOT NULL UNIQUE,
                        workspace_id TEXT NOT NULL UNIQUE,
                        workspace_slug TEXT NOT NULL UNIQUE,
                        primary_email TEXT NOT NULL,
                        legacy_claim_marker TEXT NOT NULL DEFAULT '',
                        legacy_workspace_migrated_at TEXT NOT NULL DEFAULT '',
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_auth_bindings_primary_email ON auth_bindings(primary_email)"
                )
                conn.execute(
                    """
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_bindings_legacy_marker
                    ON auth_bindings(legacy_claim_marker)
                    WHERE legacy_claim_marker <> ''
                    """
                )
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

    def _row_to_binding(self, row: sqlite3.Row | None) -> dict[str, str] | None:
        if row is None:
            return None
        return {
            "clerk_user_id": str(row["clerk_user_id"] or ""),
            "app_user_id": str(row["app_user_id"] or ""),
            "workspace_id": str(row["workspace_id"] or ""),
            "workspace_slug": str(row["workspace_slug"] or ""),
            "primary_email": str(row["primary_email"] or ""),
            "legacy_claim_marker": str(row["legacy_claim_marker"] or ""),
            "legacy_workspace_migrated_at": str(row["legacy_workspace_migrated_at"] or ""),
            "created_at": str(row["created_at"] or ""),
            "updated_at": str(row["updated_at"] or ""),
        }
