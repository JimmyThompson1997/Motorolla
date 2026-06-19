from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEV_PY_PATH = ROOT / "tools" / "dev.py"


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
    assert 'await openRouteFromHome(page, "meeting-notes", config.timeoutMs);' in source
    assert 'await openRouteFromHome(page, "reminders", config.timeoutMs);' in source


def test_live_user_session_browser_proof_avoids_stale_routes_and_contacts_edit() -> None:
    if not has_source("cover_live_user_session_playwright.mjs"):
        return
    source = read_source("cover_live_user_session_playwright.mjs")

    assert "route=apps" not in source
    assert "route=feed" not in source
    assert "contacts-edit" not in source
    assert 'url.searchParams.set("api_token"' not in source
    assert "browser_api_token" not in source
    assert "fetchConnectMyApps(" in source
    assert "data-links-connected-slug" in source
    assert "Reload connect directly" in source


def test_workspace_apps_browser_proof_loads_directly_without_browser_unlock() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "Preview needs api_token" not in source
    assert "Unlock web preview" not in source
    assert 'url.searchParams.set("api_token", String(apiToken || "").trim());' not in source
    assert "browser_api_token" not in source

def test_workspace_apps_browser_proof_checks_full_bleed_note_detail_layout() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "const DESKTOP_NOTE_DETAIL_VIEWPORT = { width: 1280, height: 900 };" in source
    assert "headerBottom" in source
    assert "bodyTop" in source
    assert "feedScrollTop" in source
    assert "pageScrollHeight" in source
    assert "frameClientHeight" in source
    assert "frameScrollHeight" in source
    assert "Expected notes list to scroll before opening detail" in source
    assert "shell scroll to reset to top" in source
    assert "Expected note HTML body to start directly below the header" in source
    assert "Expected note detail iframe height to cover its document height" in source
    assert "Expected note detail desktop HTML body to remain full width" in source

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


def test_notes_flash_browser_proof_tracks_theme_transition_and_dev_tasks() -> None:
    source = read_source("cover_notes_detail_flash_playwright.mjs")
    dev = DEV_PY_PATH.read_text(encoding="utf-8")
    package = (ROOT / "tools" / "package.json").read_text(encoding="utf-8")

    assert "PUCKY_WEB_UI_TOKEN" in source
    assert "PUCKY_WORKSPACE_PROOF_TOKEN" in source
    assert "PUCKY_API_TOKEN" in source
    assert 'const RESULT_SCHEMA = "pucky.notes_detail_flash_browser_proof.v1";' in source
    assert 'const TRANSITION_DELAY_MS = 450;' in source
    assert 'const FAIL_OPEN_MS = 1500;' in source
    assert 'frame.addEventListener("load", markReady, { once: true });' not in source
    assert 'window.setTimeout(() => descriptor.set.call(this, value), delayMs);' not in source
    assert 'window.setTimeout(() => descriptor.set.call(frame, value), delayMs);' in source
    assert 'wrapperState === "loading"' in source
    assert 'background === "rgb(8, 17, 28)"' in source
    assert 'background === "rgb(255, 255, 255)"' in source
    assert '"summary.json"' in source
    assert '"report.md"' in source
    assert 'path.join(config.reportDir, "report.md")' in source
    assert "saveScreenshot(page, config.reportDir, `${theme}-transition`)" in source
    assert "saveScreenshot(page, config.reportDir, `${theme}-settled`)" in source
    assert '"proof-local-notes-flash"' in dev
    assert '"proof-live-notes-flash"' in dev
    assert '"tools/proofs/cover/cover_notes_detail_flash_playwright.mjs"' in dev
    assert '"test:cover-notes-detail-flash": "node ./proofs/cover/cover_notes_detail_flash_playwright.mjs"' in package


def test_workspace_apps_browser_proof_removes_contact_endpoints_contract() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "assertNoContactEndpoints" in source
    assert "should not render an Endpoints section" in source
    assert "API metadata should not expose endpoints" in source
    assert "endpoints: [{" not in source


def test_workspace_apps_browser_proof_checks_flat_contact_header_contract() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "assertFlatContactProfileCard" in source
    assert '".light-contact-detail-page .light-profile-card"' in source
    assert 'cardState.backgroundColor === "rgba(0, 0, 0, 0)"' in source
    assert 'cardState.boxShadow === "none"' in source
    assert 'cardState.borderRadius === "0px"' in source
    assert "profile card should not have a visible border" in source
    assert "should render the Contact section" in source
    assert "should render the Activity section" in source


def test_workspace_apps_browser_proof_checks_contact_photo_thumbnail_contract() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "assertContactPhotoThumbnails" in source
    assert "Clinic front desk should not render in Contacts" in source
    assert "contact-me should remain initials-only" in source
    assert "naturalWidth" in source
    assert "objectFit" in source
    assert ".light-contact-row .light-avatar.has-photo img" in source


def test_workspace_apps_browser_proof_rejects_contact_html_document_contract() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "assertNoContactHtmlDocument" in source
    assert "should not render a Contact HTML document panel" in source
    assert "API contact record should not expose document HTML" in source
    assert "No generated contact page yet." not in source


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


def test_inbox_audio_truth_proof_is_toolchain_first_class() -> None:
    source = read_source("cover_inbox_tile_audio_truth_playwright.mjs")
    package = json.loads((ROOT / "tools" / "package.json").read_text(encoding="utf-8"))

    assert '"--skip-canonical-check"' in source
    assert "isLocalProofUrl" in source
    assert "isLocalProof" in source
    assert package["scripts"]["test:cover-inbox-tile-audio-truth"] == "node ./proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs"


def test_light_native_ports_proof_adds_real_render_and_scroll_contracts() -> None:
    source = read_source("cover_light_native_ports_playwright.mjs")

    assert "assertMeaningfulRows(" in source
    assert "readScrollReachability(" in source
    assert "reached_bottom" in source
    assert "Open audio controls" in source
    assert "openAudioControls(" in source
    assert "inbox_audio_controls" in source
    assert "scrollability" in source


def test_inbox_media_proof_server_uses_fixtures_without_mock_rewrite() -> None:
    source = read_source("cover_inbox_media_proof_server.py")

    assert 'parsed.path == "/ui/pucky/fixtures/reply_cards.json"' in source
    assert 'mock_artifact_prefix="fixtures/artifacts"' in source
    assert '"/ui/pucky/fixtures/reply_cards.json"' in source
