from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEV_PY_PATH = ROOT / "tools" / "dev.py"
LEGACY_WEB_TOKEN_ENV = "PUCKY_" + "WEB_UI_TOKEN"
LEGACY_BROWSER_TOKEN_KEY = "browser_" + "api_token"
LEGACY_LOCK_TITLE = "Preview needs " + "api_token"
LEGACY_UNLOCK_LABEL = "Unlock web " + "preview"


def read_source(name: str) -> str:
    matches = sorted((ROOT / "tools").rglob(name))
    assert matches, f"Missing proof source {name}"
    nested = [path for path in matches if "proofs" in path.parts or "support" in path.parts]
    target = nested[0] if nested else matches[0]
    return target.read_text(encoding="utf-8")


def has_source(name: str) -> bool:
    return bool(sorted((ROOT / "tools").rglob(name)))


def test_browser_facing_proofs_drop_legacy_web_ui_token_precedence() -> None:
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
    if has_source("cover_hosted_bug_hunt_playwright.mjs"):
        script_names.append("cover_hosted_bug_hunt_playwright.mjs")
    if has_source("cover_universal_feed_tiles_playwright.mjs"):
        script_names.append("cover_universal_feed_tiles_playwright.mjs")
    for script_name in script_names:
        assert LEGACY_WEB_TOKEN_ENV not in read_source(script_name), script_name


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
    assert LEGACY_BROWSER_TOKEN_KEY not in source
    assert "fetchConnectMyApps(" in source
    assert "data-links-connected-slug" in source
    assert "Reload connect directly" in source
    assert "const UNIVERSAL_FEED_TILE_ROUTES = [" in source
    assert '"inbox"' in source
    assert '"meetings"' in source
    assert '"meeting-notes"' in source
    assert '"reminders"' in source
    assert '"notes"' in source
    assert '"projects"' in source


def test_workspace_apps_browser_proof_loads_directly_without_browser_unlock() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert LEGACY_LOCK_TITLE not in source
    assert LEGACY_UNLOCK_LABEL not in source
    assert 'url.searchParams.set("api_token", String(apiToken || "").trim());' not in source
    assert LEGACY_BROWSER_TOKEN_KEY not in source


def test_notes_pin_browser_proof_loads_directly_and_keeps_row_toggle_contract() -> None:
    source = read_source("cover_notes_pin_playwright.mjs")

    assert LEGACY_LOCK_TITLE not in source
    assert LEGACY_UNLOCK_LABEL not in source
    assert LEGACY_WEB_TOKEN_ENV not in source
    assert 'request.method() === "PATCH"' in source
    assert '.light-note-row[data-note-id="march"] .light-note-pin-button' in source
    assert "Notes pin write failed" in source


def test_live_notes_centering_proof_seeds_saved_browser_token_and_verifies_patch_auth() -> None:
    source = read_source("cover_notes_feed_centering_real_vm_playwright.mjs")

    assert "PUCKY_API_TOKEN" in source
    assert LEGACY_WEB_TOKEN_ENV not in source
    assert LEGACY_LOCK_TITLE not in source
    assert LEGACY_UNLOCK_LABEL not in source
    assert 'localStorage.setItem("pucky.cover.browser_api_token.v1", String(apiToken || "").trim());' in source
    assert ".light-note-pin-button" in source
    assert "hasAuthorization" in source
    assert "first PATCH omitted Authorization" in source
    assert "first PATCH returned 401" in source
    assert "second PATCH omitted Authorization" in source
    assert "second PATCH returned 401" in source


def test_calendar_browser_proof_checks_header_chrome_geometry_and_scrolling() -> None:
    source = read_source("cover_calendar_playwright.mjs")

    assert "async function calendarChromeLayoutMetrics(page)" in source
    assert 'const headerShell = document.querySelector(".light-page-header-shell");' in source
    assert "chromeInHeaderShell" in source
    assert "chromePosition" in source
    assert "topRowWidth" in source
    assert "stripWidth" in source
    assert "laneWidth" in source
    assert "Expected calendar chrome to live inside the sticky header shell" in source
    assert "Expected calendar chrome to stop using its own sticky positioning" in source
    assert "Expected calendar top row to span the full calendar lane" in source
    assert "Expected calendar day rail to span the full calendar lane" in source
    assert 'calendar-desktop-${theme}-chrome.png' in source
    assert 'calendar-mobile-${theme}-chrome.png' in source
    assert "scrollDayStripWithButton(page, 1)" in source
    assert "scrollDayStripDirect(page, 220)" in source


def test_task_workspace_proof_page_url_seeds_api_token_for_preview_writes() -> None:
    source = read_source("task_workspace_proof_shared.mjs")

    assert 'url.searchParams.set("api_token", String(apiToken || "").trim());' in source
    assert "void apiToken;" not in source


def test_notes_detail_flash_browser_proof_v2_contract_is_first_class() -> None:
    source = read_source("cover_notes_detail_flash_playwright.mjs")
    scoring = read_source("notes_detail_flash_scoring.mjs")
    package = json.loads((ROOT / "tools" / "package.json").read_text(encoding="utf-8"))
    dev_source = (ROOT / "tools" / "dev.py").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    docs_readme = (ROOT / "docs" / "README.md").read_text(encoding="utf-8")

    assert LEGACY_WEB_TOKEN_ENV not in source
    assert "pucky.notes_detail_flash_browser_proof.v2" in scoring
    assert 'schema: NOTES_DETAIL_FLASH_RESULT_SCHEMA_V2,' in source
    assert 'build_verified: false,' in source
    assert 'build_dirty: false,' in source
    assert 'remote_manifest: null,' in source
    assert 'target_kind: targetKindForBaseUrl(config.baseUrl),' in source
    assert 'debug_note_flash: true,' in source
    assert 'route_delay_ms: NOTES_DETAIL_FLASH_ROUTE_DELAY_MS,' in source
    assert 'iframe_delay_ms: NOTES_DETAIL_FLASH_IFRAME_DELAY_MS,' in source
    assert 'offsets_ms: NOTES_DETAIL_FLASH_OFFSETS_MS.slice(),' in source
    assert 'required_phases: NOTES_DETAIL_FLASH_REQUIRED_PHASES.slice(),' in source
    assert 'failure_categories: NOTES_DETAIL_FLASH_FAILURE_CATEGORIES.slice(),' in source
    assert 'natural_click: lanes.natural_click,' in source
    assert 'route_delay: lanes.route_delay,' in source
    assert 'iframe_delay: lanes.iframe_delay,' in source
    assert 'await context.tracing.start({ screenshots: true, snapshots: true, sources: true });' in source
    assert 'recordVideo: { dir: path.join(laneDir, "video"), size: VIEWPORT },' in source
    assert 'window.__puckyNoteFlashTimelinePromise = new Promise((resolve) => {' in source
    assert 'window.__puckyNoteFlashDebug' in source
    assert 'url.searchParams.set("debug_note_flash", "1");' in source
    assert 'url.searchParams.set("debug_note_flash_delay_route_ms", String(laneConfig.routeDelayMs || 0));' in source
    assert 'url.searchParams.set("debug_note_flash_delay_iframe_ms", String(laneConfig.iframeDelayMs || 0));' in source
    assert 'document.querySelector(".light-detail-html-body")' in source
    assert 'const frame = wrapper?.querySelector(".light-html-frame");' in source
    assert 'body_text: bodyText,' in source
    assert 'shell?.getAttribute("data-light-route") !== "note-detail"' in source
    assert 'text.includes(title) && text.includes(bodyText)' in source
    assert '}, { timeout: timeoutMs });' in source
    assert '}, undefined, { timeout: 1200 }).then(() => true).catch(() => false);' in source
    assert "Blocked script execution in 'about:blank' because the document's frame is sandboxed and the 'allow-scripts' permission is not set." in source
    assert "Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set." in source
    assert 'buildAttemptName(theme, lane, "preclick")' in source
    assert 'buildAttemptName(theme, lane, "first-route-frame")' in source
    assert 'buildAttemptName(theme, lane, "settled")' in source
    assert 'const stem = `${theme}-${lane}-offset-${String(offsetMs).padStart(3, "0")}ms`;' in source
    assert '`${theme}-${lane}-worst-frame.png`' in source
    assert "build_mismatch" in scoring
    assert "theme_cross_flash" in scoring
    assert "route_transition_flash" in scoring
    assert "iframe_transition_flash" in scoring
    assert "note_never_ready" in scoring
    assert "seed_note_missing" in scoring
    assert "instrumentation_gap" in scoring
    assert "console_error_during_transition" in scoring
    assert 'export const NOTES_DETAIL_FLASH_OFFSETS_MS = Object.freeze([0, 12, 24, 36, 48, 72, 96, 132, 180, 260]);' in scoring
    assert 'export const NOTES_DETAIL_FLASH_LANES = Object.freeze(["natural_click", "route_delay", "iframe_delay"]);' in scoring
    assert "mean_luma>" in scoring
    assert "bright_pixel_ratio>" in scoring
    assert "mean_luma<" in scoring
    assert "dark_pixel_ratio>" in scoring
    assert package["scripts"]["test:cover-notes-detail-flash-browser"] == "node ./proofs/cover/cover_notes_detail_flash_playwright.mjs"
    assert '"proof-local-notes-flash": "Boot the local workspace proof server, then run the targeted notes flash browser proof."' in dev_source
    assert '"proof-live-notes-flash": "Run the live targeted notes flash browser proof against the current base URL env/default."' in dev_source
    assert '"proof-local-notes-flash-browser": "Boot the local workspace proof server and run the v2 Notes fast-twitch browser proof against the current local bundle."' in dev_source
    assert '"proof-live-notes-flash-browser": "Run the v2 Notes fast-twitch browser proof against the hosted VM with manifest verification."' in dev_source
    assert "def find_free_localhost_port() -> int:" in dev_source
    assert 'sock.bind(("127.0.0.1", 0))' in dev_source
    assert "def build_local_workspace_proof_server_command(port: int, *, state_dir: Path | None = None) -> list[str]:" in dev_source
    assert 'base_url = f"http://127.0.0.1:{port}"' in dev_source
    assert 'server_command=build_local_workspace_proof_server_command(' in dev_source
    assert 'health_url=f"{base_url}/healthz"' in dev_source
    assert 'if args.task in ("proof-local-notes-flash", "proof-local-notes-flash-browser"):' in dev_source
    assert 'if args.task in ("proof-live-notes-flash", "proof-live-notes-flash-browser"):' in dev_source
    assert "python -m tools.dev proof-local-notes-flash-browser" in readme
    assert "python -m tools.dev proof-live-notes-flash-browser" in readme
    assert "Notes flash browser proof (local): `python -m tools.dev proof-local-notes-flash-browser`" in docs_readme
    assert "Notes flash browser proof (live): `python -m tools.dev proof-live-notes-flash-browser`" in docs_readme


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

    assert 'document.querySelector(".light-task-detail-card")' in source
    assert 'document.querySelector(".light-task-status-circle")' in source
    assert 'document.querySelector(".light-task-detail-created")' in source
    assert 'document.querySelector(".light-task-status-trigger")' not in source
    assert 'document.querySelector(".light-task-status-circle-trigger")' not in source
    assert '".light-task-row-status-trigger"' in source
    assert 'detailState.statusValue === "done"' in source
    assert 'detailState.statusLabel === "Done"' in source
    assert 'assert(!detailState.sections.includes("people")' in source
    assert 'detailState.sections.includes("description")' in source
    assert 'detailState.sections.includes("checklist")' in source
    assert 'detailState.sections.includes("connected")' in source
    assert 'detailState.createdMeta' in source
    assert 'detailState.descriptionIsFirstSection' in source
    assert "light-task-detail-body" not in source
    assert "lightHtmlFrame" not in source
    assert ".light-task-detail-toggle" not in source


def test_live_user_session_proof_checks_task_focus_ring_is_gone() -> None:
    source = read_source("cover_live_user_session_playwright.mjs")

    assert "function readTaskRowFocusState(page, taskId)" in source
    assert "function readTaskDetailFocusState(page)" in source
    assert "function assertNoVisibleTaskFocusRing(state, context)" in source
    assert "task_row_outline_style" in source
    assert "task_row_outline_width" in source
    assert "task_detail_outline_style" in source
    assert "task_detail_outline_width" in source
    assert "assertNoVisibleTaskFocusRing(listFocusState" in source
    assert "assertNoVisibleTaskFocusRing(detailFocusState" in source
    assert "Task list status selector opened in place without a blue focus rectangle." in source
    assert "Task detail header selector opened in place without a blue focus rectangle." in source


def test_live_user_session_proof_requires_clean_task_detail_layout_and_chevron_free_rows() -> None:
    source = read_source("cover_live_user_session_playwright.mjs")

    assert "header_created_meta" in source
    assert "checklist_immediately_after_description" in source
    assert 'assert(!taskState.sections.includes("details")' in source
    assert 'assert(!taskState.sections.includes("people")' in source
    assert 'assert(taskState.checklist_immediately_after_description' in source
    assert 'assert(taskState.header_created_meta' in source
    assert "task_detail_chevron_count" in source
    assert 'querySelectorAll(".light-info-row .light-chevron")' in source
    assert 'assert(taskState.task_detail_chevron_count === 0' in source
    assert "Task detail keeps the compact header, checklist-first layout, and chevron-free linked rows." in source
    assert "for (const link of TASK_LINKS)" in source


def test_live_user_session_proof_checks_task_filter_selector_icons_and_checklist_autostatus() -> None:
    source = read_source("cover_live_user_session_playwright.mjs")

    assert "function readTaskFilterSelectorState(page)" in source
    assert "function assertTaskFilterSelectorLeadingVisuals(state, context)" in source
    assert "task_filter_selector_options" in source
    assert "selector_option_count" in source
    assert "has_leading_visual" in source
    assert "Open dark task filter selector" in source
    assert "Open light task filter selector" in source
    assert "Task filter selector renders leading visuals for every task category in dark mode." in source
    assert "Task filter selector renders leading visuals for every task category in light mode." in source
    assert "Complete final task checklist item" in source
    assert "Reopen task by unchecking a completed checklist item" in source
    assert 'assert(taskStateAfterChecklistDone.task_status === "done"' in source
    assert 'assert(taskStateAfterChecklistReopen.task_status === "in_progress"' in source
    assert 'assert(taskRecordAfterChecklistDone.status === "done"' in source
    assert 'assert(taskRecordAfterChecklistReopen.status === "in_progress"' in source


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
    assert "allowAutoplayBypass" in source
    assert 'config.browserName = browserName === "webkit" ? "webkit" : "chromium";' in source
    assert 'if (browserName === "webkit") {' in source
    assert 'await context.tracing.start({ screenshots: true, snapshots: true, sources: true });' in source
    assert 'recordVideo: { dir: videoDir, size: VIEWPORT }' in source
    assert 'writeJsonFile(path.join(config.reportDir, "network.json"), networkEvents);' in source
    assert 'writeJsonFile(path.join(config.reportDir, "console.json"), consoleMessages);' in source
    assert 'fs.writeFileSync(path.join(config.reportDir, "final-dom.html"), await page.content(), "utf8");' in source
    assert 'immediate_feedback: immediateFeedbackResult(startStop),' in source
    assert 'playing_stability: playingStabilityResult(startStop),' in source
    assert 'cross_card: crossCard ? crossCardResult(crossCard) : { pass: false, reason: "No secondary audio card found." },' in source
    assert 'assert(summary.results.immediate_feedback.pass' in source
    assert 'assert(summary.results.playing_stability.pass' in source
    assert 'assert(summary.results.cross_card.pass' in source
    assert "observed_start_ms: observedStartMs" in source
    assert "max_position_ms: maxPositionMs" in source
    assert 'assert(summary.results.injected_failure.pass' in source
    assert 'assert(summary.results.injected_early_stop.pass' in source
    assert 'summary.evidence.video_path = pageVideo ? await pageVideo.path().catch(() => "") : "";' in source
    assert package["scripts"]["test:cover-inbox-tile-audio-truth"] == "node ./proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs"


def test_light_native_ports_proof_adds_real_render_and_scroll_contracts() -> None:
    source = read_source("cover_light_native_ports_playwright.mjs")

    assert "assertMeaningfulRows(" in source
    assert "readScrollReachability(" in source
    assert "reached_bottom" in source
    assert "maxPositionMs" in source
    assert "function requiredAudioProgressDelta(" in source
    assert "required_delta_ms: requiredDeltaMs" in source
    assert "return 2000;" in source
    assert "player_delta_ms >= 500" in source
    assert "Open audio controls" in source
    assert "openAudioControls(" in source
    assert "inbox_audio_controls" in source
    assert "scrollability" in source


def test_inbox_media_proof_server_uses_fixtures_without_mock_rewrite() -> None:
    source = read_source("cover_inbox_media_proof_server.py")

    assert 'parsed.path == "/ui/pucky/fixtures/reply_cards.json"' in source
    assert 'mock_artifact_prefix="fixtures/artifacts"' in source
    assert '"/ui/pucky/fixtures/reply_cards.json"' in source

def test_universal_feed_tiles_browser_proof_contract_is_first_class() -> None:
    source = read_source("cover_universal_feed_tiles_playwright.mjs")
    package = json.loads((ROOT / "tools" / "package.json").read_text(encoding="utf-8"))
    dev_source = (ROOT / "tools" / "dev.py").read_text(encoding="utf-8")

    assert 'const RESULT_SCHEMA = "pucky.universal_feed_tiles_browser_proof.v1";' in source
    assert "const MOBILE_VIEWPORT = { width: 430, height: 932 };" in source
    assert "const DESKTOP_VIEWPORT = { width: 1440, height: 980 };" in source
    assert 'themes: ["light", "dark"]' in source
    assert 'viewportModes: ["mobile", "desktop"]' in source
    assert 'route: "notes"' in source
    assert 'route: "meeting-notes"' in source
    assert 'route: "reminders"' in source
    assert 'route: "projects"' in source
    assert 'route: "inbox"' in source
    assert 'route: "meetings"' in source
    assert 'await context.tracing.start({ screenshots: true, snapshots: true, sources: true });' in source
    assert 'recordVideo: { dir: videoDir, size: viewport }' in source
    assert 'writeJsonFile(path.join(config.reportDir, "summary.json"), summary);' in source
    assert 'writeJsonFile(path.join(config.reportDir, "console.json"), consoleEvents);' in source
    assert 'writeJsonFile(path.join(config.reportDir, "network.json"), networkEvents);' in source
    assert 'saveScreenshot(page, path.join(routeDir, `${prefix}-route-top.png`));' in source
    assert 'saveScreenshot(page, path.join(routeDir, `${prefix}-detail-open.png`));' in source
    assert 'saveScreenshot(page, path.join(routeDir, `${prefix}-back-to-list.png`));' in source
    assert 'saveScreenshot(page, path.join(routeDir, `${prefix}-archive-reveal.png`));' in source
    assert "document.documentElement.scrollWidth" in source
    assert "window.getComputedStyle(firstRow)" in source
    assert "borderTopWidth" in source
    assert "borderTopLeftRadius" in source
    assert "boxShadow" in source
    assert "backgroundColor" in source
    assert "paddingLeft" in source
    assert "paddingRight" in source
    assert "dividerColor" in source
    assert ".light-feed-page" in source
    assert ".light-feed-surface" in source
    assert ".light-feed-section" in source
    assert ".is-flat-feed" in source
    assert '.card-wrap > article.card' in source
    assert ".card.card-meeting-list" in source
    assert "assertFlatShellState(" in source
    assert "revealArchiveWithoutMutating(" in source
    assert package["scripts"]["test:cover-universal-feed-tiles"] == "node ./proofs/cover/cover_universal_feed_tiles_playwright.mjs"
    assert '"proof-local-universal-tiles": "Boot the local inbox/media proof server and run the six-route universal feed tile browser proof against the current local bundle."' in dev_source
    assert '"proof-live-universal-tiles": "Run the six-route universal feed tile browser proof against the hosted VM with screenshots, summaries, trace, and video artifacts."' in dev_source
    assert "cover_universal_feed_tiles_playwright.mjs" in dev_source


def test_hosted_bug_hunt_contract_includes_universal_feed_tiles_acceptance_surface() -> None:
    source = read_source("cover_hosted_bug_hunt_playwright.mjs")

    assert 'id: "universal_feed_tiles"' in source
    assert 'label: "Universal feed tiles"' in source
    assert 'script: "tools/proofs/cover/cover_universal_feed_tiles_playwright.mjs"' in source
    assert "universal_feed_tiles" in source


def test_universal_feed_tiles_proof_tracks_inbox_content_width_metrics() -> None:
    source = read_source("cover_universal_feed_tiles_playwright.mjs")

    assert "firstRowContentMetrics" in source
    assert "rowActionMetrics" in source
    assert "identityRect" in source
    assert "bodyRect" in source
    assert "actionsRect" in source
    assert "titleRect" in source
    assert "summaryRect" in source
    assert "actionCount" in source
    assert "first_row_content_metrics: metrics.firstRowContentMetrics" in source
    assert "row_action_metrics: metrics.rowActionMetrics" in source
    assert "Inbox: missing first-row content metrics" in source
    assert "Inbox: one-action rows should not reserve the old wide action rail" in source
    assert "Inbox: two-action rows should stay tighter than the old 98px rail" in source


def test_calendar_and_hosted_bug_hunt_proofs_cover_event_container_clicks() -> None:
    calendar_source = read_source("cover_calendar_playwright.mjs")
    hosted_source = read_source("cover_hosted_bug_hunt_playwright.mjs")

    assert "async function selectCalendarEventByContainer(" in calendar_source
    assert "calendar-desktop-${theme}-event-detail-container-click.png" in calendar_source
    assert "calendar-mobile-${theme}-detail-container-click.png" in calendar_source
    assert "Expected calendar body click to open meeting-detail" in calendar_source
    assert 'openerSelector: ".light-event-block"' in hosted_source
