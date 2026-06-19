from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import tools.support.phone_proof_shared as phone_shared


CANONICAL_REPO_ROOT = Path(r"C:\Users\jimmy\Desktop\Motorolla-master-ui")
DEFAULT_VM_BASE_URL = "https://pucky.fly.dev"
DEFAULT_BUNDLE_PATH = "/ui/pucky/latest/bundle.zip"
DEFAULT_MANIFEST_PATH = "/ui/pucky/latest/manifest.json"
DEFAULT_ADB = Path(r"C:\Users\jimmy\Desktop\Android\tools\android-sdk\platform-tools\adb.exe")
DEFAULT_PACKAGE_NAME = "com.pucky.device.debug"
DEFAULT_ACTIVITY_NAME = "com.pucky.device.MainActivity"
RESULT_SCHEMA = "pucky.ui_bundle_refresh_evidence.v1"
TRANSIENT_PUCKY_FAILURE_MARKERS = (
    "WINERROR 10053",
    "WINERROR 10054",
    "WINERROR 10061",
    "CONNECTIONABORTEDERROR",
    "CONNECTIONREFUSEDERROR",
    "CONNECTIONRESETERROR",
    "REMOTEDISCONNECTED",
    "DEVICE_OFFLINE",
    "BROKER_UNAVAILABLE",
)


class OfficialRefreshError(RuntimeError):
    pass


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def utc_stamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run_git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=root,
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout.strip()


def local_git_state(root: Path) -> dict[str, object]:
    return {
        "repo_root": str(root),
        "branch": run_git(root, "rev-parse", "--abbrev-ref", "HEAD"),
        "head": run_git(root, "rev-parse", "HEAD"),
        "head_short": run_git(root, "rev-parse", "--short", "HEAD"),
        "upstream": run_git(root, "rev-parse", "@{u}"),
        "dirty": bool(run_git(root, "status", "--short")),
    }


def require_official_local_repo(root: Path, canonical_root: Path = CANONICAL_REPO_ROOT) -> dict[str, object]:
    if root.resolve() != canonical_root.resolve():
        raise OfficialRefreshError(f"Official HTML refresh must run from {canonical_root}")
    state = local_git_state(root)
    if state["branch"] != "master":
        raise OfficialRefreshError("Official HTML refresh requires branch master")
    if state["dirty"]:
        raise OfficialRefreshError("Official HTML refresh refuses dirty workspaces")
    if state["head"] != state["upstream"]:
        raise OfficialRefreshError("Official HTML refresh requires local HEAD == origin/master")
    return state


def fetch_json(url: str) -> dict[str, Any]:
    request = Request(
        url,
        headers={
            "Cache-Control": "no-cache, no-store, max-age=0",
            "Pragma": "no-cache",
        },
    )
    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def cache_busted_url(url: str, cache_key: object) -> str:
    parsed = urlparse(url)
    query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != "_pucky_refresh"]
    query.append(("_pucky_refresh", str(cache_key)))
    return urlunparse(parsed._replace(query=urlencode(query)))


def short_commit_matches(full_commit: object, short_commit: object) -> bool:
    full = str(full_commit or "").strip()
    short = str(short_commit or "").strip()
    return bool(full and short and full.startswith(short))


def validate_remote_manifest(remote_manifest: dict[str, Any], local_git: dict[str, object]) -> dict[str, Any]:
    if remote_manifest.get("schema") != "pucky.ui_bundle.v1":
        raise OfficialRefreshError("Remote UI manifest schema is invalid")
    if remote_manifest.get("source_commit_full") != local_git["head"]:
        raise OfficialRefreshError("Remote UI manifest commit does not match local master HEAD")
    if not short_commit_matches(local_git["head"], remote_manifest.get("source_commit_short")):
        raise OfficialRefreshError("Remote UI manifest short commit does not match local master HEAD")
    if remote_manifest.get("source_branch") != "master":
        raise OfficialRefreshError("Remote UI manifest branch must be master")
    if bool(remote_manifest.get("source_dirty", True)):
        raise OfficialRefreshError("Remote UI manifest must come from a clean master checkout")
    if not str(remote_manifest.get("ui_version") or "").strip():
        raise OfficialRefreshError("Remote UI manifest must include ui_version")
    return remote_manifest


def puckyctl_args(args: argparse.Namespace, command_type: str, payload: dict[str, Any]) -> list[str]:
    argv = [
        sys.executable,
        str(args.puckyctl),
        "--json",
        "--timeout-ms",
        str(max(1000, int(args.command_timeout_seconds) * 1000)),
    ]
    if args.broker:
        argv += ["--broker", args.broker]
    if args.token:
        argv += ["--token", args.token]
    if args.device_id:
        argv += ["--device-id", args.device_id]
    argv += ["command", "send", command_type, "--args-json", json.dumps(payload, separators=(",", ":")), "--wait"]
    return argv


def run_pucky_command(args: argparse.Namespace, command_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    completed = subprocess.run(
        puckyctl_args(args, command_type, payload),
        cwd=args.repo_root,
        text=True,
        capture_output=True,
        timeout=args.command_timeout_seconds,
    )
    combined = "\n".join(part for part in (completed.stdout, completed.stderr) if part)
    try:
        parsed = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise OfficialRefreshError(f"Unable to parse puckyctl JSON for {command_type}: {combined}") from exc
    if completed.returncode != 0 or not parsed.get("ok"):
        raise OfficialRefreshError(f"Command {command_type} failed: {combined}")
    result = parsed.get("result")
    return result if isinstance(result, dict) else {}


def is_transient_pucky_failure(message: str) -> bool:
    upper = str(message or "").upper()
    return any(marker in upper for marker in TRANSIENT_PUCKY_FAILURE_MARKERS)


def wait_for_broker_command_channel(
    args: argparse.Namespace,
    *,
    timeout_seconds: float | None = None,
    sleep_seconds: float = 2.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + float(timeout_seconds or max(15, args.command_timeout_seconds))
    last_error = ""
    while time.monotonic() < deadline:
        try:
            return run_pucky_command(args, "ping", {})
        except OfficialRefreshError as exc:
            last_error = str(exc)
            if not is_transient_pucky_failure(last_error):
                raise
        time.sleep(sleep_seconds)
    raise OfficialRefreshError(f"Timed out waiting for broker command channel: {last_error}")


def run_pucky_command_resilient(
    args: argparse.Namespace,
    command_type: str,
    payload: dict[str, Any],
    *,
    attempts: int = 3,
) -> dict[str, Any]:
    last_error: OfficialRefreshError | None = None
    for attempt in range(1, max(1, attempts) + 1):
        try:
            return run_pucky_command(args, command_type, payload)
        except OfficialRefreshError as exc:
            if attempt >= attempts or not is_transient_pucky_failure(str(exc)):
                raise
            last_error = exc
            wait_for_broker_command_channel(
                args,
                timeout_seconds=min(max(15, args.command_timeout_seconds), 60),
            )
    raise last_error or OfficialRefreshError(f"Command {command_type} failed")


def run_adb(
    args: argparse.Namespace,
    serial: str,
    adb_args: list[str],
    *,
    timeout_seconds: int | float = 30,
) -> str:
    command = [str(args.adb), "-s", serial, *adb_args]
    completed = subprocess.run(
        command,
        cwd=args.repo_root,
        text=True,
        capture_output=True,
        timeout=timeout_seconds,
    )
    combined = "\n".join(part for part in (completed.stdout, completed.stderr) if part)
    if completed.returncode != 0:
        raise OfficialRefreshError(f"ADB command failed: {combined}")
    return combined.strip()


def wait_for_live_surface(
    args: argparse.Namespace,
    *,
    timeout_seconds: int | float | None = None,
    interval_seconds: float = 2.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + float(timeout_seconds or max(15, args.command_timeout_seconds))
    last_error = ""
    while time.monotonic() < deadline:
        try:
            surface = run_pucky_command_resilient(args, "ui.surface.get", {}, attempts=1)
            if surface:
                return surface
        except OfficialRefreshError as exc:
            last_error = str(exc)
            if not is_transient_pucky_failure(last_error):
                raise
        time.sleep(interval_seconds)
    raise OfficialRefreshError(f"Timed out waiting for ui.surface.get after relaunch: {last_error}")


def verify_live_shell_after_refresh(args: argparse.Namespace) -> dict[str, Any]:
    adb_serial = args.adb_serial or args.device_id
    force_stop_output = run_adb(
        args,
        adb_serial,
        ["shell", "am", "force-stop", args.package_name],
        timeout_seconds=max(30, args.command_timeout_seconds),
    )
    phone_shared.relaunch_activity(
        run_adb,
        args,
        adb_serial,
        timeout_seconds=max(30, args.command_timeout_seconds),
        settle_seconds=max(0.0, float(args.relaunch_settle_seconds)),
    )
    broker_channel = wait_for_broker_command_channel(
        args,
        timeout_seconds=min(max(15, args.command_timeout_seconds), 60),
    )
    surface = wait_for_live_surface(
        args,
        timeout_seconds=max(20, float(args.surface_timeout_seconds)),
    )
    return {
        "force_stop": {
            "package_name": args.package_name,
            "adb_serial": adb_serial,
            "output": force_stop_output,
        },
        "relaunch": {
            "package_name": args.package_name,
            "activity_name": args.activity_name,
            "adb_serial": adb_serial,
            "settle_seconds": float(args.relaunch_settle_seconds),
        },
        "broker_channel": broker_channel,
        "surface": surface,
    }


def verify_bundle_status(bundle_status: dict[str, Any], remote_manifest: dict[str, Any], local_git: dict[str, object]) -> dict[str, Any]:
    if not bundle_status.get("installed"):
        raise OfficialRefreshError("Target did not report an installed UI bundle")
    expected = {
        "ui_version": remote_manifest["ui_version"],
        "source_commit_full": local_git["head"],
        "source_commit_short": remote_manifest["source_commit_short"],
        "source_branch": "master",
        "source_dirty": False,
    }
    for key, value in expected.items():
        if bundle_status.get(key) != value:
            raise OfficialRefreshError(f"Installed bundle status mismatch for {key}")
    return bundle_status


def load_emulator_evidence(path: Path) -> dict[str, Any]:
    evidence = json.loads(path.read_text(encoding="utf-8"))
    if evidence.get("schema") != RESULT_SCHEMA:
        raise OfficialRefreshError("Emulator evidence schema is invalid")
    return evidence


def load_browser_evidence(path: Path) -> dict[str, Any]:
    evidence = json.loads(path.read_text(encoding="utf-8"))
    if evidence.get("ok") is not True:
        raise OfficialRefreshError("Browser evidence must be green before phone refresh")
    return evidence


def validate_emulator_evidence(
    evidence: dict[str, Any],
    remote_manifest: dict[str, Any],
    local_git: dict[str, object],
) -> dict[str, Any]:
    if (evidence.get("target") or {}).get("type") != "emulator":
        raise OfficialRefreshError("Phone refresh requires emulator evidence")
    if (evidence.get("local_git") or {}).get("head") != local_git["head"]:
        raise OfficialRefreshError("Emulator evidence commit does not match local master HEAD")
    if (evidence.get("remote_manifest") or {}).get("source_commit_full") != local_git["head"]:
        raise OfficialRefreshError("Emulator evidence remote manifest commit does not match local master HEAD")
    if (evidence.get("remote_manifest") or {}).get("ui_version") != remote_manifest["ui_version"]:
        raise OfficialRefreshError("Emulator evidence ui_version does not match current remote manifest")
    bundle_status = evidence.get("bundle_status") or {}
    verify_bundle_status(bundle_status, remote_manifest, local_git)
    return evidence


def validate_browser_evidence(
    evidence: dict[str, Any],
    remote_manifest: dict[str, Any],
    local_git: dict[str, object],
) -> dict[str, Any]:
    browser_commit = str(evidence.get("source_commit_full") or "")
    browser_ui_version = str(evidence.get("ui_version") or "")
    browser_manifest = evidence.get("remote_manifest") or {}
    browser_manifest_commit = str(browser_manifest.get("source_commit_full") or browser_commit)
    browser_manifest_ui_version = str(browser_manifest.get("ui_version") or browser_ui_version)
    if browser_commit != str(local_git["head"]):
        raise OfficialRefreshError("Browser evidence commit does not match local master HEAD")
    if browser_manifest_commit != str(local_git["head"]):
        raise OfficialRefreshError("Browser evidence remote manifest commit does not match local master HEAD")
    if browser_ui_version != str(remote_manifest["ui_version"]):
        raise OfficialRefreshError("Browser evidence ui_version does not match current remote manifest")
    if browser_manifest_ui_version != str(remote_manifest["ui_version"]):
        raise OfficialRefreshError("Browser evidence remote manifest ui_version does not match current remote manifest")
    return evidence


def refresh_target(
    args: argparse.Namespace,
    remote_manifest: dict[str, Any],
    local_git: dict[str, object],
) -> dict[str, Any]:
    broker_channel = wait_for_broker_command_channel(
        args,
        timeout_seconds=min(max(15, args.command_timeout_seconds), 60),
    )
    bundle_install = run_pucky_command_resilient(
        args,
        "ui.bundle.refresh",
        {
            "url": args.bundle_url,
            "max_bytes": args.max_bundle_bytes,
        },
    )
    shell_mode = run_pucky_command_resilient(args, "ui.shell.mode.set", {"mode": "web_cached"})
    bundle_status = run_pucky_command_resilient(args, "ui.bundle.status", {})
    verify_bundle_status(bundle_status, remote_manifest, local_git)
    live_shell = verify_live_shell_after_refresh(args)
    return {
        "broker_channel": broker_channel,
        "bundle_install": bundle_install,
        "shell_mode": shell_mode,
        "bundle_status": bundle_status,
        "live_shell": live_shell,
    }


def build_evidence(
    args: argparse.Namespace,
    local_git: dict[str, object],
    remote_manifest: dict[str, Any],
    refresh_result: dict[str, Any],
    emulator_evidence: dict[str, Any] | None = None,
    browser_evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    evidence: dict[str, Any] = {
        "schema": RESULT_SCHEMA,
        "created_at": utc_stamp(),
        "target": {
            "type": args.target,
            "id": args.device_id,
            "adb_serial": args.adb_serial or args.device_id,
        },
        "bundle_url": args.bundle_url,
        "manifest_url": args.manifest_url,
        "local_git": local_git,
        "remote_manifest": remote_manifest,
        "broker_channel": refresh_result.get("broker_channel", {}),
        "bundle_install": refresh_result["bundle_install"],
        "shell_mode": refresh_result["shell_mode"],
        "bundle_status": refresh_result["bundle_status"],
        "live_shell": refresh_result["live_shell"],
    }
    if emulator_evidence is not None:
        evidence["emulator_evidence"] = {
            "target": emulator_evidence.get("target"),
            "ui_version": (emulator_evidence.get("remote_manifest") or {}).get("ui_version", ""),
            "source_commit_full": (emulator_evidence.get("remote_manifest") or {}).get("source_commit_full", ""),
        }
    if browser_evidence is not None:
        evidence["browser_evidence"] = {
            "schema": browser_evidence.get("schema", ""),
            "ui_version": browser_evidence.get("ui_version", ""),
            "source_commit_full": browser_evidence.get("source_commit_full", ""),
            "refresh_key": browser_evidence.get("refresh_key", ""),
        }
    return evidence


def write_evidence(args: argparse.Namespace, evidence: dict[str, Any]) -> Path:
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    target = args.evidence_dir / f"{args.target}-bundle-refresh-{int(time.time())}.json"
    target.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return target


def run(args: argparse.Namespace) -> dict[str, Any]:
    local_git = require_official_local_repo(args.repo_root, args.canonical_root)
    refresh_key = local_git["head_short"]
    args.manifest_url = cache_busted_url(args.manifest_url, refresh_key)
    args.bundle_url = cache_busted_url(args.bundle_url, refresh_key)
    remote_manifest = validate_remote_manifest(fetch_json(args.manifest_url), local_git)
    emulator_evidence = None
    browser_evidence = None
    if args.target == "phone":
        if args.emulator_evidence is None and args.browser_evidence is None:
            raise OfficialRefreshError("Phone refresh requires --emulator-evidence or --browser-evidence for the same commit and ui_version")
        if args.emulator_evidence is not None:
            emulator_evidence = validate_emulator_evidence(
                load_emulator_evidence(args.emulator_evidence),
                remote_manifest,
                local_git,
            )
        if args.browser_evidence is not None:
            browser_evidence = validate_browser_evidence(
                load_browser_evidence(args.browser_evidence),
                remote_manifest,
                local_git,
            )
    refresh_result = refresh_target(args, remote_manifest, local_git)
    evidence = build_evidence(args, local_git, remote_manifest, refresh_result, emulator_evidence, browser_evidence)
    evidence_path = write_evidence(args, evidence)
    return {
        "ok": True,
        "evidence_path": str(evidence_path),
        "ui_version": remote_manifest["ui_version"],
        "source_commit_full": local_git["head"],
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    root = repo_root()
    parser = argparse.ArgumentParser(description="Refresh the cached Pucky HTML bundle through the official VM-backed path.")
    parser.add_argument("--target", choices=("emulator", "phone"), required=True)
    parser.add_argument("--device-id", default=os.environ.get("PUCKY_DEVICE_ID", ""))
    parser.add_argument("--adb-serial", default=os.environ.get("PUCKY_ADB_SERIAL", ""))
    parser.add_argument("--broker", default=os.environ.get("PUCKY_BROKER_URL", DEFAULT_VM_BASE_URL))
    parser.add_argument("--token", default=os.environ.get("PUCKY_OPERATOR_TOKEN") or os.environ.get("PUCKY_API_TOKEN", ""))
    parser.add_argument("--vm-base-url", default=DEFAULT_VM_BASE_URL)
    parser.add_argument("--bundle-url", default="")
    parser.add_argument("--manifest-url", default="")
    parser.add_argument("--emulator-evidence", type=Path)
    parser.add_argument("--browser-evidence", type=Path)
    parser.add_argument("--max-bundle-bytes", type=int, default=10 * 1024 * 1024)
    parser.add_argument("--command-timeout-seconds", type=int, default=120)
    parser.add_argument("--surface-timeout-seconds", type=int, default=60)
    parser.add_argument("--relaunch-settle-seconds", type=float, default=2.0)
    parser.add_argument("--evidence-dir", type=Path, default=root / ".tmp" / "pucky-html-refresh")
    parser.add_argument("--repo-root", type=Path, default=root, help=argparse.SUPPRESS)
    parser.add_argument("--canonical-root", type=Path, default=CANONICAL_REPO_ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--puckyctl", type=Path, default=root / "pucky-apk" / "puckyctl" / "puckyctl.py", help=argparse.SUPPRESS)
    parser.add_argument("--adb", type=Path, default=DEFAULT_ADB, help=argparse.SUPPRESS)
    parser.add_argument("--package-name", default=DEFAULT_PACKAGE_NAME, help=argparse.SUPPRESS)
    parser.add_argument("--activity-name", default=DEFAULT_ACTIVITY_NAME, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    args.repo_root = args.repo_root.resolve()
    args.canonical_root = args.canonical_root.resolve()
    args.puckyctl = args.puckyctl.resolve()
    args.adb = args.adb.resolve()
    if not args.device_id:
        raise OfficialRefreshError("Official HTML refresh requires --device-id or PUCKY_DEVICE_ID")
    args.vm_base_url = args.vm_base_url.rstrip("/")
    args.bundle_url = args.bundle_url or urljoin(args.vm_base_url + "/", DEFAULT_BUNDLE_PATH.lstrip("/"))
    args.manifest_url = args.manifest_url or urljoin(args.vm_base_url + "/", DEFAULT_MANIFEST_PATH.lstrip("/"))
    return args


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        result = run(args)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
