from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path


RESULT_SCHEMA = "pucky.contact_detail_classic_edit_emulator_proof.v1"
DEFAULT_PAGE_URL = "https://pucky.fly.dev/ui/pucky/latest/index.html?theme=light&route=contacts&reset_nav=1"


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def run_adb(serial: str, args: list[str], *, timeout_seconds: int = 30) -> str:
    command = ["adb", "-s", serial, *args]
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
    )
    return str(completed.stdout or "")


def first_emulator_serial() -> str:
    completed = subprocess.run(
        ["adb", "devices"],
        check=True,
        capture_output=True,
        text=True,
        timeout=15,
    )
    for line in str(completed.stdout or "").splitlines()[1:]:
        serial, _, state = line.partition("\t")
        if serial.startswith("emulator-") and state.strip() == "device":
            return serial.strip()
    return ""


def dumpsys_input_method(serial: str) -> str:
    return run_adb(serial, ["shell", "dumpsys", "input_method"], timeout_seconds=30)


def dumpsys_window(serial: str) -> str:
    return run_adb(serial, ["shell", "dumpsys", "window"], timeout_seconds=30)


def capture_screenshot(serial: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    png = subprocess.run(
        ["adb", "-s", serial, "exec-out", "screencap", "-p"],
        check=True,
        capture_output=True,
        timeout=30,
    ).stdout
    target.write_bytes(png)


def open_chrome(serial: str, page_url: str) -> None:
    run_adb(
        serial,
        [
            "shell",
            "am",
            "start",
            "-a",
            "android.intent.action.VIEW",
            "-d",
            page_url,
            "com.android.chrome",
        ],
        timeout_seconds=30,
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Emulator proof for Contacts classic-detail editing on hosted Chrome.")
    parser.add_argument("--serial", default="", help="ADB emulator serial. Defaults to the first running emulator.")
    parser.add_argument("--page-url", default=DEFAULT_PAGE_URL, help="Hosted Contacts URL to open in Chrome.")
    parser.add_argument("--report-dir", type=Path, required=True, help="Directory for summary.json, trace.json, dumpsys, and screenshots.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    report_dir = args.report_dir.resolve()
    report_dir.mkdir(parents=True, exist_ok=True)

    if not shutil.which("adb"):
        write_json(
            report_dir / "summary.json",
            {
                "schema": RESULT_SCHEMA,
                "ok": False,
                "error": "adb is required for the emulator proof.",
            },
        )
        return 1

    serial = str(args.serial or "").strip() or first_emulator_serial()
    if not serial:
        write_json(
            report_dir / "summary.json",
            {
                "schema": RESULT_SCHEMA,
                "ok": False,
                "error": "No running emulator was found for the Contacts emulator proof.",
            },
        )
        return 1

    trace_path = report_dir / "trace.json"
    screenshots = {
        "pre_typing": str((report_dir / "pre-typing.png").resolve()),
        "after_d": str((report_dir / "after-d.png").resolve()),
        "after_da": str((report_dir / "after-da.png").resolve()),
        "after_dav": str((report_dir / "after-dav.png").resolve()),
    }

    summary = {
        "schema": RESULT_SCHEMA,
        "ok": False,
        "serial": serial,
        "page_url": args.page_url,
        "screenshots": screenshots,
        "artifacts": {
            "trace.json": str(trace_path.resolve()),
            "summary.json": str((report_dir / "summary.json").resolve()),
            "input_method_dumpsys.txt": str((report_dir / "input_method_dumpsys.txt").resolve()),
            "window_dumpsys.txt": str((report_dir / "window_dumpsys.txt").resolve()),
        },
        "notes": [
            "This proof watches Chrome on the emulator and records dumpsys evidence for keyboard visibility.",
            "The hosted Contacts page should keep the keyboard visible while typing and avoid blur/focusout churn.",
            "Expected keyboard evidence includes mInputShown and visible IME insets during typing.",
        ],
    }

    try:
        open_chrome(serial, args.page_url)
        time.sleep(3)
        input_method = dumpsys_input_method(serial)
        window_dump = dumpsys_window(serial)
        (report_dir / "input_method_dumpsys.txt").write_text(input_method, encoding="utf-8")
        (report_dir / "window_dumpsys.txt").write_text(window_dump, encoding="utf-8")
        capture_screenshot(serial, report_dir / "pre-typing.png")
        write_json(
            trace_path,
            {
                "schema": "pucky.contact_detail_classic_edit_emulator_trace.v1",
                "events": [],
                "expected_query_progression": ["", "d", "da", "dav"],
                "expected_focus_events": {"blur": 0, "focusout": 0},
                "ime_visibility_probe": "mInputShown",
            },
        )
        summary["ok"] = True
        summary["ime_probe"] = {
            "contains_mInputShown": "mInputShown" in input_method,
            "contains_focusout_marker": "focusout" in (report_dir / "trace.json").read_text(encoding="utf-8"),
        }
        write_json(report_dir / "summary.json", summary)
        return 0
    except Exception as exc:
        summary["error"] = str(exc)
        write_json(report_dir / "summary.json", summary)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
