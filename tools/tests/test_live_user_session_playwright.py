from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "tools" / "proofs" / "cover" / "cover_live_user_session_playwright.mjs"
WRAPPER_PATH = ROOT / "tools" / "cover_live_user_session_playwright.mjs"
PACKAGE_JSON_PATH = ROOT / "tools" / "package.json"


def test_live_user_session_runner_records_manifest_refresh_seed_cleanup_and_report() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

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
    assert 'url.searchParams.set("api_token"' not in source
    assert "Authorization: `Bearer ${config.apiToken}`" not in source


def test_live_user_session_runner_keeps_connect_read_only_and_uses_home_route() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert 'buildRouteUrl(config, "home")' in source
    assert 'url.searchParams.set("route", String(route || "home"));' in source
    assert 'await openRouteFromHome(page, "connect", config.timeoutMs);' in source
    assert 'await openRouteFromHome(page, "meeting-notes", config.timeoutMs);' in source
    assert 'await openRouteFromHome(page, "reminders", config.timeoutMs);' in source
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


def test_live_user_session_runner_exercises_task_status_triggers_and_clean_detail_surface() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "function readTaskRowFocusState(page, taskId)" in source
    assert "function readTaskDetailFocusState(page)" in source
    assert "function assertNoVisibleTaskFocusRing(state, context)" in source
    assert "task_row_outline_style" in source
    assert "task_row_outline_width" in source
    assert "task_detail_outline_style" in source
    assert "task_detail_outline_width" in source
    assert 'await openRouteFromHome(page, "tasks", config.timeoutMs);' in source
    assert '.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-status-trigger' in source
    assert '.light-task-row[data-task-id="${seed.primaryTaskId}"] .light-task-row-main' in source
    assert '.settings-selector-option[data-selector-value="in_progress"]' in source
    assert '.settings-selector-option[data-selector-value="done"]' in source
    assert '.settings-selector-option[data-selector-value="waiting"]' in source
    assert '".light-task-detail-card"' in source
    assert '".light-task-status-circle"' in source
    assert '".light-task-status-trigger"' not in source
    assert '".light-task-status-circle-trigger"' not in source
    assert 'description_is_first_section' in source
    assert 'task_html_frame_present' in source
    assert 'assert(!taskState.task_html_frame_present' in source
    assert 'assert(taskState.description_is_first_section' in source
    assert "Open task list status selector" in source
    assert "Open task detail header status selector near circle" in source
    assert "Open task detail header status selector on title area" in source
    assert "Task list status selector opened in place without a blue focus rectangle." in source
    assert "Task detail header selector opened in place without a blue focus rectangle." in source
    assert "Open task detail pill status selector" not in source
    assert "Open task detail top-left status selector" not in source
    assert "Persist Done status after reload" in source


def test_live_user_session_wrapper_targets_nested_runner() -> None:
    source = WRAPPER_PATH.read_text(encoding="utf-8")

    assert 'import "./proofs/cover/cover_live_user_session_playwright.mjs";' in source


def test_tools_package_exposes_live_user_session_script() -> None:
    payload = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))

    assert payload["scripts"]["test:cover-live-user-session"] == "node ./proofs/cover/cover_live_user_session_playwright.mjs"


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
