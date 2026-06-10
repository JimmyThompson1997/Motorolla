from __future__ import annotations

import base64
import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from .sqlite_utils import (
    configure_sqlite_connection,
    sqlite_retry_busy_timeout_ms,
    sqlite_retry_timeout_seconds,
)


WORKSPACE_COLLECTIONS: dict[str, str] = {
    "notes": "note",
    "tasks": "task",
    "calendar-events": "calendar_event",
    "feed-items": "feed_item",
    "projects": "project",
    "contacts": "contact",
}

KIND_COLLECTIONS = {value: key for key, value in WORKSPACE_COLLECTIONS.items()}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _json_loads(value: str | None, fallback: Any) -> Any:
    try:
        parsed = json.loads(value or "")
    except Exception:
        return fallback
    return parsed if parsed is not None else fallback


def _clean_id(value: object, fallback_prefix: str) -> str:
    raw = str(value or "").strip()
    if raw:
        return "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in raw)[:96]
    return f"{fallback_prefix}-{uuid.uuid4().hex[:12]}"


def _int_or_zero(value: object) -> int:
    try:
        return int(value or 0)
    except Exception:
        return 0


def derive_task_group(record: dict[str, Any], now_ms: int | None = None) -> str:
    status = str(record.get("status") or "").strip().lower()
    if status == "done":
        return "done"
    due_at_ms = _int_or_zero(record.get("due_at_ms"))
    current = _now_ms() if now_ms is None else int(now_ms)
    if due_at_ms and due_at_ms < current:
        return "overdue"
    if not due_at_ms:
        return "do"
    if due_at_ms <= current + 24 * 60 * 60 * 1000:
        return "do"
    return "soon"


class WorkspaceStore:
    def __init__(self, db_path: str, *, clock_ms: Callable[[], int] | None = None) -> None:
        self.db_path = str(Path(db_path).resolve())
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._clock_ms = clock_ms or _now_ms
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
        self.seed_defaults()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def list_records(
        self,
        collection: str,
        *,
        include_archived: bool = False,
        include_deleted: bool = False,
        date: str = "",
        limit: int = 200,
    ) -> dict[str, object]:
        kind = self.kind_for_collection(collection)
        query = [
            "SELECT * FROM workspace_records WHERE kind = ?",
            "" if include_deleted else "AND deleted = 0",
            "" if include_archived else "AND archived = 0",
        ]
        params: list[object] = [kind]
        if kind == "calendar_event" and date:
            query.append("AND date_key = ?")
            params.append(date)
        order = "ORDER BY pinned DESC, updated_at_ms DESC, record_id ASC"
        if kind == "task":
            order = "ORDER BY due_at_ms = 0, due_at_ms ASC, updated_at_ms DESC"
        elif kind == "calendar_event":
            order = "ORDER BY start_at_ms ASC, title ASC"
        elif kind == "feed_item":
            order = "ORDER BY event_at_ms DESC, updated_at_ms DESC"
        elif kind == "project":
            order = "ORDER BY updated_at_ms DESC, title ASC"
        elif kind == "contact":
            order = "ORDER BY title COLLATE NOCASE ASC"
        query.append(order)
        query.append("LIMIT ?")
        params.append(max(1, min(500, int(limit or 200))))
        with self._lock:
            rows = self._conn.execute(" ".join(part for part in query if part), params).fetchall()
        items = [self._row_to_record(row) for row in rows]
        return {
            "schema": "pucky.workspace.list.v1",
            "collection": collection,
            "kind": kind,
            "count": len(items),
            "items": items,
            "now_ms": self.now_ms(),
        }

    def get_record(self, collection: str, record_id: str, *, include_deleted: bool = False) -> dict[str, object] | None:
        kind = self.kind_for_collection(collection)
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM workspace_records WHERE kind = ? AND record_id = ?",
                (kind, record_id),
            ).fetchone()
        if row is None:
            return None
        record = self._row_to_record(row)
        if record.get("deleted") and not include_deleted:
            return None
        return record

    def upsert_record(self, collection: str, payload: dict[str, object]) -> dict[str, object]:
        kind = self.kind_for_collection(collection)
        now = self.now_ms()
        record_id = _clean_id(payload.get("id") or payload.get("record_id"), kind)
        normalized = self._normalize_record(kind, record_id, payload, now_ms=now)
        with self._lock:
            existing = self._conn.execute(
                "SELECT created_at_ms FROM workspace_records WHERE kind = ? AND record_id = ?",
                (kind, record_id),
            ).fetchone()
            created_at_ms = int(existing["created_at_ms"]) if existing else now
            self._write_record(kind, record_id, normalized, created_at_ms=created_at_ms, updated_at_ms=now)
        return self.get_record(collection, record_id, include_deleted=True) or {}

    def patch_record(self, collection: str, record_id: str, payload: dict[str, object]) -> dict[str, object] | None:
        current = self.get_record(collection, record_id, include_deleted=True)
        if current is None:
            return None
        merged = dict(current)
        metadata = dict(current.get("metadata") or {})
        for key, value in payload.items():
            if key == "metadata" and isinstance(value, dict):
                metadata.update(value)
            else:
                merged[key] = value
        merged["metadata"] = metadata
        return self.upsert_record(collection, merged)

    def delete_record(self, collection: str, record_id: str) -> dict[str, object] | None:
        existing = self.get_record(collection, record_id, include_deleted=True)
        if existing is None:
            return None
        return self.patch_record(collection, record_id, {"deleted": True, "archived": True})

    def create_asset(self, payload: dict[str, object]) -> dict[str, object]:
        now = self.now_ms()
        asset_id = _clean_id(payload.get("id") or payload.get("asset_id"), "asset")
        title = str(payload.get("title") or asset_id).strip()
        mime_type = str(payload.get("mime_type") or "text/html; charset=utf-8").strip()
        text = str(payload.get("text") or payload.get("html") or "")
        raw_base64 = str(payload.get("base64") or "").strip()
        if raw_base64:
            try:
                size_bytes = len(base64.b64decode(raw_base64, validate=False))
            except Exception:
                size_bytes = 0
        else:
            raw_base64 = base64.b64encode(text.encode("utf-8")).decode("ascii")
            size_bytes = len(text.encode("utf-8"))
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO workspace_assets (
                  asset_id, title, mime_type, content_base64, size_bytes, metadata_json, created_at_ms, updated_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  title = excluded.title,
                  mime_type = excluded.mime_type,
                  content_base64 = excluded.content_base64,
                  size_bytes = excluded.size_bytes,
                  metadata_json = excluded.metadata_json,
                  updated_at_ms = excluded.updated_at_ms
                """,
                (asset_id, title, mime_type, raw_base64, size_bytes, _json_dumps(metadata), now, now),
            )
            self._conn.commit()
        return self.get_asset(asset_id) or {}

    def get_asset(self, asset_id: str) -> dict[str, object] | None:
        clean = str(asset_id or "").strip()
        if not clean:
            return None
        with self._lock:
            row = self._conn.execute("SELECT * FROM workspace_assets WHERE asset_id = ?", (clean,)).fetchone()
        if row is None:
            return None
        content_base64 = str(row["content_base64"] or "")
        text = ""
        if str(row["mime_type"] or "").lower().startswith("text/") or "html" in str(row["mime_type"] or "").lower():
            try:
                text = base64.b64decode(content_base64).decode("utf-8", errors="replace")
            except Exception:
                text = ""
        return {
            "schema": "pucky.workspace.asset.v1",
            "asset_id": row["asset_id"],
            "title": row["title"],
            "mime_type": row["mime_type"],
            "content_base64": content_base64,
            "text": text,
            "size_bytes": int(row["size_bytes"] or 0),
            "metadata": _json_loads(row["metadata_json"], {}),
            "created_at_ms": int(row["created_at_ms"] or 0),
            "updated_at_ms": int(row["updated_at_ms"] or 0),
        }

    def upsert_link(self, payload: dict[str, object]) -> dict[str, object]:
        now = self.now_ms()
        link_id = _clean_id(payload.get("id") or payload.get("link_id"), "link")
        source_kind = str(payload.get("source_kind") or "").strip()
        source_id = str(payload.get("source_id") or "").strip()
        target_kind = str(payload.get("target_kind") or "").strip()
        target_id = str(payload.get("target_id") or "").strip()
        label = str(payload.get("label") or "").strip()
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO workspace_links (
                  link_id, source_kind, source_id, target_kind, target_id, label, metadata_json, created_at_ms, updated_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(link_id) DO UPDATE SET
                  source_kind = excluded.source_kind,
                  source_id = excluded.source_id,
                  target_kind = excluded.target_kind,
                  target_id = excluded.target_id,
                  label = excluded.label,
                  metadata_json = excluded.metadata_json,
                  updated_at_ms = excluded.updated_at_ms
                """,
                (link_id, source_kind, source_id, target_kind, target_id, label, _json_dumps(metadata), now, now),
            )
            self._conn.commit()
        return self._link_payload(link_id) or {}

    def delete_link(self, link_id: str) -> bool:
        with self._lock:
            cursor = self._conn.execute("DELETE FROM workspace_links WHERE link_id = ?", (str(link_id or "").strip(),))
            self._conn.commit()
            return cursor.rowcount > 0

    def linked_records(self, kind: str, record_id: str) -> list[dict[str, object]]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT * FROM workspace_links
                WHERE (source_kind = ? AND source_id = ?) OR (target_kind = ? AND target_id = ?)
                ORDER BY updated_at_ms DESC, link_id ASC
                """,
                (kind, record_id, kind, record_id),
            ).fetchall()
        return [self._row_to_link(row) for row in rows]

    def count_items(self) -> int:
        with self._lock:
            row = self._conn.execute("SELECT COUNT(*) AS count FROM workspace_records WHERE deleted = 0").fetchone()
        return int(row["count"] or 0) if row else 0

    def now_ms(self) -> int:
        return int(self._clock_ms())

    def seed_defaults(self) -> None:
        with self._lock:
            seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'seeded_v1'").fetchone()
        if seeded:
            return
        now = self.now_ms()
        defaults = default_workspace_records(now)
        for collection, records in defaults.items():
            for record in records:
                self.upsert_record(collection, record)
        for asset in default_workspace_assets(now):
            self.create_asset(asset)
        for link in default_workspace_links():
            self.upsert_link(link)
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("seeded_v1", "1", now),
            )
            self._conn.commit()

    @staticmethod
    def kind_for_collection(collection: str) -> str:
        kind = WORKSPACE_COLLECTIONS.get(str(collection or "").strip())
        if not kind:
            raise ValueError("unknown_workspace_collection")
        return kind

    def _normalize_record(self, kind: str, record_id: str, payload: dict[str, object], *, now_ms: int) -> dict[str, object]:
        metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
        title = str(payload.get("title") or payload.get("display_name") or metadata.get("display_name") or record_id).strip()
        summary = str(payload.get("summary") or payload.get("detail") or metadata.get("summary") or "").strip()
        status = str(payload.get("status") or metadata.get("status") or "").strip()
        date_key = str(payload.get("date") or payload.get("date_key") or metadata.get("date") or "").strip()
        event_at_ms = _int_or_zero(payload.get("event_at_ms") or payload.get("updated_at_ms") or now_ms)
        start_at_ms = _int_or_zero(payload.get("start_at_ms") or metadata.get("start_at_ms"))
        end_at_ms = _int_or_zero(payload.get("end_at_ms") or metadata.get("end_at_ms"))
        due_at_ms = _int_or_zero(payload.get("due_at_ms") or metadata.get("due_at_ms"))
        html = str(payload.get("html") or metadata.get("html") or "").strip()
        html_asset_id = str(payload.get("html_asset_id") or metadata.get("html_asset_id") or "").strip()
        archived = bool(payload.get("archived", False))
        deleted = bool(payload.get("deleted", False))
        pinned = bool(payload.get("pinned", False))
        if kind == "task":
            status = status or "open"
        if kind == "calendar_event" and not date_key and start_at_ms:
            date_key = time.strftime("%Y-%m-%d", time.localtime(start_at_ms / 1000))
        if kind == "feed_item":
            event_at_ms = _int_or_zero(payload.get("event_at_ms") or now_ms)
        return {
            "record_id": record_id,
            "kind": kind,
            "title": title,
            "summary": summary,
            "status": status,
            "pinned": pinned,
            "date_key": date_key,
            "start_at_ms": start_at_ms,
            "end_at_ms": end_at_ms,
            "due_at_ms": due_at_ms,
            "event_at_ms": event_at_ms,
            "html": html,
            "html_asset_id": html_asset_id,
            "archived": archived,
            "deleted": deleted,
            "metadata": metadata,
        }

    def _write_record(
        self,
        kind: str,
        record_id: str,
        record: dict[str, object],
        *,
        created_at_ms: int,
        updated_at_ms: int,
    ) -> None:
        self._conn.execute(
            """
            INSERT INTO workspace_records (
              record_id, kind, title, summary, status, pinned, date_key, start_at_ms, end_at_ms,
              due_at_ms, event_at_ms, html, html_asset_id, metadata_json, archived, deleted,
              created_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(kind, record_id) DO UPDATE SET
              title = excluded.title,
              summary = excluded.summary,
              status = excluded.status,
              pinned = excluded.pinned,
              date_key = excluded.date_key,
              start_at_ms = excluded.start_at_ms,
              end_at_ms = excluded.end_at_ms,
              due_at_ms = excluded.due_at_ms,
              event_at_ms = excluded.event_at_ms,
              html = excluded.html,
              html_asset_id = excluded.html_asset_id,
              metadata_json = excluded.metadata_json,
              archived = excluded.archived,
              deleted = excluded.deleted,
              updated_at_ms = excluded.updated_at_ms
            """,
            (
                record_id,
                kind,
                record["title"],
                record["summary"],
                record["status"],
                1 if record["pinned"] else 0,
                record["date_key"],
                record["start_at_ms"],
                record["end_at_ms"],
                record["due_at_ms"],
                record["event_at_ms"],
                record["html"],
                record["html_asset_id"],
                _json_dumps(record["metadata"]),
                1 if record["archived"] else 0,
                1 if record["deleted"] else 0,
                created_at_ms,
                updated_at_ms,
            ),
        )
        self._conn.commit()

    def _row_to_record(self, row: sqlite3.Row) -> dict[str, object]:
        metadata = _json_loads(row["metadata_json"], {})
        record = {
            "schema": "pucky.workspace.record.v1",
            "id": row["record_id"],
            "record_id": row["record_id"],
            "kind": row["kind"],
            "collection": KIND_COLLECTIONS.get(row["kind"], row["kind"]),
            "title": row["title"],
            "summary": row["summary"],
            "status": row["status"],
            "pinned": bool(row["pinned"]),
            "date": row["date_key"],
            "date_key": row["date_key"],
            "start_at_ms": int(row["start_at_ms"] or 0),
            "end_at_ms": int(row["end_at_ms"] or 0),
            "due_at_ms": int(row["due_at_ms"] or 0),
            "event_at_ms": int(row["event_at_ms"] or 0),
            "html": row["html"] or "",
            "html_asset_id": row["html_asset_id"] or "",
            "metadata": metadata,
            "archived": bool(row["archived"]),
            "deleted": bool(row["deleted"]),
            "created_at_ms": int(row["created_at_ms"] or 0),
            "updated_at_ms": int(row["updated_at_ms"] or 0),
        }
        if row["kind"] == "task":
            record["derived_group"] = derive_task_group(record, self.now_ms())
        record["links"] = self.linked_records(str(row["kind"]), str(row["record_id"]))
        return record

    def _link_payload(self, link_id: str) -> dict[str, object] | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM workspace_links WHERE link_id = ?", (link_id,)).fetchone()
        return self._row_to_link(row) if row else None

    def _row_to_link(self, row: sqlite3.Row) -> dict[str, object]:
        return {
            "schema": "pucky.workspace.link.v1",
            "id": row["link_id"],
            "link_id": row["link_id"],
            "source_kind": row["source_kind"],
            "source_id": row["source_id"],
            "target_kind": row["target_kind"],
            "target_id": row["target_id"],
            "label": row["label"],
            "metadata": _json_loads(row["metadata_json"], {}),
            "created_at_ms": int(row["created_at_ms"] or 0),
            "updated_at_ms": int(row["updated_at_ms"] or 0),
        }

    def _ensure_schema(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS workspace_meta (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated_at_ms INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workspace_records (
                  record_id TEXT NOT NULL,
                  kind TEXT NOT NULL,
                  title TEXT NOT NULL,
                  summary TEXT NOT NULL DEFAULT '',
                  status TEXT NOT NULL DEFAULT '',
                  pinned INTEGER NOT NULL DEFAULT 0,
                  date_key TEXT NOT NULL DEFAULT '',
                  start_at_ms INTEGER NOT NULL DEFAULT 0,
                  end_at_ms INTEGER NOT NULL DEFAULT 0,
                  due_at_ms INTEGER NOT NULL DEFAULT 0,
                  event_at_ms INTEGER NOT NULL DEFAULT 0,
                  html TEXT NOT NULL DEFAULT '',
                  html_asset_id TEXT NOT NULL DEFAULT '',
                  metadata_json TEXT NOT NULL DEFAULT '{}',
                  archived INTEGER NOT NULL DEFAULT 0,
                  deleted INTEGER NOT NULL DEFAULT 0,
                  created_at_ms INTEGER NOT NULL,
                  updated_at_ms INTEGER NOT NULL,
                  PRIMARY KEY (kind, record_id)
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_records_kind_updated
                ON workspace_records (kind, archived, deleted, updated_at_ms);
                CREATE INDEX IF NOT EXISTS idx_workspace_records_calendar
                ON workspace_records (kind, date_key, start_at_ms);
                CREATE TABLE IF NOT EXISTS workspace_assets (
                  asset_id TEXT PRIMARY KEY,
                  title TEXT NOT NULL,
                  mime_type TEXT NOT NULL,
                  content_base64 TEXT NOT NULL,
                  size_bytes INTEGER NOT NULL DEFAULT 0,
                  metadata_json TEXT NOT NULL DEFAULT '{}',
                  created_at_ms INTEGER NOT NULL,
                  updated_at_ms INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workspace_links (
                  link_id TEXT PRIMARY KEY,
                  source_kind TEXT NOT NULL,
                  source_id TEXT NOT NULL,
                  target_kind TEXT NOT NULL,
                  target_id TEXT NOT NULL,
                  label TEXT NOT NULL DEFAULT '',
                  metadata_json TEXT NOT NULL DEFAULT '{}',
                  created_at_ms INTEGER NOT NULL,
                  updated_at_ms INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workspace_links_source
                ON workspace_links (source_kind, source_id);
                CREATE INDEX IF NOT EXISTS idx_workspace_links_target
                ON workspace_links (target_kind, target_id);
                """
            )
            self._conn.commit()


def default_workspace_assets(now_ms: int) -> list[dict[str, object]]:
    return [
        {
            "id": "asset-note-q4",
            "title": "Q4 hiring plan",
            "mime_type": "text/html; charset=utf-8",
            "html": "<!doctype html><h1>Q4 hiring plan</h1><p>Strengthen backend reliability and team leadership.</p><ul><li>Hire 2 senior backend engineers</li><li>Improve system reliability</li><li>Start interviews in November</li></ul>",
            "metadata": {"seeded_at_ms": now_ms},
        },
        {
            "id": "asset-project-aurora",
            "title": "Project Aurora summary",
            "mime_type": "text/html; charset=utf-8",
            "html": "<!doctype html><h1>Project Aurora</h1><p>Spec review, PRD discussion, requirements artifacts, and linked launch work.</p>",
            "metadata": {"seeded_at_ms": now_ms},
        },
        {
            "id": "asset-contact-maya",
            "title": "Maya Chen profile",
            "mime_type": "text/html; charset=utf-8",
            "html": "<!doctype html><h1>Maya Chen</h1><p>Design lead. Budget approved; next check-in Friday.</p>",
            "metadata": {"seeded_at_ms": now_ms},
        },
    ]


def default_workspace_records(now_ms: int) -> dict[str, list[dict[str, object]]]:
    day = time.strftime("%Y-%m-%d", time.localtime(now_ms / 1000))
    tomorrow_ms = now_ms + 24 * 60 * 60 * 1000
    tomorrow = time.strftime("%Y-%m-%d", time.localtime(tomorrow_ms / 1000))
    return {
        "notes": [
            {
                "id": "q4",
                "title": "Q4 hiring plan",
                "summary": "Engineering hiring priorities and next steps.",
                "pinned": True,
                "html_asset_id": "asset-note-q4",
                "metadata": {"context": "All notes", "icon": "pin"},
            },
            {
                "id": "march",
                "title": "March eval notes",
                "summary": "Prior vendor evaluation and support risks.",
                "metadata": {"context": "Vendor review", "icon": "attachment"},
            },
            {
                "id": "onboarding",
                "title": "Onboarding spec v3",
                "summary": "First-run checklist and analytics events.",
                "metadata": {"context": "Project Aurora", "icon": "note"},
            },
        ],
        "tasks": [
            {
                "id": "budget",
                "title": "Sign off on Maya's budget",
                "summary": "Final Q4 engineering budget review.",
                "status": "open",
                "due_at_ms": now_ms + 4 * 60 * 60 * 1000,
                "metadata": {"owner": "Maya Chen", "project": "Project Aurora"},
            },
            {
                "id": "slides",
                "title": "Prep Q4 roadmap slides",
                "summary": "Align with design and leadership.",
                "status": "open",
                "due_at_ms": now_ms + 2 * 24 * 60 * 60 * 1000,
                "metadata": {"owner": "Pucky", "project": "Project Aurora"},
            },
            {
                "id": "nda",
                "title": "Reply to legal about NDA",
                "summary": "They sent redlined version Friday.",
                "status": "open",
                "due_at_ms": now_ms - 24 * 60 * 60 * 1000,
                "metadata": {"owner": "Tom Reyes", "project": "Migration"},
            },
            {
                "id": "cleanup",
                "title": "Archive migration notes",
                "summary": "Moved into Project Migration.",
                "status": "done",
                "due_at_ms": now_ms - 2 * 24 * 60 * 60 * 1000,
                "metadata": {"owner": "Pucky", "project": "Migration"},
            },
        ],
        "calendar-events": [
            {
                "id": "roadmap",
                "title": "Roadmap sync",
                "summary": "Maya, Tom, Priya",
                "date": day,
                "start_at_ms": now_ms + 2 * 60 * 60 * 1000,
                "end_at_ms": now_ms + 3 * 60 * 60 * 1000,
                "html": "<!doctype html><h1>Roadmap sync</h1><p>Budget is approved. Sequence onboarding and migration milestones.</p>",
                "metadata": {"place": "Zoom", "attendees": ["Maya Chen", "Tom Reyes", "Priya Shah"]},
            },
            {
                "id": "vendor",
                "title": "Vendor review - Linear",
                "summary": "Conf room A",
                "date": day,
                "start_at_ms": now_ms + 6 * 60 * 60 * 1000,
                "end_at_ms": now_ms + 7 * 60 * 60 * 1000,
                "html": "<!doctype html><h1>Vendor review - Linear</h1><p>Review MCP integration, pricing, and migration costs.</p>",
                "metadata": {"place": "Conf room A", "attendees": ["Linear sales", "Tom Reyes"]},
            },
            {
                "id": "design-overlap",
                "title": "Design critique overlap",
                "summary": "Maya and Priya",
                "date": day,
                "start_at_ms": now_ms + 2 * 60 * 60 * 1000 + 15 * 60 * 1000,
                "end_at_ms": now_ms + 3 * 60 * 60 * 1000,
                "html": "<!doctype html><h1>Design critique overlap</h1><p>Overlapping calendar event to prove multiple same-hour blocks remain clickable.</p>",
                "metadata": {"place": "Figma", "attendees": ["Maya Chen", "Priya Shah"], "type": "design"},
            },
            {
                "id": "tomorrow-demo",
                "title": "Tomorrow launch review",
                "summary": "Launch checklist",
                "date": tomorrow,
                "start_at_ms": tomorrow_ms + 2 * 60 * 60 * 1000,
                "end_at_ms": tomorrow_ms + 3 * 60 * 60 * 1000,
                "html": "<!doctype html><h1>Tomorrow launch review</h1><p>Review launch checklist and final blockers.</p>",
                "metadata": {"place": "Zoom", "attendees": ["Maya Chen", "Priya Shah"]},
            },
        ],
        "feed-items": [
            {
                "id": "maya-budget",
                "title": "Maya approved the budget",
                "summary": "Slack DM",
                "event_at_ms": now_ms - 18 * 60 * 1000,
                "html": "<!doctype html><h1>Maya approved the budget</h1><p>Maya signed off on the revised engineering budget.</p>",
                "metadata": {"icon": "contacts", "type": "contact_activity"},
            },
            {
                "id": "project-decision",
                "title": "Aurora launch decision recorded",
                "summary": "Project decision",
                "event_at_ms": now_ms - 38 * 60 * 1000,
                "html": "<!doctype html><h1>Aurora launch decision</h1><p>The team chose the lighter first-run checklist.</p>",
                "metadata": {"icon": "folder", "type": "project_decision"},
            },
            {
                "id": "task-complete",
                "title": "Migration notes archived",
                "summary": "Task completed",
                "event_at_ms": now_ms - 65 * 60 * 1000,
                "html": "<!doctype html><h1>Migration notes archived</h1><p>The migration notes were moved into Project Migration.</p>",
                "metadata": {"icon": "checklist", "type": "task_completion"},
            },
            {
                "id": "calendar-change",
                "title": "Roadmap sync moved",
                "summary": "Calendar change",
                "event_at_ms": now_ms - 2 * 60 * 60 * 1000,
                "html": "<!doctype html><h1>Roadmap sync moved</h1><p>The roadmap sync shifted to the current planning window.</p>",
                "metadata": {"icon": "calendar", "type": "calendar_change"},
            },
            {
                "id": "note-update",
                "title": "Q4 hiring note updated",
                "summary": "Note update",
                "event_at_ms": now_ms - 3 * 60 * 60 * 1000,
                "html": "<!doctype html><h1>Q4 hiring note updated</h1><p>The hiring note now includes interview timing and role owners.</p>",
                "metadata": {"icon": "note", "type": "note_update"},
            },
        ],
        "projects": [
            {
                "id": "aurora",
                "title": "Project Aurora",
                "summary": "Spec review, PRD discussion, and requirements artifacts.",
                "html_asset_id": "asset-project-aurora",
                "metadata": {
                    "threads": ["PRD review thread", "Budget approval DM"],
                    "chips": ["2 threads", "4 artifacts", "Maya"],
                    "assets": ["Onboarding spec v3", "Requirements snapshot", "Figma comment"],
                },
            },
            {
                "id": "migration",
                "title": "Migration",
                "summary": "Reply threads, rollout docs, and follow-up work in one folder.",
                "metadata": {
                    "threads": ["Migration update", "Tom objections", "Slack launch notes"],
                    "chips": ["3 threads", "2 docs", "Tom"],
                    "assets": ["March eval notes", "Rollout checklist"],
                },
            },
        ],
        "contacts": [
            {
                "id": "maya",
                "title": "Maya Chen",
                "summary": "Design lead",
                "html_asset_id": "asset-contact-maya",
                "metadata": {
                    "first_name": "Maya",
                    "last_name": "Chen",
                    "avatar": "MC",
                    "photo": "fixtures/contact_photos/maya.svg",
                    "email": "maya.chen@email.com",
                    "phone": "+1 (415) 555-0142",
                    "endpoints": [{"label": "Slack", "value": "@maya"}, {"label": "Gmail", "value": "maya.chen@email.com"}],
                    "activity": ["Slack DM - approved the engineering budget", "Meeting - Roadmap sync today"],
                },
            },
            {
                "id": "tom",
                "title": "Tom Reyes",
                "summary": "Staff Engineer",
                "metadata": {
                    "first_name": "Tom",
                    "last_name": "Reyes",
                    "avatar": "TR",
                    "photo": "fixtures/contact_photos/tom.svg",
                    "email": "tom.reyes@email.com",
                    "phone": "+1 (415) 555-0177",
                    "endpoints": [{"label": "Gmail", "value": "tom.reyes@email.com"}],
                    "activity": ["Email - migration thread 1h ago", "Meeting - Vendor review today"],
                },
            },
        ],
    }


def default_workspace_links() -> list[dict[str, object]]:
    return [
        {"id": "aurora-note-q4", "source_kind": "project", "source_id": "aurora", "target_kind": "note", "target_id": "q4", "label": "Notes"},
        {"id": "aurora-task-slides", "source_kind": "project", "source_id": "aurora", "target_kind": "task", "target_id": "slides", "label": "Tasks"},
        {"id": "aurora-contact-maya", "source_kind": "project", "source_id": "aurora", "target_kind": "contact", "target_id": "maya", "label": "People"},
        {"id": "aurora-calendar-roadmap", "source_kind": "project", "source_id": "aurora", "target_kind": "calendar_event", "target_id": "roadmap", "label": "Roadmap sync"},
        {"id": "aurora-feed-decision", "source_kind": "project", "source_id": "aurora", "target_kind": "feed_item", "target_id": "project-decision", "label": "Aurora launch decision"},
        {"id": "migration-task-cleanup", "source_kind": "project", "source_id": "migration", "target_kind": "task", "target_id": "cleanup", "label": "Tasks"},
        {"id": "migration-contact-tom", "source_kind": "project", "source_id": "migration", "target_kind": "contact", "target_id": "tom", "label": "People"},
        {"id": "migration-calendar-vendor", "source_kind": "project", "source_id": "migration", "target_kind": "calendar_event", "target_id": "vendor", "label": "Vendor review"},
        {"id": "migration-feed-task", "source_kind": "project", "source_id": "migration", "target_kind": "feed_item", "target_id": "task-complete", "label": "Migration notes archived"},
    ]
