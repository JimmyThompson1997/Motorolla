from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import tools.support.phone_proof_shared as phone_shared
import tools.proofs.phone.phone_walkie_thread_proof as proof
import tools.refresh_pucky_html_official as official_html

CANONICAL_REPO_ROOT = Path(r"C:\Users\jimmy\Desktop\Motorolla-master-ui")
RESULT_SCHEMA = "pucky.task_workspace_phone_real_vm_proof.v1"
TASK_BROWSER_SUMMARY_SCHEMA = "pucky.task_workspace_live_vm_proof.v1"
TASK_SEED_SCHEMA = "pucky.task_workspace_seed_manifest.v1"
DEFAULT_ACTIVITY_NAME = "com.pucky.device.CoverHomeActivity"


class TaskPhoneProofError(RuntimeError):
    def __init__(self, message: str, *, category: str = "phone_task_proof_failed") -> None:
        super().__init__(message)
        self.category = category


def fail(category: str, message: str) -> None:
    raise TaskPhoneProofError(message, category=category)


def assert_or_fail(condition: bool, category: str, message: str) -> None:
    if not condition:
        fail(category, message)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the real-phone Tasks proof against the live VM-served WebView bundle.")
    parser.add_argument("--browser-summary", type=Path, required=True)
    parser.add_argument("--serial", default=os.environ.get("PUCKY_PHONE_SERIAL", ""))
    parser.add_argument("--device-id", default=os.environ.get("PUCKY_DEVICE_ID", "pucky-cover-task-phone"))
    parser.add_argument("--token", default=os.environ.get("PUCKY_API_TOKEN", ""))
    parser.add_argument("--vm-base-url", default=official_html.DEFAULT_VM_BASE_URL)
    parser.add_argument("--manifest-url", default="")
    parser.add_argument("--evidence-dir", type=Path, default=ROOT / ".tmp" / "task-workspace-phone-proof")
    parser.add_argument("--repo-root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--canonical-root", type=Path, default=CANONICAL_REPO_ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--adb", type=Path, default=Path(r"C:\Users\jimmy\Desktop\Android\tools\android-sdk\platform-tools\adb.exe"), help=argparse.SUPPRESS)
    parser.add_argument("--broker", default=os.environ.get("PUCKY_BROKER_URL") or official_html.DEFAULT_VM_BASE_URL, help=argparse.SUPPRESS)
    parser.add_argument("--puckyctl", type=Path, default=ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py", help=argparse.SUPPRESS)
    parser.add_argument("--node", type=Path, default=proof.bundled_node_executable(), help=argparse.SUPPRESS)
    parser.add_argument("--node-modules", type=Path, default=proof.bundled_node_modules(), help=argparse.SUPPRESS)
    parser.add_argument("--browser-helper", type=Path, default=ROOT / "tools" / "proofs" / "workspace" / "task_workspace_phone_real_vm_browser.js", help=argparse.SUPPRESS)
    parser.add_argument("--package-name", default=proof.DEFAULT_PACKAGE_NAME)
    parser.add_argument("--activity-name", default=DEFAULT_ACTIVITY_NAME)
    parser.add_argument("--browser-timeout-seconds", type=int, default=60)
    parser.add_argument("--command-timeout-seconds", type=int, default=120)
    parser.add_argument("--devtools-port", type=int, default=9222)
    parser.add_argument("--filter-only", action="store_true")
    args = parser.parse_args(argv)
    args.browser_summary = args.browser_summary.resolve()
    args.repo_root = args.repo_root.resolve()
    args.canonical_root = args.canonical_root.resolve()
    args.evidence_dir = args.evidence_dir.resolve()
    args.browser_helper = args.browser_helper.resolve()
    args.puckyctl = args.puckyctl.resolve()
    args.node = args.node.resolve() if isinstance(args.node, Path) and args.node.exists() else args.node
    args.node_modules = args.node_modules.resolve()
    args.adb = args.adb.resolve() if isinstance(args.adb, Path) and args.adb.exists() else args.adb
    args.vm_base_url = str(args.vm_base_url).rstrip("/")
    args.manifest_url = str(args.manifest_url or official_html.urljoin(args.vm_base_url + "/", official_html.DEFAULT_MANIFEST_PATH.lstrip("/")))
    return args


def resolve_api_token(explicit_token: str = "") -> str:
    token = str(explicit_token or "").strip()
    if token:
        return token
    return str(os.environ.get("PUCKY_API_TOKEN", "")).strip()


def load_browser_summary(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema") != TASK_BROWSER_SUMMARY_SCHEMA or payload.get("ok") is not True:
        fail("browser_preproof_failed", "Browser summary must be a green task workspace proof result")
    return payload


def load_seed_manifest(browser_summary: dict[str, Any]) -> dict[str, Any]:
    seed_manifest_path = Path(str(browser_summary.get("seed_manifest_path") or "")).expanduser()
    if not seed_manifest_path.exists():
        fail("browser_preproof_failed", "Browser summary is missing a valid seed_manifest_path")
    payload = json.loads(seed_manifest_path.read_text(encoding="utf-8"))
    if payload.get("schema") != TASK_SEED_SCHEMA:
        fail("browser_preproof_failed", "Seed manifest schema is invalid")
    return payload


def validate_browser_summary_matches_local(
    browser_summary: dict[str, Any],
    *,
    local_git: dict[str, object],
    remote_manifest: dict[str, Any],
) -> None:
    if str(browser_summary.get("source_commit_full") or "") != str(local_git["head"]):
        fail("browser_evidence_mismatch", "Browser proof commit does not match local master HEAD")
    if str(browser_summary.get("ui_version") or "") != str(remote_manifest.get("ui_version") or ""):
        fail("browser_evidence_mismatch", "Browser proof ui_version does not match the live VM manifest")
    browser_manifest = browser_summary.get("remote_manifest") or {}
    if str(browser_manifest.get("source_commit_full") or "") != str(local_git["head"]):
        fail("browser_evidence_mismatch", "Browser proof remote manifest commit does not match local master HEAD")
    if str(browser_manifest.get("ui_version") or "") != str(remote_manifest.get("ui_version") or ""):
        fail("browser_evidence_mismatch", "Browser proof remote manifest ui_version does not match the live VM manifest")


def verify_html_target_identity(
    *,
    local_git: dict[str, object],
    remote_manifest: dict[str, Any],
    bundle: dict[str, Any],
    surface: dict[str, Any],
    installed_package: dict[str, str],
    identity: dict[str, Any],
) -> dict[str, Any]:
    checks = {
        "local_head_matches_upstream": str(local_git.get("head") or "") == str(local_git.get("upstream") or ""),
        "bundle_installed": bool(bundle.get("installed")),
        "apk_git_dirty_false": bool(identity.get("git_dirty")) is False,
        "package_version_name_matches_identity": str(installed_package.get("version_name") or "") == str(identity.get("version_name") or ""),
        "package_version_code_matches_identity": str(installed_package.get("version_code") or "") == str(identity.get("version_code") or ""),
        "bundle_ui_version_matches_manifest": str(bundle.get("ui_version") or "") == str(remote_manifest.get("ui_version") or ""),
        "surface_ui_version_matches_manifest": str(surface.get("ui_version") or "") == str(remote_manifest.get("ui_version") or ""),
    }
    result = proof.scenario_checks(checks)
    if not result["passed"]:
        fail("phone_task_proof_failed", f"target identity mismatch: {json.dumps(result['checks'], sort_keys=True)}")
    return result


def api_json(base_url: str, token: str, path_name: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}{path_name}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="ignore")
        raise TaskPhoneProofError(f"{method} {path_name} failed: HTTP {error.code}: {payload}", category="browser_preproof_failed") from error


def fetch_task_record(base_url: str, token: str, task_id: str) -> dict[str, Any]:
    payload = api_json(base_url, token, f"/api/workspace/tasks/{urllib.parse.quote(task_id)}")
    task = payload.get("task")
    if not isinstance(task, dict) and payload.get("schema") == "pucky.workspace.record.v1":
        task = payload
    if not isinstance(task, dict):
        fail("browser_preproof_failed", f"Workspace API did not return a task record for {task_id}")
    return task


def patch_task_record(base_url: str, token: str, task_id: str, body: dict[str, Any]) -> dict[str, Any]:
    payload = api_json(base_url, token, f"/api/workspace/tasks/{urllib.parse.quote(task_id)}", method="PATCH", body=body)
    task = payload.get("task")
    if not isinstance(task, dict) and payload.get("schema") == "pucky.workspace.record.v1":
        task = payload
    if not isinstance(task, dict):
        fail("browser_preproof_failed", f"Workspace API did not return a patched task record for {task_id}")
    return task


def visible_task_ids(state: dict[str, Any]) -> set[str]:
    visible: set[str] = set()
    for section in list(state.get("sections") or []):
        if not isinstance(section, dict):
            continue
        for row_id in list(section.get("rowIds") or []):
            clean = str(row_id or "").strip()
            if clean:
                visible.add(clean)
    return visible


def task_section_labels(state: dict[str, Any]) -> list[str]:
    return [
        str(section.get("label") or "").strip()
        for section in list(state.get("sections") or [])
        if isinstance(section, dict) and str(section.get("label") or "").strip()
    ]


def verify_task_section_order(state: dict[str, Any]) -> None:
    labels = task_section_labels(state)
    expected = ["Today", "Overdue", "Upcoming", "Done"]
    assert_or_fail(labels[: len(expected)] == expected, "phone_task_detail_render_failed", f"Expected task section order {' / '.join(expected)}, got {labels}")


def expected_link_specs(seed: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {
            "kind": "calendar_event",
            "route": "meeting-detail",
            "title": str(seed["calendarEventTitle"]),
            "record_id": str(seed["calendarEventId"]),
        },
        {
            "kind": "contact",
            "route": "contact-detail",
            "title": str(seed["contactTitle"]),
            "record_id": str(seed["contactId"]),
        },
        {
            "kind": "project",
            "route": "project-detail",
            "title": str(seed["projectTitle"]),
            "record_id": str(seed["projectId"]),
        },
        {
            "kind": "note",
            "route": "note-detail",
            "title": str(seed["noteTitle"]),
            "record_id": str(seed["noteId"]),
        },
    ]


def op_state(payload: dict[str, Any], kind: str) -> dict[str, Any]:
    for item in reversed(list(payload.get("operations") or [])):
        if isinstance(item, dict) and item.get("kind") == kind and isinstance(item.get("state"), dict):
            return item["state"]
    final_surface = payload.get("final_surface")
    return final_surface if isinstance(final_surface, dict) else {}


def group_for_task(state: dict[str, Any], task_id: str) -> str:
    for section in list(state.get("sections") or []):
        if not isinstance(section, dict):
            continue
        row_ids = {str(item or "") for item in list(section.get("rowIds") or [])}
        if str(task_id or "") in row_ids:
            return str(section.get("group") or "")
    return ""


def run_phase(
    args: argparse.Namespace,
    *,
    serial: str,
    cdp_url: str,
    scenario_dir: Path,
    name: str,
    operations: list[dict[str, Any]],
    timeout_seconds: int | float | None = None,
) -> dict[str, Any]:
    return proof.capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=operations,
        scenario_dir=scenario_dir,
        browser_name=f"{name}.json",
        device_name=f"{name}.png",
        timeout_seconds=timeout_seconds or args.browser_timeout_seconds,
    )


def task_row_selector(task_id: str) -> str:
    return f'.light-task-row[data-task-id="{task_id}"] .light-task-row-main'


def task_bulk_select_button_selector() -> str:
    return ".light-page-header .light-task-select-toggle"


def task_bulk_archive_button_selector() -> str:
    return ".light-task-bulk-archive"


def task_detail_actions_selector() -> str:
    return ".light-task-detail-action-trigger"


def task_detail_archive_selector() -> str:
    return '.settings-selector-option[data-selector-value="archive_task"]'


def status_selector(status: str) -> str:
    return f'.settings-selector-option[data-selector-value="{status}"]'


def task_row_status_trigger_selector(task_id: str) -> str:
    return f'.light-task-row[data-task-id="{task_id}"] .light-task-row-status-trigger'


def detail_status_header_selector() -> str:
    return ".light-task-detail-card"


def person_chip_selector(role: str) -> str:
    return f'.light-info-row[data-task-person-role="{role}"][data-workspace-target-kind="contact"]'


def checklist_selector(item_id: str) -> str:
    return f'.light-task-checklist-row[data-checklist-item-id="{item_id}"]'


def connected_selector(kind: str) -> str:
    return f'.light-info-row[data-task-connected-kind="{kind}"]'


def screenshot_operation(path: Path) -> dict[str, Any]:
    return {"kind": "screenshot", "path": str(path)}


def open_task_ops(task_id: str, screenshot_path: Path) -> list[dict[str, Any]]:
    return [
        {"kind": "goto_tasks", "theme": "light"},
        {"kind": "click_selector", "selector": task_row_selector(task_id)},
        {"kind": "wait_for_task_detail", "task_id": task_id},
        {"kind": "task_state"},
        screenshot_operation(screenshot_path),
    ]


def verify_people_icon_visual(person: dict[str, Any], *, label: str) -> None:
    icon_color = str(person.get("icon_color") or "").strip().lower()
    icon_background = str(person.get("icon_background") or "").strip().lower()
    assert_or_fail(bool(person.get("uses_small_icon")), "phone_task_detail_render_failed", f"{label} should use the standard linked-row icon")
    assert_or_fail(bool(person.get("icon_has_svg")), "phone_task_detail_render_failed", f"{label} icon is missing its SVG glyph")
    assert_or_fail(bool(icon_color), "phone_task_detail_render_failed", f"{label} icon color was missing")
    assert_or_fail(bool(icon_background), "phone_task_detail_render_failed", f"{label} icon background was missing")
    assert_or_fail(icon_color != icon_background, "phone_task_detail_render_failed", f"{label} icon lost contrast against its background")


def verify_connected_rows_sorted(entries: list[dict[str, Any]]) -> None:
    for index in range(1, len(entries)):
        previous = int(entries[index - 1].get("recency_ms") or 0)
        current = int(entries[index].get("recency_ms") or 0)
        assert_or_fail(previous >= current, "phone_task_detail_render_failed", "Connected rows were not sorted by recency descending")


def verify_primary_detail_state(state: dict[str, Any], seed: dict[str, Any]) -> None:
    assert_or_fail(state.get("taskDetailId") == seed["primaryTaskId"], "phone_task_detail_render_failed", "Primary task detail did not open")
    assert_or_fail(not state.get("hasTaskHtmlFrame"), "phone_task_detail_render_failed", "Primary task still renders legacy task HTML")
    assert_or_fail(bool(state.get("hasDescriptionSection")), "phone_task_detail_render_failed", "Primary task is missing Description")
    assert_or_fail(not state.get("hasPeopleSection"), "phone_task_detail_render_failed", "Primary task should not render a People section")
    assert_or_fail(bool(state.get("hasChecklistSection")), "phone_task_detail_render_failed", "Primary task is missing Checklist")
    assert_or_fail(not state.get("hasNotesSection"), "phone_task_detail_render_failed", "Primary task still renders a standalone Notes section")
    assert_or_fail(bool(state.get("hasConnectedSection")), "phone_task_detail_render_failed", "Primary task is missing Connected")
    assert_or_fail(not state.get("hasAttachedSection"), "phone_task_detail_render_failed", "Primary task still renders a standalone Attached section")
    assert_or_fail(int(state.get("connectedRowCount") or 0) >= 4, "phone_task_detail_render_failed", "Primary task is missing connected linked rows")
    assert_or_fail(not bool(state.get("hasTaskPersonChips")), "phone_task_detail_render_failed", "Primary task still renders People as task chips")
    assert_or_fail(not bool(state.get("hasTaskConnectedChips")), "phone_task_detail_render_failed", "Primary task still renders Connected as task chips")
    assert_or_fail(bool(state.get("statusHeaderPresent")), "phone_task_detail_render_failed", "Primary task is missing the interactive status header card")
    assert_or_fail(bool(state.get("statusCirclePresent")), "phone_task_detail_render_failed", "Primary task is missing the visible status circle")
    assert_or_fail(bool(state.get("detailActionPresent")), "phone_task_detail_render_failed", "Primary task is missing the task actions control")
    assert_or_fail(str(state.get("title") or "") == str(seed["primaryTaskTitle"]), "phone_task_detail_render_failed", "Primary task title did not render correctly")
    connected = [item for item in list(state.get("connected") or []) if isinstance(item, dict)]
    assert_or_fail(all(bool(item.get("hasIcon")) and bool(item.get("uses_small_icon")) for item in connected), "phone_task_detail_render_failed", "Connected linked rows did not use the standard icons")
    verify_connected_rows_sorted(connected)
    connected_kinds = {str(item.get("kind") or "") for item in connected}
    for kind in ("note", "calendar_event", "contact", "project"):
        assert_or_fail(kind in connected_kinds, "phone_task_detail_render_failed", f"Primary task is missing connected {kind} rows")


def verify_empty_detail_state(state: dict[str, Any], seed: dict[str, Any]) -> None:
    assert_or_fail(state.get("taskDetailId") == seed["emptyTaskId"], "phone_task_detail_render_failed", "Empty task detail did not open")
    assert_or_fail(not state.get("hasTaskHtmlFrame"), "phone_task_detail_render_failed", "Empty task rendered legacy task HTML")
    assert_or_fail(not state.get("hasDescriptionSection"), "phone_task_detail_render_failed", "Empty task rendered a fake Description section")
    assert_or_fail(not state.get("hasChecklistSection"), "phone_task_detail_render_failed", "Empty task rendered a fake Checklist section")
    assert_or_fail(not state.get("hasNotesSection"), "phone_task_detail_render_failed", "Empty task rendered a fake Notes section")
    assert_or_fail(not state.get("hasConnectedSection"), "phone_task_detail_render_failed", "Empty task rendered a fake Connected section")
    assert_or_fail(not state.get("hasAttachedSection"), "phone_task_detail_render_failed", "Empty task rendered a fake Attached section")


def run(args: argparse.Namespace) -> dict[str, Any]:
    browser_summary = load_browser_summary(args.browser_summary)
    seed = load_seed_manifest(browser_summary)
    token = resolve_api_token(str(args.token or ""))
    if not token:
        fail("browser_preproof_failed", "Real phone task proof requires --token or PUCKY_API_TOKEN")

    local_git = proof.require_official_local_repo(args.repo_root, args.canonical_root)
    remote_manifest = official_html.validate_remote_manifest(
        official_html.fetch_json(official_html.cache_busted_url(args.manifest_url, local_git["head_short"])),
        local_git,
    )
    validate_browser_summary_matches_local(browser_summary, local_git=local_git, remote_manifest=remote_manifest)

    serial = proof.resolve_adb_serial(args)
    try:
        cdp = proof.discover_cover_cdp_url(args, serial)
    except Exception as exc:
        fail("phone_webview_attach_failed", f"Could not attach to phone WebView: {exc}")

    bundle = proof.bundle_status(args)
    surface_before = proof.snapshot_surface(args)
    installed_package = proof.installed_package_info(args, serial)
    identity = proof.apk_identity(args)
    identity_checks = verify_html_target_identity(
        local_git=local_git,
        remote_manifest=remote_manifest,
        bundle=bundle,
        surface=surface_before,
        installed_package=installed_package,
        identity=identity,
    )

    scenario_dir = args.evidence_dir / time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    scenario_dir.mkdir(parents=True, exist_ok=True)

    list_checks: list[dict[str, Any]] = []
    archive_checks: list[dict[str, Any]] = []
    navigation_checks: list[dict[str, Any]] = []
    status_checks: list[dict[str, Any]] = []
    checklist_checks: list[dict[str, Any]] = []

    primary_restore = {
        "status": "todo",
        "description": str(seed["primaryDescription"]),
        "created_by": str(seed["createdBy"]),
        "owner": str(seed["ownerContactTitle"]),
        "checklist": seed["primaryChecklist"],
    }

    try:
        list_phase = run_phase(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            scenario_dir=scenario_dir,
            name="01-task-list",
            operations=[{"kind": "goto_tasks"}, {"kind": "task_state"}, screenshot_operation(scenario_dir / "01-task-list-browser.png")],
        )
        list_state = op_state(list_phase, "task_state")
        verify_task_section_order(list_state)
        assert_or_fail(not bool(list_state.get("hasFilterButton")), "phone_task_detail_render_failed", "Task list should not render the legacy filter pill")
        assert_or_fail(not bool(list_state.get("bulkBarPresent")), "phone_task_detail_render_failed", "Bulk archive bar should stay hidden before Select mode starts")
        list_checks.append({
            "type": "list_surface",
            "headers": task_section_labels(list_state),
            "visible_task_ids": sorted(visible_task_ids(list_state)),
        })

        bulk_archive_phase = run_phase(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            scenario_dir=scenario_dir,
            name="01b-bulk-archive",
            operations=[
                {"kind": "goto_tasks", "theme": "light"},
                {"kind": "click_selector", "selector": task_bulk_select_button_selector()},
                {"kind": "task_state"},
                {"kind": "click_selector", "selector": task_row_selector(str(seed["inProgressTaskId"]))},
                {"kind": "click_selector", "selector": task_row_selector(str(seed["waitingTaskId"]))},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "01b-bulk-archive-selected-browser.png"),
                {"kind": "click_selector", "selector": task_bulk_archive_button_selector()},
                {"kind": "wait_for_task_absent", "task_id": str(seed["inProgressTaskId"])},
                {"kind": "wait_for_task_absent", "task_id": str(seed["waitingTaskId"])},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "01b-bulk-archive-complete-browser.png"),
            ],
        )
        bulk_states = [
            item.get("state")
            for item in list(bulk_archive_phase.get("operations") or [])
            if isinstance(item, dict) and item.get("kind") == "task_state" and isinstance(item.get("state"), dict)
        ]
        assert_or_fail(len(bulk_states) >= 3, "phone_task_detail_render_failed", "Bulk archive proof did not capture enough list state snapshots")
        enter_select_state = bulk_states[0]
        selected_state = bulk_states[1]
        archived_state = bulk_states[2]
        assert_or_fail(str(enter_select_state.get("pageTitle") or "") == "Select tasks", "phone_task_detail_render_failed", "Select tasks mode did not update the task page title")
        assert_or_fail(bool(enter_select_state.get("selectModeActive")), "phone_task_detail_render_failed", "Select button did not enter task bulk-select mode")
        assert_or_fail(bool(selected_state.get("bulkBarPresent")), "phone_task_detail_render_failed", "Select mode should show the sticky bulk archive bar")
        assert_or_fail(
            set(selected_state.get("selectedTaskIds") or []) == {str(seed["inProgressTaskId"]), str(seed["waitingTaskId"])},
            "phone_task_detail_render_failed",
            "Bulk-select mode did not keep the selected task ids in sync",
        )
        assert_or_fail(str(selected_state.get("bulkCountLabel") or "") == "2 selected", "phone_task_detail_render_failed", "Bulk-select bar should show the selected count")
        archived_visible = visible_task_ids(archived_state)
        assert_or_fail(not bool(archived_state.get("selectModeActive")), "phone_task_detail_render_failed", "Bulk archive should exit Select mode after success")
        assert_or_fail(str(seed["inProgressTaskId"]) not in archived_visible, "phone_task_detail_render_failed", "Bulk archive should remove the in-progress task from the active list")
        assert_or_fail(str(seed["waitingTaskId"]) not in archived_visible, "phone_task_detail_render_failed", "Bulk archive should remove the waiting task from the active list")
        archive_checks.append({
            "type": "bulk_archive",
            "selected_task_ids": list(selected_state.get("selectedTaskIds") or []),
            "visible_after_archive": sorted(archived_visible),
        })

        if args.filter_only:
            summary = {
                "schema": RESULT_SCHEMA,
                "created_at": phone_shared.utc_stamp(),
                "ok": True,
                "base_url": args.vm_base_url,
                "browser_summary_path": str(args.browser_summary),
                "seed_manifest_path": str(Path(str(browser_summary["seed_manifest_path"])).resolve()),
                "target": {
                    "type": "phone",
                    "serial": serial,
                    "device_id": args.device_id,
                    "cdp_url": cdp["cdp_url"],
                },
                "local_git": local_git,
                "remote_manifest": remote_manifest,
                "identity_checks": identity_checks,
                "bundle": bundle,
                "surface_before": surface_before,
                "list_checks": list_checks,
                "archive_checks": archive_checks,
                "navigation_checks": navigation_checks,
                "status_checks": status_checks,
                "checklist_checks": checklist_checks,
            }
            summary_path = scenario_dir / "summary.json"
            phone_shared.save_json(summary_path, summary)
            return summary

        primary_phase = run_phase(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            scenario_dir=scenario_dir,
            name="07-primary-detail",
            operations=open_task_ops(str(seed["primaryTaskId"]), scenario_dir / "07-primary-detail-browser.png"),
        )
        primary_state = op_state(primary_phase, "task_state")
        verify_primary_detail_state(primary_state, seed)

        empty_phase = run_phase(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            scenario_dir=scenario_dir,
            name="08-empty-detail",
            operations=open_task_ops(str(seed["emptyTaskId"]), scenario_dir / "08-empty-detail-browser.png"),
        )
        verify_empty_detail_state(op_state(empty_phase, "task_state"), seed)

        detail_archive_phase = run_phase(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            scenario_dir=scenario_dir,
            name="09-detail-archive",
            operations=open_task_ops(str(seed["emptyTaskId"]), scenario_dir / "09-detail-archive-task-browser.png") + [
                {"kind": "click_selector", "selector": task_detail_actions_selector()},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "09-detail-archive-sheet-browser.png"),
                {"kind": "click_selector", "selector": task_detail_archive_selector()},
                {"kind": "wait_for_route", "route": "tasks"},
                {"kind": "wait_for_task_absent", "task_id": str(seed["emptyTaskId"])},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "09-detail-archive-return-browser.png"),
            ],
        )
        detail_archive_state = op_state(detail_archive_phase, "task_state")
        assert_or_fail(str(detail_archive_state.get("route") or "") == "tasks", "phone_task_detail_render_failed", "Detail archive should return the phone proof to tasks")
        assert_or_fail(str(seed["emptyTaskId"]) not in visible_task_ids(detail_archive_state), "phone_task_detail_render_failed", "Detail archive should remove the archived task from the active list")
        assert_or_fail(True, "phone_task_detail_render_failed", "Archive task")
        archive_checks.append({
            "type": "detail_archive",
            "archived_task_id": str(seed["emptyTaskId"]),
            "route_after_archive": detail_archive_state.get("route"),
            "visible_after_archive": sorted(visible_task_ids(detail_archive_state)),
        })

        status_trigger_phase = run_phase(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            scenario_dir=scenario_dir,
            name="09b-status-triggers",
            operations=[
                {"kind": "goto_tasks"},
                {"kind": "click_selector", "selector": task_row_status_trigger_selector(str(seed["primaryTaskId"]))},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "09b-status-selector-list-browser.png"),
                {"kind": "click_selector", "selector": status_selector("todo")},
                {"kind": "click_selector", "selector": task_row_selector(str(seed["primaryTaskId"]))},
                {"kind": "wait_for_task_detail", "task_id": str(seed["primaryTaskId"])},
                {"kind": "click_selector", "selector": detail_status_header_selector()},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "09b-status-selector-header-a-browser.png"),
                {"kind": "click_selector", "selector": status_selector("todo")},
                {"kind": "click_selector", "selector": detail_status_header_selector()},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "09b-status-selector-header-b-browser.png"),
                {"kind": "click_selector", "selector": status_selector("todo")},
            ],
        )
        trigger_states = [item.get("state") for item in list(status_trigger_phase.get("operations") or []) if isinstance(item, dict) and item.get("kind") == "task_state" and isinstance(item.get("state"), dict)]
        assert_or_fail(len(trigger_states) >= 3, "phone_task_detail_render_failed", "Status trigger proof did not capture enough state snapshots")
        assert_or_fail(str(trigger_states[0].get("route") or "") == "tasks", "phone_task_detail_render_failed", "List-row status trigger should keep the phone proof on tasks")
        assert_or_fail(str(trigger_states[1].get("route") or "") == "task-detail", "phone_task_detail_render_failed", "Detail status header should keep the phone proof on task detail")
        assert_or_fail(str(trigger_states[2].get("route") or "") == "task-detail", "phone_task_detail_render_failed", "Repeated detail status header open should keep the phone proof on task detail")
        status_checks.append({"type": "status_trigger_routes", "routes": [str(state.get("route") or "") for state in trigger_states[:3]]})

        for index, spec in enumerate(expected_link_specs(seed), start=10):
            phase = run_phase(
                args,
                serial=serial,
                cdp_url=cdp["cdp_url"],
                scenario_dir=scenario_dir,
                name=f"{index:02d}-linked-{spec['kind']}",
                operations=open_task_ops(str(seed["primaryTaskId"]), scenario_dir / f"{index:02d}-linked-{spec['kind']}-task-browser.png") + [
                    {"kind": "click_selector", "selector": connected_selector(spec["kind"])},
                    {"kind": "wait_for_route", "route": spec["route"]},
                    {"kind": "wait_for_text", "selector": ".light-profile-card h1, .light-record-detail-title, .light-detail-header h1, .light-page-header h1", "text": spec["title"]},
                    screenshot_operation(scenario_dir / f"{index:02d}-linked-{spec['kind']}-open-browser.png"),
                    {"kind": "back"},
                    {"kind": "wait_for_route", "route": "task-detail"},
                    {"kind": "wait_for_task_detail", "task_id": str(seed["primaryTaskId"])},
                    {"kind": "task_state"},
                    screenshot_operation(scenario_dir / f"{index:02d}-linked-{spec['kind']}-return-browser.png"),
                ],
            )
            state = op_state(phase, "task_state")
            connected = {str(item.get("kind") or ""): item for item in list(state.get("connected") or []) if isinstance(item, dict)}
            linked = connected.get(spec["kind"], {})
            assert_or_fail(str(linked.get("route") or "") == spec["route"], "phone_linked_route_mismatch", f"{spec['kind']} chip route mismatch")
            assert_or_fail(str(linked.get("id") or "") == spec["record_id"], "phone_linked_route_mismatch", f"{spec['kind']} chip id mismatch")
            assert_or_fail(bool(linked.get("hasIcon")), "phone_task_detail_render_failed", f"{spec['kind']} chip is missing its icon")
            assert_or_fail(spec["title"] in str(linked.get("label") or ""), "phone_task_detail_render_failed", f"{spec['kind']} chip label mismatch")
            assert_or_fail(state.get("taskDetailId") == seed["primaryTaskId"], "phone_task_origin_backstack_failed", f"{spec['kind']} back path lost the originating task")
            navigation_checks.append({"kind": spec["kind"], "returned_route": state.get("route"), "returned_task_id": state.get("taskDetailId")})

        checklist_ids = [str(item["id"]) for item in list(seed["primaryChecklist"]) if isinstance(item, dict) and not bool(item.get("done"))]
        checklist_ops = open_task_ops(str(seed["primaryTaskId"]), scenario_dir / "14-checklist-task-browser.png")
        for item_id in checklist_ids:
            checklist_ops.append({"kind": "click_selector", "selector": checklist_selector(item_id)})
        checklist_ops.extend([
            {"kind": "task_state"},
            screenshot_operation(scenario_dir / "14-checklist-toggled-browser.png"),
            {"kind": "reload_page"},
            {"kind": "wait_for_route", "route": "task-detail"},
            {"kind": "wait_for_task_detail", "task_id": str(seed["primaryTaskId"])},
            {"kind": "task_state"},
            screenshot_operation(scenario_dir / "14-checklist-reload-browser.png"),
        ])
        checklist_phase = run_phase(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            scenario_dir=scenario_dir,
            name="14-checklist",
            operations=checklist_ops,
        )
        checklist_state = op_state(checklist_phase, "task_state")
        checklist_rows = {str(item.get("id") or ""): bool(item.get("done")) for item in list(checklist_state.get("checklist") or []) if isinstance(item, dict)}
        for item_id in checklist_ids:
            assert_or_fail(checklist_rows.get(item_id) is True, "phone_checklist_persistence_failed", f"Checklist item {item_id} did not persist as done after reload")
        task_after_checklist = fetch_task_record(args.vm_base_url, token, str(seed["primaryTaskId"]))
        assert_or_fail(str(task_after_checklist.get("status") or "") == "done", "phone_checklist_persistence_failed", "Checking every checklist item should auto-mark the parent task done")
        completed_after_checklist = int(task_after_checklist.get("completed_at_ms") or 0)
        assert_or_fail(int(task_after_checklist.get("completed_at_ms") or 0) > 0, "phone_checklist_persistence_failed", "Checking every checklist item should stamp completed_at_ms")
        checklist_checks.append({
            "toggled_all_done": True,
            "status_after_toggle": task_after_checklist.get("status"),
            "completed_at_ms_after_toggle": task_after_checklist.get("completed_at_ms"),
        })
        reopen_item_id = checklist_ids[-1] if checklist_ids else ""
        assert_or_fail(bool(reopen_item_id), "phone_checklist_persistence_failed", "Missing checklist item to reopen the completed task")
        reopen_phase = run_phase(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            scenario_dir=scenario_dir,
            name="14b-checklist-reopen",
            operations=open_task_ops(str(seed["primaryTaskId"]), scenario_dir / "14b-checklist-reopen-task-browser.png") + [
                {"kind": "click_selector", "selector": checklist_selector(reopen_item_id)},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "14b-checklist-reopen-browser.png"),
                {"kind": "reload_page"},
                {"kind": "wait_for_route", "route": "task-detail"},
                {"kind": "wait_for_task_detail", "task_id": str(seed["primaryTaskId"])},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "14b-checklist-reopen-reload-browser.png"),
            ],
        )
        reopen_state = op_state(reopen_phase, "task_state")
        reopen_rows = {str(item.get("id") or ""): bool(item.get("done")) for item in list(reopen_state.get("checklist") or []) if isinstance(item, dict)}
        assert_or_fail(reopen_rows.get(reopen_item_id) is False, "phone_checklist_persistence_failed", f"Checklist item {reopen_item_id} did not reopen after reload")
        task_after_reopen = fetch_task_record(args.vm_base_url, token, str(seed["primaryTaskId"]))
        assert_or_fail(str(task_after_reopen.get("status") or "") == "in_progress", "phone_checklist_persistence_failed", "Unchecking a completed checklist item should reopen the parent task to in progress")
        assert_or_fail(not bool(task_after_reopen.get("completed_at_ms")), "phone_checklist_persistence_failed", "Reopening a completed task should clear completed_at_ms")
        checklist_checks.append({
            "toggled_all_done": False,
            "status_after_reopen": task_after_reopen.get("status"),
            "completed_at_ms_after_reopen": task_after_reopen.get("completed_at_ms"),
        })

        transitions = [
            {"status": "in_progress", "group": "do"},
            {"status": "waiting", "group": "do"},
            {"status": "done", "group": "done"},
        ]
        current_primary_status = "in_progress"
        for index, transition in enumerate(transitions, start=15):
            phase = run_phase(
                args,
                serial=serial,
                cdp_url=cdp["cdp_url"],
                scenario_dir=scenario_dir,
                name=f"{index:02d}-status-{transition['status']}",
                operations=open_task_ops(str(seed["primaryTaskId"]), scenario_dir / f"{index:02d}-status-{transition['status']}-task-browser.png") + [
                    {"kind": "click_selector", "selector": detail_status_header_selector()},
                    {"kind": "click_selector", "selector": status_selector(str(transition["status"]))},
                    {"kind": "wait_for_task_status", "status": str(transition["status"])},
                    {"kind": "task_state"},
                    screenshot_operation(scenario_dir / f"{index:02d}-status-{transition['status']}-detail-browser.png"),
                    {"kind": "back"},
                    {"kind": "wait_for_route", "route": "tasks"},
                    {"kind": "task_state"},
                    screenshot_operation(scenario_dir / f"{index:02d}-status-{transition['status']}-list-browser.png"),
                    {"kind": "click_selector", "selector": task_row_selector(str(seed["primaryTaskId"]))},
                    {"kind": "wait_for_task_detail", "task_id": str(seed["primaryTaskId"])},
                    {"kind": "reload_page"},
                    {"kind": "wait_for_route", "route": "task-detail"},
                    {"kind": "wait_for_task_detail", "task_id": str(seed["primaryTaskId"])},
                    {"kind": "wait_for_task_status", "status": str(transition["status"])},
                    {"kind": "task_state"},
                    screenshot_operation(scenario_dir / f"{index:02d}-status-{transition['status']}-reload-browser.png"),
                ],
            )
            state = op_state(phase, "task_state")
            assert_or_fail(state.get("taskStatus") == transition["status"], "phone_status_persistence_failed", f"Task status did not persist as {transition['status']}")
            task_record = fetch_task_record(args.vm_base_url, token, str(seed["primaryTaskId"]))
            assert_or_fail(str(task_record.get("status") or "") == transition["status"], "phone_status_persistence_failed", f"Workspace API did not persist {transition['status']}")
            if transition["status"] == "done":
                assert_or_fail(int(task_record.get("completed_at_ms") or 0) > completed_after_checklist, "phone_status_persistence_failed", "Re-done task did not stamp a fresh completion timestamp")
            list_state_after_back = None
            for item in list(phase.get("operations") or []):
                if isinstance(item, dict) and item.get("kind") == "task_state" and isinstance(item.get("state"), dict):
                    state_candidate = item["state"]
                    if str(state_candidate.get("route") or "") == "tasks":
                        list_state_after_back = state_candidate
                        break
            assert_or_fail(group_for_task(list_state_after_back or {}, str(seed["primaryTaskId"])) == transition["group"], "phone_status_persistence_failed", f"Task did not move to {transition['group']} after {transition['status']}")
            previous_status = current_primary_status
            current_primary_status = str(transition["status"])
            status_checks.append({"from": previous_status, "to": transition["status"], "expected_group": transition["group"]})

        overdue_task = fetch_task_record(args.vm_base_url, token, str(seed["overdueTaskId"]))
        assert_or_fail(str(overdue_task.get("status") or "") == "todo", "phone_status_persistence_failed", "Overdue task stored overdue as a status value")
    finally:
        try:
            patch_task_record(args.vm_base_url, token, str(seed["primaryTaskId"]), primary_restore)
        except Exception:
            pass

    summary = {
        "schema": RESULT_SCHEMA,
        "created_at": phone_shared.utc_stamp(),
        "ok": True,
        "base_url": args.vm_base_url,
        "browser_summary_path": str(args.browser_summary),
        "seed_manifest_path": str(Path(str(browser_summary["seed_manifest_path"])).resolve()),
        "target": {
            "type": "phone",
            "serial": serial,
            "device_id": args.device_id,
            "cdp_url": cdp["cdp_url"],
        },
        "local_git": local_git,
        "remote_manifest": remote_manifest,
        "identity_checks": identity_checks,
        "bundle": bundle,
        "surface_before": surface_before,
        "list_checks": list_checks,
        "archive_checks": archive_checks,
        "navigation_checks": navigation_checks,
        "status_checks": status_checks,
        "checklist_checks": checklist_checks,
    }
    summary_path = scenario_dir / "summary.json"
    phone_shared.save_json(summary_path, summary)
    return summary


if __name__ == "__main__":
    try:
        result = run(parse_args())
    except Exception as exc:
        payload = {
            "schema": RESULT_SCHEMA,
            "ok": False,
            "error": str(exc),
            "error_category": getattr(exc, "category", "phone_task_proof_failed"),
        }
        print(json.dumps(payload, indent=2))
        raise
    print(json.dumps(result, indent=2))
