#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import pathlib
import subprocess
import time
import uuid
import xml.etree.ElementTree as ET


APP = "pucky"
DEVICE_ID = "pucky-6ee8e85c12910b5c"
EVIDENCE_DIR = pathlib.Path("pucky-apk-evidence")
ADB = pathlib.Path("tools") / "android-sdk" / "platform-tools" / "adb.exe"
BROKER_BASE_URL = ""
OPERATOR_TOKEN = "operator-dev-token"


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def extract_json(text):
    objects = []
    starts = [index for index, char in enumerate(text) if char == "{"]
    for start in starts:
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(text)):
            char = text[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    try:
                        objects.append(json.loads(text[start:index + 1]))
                    except json.JSONDecodeError:
                        pass
                    break
    for obj in objects:
        if obj.get("schema") == "puckyctl.result.v1":
            return obj
    return objects[-1] if objects else None


def fly_puckyctl(command, timeout=120):
    if BROKER_BASE_URL:
        full = "python pucky-apk\\puckyctl\\puckyctl.py --json --broker " + BROKER_BASE_URL
        if OPERATOR_TOKEN:
            full += " --token " + OPERATOR_TOKEN
        full += " " + command
        proc_args = ["powershell", "-NoProfile", "-Command", full]
    else:
        full = "puckyctl --json " + command
        proc_args = ["flyctl", "ssh", "console", "-a", APP, "--command", full]
    started = time.monotonic()
    proc = subprocess.run(
        proc_args,
        text=True,
        capture_output=True,
        timeout=timeout,
    )
    duration_ms = int((time.monotonic() - started) * 1000)
    combined = "\n".join(part for part in [proc.stdout, proc.stderr] if part)
    parsed = extract_json(combined)
    return {
        "shell_command": full,
        "returncode": proc.returncode,
        "duration_ms": duration_ms,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "json": parsed,
        "parse_ok": parsed is not None,
    }


def step(test_id, command, validate=None, expected_ok=True, timeout=120):
    record = {
        "test_id": test_id,
        "command": command,
        "started_at": utc_now(),
    }
    try:
        execution = fly_puckyctl(command, timeout=timeout)
    except Exception as exc:
        record.update({
            "completed_at": utc_now(),
            "passed": False,
            "failure": type(exc).__name__ + ": " + str(exc),
            "execution": None,
        })
        return record
    parsed = execution.get("json") or {}
    passed = bool(parsed.get("ok")) == expected_ok
    failure = None if passed else error_code(parsed, "UNEXPECTED_OK_STATE")
    if passed and validate is not None:
        passed, failure = validate(parsed)
    record.update({
        "completed_at": utc_now(),
        "passed": passed,
        "failure": failure,
        "execution": execution,
    })
    return record


def error_code(parsed, fallback):
    error = parsed.get("error")
    if isinstance(error, dict):
        return error.get("code") or error.get("message") or fallback
    return fallback


def result(parsed):
    value = parsed.get("result")
    return value if isinstance(value, dict) else {}


def validate_online(parsed):
    devices = result(parsed).get("devices") or []
    for device in devices:
        if device.get("device_id") == DEVICE_ID and device.get("online"):
            return True, None
    return False, "DEVICE_NOT_ONLINE"


def validate_reply_prompt(parsed):
    value = result(parsed)
    if value.get("shown") is True and value.get("reply_enabled") is True:
        return True, None
    return False, "REPLY_NOTIFICATION_NOT_SHOWN"


def validate_reply_received(parsed):
    replies = result(parsed).get("replies") or []
    if not replies:
        return False, "NO_REPLY_RECEIVED"
    text = str(replies[-1].get("text") or "")
    if not text.strip():
        return False, "EMPTY_REPLY_RECEIVED"
    return True, None


def validate_location_get(parsed):
    value = result(parsed)
    if value.get("available") is False:
        return True, "LOCATION_PROVIDER_RETURNED_NO_SAMPLE"
    sample = value.get("sample")
    if isinstance(sample, dict) and isinstance(sample.get("lat"), (int, float)) and isinstance(sample.get("lon"), (int, float)):
        return True, None
    return False, "LOCATION_SAMPLE_MISSING_COORDINATES"


def validate_location_watch(parsed):
    value = result(parsed)
    if value.get("sample_count", 0) >= 1 and value.get("path"):
        return True, None
    return False, "TRACE_HAS_NO_SAMPLES"


def validate_capabilities(parsed):
    value = result(parsed)
    probe = value.get("probe") if isinstance(value.get("probe"), dict) else {}
    probe_result = probe.get("result") if isinstance(probe.get("result"), dict) else {}
    caps = probe_result.get("capabilities") or value.get("capabilities") or []
    commands = {item.get("command") for item in caps if isinstance(item, dict)}
    missing = sorted({"notify.ask", "location.get", "location.watch"} - commands)
    if not missing:
        return True, None
    return False, "CAPABILITIES_MISSING_" + ",".join(missing)


def summarize(records):
    return {
        "total": len(records),
        "passed": sum(1 for item in records if item["passed"]),
        "failed": sum(1 for item in records if not item["passed"]),
        "failures": [
            {
                "test_id": item["test_id"],
                "failure": item["failure"],
                "command": item["command"],
            }
            for item in records
            if not item["passed"]
        ],
    }


def write_summary(path, run):
    summary = run["summary"]
    lines = [
        "# Pucky Phase 5 Reply + Location Test Summary",
        "",
        f"Started: {run['started_at']}",
        f"Completed: {run['completed_at']}",
        f"Device: `{DEVICE_ID}`",
        f"Broker app: `{APP}`",
        "",
        f"Total: {summary['total']}",
        f"Passed: {summary['passed']}",
        f"Failed: {summary['failed']}",
        "",
        "## Failures",
        "",
    ]
    if not summary["failures"]:
        lines.append("None.")
    else:
        for failure in summary["failures"]:
            lines.append(f"- `{failure['test_id']}`: {failure['failure']} (`{failure['command']}`)")
    lines.extend([
        "",
        "## Manual Step",
        "",
        "- `reply.poll` requires a human to type into the Android notification direct-reply UI.",
        "- Location tests use stock Android `LocationManager`; no Google Play location dependency is required.",
    ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def adb_shell(*args, timeout=30):
    subprocess.run([str(ADB), "shell", *[str(arg) for arg in args]], check=False, timeout=timeout)


def bounds_center(bounds):
    numbers = [int(item) for item in bounds.replace("[", ",").replace("]", ",").split(",") if item.strip()]
    if len(numbers) != 4:
        return None
    return int((numbers[0] + numbers[2]) / 2), int((numbers[1] + numbers[3]) / 2)


def tap_text(text):
    adb_shell("uiautomator", "dump", "/sdcard/pucky-ui.xml")
    proc = subprocess.run(
        [str(ADB), "exec-out", "cat", "/sdcard/pucky-ui.xml"],
        text=True,
        capture_output=True,
        timeout=30,
    )
    root = ET.fromstring(proc.stdout)
    for node in root.iter("node"):
        if node.attrib.get("text") == text or node.attrib.get("content-desc") == text:
            center = bounds_center(node.attrib.get("bounds", ""))
            if center:
                adb_shell("input", "tap", str(center[0]), str(center[1]))
                return True
    return False


def adb_auto_reply(text):
    # Coordinates are intentionally scoped to the current XS19 Pro test device
    # viewport. This is a test helper, not a production control path.
    adb_shell("settings", "put", "system", "accelerometer_rotation", "0")
    adb_shell("settings", "put", "system", "user_rotation", "0")
    adb_shell("svc", "power", "stayon", "true")
    adb_shell("input", "keyevent", "224")
    time.sleep(0.5)
    adb_shell("input", "swipe", "192", "845", "192", "100", "600")
    time.sleep(0.5)
    adb_shell("cmd", "statusbar", "expand-notifications")
    time.sleep(0.8)
    if not tap_text("REPLY"):
        adb_shell("input", "tap", "335", "526")
        time.sleep(0.5)
        tap_text("REPLY")
    time.sleep(0.8)
    adb_shell("input", "text", text.replace(" ", "%s"))
    time.sleep(0.6)
    adb_shell("input", "tap", "334", "516")
    time.sleep(2.0)


def main():
    global BROKER_BASE_URL, OPERATOR_TOKEN
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", default=dt.datetime.now().strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--reply-timeout-ms", type=int, default=180000)
    parser.add_argument("--skip-manual-reply", action="store_true")
    parser.add_argument("--adb-auto-reply", action="store_true")
    parser.add_argument("--adb-reply-text", default="phase5_adb_auto_reply")
    parser.add_argument("--broker", default="https://pucky.fly.dev", help="Direct broker URL. When set, avoid flyctl ssh console.")
    parser.add_argument("--token", default="operator-dev-token")
    args = parser.parse_args()
    BROKER_BASE_URL = args.broker.rstrip("/")
    OPERATOR_TOKEN = args.token

    EVIDENCE_DIR.mkdir(exist_ok=True)
    prompt_id = "phase5_" + uuid.uuid4().hex[:12]
    baseline_reply_id = ""
    try:
        baseline = fly_puckyctl("replies list --limit 1", timeout=60).get("json") or {}
        replies = result(baseline).get("replies") or []
        if replies:
            baseline_reply_id = str(replies[-1].get("reply_id") or "")
    except Exception:
        baseline_reply_id = ""
    records = []
    commands = [
        ("presence.devices", "devices", validate_online, True, 120),
        ("capabilities.new_endpoints", "capabilities --refresh", validate_capabilities, True, 180),
        ("permissions.refresh", "permissions --refresh", None, True, 180),
        ("location.get", "location get --timeout-ms 10000", validate_location_get, True, 180),
        ("location.watch", f"location watch --duration-ms 10000 --interval-ms 2000 --max-samples 8 --trace-id {prompt_id}", validate_location_watch, True, 240),
        ("reply.ask", f"notify ask --title Pucky_reply_test --text Reply_with_any_text_prompt_{prompt_id} --prompt-id {prompt_id}", validate_reply_prompt, True, 180),
    ]
    if not args.skip_manual_reply:
        poll_command = f"replies poll --timeout-ms {args.reply_timeout_ms}"
        if baseline_reply_id:
            poll_command += " --since-id " + baseline_reply_id
        commands.append((
            "reply.poll",
            poll_command,
            validate_reply_received,
            True,
            max(60, int(args.reply_timeout_ms / 1000) + 30),
        ))

    run = {
        "schema": "pucky.phase5_reply_location_results.v1",
        "run_id": "phase5_" + str(uuid.uuid4()),
        "started_at": utc_now(),
        "app": APP,
        "device_id": DEVICE_ID,
        "prompt_id": prompt_id,
        "baseline_reply_id": baseline_reply_id,
        "results": records,
    }
    for index, item in enumerate(commands, start=1):
        test_id, command, validator, expected_ok, timeout = item
        print(f"[{index}/{len(commands)}] {test_id} :: {command}", flush=True)
        record = step(test_id, command, validate=validator, expected_ok=expected_ok, timeout=timeout)
        records.append(record)
        print("  " + ("PASS" if record["passed"] else "FAIL " + str(record["failure"])), flush=True)
        if test_id == "reply.ask" and record["passed"] and args.adb_auto_reply:
            adb_auto_reply(args.adb_reply_text)
        time.sleep(1)
    run["completed_at"] = utc_now()
    run["summary"] = summarize(records)
    json_path = EVIDENCE_DIR / f"{args.prefix}-phase5-reply-location-results.json"
    summary_path = EVIDENCE_DIR / f"{args.prefix}-phase5-reply-location-summary.md"
    json_path.write_text(json.dumps(run, indent=2, sort_keys=True), encoding="utf-8")
    write_summary(summary_path, run)
    print(json.dumps({
        "ok": run["summary"]["failed"] == 0,
        "json_path": str(json_path),
        "summary_path": str(summary_path),
        "prompt_id": prompt_id,
        "summary": run["summary"],
    }, indent=2), flush=True)
    return 0 if run["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
