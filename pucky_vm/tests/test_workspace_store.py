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


def test_default_seeded_tasks_are_intentional_and_balanced(tmp_path: Path) -> None:
    clock = Clock(1_800_000_000_000)
    store = WorkspaceStore(str(tmp_path / "workspace.sqlite3"), clock_ms=clock)
    tasks = store.list_records("tasks")["items"]
    counts = {"do": 0, "soon": 0, "overdue": 0, "done": 0}
    for task in tasks:
        counts[str(task["derived_group"])] += 1
    assert counts == {"do": 4, "soon": 3, "overdue": 3, "done": 3}
    assert len(tasks) == 13
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
