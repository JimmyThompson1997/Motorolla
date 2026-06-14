from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "ui_src"


def read(name: str) -> str:
    return (UI / name).read_text(encoding="utf-8")


def css_block(styles: str, selector: str) -> str:
    match = re.search(rf"{re.escape(selector)}\s*\{{(?P<body>.*?)\n\}}", styles, re.S)
    assert match, f"Missing CSS selector {selector}"
    return match.group("body")


def function_block(source: str, name: str) -> str:
    match = re.search(rf"function {re.escape(name)}\([^)]*\)\s*\{{(?P<body>.*?)\n  \}}", source, re.S)
    assert match, f"Missing function {name}"
    return match.group("body")


def test_material_icon_registry_remains_bundled() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "const MATERIAL_SYMBOLS" in app
    assert "function iconSvg(" in app
    assert "function replyCardIconSvg(" in app
    assert "function loadCardIconRegistry(" in app
    assert 'fetch(`${linksApiBaseUrl()}/api/card-icons`' in app
    assert ".material-icon" in styles


def test_index_uses_modern_home_shell_mounts_only() -> None:
    html = read("index.html")

    assert 'data-view="home"' in html
    assert 'id="threadScopeStatus"' in html
    assert 'id="voiceStatus"' in html
    assert 'data-voice-status' in html
    assert 'aria-label="Turn state: idle"' in html
    assert 'id="feed"' in html
    assert 'id="detail"' in html
    assert 'id="pageTabs"' not in html
    assert 'id="routeTray"' not in html


def test_home_shell_registry_exposes_modern_routes_only() -> None:
    app = read("app.js")

    assert 'const LIGHT_APPS = [' in app
    assert '{ route: "inbox", label: "Inbox"' in app
    assert '{ route: "connect", label: "Connect"' in app
    assert '{ route: "meetings", label: "Meetings"' in app
    assert '{ route: "settings", label: "Settings"' in app
    assert '{ route: "feed", label: "Inbox"' not in app
    assert '{ route: "links", label: "Connect"' not in app
    assert 'route: "feed-preview"' not in app
    assert 'route: "morning"' not in app
    assert 'route: "calls"' not in app
    assert 'const HOME_SHELL_CANONICAL_ROUTES = new Set(["inbox", "connect", "meetings", "settings"])' in app


def test_route_aliases_collapse_legacy_entry_points() -> None:
    app = read("app.js")
    route_normalizer = function_block(app, "normalizeHomeShellRoute")
    initial_route_state = function_block(app, "resolveInitialRouteState")
    route_for_theme = function_block(app, "resolveRouteForTheme")
    route_sync = function_block(app, "syncRouteQueryParam")

    assert "const ROUTE_ALIASES = {" in app
    assert 'feed: "inbox"' in app
    assert 'links: "connect"' in app
    assert 'apps: "connect"' in app
    assert '"feed-preview": "inbox"' in app
    assert '"feed-preview-detail": "inbox"' in app
    assert 'morning: "home"' in app
    assert 'calls: "home"' in app
    assert "const normalized = ROUTE_ALIASES[value] || value;" in route_normalizer
    assert 'return { route: normalizeHomeShellRoute(queryRoute) || "home" };' in initial_route_state
    assert 'return { route: normalizeHomeShellRoute(persistedRoute) || "home" };' in initial_route_state
    assert 'return normalizeHomeShellRoute(value) || "home";' in route_for_theme
    assert 'url.searchParams.set("route", normalizeHomeShellRoute(route) || "home");' in route_sync


def test_render_feed_only_uses_modern_home_shell_paths() -> None:
    app = read("app.js")
    render_feed = function_block(app, "renderFeed")
    chrome_mode = function_block(app, "chromeMode")
    ui_debug_home = function_block(app, "uiDebugGotoHome")

    assert 'shell?.setAttribute("data-view", state.route || "home");' in render_feed
    assert 'shell?.setAttribute("data-canonical-route", route || "home");' in render_feed
    assert 'feed.classList.toggle("is-links-route", route === "connect");' in render_feed
    assert 'syncRouteQueryParam(route);' in render_feed
    assert 'feed.replaceChildren(homeShellCanonicalView(route, lightSettingsSurface()));' in render_feed
    assert 'const page = homeShellCanonicalView(route, lightAppsPage());' in render_feed
    assert 'feed.replaceChildren(homeShellCanonicalView(route, lightMeetingsPage()));' in render_feed
    assert 'feed.replaceChildren(homeShellCanonicalView(route, lightInboxPage()));' in render_feed
    assert 'state.route = "home";' in render_feed
    assert 'syncRouteQueryParam("home");' in render_feed
    assert "settingsPageView()" not in render_feed
    assert "linksPageView()" not in render_feed
    assert "meetingsPageView()" not in render_feed
    assert "placeholder-page" not in render_feed
    assert 'return "home-shell";' in chrome_mode
    assert '[data-route="feed"]' not in ui_debug_home


def test_boot_and_navigation_no_longer_depend_on_legacy_shell_state() -> None:
    app = read("app.js")
    render = function_block(app, "render")
    persist_nav = function_block(app, "persistNavState")
    light_navigate = function_block(app, "lightNavigate")
    light_back = function_block(app, "lightBack")

    assert "renderVoiceStatus();" in render
    assert "renderFeed();" in render
    assert "renderTabs();" not in render
    assert "renderRouteTray();" not in render
    assert "home_shell_active" not in persist_nav
    assert "open_tray_route" not in persist_nav
    assert "state.homeShellActive" not in light_navigate
    assert "state.openTrayRoute" not in light_navigate
    assert "state.homeShellActive" not in light_back
    assert "state.openTrayRoute" not in light_back
    assert "syncThemeQueryParam(state.theme);" in app
    assert "syncRouteQueryParam(state.route);" in app
    assert re.search(r"\n  render\(\);\n  installFeedScrollPersistence\(\);", app)


def test_light_shell_back_stack_persists_history_and_graph_targets_open_through_workspace_routes() -> None:
    app = read("app.js")
    light_navigate = function_block(app, "lightNavigate")
    light_back = function_block(app, "lightBack")
    light_event_block = function_block(app, "lightCalendarEventBlock")
    light_info_section = function_block(app, "lightInfoSection")
    light_project_section_item = function_block(app, "lightProjectSectionItem")
    light_record_chip = function_block(app, "lightRecordChip")

    assert "const LIGHT_ROUTE_HISTORY_LIMIT = 12;" in app
    assert "lightRouteHistory: normalizeLightRouteHistory(persistedNavState.light_history)," in app
    assert "light_history: normalizeLightRouteHistory(state.lightRouteHistory)," in app
    assert "const currentSnapshot = captureLightRouteSnapshot();" in light_navigate
    assert "pushLightRouteHistory(currentSnapshot);" in light_navigate
    assert "const snapshot = popLightRouteHistory();" in light_back
    assert "return restoreLightRouteSnapshot(snapshot);" in light_back
    assert 'state.route = parent === state.route ? "home" : parent;' in light_back
    assert 'lightCalendarEventChips(event, { limit: 2, fromRoute: "calendar" })' in light_event_block
    assert 'openWorkspaceTarget(row.target, state.route)' in light_info_section
    assert 'openWorkspaceTarget(item.target, "project-detail")' in light_project_section_item
    assert 'openWorkspaceTarget(target, options.fromRoute || state.route || "", { taskOrigin: options.taskOrigin || null });' in light_record_chip


def test_styles_drop_legacy_shell_chrome_and_follow_modern_route_names() -> None:
    styles = read("styles.css")

    assert ".page-tabs" not in styles
    assert ".voice-status" in styles
    assert ".app-shell[data-chrome-mode=\"home-shell\"] .voice-status" not in styles
    assert "--safe-area-right: env(safe-area-inset-right, 0px);" in styles
    assert "top: calc(var(--safe-area-top) + 2px);" in styles
    assert "right: calc(var(--safe-area-right) + 8px);" in styles
    assert "--voice-status-size: 38px" in styles
    assert ".voice-status-idle" in styles
    assert ".voice-status-armed" in styles
    assert ".voice-status-recording" in styles
    assert ".voice-status-uploading" in styles
    assert ".voice-status-thinking" in styles
    assert ".voice-status-speaking" in styles
    assert ".voice-status-meeting_recording" in styles
    assert "--voice-color: #586574" in styles
    assert "--voice-color: #3a84ff" in styles
    assert "--voice-color: #ff3b30" in styles
    assert "--voice-color: #ffb000" in styles
    assert "--voice-color: #a855f7" in styles
    assert ".route-tray" not in styles
    assert 'data-light-route="links"' not in styles
    assert 'data-light-route="feed"' not in styles
    assert ".light-shell[data-light-route=\"connect\"]" in styles
    assert ".light-shell[data-light-route=\"inbox\"] .light-canonical-port-surface" in styles
    assert ".light-page-header-shell" in styles
    assert ".light-canonical-port-surface" in styles


def test_voice_status_dot_is_always_rendered_and_debuggable() -> None:
    app = read("app.js")
    render_voice_status = function_block(app, "renderVoiceStatus")
    describe_ui_surface = function_block(app, "describeUiSurface")

    assert "document.querySelectorAll(\"[data-voice-status]\")" in render_voice_status
    assert "const renderedVisualState = visualState;" in render_voice_status
    assert "const renderedLabel = label;" in render_voice_status
    assert "indicator.hidden = false;" in render_voice_status
    assert 'indicator.setAttribute("aria-hidden", "false");' in render_voice_status
    assert "shouldSuppressGlobalVoiceStatus" not in app
    assert 'indicator.className = `voice-status voice-status-${renderedVisualState}`;' in render_voice_status
    assert 'indicator.setAttribute("aria-label", `Turn state: ${renderedLabel}`);' in render_voice_status
    assert 'indicator.title = `Turn: ${renderedLabel}`;' in render_voice_status

    assert 'const voiceStatus = document.getElementById("voiceStatus");' in describe_ui_surface
    assert "voice_status: {" in describe_ui_surface
    assert "exists: Boolean(voiceStatus)" in describe_ui_surface
    assert 'class_name: voiceStatus?.className || ""' in describe_ui_surface
    assert 'aria_hidden: voiceStatus?.getAttribute("aria-hidden") || ""' in describe_ui_surface
    assert "hidden: Boolean(voiceStatus?.hidden)" in describe_ui_surface
    assert 'title: voiceStatus?.title || ""' in describe_ui_surface
    assert 'label: voiceStatus?.getAttribute("aria-label") || ""' in describe_ui_surface
    assert "rect: voiceStatusRect ? {" in describe_ui_surface
    assert 'computed_display: voiceStatusStyle?.display || ""' in describe_ui_surface
    assert 'computed_visibility: voiceStatusStyle?.visibility || ""' in describe_ui_surface
    assert 'computed_opacity: voiceStatusStyle?.opacity || ""' in describe_ui_surface
    assert 'voice_color: String(voiceStatusStyle?.getPropertyValue("--voice-color") || "").trim()' in describe_ui_surface


def test_ui_debug_focus_card_navigates_to_inbox_before_selecting_thread() -> None:
    app = read("app.js")
    focus_card = function_block(app, "uiDebugFocusCard")

    assert 'if (normalizeNavDetail(state.navDetail)) {' in focus_card
    assert 'uiDebugGotoHome();' in focus_card
    assert 'if (state.route !== "inbox") {' in focus_card
    assert 'lightNavigate("inbox");' in focus_card
    assert 'state.openCardMenuSessionId = nextSessionId;' in focus_card
    assert 'state.openCardMenuThreadId = cardThreadId(card);' in focus_card
    assert 'void syncVoiceThreadScope({ reason: "debug_focus_card", render: true });' in focus_card


def test_detail_shell_inherits_shared_light_header_column_gutter_contract() -> None:
    styles = read("styles.css")

    detail_shell = css_block(styles, ".detail-shell")
    detail_body = css_block(styles, ".detail-content-inner")

    assert "--light-shell-column-max: 520px;" in detail_shell
    assert "--light-shell-column-padding: 20px;" in detail_shell
    assert "padding-bottom: var(--safe-area-bottom-pad);" in detail_shell
    assert "max-width: var(--light-shell-column-max);" in detail_body
    assert "padding: 16px var(--light-shell-column-padding) 0;" in detail_body

    compact_media = re.search(r"@media \(max-width: 380px\)\s*\{(?P<body>.*?)\n\}", styles, re.S)
    assert compact_media, "Missing compact light-shell media query"
    assert ".detail-shell {" in compact_media.group("body")
    assert "--light-shell-column-padding: 16px;" in compact_media.group("body")


def test_light_notes_pin_rows_use_right_side_toggle_and_shared_list_layout() -> None:
    app = read("app.js")
    styles = read("styles.css")

    light_notes = function_block(app, "lightNotesPage")
    light_notes_section = function_block(app, "lightNotesSection")
    note_timestamp = function_block(app, "noteContentUpdatedAtMs")
    note_row = function_block(app, "lightNoteRow")
    toggle_note_pin = function_block(app, "toggleNotePin")
    feed_block = css_block(styles, ".feed")
    header_block = css_block(styles, ".light-page-header-shell")
    notes_feed_block = css_block(styles, ".light-notes-feed")
    note_row_block = css_block(styles, ".light-note-row")
    note_row_divider_block = css_block(styles, ".light-note-row + .light-note-row")
    note_pin_button_block = css_block(styles, ".light-note-pin-button")

    assert "note?.content_updated_at_ms" in note_timestamp
    assert "note?.created_at_ms" in note_timestamp
    assert "note?.updated_at_ms" in note_timestamp
    assert 'page.classList.add("light-notes-page");' in light_notes
    assert 'const feedWrap = el("div", "light-notes-feed");' in light_notes
    assert 'feedWrap.append(lightNotesSection("Pinned", pinned));' in light_notes
    assert 'feedWrap.append(lightNotesSection("Recent", notes.filter(note => !note.pinned)));' in light_notes
    assert 'page.append(feedWrap);' in light_notes
    assert 'const section = el("section", "light-notes-section");' in light_notes_section
    assert 'notes.forEach(note => section.append(lightNoteRow(note)));' in light_notes_section

    assert 'const row = el("div", "light-note-row");' in note_row
    assert 'row.setAttribute("role", "button");' in note_row
    assert "row.tabIndex = 0;" in note_row
    assert 'row.dataset.notePinned = String(Boolean(note.pinned));' in note_row
    assert "row.append(lightSmallIcon(" not in note_row
    assert 'const meta = noteMetaLine(note);' in note_row
    assert 'note.pinned ? `Pinned${DOT}` : ""' not in note_row
    assert 'const copy = el("span", "light-note-feed-copy");' in note_row
    assert 'copy.append(el("strong", "", note.title));' in note_row
    assert 'copy.append(el("span", "light-note-row-meta", meta));' in note_row
    assert 'const pin = lightIconButton("pin", note.pinned ? "Unpin note" : "Pin note"' in note_row
    assert 'pin.innerHTML = iconSvg("pin", { filled: Boolean(note.pinned) });' in note_row
    assert "void toggleNotePin(note.id);" in note_row

    assert 'const updated = await patchWorkspaceRecord("notes", note.id, { pinned: nextPinned }, { render: false });' in app
    assert "bucket.items = nextPinned" in toggle_note_pin
    assert "bucket.items = previousItems;" in toggle_note_pin
    assert "bucket.error = previousError;" in toggle_note_pin
    assert "overflow-x: hidden;" in feed_block
    assert "overscroll-behavior-x: none;" in feed_block
    assert "width: calc(100% + (var(--app-shell-side-pad) * 2));" not in header_block
    assert "margin-left: calc(-1 * var(--app-shell-side-pad));" not in header_block
    assert "margin-right: calc(-1 * var(--app-shell-side-pad));" not in header_block

    assert "min-height: 88px;" in note_row_block
    assert "padding: 14px 0;" in note_row_block
    assert "grid-template-columns: minmax(0, 1fr) auto;" in note_row_block
    assert "display: flex;" in notes_feed_block
    assert "flex-direction: column;" in notes_feed_block
    assert "border-top:" in note_row_divider_block
    assert "color: #0a84ff;" in note_pin_button_block
    assert '.light-note-pin-button[data-note-pinned="true"]' in styles


def test_tasks_use_single_filter_selector_and_drop_count_summary() -> None:
    app = read("app.js")
    styles = read("styles.css")

    task_filters = function_block(app, "lightTaskFilters")
    workspace_page = function_block(app, "lightTaskWorkspacePage")
    tasks_page = function_block(app, "lightTasksPage")

    assert "function lightTaskCountLine" not in app
    assert "lightTaskCountLine()," not in workspace_page
    assert "lightTaskCountLine()" not in tasks_page
    assert "listPane.append(lightTaskFilters());" in workspace_page
    assert "page.append(lightTaskFilters());" in tasks_page
    assert 'title: "Filter tasks"' in task_filters
    assert 'openSettingsSelector({' in task_filters
    assert 'taskStatusFilterChoices().map(([value, label]) => ({ value, label }))' in task_filters
    assert 'button.dataset.taskFilterCurrent = currentKey;' in task_filters
    assert 'light-task-filter-button' in task_filters
    assert 'light-task-filter-button-chevron' in task_filters
    assert 'taskFilter: "all",' in app
    assert 'task_filter: state.taskFilter || "all"' not in app
    assert ".light-task-counts" not in styles
    assert ".light-task-filter-button" in styles
    assert ".light-task-filter-button-chevron" in styles
