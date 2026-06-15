from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PUCKYCTL = ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.server import Config, PuckyVoiceService  # noqa: E402


DEFAULT_BASE_URL = "https://pucky.fly.dev"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run live phone/Gmail/SMS reminder delivery proof against the VM-served bundle.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--api-token", default="")
    parser.add_argument("--me-email", default="")
    parser.add_argument("--me-phone", default="")
    parser.add_argument("--report-dir", required=True)
    parser.add_argument("--adb-serial", default="")
    parser.add_argument("--broker", default="")
    parser.add_argument("--broker-token", default="")
    parser.add_argument("--device-id", default="")
    parser.add_argument("--channels", default="phone_notification,email,sms")
    parser.add_argument("--due-seconds", type=int, default=20)
    parser.add_argument("--wait-seconds", type=int, default=90)
    return parser.parse_args()


def api_request(base_url: str, api_path: str, *, method: str = "GET", token: str = "", body: dict[str, Any] | None = None) -> Any:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(f"{base_url.rstrip('/')}{api_path}", method=method.upper(), headers=headers, data=data)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {api_path} failed ({exc.code}): {payload}") from exc


def reminder_meta(reminder: dict[str, Any]) -> dict[str, Any]:
    metadata = reminder.get("metadata") if isinstance(reminder.get("metadata"), dict) else {}
    return {
        "delivery_state": str(metadata.get("delivery_state") or "").strip().lower(),
        "snoozed_until_ms": int(metadata.get("snoozed_until_ms") or 0),
        "last_fired_due_at_ms": int(metadata.get("last_fired_due_at_ms") or 0),
        "last_delivery_results": list(metadata.get("last_delivery_results") or []) if isinstance(metadata.get("last_delivery_results"), list) else [],
    }


def reminder_is_snoozed(reminder: dict[str, Any]) -> bool:
    meta = reminder_meta(reminder)
    due_at_ms = int(reminder.get("due_at_ms") or 0)
    return meta["snoozed_until_ms"] > int(time.time() * 1000) and meta["snoozed_until_ms"] == due_at_ms


def reminder_is_active(reminder: dict[str, Any]) -> bool:
    if str(reminder.get("status") or "").strip().lower() == "done":
        return False
    meta = reminder_meta(reminder)
    due_at_ms = int(reminder.get("due_at_ms") or 0)
    if meta["delivery_state"] == "sent" and meta["last_fired_due_at_ms"] > 0 and meta["last_fired_due_at_ms"] == due_at_ms:
        return False
    return not reminder_is_snoozed(reminder)


def patch_me_profile(base_url: str, token: str, *, email: str = "", phone: str = "") -> None:
    metadata: dict[str, Any] = {}
    clean_email = str(email or "").strip()
    clean_phone = str(phone or "").strip()
    if clean_email:
        metadata["email"] = clean_email
    if clean_phone:
        metadata["phone"] = clean_phone
    if not metadata:
        return
    api_request(base_url, "/api/workspace/contacts/contact-me", method="PATCH", token=token, body={"metadata": metadata})


def wait_for_reminder_state(base_url: str, token: str, reminder_id: str, *, wait_seconds: int) -> dict[str, Any]:
    started_at = time.time()
    last_record: dict[str, Any] | None = None
    while time.time() - started_at < wait_seconds:
        last_record = api_request(base_url, f"/api/workspace/reminders/{reminder_id}", token=token)
        if reminder_meta(last_record)["delivery_state"] == "sent":
            return last_record
        time.sleep(2)
    raise RuntimeError(f"Timed out waiting for reminder {reminder_id} to send; last record={json.dumps(last_record or {}, indent=2)}")


def wait_for_active_count(base_url: str, token: str, expected_count: int, *, wait_seconds: int) -> list[dict[str, Any]]:
    started_at = time.time()
    last_items: list[dict[str, Any]] = []
    while time.time() - started_at < wait_seconds:
        payload = api_request(base_url, "/api/workspace/reminders", token=token)
        last_items = list(payload.get("items") or [])
        if len([item for item in last_items if reminder_is_active(item)]) == expected_count:
            return last_items
        time.sleep(2)
    raise RuntimeError(f"Timed out waiting for active reminder count {expected_count}; last items={json.dumps(last_items, indent=2)}")


def run_cli_json(global_args: list[str], command_args: list[str]) -> dict[str, Any]:
    process = subprocess.run(
        [sys.executable, str(PUCKYCTL), "--json", *global_args, *command_args],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    stdout = process.stdout.strip()
    stderr = process.stderr.strip()
    try:
        payload = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError:
        payload = {"stdout": stdout}
    payload["_exit_code"] = process.returncode
    if stderr:
        payload["_stderr"] = stderr
    return payload


def adb_run(serial: str, args: list[str], destination: Path | None = None) -> dict[str, Any]:
    command = ["adb"]
    if serial:
        command += ["-s", serial]
    command += args
    process = subprocess.run(command, cwd=str(ROOT), capture_output=True, text=False, check=False)
    output = process.stdout or process.stderr or b""
    if destination is not None:
        destination.write_bytes(output)
    return {"exit_code": process.returncode, "command": command, "output_path": str(destination) if destination else "", "output": output.decode("utf-8", errors="replace")}


def discover_adb_serial(preferred: str) -> str:
    if preferred:
        return preferred
    process = subprocess.run(["adb", "devices"], cwd=str(ROOT), capture_output=True, text=True, check=False)
    rows = [line.strip().split("\t", 1)[0] for line in process.stdout.splitlines()[1:] if "\tdevice" in line]
    return rows[0] if len(rows) == 1 else ""


def first_message_id(payload: dict[str, Any]) -> str:
    queue: list[Any] = [payload]
    while queue:
        item = queue.pop(0)
        if isinstance(item, dict):
            for key in ("id", "messageId", "message_id"):
                value = str(item.get(key) or "").strip()
                if value:
                    return value
            queue.extend(item.values())
        elif isinstance(item, list):
            queue.extend(item)
    return ""


def gmail_readback(service: PuckyVoiceService, subject: str) -> dict[str, Any]:
    connected_account_id, _ = service._require_connected_app("gmail", {"channel": "email"})
    query = f'subject:"{subject}" newer_than:2d'
    listing = service.composio.execute_proxy(
        connected_account_id=connected_account_id,
        endpoint="/gmail/v1/users/me/messages",
        parameters=[
            {"name": "labelIds", "value": "SENT", "type": "query"},
            {"name": "q", "value": query, "type": "query"},
            {"name": "maxResults", "value": "5", "type": "query"},
        ],
    )
    message_id = first_message_id(listing if isinstance(listing, dict) else {})
    if not message_id:
        raise RuntimeError(f"No Gmail SENT message found for query: {query}")
    metadata = service.composio.execute_proxy(
        connected_account_id=connected_account_id,
        endpoint=f"/gmail/v1/users/me/messages/{message_id}",
        parameters=[
            {"name": "format", "value": "metadata", "type": "query"},
            {"name": "metadataHeaders", "value": "Subject", "type": "query"},
            {"name": "metadataHeaders", "value": "To", "type": "query"},
            {"name": "metadataHeaders", "value": "Date", "type": "query"},
        ],
    )
    return {
        "connected_account_id": connected_account_id,
        "query": query,
        "message_id": message_id,
        "metadata": metadata,
    }


def make_reminder_payload(reminder_id: str, title: str, due_at_ms: int, channel: str) -> dict[str, Any]:
    return {
        "id": reminder_id,
        "title": title,
        "summary": f"Live reminder proof for {channel}",
        "status": "open",
        "due_at_ms": due_at_ms,
        "metadata": {
            "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
            "destinations": [{"channel": channel, "recipient_ids": ["self"]}],
        },
    }


def main() -> int:
    args = parse_args()
    report_dir = Path(args.report_dir).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir = report_dir / "adb"
    screenshots_dir.mkdir(exist_ok=True)

    base_url = args.base_url.rstrip("/")
    token = str(args.api_token or "").strip()
    channels = [item.strip() for item in str(args.channels or "").split(",") if item.strip()]
    adb_serial = discover_adb_serial(args.adb_serial)

    service = PuckyVoiceService(Config.from_env())
    patch_me_profile(base_url, token, email=args.me_email, phone=args.me_phone)
    me = api_request(base_url, "/api/workspace/contacts/contact-me", token=token)
    reminders_before = api_request(base_url, "/api/workspace/reminders", token=token)
    baseline_active = len([item for item in list(reminders_before.get("items") or []) if reminder_is_active(item)])

    preflight = {
        "me": {
            "id": me.get("id"),
            "title": me.get("title"),
            "email": ((me.get("metadata") or {}).get("email") if isinstance(me.get("metadata"), dict) else ""),
            "phone": ((me.get("metadata") or {}).get("phone") if isinstance(me.get("metadata"), dict) else ""),
            "notification_device_id": ((me.get("metadata") or {}).get("notification_device_id") if isinstance(me.get("metadata"), dict) else ""),
        },
        "connected_apps": service._connected_apps_snapshot(force=True),
        "adb_serial": adb_serial,
        "baseline_active_reminders": baseline_active,
    }

    summary: dict[str, Any] = {
        "schema": "pucky.reminders_live_delivery_proof.v1",
        "generated_at_ms": int(time.time() * 1000),
        "base_url": base_url,
        "channels": channels,
        "preflight": preflight,
        "lanes": [],
    }

    puckyctl_args: list[str] = []
    if args.broker:
      puckyctl_args += ["--broker", args.broker]
    if args.broker_token:
      puckyctl_args += ["--token", args.broker_token]
    if args.device_id:
      puckyctl_args += ["--device", args.device_id]

    timestamp = int(time.time())
    for index, channel in enumerate(channels, start=1):
        reminder_id = f"proof-reminder-live-{channel}-{timestamp}-{index}"
        title = f"Proof Reminder {channel.upper()} {timestamp}-{index}"
        due_at_ms = int(time.time() * 1000) + max(5, args.due_seconds) * 1000
        api_request(base_url, "/api/workspace/reminders", method="POST", token=token, body=make_reminder_payload(reminder_id, title, due_at_ms, channel))
        expected_active = baseline_active + 1
        wait_for_active_count(base_url, token, expected_active, wait_seconds=max(15, args.wait_seconds // 2))
        sent_record = wait_for_reminder_state(base_url, token, reminder_id, wait_seconds=args.wait_seconds)
        wait_for_active_count(base_url, token, baseline_active, wait_seconds=max(15, args.wait_seconds // 2))
        lane: dict[str, Any] = {
            "channel": channel,
            "reminder_id": reminder_id,
            "title": title,
            "due_at_ms": due_at_ms,
            "delivery_state": reminder_meta(sent_record)["delivery_state"],
            "delivery_results": reminder_meta(sent_record)["last_delivery_results"],
        }
        if channel == "phone_notification":
            lane["notify_active"] = run_cli_json(puckyctl_args, ["notify", "active"])
            lane["notify_policy"] = run_cli_json(puckyctl_args, ["notify", "policy-status"])
            lane["adb_devices"] = adb_run(adb_serial, ["devices"], report_dir / "adb_devices.txt")
            lane["adb_notifications"] = adb_run(adb_serial, ["shell", "cmd", "statusbar", "expand-notifications"])
            lane["adb_screencap"] = adb_run(adb_serial, ["exec-out", "screencap", "-p"], screenshots_dir / f"{index:02d}-{channel}.png")
            lane["adb_dumpsys"] = adb_run(adb_serial, ["shell", "dumpsys", "notification", "--noredact"], report_dir / f"{index:02d}-{channel}-dumpsys.txt")
        elif channel == "sms":
            me_phone = str(((me.get("metadata") or {}).get("phone") if isinstance(me.get("metadata"), dict) else "") or "").strip()
            lane["sms_thread"] = run_cli_json(puckyctl_args, ["phone", "sms", "get-thread", "--address", me_phone, "--limit", "10"])
            lane["adb_screencap"] = adb_run(adb_serial, ["exec-out", "screencap", "-p"], screenshots_dir / f"{index:02d}-{channel}.png")
        elif channel == "email":
            lane["gmail_readback"] = gmail_readback(service, title)
        summary["lanes"].append(lane)
        try:
            api_request(base_url, f"/api/workspace/reminders/{reminder_id}", method="DELETE", token=token)
        except Exception:
            pass

    (report_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
