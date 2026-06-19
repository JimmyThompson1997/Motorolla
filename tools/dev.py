from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
PYTHON = sys.executable

FAST_TEST_PATHS = [
    "pucky_vm/tests/test_action_ledger.py",
    "pucky_vm/tests/test_base_instructions.py",
    "pucky_vm/tests/test_broker_consolidation_repo_shape.py",
    "pucky_vm/tests/test_html_cover_ui_spec.py",
    "pucky_vm/tests/test_http_surface.py",
    "pucky_vm/tests/test_server.py",
    "pucky_vm/tests/test_ui_bundle.py",
    "pucky_vm/tests/test_workspace_store.py",
    "tools/tests",
]
FULL_TEST_PATHS = [
    "pucky_vm/tests",
    "pucky-apk/puckyctl/test_puckyctl.py",
    "tools/tests",
]
LOCAL_PROOF_SERVER = [
    PYTHON,
    "tools/proofs/workspace/workspace_apps_proof_server.py",
    "--host",
    "127.0.0.1",
    "--port",
    "8767",
    "--api-token",
    "proof-token",
]
BUNDLED_NODE_CANDIDATES = [
    Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin" / "node",
]
BUNDLED_NODE_MODULES_CANDIDATES = [
    Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "node_modules",
]
TASK_HELP = {
    "test-fast": "Run the fast unit and contract suite plus canonical tool tests.",
    "test-full": "Run the full Python suite for VM, tooling, and puckyctl.",
    "proof-local-web": "Boot the local workspace proof server, then run the hosted UI browser proof.",
    "proof-local-notes-flash": "Boot the local workspace proof server, then run the targeted notes flash browser proof.",
    "proof-live-web": "Run the live hosted UI browser proof against the current base URL env/default.",
    "proof-live-notes-flash": "Run the live targeted notes flash browser proof against the current base URL env/default.",
    "deploy-vm": "Sync the pushed master commit onto the live Fly VM and verify the served manifest.",
    "deploy-apk": "Invoke the canonical APK deploy gate through PowerShell when available.",
    "refresh-links-catalog": "Refresh the generated links catalog fixture used by the hosted UI bundle.",
    "lint": "Run the conservative Ruff check configured in pyproject.toml.",
}


def run_command(argv: list[str], *, env: dict[str, str] | None = None) -> int:
    completed = subprocess.run(argv, cwd=ROOT, env=env)
    return int(completed.returncode)


def require_binary(name: str) -> str:
    path = shutil.which(name)
    if path:
        return path
    if name == "node":
        for candidate in BUNDLED_NODE_CANDIDATES:
            if candidate.is_file():
                return str(candidate)
    raise SystemExit(f"Missing required executable: {name}")


def wait_for_http(url: str, *, timeout_seconds: float = 20.0) -> None:
    deadline = time.monotonic() + max(1.0, timeout_seconds)
    last_error = ""
    while time.monotonic() < deadline:
        try:
            with urlopen(url, timeout=2) as response:
                if 200 <= int(getattr(response, "status", 0) or 0) < 500:
                    return
        except Exception as exc:  # pragma: no cover - exercised in integration
            last_error = str(exc)
        time.sleep(0.25)
    raise SystemExit(f"Timed out waiting for local proof server at {url}: {last_error or 'unreachable'}")


def proof_env() -> dict[str, str]:
    env = os.environ.copy()
    if not str(env.get("CODEX_NODE_MODULES") or "").strip():
        for candidate in BUNDLED_NODE_MODULES_CANDIDATES:
            if candidate.is_dir():
                env["CODEX_NODE_MODULES"] = str(candidate)
                break
    return env


def run_local_workspace_proof(script_path: str, extra_args: list[str]) -> int:
    node_binary = require_binary("node")
    env = proof_env()
    server = subprocess.Popen(
        LOCAL_PROOF_SERVER,
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=env,
    )
    try:
        wait_for_http("http://127.0.0.1:8767/healthz")
        return run_command(
            [
                node_binary,
                script_path,
                "--base-url",
                "http://127.0.0.1:8767",
                "--api-token",
                "proof-token",
                *extra_args,
            ],
            env=env,
        )
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:  # pragma: no cover - defensive cleanup
            server.kill()
            server.wait(timeout=5)


def run_local_web_proof(extra_args: list[str]) -> int:
    return run_local_workspace_proof("tools/proofs/cover/cover_workspace_apps_playwright.mjs", extra_args)


def run_local_notes_flash_proof(extra_args: list[str]) -> int:
    return run_local_workspace_proof("tools/proofs/cover/cover_notes_detail_flash_playwright.mjs", extra_args)


def run_live_web_proof(extra_args: list[str]) -> int:
    node_binary = require_binary("node")
    return run_command([node_binary, "tools/proofs/cover/cover_live_user_session_playwright.mjs", *extra_args], env=proof_env())


def run_live_notes_flash_proof(extra_args: list[str]) -> int:
    node_binary = require_binary("node")
    return run_command([node_binary, "tools/proofs/cover/cover_notes_detail_flash_playwright.mjs", *extra_args], env=proof_env())


def powershell_command() -> list[str]:
    for candidate in ("pwsh", "powershell"):
        path = shutil.which(candidate)
        if path:
            if candidate == "pwsh":
                return [path, "-File", "tools/deploy-canonical-apk.ps1"]
            return [path, "-ExecutionPolicy", "Bypass", "-File", "tools/deploy-canonical-apk.ps1"]
    raise SystemExit("PowerShell is required for deploy-apk but neither pwsh nor powershell was found.")


def build_task_command(task: str) -> list[str]:
    if task == "test-fast":
        return [PYTHON, "-m", "pytest", "-q", *FAST_TEST_PATHS]
    if task == "test-full":
        return [PYTHON, "-m", "pytest", "-q", *FULL_TEST_PATHS]
    if task == "deploy-vm":
        return [PYTHON, "tools/sync_pucky_vm_official.py", "--app", "pucky"]
    if task == "deploy-apk":
        return powershell_command()
    if task == "refresh-links-catalog":
        return [PYTHON, "tools/refresh_links_catalog_snapshot.py"]
    if task == "lint":
        return [PYTHON, "-m", "ruff", "check", "pucky_vm", "tools"]
    raise SystemExit(f"Unknown task: {task}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Canonical developer task runner for the Pucky repo.")
    parser.add_argument("task", choices=sorted(TASK_HELP))
    parser.add_argument("extra_args", nargs=argparse.REMAINDER)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if args.task == "proof-local-web":
        return run_local_web_proof(args.extra_args)
    if args.task == "proof-local-notes-flash":
        return run_local_notes_flash_proof(args.extra_args)
    if args.task == "proof-live-web":
        return run_live_web_proof(args.extra_args)
    if args.task == "proof-live-notes-flash":
        return run_live_notes_flash_proof(args.extra_args)
    return run_command(build_task_command(args.task) + args.extra_args)


if __name__ == "__main__":
    raise SystemExit(main())
