from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pytest

import tools.pucky_emulator_suite as suite


def ns(tmp_path: Path, **overrides):
    android_home = tmp_path / "android-sdk"
    paths = {
        "android_home": android_home,
        "java_home": tmp_path / "jdk-17",
        "gradle": tmp_path / "gradle.bat",
        "adb": android_home / "platform-tools" / "adb.exe",
        "emulator": android_home / "emulator" / "emulator.exe",
        "avdmanager": android_home / "cmdline-tools" / "latest" / "bin" / "avdmanager.bat",
        "system_image": suite.DEFAULT_SYSTEM_IMAGE,
        "device_profile": "resizable",
        "package_name": suite.DEFAULT_PACKAGE,
        "activity_name": suite.DEFAULT_ACTIVITY,
        "apk": tmp_path / "app-debug.apk",
        "puckyctl": tmp_path / "puckyctl.py",
        "fake_broker": tmp_path / "fake-broker",
        "puckyctl_timeout_ms": 180000,
        "dry_run": True,
    }
    paths.update(overrides)
    return argparse.Namespace(**paths)


def test_parse_adb_devices_and_emulator_guard() -> None:
    output = """List of devices attached
ZY22JZ26LK             device product:aito_g_sysu model:motorola_razr_2024
emulator-5554          offline
emulator-5556          device product:sdk_gphone64_x86_64
"""
    devices = suite.parse_adb_devices(output)

    assert [device.serial for device in devices] == ["ZY22JZ26LK", "emulator-5554", "emulator-5556"]
    assert devices[1].state == "offline"
    assert suite.is_emulator_serial("emulator-5556")
    with pytest.raises(suite.SuiteError, match="Refusing non-emulator"):
        suite.require_emulator_serial("ZY22JZ26LK")


def test_parse_tap_point_requires_xy_pair() -> None:
    assert suite.parse_tap_point("528,230") == (528, 230)

    with pytest.raises(suite.SuiteError, match="Invalid tap point"):
        suite.parse_tap_point("bad-point")


def test_long_press_uses_stationary_swipe() -> None:
    args = ns(Path("."))
    config = suite.slot_config(Path("."), 1, run_id="fixed")
    runner = suite.Runner(dry_run=True)

    suite.long_press(args, runner, config, (528, 230), duration_ms=420)

    planned = runner.planned[-1]["command"]
    assert planned[:3] == [str(args.adb), "-s", config.serial]
    assert planned[-8:] == ["shell", "input", "swipe", "528", "230", "528", "230", "420"]


def test_slot_config_is_deterministic_and_disjoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(suite, "git_short", lambda root=suite.ROOT: "abc123-dirty")

    first = suite.slot_config(tmp_path, 1, run_id="fixed")
    again = suite.slot_config(tmp_path, 1, run_id="fixed")
    second = suite.slot_config(tmp_path, 2, run_id="fixed2")

    assert first == again
    assert first.avd_name == "pucky_webview_api35_01"
    assert first.serial == "emulator-5554"
    assert first.broker_port == 18081
    assert first.ui_port == 18181
    assert first.device_id == "pucky-emulator-slot-01"
    assert first.bundle_version == "emu-slot01-abc123-dirty"
    assert len({first.avd_name, second.avd_name}) == 2
    assert len({first.serial, second.serial}) == 2
    assert len({first.broker_port, second.broker_port, first.ui_port, second.ui_port}) == 4


def test_slot_paths_are_confined_to_workspace_tmp(tmp_path: Path) -> None:
    inside = tmp_path / ".tmp" / "pucky-emulator" / "avd"
    inside.mkdir(parents=True)
    suite.assert_inside(inside, tmp_path / ".tmp")

    with pytest.raises(suite.SuiteError):
        suite.assert_inside(tmp_path.parent, tmp_path / ".tmp")


def test_create_and_start_commands_use_workspace_avd_home(tmp_path: Path) -> None:
    args = ns(tmp_path)
    config = suite.slot_config(tmp_path, 3, run_id="fixed")

    create = suite.avdmanager_create_command(args, config)
    start = suite.emulator_start_command(args, config)
    env = suite.sdk_env(args, config)

    assert create[:4] == [str(args.avdmanager), "create", "avd", "--force"]
    assert "--name" in create and "pucky_webview_api35_03" in create
    assert "--package" in create and suite.DEFAULT_SYSTEM_IMAGE in create
    assert "--sdcard" in create and suite.DEFAULT_SDCARD_SIZE in create
    assert start == [
        str(args.emulator),
        "-avd",
        "pucky_webview_api35_03",
        "-port",
        "5558",
        "-no-window",
        "-partition-size",
        suite.DEFAULT_USERDATA_PARTITION_MB,
        "-no-audio",
        "-no-snapshot-load",
        "-no-snapshot-save",
        "-no-boot-anim",
        "-gpu",
        "swiftshader_indirect",
    ]
    assert env["ANDROID_AVD_HOME"] == config.avd_home
    assert str(tmp_path / ".tmp") in config.avd_home


def test_start_command_can_enable_host_audio(tmp_path: Path) -> None:
    args = ns(tmp_path, audio_mode="host")
    config = suite.slot_config(tmp_path, 2, run_id="fixed")

    start = suite.emulator_start_command(args, config)

    assert "-no-audio" not in start
    assert ["-audio", "dsound"] == start[start.index("-audio"):start.index("-audio") + 2]
    assert "-allow-host-audio" in start


def test_start_command_can_use_wav_input_audio_backend(tmp_path: Path) -> None:
    wav = tmp_path / "wake.wav"
    args = ns(tmp_path, audio_mode="wav-in", audio_wav_in=wav)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")

    start = suite.emulator_start_command(args, config)
    env = suite.sdk_env(args, config)

    assert "-no-audio" not in start
    assert ["-audio", "wav"] == start[start.index("-audio"):start.index("-audio") + 2]
    assert env["QEMU_WAV_IN_PATH"] == str(wav)
    assert env["QEMU_WAV_PATH"].endswith("qemu-audio-out.wav")
    assert env["QEMU_AUDIO_ADC_FIXED_FREQ"] == "44100"
    assert env["QEMU_AUDIO_ADC_FIXED_FMT"] == "S16"
    assert env["QEMU_AUDIO_ADC_FIXED_CHANNELS"] == "1"


def test_wav_input_audio_requires_fixture_path(tmp_path: Path) -> None:
    args = ns(tmp_path, audio_mode="wav-in", audio_wav_in=None)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")

    with pytest.raises(suite.SuiteError, match="audio-wav-in"):
        suite.sdk_env(args, config)


def test_tune_avd_config_reduces_userdata_partition_size(tmp_path: Path) -> None:
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    config_dir = Path(config.avd_home) / f"{config.avd_name}.avd"
    config_dir.mkdir(parents=True)
    config_path = config_dir / "config.ini"
    config_path.write_text("disk.dataPartition.size = 6442450944\nhw.ramSize=2G\n", encoding="utf-8")

    suite.tune_avd_config(config)

    content = config_path.read_text(encoding="utf-8")
    assert f"disk.dataPartition.size = {suite.DEFAULT_USERDATA_PARTITION_SIZE}" in content
    assert "6442450944" not in content


def test_cmd_start_reapplies_userdata_tuning_for_existing_slot(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, slot=2, no_wait=True, dry_run=False)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    calls: list[str] = []

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "load_state", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(suite, "save_state", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(suite, "avd_artifacts_exist", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "tune_avd_config", lambda cfg: calls.append(cfg.avd_name))
    monkeypatch.setattr(suite.Runner, "start_detached", lambda self, *args, **kwargs: 123)

    result = suite.cmd_start(args)

    assert result["ok"] is True
    assert calls == [config.avd_name]


def test_cmd_start_creates_missing_avd_before_launch(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, slot=1, no_wait=True, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    calls: list[tuple[str, object]] = []

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "load_state", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(suite, "save_state", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(suite, "avd_artifacts_exist", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(suite, "sdk_env", lambda *_args, **_kwargs: {"ANDROID_AVD_HOME": config.avd_home})
    monkeypatch.setattr(suite, "tune_avd_config", lambda cfg: calls.append(("tune", cfg.avd_name)))

    def fake_run(self, command, **kwargs):
        calls.append(("run", list(command)))
        return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    def fake_start_detached(self, command, **kwargs):
        calls.append(("start", list(command)))
        return 321

    monkeypatch.setattr(suite.Runner, "run", fake_run)
    monkeypatch.setattr(suite.Runner, "start_detached", fake_start_detached)

    result = suite.cmd_start(args)

    assert result["ok"] is True
    assert calls[0] == ("run", suite.avdmanager_create_command(args, config))
    assert calls[1] == ("tune", config.avd_name)
    assert calls[2] == ("start", suite.emulator_start_command(args, config))


def test_wait_for_snapshot_condition_honors_custom_poll_interval(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=True)
    snapshots = iter([{"cards": []}, {"ready": True}])
    clock = {"now": 0.0}
    sleeps: list[float] = []

    monkeypatch.setattr(suite, "command_json", lambda *args, **kwargs: next(snapshots))
    monkeypatch.setattr(suite, "command_result", lambda payload: payload)
    monkeypatch.setattr(suite, "puckyctl_command", lambda *args, **kwargs: ["puckyctl"])
    monkeypatch.setattr(suite.time, "monotonic", lambda: clock["now"])

    def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        clock["now"] += seconds

    monkeypatch.setattr(suite.time, "sleep", fake_sleep)

    result = suite.wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="snapshot ready",
        predicate=lambda snapshot: bool(snapshot.get("ready")),
        timeout=1.0,
        sleep_seconds=0.125,
    )

    assert result == {"ready": True}
    assert sleeps == [0.125]


def test_adb_launch_and_puckyctl_commands_are_scoped_to_emulator(tmp_path: Path) -> None:
    args = ns(tmp_path)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")

    reverse = suite.adb_command(args, config.serial, ["reverse", "tcp:18081", "tcp:18081"])
    launch = suite.launch_command(args, config)
    command = suite.puckyctl_command(args, config, "ui.reply_cards.get", {})

    assert reverse[:3] == [str(args.adb), "-s", "emulator-5554"]
    assert "ZY22JZ26LK" not in " ".join(reverse + launch + command)
    assert "-n" in launch
    assert f"ws://127.0.0.1:{config.broker_port}/v1/devices/{config.device_id}/connect" in launch
    assert "--broker" in command
    assert "--timeout-ms" in command
    assert "180000" in command
    assert f"http://127.0.0.1:{config.broker_port}" in command
    assert "--device-id" in command and config.device_id in command

def test_reply_cards_write_command_uses_set_for_emulator(tmp_path: Path) -> None:
    args = ns(tmp_path)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")

    command = suite.reply_cards_write_command(args, config, {"cards": [{"title": "One"}]})

    assert "ui.reply_cards.set" in command
    assert "ui.reply_cards.merge" not in command


def test_reply_cards_write_command_uses_merge_for_physical_targets(tmp_path: Path) -> None:
    args = ns(tmp_path)
    config = suite.SlotConfig(
        slot=0,
        avd_name="unused",
        serial="ZY22JZ26LK",
        emulator_port=0,
        device_id="pucky-cover-settings-phone",
        broker_port=18081,
        ui_port=18181,
        avd_home=str(tmp_path / ".tmp" / "avd-home"),
        run_id="physical",
        run_dir=str(tmp_path / ".tmp" / "run"),
        evidence_dir=str(tmp_path / ".tmp" / "evidence"),
        state_path=str(tmp_path / ".tmp" / "state.json"),
        bundle_version="physical-proof",
    )

    command = suite.reply_cards_write_command(args, config, {"cards": [{"title": "One"}]})

    assert "ui.reply_cards.merge" in command
    assert "ui.reply_cards.set" not in command


def test_launch_home_command_reuses_provisioning_payload_when_turn_config_present(tmp_path: Path) -> None:
    args = ns(tmp_path, turn_url="https://pucky.fly.dev/api/turn", turn_token="token-123")
    config = suite.slot_config(tmp_path, 1, run_id="fixed")

    home = suite.launch_home_command(args, config)

    assert home[:3] == [str(args.adb), "-s", config.serial]
    assert "--ez" in home and "show_home" in home and "true" in home
    assert "--es" in home and "provisioning_json_base64" in home


def test_launch_command_uses_resolved_launcher_activity_when_default_is_unavailable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 3, run_id="fixed")

    def fake_run(command, capture_output, text, timeout, check):
        assert command[:3] == [str(args.adb), "-s", config.serial]
        return argparse.Namespace(
            stdout=(
                "priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\n"
                "com.pucky.device.debug/com.pucky.device.MainActivity\n"
            )
        )

    monkeypatch.setattr(suite.subprocess, "run", fake_run)

    launch = suite.launch_command(args, config)
    home = suite.launch_home_command(args, config)

    assert f"{args.package_name}/com.pucky.device.MainActivity" in launch
    assert f"{args.package_name}/com.pucky.device.MainActivity" in home


def test_effective_activity_name_falls_back_to_main_activity_when_resolution_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")

    monkeypatch.setattr(
        suite.subprocess,
        "run",
        lambda *args, **kwargs: argparse.Namespace(stdout="No activity found\n"),
    )

    assert suite.effective_activity_name(args, config) == "com.pucky.device.MainActivity"


def test_launch_command_respects_explicit_activity_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    args = ns(tmp_path, dry_run=False, activity_name="com.pucky.device.CustomActivity")
    config = suite.slot_config(tmp_path, 3, run_id="fixed")

    def fail_run(*_args, **_kwargs):
        raise AssertionError("resolve-activity should not run when activity_name is explicitly set")

    monkeypatch.setattr(suite.subprocess, "run", fail_run)

    launch = suite.launch_command(args, config)

    assert f"{args.package_name}/com.pucky.device.CustomActivity" in launch


def test_grant_runtime_permissions_covers_main_activity_prompt_set(tmp_path: Path) -> None:
    args = ns(tmp_path)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=True)

    suite.grant_runtime_permissions(args, runner, config)

    grants = [planned["command"][-1] for planned in runner.planned]
    assert "android.permission.READ_SMS" in grants
    assert "android.permission.RECORD_AUDIO" in grants
    assert "android.permission.ACCESS_FINE_LOCATION" in grants


def test_grant_runtime_permissions_tolerates_timeout_on_redundant_grants(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    calls: list[str] = []

    def fake_run(command, *, timeout=30, check=False, **_kwargs):
        permission = command[-1]
        calls.append(permission)
        if permission == "android.permission.SEND_SMS":
            raise suite.subprocess.TimeoutExpired(command, timeout)
        return argparse.Namespace(stdout="", stderr="", returncode=0)

    monkeypatch.setattr(runner, "run", fake_run)

    suite.grant_runtime_permissions(args, runner, config)

    assert "android.permission.SEND_SMS" in calls
    assert "android.permission.RECORD_AUDIO" in calls


def test_dismiss_permission_controller_force_stops_permission_package(tmp_path: Path) -> None:
    args = ns(tmp_path)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=True)

    suite.dismiss_permission_controller(args, runner, config)

    assert runner.planned[-1]["command"][-3:] == [
        "am",
        "force-stop",
        suite.DEFAULT_PERMISSION_CONTROLLER_PACKAGE,
    ]


def test_parser_includes_pending_outbound_proof_command() -> None:
    parser = suite.build_parser()

    args = parser.parse_args(["prove-pending-outbound-feed", "--slot", "2", "--dry-run"])

    assert args.command == "prove-pending-outbound-feed"
    assert args.slot == 2
    assert args.long_press_ms == 360


def test_parser_includes_accepted_timeout_recovery_proof_command() -> None:
    parser = suite.build_parser()

    args = parser.parse_args(["prove-accepted-timeout-recovery", "--slot", "4", "--dry-run"])

    assert args.command == "prove-accepted-timeout-recovery"
    assert args.slot == 4
    assert args.turn_url == suite.DEFAULT_TURN_URL
    assert args.turn_timeout_seconds == 180


def test_parser_includes_displayable_reply_files_proof_command() -> None:
    parser = suite.build_parser()

    args = parser.parse_args(["prove-displayable-reply-files", "--slot", "3", "--dry-run"])

    assert args.command == "prove-displayable-reply-files"
    assert args.slot == 3
    assert args.turn_url == suite.DEFAULT_TURN_URL
    assert args.snapshot_timeout_seconds == 120
    assert args.long_press_ms == 420
    assert args.replay_broker_log is None


def test_replay_cards_from_broker_log_uses_latest_matching_card(tmp_path: Path) -> None:
    log_path = tmp_path / "fake-broker.log"
    lines = [
        {
            "message": {
                "result": {
                    "cards": [
                        {"title": "Proof HTML Dashboard", "turn_id": "older-turn", "card_id": "older-card"},
                    ]
                }
            }
        },
        {
            "command": {
                "args": {
                    "cards": [
                        {"title": "Proof Runtime Icon", "turn_id": "icon-turn", "card_id": "icon-card"},
                    ]
                }
            }
        },
        {
            "message": {
                "result": {
                    "cards": [
                        {"title": "Proof HTML Dashboard", "turn_id": "newer-turn", "card_id": "newer-card"},
                    ]
                }
            }
        },
    ]
    log_path.write_text("\n".join(json.dumps(item) for item in lines), encoding="utf-8")

    cards = suite.replay_cards_from_broker_log(
        log_path,
        ["Proof HTML Dashboard", "Proof Runtime Icon"],
    )

    assert cards["Proof HTML Dashboard"]["turn_id"] == "newer-turn"
    assert cards["Proof Runtime Icon"]["card_id"] == "icon-card"


def test_replay_cards_from_broker_log_can_allow_partial_coverage(tmp_path: Path) -> None:
    log_path = tmp_path / "fake-broker.log"
    lines = [
        {"message": {"result": {"cards": [{"title": "Proof HTML Dashboard", "card_id": "html-card"}]}}},
        {"command": {"args": {"cards": [{"title": "Proof CSV Table", "card_id": "csv-card"}]}}},
    ]
    log_path.write_text("\n".join(json.dumps(item) for item in lines), encoding="utf-8")

    cards = suite.replay_cards_from_broker_log(
        log_path,
        ["Proof HTML Dashboard", "Proof JSON Summary"],
        allow_partial=True,
    )

    assert cards == {"Proof HTML Dashboard": {"title": "Proof HTML Dashboard", "card_id": "html-card"}}


def test_replay_cards_from_broker_log_prefers_completed_reply_over_later_pending_placeholder(tmp_path: Path) -> None:
    log_path = tmp_path / "fake-broker.log"
    lines = [
        {
            "message": {
                "result": {
                    "cards": [
                        {
                            "title": "Proof HTML Dashboard",
                            "card_id": "reply-card",
                            "turn_id": "reply-turn",
                            "summary": "Rendered dashboard reply",
                            "transcript_messages": [
                                {
                                    "role": "assistant",
                                    "attachments": [
                                        {"title": "Proof HTML Dashboard File", "kind": "html", "mime_type": "text/html"}
                                    ],
                                }
                            ],
                        }
                    ]
                }
            }
        },
        {
            "message": {
                "result": {
                    "cards": [
                        {
                            "title": "Proof HTML Dashboard",
                            "card_id": "pending-card",
                            "turn_id": "pending-turn",
                            "summary": "Sending your message...",
                            "pending_outbound": True,
                            "pending_placeholder": True,
                            "pending_state": "failed",
                        }
                    ]
                }
            }
        },
    ]
    log_path.write_text("\n".join(json.dumps(item) for item in lines), encoding="utf-8")

    cards = suite.replay_cards_from_broker_log(log_path, ["Proof HTML Dashboard"])

    assert cards["Proof HTML Dashboard"]["card_id"] == "reply-card"
    assert cards["Proof HTML Dashboard"]["turn_id"] == "reply-turn"


def test_replay_cards_from_broker_log_prefers_stronger_displayable_attachment_over_later_title_collision(tmp_path: Path) -> None:
    log_path = tmp_path / "fake-broker.log"
    lines = [
        {
            "message": {
                "result": {
                    "cards": [
                        {
                            "title": "Proof HTML Dashboard",
                            "card_id": "reply-card",
                            "turn_id": "reply-turn",
                            "summary": "Rendered dashboard reply",
                            "transcript_messages": [
                                {
                                    "role": "assistant",
                                    "attachments": [
                                        {
                                            "title": "Proof HTML Dashboard",
                                            "kind": "html",
                                            "mime_type": "text/html",
                                            "path": "/data/proof-dashboard.html",
                                            "viewer_path": "/data/proof-dashboard-viewer.html",
                                            "preview_path": "/data/proof-dashboard-preview.html",
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                }
            }
        },
        {
            "message": {
                "result": {
                    "cards": [
                        {
                            "title": "Proof HTML Dashboard",
                            "card_id": "walkie-card",
                            "turn_id": "walkie-turn",
                            "summary": "Existing dashboard thread with an older artifact-rich transcript.",
                            "html_path": "/data/proof-pocket-computers.html",
                            "transcript_messages": [
                                {
                                    "role": "assistant",
                                    "attachments": [
                                        {
                                            "title": "Morning notes TXT",
                                            "mime_type": "text/plain",
                                            "path": "/data/proof-morning-notes.txt",
                                        }
                                    ],
                                }
                            ],
                        }
                    ]
                }
            }
        },
    ]
    log_path.write_text("\n".join(json.dumps(item) for item in lines), encoding="utf-8")

    cards = suite.replay_cards_from_broker_log(log_path, ["Proof HTML Dashboard"])

    assert cards["Proof HTML Dashboard"]["card_id"] == "reply-card"
    assert cards["Proof HTML Dashboard"]["turn_id"] == "reply-turn"


def test_normalize_replay_card_renormalizes_attachment_kinds() -> None:
    card = {
        "title": "Proof Runtime Icon",
        "transcript_messages": [
            {
                "role": "assistant",
                "attachments": [
                    {
                        "title": "Proof Runtime Icon File",
                        "kind": "document",
                        "mime_type": "text/plain",
                        "path": "/tmp/proof_runtime_icon_note.txt",
                        "text": "hello",
                    }
                ],
            }
        ],
    }

    normalized = suite.normalize_replay_card(card)
    attachment = normalized["transcript_messages"][0]["attachments"][0]

    assert attachment["kind"] == "text"
    assert attachment["viewer"]["type"] == "text"


def test_wait_for_live_feed_item_pages_through_next_cursor(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, turn_url="https://pucky.fly.dev/api/turn", turn_token="token-123")
    pages = iter([
        {"items": [{"turn_id": "older-turn"}], "next_cursor": "cursor-2"},
        {"items": [{"turn_id": "target-turn", "card_id": "card-1"}], "next_cursor": ""},
    ])

    monkeypatch.setattr(suite, "feed_request", lambda *_args, **_kwargs: next(pages))
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    result = suite.wait_for_live_feed_item(args, "target-turn", timeout=1.0, limit=1)

    assert result["turn_id"] == "target-turn"


def test_parser_includes_apk_actions_proof_command() -> None:
    parser = suite.build_parser()

    args = parser.parse_args(["prove-apk-actions", "--slot", "2", "--dry-run"])

    assert args.command == "prove-apk-actions"
    assert args.slot == 2
    assert args.location_lat == 37.4220
    assert args.location_lon == -122.0841


def test_apk_action_recipe_bundle_includes_notification_and_location_cases() -> None:
    bundle = suite.apk_action_recipe_bundle()
    commands = [
        step["command"]
        for recipe in bundle["recipes"]
        for step in recipe["steps"]
    ]
    phrases = {phrase for recipe in bundle["recipes"] for phrase in recipe["phrases"]}

    assert "notify.show" in commands
    assert "screenshot.capture" in commands
    assert "location.pin" in commands
    assert "torch.set" in commands
    assert "send a notification" in phrases
    assert "take a screenshot" in phrases
    assert "pin my location" in phrases


def test_parser_includes_walkie_thread_lab_command() -> None:
    parser = suite.build_parser()

    args = parser.parse_args(["walkie-thread-lab", "--slot", "2", "--scenario", "final-boss-overlap", "--dry-run"])

    assert args.command == "walkie-thread-lab"
    assert args.slot == 2
    assert args.scenario == "final-boss-overlap"
    assert args.final_boss_delay_ms_a == 6000
    assert args.final_boss_delay_ms_new == 3000
    assert args.final_boss_delay_ms_b == 0
    assert args.page_surface == "auto"
    assert args.skip_refresh is False


def test_parser_accepts_walkie_continuation_proof_alias() -> None:
    parser = suite.build_parser()

    args = parser.parse_args(["walkie-continuation-proof", "--slot", "2", "--scenario", "final-boss-overlap", "--dry-run"])

    assert args.command == "walkie-continuation-proof"
    assert args.slot == 2
    assert args.scenario == "final-boss-overlap"
    assert args.final_boss_delay_ms_a == 6000
    assert args.final_boss_delay_ms_new == 3000
    assert args.final_boss_delay_ms_b == 0
    assert args.page_surface == "auto"
    assert args.skip_refresh is False


def test_dispatch_accepts_walkie_continuation_proof_alias(monkeypatch: pytest.MonkeyPatch) -> None:
    parser = suite.build_parser()
    args = parser.parse_args(["walkie-continuation-proof", "--slot", "2", "--scenario", "final-boss-overlap", "--dry-run"])

    monkeypatch.setattr(
        suite,
        "cmd_walkie_thread_lab",
        lambda parsed_args: {
            "ok": True,
            "command": parsed_args.command,
            "scenario": parsed_args.scenario,
        },
    )

    result = suite.dispatch(args)

    assert result == {
        "ok": True,
        "command": "walkie-continuation-proof",
        "scenario": "final-boss-overlap",
    }


def test_walkie_thread_lab_scenarios_and_evidence_schema_are_stable() -> None:
    assert suite.WALKIE_THREAD_LAB_RESULT_SCHEMA == "pucky.walkie_thread_lab.v1"
    assert suite.WALKIE_THREAD_LAB_SCENARIOS == (
        "transcript-continuation",
        "page-continuation",
        "attachment-continuation",
        "negative-home",
        "history-retention",
        "final-boss-overlap",
        "all",
    )
    assert suite.WALKIE_THREAD_LAB_EVIDENCE_FILES == (
        "home-before.png",
        "before-send.png",
        "pending.png",
        "transcript-known.png",
        "reply-complete.png",
        "ui.surface.before.json",
        "ui.surface.pending.json",
        "ui.surface.transcript.json",
        "ui.surface.final.json",
        "voice.thread_scope.before.json",
        "pucky.turn.history.json",
        "ui.reply_cards.before.json",
        "ui.reply_cards.final.json",
        "proof.json",
    )


def test_parser_includes_walkie_thread_lab_command() -> None:
    parser = suite.build_parser()

    args = parser.parse_args(["walkie-thread-lab", "--slot", "2", "--scenario", "final-boss-overlap", "--dry-run"])

    assert args.command == "walkie-thread-lab"
    assert args.slot == 2
    assert args.scenario == "final-boss-overlap"
    assert args.final_boss_delay_ms_a == 6000
    assert args.final_boss_delay_ms_new == 3000
    assert args.final_boss_delay_ms_b == 0
    assert args.page_surface == "auto"
    assert args.skip_refresh is False


def test_walkie_thread_lab_scenarios_and_evidence_schema_are_stable() -> None:
    assert suite.WALKIE_THREAD_LAB_RESULT_SCHEMA == "pucky.walkie_thread_lab.v1"
    assert suite.WALKIE_THREAD_LAB_SCENARIOS == (
        "feed-focus-continuation",
        "transcript-continuation",
        "page-continuation",
        "attachment-continuation",
        "negative-home",
        "focus-clear-negative",
        "history-retention",
        "final-boss-overlap",
        "all",
    )
    assert suite.WALKIE_THREAD_LAB_EVIDENCE_FILES == (
        "home-before.png",
        "before-send.png",
        "pending.png",
        "transcript-known.png",
        "reply-complete.png",
        "ui.surface.home-before.json",
        "ui.surface.focused.json",
        "ui.surface.before.json",
        "ui.surface.pending.json",
        "ui.surface.transcript.json",
        "ui.surface.final.json",
        "ui.surface.attachment.json",
        "voice.thread_scope.before.json",
        "voice.thread_scope.focused.json",
        "pucky.turn.history.json",
        "pucky.turn.read.<turn_id>.json",
        "ui.reply_cards.before.json",
        "ui.reply_cards.final.json",
        "proof.json",
    )
    assert suite.WALKIE_THREAD_TRANSPORT_FIXTURES == {
        "thread_continue": "wake_weather",
        "file_revise": "wake_weather",
        "fresh_thread": "wake_weather",
        "thread_bravo": "wake_weather",
        "thread_alpha": "wake_weather",
    }


def test_walkie_thread_lab_all_expands_only_core_gate_sequence(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    parser = suite.build_parser()
    args = parser.parse_args(["walkie-thread-lab", "--slot", "1", "--scenario", "all", "--dry-run"])
    config = suite.slot_config(tmp_path, 1, run_id="fixed")

    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "require_emulator_serial", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)

    result = suite.cmd_walkie_thread_lab(args)

    assert suite.WALKIE_THREAD_LAB_ALL_SCENARIOS == (
        "feed-focus-continuation",
        "transcript-continuation",
        "page-continuation",
        "attachment-continuation",
        "negative-home",
        "history-retention",
        "final-boss-overlap",
    )
    assert [item["scenario"] for item in result["results"]] == list(suite.WALKIE_THREAD_LAB_ALL_SCENARIOS)
    assert "focus-clear-negative" not in [item["scenario"] for item in result["results"]]


def test_start_fixture_turn_passes_debug_fixture_transcript_and_delay(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    seen: dict[str, object] = {}

    monkeypatch.setattr(suite, "command_result", lambda payload: payload)

    def fake_command_json(_runner, command, *, timeout=60):
        seen["command"] = command
        seen["timeout"] = timeout
        return {"ok": True, "turn_id": "turn-1"}

    monkeypatch.setattr(suite, "command_json", fake_command_json)

    result = suite.start_fixture_turn(
        args,
        runner,
        config,
        fixture_name="thread_continue",
        fixture_path="/data/local/tmp/thread_continue.wav",
        debug_fixture_transcript="Should we change these goals?",
        proof_reply_delay_ms=2200,
    )

    args_index = seen["command"].index("--args-json")
    payload = json.loads(seen["command"][args_index + 1])
    assert payload["debug_fixture_transcript"] == "Should we change these goals?"
    assert payload["proof_reply_delay_ms"] == 2200
    assert payload.get("fixture_start_delay_ms", suite.WALKIE_THREAD_FIXTURE_START_DELAY_MS) == suite.WALKIE_THREAD_FIXTURE_START_DELAY_MS
    assert result["turn_id"] == "turn-1"


def test_push_turn_fixture_uses_app_owned_upload(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    fixture = tmp_path / "thread_continue.wav"
    fixture.write_bytes(b"RIFFdemo")
    seen: dict[str, object] = {}

    def fake_upload(_args, _runner, _config, *, source_path, filename, max_bytes=0):
        seen["source_path"] = source_path
        seen["filename"] = filename
        seen["max_bytes"] = max_bytes
        return {"device_path": "/data/user/0/com.pucky.device.debug/files/downloads/thread_continue.wav"}

    monkeypatch.setattr(suite, "upload_app_owned_file", fake_upload)

    remote = suite.push_turn_fixture(args, runner, config, fixture, "thread_continue")

    assert remote == "/data/user/0/com.pucky.device.debug/files/downloads/thread_continue.wav"
    assert seen["source_path"] == fixture
    assert seen["filename"] == "thread_continue.wav"


def test_upload_app_owned_file_stages_with_adb_and_run_as(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=True)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=True)
    fixture = tmp_path / "thread_continue.wav"
    fixture.write_bytes(b"RIFFdemo")

    monkeypatch.setattr(suite, "adb_command", lambda _args, serial, rest: ["adb", "-s", serial, *rest])

    uploaded = suite.upload_app_owned_file(
        args,
        runner,
        config,
        source_path=fixture,
        filename="thread_continue.wav",
    )

    commands = [planned["command"] for planned in runner.planned]
    assert commands[0][-2:] == [str(fixture), "/data/local/tmp/thread_continue.wav"]
    assert commands[1][3] == "shell"
    assert f"run-as {suite.DEFAULT_PACKAGE} sh -c " in commands[1][4]
    assert uploaded["device_path"] == "/data/user/0/com.pucky.device.debug/files/downloads/thread_continue.wav"


def test_reset_walkie_thread_lab_state_uses_full_history_clear(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    commands: list[tuple[str, dict]] = []

    monkeypatch.setattr(suite, "command_result", lambda payload: payload)

    def fake_command_json(_runner, command, *, timeout=60):
        args_index = command.index("--args-json")
        payload = json.loads(command[args_index + 1])
        commands.append((command[command.index("command") + 1], payload))
        return {"ok": True}

    monkeypatch.setattr(suite, "command_json", fake_command_json)

    suite.reset_walkie_thread_lab_state(args, runner, config)

    assert ("pucky.turn.debug.inject_history", {"clear_all": True}) in commands
    assert ("pucky.feed.sync", {"reason": "walkie_thread_lab_reset", "reset_cursor": True}) in commands


def test_find_ui_nodes_matches_content_desc_and_bounds() -> None:
    xml = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.Button" package="com.pucky.device.debug" content-desc="Open file for Proof CSV Table" bounds="[900,180][1000,260]" />
  <node index="1" text="Open file for Proof HTML Dashboard" resource-id="" class="android.widget.Button" package="com.pucky.device.debug" content-desc="" bounds="[876,204][989,307]" />
  <node index="2" text="Proof CSV Table File" resource-id="" class="android.widget.TextView" package="com.pucky.device.debug" content-desc="" bounds="[88,96][430,154]" />
</hierarchy>
"""

    nodes = suite.find_ui_nodes(xml, content_desc_pattern=r"^Open file for Proof CSV Table$")
    assert len(nodes) == 1
    assert suite.parse_node_bounds(nodes[0]["bounds"]) == (900, 180, 1000, 260)

    action_text_nodes = suite.find_ui_nodes(xml, text_pattern=r"^Open file for Proof HTML Dashboard$")
    assert len(action_text_nodes) == 1
    assert suite.parse_node_bounds(action_text_nodes[0]["bounds"]) == (876, 204, 989, 307)

    title_nodes = suite.find_ui_nodes(xml, text_pattern=r"^Proof CSV Table File$")
    assert len(title_nodes) == 1


def test_find_ui_nodes_treats_text_and_content_desc_patterns_as_or() -> None:
    xml = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.Button" package="com.pucky.device.debug" content-desc="Open file for Proof CSV Table" bounds="[900,180][1000,260]" />
  <node index="1" text="Open file for Proof HTML Dashboard" resource-id="" class="android.widget.Button" package="com.pucky.device.debug" content-desc="" bounds="[876,204][989,307]" />
</hierarchy>
"""

    desc_only = suite.find_ui_nodes(
        xml,
        text_pattern=r"^Open file for Proof CSV Table$",
        content_desc_pattern=r"^Open file for Proof CSV Table$",
    )
    assert len(desc_only) == 1
    assert desc_only[0]["content-desc"] == "Open file for Proof CSV Table"

    text_only = suite.find_ui_nodes(
        xml,
        text_pattern=r"^Open file for Proof HTML Dashboard$",
        content_desc_pattern=r"^Open file for Proof HTML Dashboard$",
    )
    assert len(text_only) == 1
    assert text_only[0]["text"] == "Open file for Proof HTML Dashboard"


def test_dismiss_anr_dialog_if_present_taps_wait(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    tapped: list[str] = []

    xml = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="System UI isn't responding" bounds="[132,365][924,436]" />
  <node index="1" text="Wait" bounds="[69,601][987,727]" />
</hierarchy>
"""

    monkeypatch.setattr(suite, "tap_ui_node", lambda *_args: tapped.append(_args[3]["text"]))
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    handled = suite.dismiss_anr_dialog_if_present(args, runner, config, xml)

    assert handled is True
    assert tapped == ["Wait"]


def test_dismiss_permission_dialog_if_present_taps_allow_variant(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    tapped: list[str] = []

    xml = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="Allow Pucky to access photos and videos?" bounds="[80,280][980,380]" />
  <node index="1" text="While using the app" bounds="[80,620][980,730]" />
</hierarchy>
"""

    monkeypatch.setattr(suite, "tap_ui_node", lambda *_args: tapped.append(_args[3]["text"]))
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    handled = suite.dismiss_permission_dialog_if_present(args, runner, config, xml)

    assert handled is True
    assert tapped == ["While using the app"]


def test_first_displayable_attachment_snapshot_prefers_latest_assistant_message() -> None:
    card = {
        "title": "Attachment card",
        "transcript_messages": [
            {"role": "assistant", "attachments": [{"title": "Older", "viewer": {"type": "download_only"}}]},
            {"role": "user", "attachments": [{"title": "Ignore user", "viewer": {"type": "text"}}]},
            {"role": "assistant", "attachments": [{"title": "Newest", "viewer": {"type": "table"}}]},
        ],
    }

    info = suite.first_displayable_attachment_snapshot(card)

    assert info is not None
    assert info["item"]["title"] == "Newest"
    assert info["viewer_type"] == "table"
    assert suite.card_action_accessibility_label(card) == "Open file for Attachment card"
    assert suite.card_action_accessibility_labels(card) == [
        "Open file for Attachment card",
        "Open page for Attachment card",
    ]
    assert suite.card_open_title(card) == "Newest"


def test_visible_cards_handles_null_surface_entries() -> None:
    assert suite.visible_cards({"visible_cards": None}) == []


def test_surface_from_snapshot_normalizes_pending_thread_identity_and_preview() -> None:
    snapshot = {
        "cards": [
            {
                "card_id": "pending_turn_turn-a",
                "session_id": "turn-a",
                "origin": {"thread_id": "thread-A"},
                "pending_outbound": True,
                "pending_state": "uploading",
                "summary": "Sending your message...",
                "title": "Proof HTML Dashboard",
            },
            {
                "card_id": "reply_turn_turn-b",
                "session_id": "turn-b",
                "origin": {"thread_id": "thread-B"},
                "summary": "Proof CSV Table",
                "title": "Proof CSV Table",
            },
        ]
    }

    surface = suite.surface_from_snapshot(snapshot)

    assert surface["route"] == "feed"
    assert suite.visible_thread_cards(surface, "thread-A")[0]["card_id"] == "pending_turn_turn-a"
    assert suite.visible_thread_cards(surface, "thread-A")[0]["kind"] == "pending_outbound"
    assert suite.visible_thread_cards(surface, "thread-A")[0]["pending_outbound"] is True
    assert suite.visible_thread_cards(surface, "thread-A")[0]["preview"] == "Sending your message..."
    assert suite.visible_thread_cards(surface, "thread-B")[0]["kind"] == "reply"


def test_final_boss_effective_delays_enforce_overlap_floors() -> None:
    args = argparse.Namespace(
        final_boss_delay_ms_a=6000,
        final_boss_delay_ms_new=3000,
        final_boss_delay_ms_b=0,
    )

    assert suite.final_boss_effective_delays(args) == (
        suite.FINAL_BOSS_MIN_DELAY_MS_A,
        suite.FINAL_BOSS_MIN_DELAY_MS_NEW,
        suite.FINAL_BOSS_MIN_DELAY_MS_B,
    )
    assert suite.FINAL_BOSS_MIN_DELAY_MS_A >= 60000
    assert suite.FINAL_BOSS_MIN_DELAY_MS_NEW >= 35000

    args = argparse.Namespace(
        final_boss_delay_ms_a=65000,
        final_boss_delay_ms_new=40000,
        final_boss_delay_ms_b=2200,
    )

    assert suite.final_boss_effective_delays(args) == (65000, 40000, 2200)


def test_require_walkie_proof_passes_raises_failed_keys() -> None:
    suite.require_walkie_proof_passes({"scenario": "ok", "passes": {"thread": True}})

    with pytest.raises(suite.SuiteError, match="final-boss-overlap proof failed: completion_order"):
        suite.require_walkie_proof_passes(
            {
                "scenario": "final-boss-overlap",
                "passes": {"completion_order": False, "thread_scope": True},
            }
        )


def test_write_walkie_thread_lab_aggregate_proof_writes_all_summary(tmp_path: Path) -> None:
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    results = [
        {"scenario": "feed-focus-continuation", "proof": {"passes": {"thread_reused": True, "slot_preserved": True}}},
        {"scenario": "final-boss-overlap", "proof": {"passes": {"completion_order": True, "final_tiles_isolated": True}}},
    ]

    proof = suite.write_walkie_thread_lab_aggregate_proof(config, results)

    proof_path = Path(config.evidence_dir) / "all" / "proof.json"
    assert proof_path.exists()
    assert proof == {
        "schema": suite.WALKIE_THREAD_LAB_RESULT_SCHEMA,
        "scenario": "all",
        "passes": {
            "feed-focus-continuation": True,
            "final-boss-overlap": True,
        },
    }
    assert json.loads(proof_path.read_text(encoding="utf-8")) == proof


def test_turn_remote_completion_timestamp_requires_remote_ok() -> None:
    assert suite.turn_remote_completion_timestamp(None) == ""
    assert suite.turn_remote_completion_timestamp({"turn": {"updated_at": "2026-05-30T19:43:12.724977Z"}}) == ""
    assert (
        suite.turn_remote_completion_timestamp(
            {
                "turn": {
                    "updated_at": "2026-05-30T19:43:12.724977Z",
                    "server_telemetry": {"status": "ok"},
                }
            }
        )
        == "2026-05-30T19:43:12.724977Z"
    )


def test_wait_for_turn_remote_completion_order_sorts_by_remote_timestamp(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    now = {"value": 0.0}
    reads = {"turn-c": 0, "turn-b": 0, "turn-a": 0}
    payloads = {
        "turn-c": [
            {"turn": {"updated_at": "", "server_telemetry": {}}},
            {"turn": {"updated_at": "2026-05-30T19:43:03.000000Z", "server_telemetry": {"status": "ok"}}},
        ],
        "turn-b": [
            {"turn": {"updated_at": "", "server_telemetry": {}}},
            {"turn": {"updated_at": "2026-05-30T19:43:01.000000Z", "server_telemetry": {"status": "ok"}}},
        ],
        "turn-a": [
            {"turn": {"updated_at": "", "server_telemetry": {}}},
            {"turn": {"updated_at": "2026-05-30T19:43:02.000000Z", "server_telemetry": {"status": "ok"}}},
        ],
    }

    monkeypatch.setattr(suite.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: now.__setitem__("value", now["value"] + seconds))

    def fake_read_turn_record(_args, _runner, _config, turn_id):
        idx = reads[turn_id]
        reads[turn_id] = min(idx + 1, len(payloads[turn_id]) - 1)
        return payloads[turn_id][idx]

    monkeypatch.setattr(suite, "read_turn_record", fake_read_turn_record)

    result = suite.wait_for_turn_remote_completion_order(
        args,
        runner,
        config,
        ["turn-c", "turn-b", "turn-a"],
        timeout_seconds=5.0,
        sleep_seconds=0.1,
    )

    assert result == ["turn-b", "turn-a", "turn-c"]


def test_walkie_thread_lab_retry_recovers_slot_before_second_attempt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    parser = suite.build_parser()
    args = parser.parse_args(["walkie-thread-lab", "--slot", "1", "--scenario", "feed-focus-continuation", "--skip-refresh"])
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    events: list[str] = []
    call_count = {"scenario": 0}

    class FakeRunner:
        def __init__(self, dry_run: bool = False) -> None:
            self.dry_run = dry_run
            self.planned: list[dict[str, Any]] = []

        def run(self, _command, timeout=None, check=True):
            events.append("launch")
            return None

    class DummyProofServer:
        def __init__(self, **_kwargs) -> None:
            pass

        def start(self) -> None:
            events.append("proof_start")

        def stop(self) -> None:
            events.append("proof_stop")

        def register_fixture(self, *_args) -> None:
            return None

    monkeypatch.setattr(suite, "Runner", FakeRunner)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "require_emulator_serial", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "grant_runtime_permissions", lambda *_args, **_kwargs: events.append("grant_runtime_permissions"))
    monkeypatch.setattr(suite, "dismiss_permission_controller", lambda *_args, **_kwargs: events.append("dismiss_permission_controller"))
    monkeypatch.setattr(suite, "launch_command", lambda *_args, **_kwargs: ["launch-home"])
    monkeypatch.setattr(suite, "ensure_broker_command_channel", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(
        suite,
        "prepare_turn_fixtures",
        lambda *_args, **_kwargs: {
            "wake_weather": Path("wake_weather.wav"),
            "thread_continue": Path("thread_continue.wav"),
            "file_revise": Path("file_revise.wav"),
            "fresh_thread": Path("fresh_thread.wav"),
            "thread_bravo": Path("thread_bravo.wav"),
            "thread_alpha": Path("thread_alpha.wav"),
        },
    )
    monkeypatch.setattr(suite, "push_turn_fixture", lambda *_args, **_kwargs: f"/remote/{_args[-1]}")
    monkeypatch.setattr(suite, "LocalProofTurnServer", DummyProofServer)
    monkeypatch.setattr(suite, "configure_turn_lab_runtime", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(suite, "reset_walkie_thread_lab_state", lambda *_args, **_kwargs: events.append("reset_walkie_thread_lab_state"))
    monkeypatch.setattr(
        suite,
        "seed_walkie_thread_cards",
        lambda *_args, **_kwargs: {
            "thread_a": {"session_id": "session-a", "origin": {"thread_id": "thread-A"}},
            "thread_b": {"session_id": "session-b", "origin": {"thread_id": "thread-B"}},
        },
    )
    monkeypatch.setattr(suite, "cmd_create", lambda *_args, **_kwargs: events.append("create") or {"ok": True})
    monkeypatch.setattr(suite, "cmd_stop", lambda *_args, **_kwargs: events.append("stop") or {"ok": True})
    monkeypatch.setattr(suite, "cmd_start", lambda *_args, **_kwargs: events.append("start") or {"ok": True})
    monkeypatch.setattr(suite, "cmd_provision", lambda *_args, **_kwargs: events.append("provision") or {"ok": True})
    monkeypatch.setattr(suite, "cmd_seed_ui", lambda *_args, **_kwargs: events.append("seed_ui") or {"ok": True})
    monkeypatch.setattr(suite, "cmd_smoke", lambda *_args, **_kwargs: events.append("smoke") or {"ok": True})

    def fake_feed_focus(*_args, **_kwargs):
        call_count["scenario"] += 1
        events.append(f"scenario_{call_count['scenario']}")
        if call_count["scenario"] == 1:
            raise suite.SuiteError("Broker wedged")
        return {"scenario": "feed-focus-continuation", "proof": {"passes": {"thread_reused": True}}}

    monkeypatch.setattr(suite, "run_feed_focus_continuation_scenario", fake_feed_focus)

    result = suite.cmd_walkie_thread_lab(args)

    assert result["ok"] is True
    assert call_count["scenario"] == 2
    assert events.index("scenario_1") < events.index("stop") < events.index("create") < events.index("start") < events.index("provision") < events.index("seed_ui") < events.index("smoke") < events.index("scenario_2")


def test_walkie_thread_lab_retry_retries_in_place_for_non_transport_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    parser = suite.build_parser()
    args = parser.parse_args(["walkie-thread-lab", "--slot", "1", "--scenario", "feed-focus-continuation", "--skip-refresh"])
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    events: list[str] = []
    call_count = {"scenario": 0}

    class FakeRunner:
        def __init__(self, dry_run: bool = False) -> None:
            self.dry_run = dry_run
            self.planned: list[dict[str, Any]] = []

        def run(self, _command, timeout=None, check=True):
            events.append("launch")
            return None

    class DummyProofServer:
        def __init__(self, **_kwargs) -> None:
            pass

        def start(self) -> None:
            events.append("proof_start")

        def stop(self) -> None:
            events.append("proof_stop")

        def register_fixture(self, *_args) -> None:
            return None

    monkeypatch.setattr(suite, "Runner", FakeRunner)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "require_emulator_serial", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "grant_runtime_permissions", lambda *_args, **_kwargs: events.append("grant_runtime_permissions"))
    monkeypatch.setattr(suite, "dismiss_permission_controller", lambda *_args, **_kwargs: events.append("dismiss_permission_controller"))
    monkeypatch.setattr(suite, "launch_command", lambda *_args, **_kwargs: ["launch-home"])
    monkeypatch.setattr(suite, "ensure_broker_command_channel", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(
        suite,
        "prepare_turn_fixtures",
        lambda *_args, **_kwargs: {
            "wake_weather": Path("wake_weather.wav"),
            "thread_continue": Path("thread_continue.wav"),
            "file_revise": Path("file_revise.wav"),
            "fresh_thread": Path("fresh_thread.wav"),
            "thread_bravo": Path("thread_bravo.wav"),
            "thread_alpha": Path("thread_alpha.wav"),
        },
    )
    monkeypatch.setattr(suite, "push_turn_fixture", lambda *_args, **_kwargs: f"/remote/{_args[-1]}")
    monkeypatch.setattr(suite, "LocalProofTurnServer", DummyProofServer)
    monkeypatch.setattr(suite, "configure_turn_lab_runtime", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(suite, "reset_walkie_thread_lab_state", lambda *_args, **_kwargs: events.append("reset_walkie_thread_lab_state"))
    monkeypatch.setattr(
        suite,
        "seed_walkie_thread_cards",
        lambda *_args, **_kwargs: {
            "thread_a": {"session_id": "session-a", "origin": {"thread_id": "thread-A"}},
            "thread_b": {"session_id": "session-b", "origin": {"thread_id": "thread-B"}},
        },
    )
    monkeypatch.setattr(suite, "cmd_create", lambda *_args, **_kwargs: events.append("create") or {"ok": True})
    monkeypatch.setattr(suite, "cmd_stop", lambda *_args, **_kwargs: events.append("stop") or {"ok": True})
    monkeypatch.setattr(suite, "cmd_start", lambda *_args, **_kwargs: events.append("start") or {"ok": True})
    monkeypatch.setattr(suite, "cmd_provision", lambda *_args, **_kwargs: events.append("provision") or {"ok": True})
    monkeypatch.setattr(suite, "cmd_seed_ui", lambda *_args, **_kwargs: events.append("seed_ui") or {"ok": True})
    monkeypatch.setattr(suite, "cmd_smoke", lambda *_args, **_kwargs: events.append("smoke") or {"ok": True})

    def fake_feed_focus(*_args, **_kwargs):
        call_count["scenario"] += 1
        events.append(f"scenario_{call_count['scenario']}")
        if call_count["scenario"] == 1:
            raise suite.SuiteError("detail surface did not stabilize")
        return {"scenario": "feed-focus-continuation", "proof": {"passes": {"thread_reused": True}}}

    monkeypatch.setattr(suite, "run_feed_focus_continuation_scenario", fake_feed_focus)

    result = suite.cmd_walkie_thread_lab(args)

    assert result["ok"] is True
    assert call_count["scenario"] == 2
    assert "create" not in events
    assert "stop" not in events
    assert "start" not in events
    assert events.index("scenario_1") < events.index("scenario_2")


def test_continuation_fixture_start_delay_ms_matches_surface_type() -> None:
    assert suite.continuation_fixture_start_delay_ms("thread_transcript") == suite.WALKIE_THREAD_FIXTURE_START_DELAY_MS
    assert suite.continuation_fixture_start_delay_ms("feed_tile_selected") == suite.FEED_FOCUS_FIXTURE_START_DELAY_MS
    assert suite.continuation_fixture_start_delay_ms("thread_page") == suite.PAGE_CONTINUATION_FIXTURE_START_DELAY_MS
    assert suite.continuation_fixture_start_delay_ms("thread_attachment") == suite.ATTACHMENT_CONTINUATION_FIXTURE_START_DELAY_MS
    assert suite.FEED_FOCUS_FIXTURE_START_DELAY_MS == suite.WALKIE_THREAD_FIXTURE_START_DELAY_MS
    assert suite.HISTORY_RETENTION_FIXTURE_START_DELAY_MS == suite.WALKIE_THREAD_FIXTURE_START_DELAY_MS
    assert suite.FINAL_BOSS_SPEECH_START_TIMEOUT_MS >= 12000


def test_scenario_evidence_dir_clears_stale_files(tmp_path: Path) -> None:
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    scenario_dir = Path(config.evidence_dir) / "feed-focus-continuation"
    scenario_dir.mkdir(parents=True)
    stale = scenario_dir / "proof.json"
    stale.write_text('{"stale": true}', encoding="utf-8")

    result = suite.scenario_evidence_dir(config, "feed-focus-continuation")

    assert result == scenario_dir
    assert result.exists()
    assert not stale.exists()


def test_surface_from_snapshot_collapses_thread_cards_with_pending_winner() -> None:
    surface = suite.surface_from_snapshot(
        {
            "cards": [
                {
                    "card_id": "pending-a",
                    "session_id": "turn-a",
                    "pending_outbound": True,
                    "summary": "Sending your message...",
                    "origin": {"thread_id": "thread-A"},
                },
                {
                    "card_id": "base-a",
                    "session_id": "base-a",
                    "title": "Proof HTML Dashboard",
                    "origin": {"thread_id": "thread-A"},
                },
                {
                    "card_id": "base-b",
                    "session_id": "base-b",
                    "title": "Proof CSV Table",
                    "origin": {"thread_id": "thread-B"},
                },
            ]
        }
    )

    assert [card["thread_id"] for card in surface["visible_cards"]] == ["thread-A", "thread-B"]
    assert surface["visible_cards"][0]["card_id"] == "pending-a"
    assert surface["visible_cards"][0]["kind"] == "pending_outbound"


def test_wait_for_voice_thread_scope_polls_until_expected_scope(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    scopes = [
        {"mode": "new_thread", "thread_id": ""},
        {"mode": "existing_thread", "thread_id": "thread-A"},
    ]
    sleeps: list[float] = []

    monkeypatch.setattr(suite, "voice_thread_scope_status", lambda *_args, **_kwargs: scopes.pop(0))
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: sleeps.append(seconds))

    scope = suite.wait_for_voice_thread_scope(
        args,
        runner,
        config,
        lambda item: item.get("mode") == "existing_thread",
        description="test scope",
    )

    assert scope["thread_id"] == "thread-A"
    assert sleeps == [0.1]


def test_wait_for_ui_surface_with_webview_relaunch_recovers_timeout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    calls = {"wait": 0}
    launches: list[str] = []
    debug_commands: list[str] = []

    def fake_wait(*_args, **kwargs):
        calls["wait"] += 1
        if calls["wait"] == 1:
            raise suite.SuiteError("Timed out waiting for home: {'ui_debug_error': 'webview_timeout'}")
        return {"route": "feed", "schema": "pucky.ui_surface.v1", "description": kwargs["description"]}

    monkeypatch.setattr(suite, "wait_for_ui_surface", fake_wait)
    monkeypatch.setattr(
        suite,
        "launch_home_resilient",
        lambda *_args, **kwargs: launches.append(str(kwargs["stage"])) or {"ok": True},
    )
    monkeypatch.setattr(
        suite,
        "ui_debug_command",
        lambda *_args, **_kwargs: debug_commands.append(str(_args[3])) or {"ok": True},
    )

    surface = suite.wait_for_ui_surface_with_webview_relaunch(
        args,
        runner,
        config,
        lambda item: item.get("route") == "feed",
        description="home route",
        retry_stage="home_retry",
    )

    assert surface["route"] == "feed"
    assert launches == ["home_retry"]
    assert debug_commands == ["ui.debug.goto_home", "ui.debug.refresh_cards"]


def test_ui_surface_relaunches_after_transient_device_offline(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    calls = {"count": 0}
    relaunches: list[str] = []

    def fake_command_json(_runner, command, *, timeout=60):
        assert "ui.surface.get" in command
        calls["count"] += 1
        if calls["count"] == 1:
            raise suite.SuiteError("DEVICE_OFFLINE: broker reconnecting")
        return {"result": {"route": "feed", "ui_version": "git-test"}}

    monkeypatch.setattr(suite, "command_json", fake_command_json)
    monkeypatch.setattr(
        suite,
        "launch_home_resilient",
        lambda *_args, **kwargs: relaunches.append(str(kwargs["stage"])) or {"ok": True},
    )
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    surface = suite.ui_surface(args, runner, config)

    assert surface["route"] == "feed"
    assert calls["count"] == 2
    assert relaunches == ["ui_surface_reconnect_1"]


def test_ui_surface_relaunches_after_timeout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    calls = {"count": 0}
    relaunches: list[str] = []

    def fake_command_json(_runner, command, *, timeout=60):
        assert "ui.surface.get" in command
        calls["count"] += 1
        if calls["count"] == 1:
            raise suite.subprocess.TimeoutExpired(command, timeout)
        return {"result": {"route": "feed", "ui_version": "git-test"}}

    monkeypatch.setattr(suite, "command_json", fake_command_json)
    monkeypatch.setattr(
        suite,
        "launch_home_resilient",
        lambda *_args, **kwargs: relaunches.append(str(kwargs["stage"])) or {"ok": True},
    )
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    surface = suite.ui_surface(args, runner, config)

    assert surface["route"] == "feed"
    assert calls["count"] == 2
    assert relaunches == ["ui_surface_reconnect_1"]


def test_first_displayable_attachment_snapshot_normalizes_localized_viewer_paths() -> None:
    card = {
        "title": "Localized attachment",
        "transcript_messages": [
            {
                "role": "assistant",
                "attachments": [
                    {
                        "title": "Proof HTML Dashboard",
                        "mime_type": "text/html",
                        "kind": "html",
                        "path": "/data/user/0/com.pucky.device.debug/files/proof_html_dashboard.html",
                        "viewer_path": "/data/user/0/com.pucky.device.debug/files/proof_html_dashboard.html",
                    }
                ],
            }
        ],
    }

    info = suite.first_displayable_attachment_snapshot(card)

    assert info is not None
    assert info["viewer_type"] == "html_iframe"
    assert info["item"]["viewer"]["viewer_path"].endswith("proof_html_dashboard.html")
    assert suite.card_action_accessibility_label(card) == "Open file for Localized attachment"


def test_synthetic_displayable_case_payloads_stay_within_windows_budget(tmp_path: Path) -> None:
    args = ns(tmp_path)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    lengths: list[int] = []

    for index, case in enumerate(suite.displayable_reply_file_cases("proof_orbit"), start=1):
        if case.get("source") != "synthetic":
            continue
        card = suite.synthetic_displayable_case_card(case, index=index)
        command = suite.reply_cards_write_command(args, config, {"cards": [card]})
        lengths.append(suite.windows_command_length(command))

    assert lengths
    assert max(lengths) < suite.SYNTHETIC_REPLY_CARD_COMMAND_BUDGET


def test_synthetic_document_case_materializes_document_html_viewer() -> None:
    case = next(item for item in suite.displayable_reply_file_cases("proof_orbit") if item["key"] == "docx_derivative")

    card = suite.synthetic_displayable_case_card(case, index=1)
    info = suite.first_displayable_attachment_snapshot(card)

    assert info is not None
    assert info["viewer_type"] == "document_html"
    assert info["item"]["viewer"]["type"] == "document_html"
    assert info["item"]["viewer"]["viewer_src"].startswith("data:text/html")


def test_replay_card_matches_displayable_case_rejects_incompatible_title_collision() -> None:
    case = next(item for item in suite.displayable_reply_file_cases("proof_orbit") if item["key"] == "html")
    card = {
        "title": "Proof HTML Dashboard",
        "card_id": "walkie-card",
        "turn_id": "walkie-turn",
        "summary": "Existing dashboard thread with an older artifact-rich transcript.",
        "html_path": "/data/proof-pocket-computers.html",
        "transcript_messages": [
            {
                "role": "assistant",
                "attachments": [
                    {
                        "title": "Morning notes TXT",
                        "mime_type": "text/plain",
                        "path": "/data/proof-morning-notes.txt",
                    }
                ],
            }
        ],
    }

    assert suite.replay_card_matches_displayable_case(card, case) is False


def test_replay_card_matches_displayable_case_accepts_matching_html_reply() -> None:
    case = next(item for item in suite.displayable_reply_file_cases("proof_orbit") if item["key"] == "html")
    card = {
        "title": "Proof HTML Dashboard",
        "card_id": "reply-card",
        "turn_id": "reply-turn",
        "summary": "Rendered dashboard reply",
        "transcript_messages": [
            {
                "role": "assistant",
                "attachments": [
                    {
                        "title": "Proof HTML Dashboard",
                        "kind": "html",
                        "mime_type": "text/html",
                        "path": "/data/proof-dashboard.html",
                        "viewer_path": "/data/proof-dashboard-viewer.html",
                        "preview_path": "/data/proof-dashboard-preview.html",
                    }
                ],
            }
        ],
    }

    assert suite.replay_card_matches_displayable_case(card, case) is True


def test_scratch_bundle_needed_when_bundle_version_mismatches(tmp_path: Path) -> None:
    config = suite.slot_config(tmp_path, 1, run_id="fixed")

    assert suite.scratch_bundle_needed({"ui_version": ""}, config) is True
    assert suite.scratch_bundle_needed({"ui_version": "someone-elses-bundle"}, config) is True
    assert suite.scratch_bundle_needed({"ui_version": config.bundle_version}, config) is False


def test_scratch_bundle_needed_skips_official_master_bundle(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    monkeypatch.setattr(
        suite,
        "local_git_state",
        lambda *_args, **_kwargs: {
            "branch": "master",
            "head": "abc123",
            "upstream": "abc123",
            "dirty": False,
        },
    )

    assert suite.scratch_bundle_needed(
        {
            "ui_version": "git-abc123",
            "source_commit_full": "abc123",
            "source_branch": "master",
            "source_dirty": False,
        },
        config,
    ) is False


def test_cmd_prove_displayable_reply_files_preserves_official_bundle_on_skip_refresh(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(
        tmp_path,
        slot=1,
        dry_run=False,
        skip_refresh=True,
        ui_dwell_seconds=0.0,
        viewer_timeout_seconds=30,
        refresh_timeout_seconds=60,
        turn_timeout_seconds=60,
        snapshot_timeout_seconds=60,
        long_press_ms=420,
        vm_base_url="https://pucky.fly.dev",
        operator_token="operator-dev-token",
        turn_token="dev-token",
        replay_broker_log=None,
    )
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    captured: dict[str, object] = {}

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "require_emulator_serial", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite.Runner, "run", lambda self, *_args, **_kwargs: suite.subprocess.CompletedProcess([], 0, stdout="", stderr=""))
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "displayable_reply_file_cases", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        suite,
        "http_json_request",
        lambda *_args, **_kwargs: {"icons": [{"name": "proof_orbit"}]},
    )
    monkeypatch.setattr(
        suite,
        "stabilize_displayable_proof_surface",
        lambda *_args, **_kwargs: {"ok": True},
    )
    monkeypatch.setattr(suite, "launch_home_resilient", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(
        suite,
        "write_evidence",
        lambda _config, _name, payload: captured.__setitem__("payload", payload) or (Path(_config.evidence_dir) / _name),
    )
    monkeypatch.setattr(
        suite,
        "command_json",
        lambda *_args, **_kwargs: {"result": {"ui_version": "git-abc123", "source_commit_full": "abc123", "source_branch": "master", "source_dirty": False}},
    )
    monkeypatch.setattr(suite, "command_result", lambda payload: payload.get("result", payload))
    monkeypatch.setattr(
        suite,
        "local_git_state",
        lambda *_args, **_kwargs: {
            "branch": "master",
            "head": "abc123",
            "upstream": "abc123",
            "dirty": False,
        },
    )
    monkeypatch.setattr(
        suite,
        "ensure_scratch_bundle",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("scratch bundle should not run")),
    )

    result = suite.cmd_prove_displayable_reply_files(args)

    assert result["ok"] is True
    assert captured["payload"]["scratch_bundle"]["skipped"] is True


def test_cmd_prove_displayable_reply_files_stabilizes_and_recovers_before_clearing_cards(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(
        tmp_path,
        slot=1,
        dry_run=False,
        skip_refresh=False,
        ui_dwell_seconds=0.0,
        viewer_timeout_seconds=75,
        refresh_timeout_seconds=60,
        turn_timeout_seconds=60,
        snapshot_timeout_seconds=60,
        long_press_ms=420,
        vm_base_url="https://pucky.fly.dev",
        operator_token="operator-dev-token",
        turn_token="dev-token",
        replay_broker_log=None,
    )
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    captured: dict[str, object] = {}
    clear_calls: list[dict[str, object]] = []
    stages: list[str] = []

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "require_emulator_serial", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite.Runner, "run", lambda self, *_args, **_kwargs: suite.subprocess.CompletedProcess([], 0, stdout="", stderr=""))
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "run_official_refresh", lambda *_args, **_kwargs: {"ok": True, "evidence_path": "refresh.json"})
    monkeypatch.setattr(
        suite,
        "ensure_broker_command_channel",
        lambda *_args, **_kwargs: {"ok": True},
    )
    monkeypatch.setattr(suite, "displayable_reply_file_cases", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(
        suite,
        "http_json_request",
        lambda *_args, **_kwargs: {"icons": [{"name": "proof_orbit"}]},
    )
    monkeypatch.setattr(
        suite,
        "stabilize_displayable_proof_surface",
        lambda *_args, **kwargs: stages.append(str(kwargs["stage"])) or {"stage": kwargs["stage"], "ok": True},
    )
    monkeypatch.setattr(suite, "launch_home_resilient", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(
        suite,
        "write_evidence",
        lambda _config, _name, payload: captured.__setitem__("payload", payload) or (Path(_config.evidence_dir) / _name),
    )
    monkeypatch.setattr(
        suite,
        "command_json",
        lambda *_args, **_kwargs: {"result": {"ui_version": "git-abc123", "source_commit_full": "abc123", "source_branch": "master", "source_dirty": False}},
    )
    monkeypatch.setattr(suite, "command_result", lambda payload: payload.get("result", payload))
    monkeypatch.setattr(
        suite,
        "broker_command_result",
        lambda _args, _runner, _config, command_name, payload=None, **kwargs: clear_calls.append(
            {
                "command_name": command_name,
                "payload": payload or {},
                "timeout": kwargs["timeout"],
                "recovery_stage": kwargs["recovery_stage"],
                "recovery_attempts": kwargs["recovery_attempts"],
            }
        )
        or {"ok": True},
    )

    result = suite.cmd_prove_displayable_reply_files(args)

    assert result["ok"] is True
    assert stages == ["displayable_before_clear", "displayable_after_clear"]
    assert clear_calls == [
        {
            "command_name": "ui.reply_cards.clear",
            "payload": {},
            "timeout": 120,
            "recovery_stage": "displayable_reply_cards_clear",
            "recovery_attempts": 3,
        }
    ]
    assert captured["payload"]["pre_clear_surface_reset"]["stage"] == "displayable_before_clear"
    assert captured["payload"]["reply_cards_clear"]["ok"] is True


def test_proof_visible_card_unarchives_and_marks_unread() -> None:
    card = {
        "card_id": "card-runtime-icon",
        "turn_id": "turn-runtime-icon",
        "title": "Proof Runtime Icon",
        "archived": True,
        "deleted": True,
        "read": True,
    }

    visible = suite.proof_visible_card(card)

    assert visible["archived"] is False
    assert visible["deleted"] is False
    assert visible["read"] is False
    assert card["archived"] is True


def test_archive_reply_card_for_displayable_proof_uses_local_write_for_synthetic(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    calls: list[list[str]] = []
    payloads: list[dict[str, Any]] = []

    def fake_reply_write(_args, _config, payload):
        payloads.append(payload)
        return ["ui.reply_cards.set"]

    def fake_command_json(_runner, command, **_kwargs):
        calls.append(command)
        return {"ok": True, "result": {"ok": True}}

    monkeypatch.setattr(suite, "reply_cards_write_command", fake_reply_write)
    monkeypatch.setattr(suite, "command_json", fake_command_json)
    monkeypatch.setattr(suite, "command_result", lambda payload: payload["result"])

    result = suite.archive_reply_card_for_displayable_proof(
        args,
        runner,
        config,
        {"card_id": "synthetic-card", "session_id": "synthetic-session", "title": "Synthetic"},
        {"synthetic": True},
        client_action_id="archive-1",
    )

    assert result["ok"] is True
    assert calls == [["ui.reply_cards.set"]]
    assert payloads[0]["cards"][0]["archived"] is True
    assert payloads[0]["cards"][0]["read"] is True


def test_archive_reply_card_for_displayable_proof_uses_feed_action_for_live(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    commands: list[tuple[str, dict[str, Any]]] = []

    def fake_puckyctl_command(_args, _config, command_type, payload, **_kwargs):
        commands.append((command_type, payload))
        return ["puckyctl", command_type]

    monkeypatch.setattr(suite, "puckyctl_command", fake_puckyctl_command)
    monkeypatch.setattr(suite, "command_json", lambda *_args, **_kwargs: {"result": {"ok": True}})
    monkeypatch.setattr(suite, "command_result", lambda payload: payload["result"])

    result = suite.archive_reply_card_for_displayable_proof(
        args,
        runner,
        config,
        {"card_id": "live-card", "session_id": "live-session", "turn_id": "live-turn"},
        {"ok": True},
        client_action_id="archive-live",
    )

    assert result["ok"] is True
    assert commands == [
        (
            "pucky.feed.action",
            {"card_id": "live-card", "session_id": "live-session", "action": "archive", "client_action_id": "archive-live"},
        )
    ]


def test_parser_includes_wake_lab_command() -> None:
    parser = suite.build_parser()

    args = parser.parse_args(["wake-lab", "--slot", "2", "--scenario", "wake-handoff-local", "--dry-run"])

    assert args.command == "wake-lab"
    assert args.slot == 2
    assert args.scenario == "wake-handoff-local"


def test_wake_lab_gates_uses_fake_recognizer_mode(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    commands: list[tuple[str, dict]] = []

    monkeypatch.setattr(suite, "wake_command", lambda *_args: commands.append((_args[3], _args[4])) or {"ok": True})
    monkeypatch.setattr(suite, "wake_stage_snapshot", lambda *_args, **_kwargs: {"wake_status": {"running": True}, "appops_record_audio": "RECORD_AUDIO: running", "turn_status": {"state": "idle"}})
    monkeypatch.setattr(suite, "wait_for_wake_status", lambda *_args, **_kwargs: {"running": True, "requested_enabled": True, "suspended_reason": ""})
    monkeypatch.setattr(runner, "run", lambda *args, **kwargs: None)
    monkeypatch.setattr(suite, "ensure_broker_command_channel", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    suite.wake_lab_gates(args, runner, config)

    assert ("wake.config.set", {"enabled": True, "recognizer_mode": "fake"}) in commands


def test_arm_wake_turn_lab_uses_fixture_capture_and_fake_recognizer(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    commands: list[tuple[str, dict]] = []

    def fake_wake_command(*call_args):
        command = call_args[3]
        payload = call_args[4]
        commands.append((command, payload))
        return {"ok": True}

    monkeypatch.setattr(suite, "wake_command", fake_wake_command)
    monkeypatch.setattr(suite, "wait_for_wake_status", lambda *_args, **_kwargs: {"running": True})

    result = suite.arm_wake_turn_lab(
        args,
        runner,
        config,
        fixture_name="wake_flashlight",
        fixture_path="/data/local/tmp/wake_flashlight.wav",
        debug_fixture_transcript="flashlight",
        fixture_start_delay_ms=2200,
    )

    assert ("wake.stop", {}) in commands
    assert (
        "wake.config.set",
        {
            "enabled": True,
            "recognizer_mode": "fake",
            "capture_source": "fixture",
            "fixture_name": "wake_flashlight",
            "fixture_path": "/data/local/tmp/wake_flashlight.wav",
            "debug_fixture_transcript": "flashlight",
            "fixture_start_delay_ms": 2200,
        },
    ) in commands
    assert result == {"ok": True}


def test_turn_history_helpers_filter_and_extract_states(tmp_path: Path) -> None:
    payload = {
        "turns": [
            {"turn_id": "old", "trigger_source": "volume_up_hold", "events": [{"state": "armed"}]},
            {"turn_id": "new", "trigger_source": "wake_word", "events": [{"state": "armed"}, {"state": "recording"}, {"state": "uploading"}]},
        ]
    }

    record = suite.latest_turn_record(payload, trigger_source="wake_word", exclude_turn_id="old")

    assert record is not None
    assert record["turn_id"] == "new"
    assert suite.turn_event_states(record) == ["armed", "recording", "uploading"]


def test_history_record_by_turn_id_matches_turn_and_local_session() -> None:
    history = {
        "turns": [
            {"turn_id": "older", "local_session_id": "older-local"},
            {"turn_id": "turn-123", "local_session_id": "turn-local-123"},
        ]
    }

    assert suite.history_record_by_turn_id(history, "turn-123") == history["turns"][1]
    assert suite.history_record_by_turn_id(history, "turn-local-123") == history["turns"][1]
    assert suite.history_record_by_turn_id(history, "missing") is None


def test_snapshot_card_by_turn_id_matches_turn_and_session() -> None:
    snapshot = {
        "cards": [
            {"card_id": "one", "turn_id": "turn-1", "session_id": "session-1"},
            {"card_id": "two", "turn_id": "turn-2", "session_id": "session-2"},
        ]
    }

    assert suite.snapshot_card_by_turn_id(snapshot, "turn-2") == snapshot["cards"][1]
    assert suite.snapshot_card_by_turn_id(snapshot, "session-2") == snapshot["cards"][1]
    assert suite.snapshot_card_by_turn_id(snapshot, "missing") is None


def test_wait_for_turn_history_record_retries_until_match(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    now = {"value": 0.0}
    histories = iter([
        {"turns": [{"turn_id": "old", "trigger_source": "wake_word"}]},
        {"turns": [{"turn_id": "new", "trigger_source": "wake_word"}]},
    ])

    monkeypatch.setattr(suite.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: now.__setitem__("value", now["value"] + seconds))
    monkeypatch.setattr(suite, "turn_history", lambda *_args, **_kwargs: next(histories))

    result = suite.wait_for_turn_history_record(
        args,
        runner,
        config,
        lambda record, _history: bool(record) and record.get("turn_id") == "new",
        timeout_seconds=2.0,
        description="new wake turn",
    )

    assert result["record"]["turn_id"] == "new"


def test_wake_lab_host_audio_smoke_uses_android_recognizer_mode(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    commands: list[tuple[str, dict]] = []

    monkeypatch.setattr(suite, "wake_command", lambda *_args: commands.append((_args[3], _args[4])) or {"ok": True})
    monkeypatch.setattr(suite, "wake_stage_snapshot", lambda *_args, **_kwargs: {"wake_status": {"running": True}})
    monkeypatch.setattr(suite, "wait_for_wake_status", lambda *_args, **_kwargs: {"running": True})
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    suite.wake_lab_host_audio_smoke(args, runner, config)

    assert ("wake.config.set", {"enabled": True, "recognizer_mode": "android"}) in commands


def test_sync_default_recipe_bundle_uses_clear_sync_and_list(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    commands: list[str] = []

    def fake_command_json(_runner, command, **_kwargs):
        name = command[command.index("command") + 1]
        commands.append(name)
        return {"result": {"name": name}}

    monkeypatch.setattr(suite, "command_json", fake_command_json)

    result = suite.sync_default_recipe_bundle(args, runner, config)

    assert commands == ["pucky.recipes.clear", "pucky.recipes.sync", "pucky.recipes.list"]
    assert result["cleared"]["name"] == "pucky.recipes.clear"
    assert result["synced"]["name"] == "pucky.recipes.sync"
    assert result["listed"]["name"] == "pucky.recipes.list"


def test_prove_apk_actions_dry_run_plans_direct_and_recipe_commands(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, slot=2, dry_run=True, location_lat=37.4220, location_lon=-122.0841)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)

    result = suite.cmd_prove_apk_actions(args)

    planned = " ".join(" ".join(item["command"]) for item in result.get("commands", []))
    assert result["ok"] is True
    assert result["dry_run"] is True
    assert "command.catalog" in planned
    assert "notify.show" in planned
    assert "photo.capture" in planned
    assert "location.get" in planned
    assert "screenshot.capture" in planned
    assert "pucky.turn.arrival_cue.test" in planned
    assert "pucky.recipes.sync" in planned
    assert "send a notification" in planned


def test_direct_photo_capture_retries_timeout_with_full_budget(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    photo_attempts = {"count": 0}
    launches: list[str] = []
    clears: list[str] = []
    sleeps: list[float] = []

    def fake_command_json(_runner, command, **_kwargs):
        name = command[command.index("command") + 1]
        assert name == "photo.capture"
        payload = json.loads(command[command.index("--args-json") + 1])
        assert payload == {"timeout_ms": 15000, "suppress_chime": True}
        photo_attempts["count"] += 1
        if photo_attempts["count"] == 1:
            raise suite.SuiteError("Command failed: photo.capture Camera capture timed out")
        return {"result": {"captured": True, "app_private_path": "/tmp/direct-photo.jpg"}}

    monkeypatch.setattr(suite, "command_json", fake_command_json)
    monkeypatch.setattr(suite, "clear_blocking_system_dialogs", lambda *_args, **_kwargs: clears.append("clear") or False)
    monkeypatch.setattr(suite, "ensure_device_interactive", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        suite,
        "launch_home_resilient",
        lambda *_args, **_kwargs: launches.append("launch") or {"ok": True, "launch_mode": "show_home"},
    )
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: sleeps.append(seconds))

    result = suite.direct_photo_capture(args, runner, config)

    assert result["captured"] is True
    assert photo_attempts["count"] == 2
    assert clears == ["clear"]
    assert launches == ["launch"]
    assert sleeps == [1.0]


def test_prove_apk_actions_regrants_provision_permissions_before_live_checks(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, slot=1, dry_run=False, location_lat=37.4220, location_lon=-122.0841)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    granted: list[str] = []

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "ensure_broker_command_channel", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(suite, "ensure_device_interactive", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "grant_provision_permissions", lambda *_args, **_kwargs: granted.append("granted"))
    monkeypatch.setattr(suite, "emulator_health_snapshot", lambda *_args, **_kwargs: {})

    def fake_run(self, command, **kwargs):
        return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    def fake_command_json(_runner, command, **_kwargs):
        name = command[command.index("command") + 1]
        if name == "ui.bundle.status":
            return {"result": {"ui_version": "git-proof"}}
        raise suite.SuiteError("stop after permission grants")

    monkeypatch.setattr(suite.Runner, "run", fake_run)
    monkeypatch.setattr(suite, "command_json", fake_command_json)

    with pytest.raises(suite.SuiteError, match="stop after permission grants"):
        suite.cmd_prove_apk_actions(args)

    assert granted == ["granted"]


def test_launch_command_embeds_provisioning_json_for_live_feed_sync(tmp_path: Path) -> None:
    args = ns(
        tmp_path,
        turn_url="https://pucky.fly.dev/api/turn",
        turn_token="secret-token",
    )
    config = suite.slot_config(tmp_path, 1, run_id="fixed")

    command = suite.launch_command(args, config)

    assert "provisioning_json_base64" in command
    encoded = command[command.index("provisioning_json_base64") + 1]
    payload = json.loads(suite.base64.b64decode(encoded).decode("utf-8"))
    assert payload["schema"] == "pucky.provisioning.v1"
    assert payload["pucky_turn_url"] == "https://pucky.fly.dev/api/turn"
    assert payload["pucky_api_token"] == "secret-token"
    assert payload["device_id"] == config.device_id
    assert payload["ui_shell_mode"] == "web_cached"


def test_adb_command_refuses_corrupted_physical_serial(tmp_path: Path) -> None:
    args = ns(tmp_path)

    with pytest.raises(suite.SuiteError, match="Refusing non-emulator"):
        suite.adb_command(args, "ZY22JZ26LK", ["install", "-r", "app-debug.apk"])


def test_harness_source_avoids_physical_deploy_paths_and_bare_installs() -> None:
    source = Path(suite.__file__).read_text(encoding="utf-8")

    forbidden = [
        "ZY22JZ26LK",
        "deploy-canonical-apk.ps1",
        "install-and-provision-apk-tunnel.ps1",
        "restore-pucky-cover-dev-loop.ps1",
        "adb install",
    ]
    for token in forbidden:
        assert token not in source


def test_runner_dry_run_records_without_executing(tmp_path: Path) -> None:
    runner = suite.Runner(dry_run=True)
    result = runner.run(["definitely-not-a-real-command"], cwd=tmp_path)
    pid = runner.start_detached(
        ["also-not-real"],
        cwd=tmp_path,
        env={},
        stdout_path=tmp_path / "out.log",
        stderr_path=tmp_path / "err.log",
    )

    assert result.returncode == 0
    assert pid == -1
    assert len(runner.planned) == 2
    assert not (tmp_path / "out.log").exists()


def test_extract_json_recovers_last_valid_object() -> None:
    text = "noise\n{\"ignored\":true}\nmore\n{\"schema\":\"puckyctl.result.v1\",\"ok\":true}\n"

    assert suite.extract_json(text) == {"schema": "puckyctl.result.v1", "ok": True}


def test_command_json_retries_transient_puckyctl_failures() -> None:
    runner = suite.Runner(dry_run=False)
    attempts = {"count": 0}

    def fake_run(command, **kwargs):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise suite.SuiteError("ConnectionAbortedError: [WinError 10053] An established connection was aborted")
        return suite.subprocess.CompletedProcess(command, 0, stdout='{"ok":true}', stderr="")

    runner.run = fake_run  # type: ignore[method-assign]

    result = suite.command_json(runner, ["fake", "command"], timeout=1)

    assert attempts["count"] == 3
    assert result == {"ok": True}


def test_command_json_retries_device_offline_with_longer_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = suite.Runner(dry_run=False)
    attempts = {"count": 0}
    sleeps: list[float] = []

    def fake_run(command, **kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise suite.SuiteError("DEVICE_OFFLINE: emulator-5554 temporarily unavailable")
        return suite.subprocess.CompletedProcess(command, 0, stdout='{"ok":true}', stderr="")

    runner.run = fake_run  # type: ignore[method-assign]
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: sleeps.append(seconds))

    result = suite.command_json(runner, ["fake", "command"], timeout=1)

    assert attempts["count"] == 2
    assert result == {"ok": True}
    assert sleeps and sleeps[0] >= 2.0


def test_command_json_retries_extended_device_offline_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = suite.Runner(dry_run=False)
    attempts = {"count": 0}
    sleeps: list[float] = []

    def fake_run(command, **kwargs):
        attempts["count"] += 1
        if attempts["count"] <= 5:
            raise suite.SuiteError("DEVICE_OFFLINE: emulator-5554 temporarily unavailable")
        return suite.subprocess.CompletedProcess(command, 0, stdout='{"ok":true}', stderr="")

    runner.run = fake_run  # type: ignore[method-assign]
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: sleeps.append(seconds))

    result = suite.command_json(runner, ["fake", "command"], timeout=1)

    assert attempts["count"] == 6
    assert result == {"ok": True}
    assert sleeps[:5] == [2.0, 4.0, 6.0, 8.0, 10.0]


def test_command_json_retries_broker_unavailable_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = suite.Runner(dry_run=False)
    attempts = {"count": 0}
    sleeps: list[float] = []

    def fake_run(command, **kwargs):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise suite.SuiteError("BROKER_UNAVAILABLE: [WinError 10061] No connection could be made because the target machine actively refused it")
        return suite.subprocess.CompletedProcess(command, 0, stdout='{"ok":true}', stderr="")

    runner.run = fake_run  # type: ignore[method-assign]
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: sleeps.append(seconds))

    result = suite.command_json(runner, ["fake", "command"], timeout=1)

    assert attempts["count"] == 3
    assert result == {"ok": True}
    assert sleeps[:2] == [1.5, 3.0]


def test_feed_request_retries_transient_transport_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts = {"count": 0}
    sleeps: list[float] = []

    def fake_http_json_request(*_args, **_kwargs):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise suite.SuiteError("ConnectionResetError: transient reset")
        return {"items": [{"turn_id": "turn-123"}], "next_cursor": ""}

    monkeypatch.setattr(suite, "http_json_request", fake_http_json_request)
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: sleeps.append(seconds))

    result = suite.feed_request("https://pucky.fly.dev/api/turn", "secret-token")

    assert attempts["count"] == 3
    assert result["items"][0]["turn_id"] == "turn-123"
    assert sleeps == [0.5, 1.0]


def test_broker_command_result_recovers_after_broker_unavailable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    attempts = {"count": 0}
    recoveries: list[str] = []

    def fake_command_json(_runner, command, *, timeout=60):
        assert "pucky.turn.history" in command
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise suite.SuiteError("BROKER_UNAVAILABLE: [WinError 10061] No connection could be made because the target machine actively refused it")
        return {"result": {"ok": True, "items": []}}

    monkeypatch.setattr(suite, "command_json", fake_command_json)
    monkeypatch.setattr(
        suite,
        "recover_broker_command_path",
        lambda *_args, **kwargs: recoveries.append(str(kwargs["stage"])) or {"ok": True},
    )

    result = suite.broker_command_result(
        args,
        runner,
        config,
        "pucky.turn.history",
        {"limit": 1},
        timeout=120,
        recovery_stage="turn_history_recover",
    )

    assert result["ok"] is True
    assert attempts["count"] == 2
    assert recoveries == ["turn_history_recover_1"]


def test_appops_running_parser_is_case_insensitive() -> None:
    assert suite.appops_indicates_running("RECORD_AUDIO: running; time=+2m15s")
    assert not suite.appops_indicates_running("RECORD_AUDIO: time=+2m15s")


def test_doctor_reports_missing_tools_without_mutating(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    args = ns(tmp_path)
    monkeypatch.setattr(suite, "port_available", lambda port: True)
    monkeypatch.setattr(suite, "free_space_gb", lambda path: 12.0)

    result = suite.doctor(args)

    assert result["schema"] == "pucky.emulator_doctor.v1"
    assert result["ok"] is False
    by_name = {item["name"]: item for item in result["checks"]}
    assert by_name["adb"]["ok"] is False
    assert by_name["emulator"]["ok"] is False


def test_doctor_flags_low_avd_workspace_free_space(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    args = ns(tmp_path)
    monkeypatch.setattr(suite, "port_available", lambda port: True)
    monkeypatch.setattr(suite, "free_space_gb", lambda path: 3.09)

    result = suite.doctor(args)
    by_name = {item["name"]: item for item in result["checks"]}

    assert by_name["avd_workspace_free_space"]["ok"] is False
    assert "3.09 GB free" in by_name["avd_workspace_free_space"]["detail"]


def test_wait_for_broker_device_requires_online_slot_device(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    monkeypatch.setattr(
        suite,
        "wait_http",
        lambda *_args, **_kwargs: {"devices": [{"device_id": config.device_id, "online": True}]},
    )

    assert suite.wait_for_broker_device(config, timeout=0.1)["device_id"] == config.device_id


def test_wait_for_wake_status_retries_until_predicate_matches(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    now = {"value": 0.0}
    statuses = iter([
        {"running": False, "suspended_reason": "service_not_started"},
        {"running": True, "suspended_reason": ""},
    ])

    monkeypatch.setattr(suite.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: now.__setitem__("value", now["value"] + seconds))
    monkeypatch.setattr(suite, "wake_status", lambda *_args, **_kwargs: next(statuses))

    result = suite.wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: bool(status.get("running")),
        timeout_seconds=3.0,
        description="wake running",
    )

    assert result["running"] is True


def test_emulator_boot_ready_accepts_bootanim_stopped(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")

    monkeypatch.setattr(
        suite,
        "boot_signal",
        lambda _args, _runner, _config, prop: "stopped" if prop == "init.svc.bootanim" else "",
    )

    assert suite.emulator_boot_ready(args, suite.Runner(dry_run=False), config) is True


def test_wait_for_boot_reports_early_emulator_exit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    now = {"value": 0.0}

    monkeypatch.setattr(suite.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: now.__setitem__("value", now["value"] + seconds))
    monkeypatch.setattr(suite, "process_alive", lambda pid: False)
    monkeypatch.setattr(suite, "adb_transport_state", lambda *_args, **_kwargs: "missing")

    with pytest.raises(suite.SuiteError, match="Emulator exited before ADB became ready"):
        suite.wait_for_boot(args, runner, config, pid=123, timeout=10.0)


def test_wait_for_boot_reports_final_adb_state_on_timeout(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    now = {"value": 0.0}

    monkeypatch.setattr(suite.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: now.__setitem__("value", now["value"] + seconds))
    monkeypatch.setattr(suite, "process_alive", lambda pid: True)
    monkeypatch.setattr(suite, "adb_transport_state", lambda *_args, **_kwargs: "offline")

    with pytest.raises(suite.SuiteError, match="adb state: offline"):
        suite.wait_for_boot(args, runner, config, pid=123, timeout=3.0)


def test_parse_display_ids_uses_first_surfaceflinger_display() -> None:
    output = """Display 4619827259835644672 (HWC display 0): port=0 pnpId=GGL displayName="EMU_display_0"
Display 4619827551948147201 (HWC display 1): port=1 pnpId=GGL displayName="EMU_display_1"
"""

    assert suite.parse_display_ids(output) == ["4619827259835644672", "4619827551948147201"]


def test_cmd_start_reuses_existing_connected_serial(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, slot=1, no_wait=True, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    launched: list[str] = []

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "load_state", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(suite, "save_state", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "avd_artifacts_exist", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "tune_avd_config", lambda _cfg: None)
    monkeypatch.setattr(suite.Runner, "start_detached", lambda self, *args, **kwargs: launched.append("launched") or 123)

    result = suite.cmd_start(args)

    assert result["ok"] is True
    assert launched == []


def test_install_services_ready_requires_mount_and_storage_probe(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)

    monkeypatch.setattr(suite, "package_manager_ready", lambda *_args, **_kwargs: True)

    results = [
        suite.subprocess.CompletedProcess([], 0, stdout="Service mount: found\n", stderr=""),
        suite.subprocess.CompletedProcess([], 0, stdout="private mounted null\n", stderr=""),
    ]

    def fake_run(self, command, **kwargs):
        return results.pop(0)

    monkeypatch.setattr(suite.Runner, "run", fake_run)

    assert suite.install_services_ready(args, runner, config) is True


def test_install_services_ready_treats_probe_timeout_as_not_ready(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)

    monkeypatch.setattr(suite, "package_manager_ready", lambda *_args, **_kwargs: True)

    def fake_run(self, command, **kwargs):
        joined = " ".join(command)
        if "service check mount" in joined:
            return suite.subprocess.CompletedProcess(command, 0, stdout="Service mount: found\n", stderr="")
        raise suite.subprocess.TimeoutExpired(command, kwargs.get("timeout", 20))

    monkeypatch.setattr(suite.Runner, "run", fake_run)

    assert suite.install_services_ready(args, runner, config) is False


def test_wait_for_install_services_requires_stable_window(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    now = {"value": 0.0}
    readiness = iter([False, True, True, True])

    monkeypatch.setattr(suite.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(suite, "install_services_ready", lambda *_args, **_kwargs: next(readiness))

    def fake_sleep(seconds: float) -> None:
        now["value"] += seconds

    monkeypatch.setattr(suite.time, "sleep", fake_sleep)

    suite.wait_for_install_services(args, runner, config, timeout=20.0, settle_seconds=4.0)

    assert now["value"] >= 4.0


def test_cmd_provision_waits_for_install_services_before_install(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, slot=1, skip_build=True, dry_run=False)
    args.apk.write_text("apk", encoding="utf-8")
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    events: list[str] = []

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "start_node_broker", lambda *_args, **_kwargs: -1)
    monkeypatch.setattr(
        suite,
        "wait_for_install_services",
        lambda *_args, **_kwargs: events.append("install_services_ready"),
    )
    monkeypatch.setattr(
        suite,
        "ensure_broker_command_channel",
        lambda *_args, **_kwargs: {"stage": "after_provision_launch", "device": {"device_id": config.device_id, "online": True}, "ping": {"ok": True}},
    )
    monkeypatch.setattr(suite, "wait_for_broker_device", lambda *_args, **_kwargs: {"device_id": config.device_id, "online": True})
    monkeypatch.setattr(suite, "load_state", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(suite, "save_state", lambda *_args, **_kwargs: {})

    def fake_run(self, command, **kwargs):
        joined = " ".join(command)
        if " install " in f" {joined} ":
            events.append("install")
        return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(suite.Runner, "run", fake_run)

    result = suite.cmd_provision(args)

    assert result["ok"] is True
    assert events[:2] == ["install_services_ready", "install"]


def test_cmd_provision_grants_calendar_and_media_permissions(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, slot=1, skip_build=True, dry_run=False)
    args.apk.write_text("apk", encoding="utf-8")
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    commands: list[list[str]] = []

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "start_node_broker", lambda *_args, **_kwargs: -1)
    monkeypatch.setattr(suite, "wait_for_install_services", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "ensure_broker_command_channel", lambda *_args, **_kwargs: {"stage": "after_provision_launch", "ok": True})
    monkeypatch.setattr(suite, "load_state", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(suite, "save_state", lambda *_args, **_kwargs: {})

    def fake_run(self, command, **kwargs):
        commands.append(command)
        return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(suite.Runner, "run", fake_run)

    result = suite.cmd_provision(args)

    assert result["ok"] is True
    joined = [" ".join(command) for command in commands if " pm grant " in f" {' '.join(command)} "]
    assert any("android.permission.READ_CALENDAR" in item for item in joined)
    assert any("android.permission.WRITE_CALENDAR" in item for item in joined)
    assert any("android.permission.READ_MEDIA_IMAGES" in item for item in joined)
    assert any("android.permission.READ_MEDIA_VIDEO" in item for item in joined)
    assert any("android.permission.READ_MEDIA_AUDIO" in item for item in joined)


def test_cmd_provision_falls_back_to_no_streaming_install_after_streamed_storage_npe(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, slot=1, skip_build=True, dry_run=False)
    args.apk.write_text("apk", encoding="utf-8")
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    install_commands: list[list[str]] = []

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "start_node_broker", lambda *_args, **_kwargs: -1)
    monkeypatch.setattr(suite, "wait_for_install_services", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "ensure_broker_command_channel", lambda *_args, **_kwargs: {"stage": "after_provision_launch", "ok": True})
    monkeypatch.setattr(suite, "load_state", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(suite, "save_state", lambda *_args, **_kwargs: {})

    def fake_run(self, command, **kwargs):
        joined = " ".join(command)
        if " install " in f" {joined} ":
            install_commands.append(command)
            if "--no-streaming" not in command:
                raise suite.SuiteError(
                    "Command failed (1): adb install -r app-debug.apk\nstdout:\nPerforming Streamed Install\n\nstderr:\n"
                    "Exception occurred while executing 'install':\n"
                    "java.lang.NullPointerException: Attempt to invoke virtual method "
                    "'void android.content.pm.PackageManagerInternal.freeStorage(java.lang.String, long, int)' "
                    "on a null object reference\n\tat com.android.server.StorageManagerService.allocateBytes"
                )
        return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(suite.Runner, "run", fake_run)

    result = suite.cmd_provision(args)

    assert result["ok"] is True
    assert len(install_commands) == 2
    assert install_commands[0][-2:] == ["-r", str(args.apk)]
    assert install_commands[1][-3:] == ["--no-streaming", "-r", str(args.apk)]


def test_save_state_preserves_slot_and_run_id(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    monkeypatch.setattr(suite, "now_iso", lambda: "2026-05-23T00:00:00Z")

    saved = suite.save_state(config, {"serial": config.serial})
    loaded = json.loads(Path(config.state_path).read_text(encoding="utf-8"))

    assert saved == loaded
    assert loaded["slot"] == 1
    assert loaded["run_id"] == "fixed"
    assert loaded["serial"] == "emulator-5554"


def test_clean_removes_slot_avd_artifacts(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, slot=1, dry_run=True)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "cmd_stop", lambda _args: {"ok": True})

    result = suite.cmd_clean(args)
    removed = result["removed"]

    assert any(path.endswith("pucky_webview_api35_01.avd") for path in removed)
    assert any(path.endswith("pucky_webview_api35_01.ini") for path in removed)


def test_vm_thread_query_command_targets_live_codex_state_row(tmp_path: Path) -> None:
    args = ns(tmp_path, flyctl=Path("flyctl"), fly_app="pucky", vm_codex_home="/data/home/codex")

    command = suite.vm_thread_query_command(args, "thread-123")

    joined = " ".join(command)
    assert command[:4] == ["flyctl", "ssh", "console", "-a"]
    assert "pucky" in command
    assert "python3 -c" in joined
    assert "/data/home/codex" in joined
    assert "thread-123" in joined


def test_seed_ui_dry_run_plans_command_bus_not_adb_push(monkeypatch: pytest.MonkeyPatch) -> None:
    args = ns(suite.ROOT, slot=1, cards_json="", max_bundle_bytes=1024 * 1024)
    config = suite.slot_config(suite.ROOT, 1, run_id="dry-run-slot01")
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "start_static_server", lambda *_args, **_kwargs: -1)

    result = suite.cmd_seed_ui(args)
    planned = " ".join(" ".join(item["command"]) for item in result["commands"])

    assert result["dry_run"] is True
    assert "ui.bundle.refresh" in planned
    assert "ui.reply_cards.set" in planned
    assert "adb push" not in planned
    assert "run-as" not in planned
    assert "shared_prefs" not in planned
    assert config.device_id in planned


def test_seed_ui_can_load_cards_from_file(tmp_path: Path) -> None:
    args = ns(tmp_path, slot=1, cards_json="", cards_file=tmp_path / "cards.json", max_bundle_bytes=1024 * 1024)
    args.cards_file.write_text('{"cards":[{"session_id":"from_file","title":"From file"}]}', encoding="utf-8")
    config = suite.slot_config(tmp_path, 1, run_id="fixed")

    payload = suite.cards_payload_from_args(args, config)

    assert payload["cards"][0]["session_id"] == "from_file"
    assert payload["cards"][0]["title"] == "From file"


def test_prove_thread_origin_dry_run_uses_refresh_sync_and_relaunch(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(
        tmp_path,
        slot=2,
        turn_url="https://pucky.fly.dev/api/turn",
        turn_token="secret",
        sample_audio=tmp_path / "sample.wav",
        vm_base_url="https://pucky.fly.dev",
        operator_token="",
        fly_app="pucky",
        vm_codex_home="/data/home/codex",
        turn_timeout_seconds=180,
        vm_query_timeout_seconds=90,
        refresh_timeout_seconds=180,
        ui_dwell_seconds=0.0,
        open_card_tap="528,230",
        gear_tap="930,312",
        skip_refresh=False,
    )
    args.sample_audio.write_bytes(b"RIFFdemo")
    config = suite.slot_config(tmp_path, 2, run_id="dry-run-slot02")

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "capture_screenshot", lambda *_args, **_kwargs: None)

    result = suite.cmd_prove_thread_origin(args)

    planned = " ".join(" ".join(item["command"]) for item in result.get("commands", []))
    assert result["ok"] is True
    assert result["dry_run"] is True
    assert "refresh_pucky_html_official.py" in planned
    assert "provisioning_json_base64" in planned
    assert "pucky.feed.sync" in planned
    assert "ui.reply_cards.get" in planned
    assert "force-stop" in planned
    assert "input tap 528 230" in planned


def test_prove_thread_origin_waits_for_broker_channel_around_refresh(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(
        tmp_path,
        slot=2,
        dry_run=False,
        turn_url="https://pucky.fly.dev/api/turn",
        turn_token="secret",
        sample_audio=tmp_path / "sample.wav",
        vm_base_url="https://pucky.fly.dev",
        operator_token="",
        fly_app="pucky",
        vm_codex_home="/data/home/codex",
        turn_timeout_seconds=180,
        vm_query_timeout_seconds=90,
        refresh_timeout_seconds=180,
        ui_dwell_seconds=0.0,
        open_card_tap="528,230",
        gear_tap="930,312",
        skip_refresh=False,
    )
    args.sample_audio.write_bytes(b"RIFFdemo")
    config = suite.slot_config(tmp_path, 2, run_id="fixed")
    channel_stages: list[str] = []

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(
        suite,
        "ensure_broker_command_channel",
        lambda _args, _runner, _config, *, stage, timeout_seconds: channel_stages.append(stage) or {"stage": stage, "ok": True},
    )
    monkeypatch.setattr(suite, "run_official_refresh", lambda *_args, **_kwargs: {"ok": True, "evidence_path": "refresh.json"})
    monkeypatch.setattr(
        suite,
        "post_live_turn",
        lambda _args, turn_id: {
            "turn_id": turn_id,
            "card_id": "card-prove",
            "title": "Proof card",
            "origin": {
                "runtime": "codex",
                "thread_id": "thread-123",
                "thread_title": "Proof card",
                "rollout_path": "/data/home/codex/sessions/proof.jsonl",
                "source": "vscode",
                "model": "gpt-5.5",
                "model_provider": "openai",
                "reasoning_effort": "high",
                "sandbox_policy": "danger-full-access",
                "approval_mode": "never",
            },
        },
    )
    monkeypatch.setattr(
        suite,
        "query_live_vm_thread",
        lambda *_args, **_kwargs: {
            "id": "thread-123",
            "title": "Proof card",
            "rollout_path": "/data/home/codex/sessions/proof.jsonl",
            "source": "vscode",
            "model": "gpt-5.5",
            "model_provider": "openai",
            "reasoning_effort": "high",
            "sandbox_policy": "danger-full-access",
            "approval_mode": "never",
            "rollout_exists": True,
        },
    )
    monkeypatch.setattr(suite, "tap", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "capture_screenshot", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "write_evidence", lambda config, name, payload: Path(config.evidence_dir) / name)

    def fake_run(self, command, **kwargs):
        return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    def fake_command_json(_runner, command, **_kwargs):
        command_type = command[command.index("command") + 1]
        if command_type == "ui.bundle.status":
            return {"result": {"ui_version": "git-proof", "source_commit_full": "proof"}}
        if command_type == "pucky.feed.sync":
            return {"result": {"ok": True}}
        if command_type == "ui.reply_cards.get":
            return {
                "result": {
                    "cards": [
                        {
                            "card_id": "card-prove",
                            "turn_id": "prove-thread-origin-turn",
                            "session_id": "prove-thread-origin-turn",
                            "origin": {
                                "runtime": "codex",
                                "thread_id": "thread-123",
                                "thread_title": "Proof card",
                                "rollout_path": "/data/home/codex/sessions/proof.jsonl",
                                "source": "vscode",
                                "model": "gpt-5.5",
                                "model_provider": "openai",
                                "reasoning_effort": "high",
                                "sandbox_policy": "danger-full-access",
                                "approval_mode": "never",
                            },
                        }
                    ]
                }
            }
        return {"result": {"ok": True}}

    monkeypatch.setattr(suite.Runner, "run", fake_run)
    monkeypatch.setattr(suite, "command_json", fake_command_json)
    monkeypatch.setattr(suite, "find_snapshot_card", lambda *_args, **_kwargs: {
        "card_id": "card-prove",
        "turn_id": "prove-thread-origin-turn",
        "session_id": "prove-thread-origin-turn",
        "origin": {
            "runtime": "codex",
            "thread_id": "thread-123",
            "thread_title": "Proof card",
            "rollout_path": "/data/home/codex/sessions/proof.jsonl",
            "source": "vscode",
            "model": "gpt-5.5",
            "model_provider": "openai",
            "reasoning_effort": "high",
            "sandbox_policy": "danger-full-access",
            "approval_mode": "never",
        },
    })

    result = suite.cmd_prove_thread_origin(args)

    assert result["ok"] is True
    assert channel_stages == ["before_refresh", "after_refresh", "after_relaunch"]


def test_ensure_broker_command_channel_clears_blockers_until_reconnected(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    now = {"value": 0.0}
    devices = iter(
        [
            None,
            {"device_id": config.device_id, "online": False},
            {"device_id": config.device_id, "online": True},
        ]
    )
    clears: list[str] = []
    ping_attempts = {"count": 0}

    monkeypatch.setattr(suite.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: now.__setitem__("value", now["value"] + seconds))
    monkeypatch.setattr(suite, "broker_device_snapshot", lambda *_args, **_kwargs: next(devices))
    monkeypatch.setattr(suite, "clear_blocking_system_dialogs", lambda *_args, **_kwargs: clears.append("clear") or False)

    def fake_command_json(_runner, _command, **_kwargs):
        ping_attempts["count"] += 1
        if ping_attempts["count"] == 1:
            raise suite.SuiteError("DEVICE_OFFLINE: broker reconnecting")
        return {"result": {"ok": True}}

    monkeypatch.setattr(suite, "command_json", fake_command_json)

    result = suite.ensure_broker_command_channel(args, runner, config, stage="after_launch", timeout_seconds=5)

    assert result["stage"] == "after_launch"
    assert result["ping"]["ok"] is True
    assert len(clears) >= 2


def test_ensure_broker_command_channel_accepts_ping_without_device_listing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    now = {"value": 0.0}
    ping_attempts = {"count": 0}

    monkeypatch.setattr(suite.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: now.__setitem__("value", now["value"] + seconds))
    monkeypatch.setattr(suite, "broker_device_snapshot", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "broker_health_available", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "clear_blocking_system_dialogs", lambda *_args, **_kwargs: False)

    def fake_command_json(_runner, _command, **_kwargs):
        ping_attempts["count"] += 1
        return {"result": {"ok": True}}

    monkeypatch.setattr(suite, "command_json", fake_command_json)

    result = suite.ensure_broker_command_channel(args, runner, config, stage="after_launch", timeout_seconds=5)

    assert ping_attempts["count"] == 1
    assert result["ping"]["ok"] is True
    assert result["device"]["device_id"] == config.device_id
    assert result["device"]["discovered_via_ping"] is True


def test_wait_for_snapshot_card_retries_until_card_lands(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    now = {"value": 0.0}
    snapshots = iter(
        [
            {"cards": []},
            {"cards": [{"card_id": "card-prove", "turn_id": "turn-123", "origin": {"thread_id": "thread-123"}}]},
        ]
    )

    monkeypatch.setattr(suite.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: now.__setitem__("value", now["value"] + seconds))
    monkeypatch.setattr(suite, "command_json", lambda *_args, **_kwargs: {"result": next(snapshots)})

    snapshot, card = suite.wait_for_snapshot_card(args, runner, config, card_id="card-prove", turn_id="turn-123", timeout=5.0)

    assert card["card_id"] == "card-prove"
    assert snapshot["cards"][0]["turn_id"] == "turn-123"


def test_prove_thread_origin_records_structured_refresh_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(
        tmp_path,
        slot=1,
        dry_run=False,
        turn_url="https://pucky.fly.dev/api/turn",
        turn_token="secret",
        sample_audio=tmp_path / "sample.wav",
        vm_base_url="https://pucky.fly.dev",
        operator_token="",
        fly_app="pucky",
        vm_codex_home="/data/home/codex",
        refresh_timeout_seconds=180,
        skip_refresh=False,
    )
    args.sample_audio.write_bytes(b"RIFFdemo")
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    captured: dict[str, object] = {}

    monkeypatch.setattr(suite, "ROOT", tmp_path)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(suite, "ensure_broker_command_channel", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(suite, "run_official_refresh", lambda *_args, **_kwargs: (_ for _ in ()).throw(suite.SuiteError("refresh boom")))
    monkeypatch.setattr(suite, "adb_transport_state", lambda *_args, **_kwargs: "offline")
    monkeypatch.setattr(suite, "broker_device_snapshot", lambda *_args, **_kwargs: {"device_id": config.device_id, "online": False})
    def fake_write_evidence(_config, _name, payload):
        captured["payload"] = payload
        return Path(_config.evidence_dir) / "thread-origin-failure.json"

    monkeypatch.setattr(suite, "write_evidence", fake_write_evidence)

    with pytest.raises(suite.SuiteError, match="thread-origin-failure.json"):
        suite.cmd_prove_thread_origin(args)

    failure = captured["payload"]
    assert failure["stage"] == "refresh"
    assert failure["kind"] == "refresh_failed"
    assert failure["adb_state"] == "offline"
    assert failure["broker_device"]["online"] is False


def test_provision_refuses_when_configured_serial_is_not_emulator(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    args = ns(tmp_path, slot=1, skip_build=True)
    bad = suite.slot_config(suite.ROOT, 1, run_id="dry-run-slot01")
    bad = suite.SlotConfig(**{**bad.__dict__, "serial": "ZY22JZ26LK"})
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: bad)

    with pytest.raises(suite.SuiteError, match="Refusing non-emulator"):
        suite.cmd_provision(args)


def test_launch_home_resilient_falls_back_to_full_launch(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    commands: list[list[str]] = []

    def fake_run(command, **kwargs):
        commands.append(command)
        joined = " ".join(command)
        if "show_home true" in joined:
            raise suite.SuiteError("foreground timeout")
        return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    runner.run = fake_run  # type: ignore[method-assign]
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    result = suite.launch_home_resilient(args, runner, config)

    assert result["launch_mode"] == "full_launch"
    assert any("show_home true" in " ".join(command) for command in commands)
    assert any("connect true" in " ".join(command) for command in commands)


def test_reset_home_surface_if_needed_uses_ui_debug_for_open_transcript(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    commands: list[str] = []

    monkeypatch.setattr(suite, "clear_blocking_system_dialogs", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(
        suite,
        "ui_surface",
        lambda *_args, **_kwargs: {
            "route": "feed",
            "ui_debug_available": True,
            "detail": {"open": True},
            "thread_scope": {"visible": True, "active": "true", "mode": "existing_thread"},
            "focused_card": {"active": False},
        },
    )
    monkeypatch.setattr(
        suite,
        "ui_debug_command",
        lambda *_args, **_kwargs: commands.append(_args[3]) or {"ok": True, "handled": True},
    )

    result = suite.reset_home_surface_if_needed(args, runner, config)

    assert result["cleared_dialogs"] is True
    assert result["needs_reset"] is True
    assert result["used_ui_debug"] is True
    assert commands == ["ui.debug.goto_home", "ui.debug.clear_focus"]


def test_reset_walkie_thread_surface_refreshes_seeded_cards(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    commands: list[str] = []

    monkeypatch.setattr(
        suite,
        "ui_debug_command",
        lambda *_args, **_kwargs: commands.append(_args[3]) or {"ok": True, "handled": True},
    )

    suite.reset_walkie_thread_surface(args, runner, config)

    assert commands == ["ui.debug.goto_home", "ui.debug.clear_focus", "ui.debug.refresh_cards"]


def test_stabilize_displayable_proof_surface_stops_turn_and_clears_focus(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False, ui_dwell_seconds=0.0)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    calls: list[str] = []

    monkeypatch.setattr(suite, "command_json", lambda *_args, **_kwargs: {"result": {"ok": True}})
    monkeypatch.setattr(suite, "command_result", lambda payload: payload.get("result", payload))
    monkeypatch.setattr(
        suite,
        "launch_home_resilient",
        lambda *_args, **kwargs: calls.append(str(kwargs["stage"])) or {"ok": True},
    )
    monkeypatch.setattr(
        suite,
        "reset_home_surface_if_needed",
        lambda *_args, **_kwargs: {"needs_reset": True, "used_ui_debug": True},
    )
    monkeypatch.setattr(
        suite,
        "ui_surface",
        lambda *_args, **_kwargs: {"route": "feed", "ui_debug_available": True, "detail": {}, "thread_scope": {}, "focused_card": {}},
    )
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    result = suite.stabilize_displayable_proof_surface(
        args,
        runner,
        config,
        stage="displayable_html_materialize",
        timeout_seconds=45,
    )

    assert result["turn_stop"]["ok"] is True
    assert result["home_reset"]["used_ui_debug"] is True
    assert calls == ["displayable_html_materialize"]


def test_stabilize_displayable_proof_surface_retries_full_launch_when_route_is_blank(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False, ui_dwell_seconds=0.0)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    surfaces = iter([
        {"route": "", "ui_debug_available": False, "detail": {}, "thread_scope": {}, "focused_card": {}},
        {"route": "feed", "ui_debug_available": True, "detail": {}, "thread_scope": {}, "focused_card": {}},
    ])
    commands: list[list[str]] = []

    runner.run = lambda command, **_kwargs: commands.append(command) or suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")  # type: ignore[method-assign]
    monkeypatch.setattr(suite, "command_json", lambda *_args, **_kwargs: {"result": {"ok": True}})
    monkeypatch.setattr(suite, "command_result", lambda payload: payload.get("result", payload))
    monkeypatch.setattr(suite, "launch_home_resilient", lambda *_args, **_kwargs: {"ok": True, "launch_mode": "show_home"})
    monkeypatch.setattr(suite, "reset_home_surface_if_needed", lambda *_args, **_kwargs: {"needs_reset": True})
    monkeypatch.setattr(suite, "ui_surface", lambda *_args, **_kwargs: next(surfaces))
    monkeypatch.setattr(suite, "launch_command", lambda *_args, **_kwargs: ["adb", "launch"])
    monkeypatch.setattr(suite, "ensure_broker_command_channel", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    result = suite.stabilize_displayable_proof_surface(
        args,
        runner,
        config,
        stage="displayable_jpg_home",
        timeout_seconds=45,
    )

    assert result["route_retry"]["channel"]["ok"] is True
    assert result["final_surface"]["route"] == "feed"
    assert commands == [["adb", "launch"]]


def test_materialize_reply_card_resilient_retries_after_timeout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    stages: list[str] = []
    attempts = {"count": 0}
    card = {"card_id": "card-1", "turn_id": "turn-1", "title": "Proof HTML Dashboard"}

    monkeypatch.setattr(
        suite,
        "stabilize_displayable_proof_surface",
        lambda *_args, **kwargs: stages.append(str(kwargs["stage"])) or {"ok": True},
    )

    def fake_materialize(*_args, **_kwargs):
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise suite.subprocess.TimeoutExpired(["ui.reply_cards.set"], 180)
        return {"cards": [card]}, card

    monkeypatch.setattr(suite, "materialize_reply_card", fake_materialize)

    recovery, snapshot, local_card = suite.materialize_reply_card_resilient(
        args,
        runner,
        config,
        card,
        stage="displayable_html_materialize",
        timeout=180,
    )

    assert attempts["count"] == 2
    assert recovery["retried_after_timeout"] is True
    assert stages == ["displayable_html_materialize", "displayable_html_materialize_retry"]
    assert snapshot["cards"][0]["card_id"] == "card-1"
    assert local_card["title"] == "Proof HTML Dashboard"


def test_configure_turn_lab_runtime_retries_relaunch_when_broker_stays_offline(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    retries: list[str] = []
    settings_payloads: list[dict[str, object]] = []

    runner.run = lambda *_args, **_kwargs: suite.subprocess.CompletedProcess([], 0, stdout="", stderr="")  # type: ignore[method-assign]
    monkeypatch.setattr(suite, "grant_runtime_permissions", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "dismiss_permission_controller", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "sync_default_recipe_bundle", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    def fake_command_json(_runner, command, **_kwargs):
        name = command[command.index("command") + 1]
        if name == "pucky.turn.settings.set":
            settings_payloads.append(json.loads(command[command.index("--args-json") + 1]))
        return {"result": {"ok": True}}

    monkeypatch.setattr(suite, "command_json", fake_command_json)

    def fake_ensure(_args, _runner, _config, *, stage: str, timeout_seconds: int) -> dict[str, object]:
        assert timeout_seconds == 90
        if stage == "turn_lab_relaunch":
            raise suite.SuiteError("device offline")
        return {"stage": stage, "ok": True}

    monkeypatch.setattr(suite, "ensure_broker_command_channel", fake_ensure)
    monkeypatch.setattr(
        suite,
        "launch_home_resilient",
        lambda *_args, **kwargs: retries.append(str(kwargs["stage"])) or {"ok": True},
    )

    runtime = suite.configure_turn_lab_runtime(
        args,
        runner,
        config,
        fake_turn=type("FakeTurn", (), {"base_url": "http://127.0.0.1:55123"})(),
        reply_mode="card_only",
        relaunch=True,
    )

    assert retries == ["turn_lab_relaunch_retry"]
    assert runtime["turn_url"] == "http://127.0.0.1:55123"
    assert settings_payloads == [
        {
            "reply_mode": "card_only",
            "arrival_cue_mode": "chime",
            "pucky_turn_url": "http://127.0.0.1:55123",
            "pucky_api_token": "dev-token",
        }
    ]


def test_configure_turn_lab_runtime_keeps_fake_turn_provisioning_for_future_relaunches(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(
        tmp_path,
        dry_run=False,
        turn_url="https://pucky.fly.dev/api/turn",
        turn_token="prod-token",
    )
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)

    runner.run = lambda *_args, **_kwargs: suite.subprocess.CompletedProcess([], 0, stdout="", stderr="")  # type: ignore[method-assign]
    monkeypatch.setattr(suite, "grant_runtime_permissions", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "dismiss_permission_controller", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(suite, "sync_default_recipe_bundle", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(suite, "ensure_broker_command_channel", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(suite, "effective_activity_name", lambda *_args, **_kwargs: "com.pucky.device.MainActivity")
    monkeypatch.setattr(suite, "command_json", lambda *_args, **_kwargs: {"result": {"ok": True}})

    suite.configure_turn_lab_runtime(
        args,
        runner,
        config,
        fake_turn=type("FakeTurn", (), {"base_url": "http://127.0.0.1:55123"})(),
        reply_mode="card_only",
        relaunch=False,
    )

    command = suite.launch_home_command(args, config)
    encoded = command[command.index("provisioning_json_base64") + 1]
    payload = json.loads(suite.base64.b64decode(encoded).decode("utf-8"))

    assert payload["pucky_turn_url"] == "http://127.0.0.1:55123"
    assert payload["pucky_api_token"] == "dev-token"


def test_dump_ui_hierarchy_retries_after_timeout(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    commands: list[list[str]] = []
    dump_attempts = {"count": 0}

    def fake_run(command, **kwargs):
        commands.append(command)
        joined = " ".join(command)
        if "uiautomator dump" in joined:
            dump_attempts["count"] += 1
            if dump_attempts["count"] == 1:
                raise suite.subprocess.TimeoutExpired(command, kwargs.get("timeout", 30))
            return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")
        if "exec-out cat" in joined:
            return suite.subprocess.CompletedProcess(command, 0, stdout="<hierarchy rotation='0' />", stderr="")
        return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    runner.run = fake_run  # type: ignore[method-assign]
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    xml = suite.dump_ui_hierarchy(args, runner, config)

    assert "<hierarchy" in xml
    assert any("input keyevent 4" in " ".join(command) for command in commands)


def test_dump_ui_hierarchy_ignores_timeout_during_backout_recovery(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    commands: list[list[str]] = []
    dump_attempts = {"count": 0}

    def fake_run(command, **kwargs):
        commands.append(command)
        joined = " ".join(command)
        if "uiautomator dump" in joined:
            dump_attempts["count"] += 1
            if dump_attempts["count"] == 1:
                raise suite.subprocess.TimeoutExpired(command, kwargs.get("timeout", 30))
            return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")
        if "input keyevent 4" in joined:
            raise suite.subprocess.TimeoutExpired(command, kwargs.get("timeout", 30))
        if "exec-out cat" in joined:
            return suite.subprocess.CompletedProcess(command, 0, stdout="<hierarchy rotation='0' />", stderr="")
        return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    runner.run = fake_run  # type: ignore[method-assign]
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    xml = suite.dump_ui_hierarchy(args, runner, config)

    assert "<hierarchy" in xml
    assert dump_attempts["count"] == 2
    assert any("input keyevent 4" in " ".join(command) for command in commands)


def test_wait_for_feed_card_title_scrolls_until_visible(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    now = {"value": 0.0}
    xmls = iter(
        [
            "<hierarchy rotation='0'></hierarchy>",
            "<hierarchy rotation='0'><node text='Proof Runtime Icon' bounds='[1,2][3,4]' /></hierarchy>",
        ]
    )
    commands: list[list[str]] = []

    monkeypatch.setattr(suite.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: now.__setitem__("value", now["value"] + seconds))
    monkeypatch.setattr(suite, "dump_ui_hierarchy", lambda *_args, **_kwargs: next(xmls))

    def fake_run(command, **kwargs):
        commands.append(command)
        return suite.subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    runner.run = fake_run  # type: ignore[method-assign]

    node, xml = suite.wait_for_feed_card_title(args, runner, config, title="Proof Runtime Icon", timeout=5.0)

    assert node["text"] == "Proof Runtime Icon"
    assert "Proof Runtime Icon" in xml
    assert any("input swipe" in " ".join(command) for command in commands)


def test_wait_for_feed_card_title_matches_title_prefix_inside_summary(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    now = {"value": 0.0}

    monkeypatch.setattr(suite.time, "monotonic", lambda: now["value"])
    monkeypatch.setattr(suite.time, "sleep", lambda seconds: now.__setitem__("value", now["value"] + seconds))
    monkeypatch.setattr(
        suite,
        "dump_ui_hierarchy",
        lambda *_args, **_kwargs: "<hierarchy rotation='0'><node text='Proof HTML Dashboard Saved: hello world' bounds='[1,2][3,4]' /></hierarchy>",
    )

    node, xml = suite.wait_for_feed_card_title(args, runner, config, title="Proof HTML Dashboard", timeout=2.0)

    assert node["text"].startswith("Proof HTML Dashboard")
    assert "hello world" in xml


def test_ensure_feed_card_visible_rematerializes_single_card_on_retry(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    calls = {"waits": 0, "launches": 0}
    written: list[list[str]] = []
    target_card = {
        "card_id": "card-runtime-icon",
        "turn_id": "turn-runtime-icon",
        "session_id": "turn-runtime-icon",
        "title": "Proof Runtime Icon",
    }

    def fake_wait(*_args, **_kwargs):
        calls["waits"] += 1
        if calls["waits"] == 1:
            raise suite.SuiteError("not yet visible")
        return {"text": "Proof Runtime Icon", "bounds": "[1,2][3,4]"}, "<hierarchy />"

    def fake_command_json(_runner, command, **_kwargs):
        written.append(command)
        return {"result": {"cards": [target_card]}}

    monkeypatch.setattr(suite, "wait_for_feed_card_title", fake_wait)
    monkeypatch.setattr(suite, "reset_home_surface_if_needed", lambda *_args, **_kwargs: {"needs_reset": False})
    monkeypatch.setattr(suite, "command_json", fake_command_json)
    monkeypatch.setattr(
        suite,
        "launch_home_resilient",
        lambda *_args, **_kwargs: calls.__setitem__("launches", calls["launches"] + 1) or {"ok": True},
    )

    node, _xml, recovery = suite.ensure_feed_card_visible(
        args,
        runner,
        config,
        title="Proof Runtime Icon",
        local_card=target_card,
        timeout=5.0,
    )

    assert node["text"] == "Proof Runtime Icon"
    assert calls["waits"] == 2
    assert calls["launches"] == 1
    assert written and "ui.reply_cards.set" in " ".join(written[0])
    assert recovery["rematerialized"] is True


def test_ensure_feed_card_visible_expands_timeout_after_rematerialization(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    waits: list[float] = []

    def fake_wait(*_args, title, timeout, **_kwargs):
        waits.append(timeout)
        if len(waits) == 1:
            raise suite.SuiteError(f"Did not find feed card titled {title} after {int(timeout)}s")
        return {"text": title, "bounds": "[1,2][3,4]"}, "<hierarchy rotation='0' />"

    monkeypatch.setattr(suite, "wait_for_feed_card_title", fake_wait)
    monkeypatch.setattr(suite, "reset_home_surface_if_needed", lambda *_args, **_kwargs: {"needs_reset": False})
    monkeypatch.setattr(suite, "command_json", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(suite, "command_result", lambda payload: payload)
    monkeypatch.setattr(suite, "reply_cards_write_command", lambda *_args, **_kwargs: ["ui.reply_cards.set"])
    monkeypatch.setattr(suite, "launch_home_resilient", lambda *_args, **_kwargs: None)

    suite.ensure_feed_card_visible(
        args,
        runner,
        config,
        title="Proof JPG Image",
        local_card={"title": "Proof JPG Image", "card_id": "card-1"},
        timeout=30.0,
    )

    assert waits == [30.0, 60.0]


def test_open_card_detail_with_retry_retries_after_missed_tap(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    card = {
        "title": "Retry card",
        "transcript_messages": [
            {
                "role": "assistant",
                "attachments": [
                    {
                        "title": "Retry file",
                        "viewer": {"type": "text", "viewer_src": "data:text/plain,ok"},
                    }
                ],
            }
        ],
    }
    tile_xml = "<hierarchy rotation='0'><node content-desc='Open file for Retry card' bounds='[1,2][3,4]' /></hierarchy>"
    taps: list[str] = []
    opened_attempts = {"count": 0}

    def fake_wait_for_ui_node(_args, _runner, _config, *, description, **_kwargs):
        if "expected tile file action" in description:
            return {"content-desc": "Open file for Retry card", "bounds": "[1,2][3,4]"}, "<hierarchy rotation='0' />"
        if "did not open a detail view" in description:
            opened_attempts["count"] += 1
            if opened_attempts["count"] == 1:
                raise suite.SuiteError("missed tap")
            return {"text": "Retry file", "bounds": "[1,2][3,4]"}, "<hierarchy rotation='0'><node text='Retry file' bounds='[1,2][3,4]' /></hierarchy>"
        raise AssertionError(description)

    monkeypatch.setattr(suite, "wait_for_ui_node", fake_wait_for_ui_node)
    monkeypatch.setattr(suite, "tap_ui_node", lambda *_args: taps.append("tap"))
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    opened_xml, refreshed_tile_xml = suite.open_card_detail_with_retry(
        args,
        runner,
        config,
        case_key="retry_case",
        title="Retry card",
        card=card,
        tile_xml=tile_xml,
        timeout=5.0,
    )

    assert opened_attempts["count"] == 2
    assert len(taps) == 2
    assert "Retry file" in opened_xml
    assert "<hierarchy" in refreshed_tile_xml


def test_open_card_detail_with_retry_waits_for_text_only_action_label(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    card = {
        "title": "Retry card",
        "transcript_messages": [
            {
                "role": "assistant",
                "attachments": [
                    {
                        "title": "Retry file",
                        "viewer": {"type": "text", "viewer_src": "data:text/plain,ok"},
                    }
                ],
            }
        ],
    }
    taps: list[str] = []

    def fake_wait_for_ui_node(_args, _runner, _config, *, description, content_desc_pattern=None, text_pattern=None, **_kwargs):
        if "expected tile file action" in description:
            assert content_desc_pattern == r"^(?:Open\ file\ for\ Retry\ card|Open\ page\ for\ Retry\ card)$"
            assert text_pattern == r"^(?:Open\ file\ for\ Retry\ card|Open\ page\ for\ Retry\ card)$"
            return {"text": "Open file for Retry card", "bounds": "[1,2][3,4]"}, "<hierarchy rotation='0'><node text='Open file for Retry card' bounds='[1,2][3,4]' /></hierarchy>"
        if "did not open a detail view" in description:
            return {"text": "Retry file", "bounds": "[1,2][3,4]"}, "<hierarchy rotation='0'><node text='Retry file' bounds='[1,2][3,4]' /></hierarchy>"
        raise AssertionError(description)

    monkeypatch.setattr(suite, "wait_for_ui_node", fake_wait_for_ui_node)
    monkeypatch.setattr(suite, "tap_ui_node", lambda *_args: taps.append("tap"))
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    opened_xml, refreshed_tile_xml = suite.open_card_detail_with_retry(
        args,
        runner,
        config,
        case_key="retry_case",
        title="Retry card",
        card=card,
        tile_xml="<hierarchy rotation='0' />",
        timeout=5.0,
    )

    assert taps == ["tap"]
    assert "Retry file" in opened_xml
    assert "Open file for Retry card" in refreshed_tile_xml


def test_open_card_detail_with_retry_accepts_page_action_for_file_like_replay_card(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    card = {
        "title": "Replay dashboard",
        "transcript_messages": [
            {
                "role": "assistant",
                "attachments": [
                    {
                        "title": "Replay notes",
                        "viewer": {"type": "text", "viewer_src": "data:text/plain,ok"},
                    }
                ],
            }
        ],
    }
    tile_xml = "<hierarchy rotation='0'><node text='Open page for Replay dashboard' bounds='[1,2][3,4]' /></hierarchy>"
    taps: list[str] = []

    def fake_wait_for_ui_node(_args, _runner, _config, *, description, **_kwargs):
        if "expected tile file action" in description:
            raise AssertionError("alternate action label should be found in the provided tile XML")
        if "did not open a detail view" in description:
            return {"text": "Replay notes", "bounds": "[1,2][3,4]"}, "<hierarchy rotation='0'><node text='Replay notes' bounds='[1,2][3,4]' /></hierarchy>"
        raise AssertionError(description)

    monkeypatch.setattr(suite, "wait_for_ui_node", fake_wait_for_ui_node)
    monkeypatch.setattr(suite, "tap_ui_node", lambda *_args: taps.append("tap"))
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)

    opened_xml, refreshed_tile_xml = suite.open_card_detail_with_retry(
        args,
        runner,
        config,
        case_key="replay_html",
        title="Replay dashboard",
        card=card,
        tile_xml=tile_xml,
        timeout=5.0,
    )

    assert taps == ["tap"]
    assert "Replay notes" in opened_xml
    assert "Open page for Replay dashboard" in refreshed_tile_xml


def test_open_card_detail_with_retry_accepts_matching_surface_detail(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    runner = suite.Runner(dry_run=False)
    card = {
        "card_id": "card-1",
        "session_id": "session-1",
        "title": "Surface card",
        "transcript_messages": [
            {
                "role": "assistant",
                "attachments": [
                    {
                        "title": "Surface file",
                        "viewer": {"type": "html_iframe", "viewer_src": "data:text/html,ok"},
                    }
                ],
            }
        ],
    }
    tile_xml = "<hierarchy rotation='0'><node text='Open file for Surface card' bounds='[1,2][3,4]' /></hierarchy>"
    taps: list[str] = []

    def fake_wait_for_ui_node(_args, _runner, _config, *, description, **_kwargs):
        if "did not open a detail view" in description:
            raise suite.SuiteError("uiautomator title not exposed yet")
        raise AssertionError(description)

    monkeypatch.setattr(suite, "wait_for_ui_node", fake_wait_for_ui_node)
    monkeypatch.setattr(suite, "tap_ui_node", lambda *_args: taps.append("tap"))
    monkeypatch.setattr(suite.time, "sleep", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        suite,
        "ui_surface",
        lambda *_args, **_kwargs: {"detail": {"open": True, "card_id": "card-1", "session_id": "session-1"}},
    )
    monkeypatch.setattr(suite, "dump_ui_hierarchy", lambda *_args, **_kwargs: "<hierarchy rotation='0'><node text='detail open' /></hierarchy>")

    opened_xml, refreshed_tile_xml = suite.open_card_detail_with_retry(
        args,
        runner,
        config,
        case_key="surface_case",
        title="Surface card",
        card=card,
        tile_xml=tile_xml,
        timeout=5.0,
    )

    assert taps == ["tap"]
    assert "detail open" in opened_xml
    assert "Open file for Surface card" in refreshed_tile_xml


def test_clean_dry_run_does_not_delete_slot_artifacts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    marker = Path(config.run_dir) / "keep.txt"
    marker.parent.mkdir(parents=True)
    marker.write_text("keep", encoding="utf-8")
    args = ns(tmp_path, slot=1)
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: config)
    monkeypatch.setattr(suite, "serial_is_connected", lambda *_args, **_kwargs: False)

    result = suite.cmd_clean(args)

    assert result["dry_run"] is True
    assert marker.exists()



def test_map_smoke_command_is_removed() -> None:
    parser = suite.build_parser()

    with pytest.raises(SystemExit):
        parser.parse_args(["map-smoke", "--slot", "1", "--dry-run"])

    assert not hasattr(suite, "cmd_map_smoke")
