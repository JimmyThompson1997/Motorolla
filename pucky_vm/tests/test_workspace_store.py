from __future__ import annotations

from pathlib import Path

from pucky_vm.workspace_store import WorkspaceStore, derive_task_group


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
            }
        },
    )
    assert patched is not None
    assert patched["metadata"]["delivery_state"] == "failed"
    assert patched["metadata"]["last_delivery_error"] == "no_online_device"
    assert patched["metadata"]["notification_device_id"] == "phone-1"
    assert patched["metadata"]["last_fired_due_at_ms"] == 25_000

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
    assert counts == {"do": 4, "soon": 4, "overdue": 3, "done": 3}
    assert len(tasks) == 14
    assert all(task["html"] for task in tasks)


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


def test_derive_task_group_boundaries() -> None:
    assert derive_task_group({"status": "done", "due_at_ms": 1}, 100) == "done"
    assert derive_task_group({"status": "open", "due_at_ms": 99}, 100) == "overdue"
    assert derive_task_group({"status": "open", "due_at_ms": 1000}, 100) == "do"
    assert derive_task_group({"status": "open", "due_at_ms": 100 + 48 * 60 * 60 * 1000}, 100) == "soon"
