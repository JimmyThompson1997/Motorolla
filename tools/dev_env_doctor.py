from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tools import dev_env_support


SCHEMA = "pucky.dev_env_doctor.v1"


def _check(name: str, ok: bool, detail: Any) -> dict[str, Any]:
    return {"name": name, "ok": bool(ok), "detail": str(detail)}


def _command_version(command: list[str], *, timeout: int = 10) -> tuple[bool, str]:
    env = dict(os.environ)
    binary = Path(command[0]) if command else None
    if binary is not None and binary.parent.exists():
        env["PATH"] = str(binary.parent) + os.pathsep + env.get("PATH", "")
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False, env=env)
    except Exception as exc:
        return False, str(exc)
    output = (result.stdout.strip() or result.stderr.strip() or f"exit {result.returncode}")
    return result.returncode == 0, output


def _run_command(command: list[str], *, timeout: int = 10, extra_env: Optional[dict[str, str]] = None) -> dict[str, Any]:
    env = dict(os.environ)
    binary = Path(command[0]) if command else None
    if binary is not None and binary.parent.exists():
        env["PATH"] = str(binary.parent) + os.pathsep + env.get("PATH", "")
    if extra_env:
        env.update({key: str(value) for key, value in extra_env.items()})
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False, env=env)
    except Exception as exc:
        return {
            "ok": False,
            "returncode": -1,
            "stdout": "",
            "stderr": str(exc),
            "output": str(exc),
            "command": list(command),
        }
    stdout = str(result.stdout or "")
    stderr = str(result.stderr or "")
    output = stdout.strip() or stderr.strip() or f"exit {result.returncode}"
    return {
        "ok": result.returncode == 0,
        "returncode": int(result.returncode),
        "stdout": stdout,
        "stderr": stderr,
        "output": output,
        "command": list(command),
    }


def _check_version(path: Optional[Path], command: list[str]) -> tuple[bool, str]:
    if path is None:
        return False, "not found"
    return _command_version(command)


def _version_major(text: str) -> Optional[int]:
    match = re.search(r"(\d+)", text)
    return int(match.group(1)) if match else None


def _build_tools_ok(android_home: Path) -> tuple[bool, str]:
    build_tools_root = android_home / "build-tools"
    if not build_tools_root.exists():
        return False, "build-tools directory missing"
    versions = sorted(path.name for path in build_tools_root.iterdir() if path.is_dir())
    ok = any(version.startswith(dev_env_support.BUILD_TOOLS_MAJOR + ".") for version in versions)
    detail = ", ".join(versions) if versions else "none installed"
    return ok, detail


def _android_packages_check(android_home: Path, system_image: str) -> tuple[bool, str]:
    missing: list[str] = []
    if not (android_home / "platform-tools").exists():
        missing.append("platform-tools")
    if not (android_home / "platforms" / f"android-{dev_env_support.ANDROID_API_LEVEL}").exists():
        missing.append(f"platforms;android-{dev_env_support.ANDROID_API_LEVEL}")
    build_tools_ok, build_tools_detail = _build_tools_ok(android_home)
    if not build_tools_ok:
        missing.append(f"build-tools;{dev_env_support.BUILD_TOOLS_MAJOR}.x ({build_tools_detail})")
    if not (android_home / "emulator").exists():
        missing.append("emulator")
    if not (android_home / Path(system_image.replace(";", os.sep))).exists():
        missing.append(system_image)
    if missing:
        return False, ", ".join(missing)
    return True, "required SDK packages installed"


def _parse_adb_devices(output: str) -> list[dict[str, str]]:
    devices: list[dict[str, str]] = []
    for raw_line in str(output or "").splitlines():
        line = raw_line.strip()
        if not line or line.lower().startswith("list of devices attached"):
            continue
        if line.startswith("* ") or line.startswith("adb server"):
            continue
        columns = line.split()
        if len(columns) < 2:
            continue
        serial = str(columns[0] or "").strip()
        state = str(columns[1] or "").strip()
        extras = " ".join(columns[2:]).strip()
        if serial.startswith("emulator-"):
            transport = "emulator"
        else:
            transport = "wireless" if ":" in serial else "usb" if serial else "unknown"
        if "usb:" in extras:
            transport = "usb"
        devices.append(
            {
                "serial": serial,
                "state": state,
                "transport": transport,
                "details": extras,
                "raw": line,
            }
        )
    return devices


def _profiler_hints(output: str) -> dict[str, bool]:
    lower = str(output or "").lower()
    return {
        "android_visible": "android" in lower,
        "motorola_visible": "motorola" in lower,
        "razr_visible": "razr" in lower,
        "usb_visible": "usb" in lower,
    }


def _transport_next_step(*, devices: list[dict[str, str]], profiler_output: str) -> str:
    if any(item["state"] == "device" and item["transport"] == "usb" for item in devices):
        return "usb_ready"
    if any(item["state"] == "device" and item["transport"] == "wireless" for item in devices):
        return "wireless_ready"
    if any(item["state"] in {"unauthorized", "authorizing"} for item in devices):
        return "unlock_and_accept_debugging"
    if any(item["state"] in {"offline", "recovery"} for item in devices):
        return "revoke_and_reauthorize_debugging"
    hints = _profiler_hints(profiler_output)
    if hints["android_visible"] or hints["motorola_visible"] or hints["razr_visible"]:
        return "switch_usb_to_file_transfer"
    return "swap_cable_or_port_then_try_wireless_debugging"


def android_transport_report(*, environment: Optional[dict[str, str]] = None) -> dict[str, Any]:
    env = environment or os.environ
    system = dev_env_support.host_system()
    adb = dev_env_support.default_adb(environment=env, system=system)
    adb_exists = adb.exists()
    adb_version = _run_command([str(adb), "version"], timeout=10) if adb_exists else {
        "ok": False,
        "returncode": -1,
        "stdout": "",
        "stderr": "adb not found",
        "output": "adb not found",
        "command": [str(adb), "version"],
    }
    server_status = _run_command([str(adb), "server-status"], timeout=10) if adb_exists else {
        "ok": False,
        "returncode": -1,
        "stdout": "",
        "stderr": "adb not found",
        "output": "adb not found",
        "command": [str(adb), "server-status"],
    }
    adb_devices = _run_command([str(adb), "devices", "-l"], timeout=15) if adb_exists else {
        "ok": False,
        "returncode": -1,
        "stdout": "",
        "stderr": "adb not found",
        "output": "adb not found",
        "command": [str(adb), "devices", "-l"],
    }
    adb_devices_libusb_1 = _run_command([str(adb), "devices", "-l"], timeout=15, extra_env={"ADB_LIBUSB": "1"}) if adb_exists else {
        "ok": False,
        "returncode": -1,
        "stdout": "",
        "stderr": "adb not found",
        "output": "adb not found",
        "command": [str(adb), "devices", "-l"],
    }
    adb_devices_libusb_0 = _run_command([str(adb), "devices", "-l"], timeout=15, extra_env={"ADB_LIBUSB": "0"}) if adb_exists else {
        "ok": False,
        "returncode": -1,
        "stdout": "",
        "stderr": "adb not found",
        "output": "adb not found",
        "command": [str(adb), "devices", "-l"],
    }
    profiler = (
        _run_command(["system_profiler", "SPUSBDataType"], timeout=30)
        if system == "Darwin"
        else {
            "ok": False,
            "returncode": -1,
            "stdout": "",
            "stderr": "system_profiler unavailable",
            "output": "system_profiler unavailable",
            "command": ["system_profiler", "SPUSBDataType"],
        }
    )
    devices = _parse_adb_devices(adb_devices.get("stdout", "") or adb_devices.get("output", ""))
    usb_ok = any(item["state"] == "device" and item["transport"] == "usb" for item in devices)
    wireless_ok = any(item["state"] == "device" and item["transport"] == "wireless" for item in devices)
    if usb_ok:
        status = "usb_ok"
    elif wireless_ok:
        status = "wireless_ok"
    else:
        status = "blocked"
    return {
        "schema": "pucky.android_transport.v1",
        "status": status,
        "usb_ok": usb_ok,
        "wireless_ok": wireless_ok,
        "adb_path": str(adb),
        "devices": devices,
        "next_step": _transport_next_step(devices=devices, profiler_output=str(profiler.get("stdout", "") or profiler.get("output", ""))),
        "adb_version": adb_version,
        "adb_server_status": server_status,
        "adb_devices": adb_devices,
        "adb_devices_libusb_1": adb_devices_libusb_1,
        "adb_devices_libusb_0": adb_devices_libusb_0,
        "system_profiler_usb": profiler,
    }


def _gradle_wrapper_check(root: Path, *, system: Optional[str] = None) -> tuple[bool, str]:
    wrapper = dev_env_support.gradle_wrapper_path(root, system=system)
    jar_path = root / "pucky-apk" / "gradle" / "wrapper" / "gradle-wrapper.jar"
    props_path = root / "pucky-apk" / "gradle" / "wrapper" / "gradle-wrapper.properties"
    missing = [str(path.relative_to(root)) for path in (wrapper, jar_path, props_path) if not path.exists()]
    if missing:
        return False, "missing " + ", ".join(missing)
    return True, str(wrapper.relative_to(root))


def emulator_suite_report() -> dict[str, Any]:
    import tools.pucky_emulator_suite as suite

    parser = suite.build_parser()
    args = parser.parse_args(["doctor"])
    return suite.doctor(args)


def gather_report(*, root: Path = ROOT, include_emulator: bool = False, include_device_transport: bool = False) -> dict[str, Any]:
    system = dev_env_support.host_system()
    machine = dev_env_support.host_machine()
    env = os.environ
    checks: List[dict[str, Any]] = []
    local_root = dev_env_support.local_dev_root(environment=env)

    if system == "Darwin":
        brew = dev_env_support.brew_path(environment=env)
        brew_ok = brew is not None or local_root.exists()
        brew_detail = brew or (f"optional when local toolchain exists at {local_root}" if local_root.exists() else "brew not found")
        checks.append(_check("homebrew", brew_ok, brew_detail))

    brewfile = root / "Brewfile"
    checks.append(_check("brewfile", brewfile.exists(), brewfile))

    python312 = dev_env_support.default_python312(environment=env)
    python_ok, python_detail = _check_version(python312, [str(python312), "--version"] if python312 else [])
    checks.append(_check("python_3_12", python_ok, python_detail if python_ok else (python_detail or python312 or "python3.12 not found")))

    node = dev_env_support.default_node(environment=env)
    node_ok, node_detail = _check_version(node, [str(node), "--version"] if node else [])
    node_major = _version_major(node_detail)
    checks.append(_check("node", node_ok and node_major is not None and node_major >= 20, node_detail if node else "node not found"))

    npm = dev_env_support.default_npm(environment=env)
    npm_ok, npm_detail = _check_version(npm, [str(npm), "--version"] if npm else [])
    checks.append(_check("npm", npm_ok, npm_detail if npm else "npm not found"))

    ffmpeg = dev_env_support.default_ffmpeg(environment=env)
    ffmpeg_ok, ffmpeg_detail = _check_version(ffmpeg, [str(ffmpeg), "-version"] if ffmpeg else [])
    checks.append(_check("ffmpeg", ffmpeg_ok, ffmpeg_detail.splitlines()[0] if ffmpeg_ok else (ffmpeg_detail or "ffmpeg not found")))

    flyctl = dev_env_support.default_flyctl(environment=env)
    flyctl_ok, flyctl_detail = _check_version(flyctl, [str(flyctl), "version"] if flyctl else [])
    checks.append(_check("flyctl", flyctl_ok, flyctl_detail if flyctl else "flyctl not found"))

    java_home = dev_env_support.default_java_home(environment=env, system=system)
    java_bin = java_home / "bin" / ("java.exe" if system == "Windows" else "java")
    java_ok, java_detail = _check_version(java_bin if java_bin.exists() else None, [str(java_bin), "-version"] if java_bin.exists() else [])
    checks.append(_check("java_17_home", java_home.exists(), java_home))
    checks.append(_check("java_17_runtime", java_ok and "17." in java_detail, java_detail if java_ok else (java_detail or java_bin)))

    gradle_ok, gradle_detail = _gradle_wrapper_check(root, system=system)
    checks.append(_check("gradle_wrapper", gradle_ok, gradle_detail))

    gradle = dev_env_support.default_gradle(root, environment=env, system=system)
    checks.append(_check("gradle_command", gradle.exists(), gradle))

    android_home = dev_env_support.default_android_home(environment=env, system=system)
    checks.append(_check("android_home", android_home.exists(), android_home))

    adb = dev_env_support.default_adb(environment=env, system=system)
    adb_ok, adb_detail = _check_version(adb if adb.exists() else None, [str(adb), "version"] if adb.exists() else [])
    checks.append(_check("adb", adb_ok, adb_detail if adb_ok else (adb_detail or adb)))

    emulator = dev_env_support.default_emulator(environment=env, system=system)
    checks.append(_check("emulator", emulator.exists(), emulator))

    avdmanager = dev_env_support.default_avdmanager(environment=env, system=system)
    checks.append(_check("avdmanager", avdmanager.exists(), avdmanager))

    sdkmanager = dev_env_support.default_sdkmanager(environment=env, system=system)
    checks.append(_check("sdkmanager", sdkmanager.exists(), sdkmanager))

    system_image = dev_env_support.default_system_image(system=system, machine=machine)
    android_packages_ok, android_packages_detail = _android_packages_check(android_home, system_image) if android_home.exists() else (False, "android_home missing")
    checks.append(_check("android_sdk_packages", android_packages_ok, android_packages_detail))

    bootstrap_script = root / "tools" / "bootstrap_mac_dev.sh"
    checks.append(_check("bootstrap_script", bootstrap_script.exists(), bootstrap_script))

    puckyctl = root / "pucky-apk" / "puckyctl" / "puckyctl.py"
    checks.append(_check("puckyctl", puckyctl.exists(), puckyctl))

    fake_broker = root / "pucky-apk" / "fake-broker" / "package.json"
    checks.append(_check("fake_broker", fake_broker.exists(), fake_broker))

    if include_emulator:
        try:
            report = emulator_suite_report()
            detail = f"{sum(1 for item in report['checks'] if item['ok'])}/{len(report['checks'])} emulator checks passing"
            checks.append(_check("emulator_suite_doctor", bool(report.get("ok")), detail))
        except Exception as exc:
            checks.append(_check("emulator_suite_doctor", False, exc))

    report = {
        "schema": SCHEMA,
        "ok": all(item["ok"] for item in checks),
        "host": {"system": system, "machine": machine},
        "checks": checks,
    }
    if include_device_transport:
        report["android_transport"] = android_transport_report(environment=env)
    return report


def print_human(report: dict[str, Any]) -> None:
    host = report.get("host") or {}
    print(f"Host: {host.get('system', '')} {host.get('machine', '')}".strip())
    for item in report["checks"]:
        status = "ok" if item["ok"] else "missing"
        print(f"[{status}] {item['name']}: {item['detail']}")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Check whether this machine is ready for local Pucky development.")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--include-emulator", action="store_true")
    parser.add_argument("--include-device-transport", action="store_true")
    args = parser.parse_args(argv)

    report = gather_report(include_emulator=args.include_emulator, include_device_transport=args.include_device_transport)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print_human(report)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
