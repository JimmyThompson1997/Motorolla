from __future__ import annotations

import argparse
import json
import math
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


def utc_stamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def shared_prefs_xml_text(
    run_adb_fn: Callable[..., str],
    args: argparse.Namespace,
    serial: str,
    *,
    prefs_name: str,
    timeout_seconds: int | float = 30,
) -> str:
    return run_adb_fn(
        args,
        serial,
        ["shell", "run-as", args.package_name, "cat", f"shared_prefs/{prefs_name}.xml"],
        timeout_seconds=timeout_seconds,
    )


def parse_named_float_pref(xml_text: str, pref_name: str) -> float | None:
    match = re.search(rf'name="{re.escape(pref_name)}"\s+value="([^"]+)"', str(xml_text or ""))
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def relaunch_activity(
    run_adb_fn: Callable[..., str],
    args: argparse.Namespace,
    serial: str,
    *,
    timeout_seconds: int | float = 30,
    settle_seconds: float = 2.0,
) -> None:
    run_adb_fn(
        args,
        serial,
        ["shell", "am", "start", "-n", f"{args.package_name}/{args.activity_name}"],
        timeout_seconds=timeout_seconds,
    )
    time.sleep(settle_seconds)


def operation_text(payload: dict[str, Any]) -> str:
    for item in reversed(list(payload.get("operations") or [])):
        if item.get("kind") == "text_content":
            return str(item.get("text") or "").strip()
    return ""


def route_of(payload: dict[str, Any]) -> str:
    final_surface = payload.get("final_surface")
    if isinstance(final_surface, dict):
        return str(final_surface.get("route") or "").strip()
    return ""


def ensure_route(payload: dict[str, Any], expected: str, label: str, *, error_cls: type[Exception]) -> None:
    actual = route_of(payload)
    if actual != expected:
        raise error_cls(f"{label} expected route {expected}, got {actual or 'missing'}")


def wait_for_numeric_field(
    wait_for_fn: Callable[..., Any],
    read_fn: Callable[[], dict[str, Any]],
    *,
    field_name: str,
    expected_value: float,
    description: str,
    abs_tol: float = 0.01,
    timeout_seconds: int | float = 20,
    interval_seconds: float = 0.5,
) -> dict[str, Any]:
    def check() -> dict[str, Any] | None:
        payload = read_fn()
        try:
            numeric = float(payload.get(field_name))
        except (TypeError, ValueError):
            return None
        if math.isclose(numeric, float(expected_value), abs_tol=abs_tol):
            return payload
        return None

    return wait_for_fn(
        check,
        timeout_seconds=timeout_seconds,
        interval_seconds=interval_seconds,
        description=description,
    )
