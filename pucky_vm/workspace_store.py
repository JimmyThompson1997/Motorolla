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
SELF_CONTACT_ID = "contact-me"
SELF_CONTACT_TITLE = "Me"
SELF_CONTACT_SUMMARY = "Personal reminder delivery profile"
JIMMY_THOMPSON_CONTACT_ID = "jimmy-thompson"
CONTACT_EMAIL_ENDPOINT_LABELS = ("email", "gmail", "mail")
CONTACT_PHONE_ENDPOINT_LABELS = ("phone", "sms", "text", "mobile", "call")
CONTACT_PHOTO_FIXTURES = (
    "fixtures/contact_photos/maya.webp",
    "fixtures/contact_photos/sam.webp",
    "fixtures/contact_photos/eric.webp",
    "fixtures/contact_photos/jimmy.jpg",
    "fixtures/contact_photos/proof-contact.webp",
)
CONTACT_PHOTO_BY_ID = {
    "maya": "fixtures/contact_photos/maya.webp",
    "sam-rivera": "fixtures/contact_photos/sam.webp",
    "eric-donaldson": "fixtures/contact_photos/eric.webp",
    JIMMY_THOMPSON_CONTACT_ID: "fixtures/contact_photos/jimmy.jpg",
}


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


def _decode_asset_text(mime_type: object, content_base64: object) -> str:
    mime = str(mime_type or "").lower()
    if not (mime.startswith("text/") or "html" in mime):
        return ""
    try:
        return base64.b64decode(str(content_base64 or "")).decode("utf-8", errors="replace")
    except Exception:
        return ""


def _workspace_kind_label(kind: object) -> str:
    return {
        "note": "Note",
        "task": "Task",
        "calendar_event": "Calendar",
        "feed_item": "Inbox",
        "project": "Project",
        "contact": "Contact",
        "meeting_note": "Meeting note",
        "reminder": "Reminder",
    }.get(str(kind or "").strip(), "Record")


def _linked_note_record_id(source_kind: object, source_id: object) -> str:
    return _clean_id(f"linked-note-{str(source_kind or '').strip()}-{str(source_id or '').strip()}", "note")


def _linked_note_link_id(source_kind: object, source_id: object) -> str:
    return _clean_id(f"linked-note-link-{str(source_kind or '').strip()}-{str(source_id or '').strip()}", "link")


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


def _self_contact_record() -> dict[str, object]:
    return {
        "id": SELF_CONTACT_ID,
        "title": SELF_CONTACT_TITLE,
        "summary": SELF_CONTACT_SUMMARY,
        "pinned": True,
        "html": _personal_html(
            SELF_CONTACT_TITLE,
            "Keep your own reminder delivery email and phone current so Gmail and SMS can route cleanly.",
            ["Primary email", "Primary phone", "Preferred reminder device"],
        ),
        "metadata": {
            "is_self": True,
            "avatar": "ME",
            "email": "",
            "phone": "",
            "notification_device_id": "",
            "preferred_reminder_device_id": "",
            "activity": ["Reminder delivery profile"],
        },
    }


def _jimmy_thompson_contact_record() -> dict[str, object]:
    return {
        "id": JIMMY_THOMPSON_CONTACT_ID,
        "title": "Jimmy Thompson",
        "summary": "Personal contact",
        "metadata": {
            "first_name": "Jimmy",
            "last_name": "Thompson",
            "avatar": "JT",
            "photo": CONTACT_PHOTO_BY_ID[JIMMY_THOMPSON_CONTACT_ID],
            "email": "jimmythompson323@gmail.com",
            "phone": "4074969882",
            "activity": ["Contact added manually"],
        },
    }


def _contact_endpoint_value(metadata: dict[str, Any], labels: tuple[str, ...]) -> str:
    endpoints = list(metadata.get("endpoints") or []) if isinstance(metadata.get("endpoints"), list) else []
    for endpoint in endpoints:
        if not isinstance(endpoint, dict):
            continue
        label = str(endpoint.get("label") or endpoint.get("type") or "").strip().lower()
        if not label:
            continue
        if any(term in label for term in labels):
            value = str(endpoint.get("value") or endpoint.get("address") or endpoint.get("number") or "").strip()
            if value:
                return value
    return ""


def _contact_metadata_without_endpoints(metadata: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(metadata or {})
    cleaned.pop("endpoints", None)
    return cleaned


def _is_contact_fixture_bitmap_photo(value: object) -> bool:
    photo = str(value or "").strip()
    return photo.startswith("fixtures/contact_photos/") and photo.lower().endswith((".jpg", ".jpeg", ".webp"))


def _contact_fixture_photo(record_id: str, title: str = "") -> str:
    clean_id = str(record_id or "").strip()
    if clean_id in CONTACT_PHOTO_BY_ID:
        return CONTACT_PHOTO_BY_ID[clean_id]
    key = f"{clean_id}:{title}".strip(":") or "contact"
    index = sum(ord(char) for char in key) % len(CONTACT_PHOTO_FIXTURES)
    return CONTACT_PHOTO_FIXTURES[index]


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
    normalized.pop("snooze_state", None)
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
    normalized.pop("project", None)
    normalized.pop("source", None)
    owner = str(
        payload.get("owner")
        or normalized.get("owner")
        or ""
    ).strip()
    created_by = str(
        payload.get("created_by")
        or normalized.get("created_by")
        or owner
        or ""
    ).strip()
    if created_by:
        normalized["created_by"] = created_by
    if owner:
        normalized["owner"] = owner
    description = str(payload.get("description") or normalized.get("description") or summary or "").strip()
    if description:
        normalized["description"] = description
    checklist = payload.get("checklist") if "checklist" in payload else normalized.get("checklist")
    normalized["checklist"] = _normalize_task_checklist(checklist)
    normalized["status"] = normalize_task_status(payload.get("status") or normalized.get("status") or "")
    return normalized


def _normalize_meeting_note_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(metadata or {})
    source = str(normalized.get("source") or "").strip()
    if source and not str(normalized.get("source_id") or "").strip():
        normalized["source_id"] = source
    normalized.pop("source", None)
    return normalized


def _normalize_note_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(metadata or {})
    normalized.pop("icon", None)
    return normalized


def _normalize_project_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(metadata or {})
    normalized.pop("assets", None)
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
            order = f"ORDER BY record_id = '{SELF_CONTACT_ID}' DESC, title COLLATE NOCASE ASC"
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
        if kind == "contact":
            metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
            if record_id == SELF_CONTACT_ID or bool(metadata.get("is_self")):
                record_id = SELF_CONTACT_ID
        existing_record = self.get_record(collection, record_id, include_deleted=True)
        normalized = self._normalize_record(kind, record_id, payload, now_ms=now)
        if kind == "task":
            self._apply_task_completion_timestamp(normalized, existing_record, payload, now_ms=now)
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
        if self.kind_for_collection(collection) == "contact" and str(record_id or "").strip() == SELF_CONTACT_ID:
            merged["id"] = SELF_CONTACT_ID
            merged["record_id"] = SELF_CONTACT_ID
            merged["title"] = str(merged.get("title") or current.get("title") or SELF_CONTACT_TITLE).strip() or SELF_CONTACT_TITLE
            merged["summary"] = str(merged.get("summary") or SELF_CONTACT_SUMMARY).strip() or SELF_CONTACT_SUMMARY
            merged["pinned"] = True
            merged["archived"] = False
            merged["deleted"] = False
            merged["metadata"] = {
                **metadata,
                "is_self": True,
            }
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

    @staticmethod
    def _task_completed_at_ms(record: dict[str, object] | None) -> int:
        if not isinstance(record, dict):
            return 0
        metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
        value = _int_or_zero(metadata.get("completed_at_ms")) if isinstance(metadata, dict) else 0
        if value > 0:
            return value
        return _int_or_zero(record.get("completed_at_ms"))

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

    @classmethod
    def _apply_task_completion_timestamp(
        cls,
        record: dict[str, object],
        current: dict[str, object] | None,
        payload: dict[str, object],
        *,
        now_ms: int,
    ) -> None:
        metadata = dict(record.get("metadata") or {})
        metadata.pop("completed_at_ms", None)
        record.pop("completed_at_ms", None)
        status = normalize_task_status(record.get("status"))
        if status != "done":
            record["metadata"] = metadata
            return
        previous_status = normalize_task_status(current.get("status")) if isinstance(current, dict) else ""
        previous_completed = cls._task_completed_at_ms(current)
        if current is None:
            resolved = _int_or_zero(payload.get("created_at_ms")) or now_ms
        elif previous_status == "done":
            resolved = previous_completed
        else:
            resolved = now_ms
        if resolved > 0:
            metadata["completed_at_ms"] = resolved
            record["completed_at_ms"] = resolved
        record["metadata"] = metadata

    def delete_record(self, collection: str, record_id: str) -> dict[str, object] | None:
        existing = self.get_record(collection, record_id, include_deleted=True)
        if existing is None:
            return None
        if self.kind_for_collection(collection) == "contact" and str(record_id or "").strip() == SELF_CONTACT_ID:
            return self.patch_record(collection, record_id, {})
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
        text = _decode_asset_text(row["mime_type"], content_base64)
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
            task_sweep_seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'seeded_task_sweep_v1'").fetchone()
            proof_cleanup_seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'proof_cleanup_v1'").fetchone()
            task_proof_cleanup_seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'task_proof_cleanup_v1'").fetchone()
            contact_endpoints_removed = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'contact_endpoints_removed_v1'").fetchone()
            contact_html_removed = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'contact_html_removed_v1'").fetchone()
            contact_cleanup_photos = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'contact_cleanup_photos_v1'").fetchone()
            contact_jimmy_thompson = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'contact_jimmy_thompson_v1'").fetchone()
            contact_jimmy_photo = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'contact_jimmy_photo_fixture_v1'").fetchone()
            notes_only_html_seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'workspace_notes_only_html_v1'").fetchone()
            metadata_cleanup_seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'workspace_metadata_cleanup_v1'").fetchone()
            demo_time_refresh_seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'seeded_demo_time_refresh_v1'").fetchone()
            graph_content_refresh_seeded = self._conn.execute("SELECT value FROM workspace_meta WHERE key = 'seeded_graph_content_refresh_v1'").fetchone()
        now = self.now_ms()
        newly_seeded = not seeded
        if not seeded:
            defaults, default_links = seeded_workspace_snapshot(
                default_workspace_records(now),
                default_workspace_links(),
                default_workspace_assets(now),
            )
            for collection, records in defaults.items():
                for record in records:
                    self.upsert_record(collection, record)
            for link in default_links:
                self.upsert_link(link)
            with self._lock:
                self._conn.execute(
                    "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                    ("seeded_v1", "1", now),
                )
                self._conn.commit()
        if not graph_seeded:
            graph_defaults, graph_links = seeded_workspace_snapshot(
                default_workspace_graph_records(now),
                default_workspace_graph_links(),
            )
            for collection, records in graph_defaults.items():
                for record in records:
                    self.upsert_record(collection, record)
            for link in graph_links:
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
        if not task_sweep_seeded:
            self._refresh_seeded_task_sweep_v1(now)
        if not proof_cleanup_seeded:
            self._cleanup_proof_artifacts(now)
        if not task_proof_cleanup_seeded:
            self._cleanup_task_proof_artifacts_v1(now)
        if not contact_endpoints_removed:
            self._remove_contact_endpoints_v1(now)
        if not contact_html_removed:
            if newly_seeded:
                self._mark_workspace_meta("contact_html_removed_v1", now)
            else:
                self._remove_contact_html_v1(now)
        if not contact_cleanup_photos:
            if newly_seeded:
                self._cleanup_contacts_and_photos_v1(now, remove_links=False)
            else:
                self._cleanup_contacts_and_photos_v1(now)
        if not notes_only_html_seeded:
            self._migrate_notes_only_html_v1(now)
        if not metadata_cleanup_seeded:
            self._cleanup_workspace_metadata_v1(now)
        if not contact_jimmy_thompson:
            self._seed_jimmy_thompson_contact_v1(now)
        if not contact_jimmy_photo:
            self._refresh_jimmy_thompson_photo_v1(now)
        if not demo_time_refresh_seeded:
            self._refresh_seeded_demo_time_v1(now)
        if not graph_content_refresh_seeded:
            self._refresh_seeded_graph_content_v1(now)
        self.ensure_self_contact()

    def ensure_self_contact(self) -> dict[str, object]:
        current = self.get_record("contacts", SELF_CONTACT_ID, include_deleted=True)
        if current is None:
            return self.upsert_record("contacts", _self_contact_record())
        metadata = _contact_metadata_without_endpoints(current.get("metadata") if isinstance(current.get("metadata"), dict) else {})
        metadata.pop("html", None)
        metadata.pop("html_asset_id", None)
        payload = {
            "id": SELF_CONTACT_ID,
            "title": str(current.get("title") or SELF_CONTACT_TITLE).strip() or SELF_CONTACT_TITLE,
            "summary": str(current.get("summary") or SELF_CONTACT_SUMMARY).strip() or SELF_CONTACT_SUMMARY,
            "pinned": True,
            "archived": False,
            "deleted": False,
            "html": str(current.get("html") or "") or _self_contact_record()["html"],
            "html_asset_id": str(current.get("html_asset_id") or ""),
            "metadata": {
                **metadata,
                "is_self": True,
                "avatar": str(metadata.get("avatar") or "ME").strip() or "ME",
                "email": str(metadata.get("email") or "").strip(),
                "phone": str(metadata.get("phone") or "").strip(),
                "notification_device_id": str(metadata.get("notification_device_id") or "").strip(),
                "preferred_reminder_device_id": str(metadata.get("preferred_reminder_device_id") or "").strip(),
                "activity": list(metadata.get("activity") or []) if isinstance(metadata.get("activity"), list) else ["Reminder delivery profile"],
            },
        }
        return self.upsert_record("contacts", payload)

    def _mark_workspace_meta(self, key: str, now_ms: int) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                (key, "1", now_ms),
            )
            self._conn.commit()

    def _remove_contact_endpoints_v1(self, now_ms: int) -> None:
        with self._lock:
            rows = self._conn.execute("SELECT record_id, metadata_json FROM workspace_records WHERE kind = 'contact'").fetchall()
            for row in rows:
                metadata = _json_loads(row["metadata_json"], {})
                if not isinstance(metadata, dict) or "endpoints" not in metadata:
                    continue
                next_metadata = dict(metadata)
                if not str(next_metadata.get("email") or "").strip():
                    email = _contact_endpoint_value(next_metadata, CONTACT_EMAIL_ENDPOINT_LABELS)
                    if email:
                        next_metadata["email"] = email
                if not str(next_metadata.get("phone") or "").strip():
                    phone = _contact_endpoint_value(next_metadata, CONTACT_PHONE_ENDPOINT_LABELS)
                    if phone:
                        next_metadata["phone"] = phone
                next_metadata.pop("endpoints", None)
                self._conn.execute(
                    """
                    UPDATE workspace_records
                    SET metadata_json = ?, updated_at_ms = ?
                    WHERE kind = 'contact' AND record_id = ?
                    """,
                    (_json_dumps(next_metadata), now_ms, row["record_id"]),
                )
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("contact_endpoints_removed_v1", "1", now_ms),
            )
            self._conn.commit()

    def _remove_contact_html_v1(self, now_ms: int) -> None:
        with self._lock:
            rows = self._conn.execute(
                "SELECT record_id, metadata_json FROM workspace_records WHERE kind = 'contact'"
            ).fetchall()
            for row in rows:
                metadata = _json_loads(row["metadata_json"], {})
                next_metadata = dict(metadata) if isinstance(metadata, dict) else {}
                next_metadata.pop("html", None)
                next_metadata.pop("html_asset_id", None)
                self._conn.execute(
                    """
                    UPDATE workspace_records
                    SET html = '',
                        html_asset_id = '',
                        metadata_json = ?,
                        updated_at_ms = ?
                    WHERE kind = 'contact'
                      AND record_id = ?
                    """,
                    (_json_dumps(next_metadata), now_ms, row["record_id"]),
                )
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("contact_html_removed_v1", "1", now_ms),
            )
            self._conn.commit()

    def _cleanup_contacts_and_photos_v1(self, now_ms: int, *, remove_links: bool = True) -> None:
        with self._lock:
            clinic_row = self._conn.execute(
                """
                SELECT html, metadata_json
                FROM workspace_records
                WHERE kind = 'contact' AND record_id = 'clinic-front-desk'
                """
            ).fetchone()
            should_remove_legacy_clinic = False
            if clinic_row is not None:
                clinic_metadata = _json_loads(clinic_row["metadata_json"], {})
                clinic_email = str(clinic_metadata.get("email") or "").strip() if isinstance(clinic_metadata, dict) else ""
                clinic_html = str(clinic_row["html"] or "").strip()
                should_remove_legacy_clinic = not clinic_email and not clinic_html
            if remove_links and should_remove_legacy_clinic:
                self._conn.execute(
                    """
                    DELETE FROM workspace_links
                    WHERE (source_kind = 'contact' AND source_id = 'clinic-front-desk')
                       OR (target_kind = 'contact' AND target_id = 'clinic-front-desk')
                    """
                )
            if should_remove_legacy_clinic:
                self._conn.execute(
                    """
                    UPDATE workspace_records
                    SET archived = 1,
                        deleted = 1,
                        updated_at_ms = ?
                    WHERE kind = 'contact'
                      AND record_id = 'clinic-front-desk'
                    """,
                    (now_ms,),
                )
            rows = self._conn.execute(
                "SELECT record_id, title, metadata_json, deleted FROM workspace_records WHERE kind = 'contact'"
            ).fetchall()
            for row in rows:
                record_id = str(row["record_id"] or "").strip()
                metadata = _json_loads(row["metadata_json"], {})
                if not isinstance(metadata, dict):
                    metadata = {}
                next_metadata = dict(metadata)
                is_self = record_id == SELF_CONTACT_ID or bool(next_metadata.get("is_self"))
                if not is_self and not bool(row["deleted"]):
                    if not _is_contact_fixture_bitmap_photo(next_metadata.get("photo")):
                        next_metadata["photo"] = _contact_fixture_photo(record_id, str(row["title"] or ""))
                if next_metadata != metadata:
                    self._conn.execute(
                        """
                        UPDATE workspace_records
                        SET metadata_json = ?,
                            updated_at_ms = ?
                        WHERE kind = 'contact'
                          AND record_id = ?
                        """,
                        (_json_dumps(next_metadata), now_ms, record_id),
                    )
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("contact_cleanup_photos_v1", "1", now_ms),
            )
            self._conn.commit()

    def _seed_jimmy_thompson_contact_v1(self, now_ms: int) -> None:
        payload = _jimmy_thompson_contact_record()
        current = self.get_record("contacts", JIMMY_THOMPSON_CONTACT_ID, include_deleted=True)
        if current is not None:
            current_metadata = current.get("metadata") if isinstance(current.get("metadata"), dict) else {}
            next_metadata = {
                **current_metadata,
                **payload["metadata"],
            }
            next_metadata.pop("is_self", None)
            if isinstance(current_metadata.get("activity"), list) and current_metadata.get("activity"):
                next_metadata["activity"] = list(current_metadata["activity"])
            payload = {
                **payload,
                "summary": str(current.get("summary") or payload["summary"]).strip() or payload["summary"],
                "archived": False,
                "deleted": False,
                "metadata": next_metadata,
            }
        self.upsert_record("contacts", payload)
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("contact_jimmy_thompson_v1", "1", now_ms),
            )
            self._conn.commit()

    def _refresh_jimmy_thompson_photo_v1(self, now_ms: int) -> None:
        current = self.get_record("contacts", JIMMY_THOMPSON_CONTACT_ID, include_deleted=True)
        if current is None:
            self._seed_jimmy_thompson_contact_v1(now_ms)
            current = self.get_record("contacts", JIMMY_THOMPSON_CONTACT_ID, include_deleted=True)
        if current is not None:
            metadata = current.get("metadata") if isinstance(current.get("metadata"), dict) else {}
            self.patch_record(
                "contacts",
                JIMMY_THOMPSON_CONTACT_ID,
                {
                    "archived": False,
                    "deleted": False,
                    "metadata": {
                        **metadata,
                        "photo": CONTACT_PHOTO_BY_ID[JIMMY_THOMPSON_CONTACT_ID],
                    },
                },
            )
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("contact_jimmy_photo_fixture_v1", "1", now_ms),
            )
            self._conn.commit()

    def _migrate_notes_only_html_v1(self, now_ms: int) -> None:
        with self._lock:
            asset_rows = self._conn.execute(
                "SELECT asset_id, mime_type, content_base64 FROM workspace_assets"
            ).fetchall()
            asset_html_by_id = {
                str(row["asset_id"] or ""): _decode_asset_text(row["mime_type"], row["content_base64"])
                for row in asset_rows
            }
            note_rows = self._conn.execute(
                """
                SELECT record_id, title, summary, html, html_asset_id, metadata_json, archived, deleted,
                       created_at_ms, updated_at_ms
                FROM workspace_records
                WHERE kind = 'note' AND (TRIM(html_asset_id) != '' OR TRIM(html) != '')
                """
            ).fetchall()
            for row in note_rows:
                asset_id = str(row["html_asset_id"] or "").strip()
                html = str(row["html"] or "").strip() or asset_html_by_id.get(asset_id, "")
                metadata = _json_loads(row["metadata_json"], {})
                metadata = _normalize_note_metadata(metadata if isinstance(metadata, dict) else {})
                metadata.pop("html", None)
                metadata.pop("html_asset_id", None)
                self._conn.execute(
                    """
                    UPDATE workspace_records
                    SET html = ?, html_asset_id = '', metadata_json = ?, updated_at_ms = ?
                    WHERE kind = 'note' AND record_id = ?
                    """,
                    (html, _json_dumps(metadata), now_ms, row["record_id"]),
                )
            rich_rows = self._conn.execute(
                """
                SELECT record_id, kind, title, summary, html, html_asset_id, archived, deleted,
                       created_at_ms, updated_at_ms
                FROM workspace_records
                WHERE kind != 'note' AND (TRIM(html) != '' OR TRIM(html_asset_id) != '')
                """
            ).fetchall()
            for row in rich_rows:
                source_kind = str(row["kind"] or "").strip()
                source_id = str(row["record_id"] or "").strip()
                asset_id = str(row["html_asset_id"] or "").strip()
                html = str(row["html"] or "").strip() or asset_html_by_id.get(asset_id, "")
                self._conn.execute(
                    """
                    UPDATE workspace_records
                    SET html = '', html_asset_id = '', updated_at_ms = ?
                    WHERE kind = ? AND record_id = ?
                    """,
                    (now_ms, source_kind, source_id),
                )
                if not html:
                    continue
                note_id = _linked_note_record_id(source_kind, source_id)
                existing_note = self._conn.execute(
                    "SELECT created_at_ms FROM workspace_records WHERE kind = 'note' AND record_id = ?",
                    (note_id,),
                ).fetchone()
                note_metadata = _normalize_note_metadata(
                    {
                        "context": _workspace_kind_label(source_kind),
                        "source_kind": source_kind,
                        "source_id": source_id,
                        "content_updated_at_ms": int(row["updated_at_ms"] or row["created_at_ms"] or now_ms),
                    }
                )
                self._write_record(
                    "note",
                    note_id,
                    {
                        "record_id": note_id,
                        "kind": "note",
                        "title": str(row["title"] or note_id).strip() or note_id,
                        "summary": str(row["summary"] or "").strip(),
                        "status": "",
                        "pinned": False,
                        "date_key": "",
                        "start_at_ms": 0,
                        "end_at_ms": 0,
                        "due_at_ms": 0,
                        "event_at_ms": int(row["updated_at_ms"] or row["created_at_ms"] or now_ms),
                        "html": html,
                        "html_asset_id": "",
                        "archived": bool(row["archived"]),
                        "deleted": bool(row["deleted"]),
                        "metadata": note_metadata,
                        "content_updated_at_ms": int(row["updated_at_ms"] or row["created_at_ms"] or now_ms),
                    },
                    created_at_ms=int(existing_note["created_at_ms"]) if existing_note else int(row["created_at_ms"] or now_ms),
                    updated_at_ms=now_ms,
                )
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
                    (
                        _linked_note_link_id(source_kind, source_id),
                        source_kind,
                        source_id,
                        "note",
                        note_id,
                        "Note",
                        _json_dumps({}),
                        now_ms,
                        now_ms,
                    ),
                )
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("workspace_notes_only_html_v1", "1", now_ms),
            )
            self._conn.commit()

    def _cleanup_workspace_metadata_v1(self, now_ms: int) -> None:
        with self._lock:
            rows = self._conn.execute(
                "SELECT kind, record_id, metadata_json FROM workspace_records"
            ).fetchall()
            for row in rows:
                kind = str(row["kind"] or "").strip()
                metadata = _json_loads(row["metadata_json"], {})
                if not isinstance(metadata, dict):
                    continue
                next_metadata = dict(metadata)
                if kind == "meeting_note":
                    next_metadata = _normalize_meeting_note_metadata(next_metadata)
                elif kind == "task":
                    next_metadata.pop("project", None)
                    next_metadata.pop("source", None)
                elif kind == "reminder":
                    next_metadata.pop("snooze_state", None)
                elif kind == "note":
                    next_metadata.pop("icon", None)
                elif kind == "project":
                    next_metadata.pop("assets", None)
                if next_metadata == metadata:
                    continue
                self._conn.execute(
                    """
                    UPDATE workspace_records
                    SET metadata_json = ?, updated_at_ms = ?
                    WHERE kind = ? AND record_id = ?
                    """,
                    (_json_dumps(next_metadata), now_ms, kind, row["record_id"]),
                )
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("workspace_metadata_cleanup_v1", "1", now_ms),
            )
            self._conn.commit()

    def _refresh_seeded_demo_time_v1(self, now_ms: int) -> None:
        fields_by_collection: dict[str, tuple[str, ...]] = {
            "calendar-events": ("date", "start_at_ms", "end_at_ms"),
            "meeting-notes": ("date", "start_at_ms", "end_at_ms"),
            "tasks": ("due_at_ms",),
            "reminders": ("due_at_ms",),
            "feed-items": ("event_at_ms",),
        }
        columns_by_kind: dict[str, tuple[str, ...]] = {
            "calendar_event": ("date_key", "start_at_ms", "end_at_ms"),
            "meeting_note": ("date_key", "start_at_ms", "end_at_ms"),
            "task": ("due_at_ms",),
            "reminder": ("due_at_ms",),
            "feed_item": ("event_at_ms",),
        }
        desired: dict[tuple[str, str], dict[str, object]] = {}
        for source in (default_workspace_records(now_ms), default_workspace_graph_records(now_ms)):
            for collection, fields in fields_by_collection.items():
                kind = self.kind_for_collection(collection)
                for record in source.get(collection, []):
                    record_id = str(record.get("id") or "").strip()
                    if not record_id:
                        continue
                    next_values: dict[str, object] = {}
                    for field in fields:
                        if field == "date":
                            next_values["date_key"] = str(record.get("date") or "").strip()
                        else:
                            next_values[field] = _int_or_zero(record.get(field))
                    desired[(kind, record_id)] = next_values
        with self._lock:
            for (kind, record_id), next_values in desired.items():
                row = self._conn.execute(
                    """
                    SELECT date_key, start_at_ms, end_at_ms, due_at_ms, event_at_ms, deleted
                    FROM workspace_records
                    WHERE kind = ? AND record_id = ?
                    """,
                    (kind, record_id),
                ).fetchone()
                if row is None or bool(row["deleted"]):
                    continue
                assignments: list[str] = []
                params: list[object] = []
                for column in columns_by_kind[kind]:
                    current_value: object
                    if column == "date_key":
                        current_value = str(row[column] or "").strip()
                    else:
                        current_value = int(row[column] or 0)
                    desired_value = next_values.get(column, "" if column == "date_key" else 0)
                    if current_value == desired_value:
                        continue
                    assignments.append(f"{column} = ?")
                    params.append(desired_value)
                if not assignments:
                    continue
                assignments.append("updated_at_ms = ?")
                params.append(now_ms)
                params.extend((kind, record_id))
                self._conn.execute(
                    f"UPDATE workspace_records SET {', '.join(assignments)} WHERE kind = ? AND record_id = ?",
                    tuple(params),
                )
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("seeded_demo_time_refresh_v1", "1", now_ms),
            )
            self._conn.commit()

    def _refresh_seeded_graph_content_v1(self, now_ms: int) -> None:
        refresh_record_ids = {
            "house-walkthrough",
            "clinic-checkin",
            "late-night-design-call",
            "freelance-homepage-note",
            "demo-task-send-freelance-mockup",
            "freelance-followup",
            "demo-reminder-freelance-followup",
        }
        refresh_link_ids = {
            "graph-calendar-late-note",
            "graph-calendar-late-task",
            "graph-calendar-late-project",
            "graph-calendar-late-reminder",
        }
        defaults = default_workspace_graph_records(now_ms)
        for collection, records in defaults.items():
            for record in records:
                if str(record.get("id") or "").strip() in refresh_record_ids:
                    self.upsert_record(collection, record)
        for link in default_workspace_graph_links():
            if str(link.get("id") or "").strip() in refresh_link_ids:
                self.upsert_link(link)
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("seeded_graph_content_refresh_v1", "1", now_ms),
            )
            self._conn.commit()

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

    def _cleanup_task_proof_artifacts_v1(self, now_ms: int) -> None:
        task_proof_like = "task-proof-%"
        with self._lock:
            self._conn.execute(
                """
                DELETE FROM workspace_links
                WHERE link_id LIKE ?
                   OR source_id LIKE ?
                   OR target_id LIKE ?
                """,
                (task_proof_like, task_proof_like, task_proof_like),
            )
            self._conn.execute(
                """
                DELETE FROM workspace_records
                WHERE record_id LIKE ?
                """,
                (task_proof_like,),
            )
            self._conn.execute(
                """
                DELETE FROM workspace_assets
                WHERE asset_id LIKE ?
                """,
                (task_proof_like,),
            )
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("task_proof_cleanup_v1", "1", now_ms),
            )
            self._conn.commit()

    def _refresh_seeded_task_sweep_v1(self, now_ms: int) -> None:
        refreshed: dict[str, dict[str, object]] = {}
        for source in (default_workspace_records(now_ms), default_workspace_graph_records(now_ms)):
            for record in source.get("tasks", []):
                record_id = str(record.get("id") or "").strip()
                if record_id.startswith("demo-task-"):
                    refreshed[record_id] = record
        refreshed_ids = sorted(refreshed)
        if refreshed_ids:
            placeholders = ",".join("?" for _ in refreshed_ids)
            params = tuple(refreshed_ids) + tuple(refreshed_ids)
            with self._lock:
                self._conn.execute(
                    f"""
                    DELETE FROM workspace_links
                    WHERE (source_kind = 'task' AND source_id LIKE 'demo-task-%' AND source_id NOT IN ({placeholders}))
                       OR (target_kind = 'task' AND target_id LIKE 'demo-task-%' AND target_id NOT IN ({placeholders}))
                    """,
                    params,
                )
                self._conn.execute(
                    f"""
                    DELETE FROM workspace_records
                    WHERE kind = 'task'
                      AND record_id LIKE 'demo-task-%'
                      AND record_id NOT IN ({placeholders})
                    """,
                    tuple(refreshed_ids),
                )
                self._conn.commit()
        for record in refreshed.values():
            self.upsert_record("tasks", record)
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
                ("seeded_task_sweep_v1", "1", now_ms),
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
        html_asset_id = ""
        archived = bool(payload.get("archived", False))
        deleted = bool(payload.get("deleted", False))
        pinned = bool(payload.get("pinned", False))
        metadata = dict(metadata)
        metadata.pop("html", None)
        metadata.pop("html_asset_id", None)
        if kind == "task":
            metadata = _normalize_task_metadata(metadata, payload, summary=summary)
            status = normalize_task_status(status or metadata.get("status") or "todo")
        if kind == "reminder":
            status = status or "open"
            metadata = _normalize_reminder_metadata(metadata, status=status)
        if kind == "meeting_note":
            metadata = _normalize_meeting_note_metadata(metadata)
        if kind == "note":
            metadata = _normalize_note_metadata(metadata)
        if kind == "project":
            metadata = _normalize_project_metadata(metadata)
        if kind == "contact":
            metadata = _contact_metadata_without_endpoints(metadata)
            is_self = record_id == SELF_CONTACT_ID or bool(metadata.get("is_self"))
            if is_self:
                metadata = {
                    **metadata,
                    "is_self": True,
                    "avatar": str(metadata.get("avatar") or "ME").strip() or "ME",
                    "email": str(metadata.get("email") or "").strip(),
                    "phone": str(metadata.get("phone") or "").strip(),
                    "notification_device_id": str(metadata.get("notification_device_id") or "").strip(),
                    "preferred_reminder_device_id": str(metadata.get("preferred_reminder_device_id") or "").strip(),
                    "activity": list(metadata.get("activity") or []) if isinstance(metadata.get("activity"), list) else ["Reminder delivery profile"],
                }
                title = title or SELF_CONTACT_TITLE
                summary = summary or SELF_CONTACT_SUMMARY
                pinned = True
                archived = False
                deleted = False
        if kind == "calendar_event" and not date_key and start_at_ms:
            date_key = time.strftime("%Y-%m-%d", time.localtime(start_at_ms / 1000))
        if kind == "feed_item":
            event_at_ms = _int_or_zero(payload.get("event_at_ms") or now_ms)
        if kind != "note":
            html = ""
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
            record["owner"] = str(metadata.get("owner") or "").strip()
            record["description"] = str(metadata.get("description") or record["summary"] or "").strip()
            record["checklist"] = _normalize_task_checklist(metadata.get("checklist"))
            completed_at_ms = _int_or_zero(metadata.get("completed_at_ms"))
            if completed_at_ms > 0:
                record["completed_at_ms"] = completed_at_ms
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


def seeded_workspace_snapshot(
    records_by_collection: dict[str, list[dict[str, object]]],
    links: list[dict[str, object]],
    assets: list[dict[str, object]] | None = None,
) -> tuple[dict[str, list[dict[str, object]]], list[dict[str, object]]]:
    asset_html_by_id = {
        str(asset.get("id") or asset.get("asset_id") or "").strip(): str(asset.get("html") or asset.get("text") or "").strip()
        for asset in (assets or [])
        if str(asset.get("id") or asset.get("asset_id") or "").strip()
    }
    next_records = {collection: [dict(record) for record in records] for collection, records in records_by_collection.items()}
    next_links = [dict(link) for link in links]
    next_records.setdefault("notes", [])
    notes = next_records["notes"]
    existing_note_ids = {
        str(note.get("id") or note.get("record_id") or "").strip()
        for note in notes
        if str(note.get("id") or note.get("record_id") or "").strip()
    }
    for collection, records in next_records.items():
        kind = WORKSPACE_COLLECTIONS.get(collection, "")
        for record in records:
            metadata = dict(record.get("metadata") or {}) if isinstance(record.get("metadata"), dict) else {}
            html = str(record.get("html") or "").strip()
            asset_id = str(record.get("html_asset_id") or "").strip()
            resolved_html = html or asset_html_by_id.get(asset_id, "")
            if kind == "note":
                record["html"] = resolved_html
                record["html_asset_id"] = ""
                record["metadata"] = _normalize_note_metadata(metadata)
                continue
            record["html"] = ""
            record["html_asset_id"] = ""
            if kind == "project":
                metadata.pop("chips", None)
                record["metadata"] = metadata
            if not kind or not resolved_html:
                continue
            source_id = str(record.get("id") or record.get("record_id") or "").strip()
            if not source_id:
                continue
            note_id = _linked_note_record_id(kind, source_id)
            if note_id not in existing_note_ids:
                notes.append(
                    {
                        "id": note_id,
                        "title": str(record.get("title") or note_id).strip() or note_id,
                        "summary": str(record.get("summary") or "").strip(),
                        "html": resolved_html,
                        "metadata": _normalize_note_metadata(
                            {
                                "context": _workspace_kind_label(kind),
                                "source_kind": kind,
                                "source_id": source_id,
                            }
                        ),
                    }
                )
                existing_note_ids.add(note_id)
            next_links.append(
                {
                    "id": _linked_note_link_id(kind, source_id),
                    "source_kind": kind,
                    "source_id": source_id,
                    "target_kind": "note",
                    "target_id": note_id,
                    "label": "Note",
                }
            )
    return next_records, next_links


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
                "title": "Approve porch repair budget",
                "summary": "Lock the painter allowance before tonight's walkthrough.",
                "status": "open",
                "due_at_ms": now_ms + 2 * 60 * 60 * 1000,
                "html": _task_html(
                    "Approve porch repair budget",
                    "Set the spend ceiling before the contractor sends the final invoice.",
                    ["Review the updated estimate", "Confirm the paint line item", "Text Maya the approved cap"],
                    "This keeps one DO task grounded in home logistics instead of product work."
                ),
                "metadata": {"owner": "Maya Chen", "project": "Home refresh"},
            },
            {
                "id": "demo-task-do-connect-brief",
                "title": "Trim first-run launch notes",
                "summary": "Make the onboarding brief read cleanly before review.",
                "status": "in_progress",
                "due_at_ms": now_ms + 7 * 60 * 60 * 1000,
                "html": _task_html(
                    "Trim first-run launch notes",
                    "Tighten the brief so the review focuses on what changed instead of re-reading the whole flow.",
                    ["Shorten the opening summary", "Confirm the screen order callout", "Flag any copy that still feels too dense"],
                    "This still lives in DO, but it should feel different from the budget and vendor tasks."
                ),
                "metadata": {"owner": "Pucky", "project": "Project Aurora"},
            },
            {
                "id": "demo-task-do-vendor-followup",
                "title": "Send migration cutoff follow-up",
                "summary": "Close the loop on today's vendor handoff while it is still fresh.",
                "status": "waiting",
                "due_at_ms": now_ms + 20 * 60 * 60 * 1000,
                "html": _task_html(
                    "Send migration cutoff follow-up",
                    "Turn the handoff call into one small note with owners, dates, and the one blocker still open.",
                    ["List the remaining cutoff risks", "Assign owners to the missing inputs", "Post the recap in the shared vendor thread"],
                    "It should feel urgent, but less frantic than the truly overdue items."
                ),
                "metadata": {"owner": "Tom Reyes", "project": "Migration"},
            },
            {
                "id": "demo-task-soon-roadmap",
                "title": "Prep roadmap review packet",
                "summary": "Build next week's deck and the small decisions list that goes with it.",
                "status": "open",
                "due_at_ms": now_ms + 2 * 24 * 60 * 60 * 1000,
                "html": _task_html(
                    "Prep roadmap review packet",
                    "Assemble the next roadmap pass so leadership can react without needing a separate explainer.",
                    ["Refresh the milestones slide", "Rewrite the top three decisions", "Add Maya's launch-readiness note"],
                    "This is an intentionally calm SOON task that should read clearly with a date-first treatment."
                ),
                "metadata": {"owner": "Pucky", "project": "Project Aurora"},
            },
            {
                "id": "demo-task-soon-nda",
                "title": "Reply to NDA redline tonight",
                "summary": "Legal still needs the signer path before tomorrow morning.",
                "status": "waiting",
                "due_at_ms": now_ms + 22 * 60 * 60 * 1000,
                "html": _task_html(
                    "Reply to NDA redline tonight",
                    "Pull the latest redline together with the signer path so legal gets one crisp response before the next handoff.",
                    ["Confirm the indemnity comment", "Note the requested signer", "Send the combined response back to legal"],
                    "This intentionally reads like a waiting task that is still due soon enough to stay in Today."
                ),
                "metadata": {"owner": "Tom Reyes", "project": "Operations"},
            },
            {
                "id": "demo-task-soon-customer-recap",
                "title": "Draft sponsor recap before standup",
                "summary": "Turn the latest migration thread into a short update before tomorrow's standup.",
                "status": "in_progress",
                "due_at_ms": now_ms + 11 * 60 * 60 * 1000,
                "html": _task_html(
                    "Draft sponsor recap before standup",
                    "Package the main decisions and the one unresolved risk into a short note that can stand on its own by tomorrow morning.",
                    ["Summarize the confirmed decisions", "Call out the blocker that remains", "Propose the next sponsor check-in"],
                    "This helps the synthetic set lean harder into active due-soon work instead of piling on more upcoming items."
                ),
                "metadata": {"owner": "Priya Shah", "project": "Migration"},
            },
            {
                "id": "demo-task-overdue-invoice",
                "title": "Clear overdue invoice approval",
                "summary": "One finance approval is still blocking payout.",
                "status": "open",
                "due_at_ms": now_ms - 3 * 60 * 60 * 1000,
                "html": _task_html(
                    "Clear overdue invoice approval",
                    "The invoice slipped past its window and now needs one fast follow-up to unblock payment.",
                    ["Confirm the final approver", "Ping finance for the blocked step", "Update the tracker once the hold clears"],
                    "This is the freshest overdue example, so it should read hot without feeling ancient."
                ),
                "metadata": {"owner": "Finance", "project": "Migration"},
            },
            {
                "id": "demo-task-done-archive",
                "title": "Archive migration handoff notes",
                "summary": "The working notes were moved and linked back to the project.",
                "status": "done",
                "due_at_ms": now_ms - 2 * 24 * 60 * 60 * 1000,
                "html": _task_html(
                    "Archive migration handoff notes",
                    "The handoff notes were reviewed, filed, and closed out cleanly.",
                    ["Confirm the archive location", "Link the final note in the project", "Mark the cleanup complete"],
                    "This keeps one DONE example administrative and tidy."
                ),
                "metadata": {"owner": "Pucky", "project": "Migration"},
            },
            {
                "id": "demo-task-done-handbook",
                "title": "Publish onboarding checklist",
                "summary": "The revised checklist is already live and linked from the release note.",
                "status": "done",
                "due_at_ms": now_ms - 24 * 60 * 60 * 1000,
                "html": _task_html(
                    "Publish onboarding checklist",
                    "The checklist shipped, so the detail view only needs enough context to feel like real history.",
                    ["Confirm the launch note", "Link the checklist in Connect", "Record the release timestamp"],
                    "This is the straightforward DONE example for the middle of the section."
                ),
                "metadata": {"owner": "Pucky", "project": "Project Aurora"},
            },
            {
                "id": "demo-task-done-retro",
                "title": "Log roadmap retro decisions",
                "summary": "The retro decisions were captured, shared, and closed out.",
                "status": "done",
                "due_at_ms": now_ms - 5 * 24 * 60 * 60 * 1000,
                "html": _task_html(
                    "Log roadmap retro decisions",
                    "Capture the final retro decisions so the next planning cycle has one stable source of truth.",
                    ["Record the tradeoffs", "Link the approved follow-ups", "Share the final retro summary"],
                    "This rounds out DONE with a more strategic example instead of another filing task."
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
                "metadata": {"place": "Phone", "attendees": ["Clinic front desk"], "type": "health"},
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
                    "activity": ["Slack DM - approved the engineering budget", "Meeting - Roadmap sync today"],
                },
            },
            {
                "id": "lee",
                "title": "Lee",
                "summary": "Handyman contact",
                "html": "<!doctype html><h1>Lee</h1><p>Contact for the front porch repair window and follow-up timing.</p>",
                "metadata": {
                    "first_name": "Lee",
                    "avatar": "L",
                    "email": "lee@example.com",
                    "phone": "+1 (415) 555-0118",
                    "activity": ["Calendar - front porch handyman window", "Task - repair follow-up"],
                },
            },
            {
                "id": "katy",
                "title": "Katy",
                "summary": "Family contact",
                "html": "<!doctype html><h1>Katy</h1><p>Contact card for family calendar logistics and soccer scheduling.</p>",
                "metadata": {
                    "first_name": "Katy",
                    "avatar": "K",
                    "email": "katy@example.com",
                    "phone": "+1 (415) 555-0124",
                    "activity": ["Calendar - soccer game tomorrow", "Reminder - bring water bottle"],
                },
            },
            {
                "id": "jeff-bennett",
                "title": "Jeff Bennett",
                "summary": "Family contact",
                "html": "<!doctype html><h1>Jeff Bennett</h1><p>Contact for dinner plans, pickup handoffs, and the proof review flow.</p>",
                "metadata": {
                    "first_name": "Jeff",
                    "last_name": "Bennett",
                    "avatar": "JB",
                    "email": "jeff.bennett@example.com",
                    "phone": "+1 (415) 555-0152",
                    "activity": ["Calendar - family dinner", "Calendar - pickup handoff"],
                },
            },
            {
                "id": "clinic-front-desk",
                "title": "Clinic front desk",
                "summary": "Clinic contact for appointment timing and prep details.",
                "html": "<!doctype html><h1>Clinic front desk</h1><p>Contact card for appointment windows, prep notes, and follow-up timing.</p>",
                "metadata": {
                    "avatar": "CF",
                    "email": "frontdesk@clinic.example.com",
                    "phone": "+1 (415) 555-0133",
                    "activity": ["Calendar - pediatric dentist follow-up", "Reminder - clinic prep questions"],
                },
            },
            _jimmy_thompson_contact_record(),
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
                "metadata": {"place": "Home", "address": "1818 Maple Ave, Oakland, CA 94611", "attendees": ["Maya Chen"], "type": "home"},
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
                "metadata": {"place": "Westside Clinic", "address": "11714 Wilshire Blvd, Suite 12, Los Angeles, CA 90025", "attendees": ["Clinic front desk"], "type": "health"},
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
                "summary": "Timezone-edge check before sending the morning follow-up. https://meet.google.com/qas-dsgn-late",
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
                    "activity": ["Call - confirm the appointment time", "Reminder - check prep instructions"],
                },
            },
            {
                "id": "jeff-bennett",
                "title": "Jeff Bennett",
                "summary": "Family contact",
                "html": _personal_html(
                    "Jeff Bennett",
                    "Family contact for dinner plans and pickup logistics.",
                    ["Confirm dinner timing", "Cover pickup handoff", "Keep the evening simple"],
                ),
                "metadata": {
                    "first_name": "Jeff",
                    "last_name": "Bennett",
                    "avatar": "JB",
                    "email": "jeff.bennett@example.com",
                    "phone": "+1 (415) 555-0152",
                    "activity": ["Calendar - dinner with the Forsters", "Calendar - Katy pickup handoff"],
                },
            },
            {
                "id": "katy",
                "title": "Katy",
                "summary": "Family contact",
                "html": _personal_html(
                    "Katy",
                    "Family contact for soccer and pickup scheduling.",
                    ["Soccer timing", "Pickup logistics", "Bring water and chairs"],
                ),
                "metadata": {
                    "first_name": "Katy",
                    "avatar": "K",
                    "email": "katy@example.com",
                    "phone": "+1 (415) 555-0124",
                    "activity": ["Calendar - soccer game", "Calendar - pickup handoff"],
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
        {"id": "graph-calendar-late-note", "source_kind": "calendar_event", "source_id": "late-night-design-call", "target_kind": "note", "target_id": "freelance-homepage-note", "label": "Freelance homepage revision"},
        {"id": "graph-calendar-late-task", "source_kind": "calendar_event", "source_id": "late-night-design-call", "target_kind": "task", "target_id": "demo-task-send-freelance-mockup", "label": "Send homepage pass to Sam"},
        {"id": "graph-calendar-late-project", "source_kind": "calendar_event", "source_id": "late-night-design-call", "target_kind": "project", "target_id": "freelance-followup", "label": "Freelance follow-up"},
        {"id": "graph-calendar-late-reminder", "source_kind": "calendar_event", "source_id": "late-night-design-call", "target_kind": "reminder", "target_id": "demo-reminder-freelance-followup", "label": "Send homepage pass before review"},
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
