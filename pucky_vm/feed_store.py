from __future__ import annotations

import base64
import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path
from urllib.parse import quote

from .sqlite_utils import (
    configure_sqlite_connection,
    sqlite_retry_busy_timeout_ms,
    sqlite_retry_timeout_seconds,
)


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
        self._conn = sqlite3.connect(
            self.db_path,
            check_same_thread=False,
            timeout=sqlite_retry_timeout_seconds(),
        )
        self._conn.row_factory = sqlite3.Row
        configure_sqlite_connection(
            self._conn,
            wal=True,
            busy_timeout_ms=sqlite_retry_busy_timeout_ms(),
        )
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
        origin: dict[str, object],
        telemetry: dict[str, object],
        transcript_messages: list[dict[str, object]],
        request_audio_mime_type: str,
        request_audio_base64: str,
        audio_mime_type: str,
        audio_base64: str,
        html_mime_type: str,
        html_base64: str,
        force_unread: bool = False,
    ) -> dict[str, object]:
        now = time.time()
        now_ms = round(now * 1000)
        now_iso = _iso_time(now)
        card_id = "pucky_card_" + turn_id
        request_audio_artifact_id = f"{card_id}:request_audio"
        audio_artifact_id = f"{card_id}:audio"
        html_artifact_id = f"{card_id}:html" if html_base64 else ""
        artifact_ids_to_keep = {audio_artifact_id}
        if request_audio_base64:
            artifact_ids_to_keep.add(request_audio_artifact_id)
        if html_artifact_id:
            artifact_ids_to_keep.add(html_artifact_id)
        artifact_ids_to_keep.update(self._transcript_attachment_artifact_ids(transcript_messages))
        origin_json = json.dumps(origin or {}, separators=(",", ":"))
        with self._lock:
            existing = self._fetch_card_row(card_id)
            created_at = existing["created_at"] if existing else now_iso
            with self._conn:
                self._conn.execute(
                    """
                    INSERT INTO turns (
                        turn_id, session_id, card_id, reply_mode, reply_text,
                        telemetry_json, transcript_messages_json, created_at, updated_at, updated_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(turn_id) DO UPDATE SET
                        session_id=excluded.session_id,
                        card_id=excluded.card_id,
                        reply_mode=excluded.reply_mode,
                        reply_text=excluded.reply_text,
                        telemetry_json=excluded.telemetry_json,
                        transcript_messages_json=excluded.transcript_messages_json,
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
                        json.dumps(transcript_messages or [], separators=(",", ":")),
                        created_at,
                        now_iso,
                        now_ms,
                    ),
                )
                if request_audio_base64:
                    self._upsert_artifact(
                        artifact_id=request_audio_artifact_id,
                        card_id=card_id,
                        kind="audio",
                        mime_type=request_audio_mime_type or "audio/wav",
                        content_base64=request_audio_base64,
                        created_at=created_at,
                        updated_at=now_iso,
                        updated_at_ms=now_ms,
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
                self._store_transcript_attachment_artifacts(
                    transcript_messages=transcript_messages,
                    html_artifact_id=html_artifact_id,
                    html_mime_type=html_mime_type,
                    html_base64=html_base64,
                    card_id=card_id,
                    created_at=created_at,
                    updated_at=now_iso,
                    updated_at_ms=now_ms,
                )
                self._prune_card_artifacts(card_id, artifact_ids_to_keep)
                self._conn.execute(
                    """
                    INSERT INTO feed_cards (
                        card_id, turn_id, session_id, title, summary, icon, reply_mode,
                        created_at, updated_at, updated_at_ms,
                        archived, read, deleted,
                        audio_artifact_id, html_artifact_id, origin_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
                    ON CONFLICT(card_id) DO UPDATE SET
                        turn_id=excluded.turn_id,
                        session_id=excluded.session_id,
                        title=excluded.title,
                        summary=excluded.summary,
                        icon=excluded.icon,
                        reply_mode=excluded.reply_mode,
                        updated_at=excluded.updated_at,
                        updated_at_ms=excluded.updated_at_ms,
                        read=CASE WHEN ? THEN 0 ELSE read END,
                        deleted=0,
                        audio_artifact_id=excluded.audio_artifact_id,
                        html_artifact_id=excluded.html_artifact_id,
                        origin_json=excluded.origin_json
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
                        origin_json,
                        1 if force_unread else 0,
                    ),
                )
            return self._build_item(card_id)

    def list_feed(
        self,
        cursor: str | None,
        limit: int,
        *,
        include_archived: bool = True,
        compact: bool = False,
        base_url: str = "",
    ) -> dict[str, object]:
        safe_limit = max(1, min(100, int(limit or 20)))
        cursor_ms, after_group_key = _cursor_decode(cursor)
        has_cursor = bool(str(cursor or "").strip())
        with self._lock:
            archived_clause = "" if include_archived else "AND archived = 0"
            rows = self._conn.execute(
                f"""
                SELECT *
                FROM feed_cards
                WHERE deleted = 0
                  {archived_clause}
                ORDER BY updated_at_ms DESC, card_id ASC
                """,
                (),
            ).fetchall()
            groups: list[tuple[str, sqlite3.Row]] = []
            seen_group_keys: set[str] = set()
            for row in rows:
                group_key = self._group_key_for_card_id(str(row["card_id"]))
                if group_key in seen_group_keys:
                    continue
                seen_group_keys.add(group_key)
                latest_ms = int(row["updated_at_ms"])
                if has_cursor and not (
                    latest_ms < cursor_ms
                    or (latest_ms == cursor_ms and group_key > after_group_key)
                ):
                    continue
                groups.append((group_key, row))
            has_more = len(groups) > safe_limit
            page_groups = groups[:safe_limit]
            items = [
                self._build_group_item(group_key, include_archived=include_archived, compact=compact, base_url=base_url)
                for group_key, _row in page_groups
            ]
            next_cursor = ""
            if page_groups:
                last_group_key, last = page_groups[-1]
                next_cursor = _cursor_encode(int(last["updated_at_ms"]), last_group_key)
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

    def get_thread_item(self, thread_id: str, *, compact: bool = False) -> dict[str, object] | None:
        clean_thread_id = str(thread_id or "").strip()
        if not clean_thread_id:
            return None
        group_key = f"thread:{clean_thread_id}"
        with self._lock:
            rows = self._card_rows_for_group(group_key)
            if not rows:
                return None
            return self._build_group_item(group_key, compact=compact)

    def get_artifact(self, artifact_id: str) -> dict[str, object] | None:
        clean = str(artifact_id or "").strip()
        if not clean:
            return None
        with self._lock:
            row = self._fetch_artifact(clean)
            if row is None:
                return None
            return {
                "artifact_id": str(row["artifact_id"]),
                "card_id": str(row["card_id"]),
                "kind": str(row["kind"]),
                "mime_type": str(row["mime_type"]),
                "content_base64": str(row["content_base64"]),
                "created_at": str(row["created_at"]),
                "updated_at": str(row["updated_at"]),
            }

    def list_media_artifacts(self, limit: int = 50) -> list[dict[str, object]]:
        safe_limit = max(1, min(100, int(limit or 50)))
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT
                    artifacts.artifact_id,
                    artifacts.card_id,
                    artifacts.kind,
                    artifacts.mime_type,
                    artifacts.content_base64,
                    artifacts.updated_at,
                    feed_cards.title
                FROM artifacts
                JOIN feed_cards ON feed_cards.card_id = artifacts.card_id
                WHERE feed_cards.archived = 0
                  AND feed_cards.deleted = 0
                  AND artifacts.kind IN ('audio', 'html', 'image', 'video', 'text')
                ORDER BY artifacts.updated_at_ms DESC, artifacts.artifact_id ASC
                LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()
            return [
                {
                    "artifact_id": str(row["artifact_id"]),
                    "card_id": str(row["card_id"]),
                    "kind": str(row["kind"]),
                    "mime_type": str(row["mime_type"]),
                    "content_base64": str(row["content_base64"]),
                    "updated_at": str(row["updated_at"]),
                    "title": str(row["title"]),
                }
                for row in rows
            ]

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
        if clean_action not in {"archive", "unarchive", "delete", "mark_read"}:
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
            elif clean_action == "unarchive":
                archived = 0
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
                        transcript_messages_json TEXT NOT NULL DEFAULT '[]',
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
                        html_artifact_id TEXT NOT NULL DEFAULT '',
                        origin_json TEXT NOT NULL DEFAULT ''
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
                self._ensure_column("feed_cards", "origin_json", "TEXT NOT NULL DEFAULT ''")
                self._ensure_column("turns", "transcript_messages_json", "TEXT NOT NULL DEFAULT '[]'")

    def _ensure_column(self, table: str, column: str, definition: str) -> None:
        existing = {
            str(row["name"])
            for row in self._conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in existing:
            self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

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

    def _store_transcript_attachment_artifacts(
        self,
        *,
        transcript_messages: list[dict[str, object]],
        html_artifact_id: str,
        html_mime_type: str,
        html_base64: str,
        card_id: str,
        created_at: str,
        updated_at: str,
        updated_at_ms: int,
    ) -> None:
        for message in transcript_messages or []:
            if not isinstance(message, dict):
                continue
            for attachment in message.get("attachments") or []:
                if not isinstance(attachment, dict):
                    continue
                for artifact_field, path_field, fallback_mime in (
                    ("artifact", "path", str(attachment.get("mime_type") or "application/octet-stream")),
                    ("viewer_artifact", "viewer_path", "text/html"),
                    ("html_artifact", "html_viewer_path", "text/html"),
                    ("document_html_artifact", "document_html_path", "text/html"),
                    ("preview_artifact", "preview_path", "image/png"),
                ):
                    artifact_id = str(attachment.get(artifact_field) or "").strip()
                    if not artifact_id:
                        continue
                    if artifact_id == html_artifact_id and html_base64:
                        self._upsert_artifact(
                            artifact_id=artifact_id,
                            card_id=card_id,
                            kind="html",
                            mime_type=html_mime_type or "text/html",
                            content_base64=html_base64,
                            created_at=created_at,
                            updated_at=updated_at,
                            updated_at_ms=updated_at_ms,
                        )
                        continue
                    source_path = str(attachment.get(path_field) or "").strip()
                    if not source_path:
                        continue
                    path = Path(source_path)
                    if not path.exists() or not path.is_file():
                        continue
                    raw = path.read_bytes()
                    self._upsert_artifact(
                        artifact_id=artifact_id,
                        card_id=card_id,
                        kind=str(attachment.get("kind") or "attachment"),
                        mime_type=fallback_mime,
                        content_base64=base64.b64encode(raw).decode("ascii"),
                        created_at=created_at,
                        updated_at=updated_at,
                        updated_at_ms=updated_at_ms,
        )

    def _transcript_attachment_artifact_ids(self, transcript_messages: list[dict[str, object]]) -> set[str]:
        artifact_ids: set[str] = set()
        for message in transcript_messages or []:
            if not isinstance(message, dict):
                continue
            for attachment in message.get("attachments") or []:
                if not isinstance(attachment, dict):
                    continue
                for artifact_field in (
                    "artifact",
                    "viewer_artifact",
                    "html_artifact",
                    "document_html_artifact",
                    "preview_artifact",
                ):
                    artifact_id = str(attachment.get(artifact_field) or "").strip()
                    if artifact_id:
                        artifact_ids.add(artifact_id)
        return artifact_ids

    def _prune_card_artifacts(self, card_id: str, artifact_ids_to_keep: set[str]) -> None:
        if not artifact_ids_to_keep:
            self._conn.execute("DELETE FROM artifacts WHERE card_id = ?", (card_id,))
            return
        placeholders = ",".join("?" for _ in artifact_ids_to_keep)
        self._conn.execute(
            f"DELETE FROM artifacts WHERE card_id = ? AND artifact_id NOT IN ({placeholders})",
            (card_id, *sorted(artifact_ids_to_keep)),
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

    def _thread_group_key(self, origin: dict[str, object], card_id: str) -> str:
        thread_id = str((origin or {}).get("thread_id") or "").strip()
        return f"thread:{thread_id}" if thread_id else f"card:{card_id}"

    def _group_key_for_card_id(self, card_id: str) -> str:
        row = self._fetch_card_row(card_id)
        if row is None:
            return f"card:{card_id}"
        try:
            origin = json.loads(str(row["origin_json"] or "") or "{}")
        except Exception:
            origin = {}
        if not isinstance(origin, dict):
            origin = {}
        return self._thread_group_key(origin, str(row["card_id"]))

    def _card_rows_for_group(self, group_key: str) -> list[sqlite3.Row]:
        if group_key.startswith("thread:"):
            thread_id = group_key.split(":", 1)[1]
            rows = self._conn.execute(
                """
                SELECT *
                FROM feed_cards
                ORDER BY updated_at_ms ASC, card_id ASC
                """
            ).fetchall()
            matches: list[sqlite3.Row] = []
            for row in rows:
                try:
                    origin = json.loads(str(row["origin_json"] or "") or "{}")
                except Exception:
                    origin = {}
                if not isinstance(origin, dict):
                    origin = {}
                if str(origin.get("thread_id") or "").strip() == thread_id:
                    matches.append(row)
            return matches
        row = self._fetch_card_row(group_key.split(":", 1)[1])
        return [row] if row is not None else []

    def _build_group_item(
        self,
        group_key: str,
        *,
        include_archived: bool = True,
        compact: bool = False,
        base_url: str = "",
    ) -> dict[str, object]:
        rows = self._card_rows_for_group(group_key)
        if not include_archived:
            rows = [row for row in rows if not bool(int(row["archived"]))]
        rows = [row for row in rows if not bool(int(row["deleted"]))]
        if not rows:
            raise KeyError("card_not_found")
        rows.sort(key=lambda row: (int(row["updated_at_ms"]), str(row["card_id"])))
        latest = rows[-1]
        latest_item = self._build_item(str(latest["card_id"]), compact=compact, base_url=base_url)
        if not compact:
            transcript_messages: list[object] = []
            for row in rows:
                turn = self._conn.execute(
                    """
                    SELECT transcript_messages_json
                    FROM turns
                    WHERE turn_id = ?
                    """,
                    (str(row["turn_id"]),),
                ).fetchone()
                if turn is None:
                    continue
                try:
                    messages = json.loads(str(turn["transcript_messages_json"] or "[]") or "[]")
                except Exception:
                    messages = []
                if isinstance(messages, list):
                    transcript_messages.extend(messages)
            latest_item["transcript_messages"] = transcript_messages
        latest_item["thread_history_count"] = len(rows)
        card = latest_item.get("card")
        if isinstance(card, dict):
            card["thread_history_count"] = len(rows)
        return latest_item

    def _build_item(self, card_id: str, *, compact: bool = False, base_url: str = "") -> dict[str, object]:
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
        origin: dict[str, object] = {}
        if turn is not None:
            try:
                telemetry = json.loads(turn["telemetry_json"])
            except Exception:
                telemetry = {}
            try:
                transcript_messages = json.loads(str(turn["transcript_messages_json"] or "[]") or "[]")
            except Exception:
                transcript_messages = []
        else:
            transcript_messages = []
        try:
            origin = json.loads(str(row["origin_json"] or "") or "{}")
        except Exception:
            origin = {}
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
            "origin": origin,
            "archived": bool(int(row["archived"])),
            "read": bool(int(row["read"])),
            "deleted": bool(int(row["deleted"])),
            "text": str(turn["reply_text"]) if turn is not None else str(row["summary"]),
            "transcript_messages": transcript_messages if isinstance(transcript_messages, list) else [],
            "card": {
                "title": str(row["title"]),
                "summary": str(row["summary"]),
                "icon": str(row["icon"]),
                "origin": origin,
                "archived": bool(int(row["archived"])),
                "read": bool(int(row["read"])),
                "deleted": bool(int(row["deleted"])),
            },
            "telemetry": telemetry,
        }
        if audio is not None:
            audio_mime_type = str(audio["mime_type"])
            audio_base64 = str(audio["content_base64"])
            if compact:
                audio_meta = self._compact_artifact_metadata(audio, base_url=base_url, media_prefix="audio")
                if audio_meta:
                    item.update(audio_meta)
            else:
                item["audio_mime_type"] = audio_mime_type
                item["audio_base64"] = audio_base64
        if compact and html is not None:
            html_meta = self._compact_artifact_metadata(html, base_url=base_url, media_prefix="html")
            if html_meta:
                item.update(html_meta)
        if not compact and html is not None:
            item["html_mime_type"] = str(html["mime_type"])
            item["html_base64"] = str(html["content_base64"])
            card = item["card"]
            if isinstance(card, dict):
                card["html_mime_type"] = str(html["mime_type"])
                card["html_base64"] = str(html["content_base64"])
        return item

    def _compact_artifact_metadata(
        self,
        artifact: sqlite3.Row,
        *,
        base_url: str = "",
        media_prefix: str,
    ) -> dict[str, object]:
        artifact_base64 = str(artifact["content_base64"] or "")
        if not artifact_base64:
            return {}
        try:
            body = base64.b64decode(artifact_base64, validate=True)
        except Exception:
            return {}
        if not body:
            return {}
        artifact_id = str(artifact["artifact_id"])
        if not media_prefix:
            return {}
        root = str(base_url or "").rstrip("/")
        path = f"/api/artifacts/{quote(artifact_id, safe='')}"
        artifact_url = f"{root}{path}" if root else path
        url_field = f"{media_prefix}_url"
        artifact_field = f"{media_prefix}_artifact"
        mime_field = f"{media_prefix}_mime_type"
        bytes_field = f"{media_prefix}_bytes"
        sha_field = f"{media_prefix}_sha256"
        media_id_field = f"{media_prefix}_media_id"
        result = {
            url_field: artifact_url,
            artifact_field: artifact_id,
            mime_field: str(artifact["mime_type"] or "application/octet-stream"),
            bytes_field: len(body),
            sha_field: hashlib.sha256(body).hexdigest(),
        }
        if media_prefix == "audio":
            result[media_id_field] = f"feed:{artifact_id}"
        return result
