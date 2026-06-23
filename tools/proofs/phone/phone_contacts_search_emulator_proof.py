from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import urlopen

from tools.proofs.phone.phone_links_auth_flow_emulator_proof import (
    bundled_node_executable,
    bundled_node_modules,
    capture_screenshot,
    clear_chrome,
    default_adb,
    ensure_chrome_available,
    ensure_device,
    ensure_dir,
    find_devtools_sockets,
    pick_free_port,
    resolve_browser_surface,
    run,
    run_browser_helper,
)

ROOT = Path(__file__).resolve().parents[3]
RESULT_SCHEMA = "pucky.contacts_search_emulator_proof.v1"
DEFAULT_BASE_URL = "https://pucky.fly.dev"
DEFAULT_HELPER = ROOT / "tools" / "proofs" / "phone" / "phone_contacts_search_browser.js"
DEFAULT_REPORT_DIR = ROOT / ".tmp" / "proof-live-contacts-search-emulator"
CHROME_PACKAGE = "com.android.chrome"


class ContactsSearchEmulatorProofError(RuntimeError):
    pass


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prove live Contacts search keyboard stability on the Android emulator.")
    parser.add_argument("--serial", default=os.environ.get("PUCKY_ANDROID_SERIAL", ""))
    parser.add_argument("--adb", type=Path, default=default_adb())
    parser.add_argument("--base-url", default=os.environ.get("PUCKY_CONTACTS_EMULATOR_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--api-token", default=os.environ.get("PUCKY_API_TOKEN", ""))
    parser.add_argument("--refresh-key", default=os.environ.get("PUCKY_CONTACTS_EMULATOR_REFRESH", ""))
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--browser-helper", type=Path, default=DEFAULT_HELPER)
    parser.add_argument("--node", type=Path, default=bundled_node_executable())
    parser.add_argument("--node-modules", type=Path, default=bundled_node_modules())
    parser.add_argument("--timeout-seconds", type=int, default=60)
    parser.add_argument("--browser-timeout-seconds", type=int, default=25)
    parser.add_argument("--devtools-timeout-seconds", type=int, default=25)
    parser.add_argument("--devtools-port", type=int, default=9222)
    args = parser.parse_args(argv)
    args.adb = args.adb.resolve() if args.adb.exists() else args.adb
    args.report_dir = args.report_dir.resolve()
    args.browser_helper = args.browser_helper.resolve()
    args.node = args.node.resolve() if args.node.exists() else args.node
    args.node_modules = args.node_modules.resolve() if args.node_modules.exists() else args.node_modules
    args.base_url = str(args.base_url or DEFAULT_BASE_URL).rstrip("/")
    args.api_token = str(args.api_token or "").strip()
    args.refresh_key = str(args.refresh_key or "").strip()
    return args


def resolve_emulator_serial(args: argparse.Namespace) -> str:
    preferred = str(args.serial or "").strip()
    completed = subprocess.run(
        [str(args.adb), "devices"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=15,
        check=False,
    )
    serials = [
        line.split()[0]
        for line in (completed.stdout or "").splitlines()[1:]
        if "\tdevice" in line and line.split()[0].startswith("emulator-")
    ]
    if preferred:
        if preferred not in serials:
            raise ContactsSearchEmulatorProofError(f"Expected emulator {preferred}, saw {serials or ['<none>']}")
        return preferred
    if len(serials) == 1:
        return serials[0]
    if not serials:
        raise ContactsSearchEmulatorProofError("No running Android emulator was available for the Contacts search proof.")
    raise ContactsSearchEmulatorProofError(f"Multiple emulators are running; pass --serial explicitly ({serials})")


def ensure_runtime(args: argparse.Namespace) -> None:
    if not args.api_token:
        raise ContactsSearchEmulatorProofError("Contacts emulator proof requires --api-token or PUCKY_API_TOKEN.")
    if not args.browser_helper.exists():
        raise ContactsSearchEmulatorProofError(f"Browser helper not found: {args.browser_helper}")
    if not Path(args.node).exists():
        raise ContactsSearchEmulatorProofError(f"Node executable not found: {args.node}")


def build_contacts_url(args: argparse.Namespace) -> str:
    parsed = urlsplit(f"{args.base_url}/ui/pucky/latest/")
    query = dict()
    query["theme"] = "light"
    query["route"] = "contacts"
    query["reset_nav"] = "1"
    query["api_token"] = args.api_token
    if args.refresh_key:
        query["_pucky_refresh"] = args.refresh_key
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), ""))


def fetch_manifest(args: argparse.Namespace) -> dict[str, Any]:
    manifest_url = f"{args.base_url}/ui/pucky/latest/manifest.json"
    if args.refresh_key:
        manifest_url = f"{manifest_url}?{urlencode({'_pucky_refresh': args.refresh_key})}"
    with urlopen(manifest_url, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return {
        "url": manifest_url,
        "payload": payload,
    }


def verify_manifest(args: argparse.Namespace) -> dict[str, Any]:
    manifest = fetch_manifest(args)
    expected = str(args.refresh_key or "").strip()
    deployed = str((manifest.get("payload") or {}).get("source_commit_full") or "").strip()
    if expected and re.fullmatch(r"[0-9a-f]{7,40}", expected) and deployed != expected:
        raise ContactsSearchEmulatorProofError(
            f"Hosted manifest did not match expected deploy commit: expected {expected}, saw {deployed or '<missing>'}"
        )
    return manifest


def launch_contacts_url(args: argparse.Namespace, contacts_url: str) -> None:
    run(
        args,
        [
            "shell",
            "am",
            "start",
            "-W",
            "-a",
            "android.intent.action.VIEW",
            "-n",
            f"{CHROME_PACKAGE}/org.chromium.chrome.browser.ChromeTabbedActivity",
            "-d",
            contacts_url,
        ],
        timeout=45,
    )


def parse_focus_component(text: str) -> str:
    raw = str(text or "")
    patterns = (
        r"mCurrentFocus=Window\{[^\}]+\s([^\s/]+)/([^\s\}]+)",
        r"(?:topResumedActivity|ResumedActivity|mFocusedApp)=ActivityRecord\{[^\}]+\s([^\s/]+)/([^\s\}]+)",
        r"ACTIVITY\s+([^\s/]+)/([^\s]+)",
    )
    for pattern in patterns:
        match = re.search(pattern, raw)
        if match:
            return f"{match.group(1)}/{match.group(2)}"
    return ""


def current_focus(args: argparse.Namespace) -> str:
    probes = (
        ["shell", "dumpsys", "window", "windows"],
        ["shell", "dumpsys", "window"],
        ["shell", "dumpsys", "activity", "activities"],
        ["shell", "dumpsys", "activity", "top"],
    )
    for adb_args in probes:
        completed = run(args, adb_args, timeout=20, check=False)
        focus = parse_focus_component(completed.stdout or "")
        if focus:
            return focus
    return ""


def discover_chrome_cdp_url(args: argparse.Namespace) -> dict[str, Any]:
    deadline = time.monotonic() + float(args.devtools_timeout_seconds)
    last_errors: list[str] = []
    while time.monotonic() < deadline:
        sockets_text = run(args, ["shell", "cat", "/proc/net/unix"], timeout=30).stdout
        sockets = [name for name in find_devtools_sockets(sockets_text) if "chrome" in name.lower()]
        if not sockets:
            last_errors = ["waiting for Chrome DevTools socket"]
            time.sleep(1.0)
            continue
        for socket_name in sockets:
            port = pick_free_port(args.devtools_port + 20)
            run(args, ["forward", f"tcp:{port}", f"localabstract:{socket_name}"], timeout=15)
            keep_forward = False
            try:
                with urlopen(f"http://127.0.0.1:{port}/json/list", timeout=10) as response:
                    pages = json.loads(response.read().decode("utf-8"))
                matches = [
                    page for page in (pages or [])
                    if "/ui/pucky/latest" in str(page.get("url") or "")
                ]
                if matches:
                    keep_forward = True
                    return {
                        "socket": socket_name,
                        "cdp_url": f"http://127.0.0.1:{port}",
                        "forward_port": str(port),
                        "pages": pages,
                        "matches": matches,
                    }
                last_errors.append(f"{socket_name}: hosted Contacts page not present yet")
            except Exception as exc:  # pragma: no cover - exercised in live proof
                last_errors.append(f"{socket_name}: {exc}")
            finally:
                if not keep_forward:
                    run(args, ["forward", "--remove", f"tcp:{port}"], timeout=10, check=False)
        time.sleep(1.0)
    raise ContactsSearchEmulatorProofError(
        "Unable to find hosted Chrome target via DevTools sockets: " + "; ".join(last_errors or ["no matching page found"])
    )


def ime_visible_from_dumpsys(text: str) -> bool:
    raw = str(text or "")
    if "mInputShown=true" in raw:
        return True
    return bool(re.search(r"type=ime[^\n]*visible=true", raw))


def ime_dumpsys(args: argparse.Namespace) -> str:
    outputs = []
    for adb_args in (
        ["shell", "dumpsys", "input_method"],
        ["shell", "dumpsys", "window"],
    ):
        completed = run(args, adb_args, timeout=20, check=False)
        outputs.append(completed.stdout or "")
    return "\n".join(outputs)


def wait_for_ime_visible(args: argparse.Namespace, timeout_seconds: float) -> str:
    deadline = time.monotonic() + max(1.0, float(timeout_seconds))
    last_dump = ""
    while time.monotonic() < deadline:
        last_dump = ime_dumpsys(args)
        if ime_visible_from_dumpsys(last_dump):
            return last_dump
        time.sleep(0.35)
    raise ContactsSearchEmulatorProofError("Timed out waiting for the Android IME to stay visible.")


def dump_uiautomator_xml(args: argparse.Namespace) -> str:
    deadline = time.monotonic() + 8.0
    last_error = "uiautomator dump did not return XML"
    while time.monotonic() < deadline:
        run(args, ["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"], timeout=30, check=False)
        completed = run(args, ["shell", "cat", "/sdcard/window_dump.xml"], timeout=30, check=False)
        text = completed.stdout or ""
        if completed.returncode == 0 and text.lstrip().startswith("<?xml"):
            return text
        last_error = f"uiautomator dump unavailable: {(completed.stderr or completed.stdout or '').strip() or 'empty output'}"
        time.sleep(0.25)
    raise ContactsSearchEmulatorProofError(last_error)


def parse_bounds(raw: str) -> tuple[int, int, int, int]:
    match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", str(raw or "").strip())
    if not match:
        raise ContactsSearchEmulatorProofError(f"Invalid node bounds: {raw!r}")
    return tuple(int(value) for value in match.groups())


def bounds_center(raw: str) -> tuple[int, int]:
    left, top, right, bottom = parse_bounds(raw)
    return ((left + right) // 2, (top + bottom) // 2)


def find_key_center_from_uiautomator(xml_text: str, key: str) -> tuple[int, int] | None:
    root = ET.fromstring(xml_text)
    needle = str(key or "").strip().lower()
    for node in root.iter("node"):
        label = str(node.attrib.get("text") or node.attrib.get("content-desc") or "").strip().lower()
        if label == needle:
            return bounds_center(node.attrib.get("bounds", ""))
    return None


def web_view_bounds_from_uiautomator(xml_text: str) -> tuple[int, int, int, int]:
    root = ET.fromstring(xml_text)
    for node in root.iter("node"):
        content_desc = str(node.attrib.get("content-desc") or "").strip().lower()
        resource_id = str(node.attrib.get("resource-id") or "").strip().lower()
        if content_desc == "web view" or resource_id.endswith("compositor_view_holder"):
            return parse_bounds(node.attrib.get("bounds", ""))
    raise ContactsSearchEmulatorProofError("Could not locate the Chrome Web View bounds in UIAutomator output.")


def translate_webview_point(
    point: dict[str, Any],
    webview_bounds: tuple[int, int, int, int],
) -> tuple[int, int]:
    viewport_width = max(1.0, float(point.get("viewportWidth") or 0))
    viewport_height = max(1.0, float(point.get("viewportHeight") or 0))
    left, top, right, bottom = webview_bounds
    width = max(1, right - left)
    height = max(1, bottom - top)
    scaled_x = left + int(round((float(point.get("x") or 0) / viewport_width) * width))
    scaled_y = top + int(round((float(point.get("y") or 0) / viewport_height) * height))
    return (scaled_x, scaled_y)


def tap(args: argparse.Namespace, x: int, y: int) -> None:
    run(args, ["shell", "input", "tap", str(int(x)), str(int(y))], timeout=10)


def write_text(path: Path, text: str) -> None:
    path.write_text(str(text or ""), encoding="utf-8")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def helper_contacts_ready(args: argparse.Namespace, chrome_cdp_url: str) -> dict[str, Any]:
    return run_browser_helper(
        args,
        cdp_url=chrome_cdp_url,
        surface="contacts_search",
        page_url_contains="/ui/pucky/latest",
        operations=[
            {"kind": "ensure_contacts_route"},
            {"kind": "read_contacts_state"},
            {"kind": "screenshot", "path": str(args.report_dir / "contacts-page-cdp.png")},
        ],
    )


def helper_search_input_center(args: argparse.Namespace, chrome_cdp_url: str) -> dict[str, Any]:
    return run_browser_helper(
        args,
        cdp_url=chrome_cdp_url,
        surface="contacts_search",
        page_url_contains="/ui/pucky/latest",
        operations=[
            {"kind": "ensure_contacts_route"},
            {"kind": "search_input_center"},
            {"kind": "read_contacts_state"},
        ],
    )


def helper_install_trace(args: argparse.Namespace, chrome_cdp_url: str) -> dict[str, Any]:
    return run_browser_helper(
        args,
        cdp_url=chrome_cdp_url,
        surface="contacts_search",
        page_url_contains="/ui/pucky/latest",
        operations=[
            {"kind": "install_contacts_trace"},
            {"kind": "read_contacts_trace"},
        ],
    )


def helper_read_state_and_trace(args: argparse.Namespace, chrome_cdp_url: str) -> dict[str, Any]:
    return run_browser_helper(
        args,
        cdp_url=chrome_cdp_url,
        surface="contacts_search",
        page_url_contains="/ui/pucky/latest",
        operations=[
            {"kind": "read_contacts_state"},
            {"kind": "read_contacts_trace"},
        ],
    )


def wait_for_query(args: argparse.Namespace, chrome_cdp_url: str, expected_query: str, timeout_seconds: float) -> dict[str, Any]:
    deadline = time.monotonic() + max(1.0, float(timeout_seconds))
    last = None
    while time.monotonic() < deadline:
        last = helper_read_state_and_trace(args, chrome_cdp_url)
        state = last.get("results", [{}])[0].get("result") or {}
        if str(state.get("query") or "") == expected_query:
            return last
        time.sleep(0.25)
    raise ContactsSearchEmulatorProofError(
        f"Timed out waiting for Contacts query {expected_query!r}; last state was {json.dumps(last or {}, indent=2)}"
    )


def focus_search_input(args: argparse.Namespace, chrome_cdp_url: str) -> tuple[dict[str, Any], tuple[int, int], tuple[int, int, int, int], str]:
    helper = helper_search_input_center(args, chrome_cdp_url)
    point = helper.get("results", [{}, {}])[1].get("result")
    state = helper.get("results", [{}, {}, {}])[2].get("result") or {}
    if not point:
        raise ContactsSearchEmulatorProofError("Could not read Contacts search input geometry from Chrome DevTools.")
    xml_text = dump_uiautomator_xml(args)
    webview_bounds = web_view_bounds_from_uiautomator(xml_text)
    tap_point = translate_webview_point(point, webview_bounds)
    tap(args, *tap_point)
    ime_dump = wait_for_ime_visible(args, 10)
    return state, tap_point, webview_bounds, ime_dump


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    ensure_dir(args.report_dir)
    ensure_runtime(args)
    args.serial = resolve_emulator_serial(args)
    manifest_summary: dict[str, Any] | None = None
    forward_port = ""
    summary: dict[str, Any] = {
        "schema": RESULT_SCHEMA,
        "ok": False,
        "serial": args.serial,
        "base_url": args.base_url,
        "refresh_key": args.refresh_key,
        "report_dir": str(args.report_dir),
        "trace_json": str(args.report_dir / "contacts-search-trace.json"),
        "screenshots": {},
        "query_progression": [],
    }
    try:
        manifest_summary = verify_manifest(args)
        summary["manifest"] = manifest_summary
        ensure_device(args)
        ensure_chrome_available(args)
        clear_chrome(args)
        contacts_url = build_contacts_url(args)
        summary["contacts_url"] = contacts_url
        launch_contacts_url(args, contacts_url)
        summary["focus_after_launch"] = resolve_browser_surface(args, timeout_seconds=args.timeout_seconds)
        summary["focus_before_trace"] = current_focus(args)

        chrome = discover_chrome_cdp_url(args)
        forward_port = str(chrome.get("forward_port") or "")
        summary["chrome_devtools"] = {
            "socket": chrome.get("socket"),
            "cdp_url": chrome.get("cdp_url"),
            "pages": chrome.get("matches") or chrome.get("pages") or [],
        }

        ready = helper_contacts_ready(args, str(chrome["cdp_url"]))
        summary["contacts_ready"] = ready
        baseline_state = ready.get("results", [{}, {"result": {}}, {}])[1].get("result") or {}
        if str(baseline_state.get("route") or "") != "contacts":
            raise ContactsSearchEmulatorProofError(f"Expected hosted Chrome route contacts, got {baseline_state.get('route')!r}")

        _, tap_point, webview_bounds, ime_before = focus_search_input(args, str(chrome["cdp_url"]))
        summary["search_input_center"] = {
            "tap_point": {"x": tap_point[0], "y": tap_point[1]},
            "webview_bounds": {
                "left": webview_bounds[0],
                "top": webview_bounds[1],
                "right": webview_bounds[2],
                "bottom": webview_bounds[3],
            },
        }
        write_text(args.report_dir / "ime-before.txt", ime_before)
        capture_screenshot(args, args.report_dir / "contacts-keyboard-before.png", "contacts-keyboard-before.png")
        summary["screenshots"]["before"] = str(args.report_dir / "contacts-keyboard-before.png")

        trace_init = helper_install_trace(args, str(chrome["cdp_url"]))
        summary["trace_init"] = trace_init

        prefixes = [("d", "contacts-keyboard-after-d.png"), ("da", "contacts-keyboard-after-da.png"), ("dav", "contacts-keyboard-after-dav.png")]
        for expected_query, screenshot_name in prefixes:
            xml_text = dump_uiautomator_xml(args)
            key_label = expected_query[-1]
            key_center = find_key_center_from_uiautomator(xml_text, key_label)
            if not key_center:
                raise ContactsSearchEmulatorProofError(f"Could not find the {key_label!r} keyboard key from UIAutomator output.")
            tap(args, *key_center)
            state_trace = wait_for_query(args, str(chrome["cdp_url"]), expected_query, 12)
            current_state = state_trace.get("results", [{}, {}])[0].get("result") or {}
            current_trace = state_trace.get("results", [{}, {}])[1].get("result") or {}
            focus = current_focus(args)
            ime_dump = wait_for_ime_visible(args, 10)
            ime_path = args.report_dir / f"ime-after-{expected_query}.txt"
            write_text(ime_path, ime_dump)
            capture_screenshot(args, args.report_dir / screenshot_name, screenshot_name)
            summary["screenshots"][expected_query] = str(args.report_dir / screenshot_name)
            summary["query_progression"].append({
                "expected_query": expected_query,
                "query": current_state.get("query"),
                "focus": focus,
                "ime_visible": ime_visible_from_dumpsys(ime_dump),
                "key_center": {"x": key_center[0], "y": key_center[1]},
                "trace_event_counts": current_trace.get("trace_event_counts") or {},
            })
            if not focus.startswith(f"{CHROME_PACKAGE}/"):
                raise ContactsSearchEmulatorProofError(f"Chrome lost focus while typing {expected_query!r}: {focus or '<none>'}")
            if not ime_visible_from_dumpsys(ime_dump):
                raise ContactsSearchEmulatorProofError(f"Android IME stopped being visible while typing {expected_query!r}.")
            if str(current_state.get("query") or "") != expected_query:
                raise ContactsSearchEmulatorProofError(
                    f"Expected Contacts query {expected_query!r}, got {current_state.get('query')!r}"
                )

        final = helper_read_state_and_trace(args, str(chrome["cdp_url"]))
        final_state = final.get("results", [{}, {}])[0].get("result") or {}
        final_trace = final.get("results", [{}, {}])[1].get("result") or {}
        write_json(args.report_dir / "contacts-search-trace.json", final_trace)
        summary["final_state"] = final_state
        summary["final_trace"] = final_trace

        event_counts = final_trace.get("trace_event_counts") or {}
        if (event_counts.get("blur") or 0) != 0 or (event_counts.get("focusout") or 0) != 0:
            raise ContactsSearchEmulatorProofError(
                f"Expected no blur/focusout while typing dav; saw {json.dumps(event_counts, indent=2)}"
            )
        if (event_counts.get("search-node-changed") or 0) != 0:
            raise ContactsSearchEmulatorProofError(
                f"Expected no Contacts search input replacement while typing dav; saw {json.dumps(event_counts, indent=2)}"
            )
        if int(final_trace.get("initialToken") or 0) != int(final_trace.get("finalToken") or 0):
            raise ContactsSearchEmulatorProofError(
                f"Expected the same mounted Contacts input token, saw {final_trace.get('initialToken')} -> {final_trace.get('finalToken')}"
            )
        if str(final_trace.get("finalValue") or "") != "dav":
            raise ContactsSearchEmulatorProofError(f"Expected final Contacts query dav, got {final_trace.get('finalValue')!r}")

        summary["ok"] = True
        write_json(args.report_dir / "summary.json", summary)
        return 0
    except Exception as exc:
        summary["error"] = str(exc)
        write_json(args.report_dir / "summary.json", summary)
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        if forward_port:
            run(args, ["forward", "--remove", f"tcp:{forward_port}"], timeout=10, check=False)


if __name__ == "__main__":
    raise SystemExit(main())
