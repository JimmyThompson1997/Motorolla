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
LOCAL_INBOX_MEDIA_PROOF_SERVER = [
    PYTHON,
    "tools/proofs/cover/cover_inbox_media_proof_server.py",
    "--host",
    "127.0.0.1",
    "--port",
    "8768",
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
    "proof-local-web": "Boot local proof servers, then run workspace, inbox audio truth, and native-port browser proofs.",
    "proof-local-notes-flash": "Boot the local workspace proof server, then run the targeted notes flash browser proof.",
    "proof-live-web": "Run live user session, inbox audio truth, and native-port browser proofs against the current base URL env/default.",
    "proof-live-notes-flash": "Run the live targeted notes flash browser proof against the current base URL env/default.",
    "deploy-vm": "Sync the pushed master commit onto the live Fly VM and verify the served manifest.",
    "deploy-apk": "Invoke the canonical APK deploy gate through PowerShell when available.",
    "refresh-links-catalog": "Refresh the generated links catalog fixture used by the hosted UI bundle.",
    "lint": "Run the conservative Ruff check configured in pyproject.toml.",
}


def has_arg(args: list[str], option: str) -> bool:
    return option in args


def maybe_with_default(args: list[str], option: str, default_value: str) -> list[str]:
    if has_arg(args, option):
        return args
    return args + [option, default_value]


def run_node_proofs(node_binary: str, scripts: list[tuple[str, list[str]]], env: dict[str, str]) -> int:
    for script, extra_args in scripts:
        status = run_command(
            [
                node_binary,
                script,
                *extra_args,
            ],
            env=env,
        )
        if status:
            return status
    return 0


def stop_servers(servers: list[subprocess.Popen[bytes]]) -> None:
    for server in servers:
        if server.poll() is not None:
            continue
        server.terminate()


def run_server(command: list[str]) -> subprocess.Popen:
    return subprocess.Popen(
        command,
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=proof_env(),
    )


def wait_for_api(url: str) -> None:
    wait_for_http(url)


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


def run_local_workspace_proof(script_path: str, extra_args: list[str], *, include_inbox_media: bool = False) -> int:
    node_binary = require_binary("node")
    env = proof_env()
    env.setdefault("PUCKY_WEB_UI_TOKEN", "proof-token")
    local_light_url = "http://127.0.0.1:8768/ui/pucky/latest/?theme=light&reset_nav=1"
    local_dark_feed_url = "http://127.0.0.1:8768/ui/pucky/latest/?theme=dark&route=inbox&reset_nav=1"
    local_dark_meetings_url = "http://127.0.0.1:8768/ui/pucky/latest/?theme=dark&route=meetings&reset_nav=1"
    servers = [run_server(LOCAL_PROOF_SERVER)]
    if include_inbox_media:
        servers.append(run_server(LOCAL_INBOX_MEDIA_PROOF_SERVER))
    try:
        wait_for_api("http://127.0.0.1:8767/healthz")
        if include_inbox_media:
            wait_for_api("http://127.0.0.1:8768/healthz")
        scripts: list[tuple[str, list[str]]] = []
        if include_inbox_media:
            scripts.extend(
                [
                    (
                        "tools/proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs",
                        maybe_with_default(
                            [
                                "--page-url",
                                "http://127.0.0.1:8768/ui/pucky/latest/?theme=light&route=inbox&reset_nav=1",
                                "--report-dir",
                                str((ROOT / ".tmp" / "proof-local-web" / "inbox-audio-light").resolve()),
                                "--skip-canonical-check",
                                *extra_args,
                            ],
                            "--page-url",
                            "http://127.0.0.1:8768/ui/pucky/latest/?theme=light&route=inbox&reset_nav=1",
                        ),
                    ),
                    (
                        "tools/proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs",
                        maybe_with_default(
                            [
                                "--page-url",
                                "http://127.0.0.1:8768/ui/pucky/latest/?theme=dark&route=inbox&reset_nav=1",
                                "--report-dir",
                                str((ROOT / ".tmp" / "proof-local-web" / "inbox-audio-dark").resolve()),
                                "--skip-canonical-check",
                                *extra_args,
                            ],
                            "--page-url",
                            "http://127.0.0.1:8768/ui/pucky/latest/?theme=dark&route=inbox&reset_nav=1",
                        ),
                    ),
                    (
                        "tools/proofs/cover/cover_light_native_ports_playwright.mjs",
                        maybe_with_default(
                            maybe_with_default(
                                maybe_with_default(
                                    maybe_with_default(
                                        [
                                            "--report-dir",
                                            str((ROOT / ".tmp" / "proof-local-web" / "light-native-ports").resolve()),
                                            *extra_args,
                                        ],
                                        "--light-url",
                                        local_light_url,
                                    ),
                                    "--dark-feed-url",
                                    local_dark_feed_url,
                                ),
                                "--dark-meetings-url",
                                local_dark_meetings_url,
                            ),
                            "--timeout-ms",
                            "30000",
                        ),
                    ),
                ]
            )
        scripts.append(
            (
                script_path,
                [
                    "--base-url",
                    "http://127.0.0.1:8767",
                    "--api-token",
                    "proof-token",
                    *extra_args,
                ],
            )
        )
        return run_node_proofs(
            node_binary,
            scripts,
            env=env,
        )
    finally:
        stop_servers(servers)
        for server in servers:
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:  # pragma: no cover - defensive cleanup
                server.kill()
                server.wait(timeout=5)


def run_local_web_proof(extra_args: list[str]) -> int:
    return run_local_workspace_proof(
        "tools/proofs/cover/cover_workspace_apps_playwright.mjs",
        extra_args,
        include_inbox_media=True,
    )


def run_local_notes_flash_proof(extra_args: list[str]) -> int:
    return run_local_workspace_proof("tools/proofs/cover/cover_notes_detail_flash_playwright.mjs", extra_args)


def run_live_web_proof(extra_args: list[str]) -> int:
    node_binary = require_binary("node")
    return run_node_proofs(
        node_binary,
        [
            (
                "tools/proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs",
                maybe_with_default(
                    [
                        "--report-dir",
                        str((ROOT / ".tmp" / "proof-live-web" / "inbox-audio-light").resolve()),
                        *extra_args,
                    ],
                    "--page-url",
                    "https://pucky.fly.dev/ui/pucky/latest/?theme=light&route=inbox&reset_nav=1",
                ),
            ),
            (
                "tools/proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs",
                maybe_with_default(
                    [
                        "--report-dir",
                        str((ROOT / ".tmp" / "proof-live-web" / "inbox-audio-dark").resolve()),
                        *extra_args,
                    ],
                    "--page-url",
                    "https://pucky.fly.dev/ui/pucky/latest/?theme=dark&route=inbox&reset_nav=1",
                ),
            ),
            ("tools/proofs/cover/cover_light_native_ports_playwright.mjs", extra_args),
            ("tools/proofs/cover/cover_live_user_session_playwright.mjs", extra_args),
        ],
        env=proof_env(),
    )


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
