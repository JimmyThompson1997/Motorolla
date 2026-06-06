from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import tools.refresh_pucky_html_official as official_html


DEFAULT_FLY_APP = "pucky"
DEFAULT_VM_REPO_PATH = "/data/pucky-src"
RESULT_SCHEMA = "pucky.vm_sync_evidence.v1"
IGNORABLE_FLY_STDERR_PREFIXES = (
    "Connecting to ",
    "Your branch is up to date with ",
    "Your branch is behind ",
    "(use \"git pull\"",
    "Already on ",
    "Already up to date.",
    "From ",
    "* branch",
    "Updating ",
    "Fast-forward",
    "Warning: Metrics token unavailable:",
    "Error: The handle is invalid.",
)


class OfficialVmSyncError(RuntimeError):
    pass


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def utc_stamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def build_remote_sync_shell_command(vm_repo_path: str) -> str:
    inner = " && ".join(
        [
            f"cd {shlex.quote(vm_repo_path)}",
            "git fetch origin",
            "git checkout master",
            "git pull --ff-only origin master",
            "git rev-parse HEAD",
        ]
    )
    return f"sh -lc {shlex.quote(inner)}"


def fly_ssh_command(*, flyctl: Path, app: str, remote_command: str) -> list[str]:
    return [
        str(flyctl),
        "ssh",
        "console",
        "-a",
        app,
        "--command",
        remote_command,
    ]


def run_subprocess(
    argv: list[str],
    *,
    cwd: Path,
    timeout_seconds: int | float,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        cwd=cwd,
        text=True,
        capture_output=True,
        timeout=timeout_seconds,
    )


def run_fly_command(
    args: argparse.Namespace,
    command: list[str],
    *,
    timeout_seconds: int | float,
    allow_ignorable_stderr: bool = False,
) -> dict[str, Any]:
    completed = run_subprocess(command, cwd=args.repo_root, timeout_seconds=timeout_seconds)
    payload = {
        "command": command,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }
    if completed.returncode != 0 and not (
        allow_ignorable_stderr and has_only_ignorable_fly_stderr(completed.stderr)
    ):
        combined = "\n".join(part for part in (completed.stdout, completed.stderr) if part.strip())
        raise OfficialVmSyncError(f"Fly command failed: {combined or 'unknown flyctl failure'}")
    return payload


def has_only_ignorable_fly_stderr(stderr_text: str) -> bool:
    lines = [line.strip() for line in str(stderr_text or "").splitlines() if line.strip()]
    if not lines:
        return False
    return all(any(line.startswith(prefix) for prefix in IGNORABLE_FLY_STDERR_PREFIXES) for line in lines)


def parse_machine_list(stdout: str) -> list[dict[str, Any]]:
    parsed = json.loads(stdout or "[]")
    if not isinstance(parsed, list):
        raise OfficialVmSyncError("flyctl machine list did not return a JSON list")
    machines = [item for item in parsed if isinstance(item, dict)]
    if not machines:
        raise OfficialVmSyncError("No Fly machines were returned for the app")
    return machines


def choose_machine_id(machine_list_stdout: str) -> str:
    machines = parse_machine_list(machine_list_stdout)
    for machine in machines:
        machine_id = str(machine.get("id") or "").strip()
        state = str(machine.get("state") or machine.get("status") or "").lower()
        if machine_id and state in {"started", "running"}:
            return machine_id
    for machine in machines:
        machine_id = str(machine.get("id") or "").strip()
        if machine_id:
            return machine_id
    raise OfficialVmSyncError("Unable to choose a Fly machine id")


def sync_vm_source(args: argparse.Namespace) -> dict[str, Any]:
    remote_command = build_remote_sync_shell_command(args.vm_repo_path)
    sync_result = run_fly_command(
        args,
        fly_ssh_command(flyctl=args.flyctl, app=args.app, remote_command=remote_command),
        timeout_seconds=args.sync_timeout_seconds,
        allow_ignorable_stderr=True,
    )
    lines = [line.strip() for line in str(sync_result.get("stdout") or "").splitlines() if line.strip()]
    remote_head = lines[-1] if lines else ""
    if not remote_head:
        raise OfficialVmSyncError("Remote sync did not report a git HEAD")
    return {
        "remote_command": remote_command,
        "result": sync_result,
        "remote_head": remote_head,
    }


def restart_vm_machine(args: argparse.Namespace) -> dict[str, Any]:
    list_command = [str(args.flyctl), "machine", "list", "-a", args.app, "--json"]
    list_result = run_fly_command(args, list_command, timeout_seconds=args.sync_timeout_seconds)
    machine_id = choose_machine_id(str(list_result.get("stdout") or ""))
    restart_command = [str(args.flyctl), "machine", "restart", machine_id, "-a", args.app]
    restart_result = run_fly_command(args, restart_command, timeout_seconds=args.restart_timeout_seconds)
    return {
        "machine_list": list_result,
        "machine_id": machine_id,
        "restart": restart_result,
    }


def wait_for_manifest_match(args: argparse.Namespace, local_git: dict[str, Any]) -> dict[str, Any]:
    manifest_url = official_html.cache_busted_url(args.manifest_url, local_git["head_short"])
    deadline = time.monotonic() + max(1, int(args.manifest_timeout_seconds))
    attempts = 0
    last_error = ""
    last_manifest: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        attempts += 1
        try:
            manifest = official_html.fetch_json(manifest_url)
            last_manifest = manifest
            validated = official_html.validate_remote_manifest(manifest, local_git)
            return {
                "attempts": attempts,
                "manifest_url": manifest_url,
                "manifest": validated,
            }
        except Exception as exc:
            last_error = str(exc)
            time.sleep(max(0.1, float(args.poll_interval_seconds)))
    detail = last_error or "remote manifest never matched the pushed master commit"
    if last_manifest is not None:
        detail = f"{detail}; last manifest ui_version={last_manifest.get('ui_version')} commit={last_manifest.get('source_commit_full')}"
    raise OfficialVmSyncError(f"Timed out waiting for VM manifest match: {detail}")


def build_evidence(
    args: argparse.Namespace,
    local_git: dict[str, Any],
    sync_result: dict[str, Any],
    restart_result: dict[str, Any],
    manifest_result: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema": RESULT_SCHEMA,
        "created_at": utc_stamp(),
        "app": args.app,
        "vm_repo_path": args.vm_repo_path,
        "local_git": local_git,
        "vm_sync": sync_result,
        "machine_restart": restart_result,
        "manifest_check": manifest_result,
    }


def write_evidence(args: argparse.Namespace, evidence: dict[str, Any]) -> Path:
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    target = args.evidence_dir / f"vm-sync-{int(time.time())}.json"
    target.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return target


def run(args: argparse.Namespace) -> dict[str, Any]:
    local_git = official_html.require_official_local_repo(args.repo_root, args.canonical_root)
    sync_result = sync_vm_source(args)
    if sync_result["remote_head"] != local_git["head"]:
        raise OfficialVmSyncError("Remote VM source head does not match local master HEAD after sync")
    restart_result = restart_vm_machine(args)
    manifest_result = wait_for_manifest_match(args, local_git)
    evidence = build_evidence(args, local_git, sync_result, restart_result, manifest_result)
    evidence_path = write_evidence(args, evidence)
    manifest = manifest_result["manifest"]
    return {
        "ok": True,
        "evidence_path": str(evidence_path),
        "ui_version": manifest["ui_version"],
        "source_commit_full": local_git["head"],
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    root = repo_root()
    parser = argparse.ArgumentParser(description="Synchronize the official Fly VM source checkout to pushed canonical master and verify the served manifest.")
    parser.add_argument("--app", default=os.environ.get("PUCKY_FLY_APP", DEFAULT_FLY_APP))
    parser.add_argument("--vm-base-url", default=official_html.DEFAULT_VM_BASE_URL)
    parser.add_argument("--manifest-url", default="")
    parser.add_argument("--vm-repo-path", default=DEFAULT_VM_REPO_PATH)
    parser.add_argument("--sync-timeout-seconds", type=int, default=180)
    parser.add_argument("--restart-timeout-seconds", type=int, default=180)
    parser.add_argument("--manifest-timeout-seconds", type=int, default=240)
    parser.add_argument("--poll-interval-seconds", type=float, default=5.0)
    parser.add_argument("--evidence-dir", type=Path, default=root / ".tmp" / "pucky-vm-sync")
    parser.add_argument("--repo-root", type=Path, default=root, help=argparse.SUPPRESS)
    parser.add_argument("--canonical-root", type=Path, default=official_html.CANONICAL_REPO_ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--flyctl", type=Path, default=Path("flyctl"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    args.repo_root = args.repo_root.resolve()
    args.canonical_root = args.canonical_root.resolve()
    args.vm_base_url = args.vm_base_url.rstrip("/")
    args.manifest_url = args.manifest_url or urljoin(args.vm_base_url + "/", official_html.DEFAULT_MANIFEST_PATH.lstrip("/"))
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
