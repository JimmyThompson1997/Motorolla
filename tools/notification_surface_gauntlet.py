from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUCKYCTL = ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py"


def payload_case(key: str, title: str, payload: dict[str, object], *, interaction: bool = False) -> dict[str, object]:
    return {
        "key": key,
        "title": title,
        "command": ["notify", "show", "--payload-json", json.dumps(payload, separators=(",", ":"))],
        "requires_phone_interaction": interaction,
    }


CASES: list[dict[str, object]] = [
    payload_case(
        "shade_passive",
        "Passive shade-only",
        {
            "id": "gauntlet_shade_passive",
            "title": "Passive shade",
            "text": "Background status check",
            "surface": {"mode": "shade"},
            "importance": "low",
            "category": "status",
            "silent": True,
        },
    ),
    payload_case(
        "default_audible",
        "Default audible",
        {
            "id": "gauntlet_default_audible",
            "title": "Default audible",
            "text": "Standard reminder sound",
            "surface": {"mode": "heads_up"},
            "importance": "default",
            "category": "reminder",
            "default_sound": True,
            "vibration_pattern_ms": [0, 120, 80, 180],
        },
    ),
    payload_case(
        "urgent_heads_up",
        "Urgent heads-up",
        {
            "id": "gauntlet_urgent_heads_up",
            "title": "Urgent heads up",
            "text": "Heads-up proof",
            "surface": {"mode": "heads_up"},
            "importance": "high",
            "category": "message",
            "default_sound": True,
            "vibration_pattern_ms": [0, 150, 60, 220],
        },
    ),
    payload_case(
        "full_screen",
        "Full screen request",
        {
            "id": "gauntlet_full_screen",
            "title": "Wake now",
            "text": "Full-screen proof",
            "surface": {"mode": "full_screen"},
            "importance": "high",
            "category": "call",
            "full_screen_activity": "home",
            "default_sound": True,
            "vibration_pattern_ms": [0, 200, 100, 320],
        },
    ),
    payload_case(
        "ongoing",
        "Ongoing sticky",
        {
            "id": "gauntlet_ongoing",
            "title": "Ongoing proof",
            "text": "Sticky until cancelled",
            "surface": {"mode": "heads_up"},
            "importance": "high",
            "category": "service",
            "ongoing": True,
            "no_clear": True,
            "only_alert_once": True,
        },
    ),
    payload_case(
        "group_summary",
        "Grouped summary",
        {
            "id": "gauntlet_group_summary",
            "title": "Grouped summary",
            "text": "Summary row",
            "surface": {"mode": "shade"},
            "importance": "default",
            "category": "event",
            "group_key": "gauntlet_group",
            "group_summary": True,
            "group_alert_behavior": "summary",
        },
    ),
    payload_case(
        "group_child",
        "Grouped child",
        {
            "id": "gauntlet_group_child",
            "title": "Grouped child",
            "text": "Child row",
            "surface": {"mode": "shade"},
            "importance": "default",
            "category": "event",
            "group_key": "gauntlet_group",
            "group_summary": False,
            "group_alert_behavior": "summary",
        },
    ),
    payload_case(
        "manual_tone_and_haptic",
        "Manual tone plus haptic",
        {
            "id": "gauntlet_manual_cues",
            "title": "Manual cues",
            "text": "Companion cue proof",
            "surface": {"mode": "heads_up"},
            "importance": "high",
            "category": "alarm",
            "manual_tone": {"duration_ms": 1500, "volume": 85, "repeat_count": 1, "repeat_gap_ms": 700},
            "manual_haptic": {"pattern_ms": [0, 200, 120, 320], "repeat_count": 1, "repeat_gap_ms": 900},
        },
    ),
    payload_case(
        "timeout",
        "Timeout auto-expire",
        {
            "id": "gauntlet_timeout",
            "title": "Timeout proof",
            "text": "Should expire automatically",
            "surface": {"mode": "heads_up"},
            "importance": "default",
            "category": "status",
            "timeout_ms": 6000,
        },
    ),
    payload_case(
        "repeat_until_cancelled",
        "Repeat until cancelled",
        {
            "id": "gauntlet_repeat_until_cancelled",
            "title": "Repeat until cancelled",
            "text": "Persistent critical cue",
            "surface": {"mode": "heads_up"},
            "importance": "high",
            "category": "alarm",
            "ongoing": True,
            "manual_tone": {"duration_ms": 1200, "volume": 90},
            "manual_haptic": {"pattern_ms": [0, 250, 100, 350]},
            "repeat_until_cancelled": True,
        },
    ),
    payload_case(
        "buttons_and_reply",
        "Buttons and inline reply",
        {
            "id": "gauntlet_buttons_reply",
            "title": "Action and reply",
            "text": "Tap or reply from the shade",
            "surface": {"mode": "heads_up"},
            "importance": "high",
            "category": "message",
            "default_sound": True,
            "actions": [
                {"id": "ack", "title": "Acknowledge", "kind": "button"},
                {"id": "later", "title": "Snooze", "kind": "button"},
                {"id": "reply", "title": "Reply", "kind": "reply", "reply_label": "Type reply"},
            ],
        },
        interaction=True,
    ),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a raw notification payload gauntlet through puckyctl.")
    parser.add_argument("--device-id", default="", help="Broker device id. Falls back to puckyctl defaults.")
    parser.add_argument("--broker", default="", help="Broker base URL override.")
    parser.add_argument("--token", default="", help="Operator token override.")
    parser.add_argument("--report-dir", required=True, help="Directory for JSON/log artifacts.")
    parser.add_argument("--adb-serial", default="", help="Optional adb serial for screenshots, dumpsys, and logcat.")
    parser.add_argument("--sleep-ms", type=int, default=2500, help="Pause between cases.")
    parser.add_argument("--cases", default="", help="Comma-separated subset of case keys.")
    return parser.parse_args()


def run_cli_json(global_args: list[str], command_args: list[str]) -> dict[str, object]:
    process = subprocess.run(
        [sys.executable, str(PUCKYCTL), "--json", *global_args, *command_args],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    stdout = process.stdout.strip()
    stderr = process.stderr.strip()
    payload: dict[str, object]
    try:
        payload = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError:
        payload = {"stdout": stdout}
    payload["_exit_code"] = process.returncode
    if stderr:
        payload["_stderr"] = stderr
    return payload


def adb_capture(serial: str, destination: Path, stem: str) -> str | None:
    if not serial:
        return None
    path = destination / f"{stem}.png"
    process = subprocess.run(
        ["adb", "-s", serial, "exec-out", "screencap", "-p"],
        cwd=str(ROOT),
        capture_output=True,
        check=False,
    )
    if process.returncode != 0 or not process.stdout:
        return None
    path.write_bytes(process.stdout)
    return str(path)


def adb_text(serial: str, command: list[str], destination: Path, name: str) -> str | None:
    if not serial:
        return None
    process = subprocess.run(
        ["adb", "-s", serial, *command],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    path = destination / name
    path.write_text(process.stdout or process.stderr or "", encoding="utf-8")
    return str(path)


def main() -> int:
    args = parse_args()
    report_dir = Path(args.report_dir).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    screenshot_dir = report_dir / "screenshots"
    screenshot_dir.mkdir(exist_ok=True)

    selected = {item.strip() for item in args.cases.split(",") if item.strip()}
    cases = [case for case in CASES if not selected or case["key"] in selected]
    global_args: list[str] = []
    if args.broker:
        global_args += ["--broker", args.broker]
    if args.token:
        global_args += ["--token", args.token]
    if args.device_id:
        global_args += ["--device", args.device_id]

    summary: dict[str, object] = {
        "schema": "pucky.notification_surface_gauntlet.v1",
        "generated_at_ms": int(time.time() * 1000),
        "case_count": len(cases),
        "cases": [],
    }
    commands: list[dict[str, object]] = []

    for index, case in enumerate(cases, start=1):
        case_key = str(case["key"])
        command = list(case["command"])
        result = run_cli_json(global_args, command)
        active = run_cli_json(global_args, ["notify", "active"])
        channels = run_cli_json(global_args, ["notify", "channels"])
        policy = run_cli_json(global_args, ["notify", "policy-status"])
        screenshot = adb_capture(args.adb_serial, screenshot_dir, f"{index:02d}-{case_key}")
        record = {
            "index": index,
            "key": case_key,
            "title": case["title"],
            "requires_phone_interaction": bool(case.get("requires_phone_interaction")),
            "command": command,
            "result": result,
            "active": active,
            "channels": channels,
            "policy": policy,
            "screenshot": screenshot,
        }
        commands.append(record)
        summary["cases"].append(
            {
                "index": index,
                "key": case_key,
                "ok": bool(result.get("ok", result.get("result", {}).get("ok"))),
                "exit_code": result.get("_exit_code"),
                "notification_id": result.get("id") or result.get("result", {}).get("id"),
                "requested_surface_mode": result.get("requested_surface_mode") or result.get("result", {}).get("requested_surface_mode"),
                "effective_surface_mode": result.get("effective_surface_mode") or result.get("result", {}).get("effective_surface_mode"),
                "degraded_to": result.get("degraded_to") or result.get("result", {}).get("degraded_to"),
            }
        )
        time.sleep(max(0.1, args.sleep_ms / 1000.0))

    (report_dir / "commands.json").write_text(json.dumps(commands, indent=2), encoding="utf-8")
    (report_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    adb_text(args.adb_serial, ["shell", "dumpsys", "notification", "--noredact"], report_dir, "dumpsys_notification.txt")
    adb_text(args.adb_serial, ["logcat", "-d"], report_dir, "logcat.txt")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
