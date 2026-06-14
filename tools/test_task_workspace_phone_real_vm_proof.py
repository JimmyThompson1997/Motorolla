from __future__ import annotations

import json
from pathlib import Path

import pytest

import tools.task_workspace_phone_real_vm_proof as phone_proof


def make_browser_summary(tmp_path: Path, *, ok: bool = True) -> Path:
    seed_manifest = tmp_path / "seed_manifest.json"
    seed_manifest.write_text(json.dumps({
        "schema": phone_proof.TASK_SEED_SCHEMA,
        "primaryTaskId": "task-1",
        "emptyTaskId": "task-2",
        "overdueTaskId": "task-3",
        "inProgressTaskId": "task-4",
        "waitingTaskId": "task-5",
        "doneTaskId": "task-6",
        "calendarEventId": "event-1",
        "contactId": "contact-1",
        "projectId": "project-1",
        "noteId": "note-1",
        "calendarEventTitle": "Task Proof Event",
        "contactTitle": "Task Proof Contact",
        "projectTitle": "Task Proof Project",
        "noteTitle": "Task Proof Note",
        "primaryTaskTitle": "Task Proof Primary",
        "primaryDescription": "Desc",
        "createdBy": "Task Proof Contact",
        "primaryChecklist": [{"id": "check-1", "label": "Check 1", "done": False}],
    }), encoding="utf-8")
    summary = tmp_path / "summary.json"
    summary.write_text(json.dumps({
        "schema": phone_proof.TASK_BROWSER_SUMMARY_SCHEMA,
        "ok": ok,
        "source_commit_full": "abcdef",
        "ui_version": "git-abcdef0",
        "remote_manifest": {
            "source_commit_full": "abcdef",
            "ui_version": "git-abcdef0",
        },
        "seed_manifest_path": str(seed_manifest),
    }), encoding="utf-8")
    return summary


def load_seed(tmp_path: Path) -> dict[str, object]:
    summary = phone_proof.load_browser_summary(make_browser_summary(tmp_path))
    return phone_proof.load_seed_manifest(summary)


def test_load_browser_summary_requires_green_task_proof(tmp_path: Path) -> None:
    with pytest.raises(phone_proof.TaskPhoneProofError, match="Browser summary must be a green task workspace proof result"):
        phone_proof.load_browser_summary(make_browser_summary(tmp_path, ok=False))


def test_load_seed_manifest_reads_path_from_browser_summary(tmp_path: Path) -> None:
    seed = load_seed(tmp_path)

    assert seed["schema"] == phone_proof.TASK_SEED_SCHEMA
    assert seed["primaryTaskId"] == "task-1"


def test_validate_browser_summary_matches_local_checks_commit_and_ui_version(tmp_path: Path) -> None:
    summary = phone_proof.load_browser_summary(make_browser_summary(tmp_path))
    remote_manifest = {"ui_version": "git-abcdef0"}
    local_git = {"head": "abcdef"}

    phone_proof.validate_browser_summary_matches_local(summary, local_git=local_git, remote_manifest=remote_manifest)

    with pytest.raises(phone_proof.TaskPhoneProofError, match="commit does not match"):
        phone_proof.validate_browser_summary_matches_local(
            summary,
            local_git={"head": "other"},
            remote_manifest=remote_manifest,
        )

    with pytest.raises(phone_proof.TaskPhoneProofError, match="ui_version does not match"):
        phone_proof.validate_browser_summary_matches_local(
            summary,
            local_git=local_git,
            remote_manifest={"ui_version": "git-other"},
        )


def test_expected_link_specs_map_seed_ids_titles_and_routes(tmp_path: Path) -> None:
    seed = load_seed(tmp_path)

    specs = phone_proof.expected_link_specs(seed)

    assert specs == [
        {"kind": "calendar_event", "route": "meeting-detail", "title": "Task Proof Event", "record_id": "event-1"},
        {"kind": "contact", "route": "contact-detail", "title": "Task Proof Contact", "record_id": "contact-1"},
        {"kind": "project", "route": "project-detail", "title": "Task Proof Project", "record_id": "project-1"},
        {"kind": "note", "route": "note-detail", "title": "Task Proof Note", "record_id": "note-1"},
    ]


def test_group_for_task_and_visible_task_ids_use_rendered_sections() -> None:
    state = {
        "sections": [
            {"group": "overdue", "rowIds": ["task-a"]},
            {"group": "do", "rowIds": ["task-b", "task-c"]},
        ]
    }

    assert phone_proof.visible_task_ids(state) == {"task-a", "task-b", "task-c"}
    assert phone_proof.group_for_task(state, "task-b") == "do"
    assert phone_proof.group_for_task(state, "missing") == ""


def test_verify_filter_state_checks_active_filter_and_hidden_rows() -> None:
    state = {
        "filters": [
            {"key": "all", "active": False},
            {"key": "todo", "active": True},
        ],
        "sections": [
            {"group": "overdue", "rowIds": ["task-a"]},
            {"group": "do", "rowIds": ["task-b"]},
        ],
    }

    phone_proof.verify_filter_state(state, filter_key="todo", present=["task-a"], absent=["task-z"])

    with pytest.raises(phone_proof.TaskPhoneProofError, match="Expected active task filter done"):
        phone_proof.verify_filter_state(state, filter_key="done", present=[], absent=[])


def test_verify_primary_detail_state_requires_structured_fields(tmp_path: Path) -> None:
    seed = load_seed(tmp_path)
    state = {
        "taskDetailId": "task-1",
        "hasTaskHtmlFrame": False,
        "hasDescriptionSection": True,
        "hasChecklistSection": True,
        "hasAttachedSection": True,
        "attachedChipIconCount": 4,
        "title": "Task Proof Primary",
        "createdBy": {
            "route": "contact-detail",
            "id": "contact-1",
        },
    }

    phone_proof.verify_primary_detail_state(state, seed)

    with pytest.raises(phone_proof.TaskPhoneProofError, match="legacy task HTML"):
        phone_proof.verify_primary_detail_state({**state, "hasTaskHtmlFrame": True}, seed)
