from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
BROWSER_SCRIPT = ROOT / "tools" / "proofs" / "cover" / "cover_speed_loop_playwright.mjs"
EMULATOR_SCRIPT = ROOT / "tools" / "proofs" / "phone" / "phone_cover_speed_emulator_proof.py"
HELPER_SCRIPT = ROOT / "tools" / "proofs" / "phone" / "phone_links_auth_flow_browser.js"
PACKAGE_JSON_PATH = ROOT / "tools" / "package.json"
DEV_PY_PATH = ROOT / "tools" / "dev.py"


def test_browser_speed_loop_proof_captures_route_matrix_perf_debug_and_connect_auth() -> None:
    source = BROWSER_SCRIPT.read_text(encoding="utf-8")

    assert 'const RESULT_SCHEMA = "pucky.cover_speed_loop_browser_proof.v1";' in source
    assert 'url.searchParams.set("debug_perf", "1");' in source
    assert 'url.searchParams.set("api_base_url", config.apiBaseUrl);' in source
    assert 'const isLocalDocument = /^file:/i.test(config.baseUrl);' in source
    assert 'const isLoopbackHost = /^https?:\\/\\/(?:127\\.0\\.0\\.1|localhost|\\[::1\\])' in source
    assert '"inbox"' in source
    assert '"meetings"' in source
    assert '"meeting-notes"' in source
    assert '"reminders"' in source
    assert '"notes"' in source
    assert '"tasks"' in source
    assert '"calendar"' in source
    assert '"projects"' in source
    assert '"contacts"' in source
    assert '"connect"' in source
    assert '"settings"' in source
    assert "await waitForPerfRouteReady(page, route, timeoutMs);" in source
    assert "window.PuckyUiDebug?.perfMetrics?.()" in source
    assert "waitForConnectSearch(" in source
    assert "async function waitForPopupAuthPage(" in source
    assert "async function waitForSameTabAuthPage(" in source
    assert "triggerConnectAuth(" in source
    assert 'summary.connect_auth = authResult;' in source
    assert 'summary.fresh_loads.home = summarizeSamples(homeFreshSamples);' in source
    assert 'summary.fresh_loads.connect = summarizeSamples(connectFreshSamples);' in source
    assert 'route_ready_median_ms: median(routeReadyValues),' in source
    assert 'bridge_total_median_ms: median(bridgeValues),' in source
    assert 'shell_launch_median_ms: median(shellValues),' in source
    assert 'webview_load_median_ms: median(webviewValues),' in source
    assert 'asset_delivery_failures_max:' in source
    assert 'hosted_reload_attempts_max:' in source
    assert 'bootstrap_snapshot_used:' in source
    assert 'throw new Error("Hosted asset bootstrap failed while loading /ui/pucky/latest/.");' in source
    assert 'summary.route_opens[routeConfig.key] = summarizeSamples(samples);' in source
    assert 'summary.detail_opens.task = summarizeSamples(taskDetailSamples);' in source
    assert 'url.searchParams.set("perf_run_id", config.perfRunId);' in source
    assert 'perf_run_id: config.perfRunId,' in source
    assert 'envKeys: ["PUCKY_API_TOKEN", "PUCKY_SPEED_LOOP_TOKEN", "PUCKY_LIVE_USER_SESSION_TOKEN"]' in source
    assert 'sharedKeys: ["PUCKY_API_TOKEN"]' in source
    assert 'throw new Error("Live speed loop proof requires --api-token or PUCKY_API_TOKEN/PUCKY_SPEED_LOOP_TOKEN/PUCKY_LIVE_USER_SESSION_TOKEN.");' in source
    assert 'async function fetchServerTelemetry(config)' in source
    assert "/api/ui/route-perf-events?run_id=" in source
    assert 'summary.console_log_path = consoleLogPath;' in source
    assert 'summary.server_telemetry = await fetchServerTelemetry(config);' in source
    assert 'throw new Error(`Connect popup never navigated to a real auth target for ${config.appSlug}.`);' in source
    assert "buildDiff(summary, config.baseline)" in source


def test_emulator_speed_loop_proof_reuses_live_auth_handoff_and_reports_route_metrics() -> None:
    source = EMULATOR_SCRIPT.read_text(encoding="utf-8")

    assert 'RESULT_SCHEMA = "pucky.cover_speed_loop_emulator_proof.v1"' in source
    assert '"connect"' in source
    assert '{"kind": "ensure_route", "route": "home"}' in source
    assert '{"kind": "click_home_tile", "route": route}' in source
    assert '{"kind": "click_selector", "selector": click_selector}' in source
    assert '{"kind": "wait_for_selector", "selector": wait_selector}' in source
    assert '{"kind": "wait_for_connect_ready", "timeout_ms": int(args.timeout_seconds * 1000)}' in source
    assert 'auth_proof.ensure_live_credentials(args)' in source
    assert 'connect_error = auth_proof.has_forbidden_connect_error(search_state)' in source
    assert 'auth_proof.resolve_browser_surface(args, timeout_seconds=args.timeout_seconds)' in source
    assert 'auth_proof.discover_chrome_cdp_url(args)' in source
    assert 'auth_proof.wait_for_rendered_auth_snapshot(args, str(chrome["cdp_url"]))' in source
    assert 'summary["connect_auth"] = {' in source
    assert '"route_ready_median_ms":' in source
    assert '"bridge_total_median_ms":' in source
    assert '"shell_launch_median_ms":' in source
    assert '"webview_load_median_ms":' in source
    assert '"asset_delivery_failures_max":' in source
    assert '"hosted_reload_attempts_max":' in source
    assert '"bootstrap_snapshot_used":' in source
    assert 'raise EmulatorSpeedProofError("Hosted asset bootstrap failed inside the Android WebView.")' in source
    assert 'summary["route_opens"][route] = summarize(samples)' in source
    assert 'summary["detail_opens"]["calendar"] = summarize(calendar_samples)' in source
    assert 'clear_logcat(args)' in source
    assert 'dump_logcat(args, args.report_dir / "logcat.txt")' in source
    assert 'fetch_server_telemetry(args)' in source
    assert 'summary["diff"] = build_diff(summary, args.baseline)' in source


def test_phone_browser_helper_supports_generic_perf_route_and_click_ops() -> None:
    source = HELPER_SCRIPT.read_text(encoding="utf-8")

    assert "async function readPerfState(client)" in source
    assert "async function ensureRoute(client, route, timeoutMs)" in source
    assert 'const currentPerfMetrics = await client.evaluate(`window.PuckyUiDebug?.perfMetrics?.() || null`).catch(() => null);' in source
    assert "if (currentRoute !== targetRoute || !perfEnabled || missingPerfRunId) {" in source
    assert 'const perfRunId = String(process.env.PUCKY_PERF_RUN_ID || "").trim();' in source
    assert 'url.searchParams.set("perf_run_id", perfRunId);' in source
    assert "async function clickHomeTile(client, route, timeoutMs)" in source
    assert "async function clickSelector(client, selector, timeoutMs)" in source
    assert "async function waitForSelector(client, selector, timeoutMs)" in source
    assert 'if (operation.kind === "ensure_route") {' in source
    assert 'if (operation.kind === "perf_state") {' in source
    assert 'if (operation.kind === "click_home_tile") {' in source
    assert 'if (operation.kind === "click_selector") {' in source
    assert 'if (operation.kind === "wait_for_selector") {' in source


def test_package_and_dev_runner_expose_speed_loop_entrypoints() -> None:
    package = json.loads(PACKAGE_JSON_PATH.read_text(encoding="utf-8"))
    dev_source = DEV_PY_PATH.read_text(encoding="utf-8")

    assert package["scripts"]["test:cover-speed-loop"] == "node ./proofs/cover/cover_speed_loop_playwright.mjs"
    assert '"proof-live-speed-browser": "Run the hosted desktop and mobile speed loop browser proof against the current base URL env/default."' in dev_source
    assert '"proof-live-speed-emulator": "Run the Android emulator speed loop proof with hosted Connect auth validation."' in dev_source
    assert "def run_live_speed_browser_proof(extra_args: list[str]) -> int:" in dev_source
    assert "def run_live_speed_emulator_proof(extra_args: list[str]) -> int:" in dev_source
    assert '"tools/proofs/cover/cover_speed_loop_playwright.mjs"' in dev_source
    assert '"tools/proofs/phone/phone_cover_speed_emulator_proof.py"' in dev_source
    assert 'if args.task == "proof-live-speed-browser":' in dev_source
    assert 'if args.task == "proof-live-speed-emulator":' in dev_source
