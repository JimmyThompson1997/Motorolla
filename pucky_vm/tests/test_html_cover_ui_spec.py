from __future__ import annotations

import json
import re
from pathlib import Path

from pucky_vm.cover_fixtures import load_deploy_fixture, runtime_fixture_from_deploy


ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "ui_src"


def read(name: str) -> str:
    return (UI / name).read_text(encoding="utf-8")


def deploy_fixture() -> dict:
    return load_deploy_fixture(UI / "fixtures" / "reply_cards_deploy.json")


def runtime_fixture() -> dict:
    return runtime_fixture_from_deploy(deploy_fixture())


def runtime_fixture_text() -> str:
    return json.dumps(runtime_fixture(), indent=2, sort_keys=False)


def css_block(styles: str, selector: str) -> str:
    match = re.search(rf"{re.escape(selector)}\s*\{{(?P<body>.*?)\n\}}", styles, re.S)
    assert match, f"Missing CSS selector {selector}"
    return match.group("body")


def top_level_css_block(styles: str, selector: str) -> str:
    match = re.search(rf"(?m)^{re.escape(selector)}\s*\{{(?P<body>.*?)^\}}", styles, re.S)
    assert match, f"Missing top-level CSS selector {selector}"
    return match.group("body")


def assert_css_block_omits_properties(body: str, *properties: str) -> None:
    for prop in properties:
        assert not re.search(rf"(?m)^\s*{re.escape(prop)}\s*:", body), f"Unexpected CSS property {prop}"


def function_block(source: str, name: str) -> str:
    match = re.search(rf"function {re.escape(name)}\([^)]*\)\s*\{{(?P<body>.*?)\n  \}}", source, re.S)
    assert match, f"Missing function {name}"
    return match.group("body")


def test_html_ui_uses_bundled_material_icon_registry() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "const MATERIAL_SYMBOLS" in app
    assert "function iconSvg(" in app
    assert "function replyCardIconSvg(" in app
    assert "function loadCardIconRegistry(" in app
    assert 'fetch(`${linksApiBaseUrl()}/api/card-icons`' in app
    assert "const ICONS = {" not in app
    assert "stroke-width: 2.8" not in styles
    assert ".material-icon" in styles


def test_top_tabs_are_visible_icon_pages_with_links_shell() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")

    assert 'id="pageTabs"' in html
    assert 'id="routeTray"' in html
    assert "const RETRO_TAB_SYMBOLS" not in app
    assert "function topIconSvg(" not in app
    assert "const PAGE_TABS" in app
    assert "renderTabs()" in app
    assert 'button.innerHTML = iconSvg(tab.icon, { filled: false });' in app
    assert 'route: "feed"' in app
    assert 'icon: "mailbox"' not in app
    assert 'icon: "mail"' in app
    assert 'label: "Home"' in app
    assert '{ route: "feed", icon: "mail", label: "Home" },\n    { route: "links", icon: "link", label: "Connect" },\n    { route: "meetings", icon: "mic", label: "Meetings" }' in app
    assert "link:" in app
    assert 'route: "links"' in app
    assert 'icon: "link"' in app
    assert 'label: "Connect"' in app
    assert 'route: "meetings"' in app
    assert 'icon: "mic"' in app
    assert 'label: "Meetings"' in app
    assert 'route: "settings"' in app
    assert 'icon: "settings"' in app
    assert 'label: "Settings"' in app
    assert 'route: "map"' not in app
    assert 'icon: "map"' not in app
    assert 'route: "morning"' in app
    assert 'icon: "coffee"' in app
    assert 'route: "calls"' in app
    assert 'icon: "phone"' in app
    assert 'route: "messages"' not in app
    assert 'route: "sensors"' not in app
    assert "placeholder-page" in app
    assert "linksPageView()" in app
    assert "meetingsPageView()" in app
    assert "function linksPageView()" in app
    assert "function meetingsPageView(options = {})" in app
    assert 'if (state.route === "links")' in app
    assert "homeShellCanonicalView(route, lightAppsPage())" in app
    assert 'feed.replaceChildren(meetingsPageView());' in app
    assert 'if (feed.firstElementChild !== page || feed.childElementCount !== 1) {' in app
    assert "links-portal-frame" not in app
    assert "loadLinksPortal({ render: true });" in app
    assert '"/api/links/composio/portal-url"' in app
    assert 'const config = await Pucky.request({ command: "pucky.config.get", args: {} });' in app
    assert "state.links.apiBaseUrl = String(config && config.api_base_url || \"\").replace(/\\/$/, \"\");" in app
    assert "init.headers.Authorization = `Bearer ${state.links.apiToken}`;" in app
    assert 'state.links.token = payload.token;' in app
    assert "const LINKS_ROW_HEIGHT = 62;" in app
    assert "const LINKS_WINDOW_OVERSCAN = 8;" not in app
    assert "async function loadLinksCatalog(options = {})" not in app
    assert '`/api/links/composio/catalog?token=${encodeURIComponent(state.links.token)}`' not in app
    assert "window.location.assign(href);" not in app
    assert "Connect did not return a valid auth URL." in app
    assert "Opened " not in app
    assert "linksHandoffLocked()" in app
    assert "window.__PUCKY_LINKS_DEBUG__" in app
    assert 'console.info("links.telemetry", entry);' in app
    assert "startLinksHandoff(slug);" in app
    assert 'releaseLinksHandoff({ render: false, reason: "error" });' in app
    assert "state.links.handoffLocked = true;" in app
    assert "state.links.handoffLocked = false;" in app
    assert "state.links.handoffDeadlineAt = Date.now() + LINKS_BROWSER_HANDOFF_LOCK_MS;" in app
    assert 'state.links.openingSlug !== slug || document.visibilityState === "hidden"' not in app
    assert 'el("h1", "links-title", "Links")' not in app
    assert "Quick search. Tap an app to open the Composio connect flow." not in app
    assert "configuredLinksUrl()" not in app
    assert ".page-tabs" in styles
    assert "display: flex" in styles
    assert ".header" in styles
    assert "height: 45px" in styles
    assert "flex: 0 0 45px" in styles
    assert "padding: 0 8px" in styles
    assert ".retro-tab-icon" not in styles
    assert "shape-rendering: crispEdges" not in styles
    assert ".tab.is-active .material-icon" in styles
    assert ".tab:not(.is-active) .material-icon" in styles
    assert ".links-page" in styles
    assert ".meetings-page" in styles
    assert ".meeting-row" in styles
    assert ".links-portal-frame" not in styles
    assert ".links-shell" not in styles
    assert ".links-title" not in styles
    assert ".links-subtitle" not in styles
    assert ".links-app-icon" in styles
    assert ".links-app-auth" in styles
    assert ".links-app-mark.is-connected" in styles
    assert ".links-open-button" in styles
    assert ".links-search" in styles
    assert ".links-loading-footer" not in styles
    assert ".feed.is-links-route" in styles
    assert ".links-page.is-handoff-lock" in styles
    assert ".links-app-row.is-opening" in styles
    assert "@keyframes linksHandoffPulse" in styles
    assert ".links-filter" not in styles
    assert ".links-app-row" in styles
    assert "min-height: 52px" in styles
    assert "min-height: 62px" in styles
    assert "font-size: 17px" in styles
    assert ".links-list-spacer" not in styles
    assert ".links-list-scrollport" in styles
    assert ".links-list-rows" in styles
    search_wrap = css_block(styles, ".links-search-wrap")
    assert "padding: 0 16px;" in search_wrap
    assert "position: sticky;" in search_wrap
    assert "top: 0;" in search_wrap
    search_input = css_block(styles, ".links-search")
    assert "min-height: 50px;" in search_input
    assert "font-size: 17px;" in search_input
    active_tab_icon = css_block(styles, ".tab.is-active .material-icon")
    assert "fill: none;" in active_tab_icon
    assert "stroke: currentColor;" in active_tab_icon
    app_row = css_block(styles, ".links-app-row")
    assert "position: absolute;" not in app_row
    assert "grid-template-columns: 30px minmax(0, 1fr) auto 18px;" in app_row
    assert "padding: 0 16px;" in app_row
    icon_block = css_block(styles, ".links-app-icon")
    assert "width: 28px;" in icon_block
    assert "height: 28px;" in icon_block
    assert "border-radius: 8px;" in icon_block
    name_block = css_block(styles, ".links-app-name")
    assert "font-size: 16px;" in name_block
    auth_block = css_block(styles, ".links-app-auth")
    assert "font-size: 12px;" in auth_block
    assert 'src="./pucky-config.js"' in html


def test_links_rows_use_static_logo_paths_without_initial_fallback() -> None:
    app = read("app.js")
    styles = read("styles.css")

    row = function_block(app, "createLinksRow")
    normalizer = function_block(app, "normalizeLinksApp")
    assert "app.logo_path" in row
    assert "links-app-logo" in row
    assert 'img.src = String(app.logo_path || "");' in row
    assert 'logo_path: String(item && item.logo_path || "").trim(),' in normalizer
    assert "links-app-fallback" not in app
    assert "linksAppInitial" not in app

    icon_block = css_block(styles, ".links-app-icon")
    assert "overflow: hidden;" in icon_block
    assert ".links-app-logo" in styles


def test_links_route_uses_local_catalog_and_query_route_restore() -> None:
    html = read("index.html")
    app = read("app.js")

    assert 'src="./pucky-links-catalog.js"' in html
    assert "window.PUCKY_BUNDLE_CONFIG" in app
    assert "function bundleConfig()" in app
    assert "function bundleUiVersion()" in app
    assert "ui_version: bundleUiVersion()" in app
    assert 'ui_version: "browser_preview"' not in app
    assert 'return "https://www.klavis.ai/home";' not in app
    assert 'BUNDLE_CONFIG.links_url' not in app
    assert "window.PUCKY_LINKS_CATALOG" in app
    assert 'fetch(`${linksApiBaseUrl()}${path}`' in app
    assert "loadLinksPortal({ render: true });" in app
    assert "function routeQueryParam()" in app
    assert "const queryRoute = routeQueryParam();" in app
    assert "return resolveRequestedRouteState(queryRoute);" in app
    assert '"/api/links/composio/portal-url"' in app
    assert '`/api/links/composio/catalog?token=${encodeURIComponent(state.links.token)}`' not in app
    assert '/api/links/composio/oauth/start?token=${encodeURIComponent(state.links.token)}' in app
    assert '"catalog_loaded_from_bundle"' in app
    assert '"catalog_start"' not in app
    assert '"catalog_end"' not in app
    assert '"full_catalog_hydrated"' not in app
    assert '"oauth_start_start"' in app
    assert '"oauth_start_end"' in app
    assert '"browser_open_requested"' in app
    assert '"document_hidden"' in app
    assert 'command: "browser.open"' in app
    assert "Browser handoff failed." in app
    assert "button.disabled = linksHandoffLocked();" in app
    assert "refs.search.disabled = handoffLocked;" in app
    assert "row.disabled = handoffLocked;" in app
    assert "const connectedPromise = loadLinksConnected({ render: false })" not in app
    assert "await loadLinksConnected({ render: false, force: Boolean(options.force) });" in app
    assert "void hydrateLinksSession({ render: false });" in app
    assert "await loadLinksCatalog({ render: false });" not in app
    assert "state.links.totalAvailable = 0;" in app
    assert "state.links.catalogVersion = \"\";" in app
    assert "state.links.catalogGeneratedAt = \"\";" in app
    assert "state.links.catalogSource = \"bundle\";" in app
    assert "const onSearchInput = () => {" in app
    assert 'scrollport.id = "linksScrollport";' in app
    assert "scrollport.scrollTop = 0;" in app
    assert "noteLinksScrollActivity();" not in app
    assert "linksVisibleRange(" not in app
    assert "refs.topSpacer.style.height =" not in app
    assert "refs.bottomSpacer.style.height =" not in app
    assert 'feed.classList.toggle("is-links-handoff-locked", linksHandoffLocked())' not in app
    assert 'linksPageRefs.page.classList.toggle("is-handoff-lock", linksHandoffLocked());' in app
    assert 'linksPageRefs.scrollport.classList.toggle("is-handoff-lock", linksHandoffLocked());' in app
    assert "window.location.assign(payload.portal_url);" not in app
    assert '"/api/links/apps"' not in app
    assert '"/api/links/status"' not in app
    assert '"/api/links/connect"' not in app


def test_native_light_mode_defaults_to_canonical_routes_and_parks_walkthrough_preview() -> None:
    html = read("index.html")
    app = read("app.js")
    styles = read("styles.css")

    assert "const THEME_STATE_KEY = \"pucky.cover.theme.v1\"" in app
    assert "const LIGHT_APPS = [" in app
    assert "const LIGHT_ROUTES = new Set([" in app
    assert 'route: "notes"' in app
    assert 'route: "tasks"' in app
    assert 'route: "calendar"' in app
    assert 'route: "feed"' in app
    assert 'route: "projects"' in app
    assert 'route: "contacts"' in app
    assert '{ route: "links", label: "Connect"' in app
    assert '{ route: "meetings", label: "Meetings"' in app
    assert '{ route: "meeting-capture", label: "Meetings"' not in app
    assert '{ route: "apps", label: "Apps"' not in app
    assert "theme: initialTheme" in app
    assert "homeShellActive: initialHomeShellActiveValue" in app
    assert "lightReturnRoute: \"\"" in app
    assert "previousLightRoute:" in app
    assert "selectedContactId:" in app
    assert "selectedMeetingId:" in app
    assert "selectedNoteId:" in app
    assert "selectedTaskId:" in app
    assert "selectedProjectId:" in app
    assert "selectedFeedId:" in app
    assert "selectedCalendarDate:" in app
    assert "taskFilter:" in app
    assert "function resolveInitialTheme()" in app
    assert "function syncThemeQueryParam(theme)" in app
    assert "function isWalkthroughPreview()" in app
    assert 'params.get("preview") === "walkthrough"' in app
    assert "function normalizeHomeShellRoute(route)" in app
    assert "function initialHomeShellActive(route, theme = \"dark\")" in app
    assert "function resolveInitialRouteState(route, theme = \"dark\")" in app
    assert "function resolveRequestedRouteState(routeValue)" in app
    assert "function resolveRouteForTheme(route, theme = state.theme)" in app
    assert "function effectiveRoute()" in app
    assert "function effectiveTheme()" in app
    assert "function handlePageTabRoute(routeValue)" in app
    assert "function installPageTabNavigation()" in app
    assert "function usesHomeFeedRoute(" in app
    assert "function embeddedLightApp()" in app
    assert "function chromeMode()" in app
    assert "function isHomeShellMockRoute(route = state.route)" in app
    assert "function isHomeShellCanonicalRoute(route = effectiveRoute())" in app
    assert "function isHomeShellRoute(route = state.route)" in app
    assert "function isLightShellRoute()" in app
    assert "function lightView()" in app
    assert "function lightHomePage()" in app
    assert "function lightNavigate(route" in app
    assert "function lightAppsPage()" in app
    assert "function lightSettingsSurface()" in app
    assert "function lightInboxPage()" in app
    assert "function lightMeetingsPage()" in app
    assert "function homeFeedContentNodes()" in app
    assert "function lightRealFeedPage(" not in app
    assert "function lightNotesPage()" in app
    assert "function lightNoteDetailPage()" in app
    assert "function lightTasksPage()" in app
    assert "function lightTaskDetailPage()" in app
    assert "function lightCalendarPage()" in app
    assert "function lightMeetingDetailPage()" in app
    assert "function lightFeedPage()" in app
    assert "function lightFeedDetailPage()" in app
    assert "function lightProjectsPage()" in app
    assert "function lightProjectDetailPage()" in app
    assert "function lightContactsPage()" in app
    assert "function lightContactDetailPage()" in app
    assert "function lightNotificationsPage()" not in app
    assert "function lightNotificationDetailPage()" not in app
    assert "function lightDigestView()" not in app
    assert "notificationDigestItems" not in app
    assert "lightMeetingCapturePage" not in app
    assert "lightNavigate(\"meeting-capture\"" not in app
    assert 'if (isHomeShellMockRoute()) {' in app
    assert "feed.replaceChildren(lightView());" in app
    assert 'return resolveInitialRouteState(route, theme).route;' in app
    assert 'return resolveInitialRouteState(route, theme).homeShellActive;' in app
    assert 'if (value === "apps") {' in app
    assert 'if (value === "inbox") {' in app
    assert "appearanceSettingsCard()" in app
    assert 'settingId: "appearance"' in app
    assert 'title: "Appearance"' in app
    assert 'function setThemePreference(theme)' in app
    assert 'state.theme = nextTheme;' in app
    assert 'persistTheme(nextTheme);' in app
    assert 'syncThemeQueryParam(nextTheme);' in app
    assert 'case "feed-preview":' in app
    assert 'view.append(lightFeedPage())' in app
    assert 'case "feed-preview-detail":' in app
    assert 'view.append(lightFeedDetailPage())' in app
    assert 'case "note-detail":' in app
    assert 'case "task-detail":' in app
    assert 'case "meeting-detail":' in app
    assert 'case "project-detail":' in app
    assert 'case "contact-detail":' in app
    assert 'case "notifications":' not in app
    assert 'case "notification-detail":' not in app
    assert 'homeShellCanonicalView(route, lightAppsPage())' in app
    assert "lightLinksPage" not in app
    assert "lightPrototypePage" not in app
    assert "function lightStatusBar()" not in app
    assert ".light-status-" not in styles
    assert ".light-digest" not in styles
    assert ".light-capture" not in styles
    assert ".light-links" not in styles
    assert ".light-apps-page" in styles
    assert ".light-settings-surface" in styles
    assert ".light-canonical-port-page" in styles
    assert ".light-canonical-port-surface" in styles
    assert ".meetings-embedded-toolbar" in styles
    assert ".light-real-feed-page" not in styles
    assert ".light-real-feed-list" not in styles
    assert ".light-meetings-page" in styles
    assert ".light-shell" in styles
    assert ".light-app-tile" in styles
    assert ".light-tasks-page" in styles
    assert ".light-calendar-page" in styles
    assert ".light-document-page" in styles
    assert ".light-project-row" in styles
    assert ".light-contact-row" in styles
    assert ".app-shell[data-theme=\"light\"] {" in styles
    assert ".app-shell[data-chrome-mode=\"home-shell\"] .header" in styles
    assert "--surface-app:" in styles
    assert "--surface-card:" in styles
    assert "--text-primary:" in styles
    assert "--icon-card-neutral:" in styles
    assert "--icon-card-identity-unread:" in styles
    assert "--icon-card-action-active:" in styles
    assert "--shadow-card:" in styles
    assert ".app-shell[data-theme=\"light\"] .settings-page" not in styles
    assert ".app-shell[data-theme=\"light\"] .links-page" not in styles
    assert ".app-shell[data-theme=\"light\"] .card" not in styles
    assert ".app-shell[data-theme=\"light\"] .detail-panel" not in styles
    assert ".app-shell[data-theme=\"light\"] .tab.is-active" not in styles
    assert ".app-shell[data-theme=\"light\"] .route-tray-shell" not in styles
    assert ".app-shell[data-theme=\"light\"] .header,\n.app-shell[data-theme=\"light\"] .page-tabs,\n.app-shell[data-theme=\"light\"] .route-tray {\n  display: none;\n}" not in styles
    assert 'data-voice-status' in html
    assert "renderVoiceStatus()" in app
    assert "installPageTabNavigation();" in app
    assert ".voice-status" in styles
    assert "function linksPageView()" in app
    assert "loadLinksPortal({ render: true });" in app


def test_native_light_mode_reuses_canonical_surfaces_and_limits_walkthrough_to_preview() -> None:
    app = read("app.js")
    styles = read("styles.css")

    render_feed = function_block(app, "renderFeed")
    render_tabs = function_block(app, "renderTabs")
    tab_view = function_block(app, "tabView")
    handle_tab_route = function_block(app, "handlePageTabRoute")
    install_tab_navigation = function_block(app, "installPageTabNavigation")
    render_route_tray = function_block(app, "renderRouteTray")
    handle_back = function_block(app, "handleAndroidBack")
    initial_route = function_block(app, "initialRoute")
    resolve_route = function_block(app, "resolveRouteForTheme")
    effective_route = function_block(app, "effectiveRoute")
    effective_theme = function_block(app, "effectiveTheme")
    sync_theme_query = function_block(app, "syncThemeQueryParam")
    uses_home_feed = function_block(app, "usesHomeFeedRoute")
    embedded_light_app = function_block(app, "embeddedLightApp")
    chrome_mode = function_block(app, "chromeMode")
    walkthrough_preview = function_block(app, "isWalkthroughPreview")
    appearance_settings = function_block(app, "appearanceSettingsCard")
    set_theme = function_block(app, "setThemePreference")
    light_apps = function_block(app, "lightAppsPage")
    light_settings = function_block(app, "lightSettingsSurface")
    light_inbox = function_block(app, "lightInboxPage")
    light_meetings = function_block(app, "lightMeetingsPage")
    home_feed_content = function_block(app, "homeFeedContentNodes")
    light_navigate = function_block(app, "lightNavigate")
    light_tasks = function_block(app, "lightTasksPage")
    light_task_sections = function_block(app, "lightTaskSectionTitle")
    light_task_counts = function_block(app, "lightTaskCounts")
    light_task_count_line = function_block(app, "lightTaskCountLine")
    light_task_filters = function_block(app, "lightTaskFilters")
    filtered_tasks = function_block(app, "filteredTasks")
    light_back = function_block(app, "lightBack")
    filtered_feed_cards = function_block(app, "filteredFeedCards")
    desired_thread_scope = function_block(app, "desiredThreadScope")
    light_theme_block = css_block(styles, '.app-shell[data-theme="light"]')
    app_shell_block = css_block(styles, ".app-shell")
    tab_block = css_block(styles, ".tab")
    active_tab_block = css_block(styles, ".tab.is-active")
    route_tray_block = css_block(styles, ".route-tray-shell")
    settings_selector_button_block = css_block(styles, ".settings-selector-button")
    links_search_placeholder_block = css_block(styles, ".links-search::placeholder")
    card_block = top_level_css_block(styles, ".card")
    timestamp_block = css_block(styles, ".card-timestamp")
    identity_unread_block = css_block(styles, ".identity.is-unread")
    action_unread_block = css_block(styles, ".action.is-unread")
    action_block = css_block(styles, ".action")
    action_playing_block = css_block(styles, ".action-audio.is-playing")
    detail_header_block = css_block(styles, ".detail-header")
    meeting_row_block = css_block(styles, ".meeting-row")
    task_row_blocks = re.findall(r"\.light-task-row[^\\{]*\{(?P<body>.*?)\n\}", styles, re.S)
    task_row_base_block = None
    for block in task_row_blocks:
      if "min-height: 54px;" in block:
        task_row_base_block = block
        break
    assert task_row_base_block, "Missing .light-task-row base CSS block"

    assert 'const route = effectiveRoute();' in render_feed
    assert 'const theme = effectiveTheme();' in render_feed
    assert 'shell?.setAttribute("data-view", state.route || "feed");' in render_feed
    assert 'shell?.setAttribute("data-theme", theme);' in render_feed
    assert 'shell?.setAttribute("data-canonical-route", route || "feed");' in render_feed
    assert 'shell?.setAttribute("data-embedded-app", embeddedLightApp());' in render_feed
    assert 'shell?.setAttribute("data-chrome-mode", chromeMode());' in render_feed
    assert 'if (isHomeShellMockRoute()) {' in render_feed
    assert 'if (isHomeShellCanonicalRoute(route)) {' in render_feed
    assert 'if (route === "settings") {' in render_feed
    assert 'if (route === "links") {' in render_feed
    assert 'if (route === "meetings") {' in render_feed
    assert 'if (route !== "feed") {' in render_feed
    assert render_feed.index('if (isHomeShellMockRoute()) {') < render_feed.index('if (route === "settings") {')
    assert 'feed.classList.toggle("is-links-route", route === "links");' in render_feed

    assert 'if (isHomeShellRoute()) {' in render_tabs
    assert 'tabs.hidden = true;' in render_tabs
    assert 'tabs.hidden = false;' in render_tabs
    assert 'tabs.replaceChildren(...PAGE_TABS.map(tabView));' in render_tabs
    assert 'button.dataset.route = tab.route;' in tab_view
    assert 'button.addEventListener("click"' not in tab_view
    assert 'const route = effectiveRoute();' in handle_tab_route
    assert 'const nextTabRoute = String(routeValue || "").trim();' in handle_tab_route
    assert 'if (!nextTabRoute || linksHandoffLocked()) {' in handle_tab_route
    assert 'state.route = nextTabRoute;' in handle_tab_route
    assert 'persistNavState();' in handle_tab_route
    assert 'render();' in handle_tab_route
    assert 'linksDebugStartSession("route", { reason: "route_open" });' in handle_tab_route
    assert 'loadLinksPortal({ render: true });' in handle_tab_route
    assert 'loadMeetings({ render: true });' in handle_tab_route
    assert 'loadSettingsState({ render: true });' in handle_tab_route
    assert 'state.homeShellActive = false;' in handle_tab_route
    assert 'tabs.dataset.routeBound = "true";' in install_tab_navigation
    assert 'tabs.addEventListener("click", event => {' in install_tab_navigation
    assert 'target.closest(".tab[data-route]")' in install_tab_navigation
    assert 'handlePageTabRoute(button.getAttribute("data-route") || "");' in install_tab_navigation
    assert 'if (isHomeShellRoute()) {' in render_route_tray
    assert 'tray.hidden = true;' in render_route_tray
    assert 'if (route !== "feed" || state.openTrayRoute !== "feed") {' in render_route_tray
    assert 'return params.get("preview") === "walkthrough";' in walkthrough_preview

    assert 'return resolveInitialRouteState(route, theme).route;' in initial_route
    assert 'if (PAGE_TABS.some(tab => tab.route === value)) {' in resolve_route
    assert 'return normalizeHomeShellRoute(value) || "home";' in resolve_route

    assert 'settingId: "appearance"' in appearance_settings
    assert 'title: "Appearance"' in appearance_settings
    assert 'valueLabel: appearanceThemeLabel(currentTheme)' in appearance_settings
    assert '{ value: "dark", label: "Dark" }' in appearance_settings
    assert '{ value: "light", label: "Light" }' in appearance_settings
    assert 'const nextTheme = normalizeTheme(theme) || "dark";' in set_theme
    assert 'const nextRoute = resolveRouteForTheme(state.route, nextTheme);' in set_theme
    assert 'state.theme = nextTheme;' in set_theme
    assert 'persistTheme(nextTheme);' in set_theme
    assert 'syncThemeQueryParam(nextTheme);' in set_theme
    assert 'persistNavState();' in set_theme
    assert 'render();' in set_theme

    assert 'const url = new URL(window.location.href || "");' in sync_theme_query
    assert 'url.searchParams.set("theme", normalizeTheme(theme) || "dark");' in sync_theme_query
    assert 'window.history.replaceState(window.history.state || null, "", `${url.pathname}${url.search}${url.hash}`);' in sync_theme_query

    assert "linksPageView()" in light_apps
    assert "loadLinksPortal({ render: true });" in app
    assert "syncLinksPage();" in app
    assert "function hydrateBundledLinksCatalog" in app
    assert "startLinksHandoff(slug);" in app
    assert "window.__PUCKY_LINKS_DEBUG__" in app
    assert "settingsPageView()" in light_settings
    assert "homeFeedContentNodes()" in light_inbox
    assert 'surface.append(meetingsPageView({ embedded: true }));' in light_meetings
    assert "filteredFeedCards()" in home_feed_content
    assert "cards.map(cardView)" in home_feed_content
    assert "renderHomeFeedInto(feed);" in render_feed
    assert "Real Home tiles will appear here." not in app
    assert "lightInboxCardView" not in app
    assert 'return state.route;' in effective_route
    assert 'return state.theme;' in effective_theme
    assert 'return value === "feed";' in uses_home_feed
    assert 'if (!isHomeShellCanonicalRoute(value)) {' in embedded_light_app
    assert 'if (value === "feed") return "inbox";' in embedded_light_app
    assert 'if (value === "links") return "connect";' in embedded_light_app
    assert 'return isHomeShellRoute() ? "home-shell" : "canonical";' in chrome_mode
    assert "canonicalLaunchForRoute" not in app
    assert "activeCanonicalLaunch" not in app
    assert "handleCanonicalLaunchBack" not in app
    assert "state.canonicalLaunch" not in app
    assert 'const nextRoute = normalizeHomeShellRoute(route' in light_navigate
    assert 'state.homeShellActive = true;' in light_navigate
    assert 'if (state.route === "meetings") {' in light_navigate
    assert "loadMeetings({ render: true });" in light_navigate
    assert 'if (handleCanonicalLaunchBack()) {' not in handle_back
    assert 'if (state.route === "inbox") {' not in filtered_feed_cards
    assert 'if (!usesHomeFeedRoute()) {' in desired_thread_scope

    assert '"DUE SOON"' in light_tasks
    assert 'counts.dueSoon' in light_task_counts
    assert '"light-task-count due-soon"' in light_task_count_line
    assert '`${counts.dueSoon} due soon`' in light_task_count_line
    assert 'lightSectionTitle("DO")' in light_task_sections
    assert 'lightSectionTitle("DUE SOON")' in light_task_sections
    assert 'lightSectionTitle("OVERDUE")' in light_task_sections
    assert 'lightSectionTitle("DONE")' in light_task_sections
    assert '["soon", "Due Soon"]' in light_task_filters
    assert 'state.taskFilter === key' in light_task_filters
    assert 'state.taskFilter === "soon" && taskGroup === "soon"' in filtered_tasks
    assert 'lightNavigate("note-detail", { from: "notes" })' in app
    assert 'lightNavigate("task-detail", { from: "tasks" })' in app
    assert 'lightNavigate("meeting-detail", { from: "calendar" })' in app
    assert 'lightNavigate("feed-preview-detail", { from: "feed-preview" })' in app
    assert 'lightNavigate("project-detail", { from: "projects" })' in app
    assert 'lightNavigate("contact-detail", { from: "contacts" })' in app

    assert 'if (isHomeShellRoute() && lightBack()) {' in handle_back
    assert 'state.route = parent === state.route ? "home" : parent;' in light_back
    assert ".light-shell[data-light-route=\"meetings\"] .meetings-page" in styles
    assert "color: var(--text-primary);" in app_shell_block
    assert "background: var(--surface-app);" in app_shell_block
    assert "background: transparent;" in tab_block
    assert "color: var(--icon-primary);" in tab_block
    assert "background: var(--surface-control-strong);" in active_tab_block
    assert "color: var(--icon-primary);" in active_tab_block
    assert "background: var(--surface-card-elevated);" in route_tray_block
    assert "background: var(--surface-control);" in settings_selector_button_block
    assert "color: var(--text-placeholder);" in links_search_placeholder_block
    assert "background: var(--surface-card);" in card_block
    assert "box-shadow: var(--shadow-card);" in card_block
    assert "color: var(--text-primary);" in card_block
    assert "color: var(--text-muted-strong);" in timestamp_block
    assert "color: var(--icon-card-identity-unread);" in identity_unread_block
    assert "color: var(--icon-card-action-unread);" in action_unread_block
    assert "color: var(--icon-card-neutral);" in action_block
    assert "color: var(--icon-card-action-active);" in action_playing_block
    assert "background: var(--surface-header);" in detail_header_block
    assert "background: var(--surface-control);" in meeting_row_block
    assert ".light-task-row:active" in styles
    assert ".light-task-row:focus-visible" in styles
    assert 'appearance: none;' in task_row_base_block
    assert 'touch-action: manipulation;' in task_row_base_block
    assert "color-scheme: light;" in light_theme_block
    assert "--surface-app:" in light_theme_block
    assert "--text-primary:" in light_theme_block
    assert "--icon-card-neutral:" in light_theme_block
    assert_css_block_omits_properties(
        light_theme_block,
        "padding",
        "margin",
        "gap",
        "display",
        "position",
        "top",
        "right",
        "bottom",
        "left",
        "height",
        "min-height",
        "max-height",
        "width",
        "flex",
        "grid-template-columns",
        "grid-template-rows",
        "overflow",
        "transform",
    )
    assert "--icon-card-identity-unread:" not in light_theme_block
    assert "--icon-card-action-unread:" not in light_theme_block
    assert "--icon-card-action-active:" not in light_theme_block
    assert ".app-shell[data-chrome-mode=\"home-shell\"] .header" in styles
    assert ".app-shell[data-theme=\"light\"] .links-page" not in styles
    assert ".app-shell[data-theme=\"light\"] .card" not in styles
    assert ".app-shell[data-theme=\"light\"] .meetings-refresh" not in styles
    assert ".app-shell[data-theme=\"light\"] .chat-media" not in styles
    assert ".app-shell[data-theme=\"light\"] .audio-detail" not in styles
    assert ".app-shell[data-theme=\"light\"] .timestamp-row" not in styles
    assert "lightLinksPage" not in app
    assert "function loadLightLinks" not in app


def test_workspace_home_apps_use_vm_backed_records_and_generated_html() -> None:
    app = read("app.js")
    styles = read("styles.css")
    server = (ROOT / "server.py").read_text(encoding="utf-8")
    store = (ROOT / "workspace_store.py").read_text(encoding="utf-8")

    assert "class WorkspaceStore" in store
    assert '"notes": "note"' in store
    assert '"tasks": "task"' in store
    assert '"calendar-events": "calendar_event"' in store
    assert '"feed-items": "feed_item"' in store
    assert '"projects": "project"' in store
    assert '"contacts": "contact"' in store
    assert "def derive_task_group(" in store
    assert 'return "overdue"' in store
    assert 'return "soon"' in store
    assert "default_workspace_records" in store
    assert '"Design critique overlap"' in store
    assert '"calendar_change"' in store
    assert '"note_update"' in store
    assert '"threads": ["PRD review thread", "Budget approval DM"]' in store
    assert '"threads": ["Migration update", "Tom objections", "Slack launch notes"]' in store
    assert '"target_kind": "calendar_event"' in store
    assert '"target_kind": "feed_item"' in store

    assert "WorkspaceStore" in server
    assert "workspace_db_path" in server
    assert "PUCKY_WORKSPACE_DB_PATH" in server
    assert 'path.startswith("/api/workspace/")' in server
    assert "def do_PATCH" in server
    assert "def do_DELETE" in server
    assert "service.workspace.list_records" in server
    assert "service.workspace.upsert_record" in server
    assert "service.workspace.patch_record" in server
    assert "service.workspace.create_asset" in server
    assert "service.workspace.upsert_link" in server
    assert "if not self._is_authorized()" in server

    assert "const WORKSPACE_ROUTE_COLLECTIONS = {" in app
    for route, collection in [
        ("notes", "notes"),
        ("note-detail", "notes"),
        ("tasks", "tasks"),
        ("task-detail", "tasks"),
        ("calendar", "calendar-events"),
        ("meeting-detail", "calendar-events"),
        ("feed-preview", "feed-items"),
        ("feed-preview-detail", "feed-items"),
        ("projects", "projects"),
        ("project-detail", "projects"),
        ("contacts", "contacts"),
        ("contact-detail", "contacts"),
    ]:
        assert f'{route}: "{collection}"' in app or f'"{route}": "{collection}"' in app

    assert "async function workspaceApiRequest" in app
    assert "async function loadWorkspaceCollection" in app
    assert "async function loadWorkspaceForRoute" in app
    assert "async function upsertWorkspaceRecord" in app
    assert "async function patchWorkspaceRecord" in app
    assert "async function loadWorkspaceAsset" in app
    assert "void loadWorkspaceForRoute(state.route, { render: true, force: true });" in app
    assert "WORKSPACE_TASK_REFRESH_MS" in app
    assert "loadWorkspaceCollection(\"tasks\", { render: true, force: true })" in app

    assert "const LIGHT_NOTES" not in app
    assert "const LIGHT_TASKS" not in app
    assert "const LIGHT_EVENTS" not in app
    assert "const LIGHT_FEED" not in app
    assert "const LIGHT_PROJECTS" not in app
    assert "const LIGHT_CONTACTS" not in app

    light_notes = function_block(app, "lightNotesPage")
    light_tasks = function_block(app, "lightTasksPage")
    light_calendar = function_block(app, "lightCalendarPage")
    light_date_picker = function_block(app, "lightDatePicker")
    light_timeline = function_block(app, "lightTimeline")
    light_feed = function_block(app, "lightFeedPage")
    light_projects = function_block(app, "lightProjectsPage")
    light_project_detail = function_block(app, "lightProjectDetailPage")
    light_contacts = function_block(app, "lightContactsPage")
    filtered_tasks = function_block(app, "filteredTasks")
    task_group = function_block(app, "lightTaskGroup")
    all_projects = function_block(app, "allProjects")
    note_detail = function_block(app, "lightNoteDetailPage")
    task_detail = function_block(app, "lightTaskDetailPage")
    event_detail = function_block(app, "lightMeetingDetailPage")
    feed_detail = function_block(app, "lightFeedDetailPage")
    contact_detail = function_block(app, "lightContactDetailPage")
    html_document = function_block(app, "lightHtmlDocument")

    assert 'workspaceItems("notes")' in light_notes
    assert 'lightWorkspaceStatus("notes"' in light_notes
    assert 'lightHtmlDocument(note' in note_detail
    assert 'filteredTasks(group)' in light_tasks
    assert 'const row = el("button", `light-task-row ${group}`);' in task_group
    assert 'row.type = "button";' in task_group
    assert 'row.dataset.taskId = task.id;' in task_group
    assert 'lightNavigate("task-detail", { from: "tasks" })' in task_group
    assert 'workspaceItems("tasks")' in filtered_tasks
    assert '"DUE SOON"' in light_tasks
    assert 'task.derived_group' in app
    assert 'patchWorkspaceRecord("tasks"' in app
    assert 'lightHtmlDocument(task' in task_detail
    assert 'selectedCalendarDateKey()' in light_date_picker
    assert 'lightWorkspaceStatus("calendar-events"' in light_calendar
    assert 'workspaceItems("calendar-events")' in light_timeline
    assert 'calendarEventHour(event)' in light_timeline
    assert "events.length > 1" in light_timeline
    assert "block.style.top" in light_timeline
    assert 'lightHtmlDocument(meeting' in event_detail
    assert 'workspaceItems("feed-items")' in light_feed
    assert 'metadata?.type' in feed_detail
    assert 'lightHtmlDocument(item' in feed_detail
    assert 'allProjects().map(project' in light_projects
    assert 'workspaceItems("projects")' in all_projects
    assert 'projectThreads(project)' in light_project_detail
    assert 'projectLinked(project, "task")' in light_project_detail
    assert 'projectLinked(project, "calendar_event")' in light_project_detail
    assert 'projectLinked(project, "feed_item")' in light_project_detail
    assert 'lightHtmlDocument(project' in light_project_detail
    assert 'upsertWorkspaceRecord("projects"' in app
    assert 'workspaceItems("contacts")' in light_contacts
    assert 'upsertWorkspaceRecord("contacts"' in app
    assert 'lightHtmlDocument(contact' in contact_detail

    assert 'frame.srcdoc = html;' in html_document
    assert 'loadWorkspaceAsset(assetId, { render: true })' in app
    assert ".light-html-card" in styles
    assert ".light-html-frame" in styles


def test_meetings_route_lists_recordings_and_opens_summary_first() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "function initialMeetingsState()" in app
    assert "meetings: initialMeetingsState()" in app
    assert "async function loadMeetings(options = {})" in app
    assert 'linksApiRequest("/api/meetings?compact=1", { cache: "no-store" })' in app
    assert "async function loadMeetingDetail(meeting)" in app
    assert "function meetingsApiErrorMessage(error" in app
    assert 'detail.replace(/^(Links|Connect) request failed/i, "Meetings request failed")' in app
    assert "function meetingsPageView(options = {})" in app
    assert "function meetingCardFromRecord(meeting)" in app
    assert "function isMeetingsListCard(card)" in app
    assert "function meetingListCardClass(card)" in app
    assert "showMeetingDetail(meeting)" in app
    assert "function meetingRowView(meeting)" not in app
    assert "function meetingRowPreview(meeting)" not in app
    assert "function meetingStateLabel(meeting)" not in app
    assert "function meetingSubtitleLegacy(meeting)" not in app
    meetings_page = function_block(app, "meetingsPageView")
    assert "visibleMeetingRecords().slice().reverse().map(meeting => cardView(meetingCardFromRecord(meeting)))" in meetings_page
    meeting_full_detail = function_block(app, "meetingHasFullDetail")
    assert "meetingState(meeting) !== \"completed\"" in meeting_full_detail
    assert "persistedAssistant" in meeting_full_detail
    assert "assistantAttachments.length > 0" in meeting_full_detail
    assert "function meetingPlayablePath(meeting)" in app
    assert "function isAndroidPlayableAudioPath(path)" in app
    assert "function preparedAudioFilename(" not in app
    assert "audio_path: meetingPlayablePath(card)" in app
    assert 'audio_url: String(card.audio_url || "")' in app
    meeting_card_from_record = function_block(app, "meetingCardFromRecord")
    assert 'read: true,' in meeting_card_from_record
    assert 'updated_at: String(card.updated_at || card.stopped_at || "")' in meeting_card_from_record
    assert 'render_profile: "meeting_list",' in meeting_card_from_record
    assert 'card.device_path || card.audio_path || card.audio_url' not in app
    assert 'value.startsWith("/data/pucky-src/")' in app
    assert "function meetingTranscriptSection(meeting)" in app
    assert "function meetingTranscriptAction(card)" in app
    assert 'return "View Transcript";' in function_block(app, "meetingTranscriptLabel")
    meeting_title = function_block(app, "meetingTitle")
    assert "recording_title" in meeting_title
    assert "card.title ||" not in meeting_title
    assert "function openMeetingSummaryDetail(meeting, options = {})" in app
    assert "function showMeetingAudioDetail(meeting)" in app
    card_view = function_block(app, "cardView")
    assert "const isMeetingList = isMeetingsListCard(card);" in card_view
    assert "meetingListCardClass(card)" in card_view
    assert 'const body = el("div", isMeetingList ? "card-body is-title-only" : "card-body");' in card_view
    assert "void showMeetingDetail(card.meeting_record);" in card_view
    assert "void showMeetingAudioDetail(card.meeting_record);" in card_view
    assert "if (!isMeetingList) {" in card_view
    assert 'applyCardActionData(body, isMeetingList ? "attachment" : "transcript", card, isMeetingList ? "meeting" : "reply");' in card_view
    assert 'applyCardActionData(audio, "audio", card, isMeetingList ? "meeting" : "reply");' in card_view
    assert 'if (card.html_path) {' in card_view
    assert 'showAttachmentViewer(card, attachmentInfo.attachments, { initialIndex: attachmentInfo.index });' in card_view
    assert 'if (!isMeetingList) {' in card_view
    resolve_artifact = function_block(app, "resolveArtifactUrl")
    assert 'const hasNativeBridge = Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");' in resolve_artifact
    assert 'const path = mediaPath(item);' in resolve_artifact
    assert "if (path && hasNativeBridge && isAndroidLocalArtifactPath(path)) {" in resolve_artifact
    assert 'const artifactId = attachmentArtifactId(item);' in resolve_artifact
    assert "const apiUrl = artifactApiUrl(artifactId);" in resolve_artifact
    assert 'return resolveLocalArtifactPath(path, item, options);' in resolve_artifact
    assert 'if (item.url) {' in resolve_artifact
    assert 'const bundled = bundledArtifactPath(item);' in resolve_artifact
    assert "async function resolveLocalArtifactPath(path, item, options = {})" in app
    first_attachment = function_block(app, "firstDisplayableAttachmentInfo")
    assert "const cardLevel = preferredDisplayAttachments(card, card?.attachments);" in first_attachment
    assert "const cardLevelHasMeetingAttachments = cardLevel.some(isMeetingAttachmentItem);" in first_attachment
    assert "if (cardLevelHasMeetingAttachments && cardLevel.length) {" in first_attachment
    assert "if (!cardLevelHasMeetingAttachments && cardLevel.length) {" in first_attachment
    meeting_summary_index = function_block(app, "meetingSummaryAttachmentIndex")
    assert 'return meetingAttachmentIndexByTitle(attachments, "Meeting Summary");' in meeting_summary_index
    meeting_record_attachments = function_block(app, "meetingRecordAttachments")
    assert 'title: "Meeting Summary"' in meeting_record_attachments
    assert 'title: "Transcript"' in meeting_record_attachments
    assert 'title: "Transcript (Plain Text)"' in meeting_record_attachments
    assert 'title: "Meeting Audio"' in meeting_record_attachments
    assert 'const audioUrl = signedAudioUrl || String(record.audio_url || "").trim();' in meeting_record_attachments
    assert 'viewer_url: transcriptHtmlUrl,' in meeting_record_attachments
    assert "function absolutizeAppUrl(url)" in app
    assert "async function resolveMeetingTranscriptLink(card, summaryItem = null)" in app
    assert "async function resolveMeetingAudioAttachmentLink(card, summaryItem = null)" in app
    assert "async function rewriteMeetingHtmlContent(htmlText, source = {}, options = {})" in app
    assert "{{PUCKY_MEETING_TRANSCRIPT_LINK}}" in app
    assert "{{PUCKY_MEETING_AUDIO_LINK}}" in app
    assert "function meetingTranscriptLinkHtml(href, label = \"Open Transcript\")" in app
    assert "function meetingAudioLinkHtml(href, label = \"Listen To Audio\")" in app
    assert "function installMeetingHtmlActionBridge(iframe, { card, attachments, summaryIndex } = {})" in app
    assert 'data-pucky-meeting-action="${escapeHtml(action)}"' in app
    assert 'target="_blank"' not in function_block(app, "meetingAudioLinkHtml")
    bridge = function_block(app, "installMeetingHtmlActionBridge")
    assert "iframe.addEventListener(\"load\", bind);" in bridge
    assert "bind();" in bridge
    assert "requestAnimationFrame(bind);" in bridge
    assert "event.target instanceof Element" not in bridge
    assert "target instanceof HTMLAnchorElement" not in bridge
    assert '["Transcript", "Transcript (Plain Text)", "Meeting Transcript HTML", "Meeting Transcript"]' in bridge
    html_rewrite = function_block(app, "rewriteMeetingHtmlContent")
    assert 'const audioHref = String(options.audioHref || "").trim();' in html_rewrite
    assert "await resolveMeetingAudioLink(source)" not in html_rewrite
    assert 'output = output.replace(/<a\\b[^>]*href=["\']\\{\\{PUCKY_MEETING_TRANSCRIPT_LINK\\}\\}["\'][^>]*>.*?<\\/a>/gi, transcriptReplacement);' in html_rewrite
    assert 'output = output.replace(/<a\\b[^>]*href=["\']\\{\\{PUCKY_MEETING_AUDIO_LINK\\}\\}["\'][^>]*>.*?<\\/a>/gi, replacement);' in html_rewrite
    assert 'const hasBrokenTranscriptLink = /<a\\b[^>]*href=["\']<a\\b[^>]*pucky-meeting-transcript-link\\b[^>]*>.*?<\\/a>["\'][^>]*>.*?<\\/a>/i.test(raw);' in html_rewrite
    assert 'const hasBrokenAudioLink = /<a\\b[^>]*href=["\']<a\\b[^>]*pucky-meeting-audio-link\\b[^>]*>.*?<\\/a>["\'][^>]*>.*?<\\/a>/i.test(raw);' in html_rewrite
    assert 'output = output.replace(/<a\\b[^>]*data-pucky-meeting-action=["\']transcript["\'][^>]*>.*?<\\/a>/gi, meetingTranscriptLinkHtml(transcriptHref));' in html_rewrite
    assert 'output = output.replace(/<a\\b[^>]*data-pucky-meeting-action=["\']audio["\'][^>]*>.*?<\\/a>/gi, meetingAudioLinkHtml(audioHref, "Listen To Audio"));' in html_rewrite
    assert 'output = output.replace(/<a\\b[^>]*href=["\']<a\\b[^>]*pucky-meeting-transcript-link\\b[^>]*>.*?<\\/a>["\'][^>]*>.*?<\\/a>/gi, meetingTranscriptLinkHtml(transcriptHref));' in html_rewrite
    assert 'output = output.replace(/<a\\b[^>]*href=["\']<a\\b[^>]*pucky-meeting-audio-link\\b[^>]*>.*?<\\/a>["\'][^>]*>.*?<\\/a>/gi, meetingAudioLinkHtml(audioHref, "Listen To Audio"));' in html_rewrite
    html_iframe = function_block(app, "htmlIframeViewer")
    assert "const audioContext = await resolveMeetingAudioAttachmentLink(card, item);" in html_iframe
    assert 'if (src && /^data:/i.test(src)) {' in html_iframe
    assert "iframe.srcdoc = await rewriteMeetingHtmlContent(decodeHtmlDataUrl(src), item, {" in html_iframe
    assert "iframe.srcdoc = await rewriteMeetingHtmlContent(await fetchHtmlAttachmentText(item, artifactId, src), item, {" in html_iframe
    assert "audioHref: audioContext.href" in html_iframe
    assert "function decodeHtmlDataUrl(src)" in app
    assert "async function fetchHtmlAttachmentText(item, artifactId, src = \"\")" in app
    fetch_html = function_block(app, "fetchHtmlAttachmentText")
    assert 'const response = await fetchArtifactHttpResponse(htmlSrc, "HTML artifact");' in fetch_html
    assert 'const response = await fetchArtifactHttpResponse(artifactApiUrl(artifactId), "HTML artifact");' in fetch_html
    assert "async function fetchArtifactHttpResponse(url, label = \"Artifact\")" in app
    fetch_artifact_http = function_block(app, "fetchArtifactHttpResponse")
    assert "await ensureLinksApiConfig();" in fetch_artifact_http
    assert "if (state.links.apiToken && !/[?&]token=/i.test(apiUrl)) {" in fetch_artifact_http
    assert "headers.Authorization = `Bearer ${state.links.apiToken}`;" in fetch_artifact_http
    assert "throw new Error(`${label} unavailable: HTTP ${response.status}`);" in fetch_artifact_http
    transcript_link = function_block(app, "resolveMeetingTranscriptLink")
    assert '"Transcript"' in transcript_link
    assert '"Transcript (Plain Text)"' in transcript_link
    assert '"Meeting Transcript HTML"' in transcript_link
    assert '"Meeting Transcript"' in transcript_link
    assert "function isMeetingProcessingCard(card)" in app
    assert "function meetingProcessingCardView(card)" in app
    assert ".card.card-meeting-list" in styles
    assert ".card.card-meeting-list .card-body.is-title-only" in styles
    assert 'applyCardDataAttributes(cardEl, card, "meeting_processing")' in app
    assert "Processing meeting..." in app
    assert "Transcription, diarization, and follow-up checks are running." in app
    assert "showTranscript(card);" not in function_block(app, "meetingProcessingCardView")
    assert "speaker_turns" in app
    assert "Refreshing..." in app
    assert 'loadMeetings({ render: true });' in app
    meeting_timestamp = function_block(app, "meetingRowTimestamp")
    assert "smartTimestamp(" in meeting_timestamp
    assert "meeting.updated_at || meeting.stopped_at || meeting.started_at || meeting.created_at" in meeting_timestamp
    resolve_audio_attachment = function_block(app, "resolveAudioAttachmentSrc")
    assert 'const hasNativeBridge = Boolean(window.PuckyAndroid && typeof window.PuckyAndroid.postMessage === "function");' in resolve_audio_attachment
    assert 'const artifactId = attachmentArtifactId(item);' in resolve_audio_attachment
    assert 'let url = String(item && item.url || "").trim();' in resolve_audio_attachment
    assert 'const hasCanonicalAttachmentSource = Boolean(artifactId || url);' in resolve_audio_attachment
    assert 'if (path && hasNativeBridge && isAndroidPlayableAudioPath(path)) {' in resolve_audio_attachment
    assert 'return resolveLocalArtifactPath(path, item, options);' in resolve_audio_attachment
    assert 'if (artifactId) {' in resolve_audio_attachment
    assert 'url = String(resolvedMeetingAudio.url);' in resolve_audio_attachment
    assert "await ensureAudioCacheForPlayback({ ...(item || {}), audio_url: url }, options)" in resolve_audio_attachment
    assert 'command: "player.asset.prepare"' not in resolve_audio_attachment
    assert 'return resolveArtifactUrl(item, { ...options, preferDataUrl: true });' in resolve_audio_attachment
    resolve_artifact = function_block(app, "resolveArtifactUrl")
    assert "async function resolveRemoteArtifactObjectUrl(artifactId, item)" in app
    assert "return resolveRemoteArtifactObjectUrl(artifactId, item);" in resolve_artifact
    assert ".meetings-page" in styles
    assert ".meetings-list-card" in styles
    assert ".card.card-meeting-processing" in styles
    assert ".meeting-processing-mark" in styles
    assert ".meeting-processing-timestamp" in styles
    assert ".meeting-row-icon" not in styles


def test_failed_meetings_open_failed_detail_instead_of_processing_player() -> None:
    app = read("app.js")
    styles = read("styles.css")

    show_meeting_detail = function_block(app, "showMeetingDetail")
    failed_detail = function_block(app, "showMeetingFailedDetail")
    failed_content = function_block(app, "meetingFailedDetailContent")

    assert 'if (meetingState(record) === "failed") {' in show_meeting_detail
    assert "showMeetingFailedDetail(record, options);" in show_meeting_detail
    assert 'showTranscript(meetingCardFromRecord(record), options);' in show_meeting_detail
    assert "return openMeetingSummaryDetail(record, options);" in show_meeting_detail
    assert 'applyDetailDataAttributes(panel, "meeting_failed", detailCard, { viewer: "meeting_failed" });' in failed_detail
    assert 'rememberNavDetail("meeting_failed", detailCard, options);' in failed_detail
    assert "Meeting failed" in failed_content
    assert "meeting-failed-summary" in failed_content
    assert "meeting-failed-chip" in failed_content
    assert "meetingTranscriptAction" not in failed_content
    assert "audio-player" not in failed_content
    assert ".meeting-failed-detail" in styles
    assert ".meeting-failed-summary" in styles
    assert ".meeting-failed-chip" in styles


def test_attachment_source_filter_hides_placeholders_and_html_path_fallback_opens() -> None:
    app = read("app.js")
    styles = read("styles.css")

    has_source = function_block(app, "hasAttachmentSource")
    meaningful = function_block(app, "hasMeaningfulAttachmentText")
    html_iframe = function_block(app, "htmlIframeViewer")

    assert "hasMeaningfulAttachmentText(attachment.text || attachment.preview)" in has_source
    assert "speaker-separated transcript with timestamps" in meaningful
    assert "playback url:" in meaningful
    assert "return text.length >= 80 || text.includes(\"\\n\");" in meaningful
    assert "htmlAttachmentLocalPath(item)" in html_iframe
    assert "rewriteMeetingHtmlContent" in html_iframe
    assert "resolveMeetingTranscriptLink" in html_iframe
    assert "installMeetingHtmlActionBridge" in html_iframe
    assert ".meeting-transcript-section" in styles
    assert ".meeting-speaker-turn" in styles
    assert ".card.card-meeting-list" in styles
    assert ".meetings-empty.is-error" in styles


def test_meeting_audio_url_is_prepared_before_native_playback() -> None:
    app = read("app.js")
    bridge = (ROOT.parent / "pucky-apk" / "app" / "src" / "main" / "java" / "com" / "pucky" / "device" / "ui" / "PuckyWebBridge.java").read_text(encoding="utf-8")

    assert "async function ensureAudioCacheForPlayback(source, options = {})" in app
    media_id = function_block(app, "audioCacheMediaId")
    assert "const meetingId = String(source && source.meeting_id || \"\").trim();" in media_id
    assert "return `meeting:${meetingId}:audio`;" in media_id
    cache = function_block(app, "ensureAudioCacheForPlayback")
    assert 'command: "media.cache.ensure"' in cache
    assert "media_id: mediaId" in cache
    assert "url," in cache
    assert 'owner_type: source && (source.is_meeting_recording || source.meeting_id) ? "meeting" : "feed"' in cache
    assert 'sha256: String(source && (source.audio_sha256 || source.media_sha256 || source.sha256) || "")' in cache
    assert "max_bytes: options.maxBytes || 96 * 1024 * 1024" in cache
    assert "source.audio_path = path;" in cache
    assert "async function prepareAudioForPlayback(card)" in app
    prepare = app.split("async function prepareAudioForPlayback", 1)[1].split("async function toggleAudio", 1)[0]
    assert "const cachedPath = await ensureAudioCacheForPlayback(card);" in prepare
    assert "return url;" in prepare
    assert 'command: "player.asset.prepare"' not in prepare
    toggle = app.split("async function toggleAudio", 1)[1].split("function showTranscript", 1)[0]
    assert "const audioPath = await prepareAudioForPlayback(card);" in toggle
    assert "args: { path: audioPath, title: card.title" in toggle
    scrub = app.split("async function commitAudioScrub", 1)[1].split("function updateAudioScrubPreview", 1)[0]
    assert "const audioPath = await prepareAudioForPlayback(card);" in scrub
    timestamp = app.split("async function commitTimestamp", 1)[1].split("async function jumpToTimestamp", 1)[0]
    assert "const audioPath = await prepareAudioForPlayback(card);" in timestamp
    assert 'case "media.cache.ensure":' in bridge
    assert 'case "media.cache.status":' in bridge
    assert 'case "player.asset.prepare":' in bridge
    assert 'case "meeting.recording.resolve_audio_link":' in bridge
    audio_attachment = function_block(app, "showAudioAttachment")
    assert "await resolveAudioAttachmentSrc(item, { maxBytes: 32 * 1024 * 1024 })" in audio_attachment


def test_meeting_transcript_uses_remaining_detail_height() -> None:
    styles = read("styles.css")

    detail = css_block(styles, ".meeting-transcript-detail")
    assert "flex: 1 1 0;" in detail
    assert "min-height: 0;" in detail
    assert "overflow: hidden;" in detail
    transcript = css_block(styles, ".meeting-transcript-section")
    assert "max-height: 46vh" not in transcript
    assert "flex: 1 1 0;" in transcript
    assert "height: max(260px" not in transcript
    assert "min-height: 0;" in transcript
    assert "overflow-y: auto;" in transcript


def test_meetings_and_home_reuse_shared_left_reveal_archive_controller() -> None:
    app = read("app.js")
    styles = read("styles.css")
    reveal = function_block(app, "installArchiveReveal")

    assert "function installArchiveReveal(wrapper, item, config)" in app
    assert "function installFeedLikeSwipeArchive(wrapper, item, config)" not in app
    assert "function installCardArchiveSwipe(wrapper, card)" not in app
    assert "function installMeetingArchiveSwipe(wrapper, meeting)" not in app
    assert "async function archiveMeetingRecord(meeting)" in app
    assert "async function performMeetingArchive(meeting)" in app
    assert "async function performHomeArchive(card)" in app
    assert 'linksApiRequest("/api/meetings/actions", {' in app
    assert 'action: "archive"' in app
    assert 'command: "pucky.feed.action"' not in function_block(app, "archiveMeetingRecord")
    assert "function applyOptimisticHomeArchive(card)" in app
    assert "function applyOptimisticMeetingArchive(meeting)" in app
    assert "const ARCHIVE_REVEAL_WIDTH_PX = 88" in app
    assert "const ARCHIVE_REVEAL_OPEN_THRESHOLD_PX = 44" in app
    assert 'const wrapper = el("div", "card-wrap");' in app
    assert "appendArchiveRevealAction(wrapper, {" in app
    assert 'action.innerHTML = iconSvg("delete", { filled: true });' in app
    assert 'const row = el(' in app
    assert "meetingListCardClass(card)" in app
    assert '"card card-meeting-list"' in app
    assert 'installArchiveReveal(wrapper, card.meeting_record, {' in app
    assert 'installArchiveReveal(wrapper, card, {' in app
    assert "if (busy || !config.canReveal(item) || isDragIgnoredTarget(target))" in reveal
    assert "applyOffset(startOffset - dx);" in reveal
    assert "if (currentOffset() >= ARCHIVE_REVEAL_OPEN_THRESHOLD_PX)" in reveal
    assert "void config.performArchive(item)" in reveal
    assert ".archive-reveal-action" in styles
    assert ".card-wrap.is-archive-reveal-open .archive-reveal-action" in styles
    assert ".meeting-row-card" not in styles
    assert ".card.card-meeting-list" in styles
    assert ".card.card-meeting-list .card-body.is-title-only" in styles


def test_meeting_recording_status_uses_purple_dot() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "meetingRecording: initialMeetingRecordingStatus()" in app
    assert "async function refreshMeetingRecordingStatus(options = {})" in app
    assert 'command: "meeting.recording.status"' in app
    assert "function meetingRecordingVisualState()" in app
    assert 'return "meeting_recording";' in app
    assert '["idle", "armed", "recording", "uploading", "thinking", "speaking", "meeting_recording"]' in app
    assert ".voice-status-meeting_recording" in styles
    assert "--voice-color: #a855f7" in css_block(styles, ".voice-status-meeting_recording")
    assert ".voice-status-recording {\n  --voice-color: #ff3b30" in styles


def test_voice_status_dot_is_single_turn_indicator() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")

    assert 'id="voiceStatus"' in html
    assert 'id="turnIndicators"' not in html
    assert "data-voice-status" in html
    assert 'aria-label="Turn state: idle"' in html
    assert "const TURN_DOTS = [" not in app
    assert "voiceState: initialVoiceState()" not in app
    assert "turn: initialTurnStatus()" in app
    assert "turnHearingUntil" not in app
    assert "turnFailedUntil" not in app
    assert "renderVoiceStatus()" in app
    assert "renderTurnIndicators()" not in app
    assert 'if (name === "voice.state")' in app
    assert 'if (name === "pucky.turn.status")' in app
    assert 'command === "pucky.turn.status"' in app
    assert 'command: "pucky.turn.status"' in app
    assert 'if (state.route === "feed") {' in app
    assert 'await refreshCardsFromVmSnapshot({ render: false });' in app
    assert "function renderVoiceStatus()" in app
    assert "function applyTurnStatus(input)" in app
    assert "function normalizeTurnStatus(input)" in app
    assert "function isTurnActive(status)" in app
    assert "function turnVisualState(status)" in app
    assert "function wakeProofVisualState(status)" in app
    assert "proof_indicator: normalizeWakeProof(raw.proof_indicator)" in app
    assert 'const wakeProofState = turnState === "idle" ? wakeProofVisualState(state.wakeStatus) : "idle"' in app
    assert 'const meetingState = meetingRecordingVisualState();' in app
    assert 'const label = meetingState !== "idle"' in app
    assert "hasNativeVisualState" not in app
    assert "indicator.visual_state = \"thinking\"" not in app
    assert "indicator.visual_state = \"speaking\"" not in app
    assert "indicator.visual_state = \"uploading\"" not in app
    assert "indicator.visual_state = \"recording\"" not in app
    assert "indicator.visual_state = \"armed\"" not in app
    assert "indicator.active = indicator.active || indicator.visual_state !== \"idle\"" in app
    assert "function noteHearingSample(indicator)" not in app
    assert 'document.querySelectorAll("[data-voice-status]")' in app
    assert "shell.append(header, content)" in app
    assert "function nextVoiceState(current)" not in app
    assert "function initialVoiceState()" not in app
    assert "function normalizeVoiceState(input)" not in app
    assert "state.voiceState = nextVoiceState(state.voiceState)" not in app
    assert ".voice-status" in styles
    assert ".turn-indicators" not in styles
    assert ".turn-dot" not in styles
    voice_status_block = styles.split(".voice-status {", 1)[1].split("}", 1)[0]
    assert "position: fixed" in styles
    assert "--voice-status-size: 38px" in styles
    assert "top: calc(var(--safe-area-top-pad) + (45px - var(--voice-status-size)) / 2);" in styles
    assert "top: 14px" not in voice_status_block
    assert "z-index: 100" in styles
    assert ".voice-status-idle" in styles
    assert ".voice-status-armed" in styles
    assert ".voice-status-recording" in styles
    assert ".voice-status-uploading" in styles
    assert ".voice-status-hearing" not in styles
    assert ".voice-status-armed::before" in styles
    assert ".voice-status-recording::before" in styles
    assert "--voice-color: #586574" in styles
    assert "color-mix(in srgb, var(--voice-color)" in styles
    assert ".voice-status-thinking" in styles
    assert ".voice-status-thinking::after" in styles
    assert ".voice-status-thinking {\n  --voice-color: #ffb000" in styles
    assert ".voice-status-uploading {\n  --voice-color: #ffb000" in styles
    assert "turnThinkingSpin" not in styles
    assert "animation: turnThinkingSpin" not in styles
    assert ".voice-status-speaking" in styles
    assert ".voice-status-failed" not in styles
    assert "@keyframes voicePulse" in styles
    assert "@keyframes voiceRing" in styles
    assert "TURN_FAILED_FLASH_MS" not in app
    assert "failureFallbackVisualState" not in app
    assert "indicator.visual_state = \"failed\"" not in app
    assert 'armed: "armed"' in app
    assert 'recording: "recording"' in app
    assert '["idle", "armed", "recording", "uploading", "thinking", "speaking", "meeting_recording"]' in app


def test_active_home_tab_opens_real_icon_filter_tray() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "openTrayRoute: initialOpenTrayRoute(persistedNavState.open_tray_route, persistedNavState.route, initialHomeShellActiveValue, initialTheme)" in app
    assert 'FEED_ICON_EXCLUDES_KEY = "pucky.cover.feed_icon_excludes.v1"' in app
    assert "excludedFeedIcons: loadFeedIconExcludes()" in app
    assert "renderRouteTray()" in app
    assert "function renderRouteTray()" in app
    assert "function homeIconFilterTrayView()" in app
    assert "function filterIconButton(filter)" in app
    assert "function uniqueFeedIconFilters()" in app
    assert "function uniqueFeedIcons()" in app
    assert "function filteredFeedCards()" in app
    assert "function cardIconKey(card)" in app
    assert "function clearMissingFeedIconFilter()" in app
    assert "function isFeedIconIncluded(icon)" in app
    assert "function toggleFeedIcon(icon)" in app
    assert "function loadFeedIconExcludes()" in app
    assert "function persistFeedIconExcludes()" in app
    assert 'state.openTrayRoute === nextTabRoute ? null : nextTabRoute' in app
    assert "const route = effectiveRoute();" in app
    assert 'if (route !== "feed" || state.openTrayRoute !== "feed")' in app
    assert "const filters = uniqueFeedIconFilters();" in app
    assert 'iconSvg("archive_folder", { filled: state.showArchivedFeed })' in app
    assert '"route-tray-archive-icon"' in app
    assert '"route-tray-divider"' in app
    assert "state.showArchivedFeed = true;" in app
    assert "state.showArchivedFeed = false;" in app
    assert "state.excludedFeedIcons = new Set(uniqueFeedIcons().filter(icon => icon !== filter.key));" in app
    assert "const selected = !state.showArchivedFeed && isFeedIconIncluded(filter.key);" in app
    assert "? archived" in app
    assert 'label: "All replies"' not in app
    assert 'data-filter-icon="all"' not in app
    assert "button.style.setProperty(\"--filter-accent\"" in app
    assert 'accent: card.accent || "#f5f9ff"' in app
    assert '"route-tray-label"' not in app
    assert '"Show"' not in app
    assert "toggleFeedIcon(filter.key);" in app
    assert "state.excludedFeedIcons.add(key)" in app
    assert "state.excludedFeedIcons.delete(key)" in app
    assert "state.openTrayRoute = null;\n        render();\n        return;" not in app
    assert "state.feedIconFilter" not in app
    assert "renderHomeFeedInto(feed);" in app
    assert "return cards.map(cardView);" in app
    assert "No selected replies." in app
    assert ".route-tray" in styles
    assert "position: absolute;" in styles
    assert "top: 45px;" in styles
    assert "top: 66px;" not in styles
    assert "pointer-events: none;" in styles
    assert "pointer-events: auto;" in styles
    assert ".route-tray-label" not in styles
    assert ".route-tray-archive-icon" in styles
    assert ".route-tray-archive-icon.is-selected" in styles
    assert ".route-tray-divider" in styles
    assert ".route-tray-icons" in styles
    assert ".filter-icon.is-selected" in styles
    assert "var(--filter-accent" in styles
    assert "color: var(--icon-subtle);" in styles
    assert '.filter-icon[data-filter-icon="all"].is-selected' not in styles
    assert ".feed-filter-empty" in styles


def test_home_cards_use_safe_area_padding_and_left_reveal_archive() -> None:
    app = read("app.js")
    styles = read("styles.css")
    reveal = function_block(app, "installArchiveReveal")
    can_archive = function_block(app, "canArchiveHomeCard")

    assert "const ARCHIVE_REVEAL_WIDTH_PX = 88" in app
    assert "const ARCHIVE_REVEAL_OPEN_THRESHOLD_PX = 44" in app
    assert "const ARCHIVE_REVEAL_SLOP_PX = 12" in app
    assert "showArchivedFeed: false" in app
    assert "async function archiveHomeCard(card)" in app
    assert "function canArchiveHomeCard(card)" in app
    assert "function canRevealHomeArchive(card)" in app
    assert "function installArchiveReveal(wrapper, item, config)" in app
    assert 'await syncFeedCards({ reason: "pre_archive", silent: true, render: false, authoritative: true });' in app
    assert 'return requestFeedAction(freshCard, "archive");' in app
    assert 'feedApiRequest("/api/feed/actions"' in app
    assert 'command: "pucky.feed.action"' not in app
    assert "client_action_id" in app
    assert "function archiveActionButton(card)" not in app
    assert 'const archive = archiveActionButton(card);' not in app
    assert 'applyCardActionData(archive, "archive", card, "reply");' not in app
    assert "action action-archive" not in app
    assert "return isFailedPendingOutboundCard(card);" in can_archive
    assert "function installCardArchiveSwipe(wrapper, card)" not in app
    assert "function canArchiveBySwipe(card)" not in app
    assert "installArchiveReveal(wrapper, card, {" in app
    assert "if (currentOffset() >= ARCHIVE_REVEAL_OPEN_THRESHOLD_PX)" in reveal
    assert "actionButton.tabIndex = isOpen ? 0 : -1;" in reveal
    assert "if (!horizontal && Math.abs(dy) > Math.abs(dx))" in reveal
    assert "event.preventDefault();" in reveal
    assert "if (horizontal) {" in reveal
    assert "CARD_MENU_LONG_PRESS_MS" not in app
    assert "function toggleCardStar(card)" not in app
    assert "function isCardStarred(card)" not in app
    assert "function installCardLongPressMenu(wrapper, card)" not in app
    assert "filteredFeedCards()" in app
    assert "const archived = Boolean(card && card.archived);" in app
    assert "state.cards = state.cards.filter" not in app
    assert 'Pucky.request({ command: "ui.reply_cards.set"' not in app
    assert "--safe-area-top-pad: max(12px, var(--safe-area-top));" in styles
    assert "--safe-area-bottom-pad: max(14px, var(--safe-area-bottom));" in styles
    assert "padding: var(--safe-area-top-pad) 14px var(--safe-area-bottom-pad);" in css_block(styles, ".app-shell")
    assert "height: var(--viewport-safe-h);" in css_block(styles, ".panel-scroll")
    assert "height: var(--viewport-safe-h);" in css_block(styles, ".detail-shell")
    assert "--archive-reveal-offset: 0px;" in css_block(styles, ".card-wrap")


def test_home_menu_keeps_a_stored_book_icon_and_trims_fixture_feed() -> None:
    app = read("app.js")
    fixtures = runtime_fixture()
    deploy_cards_fixture = deploy_fixture()

    assert 'HOME_MENU_ICON_LIBRARY_KEY = "pucky.cover.home_menu_icon_library.v1"' in app
    assert "const DEFAULT_HOME_MENU_ICONS = [" in app
    assert '{ key: "book", icon: "book", label: "Audiobooks", accent: "#72c2ff" }' in app
    assert "homeMenuIconLibrary: loadHomeMenuIconLibrary()" in app
    assert "ensureStoredHomeMenuIcons();" in app
    assert "function normalizeHomeMenuIconEntry(entry)" in app
    assert "function loadHomeMenuIconLibrary()" in app
    assert "function persistHomeMenuIconLibrary()" in app
    assert "state.homeMenuIconLibrary.forEach(filter => {" in app

    fixture_cards = {card["session_id"]: card for card in fixtures["cards"]}
    deploy_cards = {card["session_id"]: card for card in deploy_cards_fixture["cards"]}

    assert fixture_cards["fixture_book"]["icon"] == "book"
    assert fixture_cards["fixture_meeting"]["archived"] is True
    assert fixture_cards["fixture_night"]["archived"] is True
    assert fixture_cards["fixture_book"].get("archived") is not True

    assert deploy_cards["fixture_book"]["icon"] == "book"
    assert deploy_cards["fixture_meeting"]["archived"] is True
    assert deploy_cards["fixture_night"]["archived"] is True
    assert deploy_cards["fixture_book"].get("archived") is not True


def test_pending_outbound_cards_render_as_quiet_feed_items_and_ignore_icon_filters() -> None:
    app = read("app.js")
    styles = read("styles.css")
    outbound = function_block(app, "outboundCardView")
    can_archive = function_block(app, "canArchiveHomeCard")
    can_reveal = function_block(app, "canRevealHomeArchive")
    filtered = function_block(app, "filteredFeedCards")
    request_mark_read = function_block(app, "requestMarkRead")

    assert "function isPendingOutboundCard(card)" in app
    assert "function isFailedPendingOutboundCard(card)" in app
    assert "function pendingOutboundSummary(card)" in app
    assert "function pendingOutboundStatusLabel(card)" in app
    assert "function pendingOutboundStatusClass(card)" in app
    assert "if (isPendingOutboundCard(card)) {\n      return outboundCardView(card);" in app
    assert "if (isPendingOutboundCard(card)) {\n        return state.showArchivedFeed ? archived : !archived;\n      }" in filtered
    assert "isFeedIconIncluded(cardIconKey(card))" in filtered
    assert "if (!card || card.deleted || isPendingOutboundCard(card))" in app
    assert "card?.session_id || card?.local_session_id || card?.turn_id" in app
    assert "isPendingOutboundCard(card)" in request_mark_read

    assert "card card-outbound" in outbound
    assert "card-outbound-copy" in outbound
    assert "card-outbound-preview" in outbound
    assert "card-outbound-status" in outbound
    assert "card-outbound-time" in outbound
    assert "showTranscript(card)" not in outbound
    assert "toggleAudio(card)" not in outbound
    assert "showRichPage(card)" not in outbound
    assert "identity" not in outbound
    assert "card-actions" not in outbound
    assert "card-outbound-actions" not in outbound
    assert "const archive = archiveActionButton(card);" not in outbound
    assert "appendArchiveRevealAction(wrapper, {" in outbound
    assert "installArchiveReveal(wrapper, card, {" in outbound

    assert "function canArchiveHomeCard(card)" in app
    assert "if (!isPendingOutboundCard(card)) {\n      return true;\n    }\n    return isFailedPendingOutboundCard(card);" in can_archive
    assert "function installArchiveReveal(wrapper, item, config)" in app
    assert "function canRevealHomeArchive(card)" in app
    assert "return canArchiveHomeCard(card);" in can_reveal
    assert "function prefersTouchInput()" in app
    assert "function shouldHandleTouchLikePointerEvent(event, preferTouchEvents = false)" in app

    assert ".card.card-outbound" in styles
    assert ".card.card-outbound.is-failed" in styles
    assert ".card-outbound-copy" in styles
    assert ".card-outbound-preview" in styles
    assert "-webkit-line-clamp: 2" in css_block(styles, ".card-outbound-preview")
    assert ".card-outbound-preview.is-placeholder" in styles
    assert ".card-outbound-status.is-sending" in styles
    assert ".card-outbound-status.is-thinking" in styles
    assert ".card-outbound-status.is-failed" in styles
    assert ".card-outbound-time" in styles
    assert ".card-outbound-actions" not in styles
    assert "function installCardArchiveSwipe(wrapper, card)" not in app
    assert "function cardLongPressMenu(card)" not in app
    assert "function cardFocusBorder()" not in app
    assert 'wrapper.append(cardFocusBorder());' not in app
    assert "function dismissOpenCardMenu(suppressClick = true)" in app
    assert "shouldSuppressCardActivation()" in app
    assert "toggleCardStar(card);" not in app
    assert ".archive-reveal-action" in styles


def test_left_identity_icon_restores_persistent_read_unread_toggle() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert 'READ_OVERRIDES_KEY = "pucky.cover.read_overrides.v1"' in app
    assert "readOverrides: loadReadOverrides()" in app
    assert "function loadReadOverrides()" in app
    assert "function persistReadOverrides()" in app
    assert "function readOverrideForCard(card)" in app
    assert "function setCardReadOverride(card, read)" in app
    assert "function reconcileReadOverrides()" in app
    assert "function markCardRead(card)" in app
    assert "setCardReadOverride(card, true);" in app
    assert "setCardReadOverride(card, false);" in app
    assert "if (isCardRead(card)) {" in app
    assert "return Boolean(card && card.read);" in app
    assert "const override = readOverrideForCard(card);" in app
    assert "requestMarkRead(card);" in app
    assert "reconcileReadOverrides();" in app
    assert 'identity.addEventListener("click"' in app
    assert "toggleCardRead(card);" in app
    assert ".archive-reveal-action" in styles
    assert ".card-wrap.is-archive-reveal-open .archive-reveal-action" in styles
    assert ".card-wrap.is-card-swipe-active .card-swipe-action" not in styles
    assert ".card-wrap.is-card-swiped-away .card" not in styles
    assert ".card-longpress-menu" not in styles
    assert ".card-menu-action" not in styles
    assert ".card-wrap.is-card-menu-open .card" not in styles
    assert ".card-focus-border" not in styles
    assert ".card-focus-border-segment" not in styles
    assert ".card-wrap.is-card-menu-open .card-menu-action::after" not in styles
    assert ".card-wrap.is-card-menu-open .identity" not in styles
    assert ".card-wrap.is-card-menu-open .card-body" not in styles
    assert ".card-wrap.is-card-menu-open .card-actions" not in styles
    assert "filter: blur(3.2px) saturate(0.82);" not in styles
    assert "opacity: 0.24;" not in styles
    assert "touch-action: pan-y;" in styles
    assert "transition:" in css_block(styles, ".card-wrap .card")
    assert "animation: card-menu-tracer-path" not in styles
    assert "@keyframes card-menu-tracer-path" not in styles
    assert "@keyframes card-focus-border-run" not in styles
    assert "stroke-dasharray: 11 89;" not in styles
    assert "stroke-dashoffset: -100;" not in styles
    assert "top: 50%;" in styles
    assert "transform: translateY(-50%);" in styles
    assert ".card-wrap.is-card-menu-open .card::before" not in styles
    assert ".card-wrap.is-card-menu-open .card::after" not in styles
    assert "-webkit-touch-callout: none;" in styles
    assert "user-select: none;" in styles



def test_map_page_and_maplibre_experiment_are_removed() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")

    assert 'route: "map"' not in app
    assert 'icon: "map"' not in app
    assert "map:" not in app
    assert "function mapPageView" not in app
    assert "function mapLibreView" not in app
    assert "function syncMapLibre" not in app
    assert "function loadMapTracker" not in app
    assert "location.tracker." not in app
    assert "MAP_TILE_URLS" not in app
    assert "maplibre" not in app.lower()
    assert "openfreemap" not in app.lower()
    assert "basemaps.cartocdn.com" not in app
    assert "tile.openstreetmap.org" not in app
    assert "vendor/maplibre" not in html
    assert "maplibre" not in html.lower()
    assert "tile.openstreetmap.org" not in html
    assert ".map-page" not in styles
    assert ".maplibre-map" not in styles
    assert ".map-control-card" not in styles
    assert ".map-recenter" not in styles
    assert ".map-offline" not in styles
    assert ".map-canvas" not in styles
    assert ".map-debug-samples" not in styles

def test_home_feed_is_plain_single_scroller_without_pull_refresh() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")

    assert "home-feed-shell" not in app
    assert "home-feed-scroll" not in app
    assert ".home-feed-shell" not in styles
    assert ".home-feed-scroll" not in styles
    home_route = css_block(styles, ".feed.is-home-route")
    assert "overflow: hidden" not in home_route
    feed_block = css_block(styles, ".feed")
    assert "overflow-y: auto;" in feed_block
    assert "renderHomeFeedInto(feed);" in app
    assert "return cards.map(cardView);" in app

    assert "function installFeedRubberBand()" not in app
    assert "installFeedRubberBand();" not in app
    assert "feed.dataset.rubberBandBound" not in app
    assert "const FEED_REFRESH_THRESHOLD" not in app
    assert "const FEED_REFRESH_MAX_PULL" not in app
    assert "const FEED_REFRESH_MIN_DWELL_MS" not in app
    assert "function resetFeedRefreshIndicator()" not in app
    assert 'id="feedRefresh"' not in html
    assert ".feed-refresh" not in styles
    assert ".feed.is-rubber-banding" not in styles
    assert ".feed.is-rubber-band-release" not in styles
    assert '"Release to refresh"' not in app
    assert '"Pull to refresh"' not in app
    assert 'Pucky.request({ command: "ui.reply_cards.get", args: {} })' not in app
    assert 'command === "ui.reply_cards.get"' not in app
    assert 'fetch("/ui/pucky/fixtures/reply_cards.json"' not in app
    assert "function fetchVmFeedSnapshot(options = {})" in app
    assert "return `/api/feed?${params.toString()}`;" in app
    assert 'params.set("compact", "1");' in app
    assert 'command: "pucky.feed.cache.get"' not in app
    assert 'command: "pucky.feed.sync"' not in app
    assert 'command: "pucky.feed.action"' not in app
    assert 'name === "pucky.feed.updated"' not in app
    assert 'reason: "native_feed_updated"' not in app
    assert "function fetchAndroidFeedCacheSnapshot" not in app
    assert "function mirrorVmFeedToAndroidCache" not in app
    assert 'state.cards = cards;' not in app
    assert 'void refreshCardsFromNativeSnapshot({ render: true, reason: "turn_status_event" });' not in app
    assert 'const snapshot = await fetchAndroidFeedCacheSnapshot(String(options.reason || "native_snapshot"));' not in app
    assert "feed_source: state.feedSource" in app
    assert "feed_load_error: state.feedLoadError" in app
    assert "function shouldHandleTouchLikePointerEvent(event, preferTouchEvents = false)" in app
    assert 'pointerType === "mouse" || pointerType === "pen"' in app
    assert 'isTouchPointerEvent(event)' not in app
    assert 'feed.addEventListener("pointerdown"' not in app
    assert 'feed.addEventListener("pointermove"' not in app
    assert 'feed.addEventListener("pointerup"' not in app
    assert 'feed.addEventListener("pointercancel"' not in app
    assert 'feed.addEventListener("touchstart"' not in app
    assert 'feed.addEventListener("touchmove"' not in app
    assert 'feed.addEventListener("touchend"' not in app
    assert 'feed.addEventListener("touchcancel"' not in app

    assert "Pull to refresh" not in html
    assert "Release to refresh" not in html
    assert "feed-refresh-spinner" not in html
    assert "overscroll-behavior-y: contain;" in styles
    assert "opacity 140ms ease" not in styles
    assert "animation: feedRefreshSpin" not in styles
    assert "--feed-refresh-progress" not in styles
    assert "feed-refresh-spinner" not in styles
    assert "var(--blue) 0deg 44deg" not in styles
    assert "is-closing" not in app
    assert "is-closing" not in styles
    assert "is-resetting" not in app
    assert "--feed-refresh-progress" not in app
    assert "@keyframes feedRefreshSpin" not in styles

    assert "function hasAudio(card)" in app
    assert "card.audio_path || card.audio_playlist_path || card.audio_url" in app
    assert "source.media_id || source.audio_media_id" in app
    assert "card.audio_playlist_path || card.audio_path || card.audio_media_id || card.audio_url" in app
    assert "samePath(player.path, card.audio_url)" in app
    assert "samePath(player.source, card.audio_url)" in app
    assert 'command: "media.cache.ensure"' in app


def test_settings_tab_renders_real_backed_settings_page() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")

    assert "turnSettings: initialTurnSettings()" in app
    assert "wakeStatus: initialWakeStatus()" in app
    assert "uiSurface: initialUiSurfaceStatus()" in app
    assert 'state.route === "settings"' in app
    assert "settingsPageView()" in app
    assert "function settingsPageView()" in app
    assert "function settingsToggleCard(" in app
    assert "function wakeWordSettingsCard()" in app
    assert "function wakeStatusDetail(status)" in app
    assert "function arrivalCueSettingsCard()" in app
    assert "function advancedSettingsCard()" in app
    assert "function replyModeSettingsCard()" in app
    assert "function settingsSelectorCard(" in app
    assert "function settingsSelectorButton(" in app
    assert "function openSettingsSelector(" in app
    assert "function showAdvancedSettingsSheet()" in app
    assert "async function setTurnReplyMode(mode)" in app
    assert "async function loadTurnSettings" in app
    assert "async function loadSettingsState(options = {})" in app
    assert "async function loadWakeStatus(options = {})" in app
    assert "async function loadUiSurfaceStatus(options = {})" in app
    assert "function ensureSettingsSurfaceCurrent()" in app
    assert 'if (state.homeShellActive) {' in app
    assert 'if (state.route === "settings") {' in app
    assert "feed.replaceChildren(settingsPageView());" in app
    assert '`${current?.label || "Page"} will live here.`' in app
    assert 'command === "pucky.turn.settings.get"' in app
    assert 'command === "pucky.turn.settings.set"' in app
    assert 'command === "wake.status"' in app
    assert 'command === "ui.surface.get"' in app
    assert 'command === "pucky.turn.arrival_cue.test"' in app
    assert 'command === "pucky.turn.sent_cue.test"' in app
    assert 'command === "pucky.turn.received_cue.test"' in app
    assert 'command === "pucky.turn.chime.test"' in app
    assert 'command: "pucky.turn.settings.get"' in app
    assert 'command: "pucky.turn.settings.set"' in app
    assert "Card only" in app
    assert "Card + voice" in app
    assert '"settings-page"' in app
    assert '"settings-hero"' in app
    assert '"settings-card"' in app
    assert "Wake, walkie, feedback" in app
    assert "Reply playback" in app
    assert "Message sent cue" in app
    assert "Session model" in app
    assert "Thinking level" in app
    assert "Default OpenAI model. Applies to new sessions." in app
    assert "Default reasoning effort. Applies to new sessions." in app
    assert 'settingId: "turn-model"' in app
    assert 'settingId: "turn-reasoning-effort"' in app
    assert 'row.setAttribute("data-setting-id", String(settingId));' in app
    assert 'button.setAttribute("data-selector-value", String(option.value || ""));' in app
    assert 'const TURN_MODEL_OPTIONS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"]' in app
    assert 'const TURN_REASONING_EFFORT_OPTIONS = ["none", "low", "medium", "high", "xhigh"]' in app
    assert "function normalizeTurnModel(model)" in app
    assert "function normalizeTurnReasoningEffort(reasoningEffort)" in app
    assert "function modelSettingsCard()" in app
    assert "function reasoningEffortSettingsCard()" in app
    assert "Wake word" in app
    assert "Listening while awake and unlocked" in app
    assert "Waiting for screen wake" in app
    assert "Waiting for unlock" in app
    assert "Paused during active turn" in app
    assert "Wake service starting" in app
    assert "Microphone permission required" in app
    assert "Screen-off wake not enabled in this phase" in app
    assert "Wake requested, not armed" in app
    assert "Advanced" in app
    assert "Test cue" in app
    assert "Choose if replies stay as cards or also speak." in app
    assert "Cue when your message lands." in app
    assert "Buzz + chime" in app
    assert "settingsSelectorOverlay" in app
    assert "settingsSheet" in app
    assert "function openOverlay(overlayId, content, onBackdropClick)" in app
    assert "function closeOverlay(overlayId, { clearChildren = true } = {})" in app
    assert 'openOverlay("settingsSelectorOverlay", sheet, closeSettingsSelector);' in app
    assert 'closeOverlay("settingsSelectorOverlay");' in app
    assert "detail: wakeStatusDetail(state.wakeStatus)" in app
    assert "suspended_reason: String(raw.suspended_reason || \"\")" in app
    assert "state: String(raw.state || \"idle\")" in app
    assert "requested_enabled: enabled," in app
    assert "running: enabled\n" not in app
    assert 'settingsDiagnosticItem(\n        "Wake",' in app
    assert 'id="settingsSelectorOverlay"' in html
    assert 'class="settings-selector-overlay"' in html
    assert 'id="settingsSheet"' in html
    assert 'class="trace-sheet settings-sheet"' in html
    assert "replyModeButton(mode, label)" not in app
    assert "arrivalCueButton(mode, label)" not in app
    assert "diagnosticsSettingsCard()" not in app
    assert "const MOCK_SETTINGS" not in app
    assert ".settings-page" in styles
    assert ".settings-hero" in styles
    assert ".settings-card" in styles
    assert ".settings-selector-button" in styles
    assert ".settings-selector-overlay" in styles
    assert ".settings-selector-option" in styles
    assert ".settings-nav-card" in styles


def test_settings_tab_includes_default_audio_speed_control() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "defaultAudioSpeed" in app
    assert "defaultAudioSpeedAvailable" in app
    assert 'ui.default_audio_speed.get' in app
    assert 'ui.default_audio_speed.set' in app
    assert "async function loadDefaultAudioSpeed(options = {})" in app
    assert "function defaultAudioSpeedSettingCard()" in app
    assert "Default playback speed" in app
    assert "Device only" in app
    assert 'data-setting-id", "default-audio-speed"' in app
    assert 'openSpeedPicker({ kind: "setting"' in app
    assert 'openOverlay("speedOverlay", menu, closeSpeedPicker);' in app
    assert 'closeOverlay("speedOverlay");' in app
    assert ".settings-card-value" in styles
    assert ".settings-card.is-disabled" in styles
    assert ".speed-picker-title" in styles
    assert ".settings-toggle" in styles
    assert ".settings-action-button" in styles
    assert ".settings-diagnostics" in styles
    assert ".settings-segment-button" not in styles


def test_ui_surface_controller_treats_reset_nav_bundle_url_as_current() -> None:
    surface = (
        ROOT.parent
        / "pucky-apk"
        / "app"
        / "src"
        / "main"
        / "java"
        / "com"
        / "pucky"
        / "device"
        / "ui"
        / "UiSurfaceController.java"
    ).read_text(encoding="utf-8")

    assert "private static String comparableUrl(String value)" in surface
    assert "int fragment = cleaned.indexOf('#');" in surface
    assert "int query = cleaned.indexOf('?');" in surface
    assert "cleaned = cleaned.substring(0, query);" in surface
    assert "String effectiveUrl = comparableUrl" in surface
    assert "String expectedEntrypoint = comparableUrl(entrypointUrl);" in surface
    assert "return \"bundle_current\";" in surface


def test_leaving_home_uses_standard_material_card_icon() -> None:
    app = read("app.js")
    styles = read("styles.css")
    fixtures = runtime_fixture_text()

    assert "function cardIdentityIconSvg(card)" not in app
    assert "function shouldUseRetroCardIcon(card)" not in app
    assert 'identity.innerHTML = replyCardIconSvg(card.icon, { filled: true })' in app
    assert '"icon_style": "retro"' not in fixtures
    assert '"session_id": "fixture_leave"' in fixtures
    assert ".retro-card-icon" not in styles


def test_card_actions_have_local_read_state() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "async function requestFeedAction(card, action, options = {})" in app
    assert "function applyLocalFeedAction(cards, sourceCard, action)" in app
    assert "function requestMarkRead(card)" in app
    assert "function markCardRead(card)" in app
    assert "function toggleCardRead(card)" in app
    assert "function isCardRead(card)" in app
    assert "function cardStateClass(card)" in app
    assert "function toggleRead(card, action)" in app
    assert "function isActionRead(card, action)" in app
    assert 'requestFeedAction(card, "mark_read", { silent: true });' in app
    assert "result && result.ok === false" in app
    assert ": applyLocalFeedAction(state.cards, card, action);" in app
    assert "return { ...card, archived: true };" in app
    assert "return Boolean(card && card.read);" in app
    assert 'if (!options.restoring) {\n      markCardRead(card);' in app
    assert "const cardEl = el(\"article\", isMeetingList\n      ? meetingListCardClass(card)" in app
    assert "isCardRead(card)\n        ? \"card\"\n        : \"card card-unread\"" in app
    assert "cardStateClass(card)" in app
    assert 'actionStateClass(card, "page")' in app
    assert '"card card-unread"' in app
    assert 'iconSvg("mic"' in app
    assert "toggleCardRead(card)" in app
    assert 'iconSvg("chat"' not in app
    assert "action-transcript" not in app
    assert "action-page" not in app
    assert ".identity.is-unread" in styles
    assert "color: var(--accent" in styles
    assert ".card.card-unread" in styles
    assert "border-color: color-mix" in styles
    assert ".action.is-unread" in styles
    assert ".action.is-read" in styles
    assert "--action-accent" not in styles


def test_home_and_meeting_archive_use_left_reveal_trash_without_old_swipe_classes() -> None:
    app = read("app.js")
    styles = read("styles.css")
    archive = function_block(app, "archiveHomeCard")
    reveal = function_block(app, "installArchiveReveal")
    optimistic = function_block(app, "applyOptimisticHomeArchive")

    assert "authoritative: true" in app
    assert 'syncFeedCards({ reason: "load_cards", silent: true, render: true, authoritative: true })' in app
    assert 'const wrapper = el("div", "card-wrap");' in app
    assert "appendArchiveRevealAction(wrapper, {" in app
    assert 'iconSvg("delete", { filled: true })' in app
    assert "result && result.ok === false" in app
    assert 'await syncFeedCards({ reason: "pre_archive", silent: true, render: false, authoritative: true });' in archive
    assert "function applyOptimisticArchive(card)" not in app
    assert "const ARCHIVE_REVEAL_WIDTH_PX = 88" in app
    assert "const ARCHIVE_REVEAL_OPEN_THRESHOLD_PX = 44" in app
    assert "const ARCHIVE_REVEAL_SLOP_PX = 12" in app
    assert 'const ARCHIVE_REVEAL_DEBUG_STORAGE_KEY = "pucky.cover.archive_reveal_debug.v1"' in app
    assert "const ARCHIVE_REVEAL_CLOSE_REASONS = Object.freeze([" in app
    assert '"threshold_not_met"' in app
    assert '"outside_dismiss"' in app
    assert '"click_capture_close"' in app
    assert '"feed_rubberband_reset"' not in app
    assert '"pointercancel"' in app
    assert '"touchcancel"' in app
    assert '"route_change"' in app
    assert '"busy_archive"' in app
    assert "window.__puckyArchiveRevealDebug = {" in app
    assert "getTrace()" in app
    assert "clearTrace()" in app
    assert "getState()" in app
    assert "setEnabled(enabled)" in app
    assert "archiveRevealDebugRecord({" in app
    assert "function installCardArchiveSwipe(wrapper, card)" not in app
    assert "function installFeedLikeSwipeArchive(wrapper, item, config)" not in app
    assert "function installMeetingArchiveSwipe(wrapper, meeting)" not in app
    assert "function canArchiveBySwipe(card)" not in app
    assert "function canArchiveMeetingBySwipe(meeting)" not in app
    assert "Math.abs(dx) < ARCHIVE_REVEAL_SLOP_PX" in reveal
    assert "applyOffset(startOffset - dx);" in reveal
    assert "if (currentOffset() >= ARCHIVE_REVEAL_OPEN_THRESHOLD_PX)" in reveal
    assert "actionButton.tabIndex = isOpen ? 0 : -1;" in reveal
    assert 'let activeInputSource = "";' in reveal
    assert 'if (active && activeInputSource !== source) {' in reveal
    assert "activeInputSource = source;" in reveal
    assert "activeInputSource !== source" in reveal
    assert 'if (!shouldHandleTouchLikePointerEvent(event, preferTouchEvents)) {' in reveal
    assert 'begin(event.clientX, event.clientY, event.target, event.pointerId, "pointer");' in reveal
    assert 'move(event.clientX, event.clientY, "pointer");' in reveal
    assert 'finish("pointer");' in reveal
    assert 'record("cancel", { source: "pointer", close_reason: "pointercancel" });' in reveal
    assert 'begin(event.touches[0].clientX, event.touches[0].clientY, event.target, null, "touch");' in reveal
    assert 'move(event.touches[0].clientX, event.touches[0].clientY, "touch");' in reveal
    assert 'finish("touch");' in reveal
    assert 'record("cancel", { source: "touch", close_reason: "touchcancel" });' in reveal
    assert "preferTouchEvents" in reveal
    assert "isTouchPointerEvent(event)" not in reveal
    assert 'closeReveal({ immediate: false, source, reason: "threshold_not_met" });' in reveal
    assert 'closeReveal({ immediate: false, reason: "click_capture_close", context: "wrapper_click_capture" });' in reveal
    assert 'record("open");' in reveal
    assert 'target?.closest(".archive-reveal-action")' in app
    assert 'dismissArchiveReveal({ immediate: true, reason: "route_change", context: "route_change" });' in app
    assert 'dismissArchiveReveal({ immediate: true, reason: "unknown", context: "render_feed" });' in app
    assert 'reason: "outside_dismiss"' in function_block(app, "installArchiveRevealOutsideDismiss")
    assert "applyOptimisticHomeArchive(card)" in app
    assert "state.cards = state.cards.map(item => {" in optimistic
    assert "archived: true" in optimistic
    assert 'return sameCardId || sameSession ? { ...item, archived: true } : item;' in optimistic
    assert 'command: "pucky.feed.action"' not in app
    assert "CARD_ARCHIVE_SWIPE_" not in app
    assert ".archive-reveal-action" in styles
    assert ".card-wrap.is-archive-reveal-open .archive-reveal-action" in styles
    assert ".card-wrap.is-archive-reveal-active .archive-reveal-action" in styles
    assert "ARCHIVE_REVEAL_DEBUG_BADGE_RENDERING_ENABLED = false" in app
    assert ".archive-reveal-debug-badge" not in styles
    assert ".card-wrap.is-card-swipe-dragging .card" not in styles
    assert ".card-wrap.is-card-swiped-away .card" not in styles
    assert ".card-wrap.is-card-collapsing" not in styles
    assert ".card-swipe-action" not in styles
    assert ".feed-card-wrap" not in styles


def test_card_actions_are_aligned_to_content_row() -> None:
    styles = read("styles.css")

    assert "grid-template-rows: auto minmax(48px, auto)" in styles
    assert ".card-timestamp" in styles
    assert "grid-row: 1;" in styles
    assert ".card-actions" in styles
    assert "grid-row: 2;" in styles
    assert "align-self: center;" in styles


def test_transcript_and_pages_use_right_slide_detail_navigation() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "function openSideDetail(" in app
    assert "openBottomSheet" not in app
    assert 'openSideDetail(panel, card.title || "Transcript", content, dismissDetail)' in app
    assert 'openSideDetail(panel, card.title || "Page", content, dismissWithCleanup)' in app
    assert "installHorizontalDismiss(shell, panel, onDismiss)" in app
    assert "allow-same-origin" in app
    assert '"rich-swipe-edge"' in app
    assert "installHorizontalDismiss(edge, panel, dismissWithCleanup)" in app
    assert "installIframeHorizontalDismiss" not in app
    assert "installFrameMessageDismiss" not in app
    assert "withDetailSwipeBridge" not in app
    assert "pucky-detail-swipe" not in app
    assert "requestAnimationFrame(applyFrame)" in app
    assert ".rich-swipe-edge" in styles
    assert 'iconSvg("chevron_left"' in app
    assert "function installHorizontalDismiss(" in app
    assert "translateX(100%)" in styles
    assert "translateY(100%)" in styles
    assert ".detail-panel.is-open" in styles
    assert ".detail-header" in styles
    assert "flex: 0 0 45px" in styles
    assert "grid-template-columns: 45px minmax(0, 1fr) 45px" in styles
    assert "width: 45px" in styles
    assert "height: 45px" in styles
    assert "position: sticky" in styles
    assert ".detail-back" in styles
    assert "width: 24px" in styles
    assert "height: 24px" in styles
    assert ".detail-title" in styles
    assert ".rich-detail" in styles


def test_rich_pages_fill_detail_space_and_mock_paths_have_fallback() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "function mockArtifactResult(path)" in app
    assert "function isMockHtmlArtifact(path)" in app
    assert "async function richFrame(result, path = \"\", source = null)" in app
    assert 'if (isMockHtmlArtifact(card.html_path))' in app
    assert "mockArtifactResult(card.html_path)" in app
    assert "height: calc(100vh - 58px - var(--nav-safe))" not in styles
    assert "min-height: calc(100vh - 58px - var(--nav-safe))" not in styles
    assert ".rich-frame" in styles
    assert "height: 100%" in styles
    assert "flex: 1 1 auto" in styles
    assert ".rich-detail" in styles
    assert "display: flex" in styles
    rich_detail = css_block(styles, ".rich-detail")
    assert "padding: 0;" in rich_detail
    assert "var(--nav-safe)" not in rich_detail


def test_sheet_drag_waits_for_release_before_dismissal() -> None:
    app = read("app.js")

    assert "primary > threshold()" not in app.split("const finish =")[0]
    assert "const delta = config.axis" in app
    assert "if (confirmed && delta > threshold())" in app
    assert "config.done();" in app
    assert "config.reset();" in app
    assert "scrollTarget: target" in app
    assert "function canScrollUp(target)" in app
    assert "target.scrollTop > 0" in app
    assert "activePointerId = event.pointerId" in app
    confirm_body = app.split("if (!confirmed) {", 1)[1].split("scheduleApply(primary)", 1)[0]
    assert "target.setPointerCapture(activePointerId)" in confirm_body
    pointerdown_body = app.split('add("pointerdown", event => {', 1)[1].split('add("pointermove"', 1)[0]
    assert "target.setPointerCapture" not in pointerdown_body


def test_feed_waveform_and_mic_follow_current_playback_only() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert 'waveform(card, "wave-row"' in app
    assert '"action action-audio is-playing"' in app
    assert "function activePlayerMatchesCard(card) {" in app
    assert "function isPlayingCard(card) {" in app
    assert "if (isPlayingCard(card)) {" in app
    click_body = app.split('audio.addEventListener("click", async (event) => {', 1)[1].split(
        "      });\n      actions.append(audio);", 1
    )[0]
    assert "await toggleAudio(card);" in click_body
    assert "showAudioDetail(card)" not in click_body
    assert '? "Pause" : "Play"' in app
    assert '"Resume"' not in app.split('audio.setAttribute("aria-label"', 1)[1].split(");", 1)[0]
    assert ".wave-row" in styles
    assert "width: 50%" not in styles
    assert "width: 100%" in styles
    assert ".action-audio.is-playing" in styles
    assert "color: var(--accent" in styles
    active_body = app.split("function isActiveCard(card) {", 1)[1].split("\n  }\n\n  function hasAudio(card)", 1)[0]
    assert "activePlayerMatchesCard(card)" in active_body
    assert "return samePath(state.activePath, audioControlKey(card));" in active_body
    match_body = app.split("function activePlayerMatchesCard(card) {", 1)[1].split("\n  }\n\n  function isPlayingCard(card)", 1)[0]
    assert "playerHasAudioIdentity(state.player)" in match_body
    assert "isSameAudioCard(state.player, card)" in match_body
    playing_body = app.split("function isPlayingCard(card) {", 1)[1].split("\n  }\n\n  function hasAudio(card)", 1)[0]
    assert "state.player.is_playing" in playing_body
    assert "activePlayerMatchesCard(card)" in playing_body
    assert "state.activePath" not in playing_body


def test_smart_card_and_message_timestamps_are_rendered() -> None:
    app = read("app.js")
    styles = read("styles.css")
    fixtures = runtime_fixture_text()

    assert "function cardTimestamp(card)" in app
    card_timestamp_body = app.split("function cardTimestamp(card) {", 1)[1].split("\n  }\n\n  function messageTimestamp", 1)[0]
    assert "card.updated_at || card.created_at || card.timestamp || card.time || \"\"" in card_timestamp_body
    assert "function messageTimestamp(message)" in app
    assert "function smartTimestamp(raw, fallback = \"\")" in app
    assert "function formatSmartTimestamp(date, now = new Date())" in app
    assert "24 * 60 * 60 * 1000" in app
    assert 'return "Yesterday"' in app
    assert 'weekday: "long"' in app
    assert 'String(date.getFullYear()).slice(-2)' in app
    assert '"card-timestamp"' in app
    assert ".card-timestamp" in styles
    assert 'message.created_at || message.timestamp || ""' in app
    assert "message.time || message.timestamp || \"\"" in app
    assert '"created_at": "2026-05-20T06:33:00-07:00"' in fixtures
    assert '"created_at": "2026-05-09T16:13:00-07:00"' in fixtures


def test_audio_resume_and_completion_reset_are_explicit() -> None:
    app = read("app.js")

    assert "const COMPLETE_EPSILON_MS = 500" in app
    assert "const AUDIO_STATE_KEY = \"pucky.cover.audio_state.v1\"" in app
    assert "completedPaths" in app
    assert "speedByPath" in app
    assert "selectedTimestampByPath" in app
    assert "function loadAudioState()" in app
    assert "function persistAudioState()" in app
    assert "function isCompletePlayback(player)" in app
    assert "function rememberPlayerProgress(player)" in app
    assert "function forgetCompleted(path)" in app
    assert "savedPositionFor(path)" in app
    assert "function activePlayerMatchesCard(card)" in app
    assert "function savedSpeedForCard(card)" in app
    assert "function resolvedStartSpeedForCard(card)" in app
    assert 'args: { path: audioPath, title: card.title, start_at_ms: start, speed: resolvedStartSpeedForCard(card) }' in app
    assert 'args: { start_at_ms: savedPositionFor(current.source || current.path), speed: resolvedStartSpeedForCard(card) }' in app
    assert 'args: { start_at_ms: start, speed: resolvedStartSpeedForCard(card) }' in app


def test_pausing_audio_keeps_active_card_preview_lane() -> None:
    app = read("app.js")

    pause_body = app.split("async function pauseWithRewind(card) {", 1)[1].split("\n  }\n\n  function control(", 1)[0]
    assert 'command: "player.pause"' in pause_body
    assert 'command: "player.seek"' in pause_body
    assert "rememberPlayerProgress(rewound);" in pause_body
    assert 'state.activePath = audioControlKey(card);' in pause_body
    assert 'state.activePath = "";' not in pause_body
    assert "rememberPlayerProgress(current)" in app


def test_paused_player_events_keep_active_card_lane_when_identity_matches() -> None:
    app = read("app.js")

    sync_body = app.split("function syncActivePathFromPlayer(player) {", 1)[1].split("\n  }\n\n  function samePath(", 1)[0]
    assert "!playerHasAudioIdentity(player)" in sync_body
    assert "!player.is_playing" not in sync_body
    assert 'state.activePath = "";' in sync_body
    assert "const matched = state.cards.find(card => isSameAudioCard(player, card));" in sync_body
    assert "state.activePath = audioControlKey(matched);" in sync_body
    assert "samePath(playerStateKey(player), state.activePath)" in sync_body


def test_audiobook_card_uses_single_file_with_timestamps() -> None:
    app = read("app.js")
    fixtures = runtime_fixture_text()
    deploy_cards_fixture = read("fixtures/reply_cards_deploy.json")

    assert '"audio_path": "/mock/pocket-computers.wav"' in fixtures
    assert '"audio_timestamps"' in fixtures
    assert '"audio_playlist_path": "/mock/pocket-computers.m3u"' not in fixtures
    assert '"device_audio_path": "/storage/emulated/0/Android/data/com.pucky.device.debug/files/audiobooks/From_Pocket_Computers_to_Planetary_Platforms_Kokoro_George.m4a"' in deploy_cards_fixture
    assert '"public_audio_playlist_path"' not in deploy_cards_fixture
    assert "function hasAudio(card)" in app
    assert "function audioControlKey(card)" in app
    assert "function isSameAudioCard(player, card)" in app
    assert "function playerHasAudioIdentity(player)" in app
    assert "function syncActivePathFromPlayer(player)" in app
    assert "if (activePlayerMatchesCard(card)) {" in app
    assert "syncActivePathFromPlayer(state.player)" in app
    assert "|| samePath(state.activePath, audioControlKey(card))" not in app
    assert 'command: "player.queue.set"' in app
    assert "playlist_path: card.audio_playlist_path" in app
    assert "samePath(player.source, card.audio_playlist_path)" in app
    assert "sameCompleted = same && isCompletePlayback(current)" in app
    assert "function audioTimestamps(card)" in app
    assert "function timestampListView(card)" in app
    assert "function jumpToTimestamp(card, marker)" in app
    assert 'command: "player.seek"' in app
    assert "position_ms: positionMs" in app


def test_manual_pause_rewinds_one_second_before_bookmarking() -> None:
    app = read("app.js")

    assert "async function pauseWithRewind(card)" in app
    assert 'command: "player.pause"' in app
    assert 'Number(paused.position_ms || 0) - 1000' in app
    assert 'command: "player.seek"' in app
    assert 'position_ms: rewindTo' in app
    assert "rememberPlayerProgress(rewound)" in app
    assert "state.player = await pauseWithRewind(card)" in app


def test_paused_audio_detail_uses_live_player_values_for_matched_card() -> None:
    app = read("app.js")

    position_body = app.split("function playbackPositionForCard(card) {", 1)[1].split("\n  }\n\n  function scrubPreviewForCard(card)", 1)[0]
    assert "activePlayerMatchesCard(card)" in position_body
    assert "return Number(state.player.position_ms || 0);" in position_body
    duration_body = app.split("function audioDurationForCard(card) {", 1)[1].split("\n  }\n\n  function audioTimestamps(card)", 1)[0]
    assert "activePlayerMatchesCard(card)" in duration_body
    assert "return playerDuration;" in duration_body
    assert 'const speed = activePlayerMatchesCard(card) ? (state.player.speed || resolvedStartSpeedForCard(card)) : resolvedStartSpeedForCard(card);' in app


def test_transcript_initial_open_scrolls_to_latest_message() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert '"detail-content chat-detail"' in app
    assert 'const stack = el("div", "chat-stack")' in app
    assert "stack.append(bubble)" in app
    assert "content.append(stack)" in app
    assert "scrollTranscriptToLatest(content)" in app
    assert "function scrollTranscriptToLatest(content)" in app
    assert "requestAnimationFrame" in app
    assert "content.scrollTop = content.scrollHeight" in app
    assert ".chat-detail" in styles
    assert ".chat-stack" in styles
    assert ".detail-content" in styles
    assert ".bubble.assistant" in styles
    assert "width: 100%" in styles
    assert "max-width: 100%" in styles
    chat_detail = css_block(styles, ".chat-detail")
    assert "padding: 18px;" in chat_detail
    assert "var(--nav-safe)" not in chat_detail
    chat_stack = css_block(styles, ".chat-stack")
    assert "min-height: 100%;" in chat_stack
    assert "display: flex;" in chat_stack
    assert "justify-content: flex-end;" in chat_stack


def test_audio_detail_uses_full_screen_top_bar_and_compact_controls() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")

    assert 'id="audioSheet"' not in html
    assert ".audio-sheet" not in styles
    assert "function showAudioDetail(card, options = {})" in app
    assert "function renderAudioDetail()" in app
    assert "function refreshAudioDetail(card, existing)" in app
    assert "function showMeetingTranscriptDetail(card)" in app
    assert "existing.dataset.audioKey === audioStateKey(card)" in app
    assert "content.dataset.audioKey = audioStateKey(card)" in app
    assert 'openSideDetail(panel, card.title || "Audio", content, dismissAudioDetail)' in app
    assert '"detail-content audio-detail"' in app
    assert 'content.classList.add("meeting-audio-detail")' in app
    assert "content.append(meetingTranscriptAction(card));" in app
    assert 'el("button", "meeting-view-transcript", label)' in app
    assert "showTranscript(meetingCardFromRecord(meeting));" in app
    assert ".audio-detail" in styles
    meeting_detail = css_block(styles, ".meeting-audio-detail")
    assert "height: calc(var(--viewport-safe-h) - 45px);" in meeting_detail
    assert "min-height: calc(var(--viewport-safe-h) - 45px);" in meeting_detail
    assert ".meeting-transcript-action" in styles
    assert ".meeting-view-transcript" in styles
    transcript_detail = css_block(styles, ".meeting-transcript-detail")
    assert "flex: 1 1 0;" in transcript_detail
    assert "overflow: hidden;" in transcript_detail
    meeting_transcript = css_block(styles, ".meeting-transcript-section")
    assert "flex: 1 1 0;" in meeting_transcript
    assert "min-height: 0;" in meeting_transcript
    assert "height: max(260px" not in meeting_transcript
    assert "overflow-y: auto;" in meeting_transcript
    assert ".audio-controls" in styles
    assert "card.summary && audioTimestamps(card).length === 0" in app
    assert "grid-template-columns: minmax(66px, 1fr) auto minmax(66px, 1fr)" in styles
    assert ".transport-cluster" in styles
    assert ".control-spacer" in styles
    assert "showAudioSheet" not in app
    assert "renderAudioSheet" not in app
    assert "--sheet-bezel: 82px" not in styles
    assert "--sheet-top: 16px" in styles
    assert 'iconControl("replay_15"' in app
    assert 'iconControl(state.player.is_playing && activePlayerMatchesCard(card) ? "pause" : "play_arrow"' in app
    assert 'iconControl("forward_30"' in app
    assert 'control("15"' not in app
    assert 'control("30"' not in app
    assert 'state.player.is_playing ? "||" : ">"' not in app
    assert ".control-skip .material-icon" in styles
    assert ".control-play .material-icon" in styles
    assert ".timestamp-list" in styles
    assert 'player.append(waveform(card, "audio-wave"' not in app
    assert "min-height: 148px" in styles
    assert ".timestamp-row.is-active" in styles
    assert ".timestamp-row.is-selected" in styles
    assert "rowClasses.push(\"is-active\")" in app
    assert "rowClasses.push(\"is-selected\")" in app
    assert '"scrub-slider"' in app
    assert 'slider.addEventListener("pointermove"' in app
    assert 'slider.addEventListener("pointerup"' in app
    assert 'slider.addEventListener("touchmove"' in app
    assert "event.stopPropagation()" in app
    assert "setPointerCapture" in app
    assert "releasePointerCapture" in app
    assert "function scrubPositionFromPointer(slider, event, durationMs)" in app
    assert "function scrubPositionFromClientX(slider, clientX, durationMs)" in app
    assert "function isDragIgnoredTarget(target)" in app
    assert "isDragIgnoredTarget(event.target)" in app
    assert 'slider.dataset.dragIgnore = "true"' in app
    assert "function updateAudioScrubPreview(card, scrub, positionMs)" in app
    assert "function updateTimestampPreview(card, positionMs)" in app
    assert "function updateScrubChapterPreview(card, slider, positionMs, durationMs)" in app
    assert "function appendScrubChapterTicks(slider, card, durationMs)" in app
    assert "scrubChapterBubble" not in app
    assert "scrubbingAudioKey" in app
    assert "function startAudioScrub(card, positionMs)" in app
    assert "state.scrubbingAudioKey === audioStateKey(card)" in app
    assert "row.dataset.timestampId = marker.id" in app
    assert ".scrub-chapter-tick" in styles
    assert ".scrub-chapter-marker" in styles
    assert ".scrub-chapter-range" in styles
    assert ".scrub-chapter-bubble" not in styles
    assert ".timestamp-play" in styles
    assert ".audio-scrub" in styles
    assert ".scrub-slider" in styles
    assert ".scrub-knob" in styles
    assert "padding: 0 clamp(22px, 2.5vw, 32px)" in styles
    assert "touch-action: none" in styles
    assert "pointer-events: none" in styles
    assert "overscroll-behavior: contain" in styles
    assert "time-elapsed" in app
    assert "time-remaining" in app
    assert "const hours = Math.floor(total / 3600)" in app
    assert 'return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`' in app


def test_chapter_rows_preview_before_commit_and_keep_transport_play_pure() -> None:
    app = read("app.js")

    preview = re.search(r"function previewTimestamp\(card, marker\) \{(?P<body>.*?)\n  \}", app, re.S)
    assert preview, "Missing previewTimestamp"
    assert "rememberSelectedTimestamp(card, marker)" in preview.group("body")
    assert "Pucky.request" not in preview.group("body")
    assert 'command: "player.seek"' not in preview.group("body")
    assert 'command: "player.play"' not in preview.group("body")
    assert 'command: "player.queue.set"' not in preview.group("body")

    assert "function handleTimestampRowClick(card, marker, event)" in app
    assert "event.detail > 1" in app
    assert "now - previous.at < 420" in app
    assert "previewTimestamp(card, marker)" in app
    assert "commitTimestamp(card, marker)" in app
    assert 'const row = el("div", rowClasses.join(" "))' in app
    assert 'row.setAttribute("role", "button")' in app
    assert 'row.addEventListener("keydown", (event) => handleTimestampRowKeydown(card, marker, event))' in app
    assert 'row.addEventListener("click", (event) => handleTimestampRowClick(card, marker, event))' in app
    assert 'iconControl("play_arrow", `Play ${marker.title} from ${formatTime(marker.start_ms)}`' in app
    assert "event.stopPropagation();" in app
    assert "function handleTimestampRowKeydown(card, marker, event)" in app

    controls = re.search(r"function audioControls\(card\) \{(?P<body>.*?)\n  \}", app, re.S)
    assert controls, "Missing audioControls"
    assert "toggleAudio(card)" in controls.group("body")
    assert "commitTimestamp" not in controls.group("body")
    assert "previewTimestamp" not in controls.group("body")

    commit = re.search(r"async function commitTimestamp\(card, marker\) \{(?P<body>.*?)\n  \}", app, re.S)
    assert commit, "Missing commitTimestamp"
    assert 'command: "player.seek"' in commit.group("body")
    assert 'command: "player.play"' in commit.group("body")


def test_navigation_state_persists_routes_details_and_scroll_restore() -> None:
    app = read("app.js")

    assert 'const NAV_STATE_KEY = "pucky.cover.nav_state.v1"' in app
    assert "const persistedNavState = loadNavState();" in app
    assert "const initialRouteValue = initialRoute(persistedNavState.route, initialTheme);" in app
    assert "route: initialRouteValue" in app
    assert "openTrayRoute: initialOpenTrayRoute(persistedNavState.open_tray_route, persistedNavState.route, initialHomeShellActiveValue, initialTheme)" in app
    assert "feedScrollTop: scrollNumber(persistedNavState.feed_scroll_top)" in app
    assert "navDetail: normalizeNavDetail(persistedNavState.detail)" in app
    assert "function loadNavState()" in app
    assert "function shouldResetNavState()" in app
    assert 'params.get("reset_nav") === "1"' in app
    assert "localStorage.removeItem(NAV_STATE_KEY)" in app
    assert "function persistNavState()" in app
    assert "function restoreNavStateAfterCards()" in app
    assert "function dismissTransientUiForRouteChange()" in app
    assert "function installFeedScrollPersistence()" in app
    assert "function installDetailScrollPersistence(content, type)" in app
    assert "function restoreScrollPosition(target, scrollTop)" in app
    assert "function findCardBySessionId(sessionId)" in app
    assert "restoreNavStateAfterCards();" in app
    assert "showAudioDetail(card, { restoring: true" in app
    assert "showTranscript(card, { restoring: true" in app
    assert "showRichPage(card, { restoring: true" in app
    assert "showImageReel(card, null, { restoring: true" in app
    assert "timestamp_scroll_top" in app
    assert "state.navDetail = null" in app
    assert 'if (state.route !== "feed") {' in app
    assert "dismissDetail();" in app
    assert "dismissTraceSheet();" in app
    assert "closeSpeedPicker();" in app
    assert 'window.addEventListener("pagehide", persistNavState)' in app
    assert 'document.addEventListener("visibilitychange"' in app
    assert "installFeedScrollPersistence();" in app


def test_generated_images_open_as_html_reel_not_native_previews() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")
    fixture = read("fixtures/reply_cards_deploy.json")

    assert 'id="traceSheet"' in html
    assert "function cardImages(card)" in app
    assert "function messageImages(card, message, index, messages)" in app
    assert "function restorableImagesForCard(card)" in app
    assert "function chatMediaBubble(card, images)" in app
    assert "function showAttachmentViewer(card, attachmentSet = null, options = {})" in app
    assert "function showVideoAttachment(card, item, options = {})" in app
    assert '"attachment-video-shell"' in app
    assert "video.controls = false" in app
    assert 'video.setAttribute("playsinline", "")' in app
    assert 'video.setAttribute("webkit-playsinline", "")' in app
    assert '"attachment-video-play"' in app
    assert 'play.addEventListener("click"' in app
    assert 'event.stopPropagation();\n      toggle();' in app
    assert 'video.addEventListener("click"' in app
    assert 'shell.addEventListener("click"' not in app
    assert "function formatVideoTime(seconds)" in app
    assert "await video.play()" in app
    assert "async function resolveMediaSrc(image, options = {})" in app
    assert "preferDataUrl: isVideoMedia(image) ? true : options.preferDataUrl" in app
    assert "video.src = await resolveMediaSrc(item, {" in app
    assert "!options.preferDataUrl && window.PuckyAndroid" in app
    assert '"video-controls"' in app
    assert '"video-timeline"' in app
    assert '"video-progress"' in app
    assert '"video-scrubber"' in app
    assert "const seekFromPointer = (event) =>" in app
    assert "video.currentTime = ratio * duration;" in app
    assert 'video.addEventListener("seeked", updateVideoUi)' in app
    assert "frame.append(shell, attachmentMeta(item, \"Video\"))" not in app
    assert "frame.append(shell);" in app
    assert "function detailDismissHandler(options = {}, fallback = dismissDetail)" in app
    assert "const dismissAttachment = detailDismissHandler(options);" in app
    assert 'back.setAttribute("aria-label", "Back")' in app
    assert 'back.setAttribute("aria-label", "Back to feed")' not in app
    assert "function showDocumentAttachment(card, item, options = {})" in app
    assert "async function documentViewer(card, item, options = {})" in app
    assert "function showImageReel(card, imageSet = null, options = {})" in app
    assert "const restoreOptions = typeof options === \"number\"" in app
    assert "function currentImageGalleryIndex(track)" in app
    assert "function installOneSlidePager(track)" in app
    assert "track.dataset.oneSlidePagerBound" in app
    assert "const animateTo = (targetLeft, speed = 0, onComplete = reset) =>" in app
    assert "const settleDurationFor = (distance, speed) =>" in app
    assert "const flick = Math.abs(releaseVelocity) >= 0.32" in app
    assert "Math.min(82, Math.max(28, track.clientWidth * 0.11))" in app
    assert "snapTo(startIndex + direction, { velocity: releaseVelocity })" in app
    assert "track.scrollLeft = startLeft - dx" in app
    assert "behavior: \"smooth\"" not in app
    assert "function resolveImageSrc(image)" in app
    assert "function resolveArtifactUrl(item, options = {})" in app
    assert 'command: "artifact.url"' in app
    resolve_artifact = app.split("async function resolveArtifactUrl", 1)[1].split("function resolvedImageMime", 1)[0]
    assert "if (item.url)" in resolve_artifact
    assert resolve_artifact.index('command: "artifact.url"') < resolve_artifact.index('command: "artifact.read_base64"')
    assert "function resolvedImageMime(result, image, path)" in app
    assert "function isPdfMedia(item)" in app
    assert "function attachmentKind(item)" in app
    assert "function isDocumentMedia(item)" in app
    assert "function mediaDocumentMeta(item)" in app
    assert "function mediaDocumentPreview(item, variant)" in app
    assert "function documentHtmlSrc(item)" in app
    assert "async function loadDocumentHtml(src, item)" in app
    assert "item.viewer_path || item.html_viewer_path || item.document_html_path" in app
    assert "max_bytes: 2 * 1024 * 1024" in app
    assert "function documentPreviewSrc(item)" in app
    assert "function isVideoMedia(item)" in app
    assert '"chat-media-video"' in app
    assert '"image-reel-video"' in app
    assert "video/mp4" in app
    assert '"media-doc-render"' in app
    assert "Rendered from real local file" in app
    assert "Cached document preview" not in app
    assert "async function richFrame(result, path = \"\", source = null)" in app
    assert "mime === \"application/pdf\"" in app
    assert "mime === \"application/pdf\" ||" in app
    assert "data:application/pdf;base64" in app
    assert 'declared !== "application/octet-stream"' in app
    assert 'returned !== "application/octet-stream"' in app
    assert "showAttachmentViewer(card, images, { initialIndex: index, onDismiss: () => showTranscript(card) })" in app
    assert "return showVideoAttachment(card, item" in app
    assert "return showDocumentAttachment(card, item" in app
    assert 'openSideDetail(panel, item.title || card.title || "Video", content, dismissAttachment)' in app
    assert 'openSideDetail(panel, item.title || card.title || "Attachment", content, dismissAttachment)' in app
    assert "const dismissGallery = () =>" in app
    assert "if (onDismiss)" in app
    assert '"chat-media-rail"' in app
    assert '"image-gallery-track"' in app
    assert "rail.dataset.dragIgnore = \"true\"" in app
    assert "track.dataset.dragIgnore = \"true\"" in app
    assert "installOneSlidePager(rail)" in app
    assert "installOneSlidePager(track)" in app
    assert '"image-swipe-edge"' in app
    assert '"image-reel-nav"' not in app
    assert "Previous image" not in app
    assert "Next image" not in app
    assert 'iconSvg("chevron_right"' not in app
    assert '"chat-media-grid"' not in app
    assert ".chat-media-grid" not in styles
    assert ".chat-media-multiple" not in styles
    assert ".image-reel-nav" not in styles
    assert '"image-reel-count"' in app
    assert '"image-affordance"' not in app
    assert ".image-affordance" not in styles
    assert "card-wrap.has-images" not in styles
    assert '"chat-media"' in app
    assert "media-doc-preview" in app
    assert "${images.length} items" in app
    assert ".chat-media" in styles
    assert ".chat-media-rail" in styles
    assert ".chat-media::after" in styles
    assert ".chat-media-count" in styles
    assert ".media-doc-preview" in styles
    assert ".media-doc-render" in styles
    assert ".media-doc-label" in styles
    assert ".chat-media-video" in styles
    assert ".image-reel-video" in styles
    assert ".attachment-video-shell" in styles
    assert ".attachment-video-play" in styles

    assert ".attachment-video-player" in styles
    assert ".video-controls" in styles
    assert ".video-timeline" in styles
    assert ".video-progress" in styles
    assert ".video-scrubber" in styles
    video_play = css_block(styles, ".attachment-video-play")
    assert "width: 94px;" in video_play
    assert "height: 94px;" in video_play
    assert "touch-action: manipulation;" in video_play
    assert "pointer-events: auto;" in css_block(styles, ".attachment-video-shell.is-playing .attachment-video-play")
    assert ".document-frame" in styles
    assert ".document-detail" in styles
    document_detail = css_block(styles, ".document-detail")
    assert "overflow-x: hidden;" in document_detail
    assert "overflow-y: auto;" in document_detail
    assert "-webkit-overflow-scrolling: touch;" in document_detail
    assert "touch-action: pan-y;" in document_detail
    document_rendered = css_block(styles, ".document-rendered")
    assert "flex: 0 0 auto;" in document_rendered
    assert "width: 100%;" in document_rendered
    document_header = css_block(styles, ".document-rendered > header")
    assert "position: relative;" in document_header
    assert "position: sticky" not in document_header
    assert "background: #fbfcff;" in document_header
    assert ".media-doc-preview.has-render .media-doc-render" in styles
    assert ".media-doc-preview.is-gallery.has-render .media-doc-label" in styles
    assert ".chat-media-video {\n  object-fit: contain;" in styles
    assert ".media-doc-preview.is-gallery" in styles
    assert ".media-doc-badge" in styles
    assert '.media-doc-preview[data-kind="docx"]' in styles
    assert '.media-doc-preview[data-kind="xlsx"]' in styles
    assert '.media-doc-preview[data-kind="pptx"]' in styles
    assert "artifact.read_base64" in app
    assert ".image-reel" in styles
    assert ".image-gallery" in styles
    assert ".image-gallery-track" in styles
    assert ".image-swipe-edge" in styles
    assert ".image-slide" in styles
    assert ".image-slide-frame" in styles
    assert ".image-reel-count" in styles
    assert ".image-reel-meta" in styles
    assert "scroll-snap-type: x mandatory" in styles
    assert "scroll-snap-stop: always" in styles
    assert "touch-action: pan-y" in styles
    assert ".image-gallery-track.is-touch-paging" in styles
    assert "scroll-snap-type: none" in styles
    assert "scroll-behavior: smooth" not in styles
    assert "object-fit: contain" in styles
    assert "height: 52vh" not in styles
    assert "max-height: 540px" not in styles
    assert '"transcript_messages"' in fixture
    assert "real-alfred-square.png" not in fixture
    assert "real-laptop-app-icon.png" not in fixture
    assert fixture.count('"artifact": "real-master-through-chapter-8.pdf"') == 1
    assert fixture.count('"artifact": "real-manuscript-chapters-0-7.docx"') == 1
    assert fixture.count('"artifact": "real-video-4-webview.mp4"') == 1
    assert fixture.count('"artifact": "real-clipchamp-demo-webview.mp4"') == 1
    assert fixture.count('"artifact": "real-pucky-proof-webview.mp4"') == 1
    assert fixture.count('"mime_type": "video/mp4"') >= 3
    assert fixture.count('"preview_artifact": "real-master-through-chapter-8-pdf-page-1.png"') == 1
    assert fixture.count('"preview_artifact": "real-manuscript-chapters-0-7-docx-preview.png"') == 1
    assert fixture.count('"viewer_artifact": "real-master-through-chapter-8-pdf.html"') == 1
    assert fixture.count('"viewer_artifact": "real-manuscript-chapters-0-7-docx.html"') == 1
    assert (UI / "fixtures/artifacts/real-master-through-chapter-8-pdf.html").exists()
    assert (UI / "fixtures/artifacts/real-manuscript-chapters-0-7-docx.html").exists()
    assert '"title": "Clipchamp sample MP4"' in fixture
    assert '"title": "Pucky proof MP4"' in fixture
    assert fixture.count('"artifact": "commute-dashboard.png"') == 1
    assert fixture.count('"artifact": "meeting-room.jpg"') == 1
    assert fixture.count('"artifact": "night-wrap.png"') == 1
    assert '"html_artifact": "meeting-decision.pdf"' in fixture
    assert '"mime_type": "image/png"' in fixture
    assert '"mime_type": "image/jpeg"' in fixture
    assert '"mime_type": "application/pdf"' in fixture
    assert '"mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"' in fixture


def test_paperclip_requires_real_openable_attachment_source() -> None:
    app = read("app.js")

    assert "function hasAttachmentSource(attachment)" in app
    has_source = app.split("function hasAttachmentSource", 1)[1].split("function normalizeAttachment", 1)[0]
    assert "attachment.url" in has_source
    assert "const textLike =" in has_source
    assert 'kind === "text"' in has_source
    assert 'kind === "audio"' not in has_source
    assert "if (!textLike) {\n      return false;\n    }" in has_source
    assert "hasMeaningfulAttachmentText(attachment.text || attachment.preview)" in has_source
    assert "speaker-separated transcript with timestamps" in app
    assert "htmlAttachmentLocalPath(item)" in app
    assert "raw.url" in app


def test_android_system_back_closes_html_detail_first() -> None:
    app = read("app.js")

    assert "function handleAndroidBack()" in app
    assert "window.PuckyHandleAndroidBack = handleAndroidBack" in app
    assert 'detail.classList.contains("is-open")' in app
    assert 'detail.querySelector(".detail-back")' in app
    assert "back.click()" in app
    assert "dismissDetail()" in app
    assert 'traceSheet.classList.contains("is-open")' in app
    assert "dismissTraceSheet()" in app
    assert 'overlay.classList.contains("is-open")' in app
    assert "closeSpeedPicker()" in app


def test_turn_trace_is_single_log_sheet_with_thinking_rows() -> None:
    app = read("app.js")
    styles = read("styles.css")
    fixtures = runtime_fixture_text()

    assert "function showTurnTrace(card, message = null, index = 0)" in app
    assert "function dismissTraceSheet()" in app
    assert "function thinkingLogEntries(card, message = null, index = 0)" in app
    assert "function cleanTraceLabel(label)" in app
    assert 'replace(/_/g, " ")' in app
    assert "function traceStatusClass(status)" in app
    assert '"bubble-trace-action"' in app
    assert '"trace-action"' not in app
    assert 'lightbulb_2: {' in app
    assert 'iconSvg("lightbulb_2"' in app
    assert "Open thinking logs" in app
    assert "Thinking Logs" in app
    assert "mockTraceFor(card, message, index)" in app
    assert "raw JSON" not in app
    assert "token usage" not in app.lower()
    assert ".trace-sheet" in styles
    assert ".trace-card" in styles
    assert ".trace-thought" in styles
    assert ".trace-tool-row" in styles
    assert ".trace-dot.success" in styles
    assert ".trace-dot.failed" in styles
    assert ".bubble-trace-action" in styles
    assert ".card.has-trace" not in styles
    assert fixtures.count('"trace": {') == 5
    assert fixtures.count('"kind": "thinking"') == 5
    assert fixtures.count('"kind": "reasoning"') == 5


def test_reply_origin_metadata_stays_in_detail_gear_sheet_only() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")

    assert 'id="metaSheet"' in html
    assert "meta-sheet" in html
    assert "function showOriginSheet(card)" in app
    assert "function dismissOriginSheet()" in app
    assert "dismissOriginSheet();" in app
    assert "function cardOrigin(card)" in app
    assert 'return card && card.origin && typeof card.origin === "object" ? card.origin : {};' in app
    assert '"bubble-origin-action"' in app
    assert 'Open reply details' in app
    assert 'showOriginSheet(card);' in app
    assert '"Reply Details"' in app
    assert '"No generation metadata is attached to this reply yet."' in app
    assert 'metaRow("Card title", card.title || "Untitled reply")' in app
    assert 'metaRow("Thread title", origin.thread_title || "Unavailable")' in app
    assert 'metaRow("Model", origin.model || "Unavailable")' in app
    assert 'metaRow("Runtime", originRuntime(origin))' in app
    assert 'metaRow("Reasoning", origin.reasoning_effort || "Default")' in app
    assert 'metaRow("Sandbox", origin.sandbox_policy || "Unavailable")' in app
    assert 'metaRow("Approval", origin.approval_mode || "Unavailable")' in app
    assert 'metaRow("Thread ID", origin.thread_id || "Unavailable", { monospace: true })' in app
    assert 'metaRow("Rollout path", origin.rollout_path || "Unavailable", { monospace: true })' in app
    assert 'metaRow("Source", origin.source || "Unavailable")' in app
    assert '"bubble-trace-action"' in app
    assert '"Thinking Logs"' in app
    assert "state_5.sqlite" not in app
    assert "sessions/" not in app
    assert "/data/home/codex" not in app
    assert "card-origin-badge" not in app
    assert "origin-badge" not in app
    assert ".bubble-origin-action" in styles
    assert ".meta-card" in styles
    assert ".meta-rows" in styles
    assert ".meta-row" in styles
    assert ".meta-label" in styles
    assert ".meta-value" in styles
    assert ".meta-value.is-monospace" in styles


def test_html_uses_normalized_attachment_contract_for_future_files() -> None:
    app = read("app.js")
    styles = read("styles.css")
    fixture = read("fixtures/reply_cards_deploy.json")

    assert "function normalizeAttachment(attachment, index = 0)" in app
    assert "function normalizedAttachmentKind(item, mime)" in app
    assert "function normalizeAttachmentPreview(item, kind)" in app
    assert "function normalizeAttachmentViewer(item, kind, mime)" in app
    assert "function attachmentViewerType(item)" in app
    assert "const viewerType = attachmentViewerType(item)" in app
    assert "attachments: normalizedAttachments(item.attachments)" in app
    assert 'if (viewerType === "image_gallery")' in app
    assert 'if (viewerType === "video_player")' in app
    assert 'if (viewerType === "audio_player")' in app
    assert 'if (viewerType === "html_iframe")' in app
    assert 'if (viewerType === "table")' in app
    assert 'if (viewerType === "text")' in app
    assert "message?.attachments" in app
    assert "card?.attachments" in app
    assert app.count("preferDataUrl: true") >= 2
    assert '"attachments": [' in fixture
    assert '"artifact": "morning-checklist.csv"' in fixture
    assert '"artifact": "morning-notes.txt"' in fixture
    assert '"artifact": "morning-unknown.bin"' in fixture
    assert ".table-viewer" in styles
    assert ".text-viewer" in styles
    assert ".attachment-audio-card" in styles


def test_feed_tile_prefers_meeting_summary_attachment_when_no_html_path() -> None:
    app = read("app.js")

    assert "function firstDisplayableAttachmentInfo(card)" in app
    assert "function preferredDisplayAttachments(card, attachments)" in app
    assert 'if (id.endsWith(":html")) return 0;' in app
    assert 'if (title === "meeting summary") return 0;' in app
    assert 'if (title === "transcript" || title === "meeting transcript html") return 1;' in app
    assert "preferredDisplayAttachments(card, messages[index]?.attachments)" in app
    assert "preferredDisplayAttachments(card, card?.attachments)" in app
    assert '["html_iframe", "table", "text", "image_gallery", "video_player", "audio_player", "document_html"]' in app
    assert "const attachmentInfo = firstDisplayableAttachmentInfo(card);" in app
    assert 'showAttachmentViewer(card, attachmentInfo.attachments, { initialIndex: attachmentInfo.index });' in app


def test_document_html_detection_accepts_local_viewer_paths_and_xlsx_is_not_raw_table() -> None:
    app = read("app.js")

    assert "viewer.viewer_path" in app
    assert "viewer.html_viewer_path" in app
    assert "viewer.document_html_path" in app
    kind_block = function_block(app, "normalizedAttachmentKind")
    assert 'mime.includes("spreadsheetml")) return "table"' not in kind_block
    assert 'mime.includes("spreadsheetml")) return "document"' in kind_block
    assert '["text/plain", "text/markdown", "application/json", "text/xml", "application/xml"].includes(mime)' in kind_block


def test_walkie_thread_scope_badge_tracks_detail_views_and_feed_focus() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")

    assert 'id="threadScopeStatus"' in html
    assert "thread-scope-status" in html
    assert "threadScope: initialThreadScope()" in app
    assert 'command === "voice.thread_scope.get"' in app
    assert 'command === "voice.thread_scope.set"' in app
    assert 'command === "voice.thread_scope.clear"' in app
    assert "renderThreadScopeBadge()" in app
    assert "function initialThreadScope()" in app
    assert "function normalizeThreadScope(input)" in app
    assert "function threadScopeForCard(card, sourceSurface)" in app
    assert "function desiredThreadScope()" in app
    assert "function sameThreadScope(left, right)" in app
    assert "function syncVoiceThreadScope(options = {})" in app
    assert "threadScopeSyncTail = task.catch(() => {});" in app
    assert '"thread_transcript"' in app
    assert '"thread_page"' in app
    assert '"thread_attachment"' in app
    assert "const focusedCard = findFocusedCard();" in app
    assert 'return threadScopeForCard(focusedCard, "feed_tile_selected") || initialThreadScope();' in app
    assert '"feed_tile_selected"' in app
    assert '"Talk to continue..."' not in app
    assert '"data-thread-scope-active"' in app
    assert '"data-thread-scope-mode"' in app
    assert '"data-thread-id"' in app
    assert '"data-source-surface"' in app
    assert 'void syncVoiceThreadScope({ reason: "tab_click", render: true });' in app
    assert 'void syncVoiceThreadScope({ reason: "card_menu_dismiss", render: true, force: true });' in app
    assert 'void syncVoiceThreadScope({ reason: "show_transcript", render: true });' in app
    assert 'void syncVoiceThreadScope({ reason: "show_page", render: true });' in app
    assert 'void syncVoiceThreadScope({ reason: "show_audio_detail", render: true });' in app
    assert 'void syncVoiceThreadScope({ reason: "show_document_attachment", render: true });' in app
    assert 'void syncVoiceThreadScope({ reason: "detail_dismiss", render: true, force: true });' in app
    assert "node.hidden = true;" in app
    assert 'node.setAttribute("aria-hidden", "true");' in app
    assert ".thread-scope-status" in styles
    badge = css_block(styles, ".thread-scope-status")
    assert "font-size: 11px;" in badge
    assert "text-overflow: ellipsis;" in badge


def test_transcript_promotes_only_visual_media_and_rebinds_latest_thread_card() -> None:
    app = read("app.js")

    assert "function attachmentPromotesToChatMedia(item)" in app
    assert 'return ["image_gallery", "video_player", "document_html", "html_iframe"].includes(viewerType);' in app
    assert "normalizedAttachments(message?.attachments).filter(attachmentPromotesToChatMedia)" in app
    assert "function resolveNavDetailCard(detail)" in app
    assert "const byThread = detail.thread_id ? findCardByThreadId(detail.thread_id) : null;" in app
    assert "function syncOpenThreadDetailAfterCards()" in app
    assert "const nextCard = resolveNavDetailCard(detail);" in app
    assert 'showTranscript(nextCard, shouldStickToLatest' in app
    assert 'recordTurnUiEvent("thread_detail_rebound", {' in app

def test_walkie_thread_phone_proof_dom_hooks_expose_card_actions_and_detail_surfaces() -> None:
    app = read("app.js")

    assert "function applyCardDataAttributes(node, card, kind)" in app
    assert "function applyCardActionData(node, action, card, kind = \"\")" in app
    assert "function applyDetailDataAttributes(panel, detailType, card, extra = {})" in app
    assert "function clearDetailDataAttributes(panel)" in app
    assert '"data-card-kind"' in app
    assert '"data-card-id"' in app
    assert '"data-card-session-id"' in app
    assert '"data-card-thread-id"' in app
    assert '"data-card-pending-state"' in app
    assert '"data-card-action"' in app
    assert '"data-detail-type"' in app
    assert '"data-detail-card-id"' in app
    assert '"data-detail-session-id"' in app
    assert '"data-detail-thread-id"' in app
    assert '"data-detail-viewer"' in app
    assert 'applyCardDataAttributes(cardEl, card, isMeetingList ? "meeting" : "reply");' in app
    assert 'applyCardActionData(identity, "mark_read", card, "reply");' in app
    assert 'applyCardActionData(body, isMeetingList ? "attachment" : "transcript", card, isMeetingList ? "meeting" : "reply");' in app
    assert 'applyCardActionData(audio, "audio", card, isMeetingList ? "meeting" : "reply");' in app
    assert 'applyCardActionData(page, "page", card, "reply");' in app
    assert 'applyCardActionData(file, "attachment", card, "reply");' in app
    assert 'applyCardDataAttributes(cardEl, card, "pending_outbound");' in app
    assert 'applyDetailDataAttributes(panel, "transcript", card);' in app
    assert 'applyDetailDataAttributes(panel, "page", card, { viewer: "html_iframe" });' in app
    assert 'applyDetailDataAttributes(panel, "images", card, { viewer: "image_gallery" });' in app
    assert 'applyDetailDataAttributes(panel, "audio", card, { viewer: "audio_player" });' in app
    assert 'applyDetailDataAttributes(panel, "attachment", card, { viewer: "video_player" });' in app
    assert 'applyDetailDataAttributes(panel, "attachment", card, { viewer: "audio_player" });' in app
    assert 'applyDetailDataAttributes(panel, "attachment", card, { viewer: attachmentViewerType(item) });' in app
    assert "clearDetailDataAttributes(panel);" in app


def test_walkie_thread_emulator_surface_status_exposes_dom_truth_and_debug_navigation() -> None:
    app = read("app.js")

    assert 'command === "ui.surface.get"' in app
    assert 'command === "ui.debug.goto_home"' in app
    assert 'command === "ui.debug.back"' in app
    assert 'command === "ui.debug.refresh_cards"' in app
    assert 'command === "ui.debug.open_card_action"' in app
    assert "function describeUiSurface()" in app
    assert "function uiDebugDispatch(action, rawArgs = {})" in app
    assert "function uiDebugRefreshCards()" in app
    assert "function uiDebugOpenCardAction(rawArgs = {})" in app
    assert "window.PuckyUiDebug = {" in app
    assert "describe: describeUiSurface" in app
    assert "dispatch: uiDebugDispatch" in app
    assert 'route: shell?.getAttribute("data-view") || ""' in app
    assert "detail: {" in app
    assert "thread_scope: {" in app
    assert "visible_cards: cards" in app
    assert 'pending_outbound: node.getAttribute("data-card-kind") === "pending_outbound"' in app
    assert 'pending_state: node.getAttribute("data-card-pending-state") || ""' in app
    assert 'preview: (node.querySelector(".preview, .card-outbound-preview, .title")?.textContent || "").trim()' in app
    assert "handleAndroidBack()" in app
    assert '[data-route="feed"]' in app
    assert '[data-card-action="${cssEscape(action)}"]' in app


def test_walkie_thread_phone_proof_dom_hooks_expose_card_actions_and_detail_surfaces() -> None:
    app = read("app.js")

    assert "function applyCardDataAttributes(node, card, kind)" in app
    assert "function applyCardActionData(node, action, card, kind = \"\")" in app
    assert "function applyDetailDataAttributes(panel, detailType, card, extra = {})" in app
    assert "function clearDetailDataAttributes(panel)" in app
    assert '"data-card-kind"' in app
    assert '"data-card-id"' in app
    assert '"data-card-session-id"' in app
    assert '"data-card-thread-id"' in app
    assert '"data-card-pending-state"' in app
    assert '"data-card-action"' in app
    assert '"data-detail-type"' in app
    assert '"data-detail-card-id"' in app
    assert '"data-detail-session-id"' in app
    assert '"data-detail-thread-id"' in app
    assert '"data-detail-viewer"' in app
    assert 'applyCardDataAttributes(cardEl, card, isMeetingList ? "meeting" : "reply");' in app
    assert 'applyCardActionData(identity, "mark_read", card, "reply");' in app
    assert 'applyCardActionData(body, isMeetingList ? "attachment" : "transcript", card, isMeetingList ? "meeting" : "reply");' in app
    assert 'applyCardActionData(audio, "audio", card, isMeetingList ? "meeting" : "reply");' in app
    assert 'applyCardActionData(page, "page", card, "reply");' in app
    assert 'applyCardActionData(file, "attachment", card, "reply");' in app
    assert 'applyCardDataAttributes(cardEl, card, "pending_outbound");' in app
    assert 'applyDetailDataAttributes(panel, "transcript", card);' in app
    assert 'applyDetailDataAttributes(panel, "page", card, { viewer: "html_iframe" });' in app
    assert 'applyDetailDataAttributes(panel, "images", card, { viewer: "image_gallery" });' in app
    assert 'applyDetailDataAttributes(panel, "audio", card, { viewer: "audio_player" });' in app
    assert 'applyDetailDataAttributes(panel, "attachment", card, { viewer: "video_player" });' in app
    assert 'applyDetailDataAttributes(panel, "attachment", card, { viewer: "audio_player" });' in app
    assert 'applyDetailDataAttributes(panel, "attachment", card, { viewer: attachmentViewerType(item) });' in app
    assert "clearDetailDataAttributes(panel);" in app


def test_walkie_thread_emulator_surface_status_exposes_dom_truth_and_debug_navigation() -> None:
    app = read("app.js")

    assert 'command === "ui.surface.get"' in app
    assert 'command === "ui.debug.goto_home"' in app
    assert 'command === "ui.debug.back"' in app
    assert 'command === "ui.debug.focus_card"' in app
    assert 'command === "ui.debug.clear_focus"' in app
    assert 'command === "ui.debug.refresh_cards"' in app
    assert 'command === "ui.debug.open_card_action"' in app
    assert "function describeUiSurface()" in app
    assert "function uiDebugDispatch(action, rawArgs = {})" in app
    assert "function uiDebugFocusCard(rawArgs = {})" in app
    assert "function uiDebugClearFocus()" in app
    assert "function uiDebugRefreshCards()" in app
    assert "let threadScopeSyncTail = Promise.resolve();" in app
    assert 'reason: "debug_goto_home", render: true, force: true' in app
    assert 'reason: "detail_dismiss", render: true, force: true' in app
    assert "function findFocusedCard()" in app
    assert "function reconcileFocusedCardSelection()" in app
    assert "async function refreshCardsFromVmSnapshot(options = {})" in app
    assert 'recordTurnUiEvent("feed_vm_refresh_start"' in app
    assert 'recordTurnUiEvent("feed_vm_refresh_complete"' in app
    assert "function uiDebugOpenCardAction(rawArgs = {})" in app
    assert "window.PuckyUiDebug = {" in app
    assert "describe: describeUiSurface" in app
    assert "dispatch: uiDebugDispatch" in app
    assert 'route: shell?.getAttribute("data-view") || ""' in app
    assert "detail: {" in app
    assert "focused_card: {" in app
    assert "thread_scope: {" in app
    assert "turn_timing: currentTurnUiTiming()," in app
    assert "visible_cards: cards" in app
    assert "home_feed: {" in app
    assert "overflow_y: feedStyle?.overflowY || \"\"" in app
    assert "scroll_height: Math.round(Number(feed?.scrollHeight || 0))" in app
    assert "archive_reveal_open_count: document.querySelectorAll(\".card-wrap.is-archive-reveal-open\").length" in app
    assert 'active: Boolean(focusedCard)' in app
    assert 'menu_open: Boolean(focusedCard)' in app
    assert "openCardMenuThreadId" in app
    assert 'pending_outbound: node.getAttribute("data-card-kind") === "pending_outbound"' in app
    assert 'pending_state: node.getAttribute("data-card-pending-state") || ""' in app
    assert 'preview: (node.querySelector(".preview, .card-outbound-preview, .title")?.textContent || "").trim()' in app
    assert "handleAndroidBack()" in app
    assert '[data-route="feed"]' in app
    assert '[data-card-action="${cssEscape(action)}"]' in app


def test_transcript_history_keeps_clickable_attachment_chips_for_user_audio_and_prior_artifacts() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "const attachments = messageAttachmentRow(card, message, index);" in app
    assert "function messageAttachmentRow(card, message, index)" in app
    assert "const attachments = preferredDisplayAttachments(card, message?.attachments);" in app
    assert "function attachmentChipIcon(item)" in app
    assert "function attachmentChipLabel(item)" in app
    assert 'showAttachmentViewer(card, attachments, { initialIndex, onDismiss: () => showTranscript(card) });' in app
    assert 'if (String(message?.role || "").toLowerCase() === "user") {' in app
    assert 'return attachmentViewerType(item) !== "image_gallery";' in app
    assert '".bubble-attachment-row"' not in app
    assert ".bubble-attachment-row" in styles
    assert ".bubble-attachment-chip" in styles
    chip = css_block(styles, ".bubble-attachment-chip")
    assert "border-radius: 999px;" in chip
    assert "display: inline-flex;" in chip
