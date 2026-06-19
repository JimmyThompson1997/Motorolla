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
    assert '_pucky_refresh' in source
    assert '".tmp", "live-user-session-proof"' in source
    assert "summary.json" in source
    assert "report.md" in source
    assert "saveScreenshot(" in source
    assert "seedTaskProofWorkspace(" in source
    assert "cleanupTaskProofSeed(" in source
    assert 'const RESULT_SCHEMA = "pucky.live_user_session_browser_proof.v1";' in source
    assert '--keep-seed' in source


def test_live_user_session_runner_keeps_connect_read_only_and_uses_home_route() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert 'url.searchParams.set("route", String(route || "home"));' in source
    assert '"connect",' in source
    assert "route=apps" not in source
    assert "route=feed" not in source
    assert "contacts-edit" not in source
    assert "Connect stays read-only" in source
    assert "connect_cta_clicked: false" in source


def test_live_user_session_wrapper_targets_nested_runner() -> None:
    source = WRAPPER_PATH.read_text(encoding="utf-8")

    assert 'import "./proofs/cover/cover_live_user_session_playwright.mjs";' in source


def test_tools_package_exposes_live_user_session_script() -> None:
    payload = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))

    assert payload["scripts"]["test:cover-live-user-session"] == "node ./proofs/cover/cover_live_user_session_playwright.mjs"
