from __future__ import annotations

import json
from pathlib import Path

from pucky_vm.workspace_store import (
    JIMMY_THOMPSON_CONTACT_ID,
    SELF_CONTACT_ID,
    WorkspaceStore,
    _linked_note_link_id,
    _linked_note_record_id,
    default_workspace_graph_records,
    default_workspace_records,
    derive_task_group,
)


class Clock:
    def __init__(self, value: int) -> None:
        self.value = value

    def __call__(self) -> int:
        return self.value


SEEDED_DEMO_TIME_FIELDS_BY_COLLECTION: dict[str, tuple[str, ...]] = {
    "calendar-events": ("date", "start_at_ms", "end_at_ms"),
    "meeting-notes": ("date", "start_at_ms", "end_at_ms"),
    "tasks": ("due_at_ms",),
    "reminders": ("due_at_ms",),
    "feed-items": ("event_at_ms",),
}


def _expected_seeded_demo_time_fields(now_ms: int) -> dict[tuple[str, str], dict[str, object]]:
    expected: dict[tuple[str, str], dict[str, object]] = {}
    for source in (default_workspace_records(now_ms), default_workspace_graph_records(now_ms)):
        for collection, fields in SEEDED_DEMO_TIME_FIELDS_BY_COLLECTION.items():
            for record in source.get(collection, []):
                record_id = str(record.get("id") or "").strip()
                if not record_id:
                    continue
                expected[(collection, record_id)] = {
                    field: (str(record.get(field) or "").strip() if field == "date" else int(record.get(field) or 0))
                    for field in fields
                }
    return expected


def test_workspace_store_keeps_note_html_and_clears_non_note_html(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"), clock_ms=clock)

    notes = store.list_records("notes")
    assert notes["count"] >= 3
    assert notes["items"][0]["pinned"] is True

    note = store.upsert_record(
        "notes",
        {
            "id": "proof-note",
            "title": "Proof Note",
            "summary": "Created by test",
            "pinned": True,
            "html": "<!doctype html><h1>Proof</h1>",
            "html_asset_id": "ignored-on-write",
            "metadata": {"context": "Tests", "icon": "pin"},
        },
    )
    assert note["title"] == "Proof Note"
    assert note["metadata"]["context"] == "Tests"
    assert "icon" not in note["metadata"]
    assert note["html"].startswith("<!doctype html>")
    assert note["html_asset_id"] == ""

    task = store.upsert_record(
        "tasks",
        {
            "id": "proof-task",
            "title": "Proof Task",
            "summary": "Created by test",
            "status": "open",
            "due_at_ms": 1_800_000_010_000,
            "html": "<!doctype html><h1>Task</h1>",
            "html_asset_id": "ignored-on-write",
            "metadata": {"owner": "Tests", "project": "Legacy Project", "source": "legacy-meeting"},
        },
    )
    assert task["html"] == ""
    assert task["html_asset_id"] == ""
    assert "project" not in task["metadata"]
    assert "source" not in task["metadata"]


def test_workspace_store_uses_projects_collection_and_drops_tags_alias() -> None:
    from pucky_vm.workspace_store import WORKSPACE_COLLECTIONS

    assert WORKSPACE_COLLECTIONS["projects"] == "project"
    assert "tags" not in WORKSPACE_COLLECTIONS


def test_workspace_store_task_archive_hides_from_default_list_but_survives_include_archived(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"), clock_ms=clock)

    created = store.upsert_record(
        "tasks",
        {
            "id": "archive-me",
            "title": "Archive me",
            "status": "todo",
        },
    )
    archived = store.patch_record("tasks", "archive-me", {"archived": True})

    assert created["id"] == "archive-me"
    assert archived is not None
    assert archived["archived"] is True
    visible_ids = {item["id"] for item in store.list_records("tasks")["items"]}
    archived_ids = {item["id"] for item in store.list_records("tasks", include_archived=True)["items"]}
    assert "archive-me" not in visible_ids
    assert "archive-me" in archived_ids


def test_contact_endpoint_migration_backfills_email_phone_and_removes_metadata(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    legacy_metadata = {
        "avatar": "LG",
        "email": "",
        "phone": "",
        "endpoints": [
            {"label": "Slack", "value": "@legacy"},
            {"label": "Gmail", "value": "legacy@example.com"},
            {"label": "SMS", "value": "+1 (555) 010-9999"},
        ],
        "activity": ["Legacy imported contact"],
    }
    store._conn.execute(
        "UPDATE workspace_records SET metadata_json = ? WHERE kind = 'contact' AND record_id = 'sam-rivera'",
        (json.dumps(legacy_metadata),),
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'contact_endpoints_removed_v1'")
    store._conn.commit()
    store.close()

    migrated = WorkspaceStore(str(db_path), clock_ms=clock)
    contact = migrated.get_record("contacts", "sam-rivera")
    assert contact is not None
    metadata = contact["metadata"]
    assert metadata["email"] == "legacy@example.com"
    assert metadata["phone"] == "+1 (555) 010-9999"
    assert "endpoints" not in metadata


def test_contact_writes_strip_endpoint_metadata_without_backfilling(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))

    contact = store.upsert_record(
        "contacts",
        {
            "id": "endpoint-write",
            "title": "Endpoint Write",
            "metadata": {
                "email": "",
                "phone": "",
                "endpoints": [
                    {"label": "Email", "value": "ignored@example.com"},
                    {"label": "Phone", "value": "+1 (555) 010-1111"},
                ],
            },
        },
    )

    metadata = contact["metadata"]
    assert metadata.get("email", "") == ""
    assert metadata.get("phone", "") == ""
    assert "endpoints" not in metadata


def test_contact_html_migration_clears_legacy_contact_documents(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    store._conn.execute(
        """
        UPDATE workspace_records
        SET html = ?, html_asset_id = ?
        WHERE kind = 'contact' AND record_id = 'sam-rivera'
        """,
        ("<!doctype html><h1>Legacy contact page</h1>", "asset-contact-maya"),
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'contact_html_removed_v1'")
    store._conn.commit()
    store.close()

    migrated = WorkspaceStore(str(db_path), clock_ms=clock)
    contact = migrated.get_record("contacts", "sam-rivera")
    assert contact is not None
    assert contact["html"] == ""
    assert contact["html_asset_id"] == ""
    meta = migrated._conn.execute("SELECT value FROM workspace_meta WHERE key = 'contact_html_removed_v1'").fetchone()
    assert meta is not None
    assert meta["value"] == "1"


def test_contact_writes_strip_html_document_fields(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))

    contact = store.upsert_record(
        "contacts",
        {
            "id": "html-write",
            "title": "HTML Write",
            "html": "<!doctype html><h1>Contact page</h1>",
            "html_asset_id": "asset-contact-maya",
            "metadata": {
                "html": "<!doctype html><h1>Metadata page</h1>",
                "html_asset_id": "metadata-asset",
            },
        },
    )
    assert contact["html"] == ""
    assert contact["html_asset_id"] == ""

    patched = store.patch_record(
        "contacts",
        "html-write",
        {
            "html": "<!doctype html><h1>Patched page</h1>",
            "html_asset_id": "patched-asset",
            "metadata": {"html": "<p>Patched metadata</p>", "html_asset_id": "patched-metadata-asset"},
        },
    )
    assert patched is not None
    assert patched["html"] == ""
    assert patched["html_asset_id"] == ""
    assert "html" not in patched["metadata"]
    assert "html_asset_id" not in patched["metadata"]


def test_contact_cleanup_removes_clinic_and_preserves_self_photo(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    me = store.get_record("contacts", SELF_CONTACT_ID)
    assert me is not None
    me_metadata = dict(me["metadata"])
    me_metadata["photo"] = "data:image/jpeg;base64,self-proof-photo"
    store._conn.execute(
        "UPDATE workspace_records SET metadata_json = ? WHERE kind = 'contact' AND record_id = ?",
        (json.dumps(me_metadata), SELF_CONTACT_ID),
    )
    store.upsert_record(
        "contacts",
        {
            "id": "clinic-front-desk",
            "title": "Clinic front desk",
            "summary": "Legacy clinic contact",
            "metadata": {"avatar": "CF", "phone": "+1 (415) 555-0133"},
        },
    )
    store.upsert_link(
        {
            "id": "legacy-clinic-link",
            "source_kind": "calendar_event",
            "source_id": "clinic-checkin",
            "target_kind": "contact",
            "target_id": "clinic-front-desk",
            "label": "Clinic front desk",
        }
    )
    store.upsert_record(
        "contacts",
        {
            "id": "eric-donaldson",
            "title": "Eric Donaldson",
            "summary": "Legacy imported contact",
            "metadata": {"avatar": "ED", "activity": ["Imported contact"]},
        },
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'contact_cleanup_photos_v1'")
    store._conn.commit()
    store.close()

    migrated = WorkspaceStore(str(db_path), clock_ms=clock)
    visible_contacts = {item["id"]: item for item in migrated.list_records("contacts")["items"]}
    assert "clinic-front-desk" not in visible_contacts
    clinic = migrated.get_record("contacts", "clinic-front-desk", include_deleted=True)
    assert clinic is not None
    assert clinic["deleted"] is True
    assert clinic["archived"] is True

    clinic_links = migrated._conn.execute(
        """
        SELECT link_id
        FROM workspace_links
        WHERE (source_kind = 'contact' AND source_id = 'clinic-front-desk')
           OR (target_kind = 'contact' AND target_id = 'clinic-front-desk')
        """
    ).fetchall()
    assert clinic_links == []

    assert visible_contacts[SELF_CONTACT_ID]["metadata"].get("photo", "") == "data:image/jpeg;base64,self-proof-photo"
    for contact_id, contact in visible_contacts.items():
        if contact_id == SELF_CONTACT_ID:
            continue
        photo = str(contact["metadata"].get("photo") or "")
        assert photo.startswith("fixtures/contact_photos/")
        assert photo.endswith((".jpg", ".jpeg", ".webp"))


def test_jimmy_thompson_contact_is_seeded_with_requested_fields(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))

    contact = store.get_record("contacts", JIMMY_THOMPSON_CONTACT_ID)
    assert contact is not None
    assert contact["title"] == "Jimmy Thompson"
    assert contact["summary"] == "Personal contact"
    assert contact["html"] == ""
    assert contact["html_asset_id"] == ""
    assert contact["metadata"]["first_name"] == "Jimmy"
    assert contact["metadata"]["last_name"] == "Thompson"
    assert contact["metadata"]["avatar"] == "JT"
    assert contact["metadata"]["email"] == "jimmythompson323@gmail.com"
    assert contact["metadata"]["phone"] == "4074969882"
    assert contact["metadata"]["photo"] == "fixtures/contact_photos/jimmy.jpg"


def test_jimmy_thompson_contact_migration_adds_contact_to_existing_workspace(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    store._conn.execute(
        "DELETE FROM workspace_records WHERE kind = 'contact' AND record_id = ?",
        (JIMMY_THOMPSON_CONTACT_ID,),
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'contact_jimmy_thompson_v1'")
    store._conn.commit()
    store.close()

    migrated = WorkspaceStore(str(db_path), clock_ms=clock)
    contact = migrated.get_record("contacts", JIMMY_THOMPSON_CONTACT_ID)
    assert contact is not None
    assert contact["deleted"] is False
    assert contact["archived"] is False
    assert contact["metadata"]["email"] == "jimmythompson323@gmail.com"
    assert contact["metadata"]["phone"] == "4074969882"
    assert contact["metadata"]["photo"] == "fixtures/contact_photos/jimmy.jpg"

    meta = migrated._conn.execute("SELECT value FROM workspace_meta WHERE key = 'contact_jimmy_thompson_v1'").fetchone()
    assert meta is not None
    assert meta["value"] == "1"


def test_jimmy_thompson_photo_migration_updates_existing_contact(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    contact = store.get_record("contacts", JIMMY_THOMPSON_CONTACT_ID)
    assert contact is not None
    metadata = dict(contact["metadata"])
    metadata["photo"] = "fixtures/contact_photos/proof-contact.webp"
    store._conn.execute(
        "UPDATE workspace_records SET metadata_json = ? WHERE kind = 'contact' AND record_id = ?",
        (json.dumps(metadata), JIMMY_THOMPSON_CONTACT_ID),
    )
    store._conn.execute(
        "INSERT OR REPLACE INTO workspace_meta (key, value, updated_at_ms) VALUES (?, ?, ?)",
        ("contact_jimmy_thompson_v1", "1", clock.value),
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'contact_jimmy_photo_fixture_v1'")
    store._conn.commit()
    store.close()

    migrated = WorkspaceStore(str(db_path), clock_ms=clock)
    contact = migrated.get_record("contacts", JIMMY_THOMPSON_CONTACT_ID)
    assert contact is not None
    assert contact["metadata"]["photo"] == "fixtures/contact_photos/jimmy.jpg"

    meta = migrated._conn.execute("SELECT value FROM workspace_meta WHERE key = 'contact_jimmy_photo_fixture_v1'").fetchone()
    assert meta is not None
    assert meta["value"] == "1"


def test_note_content_timestamp_tracks_content_edits_not_pin_toggles(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"), clock_ms=clock)

    note = store.upsert_record(
        "notes",
        {
            "id": "proof-note",
            "title": "Proof Note",
            "summary": "Created by test",
            "metadata": {"context": "Tests"},
        },
    )
    assert note["content_updated_at_ms"] == 1_800_000_000_000
    assert note["metadata"]["content_updated_at_ms"] == 1_800_000_000_000

    clock.value = 1_800_000_001_000
    pinned = store.patch_record("notes", "proof-note", {"pinned": True})
    assert pinned is not None
    assert pinned["updated_at_ms"] == 1_800_000_001_000
    assert pinned["content_updated_at_ms"] == 1_800_000_000_000
    assert pinned["metadata"]["content_updated_at_ms"] == 1_800_000_000_000

    clock.value = 1_800_000_002_000
    edited = store.patch_record("notes", "proof-note", {"summary": "Actually edited"})
    assert edited is not None
    assert edited["updated_at_ms"] == 1_800_000_002_000
    assert edited["content_updated_at_ms"] == 1_800_000_002_000
    assert edited["metadata"]["content_updated_at_ms"] == 1_800_000_002_000


def test_workspace_store_lists_pinned_projects_before_recent_projects(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))

    store.upsert_record(
        "projects",
        {
            "id": "recent-project",
            "title": "Recent Project",
            "summary": "Newest unpinned project",
            "updated_at_ms": 1_800_000_100_000,
        },
    )
    store.upsert_record(
        "projects",
        {
            "id": "pinned-project",
            "title": "Pinned Project",
            "summary": "Older pinned project",
            "updated_at_ms": 1_800_000_000_000,
        },
    )
    store.patch_record("projects", "pinned-project", {"pinned": True})

    result = store.list_records("projects")
    project_ids = [item["id"] for item in result["items"]]

    assert "pinned-project" in project_ids
    assert "recent-project" in project_ids
    assert project_ids.index("pinned-project") < project_ids.index("recent-project")


def test_task_grouping_auto_moves_when_clock_passes_deadline(tmp_path: Path) -> None:
    clock = Clock(10_000)
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"), clock_ms=clock)
    task = store.upsert_record(
        "tasks",
        {
            "id": "deadline",
            "title": "Deadline transition",
            "status": "open",
            "due_at_ms": 12_000,
        },
    )

    assert task["derived_group"] == "do"
    clock.value = 13_000
    updated = store.get_record("tasks", "deadline")
    assert updated is not None
    assert updated["derived_group"] == "overdue"

    done = store.patch_record("tasks", "deadline", {"status": "done"})
    assert done is not None
    assert done["derived_group"] == "done"
    clock.value = 99_000
    still_done = store.get_record("tasks", "deadline")
    assert still_done is not None
    assert still_done["derived_group"] == "done"


def test_task_completed_timestamp_lifecycle_is_durable(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"), clock_ms=clock)

    active = store.upsert_record(
        "tasks",
        {
            "id": "durable-complete-active",
            "title": "Durable active task",
            "status": "todo",
        },
    )
    assert "completed_at_ms" not in active
    assert "completed_at_ms" not in active["metadata"]

    created_done = store.upsert_record(
        "tasks",
        {
            "id": "durable-complete-created-done",
            "title": "Created done task",
            "status": "done",
            "created_at_ms": clock.value - 45_000,
        },
    )
    assert created_done["completed_at_ms"] == clock.value - 45_000
    assert created_done["metadata"]["completed_at_ms"] == clock.value - 45_000

    clock.value += 1_000
    stamped = store.patch_record("tasks", "durable-complete-active", {"status": "done"})
    assert stamped is not None
    assert stamped["completed_at_ms"] == clock.value
    assert stamped["metadata"]["completed_at_ms"] == clock.value

    clock.value += 1_000
    preserved = store.patch_record("tasks", "durable-complete-active", {"summary": "Edited after completion"})
    assert preserved is not None
    assert preserved["status"] == "done"
    assert preserved["completed_at_ms"] == stamped["completed_at_ms"]

    clock.value += 1_000
    reopened = store.patch_record("tasks", "durable-complete-active", {"status": "in_progress"})
    assert reopened is not None
    assert reopened["status"] == "in_progress"
    assert "completed_at_ms" not in reopened
    assert "completed_at_ms" not in reopened["metadata"]

    clock.value += 1_000
    redone = store.patch_record("tasks", "durable-complete-active", {"status": "done"})
    assert redone is not None
    assert redone["completed_at_ms"] == clock.value
    assert redone["completed_at_ms"] > stamped["completed_at_ms"]


def test_workspace_store_migrates_legacy_non_note_html_and_asset_content_into_linked_notes_idempotently(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    store.upsert_record(
        "tasks",
        {
            "id": "legacy-inline-task",
            "title": "Legacy Inline Task",
            "summary": "Inline legacy summary",
            "status": "open",
            "due_at_ms": clock.value + 60_000,
        },
    )
    store.upsert_record(
        "projects",
        {
            "id": "legacy-asset-project",
            "title": "Legacy Asset Project",
            "summary": "Asset legacy summary",
        },
    )
    store.upsert_record(
        "notes",
        {
            "id": "legacy-asset-note",
            "title": "Legacy Asset Note",
            "summary": "Note asset summary",
        },
    )
    store.create_asset(
        {
            "id": "legacy-project-html",
            "title": "Legacy Project HTML",
            "mime_type": "text/html; charset=utf-8",
            "html": "<!doctype html><h1>Legacy project page</h1><p>Recovered from workspace_assets.</p>",
        }
    )
    store.create_asset(
        {
            "id": "legacy-note-html",
            "title": "Legacy Note HTML",
            "mime_type": "text/html; charset=utf-8",
            "html": "<!doctype html><h1>Legacy note page</h1><p>Recovered from workspace_assets.</p>",
        }
    )
    store._conn.execute(
        """
        UPDATE workspace_records
        SET html = ?, html_asset_id = ''
        WHERE kind = 'task' AND record_id = 'legacy-inline-task'
        """,
        ("<!doctype html><h1>Legacy inline task page</h1><p>Recovered inline HTML.</p>",),
    )
    store._conn.execute(
        """
        UPDATE workspace_records
        SET html = '', html_asset_id = ?
        WHERE kind = 'project' AND record_id = 'legacy-asset-project'
        """,
        ("legacy-project-html",),
    )
    store._conn.execute(
        """
        UPDATE workspace_records
        SET html = '', html_asset_id = ?
        WHERE kind = 'note' AND record_id = 'legacy-asset-note'
        """,
        ("legacy-note-html",),
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'workspace_notes_only_html_v1'")
    store._conn.commit()
    store.close()

    migrated = WorkspaceStore(str(db_path), clock_ms=clock)
    inline_task = migrated.get_record("tasks", "legacy-inline-task")
    project = migrated.get_record("projects", "legacy-asset-project")
    note = migrated.get_record("notes", "legacy-asset-note")
    assert inline_task is not None
    assert project is not None
    assert note is not None
    assert inline_task["html"] == ""
    assert inline_task["html_asset_id"] == ""
    assert project["html"] == ""
    assert project["html_asset_id"] == ""
    assert note["html_asset_id"] == ""
    assert "Legacy note page" in note["html"]

    inline_note_id = _linked_note_record_id("task", "legacy-inline-task")
    project_note_id = _linked_note_record_id("project", "legacy-asset-project")
    inline_note = migrated.get_record("notes", inline_note_id)
    project_note = migrated.get_record("notes", project_note_id)
    assert inline_note is not None
    assert project_note is not None
    assert "Legacy inline task page" in inline_note["html"]
    assert "Legacy project page" in project_note["html"]
    assert any(
        link["target_kind"] == "note" and link["target_id"] == inline_note_id
        for link in inline_task["links"]
    )
    assert any(
        link["target_kind"] == "note" and link["target_id"] == project_note_id
        for link in project["links"]
    )

    migrated._conn.execute("DELETE FROM workspace_meta WHERE key = 'workspace_notes_only_html_v1'")
    migrated._conn.commit()
    migrated.close()

    rerun = WorkspaceStore(str(db_path), clock_ms=clock)
    assert rerun._conn.execute(
        "SELECT COUNT(*) FROM workspace_records WHERE kind = 'note' AND record_id = ?",
        (inline_note_id,),
    ).fetchone()[0] == 1
    assert rerun._conn.execute(
        "SELECT COUNT(*) FROM workspace_links WHERE link_id = ?",
        (_linked_note_link_id("task", "legacy-inline-task"),),
    ).fetchone()[0] == 1
    rerun_note = rerun.get_record("notes", inline_note_id)
    assert rerun_note is not None
    assert "Legacy inline task page" in rerun_note["html"]


def test_reminder_metadata_defaults_and_patch_round_trip(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))
    reminder = store.upsert_record(
        "reminders",
        {
            "id": "proof-reminder",
            "title": "Proof reminder",
            "status": "open",
            "due_at_ms": 25_000,
            "metadata": {"source_kind": "task", "source_id": "proof-task"},
        },
    )

    assert reminder["metadata"]["delivery_state"] == "pending"
    assert reminder["metadata"]["last_fired_at_ms"] == 0
    assert reminder["metadata"]["last_fired_due_at_ms"] == 0
    assert reminder["metadata"]["last_delivery_error"] == ""
    assert reminder["metadata"]["notification_device_id"] == ""
    assert reminder["metadata"]["last_notification_command_id"] == ""
    assert reminder["metadata"]["last_delivery_mode_requested"] == ""
    assert reminder["metadata"]["last_delivery_mode_effective"] == ""
    assert reminder["metadata"]["last_delivery_degraded_to"] == ""
    assert reminder["metadata"]["last_delivery_warnings"] == []
    assert reminder["metadata"]["notification_payload"] == {}
    assert reminder["metadata"]["recipients"] == [{"id": "self", "kind": "self", "contact_id": "", "label": "Me"}]
    assert reminder["metadata"]["destinations"] == [{
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
    }]
    assert reminder["metadata"]["last_delivery_results"] == []
    assert reminder["metadata"]["recurrence"] == {}
    assert reminder["metadata"]["snoozed_until_ms"] == 0

    patched = store.patch_record(
        "reminders",
        "proof-reminder",
        {
            "metadata": {
                "delivery_state": "failed",
                "last_delivery_error": "no_online_device",
                "notification_device_id": "phone-1",
                "last_fired_due_at_ms": 25_000,
                "last_notification_command_id": "cmd_123",
                "last_delivery_mode_requested": "full_screen",
                "last_delivery_mode_effective": "heads_up",
                "last_delivery_degraded_to": "heads_up",
                "last_delivery_warnings": ["full_screen_permission_missing"],
                "recipients": [{"id": "sam-rivera", "kind": "contact", "contact_id": "sam-rivera", "label": "Sam Rivera"}],
                "destinations": [{"channel": "sms", "recipient_ids": ["sam-rivera"], "address": "+14155550168"}],
                "last_delivery_results": [{"channel": "sms", "recipient_id": "sam-rivera", "ok": False, "status": "failed", "detail": "offline"}],
                "recurrence": {"reserved": True},
            }
        },
    )
    assert patched is not None
    assert patched["metadata"]["delivery_state"] == "failed"
    assert patched["metadata"]["last_delivery_error"] == "no_online_device"
    assert patched["metadata"]["notification_device_id"] == "phone-1"
    assert patched["metadata"]["last_fired_due_at_ms"] == 25_000
    assert patched["metadata"]["last_notification_command_id"] == "cmd_123"
    assert patched["metadata"]["last_delivery_mode_requested"] == "full_screen"
    assert patched["metadata"]["last_delivery_mode_effective"] == "heads_up"
    assert patched["metadata"]["last_delivery_degraded_to"] == "heads_up"
    assert patched["metadata"]["last_delivery_warnings"] == ["full_screen_permission_missing"]
    assert patched["metadata"]["recipients"] == [{"id": "sam-rivera", "kind": "contact", "contact_id": "sam-rivera", "label": "Sam Rivera"}]
    assert patched["metadata"]["destinations"][0]["channel"] == "sms"
    assert patched["metadata"]["destinations"][0]["recipient_ids"] == ["sam-rivera"]
    assert patched["metadata"]["last_delivery_results"][0]["channel"] == "sms"
    assert patched["metadata"]["last_delivery_results"][0]["detail"] == "offline"
    assert patched["metadata"]["recurrence"] == {"reserved": True}

    done = store.patch_record("reminders", "proof-reminder", {"status": "done", "metadata": {"snoozed_until_ms": 99}})
    assert done is not None
    assert done["status"] == "done"
    assert done["metadata"]["snoozed_until_ms"] == 0


def test_workspace_store_metadata_cleanup_migration_strips_retired_keys(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    store._conn.execute(
        "UPDATE workspace_records SET metadata_json = ? WHERE kind = 'meeting_note' AND record_id = 'demo-meeting-home-refresh'",
        (
            json.dumps(
                {
                    "participants": ["Maya Chen"],
                    "source": "legacy-calendar",
                    "source_kind": "calendar_event",
                    "extracted_topics": ["paint"],
                }
            ),
        ),
    )
    store._conn.execute(
        "UPDATE workspace_records SET metadata_json = ? WHERE kind = 'task' AND record_id = 'demo-task-do-paint-samples'",
        (
            json.dumps(
                {
                    "owner": "Maya Chen",
                    "project": "Home refresh",
                    "source": "demo-meeting-home-refresh",
                }
            ),
        ),
    )
    store._conn.execute(
        "UPDATE workspace_records SET metadata_json = ? WHERE kind = 'reminder' AND record_id = 'demo-reminder-paint-samples'",
        (
            json.dumps(
                {
                    "source_kind": "task",
                    "source_id": "demo-task-do-paint-samples",
                    "snooze_state": "ready",
                }
            ),
        ),
    )
    store._conn.execute(
        "UPDATE workspace_records SET metadata_json = ? WHERE kind = 'note' AND record_id = 'q4'",
        (
            json.dumps(
                {
                    "context": "All notes",
                    "icon": "pin",
                }
            ),
        ),
    )
    store._conn.execute(
        "UPDATE workspace_records SET metadata_json = ? WHERE kind = 'project' AND record_id = 'aurora'",
        (
            json.dumps(
                {
                    "threads": ["PRD review thread"],
                    "chips": ["keep me"],
                    "assets": ["Legacy brief"],
                }
            ),
        ),
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'workspace_metadata_cleanup_v1'")
    store._conn.commit()
    store.close()

    cleaned = WorkspaceStore(str(db_path), clock_ms=clock)
    meeting = cleaned.get_record("meeting-notes", "demo-meeting-home-refresh")
    task = cleaned.get_record("tasks", "demo-task-do-paint-samples")
    reminder = cleaned.get_record("reminders", "demo-reminder-paint-samples")
    note = cleaned.get_record("notes", "q4")
    project = cleaned.get_record("projects", "aurora")
    assert meeting is not None
    assert task is not None
    assert reminder is not None
    assert note is not None
    assert project is not None
    assert meeting["metadata"]["source_id"] == "legacy-calendar"
    assert "source" not in meeting["metadata"]
    assert "project" not in task["metadata"]
    assert "source" not in task["metadata"]
    assert "snooze_state" not in reminder["metadata"]
    assert "icon" not in note["metadata"]
    assert "assets" not in project["metadata"]
    assert project["metadata"]["chips"] == ["keep me"]


def test_default_seeded_tasks_are_intentional_and_balanced(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"), clock_ms=clock)
    tasks = store.list_records("tasks")["items"]
    counts = {"do": 0, "soon": 0, "overdue": 0, "done": 0}
    for task in tasks:
        counts[str(task["derived_group"])] += 1
    assert counts == {"do": 6, "soon": 2, "overdue": 1, "done": 3}
    assert len(tasks) == 12
    assert all(task["html"] == "" for task in tasks)
    assert all(task["html_asset_id"] == "" for task in tasks)
    assert all(
        any(
            (link["source_kind"] == "task" and link["source_id"] == task["id"] and link["target_kind"] == "note")
            or (link["target_kind"] == "task" and link["target_id"] == task["id"] and link["source_kind"] == "note")
            for link in task["links"]
        )
        for task in tasks
    )


def test_task_records_expose_structured_metadata_and_graph_attached_items(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"), clock_ms=clock)

    task = store.get_record("tasks", "demo-task-do-paint-samples")
    assert task is not None
    assert task["status"] == "todo"
    assert task["created_by"] == "Maya Chen"
    assert task["owner"] == "Maya Chen"
    assert task["description"] == "Set the samples near the window before Maya arrives."
    assert [item["id"] for item in task["checklist"]] == ["paint-stairs", "paint-trim", "paint-photo"]
    assert task["checklist"][0]["done"] is True
    assert task["checklist"][1]["done"] is False

    linked_targets = {(link["target_kind"], link["target_id"]) for link in task["links"] if link["source_kind"] == "task"}
    assert ("calendar_event", "house-walkthrough") in linked_targets
    assert ("contact", "maya") in linked_targets
    assert ("project", "home-refresh") in linked_targets
    assert ("note", "house-paint-notes") in linked_targets


def test_task_owner_can_differ_from_created_by(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))

    record = store.upsert_record(
        "tasks",
        {
            "id": "task-owner-proof",
            "title": "Owner proof",
            "status": "todo",
            "created_by": "Maya Chen",
            "owner": "Sam Rivera",
        },
    )

    assert record["created_by"] == "Maya Chen"
    assert record["owner"] == "Sam Rivera"
    assert record["metadata"]["created_by"] == "Maya Chen"
    assert record["metadata"]["owner"] == "Sam Rivera"


def test_multiple_projects_threads_and_cross_links(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))
    first = store.upsert_record(
        "projects",
        {
            "id": "alpha",
            "title": "Alpha",
            "summary": "First project",
            "metadata": {"threads": ["Alpha kickoff", "Alpha launch"], "chips": ["2 threads"]},
        },
    )
    second = store.upsert_record(
        "projects",
        {
            "id": "beta",
            "title": "Beta",
            "summary": "Second project",
            "metadata": {"threads": ["Beta planning", "Beta risks", "Beta wrap"], "chips": ["3 threads"]},
        },
    )
    store.upsert_record("notes", {"id": "alpha-note", "title": "Alpha Note"})
    link = store.upsert_link(
        {
            "id": "alpha-note-link",
            "source_kind": "project",
            "source_id": "alpha",
            "target_kind": "note",
            "target_id": "alpha-note",
            "label": "Notes",
        }
    )

    assert first["metadata"]["threads"] == ["Alpha kickoff", "Alpha launch"]
    assert second["metadata"]["threads"] == ["Beta planning", "Beta risks", "Beta wrap"]
    assert link["source_id"] == "alpha"
    alpha = store.get_record("projects", "alpha")
    assert alpha is not None
    assert any(item["target_id"] == "alpha-note" for item in alpha["links"])


def test_workspace_store_cleans_legacy_message_records_when_graph_v2_runs(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    record_row = store._conn.execute("SELECT * FROM workspace_records LIMIT 1").fetchone()
    link_row = store._conn.execute("SELECT * FROM workspace_links LIMIT 1").fetchone()
    assert record_row is not None
    assert link_row is not None

    record_template = dict(record_row)
    record_template.update(
        {
            "record_id": "legacy-message",
            "kind": "message",
            "title": "Legacy message",
            "summary": "Experimental message record from the removed app",
            "status": "",
            "event_at_ms": clock.value,
            "html": "<!doctype html><html><body><h1>Legacy message</h1></body></html>",
            "html_asset_id": "",
            "metadata_json": "{}",
            "archived": 0,
            "deleted": 0,
            "created_at_ms": clock.value,
            "updated_at_ms": clock.value,
        }
    )
    columns = list(record_template.keys())
    placeholders = ", ".join("?" for _ in columns)
    store._conn.execute(
        f"INSERT OR REPLACE INTO workspace_records ({', '.join(columns)}) VALUES ({placeholders})",
        tuple(record_template[column] for column in columns),
    )

    link_template = dict(link_row)
    link_template.update(
        {
            "link_id": "legacy-message-link",
            "source_kind": "message",
            "source_id": "legacy-message",
            "target_kind": "note",
            "target_id": "q4",
            "label": "Legacy note",
            "metadata_json": "{}",
            "created_at_ms": clock.value,
            "updated_at_ms": clock.value,
        }
    )
    link_columns = list(link_template.keys())
    link_placeholders = ", ".join("?" for _ in link_columns)
    store._conn.execute(
        f"INSERT OR REPLACE INTO workspace_links ({', '.join(link_columns)}) VALUES ({link_placeholders})",
        tuple(link_template[column] for column in link_columns),
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'seeded_graph_v2'")
    store._conn.commit()
    store._conn.close()

    reseeded = WorkspaceStore(str(db_path), clock_ms=clock)
    assert reseeded._conn.execute("SELECT COUNT(*) FROM workspace_records WHERE kind = 'message'").fetchone()[0] == 0
    assert reseeded._conn.execute("SELECT COUNT(*) FROM workspace_links WHERE source_kind = 'message' OR target_kind = 'message'").fetchone()[0] == 0
    reminders = {item["id"] for item in reseeded.list_records("reminders")["items"]}
    meetings = {item["id"] for item in reseeded.list_records("meeting-notes")["items"]}
    assert "demo-reminder-health-call" in reminders
    assert "demo-meeting-freelance-followup" in meetings


def test_workspace_store_cleans_persisted_proof_records_assets_and_links(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    store.upsert_record(
        "projects",
        {
            "id": "proof-demo-project",
            "title": "Proof Alpha Project",
            "summary": "Should be removed",
        },
    )
    store.upsert_record(
        "contacts",
        {
            "id": "proof-demo-contact",
            "title": "Proof Contact One",
            "summary": "Should be removed",
        },
    )
    store.upsert_record(
        "notes",
        {
            "id": "proof-demo-note",
            "title": "Proof Pinned Note",
            "summary": "Should be removed",
            "pinned": True,
            "html_asset_id": "proof-demo-note-html",
        },
    )
    store.upsert_record(
        "feed-items",
        {
            "id": "proof-demo-feed",
            "title": "Proof Project Decision",
            "summary": "Should be removed",
            "event_at_ms": clock.value,
        },
    )
    store.create_asset(
        {
            "id": "proof-demo-note-html",
            "title": "Proof asset",
            "mime_type": "text/html; charset=utf-8",
            "html": "<!doctype html><h1>Proof</h1>",
        }
    )
    store.upsert_link(
        {
            "id": "proof-demo-link",
            "source_kind": "project",
            "source_id": "proof-demo-project",
            "target_kind": "contact",
            "target_id": "proof-demo-contact",
            "label": "Proof link",
        }
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'proof_cleanup_v1'")
    store._conn.commit()
    store._conn.close()

    cleaned = WorkspaceStore(str(db_path), clock_ms=clock)
    assert cleaned.get_record("projects", "proof-demo-project", include_deleted=True) is None
    assert cleaned.get_record("contacts", "proof-demo-contact", include_deleted=True) is None
    assert cleaned.get_record("notes", "proof-demo-note", include_deleted=True) is None
    assert cleaned.get_record("feed-items", "proof-demo-feed", include_deleted=True) is None
    assert cleaned.get_asset("proof-demo-note-html") is None
    assert cleaned._conn.execute("SELECT COUNT(*) FROM workspace_links WHERE link_id = 'proof-demo-link'").fetchone()[0] == 0
    assert cleaned.get_record("projects", "home-refresh") is not None
    assert cleaned.get_record("contacts", "maya") is not None


def test_workspace_store_cleans_task_proof_records_assets_and_links(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    store.upsert_record(
        "contacts",
        {
            "id": "task-proof-liveuser-contact",
            "title": "Task Proof Contact",
            "summary": "Should be removed",
        },
    )
    store.upsert_record(
        "contacts",
        {
            "id": "task-proof-liveuser-owner-contact",
            "title": "Task Proof Owner",
            "summary": "Should be removed",
        },
    )
    store.upsert_record(
        "tasks",
        {
            "id": "task-proof-liveuser-task",
            "title": "Task Proof Task",
            "summary": "Should be removed",
        },
    )
    store.create_asset(
        {
            "id": "task-proof-liveuser-asset",
            "title": "Task proof asset",
            "mime_type": "text/plain; charset=utf-8",
            "text": "Should be removed",
        }
    )
    store.upsert_link(
        {
            "id": "task-proof-liveuser-link",
            "source_kind": "task",
            "source_id": "task-proof-liveuser-task",
            "target_kind": "contact",
            "target_id": "task-proof-liveuser-contact",
            "label": "Proof contact",
        }
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'task_proof_cleanup_v1'")
    store._conn.commit()
    store._conn.close()

    cleaned = WorkspaceStore(str(db_path), clock_ms=clock)
    assert cleaned.get_record("contacts", "task-proof-liveuser-contact", include_deleted=True) is None
    assert cleaned.get_record("contacts", "task-proof-liveuser-owner-contact", include_deleted=True) is None
    assert cleaned.get_record("tasks", "task-proof-liveuser-task", include_deleted=True) is None
    assert cleaned.get_asset("task-proof-liveuser-asset") is None
    assert cleaned._conn.execute("SELECT COUNT(*) FROM workspace_links WHERE link_id = 'task-proof-liveuser-link'").fetchone()[0] == 0
    meta = cleaned._conn.execute("SELECT value FROM workspace_meta WHERE key = 'task_proof_cleanup_v1'").fetchone()
    assert meta is not None
    assert meta["value"] == "1"
    assert cleaned.get_record("contacts", JIMMY_THOMPSON_CONTACT_ID) is not None


def test_calendar_multi_day_and_feed_archive_visibility(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))
    store.upsert_record("calendar-events", {"id": "d1", "title": "Day one", "date": "2026-06-10", "start_at_ms": 1000})
    store.upsert_record("calendar-events", {"id": "d2", "title": "Day two", "date": "2026-06-11", "start_at_ms": 2000})
    day_one = store.list_records("calendar-events", date="2026-06-10")
    day_two = store.list_records("calendar-events", date="2026-06-11")
    assert [item["id"] for item in day_one["items"] if item["id"] == "d1"] == ["d1"]
    assert [item["id"] for item in day_two["items"] if item["id"] == "d2"] == ["d2"]

    store.upsert_record("feed-items", {"id": "visible", "title": "Visible feed", "event_at_ms": 10})
    store.upsert_record("feed-items", {"id": "archived", "title": "Archived feed", "event_at_ms": 20, "archived": True})
    visible = {item["id"] for item in store.list_records("feed-items")["items"]}
    with_archived = {item["id"] for item in store.list_records("feed-items", include_archived=True)["items"]}
    assert "visible" in visible
    assert "archived" not in visible
    assert "archived" in with_archived


def test_seeded_calendar_week_preserves_places_and_graph_links(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))
    seeded = {item["id"]: item for item in store.list_records("calendar-events")["items"]}
    assert seeded["house-walkthrough"]["title"] == "Front porch repair window"
    assert seeded["clinic-checkin"]["title"] == "Clinic paperwork check-in"
    assert seeded["freelance-review"]["title"] == "Freelance review call"
    assert seeded["forster-dinner"]["title"] == "Dinner with the Forsters"
    assert seeded["katy-handoff"]["title"] == "Katy pickup handoff"
    assert seeded["late-night-design-call"]["title"] == "Late-night design QA call"
    assert seeded["house-walkthrough"]["metadata"]["address"] == "1818 Maple Ave, Oakland, CA 94611"
    assert seeded["clinic-checkin"]["metadata"]["place"] == "Westside Clinic"
    assert seeded["clinic-checkin"]["metadata"]["address"] == "11714 Wilshire Blvd, Suite 12, Los Angeles, CA 90025"
    assert seeded["freelance-review"]["metadata"]["place"] == "Kitchen table"
    assert seeded["katy-handoff"]["metadata"]["place"] == "North field gate"
    assert "https://meet.google.com/" in seeded["late-night-design-call"]["summary"]

    house_links = {
        (row[0], row[1])
        for row in store._conn.execute(
            """
            SELECT target_kind, target_id
            FROM workspace_links
            WHERE source_kind = 'calendar_event' AND source_id = 'house-walkthrough'
            """
        ).fetchall()
    }
    assert ("contact", "maya") in house_links
    assert ("task", "demo-task-do-paint-samples") in house_links
    assert ("note", "house-paint-notes") in house_links
    assert ("project", "home-refresh") in house_links
    assert ("meeting_note", "demo-meeting-home-refresh") in house_links
    assert ("reminder", "demo-reminder-paint-samples") in house_links

    freelance_links = {
        (row[0], row[1])
        for row in store._conn.execute(
            """
            SELECT target_kind, target_id
            FROM workspace_links
            WHERE source_kind = 'calendar_event' AND source_id = 'freelance-review'
            """
        ).fetchall()
    }
    assert ("contact", "sam-rivera") in freelance_links
    assert ("task", "demo-task-send-freelance-mockup") in freelance_links
    assert ("project", "freelance-followup") in freelance_links
    assert ("meeting_note", "demo-meeting-freelance-followup") in freelance_links
    assert ("reminder", "demo-reminder-freelance-followup") in freelance_links

    clinic_links = {
        (row[0], row[1])
        for row in store._conn.execute(
            """
            SELECT target_kind, target_id
            FROM workspace_links
            WHERE source_kind = 'calendar_event' AND source_id = 'clinic-checkin'
            """
        ).fetchall()
    }
    assert ("contact", "clinic-front-desk") in clinic_links
    assert ("note", "clinic-prep-note") in clinic_links
    assert ("reminder", "demo-reminder-health-call") in clinic_links

    late_call_links = {
        (row[0], row[1])
        for row in store._conn.execute(
            """
            SELECT target_kind, target_id
            FROM workspace_links
            WHERE source_kind = 'calendar_event' AND source_id = 'late-night-design-call'
            """
        ).fetchall()
    }
    assert ("note", "freelance-homepage-note") in late_call_links
    assert ("task", "demo-task-send-freelance-mockup") in late_call_links
    assert ("project", "freelance-followup") in late_call_links
    assert ("reminder", "demo-reminder-freelance-followup") in late_call_links


def test_seeded_connected_detail_repair_restores_task_and_reminder_linked_notes(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    cases = [
        ("task", "demo-task-do-paint-samples", "Bring paint samples upstairs"),
        ("reminder", "demo-reminder-paint-samples", "Bring paint samples upstairs"),
    ]
    for source_kind, source_id, expected_title in cases:
        note_id = _linked_note_record_id(source_kind, source_id)
        assert store.get_record("notes", note_id) is not None
        store._conn.execute(
            "DELETE FROM workspace_records WHERE kind = 'note' AND record_id = ?",
            (note_id,),
        )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'seeded_connected_detail_repair_v2'")
    store._conn.commit()
    store.close()

    repaired = WorkspaceStore(str(db_path), clock_ms=clock)
    for source_kind, source_id, expected_title in cases:
        note_id = _linked_note_record_id(source_kind, source_id)
        link_id = _linked_note_link_id(source_kind, source_id)
        note = repaired.get_record("notes", note_id)
        assert note is not None
        assert note["title"] == expected_title
        link = repaired._conn.execute(
            "SELECT target_id, label FROM workspace_links WHERE link_id = ?",
            (link_id,),
        ).fetchone()
        assert link is not None
        assert link["target_id"] == note_id
        assert link["label"] == expected_title
    meta = repaired._conn.execute(
        "SELECT value FROM workspace_meta WHERE key = 'seeded_connected_detail_repair_v2'"
    ).fetchone()
    assert meta is not None
    assert meta["value"] == "1"


def test_seeded_demo_time_refresh_rebases_existing_seeded_records_and_preserves_graph_timing(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    before_house = store.get_record("calendar-events", "house-walkthrough")
    before_roadmap = store.get_record("calendar-events", "roadmap")
    before_task = store.get_record("tasks", "demo-task-do-budget")
    before_reminder = store.get_record("reminders", "demo-reminder-health-call")
    before_feed = store.get_record("feed-items", "calendar-change")
    assert before_house is not None
    assert before_roadmap is not None
    assert before_task is not None
    assert before_reminder is not None
    assert before_feed is not None
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'seeded_demo_time_refresh_v1'")
    store._conn.commit()
    store.close()

    clock.value += 5 * 24 * 60 * 60 * 1000
    expected = _expected_seeded_demo_time_fields(clock.value)
    refreshed = WorkspaceStore(str(db_path), clock_ms=clock)

    for (collection, record_id), expected_fields in expected.items():
        record = refreshed.get_record(collection, record_id)
        assert record is not None, (collection, record_id)
        for field, expected_value in expected_fields.items():
            assert record[field] == expected_value, (collection, record_id, field)

    house_event = refreshed.get_record("calendar-events", "house-walkthrough")
    clinic_event = refreshed.get_record("calendar-events", "clinic-checkin")
    freelance_event = refreshed.get_record("calendar-events", "freelance-review")
    house_meeting = refreshed.get_record("meeting-notes", "demo-meeting-home-refresh")
    freelance_meeting = refreshed.get_record("meeting-notes", "demo-meeting-freelance-followup")
    health_reminder = refreshed.get_record("reminders", "demo-reminder-health-call")
    assert house_event is not None
    assert clinic_event is not None
    assert freelance_event is not None
    assert house_meeting is not None
    assert freelance_meeting is not None
    assert health_reminder is not None

    assert house_event["start_at_ms"] != before_house["start_at_ms"]
    assert refreshed.get_record("calendar-events", "roadmap")["start_at_ms"] != before_roadmap["start_at_ms"]
    assert refreshed.get_record("tasks", "demo-task-do-budget")["due_at_ms"] != before_task["due_at_ms"]
    assert health_reminder["due_at_ms"] != before_reminder["due_at_ms"]
    assert refreshed.get_record("feed-items", "calendar-change")["event_at_ms"] != before_feed["event_at_ms"]

    assert house_meeting["date"] == house_event["date"]
    assert house_meeting["start_at_ms"] == house_event["start_at_ms"]
    assert house_meeting["end_at_ms"] == house_event["end_at_ms"]
    assert freelance_meeting["date"] == freelance_event["date"]
    assert freelance_meeting["end_at_ms"] <= freelance_event["start_at_ms"]
    assert health_reminder["due_at_ms"] < clinic_event["start_at_ms"]

    counts = {"do": 0, "soon": 0, "overdue": 0, "done": 0}
    for task in refreshed.list_records("tasks")["items"]:
        counts[str(task["derived_group"])] += 1
    assert counts == {"do": 6, "soon": 2, "overdue": 1, "done": 3}


def test_seeded_demo_time_refresh_preserves_seeded_edits_skips_deleted_rows_and_is_idempotent(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    store.patch_record(
        "calendar-events",
        "house-walkthrough",
        {"title": "Custom walkthrough title", "summary": "Custom walkthrough summary"},
    )
    store.delete_record("calendar-events", "vendor")
    custom_task = store.upsert_record(
        "tasks",
        {
            "id": "custom-user-task",
            "title": "Custom user task",
            "status": "open",
            "due_at_ms": 123_456_789,
        },
    )
    assert custom_task["due_at_ms"] == 123_456_789
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'seeded_demo_time_refresh_v1'")
    store._conn.commit()
    store.close()

    clock.value += 3 * 24 * 60 * 60 * 1000
    expected = _expected_seeded_demo_time_fields(clock.value)
    refreshed = WorkspaceStore(str(db_path), clock_ms=clock)
    edited = refreshed.get_record("calendar-events", "house-walkthrough")
    deleted = refreshed.get_record("calendar-events", "vendor", include_deleted=True)
    custom = refreshed.get_record("tasks", "custom-user-task")
    assert edited is not None
    assert deleted is not None
    assert custom is not None
    assert edited["title"] == "Custom walkthrough title"
    assert edited["summary"] == "Custom walkthrough summary"
    assert edited["date"] == expected[("calendar-events", "house-walkthrough")]["date"]
    assert edited["start_at_ms"] == expected[("calendar-events", "house-walkthrough")]["start_at_ms"]
    assert edited["end_at_ms"] == expected[("calendar-events", "house-walkthrough")]["end_at_ms"]
    assert deleted["deleted"] is True
    assert refreshed.get_record("calendar-events", "vendor") is None
    assert custom["due_at_ms"] == 123_456_789

    first_due = refreshed.get_record("tasks", "demo-task-do-budget")
    assert first_due is not None
    first_due_at_ms = first_due["due_at_ms"]
    meta = refreshed._conn.execute(
        "SELECT value FROM workspace_meta WHERE key = 'seeded_demo_time_refresh_v1'"
    ).fetchone()
    assert meta is not None
    assert meta["value"] == "1"
    refreshed.close()

    clock.value += 2 * 24 * 60 * 60 * 1000
    rerun = WorkspaceStore(str(db_path), clock_ms=clock)
    rerun_task = rerun.get_record("tasks", "demo-task-do-budget")
    assert rerun_task is not None
    assert rerun_task["due_at_ms"] == first_due_at_ms


def test_seeded_graph_content_refresh_updates_existing_demo_calendar_examples(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    old_house_metadata = {"place": "Home", "attendees": ["Maya Chen"], "type": "home"}
    old_clinic_metadata = {"place": "Westside Clinic", "attendees": ["Clinic front desk"], "type": "health"}
    old_late_metadata = {"place": "Phone", "attendees": ["Sam Rivera"], "type": "call"}
    store._conn.execute(
        "UPDATE workspace_records SET summary = ?, metadata_json = ? WHERE kind = 'calendar_event' AND record_id = 'house-walkthrough'",
        ("Walk the porch list before dinner.", json.dumps(old_house_metadata)),
    )
    store._conn.execute(
        "UPDATE workspace_records SET summary = ?, metadata_json = ? WHERE kind = 'calendar_event' AND record_id = 'clinic-checkin'",
        ("Forms and timing.", json.dumps(old_clinic_metadata)),
    )
    store._conn.execute(
        "UPDATE workspace_records SET summary = ?, metadata_json = ? WHERE kind = 'calendar_event' AND record_id = 'late-night-design-call'",
        ("Timezone-edge check before sending the morning follow-up.", json.dumps(old_late_metadata)),
    )
    store._conn.execute(
        """
        DELETE FROM workspace_links
        WHERE link_id IN (
            'graph-calendar-late-note',
            'graph-calendar-late-task',
            'graph-calendar-late-project',
            'graph-calendar-late-reminder'
        )
        """
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'seeded_graph_content_refresh_v1'")
    store._conn.commit()
    store.close()

    clock.value += 2 * 24 * 60 * 60 * 1000
    refreshed = WorkspaceStore(str(db_path), clock_ms=clock)

    expected = default_workspace_graph_records(clock.value)
    house = refreshed.get_record("calendar-events", "house-walkthrough")
    clinic = refreshed.get_record("calendar-events", "clinic-checkin")
    late_call = refreshed.get_record("calendar-events", "late-night-design-call")
    assert house is not None
    assert clinic is not None
    assert late_call is not None

    assert house["summary"] == next(record["summary"] for record in expected["calendar-events"] if record["id"] == "house-walkthrough")
    assert house["metadata"]["address"] == "1818 Maple Ave, Oakland, CA 94611"
    assert clinic["summary"] == next(record["summary"] for record in expected["calendar-events"] if record["id"] == "clinic-checkin")
    assert clinic["metadata"]["address"] == "11714 Wilshire Blvd, Suite 12, Los Angeles, CA 90025"
    assert late_call["summary"] == next(record["summary"] for record in expected["calendar-events"] if record["id"] == "late-night-design-call")
    assert "https://meet.google.com/qas-dsgn-late" in late_call["summary"]

    late_call_links = {
        (row[0], row[1])
        for row in refreshed._conn.execute(
            """
            SELECT target_kind, target_id
            FROM workspace_links
            WHERE source_kind = 'calendar_event' AND source_id = 'late-night-design-call'
            """
        ).fetchall()
    }
    assert ("note", "freelance-homepage-note") in late_call_links
    assert ("task", "demo-task-send-freelance-mockup") in late_call_links
    assert ("project", "freelance-followup") in late_call_links
    assert ("reminder", "demo-reminder-freelance-followup") in late_call_links

    meta = refreshed._conn.execute(
        "SELECT value FROM workspace_meta WHERE key = 'seeded_graph_content_refresh_v1'"
    ).fetchone()
    assert meta is not None
    assert meta["value"] == "1"


def test_seeded_reminder_connected_graph_refresh_restores_seeded_reminder_links(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    db_path = tmp_path / "workspace.sqlite3"
    store = WorkspaceStore(str(db_path), clock_ms=clock)
    store.patch_record(
        "reminders",
        "demo-reminder-health-call",
        {"summary": "Custom clinic reminder summary"},
    )
    store._conn.execute(
        """
        DELETE FROM workspace_links
        WHERE link_id IN (
            'graph-reminder-health-contact',
            'graph-reminder-health-calendar',
            'graph-reminder-health-note',
            'graph-reminder-paint-task',
            'graph-reminder-paint-meeting',
            'graph-reminder-note-note',
            'graph-reminder-note-feed',
            'graph-reminder-freelance-task',
            'graph-reminder-freelance-meeting'
        )
        """
    )
    store._conn.execute("DELETE FROM workspace_meta WHERE key = 'seeded_reminder_connected_graph_v1'")
    store._conn.commit()
    store.close()

    clock.value += 60_000
    refreshed = WorkspaceStore(str(db_path), clock_ms=clock)

    health_links = {
        (row[0], row[1])
        for row in refreshed._conn.execute(
            """
            SELECT target_kind, target_id
            FROM workspace_links
            WHERE source_kind = 'reminder' AND source_id = 'demo-reminder-health-call'
            """
        ).fetchall()
    }
    assert ("contact", "clinic-front-desk") in health_links
    assert ("calendar_event", "clinic-checkin") in health_links
    assert ("note", "clinic-prep-note") in health_links

    paint_links = {
        (row[0], row[1])
        for row in refreshed._conn.execute(
            """
            SELECT target_kind, target_id
            FROM workspace_links
            WHERE source_kind = 'reminder' AND source_id = 'demo-reminder-paint-samples'
            """
        ).fetchall()
    }
    assert ("task", "demo-task-do-paint-samples") in paint_links
    assert ("meeting_note", "demo-meeting-home-refresh") in paint_links

    note_links = {
        (row[0], row[1])
        for row in refreshed._conn.execute(
            """
            SELECT target_kind, target_id
            FROM workspace_links
            WHERE source_kind = 'reminder' AND source_id = 'demo-reminder-book-note'
            """
        ).fetchall()
    }
    assert ("note", "clinic-prep-note") in note_links
    assert ("feed_item", "calendar-change") in note_links

    freelance_links = {
        (row[0], row[1])
        for row in refreshed._conn.execute(
            """
            SELECT target_kind, target_id
            FROM workspace_links
            WHERE source_kind = 'reminder' AND source_id = 'demo-reminder-freelance-followup'
            """
        ).fetchall()
    }
    assert ("task", "demo-task-send-freelance-mockup") in freelance_links
    assert ("meeting_note", "demo-meeting-freelance-followup") in freelance_links

    health_reminder = refreshed.get_record("reminders", "demo-reminder-health-call")
    assert health_reminder is not None
    assert health_reminder["summary"] == "Custom clinic reminder summary"

    meta = refreshed._conn.execute(
        "SELECT value FROM workspace_meta WHERE key = 'seeded_reminder_connected_graph_v1'"
    ).fetchone()
    assert meta is not None
    assert meta["value"] == "1"


def test_self_contact_is_seeded_editable_and_cannot_be_deleted(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))

    contacts = store.list_records("contacts")
    assert contacts["items"]
    me = store.get_record("contacts", SELF_CONTACT_ID)
    assert me is not None
    assert me["id"] == SELF_CONTACT_ID
    assert me["html"] == ""
    assert me["html_asset_id"] == ""
    assert me["metadata"]["is_self"] is True
    assert me["metadata"]["avatar"] == "M"

    updated = store.patch_record(
        "contacts",
        SELF_CONTACT_ID,
        {
            "metadata": {
                "first_name": "Jordan",
                "last_name": "Taylor",
            }
        },
    )
    assert updated is not None
    assert updated["title"] == "Jordan Taylor"
    assert updated["metadata"]["display_name"] == "Jordan Taylor"
    assert updated["metadata"]["avatar"] == "JT"

    updated = store.patch_record(
        "contacts",
        SELF_CONTACT_ID,
        {
            "metadata": {
                "first_name": "Updated",
                "last_name": "Proof Contact",
            }
        },
    )
    assert updated is not None
    assert updated["title"] == "Updated Proof Contact"
    assert updated["metadata"]["display_name"] == "Updated Proof Contact"
    assert updated["metadata"]["avatar"] == "UC"

    updated = store.patch_record(
        "contacts",
        SELF_CONTACT_ID,
        {
            "metadata": {
                "email": "me@example.com",
                "phone": "+14155550123",
                "notification_device_id": "phone-1",
            }
        },
    )
    assert updated is not None
    assert updated["metadata"]["email"] == "me@example.com"
    assert updated["metadata"]["phone"] == "+14155550123"
    assert updated["metadata"]["notification_device_id"] == "phone-1"

    deleted = store.delete_record("contacts", SELF_CONTACT_ID)
    assert deleted is not None
    assert deleted["id"] == SELF_CONTACT_ID
    assert deleted["archived"] is False
    assert deleted["deleted"] is False

    preserved = store.patch_record("contacts", SELF_CONTACT_ID, {"archived": True, "deleted": True})
    assert preserved is not None
    assert preserved["id"] == SELF_CONTACT_ID
    assert preserved["archived"] is False
    assert preserved["deleted"] is False


def test_derive_task_group_boundaries() -> None:
    assert derive_task_group({"status": "done", "due_at_ms": 1}, 100) == "done"
    assert derive_task_group({"status": "open", "due_at_ms": 99}, 100) == "overdue"
    assert derive_task_group({"status": "open", "due_at_ms": 1000}, 100) == "do"
    assert derive_task_group({"status": "open", "due_at_ms": 100 + 48 * 60 * 60 * 1000}, 100) == "soon"
