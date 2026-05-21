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
    assert 'iconSvg("mic"' in app
    assert "toggleRead(card, \"audio\")" in app
    assert 'iconSvg("chat"' not in app
    assert "action-transcript" not in app
    assert "action-page" not in app
    assert ".identity.is-unread" in styles
    assert "color: var(--accent" in styles
    assert ".action.is-unread" in styles
    assert ".action.is-read" in styles
    assert "--action-accent" not in styles


def test_transcript_and_pages_use_right_slide_detail_navigation() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "function openSideDetail(" in app
    assert "openBottomSheet" not in app
    assert 'openSideDetail(panel, card.title || "Transcript", content, dismissDetail)' in app
    assert 'openSideDetail(panel, card.title || "Page", content, dismissDetail)' in app
    assert "installHorizontalDismiss(shell, panel, onDismiss)" in app
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


def test_sheet_drag_waits_for_release_before_dismissal() -> None:
    app = read("app.js")

    assert "primary > threshold()" not in app.split("const finish =")[0]
    assert "const delta = config.axis" in app
    assert "if (delta > threshold())" in app
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
