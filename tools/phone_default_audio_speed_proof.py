from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any

import tools.phone_proof_shared as phone_shared
import tools.phone_walkie_thread_proof as proof
import tools.refresh_pucky_html_official as official_html


ROOT = Path(__file__).resolve().parents[1]
CANONICAL_REPO_ROOT = Path(r"C:\Users\jimmy\Desktop\Motorolla-master-ui")
RESULT_SCHEMA = "pucky.default_audio_speed_phone_proof.v1"
DEFAULT_ACTIVITY_NAME = "com.pucky.device.CoverHomeActivity"
SETTINGS_VALUE_SELECTOR = '[data-setting-id="default-audio-speed"] .settings-card-value'
AUDIO_SPEED_SELECTOR = "#detail .control-speed"


class DefaultAudioSpeedProofError(RuntimeError):
    pass


def speed_attr_value(speed: float) -> str:
    rounded = round(float(speed), 2)
    if math.isclose(rounded, round(rounded), abs_tol=1e-9):
        return str(int(round(rounded)))
    return f"{rounded:g}"


def format_speed_text(speed: float) -> str:
    return f"{speed_attr_value(speed)}x"


def settings_speed_ops(speed: float) -> list[dict[str, Any]]:
    return [
        {"kind": "goto_home"},
        {"kind": "click_selector", "selector": '[data-route="settings"]'},
        {"kind": "wait_for_selector", "selector": '[data-setting-id="default-audio-speed"]'},
        {"kind": "click_selector", "selector": '[data-setting-id="default-audio-speed"]'},
        {"kind": "wait_for_selector", "selector": "#speedOverlay.is-open"},
        {"kind": "click_selector", "selector": f'[data-speed-value="{speed_attr_value(speed)}"]'},
        {"kind": "wait_for_text", "selector": SETTINGS_VALUE_SELECTOR, "text": format_speed_text(speed)},
        {"kind": "text_content", "selector": SETTINGS_VALUE_SELECTOR},
        {"kind": "describe"},
    ]


def audio_detail_open_ops(session_id: str, expected_speed: float) -> list[dict[str, Any]]:
    return [
        {"kind": "goto_home"},
        {"kind": "open_card_action", "session_id": session_id, "action": "audio", "expected_detail_type": "audio"},
        {"kind": "wait_for_text", "selector": AUDIO_SPEED_SELECTOR, "text": format_speed_text(expected_speed)},
        {"kind": "text_content", "selector": AUDIO_SPEED_SELECTOR},
        {"kind": "describe"},
    ]


def audio_detail_override_ops(speed: float) -> list[dict[str, Any]]:
    return [
        {"kind": "click_selector", "selector": AUDIO_SPEED_SELECTOR},
        {"kind": "wait_for_selector", "selector": "#speedOverlay.is-open"},
        {"kind": "click_selector", "selector": f'[data-speed-value="{speed_attr_value(speed)}"]'},
        {"kind": "wait_for_text", "selector": AUDIO_SPEED_SELECTOR, "text": format_speed_text(speed)},
        {"kind": "text_content", "selector": AUDIO_SPEED_SELECTOR},
        {"kind": "describe"},
    ]


def audio_detail_reopen_ops(session_id: str, expected_speed: float) -> list[dict[str, Any]]:
    return [
        {"kind": "back"},
        {"kind": "goto_home"},
        {"kind": "open_card_action", "session_id": session_id, "action": "audio", "expected_detail_type": "audio"},
        {"kind": "wait_for_text", "selector": AUDIO_SPEED_SELECTOR, "text": format_speed_text(expected_speed)},
        {"kind": "text_content", "selector": AUDIO_SPEED_SELECTOR},
        {"kind": "describe"},
    ]


def settings_xml_text(args: argparse.Namespace, serial: str) -> str:
    return phone_shared.shared_prefs_xml_text(
        proof.run_adb,
        args,
        serial,
        prefs_name="pucky_settings",
        timeout_seconds=30,
    )


def parse_default_tile_audio_speed(xml_text: str) -> float | None:
    return phone_shared.parse_named_float_pref(xml_text, "default_tile_audio_speed")


def operation_text(payload: dict[str, Any]) -> str:
    return phone_shared.operation_text(payload)


def relaunch_cover_home(args: argparse.Namespace, serial: str) -> None:
    phone_shared.relaunch_activity(
        proof.run_adb,
        args,
        serial,
        timeout_seconds=30,
        settle_seconds=2.0,
    )


def refresh_feed_surface(args: argparse.Namespace) -> dict[str, Any]:
    result = proof.run_pucky_command(args, "ui.debug.refresh_cards", {}, timeout_seconds=30)
    time.sleep(1.0)
    return result


def wait_for_player_speed(args: argparse.Namespace, expected_speed: float) -> dict[str, Any]:
    return phone_shared.wait_for_numeric_field(
        proof.wait_for,
        lambda: proof.run_pucky_command(args, "player.state", {}, timeout_seconds=20),
        field_name="speed",
        expected_value=expected_speed,
        description=f"player speed {expected_speed}",
    )


def clear_response_fault(args: argparse.Namespace) -> dict[str, Any]:
    return proof.run_pucky_command(args, "pucky.turn.debug.response_fault", {"clear": True}, timeout_seconds=30)


def create_reply_card(
    args: argparse.Namespace,
    *,
    label: str,
    text: str,
    proof_reply_delay_ms: int,
) -> dict[str, Any]:
    fixture = proof.put_fixture_for_text(args, text, label)
    turn_start = proof.start_fixture_turn(
        args,
        str(fixture["remote"]["path"]),
        text,
        proof_reply_delay_ms=proof_reply_delay_ms,
    )
    turn_id = str(turn_start.get("turn_id") or "").strip()
    if not turn_id:
        raise DefaultAudioSpeedProofError(f"{label} did not return a turn_id")
    turn_reply = proof.wait_for_turn_reply_saved(args, turn_id)
    session_id = str(turn_reply.get("session_id") or turn_id).strip()
    if not session_id:
        raise DefaultAudioSpeedProofError(f"{label} did not produce a session_id")
    return {
        "label": label,
        "text": text,
        "fixture": fixture,
        "turn_start": turn_start,
        "turn_reply": turn_reply,
        "turn_id": turn_id,
        "session_id": session_id,
    }


def relaxed_identity(bundle: dict[str, Any], surface: dict[str, Any], identity: dict[str, Any]) -> dict[str, Any]:
    return proof.scenario_checks(
        {
            "bundle_installed": bool(bundle.get("installed")),
            "surface_present": bool(surface),
            "apk_identity_present": bool(identity),
        }
    )


def route_of(payload: dict[str, Any]) -> str:
    return phone_shared.route_of(payload)


def ensure_route(payload: dict[str, Any], expected: str, label: str) -> None:
    phone_shared.ensure_route(payload, expected, label, error_cls=DefaultAudioSpeedProofError)


def run(args: argparse.Namespace) -> dict[str, Any]:
    if args.skip_official_preproof_check:
        local_git = proof.local_git_state(args.repo_root)
    else:
        local_git = proof.require_official_local_repo(args.repo_root, args.canonical_root)
    serial = proof.resolve_adb_serial(args)
    cdp = proof.discover_cover_cdp_url(args, serial)

    bundle = proof.bundle_status(args)
    surface_before = proof.snapshot_surface(args)
    installed_package = proof.installed_package_info(args, serial)
    identity = proof.apk_identity(args)
    remote_manifest = proof.expected_ui_manifest(args, local_git)
    identity_checks = (
        relaxed_identity(bundle, surface_before, identity)
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

    scenario_dir = args.evidence_dir / f"default-audio-speed-proof-{int(time.time())}"
    scenario_dir.mkdir(parents=True, exist_ok=True)

    baseline_settings = proof.capture_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp["cdp_url"],
        operations=settings_speed_ops(args.baseline_speed),
        scenario_dir=scenario_dir,
        browser_json_name="01-settings-baseline.json",
        device_png_name="01-settings-baseline-device.png",
    )
    ensure_route(baseline_settings, "settings", "baseline settings")

    updated_settings = proof.capture_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp["cdp_url"],
        operations=settings_speed_ops(args.default_speed),
        scenario_dir=scenario_dir,
        browser_json_name="02-settings-updated.json",
        device_png_name="02-settings-updated-device.png",
    )
    ensure_route(updated_settings, "settings", "updated settings")

    xml_text = settings_xml_text(args, serial)
    settings_xml_path = scenario_dir / "settings.xml"
    settings_xml_path.write_text(xml_text, encoding="utf-8")
    xml_speed = parse_default_tile_audio_speed(xml_text)
    if xml_speed is None or not math.isclose(xml_speed, args.default_speed, abs_tol=0.01):
        raise DefaultAudioSpeedProofError(
            f"settings xml did not persist default_tile_audio_speed={args.default_speed}: {xml_speed}"
        )

    relaunch_cover_home(args, serial)
    cdp_after_relaunch = proof.discover_cover_cdp_url(args, serial)
    reloaded_settings = proof.capture_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_after_relaunch["cdp_url"],
        operations=[
            {"kind": "goto_home"},
            {"kind": "click_selector", "selector": '[data-route="settings"]'},
            {"kind": "wait_for_selector", "selector": '[data-setting-id="default-audio-speed"]'},
            {"kind": "wait_for_text", "selector": SETTINGS_VALUE_SELECTOR, "text": format_speed_text(args.default_speed)},
            {"kind": "text_content", "selector": SETTINGS_VALUE_SELECTOR},
            {"kind": "describe"},
        ],
        scenario_dir=scenario_dir,
        browser_json_name="03-settings-reloaded.json",
        device_png_name="03-settings-reloaded-device.png",
    )
    ensure_route(reloaded_settings, "settings", "reloaded settings")

    clear_response_fault(args)

    first_text = args.first_text or f"default speed proof one {int(time.time())}"
    second_text = args.second_text or f"default speed proof two {int(time.time()) + 1}"

    first_reply = create_reply_card(
        args,
        label="default-speed-one",
        text=first_text,
        proof_reply_delay_ms=args.proof_reply_delay_ms,
    )
    refresh_feed_surface(args)
    first_audio = proof.capture_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_after_relaunch["cdp_url"],
        operations=audio_detail_open_ops(first_reply["session_id"], args.default_speed),
        scenario_dir=scenario_dir,
        browser_json_name="04-first-audio-default.json",
        device_png_name="04-first-audio-default-device.png",
    )
    first_player_state = wait_for_player_speed(args, args.default_speed)

    first_override = proof.capture_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_after_relaunch["cdp_url"],
        operations=audio_detail_override_ops(args.override_speed),
        scenario_dir=scenario_dir,
        browser_json_name="05-first-audio-override.json",
        device_png_name="05-first-audio-override-device.png",
    )
    first_override_player_state = wait_for_player_speed(args, args.override_speed)

    first_reopen = proof.capture_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_after_relaunch["cdp_url"],
        operations=audio_detail_reopen_ops(first_reply["session_id"], args.override_speed),
        scenario_dir=scenario_dir,
        browser_json_name="06-first-audio-reopen.json",
        device_png_name="06-first-audio-reopen-device.png",
    )
    first_reopen_player_state = wait_for_player_speed(args, args.override_speed)

    second_reply = create_reply_card(
        args,
        label="default-speed-two",
        text=second_text,
        proof_reply_delay_ms=args.proof_reply_delay_ms,
    )
    refresh_feed_surface(args)
    second_audio = proof.capture_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_after_relaunch["cdp_url"],
        operations=audio_detail_open_ops(second_reply["session_id"], args.default_speed),
        scenario_dir=scenario_dir,
        browser_json_name="07-second-audio-default.json",
        device_png_name="07-second-audio-default-device.png",
    )
    second_player_state = wait_for_player_speed(args, args.default_speed)

    checks = proof.scenario_checks(
        {
            "identity_checks": bool(identity_checks.get("passed")),
            "baseline_shows_1x": phone_shared.operation_text(baseline_settings) == format_speed_text(args.baseline_speed),
            "updated_shows_default_speed": phone_shared.operation_text(updated_settings) == format_speed_text(args.default_speed),
            "reloaded_shows_default_speed": phone_shared.operation_text(reloaded_settings) == format_speed_text(args.default_speed),
            "xml_persisted_default_speed": xml_speed is not None and math.isclose(xml_speed, args.default_speed, abs_tol=0.01),
            "first_tile_ui_default_speed": phone_shared.operation_text(first_audio) == format_speed_text(args.default_speed),
            "first_tile_player_default_speed": math.isclose(float(first_player_state.get("speed") or 0), args.default_speed, abs_tol=0.01),
            "first_tile_ui_override_speed": phone_shared.operation_text(first_override) == format_speed_text(args.override_speed),
            "first_tile_player_override_speed": math.isclose(float(first_override_player_state.get("speed") or 0), args.override_speed, abs_tol=0.01),
            "first_tile_reopen_ui_override_speed": phone_shared.operation_text(first_reopen) == format_speed_text(args.override_speed),
            "first_tile_reopen_player_override_speed": math.isclose(float(first_reopen_player_state.get("speed") or 0), args.override_speed, abs_tol=0.01),
            "second_tile_ui_default_speed": phone_shared.operation_text(second_audio) == format_speed_text(args.default_speed),
            "second_tile_player_default_speed": math.isclose(float(second_player_state.get("speed") or 0), args.default_speed, abs_tol=0.01),
        }
    )
    if not checks["passed"]:
        raise DefaultAudioSpeedProofError(f"default audio speed checks failed: {json.dumps(checks['checks'], sort_keys=True)}")

    report = {
        "schema": RESULT_SCHEMA,
        "created_at": phone_shared.utc_stamp(),
        "repo_root": str(args.repo_root),
        "serial": serial,
        "cdp": cdp_after_relaunch,
        "local_git": local_git,
        "remote_manifest": remote_manifest,
        "bundle_status": bundle,
        "surface_before": surface_before,
        "installed_package": installed_package,
        "apk_identity": identity,
        "identity_checks": identity_checks,
        "settings": {
            "baseline_speed": args.baseline_speed,
            "default_speed": args.default_speed,
            "override_speed": args.override_speed,
            "baseline_ui_text": phone_shared.operation_text(baseline_settings),
            "updated_ui_text": phone_shared.operation_text(updated_settings),
            "reloaded_ui_text": phone_shared.operation_text(reloaded_settings),
            "xml_speed": xml_speed,
            "xml_path": str(settings_xml_path),
        },
        "turns": {
            "first": first_reply,
            "second": second_reply,
        },
        "ui": {
            "baseline_settings": baseline_settings,
            "updated_settings": updated_settings,
            "reloaded_settings": reloaded_settings,
            "first_audio": first_audio,
            "first_override": first_override,
            "first_reopen": first_reopen,
            "second_audio": second_audio,
        },
        "player_states": {
            "first_default": first_player_state,
            "first_override": first_override_player_state,
            "first_reopen": first_reopen_player_state,
            "second_default": second_player_state,
        },
        "checks": checks,
    }
    report_path = scenario_dir / "summary.json"
    phone_shared.save_json(report_path, report)
    return {
        "ok": True,
        "schema": RESULT_SCHEMA,
        "report_path": str(report_path),
        "scenario_dir": str(scenario_dir),
        "checks": checks,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prove default tile playback speed on a live Pucky device.")
    parser.add_argument("--broker", default=None)
    parser.add_argument("--token", default=None)
    parser.add_argument("--device-id", default=None)
    parser.add_argument("--serial", default=None)
    parser.add_argument("--repo-root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--canonical-root", type=Path, default=CANONICAL_REPO_ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--browser-helper", type=Path, default=ROOT / "tools" / "phone_walkie_thread_proof_browser.js", help=argparse.SUPPRESS)
    parser.add_argument("--puckyctl", type=Path, default=ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py", help=argparse.SUPPRESS)
    parser.add_argument("--node", type=Path, default=proof.bundled_node_executable(), help=argparse.SUPPRESS)
    parser.add_argument("--node-modules", type=Path, default=proof.bundled_node_modules(), help=argparse.SUPPRESS)
    parser.add_argument("--adb", type=Path, default=Path(r"C:\Users\jimmy\Desktop\Android\tools\android-sdk\platform-tools\adb.exe"), help=argparse.SUPPRESS)
    parser.add_argument("--command-timeout-seconds", type=int, default=120)
    parser.add_argument("--browser-timeout-seconds", type=int, default=45)
    parser.add_argument("--devtools-port", type=int, default=9222)
    parser.add_argument("--vm-base-url", default=official_html.DEFAULT_VM_BASE_URL)
    parser.add_argument("--manifest-url", default="")
    parser.add_argument("--package-name", default="com.pucky.device.debug")
    parser.add_argument("--activity-name", default=DEFAULT_ACTIVITY_NAME)
    parser.add_argument("--baseline-speed", type=float, default=1.0)
    parser.add_argument("--default-speed", type=float, default=1.25)
    parser.add_argument("--override-speed", type=float, default=2.0)
    parser.add_argument("--proof-reply-delay-ms", type=int, default=0)
    parser.add_argument("--first-text", default="")
    parser.add_argument("--second-text", default="")
    parser.add_argument("--skip-official-preproof-check", action="store_true")
    parser.add_argument("--evidence-dir", type=Path, default=ROOT / ".tmp" / "default-audio-speed-phone-proof")
    args = parser.parse_args(argv)
    args.repo_root = args.repo_root.resolve()
    args.canonical_root = args.canonical_root.resolve()
    args.browser_helper = args.browser_helper.resolve()
    args.puckyctl = args.puckyctl.resolve()
    args.node = args.node.resolve() if isinstance(args.node, Path) and args.node.exists() else args.node
    args.node_modules = args.node_modules.resolve()
    args.adb = args.adb.resolve() if isinstance(args.adb, Path) and args.adb.exists() else args.adb
    args.broker = args.broker or os.environ.get("PUCKY_BROKER_URL", proof.DEFAULT_BROKER_URL)
    args.token = args.token or os.environ.get("PUCKY_OPERATOR_TOKEN", "")
    args.device_id = args.device_id or os.environ.get("PUCKY_DEVICE_ID", "")
    args.manifest_url = args.manifest_url or official_html.urljoin(args.vm_base_url.rstrip("/") + "/", official_html.DEFAULT_MANIFEST_PATH.lstrip("/"))
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
