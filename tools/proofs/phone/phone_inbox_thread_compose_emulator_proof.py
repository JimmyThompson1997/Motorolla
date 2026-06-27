from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import tools.proofs.phone.phone_walkie_thread_proof as phone_proof


RESULT_SCHEMA = "pucky.inbox_thread_compose_emulator_proof.v3"
THREAD_COMPOSE_NOTE = "thread-compose-note.txt"
THREAD_COMPOSE_IMAGE = "thread-compose-proof.png"
CHOOSER_LABELS = ("Open from", "Choose an action", "Files", "Documents", "Recent", "Recents", "Downloads", "Browse")
CHOOSER_CONFIRM_LABELS = ("Open", "Select", "Done", "OK", "Allow")
DEVICE_DOWNLOAD_DIR = "/sdcard/Download"
DEFAULT_PACKAGE = "com.pucky.device.debug"
DEFAULT_BASE_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=light&route=inbox&reset_nav=1"
DEFAULT_BROWSER_HELPER = ROOT / "tools" / "proofs" / "phone" / "phone_inbox_thread_compose_browser.js"
DEFAULT_APK = ROOT / "pucky-apk" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"


class InboxThreadComposeEmulatorProofError(RuntimeError):
    pass


def default_adb() -> Path:
    candidates = [
        os.environ.get("ADB"),
        shutil.which("adb"),
        str(Path.home() / ".local" / "pucky-dev" / "android-sdk" / "platform-tools" / "adb"),
        str(Path.home() / "Library" / "Android" / "sdk" / "platform-tools" / "adb"),
    ]
    for candidate in candidates:
        clean = str(candidate or "").strip()
        if clean and Path(clean).exists():
            return Path(clean).resolve()
    return Path("adb")


def default_node() -> Path:
    candidates = [
        os.environ.get("NODE"),
        shutil.which("node"),
        str(Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin" / "node"),
    ]
    for candidate in candidates:
        clean = str(candidate or "").strip()
        if clean and Path(clean).exists():
            return Path(clean).resolve()
    return Path("node")


def default_node_modules() -> Path:
    candidates = [
        os.environ.get("CODEX_NODE_MODULES"),
        str(Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "node_modules"),
    ]
    for candidate in candidates:
        clean = str(candidate or "").strip()
        if clean and Path(clean).exists():
            return Path(clean).resolve()
    return ROOT / "tools" / "node_modules"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inbox thread compose proof on the Android emulator.")
    parser.add_argument("--serial", default=os.environ.get("PUCKY_PHONE_SERIAL", "emulator-5554"))
    parser.add_argument("--adb", type=Path, default=default_adb())
    parser.add_argument("--apk", type=Path, default=DEFAULT_APK)
    parser.add_argument("--package-name", default=DEFAULT_PACKAGE)
    parser.add_argument("--page-url", default=os.environ.get("PUCKY_THREAD_COMPOSE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--api-token", default=os.environ.get("PUCKY_API_TOKEN", ""))
    parser.add_argument("--report-dir", type=Path, default=ROOT / ".tmp" / "proof-live-thread-compose-emulator")
    parser.add_argument("--proof-reply-delay-ms", type=int, default=6000)
    parser.add_argument("--browser-timeout-seconds", type=float, default=90)
    parser.add_argument("--devtools-port", type=int, default=9222)
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--node", type=Path, default=default_node(), help=argparse.SUPPRESS)
    parser.add_argument("--node-modules", type=Path, default=default_node_modules(), help=argparse.SUPPRESS)
    parser.add_argument("--browser-helper", type=Path, default=DEFAULT_BROWSER_HELPER, help=argparse.SUPPRESS)
    args = parser.parse_args()
    args.adb = args.adb.resolve() if args.adb.exists() else args.adb
    args.apk = args.apk.resolve()
    args.node = args.node.resolve() if args.node.exists() else args.node
    args.node_modules = args.node_modules.resolve() if args.node_modules.exists() else args.node_modules
    args.browser_helper = args.browser_helper.resolve()
    args.report_dir = args.report_dir.resolve()
    args.repo_root = ROOT
    return args


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def ensure_inputs(args: argparse.Namespace) -> None:
    if not str(args.api_token or "").strip():
        raise InboxThreadComposeEmulatorProofError("Live emulator proof requires --api-token or PUCKY_API_TOKEN.")
    if not args.browser_helper.exists():
        raise InboxThreadComposeEmulatorProofError(f"Browser helper not found: {args.browser_helper}")
    if not args.node_modules.exists():
        raise InboxThreadComposeEmulatorProofError(f"Node modules path not found: {args.node_modules}")


def run_adb(args: argparse.Namespace, adb_args: list[str], *, timeout_seconds: int | float = 30) -> str:
    try:
        return phone_proof.run_adb(args, args.serial, adb_args, timeout_seconds=timeout_seconds)
    except Exception as error:
        raise InboxThreadComposeEmulatorProofError(str(error)) from error


def ensure_device(args: argparse.Namespace) -> None:
    serials = phone_proof.list_adb_devices(args)
    if args.serial not in serials:
        raise InboxThreadComposeEmulatorProofError(f"Expected running emulator {args.serial}, saw {serials or ['<none>']}")


def create_fixture_files(report_dir: Path, run_prefix: str = "THREAD-COMPOSE-EMULATOR") -> dict[str, Path]:
    fixture_dir = report_dir / "fixtures"
    ensure_dir(fixture_dir)
    note_path = fixture_dir / THREAD_COMPOSE_NOTE
    image_path = fixture_dir / THREAD_COMPOSE_IMAGE
    note_path.write_text(
        "\n".join(
            [
                f"{run_prefix}-DRAFT-ONLY",
                f"{run_prefix}-SMOKE-1",
                f"{run_prefix}-BLOCK-1",
                "This text attachment proves chooser-open evidence, attachment send, and same-thread continuation.",
            ]
        ),
        encoding="utf-8",
    )
    image_path.write_bytes(
        base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbwAAAABJRU5ErkJggg=="
        )
    )
    return {"note": note_path, "image": image_path}


def stage_fixture_files(args: argparse.Namespace, fixture_files: dict[str, Path]) -> dict[str, str]:
    run_adb(args, ["shell", "mkdir", "-p", DEVICE_DOWNLOAD_DIR], timeout_seconds=30)
    staged: dict[str, str] = {}
    for key, local_path in fixture_files.items():
        remote_path = f"{DEVICE_DOWNLOAD_DIR}/{local_path.name}"
        run_adb(args, ["push", str(local_path), remote_path], timeout_seconds=60)
        subprocess.run(
            [
                str(args.adb),
                "-s",
                args.serial,
                "shell",
                "am",
                "broadcast",
                "-a",
                "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
                "-d",
                f"file://{remote_path}",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            check=False,
        )
        staged[key] = remote_path
    return staged


def capture_screencap(args: argparse.Namespace, report_dir: Path, name: str) -> str:
    remote_path = f"/sdcard/{name}"
    local_path = report_dir / name
    run_adb(args, ["shell", "screencap", "-p", remote_path], timeout_seconds=30)
    run_adb(args, ["pull", remote_path, str(local_path)], timeout_seconds=30)
    run_adb(args, ["shell", "rm", "-f", remote_path], timeout_seconds=15)
    return str(local_path)


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
        output = run_adb(args, list(adb_args), timeout_seconds=20)
        focus = parse_focus_component(output)
        if focus:
            return focus
    return ""


def dump_ui_xml(args: argparse.Namespace, *, timeout_seconds: float = 8.0) -> ET.Element:
    deadline = time.time() + max(1.0, float(timeout_seconds))
    last_error = "uiautomator dump did not return XML"
    while time.time() < deadline:
        subprocess.run(
            [str(args.adb), "-s", args.serial, "shell", "uiautomator", "dump", "/sdcard/window_dump.xml"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            check=False,
        )
        completed = subprocess.run(
            [str(args.adb), "-s", args.serial, "shell", "cat", "/sdcard/window_dump.xml"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
            check=False,
        )
        text = completed.stdout or ""
        if completed.returncode == 0 and text.lstrip().startswith("<?xml"):
            try:
                return ET.fromstring(text)
            except ET.ParseError:
                last_error = f"Could not parse uiautomator dump:\n{text}"
                time.sleep(0.25)
                continue
        last_error = (
            f"uiautomator dump unavailable (cat rc={completed.returncode}): "
            f"{(completed.stderr or completed.stdout or '').strip() or 'empty output'}"
        )
        time.sleep(0.25)
    raise InboxThreadComposeEmulatorProofError(last_error)


def parse_bounds(raw: str) -> tuple[int, int, int, int]:
    match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", str(raw or "").strip())
    if not match:
        raise InboxThreadComposeEmulatorProofError(f"Invalid node bounds: {raw!r}")
    return tuple(int(value) for value in match.groups())  # type: ignore[return-value]


def center_of(bounds: str) -> tuple[int, int]:
    left, top, right, bottom = parse_bounds(bounds)
    return ((left + right) // 2, (top + bottom) // 2)


def all_nodes(root: ET.Element) -> list[ET.Element]:
    return list(root.iter("node"))


def find_node_by_text(root: ET.Element, text: str, *, contains: bool = False) -> ET.Element | None:
    needle = str(text or "").strip().lower()
    for node in all_nodes(root):
        value = str(node.attrib.get("text") or node.attrib.get("content-desc") or "").strip()
        lowered = value.lower()
        if not value:
            continue
        if contains and needle in lowered:
            return node
        if not contains and lowered == needle:
            return node
    return None


def tap(args: argparse.Namespace, x: int, y: int) -> None:
    run_adb(args, ["shell", "input", "tap", str(int(x)), str(int(y))], timeout_seconds=10)


def tap_node(args: argparse.Namespace, node: ET.Element) -> None:
    x, y = center_of(node.attrib.get("bounds", ""))
    tap(args, x, y)


def chooser_visible(args: argparse.Namespace) -> bool:
    focus = current_focus(args)
    if focus and not focus.startswith(f"{args.package_name}/"):
        return True
    try:
        root = dump_ui_xml(args, timeout_seconds=2.0)
    except Exception:
        return False
    return any(
        find_node_by_text(root, label) or find_node_by_text(root, label, contains=True)
        for label in CHOOSER_LABELS
    )


def open_attach_chooser(args: argparse.Namespace, attach_rect: dict[str, object]) -> dict[str, object]:
    device_scale = float(attach_rect.get("device_scale") or 1.0)
    center_x = int(round(float(attach_rect.get("center_x") or 0) * max(device_scale, 1.0)))
    center_y = int(round(float(attach_rect.get("center_y") or 0) * max(device_scale, 1.0)))
    if center_x <= 0 or center_y <= 0:
        raise InboxThreadComposeEmulatorProofError(f"Invalid Attach rect for native tap: {attach_rect!r}")
    tap(args, center_x, center_y)
    time.sleep(1.5)
    focus = current_focus(args)
    root = dump_ui_xml(args, timeout_seconds=10.0)
    matched = [label for label in CHOOSER_LABELS if find_node_by_text(root, label) or find_node_by_text(root, label, contains=True)]
    visible = bool(matched) or (bool(focus) and not focus.startswith(f"{args.package_name}/"))
    return {
        "focus": focus,
        "visible": visible,
        "matched_labels": matched,
        "tap": {"x": center_x, "y": center_y, "device_scale": device_scale},
    }


def wait_for_node_text(args: argparse.Namespace, text: str, *, contains: bool = False, timeout_seconds: float = 12.0) -> ET.Element:
    deadline = time.time() + max(1.0, float(timeout_seconds))
    last_focus = ""
    while time.time() < deadline:
        last_focus = current_focus(args)
        root = dump_ui_xml(args, timeout_seconds=4.0)
        node = find_node_by_text(root, text, contains=contains)
        if node is not None:
            return node
        time.sleep(0.4)
    raise InboxThreadComposeEmulatorProofError(f"Could not find chooser node for {text!r}. focus={last_focus!r}")


def select_file_from_chooser(args: argparse.Namespace, file_name: str) -> dict[str, object]:
    deadline = time.time() + 20.0
    visited_downloads = False
    last_focus = ""
    while time.time() < deadline:
        last_focus = current_focus(args)
        root = dump_ui_xml(args, timeout_seconds=4.0)
        file_node = find_node_by_text(root, file_name) or find_node_by_text(root, file_name, contains=True)
        if file_node is not None:
            tap_node(args, file_node)
            time.sleep(1.0)
            if chooser_visible(args):
                confirm = None
                confirm_root = dump_ui_xml(args, timeout_seconds=4.0)
                for label in CHOOSER_CONFIRM_LABELS:
                    confirm = find_node_by_text(confirm_root, label) or find_node_by_text(confirm_root, label, contains=True)
                    if confirm is not None:
                        break
                if confirm is not None:
                    tap_node(args, confirm)
                    time.sleep(1.0)
            settle_deadline = time.time() + 12.0
            while time.time() < settle_deadline:
                focus = current_focus(args)
                if focus.startswith(f"{args.package_name}/") and not chooser_visible(args):
                    return {
                        "selected_file": file_name,
                        "focus_after": focus,
                        "used_downloads": visited_downloads,
                    }
                time.sleep(0.4)
            break
        if not visited_downloads:
            downloads = find_node_by_text(root, "Downloads") or find_node_by_text(root, "Downloads", contains=True)
            if downloads is not None:
                tap_node(args, downloads)
                visited_downloads = True
                time.sleep(1.0)
                continue
        time.sleep(0.4)
    raise InboxThreadComposeEmulatorProofError(
        f"Chooser did not return the selected file {file_name!r} to the WebView. focus={last_focus!r}"
    )


def with_query(page_url: str, updates: dict[str, str]) -> str:
    parsed = urlsplit(page_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for key, value in updates.items():
        if str(value or "").strip():
            query[key] = str(value).strip()
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


def api_base_url_for_page_url(page_url: str) -> str:
    parsed = urlsplit(page_url)
    scheme = str(parsed.scheme or "").strip()
    netloc = str(parsed.netloc or "").strip()
    if not scheme or not netloc:
        return ""
    return f"{scheme}://{netloc}"


def extract_operation(payload: dict[str, object], kind: str) -> dict[str, object] | None:
    for operation in payload.get("operations") or []:
        if isinstance(operation, dict) and str(operation.get("kind") or "") == kind:
            return operation
    return None


def install_apk(args: argparse.Namespace) -> None:
    if args.skip_install:
        return
    if not args.apk.exists():
        raise InboxThreadComposeEmulatorProofError(f"APK not found: {args.apk}")
    run_adb(args, ["install", "-r", str(args.apk)], timeout_seconds=300)


def launch_cover(args: argparse.Namespace) -> None:
    try:
        phone_proof.launch_cover_activity(args, args.serial)
    except Exception as error:
        raise InboxThreadComposeEmulatorProofError(str(error)) from error
    time.sleep(3.0)


def discover_cdp(args: argparse.Namespace) -> dict[str, str]:
    try:
        return phone_proof.discover_cover_cdp_url(args, args.serial)
    except Exception as error:
        raise InboxThreadComposeEmulatorProofError(str(error)) from error


def run_browser_helper(args: argparse.Namespace, cdp_url: str, operations: list[dict[str, object]]) -> dict[str, object]:
    try:
        return phone_proof.run_browser_helper(args, cdp_url, operations, timeout_seconds=args.browser_timeout_seconds)
    except Exception as error:
        raise InboxThreadComposeEmulatorProofError(str(error)) from error


def main() -> int:
    args = parse_args()
    ensure_dir(args.report_dir)
    ensure_inputs(args)
    run_prefix = f"THREAD-COMPOSE-EMULATOR-{format(int(time.time() * 1000), 'x').upper()}"
    fixture_files = create_fixture_files(args.report_dir, run_prefix=run_prefix)
    staged_fixture_files = stage_fixture_files(args, fixture_files)
    summary: dict[str, object] = {
        "schema": RESULT_SCHEMA,
        "serial": args.serial,
        "page_url": args.page_url,
        "run_prefix": run_prefix,
        "proof_reply_delay_ms": args.proof_reply_delay_ms,
        "chooser": "WebChromeClient file chooser / WebView file input",
        "thinking": "Thinking...",
        "request_count": 0,
        "attachments": [THREAD_COMPOSE_NOTE, THREAD_COMPOSE_IMAGE],
        "new_thread_created": False,
        "existing_thread_reused": False,
        "blocked_second_send": False,
        "scenarios": [],
        "screenshots": {},
        "fixtures": {key: str(value) for key, value in fixture_files.items()},
        "staged_fixtures": staged_fixture_files,
        "adb": str(args.adb),
        "apk": str(args.apk),
    }
    cdp: dict[str, str] = {}
    forward_port = ""
    try:
        ensure_device(args)
        install_apk(args)
        launch_cover(args)
        cdp = discover_cdp(args)
        forward_port = str(cdp.get("forward_port") or "")
        summary["devtools"] = cdp
        compose_url = with_query(
            args.page_url,
            {
                "api_token": args.api_token,
                "api_base_url": api_base_url_for_page_url(args.page_url),
                "reset_nav": "1",
            },
        )

        initial_payload = run_browser_helper(
            args,
            str(cdp["cdp_url"]),
            [
                {"kind": "goto_url", "url": compose_url},
                {"kind": "screenshot", "path": str(args.report_dir / "00-inbox-top-webview.png")},
                {"kind": "click_selector", "selector": '[aria-label="Compose new chat"]'},
                {"kind": "wait_for_selector", "selector": "#detail .thread-composer-input"},
                {"kind": "selector_rect", "selector": "#detail .thread-composer-attach"},
                {"kind": "thread_compose_snapshot"},
                {"kind": "screenshot", "path": str(args.report_dir / "01-compose-idle-webview.png")},
            ],
        )
        summary["initial"] = initial_payload
        summary["screenshots"]["inbox_top_webview"] = str(args.report_dir / "00-inbox-top-webview.png")
        summary["screenshots"]["compose_idle_webview"] = str(args.report_dir / "01-compose-idle-webview.png")
        summary["screenshots"]["device_compose_idle"] = capture_screencap(args, args.report_dir, "01-compose-idle-device.png")

        initial_ops = initial_payload.get("operations") or []
        attach_rect = ((initial_ops[4] if len(initial_ops) > 4 else {}) or {}).get("rect") or {}
        chooser_payload = open_attach_chooser(args, attach_rect)
        summary["chooser_open"] = chooser_payload
        summary["screenshots"]["device_chooser_open"] = capture_screencap(args, args.report_dir, "02-chooser-open-device.png")
        if not chooser_payload.get("visible"):
            raise InboxThreadComposeEmulatorProofError(
                f"Android chooser did not open from the Attach control. focus={chooser_payload.get('focus')!r}"
            )
        chooser_return = select_file_from_chooser(args, THREAD_COMPOSE_NOTE)
        summary["chooser_return"] = chooser_return

        queued_payload = run_browser_helper(
            args,
            str(cdp["cdp_url"]),
            [
                {"kind": "wait_for_selector", "selector": "#detail .thread-composer-chip"},
                {"kind": "thread_compose_snapshot"},
                {"kind": "screenshot", "path": str(args.report_dir / "03-attachment-queued-webview.png")},
            ],
        )
        summary["queued_after_chooser"] = queued_payload
        summary["screenshots"]["device_attachment_queued"] = capture_screencap(args, args.report_dir, "03-attachment-queued-device.png")
        cleared_payload = run_browser_helper(
            args,
            str(cdp["cdp_url"]),
            [
                {"kind": "click_selector", "selector": "#detail .thread-composer-chip-remove"},
                {"kind": "thread_compose_snapshot"},
            ],
        )
        summary["queued_after_remove"] = cleared_payload

        smoke_token = f"{run_prefix}-SMOKE-1"
        smoke_expected = f"ACK {smoke_token}"
        continuation_token = f"{run_prefix}-CONT-1"
        continuation_expected = f"ACK {continuation_token}"
        block_one_token = f"{run_prefix}-BLOCK-1"
        block_two_token = f"{run_prefix}-BLOCK-2"
        attachment_token = f"{run_prefix}-ATTACH-1"
        attachment_expected = f"TEXT-ATTACH-ACK {run_prefix} thread-compose-note.txt"
        summary["scenarios"] = [
            smoke_token,
            continuation_token,
            block_one_token,
            block_two_token,
            attachment_token,
        ]
        smoke_reply_delay_ms = max(6500, int(args.proof_reply_delay_ms))

        compose_payload = run_browser_helper(
            args,
            str(cdp["cdp_url"]),
            [
                {"kind": "wait_for_selector", "selector": "#detail .thread-composer-input"},
                {"kind": "fill_selector", "selector": "#detail .thread-composer-input", "value": f"{smoke_token}. Reply with exactly {smoke_expected}."},
                {"kind": "set_proof_reply_delay_ms", "value": smoke_reply_delay_ms},
                {"kind": "click_selector", "selector": "#detail .thread-composer-send"},
                {"kind": "click_selector", "selector": "#detail .light-back-button, #detail .detail-back"},
                {"kind": "wait_for_pending_feed_status", "token": smoke_token, "status": "Sending"},
                {"kind": "screenshot", "path": str(args.report_dir / "04-sending-feed-webview.png")},
                {"kind": "click_selector_containing_text", "selector": "article.card-outbound, article.card", "text": smoke_token},
                {"kind": "wait_for_text", "selector": "#detail .bubble", "expected": "Thinking..."},
                {"kind": "screenshot", "path": str(args.report_dir / "05-thinking-detail-webview.png")},
                {"kind": "wait_for_turn_request_count", "minimum": 1, "timeout_ms": 30000},
                {"kind": "wait_for_pending_feed_status", "token": smoke_token, "status": "Thinking"},
                {"kind": "wait_for_text", "selector": "#detail .bubble", "expected": smoke_expected, "timeout_ms": 90000},
                {"kind": "wait_for_thread_compose_thread_id", "timeout_ms": 30000},
                {"kind": "turn_request_events"},
                {"kind": "screenshot", "path": str(args.report_dir / "06-final-reply-webview.png")},
                {"kind": "fill_selector", "selector": "#detail .thread-composer-input", "value": f"{continuation_token}. Reply with exactly {continuation_expected}."},
                {"kind": "wait_for_thread_compose_ready", "draft_token": continuation_token, "timeout_ms": 30000},
                {"kind": "click_selector", "selector": "#detail .thread-composer-send"},
                {"kind": "wait_for_turn_request_count", "minimum": 2, "timeout_ms": 30000},
                {"kind": "wait_for_text", "selector": "#detail .bubble", "expected": continuation_expected, "timeout_ms": 90000},
                {"kind": "thread_compose_snapshot"},
                {"kind": "turn_request_events"},
                {"kind": "set_proof_reply_delay_ms", "value": int(args.proof_reply_delay_ms)},
                {"kind": "fill_selector", "selector": "#detail .thread-composer-input", "value": f"{block_one_token}. Reply with exactly ACK {block_one_token}."},
                {"kind": "wait_for_thread_compose_ready", "draft_token": block_one_token, "timeout_ms": 30000},
                {"kind": "click_selector", "selector": "#detail .thread-composer-send"},
                {"kind": "wait_for_turn_request_count", "minimum": 3, "timeout_ms": 30000},
                {"kind": "fill_selector", "selector": "#detail .thread-composer-input", "value": f"{block_two_token}. Reply with exactly ACK {block_two_token}."},
                {"kind": "thread_compose_snapshot"},
                {"kind": "turn_request_count"},
                {"kind": "screenshot", "path": str(args.report_dir / "07-blocked-second-send-webview.png")},
                {"kind": "wait_for_text", "selector": "#detail .bubble", "expected": f"ACK {block_one_token}", "timeout_ms": 90000},
                {"kind": "wait_for_thread_compose_ready", "draft_token": block_two_token, "timeout_ms": 90000},
                {"kind": "click_selector", "selector": "#detail .thread-composer-send"},
                {"kind": "wait_for_turn_request_count", "minimum": 4, "timeout_ms": 30000},
                {"kind": "thread_compose_snapshot"},
                {"kind": "wait_for_text", "selector": "#detail .bubble", "expected": f"ACK {block_two_token}", "timeout_ms": 90000},
                {"kind": "turn_request_events"},
                {"kind": "thread_compose_snapshot"},
                {"kind": "screenshot", "path": str(args.report_dir / "08-blocked-second-send-complete-webview.png")},
            ],
        )
        summary["compose_flow"] = compose_payload

        attach_rect_payload = run_browser_helper(
            args,
            str(cdp["cdp_url"]),
            [
                {"kind": "wait_for_selector", "selector": "#detail .thread-composer-input"},
                {"kind": "selector_rect", "selector": "#detail .thread-composer-attach"},
                {"kind": "thread_compose_snapshot"},
            ],
        )
        summary["attachment_attach_rect"] = attach_rect_payload
        attach_rect_ops = attach_rect_payload.get("operations") or []
        attachment_attach_rect = ((attach_rect_ops[1] if len(attach_rect_ops) > 1 else {}) or {}).get("rect") or {}
        attachment_chooser_open = open_attach_chooser(args, attachment_attach_rect)
        summary["attachment_chooser_open"] = attachment_chooser_open
        summary["screenshots"]["device_attachment_send_chooser_open"] = capture_screencap(args, args.report_dir, "09-attachment-send-chooser-open-device.png")
        if not attachment_chooser_open.get("visible"):
            raise InboxThreadComposeEmulatorProofError(
                f"Android chooser did not reopen for attachment send. focus={attachment_chooser_open.get('focus')!r}"
            )
        attachment_chooser_return = select_file_from_chooser(args, THREAD_COMPOSE_NOTE)
        summary["attachment_chooser_return"] = attachment_chooser_return

        attachment_payload = run_browser_helper(
            args,
            str(cdp["cdp_url"]),
            [
                {"kind": "wait_for_selector", "selector": "#detail .thread-composer-chip"},
                {"kind": "thread_compose_snapshot"},
                {"kind": "screenshot", "path": str(args.report_dir / "10-attachment-send-queued-webview.png")},
                {"kind": "fill_selector", "selector": "#detail .thread-composer-input", "value": f"{attachment_token}. Reply with exactly {attachment_expected}."},
                {"kind": "wait_for_thread_compose_ready", "draft_token": attachment_token, "timeout_ms": 30000},
                {"kind": "set_proof_reply_delay_ms", "value": 0},
                {"kind": "click_selector", "selector": "#detail .thread-composer-send"},
                {"kind": "wait_for_turn_request_count", "minimum": 5, "timeout_ms": 30000},
                {"kind": "wait_for_text", "selector": "#detail .bubble", "expected": attachment_expected, "timeout_ms": 90000},
                {"kind": "thread_compose_snapshot"},
                {"kind": "turn_request_events"},
                {"kind": "screenshot", "path": str(args.report_dir / "11-attachment-send-complete-webview.png")},
            ],
        )
        summary["attachment_send"] = attachment_payload
        summary["screenshots"]["device_attachment_send_queued"] = capture_screencap(args, args.report_dir, "10-attachment-send-queued-device.png")
        summary["screenshots"]["device_attachment_send_complete"] = capture_screencap(args, args.report_dir, "11-attachment-send-complete-device.png")

        operations = compose_payload.get("operations") or []
        queued_ops = queued_payload.get("operations") or []
        cleared_ops = cleared_payload.get("operations") or []
        attachment_ops = attachment_payload.get("operations") or []
        queued = queued_ops[1] if len(queued_ops) > 1 else {}
        cleared = cleared_ops[1] if len(cleared_ops) > 1 else {}
        smoke_final = operations[13] if len(operations) > 13 else {}
        smoke_requests = operations[14] if len(operations) > 14 else {}
        continuation_final = operations[21] if len(operations) > 21 else {}
        continuation_requests = operations[22] if len(operations) > 22 else {}
        blocked_snapshot = operations[29] if len(operations) > 29 else {}
        blocked_request_count = operations[30] if len(operations) > 30 else {}
        blocked_after_first = operations[33] if len(operations) > 33 else {}
        blocked_second_request_count = operations[35] if len(operations) > 35 else {}
        blocked_second_snapshot = operations[36] if len(operations) > 36 else {}
        blocked_requests = operations[38] if len(operations) > 38 else {}
        blocked_final = operations[39] if len(operations) > 39 else {}
        attachment_queued = attachment_ops[1] if len(attachment_ops) > 1 else {}
        attachment_final = attachment_ops[9] if len(attachment_ops) > 9 else {}
        attachment_requests = attachment_ops[10] if len(attachment_ops) > 10 else {}

        smoke_snapshot = (smoke_final or {}).get("snapshot") or {}
        continuation_snapshot = (continuation_final or {}).get("snapshot") or {}
        blocked_snapshot_data = (blocked_snapshot or {}).get("snapshot") or {}
        blocked_after_first_data = (blocked_after_first or {}).get("snapshot") or {}
        blocked_second_snapshot_data = (blocked_second_snapshot or {}).get("snapshot") or {}
        blocked_final_data = (blocked_final or {}).get("snapshot") or {}
        attachment_queued_data = (attachment_queued or {}).get("snapshot") or {}
        attachment_final_data = (attachment_final or {}).get("snapshot") or {}
        request_events = (attachment_requests or {}).get("requests") or (blocked_requests or {}).get("requests") or (continuation_requests or {}).get("requests") or (smoke_requests or {}).get("requests") or []

        summary["queued_attachment"] = (queued or {}).get("snapshot") or {}
        summary["queued_attachment_cleared"] = (cleared or {}).get("snapshot") or {}
        summary["new_chat_smoke"] = smoke_snapshot
        summary["continuation_smoke"] = continuation_snapshot
        summary["blocked_snapshot"] = blocked_snapshot_data
        summary["blocked_after_first"] = blocked_after_first_data
        summary["blocked_second_snapshot"] = blocked_second_snapshot_data
        summary["blocked_final"] = blocked_final_data
        summary["attachment_send_queued"] = attachment_queued_data
        summary["attachment_send_final"] = attachment_final_data
        summary["turn_requests"] = request_events
        summary["request_count"] = len(request_events)
        summary["new_thread_created"] = bool(smoke_snapshot.get("thread_id"))
        summary["existing_thread_reused"] = bool(
            smoke_snapshot.get("thread_id")
            and smoke_snapshot.get("thread_id") == continuation_snapshot.get("thread_id")
        )
        summary["attachment_send_ok"] = bool(
            THREAD_COMPOSE_NOTE in set(attachment_queued_data.get("chips") or [])
            and any(THREAD_COMPOSE_NOTE in str(label or "") for label in (attachment_final_data.get("attachment_labels") or []))
            and any(attachment_expected in str(text or "") for text in (attachment_final_data.get("bubble_texts") or []))
            and attachment_final_data.get("thread_id") == smoke_snapshot.get("thread_id")
        )
        summary["blocked_second_send"] = bool(
            blocked_snapshot_data.get("send_disabled")
            and block_two_token in str(blocked_snapshot_data.get("composer_text") or "")
            and int((blocked_request_count or {}).get("count") or 0) == 3
            and not bool(blocked_after_first_data.get("send_disabled"))
            and int((blocked_second_request_count or {}).get("count") or 0) == 4
            and any(f"ACK {block_two_token}" in str(text or "") for text in (blocked_final_data.get("bubble_texts") or []))
            and int(len(request_events)) >= 5
            and blocked_final_data.get("thread_id") == smoke_snapshot.get("thread_id")
        )
        summary["screenshots"]["device_final_reply"] = capture_screencap(args, args.report_dir, "12-final-reply-device.png")

        first_request = request_events[0] if request_events else {}
        second_request = request_events[1] if len(request_events) > 1 else {}
        fifth_request = request_events[4] if len(request_events) > 4 else {}
        summary["request_checks"] = {
            "first_is_new_thread": "thread_mode" in str(first_request.get("post_data") or "") and "new" in str(first_request.get("post_data") or ""),
            "second_reuses_thread_id": bool(smoke_snapshot.get("thread_id")) and str(smoke_snapshot.get("thread_id")) in str(second_request.get("post_data") or ""),
            "attachment_send_mentions_file": THREAD_COMPOSE_NOTE in str(fifth_request.get("post_data") or ""),
        }

        if not summary["new_thread_created"]:
            raise InboxThreadComposeEmulatorProofError("Emulator proof did not create a real thread id.")
        if not summary["existing_thread_reused"]:
            raise InboxThreadComposeEmulatorProofError("Emulator continuation did not stay on the created thread.")
        if not summary["blocked_second_send"]:
            raise InboxThreadComposeEmulatorProofError("Blocked-second-send evidence was incomplete in the emulator lane.")
        if not summary["attachment_send_ok"]:
            raise InboxThreadComposeEmulatorProofError("Attachment send evidence was incomplete in the emulator lane.")

        (args.report_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        return 0
    except Exception as error:
        summary["error"] = str(error)
        (args.report_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(str(error), file=sys.stderr)
        return 1
    finally:
        if forward_port:
            try:
                run_adb(args, ["forward", "--remove", f"tcp:{forward_port}"], timeout_seconds=10)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
