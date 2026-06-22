from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[3]

RESULT_SCHEMA = "pucky.links_auth_flow_emulator_proof.v2"
DEFAULT_PACKAGE = "com.pucky.device.debug"
DEFAULT_ACTIVITY = "com.pucky.device.MainActivity"
DEFAULT_BASE_URL = "https://pucky.fly.dev"
DEFAULT_APK = ROOT / "pucky-apk" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
DEFAULT_BROWSER_HELPER = ROOT / "tools" / "proofs" / "phone" / "phone_links_auth_flow_browser.js"
DEFAULT_REPORT_DIR = ROOT / ".tmp" / "links-auth-flow-emulator-live"
CHROME_PACKAGE = "com.android.chrome"
CHROME_CHOOSER_LABELS = ("Chrome", "Google Chrome")
CHROME_SETUP_ACTIVITY_HINTS = ("firstrun",)
CHROME_PROMPT_LABELS = (
    "Accept & continue",
    "Accept and continue",
    "Continue",
    "Continue without an account",
    "Use without an account",
    "No thanks",
    "Not now",
    "Skip",
    "OK",
)
RUNTIME_PERMISSIONS = [
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.READ_SMS",
    "android.permission.SEND_SMS",
    "android.permission.RECEIVE_SMS",
    "android.permission.CALL_PHONE",
    "android.permission.ANSWER_PHONE_CALLS",
    "android.permission.READ_PHONE_STATE",
    "android.permission.READ_CALL_LOG",
    "android.permission.WRITE_CALL_LOG",
    "android.permission.READ_CONTACTS",
    "android.permission.WRITE_CONTACTS",
    "android.permission.GET_ACCOUNTS",
    "android.permission.READ_CALENDAR",
    "android.permission.WRITE_CALENDAR",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
]
AUTH_URL_HINTS = (
    "slack",
    "auth",
    "oauth",
    "signin",
    "login",
    "accounts.google",
    "composio",
)


class EmulatorLinksProofError(RuntimeError):
    pass


def default_adb() -> Path:
    candidates = [
        os.environ.get("ADB"),
        shutil.which("adb"),
        str(Path.home() / ".local" / "pucky-dev" / "android-sdk" / "platform-tools" / "adb"),
        str(Path.home() / "Library" / "Android" / "sdk" / "platform-tools" / "adb"),
    ]
    for candidate in candidates:
        text = str(candidate or "").strip()
        if text and Path(text).exists():
            return Path(text).resolve()
    return Path("adb")


def bundled_node_executable() -> Path:
    root = Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin"
    for name in ("node", "node.exe"):
        candidate = root / name
        if candidate.exists():
            return candidate
    return Path("node")


def bundled_node_modules() -> Path:
    return Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "node_modules"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prove live Connect Slack auth handoff on the Android emulator.")
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--adb", type=Path, default=default_adb())
    parser.add_argument("--apk", type=Path, default=DEFAULT_APK)
    parser.add_argument("--package-name", default=DEFAULT_PACKAGE)
    parser.add_argument("--activity-name", default=DEFAULT_ACTIVITY)
    parser.add_argument("--base-url", default=os.environ.get("PUCKY_LINKS_AUTH_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--api-token", default=os.environ.get("PUCKY_API_TOKEN", ""))
    parser.add_argument("--device-token", default=os.environ.get("PUCKY_DEVICE_TOKEN", ""))
    parser.add_argument("--app-slug", default=os.environ.get("PUCKY_CONNECT_APP_SLUG", "slack"))
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--browser-helper", type=Path, default=DEFAULT_BROWSER_HELPER)
    parser.add_argument("--node", type=Path, default=bundled_node_executable())
    parser.add_argument("--node-modules", type=Path, default=bundled_node_modules())
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--skip-clear", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=60)
    parser.add_argument("--browser-timeout-seconds", type=int, default=30)
    parser.add_argument("--devtools-timeout-seconds", type=int, default=25)
    parser.add_argument("--devtools-port", type=int, default=9222)
    args = parser.parse_args(argv)
    args.adb = args.adb.resolve()
    args.apk = args.apk.resolve()
    args.report_dir = args.report_dir.resolve()
    args.browser_helper = args.browser_helper.resolve()
    args.node = args.node.resolve()
    args.node_modules = args.node_modules.resolve()
    args.base_url = str(args.base_url or DEFAULT_BASE_URL).rstrip("/")
    args.api_token = str(args.api_token or "").strip()
    args.device_token = str(args.device_token or "").strip()
    args.app_slug = str(args.app_slug or "slack").strip().lower() or "slack"
    return args


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def ensure_live_credentials(args: argparse.Namespace) -> None:
    if not args.api_token:
        raise EmulatorLinksProofError("Live emulator proof requires --api-token or PUCKY_API_TOKEN.")
    if not args.browser_helper.exists():
        raise EmulatorLinksProofError(f"Browser helper not found: {args.browser_helper}")
    if not args.node.exists():
        raise EmulatorLinksProofError(f"Node executable not found: {args.node}")


def run(args: argparse.Namespace, adb_args: list[str], *, timeout: int = 30, check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        [str(args.adb), "-s", args.serial, *adb_args],
        cwd=args.report_dir,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=timeout,
        check=False,
    )
    if check and completed.returncode != 0:
        raise EmulatorLinksProofError(
            f"adb {' '.join(adb_args)} failed ({completed.returncode}):\nstdout:\n{completed.stdout}\n\nstderr:\n{completed.stderr}"
        )
    return completed


def ensure_device(args: argparse.Namespace) -> None:
    completed = subprocess.run(
        [str(args.adb), "devices"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=15,
        check=False,
    )
    lines = [line.strip() for line in (completed.stdout or "").splitlines()[1:] if line.strip()]
    serials = {line.split()[0] for line in lines if "\tdevice" in line}
    if args.serial not in serials:
        raise EmulatorLinksProofError(f"Expected running emulator {args.serial}, saw {sorted(serials) or ['<none>']}")


def install_apk(args: argparse.Namespace) -> None:
    if args.skip_install:
        return
    if not args.apk.exists():
        raise EmulatorLinksProofError(f"APK not found: {args.apk}")
    run(args, ["install", "-r", str(args.apk)], timeout=240)


def clear_app(args: argparse.Namespace) -> None:
    if args.skip_clear:
        return
    run(args, ["shell", "pm", "clear", args.package_name], timeout=30)


def clear_chrome(args: argparse.Namespace) -> None:
    if args.skip_clear:
        return
    run(args, ["shell", "pm", "clear", CHROME_PACKAGE], timeout=30)


def grant_runtime_permissions(args: argparse.Namespace) -> None:
    for permission in RUNTIME_PERMISSIONS:
        completed = run(args, ["shell", "pm", "grant", args.package_name, permission], timeout=20, check=False)
        stderr = str(completed.stderr or "").strip().lower()
        stdout = str(completed.stdout or "").strip().lower()
        if completed.returncode == 0:
            continue
        if any(marker in stderr or marker in stdout for marker in (
            "unknown permission",
            "not a changeable permission type",
            "operation not allowed",
            "security exception",
        )):
            continue
        raise EmulatorLinksProofError(f"Could not grant {permission}: {(completed.stderr or completed.stdout or '').strip()}")


def ensure_chrome_available(args: argparse.Namespace) -> None:
    completed = run(args, ["shell", "pm", "path", CHROME_PACKAGE], timeout=20, check=False)
    output = str(completed.stdout or completed.stderr or "").strip()
    if completed.returncode != 0 or "package:" not in output:
        raise EmulatorLinksProofError("Chrome is unavailable on this emulator. Live auth proof requires Chrome.")


def provisioning_base64(args: argparse.Namespace) -> str:
    payload: dict[str, Any] = {
        "schema": "pucky.provisioning.v1",
        "device_id": "emu-links-auth-live-proof",
        "pucky_api_token": args.api_token,
    }
    if args.device_token:
        payload["token"] = args.device_token
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def launch_app(args: argparse.Namespace) -> None:
    run(
        args,
        [
            "shell",
            "am",
            "start",
            "-W",
            "-n",
            f"{args.package_name}/{args.activity_name}",
            "--ez",
            "show_home",
            "true",
            "--es",
            "provisioning_json_base64",
            provisioning_base64(args),
            "--ez",
            "connect",
            "true",
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


def wait_for_focus_prefix(args: argparse.Namespace, prefix: str, *, timeout_seconds: float = 20.0) -> str:
    deadline = time.time() + max(1.0, float(timeout_seconds))
    last_focus = ""
    while time.time() < deadline:
        last_focus = current_focus(args)
        if last_focus.startswith(prefix):
            return last_focus
        time.sleep(0.35)
    raise EmulatorLinksProofError(f"Timed out waiting for focus {prefix}; last focus was {last_focus or '<none>'}")


def dump_ui_xml(args: argparse.Namespace, *, timeout_seconds: float = 8.0) -> ET.Element:
    deadline = time.time() + max(1.0, float(timeout_seconds))
    last_error = "uiautomator dump did not return XML"
    while time.time() < deadline:
        run(args, ["shell", "uiautomator", "dump", "/sdcard/window_dump.xml"], timeout=30, check=False)
        completed = run(args, ["shell", "cat", "/sdcard/window_dump.xml"], timeout=30, check=False)
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
    raise EmulatorLinksProofError(last_error)


def parse_bounds(raw: str) -> tuple[int, int, int, int]:
    match = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", str(raw or "").strip())
    if not match:
        raise EmulatorLinksProofError(f"Invalid node bounds: {raw!r}")
    return tuple(int(value) for value in match.groups())


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


def chrome_focus_requires_setup(focus: str) -> bool:
    lowered = str(focus or "").strip().lower()
    if not lowered.startswith(f"{CHROME_PACKAGE}/"):
        return False
    return any(hint in lowered for hint in CHROME_SETUP_ACTIVITY_HINTS)


def tap(args: argparse.Namespace, x: int, y: int) -> None:
    run(args, ["shell", "input", "tap", str(int(x)), str(int(y))], timeout=10)


def tap_node(args: argparse.Namespace, node: ET.Element) -> None:
    x, y = center_of(node.attrib.get("bounds", ""))
    tap(args, x, y)


def dismiss_permission_dialogs(args: argparse.Namespace, *, timeout_seconds: int = 20) -> None:
    deadline = time.time() + timeout_seconds
    dismiss_labels = [
        "Don't allow",
        "Don’t allow",
        "Not now",
        "Cancel",
        "While using the app",
        "Only this time",
        "Allow",
        "Continue",
        "OK",
    ]
    while time.time() < deadline:
        root = dump_ui_xml(args)
        matched = None
        for label in dismiss_labels:
            matched = find_node_by_text(root, label) or find_node_by_text(root, label, contains=True)
            if matched is not None:
                break
        if matched is None:
            return
        tap_node(args, matched)
        time.sleep(0.8)


def resolve_browser_surface(args: argparse.Namespace, *, timeout_seconds: int = 25) -> str:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        focus = current_focus(args)
        if focus.startswith(f"{CHROME_PACKAGE}/") and not chrome_focus_requires_setup(focus):
            return focus
        root = dump_ui_xml(args)
        chooser = None
        for label in CHROME_CHOOSER_LABELS:
            chooser = find_node_by_text(root, label) or find_node_by_text(root, label, contains=True)
            if chooser is not None:
                break
        action = (
            find_node_by_text(root, "Just once")
            or find_node_by_text(root, "Just Once")
            or find_node_by_text(root, "Always")
        )
        if chooser is not None:
            tap_node(args, chooser)
            time.sleep(0.6)
            if action is None:
                root = dump_ui_xml(args)
                action = (
                    find_node_by_text(root, "Just once")
                    or find_node_by_text(root, "Just Once")
                    or find_node_by_text(root, "Always")
                )
            if action is not None:
                tap_node(args, action)
                time.sleep(1.0)
                continue
        tapped_prompt = False
        for label in CHROME_PROMPT_LABELS:
            prompt = find_node_by_text(root, label) or find_node_by_text(root, label, contains=True)
            if prompt is not None:
                tap_node(args, prompt)
                tapped_prompt = True
                time.sleep(1.0)
                break
        if tapped_prompt:
            continue
        if chrome_focus_requires_setup(focus):
            time.sleep(0.75)
            continue
        time.sleep(0.5)
    raise EmulatorLinksProofError(
        "Chrome chooser could not be resolved, Chrome first-run could not be dismissed, or Chrome never took focus."
    )


def capture_screenshot(args: argparse.Namespace, target: Path, remote_name: str) -> None:
    run(args, ["shell", "screencap", "-p", f"/sdcard/{remote_name}"], timeout=20)
    run(args, ["pull", f"/sdcard/{remote_name}", str(target)], timeout=30)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def fetch_json(url: str) -> Any:
    with urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def find_devtools_sockets(text: str) -> list[str]:
    found = re.findall(r"@([A-Za-z0-9._:-]*devtools_remote(?:_[0-9]+)?)", str(text or ""))
    ordered: list[str] = []
    for socket_name in found:
        if socket_name not in ordered:
            ordered.append(socket_name)
    return ordered


def pick_free_port(preferred: int = 9222) -> int:
    for port in range(preferred, preferred + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def is_cover_page(page: dict[str, Any]) -> bool:
    title = str(page.get("title") or "")
    url = str(page.get("url") or "")
    return "Pucky Cover" in title or "/ui/pucky/latest" in url or "index.html" in url


def is_auth_page(page: dict[str, Any], base_url: str) -> bool:
    url = str(page.get("url") or "").strip()
    title = str(page.get("title") or "").strip().lower()
    lowered = url.lower()
    if not lowered or lowered == "about:blank":
        return False
    if lowered.startswith("chrome://") or lowered.startswith("chrome-native://") or lowered.startswith("devtools://"):
        return False
    if lowered.startswith(base_url.lower()) and "/ui/pucky/latest" in lowered:
        return False
    return any(hint in lowered or hint in title for hint in AUTH_URL_HINTS) or lowered.startswith("http")


def discover_cover_cdp_url(args: argparse.Namespace) -> dict[str, Any]:
    deadline = time.monotonic() + float(args.devtools_timeout_seconds)
    last_errors: list[str] = []
    while time.monotonic() < deadline:
        sockets_text = run(args, ["shell", "cat", "/proc/net/unix"], timeout=30).stdout
        sockets = [name for name in find_devtools_sockets(sockets_text) if "webview" in name.lower()]
        if not sockets:
            last_errors = ["waiting for cover WebView DevTools socket"]
            time.sleep(1.0)
            continue
        for socket_name in sockets:
            port = pick_free_port(args.devtools_port)
            run(args, ["forward", f"tcp:{port}", f"localabstract:{socket_name}"], timeout=15)
            keep_forward = False
            try:
                pages = fetch_json(f"http://127.0.0.1:{port}/json/list")
                if any(is_cover_page(page) for page in (pages or [])):
                    keep_forward = True
                    return {
                        "socket": socket_name,
                        "cdp_url": f"http://127.0.0.1:{port}",
                        "forward_port": str(port),
                        "pages": pages,
                    }
                last_errors.append(f"{socket_name}: cover page not present")
            except Exception as exc:  # pragma: no cover - exercised in live proof
                last_errors.append(f"{socket_name}: {exc}")
            finally:
                if not keep_forward:
                    run(args, ["forward", "--remove", f"tcp:{port}"], timeout=10, check=False)
        time.sleep(1.0)
    raise EmulatorLinksProofError("Unable to find Pucky Cover WebView via DevTools sockets: " + "; ".join(last_errors or ["no matching cover page found"]))


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
                pages = fetch_json(f"http://127.0.0.1:{port}/json/list")
                matches = [page for page in (pages or []) if is_auth_page(page, args.base_url)]
                if matches:
                    keep_forward = True
                    return {
                        "socket": socket_name,
                        "cdp_url": f"http://127.0.0.1:{port}",
                        "forward_port": str(port),
                        "pages": pages,
                        "matches": matches,
                    }
                last_errors.append(f"{socket_name}: auth page not present yet")
            except Exception as exc:  # pragma: no cover - exercised in live proof
                last_errors.append(f"{socket_name}: {exc}")
            finally:
                if not keep_forward:
                    run(args, ["forward", "--remove", f"tcp:{port}"], timeout=10, check=False)
        time.sleep(1.0)
    raise EmulatorLinksProofError("Unable to find Chrome auth target via DevTools sockets: " + "; ".join(last_errors or ["no matching auth page found"]))


def browser_env(args: argparse.Namespace) -> dict[str, str]:
    env = os.environ.copy()
    node_path = str(args.node_modules)
    env["NODE_PATH"] = node_path if not env.get("NODE_PATH") else os.pathsep.join([node_path, env["NODE_PATH"]])
    return env


def browser_helper_timeout_seconds(request: dict[str, Any], fallback_seconds: int) -> int:
    timeout_ms_values = [int(request.get("timeout_ms") or 0)]
    for operation in request.get("operations") or []:
        if isinstance(operation, dict):
            timeout_ms_values.append(int(operation.get("timeout_ms") or 0))
    max_timeout_ms = max(timeout_ms_values or [0])
    requested_seconds = max(0, int((max_timeout_ms + 999) // 1000))
    return max(15, fallback_seconds, requested_seconds + 15)


def run_browser_helper(
    args: argparse.Namespace,
    *,
    cdp_url: str,
    surface: str,
    page_title: str = "",
    page_url_contains: str = "",
    page_url_not_contains: str = "",
    operations: list[dict[str, Any]],
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="pucky-links-auth-") as temp_dir:
        request_path = Path(temp_dir) / "request.json"
        output_path = Path(temp_dir) / "output.json"
        request = {
            "cdp_url": cdp_url,
            "surface": surface,
            "page_title": page_title,
            "page_url_contains": page_url_contains,
            "page_url_not_contains": page_url_not_contains,
            "timeout_ms": int(float(args.browser_timeout_seconds) * 1000),
            "operations": operations,
            "output_path": str(output_path),
        }
        helper_timeout_seconds = browser_helper_timeout_seconds(
            request,
            max(15, int(args.browser_timeout_seconds) + 15),
        )
        request_path.write_text(json.dumps(request, indent=2) + "\n", encoding="utf-8")
        completed = subprocess.run(
            [str(args.node), str(args.browser_helper), str(request_path)],
            cwd=args.report_dir,
            env=browser_env(args),
            capture_output=True,
            text=True,
            timeout=helper_timeout_seconds,
            check=False,
        )
        if not output_path.exists():
            raise EmulatorLinksProofError(
                f"Browser helper failed without output: {(completed.stderr or completed.stdout or '').strip()}"
            )
        payload = json.loads(output_path.read_text(encoding="utf-8"))
        if not payload.get("ok", False):
            raise EmulatorLinksProofError(f"Browser helper reported failure: {payload.get('error', 'unknown')}")
        return payload


def has_forbidden_connect_error(state: dict[str, Any]) -> str:
    metrics = state.get("metrics") or {}
    body_text = str(state.get("body_text") or "").lower()
    inline = str(metrics.get("inline_message") or "").strip()
    if "device provisioning missing pucky_api_token" in body_text:
        return "Connect still showed the missing pucky_api_token banner."
    if "unauthorized" in body_text or "unauthorized" in inline.lower():
        return "Connect showed unauthorized in the emulator."
    if not metrics.get("api_token_present"):
        return "Connect debug metrics still report api_token_present=false."
    if not metrics.get("portal_token_present"):
        return "Connect debug metrics never reported portal_token_present=true."
    if inline:
        return f"Connect surfaced an inline error before click: {inline}"
    return ""


def auth_snapshot_is_valid(snapshot: dict[str, Any], *, base_url: str) -> bool:
    url = str(snapshot.get("url") or "").strip()
    text = str(snapshot.get("body_text") or "").lower()
    title = str(snapshot.get("title") or "").lower()
    if not url or url == "about:blank":
        return False
    if url.lower().startswith(base_url.lower()) and "/ui/pucky/latest" in url.lower():
        return False
    return any(hint in url.lower() or hint in text or hint in title for hint in AUTH_URL_HINTS) or url.startswith("http")


def auth_snapshot_has_rendered_content(snapshot: dict[str, Any]) -> bool:
    title = str(snapshot.get("title") or "").strip()
    body_text = str(snapshot.get("body_text") or "").strip()
    if len(body_text) >= 24:
        return True
    if len(title) >= 6 and title.lower() != "composio platform":
        return True
    return False


def wait_for_rendered_auth_snapshot(args: argparse.Namespace, chrome_cdp_url: str) -> dict[str, Any]:
    deadline = time.time() + max(3.0, float(args.browser_timeout_seconds))
    last_snapshot: dict[str, Any] = {}
    while time.time() < deadline:
        chrome_browser = run_browser_helper(
            args,
            cdp_url=chrome_cdp_url,
            surface="chrome_auth",
            page_url_not_contains="/ui/pucky/latest",
            operations=[{"kind": "page_info"}],
        )
        snapshot = chrome_browser.get("final_state") or {}
        last_snapshot = snapshot if isinstance(snapshot, dict) else {}
        if auth_snapshot_is_valid(last_snapshot, base_url=args.base_url) and auth_snapshot_has_rendered_content(last_snapshot):
            return last_snapshot
        time.sleep(1.0)
    raise EmulatorLinksProofError(
        "Chrome opened, but the auth page never rendered readable content. "
        f"url={last_snapshot.get('url')!r} title={last_snapshot.get('title')!r}"
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    ensure_dir(args.report_dir)
    summary: dict[str, Any] = {
        "schema": RESULT_SCHEMA,
        "ok": False,
        "serial": args.serial,
        "base_url": args.base_url,
        "app_slug": args.app_slug,
        "report_dir": str(args.report_dir),
        "credentials": {
            "api_token_present": bool(args.api_token),
            "device_token_present": bool(args.device_token),
        },
        "focus_before_click": "",
        "focus_after_click": "",
        "focus_after_browser": "",
        "screenshots": {},
    }
    cover_forward_port = ""
    chrome_forward_port = ""
    try:
        ensure_live_credentials(args)
        ensure_device(args)
        ensure_chrome_available(args)
        clear_chrome(args)
        install_apk(args)
        clear_app(args)
        grant_runtime_permissions(args)
        launch_app(args)
        dismiss_permission_dialogs(args)
        wait_for_focus_prefix(args, f"{args.package_name}/", timeout_seconds=args.timeout_seconds)

        cover = discover_cover_cdp_url(args)
        cover_forward_port = str(cover.get("forward_port") or "")
        summary["cover_devtools"] = {
            "socket": cover.get("socket"),
            "cdp_url": cover.get("cdp_url"),
        }
        connect_browser = run_browser_helper(
            args,
            cdp_url=str(cover["cdp_url"]),
            surface="cover",
            page_url_contains="/ui/pucky/latest",
            operations=[
                {"kind": "ensure_connect_route"},
                {"kind": "wait_for_connect_ready", "timeout_ms": int(args.timeout_seconds * 1000)},
                {"kind": "links_state"},
                {"kind": "screenshot", "path": str(args.report_dir / "01-connect-cdp.png")},
            ],
        )
        summary["connect_browser"] = connect_browser
        connect_device = args.report_dir / "01-connect-device.png"
        capture_screenshot(args, connect_device, "links-proof-connect-device.png")
        summary["screenshots"]["connect_device"] = str(connect_device)
        summary["screenshots"]["connect_cdp"] = str(args.report_dir / "01-connect-cdp.png")
        initial_state = connect_browser.get("final_state") or {}
        connect_error = has_forbidden_connect_error(initial_state)
        if connect_error:
            raise EmulatorLinksProofError(connect_error)

        search_browser = run_browser_helper(
            args,
            cdp_url=str(cover["cdp_url"]),
            surface="cover",
            page_url_contains="/ui/pucky/latest",
            operations=[
                {"kind": "search_app", "slug": args.app_slug},
                {"kind": "links_state"},
                {"kind": "screenshot", "path": str(args.report_dir / "02-search-cdp.png")},
            ],
        )
        summary["search_browser"] = search_browser
        summary["screenshots"]["search_cdp"] = str(args.report_dir / "02-search-cdp.png")
        filtered = ((search_browser.get("final_state") or {}).get("metrics") or {}).get("filtered_slugs") or []
        if args.app_slug not in filtered:
            raise EmulatorLinksProofError(f"Connect search never exposed {args.app_slug} in filtered_slugs.")

        summary["focus_before_click"] = current_focus(args)
        click_browser = run_browser_helper(
            args,
            cdp_url=str(cover["cdp_url"]),
            surface="cover",
            page_url_contains="/ui/pucky/latest",
            operations=[
                {"kind": "click_app", "slug": args.app_slug},
                {"kind": "wait_for_handoff", "timeout_ms": int(args.timeout_seconds * 1000)},
                {"kind": "links_state"},
                {"kind": "screenshot", "path": str(args.report_dir / "03-after-click-cdp.png")},
            ],
        )
        summary["click_browser"] = click_browser
        summary["screenshots"]["after_click_cdp"] = str(args.report_dir / "03-after-click-cdp.png")
        after_click_state = click_browser.get("final_state") or {}
        last_handoff = after_click_state.get("last_handoff") or {}
        if str(last_handoff.get("event") or "") == "handoff_error":
            raise EmulatorLinksProofError(f"Connect handoff errored before Chrome opened: {last_handoff.get('error') or 'unknown error'}")
        if not bool(last_handoff.get("launched")):
            raise EmulatorLinksProofError("Connect click did not report a launched handoff.")

        summary["focus_after_click"] = resolve_browser_surface(args, timeout_seconds=args.timeout_seconds)
        summary["focus_after_browser"] = current_focus(args)
        if not summary["focus_after_browser"].startswith(f"{CHROME_PACKAGE}/"):
            raise EmulatorLinksProofError(f"Expected Chrome after handoff, saw {summary['focus_after_browser'] or '<none>'}.")

        chrome = discover_chrome_cdp_url(args)
        chrome_forward_port = str(chrome.get("forward_port") or "")
        summary["chrome_devtools"] = {
            "socket": chrome.get("socket"),
            "cdp_url": chrome.get("cdp_url"),
            "pages": chrome.get("matches") or chrome.get("pages") or [],
        }
        wait_for_rendered_auth_snapshot(args, str(chrome["cdp_url"]))
        chrome_browser = run_browser_helper(
            args,
            cdp_url=str(chrome["cdp_url"]),
            surface="chrome_auth",
            page_url_not_contains="/ui/pucky/latest",
            operations=[
                {"kind": "page_info"},
                {"kind": "screenshot", "path": str(args.report_dir / "05-auth-chrome-cdp.png")},
            ],
        )
        summary["chrome_browser"] = chrome_browser
        summary["screenshots"]["auth_chrome_cdp"] = str(args.report_dir / "05-auth-chrome-cdp.png")
        auth_device = args.report_dir / "04-auth-device.png"
        capture_screenshot(args, auth_device, "links-proof-auth-device.png")
        summary["screenshots"]["auth_device"] = str(auth_device)
        auth_snapshot = chrome_browser.get("final_state") or {}
        if not auth_snapshot_is_valid(auth_snapshot, base_url=args.base_url):
            raise EmulatorLinksProofError(
                f"Chrome opened, but the captured page did not look like auth. url={auth_snapshot.get('url')!r} title={auth_snapshot.get('title')!r}"
            )
        if not auth_snapshot_has_rendered_content(auth_snapshot):
            raise EmulatorLinksProofError(
                "Chrome opened, but the captured auth page was still visually blank. "
                f"url={auth_snapshot.get('url')!r} title={auth_snapshot.get('title')!r}"
            )

        summary["ok"] = True
        write_json(args.report_dir / "summary.json", summary)
        return 0
    except Exception as exc:
        summary["error"] = str(exc)
        write_json(args.report_dir / "summary.json", summary)
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        if chrome_forward_port:
            run(args, ["forward", "--remove", f"tcp:{chrome_forward_port}"], timeout=10, check=False)
        if cover_forward_port:
            run(args, ["forward", "--remove", f"tcp:{cover_forward_port}"], timeout=10, check=False)


if __name__ == "__main__":
    raise SystemExit(main())
