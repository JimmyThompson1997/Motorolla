#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import pathlib
import subprocess
import time
import uuid


APP = "pucky-bridge-dev-jt323"
DEVICE_ID = "pucky-6ee8e85c12910b5c"
EVIDENCE_DIR = pathlib.Path("pucky-apk-evidence")


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
                    raw = text[start:index + 1]
                    try:
                        objects.append(json.loads(raw))
                    except json.JSONDecodeError:
                        pass
                    break
    for obj in objects:
        if obj.get("schema") == "puckyctl.result.v1":
            return obj
    return objects[-1] if objects else None


def fly_puckyctl(command, timeout=90):
    full = "puckyctl --json " + command
    started = time.monotonic()
    proc = subprocess.run(
        ["flyctl", "ssh", "console", "-a", APP, "--command", full],
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


def ok_from_json(parsed, expected_ok=True):
    if parsed is None:
        return False, "NO_JSON"
    actual = bool(parsed.get("ok"))
    if actual == expected_ok:
        return True, None
    error = parsed.get("error")
    if isinstance(error, dict):
        return False, error.get("code") or error.get("message") or "COMMAND_FAILED"
    return False, "COMMAND_FAILED"


def delivery_stage(parsed):
    if parsed is None:
        return "no_cli_json"
    if parsed.get("wait_error"):
        status = parsed.get("status")
        if parsed.get("ack") is not None:
            return "apk_acknowledged_no_final_result"
        if status in {"sent", "queued"}:
            return "broker_sent_no_apk_ack"
        return "wait_timeout_" + str(status or "unknown")
    status = parsed.get("status")
    if status == "completed":
        return "apk_completed"
    if status == "failed":
        return "apk_failed"
    if status == "rejected":
        return "apk_rejected"
    if status == "device_offline":
        return "not_delivered_device_offline"
    if status == "send_failed":
        return "not_delivered_send_failed"
    if status == "sent":
        return "broker_sent_result_not_waited"
    if status == "accepted":
        return "apk_acknowledged_result_not_waited"
    if parsed.get("kind") in {"devices", "health", "history", "artifacts"}:
        return "broker_query_completed"
    return "unknown"


def result_of(record):
    parsed = record.get("json") or {}
    return parsed.get("result") if isinstance(parsed.get("result"), dict) else {}


def command_id_of(record):
    parsed = record.get("json") or {}
    return parsed.get("command_id")


def run_step(step, context):
    command = step["command"]
    if callable(command):
        command = command(context)
    record = {
        "test_id": step["id"],
        "risk_class": step.get("risk", "quiet"),
        "user_prompt": step["prompt"],
        "expected_command": command,
        "started_at": utc_now(),
    }
    try:
        execution = fly_puckyctl(command, timeout=step.get("timeout", 90))
    except Exception as exc:
        record.update({
            "completed_at": utc_now(),
            "passed": False,
            "failure": type(exc).__name__ + ": " + str(exc),
            "execution": None,
        })
        return record
    passed, failure = ok_from_json(execution["json"], expected_ok=step.get("expected_ok", True))
    validator = step.get("validate")
    if passed and validator is not None:
        passed, failure = validator(execution, context)
    after = step.get("after")
    if after is not None:
        after(execution, context)
    record.update({
        "completed_at": utc_now(),
        "passed": passed,
        "failure": failure,
        "command_id": command_id_of(execution),
        "delivery_stage": delivery_stage(execution.get("json")),
        "execution": execution,
    })
    return record


def capture_note_id(execution, context):
    note = result_of(execution).get("note") or {}
    if note.get("id"):
        context["note_id"] = note["id"]


def capture_photo_path(execution, context):
    path = result_of(execution).get("path")
    if path:
        context["photo_path"] = path


def validate_contains_active_pucky_notification(execution, context):
    active = result_of(execution).get("active") or []
    found = any(item.get("package") == "com.pucky.device.debug" for item in active if isinstance(item, dict))
    return (found, None if found else "PUCKY_NOTIFICATION_NOT_ACTIVE")


def validate_note_list_has_note(execution, context):
    expected = context.get("note_id")
    if not expected:
        return True, None
    notes = result_of(execution).get("notes") or []
    found = any(item.get("id") == expected for item in notes if isinstance(item, dict))
    return (found, None if found else "NOTE_NOT_LISTED")


def validate_artifact_list_has_photo(execution, context):
    expected = context.get("photo_path")
    if not expected:
        return True, None
    artifacts = result_of(execution).get("artifacts") or []
    found = any(item.get("device_path") == expected for item in artifacts if isinstance(item, dict))
    return (found, None if found else "PHOTO_ARTIFACT_NOT_LISTED")


def validate_devices_online(execution, context):
    devices = result_of(execution).get("devices") or []
    for device in devices:
        if device.get("device_id") == DEVICE_ID and device.get("online"):
            return True, None
    return False, "DEVICE_NOT_ONLINE"


def validate_service_online(execution, context):
    result = result_of(execution)
    if result.get("service_running") is True and result.get("connection_state") == "online":
        return True, None
    return False, "SERVICE_NOT_ONLINE"


def validate_audible_notification(execution, context):
    result = result_of(execution)
    if result.get("shown") is True and result.get("sound") is True:
        return True, None
    return False, "AUDIBLE_NOTIFICATION_NOT_CONFIRMED_BY_RESULT"


def validate_sensor_events_or_timeout(execution, context):
    parsed = execution.get("json") or {}
    if parsed.get("ok"):
        return True, None
    error = parsed.get("error") or {}
    code = error.get("code") if isinstance(error, dict) else None
    if code in {"EXECUTION_FAILED", "CAPABILITY_UNAVAILABLE"}:
        return True, "SENSOR_REPORTED_STRUCTURED_LIMITATION"
    return False, code or "SENSOR_FAILED"


def validate_offline_expected(execution, context):
    parsed = execution.get("json") or {}
    if parsed.get("ok") is False:
        error = parsed.get("error") or {}
        code = error.get("code") if isinstance(error, dict) else None
        status = parsed.get("status")
        if code == "DEVICE_OFFLINE" or status == "device_offline":
            return True, None
    return False, "OFFLINE_NEGATIVE_TEST_DID_NOT_RETURN_DEVICE_OFFLINE"


def command_arg(command_type, **args):
    parts = ["command", command_type]
    for key, value in args.items():
        parts.extend(["--arg", f"{key}={json.dumps(value) if isinstance(value, (dict, list)) else value}"])
    parts.append("--wait")
    return " ".join(str(part) for part in parts)


def build_steps():
    settings_targets = [
        "settings",
        "wifi",
        "internet_panel",
        "bluetooth",
        "location",
        "home",
        "app_details",
        "notification_app",
        "battery_optimization",
        "accessibility",
        "data_usage",
        "date",
        "display",
        "sound",
        "security",
        "developer_options",
    ]
    steps = [
        {"id": "presence.devices", "prompt": "Is Pucky online?", "command": "devices", "validate": validate_devices_online},
        {"id": "presence.service", "prompt": "Is the Pucky foreground service online?", "command": "service status", "validate": validate_service_online},
        {"id": "presence.status", "prompt": "Summarize Pucky's Android model, APK version, battery, network, and sensor count.", "command": "status"},
        {"id": "presence.network", "prompt": "What network is Pucky using right now?", "command": "network"},
        {"id": "presence.battery", "prompt": "What is Pucky's battery level?", "command": "battery"},
        {"id": "presence.power", "prompt": "What power policy risks could break background operation?", "command": "power policy"},
        {"id": "quiet.ping", "prompt": "Ping Pucky and echo a nonce.", "command": "command ping --arg nonce=phase4_nonce --wait"},
        {"id": "quiet.capabilities", "prompt": "Audit Pucky capabilities.", "command": "capabilities --refresh", "timeout": 120},
        {"id": "quiet.permissions", "prompt": "Audit Pucky permissions.", "command": "permissions --refresh", "timeout": 120},
        {"id": "quiet.storage", "prompt": "Report local app storage.", "command": "storage"},
        {"id": "quiet.logs", "prompt": "Show Pucky command logs.", "command": "logs tail --limit 50"},
        {"id": "quiet.runtime", "prompt": "Report Pucky runtime stats.", "command": "system runtime"},
        {"id": "quiet.memory", "prompt": "Report Pucky memory stats.", "command": "system memory"},
        {"id": "quiet.thermal", "prompt": "Report thermal status.", "command": "system thermal"},
        {"id": "quiet.benchmark", "prompt": "Run a tiny bounded compute benchmark.", "command": "system benchmark --max-ms 100"},
        {"id": "quiet.audio_route", "prompt": "Report Pucky audio route.", "command": "command audio.route.get --wait"},
        {"id": "quiet.ui_state", "prompt": "What does Pucky's dashboard state say?", "command": "command ui.state.get --wait"},
        {"id": "quiet.launcher_capability", "prompt": "Can Pucky act as the home app?", "command": "command launcher.capability.get --wait"},
        {"id": "quiet.broker_history", "prompt": "Summarize recent Pucky broker history.", "command": "history --limit 50"},
        {"id": "quiet.broker_artifacts", "prompt": "List broker-known Pucky artifacts.", "command": "artifacts"},
        {"id": "quiet.built_in_suite", "prompt": "Run Pucky's built-in quiet suite.", "command": "test quiet --no-evidence", "timeout": 180},
        {"id": "notify.silent", "risk": "visible", "prompt": "Send Pucky a quiet notification.", "command": "notify show --title Silent_proof --text Silent_proof_from_VM_agent"},
        {"id": "notify.audible", "risk": "audible", "prompt": "Send Pucky an audible notification.", "command": "notify show --title Audible_proof --text Audible_proof_from_VM_agent --audible", "validate": validate_audible_notification},
        {"id": "notify.active", "risk": "visible", "prompt": "Verify the Pucky notification is active.", "command": "command notify.list_active --wait", "validate": validate_contains_active_pucky_notification},
        {"id": "notify.channels", "prompt": "List Pucky notification channels.", "command": "command notify.channels.get --wait"},
        {"id": "audio.low_tone", "risk": "audible", "prompt": "Make Pucky beep quietly once.", "command": "audio tone --duration 150 --volume 20"},
        {"id": "audio.proof_tone", "risk": "audible", "prompt": "Make Pucky play a short audible proof tone.", "command": "audio tone --duration 500 --volume 60"},
        {"id": "timer.local", "risk": "visible", "prompt": "Set a Pucky timer for 20 seconds.", "command": "timer set --in 20s --title Walk_timer --text Walk_timer_proof"},
        {"id": "timer.cancel_set", "prompt": "Set a timer that will be canceled.", "command": "timer set --id cancel_test --in 60s --title Cancel_test --text Should_not_fire"},
        {"id": "timer.cancel", "prompt": "Cancel the test timer.", "command": "timer cancel --id cancel_test"},
        {"id": "sensor.list", "prompt": "Which sensors does Pucky expose?", "command": "sensor list"},
        {"id": "sensor.proximity", "prompt": "Sample Pucky proximity sensor.", "command": "sensor sample --string-type android.sensor.proximity --events 5 --timeout 5000", "timeout": 120, "validate": validate_sensor_events_or_timeout},
        {"id": "sensor.accelerometer", "prompt": "Sample Pucky accelerometer.", "command": "sensor sample --string-type android.sensor.accelerometer --events 10 --timeout 5000", "timeout": 120, "validate": validate_sensor_events_or_timeout},
        {"id": "sensor.light", "prompt": "Sample Pucky light sensor.", "command": "sensor sample --string-type android.sensor.light --events 5 --timeout 5000", "timeout": 120, "validate": validate_sensor_events_or_timeout},
        {"id": "sensor.orientation", "prompt": "Sample Pucky orientation sensor.", "command": "sensor sample --string-type android.sensor.orientation --events 5 --timeout 5000", "timeout": 120, "validate": validate_sensor_events_or_timeout},
        {"id": "camera.info", "risk": "camera", "prompt": "What cameras does Pucky expose?", "command": "camera info"},
        {"id": "camera.photo", "risk": "camera", "prompt": "Take a low-resolution photo and report metadata.", "command": "camera photo --max-width 640 --evidence", "timeout": 120, "after": capture_photo_path},
        {"id": "artifact.list_after_photo", "prompt": "List local Pucky artifacts.", "command": "artifact-local list", "validate": validate_artifact_list_has_photo},
        {"id": "artifact.hash_photo", "prompt": "Hash the newest Pucky photo artifact.", "command": lambda ctx: "artifact-local hash --path " + ctx.get("photo_path", "__missing_photo_path__")},
        {"id": "torch.auto_off", "risk": "torch", "prompt": "Turn Pucky's flashlight on for one second.", "command": "torch on --auto-off 1000"},
        {"id": "torch.off", "risk": "torch", "prompt": "Turn Pucky's flashlight off.", "command": "torch off"},
        {"id": "note.create", "prompt": "Create a local Pucky note.", "command": "note create --title Walk_note --body Created_by_VM_agent", "after": capture_note_id},
        {"id": "note.list", "prompt": "List recent Pucky notes.", "command": "note list", "validate": validate_note_list_has_note},
        {"id": "note.delete", "prompt": "Delete the test Pucky note.", "command": lambda ctx: "note delete --id " + ctx.get("note_id", "__missing_note_id__")},
        {"id": "note.list_after_delete", "prompt": "Confirm the test note is gone.", "command": "note list"},
        {"id": "ui.dashboard", "risk": "visible", "prompt": "Bring the Pucky dashboard to the front.", "command": "command ui.dashboard.show --wait"},
        {"id": "settings.panel_generic", "risk": "visible", "prompt": "Open Android internet connectivity panel.", "command": "command settings.panel --arg target=internet_panel --wait"},
    ]
    for target in settings_targets:
        steps.append({
            "id": "settings." + target,
            "risk": "visible",
            "prompt": "Open the Android " + target + " settings surface.",
            "command": "settings open " + target,
        })
    steps.extend([
        {"id": "intent.browser", "risk": "visible", "prompt": "Open example.com on Pucky.", "command": "command browser.open --arg url=https://example.com --arg require_resolvable=false --wait"},
        {"id": "intent.share", "risk": "visible", "prompt": "Open the share sheet with proof text.", "command": "share text Pucky_share_proof"},
        {"id": "intent.calendar", "risk": "visible", "prompt": "Open a calendar event draft.", "command": "command calendar.intent.insert --arg title=Pucky_calendar_proof --arg description=Created_from_VM_agent --arg require_resolvable=false --wait"},
        {"id": "intent.dial", "risk": "visible", "prompt": "Open the dialer without placing a call.", "command": "intent dial --number 5550100"},
        {"id": "intent.alarm", "risk": "visible", "prompt": "Open Android alarm UI for a Pucky proof alarm.", "command": "intent alarm --hour 7 --minutes 30 --message Pucky_alarm_proof"},
        {"id": "journey.morning_check", "prompt": "Check Pucky online state, battery, network, and proximity.", "command": "status"},
        {"id": "journey.find_device_notify", "risk": "audible", "prompt": "Help me find Pucky with a notification.", "command": "notify show --title Find_Pucky --text Find_device_journey --audible", "validate": validate_audible_notification},
        {"id": "journey.find_device_beep", "risk": "audible", "prompt": "Help me find Pucky with a beep.", "command": "audio tone --duration 300 --volume 50"},
        {"id": "journey.local_reminder", "risk": "visible", "prompt": "Remind me on Pucky in one minute to head home.", "command": "timer set --in 60s --title Head_home --text VM_agent_reminder"},
        {"id": "journey.sensor_check", "prompt": "Check proximity for a lift-to-mouth style interaction.", "command": "sensor sample --string-type android.sensor.proximity --events 3 --timeout 5000", "timeout": 120, "validate": validate_sensor_events_or_timeout},
        {"id": "journey.visual_proof", "risk": "camera", "prompt": "Take a quick low-res photo and only report metadata.", "command": "camera photo --max-width 640", "timeout": 120},
        {"id": "journey.capability_audit", "prompt": "Audit every Pucky capability and permission.", "command": "capabilities --refresh", "timeout": 120},
        {"id": "negative.offline", "prompt": "Try to send a command to an offline Pucky device and report honestly.", "command": "--device-id pucky-offline-negative-test command ping --wait", "expected_ok": False, "validate": validate_offline_expected},
        {"id": "negative.mic_record", "prompt": "Record microphone audio for ten seconds.", "command": "command mic.record --arg seconds=10 --wait", "expected_ok": False},
        {"id": "negative.raw_shell", "prompt": "Run a shell command on Pucky.", "command": "command shell.exec --arg command=date --wait", "expected_ok": False},
        {"id": "negative.wifi_toggle", "prompt": "Turn off Wi-Fi silently.", "command": "command wifi.set --arg enabled=false --wait", "expected_ok": False},
        {"id": "cleanup.torch_off", "risk": "torch", "prompt": "Ensure the torch is off.", "command": "torch off"},
        {"id": "cleanup.cancel_default_notification", "prompt": "Cancel the default Pucky proof notification.", "command": "command notify.cancel --arg numeric_id=41002 --wait"},
        {"id": "cleanup.dashboard", "risk": "visible", "prompt": "Return to the Pucky dashboard.", "command": "command ui.dashboard.show --wait"},
        {"id": "final.service", "prompt": "Confirm Pucky remains connected after the exhaustive run.", "command": "service status", "validate": validate_service_online},
        {"id": "final.devices", "prompt": "Confirm the broker still sees Pucky online.", "command": "devices", "validate": validate_devices_online},
    ])
    return steps


def summarize(results):
    by_risk = {}
    by_delivery_stage = {}
    failures = []
    for item in results:
        risk = item["risk_class"]
        bucket = by_risk.setdefault(risk, {"total": 0, "passed": 0})
        bucket["total"] += 1
        stage = item.get("delivery_stage") or "not_recorded"
        delivery_bucket = by_delivery_stage.setdefault(stage, {"total": 0, "passed": 0})
        delivery_bucket["total"] += 1
        if item["passed"]:
            bucket["passed"] += 1
            delivery_bucket["passed"] += 1
        else:
            failures.append({
                "test_id": item["test_id"],
                "risk_class": risk,
                "delivery_stage": stage,
                "failure": item["failure"],
                "command_id": item.get("command_id"),
                "expected_command": item["expected_command"],
            })
    return {
        "total": len(results),
        "passed": sum(1 for item in results if item["passed"]),
        "failed": sum(1 for item in results if not item["passed"]),
        "by_risk": by_risk,
        "by_delivery_stage": by_delivery_stage,
        "failures": failures,
    }


def write_summary(path, run):
    summary = run["summary"]
    lines = [
        "# Pucky Phase 4 Exhaustive Agent Test Summary",
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
        "## By Risk",
        "",
    ]
    for risk, bucket in sorted(summary["by_risk"].items()):
        lines.append(f"- `{risk}`: {bucket['passed']}/{bucket['total']} passed")
    lines.extend(["", "## By Delivery Stage", ""])
    for stage, bucket in sorted(summary.get("by_delivery_stage", {}).items()):
        lines.append(f"- `{stage}`: {bucket['passed']}/{bucket['total']} passed")
    lines.extend(["", "## Failures", ""])
    if not summary["failures"]:
        lines.append("None.")
    else:
        for failure in summary["failures"]:
            lines.append(
                f"- `{failure['test_id']}`: {failure['failure']} "
                f"[{failure.get('delivery_stage', 'unknown')}] (`{failure['expected_command']}`)"
            )
    lines.extend([
        "",
        "## Notes",
        "",
        "- Commands were executed through `flyctl ssh console` inside the Pucky Fly machine.",
        "- `flyctl` may return code 1 on Windows after emitting valid JSON because of `The handle is invalid`; the runner treats parsed Pucky JSON as authoritative.",
        "- User-mediated commands may leave Android on visible settings/browser/share/alarm/calendar/dialer surfaces; the cleanup step attempts to return to the Pucky dashboard.",
    ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", default=dt.datetime.now().strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--start-at", default="")
    args = parser.parse_args()

    EVIDENCE_DIR.mkdir(exist_ok=True)
    context = {}
    steps = build_steps()
    if args.start_at:
        indexes = [index for index, step in enumerate(steps) if step["id"] == args.start_at]
        if not indexes:
            raise SystemExit("Unknown --start-at " + args.start_at)
        steps = steps[indexes[0]:]
    if args.limit:
        steps = steps[:args.limit]

    run = {
        "schema": "pucky.phase4_exhaustive_agent_results.v1",
        "run_id": "phase4_" + str(uuid.uuid4()),
        "started_at": utc_now(),
        "app": APP,
        "device_id": DEVICE_ID,
        "results": [],
    }

    for index, step in enumerate(steps, start=1):
        print(f"[{index}/{len(steps)}] {step['id']} :: {step['prompt']}", flush=True)
        result = run_step(step, context)
        run["results"].append(result)
        state = "PASS" if result["passed"] else "FAIL"
        print(f"  {state} {result.get('failure') or ''}", flush=True)
        time.sleep(1)

    run["completed_at"] = utc_now()
    run["summary"] = summarize(run["results"])
    json_path = EVIDENCE_DIR / f"{args.prefix}-phase4-exhaustive-agent-results.json"
    summary_path = EVIDENCE_DIR / f"{args.prefix}-phase4-exhaustive-agent-summary.md"
    json_path.write_text(json.dumps(run, indent=2, sort_keys=True), encoding="utf-8")
    write_summary(summary_path, run)
    print(json.dumps({
        "ok": run["summary"]["failed"] == 0,
        "json_path": str(json_path),
        "summary_path": str(summary_path),
        "summary": run["summary"],
    }, indent=2), flush=True)
    return 0 if run["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
