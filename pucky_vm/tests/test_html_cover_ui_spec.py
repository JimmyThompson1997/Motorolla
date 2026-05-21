from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "ui_src"


def read(name: str) -> str:
    return (UI / name).read_text(encoding="utf-8")


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
    assert "const RETRO_SYMBOLS" not in app
    assert "function topIconSvg(" not in app
    assert "const PAGE_TABS" in app
    assert "renderTabs()" in app
    assert "button.innerHTML = iconSvg(tab.icon" in app
    assert 'route: "feed"' in app
    assert 'route: "calls"' in app
    assert 'route: "texts"' in app
    assert 'route: "routines"' in app
    assert 'route: "sensors"' in app
    assert "placeholder-page" in app
    assert ".page-tabs" in styles
    assert "display: flex" in styles
    assert ".retro-icon" not in styles
    assert ".tab.is-active .material-icon" in styles
    assert ".tab:not(.is-active) .material-icon" in styles


def test_card_actions_have_local_read_state() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert 'READ_STATE_KEY = "pucky.cover.read_actions.v2"' in app
    assert "readActions" in app
    assert "function markRead(card, action)" in app
    assert "function markUnread(card, action)" in app
    assert "function toggleRead(card, action)" in app
    assert "function isActionRead(card, action)" in app
    assert 'markRead(card, "audio")' in app
    assert 'markRead(card, "transcript")' in app
    assert 'markRead(card, "page")' in app
    assert 'actionStateClass(card, "audio")' in app
    assert 'actionStateClass(card, "page")' in app
    assert '"card card-unread"' in app
    assert 'iconSvg("mic"' in app
    assert "toggleRead(card, \"audio\")" in app
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
    assert "position: sticky" in styles
    assert ".detail-back" in styles
    assert ".detail-title" in styles
    assert ".rich-detail" in styles


def test_rich_pages_fill_detail_space_and_mock_paths_have_fallback() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "function mockArtifactResult(path)" in app
    assert "function isMockHtmlArtifact(path)" in app
    assert "function richFrame(result)" in app
    assert 'if (isMockHtmlArtifact(card.html_path))' in app
    assert "mockArtifactResult(card.html_path)" in app
    assert "height: calc(100vh - 58px - var(--nav-safe))" not in styles
    assert "min-height: calc(100vh - 58px - var(--nav-safe))" not in styles
    assert ".rich-frame" in styles
    assert "height: 100%" in styles
    assert "flex: 1 1 auto" in styles
    assert ".rich-detail" in styles
    assert "display: flex" in styles
    assert "padding: 0 0 var(--nav-safe)" in styles


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
    assert "completedPaths" in app
    assert "function isCompletePlayback(player)" in app
    assert "function rememberPlayerProgress(player)" in app
    assert "function forgetCompleted(path)" in app
    assert "savedPositionFor(path)" in app
    assert "return 0;" in app
    assert "rememberPlayerProgress(current)" in app


def test_audiobook_cards_use_native_playlist_queue() -> None:
    app = read("app.js")
    fixtures = read("fixtures/reply_cards.json")

    assert '"audio_playlist_path": "/mock/pocket-computers.m3u"' in fixtures
    assert "function hasAudio(card)" in app
    assert "function audioControlKey(card)" in app
    assert "function isSameAudioCard(player, card)" in app
    assert 'command: "player.queue.set"' in app
    assert "playlist_path: card.audio_playlist_path" in app
    assert "samePath(player.source, card.audio_playlist_path)" in app
    assert "sameCompleted = same && isCompletePlayback(current)" in app


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
    assert "scrollTranscriptToLatest(content)" in app
    assert "function scrollTranscriptToLatest(content)" in app
    assert "requestAnimationFrame" in app
    assert "content.scrollTop = content.scrollHeight" in app
    assert ".chat-detail" in styles
    assert ".detail-content" in styles


def test_audio_sheet_uses_compact_icon_controls() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "--sheet-bezel: 82px" not in styles
    assert "--sheet-top: 16px" in styles
    assert 'iconControl("replay_15"' in app
    assert 'iconControl(state.player.is_playing ? "pause" : "play_arrow"' in app
    assert 'iconControl("forward_30"' in app
    assert 'control("15"' not in app
    assert 'control("30"' not in app
    assert 'state.player.is_playing ? "||" : ">"' not in app
    assert ".control-skip .material-icon" in styles
    assert ".control-play .material-icon" in styles
    assert "time-elapsed" in app
    assert "time-remaining" in app


def test_generated_images_open_as_html_reel_not_native_previews() -> None:
    app = read("app.js")
    html = read("index.html")
    styles = read("styles.css")

    assert 'id="traceSheet"' in html
    assert "function cardImages(card)" in app
    assert "function showImageReel(card)" in app
    assert "function resolveImageSrc(image)" in app
    assert "function resolvedImageMime(result, image, path)" in app
    assert 'declared !== "application/octet-stream"' in app
    assert 'returned !== "application/octet-stream"' in app
    assert '"image-reel-nav"' in app
    assert '"image-reel-count"' in app
    assert "Previous image" in app
    assert "Next image" in app
    assert '"image-affordance"' in app
    assert 'iconSvg("image"' in app
    assert "artifact.read_base64" in app
    assert ".image-affordance" in styles
    assert ".image-reel" in styles
    assert ".image-viewer" in styles
    assert ".image-reel-nav" in styles
    assert ".image-reel-count" in styles
    assert ".image-reel-img" in styles
    assert "object-fit: contain" in styles


def test_turn_trace_is_single_gear_sheet_with_thinking_rows() -> None:
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
    assert 'iconSvg("settings"' in app
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
