from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools.proofs.phone import phone_links_auth_flow_emulator_proof as auth_proof


RESULT_SCHEMA = "pucky.cover_speed_loop_emulator_proof.v1"
DEFAULT_REPORT_DIR = auth_proof.ROOT / ".tmp" / "cover-speed-loop-emulator"
HOME_ROUTE_MATRIX = [
    "inbox",
    "meetings",
    "meeting-notes",
    "reminders",
    "notes",
    "tasks",
    "calendar",
    "projects",
    "contacts",
    "connect",
    "settings",
]


class EmulatorSpeedProofError(RuntimeError):
    pass


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Measure hosted-vs-APK speed feel on the Android emulator.")
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--adb", type=Path, default=auth_proof.default_adb())
    parser.add_argument("--apk", type=Path, default=auth_proof.DEFAULT_APK)
    parser.add_argument("--package-name", default=auth_proof.DEFAULT_PACKAGE)
    parser.add_argument("--activity-name", default=auth_proof.DEFAULT_ACTIVITY)
    parser.add_argument("--base-url", default=auth_proof.DEFAULT_BASE_URL)
    parser.add_argument("--api-token", default="")
    parser.add_argument("--device-token", default="")
    parser.add_argument("--app-slug", default="slack")
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--browser-helper", type=Path, default=auth_proof.DEFAULT_BROWSER_HELPER)
    parser.add_argument("--node", type=Path, default=auth_proof.bundled_node_executable())
    parser.add_argument("--node-modules", type=Path, default=auth_proof.bundled_node_modules())
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--skip-clear", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=90)
    parser.add_argument("--browser-timeout-seconds", type=int, default=30)
    parser.add_argument("--devtools-timeout-seconds", type=int, default=25)
    parser.add_argument("--devtools-port", type=int, default=9222)
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument("--perf-run-id", default="")
    args = parser.parse_args(argv)
    args.adb = args.adb.resolve()
    args.apk = args.apk.resolve()
    args.report_dir = args.report_dir.resolve()
    args.browser_helper = args.browser_helper.resolve()
    args.node = args.node.resolve()
    args.node_modules = args.node_modules.resolve()
    args.base_url = str(args.base_url or auth_proof.DEFAULT_BASE_URL).rstrip("/")
    args.api_token = str(args.api_token or "").strip()
    args.device_token = str(args.device_token or "").strip()
    args.app_slug = str(args.app_slug or "slack").strip().lower() or "slack"
    args.iterations = max(1, int(args.iterations or 1))
    args.baseline = args.baseline.resolve() if args.baseline else None
    args.perf_run_id = str(args.perf_run_id or "").strip()
    return args


def summarize(samples: list[dict[str, Any]]) -> dict[str, Any]:
    elapsed = sorted(float(sample.get("elapsed_ms") or 0) for sample in samples if float(sample.get("elapsed_ms") or 0) >= 0)
    route_ready = sorted(
        float(((sample.get("state") or {}).get("metrics") or {}).get("route_ready_elapsed_ms") or 0)
        for sample in samples
        if float(((sample.get("state") or {}).get("metrics") or {}).get("route_ready_elapsed_ms") or 0) >= 0
    )
    bridge_total = sorted(
        float(((sample.get("state") or {}).get("metrics") or {}).get("bridge_total_ms") or 0)
        for sample in samples
        if float(((sample.get("state") or {}).get("metrics") or {}).get("bridge_total_ms") or 0) >= 0
    )
    shell_launch = sorted(
        float(((sample.get("state") or {}).get("metrics") or {}).get("shell_launch_elapsed_ms") or 0)
        for sample in samples
        if float(((sample.get("state") or {}).get("metrics") or {}).get("shell_launch_elapsed_ms") or 0) >= 0
    )
    webview_load = sorted(
        float(((sample.get("state") or {}).get("metrics") or {}).get("webview_load_elapsed_ms") or 0)
        for sample in samples
        if float(((sample.get("state") or {}).get("metrics") or {}).get("webview_load_elapsed_ms") or 0) >= 0
    )
    asset_failures = [
        float(((sample.get("state") or {}).get("metrics") or {}).get("asset_delivery_failures") or 0)
        for sample in samples
    ]
    reload_attempts = [
        float(((sample.get("state") or {}).get("metrics") or {}).get("hosted_reload_attempts") or 0)
        for sample in samples
    ]
    if not elapsed:
        return {
            "samples": [],
            "median_ms": 0.0,
            "p95_ms": 0.0,
            "route_ready_median_ms": 0.0,
            "bridge_total_median_ms": 0.0,
            "shell_launch_median_ms": 0.0,
            "webview_load_median_ms": 0.0,
            "asset_delivery_failures_max": 0.0,
            "hosted_reload_attempts_max": 0.0,
            "bootstrap_snapshot_used": False,
        }
    median_index = max(0, (len(elapsed) - 1) // 2)
    p95_index = max(0, min(len(elapsed) - 1, int(len(elapsed) * 0.95) - 1))
    return {
        "samples": samples,
        "median_ms": round(elapsed[median_index], 1),
        "p95_ms": round(elapsed[p95_index], 1),
        "route_ready_median_ms": round(route_ready[min(len(route_ready) - 1, median_index)] if route_ready else 0.0, 1),
        "bridge_total_median_ms": round(bridge_total[min(len(bridge_total) - 1, median_index)] if bridge_total else 0.0, 1),
        "shell_launch_median_ms": round(shell_launch[min(len(shell_launch) - 1, median_index)] if shell_launch else 0.0, 1),
        "webview_load_median_ms": round(webview_load[min(len(webview_load) - 1, median_index)] if webview_load else 0.0, 1),
        "asset_delivery_failures_max": round(max(asset_failures) if asset_failures else 0.0, 1),
        "hosted_reload_attempts_max": round(max(reload_attempts) if reload_attempts else 0.0, 1),
        "bootstrap_snapshot_used": any(
            bool((((sample.get("state") or {}).get("metrics") or {}).get("bootstrap_snapshot_used")))
            for sample in samples
        ),
    }


def current_page_contains_pucky(state: dict[str, Any]) -> bool:
    url = str(state.get("url") or "")
    return "/ui/pucky/latest" in url


def run_cover_ops(args: argparse.Namespace, cdp_url: str, operations: list[dict[str, Any]]) -> dict[str, Any]:
    return auth_proof.run_browser_helper(
        args,
        cdp_url=cdp_url,
        surface="cover",
        page_url_contains="/ui/pucky/latest",
        operations=operations,
    )


def capture_cdp_screenshot(args: argparse.Namespace, cdp_url: str, target: Path, operations: list[dict[str, Any]]) -> dict[str, Any]:
    ops = [*operations, {"kind": "screenshot", "path": str(target)}]
    return run_cover_ops(args, cdp_url, ops)


def measure_route_open(args: argparse.Namespace, cdp_url: str, route: str, *, screenshot_path: Path | None = None) -> dict[str, Any]:
    operations: list[dict[str, Any]] = [
        {"kind": "ensure_route", "route": "home"},
        {"kind": "click_home_tile", "route": route},
        {"kind": "perf_state"},
    ]
    if screenshot_path is not None:
        operations.append({"kind": "screenshot", "path": str(screenshot_path)})
    started_at = time.perf_counter()
    result = run_cover_ops(args, cdp_url, operations)
    elapsed_ms = round((time.perf_counter() - started_at) * 1000, 1)
    state = result.get("final_state") or {}
    if ((state.get("metrics") or {}).get("route") or state.get("route")) not in {route}:
        raise EmulatorSpeedProofError(f"Route open landed on the wrong route for {route}: {state}")
    return {
        "elapsed_ms": elapsed_ms,
        "state": state,
    }


def measure_detail_open(
    args: argparse.Namespace,
    cdp_url: str,
    route: str,
    click_selector: str,
    wait_selector: str,
    *,
    screenshot_path: Path | None = None,
) -> dict[str, Any]:
    operations: list[dict[str, Any]] = [
        {"kind": "ensure_route", "route": route},
        {"kind": "click_selector", "selector": click_selector},
        {"kind": "wait_for_selector", "selector": wait_selector},
        {"kind": "perf_state"},
    ]
    if screenshot_path is not None:
        operations.append({"kind": "screenshot", "path": str(screenshot_path)})
    started_at = time.perf_counter()
    result = run_cover_ops(args, cdp_url, operations)
    elapsed_ms = round((time.perf_counter() - started_at) * 1000, 1)
    return {
        "elapsed_ms": elapsed_ms,
        "state": result.get("final_state") or {},
    }


def build_diff(summary: dict[str, Any], baseline_path: Path | None) -> dict[str, Any] | None:
    if not baseline_path or not baseline_path.exists():
        return None
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    diff: dict[str, Any] = {
        "baseline_path": str(baseline_path),
        "route_open_median_delta_ms": {},
        "detail_open_median_delta_ms": {},
    }
    for key, value in (summary.get("route_opens") or {}).items():
        baseline_median = float(((baseline.get("route_opens") or {}).get(key) or {}).get("median_ms") or 0)
        diff["route_open_median_delta_ms"][key] = round(float(value.get("median_ms") or 0) - baseline_median, 1)
    for key, value in (summary.get("detail_opens") or {}).items():
        baseline_median = float(((baseline.get("detail_opens") or {}).get(key) or {}).get("median_ms") or 0)
        diff["detail_open_median_delta_ms"][key] = round(float(value.get("median_ms") or 0) - baseline_median, 1)
    return diff


def telemetry_base_url(args: argparse.Namespace) -> str:
    parsed = urlsplit(str(args.base_url or auth_proof.DEFAULT_BASE_URL))
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return auth_proof.DEFAULT_BASE_URL.rstrip("/")


def fetch_server_telemetry(args: argparse.Namespace) -> dict[str, Any] | None:
    if not args.api_token or not args.perf_run_id:
        return None
    request = Request(
        f"{telemetry_base_url(args)}/api/ui/route-perf-events?run_id={args.perf_run_id}&limit=500",
        headers={"Authorization": f"Bearer {args.api_token}"},
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def clear_logcat(args: argparse.Namespace) -> None:
    auth_proof.run(args, ["logcat", "-c"], timeout=20, check=False)


def dump_logcat(args: argparse.Namespace, target: Path) -> None:
    try:
        completed = auth_proof.run(args, ["logcat", "-d"], timeout=30, check=False)
        target.write_text((completed.stdout or "") + ("\n" + completed.stderr if completed.stderr else ""), encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defensive fallback for live adb failures
        target.write_text(f"logcat capture failed: {exc}\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.perf_run_id:
        args.perf_run_id = f"emulator-speed-loop-{int(time.time() * 1000)}"
    auth_proof.ensure_dir(args.report_dir)
    summary: dict[str, Any] = {
        "schema": RESULT_SCHEMA,
        "ok": False,
        "serial": args.serial,
        "base_url": args.base_url,
        "iterations": args.iterations,
        "app_slug": args.app_slug,
        "api_token_present": bool(args.api_token),
        "device_token_present": bool(args.device_token),
        "perf_run_id": args.perf_run_id,
        "fresh_loads": {},
        "route_opens": {},
        "detail_opens": {},
        "connect_auth": None,
        "screenshots": {},
        "logcat_path": "",
        "server_telemetry": None,
        "server_telemetry_path": "",
        "diff": None,
    }
    cover_forward_port = ""
    chrome_forward_port = ""
    try:
        auth_proof.ensure_live_credentials(args)
        auth_proof.ensure_device(args)
        auth_proof.ensure_chrome_available(args)
        clear_logcat(args)
        auth_proof.clear_chrome(args)
        auth_proof.install_apk(args)
        auth_proof.clear_app(args)
        auth_proof.grant_runtime_permissions(args)

        launch_started_at = time.perf_counter()
        auth_proof.launch_app(args)
        auth_proof.dismiss_permission_dialogs(args)
        auth_proof.wait_for_focus_prefix(args, f"{args.package_name}/", timeout_seconds=args.timeout_seconds)

        cover = auth_proof.discover_cover_cdp_url(args)
        cover_forward_port = str(cover.get("forward_port") or "")
        cdp_url = str(cover["cdp_url"])
        summary["cover_devtools"] = {
            "socket": cover.get("socket"),
            "cdp_url": cdp_url,
        }

        home_browser = capture_cdp_screenshot(
            args,
            cdp_url,
            args.report_dir / "01-home-cdp.png",
            [
                {"kind": "ensure_route", "route": "home"},
                {"kind": "perf_state"},
            ],
        )
        summary["fresh_loads"]["home"] = summarize([
            {
                "elapsed_ms": round((time.perf_counter() - launch_started_at) * 1000, 1),
                "state": home_browser.get("final_state") or {},
            }
        ])
        if (
            float(summary["fresh_loads"]["home"].get("asset_delivery_failures_max") or 0) > 0
            or float(summary["fresh_loads"]["home"].get("hosted_reload_attempts_max") or 0) > 0
        ):
            raise EmulatorSpeedProofError("Hosted asset bootstrap failed inside the Android WebView.")
        auth_proof.capture_screenshot(args, args.report_dir / "01-home-device.png", "cover-speed-home-device.png")
        summary["screenshots"]["home_device"] = str(args.report_dir / "01-home-device.png")
        summary["screenshots"]["home_cdp"] = str(args.report_dir / "01-home-cdp.png")

        for route in HOME_ROUTE_MATRIX:
            samples: list[dict[str, Any]] = []
            screenshot_path = args.report_dir / f"route-{route}.png" if route in {"tasks", "contacts", "calendar", "connect"} else None
            for iteration in range(args.iterations):
                sample = measure_route_open(
                    args,
                    cdp_url,
                    route,
                    screenshot_path=screenshot_path if iteration == 0 and screenshot_path else None,
                )
                samples.append(sample)
            summary["route_opens"][route] = summarize(samples)
            if screenshot_path is not None:
                summary["screenshots"][f"route_{route}"] = str(screenshot_path)

        task_samples: list[dict[str, Any]] = []
        contact_samples: list[dict[str, Any]] = []
        calendar_samples: list[dict[str, Any]] = []
        for iteration in range(args.iterations):
            task_samples.append(
                measure_detail_open(
                    args,
                    cdp_url,
                    "tasks",
                    ".light-task-row-main",
                    ".light-task-detail-surface",
                    screenshot_path=args.report_dir / "detail-task.png" if iteration == 0 else None,
                )
            )
            contact_samples.append(
                measure_detail_open(
                    args,
                    cdp_url,
                    "contacts",
                    ".light-contact-row",
                    ".light-contact-detail-page",
                    screenshot_path=args.report_dir / "detail-contact.png" if iteration == 0 else None,
                )
            )
            calendar_samples.append(
                measure_detail_open(
                    args,
                    cdp_url,
                    "calendar",
                    ".light-event-block",
                    ".light-event-detail-page, .light-event-document",
                    screenshot_path=args.report_dir / "detail-calendar.png" if iteration == 0 else None,
                )
            )
        summary["detail_opens"]["task"] = summarize(task_samples)
        summary["detail_opens"]["contact"] = summarize(contact_samples)
        summary["detail_opens"]["calendar"] = summarize(calendar_samples)
        summary["screenshots"]["detail_task"] = str(args.report_dir / "detail-task.png")
        summary["screenshots"]["detail_contact"] = str(args.report_dir / "detail-contact.png")
        summary["screenshots"]["detail_calendar"] = str(args.report_dir / "detail-calendar.png")

        search_browser = capture_cdp_screenshot(
            args,
            cdp_url,
            args.report_dir / "connect-search.png",
            [
                {"kind": "ensure_connect_route"},
                {"kind": "wait_for_connect_ready", "timeout_ms": int(args.timeout_seconds * 1000)},
                {"kind": "links_state"},
                {"kind": "search_app", "slug": args.app_slug},
                {"kind": "links_state"},
            ],
        )
        summary["screenshots"]["connect_search"] = str(args.report_dir / "connect-search.png")
        search_state = search_browser.get("final_state") or {}
        connect_error = auth_proof.has_forbidden_connect_error(search_state)
        if connect_error:
            raise EmulatorSpeedProofError(connect_error)
        filtered = ((search_browser.get("final_state") or {}).get("metrics") or {}).get("filtered_slugs") or []
        if args.app_slug not in filtered:
            raise EmulatorSpeedProofError(f"Connect search never exposed {args.app_slug} in filtered_slugs.")

        click_started_at = time.perf_counter()
        click_browser = capture_cdp_screenshot(
            args,
            cdp_url,
            args.report_dir / "connect-after-click.png",
            [
                {"kind": "click_app", "slug": args.app_slug},
                {"kind": "wait_for_handoff", "timeout_ms": int(args.timeout_seconds * 1000)},
                {"kind": "links_state"},
            ],
        )
        summary["screenshots"]["connect_after_click"] = str(args.report_dir / "connect-after-click.png")
        after_click_state = click_browser.get("final_state") or {}
        last_handoff = after_click_state.get("last_handoff") or {}
        if str(last_handoff.get("event") or "") == "handoff_error":
            raise EmulatorSpeedProofError(f"Connect handoff errored before Chrome opened: {last_handoff.get('error') or 'unknown error'}")
        if not bool(last_handoff.get("launched")):
            raise EmulatorSpeedProofError("Connect click did not report a launched handoff.")

        summary["focus_after_click"] = auth_proof.resolve_browser_surface(args, timeout_seconds=args.timeout_seconds)
        summary["focus_after_browser"] = auth_proof.current_focus(args)
        if not str(summary["focus_after_browser"] or "").startswith(f"{auth_proof.CHROME_PACKAGE}/"):
            raise EmulatorSpeedProofError(f"Expected Chrome after handoff, saw {summary['focus_after_browser'] or '<none>'}.")

        chrome = auth_proof.discover_chrome_cdp_url(args)
        chrome_forward_port = str(chrome.get("forward_port") or "")
        auth_proof.wait_for_rendered_auth_snapshot(args, str(chrome["cdp_url"]))
        chrome_browser = auth_proof.run_browser_helper(
            args,
            cdp_url=str(chrome["cdp_url"]),
            surface="chrome_auth",
            page_url_not_contains="/ui/pucky/latest",
            operations=[
                {"kind": "page_info"},
                {"kind": "screenshot", "path": str(args.report_dir / "connect-auth-chrome.png")},
            ],
        )
        auth_proof.capture_screenshot(args, args.report_dir / "connect-auth-device.png", "cover-speed-connect-auth-device.png")
        summary["screenshots"]["connect_auth_device"] = str(args.report_dir / "connect-auth-device.png")
        summary["screenshots"]["connect_auth_cdp"] = str(args.report_dir / "connect-auth-chrome.png")
        auth_snapshot = chrome_browser.get("final_state") or {}
        if not auth_proof.auth_snapshot_is_valid(auth_snapshot, base_url=args.base_url):
            raise EmulatorSpeedProofError(
                f"Chrome opened, but the captured page did not look like auth. url={auth_snapshot.get('url')!r} title={auth_snapshot.get('title')!r}"
            )
        if not auth_proof.auth_snapshot_has_rendered_content(auth_snapshot):
            raise EmulatorSpeedProofError(
                "Chrome opened, but the captured auth page was visually blank. "
                f"url={auth_snapshot.get('url')!r} title={auth_snapshot.get('title')!r}"
            )
        summary["connect_auth"] = {
            "elapsed_ms": round((time.perf_counter() - click_started_at) * 1000, 1),
            "auth_surface": "chrome",
            "auth_url": str(auth_snapshot.get("url") or ""),
            "auth_title": str(auth_snapshot.get("title") or ""),
            "handoff": last_handoff,
        }

        summary["server_telemetry"] = fetch_server_telemetry(args)
        if summary["server_telemetry"] is not None:
            summary["server_telemetry_path"] = str(args.report_dir / "server-telemetry.json")
            auth_proof.write_json(args.report_dir / "server-telemetry.json", summary["server_telemetry"])
        summary["logcat_path"] = str(args.report_dir / "logcat.txt")
        dump_logcat(args, args.report_dir / "logcat.txt")
        summary["diff"] = build_diff(summary, args.baseline)
        summary["ok"] = True
        auth_proof.write_json(args.report_dir / "summary.json", summary)
        return 0
    except Exception as exc:
        summary["error"] = str(exc)
        summary["logcat_path"] = str(args.report_dir / "logcat.txt")
        dump_logcat(args, args.report_dir / "logcat.txt")
        auth_proof.write_json(args.report_dir / "summary.json", summary)
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        if chrome_forward_port:
            auth_proof.run(args, ["forward", "--remove", f"tcp:{chrome_forward_port}"], timeout=10, check=False)
        if cover_forward_port:
            auth_proof.run(args, ["forward", "--remove", f"tcp:{cover_forward_port}"], timeout=10, check=False)


if __name__ == "__main__":
    raise SystemExit(main())
