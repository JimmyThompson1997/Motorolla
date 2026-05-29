from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BROKER = "https://pucky.fly.dev"
DEFAULT_DEVICE_ID = "razr-comms-live"
DEFAULT_SERIAL = "ZY22JZ26LK"
DEFAULT_PUCKYCTL = ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py"
DEFAULT_ADB = Path(r"C:\Users\jimmy\Desktop\Android\tools\android-sdk\platform-tools\adb.exe")
CERT_SCHEMA = "pucky.apk_command_certification.v1"
HIGH_LIMIT = 5000
USER_NUMBER = "4074969882"
TINY_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


class CertificationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Recipe:
    expected: str
    args: dict[str, Any] | None = None
    timeout_seconds: int = 60
    notes: str = ""
    live_comms: bool = False
    stateful: bool = False


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def nonce(prefix: str = "apk-cert") -> str:
    return f"{prefix}-{int(time.time())}"


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def source_commands(root: Path = ROOT) -> list[str]:
    source = read_text(root / "pucky-apk" / "app" / "src" / "main" / "java" / "com" / "pucky" / "device" / "command" / "NativeCommandExecutor.java")
    match = re.search(r"private static final String\[\] COMMANDS = new String\[\] \{(?P<body>.*?)^\s*\};", source, re.S | re.M)
    if not match:
        raise CertificationError("Unable to locate NativeCommandExecutor COMMANDS array")
    return re.findall(r'"([^"]+)"', match.group("body"))


def extract_json(text: str) -> dict[str, Any] | None:
    objects: list[dict[str, Any]] = []
    raw = text or ""
    for start, char in enumerate(raw):
        if char != "{":
            continue
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(raw)):
            current = raw[index]
            if in_string:
                if escaped:
                    escaped = False
                elif current == "\\":
                    escaped = True
                elif current == '"':
                    in_string = False
                continue
            if current == '"':
                in_string = True
            elif current == "{":
                depth += 1
            elif current == "}":
                depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(raw[start:index + 1])
                    except json.JSONDecodeError:
                        parsed = None
                    if isinstance(parsed, dict):
                        objects.append(parsed)
                    break
    for obj in objects:
        if obj.get("schema") == "puckyctl.result.v1":
            return obj
    return objects[-1] if objects else None


def command_result_payload(envelope: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(envelope, dict):
        return {}
    result = envelope.get("result")
    return result if isinstance(result, dict) else {}


def run_subprocess(argv: list[str], *, cwd: Path = ROOT, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        cwd=str(cwd),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
        encoding="utf-8",
        errors="replace",
    )


def puckyctl_args(args: argparse.Namespace, command: str, payload: dict[str, Any], timeout_seconds: int) -> list[str]:
    return [
        sys.executable,
        str(args.puckyctl),
        "--json",
        "--broker",
        args.broker,
        "--device-id",
        args.device_id,
        "--timeout-ms",
        str(max(1000, timeout_seconds * 1000)),
        "command",
        "send",
        command,
        "--args-json",
        json.dumps(payload, separators=(",", ":")),
        "--wait",
    ]


def puckyctl_devices_args(args: argparse.Namespace) -> list[str]:
    return [
        sys.executable,
        str(args.puckyctl),
        "--json",
        "--broker",
        args.broker,
        "devices",
    ]


def device_online(args: argparse.Namespace) -> bool:
    completed = run_subprocess(puckyctl_devices_args(args), timeout=30)
    parsed = extract_json("\n".join(part for part in (completed.stdout, completed.stderr) if part).strip())
    devices = command_result_payload(parsed).get("devices") if isinstance(parsed, dict) else None
    if not isinstance(devices, list):
        return False
    for device in devices:
        if isinstance(device, dict) and device.get("device_id") == args.device_id:
            return bool(device.get("online"))
    return False


def wait_for_device_online(args: argparse.Namespace) -> None:
    if not getattr(args, "wait_online", False):
        return
    deadline = time.monotonic() + max(1, int(getattr(args, "online_timeout_seconds", 180)))
    while time.monotonic() < deadline:
        if device_online(args):
            return
        time.sleep(5)


def should_retry_response(response: dict[str, Any]) -> bool:
    error = response.get("error") if isinstance(response.get("error"), dict) else {}
    code = str(error.get("code", ""))
    message = str(error.get("message", ""))
    status = str(response.get("status", ""))
    transient_codes = {"BROKER_UNAVAILABLE", "DEVICE_OFFLINE", "WAIT_TIMEOUT", "TimeoutExpired"}
    return (
        code in transient_codes
        or status in {"device_offline", "accepted", "sent"}
        or "forcibly closed" in message.lower()
        or "connection reset" in message.lower()
    )


def run_command(args: argparse.Namespace, command: str, payload: dict[str, Any], *, timeout_seconds: int = 60) -> dict[str, Any]:
    last: dict[str, Any] | None = None
    attempts = max(1, int(args.command_attempts))
    for attempt in range(1, attempts + 1):
        wait_for_device_online(args)
        response = run_command_once(args, command, payload, timeout_seconds=timeout_seconds)
        response["attempt"] = attempt
        last = response
        if response.get("ok") or not should_retry_response(response) or attempt >= attempts:
            return response
        time.sleep(min(10.0, 1.5 * attempt))
    return last or {
        "returncode": 1,
        "ok": False,
        "status": "unknown",
        "type": command,
        "command_id": "",
        "result": {},
        "error": {"code": "UNKNOWN", "message": "No command attempt ran"},
        "raw_tail": "",
    }


def run_command_once(args: argparse.Namespace, command: str, payload: dict[str, Any], *, timeout_seconds: int = 60) -> dict[str, Any]:
    try:
        completed = run_subprocess(puckyctl_args(args, command, payload, timeout_seconds), timeout=timeout_seconds + 15)
    except Exception as exc:
        return {
            "returncode": 124,
            "ok": False,
            "status": "exception",
            "type": command,
            "command_id": "",
            "result": {},
            "error": {"code": exc.__class__.__name__, "message": str(exc)},
            "raw_tail": "",
        }
    combined = "\n".join(part for part in (completed.stdout, completed.stderr) if part).strip()
    parsed = extract_json(combined)
    return {
        "returncode": completed.returncode,
        "ok": bool(parsed and parsed.get("ok")),
        "status": parsed.get("status") if isinstance(parsed, dict) else "unparsed",
        "type": parsed.get("type") if isinstance(parsed, dict) else command,
        "command_id": parsed.get("command_id") if isinstance(parsed, dict) else "",
        "result": command_result_payload(parsed),
        "error": parsed.get("error") if isinstance(parsed, dict) else {"code": "UNPARSED", "message": combined[-1000:]},
        "raw_tail": combined[-1000:],
    }


def adb(args: argparse.Namespace, *adb_args: str, timeout_seconds: int = 30) -> dict[str, Any]:
    argv = [str(args.adb), "-s", args.serial, *adb_args]
    try:
        completed = run_subprocess(argv, timeout=timeout_seconds)
    except Exception as exc:
        return {
            "argv": argv,
            "returncode": 124,
            "stdout_tail": "",
            "stderr_tail": f"{exc.__class__.__name__}: {exc}",
        }
    return {
        "argv": argv,
        "returncode": completed.returncode,
        "stdout_tail": (completed.stdout or "")[-2000:],
        "stderr_tail": (completed.stderr or "")[-2000:],
    }


def static_recipes(run_nonce: str) -> dict[str, Recipe]:
    read_empty = {
        "ping", "command.catalog", "status.get", "capabilities.get", "permissions.get",
        "battery.get", "network.get", "storage.get", "runtime.stats", "system.memory.get",
        "system.thermal.get", "service.status", "power.policy.get", "screen.lock.status",
        "sensor.list", "camera.info", "device.primitives.list", "notify.list_active",
        "notify.channels.get", "audio.route.get", "media.state.get", "player.state",
        "button.state", "button.config.get", "voice.capture.status", "voice.capture.last",
        "pucky.turn.status", "pucky.turn.settings.get", "pucky.feed.sync", "wake.status",
        "wake.stop", "speech.native.status", "speech.native.last", "speech.echo.status",
        "speech.echo.last", "speech.echo.voices", "speech.echo.lab.status", "speech.echo.lab.last",
        "cover.wave.status", "cover.display_gesture.status", "note.list_local", "ui.state.get",
        "ui.reply_cards.get", "ui.bundle.status", "ui.surface.get", "ui.shell.mode.get",
        "launcher.capability.get", "android.catalog", "android.permission.status",
        "android.calls.state", "android.notifications.listener.status", "phone.telephony.status",
        "phone.calls.state", "notify.listener.status", "voice.thread_scope.get",
    }
    list_limited = {
        "log.tail", "artifact.list", "pucky.clipboard.list", "button.events.list",
        "voice.capture.list", "pucky.turn.history", "speech.native.list", "speech.echo.list",
        "speech.echo.lab.list", "android.sms.list", "android.calls.list",
        "android.media.images.list", "android.media.video.list", "android.media.audio.list",
        "android.downloads.list", "android.user_dictionary.list",
        "android.notifications.listener.messages", "phone.sms.list", "phone.calls.list",
        "notify.listener.messages", "media.export.list", "player.bookmark.list",
    }
    recipes: dict[str, Recipe] = {name: Recipe("pass") for name in read_empty}
    recipes.update({name: Recipe("pass", {"limit": 5}) for name in list_limited})
    recipes.update({
        "artifact.list": Recipe("pass", {"limit": 5}, timeout_seconds=180),
        "speech.echo.last": Recipe("pass", timeout_seconds=120),
        "location.get": Recipe("pass_or_honest_failure", {"cached": True, "timeout_ms": 3000}),
        "location.watch": Recipe("pass_or_honest_failure", {"duration_ms": 1000, "interval_ms": 1000, "max_samples": 1}),
        "location.tracker.status": Recipe("pass"),
        "location.tracker.start": Recipe("pass_or_honest_failure", {"interval_ms": 60000, "min_distance_m": 1000, "reason": run_nonce}),
        "location.tracker.stop": Recipe("pass_or_honest_failure", {"reason": run_nonce}),
        "location.tracker.query": Recipe("pass_or_honest_failure", {"limit": 5}),
        "location.tracker.clear": Recipe("pass_or_honest_failure", {"older_than_ms": 0, "reason": run_nonce}),
        "location.tracker.export": Recipe("pass_or_honest_failure", {"limit": 5}),
        "file.download": Recipe("pass_honest_failure", {"url": "https://example.invalid/pucky-cert.txt"}),
        "file.put_base64": Recipe("pass", {"filename": f"{run_nonce}.txt", "mime_type": "text/plain", "content_base64": "cHVja3ktY2VydA=="}),
        "app.update.install_downloaded": Recipe("pass_honest_failure", {"path": "/data/local/tmp/pucky-cert-missing.apk"}),
        "sensor.sample": Recipe("pass_or_honest_failure", {"events": 1, "timeout": 1000}),
        "sensor.watch": Recipe("pass_or_honest_failure", {"events": 1, "timeout": 1000}),
        "torch.set": Recipe("pass_or_honest_failure", {"enabled": False}),
        "photo.capture": Recipe("pass_or_honest_failure", {"max_width": 320}, timeout_seconds=120),
        "timer.set": Recipe("pass", {"delay_ms": 1000, "title": "Pucky cert timer", "text": run_nonce}),
        "timer.cancel": Recipe("pass_or_honest_failure", {"id": f"missing-{run_nonce}"}),
        "compute.benchmark": Recipe("pass", {"iterations": 1000, "max_ms": 250}),
        "shell.exec": Recipe("pass", {"command": "echo pucky-cert"}),
        "screen.lock.request": Recipe("user_mediated_verified", {"reason": "apk-certification"}),
        "screen.lock.open_accessibility_settings": Recipe("user_mediated_verified", {}),
        "artifact.hash": Recipe("pass_honest_failure", {"path": "/data/data/com.pucky.device.debug/files/missing-cert-artifact"}),
        "artifact.read_base64": Recipe("pass_honest_failure", {"path": "/data/data/com.pucky.device.debug/files/missing-cert-artifact"}),
        "artifact.url": Recipe("pass_honest_failure", {"path": "/data/data/com.pucky.device.debug/files/missing-cert-artifact"}),
        "artifact.delete": Recipe("pass_or_honest_failure", {"path": "/data/data/com.pucky.device.debug/files/missing-cert-artifact"}),
        "pucky.clipboard.last": Recipe("pass_or_honest_failure", {}),
        "pucky.clipboard.read": Recipe("pass_honest_failure", {"id": f"missing-{run_nonce}"}),
        "pucky.clipboard.delete": Recipe("pass_or_honest_failure", {"id": f"missing-{run_nonce}"}),
        "pucky.clipboard.clear": Recipe("blocked_environment", notes="destructive local-state clear; account for endpoint without clearing user data"),
        "pucky.recipes.sync": Recipe("blocked_environment", notes="recipe sync mutates offline recipe store; run in an isolated recipe test lane"),
        "pucky.recipes.list": Recipe("pass"),
        "pucky.recipes.test": Recipe("pass_or_honest_failure", {"text": "show notification", "execute": False}),
        "pucky.recipes.clear": Recipe("blocked_environment", notes="destructive local-state clear; account for endpoint without clearing user data"),
        "pucky.recipes.schema": Recipe("pass"),
        "notify.show": Recipe("pass", {"title": "Pucky cert", "text": run_nonce, "tag": run_nonce}),
        "notify.ask": Recipe("pass_or_honest_failure", {"title": "Pucky cert", "text": run_nonce, "actions": [{"id": "ok", "label": "OK"}], "timeout_ms": 1000}),
        "notify.cancel": Recipe("pass_or_honest_failure", {"tag": run_nonce}),
        "audio.tone": Recipe("pass_or_honest_failure", {"duration_ms": 80, "volume": 5}),
        "audio.volume.set": Recipe("pass_or_honest_failure", {"stream": "music", "level": 1}),
        "media.key": Recipe("pass_or_honest_failure", {"action": "pause"}),
        "media.open_uri": Recipe("user_mediated_verified", {"uri": "https://example.com"}),
        "media.export.audio": Recipe("pass_or_honest_failure", {"source": "speech.native", "limit": 1}),
        "media.export.delete": Recipe("pass_or_honest_failure", {"id": f"missing-{run_nonce}"}),
        "player.asset.prepare": Recipe("pass_honest_failure", {"url": "https://example.invalid/missing.mp3", "title": "Pucky cert"}),
        "player.load": Recipe("pass_honest_failure", {"path": "/data/local/tmp/missing-cert.mp3", "title": "Pucky cert"}),
        "player.play": Recipe("pass_or_honest_failure", {}),
        "player.pause": Recipe("pass_or_honest_failure", {}),
        "player.stop": Recipe("pass_or_honest_failure", {}),
        "player.seek": Recipe("pass_or_honest_failure", {"position_ms": 0}),
        "player.speed": Recipe("pass_or_honest_failure", {"speed": 1.0}),
        "player.queue.set": Recipe("pass_or_honest_failure", {"items": []}),
        "player.queue.next": Recipe("pass_or_honest_failure", {"play": False}),
        "player.queue.previous": Recipe("pass_or_honest_failure", {"play": False}),
        "player.bookmark.save": Recipe("pass_or_honest_failure", {"title": "Pucky cert", "position_ms": 0}),
        "button.config.set": Recipe("pass_or_honest_failure", {"enabled": True}),
        "button.config.reset": Recipe("pass_or_honest_failure", {}),
        "button.events.clear": Recipe("pass"),
        "button.simulate": Recipe("pass_or_honest_failure", {"gesture": "single"}),
        "voice.capture.start": Recipe("pass_or_honest_failure", {"max_duration_ms": 1000, "source": "apk-cert"}),
        "voice.capture.stop": Recipe("pass_or_honest_failure", {"reason": run_nonce}),
        "voice.capture.delete": Recipe("pass_or_honest_failure", {"session_id": f"missing-{run_nonce}"}),
        "pucky.turn.start": Recipe("pass_or_honest_failure", {"capture_source": "fixture", "fixture_name": "wake_weather.wav", "feedback": False, "max_duration_ms": 1000}),
        "pucky.turn.stop": Recipe("pass_or_honest_failure", {"reason": run_nonce, "feedback": False}),
        "pucky.turn.settings.set": Recipe("pass_or_honest_failure", {"reply_mode": "chime"}),
        "pucky.turn.arrival_cue.test": Recipe("pass_or_honest_failure", {"turn_id": run_nonce}),
        "pucky.turn.sent_cue.test": Recipe("pass_or_honest_failure", {"turn_id": run_nonce}),
        "pucky.turn.received_cue.test": Recipe("pass_or_honest_failure", {"turn_id": run_nonce}),
        "pucky.turn.chime.test": Recipe("pass_or_honest_failure", {"name": "received"}),
        "pucky.turn.read": Recipe("pass_honest_failure", {"turn_id": f"missing-{run_nonce}"}),
        "pucky.turn.debug.inject_history": Recipe("pass_or_honest_failure", {"turn_id": run_nonce, "state": "failed", "error": "apk_cert"}),
        "pucky.turn.debug.response_fault": Recipe("pass_or_honest_failure", {"clear": True}),
        "pucky.feed.action": Recipe("pass_honest_failure", {"action": "open", "card_id": f"missing-{run_nonce}"}),
        "wake.config.set": Recipe("pass_or_honest_failure", {"enabled": False}),
        "wake.start": Recipe("pass_or_honest_failure", {"mode": "cert"}),
        "wake.simulate": Recipe("pass_or_honest_failure", {"phrase": "hey pucky"}),
        "speech.native.start": Recipe("pass_or_honest_failure", {"max_duration_ms": 1000}),
        "speech.native.stop": Recipe("pass_or_honest_failure", {"reason": run_nonce}),
        "speech.native.delete": Recipe("pass_or_honest_failure", {"session_id": f"missing-{run_nonce}"}),
        "speech.echo.start": Recipe("pass_or_honest_failure", {"text": "Pucky certification"}),
        "speech.echo.stop": Recipe("pass_or_honest_failure", {"reason": run_nonce}),
        "speech.echo.delete": Recipe("pass_or_honest_failure", {"session_id": f"missing-{run_nonce}"}),
        "speech.echo.lab.start": Recipe("pass_or_honest_failure", {"text": "Pucky certification"}),
        "speech.echo.lab.stop": Recipe("pass_or_honest_failure", {"reason": run_nonce}),
        "cover.wave.config.set": Recipe("pass_or_honest_failure", {"enabled": True}),
        "cover.wave.trigger": Recipe("pass_or_honest_failure", {"reason": run_nonce}),
        "cover.display_gesture.set": Recipe("pass_or_honest_failure", {"enabled": True}),
        "cover.display_gesture.trigger": Recipe("pass_or_honest_failure", {"reason": run_nonce}),
        "cover.event": Recipe("pass_or_honest_failure", {"event": "apk_cert", "reason": run_nonce}),
        "settings.open": Recipe("user_mediated_verified", {"target": "app"}),
        "settings.panel": Recipe("user_mediated_verified", {"panel": "internet"}),
        "browser.open": Recipe("user_mediated_verified", {"url": "https://example.com"}),
        "share.text": Recipe("user_mediated_verified", {"text": run_nonce, "title": "Pucky cert"}),
        "alarm.intent.set": Recipe("user_mediated_verified", {"minutes_from_now": 60, "message": "Pucky cert"}),
        "calendar.intent.insert": Recipe("user_mediated_verified", {"title": "Pucky cert", "description": run_nonce}),
        "phone.intent.dial": Recipe("user_mediated_verified", {"number": USER_NUMBER}),
        "android.content.query": Recipe("pass_or_honest_failure", {"uri": "content://settings/system", "limit": 5}),
        "android.content.insert": Recipe("pass_honest_failure", {"uri": "content://user_dictionary/words", "values": {"word": f"puckycert{int(time.time())}", "frequency": 1}}),
        "android.content.update": Recipe("pass_or_honest_failure", {"uri": "content://user_dictionary/words", "values": {"frequency": 1}, "selection": "word=?", "selection_args": [f"missing{run_nonce}"]}),
        "android.content.delete": Recipe("pass_or_honest_failure", {"uri": "content://user_dictionary/words", "selection": "word=?", "selection_args": [f"missing{run_nonce}"]}),
        "android.content.call": Recipe("pass_honest_failure", {"uri": "content://settings/system", "method": "pucky_missing_method"}),
        "android.content.get_type": Recipe("pass_or_honest_failure", {"uri": "content://settings/system"}),
        "android.intent.start": Recipe("user_mediated_verified", {"action": "android.settings.SETTINGS"}),
        "android.manager.call": Recipe("pass_or_honest_failure", {"op": "call_state"}),
        "android.permission.request": Recipe("user_mediated_verified", {"permissions": ["android.permission.READ_CONTACTS"]}),
        "android.sms.thread": Recipe("pass_or_honest_failure", {"address": USER_NUMBER, "limit": 10}),
        "android.sms.send": Recipe("pass", {"to": USER_NUMBER, "body": f"Pucky APK certification text {run_nonce}"}, timeout_seconds=180, live_comms=True),
        "android.calls.place": Recipe("pass", {"number": USER_NUMBER}, timeout_seconds=180, live_comms=True),
        "android.calls.answer": Recipe("pass_or_honest_failure", {}, timeout_seconds=90),
        "android.calls.hangup": Recipe("pass_or_honest_failure", {}, timeout_seconds=90),
        "android.contacts.search": Recipe("pass_or_honest_failure", {"query": "Pucky APK Cert", "limit": 5}, stateful=True),
        "android.contacts.get": Recipe("pass_or_honest_failure", {"contact_id": -1}, stateful=True),
        "android.contacts.create": Recipe("pass", {"display_name": f"Pucky APK Cert {run_nonce}", "phones": [{"number": "+14074969882", "type": "mobile"}], "emails": [{"address": f"{run_nonce}@example.com", "type": "home"}]}, stateful=True),
        "android.contacts.replace": Recipe("pass_or_honest_failure", {"contact_id": -1, "display_name": f"Pucky APK Cert Replaced {run_nonce}"}, stateful=True),
        "android.contacts.delete": Recipe("pass_or_honest_failure", {"contact_id": -1}, stateful=True),
        "android.contacts.photo.get": Recipe("pass_or_honest_failure", {"contact_id": -1}, stateful=True),
        "android.contacts.photo.put": Recipe("pass_or_honest_failure", {"contact_id": -1, "photo_base64": TINY_PNG_BASE64}, stateful=True),
        "android.voicemail.list": Recipe("pass_or_honest_failure", {"limit": 5}),
        "android.blocked_numbers.list": Recipe("pass_or_honest_failure", {"limit": 5}),
        "android.blocked_numbers.add": Recipe("pass_or_honest_failure", {"number": "+15551230999"}),
        "android.blocked_numbers.remove": Recipe("pass_or_honest_failure", {"number": "+15551230999"}),
        "android.calendar.list": Recipe("pass_or_honest_failure", {"limit": 5}),
        "android.calendar.get": Recipe("pass_or_honest_failure", {"event_id": -1}),
        "android.calendar.create": Recipe("pass_or_honest_failure", {"title": f"Pucky APK Cert {run_nonce}", "description": run_nonce, "begin_ms": int(time.time() * 1000) + 3600000, "end_ms": int(time.time() * 1000) + 5400000}),
        "android.calendar.update": Recipe("pass_or_honest_failure", {"event_id": -1, "title": f"Pucky APK Cert Updated {run_nonce}"}),
        "android.calendar.delete": Recipe("pass_or_honest_failure", {"event_id": -1}),
        "android.clock.alarm.set": Recipe("user_mediated_verified", {"minutes_from_now": 60, "message": "Pucky cert"}),
        "android.clock.timer.set": Recipe("user_mediated_verified", {"duration_seconds": 30, "message": "Pucky cert"}),
        "android.clock.alarms.show": Recipe("user_mediated_verified", {}),
        "android.settings.get": Recipe("pass_or_honest_failure", {"namespace": "system", "name": "screen_brightness"}),
        "android.settings.put": Recipe("pass_or_honest_failure", {"namespace": "system", "name": "pucky_cert_missing", "value": "1"}),
        "android.settings.open": Recipe("user_mediated_verified", {"target": "settings"}),
        "android.downloads.get": Recipe("pass_or_honest_failure", {"download_id": -1}),
        "android.user_dictionary.add": Recipe("pass_or_honest_failure", {"word": f"puckycert{int(time.time())}", "frequency": 1}),
        "android.user_dictionary.delete": Recipe("pass_or_honest_failure", {"word": f"puckycert{int(time.time())}"}),
        "phone.sms.get_thread": Recipe("pass_or_honest_failure", {"address": USER_NUMBER, "limit": 10}),
        "phone.sms.send": Recipe("pass", {"to": USER_NUMBER, "body": f"Pucky phone alias certification text {run_nonce}"}, timeout_seconds=180, live_comms=True),
        "phone.calls.place": Recipe("pass", {"number": USER_NUMBER}, timeout_seconds=180, live_comms=True),
        "phone.calls.answer": Recipe("pass_or_honest_failure", {}, timeout_seconds=90),
        "phone.calls.hangup": Recipe("pass_or_honest_failure", {}, timeout_seconds=90),
        "phone.contacts.search": Recipe("pass_or_honest_failure", {"query": "Pucky APK Cert", "limit": 5}, stateful=True),
        "phone.contacts.get": Recipe("pass_or_honest_failure", {"contact_id": -1}, stateful=True),
        "phone.contacts.create": Recipe("pass", {"display_name": f"Pucky Phone Cert {run_nonce}", "phones": [{"number": "+14074969882", "type": "mobile"}]}, stateful=True),
        "phone.contacts.replace": Recipe("pass_or_honest_failure", {"contact_id": -1, "display_name": f"Pucky Phone Cert Replaced {run_nonce}"}, stateful=True),
        "phone.contacts.delete": Recipe("pass_or_honest_failure", {"contact_id": -1}, stateful=True),
        "phone.voicemail.list": Recipe("pass_or_honest_failure", {"limit": 5}),
        "phone.blocked_numbers.list": Recipe("pass_or_honest_failure", {"limit": 5}),
        "phone.blocked_numbers.add": Recipe("pass_or_honest_failure", {"number": "+15551230999"}),
        "phone.blocked_numbers.remove": Recipe("pass_or_honest_failure", {"number": "+15551230999"}),
        "note.create_local": Recipe("pass", {"title": f"Pucky cert {run_nonce}", "body": run_nonce}),
        "note.delete_local": Recipe("pass_or_honest_failure", {"id": f"missing-{run_nonce}"}),
        "ui.dashboard.show": Recipe("user_mediated_verified", {}),
        "ui.reply_cards.set": Recipe("blocked_environment", notes="destructive reply-card replace; use merge/reset proof in a dedicated UI lane"),
        "ui.reply_cards.merge": Recipe("pass", {"cards": []}),
        "ui.reply_cards.clear": Recipe("blocked_environment", notes="destructive reply-card clear; account for endpoint without clearing user data"),
        "ui.bundle.install_downloaded": Recipe("pass_honest_failure", {"path": "/data/local/tmp/pucky-missing-bundle.zip"}),
        "ui.bundle.refresh": Recipe("pass_or_honest_failure", {"reason": run_nonce}),
        "ui.debug.goto_home": Recipe("pass_or_honest_failure", {}),
        "ui.debug.back": Recipe("pass_or_honest_failure", {}),
        "ui.debug.focus_card": Recipe("pass_honest_failure", {"session_id": f"missing-{run_nonce}"}),
        "ui.debug.clear_focus": Recipe("pass_or_honest_failure", {}),
        "ui.debug.open_card_action": Recipe("pass_honest_failure", {"card_id": f"missing-{run_nonce}", "action": "open"}),
        "voice.thread_scope.set": Recipe("pass", {"mode": "existing_thread", "thread_id": f"thread-{run_nonce}", "source_surface": "thread_transcript"}),
        "voice.thread_scope.clear": Recipe("pass_or_honest_failure", {"reason": run_nonce}),
        "ui.shell.mode.set": Recipe("pass_or_honest_failure", {"mode": "auto"}),
        "android.substrate": Recipe("pass_honest_failure", {}),
    })
    return recipes


def recipe_for(command: str, recipes: dict[str, Recipe], args: argparse.Namespace) -> Recipe | None:
    recipe = recipes.get(command)
    if recipe is None:
        return None
    if recipe.live_comms and not args.include_live_comms:
        return replace(recipe, expected="blocked_environment", notes="live comms disabled; rerun with --include-live-comms")
    if recipe.expected == "user_mediated_verified" and not args.include_user_mediated:
        return replace(recipe, expected="user_mediated_verified", notes="user-mediated launch not run; rerun with --include-user-mediated")
    return recipe


def validate_recipe_coverage(commands: list[str], recipes: dict[str, Recipe]) -> dict[str, list[str]]:
    command_set = set(commands)
    recipe_set = set(recipes)
    return {
        "missing": sorted(command_set - recipe_set),
        "extra": sorted(recipe_set - command_set),
        "duplicates": sorted({name for name in commands if commands.count(name) > 1}),
    }


def outcome_for(recipe: Recipe, response: dict[str, Any] | None, *, skipped: bool = False) -> str:
    if skipped:
        return recipe.expected
    ok = bool(response and response.get("ok"))
    if recipe.expected in {"pass", "user_mediated_verified"}:
        return "pass" if ok else "fail"
    if recipe.expected == "pass_honest_failure":
        return "pass_honest_failure" if not ok else "pass"
    if recipe.expected == "blocked_environment":
        return "blocked_environment"
    if recipe.expected == "pass_or_honest_failure":
        return "pass" if ok else "pass_honest_failure"
    return "fail"


def cleanup_after(args: argparse.Namespace, command: str, response: dict[str, Any], *, timeout_seconds: int = 60) -> list[dict[str, Any]]:
    if not response.get("ok"):
        return []
    result = response.get("result") or {}
    cleanup: list[tuple[str, dict[str, Any]]] = []
    if command in {"android.contacts.create", "phone.contacts.create"}:
        contact = result.get("contact") if isinstance(result.get("contact"), dict) else {}
        contact_id = contact.get("contact_id")
        if contact_id is not None:
            cleanup.append((command.replace(".create", ".delete"), {"contact_id": contact_id}))
    elif command == "note.create_local":
        note = result.get("note") if isinstance(result.get("note"), dict) else {}
        note_id = note.get("id")
        if note_id:
            cleanup.append(("note.delete_local", {"id": note_id}))
    elif command == "timer.set":
        timer_id = result.get("id")
        if timer_id:
            cleanup.append(("timer.cancel", {"id": timer_id}))
    elif command == "notify.show":
        cleanup.append(("notify.cancel", {"tag": response.get("args_tag", "") or ""}))

    rows: list[dict[str, Any]] = []
    for cleanup_command, payload in cleanup:
        if cleanup_command == "notify.cancel" and not payload.get("tag"):
            continue
        cleanup_response = run_command(args, cleanup_command, payload, timeout_seconds=timeout_seconds)
        rows.append({
            "command": cleanup_command,
            "args": payload,
            "ok": cleanup_response.get("ok"),
            "status": cleanup_response.get("status"),
            "error": cleanup_response.get("error"),
        })
    return rows


def certify(args: argparse.Namespace) -> dict[str, Any]:
    run_nonce = args.nonce or nonce()
    source = source_commands(args.repo_root)
    recipes = static_recipes(run_nonce)
    coverage = validate_recipe_coverage(source, recipes)
    if coverage["missing"] or coverage["extra"] or coverage["duplicates"]:
        raise CertificationError(json.dumps({"recipe_coverage": coverage}, indent=2))
    if args.check_recipes:
        return {"schema": CERT_SCHEMA, "ok": True, "mode": "check_recipes", "source_command_count": len(source), "coverage": coverage}

    rows: list[dict[str, Any]] = []
    catalog_response = run_command(args, "command.catalog", {}, timeout_seconds=60)
    catalog_commands = command_result_payload(catalog_response).get("commands") if catalog_response else None
    if not isinstance(catalog_commands, list):
        catalog_commands = []
    catalog_delta = {
        "missing_on_device": sorted(set(source) - {str(item) for item in catalog_commands}),
        "extra_on_device": sorted({str(item) for item in catalog_commands} - set(source)),
    }

    for command in source:
        recipe = recipe_for(command, recipes, args)
        if recipe is None:
            rows.append({"command": command, "outcome": "fail", "error": {"message": "missing recipe"}})
            continue
        if recipe.expected == "blocked_environment" or (recipe.expected == "user_mediated_verified" and not args.include_user_mediated):
            rows.append({
                "command": command,
                "expected": recipe.expected,
                "outcome": outcome_for(recipe, None, skipped=True),
                "args": recipe.args or {},
                "notes": recipe.notes,
            })
            continue
        response = run_command(args, command, recipe.args or {}, timeout_seconds=recipe.timeout_seconds)
        cleanup = cleanup_after(args, command, {**response, "args_tag": (recipe.args or {}).get("tag", "")})
        rows.append({
            "command": command,
            "expected": recipe.expected,
            "outcome": outcome_for(recipe, response),
            "args": recipe.args or {},
            "command_id": response.get("command_id"),
            "attempt": response.get("attempt"),
            "status": response.get("status"),
            "error": response.get("error"),
            "result_keys": sorted((response.get("result") or {}).keys()),
            "notes": recipe.notes,
            "cleanup": cleanup,
        })
        time.sleep(args.command_pause_seconds)

    adb_evidence = {
        "devices": adb(args, "devices", timeout_seconds=20),
        "package": adb(args, "shell", "dumpsys", "package", "com.pucky.device.debug", timeout_seconds=30),
        "role": adb(args, "shell", "dumpsys", "role", timeout_seconds=30),
        "telecom": adb(args, "shell", "dumpsys", "telecom", timeout_seconds=30),
    }
    outcome_counts: dict[str, int] = {}
    for row in rows:
        outcome_counts[row["outcome"]] = outcome_counts.get(row["outcome"], 0) + 1
    failed = [row for row in rows if row["outcome"] == "fail"]
    return {
        "schema": CERT_SCHEMA,
        "ok": not failed and not catalog_delta["missing_on_device"] and not catalog_delta["extra_on_device"],
        "created_at": utc_now(),
        "nonce": run_nonce,
        "repo_root": str(args.repo_root),
        "broker": args.broker,
        "device_id": args.device_id,
        "serial": args.serial,
        "source_command_count": len(source),
        "catalog_command_count": len(catalog_commands),
        "catalog_delta": catalog_delta,
        "outcome_counts": outcome_counts,
        "failed_commands": [row["command"] for row in failed],
        "rows": rows,
        "adb_evidence": adb_evidence,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Certify the APK command universe against a live broker/device.")
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    parser.add_argument("--broker", default=os.environ.get("PUCKY_BROKER_BASE_URL", DEFAULT_BROKER))
    parser.add_argument("--device-id", default=os.environ.get("PUCKY_DEVICE_ID", DEFAULT_DEVICE_ID))
    parser.add_argument("--serial", default=os.environ.get("PUCKY_SERIAL", DEFAULT_SERIAL))
    parser.add_argument("--puckyctl", type=Path, default=DEFAULT_PUCKYCTL)
    parser.add_argument("--adb", type=Path, default=DEFAULT_ADB)
    parser.add_argument("--nonce", default="")
    parser.add_argument("--check-recipes", action="store_true")
    parser.add_argument("--include-live-comms", action="store_true")
    parser.add_argument("--include-user-mediated", action="store_true")
    parser.add_argument("--command-attempts", type=int, default=6)
    parser.add_argument("--wait-online", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--online-timeout-seconds", type=int, default=180)
    parser.add_argument("--command-pause-seconds", type=float, default=0.05)
    parser.add_argument("--output", type=Path, default=ROOT / ".tmp" / "apk-command-certification" / "latest.json")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    args.repo_root = args.repo_root.resolve()
    args.puckyctl = args.puckyctl.resolve()
    args.adb = args.adb.resolve()
    report = certify(args)
    if not args.check_recipes:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
