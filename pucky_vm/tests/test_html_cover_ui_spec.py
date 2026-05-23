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


def test_html_ui_uses_bundled_material_icon_registry() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "const MATERIAL_SYMBOLS" in app
    assert "function iconSvg(" in app
    assert "const ICONS = {" not in app
    assert "stroke-width: 2.8" not in styles
    assert ".material-icon" in styles


def test_top_tabs_are_visible_icon_pages_with_placeholders() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")

    assert 'id="pageTabs"' in html
    assert 'id="routeTray"' in html
    assert "const RETRO_TAB_SYMBOLS" not in app
    assert "function topIconSvg(" not in app
    assert "const PAGE_TABS" in app
    assert "renderTabs()" in app
    assert "button.innerHTML = iconSvg(tab.icon" in app
    assert 'route: "feed"' in app
    assert 'icon: "mailbox"' not in app
    assert 'icon: "bell"' not in app
    assert 'icon: "mail"' in app
    assert 'label: "Home"' in app
    assert 'route: "settings"' in app
    assert 'icon: "settings"' in app
    assert 'label: "Settings"' in app
    assert 'route: "morning"' in app
    assert 'icon: "coffee"' in app
    assert 'route: "calls"' in app
    assert 'icon: "phone"' in app
    assert 'route: "messages"' in app
    assert 'icon: "chat"' in app
    assert 'route: "sensors"' in app
    assert 'icon: "sensors"' in app
    assert "placeholder-page" in app
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


def test_voice_status_dot_renders_and_can_preview_states() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")

    assert 'id="voiceStatus"' in html
    assert "data-voice-status" in html
    assert 'aria-label="Voice state: listening"' in html
    assert 'const VOICE_STATES = ["listening", "hearing", "speaking", "off"]' in app
    assert "voiceState: initialVoiceState()" in app
    assert "renderVoiceStatus()" in app
    assert 'if (name === "voice.state")' in app
    assert "function renderVoiceStatus()" in app
    assert 'document.querySelectorAll("[data-voice-status]")' in app
    assert "function voiceStatusButton()" not in app
    assert "shell.append(header, content)" in app
    assert "function nextVoiceState(current)" in app
    assert "function initialVoiceState()" in app
    assert "function normalizeVoiceState(input)" in app
    assert "state.voiceState = nextVoiceState(state.voiceState)" in app
    assert ".voice-status" in styles
    voice_status_block = styles.split(".voice-status {", 1)[1].split("}", 1)[0]
    assert "position: fixed" in styles
    assert "--voice-status-size: 38px" in styles
    assert "top: calc((45px - var(--voice-status-size)) / 2)" in styles
    assert "top: 14px" not in voice_status_block
    assert "z-index: 100" in styles
    assert ".voice-status-listening" in styles
    assert ".voice-status-hearing" in styles
    assert ".voice-status-hearing::before" in styles
    assert ".voice-status-hearing::after" in styles
    assert "color-mix(in srgb, var(--voice-color)" in styles
    assert ".voice-status-speaking" in styles
    assert ".voice-status-off" in styles
    assert "@keyframes voicePulse" in styles
    assert "@keyframes voiceRing" in styles


def test_active_home_tab_opens_real_icon_filter_tray() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "openTrayRoute: initialOpenTrayRoute(persistedNavState.open_tray_route, persistedNavState.route)" in app
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
    assert 'state.openTrayRoute === tab.route ? null : tab.route' in app
    assert 'if (state.route !== "feed" || state.openTrayRoute !== "feed")' in app
    assert "const filters = uniqueFeedIconFilters();" in app
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
    assert "feed.replaceChildren(...cards.map(cardView))" in app
    assert "No selected replies." in app
    assert ".route-tray" in styles
    assert "position: absolute;" in styles
    assert "top: 45px;" in styles
    assert "top: 66px;" not in styles
    assert "pointer-events: none;" in styles
    assert "pointer-events: auto;" in styles
    assert ".route-tray-label" not in styles
    assert ".route-tray-icons" in styles
    assert ".filter-icon.is-selected" in styles
    assert "var(--filter-accent" in styles
    assert "color: rgba(245, 249, 255, 0.58);" in styles
    assert '.filter-icon[data-filter-icon="all"].is-selected' not in styles
    assert ".feed-filter-empty" in styles

def test_feed_has_subtle_edge_rubber_band() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "function installFeedRubberBand()" in app
    assert "feed.dataset.rubberBandBound" in app
    assert 'state.route !== "feed"' in app
    assert "Math.pow(Math.abs(dy), 0.72)" in app
    assert "Math.min(30" in app
    assert 'feed.classList.add("is-rubber-banding")' in app
    assert 'feed.classList.add("is-rubber-band-release")' in app
    assert "installFeedRubberBand();" in app
    assert "overscroll-behavior-y: contain;" in styles
    assert ".feed.is-rubber-banding" in styles
    assert ".feed.is-rubber-band-release" in styles


def test_settings_tab_renders_mock_html_settings_page() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "const MOCK_SETTINGS" in app
    assert 'state.route === "settings"' in app
    assert "settingsPageView()" in app
    assert "function settingsPageView()" in app
    assert "function settingsRowView(setting)" in app
    assert '"settings-page"' in app
    assert '"settings-hero"' in app
    assert '"settings-card"' in app
    assert "Pucky's phone-side powers" in app
    assert "Wake word" in app
    assert "Cover gestures" in app
    assert "Native bridge" in app
    assert ".settings-page" in styles
    assert ".settings-hero" in styles
    assert ".settings-card" in styles
    assert ".settings-card-value" in styles


def test_leaving_home_uses_standard_material_card_icon() -> None:
    app = read("app.js")
    styles = read("styles.css")
    fixtures = read("fixtures/reply_cards.json")

    assert "function cardIdentityIconSvg(card)" not in app
    assert "function shouldUseRetroCardIcon(card)" not in app
    assert 'identity.innerHTML = iconSvg(card.icon, { filled: true })' in app
    assert '"icon_style": "retro"' not in fixtures
    assert '"session_id": "fixture_leave"' in fixtures
    assert ".retro-card-icon" not in styles


def test_card_actions_have_local_read_state() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert 'READ_STATE_KEY = "pucky.cover.read_actions.v2"' in app
    assert "readActions" in app
    assert "function markRead(card, action)" in app
    assert "function markUnread(card, action)" in app
    assert "function markCardRead(card)" in app
    assert "function toggleCardRead(card)" in app
    assert "function isCardRead(card)" in app
    assert "function cardStateClass(card)" in app
    assert "function toggleRead(card, action)" in app
    assert "function isActionRead(card, action)" in app
    assert 'markRead(card, "card")' in app
    assert 'markRead(card, "audio")' in app
    assert 'markRead(card, "transcript")' in app
    assert 'markRead(card, "page")' in app
    assert 'if (!options.restoring) {\n      markRead(card, "transcript");\n      markCardRead(card);' in app
    assert 'if (!options.restoring) {\n      markRead(card, "page");\n      markCardRead(card);' in app
    assert "isCardRead(card) ? \"card\" : \"card card-unread\"" in app
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
    assert "function richFrame(result, path = \"\")" in app
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


def test_active_waveform_uses_preview_lane_and_mic_accent() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert 'waveform(card, "wave-row"' in app
    assert '"action action-audio is-playing"' in app
    assert ".wave-row" in styles
    assert "width: 50%" not in styles
    assert "width: 100%" in styles
    assert ".action-audio.is-playing" in styles
    assert "color: var(--accent" in styles


def test_smart_card_and_message_timestamps_are_rendered() -> None:
    app = read("app.js")
    styles = read("styles.css")
    fixtures = read("fixtures/reply_cards.json")

    assert "function cardTimestamp(card)" in app
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
    assert "return 0;" in app
    assert "rememberPlayerProgress(current)" in app


def test_audiobook_card_uses_single_file_with_timestamps() -> None:
    app = read("app.js")
    fixtures = read("fixtures/reply_cards.json")
    deploy_fixture = read("fixtures/reply_cards_deploy.json")

    assert '"audio_path": "/mock/pocket-computers.wav"' in fixtures
    assert '"audio_timestamps"' in fixtures
    assert '"audio_playlist_path": "/mock/pocket-computers.m3u"' not in fixtures
    assert '"device_audio_path": "/storage/emulated/0/Android/data/com.pucky.device.debug/files/audiobooks/From_Pocket_Computers_to_Planetary_Platforms_Kokoro_George.m4a"' in deploy_fixture
    assert '"public_audio_playlist_path"' not in deploy_fixture
    assert "function hasAudio(card)" in app
    assert "function audioControlKey(card)" in app
    assert "function isSameAudioCard(player, card)" in app
    assert "function playerHasAudioIdentity(player)" in app
    assert "function syncActivePathFromPlayer(player)" in app
    assert "if (playerHasAudioIdentity(state.player))" in app
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

    assert "async function pauseWithRewind()" in app
    assert 'command: "player.pause"' in app
    assert 'Number(paused.position_ms || 0) - 1000' in app
    assert 'command: "player.seek"' in app
    assert 'position_ms: rewindTo' in app
    assert "rememberPlayerProgress(rewound)" in app
    assert "state.player = await pauseWithRewind()" in app


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
    assert "existing.dataset.audioKey === audioStateKey(card)" in app
    assert "content.dataset.audioKey = audioStateKey(card)" in app
    assert 'openSideDetail(panel, card.title || "Audio", content, dismissAudioDetail)' in app
    assert '"detail-content audio-detail"' in app
    assert ".audio-detail" in styles
    assert ".audio-controls" in styles
    assert "grid-template-columns: minmax(66px, 1fr) auto minmax(66px, 1fr)" in styles
    assert ".transport-cluster" in styles
    assert ".control-spacer" in styles
    assert "showAudioSheet" not in app
    assert "renderAudioSheet" not in app
    assert "--sheet-bezel: 82px" not in styles
    assert "--sheet-top: 16px" in styles
    assert 'iconControl("replay_15"' in app
    assert 'iconControl(state.player.is_playing && isActiveCard(card) ? "pause" : "play_arrow"' in app
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
    assert "route: initialRoute(persistedNavState.route)" in app
    assert "openTrayRoute: initialOpenTrayRoute(persistedNavState.open_tray_route, persistedNavState.route)" in app
    assert "feedScrollTop: scrollNumber(persistedNavState.feed_scroll_top)" in app
    assert "navDetail: normalizeNavDetail(persistedNavState.detail)" in app
    assert "function loadNavState()" in app
    assert "function shouldResetNavState()" in app
    assert 'params.get("reset_nav") === "1"' in app
    assert "localStorage.removeItem(NAV_STATE_KEY)" in app
    assert "function persistNavState()" in app
    assert "function restoreNavStateAfterCards()" in app
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
    assert "function resolvedImageMime(result, image, path)" in app
    assert "function isPdfMedia(item)" in app
    assert "function isDocumentMedia(item)" in app
    assert "function mediaDocumentMeta(item)" in app
    assert "function mediaDocumentPreview(item, variant)" in app
    assert "function documentPreviewSrc(item)" in app
    assert "function isVideoMedia(item)" in app
    assert '"chat-media-video"' in app
    assert '"image-reel-video"' in app
    assert "video/mp4" in app
    assert '"media-doc-render"' in app
    assert "Rendered from real local file" in app
    assert "Cached document preview" not in app
    assert "function richFrame(result, path = \"\")" in app
    assert "mime === \"application/pdf\"" in app
    assert "mime === \"application/pdf\" ||" in app
    assert "data:application/pdf;base64" in app
    assert 'declared !== "application/octet-stream"' in app
    assert 'returned !== "application/octet-stream"' in app
    assert "showImageReel(card, images, { initialIndex: index, onDismiss: () => showTranscript(card) })" in app
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
    assert fixture.count('"artifact": "real-video-4.mp4"') == 1
    assert fixture.count('"preview_artifact": "real-master-through-chapter-8-pdf-page-1.png"') == 1
    assert fixture.count('"preview_artifact": "real-manuscript-chapters-0-7-docx-preview.png"') == 1
    assert '"mime_type": "video/mp4"' in fixture
    assert fixture.count('"artifact": "commute-dashboard.png"') == 1
    assert fixture.count('"artifact": "meeting-room.jpg"') == 1
    assert fixture.count('"artifact": "night-wrap.png"') == 1
    assert '"html_artifact": "meeting-decision.pdf"' in fixture
    assert '"mime_type": "image/png"' in fixture
    assert '"mime_type": "image/jpeg"' in fixture
    assert '"mime_type": "application/pdf"' in fixture
    assert '"mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"' in fixture


def test_turn_trace_is_single_log_sheet_with_thinking_rows() -> None:
    app = read("app.js")
    styles = read("styles.css")
    fixtures = read("fixtures/reply_cards.json")

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
