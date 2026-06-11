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
    "messages": "message",
    "meeting-notes": "meeting_note",
    "reminders": "reminder",
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
        elif kind == "message":
            order = "ORDER BY event_at_ms DESC, updated_at_ms DESC"
        elif kind == "meeting_note":
            order = "ORDER BY start_at_ms DESC, event_at_ms DESC, updated_at_ms DESC"
        elif kind == "reminder":
            order = "ORDER BY status = 'done', due_at_ms = 0, due_at_ms ASC, updated_at_ms DESC"
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
            graph_seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'seeded_graph_v1'").fetchone()
        now = self.now_ms()
        if not seeded:
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
        if not graph_seeded:
            graph_defaults = default_workspace_graph_records(now)
            for collection, records in graph_defaults.items():
                for record in records:
                    self.upsert_record(collection, record)
            for link in default_workspace_graph_links():
                self.upsert_link(link)
            with self._lock:
                self._conn.execute(
                    "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                    ("seeded_graph_v1", "1", now),
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


def _task_html(title: str, intro: str, bullets: list[str], footer: str) -> str:
    bullet_html = "".join(f"<li>{item}</li>" for item in bullets)
    return (
        "<!doctype html><html><body>"
        f"<h1>{title}</h1>"
        f"<p>{intro}</p>"
        f"<ul>{bullet_html}</ul>"
        f"<p>{footer}</p>"
        "</body></html>"
    )


def _personal_html(title: str, intro: str, bullets: list[str]) -> str:
    bullet_html = "".join(f"<li>{item}</li>" for item in bullets)
    return (
        "<!doctype html><html><body>"
        f"<h1>{title}</h1>"
        f"<p>{intro}</p>"
        f"<ul>{bullet_html}</ul>"
        "</body></html>"
    )


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
                "id": "demo-task-do-budget",
                "title": "Approve partner launch budget",
                "summary": "Final sign-off for this week's launch spend.",
                "status": "open",
                "due_at_ms": now_ms + 2 * 60 * 60 * 1000,
                "html": _task_html(
                    "Approve partner launch budget",
                    "Confirm the final launch spend before tomorrow morning's review.",
                    ["Review the revised cost table", "Confirm finance sign-off", "Post the approved total in the rollout thread"],
                    "Budget is expected to close today so this card should stay in the active DO bucket."
                ),
                "metadata": {"owner": "Maya Chen", "project": "Project Aurora"},
            },
            {
                "id": "demo-task-do-connect-brief",
                "title": "Review Connect onboarding brief",
                "summary": "Tighten the opening flow copy before review.",
                "status": "open",
                "due_at_ms": now_ms + 7 * 60 * 60 * 1000,
                "html": _task_html(
                    "Review Connect onboarding brief",
                    "Trim the opening copy and verify the first-run screen order.",
                    ["Check the new app labels", "Confirm the back-header behavior", "Flag any screens that still feel too busy"],
                    "This one is intentionally close enough to feel urgent without falling into the overdue bucket."
                ),
                "metadata": {"owner": "Pucky", "project": "Project Aurora"},
            },
            {
                "id": "demo-task-do-vendor-followup",
                "title": "Send vendor follow-up notes",
                "summary": "Close the loop on today's migration call.",
                "status": "open",
                "due_at_ms": now_ms + 20 * 60 * 60 * 1000,
                "html": _task_html(
                    "Send vendor follow-up notes",
                    "Package the migration call decisions into a concise next-steps note.",
                    ["List the blockers still open", "Assign owners for the two missing inputs", "Send the summary to the shared thread"],
                    "If it slips past tonight it should still read cleanly on the task page."
                ),
                "metadata": {"owner": "Tom Reyes", "project": "Migration"},
            },
            {
                "id": "demo-task-soon-roadmap",
                "title": "Prep roadmap review deck",
                "summary": "Align the next pass with design and leadership.",
                "status": "open",
                "due_at_ms": now_ms + 2 * 24 * 60 * 60 * 1000,
                "html": _task_html(
                    "Prep roadmap review deck",
                    "Build the next revision of the roadmap deck for the standing review.",
                    ["Update the milestones slide", "Trim the risks section", "Add the launch-readiness note from Maya"],
                    "This sits in Upcoming so the date treatment should stay compact."
                ),
                "metadata": {"owner": "Pucky", "project": "Project Aurora"},
            },
            {
                "id": "demo-task-soon-nda",
                "title": "Reply to legal NDA edits",
                "summary": "Second redline still needs a response.",
                "status": "open",
                "due_at_ms": now_ms + 4 * 24 * 60 * 60 * 1000,
                "html": _task_html(
                    "Reply to legal NDA edits",
                    "Collect the current redline, legal notes, and final signer before replying.",
                    ["Confirm the indemnity language", "Note the requested signature path", "Send the next response back to legal"],
                    "The body is intentionally richer so the detail page feels like a real generated brief."
                ),
                "metadata": {"owner": "Tom Reyes", "project": "Migration"},
            },
            {
                "id": "demo-task-soon-customer-recap",
                "title": "Draft customer migration recap",
                "summary": "Pull the key decisions into one page for the sponsor.",
                "status": "open",
                "due_at_ms": now_ms + 6 * 24 * 60 * 60 * 1000,
                "html": _task_html(
                    "Draft customer migration recap",
                    "Turn the latest migration thread into a clean sponsor-facing recap.",
                    ["Summarize the main decisions", "Call out the unresolved blocker", "Propose the next check-in date"],
                    "This is farther out, so the list should show a short date instead of a time."
                ),
                "metadata": {"owner": "Priya Shah", "project": "Migration"},
            },
            {
                "id": "demo-task-overdue-invoice",
                "title": "Resolve overdue invoice approval",
                "summary": "Finance still needs the missing approval chain.",
                "status": "open",
                "due_at_ms": now_ms - 3 * 60 * 60 * 1000,
                "html": _task_html(
                    "Resolve overdue invoice approval",
                    "This invoice missed its window and now needs an immediate follow-up.",
                    ["Confirm the final approver", "Ping finance for the blocked step", "Update the migration tracker once cleared"],
                    "Overdue tasks should still feel crisp in the list and on detail."
                ),
                "metadata": {"owner": "Finance", "project": "Migration"},
            },
            {
                "id": "demo-task-overdue-security",
                "title": "Close security questionnaire gaps",
                "summary": "Two answers are still missing from the vendor packet.",
                "status": "open",
                "due_at_ms": now_ms - 28 * 60 * 60 * 1000,
                "html": _task_html(
                    "Close security questionnaire gaps",
                    "Fill the final questionnaire gaps before the next review loop.",
                    ["Answer the data retention question", "Attach the vendor policy PDF", "Send the completed packet back to procurement"],
                    "This is a good overdue example because the body has enough structure to scroll."
                ),
                "metadata": {"owner": "Security", "project": "Migration"},
            },
            {
                "id": "demo-task-overdue-launch-copy",
                "title": "Finalize launch copy edits",
                "summary": "The last copy pass slipped past deadline.",
                "status": "open",
                "due_at_ms": now_ms - 72 * 60 * 60 * 1000,
                "html": _task_html(
                    "Finalize launch copy edits",
                    "The remaining copy nits need a final decision so the page can ship.",
                    ["Resolve the headline choice", "Confirm the CTA wording", "Hand the approved copy back to design"],
                    "This one is intentionally stale so the overdue bucket has variety."
                ),
                "metadata": {"owner": "Maya Chen", "project": "Project Aurora"},
            },
            {
                "id": "demo-task-done-archive",
                "title": "Archive migration notes",
                "summary": "Moved into Project Migration.",
                "status": "done",
                "due_at_ms": now_ms - 2 * 24 * 60 * 60 * 1000,
                "html": _task_html(
                    "Archive migration notes",
                    "The migration notes were reviewed, moved, and closed out cleanly.",
                    ["Confirm the archive location", "Link the final note in the project", "Mark the cleanup complete"],
                    "Done tasks keep their native state handling but still show a full page."
                ),
                "metadata": {"owner": "Pucky", "project": "Migration"},
            },
            {
                "id": "demo-task-done-handbook",
                "title": "Publish onboarding checklist",
                "summary": "The revised first-run checklist is already live.",
                "status": "done",
                "due_at_ms": now_ms - 24 * 60 * 60 * 1000,
                "html": _task_html(
                    "Publish onboarding checklist",
                    "The checklist shipped and the owner just needs the historical page for context.",
                    ["Confirm the launch note", "Link the checklist in Connect", "Record the release timestamp"],
                    "This is a clean completed example for the DONE section."
                ),
                "metadata": {"owner": "Pucky", "project": "Project Aurora"},
            },
            {
                "id": "demo-task-done-retro",
                "title": "Log roadmap retro decisions",
                "summary": "The retro decisions were captured and distributed.",
                "status": "done",
                "due_at_ms": now_ms - 5 * 24 * 60 * 60 * 1000,
                "html": _task_html(
                    "Log roadmap retro decisions",
                    "Capture the final retro decisions so the next planning cycle has a stable reference.",
                    ["Record the tradeoffs", "Link the approved follow-ups", "Share the final retro summary"],
                    "This one helps the done group feel less repetitive."
                ),
                "metadata": {"owner": "Priya Shah", "project": "Project Aurora"},
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
        ],
    }


def default_workspace_links() -> list[dict[str, object]]:
    return [
        {"id": "aurora-note-q4", "source_kind": "project", "source_id": "aurora", "target_kind": "note", "target_id": "q4", "label": "Notes"},
        {"id": "aurora-task-roadmap", "source_kind": "project", "source_id": "aurora", "target_kind": "task", "target_id": "demo-task-soon-roadmap", "label": "Tasks"},
        {"id": "aurora-contact-maya", "source_kind": "project", "source_id": "aurora", "target_kind": "contact", "target_id": "maya", "label": "People"},
        {"id": "aurora-calendar-roadmap", "source_kind": "project", "source_id": "aurora", "target_kind": "calendar_event", "target_id": "roadmap", "label": "Roadmap sync"},
        {"id": "aurora-feed-decision", "source_kind": "project", "source_id": "aurora", "target_kind": "feed_item", "target_id": "project-decision", "label": "Aurora launch decision"},
        {"id": "migration-task-archive", "source_kind": "project", "source_id": "migration", "target_kind": "task", "target_id": "demo-task-done-archive", "label": "Tasks"},
        {"id": "migration-calendar-vendor", "source_kind": "project", "source_id": "migration", "target_kind": "calendar_event", "target_id": "vendor", "label": "Vendor review"},
        {"id": "migration-feed-task", "source_kind": "project", "source_id": "migration", "target_kind": "feed_item", "target_id": "task-complete", "label": "Migration notes archived"},
    ]


def default_workspace_graph_records(now_ms: int) -> dict[str, list[dict[str, object]]]:
    day = time.strftime("%Y-%m-%d", time.localtime(now_ms / 1000))
    tomorrow_ms = now_ms + 24 * 60 * 60 * 1000
    tomorrow = time.strftime("%Y-%m-%d", time.localtime(tomorrow_ms / 1000))
    return {
        "notes": [
            {
                "id": "house-paint-notes",
                "title": "House paint notes",
                "summary": "Maya can bring paint swatches; compare warm white against hallway light.",
                "html": _personal_html(
                    "House paint notes",
                    "Maya can bring paint swatches and help compare the upstairs hallway samples.",
                    ["Check afternoon light", "Photograph the trim", "Decide between linen and warm white"],
                ),
                "metadata": {"context": "Home refresh", "icon": "note"},
            }
        ],
        "tasks": [
            {
                "id": "demo-task-do-paint-samples",
                "title": "Bring paint samples upstairs",
                "summary": "Set the samples near the window before Maya arrives.",
                "status": "open",
                "due_at_ms": now_ms + 3 * 60 * 60 * 1000,
                "html": _task_html(
                    "Bring paint samples upstairs",
                    "Put the sample cards where the light actually changes during the day.",
                    ["Carry the swatches upstairs", "Tape each one by the hallway trim", "Text Maya a picture before the walkthrough"],
                    "This task is linked from a message, a meeting note, a reminder, and the Home refresh project.",
                ),
                "metadata": {"owner": "Maya Chen", "project": "Home refresh", "source": "demo-message-house-repair"},
            }
        ],
        "calendar-events": [
            {
                "id": "house-walkthrough",
                "title": "Home refresh walkthrough",
                "summary": "Walk the hallway, paint samples, and loose repair list.",
                "date": day,
                "start_at_ms": now_ms + 4 * 60 * 60 * 1000,
                "end_at_ms": now_ms + 5 * 60 * 60 * 1000,
                "html": _personal_html(
                    "Home refresh walkthrough",
                    "A practical walkthrough for hallway paint, small repairs, and the weekend supply list.",
                    ["Maya checks paint tones", "Confirm which repair needs a contractor", "Turn decisions into tasks"],
                ),
                "metadata": {"place": "Home", "attendees": ["Maya Chen"], "type": "personal"},
            },
            {
                "id": "trip-dinner-planning",
                "title": "Dinner and trip planning",
                "summary": "Sketch dinner timing and train options for tomorrow.",
                "date": tomorrow,
                "start_at_ms": tomorrow_ms + 18 * 60 * 60 * 1000,
                "end_at_ms": tomorrow_ms + 19 * 60 * 60 * 1000,
                "html": _personal_html(
                    "Dinner and trip planning",
                    "Small logistics meeting for dinner, packing, and the train window.",
                    ["Pick dinner spot", "Check train timing", "Share the note with family"],
                ),
                "metadata": {"place": "Kitchen table", "attendees": ["Maya Chen"], "type": "family"},
            },
        ],
        "projects": [
            {
                "id": "home-refresh",
                "title": "Home refresh",
                "summary": "Paint, small repairs, and weekend decisions in one personal project.",
                "html": _personal_html(
                    "Home refresh",
                    "A lightweight project for turning house-repair chatter into a few useful next actions.",
                    ["Paint samples upstairs", "Hallway repair estimate", "Weekend supply run"],
                ),
                "metadata": {"threads": ["Paint samples", "Repair walkthrough"], "chips": ["personal", "house", "Maya"], "assets": ["Paint photos", "Repair list"]},
            }
        ],
        "messages": [
            {
                "id": "demo-message-house-repair",
                "title": "Maya can bring paint swatches",
                "summary": "Text from Maya about paint samples and the hallway repair list.",
                "event_at_ms": now_ms - 24 * 60 * 1000,
                "html": _personal_html(
                    "Maya can bring paint swatches",
                    "Maya offered to bring the paint swatches before the home refresh walkthrough.",
                    ["Ask for linen and warm white", "Tie it to the walkthrough", "Spawn the upstairs sample task"],
                ),
                "metadata": {
                    "channel": "Messages",
                    "sender": "Maya Chen",
                    "participants": ["Maya Chen"],
                    "unread_count": 1,
                    "transcript": [
                        {"role": "assistant", "sender": "Maya Chen", "text": "I can bring the paint swatches around 6 if that still helps.", "time": "5:36 PM"},
                        {"role": "user", "sender": "You", "text": "Perfect. Bring warm white and linen too so we can decide before dinner.", "time": "5:41 PM"},
                    ],
                    "extracted_topics": ["home refresh", "paint", "repair"],
                },
            },
            {
                "id": "demo-message-dinner-plan",
                "title": "Dinner timing for tomorrow",
                "summary": "Family logistics message about dinner and the train window.",
                "event_at_ms": now_ms - 2 * 60 * 60 * 1000,
                "html": _personal_html(
                    "Dinner timing for tomorrow",
                    "A low-stakes logistics thread that can still become reminders or calendar events.",
                    ["Confirm the table time", "Check train arrival", "Share note after work"],
                ),
                "metadata": {
                    "channel": "Messages",
                    "sender": "Family",
                    "participants": ["Maya Chen"],
                    "transcript": [
                        {"role": "assistant", "sender": "Family", "text": "Can we push dinner to 7:30 if the train is running late?", "time": "3:08 PM"},
                        {"role": "user", "sender": "You", "text": "Yep. I'll check the arrival window when I leave work.", "time": "3:14 PM"},
                    ],
                    "extracted_topics": ["dinner", "trip"],
                },
            },
            {
                "id": "demo-message-freelance-followup",
                "title": "Freelance client follow-up",
                "summary": "Client wants the revised HTML concept and one invoice note.",
                "event_at_ms": now_ms - 5 * 60 * 60 * 1000,
                "html": _personal_html(
                    "Freelance client follow-up",
                    "A work-adjacent message that belongs in the personal workspace without feeling corporate.",
                    ["Send the HTML concept", "Flag invoice timing", "Make one follow-up reminder"],
                ),
                "metadata": {
                    "channel": "Email",
                    "sender": "Sam Rivera",
                    "participants": ["Sam Rivera"],
                    "unread_count": 1,
                    "transcript": [
                        {"role": "assistant", "sender": "Sam Rivera", "text": "Could you send the revised HTML concept tonight and add one invoice note?", "time": "11:02 AM"},
                        {"role": "user", "sender": "You", "text": "Yes. I'll send the concept after I clean up the layout pass.", "time": "11:19 AM"},
                    ],
                    "reply_preview": "I'll send the revised concept tonight.",
                    "extracted_topics": ["freelance", "invoice"],
                },
            },
            {
                "id": "demo-message-clinic-followup",
                "title": "Clinic reschedule text",
                "summary": "Quick scheduling note that may become a reminder and a calendar block.",
                "event_at_ms": now_ms - 9 * 60 * 60 * 1000,
                "html": _personal_html(
                    "Clinic reschedule text",
                    "A tiny logistics thread that still belongs in the same personal graph.",
                    ["Confirm the new slot", "Add it to calendar", "Set a reminder the night before"],
                ),
                "metadata": {
                    "channel": "Messages",
                    "sender": "Dr. Patel Office",
                    "participants": ["Dr. Patel Office"],
                    "transcript": [
                        {"role": "assistant", "sender": "Dr. Patel Office", "text": "We can move your appointment to Friday at 11 if that helps.", "time": "9:12 AM"},
                        {"role": "user", "sender": "You", "text": "Friday at 11 works. Please send the prep note again.", "time": "9:19 AM"},
                    ],
                    "extracted_topics": ["health", "appointment"],
                },
            },
        ],
        "meeting-notes": [
            {
                "id": "demo-meeting-home-refresh",
                "title": "Home refresh walkthrough",
                "summary": "Meeting-style note for paint, repairs, and follow-up tasks.",
                "date": day,
                "start_at_ms": now_ms + 4 * 60 * 60 * 1000,
                "end_at_ms": now_ms + 5 * 60 * 60 * 1000,
                "html": _personal_html(
                    "Home refresh walkthrough",
                    "Graph meeting note that links a calendar block, attendee, project, note, task, and reminder.",
                    ["Compare paint samples", "Confirm contractor question", "Turn final decisions into weekend tasks"],
                ),
                "metadata": {"participants": ["Maya Chen"], "source": "house-walkthrough", "source_kind": "calendar_event", "source_id": "house-walkthrough", "extracted_topics": ["paint", "repair", "home refresh"]},
            },
            {
                "id": "demo-meeting-trip-plan",
                "title": "Trip planning check-in",
                "summary": "A personal planning session for family logistics and packing reminders.",
                "date": tomorrow,
                "start_at_ms": tomorrow_ms + 18 * 60 * 60 * 1000,
                "end_at_ms": tomorrow_ms + 19 * 60 * 60 * 1000,
                "html": _personal_html(
                    "Trip planning check-in",
                    "Small meeting note that keeps travel logistics connected to messages and reminders.",
                    ["Dinner timing", "Train arrival", "Packing reminder"],
                ),
                "metadata": {"participants": ["Maya Chen"], "source": "trip-dinner-planning", "source_kind": "calendar_event", "source_id": "trip-dinner-planning", "extracted_topics": ["trip", "family logistics"]},
            },
        ],
        "reminders": [
            {
                "id": "demo-reminder-paint-samples",
                "title": "Bring paint samples upstairs",
                "summary": "Nudge before the home refresh walkthrough.",
                "status": "open",
                "due_at_ms": now_ms + 2 * 60 * 60 * 1000,
                "html": _personal_html(
                    "Bring paint samples upstairs",
                    "Reminder attached to the paint task and meeting note.",
                    ["Bring swatches upstairs", "Photograph each option", "Have them ready before Maya arrives"],
                ),
                "metadata": {"source_kind": "task", "source_id": "demo-task-do-paint-samples", "snooze_state": "ready"},
            },
            {
                "id": "demo-reminder-health-call",
                "title": "Call clinic before lunch",
                "summary": "Standalone health appointment reminder.",
                "status": "open",
                "due_at_ms": now_ms + 20 * 60 * 60 * 1000,
                "html": _personal_html(
                    "Call clinic before lunch",
                    "A simple standalone reminder that is not a task yet.",
                    ["Ask about appointment slot", "Write down prep instructions", "Add calendar block if confirmed"],
                ),
                "metadata": {"source_kind": "contact", "source_id": "", "snooze_state": "ready"},
            },
            {
                "id": "demo-reminder-book-note",
                "title": "Turn book note into project idea",
                "summary": "Review the scratch note this weekend.",
                "status": "open",
                "due_at_ms": now_ms + 3 * 24 * 60 * 60 * 1000,
                "html": _personal_html(
                    "Turn book note into project idea",
                    "A reminder can attach to memory without becoming a formal task first.",
                    ["Reread the highlighted page", "Write one paragraph", "Decide if it becomes a project"],
                ),
                "metadata": {"source_kind": "note", "source_id": "house-paint-notes", "snooze_state": "later"},
            },
        ],
    }


def default_workspace_graph_links() -> list[dict[str, object]]:
    return [
        {"id": "graph-message-house-contact", "source_kind": "message", "source_id": "demo-message-house-repair", "target_kind": "contact", "target_id": "maya", "label": "Maya Chen"},
        {"id": "graph-message-house-note", "source_kind": "message", "source_id": "demo-message-house-repair", "target_kind": "note", "target_id": "house-paint-notes", "label": "House paint notes"},
        {"id": "graph-message-house-task", "source_kind": "message", "source_id": "demo-message-house-repair", "target_kind": "task", "target_id": "demo-task-do-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-message-house-project", "source_kind": "message", "source_id": "demo-message-house-repair", "target_kind": "project", "target_id": "home-refresh", "label": "Home refresh"},
        {"id": "graph-message-house-reminder", "source_kind": "message", "source_id": "demo-message-house-repair", "target_kind": "reminder", "target_id": "demo-reminder-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-meeting-home-contact", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "contact", "target_id": "maya", "label": "Maya Chen"},
        {"id": "graph-meeting-home-calendar", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "calendar_event", "target_id": "house-walkthrough", "label": "Home refresh walkthrough"},
        {"id": "graph-meeting-home-note", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "note", "target_id": "house-paint-notes", "label": "House paint notes"},
        {"id": "graph-meeting-home-task", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "task", "target_id": "demo-task-do-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-meeting-home-project", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "project", "target_id": "home-refresh", "label": "Home refresh"},
        {"id": "graph-meeting-home-reminder", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "reminder", "target_id": "demo-reminder-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-project-home-contact", "source_kind": "project", "source_id": "home-refresh", "target_kind": "contact", "target_id": "maya", "label": "Maya Chen"},
        {"id": "graph-project-home-note", "source_kind": "project", "source_id": "home-refresh", "target_kind": "note", "target_id": "house-paint-notes", "label": "House paint notes"},
        {"id": "graph-project-home-task", "source_kind": "project", "source_id": "home-refresh", "target_kind": "task", "target_id": "demo-task-do-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-project-home-reminder", "source_kind": "project", "source_id": "home-refresh", "target_kind": "reminder", "target_id": "demo-reminder-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-reminder-paint-task", "source_kind": "reminder", "source_id": "demo-reminder-paint-samples", "target_kind": "task", "target_id": "demo-task-do-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-reminder-paint-meeting", "source_kind": "reminder", "source_id": "demo-reminder-paint-samples", "target_kind": "meeting_note", "target_id": "demo-meeting-home-refresh", "label": "Home refresh walkthrough"},
    ]
