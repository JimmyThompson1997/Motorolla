from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Callable, Iterable


def sdk_env(
    args: argparse.Namespace,
    config: Any,
    *,
    error_cls: type[Exception],
    environment: dict[str, str] | None = None,
) -> dict[str, str]:
    env = dict(environment or os.environ)
    env["ANDROID_HOME"] = str(args.android_home)
    env["ANDROID_SDK_ROOT"] = str(args.android_home)
    env["ANDROID_AVD_HOME"] = str(config.avd_home)
    env["JAVA_HOME"] = str(args.java_home)
    if getattr(args, "audio_mode", "none") == "wav-in":
        raw_wav_in = getattr(args, "audio_wav_in", None)
        if raw_wav_in is None or str(raw_wav_in).strip() == "":
            raise error_cls("--audio-wav-in is required with --audio-mode wav-in")
        wav_in = Path(raw_wav_in)
        if not args.dry_run and not wav_in.exists():
            raise error_cls(f"Audio WAV input not found: {wav_in}")
        env["QEMU_WAV_IN_PATH"] = str(wav_in)
        env["QEMU_WAV_PATH"] = str(Path(config.evidence_dir) / "qemu-audio-out.wav")
        env["QEMU_AUDIO_ADC_FIXED_FREQ"] = "44100"
        env["QEMU_AUDIO_ADC_FIXED_FMT"] = "S16"
        env["QEMU_AUDIO_ADC_FIXED_CHANNELS"] = "1"
    return env


def avdmanager_create_command(
    args: argparse.Namespace,
    config: Any,
    *,
    sdcard_size: str,
) -> list[str]:
    return [
        str(args.avdmanager),
        "create",
        "avd",
        "--force",
        "--name",
        str(config.avd_name),
        "--package",
        str(args.system_image),
        "--device",
        str(args.device_profile),
        "--sdcard",
        sdcard_size,
    ]


def emulator_start_command(
    args: argparse.Namespace,
    config: Any,
    *,
    userdata_partition_mb: str,
    error_cls: type[Exception],
) -> list[str]:
    command = [
        str(args.emulator),
        "-avd",
        str(config.avd_name),
        "-port",
        str(config.emulator_port),
        "-no-window",
        "-partition-size",
        userdata_partition_mb,
    ]
    mode = getattr(args, "audio_mode", "none")
    if mode == "none":
        command.append("-no-audio")
    elif mode == "host":
        command.extend(["-audio", "dsound", "-allow-host-audio"])
    elif mode == "wav-in":
        command.extend(["-audio", "wav"])
    else:
        raise error_cls(f"Unsupported audio mode: {mode}")
    command.extend(
        [
            "-no-snapshot-load",
            "-no-snapshot-save",
            "-no-boot-anim",
            "-gpu",
            "swiftshader_indirect",
        ]
    )
    return command


def tune_avd_config(
    config: Any,
    *,
    userdata_size: str,
    wait_seconds: float,
    monotonic: Callable[[], float],
    sleep: Callable[[float], None],
) -> None:
    config_path = Path(config.avd_home) / f"{config.avd_name}.avd" / "config.ini"
    deadline = monotonic() + max(0.0, wait_seconds)
    while not config_path.exists() and monotonic() < deadline:
        sleep(0.25)
    if not config_path.exists():
        return
    lines = config_path.read_text(encoding="utf-8").splitlines()
    updated = False
    for index, line in enumerate(lines):
        if re.match(r"^\s*disk\.dataPartition\.size\s*=", line):
            lines[index] = f"disk.dataPartition.size = {userdata_size}"
            updated = True
            continue
    if not updated:
        lines.append(f"disk.dataPartition.size = {userdata_size}")
    config_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def adb_command(
    args: argparse.Namespace,
    serial: str,
    command: Iterable[str],
    *,
    require_serial: Callable[[str], None],
) -> list[str]:
    require_serial(serial)
    return [str(args.adb), "-s", serial, *command]


def launch_provisioning_json(args: argparse.Namespace, config: Any) -> str | None:
    turn_url = str(getattr(args, "turn_url", "") or "").strip()
    turn_token = str(getattr(args, "turn_token", "") or "").strip()
    if not turn_url and not turn_token:
        return None
    payload: dict[str, Any] = {
        "schema": "pucky.provisioning.v1",
        "device_id": config.device_id,
        "broker_url": f"ws://127.0.0.1:{config.broker_port}/v1/devices/{config.device_id}/connect",
        "token": "dev-token",
        "ui_shell_mode": "web_cached",
    }
    if turn_url:
        payload["pucky_turn_url"] = turn_url
    if turn_token:
        payload["pucky_api_token"] = turn_token
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def effective_activity_name(
    args: argparse.Namespace,
    config: Any,
    *,
    default_activity: str,
    adb_command_fn: Callable[[argparse.Namespace, str, Iterable[str]], list[str]],
    subprocess_module: Any = subprocess,
) -> str:
    requested = str(getattr(args, "activity_name", "") or "").strip()
    if getattr(args, "dry_run", False):
        return requested or default_activity
    if requested and requested != default_activity:
        return requested
    try:
        result = subprocess_module.run(
            adb_command_fn(
                args,
                config.serial,
                ["shell", "cmd", "package", "resolve-activity", "--brief", args.package_name],
            ),
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return requested or default_activity
    for raw_line in reversed((result.stdout or "").splitlines()):
        line = raw_line.strip()
        if not line or "/" not in line or args.package_name not in line:
            continue
        _, activity = line.split("/", 1)
        activity = activity.strip()
        if not activity:
            continue
        if activity.startswith("."):
            return f"{args.package_name}{activity}"
        return activity
    return requested or default_activity


def launch_command(
    args: argparse.Namespace,
    config: Any,
    *,
    activity_name: str,
    provisioning_json: str | None,
    adb_command_fn: Callable[[argparse.Namespace, str, Iterable[str]], list[str]],
) -> list[str]:
    command = [
        "shell",
        "am",
        "start",
        "-n",
        f"{args.package_name}/{activity_name}",
        "--es",
        "broker_url",
        f"ws://127.0.0.1:{config.broker_port}/v1/devices/{config.device_id}/connect",
        "--es",
        "device_id",
        config.device_id,
        "--es",
        "token",
        "dev-token",
    ]
    if provisioning_json:
        command.extend(["--es", "provisioning_json_base64", provisioning_json])
    command.extend(["--ez", "connect", "true"])
    return adb_command_fn(args, config.serial, command)


def launch_home_command(
    args: argparse.Namespace,
    config: Any,
    *,
    activity_name: str,
    provisioning_json: str | None,
    adb_command_fn: Callable[[argparse.Namespace, str, Iterable[str]], list[str]],
) -> list[str]:
    command = [
        "shell",
        "am",
        "start",
        "-n",
        f"{args.package_name}/{activity_name}",
        "--ez",
        "show_home",
        "true",
    ]
    if provisioning_json:
        command.extend(["--es", "provisioning_json_base64", provisioning_json])
    return adb_command_fn(args, config.serial, command)


def boot_signal(
    args: argparse.Namespace,
    runner: Any,
    config: Any,
    prop: str,
    *,
    adb_command_fn: Callable[[argparse.Namespace, str, Iterable[str]], list[str]],
) -> str:
    result = runner.run(adb_command_fn(args, config.serial, ["shell", "getprop", prop]), timeout=15, check=False)
    return result.stdout.strip()


def emulator_boot_ready(
    args: argparse.Namespace,
    runner: Any,
    config: Any,
    *,
    boot_signal_fn: Callable[[argparse.Namespace, Any, Any, str], str],
) -> bool:
    if boot_signal_fn(args, runner, config, "sys.boot_completed") == "1":
        return True
    if boot_signal_fn(args, runner, config, "dev.bootcomplete") == "1":
        return True
    if boot_signal_fn(args, runner, config, "service.bootanim.exit") == "1":
        return True
    return boot_signal_fn(args, runner, config, "init.svc.bootanim") == "stopped"


def package_manager_ready(
    args: argparse.Namespace,
    runner: Any,
    config: Any,
    *,
    adb_command_fn: Callable[[argparse.Namespace, str, Iterable[str]], list[str]],
    subprocess_module: Any = subprocess,
) -> bool:
    try:
        service = runner.run(adb_command_fn(args, config.serial, ["shell", "service", "check", "package"]), timeout=15, check=False)
    except subprocess_module.TimeoutExpired:
        return False
    service_text = (service.stdout + "\n" + service.stderr).lower()
    if service.returncode != 0 or "can't find service" in service_text or "not found" in service_text:
        return False

    try:
        query = runner.run(
            adb_command_fn(args, config.serial, ["shell", "cmd", "package", "list", "packages", "android"]),
            timeout=45,
            check=False,
        )
    except subprocess_module.TimeoutExpired:
        return False
    query_text = (query.stdout + "\n" + query.stderr).lower()
    if query.returncode == 0 and "package:android" in query_text:
        return True
    if "can't find service" in query_text or "not found" in query_text:
        return False

    try:
        fallback = runner.run(adb_command_fn(args, config.serial, ["shell", "pm", "path", "android"]), timeout=45, check=False)
    except subprocess_module.TimeoutExpired:
        return False
    fallback_text = (fallback.stdout + "\n" + fallback.stderr).lower()
    return fallback.returncode == 0 and "package:" in fallback_text and "can't find service" not in fallback_text


def install_services_ready(
    args: argparse.Namespace,
    runner: Any,
    config: Any,
    *,
    package_manager_ready_fn: Callable[[argparse.Namespace, Any, Any], bool],
    adb_command_fn: Callable[[argparse.Namespace, str, Iterable[str]], list[str]],
    subprocess_module: Any = subprocess,
) -> bool:
    if not package_manager_ready_fn(args, runner, config):
        return False
    try:
        mount = runner.run(adb_command_fn(args, config.serial, ["shell", "service", "check", "mount"]), timeout=30, check=False)
    except subprocess_module.TimeoutExpired:
        return False
    mount_text = (mount.stdout + "\n" + mount.stderr).lower()
    if mount.returncode != 0 or "can't find service" in mount_text or "not found" in mount_text:
        return False
    try:
        volumes = runner.run(adb_command_fn(args, config.serial, ["shell", "sm", "list-volumes", "all"]), timeout=45, check=False)
    except subprocess_module.TimeoutExpired:
        return False
    volumes_text = (volumes.stdout + "\n" + volumes.stderr).lower()
    if volumes.returncode != 0:
        return False
    if "exception" in volumes_text or "null object reference" in volumes_text:
        return False
    return "mounted" in volumes_text


def is_streamed_install_storage_service_failure(exc: Exception) -> bool:
    text = str(exc or "").lower()
    if "performing streamed install" in text and "failed to install" in text and "stderr:" in text:
        return True
    return (
        "performing streamed install" in text
        and "nullpointerexception" in text
        and (
            "packagemanagerinternal.freestorage" in text
            or "storagemanagerservice.allocatebytes" in text
        )
    )


def install_apk_resilient(
    args: argparse.Namespace,
    runner: Any,
    config: Any,
    *,
    adb_command_fn: Callable[[argparse.Namespace, str, Iterable[str]], list[str]],
    is_streamed_install_storage_service_failure_fn: Callable[[Exception], bool],
) -> None:
    install_command = adb_command_fn(args, config.serial, ["install", "-r", str(args.apk)])
    try:
        runner.run(install_command, timeout=420)
        return
    except subprocess.TimeoutExpired:
        if args.dry_run:
            raise
    except Exception as exc:
        if args.dry_run or not is_streamed_install_storage_service_failure_fn(exc):
            raise
    runner.run(adb_command_fn(args, config.serial, ["install", "--no-streaming", "-r", str(args.apk)]), timeout=600)


def serial_is_connected(
    args: argparse.Namespace,
    runner: Any,
    serial: str,
    *,
    require_serial: Callable[[str], None],
    parse_adb_devices_fn: Callable[[str], list[Any]],
) -> bool:
    require_serial(serial)
    if runner.dry_run:
        return True
    result = runner.run([str(args.adb), "devices", "-l"], check=False)
    return any(device.serial == serial and device.state == "device" for device in parse_adb_devices_fn(result.stdout))


def adb_transport_state(
    args: argparse.Namespace,
    runner: Any,
    serial: str,
    *,
    require_serial: Callable[[str], None],
    parse_adb_devices_fn: Callable[[str], list[Any]],
) -> str:
    require_serial(serial)
    if runner.dry_run:
        return "device"
    result = runner.run([str(args.adb), "devices", "-l"], check=False, timeout=15)
    for device in parse_adb_devices_fn(result.stdout):
        if device.serial == serial:
            return device.state
    return "missing"


def parse_display_ids(output: str) -> list[str]:
    ids: list[str] = []
    for line in output.splitlines():
        line = line.strip()
        if line.startswith("Display "):
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                ids.append(parts[1])
    return ids


def primary_display_id(
    args: argparse.Namespace,
    runner: Any,
    config: Any,
    *,
    adb_command_fn: Callable[[argparse.Namespace, str, Iterable[str]], list[str]],
) -> str | None:
    result = runner.run(adb_command_fn(args, config.serial, ["shell", "dumpsys", "SurfaceFlinger", "--display-id"]), check=False, timeout=30)
    ids = parse_display_ids(result.stdout)
    return ids[0] if ids else None
