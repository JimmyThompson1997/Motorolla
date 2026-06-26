from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import tools.proofs.phone.phone_walkie_thread_proof as proof
import tools.support.phone_proof_shared as phone_shared

RESULT_SCHEMA = "pucky.auth_android_ubc_real_proof.v1"
DEFAULT_APK = ROOT / "pucky-apk" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
DEFAULT_LOGIN_LABELS = ["Continue", "Send code", "Send Code", "Sign in", "Sign up", "Create account"]
DEFAULT_VERIFY_LABELS = ["Continue", "Verify", "Verify code", "Sign in", "Submit"]
DEFAULT_LOGOUT_LABELS = ["Sign out", "Log out", "Logout"]
DEFAULT_ROUTES = ["home", "inbox", "connect", "settings"]
DEFAULT_OTP_CODE = "424242"


class AndroidAuthProofError(RuntimeError):
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


def env_value(*names: str) -> str:
    for name in names:
        value = str(os.environ.get(name, "")).strip()
        if value:
            return value
    return ""


def truthy(value: object, fallback: bool = False) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return fallback
    return text not in {"0", "false", "no", "off"}


def timestamp_slug() -> str:
    return time.strftime("%Y-%m-%dT%H-%M-%S", time.gmtime())


def current_git_head() -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return str(completed.stdout or "").strip()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the real Android UBC auth/WebView proof against the authenticated cover shell.")
    parser.add_argument("--serial", default=os.environ.get("PUCKY_PHONE_SERIAL", ""))
    parser.add_argument("--adb", type=Path, default=default_adb())
    parser.add_argument("--apk", type=Path, default=DEFAULT_APK)
    parser.add_argument("--package-name", default=proof.DEFAULT_PACKAGE_NAME)
    parser.add_argument("--login-url", default=env_value("PUCKY_AUTH_LOGIN_URL", "PUCKY_AUTH_BASE_URL") or "https://pucky.fly.dev/sign-in")
    parser.add_argument("--workspace-host-pattern", default=env_value("PUCKY_AUTH_WORKSPACE_HOST_PATTERN"))
    parser.add_argument("--user-a-email", default=env_value("PUCKY_AUTH_USER_A_EMAIL"))
    parser.add_argument("--user-a-otp", default=env_value("PUCKY_AUTH_USER_A_OTP_CODE"))
    parser.add_argument("--user-a-otp-command", default=env_value("PUCKY_AUTH_USER_A_OTP_COMMAND", "PUCKY_AUTH_OTP_COMMAND"))
    parser.add_argument("--user-b-email", default=env_value("PUCKY_AUTH_USER_B_EMAIL"))
    parser.add_argument("--user-b-otp", default=env_value("PUCKY_AUTH_USER_B_OTP_CODE"))
    parser.add_argument("--user-b-otp-command", default=env_value("PUCKY_AUTH_USER_B_OTP_COMMAND", "PUCKY_AUTH_OTP_COMMAND"))
    parser.add_argument("--timeout-seconds", type=float, default=120)
    parser.add_argument("--browser-timeout-seconds", type=float, default=90)
    parser.add_argument("--devtools-port", type=int, default=9222)
    parser.add_argument("--report-dir", type=Path, default=ROOT / ".tmp" / "proof-live-auth-android-ubc" / timestamp_slug())
    parser.add_argument("--browser-helper", type=Path, default=ROOT / "tools" / "proofs" / "auth" / "phone_auth_ubc_browser.js", help=argparse.SUPPRESS)
    parser.add_argument("--node", type=Path, default=proof.bundled_node_executable(), help=argparse.SUPPRESS)
    parser.add_argument("--node-modules", type=Path, default=proof.bundled_node_modules(), help=argparse.SUPPRESS)
    parser.add_argument("--repo-root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--skip-install", action="store_true")
    parser.add_argument("--skip-clear", action="store_true")
    parser.add_argument("--major-routes", default=",".join(DEFAULT_ROUTES))
    args = parser.parse_args(argv)
    args.adb = args.adb.resolve() if args.adb.exists() else args.adb
    args.apk = args.apk.resolve()
    args.report_dir = args.report_dir.resolve()
    args.browser_helper = args.browser_helper.resolve()
    args.node = args.node.resolve() if isinstance(args.node, Path) and args.node.exists() else args.node
    args.node_modules = args.node_modules.resolve()
    args.repo_root = args.repo_root.resolve()
    args.login_url = str(args.login_url or "").strip()
    args.user_a_email = str(args.user_a_email or "").strip()
    args.user_b_email = str(args.user_b_email or "").strip()
    args.user_a_otp = str(args.user_a_otp or "").strip()
    args.user_b_otp = str(args.user_b_otp or "").strip()
    args.user_a_otp_command = str(args.user_a_otp_command or "").strip()
    args.user_b_otp_command = str(args.user_b_otp_command or "").strip()
    args.major_routes = [item.strip() for item in str(args.major_routes or "").split(",") if item.strip()]
    return args


def interpolate_template(template: str, values: dict[str, object]) -> str:
    output = str(template or "")
    for key, value in values.items():
        output = output.replace(f"{{{{{key}}}}}", str(value or ""))
    return output


def resolve_otp_code(email: str, explicit_code: str, explicit_command: str, label: str) -> str:
    code = str(explicit_code or "").strip()
    if code:
        return code
    command = str(explicit_command or "").strip()
    if command:
        shell = os.environ.get("SHELL") or "/bin/zsh"
        rendered = interpolate_template(command, {"email": email, "label": label})
        completed = subprocess.run(
            [shell, "-lc", rendered],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
            check=False,
        )
        stdout = str(completed.stdout or "").strip()
        if completed.returncode == 0 and stdout:
            return stdout.splitlines()[-1].strip()
        detail = str(completed.stderr or completed.stdout or "").strip()
        raise AndroidAuthProofError(
            f"{label}: OTP command failed ({completed.returncode}): {detail or 'no output'}"
        )
    if truthy(os.environ.get("PUCKY_AUTH_ALLOW_DEFAULT_TEST_OTP"), False):
        return DEFAULT_OTP_CODE
    raise AndroidAuthProofError(
        f"Missing OTP source for {label}. Set {label.lower().replace(' ', '-')}-otp, {label.lower().replace(' ', '-')}-otp-command, or the matching environment variables."
    )


def ensure_inputs(args: argparse.Namespace) -> None:
    if not args.user_a_email:
        raise AndroidAuthProofError("Missing --user-a-email or PUCKY_AUTH_USER_A_EMAIL.")
    if not args.user_b_email:
        raise AndroidAuthProofError("Missing --user-b-email or PUCKY_AUTH_USER_B_EMAIL.")
    args.user_a_otp = resolve_otp_code(args.user_a_email, args.user_a_otp, args.user_a_otp_command, "User A")
    args.user_b_otp = resolve_otp_code(args.user_b_email, args.user_b_otp, args.user_b_otp_command, "User B")
    if not args.browser_helper.exists():
        raise AndroidAuthProofError(f"Browser helper not found: {args.browser_helper}")
    if not args.node_modules.exists():
        raise AndroidAuthProofError(f"Node modules not found: {args.node_modules}")


def adb_process(args: argparse.Namespace, serial: str, adb_args: list[str], *, capture_output: bool = True, timeout: float = 60) -> subprocess.CompletedProcess[str]:
    command = [str(args.adb), "-s", serial, *adb_args]
    return subprocess.run(
        command,
        cwd=args.repo_root,
        capture_output=capture_output,
        text=True,
        encoding="utf-8",
        timeout=timeout,
        check=False,
    )


def install_apk(args: argparse.Namespace, serial: str) -> None:
    if args.skip_install:
        return
    if not args.apk.exists():
        raise AndroidAuthProofError(f"APK not found: {args.apk}")
    completed = adb_process(args, serial, ["install", "-r", str(args.apk)], timeout=300)
    if completed.returncode != 0:
        raise AndroidAuthProofError(f"adb install failed: {(completed.stderr or completed.stdout).strip()}")


def clear_app(args: argparse.Namespace, serial: str) -> None:
    if args.skip_clear:
        return
    completed = adb_process(args, serial, ["shell", "pm", "clear", args.package_name], timeout=60)
    if completed.returncode != 0:
        raise AndroidAuthProofError(f"pm clear failed: {(completed.stderr or completed.stdout).strip()}")


def reset_logcat(args: argparse.Namespace, serial: str) -> None:
    adb_process(args, serial, ["logcat", "-c"], timeout=30)


def dump_logcat(args: argparse.Namespace, serial: str, report_dir: Path) -> dict[str, str]:
    report_dir.mkdir(parents=True, exist_ok=True)
    full_path = report_dir / "logcat-full.txt"
    filtered_path = report_dir / "logcat-filtered.txt"
    completed = adb_process(args, serial, ["logcat", "-d"], timeout=90)
    full_text = str(completed.stdout or completed.stderr or "")
    full_path.write_text(full_text, encoding="utf-8")
    filtered_lines = [
        line for line in full_text.splitlines()
        if any(token in line.lower() for token in ("chromium", "webview", "cr_", "pucky"))
    ]
    filtered_path.write_text("\n".join(filtered_lines) + ("\n" if filtered_lines else ""), encoding="utf-8")
    return {
        "full": str(full_path),
        "filtered": str(filtered_path),
    }


def background_app(args: argparse.Namespace, serial: str) -> None:
    proof.run_adb(args, serial, ["shell", "input", "keyevent", "3"], timeout_seconds=30)
    time.sleep(2.0)


def relaunch_app(args: argparse.Namespace, serial: str) -> None:
    proof.launch_cover_activity(args, serial)
    time.sleep(3.0)


def force_stop(args: argparse.Namespace, serial: str) -> None:
    proof.run_adb(args, serial, ["shell", "am", "force-stop", args.package_name], timeout_seconds=30)
    time.sleep(2.0)


def op_screenshot(report_dir: Path, name: str) -> str:
    return str((report_dir / f"{name}.png").resolve())


def auth_flow_operations(
    *,
    login_url: str,
    workspace_host_pattern: str,
    email: str,
    otp_code: str,
    route_dir: Path,
    major_routes: list[str],
    screenshot_prefix: str,
) -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = [
        {"kind": "goto_url", "url": login_url},
        {"kind": "screenshot", "path": op_screenshot(route_dir, f"{screenshot_prefix}-01-signed-out-landing")},
        {"kind": "wait_for_email"},
        {"kind": "fill_email", "value": email},
        {"kind": "click_labels", "labels": DEFAULT_LOGIN_LABELS},
        {"kind": "wait_for_otp"},
        {"kind": "screenshot", "path": op_screenshot(route_dir, f"{screenshot_prefix}-02-otp-entry")},
        {"kind": "fill_otp", "value": otp_code},
        {"kind": "click_labels", "labels": DEFAULT_VERIFY_LABELS},
        {"kind": "wait_for_workspace", "login_url": login_url, "workspace_host_pattern": workspace_host_pattern},
        {"kind": "screenshot", "path": op_screenshot(route_dir, f"{screenshot_prefix}-03-workspace-landing")},
        {"kind": "read_state"},
    ]
    for index, route in enumerate(major_routes, start=4):
        ops.append({"kind": "navigate_route", "route": route})
        ops.append({"kind": "wait_for_route", "route": route})
        ops.append({"kind": "screenshot", "path": op_screenshot(route_dir, f"{screenshot_prefix}-{index:02d}-{route}")})
    return ops


def persistence_operations(
    *,
    login_url: str,
    workspace_host_pattern: str,
    route_dir: Path,
    screenshot_prefix: str,
) -> list[dict[str, Any]]:
    return [
        {"kind": "wait_for_workspace", "login_url": login_url, "workspace_host_pattern": workspace_host_pattern},
        {"kind": "screenshot", "path": op_screenshot(route_dir, f"{screenshot_prefix}-workspace")},
        {"kind": "read_state"},
    ]


def logout_operations(route_dir: Path, screenshot_prefix: str) -> list[dict[str, Any]]:
    return [
        {"kind": "logout", "labels": DEFAULT_LOGOUT_LABELS},
        {"kind": "screenshot", "path": op_screenshot(route_dir, f"{screenshot_prefix}-logout")},
        {"kind": "read_state"},
    ]


def cross_user_operations(owner_workspace_url: str, route_dir: Path, screenshot_prefix: str) -> list[dict[str, Any]]:
    return [
        {"kind": "goto_url", "url": owner_workspace_url},
        {"kind": "wait_ms", "ms": 1500},
        {"kind": "screenshot", "path": op_screenshot(route_dir, f"{screenshot_prefix}-cross-user-attempt")},
        {"kind": "read_state"},
    ]


def latest_state(payload: dict[str, Any]) -> dict[str, Any]:
    final_surface = payload.get("final_surface")
    return final_surface if isinstance(final_surface, dict) else {}


def extract_workspace_url(payload: dict[str, Any]) -> str:
    return str(latest_state(payload).get("url") or "").strip()


def device_screenshot(args: argparse.Namespace, serial: str, report_dir: Path, name: str) -> str:
    path = report_dir / f"{name}.png"
    proof.capture_device_screenshot(args, serial, path)
    return str(path)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def run_browser_ops(
    args: argparse.Namespace,
    serial: str,
    report_dir: Path,
    operations: list[dict[str, Any]],
    *,
    timeout_seconds: float | None = None,
) -> dict[str, Any]:
    cdp = proof.discover_cover_cdp_url(args, serial)
    payload = proof.run_browser_helper(args, cdp["cdp_url"], operations, timeout_seconds=timeout_seconds)
    write_json(report_dir / "browser-output.json", payload)
    return payload


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    ensure_inputs(args)
    args.report_dir.mkdir(parents=True, exist_ok=True)
    serial = proof.resolve_adb_serial(args)
    args.serial = serial
    reset_logcat(args, serial)
    summary: dict[str, Any] = {
        "schema": RESULT_SCHEMA,
        "ok": False,
        "report_dir": str(args.report_dir),
        "device_serial": serial,
        "package_name": args.package_name,
        "apk_path": str(args.apk),
        "login_url": args.login_url,
        "workspace_host_pattern": args.workspace_host_pattern,
        "major_routes": args.major_routes,
        "git_head": current_git_head(),
        "started_at": phone_shared.utc_stamp(),
        "stages": {},
    }
    try:
        install_apk(args, serial)
        clear_app(args, serial)
        summary["installed_package"] = proof.installed_package_info(args, serial)

        relaunch_app(args, serial)
        summary["stages"]["user_a_login"] = run_browser_ops(
            args,
            serial,
            args.report_dir / "user-a-login",
            auth_flow_operations(
                login_url=args.login_url,
                workspace_host_pattern=args.workspace_host_pattern,
                email=args.user_a_email,
                otp_code=args.user_a_otp,
                route_dir=args.report_dir / "user-a-login",
                major_routes=args.major_routes,
                screenshot_prefix="user-a",
            ),
            timeout_seconds=args.browser_timeout_seconds,
        )
        summary["stages"]["user_a_login"]["device_screenshot"] = device_screenshot(args, serial, args.report_dir / "device", "01-user-a-landing-device")
        owner_workspace_url = extract_workspace_url(summary["stages"]["user_a_login"])
        if not owner_workspace_url:
            raise AndroidAuthProofError("User A flow did not end on a workspace URL.")

        background_app(args, serial)
        relaunch_app(args, serial)
        summary["stages"]["background_foreground"] = run_browser_ops(
            args,
            serial,
            args.report_dir / "background-foreground",
            persistence_operations(
                login_url=args.login_url,
                workspace_host_pattern=args.workspace_host_pattern,
                route_dir=args.report_dir / "background-foreground",
                screenshot_prefix="background-foreground",
            ),
            timeout_seconds=args.browser_timeout_seconds,
        )
        summary["stages"]["background_foreground"]["device_screenshot"] = device_screenshot(args, serial, args.report_dir / "device", "02-background-foreground-device")

        force_stop(args, serial)
        relaunch_app(args, serial)
        summary["stages"]["force_stop_relaunch"] = run_browser_ops(
            args,
            serial,
            args.report_dir / "force-stop-relaunch",
            persistence_operations(
                login_url=args.login_url,
                workspace_host_pattern=args.workspace_host_pattern,
                route_dir=args.report_dir / "force-stop-relaunch",
                screenshot_prefix="force-stop-relaunch",
            ),
            timeout_seconds=args.browser_timeout_seconds,
        )
        summary["stages"]["force_stop_relaunch"]["device_screenshot"] = device_screenshot(args, serial, args.report_dir / "device", "03-force-stop-relaunch-device")

        summary["stages"]["logout"] = run_browser_ops(
            args,
            serial,
            args.report_dir / "logout",
            logout_operations(args.report_dir / "logout", "logout"),
            timeout_seconds=args.browser_timeout_seconds,
        )
        summary["stages"]["logout"]["device_screenshot"] = device_screenshot(args, serial, args.report_dir / "device", "04-logout-device")
        logout_state = latest_state(summary["stages"]["logout"])
        if "sign in" not in str(logout_state.get("body") or "").lower() and "continue" not in str(logout_state.get("body") or "").lower():
            raise AndroidAuthProofError("Logout stage did not return to an auth surface.")

        force_stop(args, serial)
        relaunch_app(args, serial)
        summary["stages"]["user_b_login"] = run_browser_ops(
            args,
            serial,
            args.report_dir / "user-b-login",
            auth_flow_operations(
                login_url=args.login_url,
                workspace_host_pattern=args.workspace_host_pattern,
                email=args.user_b_email,
                otp_code=args.user_b_otp,
                route_dir=args.report_dir / "user-b-login",
                major_routes=args.major_routes,
                screenshot_prefix="user-b",
            ),
            timeout_seconds=args.browser_timeout_seconds,
        )
        summary["stages"]["user_b_login"]["device_screenshot"] = device_screenshot(args, serial, args.report_dir / "device", "05-user-b-landing-device")
        user_b_workspace_url = extract_workspace_url(summary["stages"]["user_b_login"])
        summary["stages"]["cross_user_attempt"] = run_browser_ops(
            args,
            serial,
            args.report_dir / "cross-user-attempt",
            cross_user_operations(owner_workspace_url, args.report_dir / "cross-user-attempt", "user-b"),
            timeout_seconds=args.browser_timeout_seconds,
        )
        summary["stages"]["cross_user_attempt"]["device_screenshot"] = device_screenshot(args, serial, args.report_dir / "device", "06-cross-user-attempt-device")
        cross_body = str(latest_state(summary["stages"]["cross_user_attempt"]).get("body") or "")
        if owner_workspace_url == user_b_workspace_url:
            raise AndroidAuthProofError("User B landed on the same workspace URL as User A.")
        if re.search(r"user a|auth proof", cross_body, re.IGNORECASE):
            raise AndroidAuthProofError("Cross-user attempt surface appeared to render owner data.")

        summary["logcat"] = dump_logcat(args, serial, args.report_dir / "logs")
        summary["ok"] = True
        summary["finished_at"] = phone_shared.utc_stamp()
        phone_shared.save_json(args.report_dir / "summary.json", summary)
        return 0
    except Exception as exc:
        summary["error"] = str(exc)
        summary["finished_at"] = phone_shared.utc_stamp()
        try:
            summary["logcat"] = dump_logcat(args, serial, args.report_dir / "logs")
        except Exception as logcat_exc:  # pragma: no cover - best effort
            summary["logcat_error"] = str(logcat_exc)
        phone_shared.save_json(args.report_dir / "summary.json", summary)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
