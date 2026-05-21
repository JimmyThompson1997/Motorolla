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
    assert "const PAGE_TABS" in app
    assert "renderTabs()" in app
    assert 'route: "feed"' in app
    assert 'route: "routines"' in app
    assert 'route: "sensors"' in app
    assert "placeholder-page" in app
    assert ".page-tabs" in styles
    assert "display: flex" in styles
    assert ".tab.is-active .material-icon" in styles
    assert ".tab:not(.is-active) .material-icon" in styles


def test_card_actions_have_local_read_state() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "READ_STATE_KEY" in app
    assert "readActions" in app
    assert "function markRead(card, action)" in app
    assert "function isActionRead(card, action)" in app
    assert 'markRead(card, "audio")' in app
    assert 'markRead(card, "transcript")' in app
    assert 'markRead(card, "page")' in app
    assert 'actionStateClass(card, "audio")' in app
    assert 'actionStateClass(card, "transcript")' in app
    assert 'actionStateClass(card, "page")' in app
    assert "action-transcript" in app
    assert "action-page" in app
    assert ".identity.is-unread" in styles
    assert "color: var(--accent" in styles
    assert ".action.is-unread" in styles
    assert "color: var(--action-accent" in styles
    assert "--action-accent: #ff5fa2" in styles
    assert "--action-accent: #19e6c7" in styles


def test_transcript_and_pages_share_bottom_sheet_navigation() -> None:
    app = read("app.js")
    styles = read("styles.css")

    assert "function openBottomSheet(" in app
    assert "openBottomSheet(panel, content, dismissDetail)" in app
    assert "installVerticalDismiss(content, panel, onDismiss)" in app
    assert "openRightPanel" not in app
    assert "installHorizontalDismiss" not in app
    assert "translateY(100%)" in styles
    assert "translateX(100%)" not in styles
    assert ".detail-panel.is-open" in styles


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
