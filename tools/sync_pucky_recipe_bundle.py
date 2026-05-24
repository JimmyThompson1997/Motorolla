#!/usr/bin/env python3
"""Sync the VM-owned volume-down recipe bundle to the connected Pucky APK."""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


TERMINAL = {"completed", "failed", "rejected", "device_offline", "send_failed"}
ACTION_RECIPE_IDS = {"flashlight", "photo", "location_pin", "screenshot", "video_on", "video_off"}


def request_json(method, url, token="", body=None, timeout=30):
    data = None
    headers = {"accept": "application/json"}
    if token:
        headers["authorization"] = "Bearer " + token
    if body is not None:
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        headers["content-type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read().decode("utf-8") or "{}")
        except Exception:
            return exc.code, {"ok": False, "error": str(exc)}


def broker_url(base, path):
    return urllib.parse.urljoin(base.rstrip("/") + "/", path.lstrip("/"))


def require(ok, message, payload=None):
    if not ok:
        raise SystemExit(json.dumps({
            "ok": False,
            "error": message,
            "payload": payload,
        }, indent=2, sort_keys=True))


def resolve_device(base, token, explicit):
    if explicit:
        return explicit
    status, payload = request_json("GET", broker_url(base, "/v1/devices"), token)
    if status == 404:
        status, payload = request_json("GET", broker_url(base, "/devices"), token)
    require(status == 200, "device list failed", payload)
    devices = payload.get("devices") or []
    online = [item for item in devices if item.get("online")]
    if len(online) == 1:
        return online[0].get("device_id") or online[0].get("id")
    if len(devices) == 1:
        return devices[0].get("device_id") or devices[0].get("id")
    require(False, "device id required", {"devices": devices})


def send_command(base, token, device_id, command_type, args=None, ttl_ms=120000):
    body = {
        "id": "cmd_" + uuid.uuid4().hex,
        "type": command_type,
        "args": args or {},
        "ttl_ms": ttl_ms,
    }
    path = f"/v1/devices/{urllib.parse.quote(device_id)}/commands"
    status, payload = request_json("POST", broker_url(base, path), token, body=body)
    if status == 404:
        path = f"/devices/{urllib.parse.quote(device_id)}/commands"
        status, payload = request_json("POST", broker_url(base, path), token, body=body)
    require(status in (200, 202), f"command send failed: {command_type}", payload)
    return payload.get("command") or payload


def wait_command(base, token, device_id, command_id, timeout_s=60):
    deadline = time.monotonic() + timeout_s
    last = None
    while time.monotonic() < deadline:
        status, payload = request_json("GET", broker_url(base, f"/v1/commands/{urllib.parse.quote(command_id)}"), token)
        if status == 404:
            status, payload = request_json(
                "GET",
                broker_url(base, f"/v1/devices/{urllib.parse.quote(device_id)}/commands/{urllib.parse.quote(command_id)}"),
                token,
            )
        require(status == 200, f"command wait failed: {command_id}", payload)
        last = payload.get("command") or payload
        if last.get("status") in TERMINAL:
            return last
        time.sleep(0.5)
    require(False, f"timed out waiting for {command_id}", last)


def run_command(base, token, device_id, command_type, args=None, timeout_s=60):
    sent = send_command(base, token, device_id, command_type, args=args, ttl_ms=int(timeout_s * 1000))
    command_id = sent.get("id")
    require(command_id, "broker did not return command id", sent)
    done = wait_command(base, token, device_id, command_id, timeout_s=timeout_s)
    require(done.get("status") == "completed", f"command did not complete: {command_type}", done)
    result = ((done.get("result") or {}).get("result")
              if isinstance(done.get("result"), dict)
              else None)
    return result or done


def verify_active_sources(recipes_list):
    active = recipes_list.get("active_recipes") or []
    by_id = {item.get("id"): item for item in active if isinstance(item, dict)}
    failures = {}
    for recipe_id in sorted(ACTION_RECIPE_IDS):
        source = (by_id.get(recipe_id) or {}).get("active_source")
        if source != "vm_sync":
            failures[recipe_id] = source
    require(not failures, "action recipes are not VM-owned", failures)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--broker", default=os.environ.get("PUCKY_BROKER_BASE_URL", "http://127.0.0.1:8787"))
    parser.add_argument("--token", default=os.environ.get("PUCKY_OPERATOR_TOKEN", "operator-dev-token"))
    parser.add_argument("--device", default=os.environ.get("PUCKY_DEVICE_ID", ""))
    parser.add_argument("--bundle", default=str(Path(__file__).resolve().parents[1] / "pucky_vm" / "recipes" / "volume_down_lab_dev_bundle.json"))
    parser.add_argument("--clear-first", action="store_true")
    parser.add_argument("--smoke", action="store_true", help="Run non-executing exact-match recipe tests after sync.")
    args = parser.parse_args()

    with open(args.bundle, "r", encoding="utf-8") as handle:
        bundle = json.load(handle)

    status, health = request_json("GET", broker_url(args.broker, "/health"), args.token)
    require(status == 200, "broker health failed", health)
    device_id = resolve_device(args.broker, args.token, args.device)

    identity = run_command(args.broker, args.token, device_id, "status.get", timeout_s=60)
    if args.clear_first:
        run_command(args.broker, args.token, device_id, "pucky.recipes.clear", timeout_s=60)

    sync = run_command(args.broker, args.token, device_id, "pucky.recipes.sync", {"bundle": bundle}, timeout_s=90)
    listed = run_command(args.broker, args.token, device_id, "pucky.recipes.list", timeout_s=60)
    verify_active_sources(listed)

    smoke = []
    if args.smoke:
        for phrase in ("flashlight", "photo", "pin location", "screenshot", "video on", "video off"):
            smoke.append(run_command(
                args.broker,
                args.token,
                device_id,
                "pucky.recipes.test",
                {"text": phrase, "execute": False},
                timeout_s=60,
            ))

    print(json.dumps({
        "ok": True,
        "schema": "pucky.recipe_bundle_sync_report.v1",
        "device_id": device_id,
        "identity": identity,
        "synced_bundle_id": bundle.get("bundle_id"),
        "synced_version": bundle.get("version"),
        "sync": sync,
        "active_count": listed.get("active_count"),
        "active_sources_verified": True,
        "smoke": smoke,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
