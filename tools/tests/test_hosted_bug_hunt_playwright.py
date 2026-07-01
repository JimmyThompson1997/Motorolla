from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "tools" / "proofs" / "cover" / "cover_hosted_bug_hunt_playwright.mjs"
PACKAGE_JSON_PATH = ROOT / "tools" / "package.json"
DEV_PY_PATH = ROOT / "tools" / "dev.py"


def test_hosted_bug_hunt_runner_writes_required_artifacts_and_route_order() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert 'const RESULT_SCHEMA = "pucky.hosted_bug_hunt_browser_proof.v1";' in source
    assert '"summary.md"' in source
    assert '"findings.json"' in source
    assert '"console.log"' in source
    assert '"network.json"' in source
    assert '"screenshots"' in source
    assert '"proofs"' in source
    assert '"Home"' in source
    assert '"Inbox"' in source
    assert '"Meetings"' in source
    assert '"Meeting Notes"' in source
    assert '"Reminders"' in source
    assert '"Notes"' in source
    assert '"Tasks"' in source
    assert '"Calendar"' in source
    assert '"Projects"' in source
    assert '"Contacts"' in source
    assert '"Connect"' in source
    assert '"Settings"' in source


def test_hosted_bug_hunt_runner_reuses_existing_proofs_and_classification_labels() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "cover_live_user_session_playwright.mjs" in source
    assert "cover_inbox_tile_audio_truth_playwright.mjs" in source
    assert '"--skip-canonical-check"' in source
    assert "cover_light_native_ports_playwright.mjs" in source
    assert "cover_workspace_apps_playwright.mjs" in source
    assert "cover_home_app_labels_playwright.mjs" in source
    assert "cover_settings_quiet_list_playwright.mjs" in source
    assert "meetings_load_probe.mjs" in source
    assert "reminders_v3_browser_proof.mjs" in source
    assert '"keep as-is"' in source
    assert '"harden"' in source
    assert '"expand"' in source
    assert '"retire"' in source
    assert '"functional"' in source
    assert '"visual"' in source
    assert '"content"' in source
    assert '"navigation"' in source
    assert '"state-truthfulness"' in source
    assert '"performance-feel"' in source
    assert "performOtpLogin(" in source
    assert "waitForWorkspaceReady(" in source
    assert "Signed-in hosted routes should load protected data without unauthorized errors." in source


def test_tools_package_and_dev_runner_expose_hosted_bug_hunt_entrypoint() -> None:
    payload = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))
    dev_source = DEV_PY_PATH.read_text(encoding="utf-8")

    assert payload["scripts"]["test:cover-hosted-bug-hunt"] == "node ./proofs/cover/cover_hosted_bug_hunt_playwright.mjs"
    assert '"qa-hosted-web": "Run the authenticated hosted bug-hunt sweep with real sign-in, route screenshots, findings bundle, and coverage gaps."' in dev_source
    assert "def run_hosted_bug_hunt(extra_args: list[str]) -> int:" in dev_source
    assert '("tools/proofs/auth/live_auth_browser_playwright.mjs",' in dev_source
    assert '("tools/proofs/cover/cover_hosted_bug_hunt_playwright.mjs",' in dev_source
    assert '"--skip-proofs"' in dev_source
    assert 'if args.task == "qa-hosted-web":' in dev_source
