from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.server import Config, PuckyVoiceService, compose_pucky_base_instructions  # noqa: E402


def _payload_data(payload: dict[str, Any]) -> dict[str, Any]:
    for key in ("data", "response_data", "result"):
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    return payload


def _first_message_id(payload: dict[str, Any]) -> str:
    data = _payload_data(payload)
    messages = data.get("messages")
    if isinstance(messages, list):
        for item in messages:
            if isinstance(item, dict) and str(item.get("id") or "").strip():
                return str(item.get("id")).strip()
    return ""


def _metadata_summary(payload: dict[str, Any]) -> dict[str, str]:
    data = _payload_data(payload)
    headers = (((data.get("payload") or {}).get("headers") or []) if isinstance(data.get("payload"), dict) else [])
    out = {"subject": "", "from": "", "date": "", "snippet": str(data.get("snippet") or "")[:240]}
    if isinstance(headers, list):
        for header in headers:
            if not isinstance(header, dict):
                continue
            name = str(header.get("name") or "").strip().lower()
            if name in {"subject", "from", "date"}:
                out[name] = str(header.get("value") or "")[:240]
    return out


def run_smoke(compiled_output: str = "") -> dict[str, Any]:
    service = PuckyVoiceService(Config.from_env())
    context = service._base_runtime_context()
    composio = context.get("composio") if isinstance(context.get("composio"), dict) else {}
    gmail = next(
        (
            item for item in list(composio.get("connected_apps") or [])
            if isinstance(item, dict) and str(item.get("slug") or "").lower() == "gmail"
        ),
        None,
    )
    if not gmail:
        raise RuntimeError("Gmail is not an active connected Composio app")
    account_ids = [str(value) for value in list(gmail.get("connected_account_ids") or []) if str(value).strip()]
    if not account_ids:
        account_id = str(gmail.get("id") or "").strip()
    else:
        account_id = account_ids[0]
    if not account_id:
        raise RuntimeError("Active Gmail app has no connected account id")

    client = service.composio
    if not hasattr(client, "execute_proxy"):
        raise RuntimeError("Composio client does not expose execute_proxy")

    list_payload = client.execute_proxy(
        connected_account_id=account_id,
        endpoint="/gmail/v1/users/me/messages",
        parameters=[
            {"name": "maxResults", "value": "1", "type": "query"},
            {"name": "labelIds", "value": "INBOX", "type": "query"},
        ],
    )
    message_id = _first_message_id(list_payload)
    if not message_id:
        raise RuntimeError("Gmail metadata smoke found no latest message id")

    metadata_payload = client.execute_proxy(
        connected_account_id=account_id,
        endpoint=f"/gmail/v1/users/me/messages/{message_id}",
        parameters=[
            {"name": "format", "value": "metadata", "type": "query"},
            {"name": "metadataHeaders", "value": "Subject", "type": "query"},
            {"name": "metadataHeaders", "value": "From", "type": "query"},
            {"name": "metadataHeaders", "value": "Date", "type": "query"},
        ],
    )
    context_after = service._base_runtime_context()
    compiled = compose_pucky_base_instructions(service.config.codex_base_instructions, context_after)
    if compiled_output:
        output = Path(compiled_output).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(compiled or "", encoding="utf-8")
    rows = list((context_after.get("action_log") or {}).get("rows") or []) if isinstance(context_after.get("action_log"), dict) else []
    composio_proxy_rows = [
        row for row in rows
        if isinstance(row, dict)
        and str(row.get("surface") or "") == "composio"
        and str(row.get("tool") or "") == "POST"
        and str(row.get("target") or "") == "/tools/execute/proxy"
    ]
    if not composio_proxy_rows:
        raise RuntimeError("Gmail metadata smoke missing Composio proxy row in next compiled prompt")
    return {
        "schema": "pucky.composio_gmail_metadata_smoke.v1",
        "ok": True,
        "gmail_connected_account_id": account_id,
        "message_id": message_id,
        "metadata": _metadata_summary(metadata_payload),
        "action_log_proxy_rows": len(composio_proxy_rows),
        "compiled_sha256": hashlib.sha256((compiled or "").encode("utf-8")).hexdigest() if compiled else "",
        "compiled_output": str(Path(compiled_output).expanduser()) if compiled_output else "",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test Composio Gmail metadata and prompt action logging.")
    parser.add_argument("--compiled-output", default="")
    args = parser.parse_args()
    print(json.dumps(run_smoke(args.compiled_output), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
