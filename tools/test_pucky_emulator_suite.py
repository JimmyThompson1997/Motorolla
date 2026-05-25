from __future__ import annotations

import argparse
import json
from pathlib import Path

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
    assert start == [
        str(args.emulator),
        "-avd",
        "pucky_webview_api35_03",
        "-port",
        "5558",
        "-no-window",
        "-no-audio",
        "-no-snapshot-load",
        "-no-snapshot-save",
        "-no-boot-anim",
        "-partition-size",
        suite.DEFAULT_USERDATA_PARTITION_MB,
        "-gpu",
        "swiftshader_indirect",
    ]
    assert env["ANDROID_AVD_HOME"] == config.avd_home
    assert str(tmp_path / ".tmp") in config.avd_home


def test_tune_avd_config_reduces_userdata_partition_size(tmp_path: Path) -> None:
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    config_dir = Path(config.avd_home) / f"{config.avd_name}.avd"
    config_dir.mkdir(parents=True)
    config_path = config_dir / "config.ini"
    config_path.write_text("disk.dataPartition.size = 6442450944\nhw.ramSize=2G\n", encoding="utf-8")

    suite.tune_avd_config(config)

    content = config_path.read_text(encoding="utf-8")
    assert f"disk.dataPartition.size = {suite.DEFAULT_USERDATA_PARTITION_BYTES}" in content
    assert "6442450944" not in content


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
    assert f"http://127.0.0.1:{config.broker_port}" in command
    assert "--device-id" in command and config.device_id in command


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


def test_parse_display_ids_uses_first_surfaceflinger_display() -> None:
    output = """Display 4619827259835644672 (HWC display 0): port=0 pnpId=GGL displayName="EMU_display_0"
Display 4619827551948147201 (HWC display 1): port=1 pnpId=GGL displayName="EMU_display_1"
"""

    assert suite.parse_display_ids(output) == ["4619827259835644672", "4619827551948147201"]


def test_save_state_preserves_slot_and_run_id(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = suite.slot_config(tmp_path, 1, run_id="fixed")
    monkeypatch.setattr(suite, "now_iso", lambda: "2026-05-23T00:00:00Z")

    saved = suite.save_state(config, {"serial": config.serial})
    loaded = json.loads(Path(config.state_path).read_text(encoding="utf-8"))

    assert saved == loaded
    assert loaded["slot"] == 1
    assert loaded["run_id"] == "fixed"
    assert loaded["serial"] == "emulator-5554"


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


def test_provision_refuses_when_configured_serial_is_not_emulator(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    args = ns(tmp_path, slot=1, skip_build=True)
    bad = suite.slot_config(suite.ROOT, 1, run_id="dry-run-slot01")
    bad = suite.SlotConfig(**{**bad.__dict__, "serial": "ZY22JZ26LK"})
    monkeypatch.setattr(suite, "config_for_command", lambda *_args, **_kwargs: bad)

    with pytest.raises(suite.SuiteError, match="Refusing non-emulator"):
        suite.cmd_provision(args)


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
