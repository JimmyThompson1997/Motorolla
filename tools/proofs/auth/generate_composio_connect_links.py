from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.auth_store import AuthStore  # noqa: E402
from pucky_vm.composio import ComposioClient  # noqa: E402


RESULT_SCHEMA = "pucky.composio_connect_link_bundle.v1"


def env_value(*names: str) -> str:
    for name in names:
        value = str(os.environ.get(name, "")).strip()
        if value:
            return value
    return ""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate Composio Connect links for one or more workspace principals using the same email-to-workspace mapping as the auth surface."
    )
    parser.add_argument("--email", dest="emails", action="append", required=True)
    parser.add_argument("--app-slug", dest="app_slugs", action="append", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument(
        "--auth-db-path",
        default=str((ROOT / ".tmp" / "auth-proof-helper" / "pucky_auth.sqlite3").resolve()),
    )
    parser.add_argument("--output", default="")
    parser.add_argument("--composio-api-key", default=env_value("COMPOSIO_API_KEY"))
    return parser.parse_args(argv)


def ensure_identity(store: AuthStore, email: str) -> dict[str, str]:
    identity = store.ensure_user_workspace(email)
    workspace_id = str(identity["workspace_id"] or "").strip()
    return {
        "email": str(identity["email"] or "").strip(),
        "user_id": str(identity["user_id"] or "").strip(),
        "workspace_id": workspace_id,
        "workspace_slug": str(identity["workspace_slug"] or "").strip(),
        "composio_user_id": f"ws_{workspace_id.removeprefix('ws_')}",
    }


def callback_url(base_url: str, *, email: str, app_slug: str) -> str:
    return (
        f"{str(base_url or '').rstrip('/')}/ui/pucky/latest/"
        f"?route=connect&seed=1&email={quote(email, safe='')}&app={quote(app_slug, safe='')}"
    )


def run(args: argparse.Namespace) -> dict[str, object]:
    api_key = str(args.composio_api_key or "").strip()
    if not api_key:
        raise SystemExit("Missing COMPOSIO_API_KEY / --composio-api-key")
    store = AuthStore(args.auth_db_path)
    client = ComposioClient(api_key=api_key)
    bundle: dict[str, object] = {
        "schema": RESULT_SCHEMA,
        "base_url": str(args.base_url or "").rstrip("/"),
        "auth_db_path": str(Path(args.auth_db_path).expanduser().resolve()),
        "rows": [],
    }
    for raw_email in args.emails:
        identity = ensure_identity(store, raw_email)
        for raw_slug in args.app_slugs:
            app_slug = str(raw_slug or "").strip().lower()
            if not app_slug:
                continue
            result = client.start_oauth(
                identity["composio_user_id"],
                app_slug,
                callback_url(bundle["base_url"], email=identity["email"], app_slug=app_slug),
            )
            row = {
                **identity,
                "app_slug": app_slug,
                "callback_url": callback_url(bundle["base_url"], email=identity["email"], app_slug=app_slug),
                "ok": bool(result.get("ok")),
                "connection_id": str(result.get("connection_id") or ""),
                "auth_url": str(result.get("auth_url") or result.get("redirect_url") or ""),
                "error": str(result.get("error") or ""),
            }
            bundle["rows"].append(row)
    return bundle


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    bundle = run(args)
    payload = json.dumps(bundle, indent=2, sort_keys=True) + "\n"
    if args.output:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(payload, encoding="utf-8")
    sys.stdout.write(payload)
    failures = [row for row in list(bundle.get("rows") or []) if not bool(row.get("ok"))]
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
