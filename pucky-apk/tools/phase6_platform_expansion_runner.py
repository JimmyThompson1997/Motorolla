#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import pathlib
import subprocess
import time


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
                    try:
                        objects.append(json.loads(text[start:index + 1]))
                    except json.JSONDecodeError:
                        pass
                    break
    for obj in objects:
        if obj.get("schema") == "puckyctl.result.v1":
            return obj
    return objects[-1] if objects else None


def puckyctl(command, broker, token, timeout):
    if broker:
        full = f"python pucky-apk\\puckyctl\\puckyctl.py --json --broker {broker}"
        if token:
            full += f" --token {token}"
        full += f" {command}"
        proc_args = ["powershell", "-NoProfile", "-Command", full]
    else:
        full = "puckyctl --json " + command
        proc_args = ["flyctl", "ssh", "console", "-a", APP, "--command", full]
    started = time.monotonic()
    proc = subprocess.run(proc_args, text=True, capture_output=True, timeout=timeout)
    return {
        "shell_command": full,
        "returncode": proc.returncode,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "json": extract_json("\n".join(part for part in [proc.stdout, proc.stderr] if part)),
    }


def result(parsed):
    value = parsed.get("result") if isinstance(parsed, dict) else None
    return value if isinstance(value, dict) else {}


def error_code(parsed, fallback):
    error = parsed.get("error") if isinstance(parsed, dict) else None
    if isinstance(error, dict):
        return error.get("code") or error.get("message") or fallback
    return fallback


def step(test_id, command, validate, ctx, timeout=120):
    record = {"test_id": test_id, "command": command, "started_at": utc_now()}
    try:
        execution = puckyctl(command, ctx["broker"], ctx["token"], timeout)
        parsed = execution.get("json") or {}
        passed = bool(parsed.get("ok"))
        failure = None if passed else error_code(parsed, "COMMAND_FAILED")
        extra = {}
        if passed and validate:
            passed, failure, extra = validate(parsed, ctx)
        record.update({
            "completed_at": utc_now(),
            "passed": passed,
            "failure": failure,
            "extra": extra or {},
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
    return record


def validate_online(parsed, ctx):
    for device in result(parsed).get("devices") or []:
        if device.get("device_id") == DEVICE_ID and device.get("online"):
            return True, None, {}
    return False, "DEVICE_NOT_ONLINE", {}


def validate_capabilities(parsed, ctx):
    value = result(parsed)
    probe = value.get("probe") if isinstance(value.get("probe"), dict) else {}
    probe_result = probe.get("result") if isinstance(probe.get("result"), dict) else {}
    caps = probe_result.get("capabilities") or value.get("capabilities") or []
    commands = {item.get("command") for item in caps if isinstance(item, dict)}
    required = {"file.download", "media.state.get", "media.key", "media.open_uri"}
    missing = sorted(required - commands)
    if missing:
        return False, "CAPABILITIES_MISSING_" + ",".join(missing), {}
    return True, None, {"commands": sorted(required)}


def validate_download(parsed, ctx):
    value = result(parsed)
    if value.get("bytes", 0) <= 0:
        return False, "DOWNLOAD_EMPTY", {}
    if not value.get("sha256") or not value.get("path"):
        return False, "DOWNLOAD_METADATA_INCOMPLETE", {}
    ctx["download_path"] = value["path"]
    return True, None, {"path": value["path"], "bytes": value.get("bytes"), "sha256": value.get("sha256")}


def validate_artifact_list(parsed, ctx):
    path = ctx.get("download_path")
    artifacts = result(parsed).get("artifacts") or []
    if path and any(item.get("device_path") == path for item in artifacts):
        return True, None, {"artifact_count": len(artifacts)}
    return False, "DOWNLOADED_ARTIFACT_NOT_LISTED", {"artifact_count": len(artifacts), "path": path}


def validate_artifact_hash(parsed, ctx):
    value = result(parsed)
    if value.get("sha256") and value.get("bytes", 0) > 0:
        return True, None, {"sha256": value.get("sha256")}
    return False, "ARTIFACT_HASH_MISSING", {}


def validate_media_state(parsed, ctx):
    value = result(parsed)
    if value.get("available") is True and "music_volume" in value:
        return True, None, {"music_active": value.get("music_active"), "music_volume": value.get("music_volume")}
    return False, "MEDIA_STATE_INCOMPLETE", {}


def validate_media_key(parsed, ctx):
    value = result(parsed)
    if value.get("dispatched") is True and value.get("best_effort") is True:
        return True, None, {"action": value.get("action"), "key_code": value.get("key_code")}
    return False, "MEDIA_KEY_NOT_DISPATCHED", {}


def validate_media_open(parsed, ctx):
    value = result(parsed)
    if value.get("launched") is True:
        return True, None, {"uri": value.get("uri"), "user_mediated": value.get("user_mediated")}
    return False, "MEDIA_URI_NOT_LAUNCHED", {}


def validate_delete(parsed, ctx):
    value = result(parsed)
    if value.get("deleted") is True:
        return True, None, {"path": value.get("path")}
    return False, "ARTIFACT_NOT_DELETED", {"result": value}


def summarize(records):
    return {
        "total": len(records),
        "passed": sum(1 for item in records if item["passed"]),
        "failed": sum(1 for item in records if not item["passed"]),
        "failures": [
            {"test_id": item["test_id"], "failure": item["failure"], "command": item["command"]}
            for item in records
            if not item["passed"]
        ],
    }


def write_summary(path, run):
    summary = run["summary"]
    lines = [
        "# Pucky Phase 6 Platform Expansion Summary",
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
            lines.append(f"- `{failure['test_id']}`: {failure['failure']} via `{failure['command']}`")
    lines.extend([
        "",
        "## Notes",
        "",
        "- `media.key` is best-effort: dispatch success does not prove a third-party media app acted.",
        "- `media.open_uri` is user-mediated and may open a browser, resolver, or media app depending on Android state.",
        "- `file.download` stores content in Pucky app-owned storage, not the public Android media library.",
    ])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", default="phase6-platform")
    parser.add_argument("--broker", default="")
    parser.add_argument("--token", default="operator-dev-token")
    parser.add_argument("--download-url", default="https://pucky-bridge-dev-jt323.fly.dev/health")
    parser.add_argument("--download-filename", default="phase6-health.json")
    parser.add_argument("--media-uri", default="https://www.example.com/")
    parser.add_argument("--skip-media-open", action="store_true")
    args = parser.parse_args()

    EVIDENCE_DIR.mkdir(exist_ok=True)
    ctx = {"broker": args.broker, "token": args.token}
    records = []

    tests = [
        ("presence.devices", "devices", validate_online, 60),
        ("capabilities.phase6", "capabilities --refresh", validate_capabilities, 120),
        (
            "file.download",
            f"file download {args.download_url} --filename {args.download_filename} --max-bytes 1048576",
            validate_download,
            120,
        ),
        ("artifact.list.download", "artifact-local list", validate_artifact_list, 120),
        ("artifact.hash.download", None, validate_artifact_hash, 120),
        ("media.state", "media state", validate_media_state, 60),
        ("media.key.play_pause", "media key play_pause", validate_media_key, 60),
    ]
    if not args.skip_media_open:
        tests.append(("media.open_uri", f"media open-uri {args.media_uri}", validate_media_open, 60))
        tests.append(("media.key.pause_cleanup", "media key pause", validate_media_key, 60))
    tests.append(("artifact.delete.download", None, validate_delete, 120))

    for test_id, command, validate, timeout in tests:
        if test_id == "artifact.hash.download":
            command = "artifact-local hash --path " + json.dumps(ctx.get("download_path", ""))[1:-1]
        if test_id == "artifact.delete.download":
            command = "artifact-local delete --path " + json.dumps(ctx.get("download_path", ""))[1:-1]
        print(f"[{len(records) + 1}/{len(tests)}] {test_id} :: {command}")
        record = step(test_id, command, validate, ctx, timeout=timeout)
        records.append(record)
        print("  " + ("PASS" if record["passed"] else "FAIL " + str(record["failure"])))

    run = {
        "schema": "pucky.phase6_platform_expansion_results.v1",
        "started_at": records[0]["started_at"] if records else utc_now(),
        "completed_at": utc_now(),
        "device_id": DEVICE_ID,
        "records": records,
        "summary": summarize(records),
    }
    json_path = EVIDENCE_DIR / f"{args.prefix}-phase6-platform-expansion-results.json"
    summary_path = EVIDENCE_DIR / f"{args.prefix}-phase6-platform-expansion-summary.md"
    json_path.write_text(json.dumps(run, indent=2, sort_keys=True), encoding="utf-8")
    write_summary(summary_path, run)
    print(json.dumps({
        "ok": run["summary"]["failed"] == 0,
        "json_path": str(json_path),
        "summary_path": str(summary_path),
        "summary": run["summary"],
    }, indent=2))
    return 0 if run["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
