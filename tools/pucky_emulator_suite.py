from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
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
DEFAULT_APK = ROOT / "pucky-apk" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
DEFAULT_PUCKYCTL = ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py"
DEFAULT_FAKE_BROKER = ROOT / "pucky-apk" / "fake-broker"
BASE_DIR = ROOT / ".tmp" / "pucky-emulator"
RUNS_DIR = ROOT / ".tmp" / "pucky-emulator-runs"


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
    return [
        str(args.emulator),
        "-avd",
        config.avd_name,
        "-port",
        str(config.emulator_port),
        "-no-window",
        "-no-audio",
        "-no-snapshot-load",
        "-no-snapshot-save",
        "-no-boot-anim",
        "-gpu",
        "swiftshader_indirect",
    ]


def adb_command(args: argparse.Namespace, serial: str, command: Iterable[str]) -> list[str]:
    require_emulator_serial(serial)
    return [str(args.adb), "-s", serial, *command]


def launch_command(args: argparse.Namespace, config: SlotConfig) -> list[str]:
    return adb_command(
        args,
        config.serial,
        [
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
            "--ez",
            "connect",
            "true",
        ],
    )


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


def puckyctl_command(args: argparse.Namespace, config: SlotConfig, command_type: str, payload: dict[str, Any]) -> list[str]:
    return [
        sys.executable,
        str(args.puckyctl),
        "--json",
        "--broker",
        f"http://127.0.0.1:{config.broker_port}",
        "--device-id",
        config.device_id,
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


def wait_for_boot(args: argparse.Namespace, runner: Runner, config: SlotConfig, *, timeout: float = 180.0) -> None:
    if runner.dry_run:
        return
    runner.run(adb_command(args, config.serial, ["wait-for-device"]), timeout=int(timeout))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = runner.run(adb_command(args, config.serial, ["shell", "getprop", "sys.boot_completed"]), timeout=15, check=False)
        if result.stdout.strip() == "1":
            return
        time.sleep(2)
    raise SuiteError(f"Timed out waiting for emulator boot: {config.serial}")


def serial_is_connected(args: argparse.Namespace, runner: Runner, serial: str) -> bool:
    require_emulator_serial(serial)
    if runner.dry_run:
        return True
    result = runner.run([str(args.adb), "devices", "-l"], check=False)
    return any(device.serial == serial and device.state == "device" for device in parse_adb_devices(result.stdout))


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
    result = runner.run(command, timeout=timeout)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"raw_stdout": result.stdout, "raw_stderr": result.stderr}


def capture_screenshot(args: argparse.Namespace, runner: Runner, config: SlotConfig, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    display_id = primary_display_id(args, runner, config)
    screencap_args = ["exec-out", "screencap"]
    if display_id:
        screencap_args.extend(["-d", display_id])
    screencap_args.append("-p")
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
        save_state(config, {"config": asdict(config), "create_stdout": result.stdout, "create_stderr": result.stderr})
    return {"ok": True, "config": asdict(config), "commands": runner.planned, "dry_run": args.dry_run}


def cmd_start(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    Path(config.evidence_dir).mkdir(parents=True, exist_ok=True)
    pid = runner.start_detached(
        emulator_start_command(args, config),
        cwd=ROOT,
        env=sdk_env(args, config),
        stdout_path=Path(config.evidence_dir) / "emulator.log",
        stderr_path=Path(config.evidence_dir) / "emulator.err.log",
    )
    if not args.no_wait:
        wait_for_boot(args, runner, config)
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
    broker_pid = start_node_broker(args, runner, config)
    if not args.skip_build:
        runner.run([str(args.gradle), "-p", str(ROOT / "pucky-apk"), ":app:assembleDebug"], env=sdk_env(args, config), timeout=300)
    if not Path(args.apk).exists() and not args.dry_run:
        raise SuiteError(f"APK not found: {args.apk}")
    runner.run(adb_command(args, config.serial, ["reverse", f"tcp:{config.broker_port}", f"tcp:{config.broker_port}"]), timeout=30)
    runner.run(adb_command(args, config.serial, ["install", "-r", str(args.apk)]), timeout=180)
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
        timeout=120,
    )
    cards_payload = cards_payload_from_args(args, config)
    cards_status = command_json(runner, puckyctl_command(args, config, "ui.reply_cards.set", cards_payload), timeout=120)
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
    targets = [Path(config.run_dir), Path(config.state_path)]
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
    parser.add_argument("--dry-run", action="store_true")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Pucky emulator lab harness")
    sub = parser.add_subparsers(dest="command", required=True)
    doctor_parser = sub.add_parser("doctor")
    add_common(doctor_parser)
    for name in ("create", "start", "provision", "seed-ui", "smoke", "stop", "clean"):
        item = sub.add_parser(name)
        add_common(item)
        item.add_argument("--slot", type=int, default=1)
        if name == "start":
            item.add_argument("--no-wait", action="store_true")
        if name == "provision":
            item.add_argument("--skip-build", action="store_true")
        if name == "seed-ui":
            item.add_argument("--cards-json", default="")
            item.add_argument("--cards-file", type=Path)
            item.add_argument("--max-bundle-bytes", type=int, default=20 * 1024 * 1024)
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
    if args.command == "stop":
        return cmd_stop(args)
    if args.command == "clean":
        return cmd_clean(args)
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
