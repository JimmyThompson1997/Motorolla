from __future__ import annotations

import json
from pathlib import Path

import pytest

import tools.proofs.workspace.task_workspace_phone_real_vm_proof as phone_proof


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
        "ownerContactId": "contact-owner-1",
        "projectId": "project-1",
        "noteId": "note-1",
        "calendarEventTitle": "Task Proof Event",
        "contactTitle": "Task Proof Contact",
        "ownerContactTitle": "Task Proof Owner",
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


def test_parse_args_defaults_broker_to_official_vm(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("PUCKY_BROKER_URL", raising=False)
    monkeypatch.delenv("PUCKY_OPERATOR_TOKEN", raising=False)
    monkeypatch.delenv("PUCKY_API_TOKEN", raising=False)

    args = phone_proof.parse_args(["--browser-summary", str(make_browser_summary(tmp_path))])

    assert args.broker == phone_proof.official_html.DEFAULT_VM_BASE_URL


def test_parse_args_uses_api_token_when_present(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("PUCKY_API_TOKEN", "api-token")
    monkeypatch.setenv("PUCKY_OPERATOR_TOKEN", "operator-token")

    args = phone_proof.parse_args(["--browser-summary", str(make_browser_summary(tmp_path))])

    assert args.token == "api-token"


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


def test_task_section_labels_preserve_rendered_order() -> None:
    state = {
        "sections": [
            {"group": "do", "label": "Today", "rowIds": ["task-b"]},
            {"group": "overdue", "label": "Overdue", "rowIds": ["task-a"]},
            {"group": "soon", "label": "Upcoming", "rowIds": ["task-c"]},
            {"group": "done", "label": "Done", "rowIds": ["task-d"]},
        ],
    }

    assert phone_proof.task_section_labels(state) == ["Today", "Overdue", "Upcoming", "Done"]


def test_verify_task_section_order_requires_today_before_overdue() -> None:
    phone_proof.verify_task_section_order({"sections": [{"label": "Today"}, {"label": "Overdue"}, {"label": "Upcoming"}, {"label": "Done"}]})

    with pytest.raises(phone_proof.TaskPhoneProofError, match="Today / Overdue / Upcoming / Done"):
        phone_proof.verify_task_section_order({"sections": [{"label": "Overdue"}, {"label": "Today"}, {"label": "Upcoming"}, {"label": "Done"}]})


def test_task_archive_selectors_map_to_bulk_and_detail_actions() -> None:
    assert phone_proof.task_bulk_select_button_selector() == ".light-page-header .light-task-select-toggle"
    assert phone_proof.task_bulk_archive_button_selector() == ".light-task-bulk-archive"
    assert phone_proof.task_detail_actions_selector() == ".light-task-detail-action-trigger"
    assert phone_proof.task_detail_archive_selector() == '.settings-selector-option[data-selector-value="archive_task"]'


def test_phone_task_proof_source_requires_checklist_autodone_and_reopen() -> None:
    source = Path(phone_proof.__file__).read_text(encoding="utf-8")

    assert 'assert_or_fail(str(task_after_checklist.get("status") or "") == "done"' in source
    assert 'assert_or_fail(int(task_after_checklist.get("completed_at_ms") or 0) > 0' in source
    assert 'assert_or_fail(str(task_after_reopen.get("status") or "") == "in_progress"' in source
    assert 'assert_or_fail(not bool(task_after_reopen.get("completed_at_ms"))' in source
    assert '"status_after_toggle": task_after_checklist.get("status")' in source
    assert '"completed_at_ms_after_toggle": task_after_checklist.get("completed_at_ms")' in source
    assert '"status_after_reopen": task_after_reopen.get("status")' in source
    assert '"completed_at_ms_after_reopen": task_after_reopen.get("completed_at_ms")' in source
    assert 'assert_or_fail(int(task_record.get("completed_at_ms") or 0) > completed_after_checklist' in source
    assert "Select tasks" in source
    assert "Archive task" in source
    assert "verify_task_section_order" in source
    assert "task_bulk_archive_button_selector" in source
    assert "task_detail_archive_selector" in source


def test_fetch_task_record_accepts_wrapped_or_direct_record_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    wrapped_payload = {"task": {"id": "task-1", "title": "Wrapped task"}}
    direct_payload = {"schema": "pucky.workspace.record.v1", "id": "task-2", "title": "Direct task"}

    monkeypatch.setattr(phone_proof, "api_json", lambda *_args, **_kwargs: wrapped_payload)
    assert phone_proof.fetch_task_record("https://example.invalid", "token", "task-1") == wrapped_payload["task"]

    monkeypatch.setattr(phone_proof, "api_json", lambda *_args, **_kwargs: direct_payload)
    assert phone_proof.fetch_task_record("https://example.invalid", "token", "task-2") == direct_payload


def test_patch_task_record_accepts_wrapped_or_direct_record_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    wrapped_payload = {"task": {"id": "task-1", "title": "Wrapped task"}}
    direct_payload = {"schema": "pucky.workspace.record.v1", "id": "task-2", "title": "Direct task"}

    monkeypatch.setattr(phone_proof, "api_json", lambda *_args, **_kwargs: wrapped_payload)
    assert phone_proof.patch_task_record("https://example.invalid", "token", "task-1", {"status": "done"}) == wrapped_payload["task"]

    monkeypatch.setattr(phone_proof, "api_json", lambda *_args, **_kwargs: direct_payload)
    assert phone_proof.patch_task_record("https://example.invalid", "token", "task-2", {"status": "done"}) == direct_payload


def test_verify_primary_detail_state_requires_structured_fields(tmp_path: Path) -> None:
    seed = load_seed(tmp_path)
    state = {
        "taskDetailId": "task-1",
        "hasTaskHtmlFrame": False,
        "hasDescriptionSection": True,
        "hasPeopleSection": False,
        "hasChecklistSection": True,
        "hasNotesSection": False,
        "hasConnectedSection": True,
        "hasAttachedSection": False,
        "connectedRowCount": 4,
        "hasTaskPersonChips": False,
        "hasTaskConnectedChips": False,
        "statusHeaderPresent": True,
        "statusCirclePresent": True,
        "detailActionPresent": True,
        "title": "Task Proof Primary",
        "people": [],
        "connected": [
            {"kind": "note", "hasIcon": True, "uses_small_icon": True, "recency_ms": 400},
            {"kind": "calendar_event", "hasIcon": True, "uses_small_icon": True, "recency_ms": 300},
            {"kind": "contact", "hasIcon": True, "uses_small_icon": True, "recency_ms": 200},
            {"kind": "project", "hasIcon": True, "uses_small_icon": True, "recency_ms": 100},
        ],
    }

    phone_proof.verify_primary_detail_state(state, seed)

    with pytest.raises(phone_proof.TaskPhoneProofError, match="legacy task HTML"):
        phone_proof.verify_primary_detail_state({**state, "hasTaskHtmlFrame": True}, seed)

    with pytest.raises(phone_proof.TaskPhoneProofError, match="task actions control"):
        phone_proof.verify_primary_detail_state({
            **state,
            "detailActionPresent": False,
        }, seed)

    with pytest.raises(phone_proof.TaskPhoneProofError, match="Connected rows were not sorted by recency descending"):
        phone_proof.verify_primary_detail_state({
            **state,
            "connected": [
                {"kind": "note", "hasIcon": True, "uses_small_icon": True, "recency_ms": 100},
                {"kind": "calendar_event", "hasIcon": True, "uses_small_icon": True, "recency_ms": 300},
                {"kind": "contact", "hasIcon": True, "uses_small_icon": True, "recency_ms": 200},
                {"kind": "project", "hasIcon": True, "uses_small_icon": True, "recency_ms": 50},
            ],
        }, seed)
