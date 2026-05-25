from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path


def _iso_time(epoch_seconds: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch_seconds))


def _cursor_encode(updated_at_ms: int, card_id: str) -> str:
    return f"{updated_at_ms}:{card_id}"


def _cursor_decode(raw: str | None) -> tuple[int, str]:
    clean = str(raw or "").strip()
    if not clean:
        return 0, ""
    parts = clean.split(":", 1)
    if len(parts) != 2:
        return 0, ""
    try:
        return max(0, int(parts[0])), parts[1]
    except Exception:
        return 0, ""


class FeedStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = str(Path(db_path).resolve())
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._conn:
            self._conn.execute("PRAGMA journal_mode=WAL")
        self._ensure_schema()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def upsert_turn_result(
        self,
        *,
        turn_id: str,
        session_id: str,
        reply_mode: str,
        reply_text: str,
        title: str,
        summary: str,
        icon: str,
        telemetry: dict[str, object],
        audio_mime_type: str,
        audio_base64: str,
        html_mime_type: str,
        html_base64: str,
    ) -> dict[str, object]:
        now = time.time()
        now_ms = round(now * 1000)
        now_iso = _iso_time(now)
        card_id = "pucky_card_" + turn_id
        audio_artifact_id = f"{card_id}:audio"
        html_artifact_id = f"{card_id}:html" if html_base64 else ""
        with self._lock:
            existing = self._fetch_card_row(card_id)
            created_at = existing["created_at"] if existing else now_iso
            with self._conn:
                self._conn.execute(
                    """
                    INSERT INTO turns (
                        turn_id, session_id, card_id, reply_mode, reply_text,
                        telemetry_json, created_at, updated_at, updated_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(turn_id) DO UPDATE SET
                        session_id=excluded.session_id,
                        card_id=excluded.card_id,
                        reply_mode=excluded.reply_mode,
                        reply_text=excluded.reply_text,
                        telemetry_json=excluded.telemetry_json,
                        updated_at=excluded.updated_at,
                        updated_at_ms=excluded.updated_at_ms
                    """,
                    (
                        turn_id,
                        session_id,
                        card_id,
                        reply_mode,
                        reply_text,
                        json.dumps(telemetry, separators=(",", ":")),
                        created_at,
                        now_iso,
                        now_ms,
                    ),
                )
                self._upsert_artifact(
                    artifact_id=audio_artifact_id,
                    card_id=card_id,
                    kind="audio",
                    mime_type=audio_mime_type,
                    content_base64=audio_base64,
                    created_at=created_at,
                    updated_at=now_iso,
                    updated_at_ms=now_ms,
                )
                if html_base64:
                    self._upsert_artifact(
                        artifact_id=html_artifact_id,
                        card_id=card_id,
                        kind="html",
                        mime_type=html_mime_type,
                        content_base64=html_base64,
                        created_at=created_at,
                        updated_at=now_iso,
                        updated_at_ms=now_ms,
                    )
                else:
                    self._conn.execute("DELETE FROM artifacts WHERE artifact_id = ?", (html_artifact_id,))
                self._conn.execute(
                    """
                    INSERT INTO feed_cards (
                        card_id, turn_id, session_id, title, summary, icon, reply_mode,
                        created_at, updated_at, updated_at_ms,
                        archived, read, deleted,
                        audio_artifact_id, html_artifact_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
                    ON CONFLICT(card_id) DO UPDATE SET
                        turn_id=excluded.turn_id,
                        session_id=excluded.session_id,
                        title=excluded.title,
                        summary=excluded.summary,
                        icon=excluded.icon,
                        reply_mode=excluded.reply_mode,
                        updated_at=excluded.updated_at,
                        updated_at_ms=excluded.updated_at_ms,
                        deleted=0,
                        audio_artifact_id=excluded.audio_artifact_id,
                        html_artifact_id=excluded.html_artifact_id
                    """,
                    (
                        card_id,
                        turn_id,
                        session_id,
                        title,
                        summary,
                        icon,
                        reply_mode,
                        created_at,
                        now_iso,
                        now_ms,
                        audio_artifact_id,
                        html_artifact_id,
                    ),
                )
            return self._build_item(card_id)

    def list_feed(self, cursor: str | None, limit: int) -> dict[str, object]:
        safe_limit = max(1, min(100, int(limit or 20)))
        updated_after_ms, after_card_id = _cursor_decode(cursor)
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT card_id
                FROM feed_cards
                WHERE (updated_at_ms > ?)
                   OR (updated_at_ms = ? AND card_id > ?)
                ORDER BY updated_at_ms ASC, card_id ASC
                LIMIT ?
                """,
                (updated_after_ms, updated_after_ms, after_card_id, safe_limit + 1),
            ).fetchall()
            has_more = len(rows) > safe_limit
            rows = rows[:safe_limit]
            items = [self._build_item(row["card_id"]) for row in rows]
            next_cursor = ""
            if rows:
                last = self._fetch_card_row(rows[-1]["card_id"])
                next_cursor = _cursor_encode(int(last["updated_at_ms"]), str(last["card_id"]))
            return {
                "schema": "pucky.feed_sync.v1",
                "items": items,
                "next_cursor": next_cursor,
                "has_more": has_more,
            }

    def get_item(self, card_id: str) -> dict[str, object] | None:
        clean_card_id = str(card_id or "").strip()
        if not clean_card_id:
            return None
        with self._lock:
            row = self._fetch_card_row(clean_card_id)
            if row is None:
                return None
            return self._build_item(clean_card_id)

    def count_items(self) -> int:
        with self._lock:
            row = self._conn.execute("SELECT COUNT(*) AS count FROM feed_cards").fetchone()
            return int(row["count"]) if row is not None else 0

    def apply_action(self, *, client_action_id: str, card_id: str, action: str) -> dict[str, object]:
        clean_client_action_id = str(client_action_id or "").strip()
        clean_card_id = str(card_id or "").strip()
        clean_action = str(action or "").strip().lower()
        if not clean_client_action_id:
            raise ValueError("missing_client_action_id")
        if not clean_card_id:
            raise ValueError("missing_card_id")
        if clean_action not in {"archive", "delete", "mark_read"}:
            raise ValueError("unsupported_action")
        now = time.time()
        now_ms = round(now * 1000)
        now_iso = _iso_time(now)
        with self._lock:
            existing = self._conn.execute(
                "SELECT response_json FROM feed_actions WHERE client_action_id = ?",
                (clean_client_action_id,),
            ).fetchone()
            if existing is not None:
                return json.loads(existing["response_json"])
            card = self._fetch_card_row(clean_card_id)
            if card is None:
                raise KeyError("card_not_found")
            archived = int(card["archived"])
            read = int(card["read"])
            deleted = int(card["deleted"])
            if clean_action == "archive":
                archived = 1
            elif clean_action == "mark_read":
                read = 1
            elif clean_action == "delete":
                deleted = 1
            with self._conn:
                self._conn.execute(
                    """
                    UPDATE feed_cards
                    SET archived = ?, read = ?, deleted = ?, updated_at = ?, updated_at_ms = ?
                    WHERE card_id = ?
                    """,
                    (archived, read, deleted, now_iso, now_ms, clean_card_id),
                )
                item = self._build_item(clean_card_id)
                response = {
                    "schema": "pucky.feed_action.v1",
                    "ok": True,
                    "client_action_id": clean_client_action_id,
                    "action": clean_action,
                    "item": item,
                }
                self._conn.execute(
                    """
                    INSERT INTO feed_actions (
                        client_action_id, card_id, action, response_json, created_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        clean_client_action_id,
                        clean_card_id,
                        clean_action,
                        json.dumps(response, separators=(",", ":")),
                        now_iso,
                    ),
                )
            return response

    def _ensure_schema(self) -> None:
        with self._lock:
            with self._conn:
                self._conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS turns (
                        turn_id TEXT PRIMARY KEY,
                        session_id TEXT NOT NULL,
                        card_id TEXT NOT NULL,
                        reply_mode TEXT NOT NULL,
                        reply_text TEXT NOT NULL,
                        telemetry_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        updated_at_ms INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS artifacts (
                        artifact_id TEXT PRIMARY KEY,
                        card_id TEXT NOT NULL,
                        kind TEXT NOT NULL,
                        mime_type TEXT NOT NULL,
                        content_base64 TEXT NOT NULL,
                        byte_count INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        updated_at_ms INTEGER NOT NULL
                    );

                    CREATE TABLE IF NOT EXISTS feed_cards (
                        card_id TEXT PRIMARY KEY,
                        turn_id TEXT NOT NULL,
                        session_id TEXT NOT NULL,
                        title TEXT NOT NULL,
                        summary TEXT NOT NULL,
                        icon TEXT NOT NULL,
                        reply_mode TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        updated_at_ms INTEGER NOT NULL,
                        archived INTEGER NOT NULL DEFAULT 0,
                        read INTEGER NOT NULL DEFAULT 0,
                        deleted INTEGER NOT NULL DEFAULT 0,
                        audio_artifact_id TEXT NOT NULL,
                        html_artifact_id TEXT NOT NULL DEFAULT ''
                    );

                    CREATE TABLE IF NOT EXISTS feed_actions (
                        client_action_id TEXT PRIMARY KEY,
                        card_id TEXT NOT NULL,
                        action TEXT NOT NULL,
                        response_json TEXT NOT NULL,
                        created_at TEXT NOT NULL
                    );

                    CREATE INDEX IF NOT EXISTS idx_feed_cards_updated
                    ON feed_cards (updated_at_ms, card_id);
                    """
                )

    def _upsert_artifact(
        self,
        *,
        artifact_id: str,
        card_id: str,
        kind: str,
        mime_type: str,
        content_base64: str,
        created_at: str,
        updated_at: str,
        updated_at_ms: int,
    ) -> None:
        self._conn.execute(
            """
            INSERT INTO artifacts (
                artifact_id, card_id, kind, mime_type, content_base64,
                byte_count, created_at, updated_at, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(artifact_id) DO UPDATE SET
                mime_type=excluded.mime_type,
                content_base64=excluded.content_base64,
                byte_count=excluded.byte_count,
                updated_at=excluded.updated_at,
                updated_at_ms=excluded.updated_at_ms
            """,
            (
                artifact_id,
                card_id,
                kind,
                mime_type,
                content_base64,
                len(content_base64),
                created_at,
                updated_at,
                updated_at_ms,
            ),
        )

    def _fetch_card_row(self, card_id: str) -> sqlite3.Row | None:
        return self._conn.execute(
            """
            SELECT *
            FROM feed_cards
            WHERE card_id = ?
            """,
            (card_id,),
        ).fetchone()

    def _fetch_artifact(self, artifact_id: str) -> sqlite3.Row | None:
        clean = str(artifact_id or "").strip()
        if not clean:
            return None
        return self._conn.execute(
            """
            SELECT *
            FROM artifacts
            WHERE artifact_id = ?
            """,
            (clean,),
        ).fetchone()

    def _build_item(self, card_id: str) -> dict[str, object]:
        row = self._fetch_card_row(card_id)
        if row is None:
            raise KeyError("card_not_found")
        turn = self._conn.execute(
            """
            SELECT *
            FROM turns
            WHERE turn_id = ?
            """,
            (str(row["turn_id"]),),
        ).fetchone()
        audio = self._fetch_artifact(str(row["audio_artifact_id"]))
        html = self._fetch_artifact(str(row["html_artifact_id"]))
        telemetry = {}
        if turn is not None:
            try:
                telemetry = json.loads(turn["telemetry_json"])
            except Exception:
                telemetry = {}
        item: dict[str, object] = {
            "schema": "pucky.feed_item.v1",
            "card_id": str(row["card_id"]),
            "turn_id": str(row["turn_id"]),
            "session_id": str(row["session_id"]),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
            "reply_mode": str(row["reply_mode"]),
            "title": str(row["title"]),
            "summary": str(row["summary"]),
            "icon": str(row["icon"]),
            "archived": bool(int(row["archived"])),
            "read": bool(int(row["read"])),
            "deleted": bool(int(row["deleted"])),
            "text": str(turn["reply_text"]) if turn is not None else str(row["summary"]),
            "card": {
                "title": str(row["title"]),
                "summary": str(row["summary"]),
                "icon": str(row["icon"]),
                "archived": bool(int(row["archived"])),
                "read": bool(int(row["read"])),
                "deleted": bool(int(row["deleted"])),
            },
            "telemetry": telemetry,
        }
        if audio is not None:
            item["audio_mime_type"] = str(audio["mime_type"])
            item["audio_base64"] = str(audio["content_base64"])
        if html is not None:
            item["html_mime_type"] = str(html["mime_type"])
            item["html_base64"] = str(html["content_base64"])
            card = item["card"]
            if isinstance(card, dict):
                card["html_mime_type"] = str(html["mime_type"])
                card["html_base64"] = str(html["content_base64"])
        return item
