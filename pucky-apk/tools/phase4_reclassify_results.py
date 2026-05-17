#!/usr/bin/env python3
import json
import pathlib
import sys

from phase4_exhaustive_runner import delivery_stage, summarize, write_summary


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: phase4_reclassify_results.py RESULTS_JSON")
    path = pathlib.Path(sys.argv[1])
    data = json.loads(path.read_text(encoding="utf-8"))
    for result in data.get("results", []):
        execution = result.get("execution") or {}
        result["delivery_stage"] = delivery_stage(execution.get("json"))
    data["summary"] = summarize(data.get("results", []))
    path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    summary_path = path.with_name(path.name.replace("-results.json", "-summary.md"))
    write_summary(summary_path, data)
    print(json.dumps({
        "json_path": str(path),
        "summary_path": str(summary_path),
        "summary": data["summary"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    raise SystemExit(main())
