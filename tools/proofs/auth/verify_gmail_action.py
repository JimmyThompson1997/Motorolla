from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.auth_store import AuthStore  # noqa: E402
from pucky_vm.composio import ComposioClient  # noqa: E402


RESULT_SCHEMA = "pucky.composio_gmail_verify.v1"


def env_value(*names: str) -> str:
    for name in names:
        value = str(os.environ.get(name, "")).strip()
        if value:
            return value
    return ""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify a Gmail action result by fetching the first returned message by id.")
    parser.add_argument("--result-json-path", required=True)
    parser.add_argument("--connection-id", required=True)
    parser.add_argument("--user-email", required=True)
    parser.add_argument("--user-id", default="")
    parser.add_argument(
        "--auth-db-path",
        default=str((ROOT / ".tmp" / "auth-proof-helper" / "pucky_auth.sqlite3").resolve()),
    )
    parser.add_argument("--composio-api-key", default=env_value("COMPOSIO_API_KEY"))
    return parser.parse_args(argv)


def workspace_principal(email: str, auth_db_path: str) -> str:
    store = AuthStore(auth_db_path)
    workspace_id = str(store.ensure_user_workspace(email)["workspace_id"] or "").strip()
    return f"ws_{workspace_id.removeprefix('ws_')}"


def payload_dict(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def first_message_id(payload: dict[str, object]) -> str:
    candidates = []
    data = payload_dict(payload.get("data"))
    result = payload_dict(data.get("result"))
    candidates.append(result)
    candidates.append(payload_dict(result.get("data")))
    candidates.append(payload_dict(payload_dict(result.get("data")).get("data")))
    for candidate in candidates:
        messages = candidate.get("messages")
        if isinstance(messages, list):
            for item in messages:
                if not isinstance(item, dict):
                    continue
                for key in ("id", "messageId", "message_id"):
                    value = str(item.get(key) or "").strip()
                    if value:
                        return value
    return ""


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    api_key = str(args.composio_api_key or "").strip()
    if not api_key:
        raise SystemExit("Missing COMPOSIO_API_KEY / --composio-api-key")
    payload = json.loads(Path(args.result_json_path).read_text(encoding="utf-8"))
    message_id = first_message_id(payload)
    if not message_id:
        raise SystemExit("Could not extract a Gmail message id from the action result.")
    client = ComposioClient(api_key=api_key)
    user_id = str(args.user_id or "").strip() or workspace_principal(args.user_email, args.auth_db_path)
    result = client.execute_tool(
        tool_slug="GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
        connected_account_id=str(args.connection_id or "").strip(),
        user_id=user_id,
        arguments={"message_id": message_id, "format": "metadata"},
    )
    summary = {
        "schema": RESULT_SCHEMA,
        "ok": bool(result.get("successful", True)) and not result.get("error"),
        "user_id": user_id,
        "connection_id": str(args.connection_id or "").strip(),
        "message_id": message_id,
        "result": result,
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if summary["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
