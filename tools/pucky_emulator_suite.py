from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import mimetypes
import os
import re
import shlex
import shutil
import socket
import subprocess
import sys
import time
import textwrap
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.attachment_manifest import normalize_attachments

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
DEFAULT_USERDATA_PARTITION_MB = "2047"
DEFAULT_USERDATA_PARTITION_SIZE = DEFAULT_USERDATA_PARTITION_MB + "M"
DEFAULT_APK = ROOT / "pucky-apk" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
DEFAULT_PUCKYCTL = ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py"
DEFAULT_FAKE_BROKER = ROOT / "pucky-apk" / "fake-broker"
DEFAULT_TURN_URL = "https://pucky.fly.dev/api/turn"
DEFAULT_RECIPE_BUNDLE = ROOT / "pucky_vm" / "recipes" / "volume_down_lab_dev_bundle.json"
BASE_DIR = ROOT / ".tmp" / "pucky-emulator"
RUNS_DIR = ROOT / ".tmp" / "pucky-emulator-runs"
MIN_RECOMMENDED_AVD_FREE_GB = 8.0
INSTALL_SERVICES_SETTLE_SECONDS = 45.0
DISPLAYABLE_VIEWER_TYPES = {"html_iframe", "table", "text", "image_gallery", "video_player", "audio_player", "document_html"}
NODE_BOUNDS_RE = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
WAKE_TURN_FIXTURE_START_DELAY_MS = 1200


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


@dataclass
class FakeTurnEndpointConfig:
    response_text: str
    summary: str = ""
    response_delay_seconds: float = 0.0
    audio_duration_ms: int = 0


class FakeTurnEndpoint:
    def __init__(self, config: FakeTurnEndpointConfig) -> None:
        self.config = config
        self.requests: list[dict[str, Any]] = []
        self._server: HTTPServer | None = None
        self._thread: threading.Thread | None = None
        self.base_url = ""

    def start(self) -> None:
        if self._server is not None:
            return
        parent = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length", "0") or "0")
                body = self.rfile.read(length)
                headers = {key: value for key, value in self.headers.items()}
                turn_id = headers.get("X-Pucky-Turn-Id", "")
                parent.requests.append({
                    "path": self.path,
                    "headers": headers,
                    "body_bytes": len(body),
                    "body_sha256": hashlib.sha256(body).hexdigest(),
                })
                if parent.config.response_delay_seconds > 0:
                    time.sleep(parent.config.response_delay_seconds)
                payload = {
                    "turn_id": turn_id,
                    "session_id": turn_id,
                    "card_id": f"reply_{turn_id}" if turn_id else f"reply_{uuid.uuid4().hex[:8]}",
                    "text": parent.config.response_text,
                    "summary": parent.config.summary or parent.config.response_text,
                    "title": "Wake turn reply",
                    "icon": "bolt",
                }
                if parent.config.audio_duration_ms > 0:
                    payload["audio_mime_type"] = "audio/wav"
                    payload["audio_base64"] = response_audio_base64(parent.config.audio_duration_ms)
                raw = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
                return

        server = HTTPServer(("127.0.0.1", 0), Handler)
        self._server = server
        self.base_url = f"http://127.0.0.1:{server.server_port}/api/turn"
        self._thread = threading.Thread(target=server.serve_forever, name="fake-turn-endpoint", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server is None:
            return
        self._server.shutdown()
        self._server.server_close()
        self._server = None
        self.base_url = ""
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None


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


def wav_bytes(duration_ms: int, *, sample_rate: int = 16000, amplitude: int = 10000, frequency_hz: float = 440.0, silence: bool = False) -> bytes:
    frames = max(1, int(sample_rate * max(0, duration_ms) / 1000))
    raw = BytesIO()
    with wave.open(raw, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for index in range(frames):
            if silence:
                sample = 0
            else:
                phase = (index / sample_rate) * frequency_hz * 2.0 * math.pi
                sample = int(amplitude * math.sin(phase))
            wav_file.writeframesraw(int(sample).to_bytes(2, byteorder="little", signed=True))
    return raw.getvalue()


def response_audio_base64(duration_ms: int) -> str:
    return base64.b64encode(wav_bytes(duration_ms)).decode("ascii")


def synthesize_speech_wav(path: Path, text: str) -> bool:
    if os.name != "nt":
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    escaped_path = str(path).replace("'", "''")
    escaped_text = text.replace("'", "''")
    script = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$s.Volume = 100; "
        "$s.Rate = 0; "
        f"$s.SetOutputToWaveFile('{escaped_path}'); "
        f"$s.Speak('{escaped_text}'); "
        "$s.Dispose()"
    )
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=120,
        check=False,
    )
    return result.returncode == 0 and path.exists() and path.stat().st_size > 44


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


def launch_provisioning_json(args: argparse.Namespace, config: SlotConfig) -> str | None:
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


def launch_command(args: argparse.Namespace, config: SlotConfig) -> list[str]:
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
    provisioning_json = launch_provisioning_json(args, config)
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


def text_turn_url(turn_url: str) -> str:
    clean = str(turn_url or "").strip()
    if clean.endswith("/api/turn"):
        return clean + "/text"
    if clean.endswith("/turn"):
        return clean + "/text"
    return clean.rstrip("/") + "/text"


def text_turn_request(turn_url: str, token: str, text: str, turn_id: str, *, reply_mode: str = "card_only") -> urllib.request.Request:
    payload = {
        "text": text,
        "turn_id": turn_id,
        "reply_mode": reply_mode,
    }
    return urllib.request.Request(
        text_turn_url(turn_url),
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Pucky-Turn-Id": turn_id,
            "X-Pucky-Reply-Mode": reply_mode,
        },
    )


def http_json_request(
    request_or_url: urllib.request.Request | str,
    *,
    timeout: int | float,
    method: str = "GET",
    token: str = "",
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    if isinstance(request_or_url, urllib.request.Request):
        request = request_or_url
    else:
        payload = None if body is None else json.dumps(body).encode("utf-8")
        merged_headers = dict(headers or {})
        if token:
            merged_headers.setdefault("Authorization", f"Bearer {token}")
        if payload is not None:
            merged_headers.setdefault("Content-Type", "application/json")
        request = urllib.request.Request(
            str(request_or_url),
            data=payload,
            method=method,
            headers=merged_headers,
        )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SuiteError(f"HTTP {exc.code} for {request.full_url}: {detail}") from exc


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


def post_live_text_turn(args: argparse.Namespace, turn_id: str, text: str) -> dict[str, Any]:
    if not args.turn_token:
        raise SuiteError("prove-displayable-reply-files requires --turn-token or PUCKY_API_TOKEN")
    request = text_turn_request(args.turn_url, args.turn_token, text, turn_id)
    return http_json_request(request, timeout=args.turn_timeout_seconds)


def feed_request(turn_url: str, token: str, *, limit: int = 25, cursor: str = "") -> dict[str, Any]:
    url = turn_url_to_feed_url(turn_url) + f"?limit={int(limit)}"
    if cursor:
        url += "&cursor=" + urllib.parse.quote(cursor, safe="")
    return http_json_request(url, timeout=60, token=token)


def wait_for_live_feed_item(args: argparse.Namespace, turn_id: str, *, timeout: float = 120.0, limit: int = 25) -> dict[str, Any]:
    if not args.turn_token:
        raise SuiteError("prove-displayable-reply-files requires --turn-token or PUCKY_API_TOKEN")
    deadline = time.monotonic() + timeout
    last_page: dict[str, Any] = {}
    while time.monotonic() < deadline:
        page = feed_request(args.turn_url, args.turn_token, limit=limit)
        last_page = page
        items = page.get("items") if isinstance(page.get("items"), list) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            if str(item.get("turn_id") or "") == turn_id:
                return item
        time.sleep(2.0)
    raise SuiteError(f"Live feed item for turn {turn_id} was not visible after {int(timeout)}s: {last_page}")


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


def dump_ui_hierarchy(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> str:
    remote_path = "/sdcard/pucky_window_dump.xml"
    runner.run(adb_command(args, config.serial, ["shell", "uiautomator", "dump", remote_path]), timeout=30, check=False)
    if runner.dry_run:
        runner.run(adb_command(args, config.serial, ["exec-out", "cat", remote_path]), timeout=30)
        return "<hierarchy rotation=\"0\"/>"
    result = runner.run(adb_command(args, config.serial, ["exec-out", "cat", remote_path]), timeout=30)
    text = result.stdout.strip()
    if "<hierarchy" not in text:
        raise SuiteError(f"Unable to capture UI hierarchy: {text or result.stderr}")
    return text


def parse_node_bounds(bounds: str) -> tuple[int, int, int, int]:
    match = NODE_BOUNDS_RE.fullmatch(str(bounds or "").strip())
    if not match:
        raise SuiteError(f"Invalid node bounds: {bounds}")
    left, top, right, bottom = map(int, match.groups())
    return left, top, right, bottom


def find_ui_nodes(
    xml_text: str,
    *,
    text_pattern: str | None = None,
    content_desc_pattern: str | None = None,
) -> list[dict[str, str]]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise SuiteError(f"Unable to parse UI hierarchy XML: {exc}") from exc
    text_re = re.compile(text_pattern) if text_pattern else None
    desc_re = re.compile(content_desc_pattern) if content_desc_pattern else None
    found: list[dict[str, str]] = []
    for node in root.iter("node"):
        attrs = dict(node.attrib)
        text_value = str(attrs.get("text") or "")
        desc_value = str(attrs.get("content-desc") or "")
        if text_re and not text_re.search(text_value):
            continue
        if desc_re and not desc_re.search(desc_value):
            continue
        found.append(attrs)
    return found


def wait_for_ui_node(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    description: str,
    text_pattern: str | None = None,
    content_desc_pattern: str | None = None,
    timeout: float = 30.0,
) -> tuple[dict[str, str], str]:
    deadline = time.monotonic() + timeout
    last_xml = ""
    while time.monotonic() < deadline:
        xml_text = dump_ui_hierarchy(args, runner, config)
        last_xml = xml_text
        nodes = find_ui_nodes(xml_text, text_pattern=text_pattern, content_desc_pattern=content_desc_pattern)
        if nodes:
            return nodes[0], xml_text
        time.sleep(1.0)
    raise SuiteError(f"{description} after {int(timeout)}s")


def wait_for_ui_absence(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    description: str,
    text_pattern: str | None = None,
    content_desc_pattern: str | None = None,
    timeout: float = 30.0,
) -> str:
    deadline = time.monotonic() + timeout
    last_xml = ""
    while time.monotonic() < deadline:
        xml_text = dump_ui_hierarchy(args, runner, config)
        last_xml = xml_text
        nodes = find_ui_nodes(xml_text, text_pattern=text_pattern, content_desc_pattern=content_desc_pattern)
        if not nodes:
            return xml_text
        time.sleep(1.0)
    raise SuiteError(f"{description} after {int(timeout)}s")


def tap_ui_node(args: argparse.Namespace, runner: Runner, config: SlotConfig, node: dict[str, str]) -> None:
    left, top, right, bottom = parse_node_bounds(node.get("bounds", ""))
    tap(args, runner, config, ((left + right) // 2, (top + bottom) // 2))


def first_displayable_attachment_snapshot(card: dict[str, Any]) -> dict[str, Any] | None:
    messages = card.get("transcript_messages") if isinstance(card.get("transcript_messages"), list) else []
    sets: list[list[dict[str, Any]]] = []
    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        if str(message.get("role") or "").lower() == "user":
            continue
        attachments = normalize_attachments(
            [item for item in (message.get("attachments") if isinstance(message.get("attachments"), list) else []) if isinstance(item, dict)]
        )
        if attachments:
            sets.append(attachments)
            break
    card_level = normalize_attachments(
        [item for item in (card.get("attachments") if isinstance(card.get("attachments"), list) else []) if isinstance(item, dict)]
    )
    if card_level:
        sets.append(card_level)
    for attachments in sets:
        for index, item in enumerate(attachments):
            viewer = item.get("viewer") if isinstance(item.get("viewer"), dict) else {}
            viewer_type = str(viewer.get("type") or "").lower()
            if viewer_type in DISPLAYABLE_VIEWER_TYPES:
                return {"attachments": attachments, "index": index, "item": item, "viewer_type": viewer_type}
    return None


def card_action_accessibility_label(card: dict[str, Any]) -> str | None:
    title = str(card.get("title") or "").strip()
    if not title:
        title = "Pucky"
    if str(card.get("html_path") or "").strip():
        return f"Open page for {title}"
    attachment = first_displayable_attachment_snapshot(card)
    if attachment:
        return f"Open file for {title}"
    return None


def card_open_title(card: dict[str, Any]) -> str:
    if str(card.get("html_path") or "").strip():
        return str(card.get("title") or "Pucky")
    attachment = first_displayable_attachment_snapshot(card)
    if attachment:
        title = str((attachment.get("item") or {}).get("title") or "").strip()
        if title:
            return title
    return str(card.get("title") or "Attachment")


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
    runner.run(adb_command(args, config.serial, ["shell", "pm", "grant", args.package_name, "android.permission.CAMERA"]), timeout=30, check=False)
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


def ensure_device_interactive(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> None:
    adb_path = Path(str(args.adb))
    if runner.dry_run or not adb_path.exists():
        return
    runner.run(adb_command(args, config.serial, ["shell", "input", "keyevent", "224"]), timeout=30, check=False)
    runner.run(adb_command(args, config.serial, ["shell", "wm", "dismiss-keyguard"]), timeout=30, check=False)
    runner.run(adb_command(args, config.serial, ["shell", "input", "keyevent", "82"]), timeout=30, check=False)
    runner.run(launch_command(args, config), timeout=30, check=False)
    if not runner.dry_run:
        time.sleep(1.0)


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


def turn_history(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    limit: int = 20,
) -> dict[str, Any]:
    return command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.turn.history", {"limit": limit}),
            timeout=120,
        )
    )


def latest_turn_record(
    history_payload: dict[str, Any] | None,
    *,
    trigger_source: str = "",
    exclude_turn_id: str = "",
) -> dict[str, Any] | None:
    turns = history_payload.get("turns", []) if isinstance(history_payload, dict) else []
    for item in turns:
        if not isinstance(item, dict):
            continue
        if trigger_source and item.get("trigger_source") != trigger_source:
            continue
        if exclude_turn_id and item.get("turn_id") == exclude_turn_id:
            continue
        return item
    return None


def wait_for_turn_history_record(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    predicate,
    *,
    timeout_seconds: float = 15.0,
    sleep_seconds: float = 0.1,
    description: str,
    limit: int = 20,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        history_payload = turn_history(args, runner, config, limit=limit)
        last = latest_turn_record(history_payload)
        if predicate(last, history_payload):
            return {"record": last, "history": history_payload}
        time.sleep(sleep_seconds)
    raise SuiteError(f"Timed out waiting for {description}: {last}")


def turn_event_states(record: dict[str, Any] | None) -> list[str]:
    if not isinstance(record, dict):
        return []
    states: list[str] = []
    for event in record.get("events", []):
        if isinstance(event, dict):
            state = str(event.get("state", "")).strip()
            if state:
                states.append(state)
    return states


def prepare_turn_fixtures(config: SlotConfig) -> dict[str, Path]:
    fixture_dir = Path(config.run_dir) / "turn-fixtures"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    wake_flashlight = fixture_dir / "wake_flashlight.wav"
    wake_weather = fixture_dir / "wake_weather.wav"
    wake_silence = fixture_dir / "wake_silence.wav"
    if not synthesize_speech_wav(wake_flashlight, "Turn on the flashlight"):
        wake_flashlight.write_bytes(wav_bytes(1800))
    if not synthesize_speech_wav(wake_weather, "What is the weather today"):
        wake_weather.write_bytes(wav_bytes(2200))
    wake_silence.write_bytes(wav_bytes(5000, silence=True))
    return {
        "wake_flashlight": wake_flashlight,
        "wake_weather": wake_weather,
        "wake_silence": wake_silence,
    }


def push_turn_fixture(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    source_path: Path,
    fixture_name: str,
) -> str:
    remote_path = f"/data/local/tmp/{fixture_name}.wav"
    runner.run(adb_command(args, config.serial, ["push", str(source_path), remote_path]), timeout=60)
    return remote_path


def sync_default_recipe_bundle(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    bundle = json.loads(DEFAULT_RECIPE_BUNDLE.read_text(encoding="utf-8"))
    cleared = command_result(command_json(runner, puckyctl_command(args, config, "pucky.recipes.clear", {}), timeout=120))
    synced = command_result(command_json(runner, puckyctl_command(args, config, "pucky.recipes.sync", {"bundle": bundle}), timeout=180))
    listed = command_result(command_json(runner, puckyctl_command(args, config, "pucky.recipes.list", {}), timeout=120))
    return {"cleared": cleared, "synced": synced, "listed": listed}


def configure_turn_lab_runtime(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    fake_turn: FakeTurnEndpoint | None,
    reply_mode: str,
) -> dict[str, Any]:
    original_turn_url = getattr(args, "turn_url", "")
    original_turn_token = getattr(args, "turn_token", "")
    if fake_turn is not None:
        setattr(args, "turn_url", fake_turn.base_url)
        setattr(args, "turn_token", "dev-token")
    runner.run(adb_command(args, config.serial, ["reverse", f"tcp:{config.broker_port}", f"tcp:{config.broker_port}"]), timeout=30)
    if fake_turn is not None and fake_turn.base_url:
        port = int(fake_turn.base_url.split(":")[2].split("/")[0])
        runner.run(adb_command(args, config.serial, ["reverse", f"tcp:{port}", f"tcp:{port}"]), timeout=30)
    runner.run(adb_command(args, config.serial, ["shell", "am", "force-stop", args.package_name]), timeout=30)
    time.sleep(1.0 if not runner.dry_run else 0.0)
    runner.run(launch_command(args, config), timeout=30)
    ensure_broker_command_channel(args, runner, config, stage="turn_lab_relaunch", timeout_seconds=90)
    settings = command_result(command_json(
        runner,
        puckyctl_command(args, config, "pucky.turn.settings.set", {"reply_mode": reply_mode, "arrival_cue_mode": "chime"}),
        timeout=120,
    ))
    recipe_sync = sync_default_recipe_bundle(args, runner, config)
    setattr(args, "turn_url", original_turn_url)
    setattr(args, "turn_token", original_turn_token)
    return {"turn_settings": settings, "recipe_sync": recipe_sync, "turn_url": fake_turn.base_url if fake_turn is not None else ""}


def arm_wake_turn_lab(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    fixture_name: str,
    fixture_path: str,
    debug_fixture_transcript: str = "",
    fixture_start_delay_ms: int = 0,
    recognizer_mode: str = "fake",
) -> dict[str, Any]:
    wake_command(args, runner, config, "wake.stop", {})
    ensure_device_interactive(args, runner, config)
    payload: dict[str, Any] = {
        "enabled": True,
        "recognizer_mode": recognizer_mode,
        "capture_source": "fixture",
        "fixture_name": fixture_name,
        "fixture_path": fixture_path,
    }
    if debug_fixture_transcript:
        payload["debug_fixture_transcript"] = debug_fixture_transcript
    if fixture_start_delay_ms > 0:
        payload["fixture_start_delay_ms"] = fixture_start_delay_ms
    configured = wake_command(args, runner, config, "wake.config.set", payload)
    wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), description="wake running after wake-turn arm")
    return configured


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


def cmd_prove_displayable_reply_files(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    require_emulator_serial(config.serial)
    if not serial_is_connected(args, runner, config.serial):
        raise SuiteError(f"Emulator is not connected: {config.serial}")
    if not args.turn_token:
        raise SuiteError("prove-displayable-reply-files requires --turn-token or PUCKY_API_TOKEN")

    Path(config.evidence_dir).mkdir(parents=True, exist_ok=True)
    bundle_refresh = {"ok": True, "skipped": True}
    if not args.skip_refresh:
        bundle_refresh = run_official_refresh(args, runner, config)
        if not args.dry_run:
            ensure_broker_command_channel(
                args,
                runner,
                config,
                stage="displayable_reply_files_after_refresh",
                timeout_seconds=max(90, args.refresh_timeout_seconds),
            )
    runner.run(launch_command(args, config), timeout=30)
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
    bundle_status = command_result(command_json(runner, puckyctl_command(args, config, "ui.bundle.status", {}), timeout=120))
    command_json(runner, puckyctl_command(args, config, "ui.reply_cards.clear", {}), timeout=120)
    runner.run(launch_home_command(args, config), timeout=30)
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)

    card_icons_url = args.vm_base_url.rstrip("/") + "/api/card-icons"
    icon_registry_before = http_json_request(card_icons_url, timeout=30)
    runtime_icon_slug = "proof_orbit"
    runtime_icon_payload = {
        "name": runtime_icon_slug,
        "label": "Proof Orbit",
        "filled_svg": '<path d="M12 2 14.8 9.2 22 12 14.8 14.8 12 22 9.2 14.8 2 12 9.2 9.2Z"/>',
        "outline_svg": '<path d="M12 4.5 14 10 19.5 12 14 14 12 19.5 10 14 4.5 12 10 10Z"/>',
    }
    icon_registry_upsert = http_json_request(
        card_icons_url,
        timeout=30,
        method="POST",
        token=args.turn_token,
        body=runtime_icon_payload,
    )
    icon_registry_after = http_json_request(card_icons_url, timeout=30)

    cases = [
        {
            "key": "html",
            "card_title": "Proof HTML Dashboard",
            "card_icon": "bolt",
            "prompt": (
                "Create a small browser-displayable HTML dashboard with three goals for today. "
                "Save it as a complete HTML file and return it as the first browser-displayable result. "
                "Use card_title exactly 'Proof HTML Dashboard' and card_icon exactly 'bolt'."
            ),
            "tile_screenshot": "html-tile.png",
            "opened_screenshot": "html-opened.png",
            "expects_action": True,
            "aliases": [],
        },
        {
            "key": "csv",
            "card_title": "Proof CSV Table",
            "card_icon": "calendar",
            "prompt": (
                "Create a CSV table comparing three options with columns option, cost, and speed. "
                "Return the CSV as the first attachment. "
                "Use card_title exactly 'Proof CSV Table' and card_icon exactly 'calendar'. "
                "Make the first attachment title exactly 'Proof CSV Table File'."
            ),
            "tile_screenshot": "csv-tile.png",
            "opened_screenshot": "csv-opened.png",
            "expects_action": True,
            "aliases": [],
        },
        {
            "key": "txt",
            "card_title": "Proof Text Note",
            "card_icon": "mail",
            "prompt": (
                "Create a plain text note file listing three next steps. "
                "Return that text file as the first attachment. "
                "Use card_title exactly 'Proof Text Note' and card_icon exactly 'mail'. "
                "Make the first attachment title exactly 'Proof Text Note File'."
            ),
            "tile_screenshot": "txt-tile.png",
            "opened_screenshot": "txt-opened.png",
            "expects_action": True,
            "aliases": [],
        },
        {
            "key": "json",
            "card_title": "Proof JSON Summary",
            "card_icon": "clock",
            "prompt": (
                "Create a JSON file summarizing three findings with keys summary, risks, and next_action. "
                "Return that JSON file as the first attachment. "
                "Use card_title exactly 'Proof JSON Summary' and card_icon exactly 'clock'. "
                "Make the first attachment title exactly 'Proof JSON Summary File'."
            ),
            "tile_screenshot": "json-tile.png",
            "opened_screenshot": "json-opened.png",
            "expects_action": True,
            "aliases": [],
        },
        {
            "key": "pdf_derivative",
            "card_title": "Proof PDF Viewer",
            "card_icon": "moon",
            "prompt": (
                "Create a tiny PDF file and also create a browser-safe HTML viewer page for it. "
                "Return the PDF as the first attachment and set its viewer_path to the HTML viewer page. "
                "Use card_title exactly 'Proof PDF Viewer' and card_icon exactly 'moon'. "
                "Make the first attachment title exactly 'Proof PDF Viewer File'."
            ),
            "tile_screenshot": "pdf-tile.png",
            "opened_screenshot": "pdf-opened-derivative.png",
            "expects_action": True,
            "aliases": ["icon-existing.png"],
        },
        {
            "key": "multi",
            "card_title": "Proof Multi Attachment Order",
            "card_icon": "bolt",
            "prompt": (
                "Create two browser-displayable files and return them in this exact attachment order: "
                "first an HTML page titled 'Proof Multi First', then a CSV file titled 'Proof Multi Second'. "
                "Use card_title exactly 'Proof Multi Attachment Order' and card_icon exactly 'bolt'."
            ),
            "tile_screenshot": "multi-tile.png",
            "opened_screenshot": "multi-opened-first.png",
            "expects_action": True,
            "aliases": [],
        },
        {
            "key": "binary",
            "card_title": "Proof Binary Archive",
            "card_icon": "mail",
            "prompt": (
                "Create only a ZIP archive containing two tiny text files. "
                "Return the ZIP archive as an attachment, but do not create any browser-displayable viewer file for it. "
                "Use card_title exactly 'Proof Binary Archive' and card_icon exactly 'mail'. "
                "Make the first attachment title exactly 'Proof Binary Archive File'."
            ),
            "tile_screenshot": "binary-no-file-icon.png",
            "opened_screenshot": "",
            "expects_action": False,
            "aliases": [],
        },
        {
            "key": "icon_added",
            "card_title": "Proof Runtime Icon",
            "card_icon": runtime_icon_slug,
            "prompt": (
                f"Create a plain text note file with two bullet points and return it as the first attachment. "
                f"Use card_title exactly 'Proof Runtime Icon' and card_icon exactly '{runtime_icon_slug}'. "
                "Make the first attachment title exactly 'Proof Runtime Icon File'."
            ),
            "tile_screenshot": "icon-added.png",
            "opened_screenshot": "",
            "expects_action": True,
            "aliases": [],
        },
    ]

    results: list[dict[str, Any]] = []
    for index, case in enumerate(cases, start=1):
        turn_id = f"prove-displayable-{case['key']}-{int(time.time())}-{uuid.uuid4().hex[:6]}"
        prompt = str(case["prompt"])
        live_turn = post_live_text_turn(args, turn_id, prompt)
        live_feed_item = wait_for_live_feed_item(args, turn_id, timeout=args.turn_timeout_seconds)
        feed_sync = command_result(
            command_json(
                runner,
                puckyctl_command(args, config, "pucky.feed.sync", {"reason": f"prove-displayable:{turn_id}"}),
                timeout=180,
            )
        )
        snapshot, local_card = wait_for_snapshot_card(
            args,
            runner,
            config,
            card_id=str(live_turn.get("card_id") or ""),
            turn_id=turn_id,
            timeout=float(args.snapshot_timeout_seconds),
        )
        runner.run(launch_home_command(args, config), timeout=30)
        if not args.dry_run:
            time.sleep(args.ui_dwell_seconds)

        tile_screenshot = Path(config.evidence_dir) / str(case["tile_screenshot"])
        opened_screenshot = Path(config.evidence_dir) / str(case["opened_screenshot"]) if case["opened_screenshot"] else None
        title = str(local_card.get("title") or case["card_title"])
        _, tile_xml = wait_for_ui_node(
            args,
            runner,
            config,
            description=f"{case['key']} did not render card text for {title}",
            text_pattern=re.escape(title),
            timeout=float(args.viewer_timeout_seconds),
        )
        tile_xml_path = Path(config.evidence_dir) / f"{case['key']}-tile.xml"
        tile_xml_path.write_text(tile_xml, encoding="utf-8")
        if not args.dry_run:
            capture_screenshot(args, runner, config, tile_screenshot)
        action_label = card_action_accessibility_label(local_card)
        action_pattern = rf"^Open (?:page|file) for {re.escape(title)}$"
        open_title = card_open_title(local_card)

        opened_xml = ""
        opened_xml_path = Path(config.evidence_dir) / f"{case['key']}-opened.xml"
        if case["expects_action"]:
            if not action_label:
                raise SuiteError(f"{case['key']} returned no tile-openable attachment")
            nodes = find_ui_nodes(tile_xml, content_desc_pattern=rf"^{re.escape(action_label)}$")
            if not nodes:
                nodes = find_ui_nodes(tile_xml, text_pattern=rf"^{re.escape(action_label)}$")
            if not nodes:
                raise SuiteError(f"{case['key']} did not expose the expected tile file action: {action_label}")
            tap_ui_node(args, runner, config, nodes[0])
            if not args.dry_run:
                time.sleep(args.ui_dwell_seconds)
            _, opened_xml = wait_for_ui_node(
                args,
                runner,
                config,
                description=f"{case['key']} did not open a detail view titled {open_title}",
                text_pattern=rf"^{re.escape(open_title)}$",
                timeout=float(args.viewer_timeout_seconds),
            )
            opened_xml_path.write_text(opened_xml, encoding="utf-8")
            if opened_screenshot is not None and not args.dry_run:
                capture_screenshot(args, runner, config, opened_screenshot)
                if screenshot_sha256(tile_screenshot) == screenshot_sha256(opened_screenshot):
                    raise SuiteError(f"{case['key']} tile tap did not visibly change the UI")
            runner.run(adb_command(args, config.serial, ["shell", "input", "keyevent", "4"]), timeout=30)
            if not args.dry_run:
                time.sleep(args.ui_dwell_seconds)
        else:
            nodes = find_ui_nodes(tile_xml, content_desc_pattern=action_pattern)
            if nodes:
                raise SuiteError(f"{case['key']} unexpectedly rendered a displayable tile action")
            opened_xml_path.write_text("", encoding="utf-8")

        for alias in case.get("aliases", []):
            if not args.dry_run:
                shutil.copyfile(tile_screenshot, Path(config.evidence_dir) / str(alias))

        attachment_info = first_displayable_attachment_snapshot(local_card)
        results.append(
            {
                "key": case["key"],
                "turn_id": turn_id,
                "prompt": prompt,
                "live_turn": live_turn,
                "live_feed_item": live_feed_item,
                "feed_sync": feed_sync,
                "snapshot": snapshot,
                "local_card": local_card,
                "expected_action": bool(case["expects_action"]),
                "action_label": action_label,
                "open_title": open_title,
                "first_displayable_attachment": attachment_info,
                "tile_screenshot": str(tile_screenshot),
                "opened_screenshot": str(opened_screenshot) if opened_screenshot else "",
                "tile_xml_path": str(tile_xml_path),
                "opened_xml_path": str(opened_xml_path),
                "card_icon": str(local_card.get("icon") or ""),
                "attachment_count": len((attachment_info or {}).get("attachments") or []),
                "case_index": index,
            }
        )

    archive_case = next((item for item in results if str(item.get("key") or "") == "icon_added"), results[-1] if results else None)
    archive_proof: dict[str, Any] = {}
    if archive_case:
        archive_title = str((archive_case.get("local_card") or {}).get("title") or archive_case.get("card_title") or "").strip()
        archive_card_id = str((archive_case.get("local_card") or {}).get("card_id") or "")
        archive_turn_id = str(archive_case.get("turn_id") or "")
        runner.run(launch_home_command(args, config), timeout=30)
        if not args.dry_run:
            time.sleep(args.ui_dwell_seconds)
        archive_card_node, archive_before_xml = wait_for_ui_node(
            args,
            runner,
            config,
            description=f"Did not find archive proof card titled {archive_title}",
            text_pattern=rf"^{re.escape(archive_title)}$",
            timeout=float(args.viewer_timeout_seconds),
        )
        archive_before_xml_path = Path(config.evidence_dir) / "archive-before.xml"
        archive_before_xml_path.write_text(archive_before_xml, encoding="utf-8")
        left, top, right, bottom = parse_node_bounds(archive_card_node.get("bounds", ""))
        long_press(
            args,
            runner,
            config,
            ((left + right) // 2, (top + bottom) // 2),
            duration_ms=args.long_press_ms,
        )
        if not args.dry_run:
            time.sleep(args.ui_dwell_seconds)
        archive_menu_node, archive_menu_xml = wait_for_ui_node(
            args,
            runner,
            config,
            description="Archive menu did not appear after long-pressing reply card",
            text_pattern=r"^Archive$",
            timeout=float(args.viewer_timeout_seconds),
        )
        archive_menu_xml_path = Path(config.evidence_dir) / "archive-menu.xml"
        archive_menu_xml_path.write_text(archive_menu_xml, encoding="utf-8")
        archive_menu_screenshot = Path(config.evidence_dir) / "reply-archive-menu.png"
        if not args.dry_run:
            capture_screenshot(args, runner, config, archive_menu_screenshot)
        tap_ui_node(args, runner, config, archive_menu_node)
        if not args.dry_run:
            time.sleep(args.ui_dwell_seconds)
        archived_snapshot = wait_for_snapshot_condition(
            args,
            runner,
            config,
            description="Archived reply card never became archived in the local snapshot",
            predicate=lambda snapshot: (
                isinstance(snapshot_card_by_card_id(snapshot, archive_card_id), dict)
                and bool(snapshot_card_by_card_id(snapshot, archive_card_id).get("archived"))
            ),
            timeout=120,
        )
        archive_removed_xml = wait_for_ui_absence(
            args,
            runner,
            config,
            description="Archived reply card remained visible in the default home feed",
            text_pattern=rf"^{re.escape(archive_title)}$",
            timeout=float(args.viewer_timeout_seconds),
        )
        archive_removed_xml_path = Path(config.evidence_dir) / "archive-removed.xml"
        archive_removed_xml_path.write_text(archive_removed_xml, encoding="utf-8")
        archive_removed_screenshot = Path(config.evidence_dir) / "reply-archived-removed.png"
        if not args.dry_run:
            capture_screenshot(args, runner, config, archive_removed_screenshot)
        archive_proof = {
            "title": archive_title,
            "card_id": archive_card_id,
            "turn_id": archive_turn_id,
            "menu_screenshot": str(archive_menu_screenshot),
            "removed_screenshot": str(archive_removed_screenshot),
            "before_xml_path": str(archive_before_xml_path),
            "menu_xml_path": str(archive_menu_xml_path),
            "removed_xml_path": str(archive_removed_xml_path),
            "snapshot": archived_snapshot,
        }

    evidence = {
        "schema": "pucky.emulator_displayable_reply_files_proof.v1",
        "created_at": now_iso(),
        "config": asdict(config),
        "bundle_refresh": bundle_refresh,
        "bundle_status": bundle_status,
        "icon_registry_before": icon_registry_before,
        "icon_registry_upsert": icon_registry_upsert,
        "icon_registry_after": icon_registry_after,
        "cases": results,
        "archive_proof": archive_proof,
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }
    evidence_path = write_evidence(config, "displayable-reply-files-proof.json", evidence)
    return {
        "schema": "pucky.emulator_displayable_reply_files_proof_result.v1",
        "ok": True,
        "config": asdict(config),
        "evidence_path": str(evidence_path),
        "screenshots": {
            item["key"]: {
                "tile": item["tile_screenshot"],
                "opened": item["opened_screenshot"],
            }
            for item in results
        }
        | (
            {
                "archive": {
                    "menu": archive_proof.get("menu_screenshot", ""),
                    "removed": archive_proof.get("removed_screenshot", ""),
                }
            }
            if archive_proof
            else {}
        ),
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }


def wake_lab_gates(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    snapshots: list[dict[str, Any]] = []
    commands: list[dict[str, Any]] = []

    commands.append({"wake.stop": wake_command(args, runner, config, "wake.stop", {})})
    snapshots.append(wake_stage_snapshot(args, runner, config, "after_wake_stop", screenshot_name="wake-gates-stop.png"))
    ensure_device_interactive(args, runner, config)

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
    ensure_device_interactive(args, runner, config)
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
    ensure_device_interactive(args, runner, config)
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


def wake_lab_host_audio_smoke(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    wake_command(args, runner, config, "wake.stop", {})
    ensure_device_interactive(args, runner, config)
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


def wait_for_fake_turn_requests(fake_turn: FakeTurnEndpoint, *, count: int, timeout_seconds: float = 12.0) -> list[dict[str, Any]]:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if len(fake_turn.requests) >= count:
            return list(fake_turn.requests)
        time.sleep(0.1)
    raise SuiteError(f"Timed out waiting for {count} fake turn request(s): {fake_turn.requests}")


def wake_lab_wake_handoff_local(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    fixtures = prepare_turn_fixtures(config)
    remote = push_turn_fixture(args, runner, config, fixtures["wake_flashlight"], "wake_flashlight")
    fake_turn = FakeTurnEndpoint(FakeTurnEndpointConfig(response_text="local only", summary="flashlight"))
    fake_turn.start()
    try:
        runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=fake_turn, reply_mode="card_only")
        armed = arm_wake_turn_lab(
            args, runner, config,
            fixture_name="wake_flashlight",
            fixture_path=remote,
            debug_fixture_transcript="flashlight",
            fixture_start_delay_ms=WAKE_TURN_FIXTURE_START_DELAY_MS,
        )
        before_history = turn_history(args, runner, config)
        previous_turn_id = (latest_turn_record(before_history, trigger_source="wake_word") or {}).get("turn_id", "")
        simulate = wake_command(args, runner, config, "wake.simulate", {"event": "final", "transcript": "Hey Pucky"})
        history_started = wait_for_turn_history_record(
            args,
            runner,
            config,
            lambda record, _history: bool(record)
            and record.get("trigger_source") == "wake_word"
            and record.get("turn_id") != previous_turn_id,
            timeout_seconds=8.0,
            sleep_seconds=0.1,
            description="wake handoff local turn history",
        )
        completed = wait_for_turn_status(
            args, runner, config,
            lambda status: (status.get("last_status") or {}).get("phase") in {"local_keyword_handled", "local_keyword_failed"},
            timeout_seconds=15.0,
            sleep_seconds=0.1,
            description="wake handoff local terminal status",
        )
        final_history = wait_for_turn_history_record(
            args,
            runner,
            config,
            lambda record, _history: bool(record)
            and record.get("turn_id") == history_started["record"].get("turn_id")
            and record.get("latest_state") in {"completed", "failed"},
            timeout_seconds=15.0,
            sleep_seconds=0.1,
            description="wake handoff local final history",
        )
        rearmed = wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), timeout_seconds=15.0, description="wake rearmed after local handoff")
        snapshot = wake_stage_snapshot(args, runner, config, "wake_handoff_local", screenshot_name="wake-handoff-local.png")
        event_states = turn_event_states(final_history["record"])
        return {
            "scenario": "wake-handoff-local",
            "runtime": runtime,
            "armed": armed,
            "simulate": simulate,
            "history_started": history_started,
            "event_states": event_states,
            "completed": completed,
            "final_history": final_history,
            "rearmed": rearmed,
            "fake_turn_requests": list(fake_turn.requests),
            "snapshot": snapshot,
            "all_passed": bool(simulate.get("accepted"))
            and "armed" in event_states
            and "recording" in event_states
            and "uploading" in event_states
            and completed.get("last_status", {}).get("phase") == "local_keyword_handled"
            and final_history["record"].get("latest_state") == "completed"
            and len(fake_turn.requests) == 0,
        }
    finally:
        fake_turn.stop()


def wake_lab_wake_handoff_upload(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    fixtures = prepare_turn_fixtures(config)
    remote = push_turn_fixture(args, runner, config, fixtures["wake_weather"], "wake_weather")
    fake_turn = FakeTurnEndpoint(FakeTurnEndpointConfig(response_text="Weather looks good.", summary="weather"))
    fake_turn.start()
    try:
        runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=fake_turn, reply_mode="card_only")
        armed = arm_wake_turn_lab(
            args, runner, config,
            fixture_name="wake_weather",
            fixture_path=remote,
            debug_fixture_transcript="weather",
            fixture_start_delay_ms=WAKE_TURN_FIXTURE_START_DELAY_MS,
        )
        before_history = turn_history(args, runner, config)
        previous_turn_id = (latest_turn_record(before_history, trigger_source="wake_word") or {}).get("turn_id", "")
        simulate = wake_command(args, runner, config, "wake.simulate", {"event": "final", "transcript": "Hey Pucky"})
        history_started = wait_for_turn_history_record(
            args,
            runner,
            config,
            lambda record, _history: bool(record)
            and record.get("trigger_source") == "wake_word"
            and record.get("turn_id") != previous_turn_id,
            timeout_seconds=8.0,
            sleep_seconds=0.1,
            description="wake handoff upload turn history",
        )
        requests = wait_for_fake_turn_requests(fake_turn, count=1, timeout_seconds=15.0)
        completed = wait_for_turn_status(
            args, runner, config,
            lambda status: (status.get("last_status") or {}).get("state") == "completed",
            timeout_seconds=20.0,
            sleep_seconds=0.1,
            description="wake handoff upload completed",
        )
        final_history = wait_for_turn_history_record(
            args,
            runner,
            config,
            lambda record, _history: bool(record)
            and record.get("turn_id") == history_started["record"].get("turn_id")
            and record.get("latest_state") == "completed",
            timeout_seconds=20.0,
            sleep_seconds=0.1,
            description="wake handoff upload final history",
        )
        rearmed = wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), timeout_seconds=20.0, description="wake rearmed after upload handoff")
        snapshot = wake_stage_snapshot(args, runner, config, "wake_handoff_upload", screenshot_name="wake-handoff-upload.png")
        event_states = turn_event_states(final_history["record"])
        return {
            "scenario": "wake-handoff-upload",
            "runtime": runtime,
            "armed": armed,
            "simulate": simulate,
            "history_started": history_started,
            "event_states": event_states,
            "completed": completed,
            "final_history": final_history,
            "rearmed": rearmed,
            "fake_turn_requests": requests,
            "snapshot": snapshot,
            "all_passed": bool(simulate.get("accepted"))
            and "armed" in event_states
            and "recording" in event_states
            and "uploading" in event_states
            and len(requests) == 1
            and completed.get("last_status", {}).get("state") == "completed",
        }
    finally:
        fake_turn.stop()


def wake_lab_wake_no_speech_timeout(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    fixtures = prepare_turn_fixtures(config)
    remote = push_turn_fixture(args, runner, config, fixtures["wake_silence"], "wake_silence")
    runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=None, reply_mode="card_only")
    armed = arm_wake_turn_lab(
        args, runner, config,
        fixture_name="wake_silence",
        fixture_path=remote,
        debug_fixture_transcript="",
        fixture_start_delay_ms=WAKE_TURN_FIXTURE_START_DELAY_MS,
    )
    simulate = wake_command(args, runner, config, "wake.simulate", {"event": "final", "transcript": "Hey Pucky"})
    blue = wait_for_turn_status(args, runner, config, lambda status: status.get("visual_state") == "armed", timeout_seconds=8.0, sleep_seconds=0.1, description="wake no-speech blue/armed state")
    discarded = wait_for_turn_status(
        args, runner, config,
        lambda status: (status.get("last_status") or {}).get("phase") == "no_speech_timeout",
        timeout_seconds=12.0,
        sleep_seconds=0.1,
        description="wake no-speech timeout discard",
    )
    rearmed = wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), timeout_seconds=15.0, description="wake rearmed after no-speech timeout")
    snapshot = wake_stage_snapshot(args, runner, config, "wake_no_speech_timeout", screenshot_name="wake-no-speech-timeout.png")
    return {
        "scenario": "wake-no-speech-timeout",
        "runtime": runtime,
        "armed": armed,
        "simulate": simulate,
        "blue": blue,
        "discarded": discarded,
        "rearmed": rearmed,
        "snapshot": snapshot,
        "all_passed": bool(simulate.get("accepted"))
        and discarded.get("last_status", {}).get("phase") == "no_speech_timeout",
    }


def wake_lab_wake_negative(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=None, reply_mode="card_only")
    armed = arm_wake_turn_lab(
        args, runner, config,
        fixture_name="wake_negative",
        fixture_path="",
        debug_fixture_transcript="",
        fixture_start_delay_ms=0,
    )
    response = wake_command(args, runner, config, "wake.simulate", {"event": "final", "transcript": "Parking"})
    time.sleep(0.5 if not runner.dry_run else 0.0)
    turn = turn_status(args, runner, config)
    wake = wake_status(args, runner, config)
    snapshot = wake_stage_snapshot(args, runner, config, "wake_negative", screenshot_name="wake-negative.png")
    return {
        "scenario": "wake-negative",
        "runtime": runtime,
        "armed": armed,
        "response": response,
        "turn": turn,
        "wake": wake,
        "snapshot": snapshot,
        "all_passed": not bool(response.get("accepted")) and turn.get("visual_state") == "idle" and bool(wake.get("running")),
    }


def wake_lab_wake_pause_on_reply(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    fixtures = prepare_turn_fixtures(config)
    remote = push_turn_fixture(args, runner, config, fixtures["wake_weather"], "wake_weather_reply")
    fake_turn = FakeTurnEndpoint(FakeTurnEndpointConfig(response_text="Weather looks good.", summary="weather", audio_duration_ms=2500))
    fake_turn.start()
    try:
        runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=fake_turn, reply_mode="card_and_spoken")
        armed = arm_wake_turn_lab(
            args, runner, config,
            fixture_name="wake_weather_reply",
            fixture_path=remote,
            debug_fixture_transcript="weather",
            fixture_start_delay_ms=WAKE_TURN_FIXTURE_START_DELAY_MS,
        )
        simulate = wake_command(args, runner, config, "wake.simulate", {"event": "final", "transcript": "Hey Pucky"})
        wait_for_fake_turn_requests(fake_turn, count=1, timeout_seconds=15.0)
        speaking = wait_for_turn_status(args, runner, config, lambda status: status.get("visual_state") == "speaking", timeout_seconds=25.0, sleep_seconds=0.1, description="wake pause-on-reply speaking state")
        paused = wake_status(args, runner, config)
        completed = wait_for_turn_status(args, runner, config, lambda status: (status.get("last_status") or {}).get("state") == "completed", timeout_seconds=30.0, sleep_seconds=0.1, description="wake pause-on-reply completed state")
        rearmed = wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), timeout_seconds=30.0, description="wake rearmed after spoken reply")
        snapshot = wake_stage_snapshot(args, runner, config, "wake_pause_on_reply", screenshot_name="wake-pause-on-reply.png")
        return {
            "scenario": "wake-pause-on-reply",
            "runtime": runtime,
            "armed": armed,
            "simulate": simulate,
            "speaking": speaking,
            "paused_wake": paused,
            "completed": completed,
            "rearmed": rearmed,
            "fake_turn_requests": list(fake_turn.requests),
            "snapshot": snapshot,
            "all_passed": speaking.get("visual_state") == "speaking"
            and not bool(paused.get("running"))
            and bool(rearmed.get("running")),
        }
    finally:
        fake_turn.stop()


def wake_lab_manual_regression(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    fixtures = prepare_turn_fixtures(config)
    remote = push_turn_fixture(args, runner, config, fixtures["wake_flashlight"], "manual_flashlight")
    runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=None, reply_mode="card_only")
    wake_command(args, runner, config, "wake.stop", {})
    ensure_device_interactive(args, runner, config)
    wake_command(args, runner, config, "wake.config.set", {"enabled": True, "recognizer_mode": "fake"})
    wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), description="wake running before manual regression")
    started = command_result(command_json(
        runner,
        puckyctl_command(args, config, "pucky.turn.start", {
            "trigger_source": "volume_up_hold",
            "source": "volume_up_hold",
            "feedback": False,
            "capture_source": "fixture",
            "fixture_name": "manual_flashlight",
            "fixture_path": remote,
            "debug_fixture_transcript": "flashlight",
            "fixture_start_delay_ms": 400,
        }),
        timeout=120,
    ))
    blocked = wait_for_wake_status(args, runner, config, lambda status: status.get("suspended_reason") == "turn_active", timeout_seconds=8.0, description="wake paused during manual regression")
    wait_for_turn_status(args, runner, config, lambda status: status.get("visual_state") == "recording", timeout_seconds=8.0, sleep_seconds=0.1, description="manual regression recording state")
    stopped = command_result(command_json(
        runner,
        puckyctl_command(args, config, "pucky.turn.stop", {"reason": "button_release", "feedback": False}),
        timeout=120,
    ))
    completed = wait_for_turn_status(
        args, runner, config,
        lambda status: (status.get("last_status") or {}).get("phase") == "local_keyword_handled",
        timeout_seconds=15.0,
        sleep_seconds=0.1,
        description="manual regression local keyword handled",
    )
    rearmed = wait_for_wake_status(args, runner, config, lambda status: bool(status.get("running")), timeout_seconds=15.0, description="wake resumed after manual regression")
    snapshot = wake_stage_snapshot(args, runner, config, "manual_regression", screenshot_name="manual-regression.png")
    return {
        "scenario": "manual-regression",
        "runtime": runtime,
        "started": started,
        "blocked": blocked,
        "stopped": stopped,
        "completed": completed,
        "rearmed": rearmed,
        "snapshot": snapshot,
        "all_passed": completed.get("last_status", {}).get("phase") == "local_keyword_handled" and bool(rearmed.get("running")),
    }


def cmd_wake_lab(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    if args.slot not in (1, 2):
        raise SuiteError("wake-lab supports slot 1 fallback or slot 2")
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
    elif args.scenario == "restart-regression":
        scenario_result = wake_lab_restart_regression(args, runner, config)
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
    for name in ("create", "start", "provision", "seed-ui", "smoke", "wake-lab", "stop", "clean", "prove-thread-origin", "prove-pending-outbound-feed", "prove-displayable-reply-files"):
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
                    "wake-handoff-local",
                    "wake-handoff-upload",
                    "wake-no-speech-timeout",
                    "wake-negative",
                    "wake-pause-on-reply",
                    "manual-regression",
                    "restart-regression",
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
        if name == "prove-displayable-reply-files":
            item.add_argument("--turn-url", default=os.environ.get("PUCKY_TURN_URL", DEFAULT_TURN_URL))
            item.add_argument("--turn-token", default=os.environ.get("PUCKY_API_TOKEN", ""))
            item.add_argument("--vm-base-url", default="https://pucky.fly.dev")
            item.add_argument("--operator-token", default=os.environ.get("PUCKY_OPERATOR_TOKEN", ""))
            item.add_argument("--turn-timeout-seconds", type=int, default=180)
            item.add_argument("--refresh-timeout-seconds", type=int, default=180)
            item.add_argument("--snapshot-timeout-seconds", type=int, default=120)
            item.add_argument("--viewer-timeout-seconds", type=int, default=30)
            item.add_argument("--ui-dwell-seconds", type=float, default=1.0)
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
    if args.command == "prove-displayable-reply-files":
        return cmd_prove_displayable_reply_files(args)
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
