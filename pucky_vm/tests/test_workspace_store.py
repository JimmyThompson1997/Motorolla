from __future__ import annotations

from pathlib import Path

from pucky_vm.workspace_store import SELF_CONTACT_ID, WorkspaceStore, derive_task_group


class Clock:
    def __init__(self, value: int) -> None:
        self.value = value

    def __call__(self) -> int:
        return self.value


def test_workspace_store_seeds_and_round_trips_html_assets(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"), clock_ms=clock)

    notes = store.list_records("notes")
    assert notes["count"] >= 3
    assert notes["items"][0]["pinned"] is True

    asset = store.create_asset(
        {
            "id": "proof-html",
            "title": "Proof page",
            "mime_type": "text/html; charset=utf-8",
            "html": "<!doctype html><h1>Proof</h1>",
        }
    )
    assert asset["asset_id"] == "proof-html"
    assert "<h1>Proof</h1>" in asset["text"]

    note = store.upsert_record(
        "notes",
        {
            "id": "proof-note",
            "title": "Proof Note",
            "summary": "Created by test",
            "pinned": True,
            "html_asset_id": "proof-html",
            "metadata": {"context": "Tests"},
        },
    )
    assert note["title"] == "Proof Note"
    assert note["metadata"]["context"] == "Tests"


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


def test_task_records_support_inline_html_asset_html_and_empty_html(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))
    asset = store.create_asset(
        {
            "id": "task-proof-html",
            "title": "Task proof page",
            "mime_type": "text/html; charset=utf-8",
            "html": "<!doctype html><html><body><h1>Asset task</h1><p>Asset-backed task page.</p><ul><li>One</li></ul></body></html>",
        }
    )

    inline_task = store.upsert_record(
        "tasks",
        {
            "id": "inline-task",
            "title": "Inline task",
            "status": "open",
            "due_at_ms": 2_000,
            "html": "<!doctype html><html><body><h1>Inline task</h1><p>Inline HTML body.</p></body></html>",
        },
    )
    asset_task = store.upsert_record(
        "tasks",
        {
            "id": "asset-task",
            "title": "Asset task",
            "status": "open",
            "due_at_ms": 3_000,
            "html_asset_id": asset["asset_id"],
        },
    )
    empty_task = store.upsert_record(
        "tasks",
        {
            "id": "empty-task",
            "title": "Empty task",
            "status": "open",
            "due_at_ms": 4_000,
        },
    )

    assert inline_task["html"].startswith("<!doctype html>")
    assert inline_task["html_asset_id"] == ""
    assert asset_task["html"] == ""
    assert asset_task["html_asset_id"] == "task-proof-html"
    assert empty_task["html"] == ""
    assert empty_task["html_asset_id"] == ""


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


def test_default_seeded_tasks_are_intentional_and_balanced(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"), clock_ms=clock)
    tasks = store.list_records("tasks")["items"]
    counts = {"do": 0, "soon": 0, "overdue": 0, "done": 0}
    for task in tasks:
        counts[str(task["derived_group"])] += 1
    assert counts == {"do": 6, "soon": 2, "overdue": 1, "done": 3}
    assert len(tasks) == 12
    assert all(task["html"] for task in tasks)


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
    assert seeded["clinic-checkin"]["metadata"]["place"] == "Westside Clinic"
    assert seeded["freelance-review"]["metadata"]["place"] == "Kitchen table"
    assert seeded["katy-handoff"]["metadata"]["place"] == "North field gate"

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


def test_me_contact_is_seeded_first_and_cannot_be_deleted(tmp_path: Path) -> None:
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"))

    contacts = store.list_records("contacts")
    assert contacts["items"]
    assert contacts["items"][0]["id"] == SELF_CONTACT_ID
    assert contacts["items"][0]["title"] == "Me"
    assert contacts["items"][0]["metadata"]["is_self"] is True

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
