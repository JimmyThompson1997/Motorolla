from __future__ import annotations

import argparse
import base64
import json
import shlex
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path


DEFAULT_APP = "pucky"
DEFAULT_REMOTE_ROOT = "/data/pucky-src"


def resolve_flyctl(explicit: str) -> str:
    clean = str(explicit or "").strip()
    if clean:
        return clean
    discovered = shutil.which("flyctl")
    if discovered:
        return discovered
    fallback = Path.home() / ".fly" / "bin" / "flyctl"
    if fallback.exists():
        return str(fallback)
    raise SystemExit("Could not find flyctl. Set --flyctl or install Fly CLI.")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed one authenticated proof artifact into the live workspace feed store.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--artifact-id", required=True)
    parser.add_argument("--file-name", required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--turn-id", required=True)
    parser.add_argument("--workspace-id", default="")
    parser.add_argument("--app", default=DEFAULT_APP)
    parser.add_argument("--flyctl", default="")
    parser.add_argument("--remote-root", default=DEFAULT_REMOTE_ROOT)
    return parser.parse_args(argv)


def remote_python(payload_b64: str, remote_root: str) -> str:
    return textwrap.dedent(
        f"""
        import base64
        import json
        import sqlite3
        import time
        from pathlib import Path

        from pucky_vm.feed_store import FeedStore

        payload = json.loads(base64.b64decode({payload_b64!r}).decode("utf-8"))
        root = Path({remote_root!r})
        auth_path = root / "pucky_auth.sqlite3"
        email = str(payload.get("email") or "").strip().lower()
        artifact_id = str(payload.get("artifact_id") or "").strip()
        turn_id = str(payload.get("turn_id") or "").strip()
        workspace_id = str(payload.get("workspace_id") or "").strip()
        if not artifact_id or not turn_id:
            raise SystemExit("seed_payload_required_fields_missing")
        if not workspace_id:
            if not email:
                raise SystemExit("seed_email_or_workspace_id_required")
            conn = sqlite3.connect(str(auth_path))
            try:
                row = conn.execute(
                    "SELECT workspace_id FROM auth_bindings WHERE lower(primary_email) = ? LIMIT 1",
                    (email,),
                ).fetchone()
                if row is None or not str(row[0] or "").strip():
                    row = conn.execute(
                        "SELECT workspace_id FROM sessions WHERE lower(email) = ? ORDER BY id DESC LIMIT 1",
                        (email,),
                    ).fetchone()
                if row is None or not str(row[0] or "").strip():
                    row = conn.execute(
                        "SELECT workspace_id FROM workspaces WHERE lower(email) = ? LIMIT 1",
                        (email,),
                    ).fetchone()
            finally:
                conn.close()
            if row is None or not str(row[0] or "").strip():
                raise SystemExit(f"workspace_binding_not_found:{{email}}")
            workspace_id = str(row[0]).strip()
        if workspace_id == "default":
            feed_path = root / "pucky_feed.sqlite3"
        else:
            feed_path = root / "pucky_workspaces" / workspace_id / "feed.sqlite3"

        store = FeedStore(str(feed_path))
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        stamp_ms = int(time.time() * 1000)
        content = str(payload.get("text") or "").encode("utf-8")
        content_base64 = base64.b64encode(content).decode("utf-8")
        store._upsert_artifact(
            artifact_id=artifact_id,
            card_id=f"pucky_card_{{turn_id}}",
            kind="attachment",
            mime_type="text/plain",
            content_base64=content_base64,
            created_at=stamp,
            updated_at=stamp,
            updated_at_ms=stamp_ms,
        )
        store._conn.commit()
        store._conn.close()
        print(artifact_id)
        """
    ).strip()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(list(argv or sys.argv[1:]))
    payload = {
        "artifact_id": str(args.artifact_id or "").strip(),
        "email": str(args.email or "").strip().lower(),
        "file_name": str(args.file_name or "").strip(),
        "text": str(args.text or ""),
        "turn_id": str(args.turn_id or "").strip(),
        "workspace_id": str(args.workspace_id or "").strip(),
    }
    payload_b64 = base64.b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
    remote_code_b64 = base64.b64encode(remote_python(payload_b64, str(args.remote_root or DEFAULT_REMOTE_ROOT)).encode("utf-8")).decode("ascii")
    remote_shell = (
        f"cd {shlex.quote(str(args.remote_root or DEFAULT_REMOTE_ROOT))} "
        f"&& python3 -c 'import base64; exec(base64.b64decode(\"{remote_code_b64}\").decode(\"utf-8\"))'"
    )
    completed = subprocess.run(
        [
            resolve_flyctl(str(args.flyctl or "")),
            "ssh",
            "console",
            "-a",
            str(args.app or DEFAULT_APP),
            "--command",
            f"sh -lc {shlex.quote(remote_shell)}",
        ],
        text=True,
        capture_output=True,
        timeout=90,
    )
    stdout = str(completed.stdout or "").strip()
    stderr = str(completed.stderr or "").strip()
    if completed.returncode != 0:
        detail = stderr or stdout or "unknown_remote_seed_failure"
        raise SystemExit(f"Remote artifact seed failed ({completed.returncode}): {detail}")
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    if not lines:
        raise SystemExit("Remote artifact seed did not return an artifact id.")
    print(lines[-1])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
