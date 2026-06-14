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
    assert 'id="voiceStatus"' not in html
    assert 'data-voice-status' not in html
    assert 'aria-label="Turn state: idle"' not in html
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

    assert "renderVoiceStatus();" not in render
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


def test_styles_drop_legacy_shell_chrome_and_follow_modern_route_names() -> None:
    styles = read("styles.css")

    assert ".page-tabs" not in styles
    assert ".voice-status" not in styles
    assert "--voice-status-size" not in styles
    assert "@keyframes voicePulse" not in styles
    assert "@keyframes voiceRing" not in styles
    assert ".route-tray" not in styles
    assert 'data-light-route="links"' not in styles
    assert 'data-light-route="feed"' not in styles
    assert ".light-shell[data-light-route=\"connect\"]" in styles
    assert ".light-shell[data-light-route=\"inbox\"] .light-canonical-port-surface" in styles
    assert ".light-page-header-shell" in styles
    assert ".light-canonical-port-surface" in styles


def test_voice_status_dot_is_not_mounted_in_the_modern_shell() -> None:
    html = read("index.html")
    app = read("app.js")
    render = function_block(app, "render")
    render_voice_status = function_block(app, "renderVoiceStatus")
    describe_ui_surface = function_block(app, "describeUiSurface")

    assert 'id="voiceStatus"' not in html
    assert 'data-voice-status' not in html
    assert "renderVoiceStatus();" not in render
    assert "document.querySelectorAll(\"[data-voice-status]\")" in render_voice_status
    assert 'const voiceStatus = document.getElementById("voiceStatus");' in describe_ui_surface
    assert "voice_status: {" in describe_ui_surface
    assert "exists: Boolean(voiceStatus)" in describe_ui_surface


def test_light_notes_pin_rows_use_right_side_toggle_and_shared_list_layout() -> None:
    app = read("app.js")
    styles = read("styles.css")

    light_notes = function_block(app, "lightNotesPage")
    note_timestamp = function_block(app, "noteContentUpdatedAtMs")
    note_row = function_block(app, "lightNoteRow")
    toggle_note_pin = function_block(app, "toggleNotePin")
    note_row_block = css_block(styles, ".light-note-row")
    note_pin_button_block = css_block(styles, ".light-note-pin-button")

    assert "note?.content_updated_at_ms" in note_timestamp
    assert "note?.created_at_ms" in note_timestamp
    assert "note?.updated_at_ms" in note_timestamp
    assert 'const pinnedList = el("div", "light-list");' in light_notes
    assert "pinnedList.append(...pinned.map(lightNoteRow));" in light_notes
    assert 'page.append(lightSectionTitle("Pinned"), pinnedList);' in light_notes
    assert 'const recent = el("div", "light-list");' in light_notes
    assert 'recent.append(...notes.filter(note => !note.pinned).map(lightNoteRow));' in light_notes

    assert 'const row = el("div", "light-card light-note-row");' in note_row
    assert 'row.setAttribute("role", "button");' in note_row
    assert "row.tabIndex = 0;" in note_row
    assert 'row.dataset.notePinned = String(Boolean(note.pinned));' in note_row
    assert "row.append(lightSmallIcon(" not in note_row
    assert 'const meta = noteMetaLine(note);' in note_row
    assert 'note.pinned ? `Pinned${DOT}` : ""' not in note_row
    assert 'const pin = lightIconButton("pin", note.pinned ? "Unpin note" : "Pin note"' in note_row
    assert 'pin.innerHTML = iconSvg("pin", { filled: Boolean(note.pinned) });' in note_row
    assert "void toggleNotePin(note.id);" in note_row

    assert 'const updated = await patchWorkspaceRecord("notes", note.id, { pinned: nextPinned }, { render: false });' in app
    assert "bucket.items = nextPinned" in toggle_note_pin
    assert "bucket.items = previousItems;" in toggle_note_pin
    assert "bucket.error = previousError;" in toggle_note_pin

    assert "min-height: 88px;" in note_row_block
    assert "padding: 14px 16px;" in note_row_block
    assert "grid-template-columns: minmax(0, 1fr) auto;" in note_row_block
    assert "color: #0a84ff;" in note_pin_button_block
    assert '.light-note-pin-button[data-note-pinned="true"]' in styles
