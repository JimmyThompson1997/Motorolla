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
        "cover_notes_detail_flash_playwright.mjs",
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


def test_live_user_session_browser_proof_avoids_stale_routes_and_supports_contacts_edit() -> None:
    if not has_source("cover_live_user_session_playwright.mjs"):
        return
    source = read_source("cover_live_user_session_playwright.mjs")

    assert "route=apps" not in source
    assert "route=feed" not in source
    assert 'shouldRunRoute(config, "contacts-edit")' in source
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
    assert '"tags"' not in source


def test_live_user_session_browser_proof_tracks_failed_requests_and_mobile_connect_noise() -> None:
    if not has_source("cover_live_user_session_playwright.mjs"):
        return
    source = read_source("cover_live_user_session_playwright.mjs")

    assert "buildPageTracking(" in source
    assert "failed_requests" in source
    assert "http_error_responses" in source
    assert "seriousFailedRequests(" in source
    assert "seriousHttpErrorResponses(" in source
    assert "ERR_HTTP2_PROTOCOL_ERROR" in source


def test_workspace_apps_browser_proof_loads_directly_without_browser_unlock() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert LEGACY_LOCK_TITLE not in source
    assert LEGACY_UNLOCK_LABEL not in source
    assert 'url.searchParams.set("api_token", String(apiToken || "").trim());' not in source
    assert LEGACY_BROWSER_TOKEN_KEY not in source


def test_reminder_browser_proofs_require_graph_only_connected_feed() -> None:
    reminder_source = read_source("reminders_v3_browser_proof.mjs")
    workspace_source = read_source("cover_workspace_apps_playwright.mjs")

    assert "Expected no Connected feed when reminder has no graph links" in reminder_source
    assert "Expected no Connected section title when reminder has no graph links" in reminder_source
    assert "Expected reminder detail to omit reminder-native Connected rows" in reminder_source
    assert "detail.nativeTileLabels.length === 0" in reminder_source
    assert "detail.connectedCount === 0" in reminder_source
    assert "installAuthorizedApiProxy(" not in reminder_source
    assert 'headers.authorization = `Bearer ${token}`' not in reminder_source
    assert "document.querySelectorAll('[data-reminder-detail-tile=\"recipient\"]').length === 0" in workspace_source
    assert "document.querySelectorAll('[data-reminder-detail-tile=\"when\"]').length === 0" in workspace_source
    assert 'JSON.stringify(feedLabels) === JSON.stringify(["Proof Future Task", "Proof Graph Meeting", "Proof Alpha Project"])' in workspace_source
    assert 'for (const text of ["Proof Future Task", "Proof Graph Meeting", "Proof Alpha Project", "CONNECTED"]) {' in workspace_source
    assert 'for (const text of ["When", "Me", "Proof Contact One", "Proof Future Task", "Proof Graph Meeting", "CONNECTED"]) {' not in workspace_source


def test_universal_feed_tiles_browser_proof_loads_directly_without_browser_unlock() -> None:
    source = read_source("cover_universal_feed_tiles_playwright.mjs")

    assert LEGACY_LOCK_TITLE not in source
    assert LEGACY_UNLOCK_LABEL not in source
    assert "unlockPreviewIfNeeded(" not in source
    assert 'url.searchParams.set("api_token", String(apiToken || "").trim());' not in source


def test_notes_pin_browser_proof_loads_directly_and_keeps_row_toggle_contract() -> None:
    source = read_source("cover_notes_pin_playwright.mjs")

    assert LEGACY_LOCK_TITLE not in source
    assert LEGACY_UNLOCK_LABEL not in source
    assert LEGACY_WEB_TOKEN_ENV not in source
    assert 'request.method() === "PATCH"' in source
    assert '.light-note-row[data-note-id="march"] .light-note-pin-button' in source
    assert "Notes pin write failed" in source


def test_notes_centering_write_proof_stays_out_of_release_lane_and_uses_api_token() -> None:
    source = read_source("cover_notes_feed_centering_real_vm_playwright.mjs")
    package = json.loads((ROOT / "tools" / "package.json").read_text(encoding="utf-8"))
    dev_source = DEV_PY_PATH.read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    docs_readme = (ROOT / "docs" / "README.md").read_text(encoding="utf-8")

    assert "PUCKY_API_TOKEN" in source
    assert LEGACY_WEB_TOKEN_ENV not in source
    assert "test:cover-notes-feed-centering" not in package["scripts"]
    assert "cover_notes_feed_centering_real_vm_playwright.mjs" not in dev_source
    assert "cover_notes_feed_centering_real_vm_playwright.mjs" not in readme
    assert "cover_notes_feed_centering_real_vm_playwright.mjs" not in docs_readme


def test_calendar_browser_proof_checks_header_chrome_geometry_and_scrolling() -> None:
    source = read_source("cover_calendar_playwright.mjs")

    assert "async function calendarChromeLayoutMetrics(page)" in source
    assert "settingsButtonClassName" in source
    assert "settingsButtonBackground" in source
    assert "settingsButtonBorderWidth" in source
    assert "settingsButtonBoxShadow" in source
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
    assert "Expected calendar settings button to use the plain icon-button class" in source
    assert "Expected calendar settings button to drop the circular shell border" in source
    assert "Expected calendar settings button to drop the circular shell fill" in source
    assert "Expected calendar settings button to drop the circular shell shadow" in source
    assert "Expected off-today calendar header to stay free of Today CTA" in source
    assert "Expected mobile off-today calendar header to stay free of Today CTA" in source
    assert "Expected Connected rows to omit linked-record chips on desktop detail" in source
    assert "Expected mobile Connected rows to omit linked-record chips" in source
    assert "Expected Connected section to render inside one shared flat-feed shell on desktop detail" in source
    assert "Expected mobile Connected section to render inside one shared flat-feed shell" in source
    assert 'calendar-desktop-${theme}-chrome.png' in source
    assert 'calendar-desktop-${theme}-off-today.png' in source
    assert 'calendar-desktop-${theme}-connected.png' in source
    assert 'calendar-desktop-${theme}-settings-button.png' in source
    assert 'calendar-mobile-${theme}-chrome.png' in source
    assert 'calendar-mobile-${theme}-off-today.png' in source
    assert 'calendar-mobile-${theme}-connected.png' in source
    assert 'calendar-mobile-${theme}-settings-button.png' in source
    assert "scrollDayStripToDay(page, firstDayKey, \"start\")" in source
    assert "continueDayStripBeyondEdge(page, \"left\")" in source
    assert "continueDayStripBeyondEdge(page, \"right\")" in source


def test_calendar_browser_proof_retries_manifest_fetch_and_reacquires_event_container() -> None:
    source = read_source("cover_calendar_playwright.mjs")

    assert "const LOCATOR_SHOT_ATTEMPTS = 4;" in source
    assert "const LOCATOR_SHOT_RETRY_MS = 150;" in source
    assert "const MANIFEST_FETCH_ATTEMPTS = 4;" in source
    assert "const MANIFEST_FETCH_RETRY_MS = 750;" in source
    assert "const CALENDAR_EVENT_CONTAINER_ATTEMPTS = 4;" in source
    assert "const CALENDAR_EVENT_CONTAINER_RETRY_MS = 250;" in source
    assert "async function delay(ms)" in source
    assert "async function saveLocatorShot(locator, reportDir, name, summary)" in source
    assert "for (let attempt = 1; attempt <= LOCATOR_SHOT_ATTEMPTS; attempt += 1)" in source
    assert 'await locator.waitFor({ state: "visible" });' in source
    assert "await locator.scrollIntoViewIfNeeded();" in source
    assert "await locator.screenshot({ path: target });" in source
    assert "await delay(LOCATOR_SHOT_RETRY_MS * attempt);" in source
    assert "async function calendarEventContainerBox(page, selector)" in source
    assert "await page.waitForFunction(targetSelector => {" in source
    assert 'eventCard.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });' in source
    assert "for (let attempt = 1; attempt <= CALENDAR_EVENT_CONTAINER_ATTEMPTS; attempt += 1)" in source
    assert "await delay(CALENDAR_EVENT_CONTAINER_RETRY_MS * attempt);" in source
    assert "const box = await calendarEventContainerBox(page, proofEventSelector(seed));" in source
    assert "for (let attempt = 1; attempt <= MANIFEST_FETCH_ATTEMPTS; attempt += 1)" in source
    assert "summary.manifest_fetch_attempts = Number(summary.manifest?._proof_fetch_attempt || 0) || 1;" in source
    assert "await delay(MANIFEST_FETCH_RETRY_MS * attempt);" in source
    assert "async function waitForCalendarTitle(page, title)" in source
    assert 'await waitForCalendarTitle(page, "Proof freelance review call");' in source
    assert 'await waitForCalendarTitle(page, "Proof Katy pickup handoff");' in source
    assert "async function waitForMeetingDetailWhoChip(page, label)" in source
    assert 'await waitForMeetingDetailWhoChip(page, "Jimmy T.");' in source
    assert 'await waitForMeetingDetailWhoChip(page, "Jeff B.");' in source
    assert "kindByRoute" in source
    assert "await page.waitForFunction(({ targetSelector, targetText }) => {" in source
    assert 'targetRow.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });' in source
    assert "targetRow.click();" in source
    assert 'const allowedRoutes = new Set([route]);' in source
    assert "async function openCalendarProofRoot(page, config, theme)" in source
    assert 'await page.goto(pageUrl(config.baseUrl, config.apiToken, theme), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });' in source
    assert 'await openCalendarProofRoot(page, config, theme);' in source
    assert 'waitUntil: "networkidle"' not in source
    assert 'await selectCalendarEventById(page, seed, "late-call", "Proof late call");' in source
    assert "const whoChipTexts = detailState.whoChipTexts;" in source
    assert 'for (const label of ["Jimmy T.", "Jeff B.", "Outside counsel"]) {' in source
    assert 'assert(await page.locator(\'.light-calendar-detail-row[data-detail-row=\"who\"] .light-attendee-chip-guest\').count() >= 1' not in source


def test_task_workspace_proof_page_url_keeps_hosted_page_access_token_free() -> None:
    source = read_source("task_workspace_proof_shared.mjs")

    assert 'url.searchParams.set("api_token", String(apiToken || "").trim());' not in source
    assert "void apiToken;" in source


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


def test_workspace_apps_browser_proof_captures_contacts_flat_list_contract() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "readContactsListFlatness" in source
    assert "contacts_list_flatness" in source
    assert "Contacts list should render flat-feed rows" in source
    assert "Contacts list should stay visually flat" in source
    assert "Contacts list should remove detached side padding" in source
    assert "Contacts list should keep divider separation between rows" in source
    assert "Me contact should remain pinned first in Contacts" in source


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


def test_workspace_apps_browser_proof_captures_contacts_search_contract() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")
    shared = read_source("task_workspace_proof_shared.mjs")

    assert "readContactsSearchState" in source
    assert "setContactsSearchQuery" in source
    assert "expectContactsSearchRows" in source
    assert "installContactsSearchTrace" in source
    assert "traceContactsSearchTyping" in source
    assert 'const emailQuery = "one@example";' in source
    assert 'const phoneQuery = "0101000";' in source
    assert 'const phraseQuery = "Linked to Alpha";' in source
    assert 'const reminderQuery = "reminder";' in source
    assert 'const noMatchQuery = "zzzz-no-match";' in source
    assert 'const stabilityQuery = "dav";' in source
    assert "No contacts match your search." in source
    assert "Expected active Contacts search query to survive contact-detail Back" in source
    assert "Expected Contacts search to reset after leaving the Contacts surface" in source
    assert "Expected Contacts search typing to avoid blur/focusout while filtering" in source
    assert "Expected Contacts search typing to keep the same mounted input" in source
    assert "contacts-search-filtered-email" in source
    assert "contacts-search-filtered-phone" in source
    assert "contacts-search-filtered-phrase" in source
    assert "contacts-search-empty" in source
    assert "contacts-search-cleared" in source
    assert "contacts-search-detail-from-filter" in source
    assert "contacts-search-initials" in source
    assert "contacts-search-stability" in source
    assert 'phone: "+1 (415) 555-0188"' in shared
    assert 'activity: ["Linked to live alpha"]' in shared
    assert 'title: "David"' in shared
    assert 'title: "Daniel"' in shared


def test_workspace_apps_browser_proof_captures_contacts_edit_contract() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "readContactEditState" in source
    assert "saveContactEditAndWaitForDetail" in source
    assert "contacts-edit-open" in source
    assert "contacts-edit-name" in source
    assert "contacts-edit-photo" in source
    assert "contacts-edit-back-to-list" in source
    assert "Updated Proof Contact" in source
    assert "Updated from local proof edit flow" in source
    assert "updated.proof.one@example.com" in source
    assert "Expected contact edit to persist the updated title" in source
    assert "Expected contact edit to persist the uploaded photo asset" in source
    assert 'input[type="file"][data-contact-photo-input="true"]' in source


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
    assert 'detailState.createdMeta.startsWith("Created ")' in source
    assert 'detailState.createdMeta.startsWith("Completed ")' in source
    assert 'detailState.descriptionIsFirstSection' in source
    assert "light-task-detail-body" not in source
    assert "lightHtmlFrame" not in source
    assert ".light-task-detail-toggle" not in source

def test_workspace_apps_browser_proof_cleans_up_reminders_before_contacts_and_sweeps_prefix_records() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert 'const CLEANUP_RECORD_COLLECTION_ORDER = [' in source
    cleanup_section = source.split("const CLEANUP_RECORD_COLLECTION_ORDER = [", 1)[1].split("];", 1)[0]
    assert '"reminders"' in cleanup_section
    assert cleanup_section.index('"reminders"') < cleanup_section.index('"contacts"')
    assert "startsWith(`${runId}-`)" in source or "startsWith(prefix)" in source
    assert "sweepSeedRecordsByPrefix" in source


def test_reminders_browser_proof_covers_orphaned_recipient_actions() -> None:
    source = read_source("reminders_v3_browser_proof.mjs")

    assert "orphanContactId" in source
    assert "orphanDismissReminderId" in source
    assert "orphanSnoozeReminderId" in source
    assert 'await apiRequest(config, "DELETE", `/api/workspace/contacts/${orphanContactId}`' in source
    assert '[data-reminder-action="dismiss"]' in source
    assert '[data-reminder-action="snooze"]' in source
    assert "error toast" in source.lower()


def test_workspace_tasks_archive_proof_covers_today_first_select_mode_and_detail_archive() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert 'JSON.stringify(["Today", "Overdue", "Upcoming", "Done"])' in source
    assert "Expected task section order Today/Overdue/Upcoming/Done" in source
    assert "Select tasks" in source
    assert "Archive task" in source
    assert "bulk_archive" in source
    assert "detail_archive" in source
    assert ".light-task-filter-button" not in source


def test_live_connect_auth_browser_proof_requires_explicit_token_and_real_transition() -> None:
    source = read_source("cover_links_auth_flow_live_playwright.mjs")
    package = (ROOT / "tools" / "package.json").read_text(encoding="utf-8")

    assert "PUCKY_WEB_UI_TOKEN" in source
    assert "PUCKY_API_TOKEN" in source
    assert 'new URL("/ui/pucky/latest/",' in source
    assert "/ui/pucky/latest/index.html" not in source
    assert 'url.searchParams.set("api_token", String(config.apiToken || "").trim());' in source
    assert 'url.searchParams.set("route", "connect");' in source
    assert 'if (transition.kind === "none") {' in source
    assert "never opened an auth surface" in source
    assert '"test:cover-links-auth-flow-live": "node ./proofs/cover/cover_links_auth_flow_live_playwright.mjs"' in package


def test_emulator_connect_auth_proof_uses_chrome_cdp_and_no_mock_http_server() -> None:
    source = read_source("phone_links_auth_flow_emulator_proof.py")
    helper = read_source("phone_links_auth_flow_browser.js")

    assert "PUCKY_API_TOKEN" in source
    assert "PUCKY_DEVICE_TOKEN" in source
    assert "10.0.2.2" not in source
    assert 'CHROME_PACKAGE = "com.android.chrome"' in source
    assert "discover_chrome_cdp_url" in source
    assert "chrome_focus_requires_setup" in source
    assert "firstrun" in source.lower()
    assert '"pm", "clear", CHROME_PACKAGE' in source
    assert 'page_url_contains="/ui/pucky/latest"' in source
    assert 'page_title="Pucky Cover"' not in source
    assert '"pucky_api_token": args.api_token' in source or '"pucky_api_token": args.api_token,' in source
    assert 'payload["token"] = args.device_token' in source
    assert 'surface="chrome_auth"' in source
    assert '"surface": surface,' in source
    assert "chromium.connectOverCDP" in helper
    assert 'mode === "chrome_auth"' in helper
    assert "filtered_slugs" in helper
    assert source.index('summary["connect_browser"] = connect_browser') < source.index('connect_device = args.report_dir / "01-connect-device.png"')


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


def test_live_user_session_contacts_edit_proof_handles_teardown_and_mode_specific_values() -> None:
    source = read_source("cover_live_user_session_playwright.mjs")

    assert "function buildContactsEditProofValues(mode) {" in source
    assert 'const modeLabel = modeKey === "desktop" ? "Desktop" : modeKey === "mobile" ? "Mobile" : "Proof";' in source
    assert 'const phoneSuffix = modeKey === "desktop" ? "0179" : modeKey === "mobile" ? "0199" : "0189";' in source
    assert "Updated from ${modeKey} live proof edit flow" in source
    assert 'await route.abort("failed").catch(() => {});' in source


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

    assert "function readTaskListSelectionState(page)" in source
    assert "has_filter_pill" in source
    assert "select_mode_active" in source
    assert "selected_rows" in source
    assert "bulk_bar_present" in source
    assert "bulk_count_label" in source
    assert "Open task bulk select mode" in source
    assert "Archive two selected tasks from the Tasks list" in source
    assert "Archive current task from task detail actions" in source
    assert "Tasks opens without a filter pill and orders sections as Today, Overdue, Upcoming, and Done." in source
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
    assert 'const THEMES = ["light", "dark"];' in source
    assert ".light-app-label" in source
    assert "Meeting Notes" in source
    assert "SEMANTIC_ICON_REGISTRY" in source
    assert "data-semantic-icon" in source
    assert "iconAccentVar" in source
    assert "iconBackground" in source
    assert "registryColors" in source
    assert "assertNoSameRowLabelOverlap(metrics);" in source
    assert "horizontalOverlap > OVERLAP_EPSILON" in source
    assert "Math.abs(item.icon.centerX - tileCenter)" in source
    assert "Math.abs(item.label.centerX - tileCenter)" in source
    assert '"test:cover-home-app-labels": "node ./proofs/cover/cover_home_app_labels_playwright.mjs"' in package


def test_home_app_label_proof_is_wired_into_local_and_live_web_sweeps() -> None:
    dev_source = (ROOT / "tools" / "dev.py").read_text(encoding="utf-8")

    assert '"tools/proofs/cover/cover_home_app_labels_playwright.mjs"' in dev_source
    assert 'str((ROOT / ".tmp" / "proof-local-web" / "home-app-labels").resolve())' in dev_source
    assert 'str((live_root / "home-app-labels").resolve())' in dev_source


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
    dev_source = DEV_PY_PATH.read_text(encoding="utf-8")

    assert "assertMeaningfulRows(" in source
    assert "const NARROW_VIEWPORT = { width: 320, height: 932 };" in source
    assert "readScrollReachability(" in source
    assert "readMeetingRowLayout(" in source
    assert "reached_bottom" in source
    assert "maxPositionMs" in source
    assert "bottomSlackPx" in source
    assert "meetings_tight_layout" in source
    assert "function requiredAudioProgressDelta(" in source
    assert "required_delta_ms: requiredDeltaMs" in source
    assert "return 2000;" in source
    assert "player_delta_ms >= 500" in source
    assert "Open audio controls" in source
    assert "openAudioControls(" in source
    assert "inbox_audio_controls" in source
    assert "scrollability" in source
    assert "readInboxActionLayout(" in source
    assert "inbox_action_layout" in source
    assert "unread_page_action.contrast_ratio >= 3" in source
    assert "document.body || current === document.documentElement" in source
    assert '"--surface-card"' in source
    assert "background_source" in source
    assert 'unread_page_action.color !== "rgb(245, 249, 255)"' in source
    assert "audio_only_mic_right_aligned" in source
    assert "action-count-1" in source
    assert "readInboxManagementState(" in source
    assert "exerciseInboxManagement(" in source
    assert "inbox_management" in source
    assert 'data-card-action="manage_select"' in source
    assert 'data-card-action="manage_menu"' in source
    assert "archive_reveal_count" in source
    assert "manage_mode_active" in source
    assert "selected_count" in source
    assert "menu_open" in source
    assert "readMeetingRowLayout(" in source
    assert "titleLeftInset" in source
    assert "dark-meetings-430" in source
    assert "light-meetings-430" in source
    assert "dark-meetings-320" in source
    assert "light-meetings-320" in source
    assert "onlyInboxManagement" in source
    assert "--only-inbox-management" in source
    assert "assertInboxManagementLayout(" in source
    assert "normal_menu" in source
    assert "feed_width" in source
    assert "timestamp_alignment" in source
    assert "manage_bar_scroll" in source
    assert "assertInboxManageBarScrollStickiness(" in source
    assert "feed_contains_manage_bar" in source
    assert "card_width_target" in source
    assert "timestamp_right_gap_from_card" in source
    assert "bottom gap should stay 0-4px after scrolling" in source
    assert "selected_control" in source
    assert "manage_bar" in source
    assert "archive_filter" in source
    assert "no_audio" in source
    assert "01-normal-expanded-feed" in source
    assert "02-manage-bottom-top" in source
    assert "03-manage-bottom-scrolled-down" in source
    assert "04-manage-bottom-scrolled-up" in source
    assert "05-selected-simple-check" in source
    assert "07-archive-filter-card-visible" in source
    assert "08-archived-menu-unarchive" in source
    assert "09-after-unarchive-active-feed" in source
    assert "10-cleanup-archived-final" in source
    assert 'proofUrl.searchParams.set("api_token", String(config.apiToken || "").trim());' in source
    assert 'proofUrl.searchParams.set("_pucky_refresh", runId);' in source
    assert "proof-local-inbox-management" in dev_source
    assert "proof-live-inbox-management" in dev_source
    assert "--only-inbox-management" in dev_source
    assert '"1280x720"' in dev_source


def test_workspace_apps_browser_proof_checks_meeting_note_compact_who_contract() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "readMeetingNoteDetailState(" in source
    assert "hasStandaloneWhoSection" in source
    assert "whoInsideDetailsCard" in source
    assert "whoChipLabels" in source
    assert "whoChipRootBackground" in source
    assert "whoChipRootColor" in source
    assert "whoChipRootBorderRadius" in source
    assert "whoChipCount" in source
    assert 'JSON.stringify(meetingNoteState.detailRowLabels) === JSON.stringify(["When", "Who"])' in source
    assert "Meeting note detail should keep Who inside the Details card" in source
    assert "Meeting note detail should not keep a standalone Who section shell" in source
    assert "Expected Who chips to reuse the calendar-style contact label logic" in source
    assert "Expected meeting note Who to render at least one attendee chip" in source
    assert "Expected meeting note Who chip to keep a visible tinted root background" in source
    assert "Expected meeting note Who chip text to keep readable contrast" in source


def test_real_vm_inbox_proof_uses_universal_feed_dom_contract() -> None:
    source = read_source("cover_light_real_vm_ports_playwright.mjs")

    assert ".light-real-feed-list" not in source
    assert ".light-shell[data-light-route=\"inbox\"] .light-inbox-surface" in source
    assert "article.card" in source
    assert 'article.card h2.title' not in source
    assert '.light-shell[data-light-route=\\"inbox\\"] article.card .title' in source
    assert "loading inbox" in source.lower()
    assert "Light Inbox cold load regressed to the reply-only empty state" in source


def test_live_user_session_runtime_proof_rejects_missing_result_soft_completion() -> None:
    source = read_source("cover_live_user_session_playwright.mjs")

    assert 'if (stateName === "completed_with_missing_result") {' in source
    assert "regressed to completed_with_missing_result" in source
    assert '"completed", "failed"' in source or '["completed", "failed"]' in source
    assert "Timed out waiting for runtime meeting" in source
    assert "meeting stayed in processing past the allowed proof timeout" in source


def test_meetings_walkthrough_proof_checks_short_and_long_title_alignment() -> None:
    source = read_source("cover_light_walkthrough_port_playwright.mjs")

    assert "readMeetingRowLayout(" in source
    assert "titleLeftInset" in source
    assert 'title: "Quick sync"' in source
    assert "meetings-short-430" in source
    assert "meetings-long-430" in source
    assert "meetings-short-320" in source
    assert "meetings-long-320" in source


def test_inbox_media_proof_server_uses_fixtures_without_mock_rewrite() -> None:
    source = read_source("cover_inbox_media_proof_server.py")

    assert 'parsed.path == "/ui/pucky/fixtures/reply_cards.json"' in source
    assert 'mock_artifact_prefix="fixtures/artifacts"' in source
    assert '"/ui/pucky/fixtures/reply_cards.json"' in source

def test_contacts_search_browser_proof_task_runner_and_docs_are_first_class() -> None:
    dev_source = (ROOT / "tools" / "dev.py").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    docs_readme = (ROOT / "docs" / "README.md").read_text(encoding="utf-8")

    assert '"proof-local-contacts-search-browser": "Boot the local workspace proof server and run the Contacts search browser proof against the current local bundle."' in dev_source
    assert '"proof-live-contacts-search-browser": "Run the Contacts search browser proof against the hosted VM with manifest verification."' in dev_source
    assert 'str((ROOT / ".tmp" / "proof-local-contacts-search-browser").resolve())' in dev_source
    assert 'str((ROOT / ".tmp" / "proof-live-contacts-search-browser").resolve())' in dev_source
    assert '"--sections",' in dev_source
    assert '"contacts",' in dev_source
    assert '"--routes",' in dev_source
    assert 'return run_local_contacts_search_browser_proof(args.extra_args)' in dev_source
    assert 'return run_live_contacts_search_browser_proof(args.extra_args)' in dev_source
    assert "python -m tools.dev proof-local-contacts-search-browser" in readme
    assert "python -m tools.dev proof-live-contacts-search-browser" in readme
    assert "Contacts search browser proof (local): `python -m tools.dev proof-local-contacts-search-browser`" in docs_readme
    assert "Contacts search browser proof (live): `python -m tools.dev proof-live-contacts-search-browser`" in docs_readme


def test_contacts_search_emulator_proof_task_runner_and_docs_are_first_class() -> None:
    dev_source = (ROOT / "tools" / "dev.py").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    docs_readme = (ROOT / "docs" / "README.md").read_text(encoding="utf-8")

    assert '"proof-live-contacts-search-emulator": "Run the Android-emulator Contacts search stability proof against the hosted VM with IME and trace verification."' in dev_source
    assert 'str((ROOT / ".tmp" / "proof-live-contacts-search-emulator").resolve())' in dev_source
    assert 'return run_live_contacts_search_emulator_proof(args.extra_args)' in dev_source
    assert "python -m tools.dev proof-live-contacts-search-emulator" in readme
    assert "python -m tools.dev proof-live-contacts-search-emulator" in docs_readme
    assert "Contacts search emulator proof (live): `python -m tools.dev proof-live-contacts-search-emulator`" in docs_readme


def test_contacts_search_emulator_proof_tracks_ime_and_trace_contract() -> None:
    source = read_source("phone_contacts_search_emulator_proof.py")
    browser = read_source("phone_contacts_search_browser.js")

    assert 'CHROME_PACKAGE = "com.android.chrome"' in source
    assert "discover_chrome_cdp_url" in source
    assert "mInputShown=true" in source
    assert "visible=true" in source
    assert '"contacts-keyboard-before.png"' in source
    assert '"contacts-keyboard-after-d.png"' in source
    assert '"contacts-keyboard-after-da.png"' in source
    assert '"contacts-keyboard-after-dav.png"' in source
    assert '"install_contacts_trace"' in source
    assert '"read_contacts_state"' in source
    assert '"read_contacts_trace"' in source
    assert '"search_input_center"' in source
    assert '"dav"' in source
    assert "trace_event_counts" in source
    assert "ime_visible" in source
    assert "installContactsTrace" in browser
    assert "readContactsState" in browser
    assert "searchInputCenter" in browser
    assert "readContactsTrace" in browser


def test_contacts_edit_browser_proof_task_runner_and_docs_are_first_class() -> None:
    dev_source = (ROOT / "tools" / "dev.py").read_text(encoding="utf-8")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    docs_readme = (ROOT / "docs" / "README.md").read_text(encoding="utf-8")

    assert '"proof-local-contacts-edit-browser": "Boot the local workspace proof server and run the Contacts edit browser proof against the current local bundle."' in dev_source
    assert '"proof-live-contacts-edit-browser": "Run the Contacts edit browser proof against the hosted VM with manifest verification."' in dev_source
    assert 'str((ROOT / ".tmp" / "proof-local-contacts-edit-browser").resolve())' in dev_source
    assert 'str((ROOT / ".tmp" / "proof-live-contacts-edit-browser").resolve())' in dev_source
    assert '"contacts-edit",' in dev_source
    assert 'return run_local_contacts_edit_browser_proof(args.extra_args)' in dev_source
    assert 'return run_live_contacts_edit_browser_proof(args.extra_args)' in dev_source
    assert "python -m tools.dev proof-local-contacts-edit-browser" in readme
    assert "python -m tools.dev proof-live-contacts-edit-browser" in readme
    assert "Contacts edit browser proof (local): `python -m tools.dev proof-local-contacts-edit-browser`" in docs_readme
    assert "Contacts edit browser proof (live): `python -m tools.dev proof-live-contacts-edit-browser`" in docs_readme
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


def test_light_native_ports_proof_guards_route_fetch_during_context_shutdown() -> None:
    source = read_source("cover_light_native_ports_playwright.mjs")

    assert "const message = String(error && error.message ? error.message : error || \"\");" in source
    assert "/target page, context or browser has been closed/i.test(message)" in source
    assert "/fetch response has been disposed/i.test(message)" in source
    assert 'await route.abort("failed").catch(() => {});' in source


def test_calendar_browser_proof_covers_meeting_detail_section_toggles() -> None:
    calendar_source = read_source("cover_calendar_playwright.mjs")

    assert "data-meeting-detail-section" in calendar_source
    assert "row_top_delta_px" in calendar_source
    assert "who_chip_gap_px" in calendar_source
    assert "who_contact_icon_count" in calendar_source
    assert "who_guest_chip_count" in calendar_source
    assert "who_record_chip_count" in calendar_source
    assert "details_card_overflow_x" in calendar_source
    assert "agenda_contact_icon_count" in calendar_source
    assert "agenda_record_chip_count" in calendar_source
    assert "calendar-desktop-${theme}-event-detail-default.png" in calendar_source
    assert "calendar-desktop-${theme}-event-detail-connected-expanded.png" in calendar_source
    assert "calendar-desktop-${theme}-event-detail-details-collapsed.png" in calendar_source
    assert "calendar-desktop-${theme}-event-detail-connected-restored.png" in calendar_source
    assert "calendar-desktop-${theme}-event-detail-details-card.png" in calendar_source
    assert "calendar-desktop-${theme}-event-detail-who-row.png" in calendar_source
    assert "calendar-desktop-${theme}-agenda-tile.png" in calendar_source
    assert "calendar-desktop-${theme}-clinic-detail.png" in calendar_source
    assert "calendar-desktop-${theme}-clinic-who-row.png" in calendar_source
    assert "calendar-mobile-${theme}-detail-default.png" in calendar_source
    assert "calendar-mobile-${theme}-detail-connected-expanded.png" in calendar_source
    assert "calendar-mobile-${theme}-detail-details-collapsed.png" in calendar_source
    assert "calendar-mobile-${theme}-detail-connected-restored.png" in calendar_source
    assert "calendar-mobile-${theme}-detail-details-card.png" in calendar_source
    assert "calendar-mobile-${theme}-detail-who-row.png" in calendar_source
    assert "calendar-mobile-${theme}-agenda-tile.png" in calendar_source
    assert "calendar-mobile-${theme}-clinic-detail.png" in calendar_source
    assert "calendar-mobile-${theme}-clinic-who-row.png" in calendar_source
    assert "Expected event detail to avoid a standalone Description section." in calendar_source
    assert "Expected merged description text inside Details." in calendar_source
    assert "Expected Connected to start collapsed on a fresh event open." in calendar_source
    assert "Expected Details to start expanded on a fresh event open." in calendar_source
    assert "Expected compact When to avoid weekday text" in calendar_source
    assert "Expected compact Who row to keep visible chip spacing" in calendar_source
    assert "Expected agenda attendee chips to keep a visible contact icon on every chip." in calendar_source
    assert "Expected agenda attendee chips to avoid record-chip styling." in calendar_source
    assert "Expected Calendar Who row to keep a visible contact icon on every attendee chip." in calendar_source
    assert "Expected Calendar Who row to avoid record-chip styling." in calendar_source
    assert "Expected Calendar Who row to avoid guest attendee chips" in calendar_source
    assert "Expected mobile Details card to avoid horizontal overflow" in calendar_source
    assert "Outside counsel" in calendar_source
    assert "Clinic front desk" in calendar_source
    assert 'title: "Outside counsel"' in calendar_source
    assert 'title: "Clinic front desk"' in calendar_source
    assert "Expected agenda cards to show all contact-backed attendees" in calendar_source
    assert "Expected clinic detail to render the role-style contact as a recognized chip" in calendar_source
    assert "Expected mobile agenda cards to show all contact-backed attendees" in calendar_source
    assert "Expected mobile agenda attendee chips to keep a visible contact icon on every chip." in calendar_source
    assert "Expected mobile agenda attendee chips to avoid record-chip styling." in calendar_source
    assert "Expected mobile Who row to keep a visible contact icon on every attendee chip." in calendar_source
    assert "Expected mobile Who row to avoid record-chip styling." in calendar_source
    assert "Expected mobile Who row to avoid guest attendee chips" in calendar_source
    assert "Expected mobile Who row to include at least one guest chip." not in calendar_source
    assert "Expected mobile Who row to carry contact and guest chips" not in calendar_source
    assert "Expected Back from linked target to restore Connected expanded state." in calendar_source
    assert "Expected reopening the event detail to reset Connected closed." in calendar_source
    assert "Expected reopening the event detail to reset Details open." in calendar_source


def test_calendar_browser_proof_covers_continuous_month_rail_contract() -> None:
    calendar_source = read_source("cover_calendar_playwright.mjs")

    assert "rendered_month_keys" in calendar_source
    assert "visible_day_keys" in calendar_source
    assert "selected_day_before_scroll" in calendar_source
    assert "selected_month_before_scroll" in calendar_source
    assert "calendar-desktop-${theme}-selected-month-left-edge.png" in calendar_source
    assert "calendar-desktop-${theme}-selected-month-right-edge.png" in calendar_source
    assert "calendar-desktop-${theme}-continued-prev-month.png" in calendar_source
    assert "calendar-desktop-${theme}-continued-next-month.png" in calendar_source
    assert "calendar-desktop-${theme}-adjacent-month-selected.png" in calendar_source
    assert "calendar-mobile-${theme}-selected-month-left-edge.png" in calendar_source
    assert "calendar-mobile-${theme}-selected-month-right-edge.png" in calendar_source
    assert "calendar-mobile-${theme}-continued-prev-month.png" in calendar_source
    assert "calendar-mobile-${theme}-continued-next-month.png" in calendar_source
    assert "calendar-mobile-${theme}-adjacent-month-selected.png" in calendar_source
    assert "Expected the selected month to expose day 1 on the rail" in calendar_source
    assert "Expected passive rail scrolling to keep the selected date input stable" in calendar_source
    assert "Expected no desktop calendar rail chevrons to remain" in calendar_source
