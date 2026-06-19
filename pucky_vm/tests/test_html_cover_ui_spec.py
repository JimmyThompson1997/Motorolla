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
    icons = read("pucky-icons.js")
    styles = read("styles.css")

    assert "window.PUCKY_UI_ICONS = {" in icons
    assert "MATERIAL_SYMBOLS:" in icons
    assert "SEMANTIC_ICON_ACCENT_PALETTE:" in icons
    assert "const MATERIAL_SYMBOLS = iconCatalog.MATERIAL_SYMBOLS" in app
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
    assert '<script src="./pucky-icons.js"></script>' in html
    assert '<script src="./pucky-routes.js"></script>' in html
    assert html.index('<script src="./pucky-icons.js"></script>') < html.index('<script src="./app.js"></script>')
    assert html.index('<script src="./pucky-routes.js"></script>') < html.index('<script src="./app.js"></script>')
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


def test_route_aliases_collapse_legacy_entry_points() -> None:
    app = read("app.js")
    routes = read("pucky-routes.js")
    route_normalizer = function_block(app, "normalizeHomeShellRoute")
    initial_route_state = function_block(app, "resolveInitialRouteState")
    route_for_theme = function_block(app, "resolveRouteForTheme")
    route_sync = function_block(app, "syncRouteQueryParam")

    assert 'ROUTE_ALIASES: {}' in routes
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


def test_meeting_notes_rows_drop_leading_icon_and_trailing_chevron_only_for_that_list() -> None:
    app = read("app.js")
    styles = read("styles.css")
    meeting_notes_page = function_block(app, "lightMeetingNotesPage")
    light_graph_row = function_block(app, "lightGraphRow")

    assert 'rowClassName: "light-graph-row-meeting-notes",' in meeting_notes_page
    assert "showLeadingIcon: false," in meeting_notes_page
    assert "showTrailingChevron: false" in meeting_notes_page
    assert 'const rowClassName = String(options.rowClassName || "").trim();' in light_graph_row
    assert 'const leadingIcon = options.showLeadingIcon === false' in light_graph_row
    assert 'const trailingChevron = options.showTrailingChevron === false' in light_graph_row
    assert "if (leadingIcon) {" in light_graph_row
    assert "if (trailingChevron) {" in light_graph_row
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
    assert 'lightCalendarEventChips(event, { fromRoute: "calendar", contactsOnly: true })' in light_event_block
    assert 'limit: 2' not in light_event_block
    assert "light-event-summary" not in light_event_block
    light_gap = function_block(app, "lightCalendarGap")
    assert 'Free ${calendarFormatTime(untilMs - gapMs)} - ${calendarFormatTime(untilMs)}' in light_gap
    assert "Long break" not in light_gap
    light_cluster = function_block(app, "lightCalendarCluster")
    assert "Busy window" not in light_cluster
    light_meeting_detail = function_block(app, "lightMeetingDetailPage")
    assert 'lightDocumentEyebrow("Calendar event"' not in light_meeting_detail
    assert 'el("h1", "", meeting.title || "Untitled event")' not in light_meeting_detail
    assert "lightCalendarEventDetailsSection(meeting, attendees)" in light_meeting_detail
    assert 'page.append(lightCopySection("Description", meeting.summary));' in light_meeting_detail
    assert light_meeting_detail.index("lightCalendarEventDetailsSection(meeting, attendees)") < light_meeting_detail.index('lightCopySection("Description", meeting.summary)')
    assert 'lightCalendarEventChips(meeting, { fromRoute: "meeting-detail", excludeContacts: true })' in light_meeting_detail
    assert 'lightInfoSection("Linked records", linkedRows)' not in light_meeting_detail
    assert 'function lightCalendarEventDetailsSection(event, attendees = calendarEventPeople(event)) {' in app
    assert 'who.dataset.detailRow = "who";' in app
    assert 'calendarEventChipTargets(event, { contactsOnly: true })' in app
    assert 'light-attendee-chip-cloud' in app
    assert "calendarEventTypeFiltersCard()" in app
    assert 'const sheet = el("section", "settings-selector-sheet calendar-settings-panel");' in app
    assert "trace-sheet settings-sheet calendar-settings-sheet" not in app
    assert 'return typeof window !== "undefined" && window.innerWidth >= 768 ? 21 : 15;' in app
    assert 'localStorage.setItem("pucky.cover.calendar_type_filters.v1"' in app
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
    assert "overflow-x: clip;" in styles
    assert "overflow-y: visible;" in styles
    assert ".light-page-header-shell {\n  position: sticky;" in styles
    assert ".light-date-picker {\n  position: sticky;" in styles
    assert ".light-calendar-strip-nav-button" in styles
    assert "grid-auto-columns: 58px;" in styles
    assert "scroll-snap-type: x proximity;" in styles
    assert ".settings-selector-overlay.calendar-settings-overlay" in styles
    assert ".calendar-settings-panel" in styles
    assert ".calendar-type-filter-row" in styles
    assert ".light-calendar-detail-card" in styles


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
    assert 'if (document.visibilityState !== "visible") {' in app
    assert 'const wasTurnActive = isTurnActive(state.turn);' in app
    assert 'await loadTurnStatus({ render: false });' in app
    assert 'const turnActive = isTurnActive(state.turn);' in app
    assert 'if (state.route === "inbox" && (turnActive || wasTurnActive)) {' in app
    assert 'if (state.route === "inbox" || state.activePath || isTurnActive(state.turn) || wakeProofVisualState(state.wakeStatus) !== "idle") {' not in app
    assert '}, TURN_STATUS_POLL_MS);' in app


def test_hosted_workspace_routes_load_live_data_without_browser_unlock_state() -> None:
    app = read("app.js")
    index_html = read("index.html")
    routes = read("pucky-routes.js")
    legacy_browser_state = "pucky-browser" + "-state.js"
    legacy_browser_unlock = "pucky-browser" + "-unlock.js"
    load_workspace = function_block(app, "loadWorkspaceCollection")
    light_workspace_status = function_block(app, "lightWorkspaceStatus")
    light_calendar_page = function_block(app, "lightCalendarPage")

    assert 'notes: "Notes"' in routes
    assert '"calendar-events": "Calendar"' in routes
    assert 'await ensureLinksApiConfig();' in load_workspace
    assert 'const payload = await workspaceApiRequest(workspaceQuery(collection, { date, includeArchived: Boolean(options.includeArchived) }));' in load_workspace
    assert 'bucket.items = Array.isArray(payload && payload.items) ? payload.items : [];' in load_workspace
    assert 'bucket.loaded = true;' in load_workspace
    assert "pucky-ui-state.js" in index_html
    assert legacy_browser_state not in index_html
    assert legacy_browser_unlock not in index_html
    assert "preview_locked" not in app
    assert 'if (bucket.error) {' in light_workspace_status
    assert 'if (!bucket.loaded) {' in light_workspace_status
    assert 'if (bucket.loaded && !workspaceItems(collection).length) {' in light_workspace_status
    assert 'if (bucket.error) {' in light_calendar_page
    assert 'if (!bucket.loaded) {' in light_calendar_page


def test_hosted_connect_and_phone_role_stay_read_only_without_browser_unlock_flow() -> None:
    app = read("app.js")
    settings_page = function_block(app, "settingsPageView")
    create_links_row = function_block(app, "createLinksRow")
    hydrate_links_session = function_block(app, "hydrateLinksSession")
    load_links_connected = function_block(app, "loadLinksConnected")
    load_phone_role_status = function_block(app, "loadPhoneRoleStatus")
    phone_role_settings_detail = function_block(app, "phoneRoleSettingsDetail")

    assert "webPreviewSettingsCard" not in app
    assert "openBrowserUnlockSheet" not in app
    assert 'cards.push(phoneRoleSettingsCard(), advancedSettingsCard());' in settings_page
    assert 'showToast("Connect stays read-only in hosted web.");' in create_links_row
    assert "hostedConnectReadOnlyMode()" in hydrate_links_session
    assert 'state.links.available = true;' in hydrate_links_session
    assert 'await loadLinksConnected({ render: false, force: Boolean(options.force) });' in hydrate_links_session
    assert 'const query = new URLSearchParams();' in load_links_connected
    assert '`/api/links/composio/my-apps${query.toString() ? `?${query}` : ""}`' in load_links_connected
    assert 'state.links.userId = String(payload && payload.user_id || "").trim();' in load_links_connected
    assert 'state.phoneRole = unavailableBrowserPhoneRoleStatus("preview_unavailable", {' in load_phone_role_status
    assert "Hosted web keeps phone-role state read-only. Open the APK on your phone to view or change it." in phone_role_settings_detail
    assert "Hosted web does not expose phone-role state. Open the APK on your phone to view it." in phone_role_settings_detail


def test_ui_surface_and_audio_probe_expose_browser_runtime_truth() -> None:
    app = read("app.js")
    describe_ui_surface = function_block(app, "describeUiSurface")
    describe_audio_probe = function_block(app, "describeAudioProbe")

    assert 'if (command === "ui.surface.get") {' in app
    assert 'if (command === "ui.debug.audio_probe.get") {' in app
    assert 'bridge_connected: hasNativeAudioBridge()' in app
    assert "...state.uiSurface," in describe_ui_surface
    assert 'audio_runtime_mode: audioRuntimeMode()' in describe_ui_surface
    assert "bridge_connected: hasNativeAudioBridge()," in describe_audio_probe
    assert 'runtime_mode: audioRuntimeMode()' in describe_audio_probe
    assert 'active_path: state.activePath || ""' in describe_audio_probe
    assert 'current_tile_audio_phase: state.audioProbe.current_tile_audio_phase || "idle"' in describe_audio_probe
    assert "recent_events: Array.isArray(state.audioProbe.recent_events)" in describe_audio_probe
    assert 'last_error_toast: String(state.audioProbe.last_error_toast || state.lastToast.message || "")' in describe_audio_probe


def test_inbox_tile_audio_uses_explicit_phase_machine_and_not_waveform_default() -> None:
    app = read("app.js")
    card_view = function_block(app, "cardView")
    toggle_audio = function_block(app, "toggleAudio")
    audio_control_key = function_block(app, "audioControlKey")
    current_strip_kind = function_block(app, "currentTileAudioStripKind")
    is_audio_detail_open = function_block(app, "isAudioDetailOpen")
    sync_probe = function_block(app, "syncAudioProbeFromPlayerState")
    browser_request = function_block(app, "browserRequest")
    ensure_shared_browser_audio = function_block(app, "ensureSharedBrowserAudio")
    describe_audio_source = function_block(app, "describeAudioSourceForCard")
    audio_tile_status = function_block(app, "audioTileStatus")
    confirm_playback = function_block(app, "confirmAudioProbePlaybackStart")
    tile_audio_label = function_block(app, "tileAudioLabel")
    tile_audio_meta = function_block(app, "tileAudioMeta")
    current_player_position = function_block(app, "currentPlayerPositionMs")
    playback_position = function_block(app, "playbackPositionForCard")
    should_animate = function_block(app, "shouldAnimateActiveTileAudio")

    assert 'const AUDIO_TILE_PHASES = ["idle", "starting", "playing_confirmed", "pause_pending", "start_failed", "ended_immediately"];' in app
    assert 'if (currentTileAudioPhase(card) !== "idle") {' in card_view
    assert "body.append(audioTileStatus(card));" in card_view
    assert 'body.append(el("p", "preview", card.summary || card.transcript || ""));' in card_view
    assert "waveRow(" not in card_view
    assert 'recordAudioProbeEvent("click_received"' in toggle_audio
    assert 'setAudioProbePhase(card, "starting"' in toggle_audio
    assert 'setAudioProbePhase(card, "pause_pending"' in toggle_audio
    assert 'setAudioProbeTerminal(card, "start_failed"' in toggle_audio
    assert 'recordAudioProbeEvent("play_request_start"' in toggle_audio
    assert 'recordAudioProbeEvent("play_request_end"' in toggle_audio
    assert "confirmAudioProbePlaybackStart(busyKey, state.player);" in toggle_audio
    assert 'recordAudioProbeEvent("busy_end"' in toggle_audio
    assert 'if (!hasNativeAudioBridge() && card.audio_url) {' in audio_control_key
    assert "return card.audio_url;" in audio_control_key
    assert 'if (!Boolean(player?.is_playing) || !samePath(targetKey, playerStateKey(player))) {' in confirm_playback
    assert 'const BROWSER_AUDIO_RUNTIME = "browser_native";' in app
    assert 'const audio = new Audio();' in ensure_shared_browser_audio
    assert 'audio.addEventListener("loadedmetadata", () => syncSharedBrowserPlayerState({ render: true }));' in ensure_shared_browser_audio
    assert 'audio.addEventListener("ratechange", () => syncSharedBrowserPlayerState({ render: false }));' in ensure_shared_browser_audio
    assert 'return playerHasAudioIdentity(state.player)' in browser_request
    assert 'return setAudioProbePhaseByKey(targetKey, "playing_confirmed", {' in confirm_playback
    assert 'reason: String(reason || "play_request_acknowledged")' in confirm_playback
    assert 'if (phase !== "playing_confirmed") {' in current_strip_kind
    assert 'if (Number(state.player.duration_ms || 0) > 0 && activePlayerMatchesCard(card)) {' in current_strip_kind
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
    tile_status = css_block(styles, ".tile-audio-status")
    tile_label = css_block(styles, ".tile-audio-status-label")
    tile_strip = css_block(styles, ".tile-audio-strip")
    tile_meta = css_block(styles, ".tile-audio-status-meta")
    tile_progress = css_block(styles, ".tile-audio-progress")

    assert "color-mix(in srgb, var(--accent, #72c2ff) 76%, var(--text-muted-strong))" in busy_audio
    assert "color: #ff8f7c;" in failed_audio
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
    resolve_rich_page_source = function_block(app, "resolveRichPageSource")
    browser_request = function_block(app, "browserRequest")

    assert "function hasRichPage(card) {" in app
    assert "function resolveRichPageSource(card) {" in app
    assert 'return htmlPath || (htmlArtifact ? artifactVirtualPath(htmlArtifact) : "") || htmlUrl;' in resolve_rich_page_source
    assert 'return htmlUrl || (htmlArtifact ? artifactApiUrl(htmlArtifact) : "") || htmlPath;' in resolve_rich_page_source
    assert 'if (hasRichPage(card)) {' in card_view
    assert "if (card.html_path) {" not in card_view
    assert 'const pageSource = resolveRichPageSource(card);' in show_rich_page
    assert 'args: { path: pageSource, max_bytes: 1024 * 1024 }' in show_rich_page
    assert "mockArtifactResult" not in show_rich_page
    assert "isMockHtmlArtifact" not in app
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


def test_detail_views_surface_active_tile_audio_continuity_and_controls() -> None:
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
    assert 'openSideDetail(panel, card.title || "Transcript", content, dismissDetail, { audioCard: hasAudio(card) ? card : null });' in show_transcript
    assert "fullBleed: true" in show_rich_page
    assert 'openSideDetail(panel, card.title || "Images", content, dismissGallery, { audioCard: hasAudio(card) ? card : null });' in show_image_reel
    assert 'openSideDetail(panel, item.title || card.title || "Video", content, dismissAttachment, { audioCard: hasAudio(card) ? card : null });' in show_video_attachment
    assert 'openSideDetail(panel, item.title || card.title || "Audio", content, dismissAttachment, { audioCard: hasAudio(card) ? card : null });' in show_audio_attachment
    assert 'openSideDetail(panel, item.title || card.title || "Attachment", content, dismissAttachment, { audioCard: hasAudio(card) ? card : null });' in show_document_attachment
    assert "function openSideDetail(panel, title, content, onDismiss, options = {}) {" in app
    assert 'const audioCard = hasAudio(options.audioCard) ? options.audioCard : null;' in open_side_detail
    assert "if (audioCard) {" in open_side_detail
    assert "shell.append(detailAudioContinuity(audioCard));" in open_side_detail
    assert "const detail = normalizeNavDetail(state.navDetail);" in current_detail_audio_card
    assert "const card = resolveNavDetailCard(detail);" in current_detail_audio_card
    assert "return card && hasAudio(card) ? card : null;" in current_detail_audio_card
    assert "const targetCard = resolveAudioControlsTargetCard(card);" in show_audio_detail
    assert "state.audioCard = targetCard;" in show_audio_detail
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
    note_detail_html_card_block = css_block(styles, ".light-note-detail-html-body.light-html-card")
    note_detail_html_frame_block = css_block(styles, ".light-note-detail-html-body.light-html-card .light-html-frame")
    note_detail_html_loading_frame_block = css_block(styles, '.light-note-detail-html-body.light-html-card[data-html-frame-state="loading"] .light-html-frame')
    detail_html_empty_block = css_block(styles, ".light-detail-html-body.light-html-empty")
    html_detail_page_block = css_block(styles, ".light-page.light-html-detail-page")
    html_detail_page_children_block = css_block(styles, ".light-html-detail-page > :not(.light-page-header-shell)")
    html_detail_document_block = css_block(styles, ".light-html-detail-page.light-document-page")
    html_detail_stage_block = css_block(styles, ".light-html-stage")
    html_detail_frame_block = css_block(styles, ".light-html-detail-page .light-detail-html-body.light-html-card .light-html-frame")

    assert "note?.content_updated_at_ms" in note_timestamp
    assert "note?.created_at_ms" in note_timestamp
    assert "note?.updated_at_ms" in note_timestamp
    assert "notesSectionsExpanded: { pinned: true, recent: true }," in app
    assert 'page.classList.add("light-notes-page");' in light_notes
    assert 'const feedWrap = el("div", "light-notes-feed");' in light_notes
    assert 'feedWrap.append(lightNotesSection("Pinned", "pinned", pinned));' in light_notes
    assert 'feedWrap.append(lightNotesSection("Recent", "recent", notes.filter(note => !note.pinned)));' in light_notes
    assert 'page.append(feedWrap);' in light_notes
    assert 'const section = el("section", "light-notes-section");' in light_notes_section
    assert "section.dataset.notesSection = sectionKey;" in light_notes_section
    assert "const expanded = noteSectionExpanded(sectionKey);" in light_notes_section
    assert 'const body = el("div", "light-notes-section-body");' in light_notes_section
    assert "body.hidden = !expanded;" in light_notes_section
    assert "section.append(lightNotesSectionHeader(title, sectionKey, notes.length, expanded, bodyId));" in light_notes_section
    assert "if (expanded) {" in light_notes_section
    assert "notes.forEach(note => body.append(lightNoteRow(note)));" in light_notes_section
    assert 'const button = el("button", "light-notes-section-header");' in light_notes_section_header
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
    assert 'const row = el("div", "light-note-row");' in note_row
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
    assert 'className: "light-detail-html-body light-note-detail-html-body"' in note_detail
    assert "fullBleed: true" in note_detail
    assert "revealOnLoad: true" in note_detail

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
    assert "light-html-stage" in light_html_document
    assert "const revealOnLoad = Boolean(options && options.revealOnLoad);" in light_html_document
    assert 'wrap.dataset.htmlFrameState = "loading";' in light_html_document
    assert 'wrap.setAttribute("aria-busy", "true");' in light_html_document
    assert 'wrap.dataset.htmlFrameState = "ready";' in light_html_document
    assert 'wrap.setAttribute("aria-busy", "false");' in light_html_document
    assert 'embeddedBody.getAttribute("data-pucky-embedded-body") !== "true"' in light_html_document
    assert 'frame.addEventListener("load", () => markReady(false));' in light_html_document
    assert 'window.setTimeout(() => markReady(true), 1500);' in light_html_document

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
    assert "--note-document-surface: #08111c;" in styles
    assert "--note-document-surface: #ffffff;" in styles
    assert "background: var(--note-document-surface);" in note_detail_html_card_block
    assert "background: var(--note-document-surface);" in note_detail_html_frame_block
    assert "background: #fff;" not in note_detail_html_frame_block
    assert "visibility: hidden;" in note_detail_html_loading_frame_block
    assert "width: 100%;" in detail_html_empty_block
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

    workspace_html = function_block(app, "workspaceHtml")
    linked_rows = function_block(app, "workspaceLinkedRows")
    linked_notes = function_block(app, "lightLinkedNotesSection")
    contact_detail = function_block(app, "lightContactDetailPage")
    feed_detail = function_block(app, "lightFeedDetailPage")
    project_detail = function_block(app, "lightProjectDetailPage")
    graph_detail = function_block(app, "lightGraphDetailPage")

    assert 'return String(record.html || "");' in workspace_html
    assert "loadWorkspaceAsset" not in app
    assert "workspace.assets" not in app
    assert "const includeKinds =" in linked_rows
    assert "const excludeKinds = new Set(" in linked_rows
    assert 'if ((includeKinds && !includeKinds.has(normalizedKind)) || excludeKinds.has(normalizedKind)) {' in linked_rows
    assert 'includeKinds: ["note"],' in linked_notes
    assert 'valueResolver: ({ related, relation }) => String(related?.summary || relation || "Note").trim() || "Note"' in linked_notes
    assert 'const notes = lightLinkedNotesSection(contact);' in contact_detail
    assert 'const linkedRows = lightLinkedRecordRows(contact, { excludeKinds: ["note"] });' in contact_detail
    assert "lightHtmlDocument(contact" not in contact_detail
    assert 'const notes = lightLinkedNotesSection(item);' in feed_detail
    assert 'const relatedRows = lightLinkedRecordRows(item, { excludeKinds: ["note"] });' in feed_detail
    assert "lightHtmlDocument(item" not in feed_detail
    assert '["Artifacts", "attachment", projectAssets(project)]' not in project_detail
    assert "lightHtmlDocument(project" not in project_detail
    assert 'const notes = lightLinkedNotesSection(record);' in graph_detail
    assert 'const linkedRows = lightLinkedRecordRows(record, { excludeKinds: ["note"] });' in graph_detail
    assert "lightHtmlDocument(record" not in graph_detail


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
    assert 'options: taskStatusFilterChoices().map(([value, label]) => ({' in task_filters
    assert 'meta: String(counts[value] || 0),' in task_filters
    assert 'button.dataset.taskFilterCurrent = currentKey;' in task_filters
    assert 'light-task-filter-button' in task_filters
    assert 'light-task-filter-button-chevron' in task_filters
    assert 'iconSvg("expand_more", { filled: true })' in task_filters
    assert 'chevron-down' not in task_filters
    assert 'taskFilter: "all",' in app
    assert 'task_filter: state.taskFilter || "all"' not in app
    assert ".light-task-counts" not in styles
    assert ".light-task-filter-button" in styles
    assert ".light-task-filter-button-chevron" in styles
    assert "transform: rotate(90deg);" not in styles
    assert ".light-task-filter-button-icon {" in styles
    assert '.app-shell[data-theme="dark"] .light-task-filter-button.is-active' in styles
    assert '.app-shell[data-theme="dark"] .light-task-filter-button.is-active .light-task-filter-button-chevron' in styles


def test_tasks_use_people_chips_single_status_trigger_and_reset_scroll_on_open() -> None:
    app = read("app.js")
    tasks_page = function_block(app, "lightTasksPage")
    task_workspace_page = function_block(app, "lightTaskWorkspacePage")
    render_task_groups = function_block(app, "renderTaskGroups")
    styles = read("styles.css")

    task_group = function_block(app, "lightTaskGroup")
    task_detail_rows = function_block(app, "taskDetailRows")
    task_detail_surface = function_block(app, "lightTaskDetailSurface")
    task_notes_section = function_block(app, "lightTaskNotesSection")
    task_people_section = function_block(app, "lightTaskPeopleSection")
    task_people_loader = function_block(app, "ensureTaskPeopleContactsLoaded")
    task_status_control = function_block(app, "lightTaskStatusControl")
    task_filters = function_block(app, "lightTaskFilters")
    light_navigate = function_block(app, "lightNavigate")
    reset_scroll = function_block(app, "resetLightRouteScroll")
    task_refresh_interval = re.search(
        r'setInterval\(\(\) => \{\s*'
        r'if \((?P<condition>.*?)\) \{\s*'
        r'void loadWorkspaceCollection\("tasks", \{ render: true, force: true \}\);',
        app,
        re.S,
    )
    assert task_refresh_interval, "Missing task refresh interval"

    assert 'el("span", "light-task-row-summary"' not in task_group
    assert "function taskRowSummary" not in app
    assert "function taskOwners(task)" in app
    assert "function taskPrimaryOwner(task)" in app
    assert "explicitOwners" not in app
    assert 'const statusTrigger = el("button", "light-task-row-status-trigger");' in task_group
    assert 'statusTrigger.type = "button";' in task_group
    assert 'openTaskStatusSelector(task, "list");' in task_group
    assert 'const main = el("button", "light-task-row-main");' in task_group
    assert 'ensureTaskPeopleContactsLoaded(workspaceItems("tasks"));' in tasks_page
    assert 'ensureTaskPeopleContactsLoaded(workspaceItems("tasks"));' not in task_workspace_page
    assert 'ensureTaskPeopleContactsLoaded(workspaceItems("tasks"));' in render_task_groups
    assert "items.some(task => taskCreatedBy(task) || taskPrimaryOwner(task))" in task_people_loader
    assert 'void loadWorkspaceCollection("contacts", { render: true });' in task_people_loader
    assert 'label: "Created by"' not in task_detail_rows
    assert 'label: "Owner"' not in task_detail_rows
    assert 'const owner = taskPrimaryOwner(task);' in task_people_section
    assert 'datasetRole: "created_by"' in task_people_section
    assert 'datasetRole: "owner"' in task_people_section
    assert 'role: "Created by"' in task_people_section
    assert 'role: "Owner"' in task_people_section
    assert 'kind: "contact"' in task_people_section
    assert 'return lightLinkedNotesSection(task);' in task_notes_section
    assert "lightHtmlDocument(task" not in task_detail_surface
    assert 'const notes = lightTaskNotesSection(task);' in task_detail_surface
    assert "surface.append(notes);" in task_detail_surface
    assert "lightHtmlDocument(task" not in task_detail_surface
    assert 'const button = el("button", "light-pill is-active light-task-status-trigger");' in task_status_control
    assert 'button.type = "button";' in task_status_control
    assert 'openTaskStatusSelector(task, "detail-pill");' in task_status_control
    assert 'button.append(icon, copy);' in task_status_control
    assert 'iconSvg("expand_more", { filled: true })' not in task_status_control
    assert 'iconSvg("navigate_next")' not in task_status_control
    assert "function updateTaskStatus(taskId, nextStatus)" in app
    assert "function toggleTaskChecklistItem" not in app
    assert "function openTaskStatusSelector(task, source)" in app
    task_detail_card = function_block(app, "lightTaskDetailCard")
    assert 'const statusTrigger = el("button", "light-task-status-circle-trigger");' in task_detail_card
    assert 'statusTrigger.type = "button";' in task_detail_card
    assert 'openTaskStatusSelector(task, "detail-circle");' in task_detail_card
    assert 'const icon = el("span", "light-task-filter-button-icon");' in task_filters
    assert task_detail_surface.index('lightCopySection("Description", description)') < task_detail_surface.index('lightInfoSection("Details", taskDetailRows(task))')
    assert task_detail_surface.index('lightInfoSection("Details", taskDetailRows(task))') < task_detail_surface.index("lightTaskPeopleSection(task)")
    assert task_detail_surface.index("lightTaskChecklistSection(task)") < task_detail_surface.index("lightTaskNotesSection(task)")
    assert task_detail_surface.index("lightTaskNotesSection(task)") < task_detail_surface.index("lightTaskAttachmentsSection(task)")
    assert "resetLightRouteScroll();" in light_navigate
    assert "restoreScrollPosition(feed, 0);" in reset_scroll
    assert "window.scrollTo(0, 0);" in reset_scroll
    assert 'document.visibilityState === "visible"' in task_refresh_interval.group("condition")
    assert 'state.route === "tasks"' in task_refresh_interval.group("condition")
    assert "task-detail" not in task_refresh_interval.group("condition")
    assert ".light-task-detail-page .light-detail-html-body" not in styles
    assert ".light-task-detail-surface > .light-task-detail-body" not in styles
    assert ".light-record-chip-icon" in styles
    assert ".light-task-row-status-trigger" in styles
    assert ".light-task-status-circle-trigger" in styles
    assert ".light-task-status-trigger" in styles
    assert ".light-task-person-row" in styles
    assert ".light-task-filter-button-icon" in styles
    assert ".light-task-status-trigger-icon" in styles
    assert '.light-task-chip-cloud .light-record-chip[data-workspace-target-kind="calendar_event"]' in styles
    assert '.light-task-chip-cloud .light-record-chip[data-workspace-target-kind="project"]' in styles
    assert '.light-task-chip-cloud .light-record-chip[data-workspace-target-kind="note"]' in styles
    assert '.light-task-people-card .light-record-chip[data-workspace-target-kind="contact"]' in styles


def test_reminders_use_active_only_ui_and_hide_row_chips() -> None:
    app = read("app.js")
    styles = read("styles.css")
    reminders_page = function_block(app, "lightRemindersPage")
    reminder_active = function_block(app, "reminderIsActive")
    reminder_row = function_block(app, "lightReminderRow")
    reminder_detail = function_block(app, "lightReminderDetailPage")
    reminder_detail_card = function_block(app, "lightReminderDetailCard")
    reminder_status_row = function_block(app, "lightReminderStatusRow")
    recipient_name = function_block(app, "reminderRecipientDisplayName")
    recipient_rows = function_block(app, "reminderRecipientRows")

    assert 'const SELF_CONTACT_ID = "contact-me";' in app
    assert "const active = reminders.filter(reminder => reminderIsActive(reminder));" in reminders_page
    assert "const snoozed = reminders.filter(reminder => reminderIsSnoozed(reminder));" in reminders_page
    assert 'page.append(lightReminderListSection("", active, "active"));' in reminders_page
    assert 'page.append(lightReminderListSection("Snoozed", snoozed, "snoozed"));' in reminders_page
    assert "light-reminder-history" not in reminders_page
    assert "&& !reminderIsSnoozed(reminder)" in reminder_active
    assert "lightSmallIcon(\"bell\", \"reminders\")" in reminder_row
    assert "light-graph-chip-row" not in reminder_row
    assert 'const page = lightPage("Reminder", { detail: true });' in reminder_detail
    assert "page.append(lightReminderDetailCard(reminder));" in reminder_detail
    assert 'page.append(lightReminderActionRow(reminder));' not in reminder_detail
    assert 'el("h1", "", reminder.title)' not in reminder_detail
    assert 'lightReminderStatusRow(reminder)' in reminder_detail_card
    assert '`Status: ${reminderStatusLabel(reminder)}`' in reminder_status_row
    assert '`Delivery: ${reminderDeliveryLabel(reminder)}`' in reminder_status_row
    assert 'el("p", "light-reminder-detail-summary", summary)' in reminder_detail_card
    assert 'page.append(lightInfoSection("Schedule", reminderDetailRows(reminder)));' in reminder_detail
    assert 'page.append(lightInfoSection("Recipients", recipientRows));' in reminder_detail
    assert 'channels.classList.add("light-reminder-channels-section");' in reminder_detail
    assert 'const notes = lightLinkedNotesSection(reminder);' in reminder_detail
    assert 'const linkedRows = lightLinkedRecordRows(reminder, { excludeKinds: ["note"] });' in reminder_detail
    assert 'page.append(lightInfoSection("Linked records", linkedRows));' in reminder_detail
    assert "lightHtmlDocument(reminder" not in reminder_detail
    assert 'const me = workspaceRecordByKind("contact", SELF_CONTACT_ID);' in recipient_name
    assert 'target: workspaceTargetForKind("contact", recipient.kind === "self" ? SELF_CONTACT_ID' in recipient_rows
    assert ".light-reminder-detail-card" in styles
    assert ".light-reminder-channels-section" in styles


def test_contacts_preserve_me_contact_without_frontend_edit_action() -> None:
    app = read("app.js")
    styles = read("styles.css")
    contacts_page = function_block(app, "lightContactsPage")
    contact_detail = function_block(app, "lightContactDetailPage")
    contact_profile_card = css_block(styles, ".light-contact-detail-page .light-profile-card")

    assert 'const SELF_CONTACT_ID = "contact-me";' in app
    assert "function contactIsSelf(contact)" in app
    assert "function contactsListItems()" in app
    assert "function buildEditableContactEndpoints(existingEndpoints, emailValue, phoneValue)" not in app
    assert '"contact-edit"' not in app
    assert "list.append(...contactsListItems().map(contact => {" in contacts_page
    assert 'const page = lightPage("Contact", { detail: true });' in contact_detail
    assert 'page.classList.add("light-contact-detail-page");' in contact_detail
    assert 'const hero = el("section", "light-profile-card");' in contact_detail
    assert 'hero.append(lightAvatar(contact, "large"), el("h1", "", contact.title), el("p", "", contact.summary));' in contact_detail
    assert "lightHtmlDocument(contact" not in contact_detail
    assert "No generated contact page yet." not in contact_detail
    assert 'lightInfoSection("Endpoints"' not in contact_detail
    assert "meta.endpoints" not in contact_detail
    assert 'const notes = lightLinkedNotesSection(contact);' in contact_detail
    assert 'const linkedRows = lightLinkedRecordRows(contact, { excludeKinds: ["note"] });' in contact_detail
    assert "lightHtmlDocument(contact" not in contact_detail
    assert 'action: lightCircleButton(' not in contact_detail
    assert "Reminder device" not in contact_detail
    assert "lightContactEditPage" not in app
    assert "background: transparent;" in contact_profile_card
    assert "border: 0;" in contact_profile_card
    assert "box-shadow: none;" in contact_profile_card
    assert "border-radius: 0;" in contact_profile_card
