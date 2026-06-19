from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import tools.support.phone_proof_shared as phone_shared
import tools.proofs.phone.phone_walkie_thread_proof as proof
import tools.refresh_pucky_html_official as official_html


ROOT = Path(__file__).resolve().parents[3]
CANONICAL_REPO_ROOT = Path(r"C:\Users\jimmy\Desktop\Motorolla-master-ui")
RESULT_SCHEMA = "pucky.cover_archive_swipe_phone_proof.v1"
DEFAULT_ACTIVITY_NAME = "com.pucky.device.CoverHomeActivity"
DEFAULT_INPUT_DISPLAY_ID = "3"


class CoverArchiveSwipeProofError(RuntimeError):
    pass


def card_session_id(card: dict[str, Any]) -> str:
    return str(card.get("session_id") or card.get("turn_id") or "").strip()


def card_title(card: dict[str, Any]) -> str:
    return str(card.get("title") or card.get("summary") or card.get("preview") or "").strip()


def cards_by_session(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for card in proof.cards_from_snapshot(snapshot):
        session_id = card_session_id(card)
        if session_id:
            result[session_id] = card
    return result


def first_visible_unarchived_card(surface_snapshot: dict[str, Any], card_snapshot: dict[str, Any]) -> dict[str, Any]:
    snapshot_cards = cards_by_session(card_snapshot)
    for visible in proof.visible_cards(surface_snapshot):
        session_id = card_session_id(visible)
        if not session_id:
            continue
        card = snapshot_cards.get(session_id, visible)
        if not bool(card.get("archived")):
            return card
    raise CoverArchiveSwipeProofError("No visible unarchived card was available on the cover feed")


def top_visible_session_id(surface_snapshot: dict[str, Any]) -> str:
    visible = proof.visible_cards(surface_snapshot)
    return card_session_id(visible[0]) if visible else ""


def surface_route(surface_snapshot: dict[str, Any]) -> str:
    final_surface = surface_snapshot.get("final_surface")
    if isinstance(final_surface, dict):
        return str(final_surface.get("route") or "").strip()
    return str(surface_snapshot.get("route") or "").strip()


def png_dimensions(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise CoverArchiveSwipeProofError(f"{path} is not a PNG screenshot")
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    if width <= 0 or height <= 0:
        raise CoverArchiveSwipeProofError(f"{path} had invalid dimensions {width}x{height}")
    return width, height


def cover_archive_swipe_motion(width: int, height: int) -> dict[str, int]:
    return {
        "start_x": round(width * 0.20),
        "move_35_x": round(width * 0.35),
        "move_50_x": round(width * 0.50),
        "armed_x": round(width * 0.65),
        "end_x": round(width * 0.80),
        "y": round(height * 0.28),
        "step_delay_ms": 120,
        "armed_pause_ms": 180,
        "swipe_duration_ms": 560,
    }


def build_cover_motionevent_steps(input_display_id: str, motion: dict[str, int]) -> list[dict[str, Any]]:
    display_id = str(input_display_id).strip() or DEFAULT_INPUT_DISPLAY_ID

    def command(action: str, x: int) -> list[str]:
        return [
            "shell",
            "input",
            "touchscreen",
            "-d",
            display_id,
            "motionevent",
            action,
            str(x),
            str(motion["y"]),
        ]

    return [
        {"label": "down", "adb_args": command("DOWN", motion["start_x"])},
        {"label": "move_35", "adb_args": command("MOVE", motion["move_35_x"])},
        {"label": "move_50", "adb_args": command("MOVE", motion["move_50_x"])},
        {"label": "move_armed", "adb_args": command("MOVE", motion["armed_x"])},
        {"label": "move_end", "adb_args": command("MOVE", motion["end_x"])},
        {"label": "up", "adb_args": command("UP", motion["end_x"])},
    ]


def fallback_swipe_command(input_display_id: str, motion: dict[str, int]) -> list[str]:
    display_id = str(input_display_id).strip() or DEFAULT_INPUT_DISPLAY_ID
    return [
        "shell",
        "input",
        "touchscreen",
        "-d",
        display_id,
        "swipe",
        str(motion["start_x"]),
        str(motion["y"]),
        str(motion["end_x"]),
        str(motion["y"]),
        str(motion["swipe_duration_ms"]),
    ]


def resolve_cover_input_display_id(args: argparse.Namespace, serial: str) -> str:
    if str(args.input_display_id or "").strip():
        return str(args.input_display_id).strip()
    text = proof.run_adb(args, serial, ["shell", "dumpsys", "display"], timeout_seconds=30)
    candidates = [int(value) for value in re.findall(r"mDisplayId=(\d+)", text) if int(value) > 0]
    return str(max(candidates)) if candidates else DEFAULT_INPUT_DISPLAY_ID


def ensure_feed_surface(args: argparse.Namespace, serial: str) -> dict[str, Any]:
    phone_shared.relaunch_activity(
        proof.run_adb,
        args,
        serial,
        timeout_seconds=30,
        settle_seconds=2.0,
    )
    try:
        proof.run_pucky_command(args, "ui.debug.goto_home", {}, timeout_seconds=20)
        time.sleep(1.0)
    except Exception:
        # Relaunch already targets CoverHomeActivity; keep going if goto_home is unavailable.
        pass
    def feed_surface() -> dict[str, Any] | None:
        surface = proof.snapshot_surface(args)
        return surface if surface_route(surface) == "feed" else None

    surface = proof.wait_for(
        feed_surface,
        timeout_seconds=20,
        interval_seconds=1.0,
        description="cover feed route",
    )
    if surface_route(surface) != "feed":
        raise CoverArchiveSwipeProofError("cover archive proof expected route feed")
    return surface


def wait_for_archived_card(args: argparse.Namespace, session_id: str, *, description: str) -> dict[str, Any]:
    def predicate() -> dict[str, Any] | None:
        snapshot = proof.snapshot_cards(args)
        card = cards_by_session(snapshot).get(session_id)
        if card and bool(card.get("archived")):
            return snapshot
        return None

    return proof.wait_for(
        predicate,
        timeout_seconds=12,
        interval_seconds=0.75,
        description=description,
    )


def execute_staged_archive_swipe(
    args: argparse.Namespace,
    *,
    serial: str,
    input_display_id: str,
    motion: dict[str, int],
    armed_screenshot_path: Path,
) -> dict[str, Any]:
    steps = build_cover_motionevent_steps(input_display_id, motion)
    executed_labels: list[str] = []
    for index, step in enumerate(steps):
        proof.run_adb(args, serial, step["adb_args"], timeout_seconds=15)
        executed_labels.append(str(step["label"]))
        if step["label"] == "move_armed":
            time.sleep(motion["armed_pause_ms"] / 1000)
            proof.capture_device_screenshot(args, serial, armed_screenshot_path)
        elif index < len(steps) - 1:
            time.sleep(motion["step_delay_ms"] / 1000)
    return {
        "executed_labels": executed_labels,
        "motion": motion,
        "input_display_id": str(input_display_id),
    }


def execute_fallback_archive_swipe(
    args: argparse.Namespace,
    *,
    serial: str,
    input_display_id: str,
    motion: dict[str, int],
) -> dict[str, Any]:
    adb_args = fallback_swipe_command(input_display_id, motion)
    proof.run_adb(args, serial, adb_args, timeout_seconds=20)
    return {
        "adb_args": adb_args,
        "motion": motion,
        "input_display_id": str(input_display_id),
    }


def summary_checks(
    *,
    identity_checks: dict[str, Any],
    selected_card: dict[str, Any],
    before_surface: dict[str, Any],
    after_surface: dict[str, Any],
    final_snapshot: dict[str, Any],
) -> dict[str, Any]:
    session_id = card_session_id(selected_card)
    final_card = cards_by_session(final_snapshot).get(session_id) or {}
    checks = {
        "identity_checks_passed": bool(identity_checks.get("passed")),
        "selected_card_present": bool(session_id),
        "selected_card_unarchived_before": bool(selected_card) and not bool(selected_card.get("archived")),
        "selected_card_archived_after": bool(final_card.get("archived")),
        "top_visible_card_changed": top_visible_session_id(before_surface) != top_visible_session_id(after_surface),
    }
    return proof.scenario_checks(checks)


def run(args: argparse.Namespace) -> dict[str, Any]:
    local_git = proof.require_official_local_repo(args.repo_root, args.canonical_root) if not args.skip_official_preproof_check else proof.local_git_state(args.repo_root)
    serial = proof.resolve_adb_serial(args)
    input_display_id = resolve_cover_input_display_id(args, serial)

    bundle = proof.bundle_status(args)
    installed_package = proof.installed_package_info(args, serial)
    identity = proof.apk_identity(args)
    remote_manifest = proof.expected_ui_manifest(args, local_git)

    surface_before = ensure_feed_surface(args, serial)
    snapshot_before = proof.snapshot_cards(args)
    identity_checks = (
        proof.scenario_checks(
            {
                "bundle_installed": bool(bundle.get("installed")),
                "surface_present": bool(surface_before),
                "apk_identity_present": bool(identity),
            }
        )
        if args.skip_official_preproof_check
        else proof.verify_target_identity(
            args,
            local_git=local_git,
            remote_manifest=remote_manifest,
            bundle=bundle,
            surface=surface_before,
            installed_package=installed_package,
            identity=identity,
        )
    )

    selected_card = first_visible_unarchived_card(surface_before, snapshot_before)
    selected_session_id = card_session_id(selected_card)
    if not selected_session_id:
        raise CoverArchiveSwipeProofError("Selected cover card had no session_id")

    scenario_dir = args.evidence_dir / f"cover-archive-proof-{int(time.time())}"
    scenario_dir.mkdir(parents=True, exist_ok=True)
    before_png = proof.capture_device_screenshot(args, serial, scenario_dir / "01-cover-before.png")
    phone_shared.save_json(scenario_dir / "reply_cards.before.json", snapshot_before)
    phone_shared.save_json(scenario_dir / "ui.surface.before.json", surface_before)

    width, height = png_dimensions(before_png)
    motion = cover_archive_swipe_motion(width, height)

    staged_result = execute_staged_archive_swipe(
        args,
        serial=serial,
        input_display_id=input_display_id,
        motion=motion,
        armed_screenshot_path=scenario_dir / "02-cover-archive-swipe-armed.png",
    )

    fallback_result: dict[str, Any] | None = None
    try:
        final_snapshot = wait_for_archived_card(args, selected_session_id, description=f"archive swipe for {selected_session_id}")
    except Exception:
        fallback_result = execute_fallback_archive_swipe(
            args,
            serial=serial,
            input_display_id=input_display_id,
            motion=motion,
        )
        final_snapshot = wait_for_archived_card(args, selected_session_id, description=f"fallback archive swipe for {selected_session_id}")

    after_surface = proof.snapshot_surface(args)
    after_png = proof.capture_device_screenshot(args, serial, scenario_dir / "03-cover-after-adb-swipe.png")
    phone_shared.save_json(scenario_dir / "reply_cards.after-adb.json", final_snapshot)
    phone_shared.save_json(scenario_dir / "ui.surface.after.json", after_surface)

    checks = summary_checks(
        identity_checks=identity_checks,
        selected_card=selected_card,
        before_surface=surface_before,
        after_surface=after_surface,
        final_snapshot=final_snapshot,
    )
    if not checks["passed"]:
        raise CoverArchiveSwipeProofError(f"archive swipe checks failed: {json.dumps(checks['checks'], sort_keys=True)}")

    summary = {
        "ok": True,
        "schema": RESULT_SCHEMA,
        "repo_root": str(args.repo_root),
        "canonical_root": str(args.canonical_root),
        "serial": serial,
        "input_display_id": input_display_id,
        "local_git": local_git,
        "bundle_status": bundle,
        "installed_package": installed_package,
        "apk_identity": identity,
        "identity_checks": identity_checks,
        "selected_card": {
            "session_id": selected_session_id,
            "title": card_title(selected_card),
            "archived_before": bool(selected_card.get("archived")),
        },
        "staged_swipe": staged_result,
        "fallback_swipe": fallback_result,
        "artifacts": {
            "before_png": str(before_png),
            "armed_png": str(scenario_dir / "02-cover-archive-swipe-armed.png"),
            "after_png": str(after_png),
            "cards_before": str(scenario_dir / "reply_cards.before.json"),
            "cards_after": str(scenario_dir / "reply_cards.after-adb.json"),
            "surface_before": str(scenario_dir / "ui.surface.before.json"),
            "surface_after": str(scenario_dir / "ui.surface.after.json"),
        },
        "checks": checks,
    }
    phone_shared.save_json(scenario_dir / "summary.json", summary)
    return summary


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prove cover-screen archive swipe using live ADB gestures and screenshots.")
    parser.add_argument("--broker", default=os.environ.get("PUCKY_BROKER_URL", proof.DEFAULT_BROKER_URL))
    parser.add_argument("--token", default=os.environ.get("PUCKY_OPERATOR_TOKEN", ""))
    parser.add_argument("--device-id", default=os.environ.get("PUCKY_DEVICE_ID", ""))
    parser.add_argument("--serial", default=os.environ.get("PUCKY_PHONE_SERIAL", ""))
    parser.add_argument("--repo-root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--canonical-root", type=Path, default=CANONICAL_REPO_ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--puckyctl", type=Path, default=ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py", help=argparse.SUPPRESS)
    parser.add_argument("--adb", type=Path, default=Path(r"C:\Users\jimmy\Desktop\Android\tools\android-sdk\platform-tools\adb.exe"), help=argparse.SUPPRESS)
    parser.add_argument("--vm-base-url", default=official_html.DEFAULT_VM_BASE_URL)
    parser.add_argument("--manifest-url", default="")
    parser.add_argument("--package-name", default="com.pucky.device.debug")
    parser.add_argument("--activity-name", default=DEFAULT_ACTIVITY_NAME)
    parser.add_argument("--input-display-id", default="")
    parser.add_argument("--command-timeout-seconds", type=int, default=120)
    parser.add_argument("--skip-official-preproof-check", action="store_true")
    parser.add_argument("--evidence-dir", type=Path, default=ROOT / ".tmp" / "cover-archive-swipe-phone-proof")
    args = parser.parse_args(argv)
    args.repo_root = args.repo_root.resolve()
    args.canonical_root = args.canonical_root.resolve()
    args.puckyctl = args.puckyctl.resolve()
    args.adb = args.adb.resolve() if isinstance(args.adb, Path) and args.adb.exists() else args.adb
    args.evidence_dir = args.evidence_dir.resolve()
    args.vm_base_url = str(args.vm_base_url).rstrip("/")
    args.manifest_url = str(args.manifest_url or official_html.urljoin(args.vm_base_url + "/", official_html.DEFAULT_MANIFEST_PATH.lstrip("/")))
    return args


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        result = run(args)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
