from __future__ import annotations

import shlex
import textwrap
from pathlib import Path


def vm_thread_query_command(
    *,
    flyctl: Path,
    fly_app: str,
    vm_codex_home: str,
    thread_id: str,
) -> list[str]:
    query = textwrap.dedent(
        f"""
        import json, pathlib, sqlite3
        db = pathlib.Path({vm_codex_home!r}) / "state_5.sqlite"
        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT id, title, rollout_path, source, model, model_provider, reasoning_effort, sandbox_policy, approval_mode FROM threads WHERE id = ?",
            ({thread_id!r},),
        ).fetchone()
        conn.close()
        out = dict(row) if row else {{}}
        rollout = pathlib.Path(str(out.get("rollout_path") or ""))
        out["rollout_exists"] = rollout.exists() if str(out.get("rollout_path") or "") else False
        print(json.dumps(out))
        """
    ).strip()
    return [
        str(flyctl),
        "ssh",
        "console",
        "-a",
        fly_app,
        "--command",
        f"python3 -c {shlex.quote(query)}",
    ]


def official_refresh_command(
    *,
    python_executable: str,
    root: Path,
    device_id: str,
    broker_url: str,
    vm_base_url: str,
    refresh_timeout_seconds: int,
    operator_token: str | None = None,
) -> list[str]:
    command = [
        python_executable,
        str(root / "tools" / "refresh_pucky_html_official.py"),
        "--target",
        "emulator",
        "--device-id",
        device_id,
        "--broker",
        broker_url,
        "--repo-root",
        str(root),
        "--vm-base-url",
        vm_base_url,
        "--command-timeout-seconds",
        str(refresh_timeout_seconds),
    ]
    if operator_token:
        command += ["--token", operator_token]
    return command
