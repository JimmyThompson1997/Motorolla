from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import math
import mimetypes
import os
import re
import shlex
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
import textwrap
import urllib.error
import urllib.parse
import urllib.request
import uuid
import wave
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

ANDROID_TOOLS = Path(r"C:\Users\jimmy\Desktop\Android\tools")
DEFAULT_ANDROID_HOME = ANDROID_TOOLS / "android-sdk"
DEFAULT_JAVA_HOME = ANDROID_TOOLS / "jdk-17"
DEFAULT_GRADLE = ANDROID_TOOLS / "gradle-8.10.2" / "bin" / "gradle.bat"
DEFAULT_ADB = DEFAULT_ANDROID_HOME / "platform-tools" / "adb.exe"
DEFAULT_EMULATOR = DEFAULT_ANDROID_HOME / "emulator" / "emulator.exe"
DEFAULT_AVDMANAGER = DEFAULT_ANDROID_HOME / "cmdline-tools" / "latest" / "bin" / "avdmanager.bat"
DEFAULT_SYSTEM_IMAGE = "system-images;android-35;google_apis;x86_64"
DEFAULT_DEVICE_PROFILE = "resizable"
DEFAULT_PACKAGE = "com.pucky.device.debug"
DEFAULT_ACTIVITY = "com.pucky.device.CoverHomeActivity"
DEFAULT_USERDATA_PARTITION_MB = "768"
DEFAULT_USERDATA_PARTITION_SIZE = str(int(DEFAULT_USERDATA_PARTITION_MB) * 1024 * 1024)
DEFAULT_APK = ROOT / "pucky-apk" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
DEFAULT_PUCKYCTL = ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py"
DEFAULT_FAKE_BROKER = ROOT / "pucky-apk" / "fake-broker"
DEFAULT_TURN_URL = "https://pucky.fly.dev/api/turn"
DEFAULT_RECIPE_BUNDLE = ROOT / "pucky_vm" / "recipes" / "volume_down_lab_dev_bundle.json"
WAKE_TURN_FIXTURE_START_DELAY_MS = 2200
BASE_DIR = ROOT / ".tmp" / "pucky-emulator"
RUNS_DIR = ROOT / ".tmp" / "pucky-emulator-runs"
MIN_RECOMMENDED_AVD_FREE_GB = 8.0
INSTALL_SERVICES_SETTLE_SECONDS = 45.0


class SuiteError(RuntimeError):
    pass


@dataclass(frozen=True)
class Device:
    serial: str
    state: str
    detail: str = ""


@dataclass(frozen=True)
class SlotConfig:
    slot: int
    avd_name: str
    serial: str
    emulator_port: int
    broker_port: int
    ui_port: int
    device_id: str
    avd_home: str
    run_id: str
    run_dir: str
    evidence_dir: str
    state_path: str
    bundle_version: str


@dataclass(frozen=True)
class FakeTurnEndpointConfig:
    response_text: str
    summary: str
    response_delay_seconds: float = 0.0
    remote_stage: str = "stt_running"
    with_audio: bool = False
    audio_duration_ms: int = 900


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run_id_now(slot: int) -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"-slot{slot:02d}"


def git_short(root: Path = ROOT) -> str:
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=root,
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--short"],
            cwd=root,
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()
        return commit + ("-dirty" if dirty else "")
    except Exception:
        return "unknown"


def parse_adb_devices(output: str) -> list[Device]:
    devices: list[Device] = []
    for line in output.splitlines():
        line = line.strip()
        if not line or line.startswith("List of devices"):
            continue
        parts = line.split(None, 2)
        if len(parts) >= 2:
            devices.append(Device(parts[0], parts[1], parts[2] if len(parts) > 2 else ""))
    return devices


def is_emulator_serial(serial: str) -> bool:
    return serial.startswith("emulator-")


def require_emulator_serial(serial: str) -> None:
    if not is_emulator_serial(serial):
        raise SuiteError(f"Refusing non-emulator serial: {serial}")


def slot_config(root: Path, slot: int, *, run_id: str | None = None) -> SlotConfig:
    if slot < 1 or slot > 50:
        raise SuiteError(f"Slot must be 1..50, got {slot}")
    run_id = run_id or run_id_now(slot)
    emulator_port = 5554 + ((slot - 1) * 2)
    broker_port = 18080 + slot
    ui_port = 18180 + slot
    avd_home = root / ".tmp" / "pucky-emulator" / "avd"
    run_dir = root / ".tmp" / "pucky-emulator-runs" / run_id
    evidence_dir = run_dir / "evidence"
    state_path = root / ".tmp" / "pucky-emulator" / "state" / f"slot{slot:02d}.json"
    return SlotConfig(
        slot=slot,
        avd_name=f"pucky_webview_api35_{slot:02d}",
        serial=f"emulator-{emulator_port}",
        emulator_port=emulator_port,
        broker_port=broker_port,
        ui_port=ui_port,
        device_id=f"pucky-emulator-slot-{slot:02d}",
        avd_home=str(avd_home),
        run_id=run_id,
        run_dir=str(run_dir),
        evidence_dir=str(evidence_dir),
        state_path=str(state_path),
        bundle_version=f"emu-slot{slot:02d}-{git_short(root)}",
    )


def assert_inside(path: Path, parent: Path) -> None:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError as exc:
        raise SuiteError(f"Refusing path outside {parent}: {path}") from exc


def config_for_command(root: Path, slot: int, *, dry_run: bool = False) -> SlotConfig:
    if dry_run:
        return slot_config(root, slot, run_id=f"dry-run-slot{slot:02d}")
    state_path = BASE_DIR / "state" / f"slot{slot:02d}.json"
    if state_path.exists():
        raw = json.loads(state_path.read_text(encoding="utf-8"))
        config = raw.get("config")
        if isinstance(config, dict):
            return SlotConfig(**config)
    return slot_config(root, slot)


class Runner:
    def __init__(self, *, dry_run: bool = False) -> None:
        self.dry_run = dry_run
        self.planned: list[dict[str, Any]] = []

    def run(
        self,
        command: list[str],
        *,
        cwd: Path | str | None = None,
        env: dict[str, str] | None = None,
        timeout: int = 60,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        self.planned.append({"command": command, "cwd": str(cwd) if cwd else None})
        if self.dry_run:
            return subprocess.CompletedProcess(command, 0, stdout='{"dry_run":true}', stderr="")
        result = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
        if check and result.returncode != 0:
            raise SuiteError(
                f"Command failed ({result.returncode}): {' '.join(command)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )
        return result

    def start_detached(
        self,
        command: list[str],
        *,
        cwd: Path | str | None,
        env: dict[str, str] | None,
        stdout_path: Path,
        stderr_path: Path,
    ) -> int:
        self.planned.append({"command": command, "cwd": str(cwd) if cwd else None, "detached": True})
        if self.dry_run:
            return -1
        stdout_path.parent.mkdir(parents=True, exist_ok=True)
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
        stdout = stdout_path.open("ab")
        stderr = stderr_path.open("ab")
        proc = subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdout=stdout,
            stderr=stderr,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        return int(proc.pid)


def sdk_env(args: argparse.Namespace, config: SlotConfig) -> dict[str, str]:
    env = os.environ.copy()
    env["ANDROID_HOME"] = str(args.android_home)
    env["ANDROID_SDK_ROOT"] = str(args.android_home)
    env["ANDROID_AVD_HOME"] = config.avd_home
    env["JAVA_HOME"] = str(args.java_home)
    if getattr(args, "audio_mode", "none") == "wav-in":
        raw_wav_in = getattr(args, "audio_wav_in", None)
        if raw_wav_in is None or str(raw_wav_in).strip() == "":
            raise SuiteError("--audio-wav-in is required with --audio-mode wav-in")
        wav_in = Path(raw_wav_in)
        if not args.dry_run and not wav_in.exists():
            raise SuiteError(f"Audio WAV input not found: {wav_in}")
        env["QEMU_WAV_IN_PATH"] = str(wav_in)
        env["QEMU_WAV_PATH"] = str(Path(config.evidence_dir) / "qemu-audio-out.wav")
        env["QEMU_AUDIO_ADC_FIXED_FREQ"] = "44100"
        env["QEMU_AUDIO_ADC_FIXED_FMT"] = "S16"
        env["QEMU_AUDIO_ADC_FIXED_CHANNELS"] = "1"
    return env


def avdmanager_create_command(args: argparse.Namespace, config: SlotConfig) -> list[str]:
    return [
        str(args.avdmanager),
        "create",
        "avd",
        "--force",
        "--name",
        config.avd_name,
        "--package",
        args.system_image,
        "--device",
        args.device_profile,
        "--sdcard",
        "512M",
    ]


def emulator_start_command(args: argparse.Namespace, config: SlotConfig) -> list[str]:
    command = [
        str(args.emulator),
        "-avd",
        config.avd_name,
        "-port",
        str(config.emulator_port),
        "-no-window",
        "-partition-size",
        DEFAULT_USERDATA_PARTITION_MB,
    ]
    mode = getattr(args, "audio_mode", "none")
    if mode == "none":
        command.append("-no-audio")
    elif mode == "host":
        command.extend(["-audio", "dsound", "-allow-host-audio"])
    elif mode == "wav-in":
        command.extend(["-audio", "wav"])
    else:
        raise SuiteError(f"Unsupported audio mode: {mode}")
    command.extend([
        "-no-snapshot-load",
        "-no-snapshot-save",
        "-no-boot-anim",
        "-gpu",
        "swiftshader_indirect",
    ])
    return command


def tune_avd_config(
    config: SlotConfig,
    *,
    userdata_size: str = DEFAULT_USERDATA_PARTITION_SIZE,
    wait_seconds: float = 10.0,
) -> None:
    config_path = Path(config.avd_home) / f"{config.avd_name}.avd" / "config.ini"
    deadline = time.monotonic() + max(0.0, wait_seconds)
    while not config_path.exists() and time.monotonic() < deadline:
        time.sleep(0.25)
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


def adb_command(args: argparse.Namespace, serial: str, command: Iterable[str]) -> list[str]:
    require_emulator_serial(serial)
    return [str(args.adb), "-s", serial, *command]


def launch_provisioning_json(
    args: argparse.Namespace,
    config: SlotConfig,
    *,
    turn_url_override: str | None = None,
    turn_token_override: str | None = None,
) -> str | None:
    turn_url = str(turn_url_override if turn_url_override is not None else getattr(args, "turn_url", "") or "").strip()
    turn_token = str(turn_token_override if turn_token_override is not None else getattr(args, "turn_token", "") or "").strip()
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


def launch_command(
    args: argparse.Namespace,
    config: SlotConfig,
    *,
    turn_url_override: str | None = None,
    turn_token_override: str | None = None,
) -> list[str]:
    command = [
        "shell",
        "am",
        "start",
        "-n",
        f"{args.package_name}/{args.activity_name}",
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
    provisioning_json = launch_provisioning_json(
        args,
        config,
        turn_url_override=turn_url_override,
        turn_token_override=turn_token_override,
    )
    if provisioning_json:
        command.extend(["--es", "provisioning_json_base64", provisioning_json])
    command.extend(["--ez", "connect", "true"])
    return adb_command(args, config.serial, command)


def launch_home_command(args: argparse.Namespace, config: SlotConfig) -> list[str]:
    return adb_command(
        args,
        config.serial,
        [
            "shell",
            "am",
            "start",
            "-n",
            f"{args.package_name}/{args.activity_name}",
            "--ez",
            "show_home",
            "true",
        ],
    )


def puckyctl_timeout_ms(args: argparse.Namespace, *, minimum_seconds: int | float = 0) -> int:
    configured = int(getattr(args, "puckyctl_timeout_ms", 120000) or 120000)
    minimum = max(0, int(float(minimum_seconds) * 1000))
    return max(configured, minimum)


def puckyctl_command(
    args: argparse.Namespace,
    config: SlotConfig,
    command_type: str,
    payload: dict[str, Any],
    *,
    timeout_ms: int | None = None,
) -> list[str]:
    return [
        sys.executable,
        str(args.puckyctl),
        "--json",
        "--broker",
        f"http://127.0.0.1:{config.broker_port}",
        "--device-id",
        config.device_id,
        "--timeout-ms",
        str(timeout_ms if timeout_ms is not None else puckyctl_timeout_ms(args)),
        "command",
        command_type,
        "--args-json",
        json.dumps(payload, separators=(",", ":")),
        "--wait",
    ]


def port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def free_space_gb(path: Path) -> float:
    usage = shutil.disk_usage(path)
    return round(usage.free / (1024 ** 3), 2)


def wait_http(url: str, *, timeout: float = 20.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_error = ""
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                body = response.read().decode("utf-8", errors="replace")
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                return {"ok": True, "body": body}
        except Exception as exc:
            last_error = str(exc)
            time.sleep(0.5)
    raise SuiteError(f"Timed out waiting for {url}: {last_error}")


def wait_for_broker_device(config: SlotConfig, *, timeout: float = 45.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_payload: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        payload = wait_http(f"http://127.0.0.1:{config.broker_port}/devices", timeout=3)
        last_payload = payload
        for device in payload.get("devices", []):
            if device.get("device_id") == config.device_id and device.get("online", False):
                return device
        time.sleep(1)
    raise SuiteError(f"Timed out waiting for broker device {config.device_id}: {last_payload}")


def broker_device_snapshot(config: SlotConfig, *, timeout: float = 4.0) -> dict[str, Any] | None:
    try:
        payload = wait_http(f"{local_broker_url(config)}/devices", timeout=timeout)
    except Exception:
        return None
    for device in payload.get("devices", []):
        if device.get("device_id") == config.device_id:
            return device
    return None


def boot_signal(args: argparse.Namespace, runner: Runner, config: SlotConfig, prop: str) -> str:
    result = runner.run(adb_command(args, config.serial, ["shell", "getprop", prop]), timeout=15, check=False)
    return result.stdout.strip()


def emulator_boot_ready(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> bool:
    if boot_signal(args, runner, config, "sys.boot_completed") == "1":
        return True
    if boot_signal(args, runner, config, "dev.bootcomplete") == "1":
        return True
    if boot_signal(args, runner, config, "service.bootanim.exit") == "1":
        return True
    return boot_signal(args, runner, config, "init.svc.bootanim") == "stopped"


def process_alive(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def wait_for_boot(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    pid: int | None = None,
    timeout: float = 180.0,
) -> None:
    if runner.dry_run:
        return
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pid and not process_alive(pid):
            raise SuiteError(f"Emulator exited before ADB became ready: {config.serial} (pid {pid})")
        state = adb_transport_state(args, runner, config.serial)
        if state == "device" and emulator_boot_ready(args, runner, config):
            return
        time.sleep(2)
    state = adb_transport_state(args, runner, config.serial)
    if pid and not process_alive(pid):
        raise SuiteError(f"Emulator exited before ADB became ready: {config.serial} (pid {pid})")
    raise SuiteError(f"Timed out waiting for emulator boot: {config.serial} (adb state: {state})")


def package_manager_ready(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> bool:
    try:
        service = runner.run(adb_command(args, config.serial, ["shell", "service", "check", "package"]), timeout=15, check=False)
    except subprocess.TimeoutExpired:
        return False
    service_text = (service.stdout + "\n" + service.stderr).lower()
    if service.returncode != 0 or "can't find service" in service_text or "not found" in service_text:
        return False

    try:
        query = runner.run(
            adb_command(args, config.serial, ["shell", "cmd", "package", "list", "packages", "android"]),
            timeout=20,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False
    query_text = (query.stdout + "\n" + query.stderr).lower()
    if query.returncode == 0 and "package:android" in query_text:
        return True
    if "can't find service" in query_text or "not found" in query_text:
        return False

    try:
        fallback = runner.run(adb_command(args, config.serial, ["shell", "pm", "path", "android"]), timeout=20, check=False)
    except subprocess.TimeoutExpired:
        return False
    fallback_text = (fallback.stdout + "\n" + fallback.stderr).lower()
    return fallback.returncode == 0 and "package:" in fallback_text and "can't find service" not in fallback_text


def install_services_ready(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> bool:
    if not package_manager_ready(args, runner, config):
        return False
    try:
        mount = runner.run(adb_command(args, config.serial, ["shell", "service", "check", "mount"]), timeout=15, check=False)
    except subprocess.TimeoutExpired:
        return False
    mount_text = (mount.stdout + "\n" + mount.stderr).lower()
    if mount.returncode != 0 or "can't find service" in mount_text or "not found" in mount_text:
        return False
    try:
        volumes = runner.run(adb_command(args, config.serial, ["shell", "sm", "list-volumes", "all"]), timeout=20, check=False)
    except subprocess.TimeoutExpired:
        return False
    volumes_text = (volumes.stdout + "\n" + volumes.stderr).lower()
    if volumes.returncode != 0:
        return False
    if "exception" in volumes_text or "null object reference" in volumes_text:
        return False
    return "mounted" in volumes_text


def wait_for_install_services(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    timeout: float = 180.0,
    settle_seconds: float = INSTALL_SERVICES_SETTLE_SECONDS,
) -> None:
    if runner.dry_run:
        return
    deadline = time.monotonic() + timeout
    ready_since: float | None = None
    while time.monotonic() < deadline:
        if install_services_ready(args, runner, config):
            if ready_since is None:
                ready_since = time.monotonic()
            if time.monotonic() - ready_since >= settle_seconds:
                return
        else:
            ready_since = None
        time.sleep(2)
    raise SuiteError(f"Timed out waiting for Android install services readiness: {config.serial}")


def serial_is_connected(args: argparse.Namespace, runner: Runner, serial: str) -> bool:
    require_emulator_serial(serial)
    if runner.dry_run:
        return True
    result = runner.run([str(args.adb), "devices", "-l"], check=False)
    return any(device.serial == serial and device.state == "device" for device in parse_adb_devices(result.stdout))


def adb_transport_state(args: argparse.Namespace, runner: Runner, serial: str) -> str:
    require_emulator_serial(serial)
    if runner.dry_run:
        return "device"
    result = runner.run([str(args.adb), "devices", "-l"], check=False, timeout=15)
    for device in parse_adb_devices(result.stdout):
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


def primary_display_id(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> str | None:
    result = runner.run(adb_command(args, config.serial, ["shell", "dumpsys", "SurfaceFlinger", "--display-id"]), check=False, timeout=30)
    ids = parse_display_ids(result.stdout)
    return ids[0] if ids else None


def load_state(root: Path, slot: int) -> dict[str, Any]:
    path = root / ".tmp" / "pucky-emulator" / "state" / f"slot{slot:02d}.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(config: SlotConfig, extra: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "schema": "pucky.emulator_slot_state.v1",
        "saved_at": now_iso(),
        "slot": config.slot,
        "run_id": config.run_id,
        **extra,
    }
    path = Path(config.state_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return payload


def write_evidence(config: SlotConfig, name: str, payload: dict[str, Any]) -> Path:
    path = Path(config.evidence_dir) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path


def read_wav_pcm16_mono(path: Path) -> tuple[int, bytes]:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        sample_width = handle.getsampwidth()
        sample_rate = handle.getframerate()
        if channels != 1 or sample_width != 2:
            raise SuiteError(f"Fixture WAV must be 16-bit mono: {path}")
        return sample_rate, handle.readframes(handle.getnframes())


def write_wav_pcm16_mono(path: Path, sample_rate: int, pcm_bytes: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(pcm_bytes)
    return path


def silence_pcm16(sample_rate: int, duration_ms: int) -> bytes:
    frames = max(0, round(sample_rate * max(0, duration_ms) / 1000.0))
    return b"\x00\x00" * frames


def normalize_pcm16_peak(pcm_bytes: bytes, *, target_peak: int = 16000) -> bytes:
    if not pcm_bytes:
        return pcm_bytes
    sample_count = len(pcm_bytes) // 2
    samples = list(struct.unpack("<" + "h" * sample_count, pcm_bytes))
    peak = max(abs(sample) for sample in samples)
    if peak <= 0 or peak >= target_peak:
        return pcm_bytes
    scale = min(target_peak / peak, 32767.0 / peak)
    normalized = bytearray()
    for sample in samples:
        amplified = int(round(sample * scale))
        if amplified > 32767:
            amplified = 32767
        elif amplified < -32768:
            amplified = -32768
        normalized.extend(struct.pack("<h", amplified))
    return bytes(normalized)


def build_buffered_turn_fixture(
    source_path: Path,
    target_path: Path,
    *,
    lead_silence_ms: int,
    trail_silence_ms: int,
) -> Path:
    sample_rate, pcm_bytes = read_wav_pcm16_mono(source_path)
    pcm_bytes = normalize_pcm16_peak(pcm_bytes)
    payload = b"".join(
        (
            silence_pcm16(sample_rate, lead_silence_ms),
            pcm_bytes,
            silence_pcm16(sample_rate, trail_silence_ms),
        )
    )
    return write_wav_pcm16_mono(target_path, sample_rate, payload)


def build_silence_turn_fixture(target_path: Path, *, duration_ms: int, sample_rate: int = 16000) -> Path:
    return write_wav_pcm16_mono(target_path, sample_rate, silence_pcm16(sample_rate, duration_ms))


def response_audio_base64(*, duration_ms: int = 900, sample_rate: int = 16000, frequency_hz: float = 660.0) -> str:
    frame_count = max(1, round(sample_rate * max(1, duration_ms) / 1000.0))
    pcm = bytearray()
    for index in range(frame_count):
        envelope = 0.25 if index < frame_count - (sample_rate // 20) else 0.0
        sample = int(envelope * 32767 * math.sin((2.0 * math.pi * frequency_hz * index) / sample_rate))
        pcm.extend(int(sample).to_bytes(2, byteorder="little", signed=True))
    output = io.BytesIO()
    with wave.open(output, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(bytes(pcm))
    return base64.b64encode(output.getvalue()).decode("ascii")


class FakeTurnEndpoint:
    def __init__(self, config: FakeTurnEndpointConfig):
        self.config = config
        self.server: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None
        self.port = 0
        self.lock = threading.Lock()
        self.requests: list[dict[str, Any]] = []
        self.server_root = ""
        self._audio_base64 = response_audio_base64(duration_ms=config.audio_duration_ms) if config.with_audio else ""

    @property
    def emulator_turn_url(self) -> str:
        if self.port <= 0:
            raise SuiteError("Fake turn endpoint has not been started")
        return f"http://10.0.2.2:{self.port}/api/turn"

    def start(self) -> None:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *args: Any) -> None:
                return

            def _json(self, payload: dict[str, Any], *, status: int = 200) -> None:
                raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def do_POST(self) -> None:
                parsed = urllib.parse.urlparse(self.path)
                if parsed.path != "/api/turn":
                    self._json({"error": "not_found"}, status=404)
                    return
                content_length = int(self.headers.get("Content-Length", "0") or "0")
                body = self.rfile.read(content_length)
                turn_id = self.headers.get("X-Pucky-Turn-Id", "") or f"turn-{uuid.uuid4().hex[:8]}"
                now = now_iso()
                record = {
                    "turn_id": turn_id,
                    "received_at": now,
                    "headers": dict(self.headers.items()),
                    "body_bytes": len(body),
                    "body_sha256": hashlib.sha256(body).hexdigest(),
                    "body_path": "",
                    "response_started_at": "",
                    "response_sent_at": "",
                }
                with owner.lock:
                    owner.requests.append(record)
                    request_index = len(owner.requests) - 1
                body_path = Path(owner.server_root) / f"{turn_id}.wav"
                body_path.write_bytes(body)
                with owner.lock:
                    owner.requests[request_index]["body_path"] = str(body_path)
                    owner.requests[request_index]["response_started_at"] = now_iso()
                if owner.config.response_delay_seconds > 0:
                    time.sleep(owner.config.response_delay_seconds)
                payload = {
                    "turn_id": turn_id,
                    "session_id": turn_id,
                    "card_id": f"card_{turn_id}",
                    "title": "Wake lab reply",
                    "summary": owner.config.summary,
                    "text": owner.config.response_text,
                    "icon": "bolt",
                    "telemetry": {"total_ms": round(owner.config.response_delay_seconds * 1000)},
                    "origin": {"runtime": "wake_lab_fake_server"},
                    "created_at": now_iso(),
                    "updated_at": now_iso(),
                }
                if owner._audio_base64:
                    payload["audio_mime_type"] = "audio/wav"
                    payload["audio_base64"] = owner._audio_base64
                self._json(payload)
                with owner.lock:
                    owner.requests[request_index]["response_sent_at"] = now_iso()

            def do_GET(self) -> None:
                parsed = urllib.parse.urlparse(self.path)
                if parsed.path != "/api/turn/status":
                    self._json({"error": "not_found"}, status=404)
                    return
                turn_id = urllib.parse.parse_qs(parsed.query).get("turn_id", [""])[0]
                with owner.lock:
                    matching = next((item for item in owner.requests if item.get("turn_id") == turn_id), None)
                if matching is None:
                    self._json({"turn_id": turn_id, "stage": "missing"}, status=404)
                    return
                stage = "completed" if matching.get("response_sent_at") else owner.config.remote_stage
                self._json(
                    {
                        "turn_id": turn_id,
                        "stage": stage,
                        "user_transcript": owner.config.summary,
                        "updated_at": now_iso(),
                    }
                )

        evidence_root = BASE_DIR / "fake-turn-endpoint"
        evidence_root.mkdir(parents=True, exist_ok=True)
        self.server_root = str(evidence_root / f"server-{uuid.uuid4().hex[:8]}")
        Path(self.server_root).mkdir(parents=True, exist_ok=True)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, name="pucky-fake-turn-endpoint", daemon=True)
        self.thread.start()

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            requests = json.loads(json.dumps(self.requests))
        return {
            "emulator_turn_url": self.emulator_turn_url if self.port > 0 else "",
            "port": self.port,
            "config": asdict(self.config),
            "requests": requests,
        }

    def stop(self) -> None:
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()
            self.server = None
        if self.thread is not None:
            self.thread.join(timeout=2.0)
            self.thread = None


def command_json(runner: Runner, command: list[str], *, timeout: int = 60) -> dict[str, Any]:
    attempts = 3
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            result = runner.run(command, timeout=timeout)
            break
        except SuiteError as exc:
            if attempt >= attempts or not is_transient_puckyctl_failure(exc):
                raise
            last_error = exc
            time.sleep(0.5 * attempt)
    else:
        raise last_error or SuiteError("Unknown puckyctl command failure")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"raw_stdout": result.stdout, "raw_stderr": result.stderr}


def is_transient_puckyctl_failure(exc: Exception) -> bool:
    text = str(exc or "")
    markers = (
        "WinError 10053",
        "WinError 10054",
        "ConnectionAbortedError",
        "ConnectionResetError",
        "RemoteDisconnected",
    )
    return any(marker in text for marker in markers)


def extract_json(text: str) -> dict[str, Any] | None:
    objects: list[dict[str, Any]] = []
    starts = [index for index, char in enumerate(text) if char == "{"]
    for start in starts:
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(text)):
            char = text[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    raw = text[start:index + 1]
                    try:
                        parsed = json.loads(raw)
                    except json.JSONDecodeError:
                        parsed = None
                    if isinstance(parsed, dict):
                        objects.append(parsed)
                    break
    for obj in objects:
        if obj.get("schema") == "puckyctl.result.v1":
            return obj
    return objects[-1] if objects else None


def local_broker_url(config: SlotConfig) -> str:
    return f"http://127.0.0.1:{config.broker_port}"


def parse_tap_point(value: str) -> tuple[int, int]:
    match = re.fullmatch(r"\s*(\d+)\s*,\s*(\d+)\s*", str(value or ""))
    if not match:
        raise SuiteError(f"Invalid tap point, expected X,Y: {value}")
    return int(match.group(1)), int(match.group(2))


def tap(args: argparse.Namespace, runner: Runner, config: SlotConfig, point: tuple[int, int]) -> None:
    x, y = point
    runner.run(adb_command(args, config.serial, ["shell", "input", "tap", str(x), str(y)]), timeout=30)


def long_press(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    point: tuple[int, int],
    *,
    duration_ms: int = 360,
) -> None:
    x, y = point
    runner.run(
        adb_command(
            args,
            config.serial,
            ["shell", "input", "swipe", str(x), str(y), str(x), str(y), str(duration_ms)],
        ),
        timeout=30,
    )


def turn_url_to_feed_url(turn_url: str) -> str:
    clean = str(turn_url or "").strip()
    if clean.endswith("/api/turn"):
        return clean[: -len("/api/turn")] + "/api/feed"
    if clean.endswith("/turn"):
        return clean[: -len("/turn")] + "/api/feed"
    return clean.rstrip("/") + "/api/feed"


def turn_request(turn_url: str, token: str, audio_path: Path, turn_id: str) -> urllib.request.Request:
    content_type = mimetypes.guess_type(str(audio_path))[0] or "application/octet-stream"
    return urllib.request.Request(
        turn_url,
        data=audio_path.read_bytes(),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": content_type,
            "X-Pucky-Turn-Id": turn_id,
        },
    )


def post_live_turn(args: argparse.Namespace, turn_id: str) -> dict[str, Any]:
    if not args.turn_token:
        raise SuiteError("prove-thread-origin requires --turn-token or PUCKY_API_TOKEN")
    audio_path = Path(args.sample_audio)
    if not audio_path.exists():
        raise SuiteError(f"Sample audio not found: {audio_path}")
    request = turn_request(args.turn_url, args.turn_token, audio_path, turn_id)
    try:
        with urllib.request.urlopen(request, timeout=args.turn_timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SuiteError(f"Live turn failed with HTTP {exc.code}: {detail}") from exc


def find_snapshot_card(snapshot: dict[str, Any], *, card_id: str, turn_id: str) -> dict[str, Any]:
    cards = snapshot.get("cards") if isinstance(snapshot.get("cards"), list) else []
    for item in cards:
        if not isinstance(item, dict):
            continue
        if str(item.get("card_id") or "") == card_id:
            return item
        if str(item.get("turn_id") or "") == turn_id:
            return item
        if str(item.get("session_id") or "") == turn_id:
            return item
    raise SuiteError(f"Target card not found in emulator snapshot for turn {turn_id}")


def wait_for_snapshot_card(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    card_id: str,
    turn_id: str,
    timeout: float = 120.0,
) -> tuple[dict[str, Any], dict[str, Any]]:
    deadline = time.monotonic() + timeout
    last_snapshot: dict[str, Any] = {}
    while time.monotonic() < deadline:
        snapshot = command_result(command_json(runner, puckyctl_command(args, config, "ui.reply_cards.get", {}), timeout=120))
        last_snapshot = snapshot if isinstance(snapshot, dict) else {}
        try:
            return last_snapshot, find_snapshot_card(last_snapshot, card_id=card_id, turn_id=turn_id)
        except SuiteError:
            time.sleep(2)
    raise SuiteError(f"Target card not found in emulator snapshot for turn {turn_id} after {int(timeout)}s")


def wait_for_snapshot_condition(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    description: str,
    predicate,
    timeout: float = 120.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_snapshot: dict[str, Any] = {}
    while time.monotonic() < deadline:
        snapshot = command_result(command_json(runner, puckyctl_command(args, config, "ui.reply_cards.get", {}), timeout=120))
        last_snapshot = snapshot if isinstance(snapshot, dict) else {}
        if predicate(last_snapshot):
            return last_snapshot
        time.sleep(2)
    raise SuiteError(f"{description} after {int(timeout)}s")


def snapshot_card_by_card_id(snapshot: dict[str, Any], card_id: str) -> dict[str, Any] | None:
    cards = snapshot.get("cards")
    if not isinstance(cards, list):
        return None
    target = str(card_id or "")
    for item in cards:
        if not isinstance(item, dict):
            continue
        if str(item.get("card_id") or "") == target:
            return item
    return None


def screenshot_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalize_vm_sandbox(value: object) -> str:
    clean = str(value or "").strip()
    if not clean:
        return ""
    try:
        parsed = json.loads(clean)
        if isinstance(parsed, dict):
            raw_type = str(parsed.get("type") or "").strip()
            if raw_type == "dangerFullAccess":
                return "danger-full-access"
            if raw_type == "workspaceWrite":
                return "workspace-write"
            if raw_type == "readOnly":
                return "read-only"
            if raw_type:
                return raw_type
    except Exception:
        pass
    return clean


def vm_thread_query_command(args: argparse.Namespace, thread_id: str) -> list[str]:
    query = textwrap.dedent(
        f"""
        import json, pathlib, sqlite3
        db = pathlib.Path({str(args.vm_codex_home)!r}) / "state_5.sqlite"
        conn = sqlite3.connect(str(db))
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT id, title, rollout_path, source, model, model_provider, reasoning_effort, sandbox_policy, approval_mode FROM threads WHERE id = ?",
            ({thread_id!r},),
        ).fetchone()
        conn.close()
        out = dict(row) if row else {{}}
        rollout = pathlib.Path(str(out.get("rollout_path") or ""))
        out["rollout_exists"] = rollout.exists() if str(out.get("rollout_path") or "") else False
        print(json.dumps(out))
        """
    ).strip()
    return [
        str(args.flyctl),
        "ssh",
        "console",
        "-a",
        args.fly_app,
        "--command",
        f"python3 -c {shlex.quote(query)}",
    ]


def query_live_vm_thread(args: argparse.Namespace, thread_id: str) -> dict[str, Any]:
    command = vm_thread_query_command(args, thread_id)
    completed = subprocess.run(
        command,
        text=True,
        capture_output=True,
        timeout=args.vm_query_timeout_seconds,
    )
    combined = "\n".join(part for part in (completed.stdout, completed.stderr) if part)
    parsed = extract_json(combined)
    if parsed is None:
        raise SuiteError(f"Unable to parse VM thread metadata for {thread_id}: {combined}")
    if not parsed.get("id"):
        raise SuiteError(f"VM thread metadata not found for {thread_id}: {combined}")
    parsed["sandbox_policy"] = normalize_vm_sandbox(parsed.get("sandbox_policy"))
    return parsed


def official_refresh_command(args: argparse.Namespace, config: SlotConfig) -> list[str]:
    command = [
        sys.executable,
        str(ROOT / "tools" / "refresh_pucky_html_official.py"),
        "--target",
        "emulator",
        "--device-id",
        config.device_id,
        "--broker",
        local_broker_url(config),
        "--repo-root",
        str(ROOT),
        "--vm-base-url",
        args.vm_base_url,
        "--command-timeout-seconds",
        str(args.refresh_timeout_seconds),
    ]
    if args.operator_token:
        command += ["--token", args.operator_token]
    return command


def run_official_refresh(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    command = official_refresh_command(args, config)
    if runner.dry_run:
        runner.run(command, timeout=args.refresh_timeout_seconds)
        return {"ok": True, "dry_run": True, "evidence_path": str(ROOT / ".tmp" / "pucky-html-refresh" / "dry-run.json")}
    completed = runner.run(command, timeout=args.refresh_timeout_seconds)
    try:
        parsed = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise SuiteError(f"Unable to parse official refresh output: {completed.stdout}\n{completed.stderr}") from exc
    if not parsed.get("ok"):
        raise SuiteError(f"Official refresh failed: {completed.stdout}\n{completed.stderr}")
    return parsed


def verify_origin_against_vm(origin: dict[str, Any], vm_thread: dict[str, Any], card_title: str) -> dict[str, bool]:
    checks = {
        "thread_id_matches": str(origin.get("thread_id") or "") == str(vm_thread.get("id") or ""),
        "thread_title_matches": str(origin.get("thread_title") or "") == str(card_title or "") == str(vm_thread.get("title") or ""),
        "rollout_path_matches": str(origin.get("rollout_path") or "") == str(vm_thread.get("rollout_path") or ""),
        "model_matches": str(origin.get("model") or "") == str(vm_thread.get("model") or ""),
        "reasoning_matches": str(origin.get("reasoning_effort") or "") == str(vm_thread.get("reasoning_effort") or ""),
        "sandbox_matches": str(origin.get("sandbox_policy") or "") == str(vm_thread.get("sandbox_policy") or ""),
        "approval_matches": str(origin.get("approval_mode") or "") == str(vm_thread.get("approval_mode") or ""),
        "rollout_exists": bool(vm_thread.get("rollout_exists")),
    }
    if not all(checks.values()):
        failed = [name for name, ok in checks.items() if not ok]
        raise SuiteError(f"Origin metadata did not match live VM thread row: {', '.join(failed)}")
    return checks


def capture_screenshot(args: argparse.Namespace, runner: Runner, config: SlotConfig, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    display_id = primary_display_id(args, runner, config)
    screencap_args = ["exec-out", "screencap"]
    if display_id:
        screencap_args.extend(["-d", display_id])
    screencap_args.append("-p")
    if runner.dry_run:
        runner.run(adb_command(args, config.serial, screencap_args), timeout=30)
        return
    with path.open("wb") as out:
        subprocess.run(adb_command(args, config.serial, screencap_args), stdout=out, check=True, timeout=30)


def doctor(args: argparse.Namespace) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: Any) -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": str(detail)})

    for name in ("android_home", "java_home", "gradle", "adb", "emulator", "avdmanager", "puckyctl", "fake_broker"):
        path = getattr(args, name)
        add(name, Path(path).exists(), path)
    image_path = Path(args.android_home) / args.system_image.replace(";", os.sep)
    add("api35_google_apis_x86_64", image_path.exists(), image_path)
    for port in (18081, 18181, 18082, 18182):
        add(f"port_{port}_available", port_available(port), port)
    avd_root = ROOT / ".tmp" / "pucky-emulator"
    avd_root.mkdir(parents=True, exist_ok=True)
    avd_free_gb = free_space_gb(avd_root)
    add(
        "avd_workspace_free_space",
        avd_free_gb >= MIN_RECOMMENDED_AVD_FREE_GB,
        f"{avd_free_gb} GB free (recommended >= {MIN_RECOMMENDED_AVD_FREE_GB:.0f} GB; clean old emulator artifacts/worktrees if low)",
    )
    if Path(args.emulator).exists():
        try:
            result = subprocess.run([str(args.emulator), "-accel-check"], capture_output=True, text=True, timeout=20)
            add("emulator_acceleration", result.returncode == 0, (result.stdout + result.stderr).strip())
        except Exception as exc:
            add("emulator_acceleration", False, exc)
    else:
        add("emulator_acceleration", False, "emulator missing")
    node = shutil.which("node")
    if node:
        result = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=10)
        add("node", result.returncode == 0, result.stdout.strip() or result.stderr.strip())
    else:
        add("node", False, "node not found")
    return {"schema": "pucky.emulator_doctor.v1", "ok": all(item["ok"] for item in checks), "checks": checks}


def start_node_broker(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> int:
    if not port_available(config.broker_port):
        if runner.dry_run:
            return -1
        wait_http(f"http://127.0.0.1:{config.broker_port}/health", timeout=3)
        return -1
    env = os.environ.copy()
    env["PORT"] = str(config.broker_port)
    pid = runner.start_detached(
        ["node", "server.js"],
        cwd=args.fake_broker,
        env=env,
        stdout_path=Path(config.evidence_dir) / "fake-broker.log",
        stderr_path=Path(config.evidence_dir) / "fake-broker.err.log",
    )
    if not runner.dry_run:
        wait_http(f"http://127.0.0.1:{config.broker_port}/health", timeout=20)
    return pid


def start_static_server(args: argparse.Namespace, runner: Runner, config: SlotConfig, bundle_dir: Path) -> int:
    if not port_available(config.ui_port):
        return -1
    return runner.start_detached(
        [sys.executable, "-m", "http.server", str(config.ui_port), "--bind", "127.0.0.1"],
        cwd=bundle_dir,
        env=os.environ.copy(),
        stdout_path=Path(config.evidence_dir) / "ui-server.log",
        stderr_path=Path(config.evidence_dir) / "ui-server.err.log",
    )


def cmd_create(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    assert_inside(Path(config.avd_home), ROOT / ".tmp")
    Path(config.avd_home).mkdir(parents=True, exist_ok=True)
    result = runner.run(avdmanager_create_command(args, config), env=sdk_env(args, config), timeout=120)
    if not args.dry_run:
        tune_avd_config(config)
    if not args.dry_run:
        save_state(config, {"config": asdict(config), "create_stdout": result.stdout, "create_stderr": result.stderr})
    return {"ok": True, "config": asdict(config), "commands": runner.planned, "dry_run": args.dry_run}


def cmd_start(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    if not args.dry_run:
        tune_avd_config(config)
    Path(config.evidence_dir).mkdir(parents=True, exist_ok=True)
    pid = -1
    if not serial_is_connected(args, runner, config.serial):
        pid = runner.start_detached(
            emulator_start_command(args, config),
            cwd=ROOT,
            env=sdk_env(args, config),
            stdout_path=Path(config.evidence_dir) / "emulator.log",
            stderr_path=Path(config.evidence_dir) / "emulator.err.log",
        )
    if not args.no_wait:
        wait_for_boot(args, runner, config, pid=pid if pid > 0 else None)
    if not args.dry_run:
        state = load_state(ROOT, args.slot)
        pids = state.get("pids") if isinstance(state.get("pids"), dict) else {}
        if pid > 0:
            pids["emulator"] = pid
        save_state(config, {"config": asdict(config), "pids": pids, "serial": config.serial})
    return {"ok": True, "config": asdict(config), "pid": pid, "commands": runner.planned, "dry_run": args.dry_run}


def cmd_provision(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    require_emulator_serial(config.serial)
    if not serial_is_connected(args, runner, config.serial):
        raise SuiteError(f"Emulator is not connected: {config.serial}")
    Path(config.evidence_dir).mkdir(parents=True, exist_ok=True)
    wait_for_install_services(args, runner, config)
    broker_pid = start_node_broker(args, runner, config)
    if not args.skip_build:
        runner.run([str(args.gradle), "-p", str(ROOT / "pucky-apk"), ":app:assembleDebug"], env=sdk_env(args, config), timeout=300)
    if not Path(args.apk).exists() and not args.dry_run:
        raise SuiteError(f"APK not found: {args.apk}")
    runner.run(adb_command(args, config.serial, ["reverse", f"tcp:{config.broker_port}", f"tcp:{config.broker_port}"]), timeout=30)
    runner.run(adb_command(args, config.serial, ["install", "-r", str(args.apk)]), timeout=180)
    runner.run(adb_command(args, config.serial, ["shell", "pm", "grant", args.package_name, "android.permission.RECORD_AUDIO"]), timeout=30)
    runner.run(adb_command(args, config.serial, ["shell", "pm", "grant", args.package_name, "android.permission.POST_NOTIFICATIONS"]), timeout=30, check=False)
    runner.run(adb_command(args, config.serial, ["shell", "wm", "size", "1056x1056"]), timeout=30)
    runner.run(adb_command(args, config.serial, ["shell", "wm", "density", "420"]), timeout=30)
    runner.run(launch_command(args, config), timeout=30)
    broker_device = wait_for_broker_device(config) if not args.dry_run else {"dry_run": True}
    if not args.dry_run:
        state = load_state(ROOT, args.slot)
        pids = state.get("pids") if isinstance(state.get("pids"), dict) else {}
        if broker_pid > 0:
            pids["fake_broker"] = broker_pid
        save_state(config, {"config": asdict(config), "pids": pids, "serial": config.serial, "broker_url": f"http://127.0.0.1:{config.broker_port}"})
    return {"ok": True, "config": asdict(config), "broker_pid": broker_pid, "broker_device": broker_device, "commands": runner.planned, "dry_run": args.dry_run}


def default_cards(config: SlotConfig) -> dict[str, Any]:
    return {
        "cards": [
            {
                "session_id": f"emu_probe_slot_{config.slot:02d}",
                "title": f"Emulator slot {config.slot:02d} probe",
                "tag": "Emulator",
                "summary": "Command-bus seeded card for emulator verification.",
                "icon": "terminal",
                "accent": "#66d9ef",
                "created_at": now_iso(),
                "trace": {"schema": "pucky.turn_trace.v1", "sections": []},
            }
        ]
    }


def cards_payload_from_args(args: argparse.Namespace, config: SlotConfig) -> dict[str, Any]:
    if getattr(args, "cards_file", None):
        return json.loads(Path(args.cards_file).read_text(encoding="utf-8"))
    if args.cards_json:
        return json.loads(args.cards_json)
    return default_cards(config)


def cmd_seed_ui(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    require_emulator_serial(config.serial)
    if not serial_is_connected(args, runner, config.serial):
        raise SuiteError(f"Emulator is not connected: {config.serial}")
    bundle_dir = Path(config.run_dir) / "ui-bundle"
    if not args.dry_run:
        from pucky_vm.ui_bundle import build_ui_bundle

        bundle_result = build_ui_bundle(bundle_dir, ui_version=config.bundle_version)
    else:
        bundle_result = {"bundle_path": str(bundle_dir / "pucky-ui-latest.zip"), "manifest": {"ui_version": config.bundle_version}}
    ui_pid = start_static_server(args, runner, config, bundle_dir)
    if not args.dry_run and ui_pid > 0:
        state = load_state(ROOT, args.slot)
        pids = state.get("pids") if isinstance(state.get("pids"), dict) else {}
        pids["ui_server"] = ui_pid
        save_state(config, {"config": asdict(config), "pids": pids, "serial": config.serial})
    runner.run(adb_command(args, config.serial, ["reverse", f"tcp:{config.ui_port}", f"tcp:{config.ui_port}"]), timeout=30)
    bundle_status = command_json(
        runner,
        puckyctl_command(
            args,
            config,
            "ui.bundle.refresh",
            {"url": f"http://127.0.0.1:{config.ui_port}/pucky-ui-latest.zip", "max_bytes": args.max_bundle_bytes},
        ),
        timeout=300,
    )
    cards_payload = cards_payload_from_args(args, config)
    cards_status = command_json(runner, puckyctl_command(args, config, "ui.reply_cards.set", cards_payload), timeout=300)
    if not args.dry_run:
        state = load_state(ROOT, args.slot)
        pids = state.get("pids") if isinstance(state.get("pids"), dict) else {}
        if ui_pid > 0:
            pids["ui_server"] = ui_pid
        save_state(config, {"config": asdict(config), "pids": pids, "serial": config.serial})
        write_evidence(config, "seed-ui.json", {"bundle": bundle_result, "bundle_status": bundle_status, "cards_status": cards_status})
    return {
        "ok": True,
        "config": asdict(config),
        "bundle": bundle_result,
        "bundle_status": bundle_status,
        "cards_status": cards_status,
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }


def cmd_smoke(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    require_emulator_serial(config.serial)
    if not serial_is_connected(args, runner, config.serial):
        raise SuiteError(f"Emulator is not connected: {config.serial}")
    health = wait_http(f"http://127.0.0.1:{config.broker_port}/health", timeout=10) if not args.dry_run else {"dry_run": True}
    ping = command_json(runner, puckyctl_command(args, config, "ping", {}), timeout=60)
    bundle = command_json(runner, puckyctl_command(args, config, "ui.bundle.status", {}), timeout=60)
    cards = command_json(runner, puckyctl_command(args, config, "ui.reply_cards.get", {}), timeout=60)
    runner.run(launch_home_command(args, config), timeout=30)
    if not args.dry_run:
        time.sleep(0.5)
    screenshot = Path(config.evidence_dir) / "home-feed.png"
    post_tap_screenshot = Path(config.evidence_dir) / "post-tap.png"
    if not args.dry_run:
        capture_screenshot(args, runner, config, screenshot)
    runner.run(adb_command(args, config.serial, ["shell", "input", "tap", "528", "230"]), timeout=30)
    if not args.dry_run:
        time.sleep(0.5)
        capture_screenshot(args, runner, config, post_tap_screenshot)
        write_evidence(
            config,
            "smoke.json",
            {"health": health, "ping": ping, "bundle": bundle, "cards": cards, "screenshot": str(screenshot), "post_tap_screenshot": str(post_tap_screenshot)},
        )
    return {
        "schema": "pucky.emulator_smoke.v1",
        "ok": True,
        "config": asdict(config),
        "health": health,
        "ping": ping,
        "bundle": bundle,
        "cards": cards,
        "screenshot": str(screenshot),
        "post_tap_screenshot": str(post_tap_screenshot),
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }


def command_result(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload.get("result")
    return result if isinstance(result, dict) else payload


def wake_status(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    return command_result(command_json(runner, puckyctl_command(args, config, "wake.status", {}), timeout=60))


def wake_command(args: argparse.Namespace, runner: Runner, config: SlotConfig, name: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    return command_result(command_json(runner, puckyctl_command(args, config, name, payload or {}), timeout=120))


def turn_status(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    return command_result(command_json(runner, puckyctl_command(args, config, "pucky.turn.status", {}), timeout=60))


def turn_history(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    return command_result(command_json(runner, puckyctl_command(args, config, "pucky.turn.history", {}), timeout=60))


def turn_read(args: argparse.Namespace, runner: Runner, config: SlotConfig, turn_id: str) -> dict[str, Any]:
    return command_result(command_json(runner, puckyctl_command(args, config, "pucky.turn.read", {"turn_id": turn_id}), timeout=60))


def relaunch_with_provisioning(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    turn_url: str = "",
    turn_token: str = "",
    stage: str,
) -> None:
    runner.run(adb_command(args, config.serial, ["shell", "am", "force-stop", args.package_name]), timeout=30)
    time.sleep(1.0 if not runner.dry_run else 0.0)
    runner.run(
        launch_command(
            args,
            config,
            turn_url_override=turn_url,
            turn_token_override=turn_token,
        ),
        timeout=30,
    )
    ensure_broker_command_channel(args, runner, config, stage=stage, timeout_seconds=90)
    runner.run(launch_home_command(args, config), timeout=30)


def push_turn_fixture(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    local_path: Path,
    fixture_name: str,
) -> dict[str, Any]:
    target_name = fixture_name if fixture_name.lower().endswith(".wav") else fixture_name + ".wav"
    staging_dir = "/data/local/tmp/pucky-turn-fixtures"
    staging_path = f"{staging_dir}/{target_name}"
    internal_dir = f"/data/user/0/{args.package_name}/files/turn-fixtures"
    internal_path = f"{internal_dir}/{target_name}"
    runner.run(adb_command(args, config.serial, ["shell", "mkdir", "-p", staging_dir]), timeout=30)
    runner.run(adb_command(args, config.serial, ["push", str(local_path), staging_path]), timeout=60)
    runner.run(adb_command(args, config.serial, ["shell", "chmod", "0644", staging_path]), timeout=30)
    runner.run(adb_command(args, config.serial, ["shell", "run-as", args.package_name, "mkdir", "-p", internal_dir]), timeout=30)
    runner.run(adb_command(args, config.serial, ["shell", "run-as", args.package_name, "cp", staging_path, internal_path]), timeout=30)
    return {
        "fixture_name": fixture_name,
        "local_path": str(local_path),
        "remote_path": staging_path,
        "internal_path": internal_path,
    }


def prepare_turn_fixtures(config: SlotConfig) -> dict[str, Path]:
    fixture_dir = Path(config.run_dir) / "turn-fixtures"
    source_dir = ROOT / "pucky_vm" / "ui_src" / "fixtures" / "artifacts"
    speech_source = source_dir / "meeting.wav"
    upload_source = source_dir / "morning.wav"
    fixtures = {
        "wake_flashlight": build_buffered_turn_fixture(
            speech_source,
            fixture_dir / "wake_flashlight.wav",
            lead_silence_ms=350,
            trail_silence_ms=1200,
        ),
        "wake_weather": build_buffered_turn_fixture(
            upload_source,
            fixture_dir / "wake_weather.wav",
            lead_silence_ms=350,
            trail_silence_ms=1200,
        ),
        "manual_flashlight": build_buffered_turn_fixture(
            speech_source,
            fixture_dir / "manual_flashlight.wav",
            lead_silence_ms=350,
            trail_silence_ms=1200,
        ),
        "wake_silence": build_silence_turn_fixture(
            fixture_dir / "wake_silence.wav",
            duration_ms=3600,
        ),
    }
    return fixtures


def appops_record_audio(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> str:
    result = runner.run(
        adb_command(args, config.serial, ["shell", "cmd", "appops", "get", args.package_name, "RECORD_AUDIO"]),
        timeout=30,
        check=False,
    )
    return (result.stdout + "\n" + result.stderr).strip()


def appops_indicates_running(text: str) -> bool:
    return "running" in str(text or "").lower()


def dumpsys_audio_excerpt(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> str:
    result = runner.run(
        adb_command(args, config.serial, ["shell", "dumpsys", "audio"]),
        timeout=45,
        check=False,
    )
    text = (result.stdout + "\n" + result.stderr).splitlines()
    lowered_package = args.package_name.lower()
    matches = [line for line in text if lowered_package in line.lower() or "voice_recognition" in line.lower()]
    return "\n".join(matches[:120]) if matches else "\n".join(text[:120])


def filtered_logcat(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> str:
    result = runner.run(
        adb_command(
            args,
            config.serial,
            ["logcat", "-d", "PuckyWakeWord:V", "PuckyWakeRecognizer:V", "PuckyTurnController:V", "PuckyTurnKeyword:V", "AudioRecord:V", "*:S"],
        ),
        timeout=45,
        check=False,
    )
    return (result.stdout + "\n" + result.stderr).strip()


def wait_for_wake_status(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    predicate,
    *,
    timeout_seconds: float = 20.0,
    sleep_seconds: float = 0.5,
    description: str = "wake status condition",
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last = wake_status(args, runner, config)
        if predicate(last):
            return last
        time.sleep(sleep_seconds)
    raise SuiteError(f"Timed out waiting for {description}: {last}")


def wait_for_turn_status(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    predicate,
    *,
    timeout_seconds: float = 20.0,
    sleep_seconds: float = 0.5,
    description: str = "turn status condition",
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last = turn_status(args, runner, config)
        if predicate(last):
            return last
        time.sleep(sleep_seconds)
    raise SuiteError(f"Timed out waiting for {description}: {last}")


def turn_indicator(status: dict[str, Any]) -> dict[str, Any]:
    indicator = status.get("indicator")
    return indicator if isinstance(indicator, dict) else {}


def turn_visual_state(status: dict[str, Any]) -> str:
    indicator = turn_indicator(status)
    return str(indicator.get("visual_state") or status.get("visual_state") or indicator.get("state") or status.get("state") or "idle")


def wake_stage_snapshot(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    stage: str,
    *,
    screenshot_name: str | None = None,
) -> dict[str, Any]:
    wake = wake_status(args, runner, config)
    turn = turn_status(args, runner, config)
    appops = appops_record_audio(args, runner, config)
    audio = dumpsys_audio_excerpt(args, runner, config)
    screenshot_path = ""
    if screenshot_name and not runner.dry_run:
        screenshot = Path(config.evidence_dir) / screenshot_name
        capture_screenshot(args, runner, config, screenshot)
        screenshot_path = str(screenshot)
    return {
        "stage": stage,
        "wake_status": wake,
        "turn_status": turn,
        "appops_record_audio": appops,
        "appops_running": appops_indicates_running(appops),
        "dumpsys_audio_excerpt": audio,
        "screenshot": screenshot_path,
    }


def ensure_broker_command_channel(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    stage: str,
    timeout_seconds: int,
) -> dict[str, Any]:
    if runner.dry_run:
        return {"stage": stage, "dry_run": True}
    device = wait_for_broker_device(config, timeout=float(timeout_seconds))
    ping = command_result(
        command_json(
            runner,
            puckyctl_command(
                args,
                config,
                "ping",
                {},
                timeout_ms=puckyctl_timeout_ms(args, minimum_seconds=timeout_seconds),
            ),
            timeout=max(60, int(timeout_seconds)),
        )
    )
    return {"stage": stage, "device": device, "ping": ping}


def record_thread_origin_failure(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    stage: str,
    kind: str,
    error: Exception,
    extra: dict[str, Any] | None = None,
) -> Path:
    payload = {
        "schema": "pucky.emulator_thread_origin_failure.v1",
        "created_at": now_iso(),
        "stage": stage,
        "kind": kind,
        "error": str(error),
        "config": asdict(config),
        "adb_state": adb_transport_state(args, runner, config.serial),
        "broker_url": local_broker_url(config),
        "broker_device": broker_device_snapshot(config),
        "extra": extra or {},
    }
    return write_evidence(config, "thread-origin-failure.json", payload)


def cmd_prove_thread_origin(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    require_emulator_serial(config.serial)
    if not serial_is_connected(args, runner, config.serial):
        raise SuiteError(f"Emulator is not connected: {config.serial}")

    Path(config.evidence_dir).mkdir(parents=True, exist_ok=True)
    channel_checks: dict[str, Any] = {}
    if not args.skip_refresh:
        if not args.dry_run:
            channel_checks["before_refresh"] = ensure_broker_command_channel(
                args,
                runner,
                config,
                stage="before_refresh",
                timeout_seconds=45,
            )
        try:
            bundle_refresh = run_official_refresh(args, runner, config)
        except Exception as exc:
            if args.dry_run:
                raise
            failure_path = record_thread_origin_failure(
                args,
                runner,
                config,
                stage="refresh",
                kind="refresh_failed",
                error=exc if isinstance(exc, Exception) else SuiteError(str(exc)),
                extra={"channel_checks": channel_checks},
            )
            raise SuiteError(f"Official refresh failed during thread-origin proof; see {failure_path}: {exc}") from exc
        if not args.dry_run:
            try:
                channel_checks["after_refresh"] = ensure_broker_command_channel(
                    args,
                    runner,
                    config,
                    stage="after_refresh",
                    timeout_seconds=max(90, args.refresh_timeout_seconds),
                )
            except Exception as exc:
                kind = "device_offline_during_refresh" if adb_transport_state(args, runner, config.serial) != "device" else "broker_not_reconnected_after_refresh"
                failure_path = record_thread_origin_failure(
                    args,
                    runner,
                    config,
                    stage="after_refresh",
                    kind=kind,
                    error=exc if isinstance(exc, Exception) else SuiteError(str(exc)),
                    extra={"bundle_refresh": bundle_refresh, "channel_checks": channel_checks},
                )
                raise SuiteError(f"Thread-origin proof lost the device after refresh; see {failure_path}: {exc}") from exc
    else:
        bundle_refresh = {"ok": True, "skipped": True}
    bundle_status = command_result(command_json(runner, puckyctl_command(args, config, "ui.bundle.status", {}), timeout=120))
    runner.run(launch_command(args, config), timeout=30)
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)

    turn_id = f"prove-thread-origin-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    if args.dry_run:
        live_turn = {
            "turn_id": turn_id,
            "card_id": f"pucky_card_{turn_id}",
            "title": "Proof card",
            "origin": {
                "runtime": "codex",
                "thread_id": "thread-dry-run",
                "thread_title": "Proof card",
                "rollout_path": "/data/home/codex/sessions/dry-run.jsonl",
                "source": "vscode",
                "model": "gpt-5.5",
                "model_provider": "openai",
                "reasoning_effort": "high",
                "sandbox_policy": "danger-full-access",
                "approval_mode": "never",
            },
        }
        vm_thread = {
            "id": "thread-dry-run",
            "title": "Proof card",
            "rollout_path": "/data/home/codex/sessions/dry-run.jsonl",
            "source": "vscode",
            "model": "gpt-5.5",
            "model_provider": "openai",
            "reasoning_effort": "high",
            "sandbox_policy": "danger-full-access",
            "approval_mode": "never",
            "rollout_exists": True,
        }
    else:
        live_turn = post_live_turn(args, turn_id)
        vm_thread = query_live_vm_thread(args, str((live_turn.get("origin") or {}).get("thread_id") or ""))

    origin = live_turn.get("origin") if isinstance(live_turn.get("origin"), dict) else {}
    if not origin:
        raise SuiteError("Live turn response did not include origin metadata")
    vm_checks = verify_origin_against_vm(origin, vm_thread, str(live_turn.get("title") or ""))

    if args.dry_run:
        runner.run(puckyctl_command(args, config, "pucky.feed.sync", {"reason": f"prove-thread-origin:{turn_id}"}), timeout=180)
        runner.run(puckyctl_command(args, config, "ui.reply_cards.get", {}), timeout=120)
        feed_sync = {"schema": "pucky.feed_sync_result.v1", "dry_run": True}
        snapshot = {"schema": "pucky.reply_cards.v1", "cards": [{"card_id": live_turn["card_id"], "turn_id": turn_id, "session_id": turn_id, "origin": origin}]}
    else:
        feed_sync = command_result(
            command_json(
                runner,
                puckyctl_command(args, config, "pucky.feed.sync", {"reason": f"prove-thread-origin:{turn_id}"}),
                timeout=180,
            )
        )
        snapshot, local_card = wait_for_snapshot_card(
            args,
            runner,
            config,
            card_id=str(live_turn.get("card_id") or ""),
            turn_id=turn_id,
        )
    if args.dry_run:
        local_card = find_snapshot_card(snapshot, card_id=str(live_turn.get("card_id") or ""), turn_id=turn_id)
    local_origin = local_card.get("origin") if isinstance(local_card.get("origin"), dict) else {}
    if local_origin != origin:
        raise SuiteError("Emulator local store origin does not match live turn origin")

    feed_screenshot = Path(config.evidence_dir) / "feed-card.png"
    detail_screenshot = Path(config.evidence_dir) / "detail-thread.png"
    gear_screenshot = Path(config.evidence_dir) / "gear-sheet.png"
    relaunch_gear_screenshot = Path(config.evidence_dir) / "relaunch-gear-sheet.png"

    runner.run(launch_home_command(args, config), timeout=30)
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, feed_screenshot)
    tap(args, runner, config, parse_tap_point(args.open_card_tap))
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, detail_screenshot)
    tap(args, runner, config, parse_tap_point(args.gear_tap))
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, gear_screenshot)

    runner.run(adb_command(args, config.serial, ["shell", "am", "force-stop", args.package_name]), timeout=30)
    runner.run(launch_command(args, config), timeout=30)
    if not args.dry_run:
        try:
            channel_checks["after_relaunch"] = ensure_broker_command_channel(
                args,
                runner,
                config,
                stage="after_relaunch",
                timeout_seconds=45,
            )
        except Exception as exc:
            kind = "device_offline_after_relaunch" if adb_transport_state(args, runner, config.serial) != "device" else "broker_not_reconnected_after_relaunch"
            failure_path = record_thread_origin_failure(
                args,
                runner,
                config,
                stage="after_relaunch",
                kind=kind,
                error=exc if isinstance(exc, Exception) else SuiteError(str(exc)),
                extra={"bundle_refresh": bundle_refresh, "channel_checks": channel_checks},
            )
            raise SuiteError(f"Thread-origin proof lost the device after relaunch; see {failure_path}: {exc}") from exc
        relaunch_snapshot, relaunch_card = wait_for_snapshot_card(
            args,
            runner,
            config,
            card_id=str(live_turn.get("card_id") or ""),
            turn_id=turn_id,
        )
    else:
        runner.run(puckyctl_command(args, config, "ui.reply_cards.get", {}), timeout=120)
        relaunch_snapshot = {"schema": "pucky.reply_cards.v1", "cards": [{"card_id": live_turn["card_id"], "turn_id": turn_id, "session_id": turn_id, "origin": origin}]}
        relaunch_card = find_snapshot_card(relaunch_snapshot, card_id=str(live_turn.get("card_id") or ""), turn_id=turn_id)
    relaunch_origin = relaunch_card.get("origin") if isinstance(relaunch_card.get("origin"), dict) else {}
    if relaunch_origin != origin:
        raise SuiteError("Persisted origin did not survive app relaunch")

    runner.run(launch_home_command(args, config), timeout=30)
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
    tap(args, runner, config, parse_tap_point(args.open_card_tap))
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
    tap(args, runner, config, parse_tap_point(args.gear_tap))
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, relaunch_gear_screenshot)

    evidence = {
        "schema": "pucky.emulator_thread_origin_proof.v1",
        "created_at": now_iso(),
        "config": asdict(config),
        "bundle_refresh": bundle_refresh,
        "bundle_status": bundle_status,
        "live_turn": {
            "turn_id": live_turn.get("turn_id"),
            "card_id": live_turn.get("card_id"),
            "title": live_turn.get("title"),
            "origin": origin,
        },
        "vm_thread": vm_thread,
        "vm_checks": vm_checks,
        "feed_sync": feed_sync,
        "local_card_origin": local_origin,
        "relaunch_card_origin": relaunch_origin,
        "channel_checks": channel_checks,
        "screenshots": {
            "feed_card": str(feed_screenshot),
            "detail_thread": str(detail_screenshot),
            "gear_sheet": str(gear_screenshot),
            "relaunch_gear_sheet": str(relaunch_gear_screenshot),
        },
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }
    evidence_path = write_evidence(config, "thread-origin-proof.json", evidence)
    return {
        "schema": "pucky.emulator_thread_origin_proof_result.v1",
        "ok": True,
        "config": asdict(config),
        "turn_id": turn_id,
        "card_id": str(live_turn.get("card_id") or ""),
        "thread_id": str(origin.get("thread_id") or ""),
        "evidence_path": str(evidence_path),
        "screenshots": evidence["screenshots"],
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }


def cmd_prove_pending_outbound_feed(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    require_emulator_serial(config.serial)
    if not serial_is_connected(args, runner, config.serial):
        raise SuiteError(f"Emulator is not connected: {config.serial}")

    Path(config.evidence_dir).mkdir(parents=True, exist_ok=True)
    if not args.skip_refresh:
        run_official_refresh(args, runner, config)
    bundle_status = command_result(command_json(runner, puckyctl_command(args, config, "ui.bundle.status", {}), timeout=120))
    runner.run(launch_home_command(args, config), timeout=30)
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)

    command_json(runner, puckyctl_command(args, config, "pucky.turn.debug.inject_history", {"clear": True}), timeout=120)
    command_json(runner, puckyctl_command(args, config, "ui.reply_cards.clear", {}), timeout=120)

    sending_turn_id = f"pending-feed-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    sending_card_id = f"pending_turn_{sending_turn_id}"
    sending_inject = {
        "turn_id": sending_turn_id,
        "local_session_id": sending_turn_id,
        "latest_state": "upload_received",
        "updated_at": now_iso(),
    }
    sending_result = command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.turn.debug.inject_history", sending_inject),
            timeout=120,
        )
    )
    sending_snapshot = wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="Pending outbound sending card did not appear",
        predicate=lambda snapshot: (
            isinstance(snapshot_card_by_card_id(snapshot, sending_card_id), dict)
            and snapshot_card_by_card_id(snapshot, sending_card_id).get("pending_outbound") is True
            and str(snapshot_card_by_card_id(snapshot, sending_card_id).get("pending_label") or "") == "Sending"
        ),
        timeout=120,
    )
    sending_read = command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.turn.read", {"turn_id": sending_turn_id}),
            timeout=120,
        )
    )
    sending_screenshot = Path(config.evidence_dir) / "sending-placeholder.png"
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, sending_screenshot)

    transcript_text = "Remind me to email Sarah after lunch about the mocks."
    thinking_inject = {
        "turn_id": sending_turn_id,
        "local_session_id": sending_turn_id,
        "latest_state": "codex_running",
        "updated_at": now_iso(),
        "user_transcript": transcript_text,
    }
    thinking_result = command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.turn.debug.inject_history", thinking_inject),
            timeout=120,
        )
    )
    thinking_snapshot = wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="Pending outbound thinking card did not update",
        predicate=lambda snapshot: (
            isinstance(snapshot_card_by_card_id(snapshot, sending_card_id), dict)
            and str(snapshot_card_by_card_id(snapshot, sending_card_id).get("pending_label") or "") == "Thinking"
            and str(snapshot_card_by_card_id(snapshot, sending_card_id).get("summary") or "") == transcript_text
        ),
        timeout=120,
    )
    thinking_read = command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.turn.read", {"turn_id": sending_turn_id}),
            timeout=120,
        )
    )
    thinking_screenshot = Path(config.evidence_dir) / "thinking-transcript.png"
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, thinking_screenshot)

    reply_card_id = f"reply_{sending_turn_id}"
    reply_payload = {
        "cards": [
            {
                "card_id": reply_card_id,
                "turn_id": sending_turn_id,
                "session_id": sending_turn_id,
                "title": "Email Sarah",
                "summary": "Draft a short follow-up and include the mockup link.",
                "transcript": "Draft a short follow-up and include the mockup link.",
                "transcript_messages": [
                    {
                        "role": "assistant",
                        "text": "Draft a short follow-up and include the mockup link.",
                        "created_at": now_iso(),
                    }
                ],
                "created_at": now_iso(),
                "updated_at": now_iso(),
                "icon": "bolt",
                "accent": "#72c2ff",
                "trace": {"schema": "pucky.turn_trace.v1", "sections": []},
                "origin": {"runtime": "debug"},
                "archived": False,
                "read": False,
                "deleted": False,
            }
        ]
    }
    reply_set = command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "ui.reply_cards.set", reply_payload),
            timeout=120,
        )
    )
    reply_snapshot = wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="Reply card did not replace outbound pending card",
        predicate=lambda snapshot: (
            snapshot_card_by_card_id(snapshot, sending_card_id) is None
            and isinstance(snapshot_card_by_card_id(snapshot, reply_card_id), dict)
        ),
        timeout=120,
    )
    reply_screenshot = Path(config.evidence_dir) / "reply-replaced.png"
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, reply_screenshot)

    failed_turn_id = f"pending-failed-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    failed_card_id = f"pending_turn_{failed_turn_id}"
    failed_inject = {
        "turn_id": failed_turn_id,
        "local_session_id": failed_turn_id,
        "latest_state": "failed",
        "updated_at": now_iso(),
        "user_transcript": "This should fail and stay visible.",
        "error": "debug_failure",
    }
    failed_result = command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.turn.debug.inject_history", failed_inject),
            timeout=120,
        )
    )
    failed_snapshot = wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="Failed outbound card did not appear",
        predicate=lambda snapshot: (
            isinstance(snapshot_card_by_card_id(snapshot, failed_card_id), dict)
            and str(snapshot_card_by_card_id(snapshot, failed_card_id).get("pending_label") or "") == "Failed"
        ),
        timeout=120,
    )
    failed_read = command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.turn.read", {"turn_id": failed_turn_id}),
            timeout=120,
        )
    )
    failed_screenshot = Path(config.evidence_dir) / "failed-card.png"
    failed_post_tap_screenshot = Path(config.evidence_dir) / "failed-card-after-tap.png"
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, failed_screenshot)
    tap(args, runner, config, parse_tap_point(args.failed_card_tap))
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, failed_post_tap_screenshot)
        if screenshot_sha256(failed_screenshot) != screenshot_sha256(failed_post_tap_screenshot):
            raise SuiteError("Failed outbound card tap changed the UI; expected no detail navigation")

    failed_menu_screenshot = Path(config.evidence_dir) / "failed-archive-menu.png"
    long_press(args, runner, config, parse_tap_point(args.failed_card_tap), duration_ms=args.long_press_ms)
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, failed_menu_screenshot)
    archive_result = command_result(
        command_json(
            runner,
            puckyctl_command(
                args,
                config,
                "pucky.feed.action",
                {
                    "card_id": failed_card_id,
                    "session_id": failed_turn_id,
                    "action": "archive",
                    "client_action_id": f"prove_pending_archive_{int(time.time())}",
                },
            ),
            timeout=120,
        )
    )
    archived_snapshot = wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="Archived failed outbound card still visible in active feed snapshot",
        predicate=lambda snapshot: (
            isinstance(snapshot_card_by_card_id(snapshot, failed_card_id), dict)
            and bool(snapshot_card_by_card_id(snapshot, failed_card_id).get("archived"))
        ),
        timeout=120,
    )
    archived_screenshot = Path(config.evidence_dir) / "failed-archived.png"
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, archived_screenshot)

    history_snapshot = command_result(command_json(runner, puckyctl_command(args, config, "pucky.turn.history", {}), timeout=120))
    final_snapshot = command_result(command_json(runner, puckyctl_command(args, config, "ui.reply_cards.get", {}), timeout=120))
    evidence = {
        "schema": "pucky.emulator_pending_outbound_proof.v1",
        "created_at": now_iso(),
        "config": asdict(config),
        "bundle_status": bundle_status,
        "sending": {
            "inject": sending_inject,
            "result": sending_result,
            "read": sending_read,
            "snapshot": sending_snapshot,
        },
        "thinking": {
            "inject": thinking_inject,
            "result": thinking_result,
            "read": thinking_read,
            "snapshot": thinking_snapshot,
        },
        "reply": {
            "set": reply_set,
            "snapshot": reply_snapshot,
        },
        "failed": {
            "inject": failed_inject,
            "result": failed_result,
            "read": failed_read,
            "snapshot": failed_snapshot,
            "archive": archive_result,
            "archived_snapshot": archived_snapshot,
        },
        "history": history_snapshot,
        "final_snapshot": final_snapshot,
        "screenshots": {
            "sending_placeholder": str(sending_screenshot),
            "thinking_transcript": str(thinking_screenshot),
            "reply_replaced": str(reply_screenshot),
            "failed_card": str(failed_screenshot),
            "failed_card_after_tap": str(failed_post_tap_screenshot),
            "failed_archive_menu": str(failed_menu_screenshot),
            "failed_archived": str(archived_screenshot),
        },
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }
    evidence_path = write_evidence(config, "pending-outbound-proof.json", evidence)
    return {
        "schema": "pucky.emulator_pending_outbound_proof_result.v1",
        "ok": True,
        "config": asdict(config),
        "evidence_path": str(evidence_path),
        "screenshots": evidence["screenshots"],
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }


def wait_for_turn_visual(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    visual_state: str,
    *,
    timeout_seconds: float = 12.0,
    sleep_seconds: float = 0.1,
    description: str,
) -> dict[str, Any]:
    return wait_for_turn_status(
        args,
        runner,
        config,
        lambda status: turn_visual_state(status) == visual_state,
        timeout_seconds=timeout_seconds,
        sleep_seconds=sleep_seconds,
        description=description,
    )


def configure_turn_lab_runtime(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    fake_turn: FakeTurnEndpoint | None,
    reply_mode: str,
) -> dict[str, Any]:
    if fake_turn is not None:
        relaunch_with_provisioning(
            args,
            runner,
            config,
            turn_url=fake_turn.emulator_turn_url,
            turn_token="debug-token",
            stage="wake_turn_lab_relaunch",
        )
    recipe_sync = sync_default_recipe_bundle(args, runner, config)
    turn_settings = wake_command(args, runner, config, "pucky.turn.settings.set", {"reply_mode": reply_mode})
    return {
        "recipe_sync": recipe_sync,
        "turn_settings": turn_settings,
    }


def arm_wake_turn_lab(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    fixture_name: str = "",
    debug_fixture_transcript: str = "",
    fixture_start_delay_ms: int = 0,
) -> dict[str, Any]:
    wake_command(args, runner, config, "wake.stop", {})
    payload: dict[str, Any] = {
        "enabled": True,
        "recognizer_mode": "fake",
        "capture_source": "fixture" if fixture_name else "",
        "fixture_name": fixture_name,
        "debug_fixture_transcript": debug_fixture_transcript,
    }
    if fixture_start_delay_ms > 0:
        payload["fixture_start_delay_ms"] = fixture_start_delay_ms
    wake_command(args, runner, config, "wake.config.set", payload)
    return wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: bool(status.get("running")),
        description="wake armed for wake-to-turn lab",
    )


def scenario_turn_id(snapshot: dict[str, Any]) -> str:
    turn = snapshot.get("turn_status") or {}
    last = turn.get("last_status") if isinstance(turn.get("last_status"), dict) else {}
    return str(last.get("turn_id") or turn.get("turn_id") or "")


def sync_default_recipe_bundle(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    bundle_path = DEFAULT_RECIPE_BUNDLE
    if not bundle_path.exists():
        raise SuiteError(f"Recipe bundle not found: {bundle_path}")
    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    cleared = command_result(command_json(runner, puckyctl_command(args, config, "pucky.recipes.clear", {}), timeout=120))
    synced = command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.recipes.sync", {"bundle": bundle}),
            timeout=120,
        )
    )
    listed = command_result(command_json(runner, puckyctl_command(args, config, "pucky.recipes.list", {}), timeout=120))
    return {
        "bundle_path": str(bundle_path),
        "bundle_id": bundle.get("bundle_id"),
        "cleared": cleared,
        "sync": synced,
        "listed": listed,
    }


def wake_lab_gates(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    snapshots: list[dict[str, Any]] = []
    commands: list[dict[str, Any]] = []

    commands.append({"wake.stop": wake_command(args, runner, config, "wake.stop", {})})
    snapshots.append(wake_stage_snapshot(args, runner, config, "after_wake_stop", screenshot_name="wake-gates-stop.png"))

    commands.append({
        "wake.config.set": wake_command(
            args,
            runner,
            config,
            "wake.config.set",
            {"enabled": True, "recognizer_mode": "fake"},
        )
    })
    armed = wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: bool(status.get("running")),
        description="wake running after wake.start",
    )
    snapshots.append(wake_stage_snapshot(args, runner, config, "armed", screenshot_name="wake-gates-armed.png"))

    runner.run(adb_command(args, config.serial, ["shell", "input", "keyevent", "26"]), timeout=30)
    blocked = wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: status.get("suspended_reason") == "device_not_interactive",
        description="wake blocked after screen off",
    )
    snapshots.append(wake_stage_snapshot(args, runner, config, "screen_off", screenshot_name="wake-gates-screen-off.png"))

    runner.run(adb_command(args, config.serial, ["shell", "input", "keyevent", "224"]), timeout=30)
    runner.run(adb_command(args, config.serial, ["shell", "wm", "dismiss-keyguard"]), timeout=30, check=False)
    runner.run(adb_command(args, config.serial, ["shell", "input", "keyevent", "82"]), timeout=30, check=False)
    rearmed = wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: bool(status.get("running")),
        description="wake rearmed after wake/unlock",
    )
    snapshots.append(wake_stage_snapshot(args, runner, config, "screen_on", screenshot_name="wake-gates-screen-on.png"))

    commands.append({
        "pucky.turn.start": wake_command(
            args,
            runner,
            config,
            "pucky.turn.start",
            {"trigger_source": "volume_up_hold", "source": "volume_up_hold"},
        )
    })
    wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: status.get("suspended_reason") == "turn_active",
        description="wake paused during manual turn",
    )
    snapshots.append(wake_stage_snapshot(args, runner, config, "turn_active", screenshot_name="wake-gates-turn-active.png"))

    commands.append({"pucky.turn.stop": wake_command(args, runner, config, "pucky.turn.stop", {"reason": "wake_lab"})})
    wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: bool(status.get("running")),
        description="wake resumed after manual turn stop",
    )
    snapshots.append(wake_stage_snapshot(args, runner, config, "turn_idle", screenshot_name="wake-gates-turn-idle.png"))

    runner.run(adb_command(args, config.serial, ["shell", "am", "force-stop", args.package_name]), timeout=30)
    time.sleep(1.0)
    runner.run(launch_command(args, config), timeout=30)
    ensure_broker_command_channel(args, runner, config, stage="wake_lab_relaunch", timeout_seconds=90)
    wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: bool(status.get("running")),
        timeout_seconds=30.0,
        description="wake running after relaunch",
    )
    snapshots.append(wake_stage_snapshot(args, runner, config, "after_relaunch", screenshot_name="wake-gates-relaunch.png"))

    commands.append({"wake.stop.final": wake_command(args, runner, config, "wake.stop", {})})
    stopped = wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: not bool(status.get("running")) and not bool(status.get("requested_enabled")),
        description="wake stopped at end of gates scenario",
    )
    snapshots.append(wake_stage_snapshot(args, runner, config, "final_stop", screenshot_name="wake-gates-final-stop.png"))

    return {
        "scenario": "gates",
        "snapshots": snapshots,
        "commands": commands,
        "checks": {
            "armed_running": bool(armed.get("running")),
            "armed_appops_running": appops_indicates_running(snapshots[1]["appops_record_audio"]),
            "screen_off_blocked": blocked.get("suspended_reason") == "device_not_interactive",
            "screen_on_rearmed": bool(rearmed.get("running")),
            "relaunch_rearmed": bool(snapshots[-2]["wake_status"].get("running")),
            "final_stop_requested_disabled": not bool(stopped.get("requested_enabled")),
        },
    }


def wake_lab_simulated_transcripts(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    cases = [
        {"label": "hey-pucky-partial", "payload": {"event": "partial", "transcript": "Hey Pucky what is this"}, "accepted": True, "matched": "hey pucky"},
        {"label": "pucky-final", "payload": {"event": "final", "transcript": "Pucky"}, "accepted": True, "matched": "pucky"},
        {"label": "hey-bucky-partial", "payload": {"event": "partial", "transcript": "Hey Bucky can you hear me"}, "accepted": True, "matched": "hey bucky"},
        {"label": "hey-pookie-final", "payload": {"event": "final", "transcript": "Hey Pookie"}, "accepted": True, "matched": "hey pookie"},
        {"label": "hey-pocky-final", "payload": {"event": "final", "transcript": "Hey Pocky"}, "accepted": True, "matched": "hey pocky"},
        {"label": "hey-pupp-partial", "payload": {"event": "partial", "transcript": "Hey Pupp test"}, "accepted": True, "matched": "hey pucky"},
        {"label": "pucky-test-final", "payload": {"event": "final", "transcript": "Pucky test 123"}, "accepted": True, "matched": "pucky"},
        {"label": "alternative-hit", "payload": {"event": "partial", "transcript": "noise", "alternatives": ["Hey Pucky"]}, "accepted": True, "matched": "hey pucky"},
        {"label": "parking-negative", "payload": {"event": "final", "transcript": "Parking"}, "accepted": False, "matched": ""},
        {"label": "hear-me-negative", "payload": {"event": "final", "transcript": "Can you hear me at all"}, "accepted": False, "matched": ""},
        {"label": "lucky-day-negative", "payload": {"event": "final", "transcript": "Lucky day"}, "accepted": False, "matched": ""},
        {"label": "puppet-show-negative", "payload": {"event": "final", "transcript": "Puppet show"}, "accepted": False, "matched": ""},
    ]
    commands: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []

    wake_command(args, runner, config, "wake.stop", {})
    wake_command(args, runner, config, "wake.config.set", {"enabled": True, "recognizer_mode": "fake"})
    wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), description="wake running before simulated transcript matrix")

    for case in cases:
        response = wake_command(args, runner, config, "wake.simulate", case["payload"])
        snapshot = wake_stage_snapshot(args, runner, config, case["label"], screenshot_name=f"wake-{case['label']}.png")
        matched = str(response.get("matched_phrase") or "")
        accepted = bool(response.get("accepted"))
        result = {
            "label": case["label"],
            "response": response,
            "snapshot": snapshot,
            "accepted": accepted,
            "matched_phrase": matched,
            "expected_accepted": case["accepted"],
            "expected_matched": case["matched"],
            "turn_idle": str(snapshot["turn_status"].get("state", "idle")) == "idle",
        }
        results.append(result)
        commands.append({case["label"]: response})
        if case["accepted"]:
            wait_for_wake_status(
                args,
                runner,
                config,
                lambda status: bool(status.get("running")),
                timeout_seconds=8.0,
                description=f"wake rearmed after {case['label']}",
            )

    return {
        "scenario": "simulated-transcripts",
        "commands": commands,
        "results": results,
        "all_passed": all(
            item["accepted"] == item["expected_accepted"]
            and item["matched_phrase"] == item["expected_matched"]
            and item["turn_idle"]
            for item in results
        ),
    }


def wake_lab_restart_regression(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    errors = ["ERROR_NO_MATCH", "ERROR_SPEECH_TIMEOUT", "ERROR_TOO_MANY_REQUESTS", "ERROR_CLIENT"]
    results: list[dict[str, Any]] = []

    wake_command(args, runner, config, "wake.stop", {})
    wake_command(args, runner, config, "wake.config.set", {"enabled": True, "recognizer_mode": "fake"})
    wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), description="wake running before restart regression")

    for error_code in errors:
        response = wake_command(
            args,
            runner,
            config,
            "wake.simulate",
            {"event": "error", "error_code": error_code, "error_message": f"Simulated {error_code}"},
        )
        rearmed = wait_for_wake_status(
            args,
            runner,
            config,
            lambda status: bool(status.get("running")),
            timeout_seconds=8.0,
            description=f"wake rearmed after {error_code}",
        )
        results.append({
            "error_code": error_code,
            "response": response,
            "rearmed_status": rearmed,
            "restart_count": rearmed.get("restart_count"),
            "last_restart_reason": rearmed.get("last_restart_reason"),
        })

    double_start_first = wake_command(args, runner, config, "wake.start", {})
    double_start_second = wake_command(args, runner, config, "wake.start", {})
    first_stop = wake_command(args, runner, config, "wake.stop", {})
    second_stop = wake_command(args, runner, config, "wake.stop", {})
    wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: not bool(status.get("running")) and not bool(status.get("requested_enabled")),
        description="wake disabled after repeated stop",
    )

    wake_command(args, runner, config, "wake.start", {})
    wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), description="wake rerunning before turn pause test")
    wake_command(args, runner, config, "pucky.turn.start", {"trigger_source": "volume_up_hold", "source": "volume_up_hold"})
    turn_blocked = wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: status.get("suspended_reason") == "turn_active",
        description="wake blocked during manual turn in restart regression",
    )
    wake_command(args, runner, config, "pucky.turn.stop", {"reason": "wake_lab"})
    wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), description="wake resumed after manual turn in restart regression")

    runner.run(adb_command(args, config.serial, ["shell", "am", "force-stop", args.package_name]), timeout=30)
    time.sleep(1.0)
    runner.run(launch_command(args, config), timeout=30)
    ensure_broker_command_channel(args, runner, config, stage="wake_lab_restart_relaunch", timeout_seconds=90)
    relaunch = wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: bool(status.get("running")),
        timeout_seconds=30.0,
        description="wake running after relaunch in restart regression",
    )

    return {
        "scenario": "restart-regression",
        "error_results": results,
        "double_start_first": double_start_first,
        "double_start_second": double_start_second,
        "double_stop_first": first_stop,
        "double_stop_second": second_stop,
        "turn_blocked": turn_blocked,
        "relaunch_status": relaunch,
        "all_passed": all(
            isinstance(item.get("restart_count"), (int, float)) and item.get("restart_count", 0) >= 1
            for item in results
        ) and turn_blocked.get("suspended_reason") == "turn_active" and bool(relaunch.get("running")),
    }


def wake_lab_wake_handoff_local(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    fixtures = prepare_turn_fixtures(config)
    pushed = [push_turn_fixture(args, runner, config, fixtures["wake_flashlight"], "wake_flashlight")]
    fake_turn = FakeTurnEndpoint(
        FakeTurnEndpointConfig(
            response_text="This local path should never upload.",
            summary="flashlight",
            response_delay_seconds=0.2,
        )
    )
    fake_turn.start()
    try:
        runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=fake_turn, reply_mode="card_only")
        armed = arm_wake_turn_lab(
            args,
            runner,
            config,
            fixture_name="wake_flashlight",
            debug_fixture_transcript="flashlight",
            fixture_start_delay_ms=WAKE_TURN_FIXTURE_START_DELAY_MS,
        )
        wake_stage_snapshot(args, runner, config, "wake_handoff_local_armed", screenshot_name="wake-handoff-local-armed.png")
        simulate = wake_command(args, runner, config, "wake.simulate", {"event": "final", "transcript": "Hey Pucky"})
        blue = wait_for_turn_visual(
            args,
            runner,
            config,
            "armed",
            timeout_seconds=6.0,
            description="wake-started turn blue/armed state for local recipe",
        )
        blue_snapshot = wake_stage_snapshot(args, runner, config, "wake_handoff_local_blue", screenshot_name="wake-handoff-local-blue.png")
        red = wait_for_turn_visual(
            args,
            runner,
            config,
            "recording",
            timeout_seconds=6.0,
            description="wake-started turn red/recording state for local recipe",
        )
        red_snapshot = wake_stage_snapshot(args, runner, config, "wake_handoff_local_red", screenshot_name="wake-handoff-local-red.png")
        yellow = wait_for_turn_visual(
            args,
            runner,
            config,
            "uploading",
            timeout_seconds=6.0,
            sleep_seconds=0.05,
            description="wake-started turn yellow/uploading state for local recipe",
        )
        yellow_snapshot = wake_stage_snapshot(args, runner, config, "wake_handoff_local_yellow", screenshot_name="wake-handoff-local-yellow.png")
        completed = wait_for_turn_status(
            args,
            runner,
            config,
            lambda status: str((status.get("last_status") or {}).get("state") or "") == "completed",
            timeout_seconds=10.0,
            sleep_seconds=0.1,
            description="local recipe turn completion",
        )
        rearmed = wait_for_wake_status(
            args,
            runner,
            config,
            lambda status: bool(status.get("running")) and str(status.get("phase") or "") == "wake_armed",
            timeout_seconds=10.0,
            sleep_seconds=0.1,
            description="wake rearmed after local recipe handoff",
        )
        final_snapshot = wake_stage_snapshot(args, runner, config, "wake_handoff_local_final", screenshot_name="wake-handoff-local-final.png")
        turn_id = scenario_turn_id(final_snapshot) or scenario_turn_id(yellow_snapshot) or scenario_turn_id(red_snapshot)
        turn_read_payload = turn_read(args, runner, config, turn_id) if turn_id else {}
        history = turn_history(args, runner, config)
        server_snapshot = fake_turn.snapshot()
        latest = completed.get("last_status") if isinstance(completed.get("last_status"), dict) else {}
        return {
            "scenario": "wake-handoff-local",
            "runtime": runtime,
            "fixtures": pushed,
            "simulate": simulate,
            "snapshots": {
                "blue": blue_snapshot,
                "red": red_snapshot,
                "yellow": yellow_snapshot,
                "final": final_snapshot,
            },
            "turn_statuses": {
                "armed": armed,
                "blue": blue,
                "red": red,
                "yellow": yellow,
                "completed": completed,
                "rearmed": rearmed,
            },
            "turn_read": turn_read_payload,
            "turn_history": history,
            "fake_turn_endpoint": server_snapshot,
            "all_passed": (
                simulate.get("accepted") is True
                and turn_visual_state(blue) == "armed"
                and turn_visual_state(red) == "recording"
                and turn_visual_state(yellow) == "uploading"
                and str(latest.get("phase") or "") == "local_keyword_handled"
                and bool(latest.get("local_recipe_matched"))
                and len(server_snapshot["requests"]) == 0
                and bool(rearmed.get("running"))
            ),
        }
    finally:
        fake_turn.stop()


def wake_lab_wake_handoff_upload(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    fixtures = prepare_turn_fixtures(config)
    pushed = [push_turn_fixture(args, runner, config, fixtures["wake_weather"], "wake_weather")]
    fake_turn = FakeTurnEndpoint(
        FakeTurnEndpointConfig(
            response_text="Weather is clear and traffic is light.",
            summary="weather request",
            response_delay_seconds=1.0,
            remote_stage="stt_running",
        )
    )
    fake_turn.start()
    try:
        runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=fake_turn, reply_mode="card_only")
        armed = arm_wake_turn_lab(
            args,
            runner,
            config,
            fixture_name="wake_weather",
            debug_fixture_transcript="what's the weather today",
            fixture_start_delay_ms=WAKE_TURN_FIXTURE_START_DELAY_MS,
        )
        simulate = wake_command(args, runner, config, "wake.simulate", {"event": "final", "transcript": "Hey Pucky"})
        blue = wait_for_turn_visual(
            args,
            runner,
            config,
            "armed",
            timeout_seconds=6.0,
            description="wake-started turn blue/armed state for upload path",
        )
        blue_snapshot = wake_stage_snapshot(args, runner, config, "wake_handoff_upload_blue", screenshot_name="wake-handoff-upload-blue.png")
        red = wait_for_turn_visual(
            args,
            runner,
            config,
            "recording",
            timeout_seconds=6.0,
            description="wake-started turn red/recording state for upload path",
        )
        red_snapshot = wake_stage_snapshot(args, runner, config, "wake_handoff_upload_red", screenshot_name="wake-handoff-upload-red.png")
        yellow = wait_for_turn_visual(
            args,
            runner,
            config,
            "uploading",
            timeout_seconds=8.0,
            sleep_seconds=0.05,
            description="wake-started turn yellow/uploading state for upload path",
        )
        yellow_snapshot = wake_stage_snapshot(args, runner, config, "wake_handoff_upload_yellow", screenshot_name="wake-handoff-upload-yellow.png")
        completed = wait_for_turn_status(
            args,
            runner,
            config,
            lambda status: str((status.get("last_status") or {}).get("state") or "") == "completed",
            timeout_seconds=12.0,
            sleep_seconds=0.1,
            description="uploaded wake-started turn completion",
        )
        rearmed = wait_for_wake_status(
            args,
            runner,
            config,
            lambda status: bool(status.get("running")) and str(status.get("phase") or "") == "wake_armed",
            timeout_seconds=12.0,
            sleep_seconds=0.1,
            description="wake rearmed after uploaded wake-started turn",
        )
        final_snapshot = wake_stage_snapshot(args, runner, config, "wake_handoff_upload_final", screenshot_name="wake-handoff-upload-final.png")
        turn_id = scenario_turn_id(final_snapshot) or scenario_turn_id(yellow_snapshot)
        turn_read_payload = turn_read(args, runner, config, turn_id) if turn_id else {}
        history = turn_history(args, runner, config)
        server_snapshot = fake_turn.snapshot()
        latest = completed.get("last_status") if isinstance(completed.get("last_status"), dict) else {}
        first_request = server_snapshot["requests"][0] if server_snapshot["requests"] else {}
        return {
            "scenario": "wake-handoff-upload",
            "runtime": runtime,
            "fixtures": pushed,
            "simulate": simulate,
            "snapshots": {
                "blue": blue_snapshot,
                "red": red_snapshot,
                "yellow": yellow_snapshot,
                "final": final_snapshot,
            },
            "turn_statuses": {
                "armed": armed,
                "blue": blue,
                "red": red,
                "yellow": yellow,
                "completed": completed,
                "rearmed": rearmed,
            },
            "turn_read": turn_read_payload,
            "turn_history": history,
            "fake_turn_endpoint": server_snapshot,
            "all_passed": (
                simulate.get("accepted") is True
                and turn_visual_state(blue) == "armed"
                and turn_visual_state(red) == "recording"
                and turn_visual_state(yellow) == "uploading"
                and len(server_snapshot["requests"]) == 1
                and first_request.get("body_bytes", 0) > 0
                and str(latest.get("state") or "") == "completed"
                and not bool(latest.get("local_recipe_matched"))
                and bool(rearmed.get("running"))
            ),
        }
    finally:
        fake_turn.stop()


def wake_lab_wake_no_speech_timeout(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    fixtures = prepare_turn_fixtures(config)
    pushed = [push_turn_fixture(args, runner, config, fixtures["wake_silence"], "wake_silence")]
    fake_turn = FakeTurnEndpoint(
        FakeTurnEndpointConfig(
            response_text="No speech should have uploaded.",
            summary="silence",
            response_delay_seconds=0.2,
        )
    )
    fake_turn.start()
    try:
        runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=fake_turn, reply_mode="card_only")
        armed = arm_wake_turn_lab(
            args,
            runner,
            config,
            fixture_name="wake_silence",
            debug_fixture_transcript="",
            fixture_start_delay_ms=WAKE_TURN_FIXTURE_START_DELAY_MS,
        )
        simulate = wake_command(args, runner, config, "wake.simulate", {"event": "final", "transcript": "Hey Pucky"})
        blue = wait_for_turn_visual(
            args,
            runner,
            config,
            "armed",
            timeout_seconds=6.0,
            description="wake-started turn blue/armed state for no-speech timeout",
        )
        blue_snapshot = wake_stage_snapshot(args, runner, config, "wake_no_speech_blue", screenshot_name="wake-no-speech-blue.png")
        discarded = wait_for_turn_status(
            args,
            runner,
            config,
            lambda status: str((status.get("last_status") or {}).get("state") or "") == "discarded_silence",
            timeout_seconds=8.0,
            sleep_seconds=0.1,
            description="wake-started turn no-speech timeout",
        )
        rearmed = wait_for_wake_status(
            args,
            runner,
            config,
            lambda status: bool(status.get("running")) and str(status.get("phase") or "") == "wake_armed",
            timeout_seconds=10.0,
            sleep_seconds=0.1,
            description="wake rearmed after no-speech timeout",
        )
        final_snapshot = wake_stage_snapshot(args, runner, config, "wake_no_speech_final", screenshot_name="wake-no-speech-final.png")
        server_snapshot = fake_turn.snapshot()
        latest = discarded.get("last_status") if isinstance(discarded.get("last_status"), dict) else {}
        return {
            "scenario": "wake-no-speech-timeout",
            "runtime": runtime,
            "fixtures": pushed,
            "simulate": simulate,
            "snapshots": {
                "blue": blue_snapshot,
                "final": final_snapshot,
            },
            "turn_statuses": {
                "armed": armed,
                "blue": blue,
                "discarded": discarded,
                "rearmed": rearmed,
            },
            "fake_turn_endpoint": server_snapshot,
            "all_passed": (
                simulate.get("accepted") is True
                and turn_visual_state(blue) == "armed"
                and str(latest.get("state") or "") == "discarded_silence"
                and "failure_chime" in latest
                and len(server_snapshot["requests"]) == 0
                and bool(rearmed.get("running"))
            ),
        }
    finally:
        fake_turn.stop()


def wake_lab_wake_negative(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    wake_command(args, runner, config, "wake.stop", {})
    wake_command(
        args,
        runner,
        config,
        "wake.config.set",
        {"enabled": True, "recognizer_mode": "fake", "capture_source": "", "fixture_name": "", "debug_fixture_transcript": ""},
    )
    armed = wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), description="wake armed before negative scenario")
    response = wake_command(args, runner, config, "wake.simulate", {"event": "final", "transcript": "Parking"})
    idle_turn = wait_for_turn_status(
        args,
        runner,
        config,
        lambda status: str(status.get("state") or "idle") == "idle" or str((status.get("indicator") or {}).get("visual_state") or "idle") == "idle",
        timeout_seconds=4.0,
        sleep_seconds=0.1,
        description="turn remained idle after non-wake transcript",
    )
    wake_running = wait_for_wake_status(
        args,
        runner,
        config,
        lambda status: bool(status.get("running")) and str(status.get("phase") or "") == "wake_armed",
        timeout_seconds=6.0,
        sleep_seconds=0.1,
        description="wake stayed armed after negative transcript",
    )
    snapshot = wake_stage_snapshot(args, runner, config, "wake_negative_final", screenshot_name="wake-negative-final.png")
    return {
        "scenario": "wake-negative",
        "armed": armed,
        "response": response,
        "idle_turn": idle_turn,
        "wake_running": wake_running,
        "snapshot": snapshot,
        "all_passed": response.get("accepted") is False and turn_visual_state(idle_turn) == "idle" and bool(wake_running.get("running")),
    }


def wake_lab_wake_pause_on_reply(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    fixtures = prepare_turn_fixtures(config)
    pushed = [push_turn_fixture(args, runner, config, fixtures["wake_weather"], "wake_weather")]
    fake_turn = FakeTurnEndpoint(
        FakeTurnEndpointConfig(
            response_text="I found the weather and queued a spoken reply.",
            summary="spoken weather reply",
            response_delay_seconds=1.0,
            remote_stage="tts_running",
            with_audio=True,
            audio_duration_ms=2500,
        )
    )
    fake_turn.start()
    try:
        runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=fake_turn, reply_mode="card_and_spoken")
        armed = arm_wake_turn_lab(
            args,
            runner,
            config,
            fixture_name="wake_weather",
            debug_fixture_transcript="tell me the weather",
            fixture_start_delay_ms=WAKE_TURN_FIXTURE_START_DELAY_MS,
        )
        simulate = wake_command(args, runner, config, "wake.simulate", {"event": "final", "transcript": "Hey Pucky"})
        blue = wait_for_turn_visual(
            args,
            runner,
            config,
            "armed",
            timeout_seconds=6.0,
            description="wake-started turn blue/armed state for spoken reply",
        )
        blue_snapshot = wake_stage_snapshot(args, runner, config, "wake_pause_reply_blue", screenshot_name="wake-pause-reply-blue.png")
        red = wait_for_turn_visual(
            args,
            runner,
            config,
            "recording",
            timeout_seconds=6.0,
            description="wake-started turn red/recording state for spoken reply",
        )
        red_snapshot = wake_stage_snapshot(args, runner, config, "wake_pause_reply_red", screenshot_name="wake-pause-reply-red.png")
        yellow = wait_for_turn_visual(
            args,
            runner,
            config,
            "uploading",
            timeout_seconds=8.0,
            sleep_seconds=0.05,
            description="wake-started turn yellow/uploading state for spoken reply",
        )
        yellow_snapshot = wake_stage_snapshot(args, runner, config, "wake_pause_reply_yellow", screenshot_name="wake-pause-reply-yellow.png")
        speaking = wait_for_turn_visual(
            args,
            runner,
            config,
            "speaking",
            timeout_seconds=12.0,
            sleep_seconds=0.1,
            description="spoken reply playback state",
        )
        speaking_snapshot = wake_stage_snapshot(args, runner, config, "wake_pause_reply_speaking", screenshot_name="wake-pause-reply-speaking.png")
        wake_paused = wait_for_wake_status(
            args,
            runner,
            config,
            lambda status: not bool(status.get("running")) and str(status.get("phase") or "") == "turn_paused",
            timeout_seconds=6.0,
            sleep_seconds=0.1,
            description="wake paused while spoken reply is active",
        )
        rearmed = wait_for_wake_status(
            args,
            runner,
            config,
            lambda status: bool(status.get("running")) and str(status.get("phase") or "") == "wake_armed",
            timeout_seconds=20.0,
            sleep_seconds=0.2,
            description="wake rearmed after spoken reply completed",
        )
        final_snapshot = wake_stage_snapshot(args, runner, config, "wake_pause_reply_final", screenshot_name="wake-pause-reply-final.png")
        turn_id = scenario_turn_id(final_snapshot) or scenario_turn_id(yellow_snapshot)
        turn_read_payload = turn_read(args, runner, config, turn_id) if turn_id else {}
        server_snapshot = fake_turn.snapshot()
        return {
            "scenario": "wake-pause-on-reply",
            "runtime": runtime,
            "fixtures": pushed,
            "simulate": simulate,
            "snapshots": {
                "blue": blue_snapshot,
                "red": red_snapshot,
                "yellow": yellow_snapshot,
                "speaking": speaking_snapshot,
                "final": final_snapshot,
            },
            "turn_statuses": {
                "armed": armed,
                "blue": blue,
                "red": red,
                "yellow": yellow,
                "speaking": speaking,
                "wake_paused": wake_paused,
                "rearmed": rearmed,
            },
            "turn_read": turn_read_payload,
            "fake_turn_endpoint": server_snapshot,
            "all_passed": (
                simulate.get("accepted") is True
                and turn_visual_state(blue) == "armed"
                and turn_visual_state(red) == "recording"
                and turn_visual_state(yellow) == "uploading"
                and turn_visual_state(speaking) == "speaking"
                and len(server_snapshot["requests"]) == 1
                and not bool(wake_paused.get("running"))
                and bool(rearmed.get("running"))
            ),
        }
    finally:
        fake_turn.stop()


def wake_lab_manual_regression(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    fixtures = prepare_turn_fixtures(config)
    pushed = [push_turn_fixture(args, runner, config, fixtures["manual_flashlight"], "manual_flashlight")]
    fake_turn = FakeTurnEndpoint(
        FakeTurnEndpointConfig(
            response_text="Manual flashlight path should stay local.",
            summary="flashlight",
            response_delay_seconds=0.2,
        )
    )
    fake_turn.start()
    try:
        runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=fake_turn, reply_mode="card_only")
        armed = arm_wake_turn_lab(args, runner, config)
        start = wake_command(
            args,
            runner,
            config,
            "pucky.turn.start",
            {
                "trigger_source": "volume_up_hold",
                "source": "volume_up_hold",
                "capture_source": "fixture",
                "fixture_name": "manual_flashlight",
                "fixture_start_delay_ms": WAKE_TURN_FIXTURE_START_DELAY_MS,
                "debug_fixture_transcript": "flashlight",
            },
        )
        paused = wait_for_wake_status(
            args,
            runner,
            config,
            lambda status: str(status.get("suspended_reason") or "") == "turn_active" or str(status.get("phase") or "") == "turn_paused",
            timeout_seconds=6.0,
            sleep_seconds=0.1,
            description="wake paused during manual fixture-backed turn",
        )
        recording = wait_for_turn_visual(
            args,
            runner,
            config,
            "recording",
            timeout_seconds=6.0,
            description="manual turn reached recording state",
        )
        recording_snapshot = wake_stage_snapshot(args, runner, config, "manual_regression_recording", screenshot_name="wake-manual-regression-recording.png")
        stop = wake_command(args, runner, config, "pucky.turn.stop", {"reason": "wake_lab_manual"})
        completed = wait_for_turn_status(
            args,
            runner,
            config,
            lambda status: str((status.get("last_status") or {}).get("state") or "") == "completed",
            timeout_seconds=10.0,
            sleep_seconds=0.1,
            description="manual fixture-backed turn completion",
        )
        rearmed = wait_for_wake_status(
            args,
            runner,
            config,
            lambda status: bool(status.get("running")) and str(status.get("phase") or "") == "wake_armed",
            timeout_seconds=10.0,
            sleep_seconds=0.1,
            description="wake rearmed after manual turn regression",
        )
        final_snapshot = wake_stage_snapshot(args, runner, config, "manual_regression_final", screenshot_name="wake-manual-regression-final.png")
        server_snapshot = fake_turn.snapshot()
        latest = completed.get("last_status") if isinstance(completed.get("last_status"), dict) else {}
        return {
            "scenario": "manual-regression",
            "runtime": runtime,
            "fixtures": pushed,
            "start": start,
            "stop": stop,
            "snapshots": {
                "recording": recording_snapshot,
                "final": final_snapshot,
            },
            "turn_statuses": {
                "armed": armed,
                "paused": paused,
                "recording": recording,
                "completed": completed,
                "rearmed": rearmed,
            },
            "fake_turn_endpoint": server_snapshot,
            "all_passed": (
                turn_visual_state(recording) == "recording"
                and str(latest.get("phase") or "") == "local_keyword_handled"
                and bool(latest.get("local_recipe_matched"))
                and len(server_snapshot["requests"]) == 0
                and bool(rearmed.get("running"))
            ),
        }
    finally:
        fake_turn.stop()


def wake_lab_host_audio_smoke(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    wake_command(args, runner, config, "wake.stop", {})
    wake_command(args, runner, config, "wake.config.set", {"enabled": True, "recognizer_mode": "android"})
    armed = wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), description="wake armed before host audio smoke")
    before = wake_stage_snapshot(args, runner, config, "host_audio_before", screenshot_name="wake-host-before.png")
    time.sleep(8.0 if not runner.dry_run else 0.0)
    after = wake_stage_snapshot(args, runner, config, "host_audio_after", screenshot_name="wake-host-after.png")
    return {
        "scenario": "host-audio-smoke",
        "armed_status": armed,
        "before": before,
        "after": after,
        "note": "Evidence-only live recognizer smoke. Use emulator start --audio-mode host or wav-in for meaningful audio input.",
    }


def cmd_wake_lab(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    if args.slot != 2:
        raise SuiteError("wake-lab is reserved for slot 2")
    require_emulator_serial(config.serial)
    if not serial_is_connected(args, runner, config.serial):
        raise SuiteError(f"Emulator is not connected: {config.serial}")
    Path(config.evidence_dir).mkdir(parents=True, exist_ok=True)
    ensure_broker_command_channel(args, runner, config, stage="wake_lab_start", timeout_seconds=90)
    runner.run(launch_home_command(args, config), timeout=30)
    runner.run(adb_command(args, config.serial, ["logcat", "-c"]), timeout=30, check=False)

    preflight = {
        "broker_device": broker_device_snapshot(config),
        "bundle_status": command_result(command_json(runner, puckyctl_command(args, config, "ui.bundle.status", {}), timeout=60)),
        "wake_status": wake_status(args, runner, config),
    }

    if args.scenario == "gates":
        scenario_result = wake_lab_gates(args, runner, config)
    elif args.scenario == "simulated-transcripts":
        scenario_result = wake_lab_simulated_transcripts(args, runner, config)
    elif args.scenario == "restart-regression":
        scenario_result = wake_lab_restart_regression(args, runner, config)
    elif args.scenario == "wake-handoff-local":
        scenario_result = wake_lab_wake_handoff_local(args, runner, config)
    elif args.scenario == "wake-handoff-upload":
        scenario_result = wake_lab_wake_handoff_upload(args, runner, config)
    elif args.scenario == "wake-no-speech-timeout":
        scenario_result = wake_lab_wake_no_speech_timeout(args, runner, config)
    elif args.scenario == "wake-negative":
        scenario_result = wake_lab_wake_negative(args, runner, config)
    elif args.scenario == "wake-pause-on-reply":
        scenario_result = wake_lab_wake_pause_on_reply(args, runner, config)
    elif args.scenario == "manual-regression":
        scenario_result = wake_lab_manual_regression(args, runner, config)
    elif args.scenario == "host-audio-smoke":
        scenario_result = wake_lab_host_audio_smoke(args, runner, config)
    else:
        raise SuiteError(f"Unsupported wake-lab scenario: {args.scenario}")

    final_snapshot = wake_stage_snapshot(args, runner, config, "final", screenshot_name=f"wake-{args.scenario}-final.png")
    logcat_text = filtered_logcat(args, runner, config)
    evidence = {
        "schema": "pucky.emulator_wake_lab.v1",
        "scenario": args.scenario,
        "preflight": preflight,
        "result": scenario_result,
        "final_snapshot": final_snapshot,
        "logcat": logcat_text,
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }
    evidence_path = write_evidence(config, f"wake-lab-{args.scenario}.json", evidence)
    return {
        "schema": "pucky.emulator_wake_lab_result.v1",
        "ok": True,
        "config": asdict(config),
        "scenario": args.scenario,
        "evidence_path": str(evidence_path),
        "result": scenario_result,
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }


def cmd_stop(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    state = load_state(ROOT, args.slot)
    killed: list[int] = []
    for pid in (state.get("pids") or {}).values():
        if isinstance(pid, int) and pid > 0:
            if args.dry_run:
                killed.append(pid)
            else:
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, text=True)
                killed.append(pid)
    if serial_is_connected(args, runner, config.serial):
        runner.run(adb_command(args, config.serial, ["emu", "kill"]), check=False, timeout=30)
    return {"ok": True, "config": asdict(config), "killed": killed, "commands": runner.planned, "dry_run": args.dry_run}


def cmd_clean(args: argparse.Namespace) -> dict[str, Any]:
    stopped = cmd_stop(args)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    avd_root = Path(config.avd_home)
    targets = [
        Path(config.run_dir),
        Path(config.state_path),
        avd_root / f"{config.avd_name}.avd",
        avd_root / f"{config.avd_name}.ini",
    ]
    if not args.dry_run:
        for target in targets:
            assert_inside(target, ROOT / ".tmp")
            if target.is_dir():
                shutil.rmtree(target)
            elif target.exists():
                target.unlink()
    return {"ok": True, "stopped": stopped, "removed": [str(target) for target in targets], "dry_run": args.dry_run}


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--android-home", type=Path, default=DEFAULT_ANDROID_HOME)
    parser.add_argument("--java-home", type=Path, default=DEFAULT_JAVA_HOME)
    parser.add_argument("--gradle", type=Path, default=DEFAULT_GRADLE)
    parser.add_argument("--adb", type=Path, default=DEFAULT_ADB)
    parser.add_argument("--emulator", type=Path, default=DEFAULT_EMULATOR)
    parser.add_argument("--avdmanager", type=Path, default=DEFAULT_AVDMANAGER)
    parser.add_argument("--system-image", default=DEFAULT_SYSTEM_IMAGE)
    parser.add_argument("--device-profile", default=DEFAULT_DEVICE_PROFILE)
    parser.add_argument("--package-name", default=DEFAULT_PACKAGE)
    parser.add_argument("--activity-name", default=DEFAULT_ACTIVITY)
    parser.add_argument("--apk", type=Path, default=DEFAULT_APK)
    parser.add_argument("--puckyctl", type=Path, default=DEFAULT_PUCKYCTL)
    parser.add_argument("--fake-broker", type=Path, default=DEFAULT_FAKE_BROKER)
    parser.add_argument("--flyctl", type=Path, default=Path("flyctl"))
    parser.add_argument("--puckyctl-timeout-ms", type=int, default=180000)
    parser.add_argument("--dry-run", action="store_true")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Pucky emulator lab harness")
    sub = parser.add_subparsers(dest="command", required=True)
    doctor_parser = sub.add_parser("doctor")
    add_common(doctor_parser)
    for name in ("create", "start", "provision", "seed-ui", "smoke", "wake-lab", "stop", "clean", "prove-thread-origin", "prove-pending-outbound-feed"):
        item = sub.add_parser(name)
        add_common(item)
        item.add_argument("--slot", type=int, default=1)
        if name == "start":
            item.add_argument("--no-wait", action="store_true")
            item.add_argument("--audio-mode", choices=("none", "host", "wav-in"), default="none")
            item.add_argument("--audio-wav-in", type=Path, default=None)
        if name == "provision":
            item.add_argument("--skip-build", action="store_true")
        if name == "seed-ui":
            item.add_argument("--cards-json", default="")
            item.add_argument("--cards-file", type=Path)
            item.add_argument("--max-bundle-bytes", type=int, default=20 * 1024 * 1024)
        if name == "wake-lab":
            item.add_argument(
                "--scenario",
                choices=(
                    "gates",
                    "simulated-transcripts",
                    "restart-regression",
                    "wake-handoff-local",
                    "wake-handoff-upload",
                    "wake-no-speech-timeout",
                    "wake-negative",
                    "wake-pause-on-reply",
                    "manual-regression",
                    "host-audio-smoke",
                ),
                required=True,
            )
        if name == "prove-thread-origin":
            item.add_argument("--turn-url", default=os.environ.get("PUCKY_TURN_URL", DEFAULT_TURN_URL))
            item.add_argument("--turn-token", default=os.environ.get("PUCKY_API_TOKEN", ""))
            item.add_argument("--sample-audio", type=Path, default=ROOT / "pucky_vm" / "ui_src" / "fixtures" / "artifacts" / "morning.wav")
            item.add_argument("--vm-base-url", default="https://pucky.fly.dev")
            item.add_argument("--operator-token", default=os.environ.get("PUCKY_OPERATOR_TOKEN", ""))
            item.add_argument("--fly-app", default="pucky")
            item.add_argument("--vm-codex-home", default="/data/home/codex")
            item.add_argument("--turn-timeout-seconds", type=int, default=180)
            item.add_argument("--vm-query-timeout-seconds", type=int, default=90)
            item.add_argument("--refresh-timeout-seconds", type=int, default=180)
            item.add_argument("--ui-dwell-seconds", type=float, default=1.0)
            item.add_argument("--open-card-tap", default="528,230")
            item.add_argument("--gear-tap", default="930,312")
            item.add_argument("--skip-refresh", action="store_true")
        if name == "prove-pending-outbound-feed":
            item.add_argument("--vm-base-url", default="https://pucky.fly.dev")
            item.add_argument("--operator-token", default=os.environ.get("PUCKY_OPERATOR_TOKEN", ""))
            item.add_argument("--refresh-timeout-seconds", type=int, default=180)
            item.add_argument("--ui-dwell-seconds", type=float, default=1.0)
            item.add_argument("--failed-card-tap", default="528,230")
            item.add_argument("--long-press-ms", type=int, default=360)
            item.add_argument("--skip-refresh", action="store_true")
    return parser


def dispatch(args: argparse.Namespace) -> dict[str, Any]:
    if args.command == "doctor":
        return doctor(args)
    if args.command == "create":
        return cmd_create(args)
    if args.command == "start":
        return cmd_start(args)
    if args.command == "provision":
        return cmd_provision(args)
    if args.command == "seed-ui":
        return cmd_seed_ui(args)
    if args.command == "smoke":
        return cmd_smoke(args)
    if args.command == "wake-lab":
        return cmd_wake_lab(args)
    if args.command == "stop":
        return cmd_stop(args)
    if args.command == "clean":
        return cmd_clean(args)
    if args.command == "prove-thread-origin":
        return cmd_prove_thread_origin(args)
    if args.command == "prove-pending-outbound-feed":
        return cmd_prove_pending_outbound_feed(args)
    raise SuiteError(f"Unknown command: {args.command}")


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = dispatch(args)
    except SuiteError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
