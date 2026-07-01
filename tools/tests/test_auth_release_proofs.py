from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOLS_DIR = ROOT / "tools"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_tools_package_and_dev_runner_expose_auth_release_entrypoints() -> None:
    package = json.loads((TOOLS_DIR / "package.json").read_text(encoding="utf-8"))
    dev_source = read_text(TOOLS_DIR / "dev.py")

    assert package["scripts"]["test:auth-browser-live"] == "node ./proofs/auth/live_auth_browser_playwright.mjs"
    assert package["scripts"]["test:auth-composio-live"] == "node ./proofs/auth/live_auth_composio_playwright.mjs"
    assert '"proof-live-auth-browser": "Run the multi-user Clerk/email-OTP browser auth proof with matrix screenshots, API assertions, persistence checks, and cross-user isolation attempts."' in dev_source
    assert '"proof-live-auth-composio": "Run the authenticated Composio isolation proof with real browser login, My Apps truth checks, action execution, and foreign principal denial checks."' in dev_source
    assert '"proof-live-auth-android-ubc": "Run the physical Android UBC auth/WebView proof against the plugged-in device with install, clear, relaunch, screenshots, and logcat evidence."' in dev_source
    assert '"qa-live-multiuser-release": "Run the full local/staging/production multi-user auth release gauntlet and emit one pass/fail verdict bundle."' in dev_source
    assert "def run_live_auth_browser_proof(extra_args: list[str]) -> int:" in dev_source
    assert 'str((ROOT / ".tmp" / "proof-live-auth-browser").resolve())' in dev_source
    assert "def run_live_auth_composio_proof(extra_args: list[str]) -> int:" in dev_source
    assert 'str((ROOT / ".tmp" / "proof-live-auth-composio").resolve())' in dev_source
    assert "def run_live_auth_android_ubc_proof(extra_args: list[str]) -> int:" in dev_source
    assert 'str((ROOT / ".tmp" / "proof-live-auth-android-ubc").resolve())' in dev_source
    assert "def run_live_multiuser_release_gauntlet(extra_args: list[str]) -> int:" in dev_source
    assert 'str((ROOT / ".tmp" / "qa-live-multiuser-release").resolve())' in dev_source
    assert 'if args.task == "proof-live-auth-browser":' in dev_source
    assert 'if args.task == "proof-live-auth-composio":' in dev_source
    assert 'if args.task == "proof-live-auth-android-ubc":' in dev_source
    assert 'if args.task == "qa-live-multiuser-release":' in dev_source


def test_live_auth_browser_proof_covers_matrix_api_assertions_and_cross_user_replays() -> None:
    source = read_text(TOOLS_DIR / "proofs" / "auth" / "live_auth_browser_playwright.mjs")

    assert 'const RESULT_SCHEMA = "pucky.live_auth_browser_proof.v1";' in source
    assert 'const HOME_TILE_ROUTES = ["inbox", "notes", "tasks", "contacts", "projects", "reminders", "settings"];' in source
    assert '"chromium-desktop"' in source
    assert '"webkit-desktop"' in source
    assert '"chromium-tablet"' in source
    assert '"chromium-mobile-390x844"' in source
    assert '"chromium-mobile-412x915"' in source
    assert '"chromium-narrow-375x667"' in source
    assert '"chromium-fold-344x882"' in source
    assert '"/api/feed?limit=25&compact=1"' in source
    assert '"/api/meetings?compact=1"' in source
    assert '"/api/links/composio/my-apps"' in source
    assert '"/api/links/composio/catalog"' in source
    assert "/api/links/composio/all-apps?q=" in source
    assert "/api/links/composio/app-details?slug=" in source
    assert "/api/artifacts/" in source
    assert "seedWorkspaceRecords(" in source
    assert "pageApiMultipartJson(" in source
    assert "fetchNoRedirect(" in source
    assert "verifySignedOutDirectEntryRedirect(" in source
    assert 'redirect: "manual"' in source
    assert "verifyHomeTileLoads(" in source
    assert "Live manifest commit" in source
    assert "pucky-browser-state.js" in source
    assert "pucky-browser-unlock.js" in source
    assert "pucky-ui-state.js" in source
    assert "Stale owner session replay revived an authenticated workspace." in source
    assert "Wrong-host owner cookie replay exposed data." in source
    assert "User B saw User A workspace data while visiting the owner workspace URL directly." in source
    assert "Home tile" in source
    assert 'const settingsUrl = buildRouteUrl(landingUrl, "settings");' in source
    assert 'await waitForRouteReady(page, "settings", timeoutMs);' in source
    assert "User B connection ids" not in source  # Keep browser proof focused on workspace/auth, not Composio execute logic.
    assert '"summary.json"' in source
    assert '"report.md"' in source
    assert 'envValue("PUCKY_AUTH_BROWSER_PREVIEW_TOKEN")' in source
    assert 'envValue("PUCKY_WEB_UI_TOKEN")' not in source


def test_live_auth_composio_proof_checks_portal_token_actions_and_foreign_denial() -> None:
    source = read_text(TOOLS_DIR / "proofs" / "auth" / "live_auth_composio_playwright.mjs")

    assert 'const RESULT_SCHEMA = "pucky.live_auth_composio_proof.v1";' in source
    assert '|| "gmail"' in source
    assert "/api/links/composio/portal-url?auth_mode=browser" in source
    assert "/api/links/composio/my-apps" in source
    assert "/api/links/composio/app-details?" in source
    assert "/api/links/composio/actions/execute" in source
    assert "/api/links/composio/disconnect?token=" in source
    assert "foreign_execute" in source
    assert "foreign_disconnect" in source
    assert "connectViaUi" in source
    assert "waitForConnection(" in source
    assert "runVerificationCommand(" in source
    assert "PUCKY_COMPOSIO_REQUIRE_VERIFICATION_COMMAND" in source
    assert '"summary.json"' in source
    assert '"report.md"' in source
    assert 'envValue("PUCKY_AUTH_COMPOSIO_BROWSER_PREVIEW_TOKEN", "PUCKY_AUTH_BROWSER_PREVIEW_TOKEN")' in source
    assert 'envValue("PUCKY_WEB_UI_TOKEN")' not in source


def test_android_ubc_auth_proof_captures_real_device_evidence_and_cross_user_attempts() -> None:
    source = read_text(TOOLS_DIR / "proofs" / "auth" / "phone_auth_ubc_real_proof.py")
    helper_source = read_text(TOOLS_DIR / "proofs" / "auth" / "phone_auth_ubc_browser.js")
    doctor_source = read_text(TOOLS_DIR / "dev_env_doctor.py")

    assert 'RESULT_SCHEMA = "pucky.auth_android_ubc_real_proof.v1"' in source
    assert "adb" in source
    assert "logcat" in source
    assert "--include-device-transport" in doctor_source
    assert '"schema": "pucky.android_transport.v1"' in doctor_source
    assert '"status": status' in doctor_source
    assert "usb_ok" in doctor_source
    assert "wireless_ok" in doctor_source
    assert "android_transport" in source
    assert "transport-preflight.json" in source
    assert "pm clear" in source
    assert "force-stop" in source
    assert "background_foreground" in source
    assert "force_stop_relaunch" in source
    assert "cross_user_attempt" in source
    assert "device_screenshot" in source
    assert "phone_auth_ubc_browser.js" in source
    assert "PUCKY_AUTH_USER_A_OTP_COMMAND" in source
    assert "PUCKY_AUTH_OTP_COMMAND" in source
    assert "resolve_otp_code(" in source
    assert "wait_for_workspace" in helper_source
    assert "navigate_route" in helper_source
    assert "logout" in helper_source
    assert "screenshot" in helper_source


def test_release_gauntlet_fails_closed_and_emits_single_verdict_file() -> None:
    source = read_text(TOOLS_DIR / "proofs" / "auth" / "qa_live_multiuser_release.py")

    assert 'RESULT_SCHEMA = "pucky.live_multiuser_release_gauntlet.v1"' in source
    assert "PUCKY_AUTH_COMPOSIO_REQUIRED_APPS" in source
    assert '"required_composio_apps"' in source
    assert "googlecalendar" in source
    assert 'task_label=f"proof-live-auth-composio-{stage_name}-{app_slug}"' in source
    assert '"--app-slug", app_slug' in source
    assert '"test-fast"' in source
    assert '"test-full"' in source
    assert '"proof-live-web"' in source
    assert '"qa-hosted-web"' in source
    assert '"proof-live-auth-browser"' in source
    assert '"proof-live-auth-composio"' in source
    assert '"proof-live-auth-android-ubc"' in source
    assert '"staging-deploy"' in source
    assert '"production-deploy"' in source
    assert 'write_json(args.bundle_dir / "summary.json", summary)' in source
    assert 'write_json(args.bundle_dir / "verdict.json", summary["verdict"])' in source
    assert '"status": "pass"' in source
    assert '"status": "fail"' in source


def test_live_auth_browser_bundle_contract_and_wrappers_replace_legacy_anonymous_release_entry() -> None:
    auth_source = read_text(TOOLS_DIR / "proofs" / "auth" / "live_auth_browser_playwright.mjs")
    dev_source = read_text(TOOLS_DIR / "dev.py")

    assert "expectedBundleScripts(" in auth_source
    assert "fetchRemoteManifest(" in auth_source
    assert "fetchNoRedirect(" in auth_source
    assert "verifyBundleFreshness(" in auth_source
    assert '"missing_scripts"' in auth_source
    assert '"unexpected_legacy_scripts"' in auth_source
    assert '("tools/proofs/auth/live_auth_browser_playwright.mjs"' in dev_source
    assert '"--skip-proofs"' in dev_source


def test_auth_release_shared_supports_multipart_session_uploads_and_binary_fetches() -> None:
    source = read_text(TOOLS_DIR / "support" / "auth_release_shared.mjs")

    assert "export async function pageApiMultipartJson" in source
    assert "new FormData()" in source
    assert "new Blob(" in source
    assert "export async function pageFetchMeta" in source
    assert 'credentials: "include"' in source
