from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "tools" / "proofs" / "cover" / "cover_live_user_session_playwright.mjs"
WRAPPER_PATH = ROOT / "tools" / "cover_live_user_session_playwright.mjs"
PACKAGE_JSON_PATH = ROOT / "tools" / "package.json"


def test_live_user_session_runner_records_manifest_refresh_seed_cleanup_and_report() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "PUCKY_WEB_UI_TOKEN" in source
    assert "PUCKY_LIVE_USER_SESSION_TOKEN" in source
    assert "PUCKY_OPERATOR_TOKEN" in source
    assert "PUCKY_API_TOKEN" in source
    assert "/ui/pucky/latest/manifest.json" in source
    assert "_pucky_refresh" in source
    assert '".tmp", "live-user-session-proof"' in source
    assert "summary.json" in source
    assert "report.md" in source
    assert "saveScreenshot(" in source
    assert "seedTaskProofWorkspace(" in source
    assert "cleanupTaskProofSeed(" in source
    assert 'const RESULT_SCHEMA = "pucky.live_user_session_browser_proof.v1";' in source
    assert "--keep-seed" in source
    assert '"meeting-notes"' in source
    assert '"reminders"' in source
    assert "const UNIVERSAL_FEED_TILE_ROUTES = [" in source
    assert '"notes"' in source
    assert '"projects"' in source
    assert '"inbox"' in source
    assert '"meetings"' in source
    assert 'url.searchParams.set("api_token"' not in source
    assert "browser_api_token" not in source
    assert "Authorization: `Bearer ${config.apiToken}`" not in source


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
    assert "route=apps" not in source
    assert "route=feed" not in source
    assert "contacts-edit" not in source
    assert "Connect stays read-only" in source
    assert "connect_cta_clicked: false" in source
    assert "fetchConnectMyApps(" in source
    assert "waitForConnectChips(" in source
    assert "data-links-connected-slug" in source
    assert "Reload connect directly" in source
    assert 'LIVE_CONNECT_REQUIRED_SLUGS = ["gmail", "googlecalendar"]' in source
    assert 'localStorage.removeItem("pucky.cover.browser_device_id.v1");' in source


def test_live_user_session_wrapper_targets_nested_runner() -> None:
    source = WRAPPER_PATH.read_text(encoding="utf-8")

    assert 'import "./proofs/cover/cover_live_user_session_playwright.mjs";' in source


def test_tools_package_exposes_live_user_session_script() -> None:
    payload = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))

    assert payload["scripts"]["test:cover-live-user-session"] == "node ./proofs/cover/cover_live_user_session_playwright.mjs"
    assert payload["scripts"]["test:cover-universal-feed-tiles"] == "node ./proofs/cover/cover_universal_feed_tiles_playwright.mjs"


def test_tools_package_exposes_inbox_related_proofs() -> None:
    payload = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))

    assert payload["scripts"]["test:cover-inbox-tile-audio-truth"] == "node ./proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs"
    assert payload["scripts"]["test:cover-light-native-ports"] == "node ./proofs/cover/cover_light_native_ports_playwright.mjs"


def test_tools_dev_runs_inbox_focused_local_and_live_entrypoints() -> None:
    source = (ROOT / "tools" / "dev.py").read_text(encoding="utf-8")

    assert "cover_light_native_ports_playwright.mjs" in source
    assert "cover_inbox_tile_audio_truth_playwright.mjs" in source
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
    assert 'proof-local-universal-tiles' in source
    assert 'proof-live-universal-tiles' in source


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
    assert 'openerSelector: ".light-event-block"' in hosted_source
