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
    monkeypatch.setattr(suite, "tune_avd_config", lambda cfg: calls.append(cfg.avd_name))
    monkeypatch.setattr(suite.Runner, "start_detached", lambda self, *args, **kwargs: 123)

    result = suite.cmd_start(args)

    assert result["ok"] is True
    assert calls == [config.avd_name]


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


def test_emulator_boot_ready_accepts_bootanim_stopped(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = ns(tmp_path, dry_run=False)
    config = suite.slot_config(tmp_path, 1, run_id="fixed")

    monkeypatch.setattr(
        suite,
        "boot_signal",
        lambda _args, _runner, _config, prop: "stopped" if prop == "init.svc.bootanim" else "",
    )

    assert suite.emulator_boot_ready(args, suite.Runner(dry_run=False), config) is True


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
