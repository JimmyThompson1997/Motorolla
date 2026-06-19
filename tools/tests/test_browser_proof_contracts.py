from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read_source(name: str) -> str:
    matches = sorted((ROOT / "tools").rglob(name))
    assert matches, f"Missing proof source {name}"
    nested = [path for path in matches if "proofs" in path.parts or "support" in path.parts]
    target = nested[0] if nested else matches[0]
    return target.read_text(encoding="utf-8")


def has_source(name: str) -> bool:
    return bool(sorted((ROOT / "tools").rglob(name)))


def test_browser_facing_proofs_prefer_web_ui_token() -> None:
    script_names = [
        "cover_calendar_playwright.mjs",
        "cover_links_scroll_probe.mjs",
        "cover_notes_feed_centering_real_vm_playwright.mjs",
        "cover_workspace_apps_playwright.mjs",
        "meeting_mode_agent_real_vm_playwright.mjs",
        "meetings_load_probe.mjs",
        "reminders_v3_browser_proof.mjs",
        "task_workspace_live_vm_proof.mjs",
    ]
    if has_source("cover_live_user_session_playwright.mjs"):
        script_names.append("cover_live_user_session_playwright.mjs")
    for script_name in script_names:
        assert "PUCKY_WEB_UI_TOKEN" in read_source(script_name), script_name


def test_canonical_browser_proof_routes_use_inbox_and_connect() -> None:
    assert "route=inbox" in read_source("meetings_load_probe.mjs")
    assert "route=connect" in read_source("cover_links_scroll_probe.mjs")
    if not has_source("cover_live_user_session_playwright.mjs"):
        return
    source = read_source("cover_live_user_session_playwright.mjs")
    assert 'await openRouteFromHome(page, "inbox", config.timeoutMs);' in source
    assert 'await openRouteFromHome(page, "connect", config.timeoutMs);' in source


def test_live_user_session_browser_proof_avoids_stale_routes_and_contacts_edit() -> None:
    if not has_source("cover_live_user_session_playwright.mjs"):
        return
    source = read_source("cover_live_user_session_playwright.mjs")

    assert "route=apps" not in source
    assert "route=feed" not in source
    assert "contacts-edit" not in source


def test_workspace_apps_browser_proof_covers_preview_api_token_lock() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "Preview needs api_token" in source
    assert 'url.searchParams.set("api_token", String(apiToken || "").trim());' in source
    assert "Web preview is locked. Use Unlock web preview to load live ${expectedLabel} from the VM in this browser." in source
    assert "!/unauthorized/i.test(text)" in source
    assert "Unlock web preview" in source
    assert 'await unlockBrowserPreview(page, config.apiToken, config.timeoutMs);' in source
    assert 'await page.getByRole("button", { name: "Save token" }).click();' in source


def test_notes_pin_browser_proof_handles_preview_unlock_and_row_toggle_contract() -> None:
    source = read_source("cover_notes_pin_playwright.mjs")

    assert "Preview needs api_token" in source
    assert "Unlock web preview" in source
    assert "Paste PUCKY_WEB_UI_TOKEN" in source
    assert 'await page.getByRole("button", { name: "Save token" }).click();' in source
    assert 'request.method() === "PATCH"' in source
    assert '.light-note-row[data-note-id="march"] .light-note-pin-button' in source
    assert "Notes pin write failed" in source


def test_live_notes_centering_proof_unlocks_preview_before_toggling_rows() -> None:
    source = read_source("cover_notes_feed_centering_real_vm_playwright.mjs")

    assert "PUCKY_WEB_UI_TOKEN" in source
    assert "Preview needs api_token" in source
    assert "Unlock web preview" in source
    assert 'await page.getByRole("button", { name: "Save token" }).click();' in source
    assert ".light-note-pin-button" in source


def test_workspace_tasks_press_proof_uses_real_row_control() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "taskById(seed.taskIds?.rowA)" in source
    assert "taskById(seed.taskIds?.rowB)" in source
    assert "function taskRowControl(page, taskId)" in source
    assert "const rowAPressTarget = taskRowControl(page, rowA.id);" in source
    assert 'rowAPressTarget.dispatchEvent("pointerdown"' in source
    assert "button instanceof HTMLButtonElement" not in source


def test_workspace_tasks_detail_proof_uses_status_control_contract() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert 'document.querySelector(".light-task-status-trigger")' in source
    assert 'querySelector(".light-task-status-trigger-label")' in source
    assert 'detailState.statusValue === "done"' in source
    assert 'detailState.statusLabel === "Done"' in source
    assert ".light-task-detail-toggle" not in source


def test_home_app_label_proof_checks_narrow_row_overlap_and_centering() -> None:
    source = read_source("cover_home_app_labels_playwright.mjs")
    package = (ROOT / "tools" / "package.json").read_text(encoding="utf-8")

    assert "pucky.home_app_labels_browser_proof.v1" in source
    assert "const VIEWPORT = { width: 395, height: 786 };" in source
    assert ".light-app-label" in source
    assert "Meeting Notes" in source
    assert "assertNoSameRowLabelOverlap(metrics);" in source
    assert "horizontalOverlap > OVERLAP_EPSILON" in source
    assert "Math.abs(item.icon.centerX - tileCenter)" in source
    assert "Math.abs(item.label.centerX - tileCenter)" in source
    assert '"test:cover-home-app-labels": "node ./proofs/cover/cover_home_app_labels_playwright.mjs"' in package


def test_settings_quiet_list_proof_checks_compact_live_rows() -> None:
    source = read_source("cover_settings_quiet_list_playwright.mjs")
    package = (ROOT / "tools" / "package.json").read_text(encoding="utf-8")

    assert "pucky.settings_quiet_list_browser_proof.v1" in source
    assert "const VIEWPORT = { width: 393, height: 852 };" in source
    assert "const MAX_ANY_ROW_HEIGHT = 82;" in source
    assert "const MAX_NORMAL_ROW_HEIGHT = 64;" in source
    assert '.light-settings-real .settings-card' in source
    assert "byId.advanced.rect.bottom <= VIEWPORT.height" in source
    assert 'card.style.boxShadow === "none"' in source
    assert "card.selector.hittable" in source
    assert "card.toggle.hittable" in source
    assert "card.action.hittable" in source
    assert '"test:cover-settings-quiet-list": "node ./proofs/cover/cover_settings_quiet_list_playwright.mjs"' in package


def test_workspace_proof_server_keeps_broker_state_out_of_vm_only_data_dir() -> None:
    source = read_source("workspace_apps_proof_server.py")

    assert 'os.environ.setdefault("PUCKY_DB_PATH", str((root / "broker.sqlite3").resolve()))' in source
