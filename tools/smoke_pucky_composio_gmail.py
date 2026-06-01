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
    def _extract(item: Any) -> str:
        if not isinstance(item, dict):
            return ""
        for key in ("id", "messageId", "message_id"):
            value = str(item.get(key) or "").strip()
            if value:
                return value
        return ""

    data = _payload_data(payload)
    if isinstance(data.get("messages"), list):
        for item in data.get("messages") or []:
            message_id = _extract(item)
            if message_id:
                return message_id
    messages = data.get("messages")
    if isinstance(messages, list):
        for item in messages:
            message_id = _extract(item)
            if message_id:
                return message_id
    if isinstance(data.get("data"), dict):
        nested = data.get("data") or {}
        if isinstance(nested.get("messages"), list):
            for item in nested.get("messages") or []:
                message_id = _extract(item)
                if message_id:
                    return message_id
    return ""


def _metadata_summary(payload: dict[str, Any]) -> dict[str, str]:
    data = _payload_data(payload)
    if isinstance(data.get("data"), dict):
        data = data.get("data") or {}
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


def _try_proxy_gmail_metadata(client: Any, account_id: str) -> tuple[str, dict[str, Any]]:
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
        raise RuntimeError("Gmail proxy metadata smoke found no latest message id")
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
    return message_id, metadata_payload


def _try_direct_tool_gmail_metadata(client: Any, account_id: str, user_id: str) -> tuple[str, dict[str, Any]]:
    if not hasattr(client, "execute_tool"):
        raise RuntimeError("Composio client does not expose execute_tool")
    if not str(user_id or "").strip():
        raise RuntimeError("Composio Gmail direct-tool metadata smoke requires a user_id")
    list_payload = client.execute_tool(
        tool_slug="GMAIL_FETCH_EMAILS",
        connected_account_id=account_id,
        user_id=user_id,
        arguments={
            "max_results": 1,
            "label_ids": ["INBOX"],
            "include_payload": False,
        },
    )
    message_id = _first_message_id(list_payload)
    if not message_id:
        raise RuntimeError("Gmail tool metadata smoke found no latest message id")
    metadata_payload = client.execute_tool(
        tool_slug="GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
        connected_account_id=account_id,
        user_id=user_id,
        arguments={
            "message_id": message_id,
            "format": "metadata",
        },
    )
    return message_id, metadata_payload


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
    user_id = str(service.config.composio_default_user_id or "").strip()

    execution_mode = "proxy"
    try:
        message_id, metadata_payload = _try_proxy_gmail_metadata(client, account_id)
    except RuntimeError as exc:
        detail = str(exc)
        if "403" not in detail and "proxy" not in detail.lower():
            raise
        execution_mode = "tool"
        message_id, metadata_payload = _try_direct_tool_gmail_metadata(client, account_id, user_id)
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
        and (
            str(row.get("target") or "") == "/tools/execute/proxy"
            or str(row.get("target") or "").startswith("/tools/execute/GMAIL_")
        )
    ]
    if not composio_proxy_rows:
        raise RuntimeError("Gmail metadata smoke missing Composio execute row in next compiled prompt")
    return {
        "schema": "pucky.composio_gmail_metadata_smoke.v1",
        "ok": True,
        "execution_mode": execution_mode,
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
