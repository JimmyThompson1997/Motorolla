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


def _normalize_reminder_recipient_id(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return "self" if raw.lower() == "self" else raw


def _normalize_reminder_recipients(value: object) -> list[dict[str, Any]]:
    entries = list(value) if isinstance(value, list) else []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in entries:
        if isinstance(entry, str):
            recipient_id = _normalize_reminder_recipient_id(entry)
            if not recipient_id or recipient_id in seen:
                continue
            kind = "self" if recipient_id == "self" else "contact"
            out.append(
                {
                    "id": recipient_id,
                    "kind": kind,
                    "contact_id": "" if kind == "self" else recipient_id,
                    "label": "Me" if kind == "self" else "",
                }
            )
            seen.add(recipient_id)
            continue
        if not isinstance(entry, dict):
            continue
        recipient_id = _normalize_reminder_recipient_id(
            entry.get("id") or entry.get("recipient_id") or entry.get("contact_id")
        )
        if not recipient_id or recipient_id in seen:
            continue
        kind = str(entry.get("kind") or "").strip().lower()
        if kind not in {"self", "contact"}:
            kind = "self" if recipient_id == "self" else "contact"
        out.append(
            {
                "id": recipient_id,
                "kind": kind,
                "contact_id": "" if kind == "self" else str(entry.get("contact_id") or recipient_id).strip(),
                "label": str(entry.get("label") or entry.get("title") or entry.get("name") or ("Me" if kind == "self" else "")).strip(),
            }
        )
        seen.add(recipient_id)
    if out:
        return out
    return [{"id": "self", "kind": "self", "contact_id": "", "label": "Me"}]


def _normalize_reminder_destinations(value: object) -> list[dict[str, Any]]:
    entries = list(value) if isinstance(value, list) else []
    out: list[dict[str, Any]] = []
    for entry in entries:
        if isinstance(entry, str):
            channel = str(entry or "").strip().lower()
            if channel:
                out.append(
                    {
                        "id": f"{channel}-default",
                        "channel": channel,
                        "recipient_ids": ["self"],
                        "app_slug": "",
                        "connected_account_id": "",
                        "endpoint": "",
                        "address": "",
                        "label": "",
                        "method": "POST",
                        "query": [],
                        "parameters": {},
                        "notification_payload": {},
                    }
                )
            continue
        if not isinstance(entry, dict):
            continue
        channel = str(entry.get("channel") or entry.get("kind") or entry.get("type") or "").strip().lower()
        if not channel:
            continue
        raw_recipient_ids = entry.get("recipient_ids")
        recipient_ids: list[str] = []
        if isinstance(raw_recipient_ids, list):
            recipient_ids = [
                recipient_id
                for recipient_id in (_normalize_reminder_recipient_id(item) for item in raw_recipient_ids)
                if recipient_id
            ]
        else:
            single = _normalize_reminder_recipient_id(
                entry.get("recipient_id") or entry.get("contact_id") or "self"
            )
            if single:
                recipient_ids = [single]
        out.append(
            {
                "id": str(entry.get("id") or f"{channel}-{len(out) + 1}").strip() or f"{channel}-{len(out) + 1}",
                "channel": channel,
                "recipient_ids": recipient_ids or ["self"],
                "app_slug": str(entry.get("app_slug") or "").strip().lower(),
                "connected_account_id": str(entry.get("connected_account_id") or "").strip(),
                "endpoint": str(entry.get("endpoint") or "").strip(),
                "address": str(entry.get("address") or entry.get("value") or entry.get("number") or "").strip(),
                "label": str(entry.get("label") or "").strip(),
                "method": str(entry.get("method") or "POST").strip().upper() or "POST",
                "query": list(entry.get("query") or []) if isinstance(entry.get("query"), list) else [],
                "parameters": dict(entry.get("parameters") or {}) if isinstance(entry.get("parameters"), dict) else {},
                "notification_payload": dict(entry.get("notification_payload") or {}) if isinstance(entry.get("notification_payload"), dict) else {},
            }
        )
    if out:
        return out
    return [
        {
            "id": "phone_notification-default",
            "channel": "phone_notification",
            "recipient_ids": ["self"],
            "app_slug": "",
            "connected_account_id": "",
            "endpoint": "",
            "address": "",
            "label": "",
            "method": "POST",
            "query": [],
            "parameters": {},
            "notification_payload": {},
        }
    ]


def _normalize_reminder_delivery_results(value: object) -> list[dict[str, Any]]:
    entries = list(value) if isinstance(value, list) else []
    out: list[dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        out.append(
            {
                "channel": str(entry.get("channel") or "").strip().lower(),
                "recipient_id": _normalize_reminder_recipient_id(entry.get("recipient_id")),
                "recipient_label": str(entry.get("recipient_label") or "").strip(),
                "target": str(entry.get("target") or "").strip(),
                "ok": bool(entry.get("ok")),
                "status": str(entry.get("status") or "").strip(),
                "detail": str(entry.get("detail") or entry.get("error") or "").strip(),
                "command_id": str(entry.get("command_id") or "").strip(),
                "connected_account_id": str(entry.get("connected_account_id") or "").strip(),
                "app_slug": str(entry.get("app_slug") or "").strip().lower(),
                "requested_mode": str(entry.get("requested_mode") or "").strip(),
                "effective_mode": str(entry.get("effective_mode") or "").strip(),
                "degraded_to": str(entry.get("degraded_to") or "").strip(),
                "warnings": list(entry.get("warnings") or []) if isinstance(entry.get("warnings"), list) else [],
                "fired_at_ms": _int_or_zero(entry.get("fired_at_ms")),
            }
        )
    return out


def _normalize_reminder_metadata(metadata: dict[str, Any], *, status: str) -> dict[str, Any]:
    normalized = dict(metadata or {})
    delivery_state = str(normalized.get("delivery_state") or "").strip().lower()
    if delivery_state not in {"pending", "sent", "failed"}:
        delivery_state = "pending"
    normalized["delivery_state"] = delivery_state
    normalized["last_fired_at_ms"] = _int_or_zero(normalized.get("last_fired_at_ms"))
    normalized["last_fired_due_at_ms"] = _int_or_zero(normalized.get("last_fired_due_at_ms"))
    normalized["snoozed_until_ms"] = _int_or_zero(normalized.get("snoozed_until_ms"))
    normalized["last_delivery_error"] = str(normalized.get("last_delivery_error") or "").strip()
    normalized["notification_device_id"] = str(normalized.get("notification_device_id") or "").strip()
    normalized["last_notification_command_id"] = str(normalized.get("last_notification_command_id") or "").strip()
    normalized["last_delivery_mode_requested"] = str(normalized.get("last_delivery_mode_requested") or "").strip()
    normalized["last_delivery_mode_effective"] = str(normalized.get("last_delivery_mode_effective") or "").strip()
    normalized["last_delivery_degraded_to"] = str(normalized.get("last_delivery_degraded_to") or "").strip()
    warnings = normalized.get("last_delivery_warnings")
    normalized["last_delivery_warnings"] = list(warnings) if isinstance(warnings, list) else []
    notification_payload = normalized.get("notification_payload")
    normalized["notification_payload"] = dict(notification_payload) if isinstance(notification_payload, dict) else {}
    normalized["recipients"] = _normalize_reminder_recipients(normalized.get("recipients"))
    normalized["destinations"] = _normalize_reminder_destinations(normalized.get("destinations"))
    normalized["last_delivery_results"] = _normalize_reminder_delivery_results(normalized.get("last_delivery_results"))
    normalized["recurrence"] = dict(normalized.get("recurrence") or {}) if isinstance(normalized.get("recurrence"), dict) else {}
    if str(status or "").strip().lower() == "done":
        normalized["snoozed_until_ms"] = 0
    return normalized


TASK_STATUS_ALIASES = {
    "": "todo",
    "open": "todo",
    "todo": "todo",
    "to_do": "todo",
    "in_progress": "in_progress",
    "in-progress": "in_progress",
    "in progress": "in_progress",
    "waiting": "waiting",
    "blocked": "waiting",
    "done": "done",
    "complete": "done",
    "completed": "done",
}


def normalize_task_status(value: object) -> str:
    raw = str(value or "").strip().lower()
    return TASK_STATUS_ALIASES.get(raw, "todo")


def _normalize_task_checklist(items: object) -> list[dict[str, object]]:
    if not isinstance(items, list):
        return []
    normalized: list[dict[str, object]] = []
    for index, item in enumerate(items, start=1):
        if isinstance(item, dict):
            label = str(item.get("label") or item.get("title") or item.get("text") or "").strip()
            if not label:
                continue
            normalized.append(
                {
                    "id": str(item.get("id") or f"item-{index}").strip() or f"item-{index}",
                    "label": label,
                    "done": bool(item.get("done") or item.get("checked")),
                }
            )
            continue
        label = str(item or "").strip()
        if not label:
            continue
        normalized.append({"id": f"item-{index}", "label": label, "done": False})
    return normalized


def _normalize_task_metadata(metadata: dict[str, Any], payload: dict[str, object], *, summary: str) -> dict[str, Any]:
    normalized = dict(metadata or {})
    created_by = str(
        payload.get("created_by")
        or normalized.get("created_by")
        or normalized.get("owner")
        or ""
    ).strip()
    if created_by:
        normalized["created_by"] = created_by
        normalized["owner"] = str(normalized.get("owner") or created_by).strip() or created_by
    description = str(payload.get("description") or normalized.get("description") or summary or "").strip()
    if description:
        normalized["description"] = description
    checklist = payload.get("checklist") if "checklist" in payload else normalized.get("checklist")
    normalized["checklist"] = _normalize_task_checklist(checklist)
    normalized["status"] = normalize_task_status(payload.get("status") or normalized.get("status") or "")
    return normalized


def derive_task_group(record: dict[str, Any], now_ms: int | None = None) -> str:
    status = normalize_task_status(record.get("status"))
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
        existing_record = self.get_record(collection, record_id, include_deleted=True)
        normalized = self._normalize_record(kind, record_id, payload, now_ms=now)
        if kind == "note":
            self._apply_note_content_timestamp(normalized, existing_record, now_ms=now)
        created_at_ms = int(existing_record["created_at_ms"]) if existing_record else now
        with self._lock:
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

    @staticmethod
    def _note_content_updated_at_ms(record: dict[str, object] | None) -> int:
        if not isinstance(record, dict):
            return 0
        metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
        value = _int_or_zero(metadata.get("content_updated_at_ms")) if isinstance(metadata, dict) else 0
        if value > 0:
            return value
        return _int_or_zero(record.get("content_updated_at_ms"))

    @classmethod
    def _note_content_changed(cls, current: dict[str, object] | None, record: dict[str, object]) -> bool:
        if current is None:
            return True
        current_metadata = dict(current.get("metadata") or {})
        next_metadata = dict(record.get("metadata") or {})
        current_metadata.pop("content_updated_at_ms", None)
        next_metadata.pop("content_updated_at_ms", None)
        return (
            str(current.get("title") or "") != str(record.get("title") or "")
            or str(current.get("summary") or "") != str(record.get("summary") or "")
            or str(current.get("html") or "") != str(record.get("html") or "")
            or str(current.get("html_asset_id") or "") != str(record.get("html_asset_id") or "")
            or current_metadata != next_metadata
        )

    @classmethod
    def _apply_note_content_timestamp(
        cls,
        record: dict[str, object],
        current: dict[str, object] | None,
        *,
        now_ms: int,
    ) -> None:
        metadata = dict(record.get("metadata") or {})
        previous = cls._note_content_updated_at_ms(current)
        explicit = _int_or_zero(record.get("content_updated_at_ms") or metadata.get("content_updated_at_ms"))
        if explicit > 0 and explicit != previous:
            resolved = explicit
        elif current is None:
            resolved = _int_or_zero(record.get("updated_at_ms") or record.get("created_at_ms")) or now_ms
        elif cls._note_content_changed(current, record):
            resolved = now_ms
        else:
            resolved = previous or _int_or_zero(current.get("created_at_ms")) or now_ms
        if resolved <= 0:
            if current is None:
                resolved = now_ms
            else:
                resolved = previous or now_ms
        metadata["content_updated_at_ms"] = resolved
        record["metadata"] = metadata
        record["content_updated_at_ms"] = resolved

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
            graph_v2_seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'seeded_graph_v2'").fetchone()
            graph_v3_seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'seeded_graph_v3'").fetchone()
            proof_cleanup_seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'proof_cleanup_v1'").fetchone()
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
        if not graph_v2_seeded:
            self._reseed_graph_v2(now)
        if not graph_v3_seeded:
            self._reseed_graph_v3(now)
        if not proof_cleanup_seeded:
            self._cleanup_proof_artifacts(now)

    @staticmethod
    def kind_for_collection(collection: str) -> str:
        kind = WORKSPACE_COLLECTIONS.get(str(collection or "").strip())
        if not kind:
            raise ValueError("unknown_workspace_collection")
        return kind

    def _reseed_graph_v2(self, now_ms: int) -> None:
        graph_record_ids = [
            "house-paint-notes",
            "clinic-prep-note",
            "freelance-homepage-note",
            "demo-task-do-paint-samples",
            "demo-task-send-freelance-mockup",
            "house-walkthrough",
            "clinic-checkin",
            "freelance-review",
            "home-refresh",
            "freelance-followup",
            "sam-rivera",
            "clinic-front-desk",
            "demo-message-house-repair",
            "demo-message-dinner-plan",
            "demo-message-freelance-followup",
            "demo-message-clinic-followup",
            "demo-meeting-home-refresh",
            "demo-meeting-trip-plan",
            "demo-meeting-freelance-followup",
            "demo-reminder-paint-samples",
            "demo-reminder-health-call",
            "demo-reminder-book-note",
            "demo-reminder-freelance-followup",
        ]
        placeholders = ",".join("?" for _ in graph_record_ids)
        link_params = tuple(graph_record_ids) + tuple(graph_record_ids)
        with self._lock:
            self._conn.execute(
                f"""
                DELETE FROM workspace_links
                WHERE source_kind = 'message'
                   OR target_kind = 'message'
                   OR link_id LIKE 'graph-%'
                   OR source_id IN ({placeholders})
                   OR target_id IN ({placeholders})
                """,
                link_params,
            )
            self._conn.execute(
                f"DELETE FROM workspace_records WHERE kind = 'message' OR record_id IN ({placeholders})",
                tuple(graph_record_ids),
            )
            self._conn.commit()
        for collection, records in default_workspace_graph_records(now_ms).items():
            for record in records:
                self.upsert_record(collection, record)
        for link in default_workspace_graph_links():
            self.upsert_link(link)
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("seeded_graph_v2", "1", now_ms),
            )
            self._conn.commit()

    def _reseed_graph_v3(self, now_ms: int) -> None:
        graph_record_ids = {
            "demo-task-do-paint-samples",
            "demo-task-send-freelance-mockup",
            "house-paint-notes",
            "freelance-homepage-note",
            "house-walkthrough",
            "freelance-review",
            "home-refresh",
            "freelance-followup",
            "maya",
            "sam-rivera",
        }
        with self._lock:
            self._conn.execute(
                """
                DELETE FROM workspace_links
                WHERE link_id IN (
                    'graph-task-home-contact',
                    'graph-task-home-calendar',
                    'graph-task-home-note',
                    'graph-task-home-project',
                    'graph-task-freelance-contact',
                    'graph-task-freelance-calendar',
                    'graph-task-freelance-note',
                    'graph-task-freelance-project'
                )
                """
            )
            self._conn.commit()
        defaults = default_workspace_graph_records(now_ms)
        for collection, records in defaults.items():
            for record in records:
                if str(record.get("id") or "") in graph_record_ids:
                    self.upsert_record(collection, record)
        for link in default_workspace_graph_links():
            if str(link.get("id") or "").startswith("graph-task-"):
                self.upsert_link(link)
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("seeded_graph_v3", "1", now_ms),
            )
            self._conn.commit()

    def _cleanup_proof_artifacts(self, now_ms: int) -> None:
        proof_like = "proof-%"
        with self._lock:
            self._conn.execute(
                """
                DELETE FROM workspace_links
                WHERE link_id LIKE ?
                   OR source_id LIKE ?
                   OR target_id LIKE ?
                """,
                (proof_like, proof_like, proof_like),
            )
            self._conn.execute(
                """
                DELETE FROM workspace_records
                WHERE record_id LIKE ?
                """,
                (proof_like,),
            )
            self._conn.execute(
                """
                DELETE FROM workspace_assets
                WHERE asset_id LIKE ?
                """,
                (proof_like,),
            )
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("proof_cleanup_v1", "1", now_ms),
            )
            self._conn.commit()

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
            metadata = _normalize_task_metadata(metadata, payload, summary=summary)
            status = normalize_task_status(status or metadata.get("status") or "todo")
        if kind == "reminder":
            status = status or "open"
            metadata = _normalize_reminder_metadata(metadata, status=status)
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
            record["status"] = normalize_task_status(record["status"])
            record["created_by"] = str(metadata.get("created_by") or metadata.get("owner") or "").strip()
            record["description"] = str(metadata.get("description") or record["summary"] or "").strip()
            record["checklist"] = _normalize_task_checklist(metadata.get("checklist"))
            record["derived_group"] = derive_task_group(record, self.now_ms())
        if row["kind"] == "note":
            record["content_updated_at_ms"] = self._note_content_updated_at_ms(record) or int(row["created_at_ms"] or 0) or int(row["updated_at_ms"] or 0)
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
                "title": "Front porch handyman window",
                "summary": "Home repair follow-up",
                "date": day,
                "start_at_ms": now_ms + 2 * 60 * 60 * 1000,
                "end_at_ms": now_ms + 3 * 60 * 60 * 1000,
                "html": "<!doctype html><h1>Front porch handyman window</h1><p>Walk the loose trim, porch light, and small patch list before the weekend.</p>",
                "metadata": {"place": "Home", "attendees": ["Lee"], "type": "personal"},
            },
            {
                "id": "vendor",
                "title": "Pediatric dentist follow-up",
                "summary": "Call to confirm the cleaning window",
                "date": day,
                "start_at_ms": now_ms + 6 * 60 * 60 * 1000,
                "end_at_ms": now_ms + 7 * 60 * 60 * 1000,
                "html": "<!doctype html><h1>Pediatric dentist follow-up</h1><p>Confirm the cleaning slot and write down the one insurance question to ask.</p>",
                "metadata": {"place": "Phone", "attendees": ["Front desk"], "type": "health"},
            },
            {
                "id": "design-overlap",
                "title": "Dinner ingredient run",
                "summary": "Quick overlap before pickup",
                "date": day,
                "start_at_ms": now_ms + 2 * 60 * 60 * 1000 + 15 * 60 * 1000,
                "end_at_ms": now_ms + 3 * 60 * 60 * 1000,
                "html": "<!doctype html><h1>Dinner ingredient run</h1><p>Small overlapping errand block so the day still proves stacked events cleanly.</p>",
                "metadata": {"place": "Market", "attendees": ["Maya Chen"], "type": "family"},
            },
            {
                "id": "tomorrow-demo",
                "title": "Katy soccer game",
                "summary": "Bring water and folding chairs",
                "date": tomorrow,
                "start_at_ms": tomorrow_ms + 2 * 60 * 60 * 1000,
                "end_at_ms": tomorrow_ms + 3 * 60 * 60 * 1000,
                "html": "<!doctype html><h1>Katy soccer game</h1><p>Keep the morning open enough to get there early and still grab coffee on the way.</p>",
                "metadata": {"place": "North field", "attendees": ["Katy"], "type": "family"},
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
    def event_slot(offset_days: int, hour: int, minute: int = 0, duration_minutes: int = 60) -> tuple[str, int, int]:
        target_ms = now_ms + offset_days * 24 * 60 * 60 * 1000
        target = time.localtime(target_ms / 1000)
        date_key = time.strftime("%Y-%m-%d", target)
        day_start_ms = target_ms - ((target.tm_hour * 60 * 60 + target.tm_min * 60 + target.tm_sec) * 1000)
        start_ms = day_start_ms + ((hour * 60 + minute) * 60 * 1000)
        return date_key, start_ms, start_ms + duration_minutes * 60 * 1000

    day, house_start_ms, house_end_ms = event_slot(0, 10, 0, 60)
    _, dinner_start_ms, dinner_end_ms = event_slot(0, 18, 30, 90)
    _, late_call_start_ms, late_call_end_ms = event_slot(0, 23, 30, 20)
    tomorrow, clinic_start_ms, clinic_end_ms = event_slot(1, 11, 0, 30)
    _, katy_start_ms, katy_end_ms = event_slot(1, 17, 15, 30)
    day_after, freelance_start_ms, freelance_end_ms = event_slot(2, 15, 0, 60)
    _, freelance_prep_start_ms, freelance_prep_end_ms = event_slot(2, 13, 30, 45)
    paint_reminder_due_ms = house_start_ms - 2 * 60 * 60 * 1000
    health_reminder_due_ms = clinic_start_ms - 2 * 60 * 60 * 1000
    freelance_reminder_due_ms = freelance_start_ms - 2 * 60 * 60 * 1000
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
            },
            {
                "id": "clinic-prep-note",
                "title": "Clinic prep note",
                "summary": "Questions to ask before the appointment and a short prep checklist.",
                "html": _personal_html(
                    "Clinic prep note",
                    "Keep the call short and make sure the appointment window is still right.",
                    ["Confirm arrival time", "Ask about prep instructions", "Write down what to bring"],
                ),
                "metadata": {"context": "Health appointment", "icon": "note"},
            },
            {
                "id": "freelance-homepage-note",
                "title": "Freelance homepage revision",
                "summary": "Small list of copy, layout, and invoice follow-ups for the next client pass.",
                "html": _personal_html(
                    "Freelance homepage revision",
                    "Capture the last homepage changes before the next client review.",
                    ["Tighten the headline", "Swap the proof image", "Pair the invoice note with the mockup"],
                ),
                "metadata": {"context": "Freelance follow-up", "icon": "note"},
            },
        ],
        "tasks": [
            {
                "id": "demo-task-do-paint-samples",
                "title": "Bring paint samples upstairs",
                "summary": "Set the samples near the window before Maya arrives.",
                "status": "open",
                "due_at_ms": now_ms + 3 * 60 * 60 * 1000,
                "checklist": [
                    {"id": "paint-stairs", "label": "Carry the swatches upstairs", "done": True},
                    {"id": "paint-trim", "label": "Tape each sample by the hallway trim", "done": False},
                    {"id": "paint-photo", "label": "Text Maya a quick photo before the walkthrough", "done": False},
                ],
                "html": _task_html(
                    "Bring paint samples upstairs",
                    "Put the sample cards where the light actually changes during the day.",
                    ["Carry the swatches upstairs", "Tape each one by the hallway trim", "Text Maya a picture before the walkthrough"],
                    "This task is linked from the meeting note, the reminder, and the Home refresh project.",
                ),
                "metadata": {"owner": "Maya Chen", "project": "Home refresh", "source": "demo-meeting-home-refresh"},
            },
                {
                "id": "demo-task-send-freelance-mockup",
                "title": "Send homepage pass to Sam",
                "summary": "Ship the revised HTML and the invoice note before the client review.",
                "status": "open",
                "due_at_ms": freelance_start_ms - 90 * 60 * 1000,
                "checklist": [],
                "html": _task_html(
                    "Send homepage pass to Sam",
                    "Package the latest HTML pass and the invoice note so the review stays calm and small.",
                    ["Export the latest mockup", "Attach the invoice note", "Send it before the review window"],
                    "This one keeps the freelance project, meeting note, and reminder tied together.",
                ),
                "metadata": {"owner": "Sam Rivera", "project": "Freelance follow-up", "source": "demo-meeting-freelance-followup"},
            },
        ],
        "calendar-events": [
            {
                "id": "house-walkthrough",
                "title": "Front porch repair window",
                "summary": "Walk the porch list, paint touch-ups, and the one loose handrail fix.",
                "date": day,
                "start_at_ms": house_start_ms,
                "end_at_ms": house_end_ms,
                "html": _personal_html(
                    "Front porch repair window",
                    "A practical home window for the porch list, touch-up paint, and the one repair that still needs a decision.",
                    ["Check the porch rail", "Look at the touch-up paint together", "Turn the final decision into one task"],
                ),
                "metadata": {"place": "Home", "attendees": ["Maya Chen"], "type": "home"},
            },
            {
                "id": "clinic-checkin",
                "title": "Clinic paperwork check-in",
                "summary": "Short appointment block to confirm forms, timing, and the follow-up questions.",
                "date": tomorrow,
                "start_at_ms": clinic_start_ms,
                "end_at_ms": clinic_end_ms,
                "html": _personal_html(
                    "Clinic paperwork check-in",
                    "Keep the appointment block simple and make sure the forms and prep questions are settled before the visit.",
                    ["Confirm the paperwork is in", "Bring the question list", "Turn any follow-up into a note"],
                ),
                "metadata": {"place": "Westside Clinic", "attendees": ["Clinic front desk"], "type": "health"},
            },
            {
                "id": "freelance-review",
                "title": "Freelance review call",
                "summary": "Kitchen table client call for the homepage pass and the last invoice cleanup.",
                "date": day_after,
                "start_at_ms": freelance_start_ms,
                "end_at_ms": freelance_end_ms,
                "html": _personal_html(
                    "Freelance review call",
                    "Keep the review focused on the homepage pass, the last invoice detail, and the next edit round.",
                    ["Walk through the new HTML", "Confirm the next edit round", "Close the invoice question"],
                ),
                "metadata": {"place": "Kitchen table", "attendees": ["Sam Rivera"], "type": "freelance"},
            },
            {
                "id": "forster-dinner",
                "title": "Dinner with the Forsters",
                "summary": "Simple family dinner and a quick summer-plan catch-up.",
                "date": day,
                "start_at_ms": dinner_start_ms,
                "end_at_ms": dinner_end_ms,
                "html": _personal_html(
                    "Dinner with the Forsters",
                    "Keep dinner easy, catch up on the summer schedule, and do not over-plan it.",
                    ["Bring dessert", "Talk through the July weekend", "Leave with one simple next step"],
                ),
                "metadata": {"place": "Forster house", "attendees": ["Jeff Bennett"], "type": "family"},
            },
            {
                "id": "katy-handoff",
                "title": "Katy pickup handoff",
                "summary": "School pickup switch so the evening stays simple.",
                "date": tomorrow,
                "start_at_ms": katy_start_ms,
                "end_at_ms": katy_end_ms,
                "html": _personal_html(
                    "Katy pickup handoff",
                    "A small family logistics block for the pickup handoff and the evening plan.",
                    ["Text when you leave", "Confirm the pickup gate", "Bring the extra water bottle"],
                ),
                "metadata": {"place": "North field gate", "attendees": ["Katy"], "type": "family"},
            },
            {
                "id": "late-night-design-call",
                "title": "Late-night design QA call",
                "summary": "Timezone-edge check before sending the morning follow-up.",
                "date": day,
                "start_at_ms": late_call_start_ms,
                "end_at_ms": late_call_end_ms,
                "html": _personal_html(
                    "Late-night design QA call",
                    "A short late-night call that is useful for timezone testing and one last design check.",
                    ["Confirm the final QA pass", "Write the morning follow-up note", "Do not let it sprawl"],
                ),
                "metadata": {"place": "Phone", "attendees": ["Sam Rivera"], "type": "call"},
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
            },
            {
                "id": "freelance-followup",
                "title": "Freelance follow-up",
                "summary": "Homepage revision, invoice timing, and the next review window.",
                "html": _personal_html(
                    "Freelance follow-up",
                    "Keep the homepage revision, invoice question, and next review pass together in one small project shell.",
                    ["Homepage pass", "Invoice note", "Next review"],
                ),
                "metadata": {"threads": ["Homepage revision", "Invoice note"], "chips": ["Freelance", "2 follow-ups"]},
            },
        ],
        "contacts": [
            {
                "id": "sam-rivera",
                "title": "Sam Rivera",
                "summary": "Freelance client",
                "html": _personal_html(
                    "Sam Rivera",
                    "Client contact for the homepage revision and invoice follow-up.",
                    ["Homepage revision", "Invoice timing", "Review call"],
                ),
                "metadata": {
                    "first_name": "Sam",
                    "last_name": "Rivera",
                    "avatar": "SR",
                    "email": "sam.rivera@example.com",
                    "phone": "+1 (415) 555-0168",
                    "endpoints": [{"label": "Email", "value": "sam.rivera@example.com"}],
                    "activity": ["Email - asked for the revised homepage pass", "Calendar - review call in two days"],
                },
            },
            {
                "id": "clinic-front-desk",
                "title": "Clinic front desk",
                "summary": "Call to confirm the appointment window and prep notes.",
                "html": _personal_html(
                    "Clinic front desk",
                    "Short contact card for appointment timing and prep questions.",
                    ["Confirm the time", "Ask about prep", "Write down follow-up instructions"],
                ),
                "metadata": {
                    "avatar": "CF",
                    "email": "frontdesk@clinic.example.com",
                    "phone": "+1 (415) 555-0133",
                    "endpoints": [{"label": "Phone", "value": "+1 (415) 555-0133"}],
                    "activity": ["Call - confirm the appointment time", "Reminder - check prep instructions"],
                },
            },
        ],
        "meeting-notes": [
            {
                "id": "demo-meeting-home-refresh",
                "title": "Home refresh walkthrough",
                "summary": "Meeting-style note for paint, repairs, and follow-up tasks.",
                "date": day,
                "start_at_ms": house_start_ms,
                "end_at_ms": house_end_ms,
                "html": _personal_html(
                    "Home refresh walkthrough",
                    "Graph meeting note that links a calendar block, attendee, project, note, task, and reminder.",
                    ["Compare paint samples", "Confirm contractor question", "Turn final decisions into weekend tasks"],
                ),
                "metadata": {"participants": ["Maya Chen"], "source": "house-walkthrough", "source_kind": "calendar_event", "source_id": "house-walkthrough", "extracted_topics": ["paint", "repair", "home refresh"]},
            },
            {
                "id": "demo-meeting-freelance-followup",
                "title": "Freelance review prep",
                "summary": "Small planning note for the homepage pass and invoice follow-up before the client review.",
                "date": day_after,
                "start_at_ms": freelance_prep_start_ms,
                "end_at_ms": freelance_prep_end_ms,
                "html": _personal_html(
                    "Freelance review prep",
                    "Keep the review call practical: ship the revised HTML, answer the invoice question, and leave with one clear next step.",
                    ["Send the revised HTML", "Answer the invoice question", "Agree on the next edit round"],
                ),
                "metadata": {"participants": ["Sam Rivera"], "source": "freelance-review", "source_kind": "calendar_event", "source_id": "freelance-review", "extracted_topics": ["freelance", "homepage", "invoice"]},
            },
        ],
        "reminders": [
            {
                "id": "demo-reminder-paint-samples",
                "title": "Bring paint samples upstairs",
                "summary": "Nudge before the home refresh walkthrough.",
                "status": "open",
                "due_at_ms": paint_reminder_due_ms,
                "html": _personal_html(
                    "Bring paint samples upstairs",
                    "Reminder attached to the paint task and meeting note.",
                    ["Bring swatches upstairs", "Photograph each option", "Have them ready before Maya arrives"],
                ),
                "metadata": {
                    "source_kind": "task",
                    "source_id": "demo-task-do-paint-samples",
                    "snooze_state": "ready",
                    "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
                    "destinations": [{"channel": "phone_notification", "recipient_ids": ["self"]}],
                },
            },
            {
                "id": "demo-reminder-health-call",
                "title": "Call clinic before lunch",
                "summary": "Confirm the appointment window and ask the prep questions.",
                "status": "open",
                "due_at_ms": health_reminder_due_ms,
                "html": _personal_html(
                    "Call clinic before lunch",
                    "A simple health reminder that links directly to the appointment block and prep note.",
                    ["Ask about appointment slot", "Write down prep instructions", "Add calendar block if confirmed"],
                ),
                "metadata": {
                    "source_kind": "calendar_event",
                    "source_id": "clinic-checkin",
                    "snooze_state": "ready",
                    "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
                    "destinations": [{"channel": "phone_notification", "recipient_ids": ["self"]}],
                },
            },
            {
                "id": "demo-reminder-book-note",
                "title": "Review clinic prep note tonight",
                "summary": "Skim the prep note and keep the front-desk number handy before tomorrow.",
                "status": "open",
                "due_at_ms": clinic_start_ms - 15 * 60 * 60 * 1000,
                "html": _personal_html(
                    "Review clinic prep note tonight",
                    "One quiet reminder tied to the clinic prep note so the next morning starts cleanly.",
                    ["Open the prep note", "Check the front-desk number", "Leave one quick question at the top"],
                ),
                "metadata": {
                    "source_kind": "note",
                    "source_id": "clinic-prep-note",
                    "snooze_state": "ready",
                    "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
                    "destinations": [{"channel": "phone_notification", "recipient_ids": ["self"]}],
                },
            },
            {
                "id": "demo-reminder-freelance-followup",
                "title": "Send homepage pass before review",
                "summary": "Get the revised HTML and invoice note out before the client review window.",
                "status": "open",
                "due_at_ms": freelance_reminder_due_ms,
                "html": _personal_html(
                    "Send homepage pass before review",
                    "Small reminder that keeps the freelance task and meeting note in sync.",
                    ["Export the latest HTML", "Attach the invoice note", "Send it before the review starts"],
                ),
                "metadata": {
                    "source_kind": "task",
                    "source_id": "demo-task-send-freelance-mockup",
                    "snooze_state": "ready",
                    "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
                    "destinations": [{"channel": "phone_notification", "recipient_ids": ["self"]}],
                },
            },
        ],
    }


def default_workspace_graph_links() -> list[dict[str, object]]:
    return [
        {"id": "graph-meeting-home-contact", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "contact", "target_id": "maya", "label": "Maya Chen"},
        {"id": "graph-meeting-home-calendar", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "calendar_event", "target_id": "house-walkthrough", "label": "Home refresh walkthrough"},
        {"id": "graph-meeting-home-note", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "note", "target_id": "house-paint-notes", "label": "House paint notes"},
        {"id": "graph-meeting-home-task", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "task", "target_id": "demo-task-do-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-meeting-home-project", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "project", "target_id": "home-refresh", "label": "Home refresh"},
        {"id": "graph-meeting-home-reminder", "source_kind": "meeting_note", "source_id": "demo-meeting-home-refresh", "target_kind": "reminder", "target_id": "demo-reminder-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-project-home-contact", "source_kind": "project", "source_id": "home-refresh", "target_kind": "contact", "target_id": "maya", "label": "Maya Chen"},
        {"id": "graph-project-home-calendar", "source_kind": "project", "source_id": "home-refresh", "target_kind": "calendar_event", "target_id": "house-walkthrough", "label": "Home refresh walkthrough"},
        {"id": "graph-project-home-meeting", "source_kind": "project", "source_id": "home-refresh", "target_kind": "meeting_note", "target_id": "demo-meeting-home-refresh", "label": "Home refresh walkthrough"},
        {"id": "graph-project-home-note", "source_kind": "project", "source_id": "home-refresh", "target_kind": "note", "target_id": "house-paint-notes", "label": "House paint notes"},
        {"id": "graph-project-home-task", "source_kind": "project", "source_id": "home-refresh", "target_kind": "task", "target_id": "demo-task-do-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-project-home-reminder", "source_kind": "project", "source_id": "home-refresh", "target_kind": "reminder", "target_id": "demo-reminder-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-task-home-contact", "source_kind": "task", "source_id": "demo-task-do-paint-samples", "target_kind": "contact", "target_id": "maya", "label": "Maya Chen"},
        {"id": "graph-task-home-calendar", "source_kind": "task", "source_id": "demo-task-do-paint-samples", "target_kind": "calendar_event", "target_id": "house-walkthrough", "label": "Home refresh walkthrough"},
        {"id": "graph-task-home-note", "source_kind": "task", "source_id": "demo-task-do-paint-samples", "target_kind": "note", "target_id": "house-paint-notes", "label": "House paint notes"},
        {"id": "graph-task-home-project", "source_kind": "task", "source_id": "demo-task-do-paint-samples", "target_kind": "project", "target_id": "home-refresh", "label": "Home refresh"},
        {"id": "graph-reminder-paint-task", "source_kind": "reminder", "source_id": "demo-reminder-paint-samples", "target_kind": "task", "target_id": "demo-task-do-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-reminder-paint-meeting", "source_kind": "reminder", "source_id": "demo-reminder-paint-samples", "target_kind": "meeting_note", "target_id": "demo-meeting-home-refresh", "label": "Home refresh walkthrough"},
        {"id": "graph-reminder-health-contact", "source_kind": "reminder", "source_id": "demo-reminder-health-call", "target_kind": "contact", "target_id": "clinic-front-desk", "label": "Clinic front desk"},
        {"id": "graph-reminder-health-calendar", "source_kind": "reminder", "source_id": "demo-reminder-health-call", "target_kind": "calendar_event", "target_id": "clinic-checkin", "label": "Clinic check-in"},
        {"id": "graph-reminder-health-note", "source_kind": "reminder", "source_id": "demo-reminder-health-call", "target_kind": "note", "target_id": "clinic-prep-note", "label": "Clinic prep note"},
        {"id": "graph-note-clinic-reminder", "source_kind": "note", "source_id": "clinic-prep-note", "target_kind": "reminder", "target_id": "demo-reminder-book-note", "label": "Review clinic prep note tonight"},
        {"id": "graph-reminder-note-note", "source_kind": "reminder", "source_id": "demo-reminder-book-note", "target_kind": "note", "target_id": "clinic-prep-note", "label": "Clinic prep note"},
        {"id": "graph-reminder-note-feed", "source_kind": "reminder", "source_id": "demo-reminder-book-note", "target_kind": "feed_item", "target_id": "calendar-change", "label": "Roadmap sync moved"},
        {"id": "graph-feed-note-reminder", "source_kind": "feed_item", "source_id": "calendar-change", "target_kind": "reminder", "target_id": "demo-reminder-book-note", "label": "Review clinic prep note tonight"},
        {"id": "graph-calendar-home-contact", "source_kind": "calendar_event", "source_id": "house-walkthrough", "target_kind": "contact", "target_id": "maya", "label": "Maya Chen"},
        {"id": "graph-calendar-home-note", "source_kind": "calendar_event", "source_id": "house-walkthrough", "target_kind": "note", "target_id": "house-paint-notes", "label": "House paint notes"},
        {"id": "graph-calendar-home-task", "source_kind": "calendar_event", "source_id": "house-walkthrough", "target_kind": "task", "target_id": "demo-task-do-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-calendar-home-project", "source_kind": "calendar_event", "source_id": "house-walkthrough", "target_kind": "project", "target_id": "home-refresh", "label": "Home refresh"},
        {"id": "graph-calendar-home-meeting", "source_kind": "calendar_event", "source_id": "house-walkthrough", "target_kind": "meeting_note", "target_id": "demo-meeting-home-refresh", "label": "Home refresh walkthrough"},
        {"id": "graph-calendar-home-reminder", "source_kind": "calendar_event", "source_id": "house-walkthrough", "target_kind": "reminder", "target_id": "demo-reminder-paint-samples", "label": "Bring paint samples upstairs"},
        {"id": "graph-calendar-health-contact", "source_kind": "calendar_event", "source_id": "clinic-checkin", "target_kind": "contact", "target_id": "clinic-front-desk", "label": "Clinic front desk"},
        {"id": "graph-calendar-health-note", "source_kind": "calendar_event", "source_id": "clinic-checkin", "target_kind": "note", "target_id": "clinic-prep-note", "label": "Clinic prep note"},
        {"id": "graph-calendar-health-reminder", "source_kind": "calendar_event", "source_id": "clinic-checkin", "target_kind": "reminder", "target_id": "demo-reminder-health-call", "label": "Call clinic before lunch"},
        {"id": "graph-meeting-freelance-contact", "source_kind": "meeting_note", "source_id": "demo-meeting-freelance-followup", "target_kind": "contact", "target_id": "sam-rivera", "label": "Sam Rivera"},
        {"id": "graph-meeting-freelance-calendar", "source_kind": "meeting_note", "source_id": "demo-meeting-freelance-followup", "target_kind": "calendar_event", "target_id": "freelance-review", "label": "Freelance review call"},
        {"id": "graph-meeting-freelance-note", "source_kind": "meeting_note", "source_id": "demo-meeting-freelance-followup", "target_kind": "note", "target_id": "freelance-homepage-note", "label": "Freelance homepage revision"},
        {"id": "graph-meeting-freelance-task", "source_kind": "meeting_note", "source_id": "demo-meeting-freelance-followup", "target_kind": "task", "target_id": "demo-task-send-freelance-mockup", "label": "Send homepage pass to Sam"},
        {"id": "graph-meeting-freelance-project", "source_kind": "meeting_note", "source_id": "demo-meeting-freelance-followup", "target_kind": "project", "target_id": "freelance-followup", "label": "Freelance follow-up"},
        {"id": "graph-meeting-freelance-reminder", "source_kind": "meeting_note", "source_id": "demo-meeting-freelance-followup", "target_kind": "reminder", "target_id": "demo-reminder-freelance-followup", "label": "Send homepage pass before review"},
        {"id": "graph-calendar-freelance-contact", "source_kind": "calendar_event", "source_id": "freelance-review", "target_kind": "contact", "target_id": "sam-rivera", "label": "Sam Rivera"},
        {"id": "graph-calendar-freelance-note", "source_kind": "calendar_event", "source_id": "freelance-review", "target_kind": "note", "target_id": "freelance-homepage-note", "label": "Freelance homepage revision"},
        {"id": "graph-calendar-freelance-task", "source_kind": "calendar_event", "source_id": "freelance-review", "target_kind": "task", "target_id": "demo-task-send-freelance-mockup", "label": "Send homepage pass to Sam"},
        {"id": "graph-calendar-freelance-project", "source_kind": "calendar_event", "source_id": "freelance-review", "target_kind": "project", "target_id": "freelance-followup", "label": "Freelance follow-up"},
        {"id": "graph-calendar-freelance-meeting", "source_kind": "calendar_event", "source_id": "freelance-review", "target_kind": "meeting_note", "target_id": "demo-meeting-freelance-followup", "label": "Freelance review prep"},
        {"id": "graph-calendar-freelance-reminder", "source_kind": "calendar_event", "source_id": "freelance-review", "target_kind": "reminder", "target_id": "demo-reminder-freelance-followup", "label": "Send homepage pass before review"},
        {"id": "graph-project-freelance-contact", "source_kind": "project", "source_id": "freelance-followup", "target_kind": "contact", "target_id": "sam-rivera", "label": "Sam Rivera"},
        {"id": "graph-project-freelance-calendar", "source_kind": "project", "source_id": "freelance-followup", "target_kind": "calendar_event", "target_id": "freelance-review", "label": "Freelance review call"},
        {"id": "graph-project-freelance-meeting", "source_kind": "project", "source_id": "freelance-followup", "target_kind": "meeting_note", "target_id": "demo-meeting-freelance-followup", "label": "Freelance review prep"},
        {"id": "graph-project-freelance-note", "source_kind": "project", "source_id": "freelance-followup", "target_kind": "note", "target_id": "freelance-homepage-note", "label": "Freelance homepage revision"},
        {"id": "graph-project-freelance-task", "source_kind": "project", "source_id": "freelance-followup", "target_kind": "task", "target_id": "demo-task-send-freelance-mockup", "label": "Send homepage pass to Sam"},
        {"id": "graph-project-freelance-reminder", "source_kind": "project", "source_id": "freelance-followup", "target_kind": "reminder", "target_id": "demo-reminder-freelance-followup", "label": "Send homepage pass before review"},
        {"id": "graph-task-freelance-contact", "source_kind": "task", "source_id": "demo-task-send-freelance-mockup", "target_kind": "contact", "target_id": "sam-rivera", "label": "Sam Rivera"},
        {"id": "graph-task-freelance-calendar", "source_kind": "task", "source_id": "demo-task-send-freelance-mockup", "target_kind": "calendar_event", "target_id": "freelance-review", "label": "Freelance review call"},
        {"id": "graph-task-freelance-note", "source_kind": "task", "source_id": "demo-task-send-freelance-mockup", "target_kind": "note", "target_id": "freelance-homepage-note", "label": "Freelance homepage revision"},
        {"id": "graph-task-freelance-project", "source_kind": "task", "source_id": "demo-task-send-freelance-mockup", "target_kind": "project", "target_id": "freelance-followup", "label": "Freelance follow-up"},
        {"id": "graph-reminder-freelance-task", "source_kind": "reminder", "source_id": "demo-reminder-freelance-followup", "target_kind": "task", "target_id": "demo-task-send-freelance-mockup", "label": "Send homepage pass to Sam"},
        {"id": "graph-reminder-freelance-meeting", "source_kind": "reminder", "source_id": "demo-reminder-freelance-followup", "target_kind": "meeting_note", "target_id": "demo-meeting-freelance-followup", "label": "Freelance review prep"},
    ]
