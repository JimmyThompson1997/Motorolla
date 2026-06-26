from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "tools" / "proofs" / "cover" / "cover_live_user_session_playwright.mjs"
WRAPPER_PATH = ROOT / "tools" / "cover_live_user_session_playwright.mjs"
PACKAGE_JSON_PATH = ROOT / "tools" / "package.json"


def test_live_user_session_runner_records_manifest_refresh_seed_cleanup_and_report() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "loadFlyEnvironment(" in source
    assert "resolveWriteToken(" in source
    assert "loadProofRuntimeEnv(" in source
    assert "PUCKY_LIVE_USER_SESSION_TOKEN" in source
    assert "PUCKY_OPERATOR_TOKEN" in source
    assert "PUCKY_API_TOKEN" in source
    assert "PUCKY_WEB_UI_TOKEN" not in source
    assert "/ui/pucky/latest/manifest.json" in source
    assert "_pucky_refresh" in source
    assert '".tmp", "live-user-session-proof"' in source
    assert "summary.json" in source
    assert "report.md" in source
    assert "saveScreenshot(" in source
    assert "fs.rmSync(config.reportDir, { recursive: true, force: true });" in source
    assert "seedTaskProofWorkspace(" in source
    assert "prepareRuntimeMeeting(" in source
    assert "runtime_meeting" in source
    assert "cleanupTaskProofSeed(" in source
    assert "failed_requests" in source
    assert "http_error_responses" in source
    assert "buildPageTracking(" in source
    assert 'const RESULT_SCHEMA = "pucky.live_user_session_browser_proof.v1";' in source
    assert "--keep-seed" in source
    assert '"meeting-notes"' in source
    assert '"reminders"' in source
    assert "const UNIVERSAL_FEED_TILE_ROUTES = [" in source
    assert '"notes"' in source
    assert '"projects"' in source
    assert '"tags"' not in source
    assert '"inbox"' in source
    assert '"meetings"' in source
    assert 'url.searchParams.set("api_token"' not in source
    assert "browser_api_token" not in source
    assert "Authorization: `Bearer ${config.apiToken}`" not in source
    assert "/target page, context or browser has been closed/i.test(message)" in source
    assert "/fetch response has been disposed/i.test(message)" in source
    assert 'await route.abort("failed").catch(() => {});' in source


def test_live_user_session_runner_keeps_connect_read_only_and_uses_home_route() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert 'buildRouteUrl(config, "home")' in source
    assert 'url.searchParams.set("route", String(route || "home"));' in source
    assert 'await openRouteFromHome(page, "connect", config.timeoutMs);' in source
    assert 'await openRouteFromHome(page, "inbox", config.timeoutMs);' in source
    assert 'await openRouteFromHome(page, "meetings", config.timeoutMs);' in source
    assert 'await openRouteFromHome(page, "meeting-notes", config.timeoutMs);' in source
    assert 'await openRouteFromHome(page, "reminders", config.timeoutMs);' in source
    assert 'await openRouteFromHome(page, "notes", config.timeoutMs);' in source
    assert 'await openRouteFromHome(page, "projects", config.timeoutMs);' in source
    assert 'await openRouteFromHome(page, "contacts", config.timeoutMs);' in source
    assert "route=apps" not in source
    assert "route=feed" not in source
    assert 'shouldRunRoute(config, "contact-edit")' in source
    assert "Connect stays read-only" in source
    assert "connect_cta_clicked: false" in source
    assert "fetchConnectMyApps(" in source
    assert "waitForConnectChips(" in source
    assert "data-links-connected-slug" in source
    assert "Reload connect directly" in source
    assert "seriousFailedRequests(" in source
    assert "seriousHttpErrorResponses(" in source
    assert "ERR_HTTP2_PROTOCOL_ERROR" in source
    assert 'LIVE_CONNECT_REQUIRED_SLUGS = ["gmail", "googlecalendar"]' in source
    assert 'localStorage.removeItem("pucky.cover.browser_device_id.v1");' in source


def test_live_user_session_runner_requires_runtime_meeting_to_appear_in_meetings_and_inbox() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "const MEETING_RUNTIME_FIXTURE_PATH =" in source
    assert "async function archiveVisibleMeetings(" in source
    assert "async function ingestRuntimeProofMeeting(" in source
    assert "async function waitForMeetingCompletion(" in source
    assert "async function prepareRuntimeMeeting(" in source
    assert 'if (stateName === "completed_with_missing_result") {' in source
    assert "regressed to completed_with_missing_result" in source
    assert '["completed", "failed"]' in source or '"completed", "failed"' in source
    assert "meeting stayed in processing past the allowed proof timeout" in source
    assert "if (!contactEditOnly) {" in source
    assert 'mobile = await runProofMode(browser, config, "mobile", seed, runtimeMeeting);' in source
    assert 'desktop = await runProofMode(browser, config, "desktop", seed, runtimeMeeting);' in source
    assert "Runtime meeting card was visible in Inbox and opened its detail panel." in source
    assert "Runtime meeting detail panel opened." in source
    assert "Inbox stayed empty instead of showing runtime meeting" in source
    assert "Meetings stayed empty instead of showing runtime meeting" in source


def test_live_user_session_runner_captures_contacts_list_before_detail() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "readContactsListFlatness(" in source
    assert 'action: "Inspect Contacts list"' in source
    assert "Contacts list stays flat on the deployed hosted UI before opening detail." in source
    assert "contacts_list_flatness" in source
    assert "first_contact_id" in source
    assert "contact_title" in source


def test_live_user_session_runner_exercises_task_status_triggers_and_clean_detail_surface() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "function readTaskRowFocusState(page, taskId)" in source
    assert "function readTaskDetailFocusState(page)" in source
    assert "function assertNoVisibleTaskFocusRing(state, context)" in source
    assert "task_row_outline_style" in source
    assert "task_row_outline_width" in source
    assert "task_detail_outline_style" in source
    assert "task_detail_outline_width" in source
    assert 'await openRouteFromHome(page, "tasks", config.timeoutMs);' in source
    assert '.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-status-trigger' in source
    assert '.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-main' in source
    assert '.settings-selector-option[data-selector-value="in_progress"]' in source
    assert '.settings-selector-option[data-selector-value="done"]' in source
    assert '.settings-selector-option[data-selector-value="waiting"]' in source
    assert '".light-task-detail-card"' in source
    assert '".light-task-status-circle"' in source
    assert '".light-task-detail-created"' in source
    assert '".light-task-status-trigger"' not in source
    assert '".light-task-status-circle-trigger"' not in source
    assert 'description_is_first_section' in source
    assert 'checklist_immediately_after_description' in source
    assert 'header_created_meta' in source
    assert 'task_html_frame_present' in source
    assert 'const connectedSection = infoSection("connected");' in source
    assert "connected: Array.from(connectedSection?.querySelectorAll('.light-info-row[data-task-connected-kind]') || [])" in source
    assert "const peopleSection = infoSection(\"people\");" not in source
    assert "people:" not in source
    assert 'assert(!taskState.sections.includes("details")' in source
    assert 'assert(!taskState.sections.includes("people")' in source
    assert 'assert(!taskState.sections.includes("notes")' in source
    assert 'assert(!taskState.sections.includes("attached")' in source
    assert 'assert(taskState.checklist_immediately_after_description' in source
    assert 'assert(taskState.header_created_meta' in source
    assert 'assert(taskState.header_created_meta.startsWith("Created ")' in source
    assert 'task_detail_chevron_count: Array.from(detail?.querySelectorAll(".light-info-row .light-chevron") || []).length,' in source
    assert 'assert(!taskState.task_html_frame_present' in source
    assert 'assert(taskState.description_is_first_section' in source
    assert 'assert(taskState.task_detail_chevron_count === 0' in source
    assert "Open task list status selector" in source
    assert "Open task detail header status selector near circle" in source
    assert "Open task detail header status selector on title area" in source
    assert "Task detail keeps the compact header, checklist-first layout, and chevron-free linked rows." in source
    assert "Task list status selector opened in place without a blue focus rectangle." in source
    assert "Task detail header selector opened in place without a blue focus rectangle." in source
    assert "Open task detail pill status selector" not in source
    assert "Open task detail top-left status selector" not in source
    assert "Persist Done status after reload" in source
    assert "function readTaskFilterSelectorState(page)" not in source
    assert "function assertTaskFilterSelectorLeadingVisuals(state, context)" not in source
    assert ".light-task-filter-button" not in source
    assert "Select tasks" in source
    assert "Archive task" in source
    assert "Open task bulk select mode" in source
    assert "Archive two selected tasks from the Tasks list" in source
    assert "Archive current task from task detail actions" in source
    assert "Complete final task checklist item" in source
    assert "Reopen task by unchecking a completed checklist item" in source
    assert 'assert(taskStateAfterChecklistDone.task_status === "done"' in source
    assert 'assert(taskStateAfterChecklistDone.header_created_meta.startsWith("Completed ")' in source
    assert 'const completedAtAfterChecklistDone = Number(taskRecordAfterChecklistDone.completed_at_ms || 0);' in source
    assert 'assert(taskStateAfterChecklistReopen.task_status === "in_progress"' in source
    assert 'assert(taskStateAfterChecklistReopen.header_created_meta.startsWith("Created ")' in source
    assert 'assert(!("completed_at_ms" in taskRecordAfterChecklistReopen)' in source
    assert 'assert(taskRecordAfterChecklistDone.status === "done"' in source
    assert 'assert(taskRecordAfterChecklistReopen.status === "in_progress"' in source
    assert 'const completedAtAfterReload = Number(taskRecord.completed_at_ms || 0);' in source
    assert 'assert(taskState.header_created_meta.startsWith("Completed ")' in source
    assert 'assert(completedAtAfterReload > completedAtAfterChecklistDone' in source


def test_live_user_session_runner_supports_contacts_route_filter_and_search_contract() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "routes: []" in source
    assert 'arg === "--routes"' in source
    assert "function shouldRunRoute(config, route) {" in source
    assert 'shouldRunRoute(config, "contacts")' in source
    assert "readContactsSearchState" in source
    assert "setContactsSearchQuery" in source
    assert "expectContactsSearchRows" in source
    assert 'const phraseQuery = "Linked to live alpha";' in source
    assert 'const phoneQuery = "0188";' in source
    assert 'const reminderQuery = "reminder";' in source
    assert 'const noMatchQuery = "zzzz-no-match";' in source
    assert 'action: "Filter Contacts by activity phrase"' in source
    assert 'action: "Show Contacts search empty state"' in source
    assert 'action: "Clear Contacts search"' in source
    assert 'action: "Open seeded contact detail from filtered list"' in source
    assert 'action: "Return to filtered Contacts list"' in source
    assert "Contacts search should reset after leaving the Contacts surface" in source
    assert "installContactsSearchTrace" in source
    assert "traceContactsSearchTyping" in source
    assert 'const stabilityQuery = "dav";' in source
    assert "Expected Contacts search typing to avoid blur/focusout while filtering" in source
    assert "Expected Contacts search typing to keep the same mounted input" in source
    assert "Expected David avatar to render a single D initial" in source
    assert "Expected Daniel avatar to render a single D initial" in source
    assert "Requested routes" in source
    assert "requested_routes:" in source


def test_live_user_session_runner_supports_contacts_edit_route_and_post_save_contract() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert 'shouldRunRoute(config, "contact-edit")' in source
    assert "function buildContactsEditProofValues(mode) {" in source
    assert 'const modeLabel = modeKey === "desktop" ? "Desktop" : modeKey === "iphone" ? "iPhone" : modeKey === "android" ? "Android" : "Proof";' in source
    assert 'const phoneSuffix = modeKey === "desktop" ? "0179" : modeKey === "iphone" ? "0199" : modeKey === "android" ? "0209" : "0189";' in source
    assert 'action: "Open classic contact detail"' in source
    assert 'action: "Enter in-place contact edit mode"' in source
    assert 'action: "Autosave edited contact"' in source
    assert 'action: "Add and remove contact photo"' in source
    assert 'action: "Reload saved contact detail"' in source
    assert 'action: "Return to edited Contacts list"' in source
    assert "readContactEditState" in source
    assert "traceContactEditTyping" in source
    assert "data-contact-autosave-status" in source
    assert "Updated Live Contact" in source
    assert "Updated from ${modeKey} live proof edit flow" in source
    assert "updated.live.contact@example.com" in source
    assert "Expected saved contact detail to show the updated title" in source
    assert "expected classic detail to keep the hero tile visible" in source
    assert "expected the same hero tile to stay visible in edit mode" in source
    assert "expected activity to remain read-only in classic detail" in source
    assert "Expected contact edit typing to keep the same mounted input" in source
    assert "Expected photo removal to restore initials" in source
    assert "Expected contact detail reload to stay on the edited contact" in source
    assert "Expected edited contact row to reappear with the updated title" in source


def test_live_user_session_wrapper_targets_nested_runner() -> None:
    source = WRAPPER_PATH.read_text(encoding="utf-8")

    assert 'import "./proofs/cover/cover_live_user_session_playwright.mjs";' in source


def test_tools_package_exposes_live_user_session_script() -> None:
    payload = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))

    assert payload["scripts"]["test:cover-live-user-session"] == "node ./proofs/cover/cover_live_user_session_playwright.mjs"
    assert payload["scripts"]["test:cover-universal-feed-tiles"] == "node ./proofs/cover/cover_universal_feed_tiles_playwright.mjs"
    assert payload["scripts"]["test:cover-calendar"] == "node ./proofs/cover/cover_calendar_playwright.mjs"


def test_tools_package_exposes_inbox_related_proofs() -> None:
    payload = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))

    assert payload["scripts"]["test:cover-inbox-tile-audio-truth"] == "node ./proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs"
    assert payload["scripts"]["test:cover-light-native-ports"] == "node ./proofs/cover/cover_light_native_ports_playwright.mjs"


def test_tools_dev_runs_inbox_focused_local_and_live_entrypoints() -> None:
    source = (ROOT / "tools" / "dev.py").read_text(encoding="utf-8")

    assert "cover_light_native_ports_playwright.mjs" in source
    assert "cover_inbox_tile_audio_truth_playwright.mjs" in source
    assert "cover_calendar_playwright.mjs" in source
    assert "cover_live_user_session_playwright.mjs" in source
    assert "--skip-canonical-check" in source
    assert "127.0.0.1:8768" in source
    assert "ensure_cover_playwright_shims()" in source
    assert 'for package_name in ("playwright-core", "playwright"):' in source
    assert 'tools_node_modules = ROOT / "tools" / "node_modules"' in source
    assert 'for browser_name in ("chromium", "webkit"):' in source
    assert "for attempt in range(1, 4):" in source
    assert 'append_refresh_param(' in source
    assert '"_pucky_refresh"' in source
    assert '"https://pucky.fly.dev/ui/pucky/latest/?theme=light&reset_nav=1"' in source
    assert '"https://pucky.fly.dev/ui/pucky/latest/?theme=light&route=inbox&reset_nav=1"' in source
    assert 'live_root / "inbox-audio-light" / browser_name / run_name' in source
    assert 'live_root / "light-native-ports" / browser_name / run_name' in source
    assert "cover_universal_feed_tiles_playwright.mjs" in source
    assert 'proof-local-calendar' in source
    assert 'proof-live-calendar' in source
    assert 'proof-local-contacts-search-browser' in source
    assert 'proof-live-contacts-search-browser' in source
    assert 'proof-local-universal-tiles' in source
    assert 'proof-live-universal-tiles' in source


def test_live_native_port_proof_tracks_audio_continuity_opt_out_and_audio_detail_evidence() -> None:
    source = (ROOT / "tools" / "proofs" / "cover" / "cover_light_native_ports_playwright.mjs").read_text(encoding="utf-8")

    assert "audio_continuity_present" in source
    assert "audio_detail_controls_present" in source
    assert "assertNoInheritedAudioContinuity(" in source
    assert "readRichDetailLayout(" in source
    assert "05-dark-inbox-title-detail" in source
    assert "07-dark-inbox-page-top" in source
    assert "09-dark-inbox-page-bottom" in source
    assert "10a-dark-inbox-audio-detail" in source
    assert "10b-light-inbox-audio-detail" in source
    assert "inbox_audio_controls" not in source
    assert "openAudioControls(" not in source


def test_live_browser_stack_keeps_inbox_width_and_calendar_container_acceptance_contracts() -> None:
    universal_source = (ROOT / "tools" / "proofs" / "cover" / "cover_universal_feed_tiles_playwright.mjs").read_text(encoding="utf-8")
    calendar_source = (ROOT / "tools" / "proofs" / "cover" / "cover_calendar_playwright.mjs").read_text(encoding="utf-8")
    hosted_source = (ROOT / "tools" / "proofs" / "cover" / "cover_hosted_bug_hunt_playwright.mjs").read_text(encoding="utf-8")

    assert "first_row_content_metrics" in universal_source
    assert "row_action_metrics" in universal_source
    assert "Inbox: one-action rows should not reserve the old wide action rail" in universal_source
    assert "Inbox: two-action rows should stay tighter than the old 98px rail" in universal_source
    assert "selectCalendarEventByContainer" in calendar_source
    assert "calendar-desktop-${theme}-event-detail-container-click.png" in calendar_source
    assert "calendar-mobile-${theme}-detail-container-click.png" in calendar_source
    assert "Expected no desktop calendar rail chevrons to remain" in calendar_source
    assert "Expected passive rail scrolling to keep the selected date input stable" in calendar_source
    assert "calendar-desktop-${theme}-adjacent-month-selected.png" in calendar_source
    assert "calendar-mobile-${theme}-adjacent-month-selected.png" in calendar_source
    assert 'openerSelector: ".light-event-block"' in hosted_source
    assert "inboxVisibleMenuButtonCount" in hosted_source
    assert "Normal-mode Inbox rows should not expose left-side row menu buttons." in hosted_source
