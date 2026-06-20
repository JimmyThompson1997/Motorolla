from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
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
    "proof-local-notes-flash": "Boot the local workspace proof server, then run the targeted notes flash browser proof.",
    "proof-live-notes-flash": "Run the live targeted notes flash browser proof against the current base URL env/default.",
    "proof-local-notes-flash-browser": "Boot the local workspace proof server and run the v2 Notes fast-twitch browser proof against the current local bundle.",
    "proof-live-notes-flash-browser": "Run the v2 Notes fast-twitch browser proof against the hosted VM with manifest verification.",
    "proof-local-universal-tiles": "Boot the local inbox/media proof server and run the six-route universal feed tile browser proof against the current local bundle.",
    "proof-live-universal-tiles": "Run the six-route universal feed tile browser proof against the hosted VM with screenshots, summaries, trace, and video artifacts.",
    "proof-local-web": "Boot local proof servers, then run workspace, inbox audio truth, and native-port browser proofs.",
    "proof-live-web": "Run live user session, inbox audio truth, native-port, and universal feed tile browser proofs against the current base URL env/default.",
    "qa-hosted-web": "Run the hosted-first bug hunt sweep: baseline proofs, screenshots, findings bundle, and coverage gaps.",
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


def append_refresh_param(url: str, refresh_value: str) -> str:
    if not str(refresh_value or "").strip():
        return url
    parsed = urlsplit(url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["_pucky_refresh"] = str(refresh_value).strip()
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), parsed.fragment))


def current_git_head() -> str:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    return str(completed.stdout or "").strip()


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


def find_free_localhost_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


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
    ensure_cover_playwright_shims()
    env = os.environ.copy()
    if not str(env.get("CODEX_NODE_MODULES") or "").strip():
        for candidate in BUNDLED_NODE_MODULES_CANDIDATES:
            if candidate.is_dir():
                env["CODEX_NODE_MODULES"] = str(candidate)
                break
    return env


def bundled_package_dir(package_name: str) -> Path | None:
    package = str(package_name or "").strip()
    if not package:
        return None
    for candidate in BUNDLED_NODE_MODULES_CANDIDATES:
        direct = candidate / package
        if direct.is_dir():
            return direct
        pnpm_root = candidate / ".pnpm"
        if not pnpm_root.is_dir():
            continue
        for entry in pnpm_root.iterdir():
            if not entry.is_dir() or not entry.name.startswith(package):
                continue
            nested = entry / "node_modules" / package
            if nested.is_dir():
                return nested
    return None


def ensure_cover_playwright_shims() -> None:
    tools_node_modules = ROOT / "tools" / "node_modules"
    tools_node_modules.mkdir(parents=True, exist_ok=True)
    for package_name in ("playwright-core", "playwright"):
        target = bundled_package_dir(package_name)
        if target is None:
            continue
        link_path = tools_node_modules / package_name
        if link_path.exists() or link_path.is_symlink():
            continue
        link_path.symlink_to(target, target_is_directory=True)


def build_local_workspace_proof_server_command(port: int, *, state_dir: Path | None = None) -> list[str]:
    command = [
        PYTHON,
        "tools/proofs/workspace/workspace_apps_proof_server.py",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "--api-token",
        "proof-token",
    ]
    if state_dir is not None:
        command.extend(["--state-dir", str(state_dir.resolve())])
    return command


def run_local_web_proof(extra_args: list[str]) -> int:
    node_binary = require_binary("node")
    env = proof_env()
    local_light_url = "http://127.0.0.1:8768/ui/pucky/latest/?theme=light&reset_nav=1"
    local_dark_feed_url = "http://127.0.0.1:8768/ui/pucky/latest/?theme=dark&route=inbox&reset_nav=1"
    local_dark_meetings_url = "http://127.0.0.1:8768/ui/pucky/latest/?theme=dark&route=meetings&reset_nav=1"
    servers = [
        run_server(LOCAL_PROOF_SERVER),
        run_server(LOCAL_INBOX_MEDIA_PROOF_SERVER),
    ]
    try:
        wait_for_api("http://127.0.0.1:8767/healthz")
        wait_for_api("http://127.0.0.1:8768/healthz")
        return run_node_proofs(
            node_binary,
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
                (
                    "tools/proofs/cover/cover_workspace_apps_playwright.mjs",
                    [
                        "--base-url",
                        "http://127.0.0.1:8767",
                        "--api-token",
                        "proof-token",
                        *extra_args,
                    ],
                ),
            ],
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


def run_local_workspace_proof(
    script: str,
    script_args: list[str],
    extra_args: list[str],
    *,
    server_command: list[str] | None = None,
    health_url: str = "http://127.0.0.1:8767/healthz",
) -> int:
    node_binary = require_binary("node")
    env = proof_env()
    env.setdefault("PUCKY_API_TOKEN", "proof-token")
    env.setdefault("PUCKY_" + "WEB_UI_TOKEN", "proof-token")
    server = run_server(server_command or LOCAL_PROOF_SERVER)
    try:
        wait_for_api(health_url)
        return run_node_proofs(
            node_binary,
            [
                (
                    script,
                    script_args + extra_args,
                ),
            ],
            env=env,
        )
    finally:
        stop_servers([server])
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:  # pragma: no cover - defensive cleanup
            server.kill()
            server.wait(timeout=5)


def run_local_notes_flash_browser_proof(extra_args: list[str]) -> int:
    port = find_free_localhost_port()
    base_url = f"http://127.0.0.1:{port}"
    return run_local_workspace_proof(
        "tools/proofs/cover/cover_notes_detail_flash_playwright.mjs",
        [
            "--base-url",
            base_url,
            "--api-token",
            "proof-token",
            "--report-dir",
            str((ROOT / ".tmp" / "proof-local-notes-flash").resolve()),
        ],
        extra_args,
        server_command=build_local_workspace_proof_server_command(
            port,
            state_dir=ROOT / ".tmp" / "proof-local-notes-flash-browser-state",
        ),
        health_url=f"{base_url}/healthz",
    )


def run_live_notes_flash_browser_proof(extra_args: list[str]) -> int:
    node_binary = require_binary("node")
    return run_node_proofs(
        node_binary,
        [
            (
                "tools/proofs/cover/cover_notes_detail_flash_playwright.mjs",
                [
                    "--report-dir",
                    str((ROOT / ".tmp" / "proof-live-notes-flash").resolve()),
                    *extra_args,
                ],
            ),
        ],
        env=proof_env(),
    )


def run_local_universal_feed_tiles_proof(extra_args: list[str]) -> int:
    return run_local_workspace_proof(
        "tools/proofs/cover/cover_universal_feed_tiles_playwright.mjs",
        [
            "--base-url",
            "http://127.0.0.1:8768",
            "--api-token",
            "proof-token",
            "--report-dir",
            str((ROOT / ".tmp" / "proof-local-universal-tiles").resolve()),
        ],
        extra_args,
        server_command=LOCAL_INBOX_MEDIA_PROOF_SERVER,
        health_url="http://127.0.0.1:8768/healthz",
    )


def run_live_universal_feed_tiles_proof(extra_args: list[str]) -> int:
    node_binary = require_binary("node")
    refresh_seed = current_git_head() or str(int(time.time()))
    base_url = append_refresh_param("https://pucky.fly.dev", refresh_seed)
    return run_node_proofs(
        node_binary,
        [
            (
                "tools/proofs/cover/cover_universal_feed_tiles_playwright.mjs",
                [
                    "--base-url",
                    base_url,
                    "--report-dir",
                    str((ROOT / ".tmp" / "proof-live-universal-tiles").resolve()),
                    *extra_args,
                ],
            ),
        ],
        env=proof_env(),
    )


def run_live_web_proof(extra_args: list[str]) -> int:
    node_binary = require_binary("node")
    refresh_seed = current_git_head() or str(int(time.time()))
    live_root = (ROOT / ".tmp" / "proof-live-web").resolve()
    light_home_url = append_refresh_param(
        "https://pucky.fly.dev/ui/pucky/latest/?theme=light&reset_nav=1",
        refresh_seed,
    )
    light_url = append_refresh_param(
        "https://pucky.fly.dev/ui/pucky/latest/?theme=light&route=inbox&reset_nav=1",
        refresh_seed,
    )
    dark_feed_url = append_refresh_param(
        "https://pucky.fly.dev/ui/pucky/latest/?theme=dark&route=inbox&reset_nav=1",
        refresh_seed,
    )
    dark_meetings_url = append_refresh_param(
        "https://pucky.fly.dev/ui/pucky/latest/?theme=dark&route=meetings&reset_nav=1",
        refresh_seed,
    )
    scripts: list[tuple[str, list[str]]] = []
    for browser_name in ("chromium", "webkit"):
        for attempt in range(1, 4):
            run_name = f"run-{attempt}"
            scripts.extend([
                (
                    "tools/proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs",
                    [
                        "--browser",
                        browser_name,
                        "--page-url",
                        light_url,
                        "--report-dir",
                        str((live_root / "inbox-audio-light" / browser_name / run_name).resolve()),
                        *extra_args,
                    ],
                ),
                (
                    "tools/proofs/cover/cover_inbox_tile_audio_truth_playwright.mjs",
                    [
                        "--browser",
                        browser_name,
                        "--page-url",
                        dark_feed_url,
                        "--report-dir",
                        str((live_root / "inbox-audio-dark" / browser_name / run_name).resolve()),
                        *extra_args,
                    ],
                ),
                (
                    "tools/proofs/cover/cover_light_native_ports_playwright.mjs",
                    [
                        "--browser",
                        browser_name,
                        "--light-url",
                        light_home_url,
                        "--dark-feed-url",
                        dark_feed_url,
                        "--dark-meetings-url",
                        dark_meetings_url,
                        "--report-dir",
                        str((live_root / "light-native-ports" / browser_name / run_name).resolve()),
                        *extra_args,
                    ],
                ),
            ])
    scripts.append(
        (
            "tools/proofs/cover/cover_universal_feed_tiles_playwright.mjs",
            [
                "--base-url",
                append_refresh_param("https://pucky.fly.dev", refresh_seed),
                "--report-dir",
                str((live_root / "universal-feed-tiles").resolve()),
                *extra_args,
            ],
        )
    )
    scripts.append(
        (
            "tools/proofs/cover/cover_live_user_session_playwright.mjs",
            [
                "--report-dir",
                str((live_root / "live-user-session").resolve()),
                *extra_args,
            ],
        )
    )
    return run_node_proofs(
        node_binary,
        scripts,
        env=proof_env(),
    )


def run_hosted_bug_hunt(extra_args: list[str]) -> int:
    node_binary = require_binary("node")
    return run_node_proofs(
        node_binary,
        [
            ("tools/proofs/cover/cover_hosted_bug_hunt_playwright.mjs", extra_args),
        ],
        env=proof_env(),
    )


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
    if args.task in ("proof-local-notes-flash", "proof-local-notes-flash-browser"):
        return run_local_notes_flash_browser_proof(args.extra_args)
    if args.task in ("proof-live-notes-flash", "proof-live-notes-flash-browser"):
        return run_live_notes_flash_browser_proof(args.extra_args)
    if args.task == "proof-local-universal-tiles":
        return run_local_universal_feed_tiles_proof(args.extra_args)
    if args.task == "proof-live-universal-tiles":
        return run_live_universal_feed_tiles_proof(args.extra_args)
    if args.task == "proof-local-web":
        return run_local_web_proof(args.extra_args)
    if args.task == "proof-live-web":
        return run_live_web_proof(args.extra_args)
    if args.task == "qa-hosted-web":
        return run_hosted_bug_hunt(args.extra_args)
    return run_command(build_task_command(args.task) + args.extra_args)


if __name__ == "__main__":
    raise SystemExit(main())
