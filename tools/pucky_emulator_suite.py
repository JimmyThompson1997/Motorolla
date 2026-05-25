from __future__ import annotations

import argparse
import json
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
import urllib.error
import urllib.request
import uuid
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
DEFAULT_USERDATA_PARTITION_MB = "2047"
DEFAULT_USERDATA_PARTITION_BYTES = str(int(DEFAULT_USERDATA_PARTITION_MB) * 1024 * 1024)
DEFAULT_APK = ROOT / "pucky-apk" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
DEFAULT_PUCKYCTL = ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py"
DEFAULT_FAKE_BROKER = ROOT / "pucky-apk" / "fake-broker"
DEFAULT_TURN_URL = "https://pucky.fly.dev/api/turn"
BASE_DIR = ROOT / ".tmp" / "pucky-emulator"
RUNS_DIR = ROOT / ".tmp" / "pucky-emulator-runs"
MIN_RECOMMENDED_AVD_FREE_GB = 8.0


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
        "-partition-size",
        DEFAULT_USERDATA_PARTITION_MB,
        "-gpu",
        "swiftshader_indirect",
    ]


def tune_avd_config(config: SlotConfig, *, userdata_size: str = DEFAULT_USERDATA_PARTITION_BYTES) -> None:
    config_path = Path(config.avd_home) / f"{config.avd_name}.avd" / "config.ini"
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


def wait_for_boot(args: argparse.Namespace, runner: Runner, config: SlotConfig, *, timeout: float = 180.0) -> None:
    if runner.dry_run:
        return
    runner.run(adb_command(args, config.serial, ["wait-for-device"]), timeout=int(timeout))
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if emulator_boot_ready(args, runner, config):
            return
        time.sleep(2)
    raise SuiteError(f"Timed out waiting for emulator boot: {config.serial}")


def package_manager_ready(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> bool:
    service = runner.run(adb_command(args, config.serial, ["shell", "service", "check", "package"]), timeout=15, check=False)
    service_text = (service.stdout + "\n" + service.stderr).lower()
    if service.returncode != 0 or "can't find service" in service_text or "not found" in service_text:
        return False

    query = runner.run(
        adb_command(args, config.serial, ["shell", "cmd", "package", "list", "packages", "android"]),
        timeout=20,
        check=False,
    )
    query_text = (query.stdout + "\n" + query.stderr).lower()
    if query.returncode == 0 and "package:android" in query_text:
        return True
    if "can't find service" in query_text or "not found" in query_text:
        return False

    fallback = runner.run(adb_command(args, config.serial, ["shell", "pm", "path", "android"]), timeout=20, check=False)
    fallback_text = (fallback.stdout + "\n" + fallback.stderr).lower()
    return fallback.returncode == 0 and "package:" in fallback_text and "can't find service" not in fallback_text


def wait_for_package_manager(args: argparse.Namespace, runner: Runner, config: SlotConfig, *, timeout: float = 120.0) -> None:
    if runner.dry_run:
        return
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if package_manager_ready(args, runner, config):
            return
        time.sleep(2)
    raise SuiteError(f"Timed out waiting for Android PackageManager readiness: {config.serial}")


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
    result = runner.run(command, timeout=timeout)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"raw_stdout": result.stdout, "raw_stderr": result.stderr}


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
    wait_for_package_manager(args, runner, config)
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


def command_result(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload.get("result")
    return result if isinstance(result, dict) else payload


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
        snapshot = command_result(command_json(runner, puckyctl_command(args, config, "ui.reply_cards.get", {}), timeout=120))
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
        relaunch_snapshot = command_result(command_json(runner, puckyctl_command(args, config, "ui.reply_cards.get", {}), timeout=120))
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
    for name in ("create", "start", "provision", "seed-ui", "smoke", "stop", "clean", "prove-thread-origin"):
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
    if args.command == "prove-thread-origin":
        return cmd_prove_thread_origin(args)
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
