#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import pathlib
import time

from phase4_exhaustive_runner import APP, DEVICE_ID, EVIDENCE_DIR, delivery_stage, fly_puckyctl


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def summarize(records):
    by_stage = {}
    offline = 0
    command_failures = 0
    for record in records:
        for probe in record["probes"]:
            stage = probe.get("delivery_stage")
            bucket = by_stage.setdefault(stage, 0)
            by_stage[stage] = bucket + 1
            parsed = probe.get("json") or {}
            if stage and stage.startswith("not_delivered"):
                offline += 1
            if parsed.get("status") == "failed":
                command_failures += 1
    return {
        "samples": len(records),
        "probe_count": sum(len(item["probes"]) for item in records),
        "by_delivery_stage": by_stage,
        "not_delivered_count": offline,
        "apk_failed_count": command_failures,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", default=dt.datetime.now().strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--minutes", type=float, default=10.0)
    parser.add_argument("--interval", type=float, default=60.0)
    args = parser.parse_args()

    EVIDENCE_DIR.mkdir(exist_ok=True)
    deadline = time.monotonic() + max(0.1, args.minutes) * 60
    records = []
    index = 0
    while time.monotonic() < deadline:
        index += 1
        item = {"sample": index, "timestamp": utc_now(), "probes": []}
        for label, command in [
            ("devices", "devices"),
            ("service", "service status"),
            ("network", "network"),
            ("battery", "battery"),
            ("ping", "command ping --arg monitor=phase4_reception --wait"),
        ]:
            execution = fly_puckyctl(command, timeout=90)
            parsed = execution.get("json")
            item["probes"].append({
                "label": label,
                "command": command,
                "delivery_stage": delivery_stage(parsed),
                "ok": None if parsed is None else parsed.get("ok"),
                "status": None if parsed is None else parsed.get("status"),
                "command_id": None if parsed is None else parsed.get("command_id"),
                "json": parsed,
                "returncode": execution["returncode"],
                "duration_ms": execution["duration_ms"],
            })
        records.append(item)
        print(json.dumps({
            "sample": index,
            "timestamp": item["timestamp"],
            "stages": [probe["delivery_stage"] for probe in item["probes"]],
        }), flush=True)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(args.interval, remaining))

    run = {
        "schema": "pucky.phase4_reception_monitor.v1",
        "started_at": records[0]["timestamp"] if records else utc_now(),
        "completed_at": utc_now(),
        "app": APP,
        "device_id": DEVICE_ID,
        "minutes_requested": args.minutes,
        "interval_seconds": args.interval,
        "records": records,
        "summary": summarize(records),
    }
    out = EVIDENCE_DIR / f"{args.prefix}-phase4-reception-monitor.json"
    out.write_text(json.dumps(run, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({"path": str(out), "summary": run["summary"]}, indent=2, sort_keys=True), flush=True)
    return 0 if run["summary"]["not_delivered_count"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
