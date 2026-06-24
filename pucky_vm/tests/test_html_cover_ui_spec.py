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
    match = re.search(rf"function {re.escape(name)}\(.*?\)\s*\{{(?P<body>.*?)\n  \}}", source, re.S)
    assert match, f"Missing function {name}"
    return match.group("body")


def test_material_icon_registry_remains_bundled() -> None:
    app = read("app.js")
    icons = read("pucky-icons.js")
    styles = read("styles.css")

    assert "window.PUCKY_UI_ICONS = {" in icons
    assert "MATERIAL_SYMBOLS:" in icons
    assert "SEMANTIC_ICON_REGISTRY:" in icons
    assert "const MATERIAL_SYMBOLS = iconCatalog.MATERIAL_SYMBOLS" in app
    assert "const SEMANTIC_ICON_REGISTRY = iconCatalog.SEMANTIC_ICON_REGISTRY" in app
    assert "function iconSvg(" in app
    assert "function replyCardIconSvg(" in app
    assert "function loadCardIconRegistry(" in app
    assert 'fetch(`${linksApiBaseUrl()}/api/card-icons`' in app
    assert ".material-icon" in styles


def test_index_uses_modern_home_shell_mounts_only() -> None:
    html = read("index.html")

    assert 'id="bootStatus"' in html
    assert 'id="appShellRoot"' in html
    assert 'data-view="home"' in html
    assert 'id="threadScopeStatus"' in html
    assert 'id="voiceStatus"' in html
    assert 'data-voice-status' in html
    assert 'aria-label="Turn state: idle"' in html
    assert 'id="feed"' in html
    assert 'id="detail"' in html
    assert "window.__PUCKY_BOOTSTRAP_STATUS__" in html
    assert 'const ESSENTIAL_ASSETS = [' in html
    assert 'const BOOTSTRAP_COMMIT = "__PUCKY_BOOTSTRAP_COMMIT__";' in html
    assert "const PAGE_REFRESH_SEED = (() => {" in html
    assert "const ASSET_REFRESH_SEED = COMMIT_SEED || PAGE_REFRESH_SEED;" in html
    assert "function assetUrl(rawUrl)" in html
    assert 'url.searchParams.set("_pucky_asset", ASSET_REFRESH_SEED);' in html
    assert '"pucky-config.js"' in html
    assert '"pucky-links-catalog.js"' in html
    assert '"pucky-icons.js"' in html
    assert '"pucky-routes.js"' in html
    assert '"pucky-ui-state.js"' in html
    assert '"app.js"' in html
    assert 'BOOT_TIMEOUT_MS = 7000' in html
    assert 'autoReloadOnce()' in html
    assert 'asset_delivery_failures' in html
    assert "target.href = assetUrl(asset.url);" in html
    assert "target.src = assetUrl(asset.url);" in html
    assert html.index('"pucky-icons.js"') < html.index('"app.js"')
    assert html.index('"pucky-routes.js"') < html.index('"app.js"')
    assert 'id="pageTabs"' not in html
    assert 'id="routeTray"' not in html


def test_home_shell_registry_exposes_modern_routes_only() -> None:
    app = read("app.js")
    routes = read("pucky-routes.js")

    assert "window.PUCKY_UI_ROUTES = {" in routes
    assert "const LIGHT_APPS = Array.isArray(routeCatalog.LIGHT_APPS)" in app
    assert '{ route: "inbox", label: "Inbox"' in routes
    assert '{ route: "connect", label: "Connect"' in routes
    assert '{ route: "meetings", label: "Meetings"' in routes
    assert '{ route: "settings", label: "Settings"' in routes
    assert routes.index('{ route: "contacts", label: "Contacts"') < routes.index('{ route: "connect", label: "Connect"') < routes.index('{ route: "settings", label: "Settings"')
    assert '{ route: "feed", label: "Inbox"' not in routes
    assert '{ route: "links", label: "Connect"' not in routes
    assert 'route: "feed-preview"' not in routes
    assert 'route: "morning"' not in routes
    assert 'route: "calls"' not in routes
    assert 'HOME_SHELL_CANONICAL_ROUTES: ["inbox", "connect", "meetings", "settings"]' in routes
    assert "const HOME_SHELL_CANONICAL_ROUTES = new Set(Array.isArray(routeCatalog.HOME_SHELL_CANONICAL_ROUTES)" in app


def test_semantic_icon_registry_drives_home_tiles_and_reverse_lookup() -> None:
    app = read("app.js")
    routes = read("pucky-routes.js")
    light_app_tile = function_block(app, "lightAppTile")
    semantic_icon_accent_key = function_block(app, "semanticIconAccentKey")
    semantic_icon_name = function_block(app, "semanticIconName")
    canonical_icon_accent_key = function_block(app, "canonicalIconAccentKey")
    light_app_icon = function_block(app, "lightAppIcon")
    reminder_channel_accent_key = function_block(app, "reminderChannelAccentKey")
    graph_kind_accent_key = function_block(app, "graphKindAccentKey")

    assert "const SEMANTIC_ICON_KEY_BY_ICON = Object.freeze(Object.entries(SEMANTIC_ICON_REGISTRY)" in app
    assert 'tile.dataset.semanticIcon = app.semantic;' in light_app_tile
    assert 'return SEMANTIC_ICON_REGISTRY[key] ? key : "";' in semantic_icon_accent_key
    assert "const entry = SEMANTIC_ICON_REGISTRY[key] || SEMANTIC_ICON_REGISTRY.inbox;" in semantic_icon_name
    assert 'return String(entry.icon || SEMANTIC_ICON_REGISTRY.inbox?.icon || "mail").trim();' in semantic_icon_name
    assert "function semanticIconAccentValue(accentKey, theme = effectiveTheme()) {" in app
    assert "const colors = entry.colors" in app
    assert 'return String(colors[mode] || colors.dark || colors.light || "#8b63ff").trim();' in app
    assert 'return SEMANTIC_ICON_KEY_BY_ICON[key] || "";' in canonical_icon_accent_key
    assert 'if (key === "mail") return "inbox";' not in canonical_icon_accent_key
    assert "applySemanticIconAccent(wrap, app?.semantic);" in light_app_icon
    assert 'wrap.innerHTML = iconSvg(semanticIconName(app?.semantic), { filled: false });' in light_app_icon
    assert '"email": "inbox"' in reminder_channel_accent_key or 'email: "inbox"' in reminder_channel_accent_key
    assert '"sms": "inbox"' in reminder_channel_accent_key or 'sms: "inbox"' in reminder_channel_accent_key
    assert '"call": "contacts"' in reminder_channel_accent_key or 'call: "contacts"' in reminder_channel_accent_key
    assert '"connected_app": "connect"' in reminder_channel_accent_key or 'connected_app: "connect"' in reminder_channel_accent_key
    assert "return canonicalIconAccentKey(graphKindIcon(kind));" in graph_kind_accent_key
    assert '{ route: "inbox", label: "Inbox", semantic: "inbox", kind: "real" }' in routes


def test_route_aliases_collapse_legacy_entry_points() -> None:
    app = read("app.js")
    routes = read("pucky-routes.js")
    route_normalizer = function_block(app, "normalizeHomeShellRoute")
    initial_route_state = function_block(app, "resolveInitialRouteState")
    route_for_theme = function_block(app, "resolveRouteForTheme")
    route_sync = function_block(app, "syncRouteQueryParam")

    assert 'projects: "tags"' not in routes
    assert '"project-detail": "tag-detail"' not in routes
    assert "const ROUTE_ALIASES = routeCatalog.ROUTE_ALIASES && typeof routeCatalog.ROUTE_ALIASES === \"object\"" in app
    assert 'feed: "inbox"' not in routes
    assert 'links: "connect"' not in routes
    assert 'apps: "connect"' not in routes
    assert '"feed-preview": "inbox"' not in routes
    assert '"feed-preview-detail": "inbox"' not in routes
    assert 'morning: "home"' not in routes
    assert 'calls: "home"' not in routes
    assert "const normalized = ROUTE_ALIASES[value] || value;" in route_normalizer
    assert 'return { route: normalizeHomeShellRoute(queryRoute) || "home" };' in initial_route_state
    assert 'return { route: normalizeHomeShellRoute(persistedRoute) || "home" };' in initial_route_state
    assert 'return normalizeHomeShellRoute(value) || "home";' in route_for_theme
    assert 'url.searchParams.delete("reset_nav");' in route_sync
    assert 'url.searchParams.set("route", normalizeHomeShellRoute(route) || "home");' in route_sync


def test_render_feed_only_uses_modern_home_shell_paths() -> None:
    app = read("app.js")
    render_feed = function_block(app, "renderFeed")
    light_mock_route_page = function_block(app, "lightMockRoutePage")
    home_shell_mock_view = function_block(app, "homeShellMockView")
    chrome_mode = function_block(app, "chromeMode")
    ui_debug_home = function_block(app, "uiDebugGotoHome")

    assert 'shell?.setAttribute("data-view", state.route || "home");' in render_feed
    assert 'shell?.setAttribute("data-canonical-route", route || "home");' in render_feed
    assert 'feed.classList.toggle("is-links-route", route === "connect");' in render_feed
    assert 'syncRouteQueryParam(route);' in render_feed
    assert 'const page = lightMockRoutePage(route) || lightHomePage();' in render_feed
    assert 'currentView.dataset.homeShellKind !== "mock"' in render_feed
    assert 'currentView.firstElementChild !== page' in render_feed
    assert 'feed.replaceChildren(homeShellMockView(route, page));' in render_feed
    assert 'feed.replaceChildren(homeShellCanonicalView(route, lightSettingsSurface()));' in render_feed
    assert 'const page = homeShellCanonicalView(route, lightAppsPage());' in render_feed
    assert 'feed.replaceChildren(homeShellCanonicalView(route, lightMeetingsPage()));' in render_feed
    assert 'feed.replaceChildren(homeShellCanonicalView(route, lightInboxPage()));' in render_feed
    assert 'state.route = "home";' in render_feed
    assert 'syncRouteQueryParam("home");' in render_feed
    assert 'view.dataset.homeShellKind = "mock";' in home_shell_mock_view
    assert 'view.append(page);' in home_shell_mock_view
    assert 'return lightContactDetailPage();' in light_mock_route_page
    assert 'return lightContactEditPage();' in light_mock_route_page
    assert "settingsPageView()" not in render_feed
    assert "linksPageView()" not in render_feed
    assert "meetingsPageView()" not in render_feed
    assert "placeholder-page" not in render_feed
    assert 'return "home-shell";' in chrome_mode
    assert '[data-route="feed"]' not in ui_debug_home


def test_meeting_notes_rows_drop_leading_icon_and_trailing_chevron_only_for_that_list() -> None:
    app = read("app.js")
    styles = read("styles.css")
    meeting_notes_page = function_block(app, "lightMeetingNotesPage")
    light_graph_list_page = function_block(app, "lightGraphListPage")
    graph_descriptor = function_block(app, "universalGraphFeedTileDescriptor")
    render_universal_tile = function_block(app, "renderUniversalFeedTile")
    light_graph_row = function_block(app, "lightGraphRow")

    assert "function normalizeUniversalFeedTileDescriptor(" in app
    assert "function normalizeUniversalFeedSectionDescriptor(" in app
    assert "function renderUniversalFeedPage(" in app
    assert "function renderUniversalFeedSection(" in app
    assert "function renderUniversalFeedTile(" in app
    assert 'rowClassName: "light-graph-row-meeting-notes",' in meeting_notes_page
    assert 'surface: "meeting-notes",' in meeting_notes_page
    assert "showLeadingIcon: false," in meeting_notes_page
    assert "showTrailingChevron: false" in meeting_notes_page
    assert "showChips: false," in meeting_notes_page
    assert "return renderUniversalFeedPage({" in light_graph_list_page
    assert 'surface: String(options.surface || options.collection || "workspace"),' in light_graph_list_page
    assert 'surfaceClassName: "light-list-surface",' in light_graph_list_page
    assert "items: workspaceItems(options.collection).map(record => universalGraphFeedTileDescriptor(record, options))" in light_graph_list_page
    assert 'renderMode: "flat",' in graph_descriptor
    assert "showChips: options.showChips !== false," in graph_descriptor
    assert 'return lightGraphRow(record, {' in render_universal_tile
    assert "rowClassName: descriptor.meta?.rowClassName || \"\"," in render_universal_tile
    assert "showLeadingIcon: descriptor.leading?.show !== false," in render_universal_tile
    assert "showTrailingChevron: descriptor.trailing?.show !== false" in render_universal_tile
    assert "showChips: descriptor.meta?.showChips !== false," in render_universal_tile
    assert 'flatFeed: descriptor.renderMode === "flat",' in render_universal_tile
    assert 'const rowClassName = String(options.rowClassName || "").trim();' in light_graph_row
    assert "const flatFeed = options.flatFeed === true;" in light_graph_row
    assert 'const leadingIcon = options.showLeadingIcon === false' in light_graph_row
    assert 'const trailingChevron = options.showTrailingChevron === false' in light_graph_row
    assert "if (leadingIcon) {" in light_graph_row
    assert 'if (options.showChips !== false) {' in light_graph_row
    assert "if (trailingChevron) {" in light_graph_row
    assert 'flatFeed ? "is-flat-feed" : ""' in light_graph_row
    assert ".light-feed-page {" in styles
    assert ".light-feed-surface {" in styles
    assert ".light-feed-section {" in styles
    assert ".light-feed-section-header {" in styles
    assert ".light-feed-section-body {" in styles
    assert ".light-feed-list {" in styles
    assert ".light-feed-row {" in styles
    assert ".light-graph-row.light-graph-row-meeting-notes {" in styles
    assert "grid-template-columns: minmax(0, 1fr) auto;" in styles


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
    assert re.search(
        r"\n  render\(\);\n  setPerfBootPhase\(\"initial_render\"\);\n  syncPerfDebugState\(\"boot\"\);\n  installFeedScrollPersistence\(\);",
        app,
    )


def test_home_route_forces_reminder_collection_refresh() -> None:
    app = read("app.js")
    load_workspace_for_route = function_block(app, "loadWorkspaceForRoute")

    assert 'if (String(route || "").trim() === "home") {' in load_workspace_for_route
    assert 'await loadWorkspaceCollection("reminders", options);' in load_workspace_for_route
    assert 'return;' in load_workspace_for_route


def test_reminder_visible_refresh_rerenders_time_based_ui_even_when_records_are_unchanged() -> None:
    app = read("app.js")
    load_workspace_collection = function_block(app, "loadWorkspaceCollection")

    assert 'if (options.render && (changed || options.renderWhenUnchanged === true)) {' in load_workspace_collection
    assert 'renderWhenUnchanged: true,' in app
    assert 'reason: "visible_stale"' in app
    assert 'reason: "visibility_visible"' in app


def test_light_shell_back_stack_persists_history_and_graph_targets_open_through_workspace_routes() -> None:
    app = read("app.js")
    persist_nav = function_block(app, "persistNavState")
    light_navigate = function_block(app, "lightNavigate")
    light_back = function_block(app, "lightBack")
    light_date_picker = function_block(app, "lightDatePicker")
    light_event_block = function_block(app, "lightCalendarEventBlock")
    light_attendee_chip = function_block(app, "lightAttendeeChip")
    light_info_section = function_block(app, "lightInfoSection")
    light_project_row = function_block(app, "lightProjectRow")
    light_linked_record_feed_row = function_block(app, "lightLinkedRecordFeedRow")
    light_record_chip = function_block(app, "lightRecordChip")
    build_calendar_day_rail = function_block(app, "buildCalendarDayRail")
    continue_calendar_day_rail = function_block(app, "continueCalendarDayRail")

    assert "const LIGHT_ROUTE_HISTORY_LIMIT = 12;" in app
    assert "lightRouteHistory: normalizeLightRouteHistory(persistedNavState.light_history)," in app
    assert "selectedContactId: String(persistedNavState.selected_contact_id || persistedNavState.selectedContactId || \"\").trim() || \"sarah\"," in app
    assert "light_history: normalizeLightRouteHistory(state.lightRouteHistory)," in app
    assert "selected_contact_id: state.selectedContactId || null," in persist_nav
    assert "const currentSnapshot = captureLightRouteSnapshot();" in light_navigate
    assert "pushLightRouteHistory(currentSnapshot);" in light_navigate
    assert "const snapshot = popLightRouteHistory();" in light_back
    assert "const restored = restoreLightRouteSnapshot(snapshot);" in light_back
    assert "restoreDetailNavOrigin();" in light_back
    assert 'state.route = parent === state.route ? "home" : parent;' in light_back
    assert 'lightCalendarEventChips(event, { fromRoute: "calendar", contactsOnly: true })' in light_event_block
    assert 'limit: 2' not in light_event_block
    assert "light-event-summary" not in light_event_block
    assert 'block.setAttribute("role", "button");' in light_event_block
    assert "block.tabIndex = 0;" in light_event_block
    assert 'block.addEventListener("click", event => {' in light_event_block
    assert 'event.target instanceof Element && event.target.closest(".light-attendee-chip")' in light_event_block
    assert 'main.addEventListener("click", event => {' in light_event_block
    assert "event.stopPropagation();" in light_event_block
    assert 'if (event.key === "Enter" || event.key === " ") {' in light_event_block
    light_calendar_event_chips = function_block(app, "lightCalendarEventChips")
    assert 'visible.forEach(entry => row.append(lightCalendarContactChip(entry, { fromRoute: options.fromRoute || state.route || "" })));' in light_calendar_event_chips
    assert "lightRecordChip(entry" not in light_calendar_event_chips
    light_gap = function_block(app, "lightCalendarGap")
    assert 'Free ${calendarFormatTime(untilMs - gapMs)} - ${calendarFormatTime(untilMs)}' in light_gap
    assert "Long break" not in light_gap
    light_cluster = function_block(app, "lightCalendarCluster")
    assert "Busy window" not in light_cluster
    light_meeting_detail = function_block(app, "lightMeetingDetailPage")
    assert 'lightDocumentEyebrow("Calendar event"' not in light_meeting_detail
    assert 'el("h1", "", meeting.title || "Untitled event")' not in light_meeting_detail
    assert "lightCalendarEventDetailsSection(meeting, attendees)" in light_meeting_detail
    assert 'page.append(lightCopySection("Description", meeting.summary));' not in light_meeting_detail
    assert "lightMeetingDetailConnectedSection(meeting)" in light_meeting_detail
    assert "lightLinkedRecordSection(meeting, {" not in light_meeting_detail
    assert 'lightCalendarEventChips(meeting, { fromRoute: "meeting-detail", excludeContacts: true })' not in light_meeting_detail
    assert 'lightInfoSection("Linked records", linkedRows)' not in light_meeting_detail
    linked_record_section = function_block(app, "lightLinkedRecordSection")
    assert "const entries = Array.isArray(options.entries)" in linked_record_section
    assert 'connectedRecordEntries(options.entries, {' in linked_record_section
    assert ': workspaceLinkedEntries(record, {' in linked_record_section
    assert "const showWhenEmpty = options.showWhenEmpty === true;" in linked_record_section
    assert "if (!entries.length && !showWhenEmpty) {" in linked_record_section
    assert 'section.dataset.linkedRecordsTitle = String(title || "Linked records").trim().toLowerCase();' in linked_record_section
    assert 'body.append(el("div", flatFeed ? "light-linked-records-empty-shell is-flat-feed" : "light-card light-linked-records-empty-shell"));' in linked_record_section
    assert 'entries.forEach(entry => body.append(lightLinkedRecordFeedRow(entry, {' in linked_record_section
    light_calendar_event_details_section = function_block(app, "lightCalendarEventDetailsSection")
    assert 'function lightCalendarEventDetailsSection(event, attendees = calendarEventPeople(event)) {' in app
    assert 'const card = el("div", "light-calendar-detail-card light-calendar-event-detail-card");' in app
    assert 'calendarEventCompactWhenLabel(event)' in app
    assert 'const description = String(event?.summary || "").trim();' in app
    assert 'lightCalendarDetailDescription(description)' in app
    assert 'lightCalendarDetailRow("who", "Who", cloud, {' in app
    assert 'calendarEventChipTargets(event, { contactsOnly: true })' in app
    assert 'light-attendee-chip-cloud' in app
    assert 'recognized.forEach(entry => cloud.append(lightCalendarContactChip(entry, { fromRoute: "meeting-detail" })));' in app
    assert "lightRecordChip(entry" not in light_calendar_event_details_section
    assert 'guests.forEach(label => cloud.append(lightGuestAttendeeChip(label)));' not in light_calendar_event_details_section
    assert 'light-calendar-detail-guest-list' not in app
    assert 'const address = String(event?.metadata?.address || "").trim();' in app
    assert 'const locationValue = lightCalendarLocationValue(place, address);' in app
    assert 'card.append(lightCalendarDetailRow("place", "Location", locationValue, {' in app
    assert 'lightCalendarDetailRow("place", "Place", place, { compact: true })' not in app
    assert 'lightCalendarDetailRow("time-zone", "Time zone", eventTimeZone, { compact: true })' in app
    assert 'function lightCalendarDetailDescription(description) {' in app
    assert 'function lightCalendarLocationValue(place, address) {' in app
    assert 'function appendCalendarDescriptionNodes(container, description) {' in app
    assert 'function lightCalendarDescriptionLink(url) {' in app
    assert 'command: "browser.open", args: { url: href }' in app
    open_external_browser_url = function_block(app, "openExternalBrowserUrl")
    assert "window.location.assign" not in open_external_browser_url
    assert 'window.PuckyAndroid' in open_external_browser_url
    assert 'typeof window.PuckyAndroid.postMessage === "function"' in open_external_browser_url
    light_calendar_description_link = function_block(app, "lightCalendarDescriptionLink")
    assert 'window.PuckyAndroid' in light_calendar_description_link
    assert 'typeof window.PuckyAndroid.postMessage === "function"' in light_calendar_description_link
    assert "event.preventDefault();" in light_calendar_description_link
    assert 'function lightCalendarDetailRow(rowKey, label, value, options = {}) {' in app
    assert 'function lightCalendarContactChip(entry, options = {}) {' in app
    assert 'const icon = el("span", "light-calendar-attendee-chip-icon");' in app
    assert 'el("span", "light-calendar-attendee-chip-label", label)' in app
    assert "if (options.compact) {" in app
    assert 'row.classList.add("is-compact");' in app
    assert 'function calendarEventCompactDateLabel(event, timeZone = calendarEffectiveTimeZone()) {' in app
    assert 'function calendarEventCompactWhenLabel(event, timeZone = calendarEffectiveTimeZone()) {' in app
    assert 'function lightMeetingDetailConnectedSection(meeting) {' in app
    assert 'function lightMeetingDetailSection(title, sectionKey, bodyContent, options = {}) {' in app
    assert 'function lightMeetingDetailSectionHeader(title, sectionKey, count, expanded, controlsId) {' in app
    assert 'function resetMeetingDetailSections(meetingId = state.selectedMeetingId) {' in app
    assert 'function ensureMeetingDetailSections(meetingId = state.selectedMeetingId) {' in app
    assert 'function toggleMeetingDetailSection(sectionKey) {' in app
    assert 'state.meetingDetailSections = resetMeetingDetailSections(event.id);' in app
    assert 'state.meetingDetailSections = resetMeetingDetailSections(target.id);' in app
    assert 'const body = el("div", "light-meeting-detail-section-body");' in app
    assert 'body.hidden = !expanded;' in app
    assert 'button.setAttribute("aria-expanded", String(expanded));' in app
    assert 'button.setAttribute("aria-controls", controlsId);' in app
    assert 'function lightGuestAttendeeChip(label) {' in app
    assert 'return el("span", "light-attendee-chip light-attendee-chip-guest", String(label || "").trim());' in app
    assert "function disambiguateCalendarChipLabels(chips) {" in app
    assert 'return disambiguateCalendarChipLabels(chips);' in app
    assert 'label: `${label}${DOT}${graphKindLabel(kind)}`' in app
    assert "calendarEventTypeFiltersCard()" in app
    assert 'const sheet = el("section", "settings-selector-sheet calendar-settings-panel");' in app
    assert "trace-sheet settings-sheet calendar-settings-sheet" not in app
    assert "lightCalendarStripNavButton" not in light_date_picker
    assert "buildCalendarDayRail(strip, selectedCalendarDateKey());" in light_date_picker
    assert 'strip.addEventListener("scroll", () => queueCalendarDayRailContinuation(strip));' in light_date_picker
    assert "function calendarMonthKey(value = selectedCalendarDateKey()) {" in app
    assert "function calendarMonthDayKeys(monthKey) {" in app
    assert "function calendarDayRailMonthKeys(dayKey = selectedCalendarDateKey()) {" in app
    assert "state.calendarDayRailStartMonth" in app
    assert "state.calendarDayRailEndMonth" in app
    assert "calendarStripWindowSize" not in app
    assert "calendarStripDays(" not in app
    calendar_contact_chip_label = function_block(app, "calendarContactChipLabel")
    assert 'if (first && last) {' in calendar_contact_chip_label
    assert 'if (first) {' in calendar_contact_chip_label
    assert 'const parts = display.split(/\\s+/).filter(Boolean);' not in calendar_contact_chip_label
    assert 'return display || "Contact";' in calendar_contact_chip_label
    assert "queueCalendarDayStripCenter(strip, targetDayKey);" in build_calendar_day_rail
    assert "state.selectedCalendarDate" not in continue_calendar_day_rail
    assert 'localStorage.setItem("pucky.cover.calendar_type_filters.v1"' in app
    light_info_row = function_block(app, "lightInfoRow")
    assert 'openWorkspaceTarget(' in light_info_row
    assert 'row.fromRoute || state.route || ""' in light_info_row
    assert 'openWorkspaceTarget(' in light_linked_record_feed_row
    assert 'options.fromRoute || state.route || ""' in light_linked_record_feed_row
    assert "lightInfoRow(row" in light_info_section
    assert 'lightNavigate("project-detail", { from: "projects" });' in light_project_row
    assert "event.stopPropagation();" in light_attendee_chip
    assert 'openWorkspaceTarget(target, options.fromRoute || state.route || "", {' in light_record_chip
    assert 'taskOrigin: options.taskOrigin || null,' in light_record_chip
    assert 'detailOrigin: options.detailOrigin || null,' in light_record_chip


def test_calendar_connected_tiles_use_relative_time_window_instead_of_summary() -> None:
    app = read("app.js")

    graph_list_label = function_block(app, "graphListLabel")
    timestamp_label = function_block(app, "calendarConnectedTileTimestampLabel")
    date_label = function_block(app, "calendarConnectedTileDateLabel")
    connected_value = function_block(app, "connectedRecordValue")
    ensure_linked_collections = function_block(app, "ensureLinkedCollections")
    record_loader = function_block(app, "loadWorkspaceRecord")
    record_lookup = function_block(app, "workspaceRecordByKind")
    workspace_linked_rows = function_block(app, "workspaceLinkedRows")
    reminder_linked_rows = function_block(app, "reminderDetailLinkedRows")
    task_connected_rows = function_block(app, "taskConnectedRows")
    meeting_connected_detail = function_block(app, "meetingNoteConnectedDetail")
    project_connected_detail = function_block(app, "projectConnectedDetail")

    assert 'String(record?.kind || "").trim() === "calendar_event"' in graph_list_label
    assert "return calendarConnectedTileTimestampLabel(record);" in graph_list_label
    assert "calendarConnectedTileDateLabel(dayKey, timeZone, nowMs)" in timestamp_label
    assert "calendarEventTimeRange(event, timeZone)" in timestamp_label
    assert 'return "Today";' in date_label
    assert 'return "Tomorrow";' in date_label
    assert 'return "Yesterday";' in date_label
    assert 'formatCalendarDateKey(normalized, { weekday: "long" })' in date_label
    assert 'formatCalendarDateKey(normalized, { month: "numeric", day: "numeric", year: "2-digit" })' in date_label
    assert 'String(relatedKind || "").trim() === "calendar_event" && related' in connected_value
    assert "return calendarConnectedTileTimestampLabel(related);" in connected_value
    assert 'String(relatedKind || "") === "calendar_event"' in ensure_linked_collections
    assert "loadWorkspaceRecord(collection, relatedId, { render: true, reason: \"linked_calendar\" })" in ensure_linked_collections
    assert "workspaceApiRequest(`/api/workspace/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`" in record_loader
    assert "workspaceRecordCacheEntry(bucket, recordId)" in record_lookup
    assert "connectedRecordValue(entry.relatedKind, entry.related, entry.relation)" in workspace_linked_rows
    assert "connectedRecordValue(relatedKind, related, relation, { preferSummary: true })" in reminder_linked_rows
    assert "connectedRecordValue(entry.relatedKind, entry.related, entry.relation, { preferSummary: true })" in task_connected_rows
    assert "return calendarConnectedTileTimestampLabel(related);" in meeting_connected_detail
    assert "return calendarConnectedTileTimestampLabel(related);" in project_connected_detail
    assert "value: String(related?.summary || relation || graphKindLabel(relatedKind))" not in task_connected_rows
    assert "calendarEventDayLabel(related)" not in meeting_connected_detail
    assert "calendarEventDayLabel(related)" not in project_connected_detail


def test_calendar_day_rail_styles_and_contracts_follow_continuous_month_model() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert ".light-calendar-day-strip {" in styles
    assert "overflow-x: auto;" in styles
    assert "padding: 2px max(0px, calc((100% - 58px) / 2)) 4px;" not in styles
    assert ".light-calendar-strip-nav" not in styles
    assert ".light-calendar-strip-nav-button" not in styles
    assert 'chip.dataset.month = calendarMonthKey(dayKey);' in app
    assert "function appendCalendarDayRailMonth(strip, monthKey) {" in app
    assert "function prependCalendarDayRailMonth(strip, monthKey) {" in app


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
    assert ".light-page-header-shell.has-chrome" in styles
    assert ".light-canonical-port-surface" in styles
    assert "overflow-x: clip;" in styles
    assert "overflow-y: visible;" in styles
    assert ".light-page-header-shell {\n  position: sticky;" in styles
    assert ".light-date-picker {\n  position: sticky;" not in styles
    assert ".light-calendar-strip-nav-button" not in styles
    assert "grid-auto-columns: 58px;" in styles
    assert "scroll-snap-type: x proximity;" in styles
    assert ".settings-selector-overlay.calendar-settings-overlay" in styles
    assert ".calendar-settings-panel" in styles
    assert ".calendar-type-filter-row" in styles
    assert ".light-calendar-detail-card" in styles
    assert ".light-calendar-event-detail-card" in styles
    assert ".light-calendar-event-detail-card .light-calendar-detail-row.is-compact" in styles
    assert ".light-calendar-event-detail-card .light-calendar-detail-row-value" in styles
    assert ".light-calendar-event-detail-card .light-attendee-chip-cloud" in styles
    assert ".light-calendar-attendee-chip {" in styles
    assert ".light-calendar-attendee-chip .light-calendar-attendee-chip-icon {" in styles
    assert ".light-calendar-attendee-chip .light-calendar-attendee-chip-label {" in styles
    assert ".light-calendar-detail-location {" in styles
    assert ".light-calendar-detail-location-address {" in styles
    assert ".light-calendar-detail-description-link {" in styles
    assert ".app-shell[data-theme=\"dark\"] .light-attendee-chip.is-link" in styles
    assert ".light-attendee-chip-guest" in styles
    assert ".app-shell[data-theme=\"dark\"] .light-attendee-chip-guest" in styles
    assert ".light-linked-record-list" in styles
    assert ".light-linked-record-feed-row" in styles
    assert ".light-linked-records-empty-shell" in styles
    assert ".light-linked-record-list.is-flat-feed {" in styles
    assert ".light-linked-records-section.is-flat-feed {" in styles
    assert ".light-linked-record-feed-row.is-flat-feed {" in styles
    assert ".light-linked-records-empty-shell.is-flat-feed {" in styles


def test_voice_status_dot_is_always_rendered_and_debuggable() -> None:
    app = read("app.js")
    render_voice_status = function_block(app, "renderVoiceStatus")
    describe_ui_surface = function_block(app, "describeUiSurface")
    normalize_turn_status = function_block(app, "normalizeTurnStatus")
    stale_recovery_guard = function_block(app, "shouldTreatReplyRecoveryAsSettled")

    assert "document.querySelectorAll(\"[data-voice-status]\")" in render_voice_status
    assert "const renderedVisualState = visualState;" in render_voice_status
    assert "const renderedLabel = label;" in render_voice_status
    assert "indicator.hidden = false;" in render_voice_status
    assert 'indicator.setAttribute("aria-hidden", "false");' in render_voice_status
    assert "shouldSuppressGlobalVoiceStatus" not in app
    assert 'indicator.className = `voice-status voice-status-${renderedVisualState}`;' in render_voice_status
    assert 'indicator.setAttribute("aria-label", `Turn state: ${renderedLabel}`);' in render_voice_status
    assert 'indicator.title = `Turn: ${renderedLabel}`;' in render_voice_status
    assert "if (shouldTreatReplyRecoveryAsSettled(raw, indicator)) {" in normalize_turn_status
    assert 'indicator.state = "idle";' in normalize_turn_status
    assert 'indicator.visual_state = "idle";' in normalize_turn_status
    assert 'indicator.uploading = false;' in normalize_turn_status
    assert 'indicator.tts_running = false;' in normalize_turn_status
    assert 'indicator.active = false;' in normalize_turn_status
    assert "const serverTurnStatus = last && typeof last.server_turn_status === \"object\" ? last.server_turn_status : {};" in stale_recovery_guard
    assert "const replyRecoveryPending = truthy(raw.reply_recovery_pending ?? last.reply_recovery_pending);" in stale_recovery_guard
    assert "const responseTransportError = String(raw.response_transport_error || last.response_transport_error || \"\").trim();" in stale_recovery_guard
    assert "const feedPersisted = truthy(serverTurnStatus.feed_persisted);" in stale_recovery_guard
    assert "const playerCompleted = !truthy(player.is_playing)" in stale_recovery_guard
    assert "const transportActive = indicator.uploading" in stale_recovery_guard
    assert "|| indicator.stt_running" in stale_recovery_guard
    assert "|| indicator.codex_running" in stale_recovery_guard
    assert "|| indicator.tts_running;" in stale_recovery_guard
    assert 'const visuallyActive = indicator.visual_state === "uploading" || indicator.visual_state === "thinking";' in stale_recovery_guard
    assert "if (transportActive || visuallyActive) {" in stale_recovery_guard
    assert 'if (remoteStage !== "completed" && serverStage !== "completed") {' in stale_recovery_guard
    assert "return feedPersisted || playerCompleted;" in stale_recovery_guard

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


def test_turn_status_polling_can_discover_new_walkie_activity_from_idle_routes() -> None:
    app = read("app.js")

    assert 'const TURN_STATUS_POLL_MS = 250;' in app
    assert 'const TURN_STATUS_LIVE_ROUTE_INTERVAL_MS = 1000;' in app
    assert 'const TURN_STATUS_IDLE_ROUTE_INTERVAL_MS = 3000;' in app
    assert 'if (document.visibilityState !== "visible") {' in app
    assert 'const turnInterval = turnStatusPollIntervalMs(state.route);' in app
    assert 'if ((now - lastTurnStatusPollAt) >= turnInterval) {' in app
    assert 'recordPerfPollTick("turn_status");' in app
    assert 'const wasTurnActive = isTurnActive(state.turn);' in app
    assert 'await loadTurnStatus({ render: false });' in app
    assert 'if (state.route === "inbox" && (turnActive || wasTurnActive)) {' in app
    assert 'requestRender("visible_poll");' in app
    assert '}, TURN_STATUS_POLL_MS);' in app


def test_hosted_workspace_routes_load_live_data_without_browser_unlock_state() -> None:
    app = read("app.js")
    styles = read("styles.css")
    index_html = read("index.html")
    routes = read("pucky-routes.js")
    legacy_browser_state = "pucky-browser" + "-state.js"
    legacy_browser_unlock = "pucky-browser" + "-unlock.js"
    load_workspace = function_block(app, "loadWorkspaceCollection")
    light_workspace_status = function_block(app, "lightWorkspaceStatus")
    light_calendar_page = function_block(app, "lightCalendarPage")
    light_date_picker = function_block(app, "lightDatePicker")
    light_header = function_block(app, "lightHeader")

    assert 'notes: "Notes"' in routes
    assert '"calendar-events": "Calendar"' in routes
    assert 'await ensureLinksApiConfig();' in load_workspace
    assert 'const payload = await workspaceApiRequest(workspaceQuery(collection, { date, includeArchived: Boolean(options.includeArchived) }), {' in load_workspace
    assert 'metricKey: `workspace:${collection}`' in load_workspace
    assert 'const nextItems = Array.isArray(payload && payload.items) ? payload.items : [];' in load_workspace
    assert 'const nextFingerprint = stableJsonFingerprint(nextItems);' in load_workspace
    assert 'bucket.items = nextItems;' in load_workspace
    assert 'bucket.fingerprint = nextFingerprint;' in load_workspace
    assert 'bucket.loaded = true;' in load_workspace
    assert 'bucket.lastRefreshAt = refreshedAt;' in load_workspace
    assert 'bucket.dirty = false;' in load_workspace
    assert "pucky-ui-state.js" in index_html
    assert legacy_browser_state not in index_html
    assert legacy_browser_unlock not in index_html
    assert "preview_locked" not in app
    assert 'if (bucket.error) {' in light_workspace_status
    assert 'if (!bucket.loaded) {' in light_workspace_status
    assert 'if (bucket.loaded && !workspaceItems(collection).length) {' in light_workspace_status
    assert 'headerChrome: lightDatePicker()' in light_calendar_page
    assert 'page.append(lightDatePicker())' not in light_calendar_page
    assert 'const today = el("button", "light-calendar-today-button", "Today");' not in light_date_picker
    assert 'action: lightIconButton("settings", "Calendar settings", openCalendarSettingsSheet, "light-calendar-settings-button")' in light_calendar_page
    assert 'action: lightCircleButton("settings", "Calendar settings", openCalendarSettingsSheet, "light-calendar-settings-button")' not in light_calendar_page
    assert "if (options.headerChrome)" in light_header
    assert 'if (bucket.error) {' in light_calendar_page
    assert 'if (!bucket.loaded) {' in light_calendar_page
    assert ".light-calendar-today-button" not in styles
    calendar_settings_button = css_block(styles, ".light-calendar-settings-button")
    assert "background: transparent;" in calendar_settings_button
    assert "border: none;" in calendar_settings_button
    assert "box-shadow: none;" in calendar_settings_button


def test_calendar_uses_one_full_collection_for_day_rail_and_selected_day() -> None:
    app = read("app.js")
    workspace_route_query_key = function_block(app, "workspaceRouteQueryKey")
    workspace_query_key = function_block(app, "workspaceQueryKey")
    load_workspace = function_block(app, "loadWorkspaceCollection")
    load_workspace_for_route = function_block(app, "loadWorkspaceForRoute")
    light_date_picker = function_block(app, "lightDatePicker")
    light_calendar_day_chip = function_block(app, "lightCalendarDayChip")

    assert 'if (currentRoute === "calendar") {' not in workspace_route_query_key
    assert 'if (String(collection || "").trim() === "calendar-events") {' not in workspace_query_key
    assert 'const date = String(options.date || "");' in load_workspace
    assert 'const date = String(options.date || queryKey || "");' not in load_workspace
    assert 'reason: "calendar_preload_prev"' not in load_workspace
    assert 'reason: "calendar_preload_next"' not in load_workspace
    assert 'date: queryKey || options.date || ""' not in load_workspace_for_route
    assert 'void loadWorkspaceForRoute("calendar", {' not in light_date_picker
    assert 'reason: "calendar_day_change"' not in light_date_picker
    assert 'void loadWorkspaceForRoute("calendar", {' not in light_calendar_day_chip
    assert 'reason: "calendar_day_click"' not in light_calendar_day_chip
    assert 'state.selectedCalendarDate = dayKey;' in light_calendar_day_chip
    assert 'render();' in light_calendar_day_chip


def test_perf_debug_contract_exposes_route_ready_render_bridge_and_poll_metrics() -> None:
    app = read("app.js")
    perf_metrics = function_block(app, "perfDebugMetrics")
    route_ready = function_block(app, "routeReadyState")
    ui_dispatch = function_block(app, "uiDebugDispatch")

    assert 'window.__PUCKY_PERF_DEBUG__ = {' in app
    assert 'schema: "pucky.perf_debug.v1",' in app
    assert 'function perfDebugEnabled() {' in app
    assert 'params.get("debug_perf") === "1"' in app
    assert 'function initialPerfDebugState(initialRoute = "") {' in app
    assert 'function routeReadyState(route = state.route) {' in app
    assert 'function perfDebugMetrics() {' in app
    assert 'route_ready: Boolean(perfDebugState.route_ready),' in perf_metrics
    assert 'route_ready_reason: String(perfDebugState.route_ready_reason || ""),' in perf_metrics
    assert 'route_enter_at_ms: safeNumber(perfDebugState.route_enter_at_ms),' in perf_metrics
    assert 'route_data_start_at_ms: safeNumber(perfDebugState.route_data_start_at_ms),' in perf_metrics
    assert 'route_data_end_at_ms: safeNumber(perfDebugState.route_data_end_at_ms),' in perf_metrics
    assert 'wall_elapsed_ms: Math.max(0, Date.now() - safeNumber(perfDebugState.route_enter_at_ms)),' in perf_metrics
    assert 'bridge_total_ms: safeNumber(perfDebugState.bridge_total_ms),' in perf_metrics
    assert 'shell_launch_elapsed_ms: safeNumber(perfDebugState.shell_launch_elapsed_ms),' in perf_metrics
    assert 'webview_load_elapsed_ms: safeNumber(perfDebugState.webview_load_elapsed_ms),' in perf_metrics
    assert 'asset_delivery_failures: safeNumber(perfDebugState.asset_delivery_failures),' in perf_metrics
    assert 'hosted_reload_attempts: safeNumber(perfDebugState.hosted_reload_attempts),' in perf_metrics
    assert 'bootstrap_snapshot_used: Boolean(perfDebugState.bootstrap_snapshot_used),' in perf_metrics
    assert 'render_count: safeNumber(perfDebugState.render_count),' in perf_metrics
    assert 'bridge_calls_by_command: { ...perfDebugState.bridge_calls_by_command },' in perf_metrics
    assert 'fetches_by_key: { ...perfDebugState.fetches_by_key },' in perf_metrics
    assert 'poll_ticks_by_lane: { ...perfDebugState.poll_ticks_by_lane },' in perf_metrics
    assert 'cache_hits_by_key: { ...perfDebugState.cache_hits_by_key },' in perf_metrics
    assert 'deferred_tasks_started: safeNumber(perfDebugState.deferred_tasks_started),' in perf_metrics
    assert 'deferred_tasks_completed: safeNumber(perfDebugState.deferred_tasks_completed),' in perf_metrics
    assert 'unchanged_refresh_skips: safeNumber(perfDebugState.unchanged_refresh_skips),' in perf_metrics
    assert 'sample_reason: String(perfDebugState.sample_reason || ""),' in perf_metrics
    assert 'surface: String(perfDebugState.surface || ""),' in perf_metrics
    assert 'device_class: String(perfDebugState.device_class || ""),' in perf_metrics
    assert 'case "connect":' in route_ready
    assert 'case "tasks":' in route_ready
    assert 'case "calendar":' in route_ready
    assert '"connect_catalog_ready"' in route_ready
    assert 'if (action === "perf_metrics") {' in ui_dispatch
    assert 'metrics: perfDebugMetrics(),' in ui_dispatch
    assert 'perfMetrics: perfDebugMetrics' in app


def test_perf_telemetry_sampling_and_flush_posts_route_events_to_dedicated_endpoint() -> None:
    app = read("app.js")
    initial_perf = function_block(app, "initialPerfDebugState")
    route_perf_payload = function_block(app, "routePerfEventPayload")
    flush_route_perf = function_block(app, "flushRoutePerfTelemetry")

    assert 'const PERF_BROWSER_SAMPLE_RATE = 0.01;' in app
    assert 'const PERF_ANDROID_SAMPLE_RATE = 0.05;' in app
    assert 'function perfTelemetrySampleReason() {' in app
    assert 'enabled: perfDebugEnabled() || Boolean(sampleReason),' in initial_perf
    assert 'schema: "pucky.ui_route_perf_event.v1",' in app
    assert 'function flushRoutePerfTelemetry(trigger = "route_ready") {' in app
    assert "/api/ui/route-perf-events" in flush_route_perf
    assert 'app_version: "",' in route_perf_payload
    assert 'ui_version: String(state.uiSurface?.ui_version || bundleUiVersion() || ""),' in route_perf_payload
    assert 'shell_launch_elapsed_ms: safeNumber(metrics.shell_launch_elapsed_ms),' in route_perf_payload
    assert 'webview_load_elapsed_ms: safeNumber(metrics.webview_load_elapsed_ms),' in route_perf_payload
    assert 'asset_delivery_failures: safeNumber(metrics.asset_delivery_failures),' in route_perf_payload
    assert 'hosted_reload_attempts: safeNumber(metrics.hosted_reload_attempts),' in route_perf_payload
    assert 'bootstrap_snapshot_used: Boolean(metrics.bootstrap_snapshot_used),' in route_perf_payload


def test_shared_bridge_cache_and_calendar_day_cache_support_android_shell_tax_reduction() -> None:
    app = read("app.js")
    load_workspace = function_block(app, "loadWorkspaceCollection")
    load_workspace_for_route = function_block(app, "loadWorkspaceForRoute")
    request_native_config = function_block(app, "requestNativeLinksConfig")

    assert "const bridgeReadCache = new Map();" in app
    assert "function cachedBridgeRead(command, args = {}, options = {}) {" in app
    assert 'invalidateBridgeReadCache("pucky.turn.settings.get");' in app
    assert 'invalidateBridgeReadCache("wake.status");' in app
    assert 'invalidateBridgeReadCache("ui.default_audio_speed.get");' in app
    assert 'queryKey: "",' in app
    assert "queryCache: {}" in app
    assert 'recordPerfCacheHit(`workspace:${collection}`);' in load_workspace
    assert 'rememberWorkspaceCache(bucket, queryKey, nextItems, nextFingerprint, refreshedAt);' in load_workspace
    assert 'allowCachedRender: true,' not in load_workspace
    assert 'shiftCalendarDateKey(dayKey, -1)' not in load_workspace
    assert 'const queryKey = workspaceRouteQueryKey(route, options);' in load_workspace_for_route
    assert 'const cached = !options.force ? readBridgeCache("pucky.config.get", {}, PERF_BRIDGE_CACHE_TTL_MS) : null;' in request_native_config


def test_android_bootstrap_snapshot_primes_first_paint_state_before_individual_reads() -> None:
    app = read("app.js")
    load_native_bootstrap = function_block(app, "loadNativeBootstrapSnapshot")
    apply_native_bootstrap = function_block(app, "applyNativeBootstrapSnapshot")
    load_settings = function_block(app, "loadSettingsState")
    ensure_links = function_block(app, "ensureLinksApiConfig")
    boot_side_effects = function_block(app, "runBootRouteSideEffects")

    assert 'let nativeBootstrapPromise = null;' in app
    assert 'function applyNativeBootstrapSnapshot(snapshot) {' in app
    assert 'writeBridgeCache("ui.surface.get", {}, raw.ui_surface);' in apply_native_bootstrap
    assert 'writeBridgeCache("pucky.config.get", {}, config);' in apply_native_bootstrap
    assert 'writeBridgeCache("pucky.turn.settings.get", {}, raw.turn_settings);' in apply_native_bootstrap
    assert 'writeBridgeCache("wake.status", {}, raw.wake_status);' in apply_native_bootstrap
    assert 'writeBridgeCache("phone.role.status", {}, raw.phone_role);' in apply_native_bootstrap
    assert 'writeBridgeCache("ui.default_audio_speed.get", {}, raw.default_audio_speed);' in apply_native_bootstrap
    assert 'perfDebugState.bootstrap_snapshot_used = true;' in apply_native_bootstrap
    assert 'await cachedBridgeRead("ui.bootstrap.get", {}, {' in load_native_bootstrap
    assert 'await loadNativeBootstrapSnapshot({ render: false, force: Boolean(options.force) });' in load_settings
    assert 'await loadNativeBootstrapSnapshot({ render: false });' in ensure_links
    assert 'const bootstrapTask = hasNativeBootstrap' in boot_side_effects
    assert 'void bootstrapTask.then(() => loadLinksPortal({ render: true }));' in boot_side_effects


def test_browser_preview_requests_reuse_saved_browser_state_token() -> None:
    app = read("app.js")
    ui_state = read("pucky-ui-state.js")

    initial_links = function_block(app, "initialLinksState")
    resolve_hosted_browser_api_base = function_block(app, "resolveHostedBrowserApiBaseUrl")
    resolve_hosted_browser_api_token = function_block(app, "resolveHostedBrowserApiToken")
    resolve_hosted_browser_device = function_block(app, "resolveHostedBrowserDeviceId")
    hydrate_links_session = function_block(app, "hydrateLinksSession")

    assert 'apiBaseUrl: resolveHostedBrowserApiBaseUrl(),' in initial_links
    assert 'apiToken: resolveHostedBrowserApiToken(),' in initial_links
    assert "function resolveBrowserApiBaseUrl(" in ui_state
    assert 'params.get("api_base_url")' in ui_state
    assert 'const fallbackApiBaseUrl = window.location && /^https?:$/i.test(window.location.protocol || "")' in resolve_hosted_browser_api_base
    assert 'if (uiState && typeof uiState.resolveBrowserApiBaseUrl === "function") {' in resolve_hosted_browser_api_base
    assert 'return String(uiState.resolveBrowserApiBaseUrl({ defaultApiBaseUrl: fallbackApiBaseUrl }) || fallbackApiBaseUrl).trim().replace(/\\/$/, "");' in resolve_hosted_browser_api_base
    assert "function resolveBrowserApiToken(" in ui_state
    assert "browser_api_token" in ui_state
    assert 'new URLSearchParams(window.location.search || "").get("api_token")' in app
    assert 'params.get("api_token")' in ui_state
    assert 'if (uiState && typeof uiState.resolveBrowserApiToken === "function") {' in resolve_hosted_browser_api_token
    assert 'return String(uiState.resolveBrowserApiToken() || "").trim();' in resolve_hosted_browser_api_token
    assert 'return String(new URLSearchParams(window.location.search || "").get("api_token") || "").trim();' in resolve_hosted_browser_api_token
    assert 'const uiState = window.PUCKY_UI_STATE && typeof window.PUCKY_UI_STATE === "object"' in resolve_hosted_browser_device
    assert 'return String(uiState.resolveBrowserDeviceId({ deviceStateKey: BROWSER_DEVICE_STATE_KEY }) || "").trim();' in resolve_hosted_browser_device
    assert 'browser_preview: true' in hydrate_links_session


def test_bridge_connect_surfaces_missing_provisioning_token() -> None:
    app = read("app.js")
    hydrate_links_session = function_block(app, "hydrateLinksSession")
    links_debug_metrics = function_block(app, "linksDebugMetrics")

    assert 'state.links.error = "Device provisioning missing pucky_api_token.";' in hydrate_links_session
    assert 'api_token_present: Boolean(String(state.links.apiToken || "").trim())' in links_debug_metrics
    assert 'portal_token_present: Boolean(String(state.links.token || "").trim())' in links_debug_metrics
    assert 'inline_message: String(state.links.error || state.links.message || "")' in links_debug_metrics


def test_browser_open_truthfully_reports_popup_fallback_or_failure() -> None:
    app = read("app.js")
    browser_request = function_block(app, "browserRequest")

    assert 'await new Promise(resolve => setTimeout(resolve, 24));' in browser_request
    assert 'const popupHref = String(popup.location && popup.location.href || "").trim();' in browser_request
    assert 'launch_surface: "popup"' in browser_request
    assert 'popup_opened: true' in browser_request
    assert 'launch_surface: "same_tab"' in browser_request
    assert 'same_tab_navigation: true' in browser_request
    assert 'throw new Error(detail ? `browser.open failed to launch auth: ${detail}` : "browser.open could not open a popup or navigate this tab.");' in browser_request


def test_connect_debug_metrics_capture_filtered_slugs_and_last_handoff_state() -> None:
    app = read("app.js")
    initial_links_state = function_block(app, "initialLinksState")
    links_debug_root = function_block(app, "linksDebugRoot")
    open_links_auth_flow = function_block(app, "openLinksAuthFlow")
    links_debug_metrics = function_block(app, "linksDebugMetrics")

    assert 'last_handoff: blankLinksHandoffState()' in links_debug_root
    assert 'lastHandoff: blankLinksHandoffState(),' in initial_links_state
    assert 'const handoff = normalizeLinksBrowserOpenResult(' in open_links_auth_flow
    assert 'setLinksHandoffState(handoff);' in open_links_auth_flow
    assert '"browser_open_result"' in open_links_auth_flow
    assert 'filtered_slugs: filteredSlugs,' in links_debug_metrics
    assert 'last_handoff_event: String(handoff.event || "")' in links_debug_metrics
    assert 'last_handoff_surface: String(handoff.launch_surface || "")' in links_debug_metrics
    assert 'last_handoff_same_tab_navigation: Boolean(handoff.same_tab_navigation)' in links_debug_metrics


def test_connect_native_config_waits_for_bridge_request_before_declaring_missing_token() -> None:
    app = read("app.js")
    request_native_config = function_block(app, "requestNativeLinksConfig")
    ensure_links_api_config = function_block(app, "ensureLinksApiConfig")

    assert 'const deadlineAt = Date.now() + LINKS_NATIVE_CONFIG_READY_TIMEOUT_MS;' in request_native_config
    assert 'const requireApiToken = options.requireApiToken === true;' in request_native_config
    assert 'if (!(window.Pucky && typeof window.Pucky.request === "function")) {' in request_native_config
    assert 'await new Promise(resolve => setTimeout(resolve, LINKS_NATIVE_CONFIG_RETRY_MS));' in request_native_config
    assert 'const hasApiToken = Boolean(String(config && config.api_token || "").trim()) || config && config.has_api_token === true;' in request_native_config
    assert 'return await Pucky.request({ command: "pucky.config.get", args: {} });' not in request_native_config
    assert 'const config = await requestNativeLinksConfig({ requireApiToken: true });' in ensure_links_api_config
    assert 'if (state.links.apiBaseUrl && state.links.apiToken) {' in ensure_links_api_config
    assert 'if (state.links.apiBaseUrl) {' not in ensure_links_api_config


def test_ui_surface_and_audio_probe_expose_browser_runtime_truth() -> None:
    app = read("app.js")
    describe_ui_surface = function_block(app, "describeUiSurface")
    describe_audio_probe = function_block(app, "describeAudioProbe")

    assert 'if (command === "ui.surface.get") {' in app
    assert 'if (command === "ui.debug.audio_probe.get") {' in app
    assert 'bridge_connected: hasNativeAudioBridge()' in app
    assert "...state.uiSurface," in describe_ui_surface
    assert 'const currentUrl = String(window.location && window.location.href || "");' in describe_ui_surface
    assert 'const bridgeConnected = hasNativeAudioBridge();' in describe_ui_surface
    assert 'requested_url: bridgeConnected ? state.uiSurface.requested_url : currentUrl,' in describe_ui_surface
    assert 'active_url: bridgeConnected ? state.uiSurface.active_url : currentUrl,' in describe_ui_surface
    assert 'entrypoint_url: bridgeConnected ? state.uiSurface.entrypoint_url : currentUrl,' in describe_ui_surface
    assert 'audio_runtime_mode: audioRuntimeMode()' in describe_ui_surface
    assert "bridge_connected: hasNativeAudioBridge()," in describe_audio_probe
    assert 'runtime_mode: audioRuntimeMode()' in describe_audio_probe
    assert 'active_path: state.activePath || ""' in describe_audio_probe
    assert 'current_tile_audio_phase: state.audioProbe.current_tile_audio_phase || "idle"' in describe_audio_probe
    assert "recent_events: Array.isArray(state.audioProbe.recent_events)" in describe_audio_probe
    assert 'last_error_toast: String(state.audioProbe.last_error_toast || state.lastToast.message || "")' in describe_audio_probe


def test_settings_surface_reload_is_native_only() -> None:
    app = read("app.js")
    ensure_surface_current = function_block(app, "ensureSettingsSurfaceCurrent")

    assert 'const bridgeConnected = Boolean(state.uiSurface.bridge_connected);' in ensure_surface_current
    assert 'if (!bridgeConnected || sourceKind === "bundle_current" || !entrypointUrl || !window.location || !window.location.replace) {' in ensure_surface_current
    assert 'window.location.replace(entrypointUrl);' in ensure_surface_current


def test_inbox_tile_audio_uses_explicit_phase_machine_and_not_waveform_default() -> None:
    app = read("app.js")
    card_view = function_block(app, "cardView")
    toggle_audio = function_block(app, "toggleAudio")
    toggle_hosted_audio = function_block(app, "toggleHostedBrowserAudio")
    audio_control_key = function_block(app, "audioControlKey")
    current_strip_kind = function_block(app, "currentTileAudioStripKind")
    is_audio_detail_open = function_block(app, "isAudioDetailOpen")
    sync_probe = function_block(app, "syncAudioProbeFromPlayerState")
    browser_request = function_block(app, "browserRequest")
    ensure_shared_browser_audio = function_block(app, "ensureSharedBrowserAudio")
    sync_shared_browser_player = function_block(app, "syncSharedBrowserPlayerState")
    describe_audio_source = function_block(app, "describeAudioSourceForCard")
    audio_tile_status = function_block(app, "audioTileStatus")
    confirm_playback = function_block(app, "confirmAudioProbePlaybackStart")
    tile_audio_label = function_block(app, "tileAudioLabel")
    tile_audio_meta = function_block(app, "tileAudioMeta")
    current_player_position = function_block(app, "currentPlayerPositionMs")
    playback_position = function_block(app, "playbackPositionForCard")
    should_animate = function_block(app, "shouldAnimateActiveTileAudio")
    hosted_audio_session_key = function_block(app, "hostedAudioSessionKey")
    is_same_audio_card = function_block(app, "isSameAudioCard")

    assert 'const AUDIO_TILE_PHASES = ["idle", "starting", "playing_confirmed", "pause_pending", "start_failed", "ended_immediately"];' in app
    assert 'if (currentTileAudioPhase(card) !== "idle") {' in card_view
    assert 'const title = el("button", "card-title-trigger title", card.title || "Pucky");' in card_view
    assert 'applyCardActionData(title, "transcript_title", card, "reply");' in card_view
    assert "replyCardIconSvg(feedIdentityIconName(card), { filled: true })" in card_view
    assert 'const inlineAudio = el("button", "card-inline-audio-trigger");' in card_view
    assert 'applyCardActionData(inlineAudio, "audio_controls_inline", card, "reply");' in card_view
    assert "inlineAudio.append(audioTileStatus(card));" in card_view
    assert 'showAudioDetail(resolveAudioControlsTargetCard(card));' in card_view
    assert 'const summary = el("button", "card-summary-trigger");' in card_view
    assert 'applyCardActionData(summary, "transcript_body", card, "reply");' in card_view
    assert 'summary.append(el("p", "preview", card.summary || card.transcript || ""));' in card_view
    assert "waveRow(" not in card_view
    assert 'if (prefersHostedDirectAudio(card)) {' in toggle_audio
    assert "await toggleHostedBrowserAudio(card, busyKey);" in toggle_audio
    assert 'recordAudioProbeEvent("click_received"' in toggle_audio
    assert 'setAudioProbePhase(card, "starting"' in toggle_audio
    assert 'setAudioProbePhase(card, "pause_pending"' in toggle_audio
    assert 'setAudioProbeTerminal(card, "start_failed"' in toggle_audio
    assert 'recordAudioProbeEvent("play_request_start"' in toggle_audio
    assert 'recordAudioProbeEvent("play_request_end"' in toggle_audio
    assert "confirmAudioProbePlaybackStart(busyKey, state.player);" in toggle_audio
    assert 'recordAudioProbeEvent("busy_end"' in toggle_audio
    assert "const current = currentBrowserPlayerState();" in toggle_hosted_audio
    assert 'const audioUrl = String(card?.audio_url || "").trim();' in toggle_hosted_audio
    assert "const controlKey = audioControlKey(card) || audioUrl;" in toggle_hosted_audio
    assert ": savedPositionFor(controlKey);" in toggle_hosted_audio
    assert "forgetCompleted(controlKey);" in toggle_hosted_audio
    assert 'command: "player.play",' in toggle_hosted_audio
    assert "source: controlKey," in toggle_hosted_audio
    assert 'if (!hasNativeAudioBridge() && card.audio_url) {' in audio_control_key
    assert "return hostedAudioSessionKey(card) || card.audio_url;" in audio_control_key
    assert "return `media:${explicit}`;" in hosted_audio_session_key
    assert "return `card:${cardId}:audio`;" in hosted_audio_session_key
    assert "return `session:${sessionId}:audio`;" in hosted_audio_session_key
    assert "samePath(playerStateKey(player), audioStateKey(card))" in is_same_audio_card
    assert 'if (!Boolean(player?.is_playing) || !samePath(targetKey, playerStateKey(player))) {' in confirm_playback
    assert 'const BROWSER_AUDIO_RUNTIME = "browser_native";' in app
    assert 'const audio = new Audio();' in ensure_shared_browser_audio
    assert 'audio.addEventListener("loadedmetadata", () => syncSharedBrowserPlayerState({ render: true }));' in ensure_shared_browser_audio
    assert 'audio.addEventListener("ratechange", () => syncSharedBrowserPlayerState({ render: false }));' in ensure_shared_browser_audio
    assert "const audioElementSource = String(audio.currentSrc || audio.src || \"\").trim();" in sync_shared_browser_player
    assert "previousPlayer?.path || audioElementSource" in sync_shared_browser_player
    assert "previousPlayer?.source || state.activePath || audioElementSource" in sync_shared_browser_player
    assert 'return playerHasAudioIdentity(state.player)' in browser_request
    assert 'return setAudioProbePhaseByKey(targetKey, "playing_confirmed", {' in confirm_playback
    assert 'reason: String(reason || "play_request_acknowledged")' in confirm_playback
    assert 'if (phase !== "playing_confirmed") {' in current_strip_kind
    assert 'if (Number(state.player.duration_ms || 0) > 0 && activePlayerMatchesCard(card)) {' in current_strip_kind
    assert "const phase = isAudioTilePhase(state.audioProbe.current_tile_audio_phase)" in sync_probe
    assert 'setAudioProbePhaseByKey(targetKey, "playing_confirmed"' in sync_probe
    assert 'setAudioProbeTerminalByKey(targetKey, "ended_immediately"' in sync_probe
    assert 'if (prefersHostedDirectAudio(card)) {' in describe_audio_source
    assert 'const audio = ensureSharedBrowserAudio();' in browser_request
    assert 'const requestedPath = String(args.path || "").trim();' in browser_request
    assert 'await audio.play();' in browser_request
    assert 'await audio.pause();' in browser_request
    assert 'const positionMs = Math.max(0, Math.round(Number(args.position_ms || 0)));' in browser_request
    assert 'return fetchArtifactBase64(args.path, args.max_bytes);' in browser_request
    assert 'const strip = el("div", `tile-audio-strip is-${phase} is-${runtime}`);' in audio_tile_status
    assert 'setDataAttribute(strip, "data-strip-kind", stripKind);' in audio_tile_status
    assert 'const progress = el("span", "tile-audio-progress");' in audio_tile_status
    assert "Audio playing" in tile_audio_label
    assert 'Playback ended early' in tile_audio_label
    assert 'return "Browser preview only."' not in tile_audio_meta
    assert 'const shouldRenderStrip = !(runtime === "browser_stub" && phase === "playing_confirmed" && stripKind === "status");' not in audio_tile_status
    assert 'return currentPlayerPositionMs(state.player);' in playback_position
    assert 'const base = Math.max(0, Number(player?.position_ms || 0));' in current_player_position
    assert 'const observedAtMs = Math.max(0, Number(player?.observed_at_ms || 0));' in current_player_position
    assert 'return duration > 0 ? Math.min(duration, live) : live;' in current_player_position
    assert 'const panel = document.getElementById("detail");' in is_audio_detail_open
    assert 'return Boolean(panel?.classList.contains("is-open") && panel.getAttribute("data-detail-type") === "audio");' in is_audio_detail_open
    assert 'if (!state.activePath || !state.player.is_playing) {' in should_animate
    assert 'if (Number(state.player.duration_ms || 0) <= 0) {' in should_animate
    assert 'state.route === "inbox" || state.route === "inbox-detail"' in should_animate
    assert 'const detailCard = currentDetailAudioCard();' in should_animate


def test_tile_audio_styles_use_truthful_status_strip_instead_of_waveform_default() -> None:
    styles = read("styles.css")
    busy_audio = css_block(styles, ".action-audio.is-busy")
    failed_audio = css_block(styles, ".action-audio.is-failed")
    card_body = css_block(styles, ".card-body")
    title_trigger = css_block(styles, ".card-title-trigger,\n.card-summary-trigger,\n.card-inline-audio-trigger")
    tile_status = css_block(styles, ".tile-audio-status")
    tile_label = css_block(styles, ".tile-audio-status-label")
    tile_strip = css_block(styles, ".tile-audio-strip")
    tile_meta = css_block(styles, ".tile-audio-status-meta")
    tile_progress = css_block(styles, ".tile-audio-progress")

    assert "color-mix(in srgb, var(--accent, #72c2ff) 76%, var(--text-muted-strong))" in busy_audio
    assert "color: #ff8f7c;" in failed_audio
    assert "display: flex;" in card_body
    assert "flex-direction: column;" in card_body
    assert "justify-content: center;" in card_body
    assert "background: transparent;" in title_trigger
    assert "text-align: left;" in title_trigger
    assert "font: inherit;" in title_trigger
    assert "display: grid;" in tile_status
    assert "margin-top: 6px;" in tile_status
    assert "font-size: 12px;" in tile_label
    assert "font-weight: 760;" in tile_label
    assert "height: 8px;" in tile_strip
    assert "overflow: hidden;" in tile_strip
    assert "background: color-mix(in srgb, var(--accent, #72c2ff) 14%, var(--surface-control));" in tile_strip
    assert "font-size: 11px;" in tile_meta
    assert "width: calc(var(--progress, 0) * 100%);" in tile_progress
    assert ".tile-audio-strip.is-starting::after," in styles
    assert ".tile-audio-strip.is-playing_confirmed::after" in styles
    assert ".tile-audio-strip.is-playing_confirmed[data-strip-kind=\"progress\"]::after" in styles
    assert ".tile-audio-strip.is-start_failed," in styles
    assert "@keyframes tile-audio-strip-sweep" in styles


def test_feed_page_uses_real_html_sources_without_mock_fallbacks() -> None:
    app = read("app.js")
    card_view = function_block(app, "cardView")
    show_rich_page = function_block(app, "showRichPage")
    read_rich_page_source = function_block(app, "readRichPageSource")
    rich_frame = function_block(app, "richFrame")
    resolve_rich_page_source = function_block(app, "resolveRichPageSource")
    browser_request = function_block(app, "browserRequest")

    assert "function hasRichPage(card) {" in app
    assert "function resolveRichPageSource(card) {" in app
    assert 'return htmlPath || (htmlArtifact ? artifactVirtualPath(htmlArtifact) : "") || htmlUrl;' in resolve_rich_page_source
    assert 'return htmlUrl || (htmlArtifact ? artifactApiUrl(htmlArtifact) : "") || htmlPath;' in resolve_rich_page_source
    assert 'applyCardActionData(page, "page", card, "reply");' not in card_view
    assert 'showRichPage(card);' not in card_view
    assert "if (card.html_path) {" not in card_view
    assert 'const pageSource = resolveRichPageSource(card);' in show_rich_page
    assert "content.append(await richFrame(pageSource, card), el(\"div\", \"rich-swipe-edge\"));" in show_rich_page
    assert "mockArtifactResult" not in show_rich_page
    assert "isMockHtmlArtifact" not in app
    assert 'const response = await fetchArtifactHttpResponse(source, "Page");' in read_rich_page_source
    assert 'const content_base64 = base64FromBytes(buffer)' not in read_rich_page_source
    assert 'content_base64: base64FromBytes(buffer),' in read_rich_page_source
    assert "const result = await readRichPageSource(path);" in rich_frame
    assert "atob(content)" not in rich_frame
    assert 'const url = await resolveBrowserArtifactUrl(args.path);' in browser_request


def test_feed_detail_uses_full_bleed_scrollable_layout() -> None:
    app = read("app.js")
    styles = read("styles.css")
    show_rich_page = function_block(app, "showRichPage")
    open_side_detail = function_block(app, "openSideDetail")
    detail_shell = css_block(styles, ".detail-shell.is-full-bleed")
    detail_content = css_block(styles, ".detail-content.is-full-bleed,\n.detail-content-inner.is-full-bleed")
    rich_detail = css_block(styles, ".rich-detail.is-full-bleed")

    assert "fullBleed: true" in show_rich_page
    assert "shell.classList.add(\"is-full-bleed\");" in open_side_detail
    assert "body.classList.add(\"is-full-bleed\");" in open_side_detail
    assert "content.classList.add(\"is-full-bleed\");" in open_side_detail
    assert "--light-shell-column-max: 100%;" in detail_shell
    assert "display: flex;" in detail_content
    assert ".detail-content-inner.is-full-bleed {\n  max-width: 100%;" in styles
    assert ".detail-content-inner.is-full-bleed {\n  max-width: 100%;\n  margin: 0;\n  padding: 0;" in styles
    assert "flex: 1 1 auto;" in rich_detail
    assert "min-height: 0;" in rich_detail


def test_detail_views_require_explicit_audio_continuity_opt_in_and_preserve_audio_surfaces() -> None:
    app = read("app.js")
    render_fn = function_block(app, "render")
    show_transcript = function_block(app, "showTranscript")
    show_rich_page = function_block(app, "showRichPage")
    show_image_reel = function_block(app, "showImageReel")
    show_video_attachment = function_block(app, "showVideoAttachment")
    show_audio_attachment = function_block(app, "showAudioAttachment")
    show_document_attachment = function_block(app, "showDocumentAttachment")
    open_side_detail = function_block(app, "openSideDetail")
    show_audio_detail = function_block(app, "showAudioDetail")
    resolve_audio_controls_target_card = function_block(app, "resolveAudioControlsTargetCard")
    find_card_by_player = function_block(app, "findCardByPlayer")
    current_detail_audio_card = function_block(app, "currentDetailAudioCard")
    detail_audio_continuity = function_block(app, "detailAudioContinuity")
    render_detail_audio_continuity = function_block(app, "renderDetailAudioContinuity")

    assert "renderDetailAudioContinuity();" in render_fn
    assert 'openSideDetail(panel, card.title || "Transcript", content, dismissDetail);' in show_transcript
    assert "showAudioDetail(resolveAudioControlsTargetCard(card));" not in show_transcript
    assert "fullBleed: true" in show_rich_page
    assert 'openSideDetail(panel, card.title || "Page", content, dismissWithCleanup, { fullBleed: true });' in show_rich_page
    assert 'openSideDetail(panel, card.title || "Images", content, dismissGallery);' in show_image_reel
    assert 'openSideDetail(panel, item.title || card.title || "Video", content, dismissAttachment);' in show_video_attachment
    assert 'openSideDetail(panel, item.title || card.title || "Audio", content, dismissAttachment);' in show_audio_attachment
    assert 'openSideDetail(panel, item.title || card.title || "Attachment", content, dismissAttachment);' in show_document_attachment
    assert "function openSideDetail(panel, title, content, onDismiss, options = {}) {" in app
    assert 'const audioCard = options.showAudioContinuity === true && hasAudio(options.audioCard) ? options.audioCard : null;' in open_side_detail
    assert "if (audioCard) {" in open_side_detail
    assert "shell.append(detailAudioContinuity(audioCard));" in open_side_detail
    assert "const detail = normalizeNavDetail(state.navDetail);" in current_detail_audio_card
    assert "const card = resolveNavDetailCard(detail);" in current_detail_audio_card
    assert "return card && hasAudio(card) ? card : null;" in current_detail_audio_card
    assert "const targetCard = resolveAudioControlsTargetCard(card);" in show_audio_detail
    assert "state.audioCard = targetCard;" in show_audio_detail
    assert 'openSideDetail(panel, targetCard.title || "Audio", content, dismissAudioDetail);' in show_audio_detail
    assert "const active = findCardByPlayer(state.player);" in resolve_audio_controls_target_card
    assert "const bySession = findCardBySessionId(sessionId);" in resolve_audio_controls_target_card
    assert "return findCardByIdentity(card) || card;" in resolve_audio_controls_target_card
    assert "if (!playerHasAudioIdentity(player)) {" in find_card_by_player
    assert 'const section = el("section", "detail-audio-continuity");' in detail_audio_continuity
    assert 'copy.append(el("div", "detail-audio-continuity-kicker", "Audio playback"));' in detail_audio_continuity
    assert 'copy.append(el("div", "detail-audio-continuity-title", card.title || "Audio"));' in detail_audio_continuity
    assert "copy.append(audioTileStatus(card));" in detail_audio_continuity
    assert 'isPlayingCard(card) ? "Pause" : "Play"' in detail_audio_continuity
    assert "Stop preview" not in detail_audio_continuity
    assert 'const toggle = el("button", "detail-audio-action detail-audio-action-primary",' in detail_audio_continuity
    assert "void toggleAudio(card);" in detail_audio_continuity
    assert 'const open = el("button", "detail-audio-action", "Open audio controls");' in detail_audio_continuity
    assert "open.addEventListener(\"click\", () => {" in detail_audio_continuity
    assert "showAudioDetail(resolveAudioControlsTargetCard(card));" in detail_audio_continuity
    assert 'const existing = panel.querySelector(".detail-audio-continuity");' in render_detail_audio_continuity
    assert "existing.replaceWith(detailAudioContinuity(card));" in render_detail_audio_continuity


def test_notes_detail_contract_stays_full_bleed_and_transcript_page_detail_do_not_inherit_audio_chrome() -> None:
    app = read("app.js")
    note_detail = function_block(app, "lightNoteDetailPage")
    show_transcript = function_block(app, "showTranscript")
    show_rich_page = function_block(app, "showRichPage")
    show_document_attachment = function_block(app, "showDocumentAttachment")

    assert 'page.classList.add("light-document-page", "light-note-document", "light-note-detail-page");' in note_detail
    assert 'className: "light-detail-html-body light-note-detail-html-body",' in note_detail
    assert "fullBleed: true," in note_detail
    assert "{ audioCard:" not in show_transcript
    assert "{ audioCard:" not in show_rich_page
    assert "{ audioCard:" not in show_document_attachment


def test_inbox_manage_select_keeps_visible_dark_mode_chrome() -> None:
    styles = read("styles.css")
    inbox_manage_select = css_block(styles, ".inbox-manage-select")
    inbox_manage_select_icon = css_block(styles, ".inbox-manage-select .material-icon")

    assert "border: 1px solid" in inbox_manage_select
    assert "color: var(--home-shell-text-muted);" in inbox_manage_select
    assert "background: color-mix(in srgb, var(--surface-card-elevated)" in inbox_manage_select
    assert "fill: currentColor;" in inbox_manage_select_icon
    assert "stroke: none;" in inbox_manage_select_icon
    assert ".inbox-card-menu-button" not in styles


def test_completed_meeting_detail_refresh_does_not_reopen_after_dismiss() -> None:
    app = read("app.js")
    show_meeting_detail = function_block(app, "showMeetingDetail")

    assert 'const detail = await loadMeetingDetail(meeting);' in show_meeting_detail
    assert 'const panel = document.getElementById("detail");' in show_meeting_detail
    assert 'if (stateName === "completed") {\n        openDetail(detail, { scrollTop: state.navDetail?.scroll_top });' not in show_meeting_detail
    assert 'if (panel?.classList.contains("is-open") && panel.getAttribute("data-detail-session-id") === meetingId) {\n        openDetail(detail, { scrollTop: state.navDetail?.scroll_top });' in show_meeting_detail
    assert show_meeting_detail.index('const detail = await loadMeetingDetail(meeting);') < show_meeting_detail.index('panel?.classList.contains("is-open")')


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
    detail_content = css_block(styles, ".detail-content")
    detail_body = css_block(styles, ".detail-content-inner")

    assert "--light-shell-column-max: 520px;" in detail_shell
    assert "--light-shell-column-padding: 20px;" in detail_shell
    assert "padding-bottom: var(--safe-area-bottom-pad);" in detail_shell
    assert "overflow-x: hidden;" in detail_shell
    assert "overflow-y: auto;" in detail_content
    assert "touch-action: pan-y;" in detail_content
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
    universal_note_descriptor = function_block(app, "universalNoteFeedTileDescriptor")
    flat_feed_surface = function_block(app, "isUniversalFlatFeedSurface")
    render_universal_page = function_block(app, "renderUniversalFeedPage")
    render_universal_section = function_block(app, "renderUniversalFeedSection")
    render_universal_tile = function_block(app, "renderUniversalFeedTile")
    light_notes_section_header = function_block(app, "lightNotesSectionHeader")
    note_timestamp = function_block(app, "noteContentUpdatedAtMs")
    note_timestamp_label = function_block(app, "noteTimestampLabel")
    note_source = function_block(app, "noteSourceLabel")
    note_meta = function_block(app, "noteMetaLine")
    patch_workspace_record = function_block(app, "patchWorkspaceRecord")
    toggle_note_pin = function_block(app, "toggleNotePin")
    note_row = function_block(app, "lightNoteRow")
    note_detail = function_block(app, "lightNoteDetailPage")
    light_page = function_block(app, "lightPage")
    sync_html_detail_frame_height = function_block(app, "syncHtmlDetailFrameHeight")
    install_html_detail_frame_sizing = function_block(app, "installHtmlDetailFrameSizing")
    light_html_document = function_block(app, "lightHtmlDocument")
    feed_block = css_block(styles, ".feed")
    header_block = css_block(styles, ".light-page-header-shell")
    notes_feed_block = css_block(styles, ".light-notes-feed")
    notes_section_header_block = css_block(styles, ".light-notes-section-header")
    note_row_block = css_block(styles, ".light-note-row")
    note_row_divider_block = css_block(styles, ".light-note-row + .light-note-row")
    note_row_meta_block = css_block(styles, ".light-note-row-meta")
    note_row_context_block = css_block(styles, ".light-note-row-context")
    note_row_time_block = css_block(styles, ".light-note-row-time")
    note_pin_button_block = css_block(styles, ".light-note-pin-button")
    note_pin_icon_block = css_block(styles, ".light-note-pin-button .material-icon")
    detail_html_shared_match = re.search(r"\.light-detail-html-body\.light-html-card,\s*\.light-detail-html-body\.light-html-empty\s*\{(?P<body>.*?)\n\}", styles, re.S)
    assert detail_html_shared_match, "Missing shared detail HTML body block"
    detail_html_shared_block = detail_html_shared_match.group("body")
    detail_html_card_block = css_block(styles, ".light-detail-html-body.light-html-card")
    detail_html_empty_block = css_block(styles, ".light-detail-html-body.light-html-empty")
    html_detail_page_block = css_block(styles, ".light-page.light-html-detail-page")
    html_detail_page_children_block = css_block(styles, ".light-html-detail-page > :not(.light-page-header-shell)")
    html_detail_document_block = css_block(styles, ".light-html-detail-page.light-document-page")
    html_detail_stage_block = css_block(styles, ".light-html-stage")
    html_detail_frame_block = css_block(styles, ".light-html-detail-page .light-detail-html-body.light-html-card .light-html-frame")

    assert "note?.content_updated_at_ms" in note_timestamp
    assert "note?.created_at_ms" in note_timestamp
    assert "note?.updated_at_ms" in note_timestamp
    assert 'const UNIVERSAL_FLAT_FEED_SURFACES = new Set(["notes", "meeting-notes", "reminders", "projects", "inbox", "meetings"]);' in app
    assert "return UNIVERSAL_FLAT_FEED_SURFACES.has(surfaceKey);" in flat_feed_surface
    assert "notesSectionsExpanded: { pinned: true, recent: true }," in app
    assert "return renderUniversalFeedPage({" in light_notes
    assert 'surface: "notes",' in light_notes
    assert 'pageClassName: "light-notes-page",' in light_notes
    assert 'surfaceClassName: "light-notes-feed",' in light_notes
    assert "const sections = [];" in light_notes
    assert 'sections.push(lightNotesSection("Pinned", "pinned", pinned));' in light_notes
    assert 'sections.push(lightNotesSection("Recent", "recent", notes.filter(note => !note.pinned)));' in light_notes
    assert "return {" in light_notes_section
    assert "key: sectionKey," in light_notes_section
    assert "label: title," in light_notes_section
    assert "count: notes.length," in light_notes_section
    assert "collapsible: true," in light_notes_section
    assert "expanded: noteSectionExpanded(sectionKey)," in light_notes_section
    assert "emptyState: null," in light_notes_section
    assert "items: notes.map(note => universalNoteFeedTileDescriptor(note, sectionKey))" in light_notes_section
    assert 'renderMode: "flat",' in universal_note_descriptor
    assert 'const surfaceKey = String(options.surface || "").trim().toLowerCase();' in render_universal_page
    assert "const isFlatFeed = isUniversalFlatFeedSurface(surfaceKey);" in render_universal_page
    assert 'page.dataset.feedSurface = surfaceKey;' in render_universal_page
    assert 'surface.dataset.feedSurface = surfaceKey;' in render_universal_page
    assert 'page.classList.add("is-flat-feed");' in render_universal_page
    assert 'surface.classList.add("is-flat-feed");' in render_universal_page
    assert 'if (descriptor.collapsible && descriptor.surface === "notes") {' in render_universal_section
    assert 'if (isUniversalFlatFeedSurface(descriptor.surface)) {' in render_universal_section
    assert 'section.classList.add("is-flat-feed");' in render_universal_section
    assert "const body = el(\"div\", `${listClassName} light-feed-section-body light-feed-list`.trim());" in render_universal_section
    assert 'body.classList.add("is-flat-feed");' in render_universal_section
    assert "body.hidden = descriptor.collapsible && !descriptor.expanded;" in render_universal_section
    assert 'body.append(...descriptor.items.map(item => renderUniversalFeedTile(item)));' in render_universal_section
    assert 'return lightNoteRow(descriptor.meta?.note || null);' in render_universal_tile
    assert 'const button = el("button", "light-feed-section-header light-notes-section-header");' in light_notes_section_header
    assert "button.type = \"button\";" in light_notes_section_header
    assert "button.dataset.notesSection = sectionKey;" in light_notes_section_header
    assert 'button.setAttribute("aria-expanded", String(expanded));' in light_notes_section_header
    assert 'button.setAttribute("aria-controls", controlsId);' in light_notes_section_header
    assert 'iconSvg(expanded ? "expand_more" : "chevron_right")' in light_notes_section_header
    assert "event.stopPropagation();" in light_notes_section_header

    assert "return workspaceTimestamp(noteContentUpdatedAtMs(note));" in note_timestamp_label
    assert 'const raw = String(note?.metadata?.context || "").trim();' in note_source
    assert 'normalized === "notes"' in note_source
    assert 'normalized === "all notes"' in note_source
    assert 'return {' in note_meta
    assert "source: noteSourceLabel(note)" in note_meta
    assert "timestamp: noteTimestampLabel(note)" in note_meta
    assert 'const row = el("div", "light-feed-row light-note-row");' in note_row
    assert 'row.setAttribute("role", "button");' in note_row
    assert "row.tabIndex = 0;" in note_row
    assert 'row.dataset.notePinned = String(Boolean(note.pinned));' in note_row
    assert 'row.dataset.noteHasSource = String(Boolean(meta.source));' in note_row
    assert "row.append(lightSmallIcon(" not in note_row
    assert 'const meta = noteMetaLine(note);' in note_row
    assert 'note.pinned ? `Pinned${DOT}` : ""' not in note_row
    assert 'const copy = el("span", "light-note-feed-copy");' in note_row
    assert 'copy.append(el("strong", "", note.title || "Untitled note"));' in note_row
    assert "light-note-summary" not in note_row
    assert 'const metaRow = el("span", "light-note-row-meta");' in note_row
    assert "if (meta.source) {" in note_row
    assert 'metaRow.append(el("span", "light-note-row-context", meta.source));' in note_row
    assert 'metaRow.classList.add("is-time-only");' in note_row
    assert 'metaRow.append(el("span", "light-note-row-time", meta.timestamp));' in note_row
    assert 'const pin = el("button", "light-note-pin-button");' in note_row
    assert 'pin.type = "button";' in note_row
    assert 'pin.dataset.notePinned = String(Boolean(note.pinned));' in note_row
    assert 'pin.setAttribute("aria-label", note.pinned ? "Unpin note" : "Pin note");' in note_row
    assert 'pin.addEventListener("click", event => {' in note_row
    assert "event.preventDefault();" in note_row
    assert "event.stopPropagation();" in note_row
    assert "void toggleNotePin(note);" in note_row
    assert 'pin.innerHTML = iconSvg("pin", { filled: Boolean(note.pinned) });' in note_row
    assert "row.append(copy, pin);" in note_row
    assert 'return lightPage("Note", { subtitle: "Note not found.", detail: true });' in note_detail
    assert 'const page = lightPage(note.title || "Untitled note", { detail: true, htmlDetail: true });' in note_detail
    assert 'page.classList.add("light-document-page", "light-note-document", "light-note-detail-page");' in note_detail
    assert "lightDocumentEyebrow(" not in note_detail
    assert 'el("h1", "", note.title)' not in note_detail
    assert 'el("p", "light-note-body", note.summary || "")' not in note_detail
    assert 'page.append(lightHtmlDocument(note, "No generated note page yet.", {' in note_detail
    assert "untitledFallback: true," in note_detail
    assert 'className: "light-detail-html-body light-note-detail-html-body",' in note_detail
    assert "fullBleed: true," in note_detail
    assert 'revealOnLoad: "note",' in note_detail
    assert "noteFlashDebug: true" in note_detail
    assert "if (options.htmlDetail) {" in light_page
    assert 'page.classList.add("light-html-detail-page");' in light_page
    assert "frame.contentDocument.documentElement" in sync_html_detail_frame_height
    assert "frame.contentDocument.body" in sync_html_detail_frame_height
    assert 'frame.style.height = `${height}px`;' in sync_html_detail_frame_height
    assert "ResizeObserver" in install_html_detail_frame_sizing
    assert 'window.addEventListener("resize", schedule);' in install_html_detail_frame_sizing
    assert 'frame.addEventListener("load", bind);' in install_html_detail_frame_sizing
    assert 'frame.setAttribute("sandbox", "allow-same-origin");' in light_html_document
    assert "installHtmlDetailFrameSizing(frame);" in light_html_document
    assert "const fullBleed = Boolean(options && options.fullBleed);" in light_html_document
    assert 'const revealOnLoad = String(options && options.revealOnLoad || "").trim().toLowerCase();' in light_html_document
    assert 'const noteRevealOnLoad = revealOnLoad === "note";' in light_html_document
    assert "light-html-stage" in light_html_document
    assert 'wrap.setAttribute("data-html-frame-state", "loading");' in light_html_document
    assert 'wrap.setAttribute("aria-busy", "true");' in light_html_document
    assert 'frame.style.visibility = "hidden";' in light_html_document

    assert 'return workspaceApiRequest(`/api/workspace/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,' in patch_workspace_record
    assert 'method: "PATCH",' in patch_workspace_record
    assert "const nextPinned = !Boolean(note.pinned);" in toggle_note_pin
    assert 'setNotesSectionExpanded(nextPinned ? "pinned" : "recent", true);' in toggle_note_pin
    assert 'await patchWorkspaceRecord("notes", noteId, { pinned: nextPinned });' in toggle_note_pin
    assert 'await loadWorkspaceCollection("notes", { render: true, force: true });' in toggle_note_pin
    assert "showToast(error.message);" in toggle_note_pin
    assert "overflow-x: hidden;" in feed_block
    assert "overscroll-behavior-x: none;" in feed_block
    assert "width: calc(100% + (var(--app-shell-side-pad) * 2));" not in header_block
    assert "margin-left: calc(-1 * var(--app-shell-side-pad));" not in header_block
    assert "margin-right: calc(-1 * var(--app-shell-side-pad));" not in header_block

    assert "min-height: 74px;" in note_row_block
    assert "padding: 12px 0;" in note_row_block
    assert "grid-template-columns: minmax(0, 1fr) auto;" in note_row_block
    assert "display: flex;" in notes_feed_block
    assert "flex-direction: column;" in notes_feed_block
    assert "width: 100%;" in notes_section_header_block
    assert "background: transparent;" in notes_section_header_block
    assert "justify-content: space-between;" in notes_section_header_block
    assert "border-top:" in note_row_divider_block
    assert "display: flex;" in note_row_meta_block
    assert "gap: 10px;" in note_row_meta_block
    assert "overflow: hidden;" in note_row_context_block
    assert "text-overflow: ellipsis;" in note_row_context_block
    assert "margin-left: auto;" in note_row_time_block
    assert "white-space: nowrap;" in note_row_time_block
    assert "width: 36px;" in note_pin_button_block
    assert "height: 36px;" in note_pin_button_block
    assert "background: transparent;" in note_pin_button_block
    assert "border: 0;" in note_pin_button_block
    assert "width: 16px;" in note_pin_icon_block
    assert "height: 16px;" in note_pin_icon_block
    assert "width: 100%;" in detail_html_shared_block
    assert "margin-left: 0;" in detail_html_shared_block
    assert "margin-right: 0;" in detail_html_shared_block
    assert "calc(100% + 40px)" not in detail_html_shared_block
    assert "margin-left: -20px;" not in detail_html_shared_block
    assert "width: 100%;" in detail_html_empty_block
    assert "--light-note-detail-document-bg: #ffffff;" in styles
    assert '.app-shell[data-theme="dark"] .light-note-detail-page {' in styles
    assert "--light-note-detail-document-bg: #08111c;" in styles
    assert ".light-note-detail-page {" in styles
    assert "background: var(--light-note-detail-document-bg);" in styles
    assert '.light-note-detail-html-body[data-html-frame-state="loading"] {' in styles
    assert '.light-note-detail-html-body .light-html-frame {' in styles
    assert "padding-left: 0;" in styles
    assert "padding-right: 0;" in styles
    assert "gap: 0;" in html_detail_page_block
    assert "max-width: 100%;" in html_detail_page_children_block
    assert "margin: 0;" in html_detail_page_children_block
    assert "padding: 0;" in html_detail_page_children_block
    assert "gap: 0;" in html_detail_document_block
    assert "padding-bottom: var(--safe-area-bottom);" in html_detail_document_block
    assert "background: transparent;" in html_detail_stage_block
    assert "border: 0;" in html_detail_stage_block
    assert "border-radius: 0;" in html_detail_stage_block
    assert "box-shadow: none;" in html_detail_stage_block
    assert "overflow: hidden;" in html_detail_frame_block
    assert "calc(var(--viewport-h) - var(--light-page-header-offset) - var(--safe-area-bottom))" in html_detail_frame_block
    assert "height: 36px;" in note_pin_button_block
    assert "background: transparent;" in note_pin_button_block
    assert "border: 0;" in note_pin_button_block
    assert "border-radius: 0;" in note_pin_button_block
    assert "box-shadow: none;" in note_pin_button_block
    assert "width: 16px;" in note_pin_icon_block
    assert "height: 16px;" in note_pin_icon_block
    assert '.light-note-pin-button[data-note-pinned="true"]' in styles
    assert app.count("lightHtmlDocument(") == 2


def test_workspace_detail_routes_use_notes_only_rich_content_model() -> None:
    app = read("app.js")
    styles = read("styles.css")

    workspace_html = function_block(app, "workspaceHtml")
    linked_entries = function_block(app, "workspaceLinkedEntries")
    linked_feed_row = function_block(app, "lightLinkedRecordFeedRow")
    linked_rows = function_block(app, "workspaceLinkedRows")
    linked_notes = function_block(app, "lightLinkedNotesSection")
    linked_record_section = function_block(app, "lightLinkedRecordSection")
    contact_detail = function_block(app, "lightContactDetailPage")
    contact_detail_sync = function_block(app, "syncContactDetailEditor")
    feed_detail = function_block(app, "lightFeedDetailPage")
    meeting_note_detail = function_block(app, "lightMeetingNoteDetailPage")
    meeting_note_support = function_block(app, "ensureMeetingNoteSupportingCollections")
    meeting_note_details = function_block(app, "lightMeetingNoteDetailsSection")
    meeting_note_who_row = function_block(app, "lightMeetingNoteWhoRow")
    meeting_note_attendees = function_block(app, "meetingNoteAttendeeEntries")
    meeting_note_connected_detail = function_block(app, "meetingNoteConnectedDetail")
    project_detail = function_block(app, "lightProjectDetailPage")
    graph_detail = function_block(app, "lightGraphDetailPage")

    assert 'return String(record.html || "");' in workspace_html
    assert "loadWorkspaceAsset" not in app
    assert "workspace.assets" not in app
    assert "const includeKinds =" in linked_entries
    assert "const excludeKinds = new Set(" in linked_entries
    assert "const dedupeTargets = options.dedupeTargets === true;" in linked_entries
    assert "const seenTargets = dedupeTargets ? new Set() : null;" in linked_entries
    assert 'if ((includeKinds && !includeKinds.has(normalizedKind)) || excludeKinds.has(normalizedKind)) {' in linked_entries
    assert 'return workspaceLinkedEntries(record, options).map(entry => {' in linked_rows
    assert 'includeKinds: ["note"],' in linked_notes
    assert 'valueResolver: ({ related, relation }) => String(related?.summary || relation || "Note").trim() || "Note"' in linked_notes
    assert "const showChips = options.showChips !== false;" in linked_feed_row
    assert "const showChevron = options.showChevron !== false;" in linked_feed_row
    assert 'const flatFeed = String(options.variant || "").trim().toLowerCase() === "flat";' in linked_feed_row
    assert 'showChips ? "" : "is-no-chips",' in linked_feed_row
    assert 'showChevron ? "" : "is-no-chevron",' in linked_feed_row
    assert 'flatFeed ? "is-flat-feed" : "",' in linked_feed_row
    assert 'typeof options.detailResolver === "function"' in linked_feed_row
    assert "if (showChips) {" in linked_feed_row
    assert 'if (isInteractive && showChevron) {' in linked_feed_row
    assert 'const notes = lightLinkedNotesSection(contact);' not in contact_detail
    assert 'const linkedRows = lightLinkedRecordRows(contact, { excludeKinds: ["note"] });' not in contact_detail
    assert 'const connected = el("div", "light-contact-detail-connected");' in contact_detail
    assert "refs.connected.replaceChildren(lightLinkedRecordSection(contact, {" in contact_detail_sync
    assert 'title: "Connected"' in contact_detail_sync
    assert "showWhenEmpty: true" in contact_detail_sync
    assert 'showChips: false,' in contact_detail_sync
    assert 'showChevron: false,' in contact_detail_sync
    assert 'variant: "flat",' in contact_detail_sync
    assert 'fromRoute: "contact-detail"' in contact_detail_sync
    assert "const title = options.title || \"Linked records\";" in linked_record_section
    assert "const showWhenEmpty = options.showWhenEmpty === true;" in linked_record_section
    assert 'const flatFeed = String(options.variant || "").trim().toLowerCase() === "flat";' in linked_record_section
    assert "const entries = Array.isArray(options.entries)" in linked_record_section
    assert 'connectedRecordEntries(options.entries, {' in linked_record_section
    assert ': workspaceLinkedEntries(record, {' in linked_record_section
    assert "dedupeTargets: options.dedupeTargets === true," in linked_record_section
    assert "if (flatFeed) {" in linked_record_section
    assert 'section.classList.add("is-flat-feed");' in linked_record_section
    assert 'body.classList.add("light-card", "is-flat-feed");' in linked_record_section
    assert "detailResolver: typeof options.detailResolver === \"function\" ? options.detailResolver : null," in linked_record_section
    assert "showChips: options.showChips !== false," in linked_record_section
    assert "showChevron: options.showChevron !== false," in linked_record_section
    assert 'variant: flatFeed ? "flat" : "",' in linked_record_section
    assert "lightHtmlDocument(contact" not in contact_detail
    assert "lightGraphDetailPage(meeting" not in meeting_note_detail
    assert 'page.classList.add("light-document-page", "light-meeting-note-detail-page");' in meeting_note_detail
    assert 'page.append(el("p", "light-event-summary-copy light-meeting-note-summary", summary));' in meeting_note_detail
    assert "page.append(lightMeetingNoteDetailsSection(meeting));" in meeting_note_detail
    assert "page.append(lightLinkedRecordSection(meeting, {" in meeting_note_detail
    assert 'title: "Connected"' in meeting_note_detail
    assert 'excludeKinds: ["contact"]' in meeting_note_detail
    assert "showWhenEmpty: true" in meeting_note_detail
    assert "dedupeTargets: true," in meeting_note_detail
    assert "showChips: false," in meeting_note_detail
    assert 'showChevron: false,' in meeting_note_detail
    assert 'variant: "flat",' in meeting_note_detail
    assert "detailResolver: meetingNoteConnectedDetail," in meeting_note_detail
    assert "Graph meeting" not in meeting_note_detail
    assert "lightLinkedNotesSection(meeting)" not in meeting_note_detail
    assert 'lightInfoSection("Linked records"' not in meeting_note_detail
    assert 'lightInfoSection("Context"' not in meeting_note_detail
    assert "lightMeetingNoteWhoSection(meeting)" not in meeting_note_detail
    assert "ensureLinkedCollections(meeting);" in meeting_note_support
    assert 'void loadWorkspaceCollection("contacts", { render: true });' in meeting_note_support
    assert "workspaceCollectionForKind(sourceKind)" in meeting_note_support
    assert "page.append(lightSectionTitle(\"Details\"));" not in meeting_note_detail
    assert 'section.append(lightSectionTitle("Details"));' in meeting_note_details
    assert 'card.append(lightMeetingNoteDetailRow("when", "When", meetingTimeLabel(meeting)));' in meeting_note_details
    assert 'const who = lightMeetingNoteWhoRow(meeting);' in meeting_note_details
    assert "if (who) {" in meeting_note_details
    assert "card.append(who);" in meeting_note_details
    assert '"Topics"' not in meeting_note_details
    assert '"Source"' not in meeting_note_details
    assert "const contact = workspaceContactByName(label);" in meeting_note_attendees
    assert "label: contact ? calendarContactChipLabel(contact) : label," in meeting_note_attendees
    assert "contact: contact || null," in meeting_note_attendees
    assert 'const row = el("div", "light-calendar-detail-row light-meeting-note-detail-row");' in meeting_note_who_row
    assert 'const value = el("div", "light-calendar-detail-row-value light-calendar-detail-people");' in meeting_note_who_row
    assert 'const cloud = el("div", "light-chip-cloud light-attendee-chip-cloud");' in meeting_note_who_row
    assert 'lightCalendarContactChip(entry, { fromRoute: "meeting-note-detail" })' in meeting_note_who_row
    assert "lightGuestAttendeeChip(entry.label)" in meeting_note_who_row
    assert 'if (kind === "calendar_event") {' in meeting_note_connected_detail
    assert "return calendarConnectedTileTimestampLabel(related);" in meeting_note_connected_detail
    assert 'const timestamp = kind === "note"' in meeting_note_connected_detail
    assert "linkedRecordRecencyMs(kind, related)" in meeting_note_connected_detail
    assert 'const notes = lightLinkedNotesSection(item);' in feed_detail
    assert 'const relatedRows = lightLinkedRecordRows(item, { excludeKinds: ["note"] });' in feed_detail
    assert "lightHtmlDocument(item" not in feed_detail
    assert '["Artifacts", "attachment", projectAssets(project)]' not in project_detail
    assert "lightHtmlDocument(project" not in project_detail
    assert "lightDetailHero(" not in project_detail
    assert "lightChipCloud(" not in project_detail
    assert "light-project-section-grid" not in project_detail
    assert 'page.classList.add("light-project-detail-page");' in project_detail
    assert "page.append(lightLinkedRecordSection(project, {" in project_detail
    assert 'title: "Connected"' in project_detail
    assert "showWhenEmpty: true" in project_detail
    assert 'fromRoute: "project-detail"' in project_detail
    assert "dedupeTargets: true," in project_detail
    assert "showChips: false," in project_detail
    assert 'showChevron: false,' in project_detail
    assert 'variant: "flat",' in project_detail
    assert "detailResolver: projectConnectedDetail," in project_detail
    assert "function projectConnectedDetail(entry) {" in app
    assert "return calendarConnectedTileTimestampLabel(related);" in function_block(app, "projectConnectedDetail")
    assert 'const notes = lightLinkedNotesSection(record);' in graph_detail
    assert 'const linkedRows = lightLinkedRecordRows(record, { excludeKinds: ["note"] });' in graph_detail
    assert "lightHtmlDocument(record" not in graph_detail
    assert ".light-meeting-note-detail-row.is-clickable {" in styles
    assert ".light-meeting-note-summary {" in styles
    assert ".light-linked-record-feed-row.is-no-chevron {" in styles
    assert "grid-template-columns: 48px minmax(0, 1fr) auto;" in styles
    assert ".light-linked-record-feed-row.is-no-chips.is-no-chevron {" in styles
    assert "grid-template-columns: 48px minmax(0, 1fr);" in styles


def test_note_flash_debug_surface_and_browser_delay_contracts_stay_notes_only() -> None:
    app = read("app.js")
    render = function_block(app, "render")
    light_note_row = function_block(app, "lightNoteRow")
    light_note_detail = function_block(app, "lightNoteDetailPage")
    light_navigate = function_block(app, "lightNavigate")
    light_html_document = function_block(app, "lightHtmlDocument")
    resolve_defaults = function_block(app, "resolveNoteFlashDebugDefaults")
    debug_snapshot = function_block(app, "noteFlashDebugSnapshot")

    assert 'const NOTE_FLASH_DEBUG_TRACE_LIMIT = 256;' in app
    assert 'const NOTE_FLASH_DEBUG_FAIL_OPEN_MS = 1500;' in app
    assert 'const NOTE_FLASH_DEBUG_REQUIRED_PHASES = Object.freeze([' in app
    assert '"note_row_pointerdown",' in app
    assert '"note_row_click",' in app
    assert '"lightNavigate_start",' in app
    assert '"lightNavigate_state_set",' in app
    assert '"render_start",' in app
    assert '"note_detail_page_created",' in app
    assert '"note_detail_wrapper_created",' in app
    assert '"note_iframe_srcdoc_assigned",' in app
    assert '"note_iframe_load",' in app
    assert '"note_iframe_ready",' in app
    assert '"note_iframe_fail_open",' in app
    assert '"render_end"' in app
    assert 'window.__puckyNoteFlashDebug = {' in app
    assert 'schema: "pucky.note_flash_debug.v1",' in app
    assert 'return noteFlashDebugTrace.slice();' in app
    assert "return noteFlashDebugSnapshot();" in app
    assert 'params.get("debug_note_flash") === "1"' in resolve_defaults
    assert 'parseDebugDelayMs(params.get("debug_note_flash_delay_route_ms"))' in resolve_defaults
    assert 'parseDebugDelayMs(params.get("debug_note_flash_delay_iframe_ms"))' in resolve_defaults
    assert 'noteFlashDebugRecord("render_start");' in render
    assert 'noteFlashDebugRecord("render_end");' in render
    assert 'noteFlashDebugRecord("note_row_pointerdown",' in light_note_row
    assert 'noteFlashDebugRecord("note_row_click",' in light_note_row
    assert 'noteFlashDebugRecord("note_detail_page_created",' in light_note_detail
    assert "noteFlashDebug: true" in light_note_detail
    assert 'const routeDelayMs = noteFlashDebugEnabled() && nextRoute === "note-detail"' in light_navigate
    assert 'window.setTimeout(() => commitNavigation("light_app_click"), routeDelayMs);' in light_navigate
    assert 'const noteFlashDebug = Boolean(options && options.noteFlashDebug && noteFlashDebugEnabled());' in light_html_document
    assert 'noteFlashDebugRecord("note_detail_wrapper_created",' in light_html_document
    assert 'noteFlashDebugRecord("note_iframe_srcdoc_assigned",' in light_html_document
    assert 'noteFlashDebugRecord("note_iframe_load",' in light_html_document
    assert 'markReady("note_iframe_ready", "load_event");' in light_html_document
    assert 'markReady("note_iframe_fail_open", "fail_open_timeout");' in light_html_document
    assert "let srcdocAssigned = false;" in light_html_document
    assert "if (!srcdocAssigned) {" in light_html_document
    assert "srcdocAssigned = true;" in light_html_document
    assert 'window.setTimeout(assignSrcdoc, iframeDelayMs);' in light_html_document
    assert 'frame.srcdoc = normalizedWorkspaceHtmlDocument(html);' in light_html_document
    assert 'required_phases: NOTE_FLASH_DEBUG_REQUIRED_PHASES.slice()' in debug_snapshot
    assert 'const wrapper = detail?.querySelector(".light-detail-html-body");' in app


def test_tasks_drop_filter_selector_and_render_select_archive_controls() -> None:
    app = read("app.js")
    styles = read("styles.css")

    workspace_page = function_block(app, "lightTaskWorkspacePage")
    tasks_page = function_block(app, "lightTasksPage")
    render_task_groups = function_block(app, "renderTaskGroups")

    assert "function lightTaskCountLine" not in app
    assert "lightTaskCountLine()," not in workspace_page
    assert "lightTaskCountLine()" not in tasks_page
    assert "function lightTaskFilters" not in app
    assert "taskFilter:" not in app
    assert "function taskStatusFilterSelectorOptions(counts)" not in app
    assert "function currentTaskFilterChoice()" not in app
    assert "function taskStatusCounts()" not in app
    assert "listPane.append(lightTaskBulkActionBar());" in workspace_page
    assert "page.append(lightTaskBulkActionBar());" in tasks_page
    assert "taskPageTitle()" in workspace_page
    assert "taskPageTitle()" in tasks_page
    assert "taskPageHeaderAction()" in workspace_page
    assert "taskPageHeaderAction()" in tasks_page
    assert "function taskSelectionModeActive()" in app
    assert "function lightTaskBulkActionBar()" in app
    assert "function taskPageHeaderAction()" in app
    assert "function taskPageTitle()" in app
    assert render_task_groups.index('["do", "Today"]') < render_task_groups.index('["overdue", "Overdue"]')
    assert render_task_groups.index('["overdue", "Overdue"]') < render_task_groups.index('["soon", "Upcoming"]')
    assert ".light-task-counts" not in styles
    assert ".light-task-filter-strip" not in styles
    assert ".light-task-filter-button" not in styles
    assert ".light-task-filter-button-chevron" not in styles
    assert ".light-task-filter-button-icon" not in styles
    assert ".light-task-bulk-bar" in styles
    assert ".light-task-selection-trigger" in styles
    assert ".light-task-detail-action-trigger" in styles


def test_tasks_use_compact_header_checklist_first_connected_rows_single_status_trigger_and_reset_scroll_on_open() -> None:
    app = read("app.js")
    tasks_page = function_block(app, "lightTasksPage")
    task_workspace_page = function_block(app, "lightTaskWorkspacePage")
    render_task_groups = function_block(app, "renderTaskGroups")
    styles = read("styles.css")

    task_group = function_block(app, "lightTaskGroup")
    task_detail_card = function_block(app, "lightTaskDetailCard")
    task_detail_surface = function_block(app, "lightTaskDetailSurface")
    task_checklist_section = function_block(app, "lightTaskChecklistSection")
    toggle_task_checklist_item = function_block(app, "toggleTaskChecklistItem")
    task_connected_rows = function_block(app, "taskConnectedRows")
    task_connected_section = function_block(app, "lightTaskConnectedSection")
    task_selection_control = function_block(app, "lightTaskSelectionControl")
    task_bulk_action_bar = function_block(app, "lightTaskBulkActionBar")
    task_detail_action_button = function_block(app, "lightTaskDetailActionButton")
    light_info_row = function_block(app, "lightInfoRow")
    light_navigate = function_block(app, "lightNavigate")
    reset_scroll = function_block(app, "resetLightRouteScroll")
    workspace_linked_entries = function_block(app, "workspaceLinkedEntries")
    linked_record_recency = function_block(app, "linkedRecordRecencyMs")
    assert 'const WORKSPACE_TASK_STALE_VISIBLE_MS = 15000;' in app
    assert '&& (state.route === "tasks" || state.route === "task-detail")' in app
    assert '&& workspaceBucketNeedsRefresh("tasks", WORKSPACE_TASK_STALE_VISIBLE_MS)) {' in app
    assert 'recordPerfPollTick("workspace_tasks_visible");' in app
    assert 'reason: "visible_stale"' in app

    assert 'el("span", "light-task-row-summary"' not in task_group
    assert "function taskRowSummary" not in app
    assert "function taskOwners(task)" not in app
    assert "function taskPrimaryOwner(task)" not in app
    assert "function taskCreatedBy(task)" not in app
    assert "function taskCreatedByTarget(task)" not in app
    assert "function ensureTaskPeopleContacts(task)" not in app
    assert "function ensureTaskPeopleContactsLoaded(tasks)" not in app
    assert "function taskDetailRows(task)" not in app
    assert "function lightTaskPeopleSection(task)" not in app
    assert "explicitOwners" not in app
    assert "function lightTaskRowStatusTrigger(task)" in app
    assert 'const leading = selectionMode ? lightTaskSelectionControl(task) : lightTaskRowStatusTrigger(task);' in task_group
    assert 'openTaskStatusSelector(task, "list");' in function_block(app, "lightTaskRowStatusTrigger")
    assert 'const main = el("button", "light-task-row-main");' in task_group
    assert 'ensureTaskPeopleContactsLoaded(workspaceItems("tasks"));' not in tasks_page
    assert 'ensureTaskPeopleContactsLoaded(workspaceItems("tasks"));' not in task_workspace_page
    assert 'ensureTaskPeopleContactsLoaded(workspaceItems("tasks"));' not in render_task_groups
    assert 'return workspaceLinkedEntries(record, options).map(entry => {' in function_block(app, "workspaceLinkedRows")
    assert 'const currentKind = String(options.currentKind || record?.kind || "");' in workspace_linked_entries
    assert 'label,' in workspace_linked_entries
    assert 'relation,' in workspace_linked_entries
    assert 'target: workspaceTargetForKind(relatedKind, related?.id || relatedId),' in workspace_linked_entries
    assert 'if (kind === "note") {' in linked_record_recency
    assert 'return noteContentUpdatedAtMs(related);' in linked_record_recency
    assert 'workspaceLinkedEntries(task, { currentKind: "task" }).forEach(entry => {' in task_connected_rows
    assert 'const recencyMs = linkedRecordRecencyMs(entry.relatedKind, entry.related);' in task_connected_rows
    assert 'value = entry.relatedKind === "note"' in task_connected_rows
    assert 'dataset: {' in task_connected_rows
    assert 'taskConnectedKind: entry.relatedKind,' in task_connected_rows
    assert 'taskConnectedRecencyMs: String(recencyMs || 0),' in task_connected_rows
    assert 'rows.sort((left, right) => {' in task_connected_rows
    assert 'const recencyDelta = Number(right.recencyMs || 0) - Number(left.recencyMs || 0);' in task_connected_rows
    assert 'return lightInfoSection("Connected", rows, { showTrailingChevron: false });' in task_connected_section
    assert "lightRecordChip(" not in task_connected_section
    assert 'connectedRecordValue(entry.relatedKind, entry.related, entry.relation, { preferSummary: true })' in task_connected_rows
    assert "lightHtmlDocument(task" not in task_detail_surface
    assert 'const connected = lightTaskConnectedSection(task);' in task_detail_surface
    assert "surface.append(connected);" in task_detail_surface
    assert "lightHtmlDocument(task" not in task_detail_surface
    assert "ensureTaskPeopleContacts(task)" not in task_detail_surface
    assert 'lightInfoSection("Details", taskDetailRows(task))' not in task_detail_surface
    assert "lightTaskPeopleSection(task)" not in task_detail_surface
    assert "taskMutationPending: {}," in app
    assert "function updateTaskStatus(taskId, nextStatus)" in app
    assert "function taskMutationPending(taskId, scope)" in app
    assert "function setTaskMutationPending(taskId, scope, pending)" in app
    assert "async function toggleTaskChecklistItem(task, itemId)" in app
    assert "function openTaskStatusSelector(task, source)" in app
    assert "function taskSelectionModeActive()" in app
    assert "function clearTaskSelection()" in app
    assert "function toggleTaskSelection(task)" in app
    assert "async function archiveSelectedTasks()" in app
    assert "async function archiveTask(task, options = {})" in app
    assert "function openTaskActions(task)" in app
    assert 'const row = el("button", item.done ? "light-task-checklist-row is-done" : "light-task-checklist-row");' in task_checklist_section
    assert 'row.type = "button";' in task_checklist_section
    assert 'row.dataset.checklistDone = item.done ? "true" : "false";' in task_checklist_section
    assert 'row.setAttribute("aria-pressed", item.done ? "true" : "false");' in task_checklist_section
    assert 'row.disabled = taskMutationPending(taskRecordId(task), item.id);' in task_checklist_section
    assert 'row.addEventListener("click", event => {' in task_checklist_section
    assert 'void toggleTaskChecklistItem(task, item.id);' in task_checklist_section
    assert 'const previousAllDone = checklist.length > 0 && checklist.every(item => Boolean(item?.done));' in toggle_task_checklist_item
    assert 'const nextAllDone = nextChecklist.length > 0 && nextChecklist.every(item => Boolean(item?.done));' in toggle_task_checklist_item
    assert 'const currentStatus = normalizedTaskStatus(current);' in toggle_task_checklist_item
    assert 'const nextStatus = nextAllDone ? "done" : (previousAllDone ? "in_progress" : "");' in toggle_task_checklist_item
    assert 'const payload = nextStatus ? { checklist: nextChecklist, status: nextStatus } : { checklist: nextChecklist };' in toggle_task_checklist_item
    assert 'const optimisticStatus = nextStatus || currentStatus;' in toggle_task_checklist_item
    assert "status: optimisticStatus," in toggle_task_checklist_item
    assert "function lightTaskStatusControl" not in app
    assert 'const card = el("button", `light-card light-task-detail-card ${taskRowTone(task)}`);' in task_detail_card
    assert 'card.type = "button";' in task_detail_card
    assert 'card.dataset.taskStatusTrigger = "true";' in task_detail_card
    assert 'card.setAttribute("aria-haspopup", "dialog");' in task_detail_card
    assert 'card.setAttribute("aria-label", `Change task status for ${task.title || "task"}. Current status ${taskStatusLabel(current)}.`);' in task_detail_card
    assert 'card.addEventListener("click", event => {' in task_detail_card
    assert 'openTaskStatusSelector(task, "detail-header");' in task_detail_card
    assert 'const statusCircle = el("span", "light-task-status-circle");' in task_detail_card
    assert 'statusCircle.append(el("span", taskCheckCircleClass(task)));' in task_detail_card
    assert "lightTaskStatusControl(task)" not in task_detail_card
    assert 'const createdAt = Number(task?.created_at_ms || 0);' in task_detail_card
    assert 'const completedAt = Number(task?.completed_at_ms || 0);' in task_detail_card
    assert 'const headerMetaPrefix = current === "done" ? "Completed" : "Created";' in task_detail_card
    assert 'const headerMetaAt = current === "done" ? (completedAt > 0 ? completedAt : createdAt) : createdAt;' in task_detail_card
    assert 'if (Number.isFinite(headerMetaAt) && headerMetaAt > 0) {' in task_detail_card
    assert 'copy.append(el("span", "light-task-detail-created", `${headerMetaPrefix} ${taskDateTimeLabel(headerMetaAt, "")}`));' in task_detail_card
    assert 'const selectionMode = taskSelectionModeActive();' in task_group
    assert 'void toggleTaskSelection(task);' in task_group
    assert 'const trigger = el("button", selected ? "light-task-selection-trigger is-selected" : "light-task-selection-trigger");' in task_selection_control
    assert 'bar.append(el("span", "light-task-bulk-count", `${count} selected`));' in task_bulk_action_bar
    assert 'const archive = el("button", "light-task-bulk-archive", "Archive");' in task_bulk_action_bar
    assert 'const actionButton = el("button", "light-task-detail-action-trigger");' in task_detail_action_button
    assert 'actionButton.setAttribute("aria-label", "Task actions");' in task_detail_action_button
    assert 'patchWorkspaceRecord("tasks", taskId, { archived: true })' in app
    assert 'Object.entries(row.dataset).forEach(([key, value]) => {' in light_info_row
    assert 'item.dataset[key] = String(value || "");' in light_info_row
    assert 'row.fromRoute || state.route || ""' in light_info_row
    assert 'row.openOptions || {}' in light_info_row
    assert 'lightTextStack(row.label, row.value)' in light_info_row
    assert "options.showChevron !== false" not in light_info_row
    assert task_detail_surface.index('lightCopySection("Description", description)') < task_detail_surface.index("lightTaskChecklistSection(task)")
    assert task_detail_surface.index("lightTaskChecklistSection(task)") < task_detail_surface.index("lightTaskConnectedSection(task)")
    assert "resetLightRouteScroll();" in light_navigate
    assert "restoreScrollPosition(feed, 0);" in reset_scroll
    assert "window.scrollTo(0, 0);" in reset_scroll
    assert 'markWorkspaceBucketDirty("tasks", { refresh: true, reason: "task_status_update" });' in app
    assert 'markWorkspaceBucketDirty("tasks", { refresh: true, reason: "task_checklist_toggle" });' in app
    assert ".light-task-detail-page .light-detail-html-body" not in styles
    assert ".light-task-detail-surface > .light-task-detail-body" not in styles
    assert ".light-record-chip-icon" in styles
    assert ".light-task-row-status-trigger" in styles
    assert ".light-task-selection-trigger" in styles
    assert ".light-task-status-circle" in styles
    assert ".light-task-status-circle-trigger" not in styles
    assert ".light-task-status-control" not in styles
    assert ".light-task-status-trigger" not in styles
    assert ".light-task-person-row" not in styles
    assert ".light-task-filter-button-icon" not in styles
    assert ".light-task-bulk-bar" in styles
    assert ".light-task-detail-action-trigger" in styles
    assert ".light-task-detail-card" in styles
    assert ".light-task-detail-created" in styles
    assert ".light-task-row:focus-within" not in styles
    assert ".light-task-row-main:focus," in styles
    assert ".light-task-row-main:focus-visible," in styles
    assert ".light-task-row-status-trigger:focus," in styles
    assert ".light-task-row-status-trigger:focus-visible," in styles
    assert ".light-task-detail-card:focus," in styles
    assert ".light-task-detail-card:focus-visible" in styles
    assert "outline: none;" in styles
    assert "box-shadow: none;" in styles
    assert ".light-task-people-card" not in styles
    assert ".light-task-attachment-card" not in styles
    assert ".light-task-chip-cloud" not in styles


def test_reminders_use_active_only_ui_and_hide_row_chips() -> None:
    app = read("app.js")
    styles = read("styles.css")
    reminders_page = function_block(app, "lightRemindersPage")
    reminder_section = function_block(app, "lightReminderListSection")
    reminder_descriptor = function_block(app, "universalReminderFeedTileDescriptor")
    render_universal_tile = function_block(app, "renderUniversalFeedTile")
    reminder_active = function_block(app, "reminderIsActive")
    reminder_is_live = function_block(app, "reminderIsLive")
    reminder_is_now = function_block(app, "reminderIsNow")
    reminder_row = function_block(app, "lightReminderRow")
    reminder_row_end = function_block(app, "lightReminderRowEnd")
    reminder_countdown = function_block(app, "reminderSnoozeCountdown")
    reminder_remaining = function_block(app, "reminderRemainingCompactLabel")
    route_uses_reminder_tick = function_block(app, "routeUsesReminderLiveUiTick")
    reminder_needs_tick = function_block(app, "reminderNeedsLiveUiTick")
    should_tick_reminder_ui = function_block(app, "shouldTickReminderLiveUi")
    reminder_detail = function_block(app, "lightReminderDetailPage")
    reminder_detail_surface = function_block(app, "lightReminderDetailSurface")
    reminder_detail_feed = function_block(app, "lightReminderDetailFeed")
    reminder_detail_card = function_block(app, "lightReminderDetailCard")
    reminder_action_row = function_block(app, "lightReminderActionRow")
    reminder_feed_rows = function_block(app, "reminderDetailFeedRows")
    reminder_linked_note_rows = function_block(app, "reminderDetailLinkedNoteRows")
    reminder_linked_rows = function_block(app, "reminderDetailLinkedRecordRows")
    dismiss_reminder = function_block(app, "dismissReminder")
    mark_reminder_done = function_block(app, "markReminderDone")
    snooze_reminder = function_block(app, "snoozeReminder")
    light_info_row = function_block(app, "lightInfoRow")

    assert 'const SELF_CONTACT_ID = "contact-me";' in app
    assert "const REMINDER_LIVE_UI_TICK_MS = 1000;" in app
    assert "const active = reminders.filter(reminder => reminderIsActive(reminder));" in reminders_page
    assert "const live = active.filter(reminder => reminderIsLive(reminder));" in reminders_page
    assert "const upcoming = active.filter(reminder => !reminderIsLive(reminder));" in reminders_page
    assert "return renderUniversalFeedPage({" in reminders_page
    assert 'surface: "reminders",' in reminders_page
    assert 'pageClassName: "light-graph-page light-reminders-page",' in reminders_page
    assert "const sections = [];" in reminders_page
    assert 'sections.push(lightReminderListSection("Live", live, "live"));' in reminders_page
    assert 'sections.push(lightReminderListSection("Upcoming", upcoming, "upcoming"));' in reminders_page
    assert 'sections.push(lightReminderListSection("Snoozed", snoozed, "snoozed"));' not in reminders_page
    assert "return {" in reminder_section
    assert "key: String(sectionKey || \"\").trim().toLowerCase()," in reminder_section
    assert "label: title," in reminder_section
    assert "count: reminders.length," in reminder_section
    assert "collapsible: false," in reminder_section
    assert "items: reminders.map(reminder => universalReminderFeedTileDescriptor(reminder, sectionKey))" in reminder_section
    assert 'renderMode: "flat",' in reminder_descriptor
    assert "light-reminder-history" not in reminders_page
    assert "&& !reminderIsSentHistory(reminder)" in reminder_active
    assert "if (!reminderIsActive(reminder) || reminderIsSnoozed(reminder)) {" in reminder_is_live
    assert "return reminderIsLive(reminder);" in reminder_is_now
    assert 'return lightReminderRow(descriptor.meta?.reminder || null);' in render_universal_tile
    assert 'flatFeed: descriptor.renderMode === "flat",' in render_universal_tile
    assert 'lightSmallIcon("bell", "reminders")' in reminder_row
    assert "const flatFeed = options.flatFeed === true;" in reminder_row
    assert "const secondaryCopy = reminderListSecondaryCopy(reminder);" in reminder_row
    assert 'copy.append(el("span", "light-reminder-row-summary", secondaryCopy));' in reminder_row
    assert 'const reminderState = reminderIsLive(reminder) ? "live" : (reminderIsSnoozed(reminder) ? "snoozed" : "upcoming");' in reminder_row
    assert 'row.dataset.reminderState = reminderState;' in reminder_row
    assert "lightReminderRowEnd(reminder)" in reminder_row
    assert 'wrap.dataset.reminderCountdown = "true";' in reminder_row_end
    assert 'wrap.dataset.reminderProgress = countdown.progress.toFixed(3);' in reminder_row_end
    assert 'el("span", "light-reminder-countdown-ring")' in reminder_row_end
    assert 'el("span", "light-reminder-countdown-label", countdown.label)' in reminder_row_end
    assert 'return el("span", "light-reminder-time", reminderRowLabel(reminder));' in reminder_row_end
    assert "const totalMs = Math.max(60_000, dueAtMs - startAtMs);" in reminder_countdown
    assert "const remainingMs = Math.max(0, dueAtMs - Number(nowMs || Date.now()));" in reminder_countdown
    assert "const progress = Math.max(0, Math.min(1, 1 - (remainingMs / totalMs)));" in reminder_countdown
    assert 'return `${totalMinutes}m`;' in reminder_remaining
    assert 'return `${hours}h`;' in reminder_remaining
    assert 'return ["home", "reminders", "reminder-detail"].includes(String(route || "").trim());' in route_uses_reminder_tick
    assert "if (!reminderIsActive(reminder)) {" in reminder_needs_tick
    assert "const dueAtMs = Number(reminder?.due_at_ms || 0);" in reminder_needs_tick
    assert "return dueAtMs > nowMs || reminderIsLive(reminder) || reminderIsSnoozed(reminder);" in reminder_needs_tick
    assert 'if (document.visibilityState !== "visible" || !routeUsesReminderLiveUiTick(route)) {' in should_tick_reminder_ui
    assert 'return workspaceItems("reminders").some(reminder => reminderNeedsLiveUiTick(reminder, nowMs));' in should_tick_reminder_ui
    assert 'requestRender("reminder_live_ui_tick");' in app
    assert "light-graph-chip-row" not in reminder_row
    assert 'flatFeed ? "is-flat-feed" : ""' in reminder_row
    assert 'const page = lightPage("Reminder", { detail: true });' in reminder_detail
    assert "page.append(lightReminderDetailSurface(reminder));" in reminder_detail
    assert 'page.append(lightReminderDetailCard(reminder));' not in reminder_detail
    assert 'const feed = lightReminderDetailFeed(reminder);' in reminder_detail_surface
    assert 'surface.append(lightReminderDetailCard(reminder));' in reminder_detail_surface
    assert "const rows = reminderDetailFeedRows(reminder);" in reminder_detail_feed
    assert "if (!rows.length) {" in reminder_detail_feed
    assert "return null;" in reminder_detail_feed
    assert 'card.dataset.reminderDetailFeed = "true";' in reminder_detail_feed
    assert 'rows.forEach(row => card.append(lightInfoRow(row)));' in reminder_detail_feed
    assert "reminderDetailLinkedNoteRows(reminder)" in reminder_feed_rows
    assert "reminderDetailLinkedRecordRows(reminder)" in reminder_feed_rows
    assert "reminderDetailRows(reminder)" not in reminder_feed_rows
    assert "reminderDetailRecipientFeedRows(reminder)" not in reminder_feed_rows
    assert 'includeKinds: ["note"]' in reminder_linked_note_rows
    assert 'excludeKinds: ["note"]' in reminder_linked_rows
    assert '"calendar_event", "task", "meeting_note", "project", "contact", "feed_item"' in reminder_linked_rows
    assert 'el("h1", "", reminder.title)' not in reminder_detail
    assert "if (!reminderIsLive(reminder)) {" in reminder_action_row
    assert 'dataset.reminderAction = "dismiss";' in reminder_action_row
    assert 'dataset.reminderAction = "snooze";' in reminder_action_row
    assert '"Dismiss"' in reminder_action_row
    assert '"Snooze"' in reminder_action_row
    assert '"Done"' not in reminder_action_row
    assert '"Snooze 10 min"' not in reminder_action_row
    assert '"Snooze..."' not in reminder_action_row
    assert "void dismissReminder(reminder);" in reminder_action_row
    assert "void snoozeReminder(reminder, Date.now() + 90_000);" in reminder_action_row
    assert 'el("p", "light-reminder-detail-summary", summary)' in reminder_detail_card
    assert 'card.dataset.reminderState = reminderIsLive(reminder) ? "live" : (reminderIsSnoozed(reminder) ? "snoozed" : "upcoming");' in reminder_detail_card
    assert "const actionRow = lightReminderActionRow(reminder);" in reminder_detail_card
    assert "if (actionRow) {" in reminder_detail_card
    assert "card.append(actionRow);" in reminder_detail_card
    assert "lightReminderStatusRow(reminder)" not in reminder_detail_card
    assert 'page.append(lightInfoSection("Schedule", reminderDetailRows(reminder)));' not in reminder_detail
    assert 'page.append(lightInfoSection("Recipients", recipientRows));' not in reminder_detail
    assert 'lightInfoSection("Channels"' not in reminder_detail
    assert 'const notes = lightLinkedNotesSection(reminder);' not in reminder_detail
    assert 'const linkedRows = lightLinkedRecordRows(reminder, { excludeKinds: ["note"] });' not in reminder_detail
    assert 'page.append(lightInfoSection("Linked records", linkedRows));' not in reminder_detail
    assert "return markReminderDone(reminder);" in dismiss_reminder
    assert "applyReminderMutation(normalizedReminderId, \"done\"" in mark_reminder_done
    assert 'lightNavigate("reminders", { from: "reminder-detail" });' in mark_reminder_done
    assert 'metadata: {' in snooze_reminder
    assert 'snoozed_until_ms: nextDueAtMs,' in snooze_reminder
    assert 'delivery_state: "pending",' in snooze_reminder
    assert 'last_fired_at_ms: 0,' in snooze_reminder
    assert 'last_fired_due_at_ms: 0,' in snooze_reminder
    assert 'last_delivery_error: "",' in snooze_reminder
    assert 'function reminderSnoozePresets(nowMs = Date.now()) {' in app
    assert '"1_hour", label: "1 hour"' in app
    assert '"this_evening", label: "This evening"' in app
    assert '"tomorrow_morning", label: "Tomorrow morning"' in app
    assert 'function reminderSnoozePresetTimestamp(preset, nowMs = Date.now()) {' in app
    assert 'normalizedPreset === "this_evening"' in app
    assert 'normalizedPreset === "tomorrow_morning"' in app
    assert "lightHtmlDocument(reminder" not in reminder_detail
    assert "row?.hideDetail" in light_info_row
    assert 'isInteractive ? el("span", "light-chevron", ">") : el("span", "")' not in light_info_row
    assert ".light-reminder-detail-card" in styles
    assert ".light-reminder-detail-surface" in styles
    assert ".light-reminder-action-row" in styles
    assert ".light-reminder-countdown" in styles
    assert ".light-reminder-countdown-ring" in styles
    assert ".light-reminder-countdown-label" in styles
    assert ".light-reminder-row-summary" in styles
    assert ".light-reminder-detail-feed .light-info-row" in styles
    assert ".light-reminder-channels-section" not in styles
    assert ".light-reminder-status-row" not in styles
    assert ".light-reminder-action-button.is-selector" not in styles
    assert "padding: 22px 18px 18px;" in styles
    assert "grid-template-columns: 36px minmax(0, 1fr);" in styles
    assert "width: 36px;" in styles
    assert "height: 36px;" in styles
    assert "font-size: 21px;" in styles
    assert "@media (max-width: 480px) {" in styles


def test_projects_inbox_and_meetings_join_universal_feed_pipeline_without_rewriting_canonical_cards() -> None:
    app = read("app.js")
    styles = read("styles.css")

    projects_page = function_block(app, "lightProjectsPage")
    project_descriptor = function_block(app, "universalProjectFeedTileDescriptor")
    project_row = function_block(app, "lightProjectRow")
    reply_descriptor = function_block(app, "universalCanonicalReplyFeedTileDescriptor")
    meeting_descriptor = function_block(app, "universalCanonicalMeetingFeedTileDescriptor")
    inbox_page = function_block(app, "lightInboxPage")
    meetings_page = function_block(app, "lightMeetingsPage")
    render_universal_tile = function_block(app, "renderUniversalFeedTile")
    card_view = function_block(app, "cardView")

    assert "function lightProjectRow(" in app
    assert "function lightInboxSection(" in app
    inbox_section = function_block(app, "lightInboxSection")
    assert "function lightMeetingsSection(" in app
    assert "return renderUniversalFeedPage({" in projects_page
    assert 'surface: "projects",' in projects_page
    assert 'items: allProjects().map(project => universalProjectFeedTileDescriptor(project, "projects"))' in projects_page
    assert 'renderMode: "flat",' in project_descriptor
    assert "const flatFeed = options.flatFeed === true;" in project_row
    assert 'flatFeed ? "is-flat-feed" : ""' in project_row
    assert 'lightSmallIcon("folder")' in project_row
    assert "return renderUniversalFeedPage({" in inbox_page
    assert 'surface: "inbox",' in inbox_page
    assert 'surfaceTag: "section",' in inbox_page
    assert 'surfaceClassName: "light-canonical-port-surface light-inbox-surface",' in inbox_page
    assert "sections: [lightInboxSection()]" in inbox_page
    assert "return renderUniversalFeedPage({" in meetings_page
    assert 'surface: "meetings",' in meetings_page
    assert 'surfaceTag: "section",' in meetings_page
    assert 'surfaceClassName: "light-canonical-port-surface light-meetings-surface",' in meetings_page
    assert 'contentClassName: "meetings-page is-embedded-light",' in meetings_page
    assert "const beforeSections = [];" in meetings_page
    assert "sections: [lightMeetingsSection()]" in meetings_page
    assert "function meetingsEmbeddedToolbar()" not in app
    assert "meetingsEmbeddedToolbar" not in meetings_page
    assert 'renderMode: "flat",' in reply_descriptor
    assert 'renderMode: "flat",' in meeting_descriptor
    assert "const displayCards = feedDisplayCards();" in inbox_section
    assert 'workspaceItems("feed-items")' not in inbox_section
    assert "if (!displayCards.length && !state.feedLastAppliedAt) {" in inbox_section
    assert 'emptyState: el("div", "empty", "Loading inbox..."),' in inbox_section
    assert 'empty.append("No inbox items yet.", document.createElement("br"), "Replies and meeting summaries will appear here.");' in inbox_section
    assert '"No replies yet."' not in inbox_section
    assert "const card = descriptor.meta?.card;" in render_universal_tile
    assert 'return cardView(card, { surface: descriptor.surface, flatFeed: descriptor.renderMode === "flat" });' in render_universal_tile
    assert "const meeting = descriptor.meta?.meeting;" in render_universal_tile
    assert 'return cardView(meetingCardFromRecord(meeting), { surface: descriptor.surface, flatFeed: descriptor.renderMode === "flat" });' in render_universal_tile
    assert "function cardView(card, options = {})" in app
    assert "const flatFeed = Boolean(options.flatFeed);" in card_view
    assert 'const surface = String(options.surface || "").trim().toLowerCase();' in card_view
    assert 'const wrapper = el("div", flatFeed ? "card-wrap is-flat-feed" : "card-wrap");' in card_view
    assert 'const cardClassName = isMeetingList' in card_view
    assert 'const cardEl = el("article", flatFeed ? `${cardClassName} is-flat-feed` : cardClassName);' in card_view
    assert 'setDataAttribute(wrapper, "data-card-surface", surface);' in card_view
    assert 'setDataAttribute(cardEl, "data-card-surface", surface);' in card_view
    assert ".meetings-embedded-toolbar {" not in styles
    assert ".meetings-refresh {" not in styles
    assert 'body.classList.add("is-flat-feed");' in card_view
    assert 'const copy = el("div", "card-meeting-copy");' in card_view
    assert 'const meta = el("div", "card-meeting-meta");' in card_view
    assert "meta.append(actions);" in card_view
    assert 'actions.classList.add(`action-count-${Math.min(2, actions.childElementCount)}`);' in card_view
    assert 'setDataAttribute(actions, "data-card-surface", surface);' in card_view
    assert ".light-canonical-port-surface {" in styles
    assert ".card {" in styles
    meeting_list_card = css_block(styles, ".card.card-meeting-list")
    meeting_list_title_only = css_block(styles, ".card.card-meeting-list .card-body.is-title-only")
    assert ".card.card-meeting-list {" in styles
    assert ".card-meeting-copy {" in styles
    assert ".card-meeting-meta {" in styles
    assert "grid-template-rows: auto;" in meeting_list_card
    assert "min-height: 72px;" in meeting_list_card
    assert "display: block;" in meeting_list_title_only
    assert "align-items: center;" not in meeting_list_title_only
    assert ".light-feed-surface.is-flat-feed {" in styles
    assert ".light-feed-section.is-flat-feed {" in styles
    assert ".light-feed-list.is-flat-feed {" in styles
    assert ".light-feed-row.is-flat-feed {" in styles
    assert ".light-graph-row.is-flat-feed {" in styles
    assert ".light-reminder-row.is-flat-feed {" in styles
    assert ".light-project-row.is-flat-feed {" in styles
    assert ".card-wrap.is-flat-feed {" in styles
    assert ".card.is-flat-feed {" in styles
    assert ".card-wrap.is-flat-feed + .card-wrap.is-flat-feed .card.is-flat-feed {" in styles
    assert '.light-inbox-surface .card.is-flat-feed[data-card-surface="inbox"][data-card-kind="reply"] {' in styles
    assert '.light-inbox-surface .card.is-flat-feed[data-card-surface="inbox"][data-card-kind="reply"] .card-body.is-flat-feed {' in styles
    assert '.light-inbox-surface .card.is-flat-feed[data-card-surface="inbox"][data-card-kind="reply"] .card-actions.action-count-1 {' in styles
    assert '.light-inbox-surface .card.is-flat-feed[data-card-surface="inbox"][data-card-kind="reply"] .card-actions.action-count-2 {' in styles
    assert '.light-meetings-surface .card.is-flat-feed[data-card-surface="meetings"]' not in styles
    assert ".light-chip-cloud span," not in styles


def test_light_inbox_unread_attachment_actions_use_light_theme_icon_color() -> None:
    styles = read("styles.css")
    light_shell = css_block(styles, '.app-shell[data-theme="light"]')

    assert "--icon-card-neutral: #101624;" in light_shell
    assert "--icon-card-action-unread: #101624;" in light_shell


def test_inbox_management_uses_visible_archive_controls_without_delete_ui() -> None:
    app = read("app.js")
    icons = read("pucky-icons.js")
    styles = read("styles.css")
    render = function_block(app, "render")
    inbox_page = function_block(app, "lightInboxPage")
    header_action = function_block(app, "inboxManageHeaderAction")
    header_pill = function_block(app, "inboxHeaderPillButton")
    toggle_archive = function_block(app, "toggleInboxArchivedFeed")
    overlay = function_block(app, "renderInboxManageOverlay")
    card_view = function_block(app, "cardView")
    meeting_processing_view = function_block(app, "meetingProcessingCardView")
    select_button = function_block(app, "inboxManageSelectButton")
    inbox_shell = css_block(styles, '.light-shell[data-light-route="inbox"]')
    timestamp = css_block(styles, ".card-timestamp")
    header_pill_css = css_block(styles, ".inbox-header-pill")
    spinner_css = css_block(styles, ".inbox-header-spinner")
    loading_notice = css_block(styles, ".inbox-archive-loading-notice")
    manage_bar = css_block(styles, ".inbox-manage-bar")

    assert "action: inboxManageHeaderAction()" in inbox_page
    assert "afterSections: [inboxManageToolbar()].filter(Boolean)" not in inbox_page
    assert "function inboxManageHeaderAction(" in app
    assert "function inboxHeaderPillButton(" in app
    assert "lightCircleButton(" not in header_action
    assert 'label: inboxArchiveFilterLabel(displayArchived)' in header_action
    assert 'label: state.inboxManageMode ? "Done" : "Manage"' in header_action
    assert 'button.setAttribute("aria-busy", "true");' in header_pill
    assert 'button.disabled = Boolean(config.disabled);' in header_pill
    assert "state.inboxArchiveFilterPendingTarget" in app
    assert "function inboxArchiveFilterLoadingNotice(" in app
    assert "beforeSections: [inboxArchiveFilterLoadingNotice()].filter(Boolean)" in inbox_page
    assert 'state.inboxArchiveFilterPendingTarget = targetArchived;' in toggle_archive
    assert 'state.showArchivedFeed = targetArchived;' in toggle_archive
    assert toggle_archive.index('await syncFeedCards({') < toggle_archive.index('state.showArchivedFeed = targetArchived;')
    assert "function inboxManageToolbar(" in app
    assert "function renderInboxManageOverlay(" in app
    assert render.index("renderFeed();") < render.index("renderInboxManageOverlay();")
    assert 'const shell = document.querySelector(".app-shell");' in overlay
    assert 'overlay.id = "inboxManageOverlay";' in overlay
    assert "shell.append(overlay);" in overlay
    assert "function archiveSelectedInboxCards(" in app
    assert 'applyCardActionData(select, "manage_select", card, "reply");' in app
    assert 'applyCardActionData(menuButton, "manage_menu", card, "reply");' not in app
    assert 'const action = state.showArchivedFeed ? "unarchive" : "archive";' in function_block(app, "archiveSelectedInboxCards")
    assert "postFeedAction(card, action);" in function_block(app, "archiveSelectedInboxCards")
    assert 'const revealArchiveEnabled = surface !== "inbox" && canArchiveHomeCard(card);' in card_view
    assert "function shouldShowInboxCardEscapeMenu(" not in app
    assert "function cardOverflowMenu(" not in app
    assert "function inboxCardMenuButton(" not in app
    assert "function openInboxCardMenu(" not in app
    assert "function isInboxCardMenuOpen(" not in app
    assert 'const inboxEscapeMenu = manageableInboxCard && shouldShowInboxCardEscapeMenu(card);' not in card_view
    assert 'if (inboxEscapeMenu && !inboxManageMode) {' not in card_view
    assert 'wrapper.classList.add("has-inbox-menu");' not in card_view
    assert 'const manageableInboxCard = inboxSurface && canManageInboxCard(card);' in meeting_processing_view
    assert 'wrapper.append(inboxManageSelectButton(card));' in meeting_processing_view
    assert 'const inboxEscapeMenu = manageableInboxCard && shouldShowInboxCardEscapeMenu(card);' not in meeting_processing_view
    assert 'wrapper.append(inboxCardMenuButton(card));' not in meeting_processing_view
    assert 'wrapper.append(cardOverflowMenu(card));' not in meeting_processing_view
    assert 'wrapper.classList.add("has-inbox-menu");' not in meeting_processing_view
    assert 'check: {' in icons
    assert 'select.innerHTML = selected ? iconSvg("check", { filled: true }) : "";' in select_button
    assert 'iconSvg("checklist", { filled: selected })' not in select_button
    assert "--light-shell-column-max: 744px;" in inbox_shell
    assert "--light-shell-column-padding: 12px;" in inbox_shell
    assert "text-align: right;" in timestamp
    assert ".card-wrap.has-inbox-menu" not in styles
    assert '.card-wrap.is-inbox-manage-mode .card.is-flat-feed[data-card-surface="inbox"][data-card-kind="reply"],' in styles
    assert '.card-wrap.is-inbox-manage-mode .card.is-flat-feed[data-card-surface="inbox"][data-card-kind="meeting_processing"]' in styles
    assert ".inbox-manage-bar" in styles
    assert ".inbox-manage-select" in styles
    assert ".inbox-header-pill" in styles
    assert "display: inline-flex;" in header_pill_css
    assert ".inbox-header-spinner" in styles
    assert "animation: inbox-spin 0.72s linear infinite;" in spinner_css
    assert ".inbox-archive-loading-notice" in styles
    assert "Loading archived replies..." in app
    assert "Loading active replies..." in app
    assert "role\", \"status\"" in app
    assert "width: min(calc(100vw - 52px), 720px);" in loading_notice
    assert ".inbox-card-menu" not in styles
    assert "position: fixed;" in manage_bar
    assert "bottom: env(safe-area-inset-bottom, 0px);" in manage_bar
    assert "width: min(calc(100vw - 28px), 480px);" in manage_bar


def test_meetings_titles_stay_explicitly_left_anchored() -> None:
    styles = read("styles.css")
    meeting_title_only = css_block(styles, ".card.card-meeting-list .card-body.is-title-only")
    meeting_copy = css_block(styles, ".card.card-meeting-list .card-meeting-copy")

    assert "display: block;" in meeting_title_only
    assert "align-items: center;" not in meeting_title_only
    assert "width: 100%;" in meeting_copy
    assert "text-align: left;" in meeting_copy

def test_contacts_preserve_me_contact_with_frontend_edit_flow() -> None:
    app = read("app.js")
    styles = read("styles.css")
    contacts_page = function_block(app, "lightContactsPage")
    contacts_search = function_block(app, "lightContactsSearchField")
    sync_contacts_page = function_block(app, "syncContactsPage")
    sync_contacts_search_input = function_block(app, "syncContactsSearchInput")
    contact_search_terms = function_block(app, "contactSearchTerms")
    contact_matches_search = function_block(app, "contactMatchesSearch")
    filtered_contacts = function_block(app, "filteredContactsListItems")
    contact_initials_from_text = function_block(app, "contactInitialsFromText")
    contact_avatar_text = function_block(app, "contactAvatarText")
    contact_draft_avatar = function_block(app, "contactDraftAvatar")
    build_contact_edit_draft = function_block(app, "buildContactEditDraft")
    contact_edit_snapshot = function_block(app, "contactEditDraftSnapshot")
    schedule_contact_detail_autosave = function_block(app, "scheduleContactDetailAutosave")
    run_after_contact_detail_flush = function_block(app, "runAfterContactDetailFlush")
    flush_contact_detail_autosave = function_block(app, "flushContactDetailAutosave")
    sync_contact_detail_editor = function_block(app, "syncContactDetailEditor")
    light_view = function_block(app, "lightView")
    light_mock_route_page = function_block(app, "lightMockRoutePage")
    prepare_contact_photo_draft = function_block(app, "prepareContactPhotoDraft")
    light_avatar = function_block(app, "lightAvatar")
    contact_detail = function_block(app, "lightContactDetailPage")
    contact_edit = function_block(app, "lightContactEditPage")
    contact_search_wrap = css_block(styles, ".light-contacts-search-wrap")
    contact_search_input = css_block(styles, ".light-contacts-search")
    contact_list = css_block(styles, ".light-contact-list")
    contact_row = css_block(styles, ".light-contact-row")
    contact_detail_form = css_block(styles, ".light-contact-detail-page .light-contact-edit-form")
    contact_detail_header = css_block(styles, ".light-contact-detail-page .light-contact-edit-photo-card")
    contact_detail_status = css_block(styles, ".light-contact-detail-status")
    contact_activity_row = css_block(styles, ".light-contact-activity-row")

    assert 'const SELF_CONTACT_ID = "contact-me";' in app
    assert "function contactIsSelf(contact)" in app
    assert "function contactsListItems()" in app
    assert "function normalizeSearchDigits(value)" in app
    assert "let contactsPageNode = null;" in app
    assert "let contactsPageRefs = null;" in app
    assert "let contactDetailPageNode = null;" in app
    assert "let contactDetailPageRefs = null;" in app
    assert 'let contactDetailPageContactId = "";' in app
    assert '"contact-edit"' in app
    assert "function syncContactsPage()" in app
    assert "function syncContactsSearchInput(refs)" in app
    assert "function syncContactDetailEditor() {" in app
    assert "function lightMockRoutePage(route = state.route) {" in app
    assert "function scheduleContactDetailAutosave() {" in app
    assert "async function flushContactDetailAutosave(options = {}) {" in app
    assert 'function contactInitialsFromText(value, fallback = "CT") {' in app
    assert "function contactAvatarText(contact) {" in app
    assert "const searchWrap = lightContactsSearchField();" in contacts_page
    assert "if (!contactsPageNode) {" in contacts_page
    assert "contactsPageRefs = {" in contacts_page
    assert "contactsPageNode = page;" in contacts_page
    assert "syncContactsPage();" in contacts_page
    assert 'search.type = "search";' in contacts_search
    assert 'search.setAttribute("aria-label", "Search contacts");' in contacts_search
    assert 'search.placeholder = "Search contacts";' in contacts_search
    assert 'search.addEventListener("input", onSearchInput);' in contacts_search
    assert 'search.addEventListener("search", onSearchInput);' in contacts_search
    assert "state.contacts.search = nextValue;" in contacts_search
    assert "resetLightRouteScroll();" in contacts_search
    assert "syncContactsPage();" in contacts_search
    assert "render();" not in contacts_search
    assert "queueContactsSearchFieldFocus(" not in app
    assert 'if (document.activeElement !== refs.search && refs.search.value !== state.contacts.search) {' in sync_contacts_search_input
    assert "const contacts = filteredContactsListItems();" in sync_contacts_page
    assert 'refs.list.replaceChildren(fragment);' in sync_contacts_page
    assert "return contactsListItems().filter(contact => contactMatchesSearch(contact));" in filtered_contacts
    assert "meta.display_name" in contact_search_terms
    assert "meta.first_name" in contact_search_terms
    assert "meta.last_name" in contact_search_terms
    assert "meta.email" in contact_search_terms
    assert "meta.phone" in contact_search_terms
    assert "...activity," in contact_search_terms
    assert "phoneDigits.includes(queryDigits)" in contact_matches_search
    assert 'refs.empty.hidden = contacts.length > 0;' in sync_contacts_page
    assert 'refs.list.hidden = contacts.length === 0;' in sync_contacts_page
    assert 'No contacts match your search.' in sync_contacts_page
    assert 'Clear the search field to see every contact again.' in sync_contacts_page
    assert 'const row = el("button", "light-contact-row light-feed-row is-flat-feed");' in sync_contacts_page
    assert 'const row = el("button", "light-card light-contact-row");' not in sync_contacts_page
    assert 'return letters[0].charAt(0).toUpperCase();' in contact_initials_from_text
    assert 'return letters[0].slice(0, 2).toUpperCase();' not in contact_initials_from_text
    assert 'if (contactIsSelf(contact)) {' in contact_avatar_text
    assert 'return "ME";' in contact_avatar_text
    assert "contactInitialsFromText(" in contact_draft_avatar
    assert 'return letters[0].slice(0, 2).toUpperCase();' not in contact_draft_avatar
    assert 'activity: Array.isArray(meta.activity) ? meta.activity.map(value => String(value || "")) : [],' in build_contact_edit_draft
    assert 'activity: Array.isArray(draft?.activity) ? draft.activity.map(value => String(value || "")) : [],' in contact_edit_snapshot
    assert "window.setTimeout(() => {" in schedule_contact_detail_autosave
    assert "350" in schedule_contact_detail_autosave
    assert "render();" not in schedule_contact_detail_autosave
    assert "if (!isContactDetailEditorRoute(state.route)) {" in run_after_contact_detail_flush
    assert "if (stayingOnSameContact) {" in run_after_contact_detail_flush
    assert "if (!state.contacts.editSaving && !contactEditHasUnsavedChanges()) {" in run_after_contact_detail_flush
    assert "clearContactEditDraft();" in run_after_contact_detail_flush
    assert "callback();" in run_after_contact_detail_flush
    assert "callback();\n      return true;" not in run_after_contact_detail_flush
    assert 'const updated = await patchWorkspaceRecord("contacts", contactId, payload);' in flush_contact_detail_autosave
    assert "render();" not in flush_contact_detail_autosave
    assert "createWorkspaceAsset(" not in flush_contact_detail_autosave
    assert 'canvas.toDataURL("image/jpeg", 0.82);' in prepare_contact_photo_draft
    assert "pendingPhotoBase64" not in prepare_contact_photo_draft
    assert "const initials = contactAvatarText(contact);" in light_avatar
    assert 'meta.avatar || contact.title || "?"' not in light_avatar
    assert 'const page = lightPage("Contact", {' in contact_detail
    assert "detail: true," in contact_detail
    assert 'page.classList.add("light-contact-detail-page", "light-contact-edit-page");' in contact_detail
    assert 'const form = el("form", "light-contact-edit-form");' in contact_detail
    assert 'const header = el("section", "light-contact-edit-photo-card");' in contact_detail
    assert 'photoInput.accept = "image/png,image/jpeg,image/webp";' in contact_detail
    assert 'summaryInput.dataset.contactEditField = "summary";' in contact_detail
    assert 'emailInput.dataset.contactEditField = "email";' in contact_detail
    assert 'phoneInput.dataset.contactEditField = "phone";' in contact_detail
    assert 'removePhoto.dataset.contactPhotoRemove = "true";' in contact_detail
    assert 'lightContactEditField("Description", summaryInput),' in contact_detail
    assert 'const hero = el("section", "light-profile-card");' not in contact_detail
    assert 'lightInfoSection("Endpoints"' not in contact_detail
    assert "meta.endpoints" not in contact_detail
    assert 'const notes = lightLinkedNotesSection(contact);' not in contact_detail
    assert 'const linkedRows = lightLinkedRecordRows(contact, { excludeKinds: ["note"] });' not in contact_detail
    assert 'lightIconButton("edit", contactIsSelf(contact) ? "Edit me" : "Edit contact"' not in contact_detail
    assert 'lightNavigate("contact-edit", { from: "contact-detail" });' not in contact_detail
    assert '"Last interaction"' not in contact_detail
    assert '"Last meeting"' not in contact_detail
    assert '"Upcoming"' not in contact_detail
    assert "lightHtmlDocument(contact" not in contact_detail
    assert "Reminder device" not in contact_detail
    assert 'refs.nameGrid.hidden = contactIsSelf(contact);' in sync_contact_detail_editor
    assert 'refs.activitySection.hidden = contactIsSelf(contact);' in sync_contact_detail_editor
    assert 'refs.connected.replaceChildren(lightLinkedRecordSection(contact, {' in sync_contact_detail_editor
    assert 'refs.status.dataset.contactAutosaveStatus = state.contacts.editStatus || "idle";' in sync_contact_detail_editor
    assert 'changePhoto.textContent = draft.photo ? "Change photo" : "Add photo";' in sync_contact_detail_editor
    assert 'removePhoto.hidden = !draft.photo;' in sync_contact_detail_editor
    assert 'const mockPage = lightMockRoutePage(route);' in light_view
    assert 'return homeShellMockView(route, page);' in light_view
    assert 'return lightContactsPage();' in light_mock_route_page
    assert 'return lightContactDetailPage();' in light_mock_route_page
    assert 'return lightContactEditPage();' in light_mock_route_page
    assert "function lightContactEditPage()" in app
    assert "return lightContactDetailPage();" in contact_edit
    assert "saveButton" not in contact_edit
    assert "lightLinkedRecordSection(contact, {" not in contact_edit
    assert "display: flex;" in contact_search_wrap
    assert "padding: 0;" in contact_search_wrap
    assert "border-bottom:" in contact_search_wrap
    assert "background:" not in contact_search_wrap
    assert "width: 100%;" in contact_search_input
    assert "min-height: 50px;" in contact_search_input
    assert "background: transparent;" in contact_search_input
    assert "font-size: 17px;" in contact_search_input
    assert "gap: 0;" in contact_list
    assert "padding: 0 0 84px;" in contact_list
    assert "gap: 12px;" not in contact_list
    assert "padding: 0 4px 84px;" not in contact_list
    assert "grid-template-columns: 48px minmax(0, 1fr);" in contact_row
    assert "padding: 12px 0;" in contact_row
    assert "border-radius: 0;" in contact_row
    assert "background: transparent;" in contact_row
    assert "box-shadow: none;" in contact_row
    assert ".light-contact-row .light-avatar {" not in styles
    assert ".light-contact-row .light-text-stack strong {" not in styles
    assert ".light-contact-row .light-text-stack span {" not in styles
    assert "display: grid;" in contact_detail_form
    assert "padding: 0 0 84px;" in contact_detail_form
    assert "background: transparent;" in contact_detail_header
    assert "border: 0;" in contact_detail_header
    assert "box-shadow: none;" in contact_detail_header
    assert "padding: 0;" in contact_detail_header
    assert "font-size:" in contact_detail_status
    assert "color:" in contact_detail_status
    assert "display: grid;" in contact_activity_row
    assert "grid-template-columns:" in contact_activity_row


def test_contacts_search_resets_only_when_leaving_contacts_surface() -> None:
    app = read("app.js")
    reset_contacts_search = function_block(app, "resetContactsSearchIfLeavingContacts")
    is_contacts_surface_route = function_block(app, "isContactsSurfaceRoute")
    restore_light_route_snapshot = function_block(app, "restoreLightRouteSnapshot")
    light_navigate = function_block(app, "lightNavigate")
    light_back = function_block(app, "lightBack")

    assert "function isContactsSurfaceRoute(route) {" in app
    assert 'return value === "contacts" || value === "contact-detail" || value === "contact-edit";' in is_contacts_surface_route
    assert "if (!isContactsSurfaceRoute(currentRoute) || isContactsSurfaceRoute(nextRoute)) {" in reset_contacts_search
    assert 'state.contacts.search = "";' in reset_contacts_search
    assert "resetContactsSearchIfLeavingContacts(normalized.route);" in restore_light_route_snapshot
    assert "resetContactsSearchIfLeavingContacts(nextRoute);" in light_navigate
    assert 'resetContactsSearchIfLeavingContacts(parent === state.route ? "home" : parent);' in light_back


def test_linked_records_keep_click_targets_but_allow_task_surface_chevron_suppression() -> None:
    app = read("app.js")
    light_info_section = function_block(app, "lightInfoSection")
    light_info_row = function_block(app, "lightInfoRow")

    assert "function lightInfoSection(title, rows, options = {})" in app
    assert 'const suppressInteractiveChevron = String(title || "").trim().toLowerCase() === "linked records";' in light_info_section
    assert 'const showTrailingChevron = options.showTrailingChevron !== false && !suppressInteractiveChevron;' in light_info_section
    assert 'rows.forEach(row => card.append(lightInfoRow(row, { showChevron: showTrailingChevron })));' in light_info_section
    assert "item.dataset.workspaceTargetRoute = row.target.route;" in light_info_row
    assert "item.dataset.workspaceTargetId = row.target.id;" in light_info_row
    assert "item.addEventListener(\"click\", () => openWorkspaceTarget(" in light_info_row
    assert 'lightTextStack(row.label, row.value)' in light_info_row
    assert 'light-chevron' not in light_info_row
