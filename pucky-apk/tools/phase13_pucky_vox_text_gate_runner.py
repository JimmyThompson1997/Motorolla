#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import pathlib
import subprocess
import time
import urllib.error
import urllib.request


DEVICE_ID = "pucky-6ee8e85c12910b5c"
EVIDENCE_DIR = pathlib.Path("pucky-apk-evidence")
PUCKYCTL = pathlib.Path("pucky-apk") / "puckyctl" / "puckyctl.py"
DEFAULT_VOX_URL = "https://jt-project-vox-codex.fly.dev"
DEFAULT_BROKER_URL = "https://pucky.fly.dev"
DEFAULT_OPERATOR_TOKEN = "operator-dev-token"


def utc_now():
    return (
        dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def stamp_now():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")


def load_dotenv(path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        key, value = clean.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def http_json(method, url, payload=None, timeout=180):
    data = None
    headers = {"accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers["content-type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8", errors="replace")
            body = json.loads(text) if text.strip() else {}
            return {
                "ok": 200 <= response.status < 300,
                "status": response.status,
                "duration_ms": int((time.monotonic() - started) * 1000),
                "body": body,
                "error": None,
            }
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(text) if text.strip() else {}
        except json.JSONDecodeError:
            body = {"raw": text}
        return {
            "ok": False,
            "status": exc.code,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "body": body,
            "error": {"type": "HTTPError", "message": str(exc)},
        }
    except Exception as exc:
        return {
            "ok": False,
            "status": None,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "body": {},
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }


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
                        objects.append(json.loads(text[start : index + 1]))
                    except json.JSONDecodeError:
                        pass
                    break
    for obj in objects:
        if obj.get("schema") == "puckyctl.result.v1":
            return obj
    return objects[-1] if objects else None


def puckyctl(args, broker, token, timeout=120):
    cmd = ["python", str(PUCKYCTL), "--json"]
    if broker:
        cmd += ["--broker", broker]
    if token:
        cmd += ["--token", token]
    cmd += args
    started = time.monotonic()
    try:
        proc = subprocess.run(
            cmd,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        combined = "\n".join(part for part in (proc.stdout, proc.stderr) if part)
        parsed = extract_json(combined)
        return {
            "argv": redact_argv(cmd),
            "returncode": proc.returncode,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "json": parsed,
        }
    except Exception as exc:
        return {
            "argv": redact_argv(cmd),
            "returncode": None,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "stdout": "",
            "stderr": "",
            "json": None,
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }


def redact_argv(argv):
    out = []
    skip_next = False
    for index, item in enumerate(argv):
        if skip_next:
            out.append("<redacted>")
            skip_next = False
            continue
        out.append(item)
        if item in {"--token", "--operator-token"}:
            skip_next = True
        elif item.startswith("--token=") or item.startswith("--operator-token="):
            out[index] = item.split("=", 1)[0] + "=<redacted>"
    return out


def pucky_result(execution):
    parsed = execution.get("json") if isinstance(execution, dict) else None
    if not isinstance(parsed, dict):
        return {}
    result = parsed.get("result")
    return result if isinstance(result, dict) else {}


def build_turns(run_id):
    return [
        {
            "caller_turn_id": 1,
            "sentinel": "PUCKY_VOX_GATE_ONE",
            "text": (
                "Pucky integration gate turn one. "
                "Reply with exactly PUCKY_VOX_GATE_ONE and no extra words."
            ),
        },
        {
            "caller_turn_id": 2,
            "sentinel": "PUCKY_VOX_GATE_TWO",
            "text": (
                "Pucky integration gate turn two from Android native STT relay "
                f"run {run_id}. Reply with exactly PUCKY_VOX_GATE_TWO and no extra words."
            ),
        },
        {
            "caller_turn_id": 3,
            "sentinel": "PUCKY_VOX_GATE_THREE",
            "text": (
                "Pucky integration gate turn three. Treat this as text that came from "
                "Pucky after a Volume Up hold. Reply with exactly PUCKY_VOX_GATE_THREE "
                "and no extra words."
            ),
        },
    ]


def run_vox_turn(vox_url, room, turn):
    payload = {
        "room": room,
        "caller_turn_id": turn["caller_turn_id"],
        "text": turn["text"],
    }
    response = http_json("POST", vox_url.rstrip("/") + "/api/voice/turns", payload)
    body = response.get("body") if isinstance(response, dict) else {}
    final_text = str(body.get("final_text") or "")
    passed = bool(response.get("ok")) and turn["sentinel"] in final_text
    failure = None
    if not response.get("ok"):
        failure = "VOX_HTTP_FAILED"
    elif turn["sentinel"] not in final_text:
        failure = "VOX_SENTINEL_MISSING"
    return {
        "step": f"vox.turn.{turn['caller_turn_id']}",
        "started_at": utc_now(),
        "completed_at": utc_now(),
        "passed": passed,
        "failure": failure,
        "request": payload,
        "expected_sentinel": turn["sentinel"],
        "final_text": final_text,
        "response": response,
    }


def summarize(run):
    steps = run["steps"]
    required_failures = [
        {
            "step": item.get("step"),
            "failure": item.get("failure"),
        }
        for item in steps
        if item.get("passed") is False and item.get("required", True)
    ]
    optional_failures = [
        {
            "step": item.get("step"),
            "failure": item.get("failure"),
        }
        for item in steps
        if item.get("passed") is False and not item.get("required", True)
    ]
    required_steps = [item for item in steps if item.get("required", True)]
    return {
        "passed": bool(required_steps) and not required_failures,
        "total_steps": len(steps),
        "required_steps": len(required_steps),
        "passed_steps": sum(1 for item in steps if item.get("passed") is True),
        "failed_steps": len(required_failures) + len(optional_failures),
        "failures": required_failures,
        "required_failures": required_failures,
        "optional_failures": optional_failures,
        "vox_replies": [
            item.get("final_text")
            for item in steps
            if str(item.get("step", "")).startswith("vox.turn.")
        ],
    }


def write_summary(path, run, results_path):
    summary = run["summary"]
    lines = [
        "# Pucky Phase 13 Vox Text Gate Summary",
        "",
        f"Started: {run['started_at']}",
        f"Completed: {run['completed_at']}",
        f"Passed: {summary['passed']}",
        f"Room: `{run['room']}`",
        f"Vox URL: `{run['vox_url']}`",
        f"Device ID: `{run['device_id']}`",
        f"Results: `{results_path}`",
        "",
        "## Vox Replies",
        "",
    ]
    for reply in summary["vox_replies"]:
        lines.append(f"- `{reply}`")
    lines.extend(["", "## Failures", ""])
    if summary["required_failures"]:
        for failure in summary["required_failures"]:
            lines.append(f"- `{failure['step']}`: {failure['failure']}")
    else:
        lines.append("- None")
    lines.extend(["", "## Optional Device Return Issues", ""])
    if summary["optional_failures"]:
        for failure in summary["optional_failures"]:
            lines.append(f"- `{failure['step']}`: {failure['failure']}")
    else:
        lines.append("- None")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vox-url", default=DEFAULT_VOX_URL)
    parser.add_argument("--broker", default=DEFAULT_BROKER_URL)
    parser.add_argument("--token", default="")
    parser.add_argument("--env", default=".env")
    parser.add_argument("--device-id", default=DEVICE_ID)
    parser.add_argument("--label", default="phase13-pucky-vox-text-gate")
    parser.add_argument("--skip-pucky-return", action="store_true")
    parser.add_argument("--notify-audible", action="store_true")
    args = parser.parse_args()

    load_dotenv(pathlib.Path(args.env))
    token = (
        args.token
        or os.environ.get("PUCKY_OPERATOR_TOKEN", "").strip()
        or DEFAULT_OPERATOR_TOKEN
    )
    stamp = stamp_now()
    run_id = f"pucky-vox-{stamp}"
    room = f"pucky-text-gate-{stamp}"
    out_dir = EVIDENCE_DIR / "phase13-pucky-vox-text-gate"
    out_dir.mkdir(parents=True, exist_ok=True)
    results_path = out_dir / f"{stamp}-{args.label}-results.json"
    summary_path = out_dir / f"{stamp}-{args.label}-summary.md"

    run = {
        "schema": "pucky.phase13_vox_text_gate_results.v1",
        "started_at": utc_now(),
        "run_id": run_id,
        "room": room,
        "vox_url": args.vox_url.rstrip("/"),
        "broker": args.broker.rstrip("/"),
        "device_id": args.device_id,
        "secret_status": {
            "pucky_operator_token_present": bool(token),
        },
        "steps": [],
    }

    health = http_json("GET", args.vox_url.rstrip("/") + "/healthz", timeout=45)
    run["steps"].append(
        {
            "step": "vox.health",
            "required": True,
            "passed": bool(
                health.get("ok")
                and health.get("body", {}).get("ok") is True
                and health.get("body", {}).get("worker_running") is True
            ),
            "failure": None
            if health.get("ok")
            and health.get("body", {}).get("ok") is True
            and health.get("body", {}).get("worker_running") is True
            else "VOX_HEALTH_NOT_READY",
            "response": health,
        }
    )

    if run["steps"][-1]["passed"]:
        for turn in build_turns(run_id):
            run["steps"].append(run_vox_turn(args.vox_url, room, turn))
    else:
        for turn in build_turns(run_id):
            run["steps"].append(
                {
                    "step": f"vox.turn.{turn['caller_turn_id']}",
                    "required": True,
                    "passed": False,
                    "failure": "SKIPPED_VOX_HEALTH_FAILED",
                    "request": {"room": room, "caller_turn_id": turn["caller_turn_id"]},
                }
            )

    vox_reply = ""
    for item in reversed(run["steps"]):
        if str(item.get("step", "")).startswith("vox.turn.") and item.get("passed"):
            vox_reply = str(item.get("final_text") or "")
            break

    if args.skip_pucky_return:
        run["steps"].append(
            {
                "step": "pucky.return_notification",
                "required": False,
                "passed": None,
                "failure": "SKIPPED_BY_FLAG",
            }
        )
    else:
        devices_exec = puckyctl(["devices"], args.broker, token, timeout=45)
        devices_parsed = devices_exec.get("json") or {}
        devices = pucky_result(devices_exec).get("devices") or []
        online = any(
            device.get("device_id") == args.device_id and device.get("online")
            for device in devices
        )
        run["steps"].append(
            {
                "step": "pucky.devices",
                "required": False,
                "passed": bool(devices_parsed.get("ok") and online),
                "failure": None
                if devices_parsed.get("ok") and online
                else "PUCKY_DEVICE_NOT_ONLINE",
                "execution": devices_exec,
            }
        )
        if devices_parsed.get("ok") and online and vox_reply:
            notify_args = [
                "notify",
                "show",
                "--title",
                "Pucky Vox gate",
                "--text",
                f"Vox replied: {vox_reply}",
                "--wait",
            ]
            if args.notify_audible:
                notify_args.append("--audible")
            else:
                notify_args.append("--silent")
            notify_exec = puckyctl(notify_args, args.broker, token, timeout=90)
            notify_parsed = notify_exec.get("json") or {}
            run["steps"].append(
                {
                    "step": "pucky.return_notification",
                    "required": False,
                    "passed": bool(notify_parsed.get("ok")),
                    "failure": None if notify_parsed.get("ok") else "PUCKY_NOTIFY_FAILED",
                    "execution": notify_exec,
                }
            )
        else:
            run["steps"].append(
                {
                    "step": "pucky.return_notification",
                    "required": False,
                    "passed": False,
                    "failure": "SKIPPED_DEVICE_OFFLINE_OR_NO_VOX_REPLY",
                }
            )

    run["completed_at"] = utc_now()
    run["summary"] = summarize(run)
    write_json(results_path, run)
    write_summary(summary_path, run, results_path)
    print(
        json.dumps(
            {
                "passed": run["summary"]["passed"],
                "results": str(results_path),
                "summary": str(summary_path),
                "vox_replies": run["summary"]["vox_replies"],
                "failures": run["summary"]["failures"],
                "optional_failures": run["summary"]["optional_failures"],
            },
            indent=2,
        )
    )
    return 0 if run["summary"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
