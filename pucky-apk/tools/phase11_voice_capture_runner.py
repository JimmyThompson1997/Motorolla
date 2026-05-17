#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import pathlib
import subprocess
import time


DEVICE_ID = "pucky-6ee8e85c12910b5c"
EVIDENCE_DIR = pathlib.Path("pucky-apk-evidence")
PUCKYCTL = pathlib.Path("pucky-apk") / "puckyctl" / "puckyctl.py"


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


def puckyctl(args, broker, token, timeout):
    cmd = ["python", str(PUCKYCTL), "--json"]
    if broker:
        cmd += ["--broker", broker]
    if token:
        cmd += ["--token", token]
    cmd += args
    started = time.monotonic()
    proc = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)
    combined = "\n".join(part for part in [proc.stdout, proc.stderr] if part)
    return {
        "argv": cmd,
        "returncode": proc.returncode,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "json": extract_json(combined),
    }


def result(parsed):
    value = parsed.get("result") if isinstance(parsed, dict) else None
    return value if isinstance(value, dict) else {}


def err(parsed, fallback):
    error = parsed.get("error") if isinstance(parsed, dict) else None
    if isinstance(error, dict):
        return error.get("code") or error.get("message") or fallback
    return fallback


def step(test_id, args, validate, ctx, timeout=120, sleep_after=0):
    record = {"test_id": test_id, "args": args, "started_at": utc_now()}
    try:
        execution = puckyctl(args, ctx["broker"], ctx["token"], timeout)
        parsed = execution.get("json") or {}
        passed = bool(parsed.get("ok"))
        failure = None if passed else err(parsed, "COMMAND_FAILED")
        extra = {}
        if passed and validate:
            passed, failure, extra = validate(parsed, ctx)
        record.update({
            "completed_at": utc_now(),
            "passed": passed,
            "failure": failure,
            "extra": extra,
            "execution": execution,
        })
    except Exception as exc:
        record.update({
            "completed_at": utc_now(),
            "passed": False,
            "failure": type(exc).__name__ + ": " + str(exc),
            "extra": {},
            "execution": None,
        })
    if sleep_after:
        time.sleep(sleep_after)
    return record


def validate_device_online(parsed, ctx):
    for device in result(parsed).get("devices") or []:
        if device.get("device_id") == DEVICE_ID and device.get("online"):
            return True, None, {"device_id": DEVICE_ID}
    return False, "DEVICE_NOT_ONLINE", {}


def validate_record_permission(parsed, ctx):
    text = json.dumps(result(parsed))
    if "RECORD_AUDIO" in text and "granted" in text:
        return True, None, {}
    return False, "RECORD_AUDIO_NOT_GRANTED", {}


def validate_idle(parsed, ctx):
    state = result(parsed).get("state")
    if state == "idle":
        return True, None, {}
    return False, "VOICE_NOT_IDLE", {"state": state}


def validate_start(parsed, ctx):
    value = result(parsed)
    if value.get("state") != "recording":
        return False, "CAPTURE_NOT_RECORDING", {"state": value.get("state")}
    ctx["active_session"] = value.get("session_id")
    return True, None, {"session_id": ctx["active_session"]}


def validate_duplicate_start(parsed, ctx):
    value = result(parsed)
    if value.get("result") == "already_recording":
        return True, None, {"session_id": result(value.get("active_session") or {}).get("session_id")}
    return False, "DUPLICATE_START_DID_NOT_REPORT_ALREADY_RECORDING", {"result": value}


def validate_stop(parsed, ctx):
    value = result(parsed)
    capture = value.get("capture") if isinstance(value.get("capture"), dict) else {}
    if value.get("state") != "completed":
        return False, "CAPTURE_NOT_COMPLETED", {"result": value}
    if capture.get("bytes", 0) <= 1000 or capture.get("duration_ms", 0) < 1000:
        return False, "CAPTURE_TOO_SMALL", {"bytes": capture.get("bytes"), "duration_ms": capture.get("duration_ms")}
    ctx["last_session"] = capture.get("session_id")
    return True, None, {
        "session_id": ctx["last_session"],
        "bytes": capture.get("bytes"),
        "duration_ms": capture.get("duration_ms"),
    }


def validate_last(parsed, ctx):
    capture = result(parsed).get("capture") if isinstance(result(parsed).get("capture"), dict) else {}
    expected = ctx.get("last_session")
    if expected and capture.get("session_id") == expected:
        return True, None, {"session_id": expected}
    return False, "LAST_CAPTURE_MISMATCH", {"expected": expected, "actual": capture.get("session_id")}


def validate_list(parsed, ctx):
    expected = ctx.get("last_session")
    captures = result(parsed).get("captures") or []
    if expected and any(item.get("session_id") == expected for item in captures):
        return True, None, {"count": len(captures)}
    return False, "CAPTURE_NOT_LISTED", {"expected": expected, "count": len(captures)}


def validate_button_config(parsed, ctx):
    text = json.dumps(result(parsed))
    if "voice.capture.start" in text and "voice.capture.stop" in text:
        return True, None, {}
    return False, "BUTTON_CONFIG_MISSING_CAPTURE_ACTIONS", {}


def button_action_result(parsed):
    event = result(parsed).get("event")
    if not isinstance(event, dict):
        return {}
    action_result = event.get("action_result")
    if not isinstance(action_result, dict):
        return {}
    value = action_result.get("result")
    return value if isinstance(value, dict) else {}


def validate_button_start(parsed, ctx):
    value = button_action_result(parsed)
    if value.get("state") != "recording":
        return False, "BUTTON_CAPTURE_NOT_RECORDING", {"state": value.get("state")}
    ctx["active_session"] = value.get("session_id")
    return True, None, {"session_id": ctx["active_session"]}


def validate_button_stop(parsed, ctx):
    value = button_action_result(parsed)
    capture = value.get("capture") if isinstance(value.get("capture"), dict) else {}
    if value.get("state") != "completed":
        return False, "BUTTON_CAPTURE_NOT_COMPLETED", {"result": value}
    if capture.get("bytes", 0) <= 1000 or capture.get("duration_ms", 0) < 1000:
        return False, "BUTTON_CAPTURE_TOO_SMALL", {"bytes": capture.get("bytes"), "duration_ms": capture.get("duration_ms")}
    ctx["last_session"] = capture.get("session_id")
    return True, None, {
        "session_id": ctx["last_session"],
        "bytes": capture.get("bytes"),
        "duration_ms": capture.get("duration_ms"),
    }


def validate_button_events(parsed, ctx):
    events = result(parsed).get("events") or []
    gestures = {item.get("gesture"): item.get("mapped_action") for item in events}
    if gestures.get("volume_up_hold") == "voice.capture.start" and gestures.get("volume_up_hold_release") == "voice.capture.stop":
        return True, None, {"event_count": len(events)}
    return False, "BUTTON_CAPTURE_EVENTS_MISSING", {"gestures": gestures}


def validate_delete(parsed, ctx):
    value = result(parsed)
    if value.get("deleted_metadata") is True:
        return True, None, {"deleted_file": value.get("deleted_file")}
    return False, "DELETE_METADATA_FAILED", {"result": value}


def validate_tone(parsed, ctx):
    if not ctx["allow_audio"]:
        return True, None, {"skipped": True}
    value = result(parsed)
    if value.get("played") is True:
        return True, None, {"duration_ms": value.get("duration_ms")}
    return False, "TONE_NOT_PLAYED", {"result": value}


def summarize(records):
    failures = [
        {"test_id": item["test_id"], "failure": item["failure"], "args": item["args"]}
        for item in records
        if not item["passed"]
    ]
    return {
        "total": len(records),
        "passed": len(records) - len(failures),
        "failed": len(failures),
        "failures": failures,
    }


def write_summary(path, run):
    summary = run["summary"]
    lines = [
        "# Pucky Phase 11 Voice Capture Summary",
        "",
        f"Started: {run['started_at']}",
        f"Completed: {run['completed_at']}",
        f"Device: `{DEVICE_ID}`",
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
            lines.append(f"- `{failure['test_id']}`: {failure['failure']}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--broker", default="https://pucky-bridge-dev-jt323.fly.dev")
    parser.add_argument("--token", default="")
    parser.add_argument("--label", default="phase11-voice-capture")
    parser.add_argument("--allow-audio", action="store_true")
    args = parser.parse_args()

    out_dir = EVIDENCE_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
    ctx = {"broker": args.broker, "token": args.token, "allow_audio": args.allow_audio}
    records = []

    def add(test_id, cmd, validate=None, timeout=120, sleep_after=0):
        records.append(step(test_id, cmd, validate, ctx, timeout=timeout, sleep_after=sleep_after))

    add("device-online", ["devices"], validate_device_online)
    add("record-permission", ["permissions", "--refresh", "--wait"], validate_record_permission)
    add("voice-status-idle", ["voice", "status", "--wait"], validate_idle)
    add("button-config-reset", ["button", "config-reset", "--wait"], validate_button_config)
    add("voice-start", ["voice", "start", "--session-id", "runner-command", "--sample-tag", "runner-command", "--max-duration-ms", "10000", "--wait"], validate_start)
    add("voice-duplicate-start", ["voice", "start", "--session-id", "runner-duplicate", "--wait"], validate_duplicate_start)
    if args.allow_audio:
        add("tone-during-capture", ["audio", "tone", "--duration", "500", "--volume", "25", "--wait"], validate_tone, sleep_after=1)
    else:
        time.sleep(1)
    add("voice-stop", ["voice", "stop", "--session-id", "vc_runner-command", "--reason", "runner_command_stop", "--wait"], validate_stop)
    add("voice-last", ["voice", "last", "--wait"], validate_last)
    add("voice-list", ["voice", "list", "--limit", "10", "--wait"], validate_list)
    add("button-clear-events", ["button", "clear-events", "--wait"])
    add("button-sim-hold", ["button", "simulate", "volume_up_hold", "--wait"], validate_button_start)
    if args.allow_audio:
        add("tone-during-button-capture", ["audio", "tone", "--duration", "500", "--volume", "25", "--wait"], validate_tone, sleep_after=1)
    else:
        time.sleep(1)
    add("button-sim-release", ["button", "simulate", "volume_up_hold_release", "--wait"], validate_button_stop)
    add("button-events", ["button", "events", "--limit", "10", "--wait"], validate_button_events)
    add("delete-start", ["voice", "start", "--session-id", "runner-delete", "--sample-tag", "runner-delete", "--max-duration-ms", "4000", "--wait"], validate_start, sleep_after=2)
    add("delete-stop", ["voice", "stop", "--session-id", "vc_runner-delete", "--reason", "runner_delete_stop", "--wait"], validate_stop)
    add("delete-keep-file", ["voice", "delete", "vc_runner-delete", "--keep-file", "--wait"], validate_delete)
    add("final-status-idle", ["voice", "status", "--wait"], validate_idle)

    run = {
        "schema": "pucky.phase11_voice_capture_results.v1",
        "started_at": records[0]["started_at"] if records else utc_now(),
        "completed_at": utc_now(),
        "device_id": DEVICE_ID,
        "broker": args.broker,
        "allow_audio": args.allow_audio,
        "records": records,
        "summary": summarize(records),
    }

    result_path = out_dir / f"{stamp}-{args.label}-results.json"
    summary_path = out_dir / f"{stamp}-{args.label}-summary.md"
    result_path.write_text(json.dumps(run, indent=2), encoding="utf-8")
    write_summary(summary_path, run)
    print(json.dumps({"results": str(result_path), "summary": str(summary_path), **run["summary"]}, indent=2))
    return 0 if run["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
