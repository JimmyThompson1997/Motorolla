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
    parser.add_argument("--token", default=os.environ.get("PUCKY_WEB_UI_TOKEN") or os.environ.get("PUCKY_API_TOKEN", ""))
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


def resolve_user_data_api_token(explicit_token: str = "") -> str:
    token = str(explicit_token or "").strip()
    if token:
        return token
    web_ui_token = str(os.environ.get("PUCKY_WEB_UI_TOKEN", "")).strip()
    if web_ui_token:
        return web_ui_token
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


def active_filter_key(state: dict[str, Any]) -> str:
    for item in list(state.get("filters") or []):
        if isinstance(item, dict) and item.get("active"):
            return str(item.get("key") or "")
    return ""


def task_filter_label(filter_key: str) -> str:
    return {
        "all": "All",
        "todo": "To do",
        "in_progress": "In progress",
        "waiting": "Waiting",
        "done": "Done",
    }.get(str(filter_key or ""), "All")


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


def status_selector(status: str) -> str:
    return f'.settings-selector-option[data-selector-value="{status}"]'


def task_row_status_trigger_selector(task_id: str) -> str:
    return f'.light-task-row[data-task-id="{task_id}"] .light-task-row-status-trigger'


def detail_status_trigger_selector() -> str:
    return ".light-task-status-trigger"


def detail_status_circle_selector() -> str:
    return ".light-task-status-circle-trigger"


def person_chip_selector(role: str) -> str:
    return f'.light-task-person-row[data-task-person-role="{role}"] [data-workspace-target-kind="contact"]'


def checklist_selector(item_id: str) -> str:
    return f'.light-task-checklist-row[data-checklist-item-id="{item_id}"]'


def attachment_selector(kind: str) -> str:
    return f'.light-task-chip-cloud [data-workspace-target-kind="{kind}"]'


def screenshot_operation(path: Path) -> dict[str, Any]:
    return {"kind": "screenshot", "path": str(path)}


def open_task_ops(task_id: str, screenshot_path: Path) -> list[dict[str, Any]]:
    return [
        {"kind": "goto_tasks", "theme": "light"},
        {"kind": "click_selector", "selector": ".light-task-filter-button"},
        {"kind": "click_selector", "selector": status_selector("all")},
        {"kind": "click_selector", "selector": task_row_selector(task_id)},
        {"kind": "wait_for_task_detail", "task_id": task_id},
        {"kind": "task_state"},
        screenshot_operation(screenshot_path),
    ]


def verify_filter_state(
    state: dict[str, Any],
    *,
    filter_key: str,
    present: list[str],
    absent: list[str],
) -> None:
    assert_or_fail(active_filter_key(state) == filter_key, "phone_task_detail_render_failed", f"Expected active task filter {filter_key}")
    visible = visible_task_ids(state)
    for task_id in present:
        assert_or_fail(task_id in visible, "phone_task_detail_render_failed", f"Expected task {task_id} to be visible under {filter_key}")
    for task_id in absent:
        assert_or_fail(task_id not in visible, "phone_task_detail_render_failed", f"Expected task {task_id} to be hidden under {filter_key}")


def verify_filter_visual(state: dict[str, Any], *, theme: str) -> None:
    visual = state.get("filterVisual") or {}
    assert_or_fail(not bool(visual.get("chevronHasRect")), "phone_task_detail_render_failed", f"{theme}: task filter rendered the fallback icon")
    supported_chevron_paths = {
        "m7 10 5 5 5-5",
        "m7 10 5 5 5-5H7Z",
        "m9 5 7 7-7 7",
        "M8.6 5.4 10 4l8 8-8 8-1.4-1.4 6.6-6.6-6.6-6.6Z",
    }
    assert_or_fail(
        str(visual.get("chevronPath") or "") in supported_chevron_paths,
        "phone_task_detail_render_failed",
        f"{theme}: task filter chevron path was unexpected",
    )
    if theme == "dark":
        assert_or_fail(str(visual.get("buttonColor") or "") == "rgb(245, 249, 255)", "phone_task_detail_render_failed", "dark: task filter text is not using the readable neutral color")
        assert_or_fail(str(visual.get("chevronColor") or "") == "rgb(245, 249, 255)", "phone_task_detail_render_failed", "dark: task filter chevron is not using the readable neutral color")


def verify_primary_detail_state(state: dict[str, Any], seed: dict[str, Any]) -> None:
    assert_or_fail(state.get("taskDetailId") == seed["primaryTaskId"], "phone_task_detail_render_failed", "Primary task detail did not open")
    assert_or_fail(not state.get("hasTaskHtmlFrame"), "phone_task_detail_render_failed", "Primary task still renders legacy task HTML")
    assert_or_fail(bool(state.get("hasDescriptionSection")), "phone_task_detail_render_failed", "Primary task is missing Description")
    assert_or_fail(bool(state.get("hasPeopleSection")), "phone_task_detail_render_failed", "Primary task is missing People")
    assert_or_fail(bool(state.get("hasChecklistSection")), "phone_task_detail_render_failed", "Primary task is missing Checklist")
    assert_or_fail(bool(state.get("hasAttachedSection")), "phone_task_detail_render_failed", "Primary task is missing Attached")
    assert_or_fail(int(state.get("attachedChipIconCount") or 0) >= 4, "phone_task_detail_render_failed", "Primary task chips are missing icons")
    assert_or_fail(not bool(state.get("hasLegacyCreatedByRow")), "phone_task_detail_render_failed", "Primary task still renders the legacy Created by info row")
    assert_or_fail(bool(state.get("statusTriggerPresent")), "phone_task_detail_render_failed", "Primary task is missing the status pill trigger")
    assert_or_fail(bool(state.get("statusCircleTriggerPresent")), "phone_task_detail_render_failed", "Primary task is missing the status circle trigger")
    assert_or_fail(str(state.get("title") or "") == str(seed["primaryTaskTitle"]), "phone_task_detail_render_failed", "Primary task title did not render correctly")
    people = [item for item in list(state.get("people") or []) if isinstance(item, dict)]
    created_by = next((item for item in people if str(item.get("role") or "") == "created_by"), {})
    owner = next((item for item in people if str(item.get("role") or "") == "owner"), {})
    assert_or_fail(str(created_by.get("route") or "") == "contact-detail", "phone_task_detail_render_failed", "Created by chip is not linked to contact detail")
    assert_or_fail(str(created_by.get("id") or "") == str(seed["contactId"]), "phone_task_detail_render_failed", "Created by chip did not point at the expected contact")
    assert_or_fail(str(owner.get("route") or "") == "contact-detail", "phone_task_detail_render_failed", "Owner chip is not linked to contact detail")
    assert_or_fail(str(owner.get("id") or "") == str(seed["ownerContactId"]), "phone_task_detail_render_failed", "Owner chip did not point at the expected owner contact")


def verify_empty_detail_state(state: dict[str, Any], seed: dict[str, Any]) -> None:
    assert_or_fail(state.get("taskDetailId") == seed["emptyTaskId"], "phone_task_detail_render_failed", "Empty task detail did not open")
    assert_or_fail(not state.get("hasTaskHtmlFrame"), "phone_task_detail_render_failed", "Empty task rendered legacy task HTML")
    assert_or_fail(not state.get("hasDescriptionSection"), "phone_task_detail_render_failed", "Empty task rendered a fake Description section")
    assert_or_fail(not state.get("hasChecklistSection"), "phone_task_detail_render_failed", "Empty task rendered a fake Checklist section")
    assert_or_fail(not state.get("hasAttachedSection"), "phone_task_detail_render_failed", "Empty task rendered a fake Attached section")


def run(args: argparse.Namespace) -> dict[str, Any]:
    browser_summary = load_browser_summary(args.browser_summary)
    seed = load_seed_manifest(browser_summary)
    token = resolve_user_data_api_token(str(args.token or ""))
    if not token:
        fail("browser_preproof_failed", "Real phone task proof requires --token or PUCKY_WEB_UI_TOKEN or PUCKY_API_TOKEN")

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

    filter_checks: list[dict[str, Any]] = []
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
        labels = [str(section.get("label") or "") for section in list_state.get("sections") or [] if isinstance(section, dict)]
        for expected_label in ["Today", "Upcoming", "Overdue", "Done"]:
            assert_or_fail(expected_label in labels, "phone_task_detail_render_failed", f"Missing task bucket {expected_label}")
        filter_labels = [str(item.get("label") or "") for item in list_state.get("filters") or [] if isinstance(item, dict)]
        assert_or_fail(filter_labels == ["All"], "phone_task_detail_render_failed", "Expected a single visible All task filter trigger")
        verify_filter_visual(list_state, theme="light")

        filter_expectations = [
            {"key": "all", "present": [seed["primaryTaskId"], seed["overdueTaskId"], seed["inProgressTaskId"], seed["waitingTaskId"], seed["doneTaskId"], seed["emptyTaskId"]], "absent": []},
            {"key": "todo", "present": [seed["primaryTaskId"], seed["overdueTaskId"], seed["emptyTaskId"]], "absent": [seed["inProgressTaskId"], seed["waitingTaskId"], seed["doneTaskId"]]},
            {"key": "in_progress", "present": [seed["inProgressTaskId"]], "absent": [seed["primaryTaskId"], seed["overdueTaskId"], seed["waitingTaskId"], seed["doneTaskId"], seed["emptyTaskId"]]},
            {"key": "waiting", "present": [seed["waitingTaskId"]], "absent": [seed["primaryTaskId"], seed["overdueTaskId"], seed["inProgressTaskId"], seed["doneTaskId"], seed["emptyTaskId"]]},
            {"key": "done", "present": [seed["doneTaskId"]], "absent": [seed["primaryTaskId"], seed["overdueTaskId"], seed["inProgressTaskId"], seed["waitingTaskId"], seed["emptyTaskId"]]},
        ]
        for index, expectation in enumerate(filter_expectations, start=2):
            filter_ops: list[dict[str, Any]] = [
                {"kind": "goto_tasks"},
                {"kind": "click_selector", "selector": ".light-task-filter-button"},
                {"kind": "click_selector", "selector": f'.settings-selector-option[data-selector-value="{expectation["key"]}"]'},
            ]
            if expectation["key"] in {"all", "done"}:
                filter_ops.append({"kind": "ensure_task_section_expanded", "group": "done"})
            filter_ops.extend([
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / f"{index:02d}-filter-{expectation['key']}-browser.png"),
            ])
            phase = run_phase(
                args,
                serial=serial,
                cdp_url=cdp["cdp_url"],
                scenario_dir=scenario_dir,
                name=f"{index:02d}-filter-{expectation['key']}",
                operations=filter_ops,
            )
            state = op_state(phase, "task_state")
            verify_filter_state(state, filter_key=str(expectation["key"]), present=[str(item) for item in expectation["present"]], absent=[str(item) for item in expectation["absent"]])
            current_labels = [str(item.get("label") or "") for item in list(state.get("filters") or []) if isinstance(item, dict)]
            assert_or_fail(current_labels == [task_filter_label(str(expectation["key"]))], "phone_task_detail_render_failed", f"Visible task filter label did not switch to {task_filter_label(str(expectation['key']))}")
            filter_checks.append({"filter": expectation["key"], "visible": sorted(visible_task_ids(state))})

        dark_filter_phase = run_phase(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            scenario_dir=scenario_dir,
            name="06-dark-filter-visual",
            operations=[
                {"kind": "goto_tasks", "theme": "dark"},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "06-dark-filter-browser.png"),
            ],
        )
        dark_filter_state = op_state(dark_filter_phase, "task_state")
        verify_filter_visual(dark_filter_state, theme="dark")
        filter_checks.append({"filter": "dark_visual", "theme": dark_filter_state.get("filterVisual", {}).get("theme"), "visible": sorted(visible_task_ids(dark_filter_state))})

        reset_light_phase = run_phase(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            scenario_dir=scenario_dir,
            name="06b-light-reset",
            operations=[
                {"kind": "goto_tasks", "theme": "light"},
                {"kind": "task_state"},
            ],
        )
        verify_filter_visual(op_state(reset_light_phase, "task_state"), theme="light")

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
                "filter_checks": filter_checks,
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

        created_by_phase = run_phase(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            scenario_dir=scenario_dir,
            name="09-created-by",
            operations=open_task_ops(str(seed["primaryTaskId"]), scenario_dir / "09-created-by-task-browser.png") + [
                {"kind": "click_selector", "selector": person_chip_selector("created_by")},
                {"kind": "wait_for_route", "route": "contact-detail"},
                {"kind": "wait_for_text", "selector": ".light-profile-card h1, .light-record-detail-title, .light-detail-header h1, .light-page-header h1", "text": str(seed["contactTitle"])},
                screenshot_operation(scenario_dir / "09-created-by-open-browser.png"),
                {"kind": "back"},
                {"kind": "wait_for_route", "route": "task-detail"},
                {"kind": "wait_for_task_detail", "task_id": str(seed["primaryTaskId"])},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "09-created-by-return-browser.png"),
            ],
        )
        created_by_return = op_state(created_by_phase, "task_state")
        assert_or_fail(created_by_return.get("taskDetailId") == seed["primaryTaskId"], "phone_task_origin_backstack_failed", "Created by navigation did not return to the same task")
        navigation_checks.append({"kind": "created_by", "returned_route": created_by_return.get("route"), "returned_task_id": created_by_return.get("taskDetailId")})

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
                {"kind": "click_selector", "selector": detail_status_trigger_selector()},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "09b-status-selector-pill-browser.png"),
                {"kind": "click_selector", "selector": status_selector("todo")},
                {"kind": "click_selector", "selector": detail_status_circle_selector()},
                {"kind": "task_state"},
                screenshot_operation(scenario_dir / "09b-status-selector-circle-browser.png"),
                {"kind": "click_selector", "selector": status_selector("todo")},
            ],
        )
        trigger_states = [item.get("state") for item in list(status_trigger_phase.get("operations") or []) if isinstance(item, dict) and item.get("kind") == "task_state" and isinstance(item.get("state"), dict)]
        assert_or_fail(len(trigger_states) >= 3, "phone_task_detail_render_failed", "Status trigger proof did not capture enough state snapshots")
        assert_or_fail(str(trigger_states[0].get("route") or "") == "tasks", "phone_task_detail_render_failed", "List-row status trigger should keep the phone proof on tasks")
        assert_or_fail(str(trigger_states[1].get("route") or "") == "task-detail", "phone_task_detail_render_failed", "Detail status pill should keep the phone proof on task detail")
        assert_or_fail(str(trigger_states[2].get("route") or "") == "task-detail", "phone_task_detail_render_failed", "Detail status circle should keep the phone proof on task detail")
        status_checks.append({"type": "status_trigger_routes", "routes": [str(state.get("route") or "") for state in trigger_states[:3]]})

        for index, spec in enumerate(expected_link_specs(seed), start=10):
            phase = run_phase(
                args,
                serial=serial,
                cdp_url=cdp["cdp_url"],
                scenario_dir=scenario_dir,
                name=f"{index:02d}-linked-{spec['kind']}",
                operations=open_task_ops(str(seed["primaryTaskId"]), scenario_dir / f"{index:02d}-linked-{spec['kind']}-task-browser.png") + [
                    {"kind": "click_selector", "selector": attachment_selector(spec["kind"])},
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
            attached = {str(item.get("kind") or ""): item for item in list(state.get("attached") or []) if isinstance(item, dict)}
            linked = attached.get(spec["kind"], {})
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
        assert_or_fail(str(task_after_checklist.get("status") or "") == "todo", "phone_checklist_persistence_failed", "Checking every checklist item auto-marked the parent task done")
        checklist_checks.append({"toggled_all_done": True, "status_after_toggle": task_after_checklist.get("status")})

        transitions = [
            {"status": "in_progress", "group": "do", "trigger": "pill"},
            {"status": "waiting", "group": "do", "trigger": "circle"},
            {"status": "done", "group": "done", "trigger": "pill"},
        ]
        current_primary_status = "todo"
        for index, transition in enumerate(transitions, start=15):
            trigger_selector = detail_status_circle_selector() if transition["trigger"] == "circle" else detail_status_trigger_selector()
            phase = run_phase(
                args,
                serial=serial,
                cdp_url=cdp["cdp_url"],
                scenario_dir=scenario_dir,
                name=f"{index:02d}-status-{transition['status']}",
                operations=open_task_ops(str(seed["primaryTaskId"]), scenario_dir / f"{index:02d}-status-{transition['status']}-task-browser.png") + [
                    {"kind": "click_selector", "selector": trigger_selector},
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
        "filter_checks": filter_checks,
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
