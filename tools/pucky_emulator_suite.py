from __future__ import annotations

import argparse
import base64
from copy import deepcopy
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
import tempfile
import time
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.attachment_manifest import normalize_attachments
from pucky_vm.server import Config, PuckyVoiceService, make_handler, reset_broker_for_tests
from tools.pucky_emulator_support import bootstrap as emu_bootstrap_support
from tools.pucky_emulator_support import capture as emu_capture_support
from tools.pucky_emulator_support import display as emu_display_support
from tools.pucky_emulator_support import state as emu_state_support
from tools.pucky_emulator_support import vm as emu_vm_support

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
DEFAULT_ACTIVITY = "com.pucky.device.MainActivity"
DEFAULT_PERMISSION_CONTROLLER_PACKAGE = "com.google.android.permissioncontroller"
DEFAULT_USERDATA_PARTITION_MB = "768"
DEFAULT_USERDATA_PARTITION_SIZE = DEFAULT_USERDATA_PARTITION_MB + "M"
DEFAULT_SDCARD_SIZE = "64M"
DEFAULT_APK = ROOT / "pucky-apk" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
DEFAULT_PUCKYCTL = ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py"
DEFAULT_FAKE_BROKER = ROOT / "pucky-apk" / "fake-broker"
DEFAULT_TURN_URL = "https://pucky.fly.dev/api/turn"
DEFAULT_RECIPE_BUNDLE = ROOT / "pucky_vm" / "recipes" / "volume_down_lab_dev_bundle.json"
BASE_DIR = ROOT / ".tmp" / "pucky-emulator"
RUNS_DIR = ROOT / ".tmp" / "pucky-emulator-runs"
MIN_RECOMMENDED_AVD_FREE_GB = 8.0
INSTALL_SERVICES_SETTLE_SECONDS = 45.0
EMULATOR_RUNTIME_PERMISSIONS = (
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.READ_SMS",
    "android.permission.SEND_SMS",
    "android.permission.RECEIVE_SMS",
    "android.permission.CALL_PHONE",
    "android.permission.ANSWER_PHONE_CALLS",
    "android.permission.READ_PHONE_STATE",
    "android.permission.READ_CALL_LOG",
    "android.permission.WRITE_CALL_LOG",
    "android.permission.READ_CONTACTS",
    "android.permission.WRITE_CONTACTS",
    "android.permission.GET_ACCOUNTS",
    "android.permission.READ_CALENDAR",
    "android.permission.WRITE_CALENDAR",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_AUDIO",
    "android.permission.READ_EXTERNAL_STORAGE",
    "android.permission.CAMERA",
    "android.permission.RECORD_AUDIO",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
)
DISPLAYABLE_VIEWER_TYPES = {"html_iframe", "table", "text", "image_gallery", "video_player", "audio_player", "document_html"}
DISPLAYABLE_VIEWER_PRIORITY = {
    "html_iframe": 60,
    "document_html": 55,
    "table": 50,
    "image_gallery": 45,
    "video_player": 40,
    "audio_player": 35,
    "text": 30,
}
NODE_BOUNDS_RE = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
WAKE_TURN_FIXTURE_START_DELAY_MS = 1200
WALKIE_THREAD_FIXTURE_START_DELAY_MS = 400
PAGE_CONTINUATION_FIXTURE_START_DELAY_MS = 1200
ATTACHMENT_CONTINUATION_FIXTURE_START_DELAY_MS = 400
HISTORY_RETENTION_FIXTURE_START_DELAY_MS = 400
FINAL_BOSS_FIXTURE_START_DELAY_MS = 1200
FINAL_BOSS_SPEECH_START_TIMEOUT_MS = 12000
FINAL_BOSS_MIN_DELAY_MS_A = 60000
FINAL_BOSS_MIN_DELAY_MS_NEW = 35000
FINAL_BOSS_MIN_DELAY_MS_B = 1000
WALKIE_THREAD_LAB_RESULT_SCHEMA = "pucky.walkie_thread_lab.v1"
WALKIE_THREAD_LAB_SCENARIOS = (
    "transcript-continuation",
    "page-continuation",
    "attachment-continuation",
    "negative-home",
    "history-retention",
    "final-boss-overlap",
    "all",
)
WALKIE_THREAD_LAB_ALL_SCENARIOS = (
    "transcript-continuation",
    "page-continuation",
    "attachment-continuation",
    "negative-home",
    "history-retention",
    "final-boss-overlap",
)
WALKIE_THREAD_LAB_EVIDENCE_FILES = (
    "home-before.png",
    "before-send.png",
    "pending.png",
    "transcript-known.png",
    "reply-complete.png",
    "ui.surface.home-before.json",
    "ui.surface.before.json",
    "ui.surface.pending.json",
    "ui.surface.transcript.json",
    "ui.surface.final.json",
    "ui.surface.attachment.json",
    "voice.thread_scope.before.json",
    "turn.timing.json",
    "pucky.turn.history.json",
    "pucky.turn.read.<turn_id>.json",
    "ui.reply_cards.before.json",
    "ui.reply_cards.final.json",
    "proof.json",
)
WALKIE_THREAD_LAB_DESCRIPTION = (
    "Run the emulator Walkie thread-continuation certification scenarios."
)


def require_walkie_proof_passes(proof: dict[str, Any]) -> None:
    passes = proof.get("passes") if isinstance(proof.get("passes"), dict) else {}
    failed = [str(name) for name, ok in passes.items() if not bool(ok)]
    if failed:
        scenario = str(proof.get("scenario") or "walkie-thread-lab")
        raise SuiteError(f"{scenario} proof failed: {', '.join(failed)}")


def aggregate_walkie_thread_lab_proof(results: list[dict[str, Any]]) -> dict[str, Any]:
    passes: dict[str, bool] = {}
    for result in results:
        scenario = str(result.get("scenario") or "").strip()
        if not scenario:
            continue
        proof = result.get("proof") if isinstance(result.get("proof"), dict) else {}
        scenario_passes = proof.get("passes") if isinstance(proof.get("passes"), dict) else {}
        passes[scenario] = bool(scenario_passes) and all(bool(value) for value in scenario_passes.values())
    return {
        "schema": WALKIE_THREAD_LAB_RESULT_SCHEMA,
        "scenario": "all",
        "passes": passes,
    }


def write_walkie_thread_lab_aggregate_proof(config: SlotConfig, results: list[dict[str, Any]]) -> dict[str, Any]:
    proof = aggregate_walkie_thread_lab_proof(results)
    write_json_file(scenario_evidence_dir(config, "all") / "proof.json", proof)
    require_walkie_proof_passes(proof)
    return proof


SYNTHETIC_REPLY_CARD_COMMAND_BUDGET = 7000
DIRECT_PHOTO_CAPTURE_TIMEOUT_MS = 15000
DIRECT_PHOTO_CAPTURE_RETRY_ATTEMPTS = 2
PROVISION_PERMISSION_GRANTS = (
    "android.permission.RECORD_AUDIO",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.CAMERA",
    "android.permission.READ_CALENDAR",
    "android.permission.WRITE_CALENDAR",
    "android.permission.READ_MEDIA_IMAGES",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_MEDIA_AUDIO",
)
PERMISSION_ALLOW_PATTERNS = (
    r"^While using the app$",
    r"^Only this time$",
    r"^Allow$",
)
DOCUMENT_VIEWER_SOURCE_KEYS = (
    "viewer_src",
    "viewer_url",
    "viewer_path",
    "html_viewer_path",
    "document_html_path",
    "viewer_artifact",
    "html_artifact",
    "document_html_artifact",
)
WALKIE_THREAD_TRANSPORT_FIXTURES = {
    "thread_continue": "wake_weather",
    "file_revise": "wake_weather",
    "fresh_thread": "wake_weather",
    "thread_bravo": "wake_weather",
    "thread_alpha": "wake_weather",
}


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


class FixtureAwareSTT:
    def __init__(self) -> None:
        self.transcripts_by_hash: dict[str, str] = {}

    def register(self, audio_path: Path, transcript: str) -> None:
        self.transcripts_by_hash[file_sha256(audio_path)] = str(transcript)

    def transcribe(self, audio: bytes, content_type: str) -> str:
        digest = hashlib.sha256(audio).hexdigest()
        return self.transcripts_by_hash.get(digest, "Unmapped fixture transcript")


class HarnessTTS:
    def synthesize(self, text: str) -> tuple[bytes, str]:
        return wav_bytes(1200), "audio/wav"


class WalkieThreadScriptedCodex:
    ready = True

    def __init__(self, *, invalid_thread_ids: set[str] | None = None) -> None:
        self.invalid_thread_ids = set(invalid_thread_ids or set())
        self.turn_requests: list[dict[str, Any]] = []
        self.renamed_titles: list[dict[str, str]] = []
        self.next_thread_number = 100
        self.thread_id = "thread-bootstrap"
        self.last_turn_routing = {
            "requested_thread_id": "",
            "used_thread_id": self.thread_id,
            "thread_mode": "new",
            "reused_existing_thread": False,
            "fallback_reason": "",
        }

    def start(self) -> None:
        return None

    def send_turn(self, text: str, *, thread_id: str | None = None):
        requested_thread_id = str(thread_id or "").strip()
        used_thread_id = requested_thread_id or f"thread-{self.next_thread_number}"
        fallback_reason = ""
        thread_mode = "existing" if requested_thread_id else "new"
        if requested_thread_id in self.invalid_thread_ids:
            fallback_reason = "thread_not_found"
            used_thread_id = f"thread-{self.next_thread_number}"
            thread_mode = "new"
            self.next_thread_number += 1
        elif not requested_thread_id:
            self.next_thread_number += 1
        self.thread_id = used_thread_id
        title = self._title_for(text, requested_thread_id)
        icon = self._icon_for(text, requested_thread_id)
        reply_text = self._reply_text_for(text, requested_thread_id, used_thread_id)
        self.turn_requests.append(
            {
                "text": text,
                "requested_thread_id": requested_thread_id,
                "used_thread_id": used_thread_id,
                "thread_mode": thread_mode,
                "fallback_reason": fallback_reason,
                "title": title,
                "icon": icon,
            }
        )
        self.last_turn_routing = {
            "requested_thread_id": requested_thread_id,
            "used_thread_id": used_thread_id,
            "thread_mode": thread_mode,
            "reused_existing_thread": bool(requested_thread_id and thread_mode == "existing"),
            "fallback_reason": fallback_reason,
        }
        return type(
            "HarnessTurnResult",
            (),
            {
                "reply_text": json.dumps(
                    {
                        "reply_text": reply_text,
                        "card_title": title,
                        "card_icon": icon,
                        "html": None,
                    }
                ),
                "used_thread_id": used_thread_id,
                "requested_thread_id": requested_thread_id,
                "thread_mode": thread_mode,
                "reused_existing_thread": bool(requested_thread_id and thread_mode == "existing"),
                "fallback_reason": fallback_reason,
            },
        )()

    def set_thread_title(self, title: str, *, thread_id: str | None = None) -> None:
        self.renamed_titles.append({"title": title, "thread_id": str(thread_id or self.thread_id)})
        if thread_id:
            self.thread_id = str(thread_id)

    def thread_origin(self, thread_id: str | None = None, *, retries: int = 5, delay: float = 0.15) -> dict[str, str]:
        resolved_thread_id = str(thread_id or self.thread_id)
        title = next(
            (item["title"] for item in reversed(self.renamed_titles) if item["thread_id"] == resolved_thread_id),
            resolved_thread_id,
        )
        return {
            "runtime": "codex",
            "thread_id": resolved_thread_id,
            "thread_title": title,
            "rollout_path": f"/data/home/codex/sessions/{resolved_thread_id}.jsonl",
            "source": "vscode",
            "model": "gpt-5.5",
            "model_provider": "openai",
            "reasoning_effort": "high",
            "sandbox_policy": "danger-full-access",
            "approval_mode": "never",
        }

    @staticmethod
    def _title_for(text: str, requested_thread_id: str) -> str:
        lowered = text.lower()
        if "alpha" in lowered:
            return "Thread A"
        if "bravo" in lowered or "thread b" in lowered:
            return "Thread B"
        if "fresh" in lowered or not requested_thread_id:
            return "Fresh Thread"
        if "file" in lowered:
            return "File Revision"
        return "Thread Continue"

    @staticmethod
    def _icon_for(text: str, requested_thread_id: str) -> str:
        lowered = text.lower()
        if "file" in lowered or "bravo" in lowered:
            return "calendar"
        if "fresh" in lowered or not requested_thread_id:
            return "bolt"
        return "attachment"

    @staticmethod
    def _reply_text_for(text: str, requested_thread_id: str, used_thread_id: str) -> str:
        if requested_thread_id:
            return f"Continued {used_thread_id}: {text}"
        return f"Started {used_thread_id}: {text}"


class LocalProofTurnServer:
    def __init__(self, *, proof_reply_delay_enabled: bool = True) -> None:
        self.tmp = tempfile.TemporaryDirectory(prefix="pucky-emulator-proof-")
        self.broker = reset_broker_for_tests(str(Path(self.tmp.name) / "broker.sqlite3"))
        self.stt = FixtureAwareSTT()
        self.tts = HarnessTTS()
        self.codex = WalkieThreadScriptedCodex()
        self.service = PuckyVoiceService(
            Config(
                host="127.0.0.1",
                port=0,
                pucky_api_token="dev-token",
                deepgram_api_key="dg",
                deepinfra_api_key="di",
                max_audio_bytes=1024 * 1024,
                max_html_bytes=512 * 1024,
                max_attachment_count=6,
                max_attachment_bytes=8 * 1024 * 1024,
                max_attachment_viewer_bytes=16 * 1024 * 1024,
                tts_voice="af_heart",
                tts_response_format="wav",
                tts_speed=1.0,
                codex_command=["codex", "app-server", "--listen", "stdio://"],
                codex_cwd=None,
                codex_startup_timeout=1.0,
                codex_turn_timeout=1.0,
                developer_instructions="emulator gauntlet",
                feed_db_path=str(Path(self.tmp.name) / "feed.sqlite3"),
                codex_sandbox="danger-full-access",
                codex_approval_policy="never",
                codex_model="gpt-5.5",
                codex_reasoning_effort="high",
                composio_api_key="",
                composio_base_url="",
                composio_default_user_id="",
                connect_portal_secret="",
                connect_portal_ttl_seconds=3600,
                composio_default_auth_mode="browser",
                proof_reply_delay_enabled=proof_reply_delay_enabled,
            ),
            stt=self.stt,
            tts=self.tts,
            codex=self.codex,
        )
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.service))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.base_url = f"http://127.0.0.1:{self.server.server_port}/api/turn"

    def start(self) -> None:
        self.thread.start()

    def register_fixture(self, audio_path: Path, transcript: str) -> None:
        self.stt.register(audio_path, transcript)

    def turn_status_snapshot(self, turn_id: str) -> dict[str, Any]:
        with self.service._turn_status_lock:
            payload = dict(self.service._turn_statuses.get(str(turn_id), {}))
        return payload

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.service.feed.close()
        if getattr(self.broker, "DB", None) is not None:
            self.broker.DB.close()
            self.broker.DB = None
        self.broker.DEVICES.clear()
        self.tmp.cleanup()


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


def run_git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=root,
        text=True,
        capture_output=True,
        check=True,
    ).stdout.strip()


def local_git_state(root: Path = ROOT) -> dict[str, object]:
    return {
        "branch": run_git(root, "rev-parse", "--abbrev-ref", "HEAD"),
        "head": run_git(root, "rev-parse", "HEAD"),
        "upstream": run_git(root, "rev-parse", "@{u}"),
        "dirty": bool(run_git(root, "status", "--short")),
    }


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
    return emu_bootstrap_support.sdk_env(
        args,
        config,
        error_cls=SuiteError,
    )


def avdmanager_create_command(args: argparse.Namespace, config: SlotConfig) -> list[str]:
    return emu_bootstrap_support.avdmanager_create_command(
        args,
        config,
        sdcard_size=DEFAULT_SDCARD_SIZE,
    )


def avd_artifacts_exist(config: SlotConfig) -> bool:
    avd_root = Path(config.avd_home)
    avd_dir = avd_root / f"{config.avd_name}.avd"
    avd_ini = avd_root / f"{config.avd_name}.ini"
    return avd_dir.is_dir() and (avd_dir / "config.ini").exists() and avd_ini.is_file()


def emulator_start_command(args: argparse.Namespace, config: SlotConfig) -> list[str]:
    return emu_bootstrap_support.emulator_start_command(
        args,
        config,
        userdata_partition_mb=DEFAULT_USERDATA_PARTITION_MB,
        error_cls=SuiteError,
    )


def tune_avd_config(
    config: SlotConfig,
    *,
    userdata_size: str = DEFAULT_USERDATA_PARTITION_SIZE,
    wait_seconds: float = 10.0,
) -> None:
    emu_bootstrap_support.tune_avd_config(
        config,
        userdata_size=userdata_size,
        wait_seconds=wait_seconds,
        monotonic=time.monotonic,
        sleep=time.sleep,
    )


def adb_command(args: argparse.Namespace, serial: str, command: Iterable[str]) -> list[str]:
    return emu_bootstrap_support.adb_command(
        args,
        serial,
        command,
        require_serial=require_emulator_serial,
    )


def launch_provisioning_json(args: argparse.Namespace, config: SlotConfig) -> str | None:
    return emu_bootstrap_support.launch_provisioning_json(args, config)


def effective_activity_name(args: argparse.Namespace, config: SlotConfig) -> str:
    return emu_bootstrap_support.effective_activity_name(
        args,
        config,
        default_activity=DEFAULT_ACTIVITY,
        adb_command_fn=adb_command,
        subprocess_module=subprocess,
    )


def launch_command(args: argparse.Namespace, config: SlotConfig) -> list[str]:
    return emu_bootstrap_support.launch_command(
        args,
        config,
        activity_name=effective_activity_name(args, config),
        provisioning_json=launch_provisioning_json(args, config),
        adb_command_fn=adb_command,
    )


def launch_home_command(args: argparse.Namespace, config: SlotConfig) -> list[str]:
    return emu_bootstrap_support.launch_home_command(
        args,
        config,
        activity_name=effective_activity_name(args, config),
        provisioning_json=launch_provisioning_json(args, config),
        adb_command_fn=adb_command,
    )


def launch_home_resilient(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    wait_for_channel: bool = False,
    stage: str = "after_home_launch",
    timeout_seconds: int = 45,
) -> dict[str, Any]:
    attempts = [
        ("show_home", launch_home_command(args, config)),
        ("full_launch", launch_command(args, config)),
    ]
    last_error: Exception | None = None
    for mode, command in attempts:
        try:
            runner.run(command, timeout=30)
            result = {"ok": True, "launch_mode": mode}
            if wait_for_channel:
                result["channel"] = ensure_broker_command_channel(
                    args,
                    runner,
                    config,
                    stage=stage,
                    timeout_seconds=timeout_seconds,
                )
            return result
        except Exception as exc:
            last_error = exc if isinstance(exc, Exception) else SuiteError(str(exc))
            runner.run(adb_command(args, config.serial, ["shell", "input", "keyevent", "4"]), timeout=30, check=False)
            if not runner.dry_run:
                time.sleep(0.75)
    raise last_error or SuiteError("Unable to relaunch the home surface")


def direct_photo_capture_payload() -> dict[str, Any]:
    return {"timeout_ms": DIRECT_PHOTO_CAPTURE_TIMEOUT_MS, "suppress_chime": True}


def is_camera_capture_timeout_error(exc: Exception) -> bool:
    text = str(exc or "").lower()
    return "camera capture timed out" in text or ("photo.capture" in text and "timed out" in text)


def direct_photo_capture(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, DIRECT_PHOTO_CAPTURE_RETRY_ATTEMPTS + 1):
        try:
            return command_result(
                command_json(
                    runner,
                    puckyctl_command(args, config, "photo.capture", direct_photo_capture_payload()),
                    timeout=180,
                )
            )
        except Exception as exc:
            last_error = exc if isinstance(exc, Exception) else SuiteError(str(exc))
            if attempt >= DIRECT_PHOTO_CAPTURE_RETRY_ATTEMPTS or not is_camera_capture_timeout_error(last_error):
                raise
            clear_blocking_system_dialogs(args, runner, config)
            ensure_device_interactive(args, runner, config)
            launch_home_resilient(args, runner, config)
            if not runner.dry_run:
                time.sleep(1.0)
    raise last_error or SuiteError("Direct photo.capture failed")


def grant_runtime_permissions(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> None:
    for permission in EMULATOR_RUNTIME_PERMISSIONS:
        try:
            runner.run(
                adb_command(args, config.serial, ["shell", "pm", "grant", args.package_name, permission]),
                timeout=30,
                check=False,
            )
        except subprocess.TimeoutExpired:
            continue


def dismiss_permission_controller(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> None:
    runner.run(
        adb_command(
            args,
            config.serial,
            ["shell", "am", "force-stop", DEFAULT_PERMISSION_CONTROLLER_PACKAGE],
        ),
        timeout=30,
        check=False,
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


def windows_command_length(command: list[str]) -> int:
    return len(subprocess.list2cmdline([str(part) for part in command]))


def reply_cards_write_command(
    args: argparse.Namespace,
    config: SlotConfig,
    payload: dict[str, Any],
) -> list[str]:
    command_type = "ui.reply_cards.set" if is_emulator_serial(config.serial) else "ui.reply_cards.merge"
    return puckyctl_command(args, config, command_type, payload)


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


def broker_health_available(config: SlotConfig, *, timeout: float = 3.0) -> bool:
    try:
        wait_http(f"http://127.0.0.1:{config.broker_port}/health", timeout=timeout)
        return True
    except Exception:
        return False


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
    return emu_bootstrap_support.boot_signal(
        args,
        runner,
        config,
        prop,
        adb_command_fn=adb_command,
    )


def emulator_boot_ready(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> bool:
    return emu_bootstrap_support.emulator_boot_ready(
        args,
        runner,
        config,
        boot_signal_fn=boot_signal,
    )


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
    return emu_bootstrap_support.package_manager_ready(
        args,
        runner,
        config,
        adb_command_fn=adb_command,
        subprocess_module=subprocess,
    )


def install_services_ready(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> bool:
    return emu_bootstrap_support.install_services_ready(
        args,
        runner,
        config,
        package_manager_ready_fn=package_manager_ready,
        adb_command_fn=adb_command,
        subprocess_module=subprocess,
    )


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


def is_streamed_install_storage_service_failure(exc: Exception) -> bool:
    return emu_bootstrap_support.is_streamed_install_storage_service_failure(exc)


def install_apk_resilient(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
) -> None:
    emu_bootstrap_support.install_apk_resilient(
        args,
        runner,
        config,
        adb_command_fn=adb_command,
        is_streamed_install_storage_service_failure_fn=is_streamed_install_storage_service_failure,
    )


def serial_is_connected(args: argparse.Namespace, runner: Runner, serial: str) -> bool:
    return emu_bootstrap_support.serial_is_connected(
        args,
        runner,
        serial,
        require_serial=require_emulator_serial,
        parse_adb_devices_fn=parse_adb_devices,
    )


def adb_transport_state(args: argparse.Namespace, runner: Runner, serial: str) -> str:
    return emu_bootstrap_support.adb_transport_state(
        args,
        runner,
        serial,
        require_serial=require_emulator_serial,
        parse_adb_devices_fn=parse_adb_devices,
    )


def parse_display_ids(output: str) -> list[str]:
    return emu_bootstrap_support.parse_display_ids(output)


def primary_display_id(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> str | None:
    return emu_bootstrap_support.primary_display_id(
        args,
        runner,
        config,
        adb_command_fn=adb_command,
    )


def load_state(root: Path, slot: int) -> dict[str, Any]:
    return emu_state_support.load_state(root, slot)


def save_state(config: SlotConfig, extra: dict[str, Any]) -> dict[str, Any]:
    return emu_state_support.save_state(config, extra, now_iso=now_iso)


def state_pid(value: Any) -> int | None:
    return emu_state_support.state_pid(value)


def slot_state_has_live_processes(state: dict[str, Any] | None) -> bool:
    return emu_state_support.slot_state_has_live_processes(
        state,
        process_alive=process_alive,
    )


def slot_is_for_sure_free(
    args: argparse.Namespace,
    runner: Runner,
    root: Path,
    slot: int,
) -> bool:
    config = slot_config(root, slot, run_id=f"probe-slot{slot:02d}")
    ports_free = all(
        port_available(port)
        for port in (config.emulator_port, config.broker_port, config.ui_port)
    )
    if not ports_free:
        return False
    if adb_transport_state(args, runner, config.serial) != "missing":
        return False
    state = load_state(root, slot)
    return not slot_state_has_live_processes(state)


def first_free_slot_config(
    args: argparse.Namespace,
    runner: Runner,
    root: Path,
    *,
    start_slot: int = 3,
    end_slot: int = 10,
) -> SlotConfig:
    for slot in range(int(start_slot), int(end_slot) + 1):
        if slot_is_for_sure_free(args, runner, root, slot):
            return slot_config(root, slot)
    raise SuiteError(f"No for-sure free emulator slot found in range {start_slot}..{end_slot}")


def write_evidence(config: SlotConfig, name: str, payload: dict[str, Any]) -> Path:
    path = Path(config.evidence_dir) / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path


def replay_cards_from_broker_log(
    log_path: Path,
    titles: Iterable[str],
    *,
    allow_partial: bool = False,
) -> dict[str, dict[str, Any]]:
    def is_pending_outbound(card: dict[str, Any]) -> bool:
        if bool(card.get("pending_outbound")) or bool(card.get("pending_placeholder")):
            return True
        pending_state = str(card.get("pending_state") or "").strip().lower()
        if pending_state in {"pending", "failed"}:
            return True
        summary = str(card.get("summary") or "").strip()
        return summary == "Sending your message..."

    def replay_card_priority(card: dict[str, Any]) -> int:
        score = 0
        if not is_pending_outbound(card):
            score += 100
        normalized = normalize_replay_card(card)
        attachment_info = first_displayable_attachment_snapshot(normalized)
        if attachment_info:
            viewer_type = str(attachment_info.get("viewer_type") or "").lower()
            item = attachment_info.get("item") if isinstance(attachment_info.get("item"), dict) else {}
            score += DISPLAYABLE_VIEWER_PRIORITY.get(viewer_type, 0)
            if str(item.get("preview_path") or "").strip():
                score += 4
            if str(item.get("viewer_path") or "").strip():
                score += 4
            if str(item.get("document_html_path") or "").strip():
                score += 4
        if str(normalized.get("html_path") or "").strip():
            score += 5
        return score

    wanted = {str(title).strip() for title in titles if str(title).strip()}
    if not wanted:
        return {}
    if not log_path.exists():
        raise SuiteError(f"Replay broker log does not exist: {log_path}")
    found: dict[str, dict[str, Any]] = {}
    for raw_line in log_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        card_lists: list[list[dict[str, Any]]] = []
        message = event.get("message")
        if isinstance(message, dict):
            result = message.get("result")
            if isinstance(result, dict) and isinstance(result.get("cards"), list):
                card_lists.append([card for card in result["cards"] if isinstance(card, dict)])
        command = event.get("command")
        if isinstance(command, dict):
            args = command.get("args")
            if isinstance(args, dict) and isinstance(args.get("cards"), list):
                card_lists.append([card for card in args["cards"] if isinstance(card, dict)])
        for cards in card_lists:
            for card in cards:
                title = str(card.get("title") or "").strip()
                if title in wanted:
                    existing = found.get(title)
                    if existing is None:
                        found[title] = deepcopy(card)
                        continue
                    existing_pending = is_pending_outbound(existing)
                    incoming_pending = is_pending_outbound(card)
                    existing_priority = replay_card_priority(existing)
                    incoming_priority = replay_card_priority(card)
                    if incoming_priority > existing_priority:
                        found[title] = deepcopy(card)
                        continue
                    if incoming_priority < existing_priority:
                        continue
                    if existing_pending and not incoming_pending:
                        found[title] = deepcopy(card)
                        continue
                    if not existing_pending and incoming_pending:
                        continue
                    found[title] = deepcopy(card)
    missing = [title for title in titles if str(title).strip() and str(title).strip() not in found]
    if missing and not allow_partial:
        raise SuiteError(f"Replay broker log missing captured cards for: {', '.join(missing)}")
    return found


def normalize_replay_card(card: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(card)
    if isinstance(normalized.get("attachments"), list):
        normalized["attachments"] = normalize_attachments(normalized.get("attachments"))
    messages = []
    for message in normalized.get("transcript_messages") or []:
        if not isinstance(message, dict):
            continue
        item = deepcopy(message)
        if isinstance(item.get("attachments"), list):
            item["attachments"] = normalize_attachments(item.get("attachments"))
        messages.append(item)
    if messages:
        normalized["transcript_messages"] = messages
    return normalized


def command_json_allow_failure(runner: Runner, command: list[str], *, timeout: int = 60) -> dict[str, Any]:
    result = runner.run(command, timeout=timeout, check=False)
    payload = extract_json((result.stdout or "") + "\n" + (result.stderr or ""))
    if payload is None:
        payload = {"raw_stdout": result.stdout, "raw_stderr": result.stderr}
    payload["returncode"] = result.returncode
    return payload


def command_json(runner: Runner, command: list[str], *, timeout: int = 60) -> dict[str, Any]:
    attempts = 8
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            result = runner.run(command, timeout=timeout)
            break
        except SuiteError as exc:
            if attempt >= attempts or not is_transient_puckyctl_failure(exc):
                raise
            last_error = exc
            time.sleep(command_retry_delay_seconds(exc, attempt))
    else:
        raise last_error or SuiteError("Unknown puckyctl command failure")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"raw_stdout": result.stdout, "raw_stderr": result.stderr}


def command_retry_delay_seconds(exc: Exception, attempt: int) -> float:
    text = str(exc or "")
    upper = text.upper()
    if "DEVICE_OFFLINE" in upper:
        return float(max(2.0, attempt * 2.0))
    if "BROKER_UNAVAILABLE" in upper or "WINERROR 10061" in upper or "CONNECTIONREFUSEDERROR" in upper:
        return float(max(1.5, attempt * 1.5))
    return float(0.5 * attempt)


def is_transient_puckyctl_failure(exc: Exception) -> bool:
    text = str(exc or "")
    markers = (
        "WinError 10053",
        "WinError 10054",
        "WinError 10061",
        "ConnectionAbortedError",
        "ConnectionRefusedError",
        "ConnectionResetError",
        "RemoteDisconnected",
        "DEVICE_OFFLINE",
        "BROKER_UNAVAILABLE",
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


def adb_emu_geo_fix(args: argparse.Namespace, runner: Runner, config: SlotConfig, *, lat: float, lon: float) -> None:
    runner.run([str(args.adb), "-s", config.serial, "emu", "geo", "fix", str(lon), str(lat)], timeout=30, check=False)


def adb_path_exists(args: argparse.Namespace, runner: Runner, config: SlotConfig, path: str) -> bool:
    if not path:
        return False
    result = runner.run(adb_command(args, config.serial, ["shell", "ls", path]), timeout=30, check=False)
    text = (result.stdout or "") + "\n" + (result.stderr or "")
    return result.returncode == 0 and "No such file" not in text


def activity_focus_excerpt(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> str:
    if runner.dry_run:
        return ""
    result = runner.run(
        adb_command(args, config.serial, ["shell", "dumpsys", "activity", "activities"]),
        timeout=30,
        check=False,
    )
    lines: list[str] = []
    for raw_line in ((result.stdout or "") + "\n" + (result.stderr or "")).splitlines():
        line = raw_line.strip()
        lower = line.lower()
        if not line:
            continue
        if (
            "application not responding" in lower
            or "mfocusedapp" in lower
            or "mresumedactivity" in lower
            or "topresumedactivity" in lower
        ):
            lines.append(line)
    return "\n".join(lines[:20])


def emulator_health_snapshot(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    return {
        "adb_state": adb_transport_state(args, runner, config.serial),
        "broker_device": broker_device_snapshot(config),
        "activity_excerpt": activity_focus_excerpt(args, runner, config),
    }


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


def card_archive_swipe_motion(config: SlotConfig, bounds: tuple[int, int, int, int]) -> dict[str, int]:
    left, top, right, bottom = bounds
    width = max(1, right - left)
    return {
        "start_x": left + round(width * 0.20),
        "end_x": left + round(width * 0.80),
        "y": (top + bottom) // 2,
        "duration_ms": 560,
    }


def perform_card_archive_swipe(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    bounds: tuple[int, int, int, int],
) -> dict[str, int]:
    motion = card_archive_swipe_motion(config, bounds)
    runner.run(
        adb_command(
            args,
            config.serial,
            [
                "shell",
                "input",
                "swipe",
                str(motion["start_x"]),
                str(motion["y"]),
                str(motion["end_x"]),
                str(motion["y"]),
                str(motion["duration_ms"]),
            ],
        ),
        timeout=30,
    )
    return motion


def scroll_feed(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> None:
    runner.run(
        adb_command(args, config.serial, ["shell", "input", "swipe", "528", "860", "528", "280", "250"]),
        timeout=30,
        check=False,
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
    attempts = 3
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return http_json_request(url, timeout=60, token=token)
        except Exception as exc:
            if attempt >= attempts or not is_transient_puckyctl_failure(exc):
                raise
            last_error = exc
            time.sleep(0.5 * attempt)
    raise last_error or SuiteError(f"Feed request failed for {url}")


def wait_for_live_feed_item(args: argparse.Namespace, turn_id: str, *, timeout: float = 120.0, limit: int = 25) -> dict[str, Any]:
    if not args.turn_token:
        raise SuiteError("prove-displayable-reply-files requires --turn-token or PUCKY_API_TOKEN")
    deadline = time.monotonic() + timeout
    last_page: dict[str, Any] = {}
    while time.monotonic() < deadline:
        cursor = ""
        while True:
            page = feed_request(args.turn_url, args.turn_token, limit=limit, cursor=cursor)
            last_page = page
            items = page.get("items") if isinstance(page.get("items"), list) else []
            for item in items:
                if not isinstance(item, dict):
                    continue
                if str(item.get("turn_id") or "") == turn_id:
                    return item
            cursor = str(page.get("next_cursor") or "").strip()
            if not cursor:
                break
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
    sleep_seconds: float = 2.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last_snapshot: dict[str, Any] = {}
    while time.monotonic() < deadline:
        snapshot = command_result(command_json(runner, puckyctl_command(args, config, "ui.reply_cards.get", {}), timeout=120))
        last_snapshot = snapshot if isinstance(snapshot, dict) else {}
        if predicate(last_snapshot):
            return last_snapshot
        time.sleep(sleep_seconds)
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


def snapshot_card_by_turn_id(snapshot: dict[str, Any], turn_id: str) -> dict[str, Any] | None:
    cards = snapshot.get("cards")
    if not isinstance(cards, list):
        return None
    target = str(turn_id or "")
    for item in cards:
        if not isinstance(item, dict):
            continue
        if str(item.get("turn_id") or "") == target:
            return item
        if str(item.get("session_id") or "") == target:
            return item
    return None


def dump_ui_hierarchy(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> str:
    remote_path = "/data/local/tmp/pucky_window_dump.xml"
    last_error = ""
    for attempt in range(1, 3):
        try:
            runner.run(adb_command(args, config.serial, ["shell", "uiautomator", "dump", remote_path]), timeout=30, check=False)
            if runner.dry_run:
                runner.run(adb_command(args, config.serial, ["exec-out", "cat", remote_path]), timeout=30)
                return "<hierarchy rotation=\"0\"/>"
            result = runner.run(adb_command(args, config.serial, ["exec-out", "cat", remote_path]), timeout=30)
            text = result.stdout.strip()
            if "<hierarchy" not in text:
                raise SuiteError(f"Unable to capture UI hierarchy: {text or result.stderr}")
            return text
        except (SuiteError, subprocess.TimeoutExpired) as exc:
            last_error = str(exc)
            if attempt >= 2:
                raise SuiteError(f"Unable to capture UI hierarchy after retry: {last_error}") from exc
            try:
                runner.run(adb_command(args, config.serial, ["shell", "input", "keyevent", "4"]), timeout=30, check=False)
            except subprocess.TimeoutExpired:
                pass
            if not runner.dry_run:
                time.sleep(0.75)
    raise SuiteError(f"Unable to capture UI hierarchy: {last_error}")


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
        text_matches = bool(text_re and text_re.search(text_value))
        desc_matches = bool(desc_re and desc_re.search(desc_value))
        if text_re and desc_re:
            if not (text_matches or desc_matches):
                continue
        elif text_re and not text_matches:
            continue
        elif desc_re and not desc_matches:
            continue
        found.append(attrs)
    return found


def dismiss_anr_dialog_if_present(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    xml_text: str,
) -> bool:
    if not find_ui_nodes(xml_text, text_pattern=r".+isn't responding$"):
        return False
    for pattern in (r"^Wait$", r"^Close app$"):
        nodes = find_ui_nodes(xml_text, text_pattern=pattern)
        if not nodes:
            continue
        if not runner.dry_run:
            tap_ui_node(args, runner, config, nodes[0])
            time.sleep(1.5)
        return True
    return False


def dismiss_permission_dialog_if_present(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    xml_text: str,
) -> bool:
    for pattern in PERMISSION_ALLOW_PATTERNS:
        nodes = find_ui_nodes(xml_text, text_pattern=pattern)
        if not nodes:
            nodes = find_ui_nodes(xml_text, content_desc_pattern=pattern)
        if not nodes:
            continue
        if not runner.dry_run:
            tap_ui_node(args, runner, config, nodes[0])
            time.sleep(1.5)
        return True
    return False


def dismiss_blocking_system_dialog_if_present(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    xml_text: str,
) -> bool:
    return dismiss_anr_dialog_if_present(args, runner, config, xml_text) or dismiss_permission_dialog_if_present(args, runner, config, xml_text)


def clear_blocking_system_dialogs(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> bool:
    try:
        xml_text = dump_ui_hierarchy(args, runner, config)
    except Exception:
        return False
    return dismiss_blocking_system_dialog_if_present(args, runner, config, xml_text)


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
        if dismiss_blocking_system_dialog_if_present(args, runner, config, xml_text):
            continue
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
        if dismiss_blocking_system_dialog_if_present(args, runner, config, xml_text):
            continue
        nodes = find_ui_nodes(xml_text, text_pattern=text_pattern, content_desc_pattern=content_desc_pattern)
        if not nodes:
            return xml_text
        time.sleep(1.0)
    raise SuiteError(f"{description} after {int(timeout)}s")


def tap_ui_node(args: argparse.Namespace, runner: Runner, config: SlotConfig, node: dict[str, str]) -> None:
    left, top, right, bottom = parse_node_bounds(node.get("bounds", ""))
    tap(args, runner, config, ((left + right) // 2, (top + bottom) // 2))


def wait_for_feed_card_title(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    title: str,
    timeout: float = 30.0,
    max_scrolls: int = 6,
) -> tuple[dict[str, str], str]:
    deadline = time.monotonic() + timeout
    clean_title = str(title or "").strip()
    pattern = re.escape(clean_title)
    last_xml = ""
    scrolls = 0
    while time.monotonic() < deadline:
        xml_text = dump_ui_hierarchy(args, runner, config)
        last_xml = xml_text
        if dismiss_blocking_system_dialog_if_present(args, runner, config, xml_text):
            continue
        nodes = find_ui_nodes(xml_text, text_pattern=pattern)
        if nodes:
            return nodes[0], xml_text
        if scrolls < max_scrolls:
            scroll_feed(args, runner, config)
            scrolls += 1
            if not runner.dry_run:
                time.sleep(0.75)
            continue
        time.sleep(1.0)
    raise SuiteError(f"Did not find feed card titled {title} after {int(timeout)}s")


def ensure_feed_card_visible(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    title: str,
    local_card: dict[str, Any] | None,
    timeout: float = 30.0,
) -> tuple[dict[str, str], str, dict[str, Any]]:
    recovery = {
        "rematerialized": False,
        "home_reset_before_wait": reset_home_surface_if_needed(args, runner, config),
    }
    try:
        node, xml_text = wait_for_feed_card_title(args, runner, config, title=title, timeout=timeout)
        return node, xml_text, recovery
    except SuiteError as exc:
        recovery["first_error"] = str(exc)
        if not isinstance(local_card, dict):
            raise
    snapshot = command_result(
        command_json(
            runner,
            reply_cards_write_command(args, config, {"cards": [local_card]}),
            timeout=180,
        )
    )
    recovery["rematerialized"] = True
    recovery["snapshot"] = snapshot
    launch_home_resilient(
        args,
        runner,
        config,
        wait_for_channel=not runner.dry_run,
        stage="displayable_feed_recovery",
        timeout_seconds=max(45, int(math.ceil(timeout))),
    )
    recovery["home_reset_after_rematerialize"] = reset_home_surface_if_needed(args, runner, config)
    recovery_timeout = max(timeout * 2.0, 60.0)
    node, xml_text = wait_for_feed_card_title(args, runner, config, title=title, timeout=recovery_timeout)
    return node, xml_text, recovery


def open_card_detail_with_retry(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    case_key: str,
    title: str,
    card: dict[str, Any],
    tile_xml: str,
    timeout: float = 30.0,
) -> tuple[str, str]:
    action_labels = card_action_accessibility_labels(card)
    action_label = action_labels[0] if action_labels else None
    action_pattern = action_labels_pattern(action_labels)
    open_title = card_open_title(card)
    if not action_label:
        raise SuiteError(f"{case_key} returned no tile-openable attachment")

    def find_action_node_in_xml(xml_text: str) -> dict[str, str] | None:
        nodes = find_ui_nodes(xml_text, content_desc_pattern=action_pattern)
        if not nodes:
            nodes = find_ui_nodes(xml_text, text_pattern=action_pattern)
        return nodes[0] if nodes else None

    def surface_detail_matches_card(surface: dict[str, Any]) -> bool:
        detail = surface.get("detail") if isinstance(surface.get("detail"), dict) else {}
        if not bool(detail.get("open")):
            return False
        card_id = str(card.get("card_id") or "").strip()
        session_id = str(card.get("session_id") or "").strip()
        detail_card_id = str(detail.get("card_id") or "").strip()
        detail_session_id = str(detail.get("session_id") or "").strip()
        return bool((card_id and detail_card_id == card_id) or (session_id and detail_session_id == session_id))

    current_tile_xml = tile_xml
    action_node = find_action_node_in_xml(current_tile_xml)
    if action_node is None:
        action_node, current_tile_xml = wait_for_ui_node(
            args,
            runner,
            config,
            description=f"{case_key} did not expose the expected tile file action: {' or '.join(action_labels)}",
            content_desc_pattern=action_pattern,
            text_pattern=action_pattern,
            timeout=timeout,
        )
    for attempt in range(2):
        tap_ui_node(args, runner, config, action_node)
        if not runner.dry_run:
            time.sleep(getattr(args, "ui_dwell_seconds", 1.0))
        try:
            _, opened_xml = wait_for_ui_node(
                args,
                runner,
                config,
                description=f"{case_key} did not open a detail view titled {open_title}",
                text_pattern=rf"^{re.escape(open_title)}$",
                timeout=timeout,
            )
            return opened_xml, current_tile_xml
        except SuiteError as exc:
            try:
                if surface_detail_matches_card(ui_surface(args, runner, config)):
                    return dump_ui_hierarchy(args, runner, config), current_tile_xml
            except Exception:
                pass
            if attempt >= 1:
                raise exc
            action_node, current_tile_xml = wait_for_ui_node(
                args,
                runner,
                config,
                description=f"{case_key} did not expose the expected tile file action: {' or '.join(action_labels)}",
                content_desc_pattern=action_pattern,
                text_pattern=action_pattern,
                timeout=timeout,
            )
    raise SuiteError(f"{case_key} did not open a detail view titled {open_title}")


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


def expected_displayable_attachment_snapshot(case: dict[str, Any]) -> dict[str, Any] | None:
    attachments = normalize_attachments(deepcopy(case.get("synthetic_attachments") or []))
    for index, item in enumerate(attachments):
        viewer = item.get("viewer") if isinstance(item.get("viewer"), dict) else {}
        viewer_type = str(viewer.get("type") or "").lower()
        if viewer_type in DISPLAYABLE_VIEWER_TYPES:
            return {"attachments": attachments, "index": index, "item": item, "viewer_type": viewer_type}
    return None


def replay_card_matches_displayable_case(card: dict[str, Any], case: dict[str, Any]) -> bool:
    if str(case.get("source") or "").lower() != "synthetic":
        return True
    if not bool(case.get("expects_action")):
        return False
    expected = expected_displayable_attachment_snapshot(case)
    if expected is None:
        return bool(str(card.get("html_path") or "").strip()) or first_displayable_attachment_snapshot(normalize_replay_card(card)) is not None
    actual = first_displayable_attachment_snapshot(normalize_replay_card(card))
    if actual is None:
        return False
    expected_item = expected.get("item") if isinstance(expected.get("item"), dict) else {}
    actual_item = actual.get("item") if isinstance(actual.get("item"), dict) else {}
    if str(actual.get("viewer_type") or "").lower() != str(expected.get("viewer_type") or "").lower():
        return False
    expected_kind = str(expected_item.get("kind") or "").strip().lower()
    actual_kind = str(actual_item.get("kind") or "").strip().lower()
    if expected_kind and actual_kind != expected_kind:
        return False
    expected_mime = str(expected_item.get("mime_type") or "").strip().lower()
    actual_mime = str(actual_item.get("mime_type") or "").strip().lower()
    if expected_mime and actual_mime != expected_mime:
        return False
    return True


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


def card_action_accessibility_labels(card: dict[str, Any]) -> list[str]:
    primary = card_action_accessibility_label(card)
    if not primary:
        return []
    title = str(card.get("title") or "").strip() or "Pucky"
    labels = [primary]
    for label in (f"Open page for {title}", f"Open file for {title}"):
        if label not in labels:
            labels.append(label)
    return labels


def action_labels_pattern(labels: list[str]) -> str:
    if not labels:
        return r"a^"
    return rf"^(?:{'|'.join(re.escape(label) for label in labels)})$"


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
    return emu_capture_support.screenshot_sha256(path)


def file_sha256(path: Path) -> str:
    return emu_capture_support.file_sha256(path)


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
    return emu_vm_support.vm_thread_query_command(
        flyctl=args.flyctl,
        fly_app=args.fly_app,
        vm_codex_home=str(args.vm_codex_home),
        thread_id=thread_id,
    )


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
    return emu_vm_support.official_refresh_command(
        python_executable=sys.executable,
        root=ROOT,
        device_id=config.device_id,
        broker_url=local_broker_url(config),
        vm_base_url=args.vm_base_url,
        refresh_timeout_seconds=args.refresh_timeout_seconds,
        operator_token=args.operator_token,
    )


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
    emu_capture_support.capture_screenshot(
        args,
        runner,
        config,
        path,
        adb_command_fn=adb_command,
        primary_display_id_fn=primary_display_id,
        screencap_args_fn=emu_display_support.screencap_args,
        subprocess_module=subprocess,
    )

AsyncScreenshotCapture = emu_capture_support.AsyncScreenshotCapture


def start_async_screenshot_capture(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    path: Path,
) -> AsyncScreenshotCapture:
    return emu_capture_support.start_async_screenshot_capture(
        args,
        runner,
        config,
        path,
        runner_cls=Runner,
        capture_screenshot_fn=capture_screenshot,
    )


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


def recover_broker_command_path(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    stage: str,
    timeout_seconds: int = 90,
) -> dict[str, Any]:
    state = load_state(ROOT, config.slot)
    pids = state.get("pids") if isinstance(state.get("pids"), dict) else {}
    emulator_pid = state_pid(pids.get("emulator"))
    broker_pid = state_pid(pids.get("fake_broker"))
    recovery: dict[str, Any] = {"stage": stage}
    state_changed = False

    if not serial_is_connected(args, runner, config.serial):
        if emulator_pid and process_alive(emulator_pid):
            wait_for_boot(args, runner, config, pid=emulator_pid, timeout=max(90.0, float(timeout_seconds)))
            recovery["waited_for_boot"] = True
        else:
            new_emulator_pid = runner.start_detached(
                emulator_start_command(args, config),
                cwd=ROOT,
                env=sdk_env(args, config),
                stdout_path=Path(config.evidence_dir) / "emulator.log",
                stderr_path=Path(config.evidence_dir) / "emulator.err.log",
            )
            wait_for_boot(args, runner, config, pid=new_emulator_pid, timeout=max(180.0, float(timeout_seconds)))
            pids["emulator"] = new_emulator_pid
            recovery["started_emulator"] = new_emulator_pid
            state_changed = True

    if not broker_health_available(config, timeout=3.0):
        if broker_pid is None or not process_alive(broker_pid):
            new_broker_pid = start_node_broker(args, runner, config)
            if new_broker_pid > 0:
                pids["fake_broker"] = new_broker_pid
                recovery["started_broker"] = new_broker_pid
                state_changed = True
        wait_http(f"http://127.0.0.1:{config.broker_port}/health", timeout=max(10.0, float(timeout_seconds) / 2.0))

    runner.run(
        adb_command(args, config.serial, ["reverse", f"tcp:{config.broker_port}", f"tcp:{config.broker_port}"]),
        timeout=30,
        check=False,
    )
    recovery["channel"] = launch_home_resilient(
        args,
        runner,
        config,
        wait_for_channel=True,
        stage=stage,
        timeout_seconds=timeout_seconds,
    )
    if state_changed and not runner.dry_run:
        save_state(config, {"config": asdict(config), "pids": pids, "serial": config.serial, "broker_url": f"http://127.0.0.1:{config.broker_port}"})
    return recovery


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
    serial_connected = serial_is_connected(args, runner, config.serial)
    if not args.dry_run and not serial_connected and not avd_artifacts_exist(config):
        Path(config.avd_home).mkdir(parents=True, exist_ok=True)
        runner.run(avdmanager_create_command(args, config), env=sdk_env(args, config), timeout=120)
    if not args.dry_run:
        tune_avd_config(config)
    Path(config.evidence_dir).mkdir(parents=True, exist_ok=True)
    pid = -1
    if not serial_connected:
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


def grant_provision_permissions(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> None:
    for permission in PROVISION_PERMISSION_GRANTS:
        runner.run(adb_command(args, config.serial, ["shell", "pm", "grant", args.package_name, permission]), timeout=30, check=False)


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
    install_apk_resilient(args, runner, config)
    grant_provision_permissions(args, runner, config)
    grant_runtime_permissions(args, runner, config)
    dismiss_permission_controller(args, runner, config)
    runner.run(adb_command(args, config.serial, ["shell", "wm", "size", "1056x1056"]), timeout=30)
    runner.run(adb_command(args, config.serial, ["shell", "wm", "density", "420"]), timeout=30)
    runner.run(launch_command(args, config), timeout=30)
    broker_channel = ensure_broker_command_channel(args, runner, config, stage="after_provision_launch", timeout_seconds=90)
    broker_device = broker_channel.get("device") if isinstance(broker_channel, dict) else broker_channel
    if not args.dry_run:
        state = load_state(ROOT, args.slot)
        pids = state.get("pids") if isinstance(state.get("pids"), dict) else {}
        if broker_pid > 0:
            pids["fake_broker"] = broker_pid
        save_state(config, {"config": asdict(config), "pids": pids, "serial": config.serial, "broker_url": f"http://127.0.0.1:{config.broker_port}"})
    return {
        "ok": True,
        "config": asdict(config),
        "broker_pid": broker_pid,
        "broker_device": broker_device,
        "broker_channel": broker_channel,
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }


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
    cards_status = command_json(runner, reply_cards_write_command(args, config, cards_payload), timeout=300)
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


def ensure_scratch_bundle(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    max_bundle_bytes: int = 20 * 1024 * 1024,
) -> dict[str, Any]:
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
    bundle_refresh = command_result(
        command_json(
            runner,
            puckyctl_command(
                args,
                config,
                "ui.bundle.refresh",
                {"url": f"http://127.0.0.1:{config.ui_port}/pucky-ui-latest.zip", "max_bytes": max_bundle_bytes},
            ),
            timeout=300,
        )
    )
    bundle_status = command_result(command_json(runner, puckyctl_command(args, config, "ui.bundle.status", {}), timeout=120))
    return {"bundle": bundle_result, "bundle_refresh": bundle_refresh, "bundle_status": bundle_status}


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


def button_events(args: argparse.Namespace, runner: Runner, config: SlotConfig, *, limit: int = 30) -> dict[str, Any]:
    return broker_command_result(
        args,
        runner,
        config,
        "button.events.list",
        {"limit": limit},
        timeout=120,
        recovery_stage="button_events_list_recover",
    )


def clear_button_events(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    return broker_command_result(
        args,
        runner,
        config,
        "button.events.clear",
        {},
        timeout=120,
        recovery_stage="button_events_clear_recover",
    )


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


def broker_command_result(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    command_name: str,
    payload: dict[str, Any] | None = None,
    *,
    timeout: int = 120,
    recovery_stage: str,
    recovery_attempts: int = 2,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, recovery_attempts + 1):
        try:
            return command_result(
                command_json(
                    runner,
                    puckyctl_command(args, config, command_name, payload or {}),
                    timeout=timeout,
                )
            )
        except Exception as exc:
            if attempt >= recovery_attempts or not is_transient_puckyctl_failure(exc):
                raise
            last_error = exc
            recover_broker_command_path(
                args,
                runner,
                config,
                stage=f"{recovery_stage}_{attempt}",
                timeout_seconds=90,
            )
    raise last_error or SuiteError(f"Unable to complete broker command: {command_name}")


def turn_history(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    limit: int = 20,
) -> dict[str, Any]:
    return broker_command_result(
        args,
        runner,
        config,
        "pucky.turn.history",
        {"limit": limit},
        timeout=120,
        recovery_stage="turn_history_recover",
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


def history_record_by_turn_id(history_payload: dict[str, Any] | None, turn_id: str) -> dict[str, Any] | None:
    target = str(turn_id or "")
    turns = history_payload.get("turns", []) if isinstance(history_payload, dict) else []
    for item in turns:
        if not isinstance(item, dict):
            continue
        if str(item.get("turn_id") or "") == target:
            return item
        if str(item.get("local_session_id") or "") == target:
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


def ui_surface(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
) -> dict[str, Any]:
    attempts = 2 if not runner.dry_run else 1
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return command_result(
                command_json(
                    runner,
                    puckyctl_command(args, config, "ui.surface.get", {}),
                    timeout=120,
                )
            )
        except subprocess.TimeoutExpired as exc:
            last_error = exc
            if attempt >= attempts:
                raise SuiteError(f"ui.surface.get timed out after recovery retry: {exc}") from exc
            launch_home_resilient(
                args,
                runner,
                config,
                wait_for_channel=True,
                stage=f"ui_surface_reconnect_{attempt}",
                timeout_seconds=90,
            )
            if not runner.dry_run:
                time.sleep(getattr(args, "ui_dwell_seconds", 1.0))
        except SuiteError as exc:
            last_error = exc
            if attempt >= attempts or not is_transient_puckyctl_failure(exc):
                raise
            launch_home_resilient(
                args,
                runner,
                config,
                wait_for_channel=True,
                stage=f"ui_surface_reconnect_{attempt}",
                timeout_seconds=90,
            )
            if not runner.dry_run:
                time.sleep(getattr(args, "ui_dwell_seconds", 1.0))
    raise last_error or SuiteError("Unable to query ui.surface.get")


def voice_thread_scope_status(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
) -> dict[str, Any]:
    return command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "voice.thread_scope.get", {}),
            timeout=120,
        )
    )


def wait_for_voice_thread_scope(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    predicate,
    *,
    description: str,
    timeout_seconds: float = 10.0,
    sleep_seconds: float = 0.1,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last_scope: dict[str, Any] = {}
    while time.monotonic() < deadline:
        scope = voice_thread_scope_status(args, runner, config)
        last_scope = scope if isinstance(scope, dict) else {}
        if predicate(last_scope):
            return last_scope
        time.sleep(sleep_seconds)
    raise SuiteError(f"Timed out waiting for {description}: {last_scope}")


def reply_cards_snapshot(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
) -> dict[str, Any]:
    return broker_command_result(
        args,
        runner,
        config,
        "ui.reply_cards.get",
        {},
        timeout=120,
        recovery_stage="reply_cards_get_recover",
    )


def ui_debug_command(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    command_name: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return broker_command_result(
        args,
        runner,
        config,
        command_name,
        payload or {},
        timeout=120,
        recovery_stage=f"{command_name.replace('.', '_')}_recover",
    )


def reset_walkie_thread_surface(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
) -> None:
    ui_debug_command(args, runner, config, "ui.debug.goto_home", {})
    ui_debug_command(args, runner, config, "ui.debug.clear_focus", {})
    ui_debug_command(args, runner, config, "ui.debug.refresh_cards", {})


def reset_home_surface_if_needed(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
) -> dict[str, Any]:
    cleared_dialogs = clear_blocking_system_dialogs(args, runner, config)
    surface = ui_surface(args, runner, config)
    detail = surface.get("detail") if isinstance(surface.get("detail"), dict) else {}
    thread_scope = surface.get("thread_scope") if isinstance(surface.get("thread_scope"), dict) else {}
    focused = surface.get("focused_card") if isinstance(surface.get("focused_card"), dict) else {}
    needs_reset = (
        str(surface.get("route") or "") != "feed"
        or bool(detail.get("open"))
        or bool(thread_scope.get("visible"))
        or str(thread_scope.get("active") or "").lower() == "true"
        or bool(focused.get("active"))
    )
    result: dict[str, Any] = {
        "cleared_dialogs": cleared_dialogs,
        "needs_reset": needs_reset,
        "used_ui_debug": False,
        "used_back": False,
    }
    if not needs_reset:
        return result
    if bool(surface.get("ui_debug_available")):
        try:
            result["goto_home"] = ui_debug_command(args, runner, config, "ui.debug.goto_home", {})
            result["clear_focus"] = ui_debug_command(args, runner, config, "ui.debug.clear_focus", {})
            result["used_ui_debug"] = True
            return result
        except Exception as exc:
            result["ui_debug_error"] = str(exc)
    runner.run(adb_command(args, config.serial, ["shell", "input", "keyevent", "4"]), timeout=30, check=False)
    if not runner.dry_run:
        time.sleep(0.75)
    result["used_back"] = True
    return result


def reset_walkie_thread_lab_state(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
) -> None:
    command_result(command_json(runner, puckyctl_command(args, config, "pucky.turn.stop", {}), timeout=120))
    try:
        command_result(command_json(runner, puckyctl_command(args, config, "pucky.turn.debug.inject_history", {"clear_all": True}), timeout=120))
    except SuiteError as exc:
        if "pucky.turn.debug.inject_history requires turn_id or local_session_id" not in str(exc):
            raise
    command_result(command_json(runner, puckyctl_command(args, config, "pucky.turn.debug.response_fault", {"clear": True}), timeout=120))
    command_result(command_json(runner, puckyctl_command(args, config, "ui.reply_cards.clear", {}), timeout=120))
    command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.feed.sync", {"reason": "walkie_thread_lab_reset", "reset_cursor": True}),
            timeout=120,
        )
    )


def walkie_thread_lab_scenarios_for_request(selected: str) -> list[str]:
    return list(WALKIE_THREAD_LAB_ALL_SCENARIOS) if selected == "all" else [selected]


def walkie_thread_lab_recovery_args(
    args: argparse.Namespace,
    command: str,
    **overrides: Any,
) -> argparse.Namespace:
    payload = dict(vars(args))
    payload["command"] = command
    payload.update(overrides)
    return argparse.Namespace(**payload)


def recover_walkie_thread_lab_slot(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "stop": cmd_stop(walkie_thread_lab_recovery_args(args, "stop")),
        "create": cmd_create(walkie_thread_lab_recovery_args(args, "create")),
        "start": cmd_start(
            walkie_thread_lab_recovery_args(
                args,
                "start",
                no_wait=False,
                audio_mode="none",
                audio_wav_in=None,
            )
        ),
        "provision": cmd_provision(walkie_thread_lab_recovery_args(args, "provision", skip_build=True)),
        "seed_ui": cmd_seed_ui(
            walkie_thread_lab_recovery_args(
                args,
                "seed-ui",
                cards_json="",
                cards_file=None,
                max_bundle_bytes=20 * 1024 * 1024,
            )
        ),
        "smoke": cmd_smoke(walkie_thread_lab_recovery_args(args, "smoke")),
    }


def should_recover_walkie_thread_lab_exception(exc: Exception) -> bool:
    text = str(exc or "").lower()
    recovery_tokens = (
        "broker",
        "adb",
        "transport",
        "device offline",
        "device is offline",
        "emulator is not connected",
        "timed out waiting for emulator boot",
        "no devices/emulators found",
        "connection reset",
        "connection aborted",
        "broken pipe",
        "socket",
    )
    return any(token in text for token in recovery_tokens)


def write_json_file(path: Path, payload: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def visible_cards(surface: dict[str, Any] | None) -> list[dict[str, Any]]:
    raw = surface.get("visible_cards") if isinstance(surface, dict) else []
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def visible_thread_cards(surface: dict[str, Any] | None, thread_id: str) -> list[dict[str, Any]]:
    target = str(thread_id or "")
    return [item for item in visible_cards(surface) if str(item.get("thread_id") or "") == target]


def visible_thread_index(surface: dict[str, Any] | None, thread_id: str) -> int:
    target = str(thread_id or "")
    for index, item in enumerate(visible_cards(surface)):
        if str(item.get("thread_id") or "") == target:
            return index
    return -1


def focused_card(surface: dict[str, Any] | None) -> dict[str, Any]:
    raw = surface.get("focused_card") if isinstance(surface, dict) else {}
    return raw if isinstance(raw, dict) else {}


def focus_card_surface(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    session_id: str = "",
    card_id: str = "",
    predicate,
    description: str,
    timeout_seconds: float = 20.0,
) -> tuple[dict[str, Any], dict[str, Any]]:
    result = ui_debug_command(
        args,
        runner,
        config,
        "ui.debug.focus_card",
        {k: v for k, v in {"session_id": session_id, "card_id": card_id}.items() if v},
    )
    if not bool(result.get("ok")) or not bool(result.get("handled")):
        raise SuiteError(f"ui.debug.focus_card failed for {description}: {result}")
    surface = result.get("surface") if isinstance(result.get("surface"), dict) else {}
    if predicate(surface):
        return result, surface
    return result, wait_for_ui_surface(
        args,
        runner,
        config,
        predicate,
        timeout_seconds=timeout_seconds,
        description=description,
    )


def clone_json_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(payload))


def final_boss_effective_delays(args: argparse.Namespace) -> tuple[int, int, int]:
    return (
        max(int(args.final_boss_delay_ms_a), FINAL_BOSS_MIN_DELAY_MS_A),
        max(int(args.final_boss_delay_ms_new), FINAL_BOSS_MIN_DELAY_MS_NEW),
        max(int(args.final_boss_delay_ms_b), FINAL_BOSS_MIN_DELAY_MS_B),
    )


def continuation_fixture_start_delay_ms(expected_source_surface: str) -> int:
    source = str(expected_source_surface or "")
    if source == "thread_attachment":
        return ATTACHMENT_CONTINUATION_FIXTURE_START_DELAY_MS
    if source == "thread_page":
        return PAGE_CONTINUATION_FIXTURE_START_DELAY_MS
    return WALKIE_THREAD_FIXTURE_START_DELAY_MS


def scenario_evidence_dir(config: SlotConfig, scenario_name: str) -> Path:
    evidence_root = Path(config.evidence_dir)
    scenario_dir = evidence_root / scenario_name
    try:
        scenario_dir.resolve().relative_to(evidence_root.resolve())
    except ValueError as exc:
        raise SuiteError(f"Refusing to clear evidence outside run directory: {scenario_dir}") from exc
    if scenario_dir.exists():
        shutil.rmtree(scenario_dir)
    scenario_dir.mkdir(parents=True, exist_ok=True)
    return scenario_dir


def surface_from_snapshot(snapshot: dict[str, Any] | None, *, route: str = "feed") -> dict[str, Any]:
    raw_cards = snapshot.get("cards") if isinstance(snapshot, dict) and isinstance(snapshot.get("cards"), list) else []
    cards: list[dict[str, Any]] = []
    thread_indexes: dict[str, int] = {}
    for item in raw_cards:
        if not isinstance(item, dict):
            continue
        origin = item.get("origin") if isinstance(item.get("origin"), dict) else {}
        preview = (
            str(item.get("summary") or "")
            or str(item.get("title") or "")
            or str(item.get("transcript") or "")
        )
        card = clone_json_payload(item)
        card["kind"] = "pending_outbound" if bool(item.get("pending_outbound")) else "reply"
        card["thread_id"] = str(item.get("thread_id") or origin.get("thread_id") or "")
        card["pending_outbound"] = bool(item.get("pending_outbound"))
        card["pending_state"] = str(item.get("pending_state") or "")
        card["preview"] = preview
        thread_id = str(card.get("thread_id") or "")
        if thread_id:
            existing_index = thread_indexes.get(thread_id)
            if existing_index is None:
                thread_indexes[thread_id] = len(cards)
                cards.append(card)
                continue
            existing = cards[existing_index]
            if bool(card.get("pending_outbound")) and not bool(existing.get("pending_outbound")):
                cards[existing_index] = card
            continue
        cards.append(card)
    return {
        "schema": "pucky.ui_surface.v1",
        "route": route,
        "visible_cards": cards,
    }


def wait_for_thread_progression(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    thread_id: str,
    transcript_text: str,
    timeout_seconds: float = 20.0,
    sleep_seconds: float = 0.1,
    description: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    deadline = time.monotonic() + timeout_seconds
    pending_surface: dict[str, Any] | None = None
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        surface = ui_surface(args, runner, config)
        snapshot_surface = surface_from_snapshot(reply_cards_snapshot(args, runner, config))
        last = surface
        candidates = [surface, snapshot_surface]
        if pending_surface is None:
            for candidate in candidates:
                thread_cards = visible_thread_cards(candidate, thread_id)
                if len(thread_cards) != 1:
                    continue
                card = thread_cards[0]
                if str(card.get("kind") or "") == "pending_outbound" and "Sending your message..." in str(card.get("preview") or ""):
                    pending_surface = clone_json_payload(candidate)
                    break
        if pending_surface is not None:
            for candidate in candidates:
                thread_cards = visible_thread_cards(candidate, thread_id)
                if len(thread_cards) != 1:
                    continue
                card = thread_cards[0]
                if transcript_text in str(card.get("preview") or ""):
                    return pending_surface, clone_json_payload(candidate)
        time.sleep(sleep_seconds)
    if pending_surface is None:
        raise SuiteError(f"Timed out waiting for {description} pending tile: {last}")
    raise SuiteError(f"Timed out waiting for {description} transcript preview: {last}")


def wait_for_ui_surface(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    predicate,
    *,
    timeout_seconds: float = 20.0,
    sleep_seconds: float = 0.25,
    description: str,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        last = ui_surface(args, runner, config)
        if predicate(last):
            return last
        time.sleep(sleep_seconds)
    raise SuiteError(f"Timed out waiting for {description}: {last}")


def wait_for_ui_surface_with_webview_relaunch(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    predicate,
    *,
    timeout_seconds: float = 20.0,
    sleep_seconds: float = 0.25,
    description: str,
    retry_stage: str,
) -> dict[str, Any]:
    try:
        return wait_for_ui_surface(
            args,
            runner,
            config,
            predicate,
            timeout_seconds=timeout_seconds,
            sleep_seconds=sleep_seconds,
            description=description,
        )
    except SuiteError as exc:
        if "webview_timeout" not in str(exc):
            raise
        launch_home_resilient(args, runner, config, wait_for_channel=True, stage=retry_stage, timeout_seconds=90)
        ui_debug_command(args, runner, config, "ui.debug.goto_home", {})
        ui_debug_command(args, runner, config, "ui.debug.refresh_cards", {})
        return wait_for_ui_surface(
            args,
            runner,
            config,
            predicate,
            timeout_seconds=max(timeout_seconds, 30.0),
            sleep_seconds=sleep_seconds,
            description=f"{description} after relaunch",
        )


def wait_for_turn_record(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    turn_id: str,
    predicate,
    *,
    timeout_seconds: float = 30.0,
    sleep_seconds: float = 0.25,
    description: str,
    limit: int = 30,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    last_record: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        history_payload = turn_history(args, runner, config, limit=limit)
        last_record = history_record_by_turn_id(history_payload, turn_id)
        if predicate(last_record, history_payload):
            return {"record": last_record, "history": history_payload}
        time.sleep(sleep_seconds)
    raise SuiteError(f"Timed out waiting for {description}: {last_record}")


def read_turn_record(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    turn_id: str,
) -> dict[str, Any]:
    return broker_command_result(
        args,
        runner,
        config,
        "pucky.turn.read",
        {"turn_id": turn_id},
        timeout=120,
        recovery_stage="turn_read_recover",
    )


def iso_timestamp_millis(value: Any) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def build_turn_timing_artifact(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    turn_ids: list[str],
    surface: dict[str, Any] | None = None,
    button_limit: int = 30,
    history_limit: int = 40,
) -> dict[str, Any]:
    clean_turn_ids = [str(turn_id or "").strip() for turn_id in turn_ids if str(turn_id or "").strip()]
    surface_payload = surface if isinstance(surface, dict) else ui_surface(args, runner, config)
    history_payload = turn_history(args, runner, config, limit=history_limit)
    status_payload = turn_status(args, runner, config)
    button_payload = button_events(args, runner, config, limit=button_limit)
    ui_timing = surface_payload.get("turn_timing") if isinstance(surface_payload.get("turn_timing"), dict) else {}
    ui_events = ui_timing.get("events") if isinstance(ui_timing.get("events"), list) else []
    turns: dict[str, Any] = {}
    timeline: list[dict[str, Any]] = []

    for event in button_payload.get("events", []):
        if not isinstance(event, dict):
            continue
        timestamp_ms = iso_timestamp_millis(event.get("timestamp"))
        timeline.append(
            {
                "source": "button",
                "event": str(event.get("gesture") or "button_event"),
                "timestamp": str(event.get("timestamp") or ""),
                "timestamp_ms": timestamp_ms,
                "mapped_action": str((event.get("action_result") or {}).get("action") or ""),
                "status": str((event.get("action_result") or {}).get("status") or ""),
            }
        )

    for turn_id in clean_turn_ids:
        record = history_record_by_turn_id(history_payload, turn_id) or {}
        read_payload = read_turn_record(args, runner, config, turn_id)
        turns[turn_id] = {
            "record": record,
            "read": read_payload,
            "latest_state": str((read_payload.get("turn") or {}).get("latest_state") or record.get("latest_state") or ""),
            "server_telemetry": (read_payload.get("turn") or {}).get("server_telemetry")
            if isinstance(read_payload.get("turn"), dict)
            else record.get("server_telemetry"),
        }
        for event in record.get("events", []):
            if not isinstance(event, dict):
                continue
            timestamp_ms = iso_timestamp_millis(event.get("updated_at"))
            timeline.append(
                {
                    "source": "turn_history",
                    "turn_id": turn_id,
                    "event": str(event.get("state") or ""),
                    "timestamp": str(event.get("updated_at") or ""),
                    "timestamp_ms": timestamp_ms,
                    "visual_state": str(event.get("visual_state") or ""),
                    "phase": str(event.get("phase") or ""),
                    "remote_stage": str(event.get("remote_stage") or ""),
                }
            )

    for event in ui_events:
        if not isinstance(event, dict):
            continue
        turn_id = str(event.get("turn_id") or "").strip()
        if clean_turn_ids and turn_id and turn_id not in clean_turn_ids:
            continue
        timestamp_ms = iso_timestamp_millis(event.get("at"))
        timeline.append(
            {
                "source": "web_ui",
                "turn_id": turn_id,
                "event": str(event.get("event") or ""),
                "timestamp": str(event.get("at") or ""),
                "timestamp_ms": timestamp_ms,
                "visual_state": str(event.get("visual_state") or ""),
                "label": str(event.get("label") or ""),
                "reason": str(event.get("reason") or ""),
            }
        )

    timeline.sort(key=lambda item: (item.get("timestamp_ms") is None, item.get("timestamp_ms") or 0, str(item.get("source") or "")))
    origin_ms = next((item.get("timestamp_ms") for item in timeline if isinstance(item.get("timestamp_ms"), int)), None)
    for item in timeline:
        timestamp_ms = item.get("timestamp_ms")
        item["offset_ms"] = (timestamp_ms - origin_ms) if isinstance(timestamp_ms, int) and isinstance(origin_ms, int) else None

    return {
        "schema": "pucky.turn_timing_artifact.v1",
        "collected_at": now_iso(),
        "turn_ids": clean_turn_ids,
        "button_events": button_payload,
        "turn_status": status_payload,
        "ui_surface_turn_timing": ui_timing,
        "turns": turns,
        "timeline": timeline,
    }


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
    thread_continue = fixture_dir / "thread_continue.wav"
    file_revise = fixture_dir / "file_revise.wav"
    fresh_thread = fixture_dir / "fresh_thread.wav"
    thread_bravo = fixture_dir / "thread_bravo.wav"
    thread_alpha = fixture_dir / "thread_alpha.wav"
    if not synthesize_speech_wav(wake_flashlight, "Turn on the flashlight"):
        wake_flashlight.write_bytes(wav_bytes(1800))
    if not synthesize_speech_wav(wake_weather, "What is the weather today"):
        wake_weather.write_bytes(wav_bytes(2200))
    if not synthesize_speech_wav(thread_continue, "Should we change these goals?"):
        thread_continue.write_bytes(wav_bytes(2400))
    if not synthesize_speech_wav(file_revise, "Can you revise this file?"):
        file_revise.write_bytes(wav_bytes(2400))
    if not synthesize_speech_wav(fresh_thread, "Fresh thread follow up"):
        fresh_thread.write_bytes(wav_bytes(2400))
    if not synthesize_speech_wav(thread_bravo, "Bravo thread follow up"):
        thread_bravo.write_bytes(wav_bytes(2400))
    if not synthesize_speech_wav(thread_alpha, "Alpha thread continue"):
        thread_alpha.write_bytes(wav_bytes(2400))
    wake_silence.write_bytes(wav_bytes(5000, silence=True))
    return {
        "wake_flashlight": wake_flashlight,
        "wake_weather": wake_weather,
        "wake_silence": wake_silence,
        "thread_continue": thread_continue,
        "file_revise": file_revise,
        "fresh_thread": fresh_thread,
        "thread_bravo": thread_bravo,
        "thread_alpha": thread_alpha,
    }


def push_turn_fixture(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    source_path: Path,
    fixture_name: str,
) -> str:
    uploaded = upload_app_owned_file(
        args,
        runner,
        config,
        source_path=source_path,
        filename=f"{fixture_name}.wav",
        max_bytes=2 * 1024 * 1024,
    )
    device_path = str(uploaded.get("device_path") or uploaded.get("path") or "").strip()
    if not device_path:
        raise SuiteError(f"Fixture upload did not return a device path for {fixture_name}")
    return device_path


def upload_app_owned_file(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    source_path: Path,
    filename: str,
    max_bytes: int = 2 * 1024 * 1024,
) -> dict[str, Any]:
    if source_path.stat().st_size > max_bytes:
        raise SuiteError(f"File exceeds max_bytes for app-owned upload: {source_path} > {max_bytes}")
    safe_name = Path(filename).name
    stage_path = f"/data/local/tmp/{safe_name}"
    runner.run(adb_command(args, config.serial, ["push", str(source_path), stage_path]), timeout=60)
    escaped_stage = stage_path.replace("'", "'\\''")
    escaped_name = safe_name.replace("'", "'\\''")
    copy_script = (
        "mkdir -p files/downloads && "
        f"cp '{escaped_stage}' 'files/downloads/{escaped_name}' && "
        f"chmod 600 'files/downloads/{escaped_name}'"
    )
    runner.run(
        adb_command(args, config.serial, ["shell", f"run-as {DEFAULT_PACKAGE} sh -c {shlex.quote(copy_script)}"]),
        timeout=60,
    )
    runner.run(adb_command(args, config.serial, ["shell", "rm", "-f", stage_path]), timeout=30, check=False)
    device_path = f"/data/user/0/{DEFAULT_PACKAGE}/files/downloads/{safe_name}"
    return {
        "filename": safe_name,
        "path": device_path,
        "device_path": device_path,
        "bytes": source_path.stat().st_size,
        "app_owned": True,
    }


def sync_default_recipe_bundle(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    bundle = json.loads(DEFAULT_RECIPE_BUNDLE.read_text(encoding="utf-8"))
    return sync_recipe_bundle(args, runner, config, bundle)


def sync_recipe_bundle(args: argparse.Namespace, runner: Runner, config: SlotConfig, bundle: dict[str, Any]) -> dict[str, Any]:
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
    relaunch: bool = True,
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
    grant_runtime_permissions(args, runner, config)
    dismiss_permission_controller(args, runner, config)
    if relaunch:
        runner.run(adb_command(args, config.serial, ["shell", "am", "force-stop", args.package_name]), timeout=30)
        time.sleep(1.0 if not runner.dry_run else 0.0)
        runner.run(launch_command(args, config), timeout=30)
        try:
            ensure_broker_command_channel(args, runner, config, stage="turn_lab_relaunch", timeout_seconds=90)
        except SuiteError:
            launch_home_resilient(
                args,
                runner,
                config,
                wait_for_channel=True,
                stage="turn_lab_relaunch_retry",
                timeout_seconds=90,
            )
    else:
        ensure_broker_command_channel(args, runner, config, stage="turn_lab_existing", timeout_seconds=90)
    settings_payload: dict[str, Any] = {"reply_mode": reply_mode, "arrival_cue_mode": "chime"}
    if fake_turn is not None:
        settings_payload["pucky_turn_url"] = fake_turn.base_url
        settings_payload["pucky_api_token"] = "dev-token"
    settings = command_result(command_json(
        runner,
        puckyctl_command(args, config, "pucky.turn.settings.set", settings_payload),
        timeout=120,
    ))
    recipe_sync = sync_default_recipe_bundle(args, runner, config)
    configured_turn_url = fake_turn.base_url if fake_turn is not None else str(original_turn_url or "")
    if fake_turn is None:
        setattr(args, "turn_url", original_turn_url)
        setattr(args, "turn_token", original_turn_token)
    return {"turn_settings": settings, "recipe_sync": recipe_sync, "turn_url": configured_turn_url}


def walkie_thread_seed_cards(uploaded: dict[str, dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    card_a = {
        "turn_id": "proof-thread-a-base",
        "session_id": "proof-thread-a-session",
        "card_id": "pucky_card_proof_thread_a",
        "title": "Proof HTML Dashboard",
        "summary": "Existing dashboard thread with an older artifact-rich transcript.",
        "icon": "bolt",
        "accent": "#72c2ff",
        "created_at": "2026-05-27T18:10:00Z",
        "html_path": uploaded["pocket_html"]["path"],
        "origin": {
            "runtime": "codex",
            "thread_id": "thread-A",
            "thread_title": "Proof HTML Dashboard",
            "rollout_path": "/data/home/codex/sessions/thread-A.jsonl",
            "source": "vscode",
            "model": "gpt-5.5",
            "model_provider": "openai",
            "reasoning_effort": "high",
        },
        "transcript_messages": [
            {"role": "user", "text": "Show me the latest dashboard.", "created_at": "2026-05-27T18:08:00Z"},
            {
                "role": "assistant",
                "text": "Here is the current dashboard and the notes that came with it.",
                "created_at": "2026-05-27T18:09:00Z",
                "attachments": [
                    {
                        "path": uploaded["morning_notes"]["path"],
                        "mime_type": "text/plain",
                        "title": "Morning notes TXT",
                        "alt": "Older assistant artifact for retention checks"
                    }
                ]
            }
        ]
    }
    card_b = {
        "turn_id": "proof-thread-b-base",
        "session_id": "proof-thread-b-session",
        "card_id": "pucky_card_proof_thread_b",
        "title": "Proof CSV Table",
        "summary": "Existing file thread with a displayable attachment surface.",
        "icon": "calendar",
        "accent": "#50d86a",
        "created_at": "2026-05-27T18:12:00Z",
        "origin": {
            "runtime": "codex",
            "thread_id": "thread-B",
            "thread_title": "Proof CSV Table",
            "rollout_path": "/data/home/codex/sessions/thread-B.jsonl",
            "source": "vscode",
            "model": "gpt-5.5",
            "model_provider": "openai",
            "reasoning_effort": "high",
        },
        "transcript_messages": [
            {"role": "user", "text": "Open the table.", "created_at": "2026-05-27T18:11:00Z"},
            {
                "role": "assistant",
                "text": "I attached the CSV and the rendered document preview.",
                "created_at": "2026-05-27T18:12:00Z",
                "attachments": [
                    {
                        "path": uploaded["morning_checklist"]["path"],
                        "mime_type": "text/csv",
                        "title": "Morning checklist CSV",
                        "alt": "Attachment viewer proof fixture"
                    }
                ]
            }
        ]
    }
    cards = [card_a, card_b]
    return cards, {"thread_a": card_a, "thread_b": card_b}


def seed_walkie_thread_cards(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
) -> dict[str, dict[str, Any]]:
    artifacts_dir = ROOT / "pucky_vm" / "ui_src" / "fixtures" / "artifacts"
    uploaded = {
        "pocket_html": upload_app_owned_file(
            args, runner, config,
            source_path=artifacts_dir / "pocket-computers.html",
            filename="proof-pocket-computers.html",
        ),
        "morning_notes": upload_app_owned_file(
            args, runner, config,
            source_path=artifacts_dir / "morning-notes.txt",
            filename="proof-morning-notes.txt",
        ),
        "morning_checklist": upload_app_owned_file(
            args, runner, config,
            source_path=artifacts_dir / "morning-checklist.csv",
            filename="proof-morning-checklist.csv",
        ),
    }
    cards, catalog = walkie_thread_seed_cards(uploaded)
    command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "ui.reply_cards.set", {"cards": cards}),
            timeout=120,
        )
    )
    wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="seeded walkie thread cards stored",
        predicate=lambda snapshot: len(card_thread_ids(snapshot)) >= len(catalog),
        timeout=20.0,
    )
    ui_debug_command(args, runner, config, "ui.debug.goto_home", {})
    ui_debug_command(args, runner, config, "ui.debug.refresh_cards", {})
    expected_threads = {str(item.get("origin", {}).get("thread_id") or item.get("thread_id") or "") for item in catalog.values()}
    expected_threads.discard("")
    wait_for_ui_surface_with_webview_relaunch(
        args,
        runner,
        config,
        lambda surface: str(surface.get("route") or "") == "feed"
        and expected_threads.issubset({str(item.get("thread_id") or "") for item in visible_cards(surface)}),
        timeout_seconds=20.0,
        description="seeded walkie thread home cards",
        retry_stage="seeded_walkie_thread_home_relaunch",
    )
    return catalog


def start_fixture_turn(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    fixture_name: str,
    fixture_path: str,
    debug_fixture_transcript: str = "",
    proof_reply_delay_ms: int = 0,
    fixture_start_delay_ms: int = WALKIE_THREAD_FIXTURE_START_DELAY_MS,
    speech_start_timeout_ms: int = 3000,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "trigger_source": "volume_up_hold",
        "capture_source": "fixture",
        "fixture_name": fixture_name,
        "fixture_path": fixture_path,
        "auto_endpoint": True,
        "speech_start_timeout_ms": speech_start_timeout_ms,
        "trailing_silence_ms": 800,
        "min_speech_ms": 180,
        "max_duration_ms": 15000,
        "feedback": False,
    }
    if debug_fixture_transcript:
        payload["debug_fixture_transcript"] = debug_fixture_transcript
    if proof_reply_delay_ms > 0:
        payload["proof_reply_delay_ms"] = proof_reply_delay_ms
    if fixture_start_delay_ms > 0:
        payload["fixture_start_delay_ms"] = fixture_start_delay_ms
    return command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.turn.start", payload),
            timeout=120,
        )
    )


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
    deadline = time.monotonic() + float(timeout_seconds)
    last_device: dict[str, Any] | None = None
    last_error = ""
    while time.monotonic() < deadline:
        try:
            device = broker_device_snapshot(config, timeout=3.0)
            if isinstance(device, dict):
                last_device = device
            candidate = device if isinstance(device, dict) else last_device
            if isinstance(candidate, dict) and candidate.get("device_id") == config.device_id and bool(candidate.get("online")):
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
                return {"stage": stage, "device": candidate, "ping": ping}
            can_probe_without_listing = not (
                isinstance(candidate, dict)
                and candidate.get("device_id") == config.device_id
                and not bool(candidate.get("online"))
            )
            if can_probe_without_listing and broker_health_available(config, timeout=1.0):
                exploratory_timeout_seconds = min(max(int(timeout_seconds), 15), 30)
                ping = command_result(
                    command_json(
                        runner,
                        puckyctl_command(
                            args,
                            config,
                            "ping",
                            {},
                            timeout_ms=puckyctl_timeout_ms(args, minimum_seconds=exploratory_timeout_seconds),
                        ),
                        timeout=exploratory_timeout_seconds,
                    )
                )
                fallback_device = {
                    "device_id": config.device_id,
                    "online": True,
                    "discovered_via_ping": True,
                }
                return {"stage": stage, "device": fallback_device, "ping": ping}
        except Exception as exc:
            last_error = str(exc)
            if isinstance(last_device, dict) and last_device.get("device_id") == config.device_id and bool(last_device.get("online")):
                try:
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
                    return {"stage": stage, "device": last_device, "ping": ping}
                except Exception as ping_exc:
                    last_error = str(ping_exc)
        try:
            clear_blocking_system_dialogs(args, runner, config)
        except Exception:
            pass
        time.sleep(1.0)
    raise SuiteError(f"Timed out waiting for broker command channel {stage}: device={last_device} error={last_error}")


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
            reply_cards_write_command(args, config, reply_payload),
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


def cmd_prove_accepted_timeout_recovery(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    require_emulator_serial(config.serial)
    if not serial_is_connected(args, runner, config.serial):
        raise SuiteError(f"Emulator is not connected: {config.serial}")

    Path(config.evidence_dir).mkdir(parents=True, exist_ok=True)
    bundle_refresh = {"ok": True, "skipped": True}
    if not args.skip_refresh:
        bundle_refresh = run_official_refresh(args, runner, config)
    bundle_status = command_result(command_json(runner, puckyctl_command(args, config, "ui.bundle.status", {}), timeout=120))

    runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=None, reply_mode="card_only", relaunch=False)
    fixtures = prepare_turn_fixtures(config)
    remote_fixture = push_turn_fixture(args, runner, config, fixtures["wake_weather"], "accepted_timeout_recovery")
    command_result(command_json(runner, puckyctl_command(args, config, "pucky.turn.debug.response_fault", {"clear": True}), timeout=120))
    command_result(command_json(runner, puckyctl_command(args, config, "ui.reply_cards.clear", {}), timeout=120))
    runner.run(launch_home_command(args, config), timeout=30)
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)

    debug_fault = command_result(
        command_json(
            runner,
            puckyctl_command(
                args,
                config,
                "pucky.turn.debug.response_fault",
                {"after_remote_accept": True, "error": "debug_forced_transport_timeout"},
            ),
            timeout=120,
        )
    )
    started = command_result(
        command_json(
            runner,
            puckyctl_command(
                args,
                config,
                "pucky.turn.start",
                {
                    "trigger_source": "volume_up_hold",
                    "source": "volume_up_hold",
                    "feedback": False,
                    "capture_source": "fixture",
                    "fixture_name": "accepted_timeout_recovery",
                    "fixture_path": remote_fixture,
                    "debug_fixture_transcript": "summarize three calm priorities for today",
                    "fixture_start_delay_ms": 400,
                },
            ),
            timeout=120,
        )
    )
    turn_id = str(
        started.get("turn_id")
        or started.get("local_session_id")
        or ((started.get("last_status") or {}).get("turn_id") if isinstance(started.get("last_status"), dict) else "")
        or ""
    ).strip()
    if not turn_id:
        raise SuiteError(f"Accepted-timeout proof did not return a turn id: {started}")
    pending_card_id = f"pending_turn_{turn_id}"

    wait_for_turn_status(
        args,
        runner,
        config,
        lambda status: str((status.get("last_status") or {}).get("turn_id") or "") == turn_id
        and status.get("visual_state") == "recording",
        timeout_seconds=10.0,
        sleep_seconds=0.1,
        description="accepted-timeout proof recording state",
    )
    stopped = command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.turn.stop", {"reason": "button_release", "feedback": False}),
            timeout=120,
        )
    )

    pending_history = wait_for_turn_history_record(
        args,
        runner,
        config,
        lambda _record, history_payload: (
            isinstance(history_record_by_turn_id(history_payload, turn_id), dict)
            and bool(history_record_by_turn_id(history_payload, turn_id).get("reply_recovery_pending"))
            and str(history_record_by_turn_id(history_payload, turn_id).get("latest_state") or "") != "failed"
            and "failed" not in turn_event_states(history_record_by_turn_id(history_payload, turn_id))
        ),
        timeout_seconds=float(args.turn_timeout_seconds),
        sleep_seconds=0.2,
        description="accepted turn transport recovery pending state",
    )
    pending_status = wait_for_turn_status(
        args,
        runner,
        config,
        lambda status: (
            str((status.get("last_status") or {}).get("turn_id") or "") == turn_id
            and not bool(status.get("failed"))
            and str((status.get("last_status") or {}).get("state") or "") != "failed"
            and (
                bool((status.get("last_status") or {}).get("reply_recovery_pending"))
                or str((status.get("last_status") or {}).get("phase") or "") == "reply_recovered"
            )
        ),
        timeout_seconds=float(args.turn_timeout_seconds),
        sleep_seconds=0.2,
        description="accepted turn live status without visible failed",
    )
    pending_snapshot = wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="accepted turn pending card never appeared",
        predicate=lambda snapshot: (
            (
                isinstance(snapshot_card_by_card_id(snapshot, pending_card_id), dict)
                and snapshot_card_by_card_id(snapshot, pending_card_id).get("pending_outbound") is True
                and str(snapshot_card_by_card_id(snapshot, pending_card_id).get("pending_label") or "") in {"Sending", "Thinking"}
                and str(snapshot_card_by_card_id(snapshot, pending_card_id).get("pending_label") or "") != "Failed"
            ) or (
                isinstance(snapshot_card_by_turn_id(snapshot, turn_id), dict)
                and not bool(snapshot_card_by_turn_id(snapshot, turn_id).get("pending_outbound"))
            )
        ),
        timeout=120,
    )
    pending_card = snapshot_card_by_card_id(pending_snapshot, pending_card_id)
    pending_read = command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.turn.read", {"turn_id": turn_id}),
            timeout=120,
        )
    )
    pending_screenshot = Path(config.evidence_dir) / "accepted-timeout-pending.png"
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, pending_screenshot)

    recovered_history = wait_for_turn_history_record(
        args,
        runner,
        config,
        lambda _record, history_payload: (
            isinstance(history_record_by_turn_id(history_payload, turn_id), dict)
            and bool(history_record_by_turn_id(history_payload, turn_id).get("reply_card_saved"))
            and str(history_record_by_turn_id(history_payload, turn_id).get("latest_state") or "") in {"completed", "speaking"}
            and str(history_record_by_turn_id(history_payload, turn_id).get("phase") or "") == "reply_recovered"
            and "failed" not in turn_event_states(history_record_by_turn_id(history_payload, turn_id))
        ),
        timeout_seconds=float(args.turn_timeout_seconds),
        sleep_seconds=0.5,
        description="accepted turn reply recovery completion",
    )
    recovered_snapshot = wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="accepted turn pending card was not replaced by the recovered reply card",
        predicate=lambda snapshot: (
            snapshot_card_by_card_id(snapshot, pending_card_id) is None
            and isinstance(snapshot_card_by_turn_id(snapshot, turn_id), dict)
            and not bool(snapshot_card_by_turn_id(snapshot, turn_id).get("pending_outbound"))
        ),
        timeout=120,
    )
    recovered_status = wait_for_turn_status(
        args,
        runner,
        config,
        lambda status: (
            str((status.get("last_status") or {}).get("turn_id") or "") == turn_id
            and str((status.get("last_status") or {}).get("phase") or "") == "reply_recovered"
            and str((status.get("last_status") or {}).get("state") or "") in {"completed", "speaking"}
        ),
        timeout_seconds=float(args.turn_timeout_seconds),
        sleep_seconds=0.5,
        description="accepted turn recovered status",
    )
    recovered_read = command_result(
        command_json(
            runner,
            puckyctl_command(args, config, "pucky.turn.read", {"turn_id": turn_id}),
            timeout=120,
        )
    )
    recovered_screenshot = Path(config.evidence_dir) / "accepted-timeout-recovered.png"
    if not args.dry_run:
        time.sleep(args.ui_dwell_seconds)
        capture_screenshot(args, runner, config, recovered_screenshot)

    command_result(command_json(runner, puckyctl_command(args, config, "pucky.turn.debug.response_fault", {"clear": True}), timeout=120))
    history_snapshot = command_result(command_json(runner, puckyctl_command(args, config, "pucky.turn.history", {}), timeout=120))
    final_snapshot = command_result(command_json(runner, puckyctl_command(args, config, "ui.reply_cards.get", {}), timeout=120))
    final_status = command_result(command_json(runner, puckyctl_command(args, config, "pucky.turn.status", {}), timeout=120))
    evidence = {
        "schema": "pucky.emulator_accepted_timeout_recovery_proof.v1",
        "created_at": now_iso(),
        "config": asdict(config),
        "bundle_refresh": bundle_refresh,
        "bundle_status": bundle_status,
        "runtime": runtime,
        "fixture_path": remote_fixture,
        "debug_fault": debug_fault,
        "started": started,
        "stopped": stopped,
        "pending": {
            "history": pending_history,
            "status": pending_status,
            "read": pending_read,
            "snapshot": pending_snapshot,
            "pending_card_observed": isinstance(pending_card, dict),
        },
        "recovered": {
            "history": recovered_history,
            "status": recovered_status,
            "read": recovered_read,
            "snapshot": recovered_snapshot,
        },
        "history": history_snapshot,
        "final_status": final_status,
        "final_snapshot": final_snapshot,
        "screenshots": {
            "pending": str(pending_screenshot),
            "recovered": str(recovered_screenshot),
        },
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }
    evidence_path = write_evidence(config, "accepted-timeout-recovery-proof.json", evidence)
    return {
        "schema": "pucky.emulator_accepted_timeout_recovery_proof_result.v1",
        "ok": True,
        "config": asdict(config),
        "turn_id": turn_id,
        "evidence_path": str(evidence_path),
        "screenshots": evidence["screenshots"],
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }


def data_url_text(mime_type: str, text: str) -> str:
    return f"data:{mime_type};charset=utf-8,{urllib.parse.quote(text, safe='')}"


def displayable_reply_file_cases(runtime_icon_slug: str) -> list[dict[str, Any]]:
    png_data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
    jpg_data = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
    svg_data = data_url_text("image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><rect width='24' height='24' fill='#66d9ef'/></svg>")
    wav_data = "data:audio/wav;base64,UklGRg=="
    mp3_data = "data:audio/mpeg;base64,SUQz"
    mp4_data = "data:video/mp4;base64,AAAA"
    webm_data = "data:video/webm;base64,GkXfoA=="
    doc_view = data_url_text("text/html", "<html><body><h1>Preview</h1><p>Proof</p></body></html>")

    def synthetic_case(
        key: str,
        card_title: str,
        card_icon: str,
        attachments: list[dict[str, Any]],
        *,
        expects_action: bool = True,
        opened_screenshot: str | None = None,
        aliases: list[str] | None = None,
    ) -> dict[str, Any]:
        return {
            "key": key,
            "card_title": card_title,
            "card_icon": card_icon,
            "source": "synthetic",
            "synthetic_attachments": attachments,
            "tile_screenshot": f"{key}-tile.png",
            "opened_screenshot": opened_screenshot if opened_screenshot is not None else (f"{key}-opened.png" if expects_action else ""),
            "expects_action": expects_action,
            "aliases": list(aliases or []),
        }

    return [
        synthetic_case("html", "Proof HTML Dashboard", "bolt", [{"title": "Proof HTML Dashboard File", "kind": "html", "mime_type": "text/html", "viewer": {"type": "html_iframe", "viewer_src": data_url_text("text/html", "<html><body><h1>HTML</h1></body></html>")}}]),
        synthetic_case("htm", "Proof HTM Panel", "bolt", [{"title": "Proof HTM Panel File", "kind": "html", "mime_type": "text/html", "viewer": {"type": "html_iframe", "viewer_src": data_url_text("text/html", "<html><body><h1>HTM</h1></body></html>")}}]),
        synthetic_case("csv", "Proof CSV Table", "calendar", [{"title": "Proof CSV Table File", "kind": "table", "mime_type": "text/csv", "viewer": {"type": "table", "viewer_src": data_url_text("text/csv", "option,cost,speed\nA,1,fast")}}]),
        synthetic_case("tsv", "Proof TSV Table", "calendar", [{"title": "Proof TSV Table File", "kind": "table", "mime_type": "text/tab-separated-values", "viewer": {"type": "table", "viewer_src": data_url_text("text/tab-separated-values", "option\tcost\tspeed\nA\t1\tfast")}}]),
        synthetic_case("txt", "Proof Text Note", "mail", [{"title": "Proof Text Note File", "kind": "text", "mime_type": "text/plain", "viewer": {"type": "text", "viewer_src": data_url_text("text/plain", "next step one\nnext step two")}}]),
        synthetic_case("md", "Proof Markdown Note", "mail", [{"title": "Proof Markdown Note File", "kind": "text", "mime_type": "text/markdown", "viewer": {"type": "text", "viewer_src": data_url_text("text/markdown", "# Heading\n- one\n- two")}}]),
        synthetic_case("json", "Proof JSON Summary", "clock", [{"title": "Proof JSON Summary File", "kind": "text", "mime_type": "application/json", "viewer": {"type": "text", "viewer_src": data_url_text("application/json", '{"summary":"ok","risks":["low"]}')}}]),
        synthetic_case("xml", "Proof XML Summary", "clock", [{"title": "Proof XML Summary File", "kind": "text", "mime_type": "application/xml", "viewer": {"type": "text", "viewer_src": data_url_text("application/xml", "<proof><status>ok</status></proof>")}}]),
        synthetic_case("png", "Proof PNG Image", "moon", [{"title": "Proof PNG Image File", "kind": "image", "mime_type": "image/png", "data_url": png_data}]),
        synthetic_case("jpg", "Proof JPG Image", "moon", [{"title": "Proof JPG Image File", "kind": "image", "mime_type": "image/jpeg", "data_url": jpg_data}]),
        synthetic_case("svg", "Proof SVG Image", "moon", [{"title": "Proof SVG Image File", "kind": "image", "mime_type": "image/svg+xml", "data_url": svg_data}]),
        synthetic_case("wav", "Proof WAV Audio", "bolt", [{"title": "Proof WAV Audio File", "kind": "audio", "mime_type": "audio/wav", "data_url": wav_data}]),
        synthetic_case("mp3", "Proof MP3 Audio", "bolt", [{"title": "Proof MP3 Audio File", "kind": "audio", "mime_type": "audio/mpeg", "data_url": mp3_data}]),
        synthetic_case("mp4", "Proof MP4 Video", "calendar", [{"title": "Proof MP4 Video File", "kind": "video", "mime_type": "video/mp4", "data_url": mp4_data}]),
        synthetic_case("webm", "Proof WEBM Video", "calendar", [{"title": "Proof WEBM Video File", "kind": "video", "mime_type": "video/webm", "data_url": webm_data}]),
        synthetic_case("pdf_derivative", "Proof PDF Viewer", "moon", [{"title": "Proof PDF Viewer File", "name": "proof.pdf", "kind": "document", "mime_type": "application/pdf", "viewer": {"type": "document_html", "viewer_src": doc_view}}]),
        synthetic_case("pdf_download_only", "Proof PDF Download", "moon", [{"title": "Proof PDF Download File", "name": "proof.pdf", "kind": "document", "mime_type": "application/pdf"}], expects_action=False),
        synthetic_case("docx_derivative", "Proof DOCX Viewer", "mail", [{"title": "Proof DOCX Viewer File", "name": "proof.docx", "kind": "document", "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "viewer": {"type": "document_html", "viewer_src": doc_view}}]),
        synthetic_case("docx_download_only", "Proof DOCX Download", "mail", [{"title": "Proof DOCX Download File", "name": "proof.docx", "kind": "document", "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}], expects_action=False),
        synthetic_case("pptx_derivative", "Proof PPTX Viewer", "clock", [{"title": "Proof PPTX Viewer File", "name": "proof.pptx", "kind": "document", "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "viewer": {"type": "document_html", "viewer_src": doc_view}}]),
        synthetic_case("pptx_download_only", "Proof PPTX Download", "clock", [{"title": "Proof PPTX Download File", "name": "proof.pptx", "kind": "document", "mime_type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}], expects_action=False),
        synthetic_case("xlsx_derivative", "Proof XLSX Viewer", "calendar", [{"title": "Proof XLSX Viewer File", "name": "proof.xlsx", "kind": "document", "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "viewer": {"type": "document_html", "viewer_src": doc_view}}]),
        synthetic_case("xlsx_download_only", "Proof XLSX Download", "calendar", [{"title": "Proof XLSX Download File", "name": "proof.xlsx", "kind": "document", "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}], expects_action=False),
        synthetic_case("multi", "Proof Multi Attachment Order", "bolt", [{"title": "Proof Multi First", "kind": "html", "mime_type": "text/html", "viewer": {"type": "html_iframe", "viewer_src": data_url_text("text/html", "<html><body><h1>First</h1></body></html>")}}, {"title": "Proof Multi Second", "kind": "table", "mime_type": "text/csv", "viewer": {"type": "table", "viewer_src": data_url_text("text/csv", "name,value\nsecond,2")}}], opened_screenshot="multi-opened-first.png"),
        synthetic_case("binary", "Proof Binary Archive", "mail", [{"title": "Proof Binary Archive File", "name": "proof-binary.zip", "kind": "archive", "mime_type": "application/zip"}], expects_action=False, opened_screenshot=""),
        synthetic_case("icon_added", "Proof Runtime Icon", runtime_icon_slug, [{"title": "Proof Runtime Icon File", "kind": "text", "mime_type": "text/plain", "viewer": {"type": "text", "viewer_src": data_url_text("text/plain", "proof icon\nready")}}]),
    ]


def synthetic_displayable_case_card(case: dict[str, Any], *, index: int = 1) -> dict[str, Any]:
    key = str(case.get("key") or f"case-{index}")
    turn_id = f"synthetic-displayable-{index:02d}-{key}"
    card_id = f"synthetic-card-{index:02d}-{key}"
    attachments = normalize_attachments(deepcopy(case.get("synthetic_attachments") or []))
    return {
        "card_id": card_id,
        "turn_id": turn_id,
        "session_id": turn_id,
        "title": str(case.get("card_title") or key),
        "summary": f"Synthetic proof payload for {case.get('card_title') or key}.",
        "icon": str(case.get("card_icon") or "bolt"),
        "created_at": now_iso(),
        "trace": {"schema": "pucky.turn_trace.v1", "sections": []},
        "transcript_messages": [
            {
                "role": "assistant",
                "text": f"Synthetic proof payload for {case.get('card_title') or key}.",
                "attachments": attachments,
            }
        ],
    }


def proof_visible_card(card: dict[str, Any]) -> dict[str, Any]:
    visible = deepcopy(card)
    visible["archived"] = False
    visible["deleted"] = False
    visible["read"] = False
    return visible


def materialize_reply_card(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    card: dict[str, Any],
    *,
    timeout: int = 180,
) -> tuple[dict[str, Any], dict[str, Any]]:
    visible_card = proof_visible_card(card)
    command = reply_cards_write_command(args, config, {"cards": [visible_card]})
    length = windows_command_length(command)
    if length >= SYNTHETIC_REPLY_CARD_COMMAND_BUDGET and str(visible_card.get("turn_id") or "").startswith("synthetic-displayable-"):
        raise SuiteError(f"Synthetic reply-card payload exceeded Windows command budget ({length} chars)")
    snapshot = command_result(command_json(runner, command, timeout=timeout))
    local_card = find_snapshot_card(
        snapshot,
        card_id=str(visible_card.get("card_id") or ""),
        turn_id=str(visible_card.get("turn_id") or visible_card.get("session_id") or ""),
    )
    return snapshot, local_card


def stop_active_turn(args: argparse.Namespace, runner: Runner, config: SlotConfig) -> dict[str, Any]:
    try:
        return command_result(
            command_json(
                runner,
                puckyctl_command(args, config, "pucky.turn.stop", {}),
                timeout=120,
            )
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def stabilize_displayable_proof_surface(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    stage: str,
    timeout_seconds: int,
) -> dict[str, Any]:
    turn_stop = stop_active_turn(args, runner, config)
    launch = launch_home_resilient(
        args,
        runner,
        config,
        wait_for_channel=not runner.dry_run,
        stage=stage,
        timeout_seconds=timeout_seconds,
    )
    home_reset = reset_home_surface_if_needed(args, runner, config)
    if not runner.dry_run:
        time.sleep(getattr(args, "ui_dwell_seconds", 1.0))
    final_surface = ui_surface(args, runner, config)
    result = {
        "turn_stop": turn_stop,
        "launch": launch,
        "home_reset": home_reset,
        "final_surface": final_surface,
    }
    if str(final_surface.get("route") or "") != "feed":
        runner.run(launch_command(args, config), timeout=30)
        route_retry: dict[str, Any] = {"launch_mode": "full_launch"}
        if not runner.dry_run:
            route_retry["channel"] = ensure_broker_command_channel(
                args,
                runner,
                config,
                stage=f"{stage}_route_retry",
                timeout_seconds=timeout_seconds,
            )
            time.sleep(getattr(args, "ui_dwell_seconds", 1.0))
        route_retry["home_reset"] = reset_home_surface_if_needed(args, runner, config)
        final_surface = ui_surface(args, runner, config)
        route_retry["final_surface"] = final_surface
        result["route_retry"] = route_retry
        result["final_surface"] = final_surface
    return result


def materialize_reply_card_resilient(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    card: dict[str, Any],
    *,
    stage: str,
    timeout: int = 180,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    timeout_seconds = max(45, int(math.ceil(timeout)))
    recovery = {
        "surface_reset": stabilize_displayable_proof_surface(
            args,
            runner,
            config,
            stage=stage,
            timeout_seconds=timeout_seconds,
        ),
        "retried_after_timeout": False,
    }
    try:
        snapshot, local_card = materialize_reply_card(args, runner, config, card, timeout=timeout)
        return recovery, snapshot, local_card
    except subprocess.TimeoutExpired:
        recovery["retried_after_timeout"] = True
        recovery["surface_reset_retry"] = stabilize_displayable_proof_surface(
            args,
            runner,
            config,
            stage=f"{stage}_retry",
            timeout_seconds=timeout_seconds,
        )
        snapshot, local_card = materialize_reply_card(args, runner, config, card, timeout=timeout)
        return recovery, snapshot, local_card


def card_icon_registry_contains(payload: dict[str, Any], name: str) -> bool:
    icons = payload.get("icons") if isinstance(payload.get("icons"), list) else []
    target = str(name or "").strip()
    return any(isinstance(item, dict) and str(item.get("name") or "").strip() == target for item in icons)


def archive_reply_card_for_displayable_proof(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    card: dict[str, Any],
    live_turn: dict[str, Any],
    *,
    client_action_id: str,
) -> dict[str, Any]:
    if bool(live_turn.get("synthetic")) or bool(live_turn.get("replayed")):
        archived = deepcopy(card)
        archived["archived"] = True
        archived["read"] = True
        return command_result(
            command_json(
                runner,
                reply_cards_write_command(args, config, {"cards": [archived]}),
                timeout=180,
            )
        )
    return command_result(
        command_json(
            runner,
            puckyctl_command(
                args,
                config,
                "pucky.feed.action",
                {
                    "card_id": str(card.get("card_id") or ""),
                    "session_id": str(card.get("session_id") or card.get("turn_id") or ""),
                    "action": "archive",
                    "client_action_id": client_action_id,
                },
            ),
            timeout=120,
        )
    )


def bundle_matches_local_master(bundle_status: dict[str, Any], root: Path = ROOT) -> bool:
    commit = str(bundle_status.get("source_commit_full") or "").strip()
    if not commit:
        return False
    try:
        state = local_git_state(root)
    except Exception:
        return False
    return (
        str(state.get("branch") or "") == "master"
        and not bool(state.get("dirty"))
        and str(state.get("head") or "") == str(state.get("upstream") or "")
        and commit == str(state.get("head") or "")
        and str(bundle_status.get("source_branch") or "") == "master"
        and not bool(bundle_status.get("source_dirty", True))
        and bool(str(bundle_status.get("ui_version") or "").strip())
    )


def scratch_bundle_needed(bundle_status: dict[str, Any], config: SlotConfig) -> bool:
    if bundle_matches_local_master(bundle_status):
        return False
    return str(bundle_status.get("ui_version") or "").strip() != str(config.bundle_version or "").strip()


def cmd_prove_displayable_reply_files(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    require_emulator_serial(config.serial)
    if not serial_is_connected(args, runner, config.serial):
        raise SuiteError(f"Emulator is not connected: {config.serial}")

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
    scratch_bundle = {"ok": True, "skipped": True}
    if args.skip_refresh and scratch_bundle_needed(bundle_status, config):
        scratch_bundle = ensure_scratch_bundle(args, runner, config)
        bundle_status = scratch_bundle["bundle_status"]
        stabilize_displayable_proof_surface(
            args,
            runner,
            config,
            stage="displayable_after_scratch_bundle",
            timeout_seconds=45,
        )
    pre_clear_surface_reset = stabilize_displayable_proof_surface(
        args,
        runner,
        config,
        stage="displayable_before_clear",
        timeout_seconds=max(45, int(args.viewer_timeout_seconds)),
    )
    reply_cards_clear = broker_command_result(
        args,
        runner,
        config,
        "ui.reply_cards.clear",
        {},
        timeout=max(120, int(args.viewer_timeout_seconds)),
        recovery_stage="displayable_reply_cards_clear",
        recovery_attempts=3,
    )
    initial_surface_reset = stabilize_displayable_proof_surface(
        args,
        runner,
        config,
        stage="displayable_after_clear",
        timeout_seconds=max(45, int(args.viewer_timeout_seconds)),
    )

    card_icons_url = args.vm_base_url.rstrip("/") + "/api/card-icons"
    runtime_icon_slug = "proof_orbit"
    cases = displayable_reply_file_cases(runtime_icon_slug)
    requires_live_turns = any(str(case.get("source") or "") not in {"synthetic"} for case in cases)
    if requires_live_turns and not args.turn_token:
        raise SuiteError("prove-displayable-reply-files requires --turn-token or PUCKY_API_TOKEN for live-turn cases")

    icon_registry_before = http_json_request(card_icons_url, timeout=30)
    runtime_icon_payload = {
        "name": runtime_icon_slug,
        "label": "Proof Orbit",
        "filled_svg": '<path d="M12 2 14.8 9.2 22 12 14.8 14.8 12 22 9.2 14.8 2 12 9.2 9.2Z"/>',
        "outline_svg": '<path d="M12 4.5 14 10 19.5 12 14 14 12 19.5 10 14 4.5 12 10 10Z"/>',
    }
    icon_registry_upsert: dict[str, Any]
    auth_token = str(args.turn_token or args.operator_token or "").strip()
    if card_icon_registry_contains(icon_registry_before, runtime_icon_slug):
        icon_registry_upsert = {"ok": True, "skipped": True, "reason": "already_present"}
        icon_registry_after = icon_registry_before
    elif auth_token:
        icon_registry_upsert = http_json_request(
            card_icons_url,
            timeout=30,
            method="POST",
            token=auth_token,
            body=runtime_icon_payload,
        )
        icon_registry_after = http_json_request(card_icons_url, timeout=30)
    else:
        raise SuiteError("prove-displayable-reply-files needs --turn-token or --operator-token when proof_orbit is not already registered")
    replay_cards: dict[str, dict[str, Any]] = {}
    if args.replay_broker_log:
        replay_cards = replay_cards_from_broker_log(
            args.replay_broker_log,
            [str(case["card_title"]) for case in cases],
            allow_partial=True,
        )

    results: list[dict[str, Any]] = []
    for index, case in enumerate(cases, start=1):
        prompt = str(case.get("prompt") or "")
        replay_card_candidate = replay_cards.get(str(case["card_title"]))
        if isinstance(replay_card_candidate, dict) and replay_card_matches_displayable_case(replay_card_candidate, case):
            replay_card = normalize_replay_card(replay_card_candidate)
            turn_id = str(replay_card.get("turn_id") or f"replay-{case['key']}")
            live_turn = {
                "ok": True,
                "replayed": True,
                "turn_id": turn_id,
                "card_id": str(replay_card.get("card_id") or ""),
                "title": str(replay_card.get("title") or ""),
            }
            live_feed_item = {
                "ok": True,
                "replayed": True,
                "turn_id": turn_id,
                "card_id": str(replay_card.get("card_id") or ""),
                "title": str(replay_card.get("title") or ""),
            }
            feed_sync = {"ok": True, "replayed": True, "skipped": True}
            materialize_recovery, materialized_snapshot, local_card = materialize_reply_card_resilient(
                args,
                runner,
                config,
                replay_card,
                stage=f"displayable_{case['key']}_materialize",
                timeout=180,
            )
            snapshot = materialized_snapshot
        elif str(case.get("source") or "") == "synthetic":
            synthetic_card = synthetic_displayable_case_card(case, index=index)
            turn_id = str(synthetic_card.get("turn_id") or f"synthetic-{case['key']}")
            live_turn = {
                "ok": True,
                "synthetic": True,
                "turn_id": turn_id,
                "card_id": str(synthetic_card.get("card_id") or ""),
                "title": str(synthetic_card.get("title") or ""),
            }
            live_feed_item = {
                "ok": True,
                "synthetic": True,
                "turn_id": turn_id,
                "card_id": str(synthetic_card.get("card_id") or ""),
                "title": str(synthetic_card.get("title") or ""),
            }
            feed_sync = {"ok": True, "synthetic": True, "skipped": True}
            materialize_recovery, materialized_snapshot, local_card = materialize_reply_card_resilient(
                args,
                runner,
                config,
                synthetic_card,
                stage=f"displayable_{case['key']}_materialize",
                timeout=180,
            )
            snapshot = materialized_snapshot
        else:
            turn_id = f"prove-displayable-{case['key']}-{int(time.time())}-{uuid.uuid4().hex[:6]}"
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
            materialize_recovery, materialized_snapshot, local_card = materialize_reply_card_resilient(
                args,
                runner,
                config,
                local_card,
                stage=f"displayable_{case['key']}_materialize",
                timeout=180,
            )
        post_materialize_surface_reset = stabilize_displayable_proof_surface(
            args,
            runner,
            config,
            stage=f"displayable_{case['key']}_home",
            timeout_seconds=max(45, int(args.viewer_timeout_seconds)),
        )

        tile_screenshot = Path(config.evidence_dir) / str(case["tile_screenshot"])
        opened_screenshot = Path(config.evidence_dir) / str(case["opened_screenshot"]) if case["opened_screenshot"] else None
        title = str(local_card.get("title") or case["card_title"])
        _, tile_xml, feed_recovery = ensure_feed_card_visible(
            args,
            runner,
            config,
            title=title,
            local_card=local_card,
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
            opened_xml, tile_xml = open_card_detail_with_retry(
                args,
                runner,
                config,
                case_key=str(case["key"]),
                title=title,
                card=local_card,
                tile_xml=tile_xml,
                timeout=float(args.viewer_timeout_seconds),
            )
            tile_xml_path.write_text(tile_xml, encoding="utf-8")
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
                "materialized_snapshot": materialized_snapshot,
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
                "feed_recovery": feed_recovery,
                "materialize_recovery": materialize_recovery,
                "post_materialize_surface_reset": post_materialize_surface_reset,
            }
        )

    archive_case = next((item for item in results if str(item.get("key") or "") == "icon_added"), results[-1] if results else None)
    archive_proof: dict[str, Any] = {}
    if archive_case:
        archive_title = str((archive_case.get("local_card") or {}).get("title") or archive_case.get("card_title") or "").strip()
        archive_card_id = str((archive_case.get("local_card") or {}).get("card_id") or "")
        archive_turn_id = str(archive_case.get("turn_id") or "")
        archive_title_pattern = re.escape(archive_title)
        runner.run(launch_home_command(args, config), timeout=30)
        if not args.dry_run:
            time.sleep(max(args.ui_dwell_seconds, 2.0))
        archive_card_node, archive_before_xml = wait_for_ui_node(
            args,
            runner,
            config,
            description=f"Did not find archive proof card titled {archive_title}",
            text_pattern=archive_title_pattern,
            timeout=float(args.viewer_timeout_seconds),
        )
        archive_before_xml_path = Path(config.evidence_dir) / "archive-before.xml"
        archive_before_xml_path.write_text(archive_before_xml, encoding="utf-8")
        archive_before_screenshot = Path(config.evidence_dir) / "archive-before.png"
        if not args.dry_run:
            capture_screenshot(args, runner, config, archive_before_screenshot)
        swipe_motion = perform_card_archive_swipe(
            args,
            runner,
            config,
            parse_node_bounds(archive_card_node.get("bounds", "")),
        )
        if not args.dry_run:
            time.sleep(max(args.ui_dwell_seconds, 0.75))
        archive_swipe_screenshot = Path(config.evidence_dir) / "archive-swipe-armed.png"
        if not args.dry_run:
            capture_screenshot(args, runner, config, archive_swipe_screenshot)
        archive_result = archive_reply_card_for_displayable_proof(
            args,
            runner,
            config,
            archive_case.get("local_card") if isinstance(archive_case.get("local_card"), dict) else {},
            archive_case.get("live_turn") if isinstance(archive_case.get("live_turn"), dict) else {},
            client_action_id=f"prove_displayable_archive_{int(time.time())}",
        )
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
            text_pattern=archive_title_pattern,
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
            "archive_result": archive_result,
            "swipe_motion": swipe_motion,
            "before_screenshot": str(archive_before_screenshot),
            "swipe_screenshot": str(archive_swipe_screenshot),
            "removed_screenshot": str(archive_removed_screenshot),
            "before_xml_path": str(archive_before_xml_path),
            "removed_xml_path": str(archive_removed_xml_path),
            "snapshot": archived_snapshot,
        }

    evidence = {
        "schema": "pucky.emulator_displayable_reply_files_proof.v1",
        "created_at": now_iso(),
        "config": asdict(config),
        "bundle_refresh": bundle_refresh,
        "bundle_status": bundle_status,
        "scratch_bundle": scratch_bundle,
        "pre_clear_surface_reset": pre_clear_surface_reset,
        "reply_cards_clear": reply_cards_clear,
        "initial_surface_reset": initial_surface_reset,
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
                    "before": archive_proof.get("before_screenshot", ""),
                    "swipe": archive_proof.get("swipe_screenshot", ""),
                    "removed": archive_proof.get("removed_screenshot", ""),
                }
            }
            if archive_proof
            else {}
        ),
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }


def apk_action_recipe_bundle() -> dict[str, Any]:
    def recipe(recipe_id: str, phrase: str, command: str, args: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": recipe_id,
            "phrases": [phrase],
            "match": "exact_utterance",
            "steps": [{"type": "device", "command": command, "args": args}],
        }

    return {
        "schema": "pucky.recipe_bundle.v1",
        "bundle_id": "prove_apk_actions",
        "version": 1,
        "updated_at": now_iso(),
        "recipes": [
            recipe(
                "recipe_notify_show",
                "send a notification",
                "notify.show",
                {
                    "id": "proof_recipe_notification",
                    "title": "Recipe notification",
                    "text": "Recipe notification body",
                    "auto_cancel": True,
                },
            ),
            recipe(
                "recipe_take_screenshot",
                "take a screenshot",
                "screenshot.capture",
                {"timeout_ms": 4000, "publish": True},
            ),
            recipe(
                "recipe_pin_location",
                "pin my location",
                "location.pin",
                {
                    "timeout_ms": 15000,
                    "max_cache_age_ms": 0,
                    "allow_pending": False,
                    "provider": "gps",
                },
            ),
            recipe(
                "recipe_flashlight",
                "turn on flashlight",
                "torch.set",
                {"auto_off_ms": 600},
            ),
        ],
    }


def cmd_prove_apk_actions(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    require_emulator_serial(config.serial)
    if not serial_is_connected(args, runner, config.serial):
        raise SuiteError(f"Emulator is not connected: {config.serial}")

    Path(config.evidence_dir).mkdir(parents=True, exist_ok=True)
    recipe_bundle = apk_action_recipe_bundle()
    if args.dry_run:
        ensure_broker_command_channel(args, runner, config, stage="apk_actions_start", timeout_seconds=90)
        runner.run(launch_home_command(args, config), timeout=30)
        runner.run([str(args.adb), "-s", config.serial, "emu", "geo", "fix", str(args.location_lon), str(args.location_lat)], timeout=30, check=False)
        dry_commands = [
            ("ui.bundle.status", {}),
            ("command.catalog", {}),
            ("capabilities.get", {}),
            ("permissions.get", {}),
            ("device.primitives.list", {}),
            ("notify.show", {"id": "proof_direct_notification", "title": "Direct notification", "text": "Direct APK action proof"}),
            ("notify.list_active", {}),
            ("notify.cancel", {"id": "proof_direct_notification"}),
            ("photo.capture", direct_photo_capture_payload()),
            ("pucky.turn.settings.set", {"arrival_cue_mode": "haptic"}),
            ("pucky.turn.arrival_cue.test", {"turn_id": "proof_direct_haptic"}),
            ("location.get", {"timeout_ms": 15000, "max_cache_age_ms": 0, "provider": "gps", "fresh": True}),
            ("camera.info", {}),
            ("torch.set", {"enabled": True, "auto_off_ms": 600}),
            ("pucky.recipes.clear", {}),
            ("pucky.recipes.sync", {"bundle": recipe_bundle}),
            ("pucky.recipes.list", {}),
            ("pucky.recipes.test", {"text": "send a notification", "execute": True}),
            ("pucky.recipes.test", {"text": "take a screenshot", "execute": True}),
            ("pucky.recipes.test", {"text": "pin my location", "execute": True}),
            ("pucky.recipes.test", {"text": "turn on flashlight", "execute": True}),
            ("pucky.clipboard.last", {}),
        ]
        for name, payload in dry_commands:
            runner.run(puckyctl_command(args, config, name, payload), timeout=180)
        return {
            "schema": "pucky.emulator_apk_actions_proof_result.v1",
            "ok": True,
            "config": asdict(config),
            "evidence_path": str(Path(config.evidence_dir) / "apk-actions-proof.json"),
            "commands": runner.planned,
            "dry_run": True,
        }

    try:
        channel = ensure_broker_command_channel(args, runner, config, stage="apk_actions_start", timeout_seconds=90)
        runner.run(launch_home_command(args, config), timeout=30)
        ensure_device_interactive(args, runner, config)
        grant_provision_permissions(args, runner, config)
        runner.run(adb_command(args, config.serial, ["shell", "pm", "grant", args.package_name, "android.permission.ACCESS_COARSE_LOCATION"]), timeout=30, check=False)
        runner.run(adb_command(args, config.serial, ["shell", "pm", "grant", args.package_name, "android.permission.ACCESS_FINE_LOCATION"]), timeout=30, check=False)
        accessibility_component = f"{args.package_name}/com.pucky.device.accessibility.PuckyAccessibilityService"
        runner.run(adb_command(args, config.serial, ["shell", "settings", "put", "secure", "enabled_accessibility_services", accessibility_component]), timeout=30, check=False)
        runner.run(adb_command(args, config.serial, ["shell", "settings", "put", "secure", "accessibility_enabled", "1"]), timeout=30, check=False)
        time.sleep(2.0)
        bundle_status = command_result(command_json(runner, puckyctl_command(args, config, "ui.bundle.status", {}), timeout=120))
        health_before = emulator_health_snapshot(args, runner, config)

        catalog = command_result(command_json(runner, puckyctl_command(args, config, "command.catalog", {}), timeout=120))
        capabilities = command_result(command_json(runner, puckyctl_command(args, config, "capabilities.get", {}), timeout=120))
        permissions = command_result(command_json(runner, puckyctl_command(args, config, "permissions.get", {}), timeout=120))
        primitives = command_result(command_json(runner, puckyctl_command(args, config, "device.primitives.list", {}), timeout=120))
        screen_lock_status = command_result(command_json(runner, puckyctl_command(args, config, "screen.lock.status", {}), timeout=120))
        if not bool(screen_lock_status.get("enabled_in_settings")):
            raise SuiteError(f"Accessibility service did not enable cleanly for screenshot proof: {screen_lock_status}")

        catalog_names = {str(item) for item in (catalog.get("commands") if isinstance(catalog.get("commands"), list) else [])}
        missing_commands = sorted(
            name
            for name in (
                "notify.show",
                "notify.cancel",
                "notify.list_active",
                "photo.capture",
                "location.get",
                "pucky.turn.settings.set",
                "pucky.turn.arrival_cue.test",
                "pucky.recipes.sync",
                "pucky.recipes.test",
                "pucky.clipboard.last",
            )
            if name not in catalog_names
        )
        if missing_commands:
            raise SuiteError(f"command.catalog missing required commands: {', '.join(missing_commands)}")

        primitive_names = {
            str(item.get("command") or "")
            for item in (primitives.get("primitives") if isinstance(primitives.get("primitives"), list) else [])
            if isinstance(item, dict)
        }
        missing_primitives = sorted(
            name
            for name in ("torch.set", "photo.capture", "location.pin", "screenshot.capture", "video.capture.start", "video.capture.stop", "notify.show")
            if name not in primitive_names
        )
        if missing_primitives:
            raise SuiteError(f"device.primitives.list missing required primitives: {', '.join(missing_primitives)}")

        notify_id = "proof_direct_notification"
        direct_notify_show = command_result(
            command_json(
                runner,
                puckyctl_command(
                    args,
                    config,
                    "notify.show",
                    {"id": notify_id, "title": "Direct notification", "text": "Direct APK action proof", "auto_cancel": True},
                ),
                timeout=120,
            )
        )
        direct_notify_active = command_result(command_json(runner, puckyctl_command(args, config, "notify.list_active", {}), timeout=120))
        if not any(int(item.get("id", -1)) == int(direct_notify_show.get("id", -2)) for item in direct_notify_active.get("active", []) if isinstance(item, dict)):
            raise SuiteError("Direct notification did not appear in notify.list_active")
        direct_notify_cancel = command_result(
            command_json(runner, puckyctl_command(args, config, "notify.cancel", {"id": notify_id}), timeout=120))
        direct_notify_after = command_result(command_json(runner, puckyctl_command(args, config, "notify.list_active", {}), timeout=120))
        if any(int(item.get("id", -1)) == int(direct_notify_show.get("id", -2)) for item in direct_notify_after.get("active", []) if isinstance(item, dict)):
            raise SuiteError("Direct notification remained active after notify.cancel")

        camera_info = command_result(command_json(runner, puckyctl_command(args, config, "camera.info", {}), timeout=120))
        direct_photo = direct_photo_capture(args, runner, config)
        direct_photo_path = str(direct_photo.get("app_private_path") or direct_photo.get("path") or "").strip()
        if not direct_photo.get("captured") or not direct_photo_path or not adb_path_exists(args, runner, config, direct_photo_path):
            raise SuiteError(f"Direct photo.capture did not produce a readable device file: {direct_photo}")
        direct_photo_pull = Path(config.evidence_dir) / "direct-command-photo.jpg"
        runner.run(adb_command(args, config.serial, ["pull", direct_photo_path, str(direct_photo_pull)]), timeout=60)

        direct_haptic_settings = command_result(
            command_json(runner, puckyctl_command(args, config, "pucky.turn.settings.set", {"arrival_cue_mode": "haptic"}), timeout=120)
        )
        direct_haptic = command_result(
            command_json(
                runner,
                puckyctl_command(args, config, "pucky.turn.arrival_cue.test", {"turn_id": "proof_direct_haptic"}),
                timeout=120,
            )
        )
        if not bool(direct_haptic.get("haptic_attempted")):
            raise SuiteError(f"Arrival cue test did not attempt haptic playback: {direct_haptic}")

        adb_emu_geo_fix(args, runner, config, lat=float(args.location_lat), lon=float(args.location_lon))
        time.sleep(2.0)
        direct_location = command_result(
            command_json(
                runner,
                puckyctl_command(
                    args,
                    config,
                    "location.get",
                    {
                        "timeout_ms": 15000,
                        "max_cache_age_ms": 0,
                        "provider": "gps",
                        "fresh": True,
                    },
                ),
                timeout=180,
            )
        )
        sample = direct_location.get("sample") if isinstance(direct_location.get("sample"), dict) else {}
        if direct_location.get("state") != "succeeded" or not sample or not bool(direct_location.get("fresh")):
            raise SuiteError(f"Direct location.get did not return a fresh sample after emulator geo fix: {direct_location}")

        torch_case: dict[str, Any] = {"status": "skipped", "reason": "camera_permission_or_flash_unavailable"}
        cameras = camera_info.get("cameras") if isinstance(camera_info.get("cameras"), list) else []
        if camera_info.get("camera_permission_granted") and any(bool(item.get("flash_available")) for item in cameras if isinstance(item, dict)):
            try:
                torch_result = command_result(
                    command_json(runner, puckyctl_command(args, config, "torch.set", {"enabled": True, "auto_off_ms": 600}), timeout=120)
                )
                torch_case = {"status": "passed", "result": torch_result}
            except Exception as exc:
                torch_case = {"status": "skipped", "reason": str(exc)}

        recipe_sync = sync_recipe_bundle(args, runner, config, recipe_bundle)
        recipe_notify = command_result(
            command_json(runner, puckyctl_command(args, config, "pucky.recipes.test", {"text": "send a notification", "execute": True}), timeout=180)
        )
        recipe_notify_clipboard = command_result(command_json(runner, puckyctl_command(args, config, "pucky.clipboard.last", {}), timeout=120))
        recipe_notify_active = command_result(command_json(runner, puckyctl_command(args, config, "notify.list_active", {}), timeout=120))
        recipe_notify_result = (
            recipe_notify.get("execution", {}).get("primary_action_result", {}).get("result", {})
            if isinstance(recipe_notify.get("execution"), dict)
            else {}
        )
        if not any(
            int(item.get("id", -1)) == int(recipe_notify_result.get("id", -2))
            for item in recipe_notify_active.get("active", [])
            if isinstance(item, dict)
        ):
            raise SuiteError("Recipe notification did not appear in notify.list_active")
        recipe_notify_cancel = command_result(
            command_json(
                runner,
                puckyctl_command(args, config, "notify.cancel", {"numeric_id": int(recipe_notify_result.get("id", 0))}),
                timeout=120,
            )
        )
        recipe_notify_after = command_result(command_json(runner, puckyctl_command(args, config, "notify.list_active", {}), timeout=120))

        recipe_screenshot = command_result(
            command_json(runner, puckyctl_command(args, config, "pucky.recipes.test", {"text": "take a screenshot", "execute": True}), timeout=240)
        )
        recipe_screenshot_clipboard = command_result(command_json(runner, puckyctl_command(args, config, "pucky.clipboard.last", {}), timeout=120))
        recipe_screenshot_result = (
            recipe_screenshot.get("execution", {}).get("primary_action_result", {}).get("result", {})
            if isinstance(recipe_screenshot.get("execution"), dict)
            else {}
        )
        recipe_screenshot_path = str(recipe_screenshot_result.get("app_private_path") or recipe_screenshot_result.get("path") or "").strip()
        if recipe_screenshot.get("execution_status") != "succeeded" or not recipe_screenshot_path or not adb_path_exists(args, runner, config, recipe_screenshot_path):
            raise SuiteError(f"Recipe screenshot did not produce a readable device file: {recipe_screenshot}")
        recipe_screenshot_pull = Path(config.evidence_dir) / "recipe-screenshot.jpg"
        runner.run(adb_command(args, config.serial, ["pull", recipe_screenshot_path, str(recipe_screenshot_pull)]), timeout=60)

        adb_emu_geo_fix(args, runner, config, lat=float(args.location_lat), lon=float(args.location_lon))
        time.sleep(2.0)
        recipe_location = command_result(
            command_json(runner, puckyctl_command(args, config, "pucky.recipes.test", {"text": "pin my location", "execute": True}), timeout=240)
        )
        recipe_location_clipboard = command_result(command_json(runner, puckyctl_command(args, config, "pucky.clipboard.last", {}), timeout=120))
        recipe_location_result = (
            recipe_location.get("execution", {}).get("primary_action_result", {}).get("result", {})
            if isinstance(recipe_location.get("execution"), dict)
            else {}
        )
        if recipe_location.get("execution_status") != "succeeded" or recipe_location_result.get("state") != "succeeded":
            raise SuiteError(f"Recipe location did not succeed after emulator geo fix: {recipe_location}")

        recipe_torch: dict[str, Any] = {"status": "skipped", "reason": "camera_permission_or_flash_unavailable"}
        if torch_case.get("status") == "passed":
            try:
                recipe_torch_result = command_result(
                    command_json(runner, puckyctl_command(args, config, "pucky.recipes.test", {"text": "turn on flashlight", "execute": True}), timeout=180)
                )
                recipe_torch = {
                    "status": "passed",
                    "result": recipe_torch_result,
                    "clipboard": command_result(command_json(runner, puckyctl_command(args, config, "pucky.clipboard.last", {}), timeout=120)),
                }
            except Exception as exc:
                recipe_torch = {"status": "skipped", "reason": str(exc)}

        health_after = emulator_health_snapshot(args, runner, config)
        evidence = {
            "schema": "pucky.emulator_apk_actions_proof.v1",
            "created_at": now_iso(),
            "config": asdict(config),
            "channel": channel,
            "bundle_status": bundle_status,
            "health_before": health_before,
            "catalog": catalog,
            "capabilities": capabilities,
            "permissions": permissions,
            "device_primitives": primitives,
            "screen_lock_status": screen_lock_status,
            "direct": {
                "notification": {
                    "show": direct_notify_show,
                    "active": direct_notify_active,
                    "cancel": direct_notify_cancel,
                    "active_after_cancel": direct_notify_after,
                },
                "photo": {
                    "camera_info": camera_info,
                    "result": direct_photo,
                    "pulled_path": str(direct_photo_pull),
                },
                "haptic": direct_haptic,
                "haptic_settings": direct_haptic_settings,
                "location": {
                    "seed": {"lat": args.location_lat, "lon": args.location_lon},
                    "result": direct_location,
                },
                "torch": torch_case,
            },
            "recipes": {
                "bundle": recipe_sync,
                "notification": {
                    "result": recipe_notify,
                    "clipboard": recipe_notify_clipboard,
                    "active": recipe_notify_active,
                    "cancel": recipe_notify_cancel,
                    "active_after_cancel": recipe_notify_after,
                },
                "screenshot": {
                    "result": recipe_screenshot,
                    "clipboard": recipe_screenshot_clipboard,
                    "pulled_path": str(recipe_screenshot_pull),
                },
                "location": {
                    "result": recipe_location,
                    "clipboard": recipe_location_clipboard,
                },
                "torch": recipe_torch,
            },
            "health_after": health_after,
            "commands": runner.planned,
            "dry_run": False,
        }
        evidence_path = write_evidence(config, "apk-actions-proof.json", evidence)
        return {
            "schema": "pucky.emulator_apk_actions_proof_result.v1",
            "ok": True,
            "config": asdict(config),
            "evidence_path": str(evidence_path),
            "artifacts": {
                "direct_photo": str(direct_photo_pull),
                "recipe_screenshot": str(recipe_screenshot_pull),
            },
            "commands": runner.planned,
            "dry_run": False,
        }
    except Exception as exc:
        failure = {
            "schema": "pucky.emulator_apk_actions_failure.v1",
            "created_at": now_iso(),
            "config": asdict(config),
            "error": str(exc),
            "health": emulator_health_snapshot(args, runner, config),
            "commands": runner.planned,
        }
        failure_path = write_evidence(config, "apk-actions-failure.json", failure)
        raise SuiteError(f"APK action proof failed; see {failure_path}: {exc}") from exc


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


def card_thread_ids(snapshot: dict[str, Any]) -> set[str]:
    cards = snapshot.get("cards") if isinstance(snapshot.get("cards"), list) else []
    out: set[str] = set()
    for item in cards:
        if not isinstance(item, dict):
            continue
        thread_id = str((item.get("origin") or {}).get("thread_id") or "")
        if thread_id:
            out.add(thread_id)
    return out


def capture_walkie_stage(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    scenario_dir: Path,
    *,
    screenshot_name: str,
    surface_name: str,
) -> dict[str, Any]:
    surface = ui_surface(args, runner, config)
    write_json_file(scenario_dir / surface_name, surface)
    if not runner.dry_run:
        capture_screenshot(args, runner, config, scenario_dir / screenshot_name)
    return surface


def wait_for_turn_completion_order(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    turn_ids: list[str],
    *,
    timeout_seconds: float = 30.0,
    sleep_seconds: float = 0.2,
) -> list[str]:
    pending = list(turn_ids)
    completed: list[str] = []
    deadline = time.monotonic() + timeout_seconds
    while pending and time.monotonic() < deadline:
        history_payload = turn_history(args, runner, config, limit=40)
        for turn_id in list(pending):
            record = history_record_by_turn_id(history_payload, turn_id)
            if isinstance(record, dict) and str(record.get("latest_state") or "") in {"completed", "speaking"}:
                completed.append(turn_id)
                pending.remove(turn_id)
        if pending:
            time.sleep(sleep_seconds)
    if pending:
        raise SuiteError(f"Timed out waiting for completion order: remaining={pending} completed={completed}")
    return completed


def turn_remote_completion_timestamp(read_payload: dict[str, Any] | None) -> str:
    if not isinstance(read_payload, dict):
        return ""
    turn = read_payload.get("turn")
    if not isinstance(turn, dict):
        return ""
    telemetry = turn.get("server_telemetry")
    if not isinstance(telemetry, dict) or str(telemetry.get("status") or "") != "ok":
        return ""
    timestamp = str(turn.get("updated_at") or "").strip()
    return timestamp


def wait_for_turn_remote_completion_order(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    turn_ids: list[str],
    *,
    proof_server: LocalProofTurnServer | None = None,
    timeout_seconds: float = 30.0,
    sleep_seconds: float = 0.2,
) -> list[str]:
    pending = list(turn_ids)
    observed: dict[str, str] = {}
    deadline = time.monotonic() + timeout_seconds
    while pending and time.monotonic() < deadline:
        for turn_id in list(pending):
            completed_at = ""
            if proof_server is not None:
                status_payload = proof_server.turn_status_snapshot(turn_id)
                if bool(status_payload.get("completed")) and str(status_payload.get("status") or "") == "ok":
                    completed_at = str(status_payload.get("updated_at") or "").strip()
            else:
                read_payload = read_turn_record(args, runner, config, turn_id)
                completed_at = turn_remote_completion_timestamp(read_payload)
            if completed_at:
                observed[turn_id] = completed_at
                pending.remove(turn_id)
        if pending:
            time.sleep(sleep_seconds)
    if pending:
        raise SuiteError(f"Timed out waiting for remote completion order: remaining={pending} observed={observed}")
    return [item[0] for item in sorted(observed.items(), key=lambda item: (item[1], item[0]))]


CONTINUATION_PROOF_REPLY_DELAY_MS = 6000


def run_continuation_scenario(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    scenario_name: str,
    card: dict[str, Any],
    open_action: str,
    expected_detail_type: str,
    expected_source_surface: str,
    remote_fixture_path: str,
    transcript_text: str,
    proof_reply_delay_ms: int = CONTINUATION_PROOF_REPLY_DELAY_MS,
) -> dict[str, Any]:
    scenario_dir = scenario_evidence_dir(config, scenario_name)
    before_cards = reply_cards_snapshot(args, runner, config)
    write_json_file(scenario_dir / "ui.reply_cards.before.json", before_cards)
    reset_walkie_thread_surface(args, runner, config)
    home_before = capture_walkie_stage(
        args, runner, config, scenario_dir,
        screenshot_name="home-before.png",
        surface_name="ui.surface.home-before.json",
    )
    ui_debug_command(args, runner, config, "ui.debug.open_card_action", {"session_id": card["session_id"], "action": open_action})
    before_send_surface = wait_for_ui_surface(
        args,
        runner,
        config,
        lambda surface: bool(surface.get("detail", {}).get("open"))
        and str(surface.get("detail", {}).get("type") or "") == expected_detail_type,
        description=f"{scenario_name} detail open",
    )
    write_json_file(scenario_dir / "ui.surface.before.json", before_send_surface)
    if not runner.dry_run:
        capture_screenshot(args, runner, config, scenario_dir / "before-send.png")
    scope_before = wait_for_voice_thread_scope(
        args,
        runner,
        config,
        lambda scope: scope.get("mode") == "existing_thread"
        and scope.get("source_surface") == expected_source_surface
        and str(scope.get("thread_id") or "") == str(card["origin"]["thread_id"]),
        description=f"{scenario_name} native scope",
    )
    write_json_file(scenario_dir / "voice.thread_scope.before.json", scope_before)

    clear_button_events(args, runner, config)
    started = start_fixture_turn(
        args, runner, config,
        fixture_name=scenario_name,
        fixture_path=remote_fixture_path,
        debug_fixture_transcript=transcript_text,
        proof_reply_delay_ms=proof_reply_delay_ms,
        fixture_start_delay_ms=continuation_fixture_start_delay_ms(expected_source_surface),
        speech_start_timeout_ms=FINAL_BOSS_SPEECH_START_TIMEOUT_MS,
    )
    turn_id = str(started.get("turn_id") or "")
    if not turn_id:
        raise SuiteError(f"{scenario_name} did not return a turn id")

    pending_surface, transcript_surface = wait_for_thread_progression(
        args,
        runner,
        config,
        thread_id=str(card["origin"]["thread_id"]),
        transcript_text=transcript_text,
        timeout_seconds=20.0,
        sleep_seconds=0.1,
        description=scenario_name,
    )
    write_json_file(scenario_dir / "ui.surface.pending.json", pending_surface)
    write_json_file(scenario_dir / "ui.surface.transcript.json", transcript_surface)
    if not runner.dry_run:
        capture_screenshot(args, runner, config, scenario_dir / "transcript-known.png")

    final_snapshot, final_card = wait_for_snapshot_card(args, runner, config, card_id="", turn_id=turn_id, timeout=float(args.turn_timeout_seconds))
    write_json_file(scenario_dir / "ui.reply_cards.final.json", final_snapshot)
    reset_walkie_thread_surface(args, runner, config)
    final_surface = wait_for_ui_surface(
        args,
        runner,
        config,
        lambda surface: len(visible_thread_cards(surface, str(card["origin"]["thread_id"]))) == 1
        and str(visible_thread_cards(surface, str(card["origin"]["thread_id"]))[0].get("kind") or "") != "pending_outbound",
        timeout_seconds=20.0,
        description=f"{scenario_name} final tile",
    )
    write_json_file(scenario_dir / "ui.surface.final.json", final_surface)
    write_json_file(scenario_dir / "pucky.turn.history.json", turn_history(args, runner, config, limit=30))
    write_json_file(scenario_dir / f"pucky.turn.read.{turn_id}.json", read_turn_record(args, runner, config, turn_id))
    write_json_file(
        scenario_dir / "turn.timing.json",
        build_turn_timing_artifact(args, runner, config, turn_ids=[turn_id], surface=final_surface),
    )
    if not runner.dry_run:
        capture_screenshot(args, runner, config, scenario_dir / "reply-complete.png")

    thread_id = str((final_card.get("origin") or {}).get("thread_id") or "")
    pending_card = visible_thread_cards(pending_surface, str(card["origin"]["thread_id"]))[0]
    proof = {
        "schema": WALKIE_THREAD_LAB_RESULT_SCHEMA,
        "scenario": scenario_name,
        "passes": {
            "scope_existing_thread": scope_before.get("mode") == "existing_thread",
            "scope_source_surface": scope_before.get("source_surface") == expected_source_surface,
            "thread_reused": thread_id == str(card["origin"]["thread_id"]),
            "pending_kind": str(pending_card.get("kind") or "") == "pending_outbound",
            "pending_placeholder": "Sending your message..." in str(pending_card.get("preview") or ""),
            "transcript_preview": transcript_text in str(visible_thread_cards(transcript_surface, str(card["origin"]["thread_id"]))[0].get("preview") or ""),
            "slot_preserved": visible_thread_index(pending_surface, str(card["origin"]["thread_id"])) == visible_thread_index(final_surface, str(card["origin"]["thread_id"])),
            "single_visible_tile": len(visible_thread_cards(final_surface, str(card["origin"]["thread_id"]))) == 1,
        },
    }
    write_json_file(scenario_dir / "proof.json", proof)
    require_walkie_proof_passes(proof)
    return {"scenario": scenario_name, "turn_id": turn_id, "thread_id": thread_id, "proof": proof}


def run_negative_home_scenario(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    remote_fixture_path: str,
    transcript_text: str,
) -> dict[str, Any]:
    scenario_name = "negative-home"
    scenario_dir = scenario_evidence_dir(config, scenario_name)
    before_cards = reply_cards_snapshot(args, runner, config)
    before_threads = card_thread_ids(before_cards)
    write_json_file(scenario_dir / "ui.reply_cards.before.json", before_cards)
    reset_walkie_thread_surface(args, runner, config)
    capture_walkie_stage(args, runner, config, scenario_dir, screenshot_name="home-before.png", surface_name="ui.surface.home-before.json")
    before_surface = capture_walkie_stage(args, runner, config, scenario_dir, screenshot_name="before-send.png", surface_name="ui.surface.before.json")
    scope_before = wait_for_voice_thread_scope(
        args,
        runner,
        config,
        lambda scope: scope.get("mode") == "new_thread" and not str(scope.get("thread_id") or ""),
        description=f"{scenario_name} native new-thread scope",
    )
    write_json_file(scenario_dir / "voice.thread_scope.before.json", scope_before)
    clear_button_events(args, runner, config)
    started = start_fixture_turn(
        args,
        runner,
        config,
        fixture_name=scenario_name,
        fixture_path=remote_fixture_path,
        debug_fixture_transcript=transcript_text,
        proof_reply_delay_ms=1000,
        fixture_start_delay_ms=WALKIE_THREAD_FIXTURE_START_DELAY_MS,
        speech_start_timeout_ms=FINAL_BOSS_SPEECH_START_TIMEOUT_MS,
    )
    turn_id = str(started.get("turn_id") or "")
    terminal = wait_for_turn_record(
        args,
        runner,
        config,
        turn_id,
        lambda record, _history: isinstance(record, dict)
        and str(record.get("latest_state") or "") in {"completed", "speaking", "discarded_silence", "failed"},
        timeout_seconds=25.0,
        sleep_seconds=0.2,
        description=f"{scenario_name} terminal turn state",
    )
    terminal_record = terminal.get("record") if isinstance(terminal, dict) else {}
    if str((terminal_record or {}).get("latest_state") or "") in {"discarded_silence", "failed"}:
        write_json_file(scenario_dir / "pucky.turn.history.json", terminal.get("history") if isinstance(terminal, dict) else {})
        write_json_file(scenario_dir / f"pucky.turn.read.{turn_id}.json", read_turn_record(args, runner, config, turn_id))
        raise SuiteError(f"{scenario_name} turn failed before card save: {terminal_record}")
    final_snapshot, final_card = wait_for_snapshot_card(args, runner, config, card_id="", turn_id=turn_id, timeout=float(args.turn_timeout_seconds))
    write_json_file(scenario_dir / "ui.reply_cards.final.json", final_snapshot)
    final_surface = capture_walkie_stage(args, runner, config, scenario_dir, screenshot_name="reply-complete.png", surface_name="ui.surface.final.json")
    write_json_file(scenario_dir / "pucky.turn.history.json", turn_history(args, runner, config, limit=30))
    write_json_file(scenario_dir / f"pucky.turn.read.{turn_id}.json", read_turn_record(args, runner, config, turn_id))
    write_json_file(
        scenario_dir / "turn.timing.json",
        build_turn_timing_artifact(args, runner, config, turn_ids=[turn_id], surface=final_surface),
    )
    new_thread_id = str((final_card.get("origin") or {}).get("thread_id") or "")
    proof = {
        "schema": WALKIE_THREAD_LAB_RESULT_SCHEMA,
        "scenario": scenario_name,
        "passes": {
            "scope_new_thread": scope_before.get("mode") == "new_thread",
            "scope_empty_thread_id": not bool(scope_before.get("thread_id")),
            "created_fresh_thread": bool(new_thread_id) and new_thread_id not in before_threads,
            "home_route": before_surface.get("route") == "feed",
            "final_visible": bool(final_surface.get("visible_cards")),
        },
    }
    write_json_file(scenario_dir / "proof.json", proof)
    require_walkie_proof_passes(proof)
    return {"scenario": scenario_name, "turn_id": turn_id, "thread_id": new_thread_id, "proof": proof}


def run_history_retention_scenario(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    card: dict[str, Any],
    remote_fixture_path: str,
    transcript_text: str,
) -> dict[str, Any]:
    scenario_name = "history-retention"
    scenario_dir = scenario_evidence_dir(config, scenario_name)
    before_cards = reply_cards_snapshot(args, runner, config)
    write_json_file(scenario_dir / "ui.reply_cards.before.json", before_cards)
    reset_walkie_thread_surface(args, runner, config)
    capture_walkie_stage(args, runner, config, scenario_dir, screenshot_name="home-before.png", surface_name="ui.surface.home-before.json")
    ui_debug_command(args, runner, config, "ui.debug.open_card_action", {"session_id": card["session_id"], "action": "transcript"})
    before_surface = wait_for_ui_surface(
        args,
        runner,
        config,
        lambda surface: bool(surface.get("detail", {}).get("open"))
        and str(surface.get("detail", {}).get("type") or "") == "transcript",
        description=f"{scenario_name} detail open",
    )
    write_json_file(scenario_dir / "ui.surface.before.json", before_surface)
    if not runner.dry_run:
        capture_screenshot(args, runner, config, scenario_dir / "before-send.png")
    scope_before = wait_for_voice_thread_scope(
        args,
        runner,
        config,
        lambda scope: scope.get("mode") == "existing_thread"
        and scope.get("source_surface") == "thread_transcript"
        and str(scope.get("thread_id") or "") == str(card["origin"]["thread_id"]),
        description=f"{scenario_name} native transcript scope",
    )
    write_json_file(scenario_dir / "voice.thread_scope.before.json", scope_before)

    clear_button_events(args, runner, config)
    started = start_fixture_turn(
        args,
        runner,
        config,
        fixture_name=scenario_name,
        fixture_path=remote_fixture_path,
        debug_fixture_transcript=transcript_text,
        proof_reply_delay_ms=CONTINUATION_PROOF_REPLY_DELAY_MS,
        fixture_start_delay_ms=HISTORY_RETENTION_FIXTURE_START_DELAY_MS,
        speech_start_timeout_ms=FINAL_BOSS_SPEECH_START_TIMEOUT_MS,
    )
    turn_id = str(started.get("turn_id") or "")
    if not turn_id:
        raise SuiteError("history-retention did not return a turn id")
    terminal = wait_for_turn_record(
        args,
        runner,
        config,
        turn_id,
        lambda record, _history: isinstance(record, dict)
        and str(record.get("latest_state") or "") in {"completed", "speaking", "discarded_silence", "failed"},
        timeout_seconds=25.0,
        sleep_seconds=0.2,
        description=f"{scenario_name} terminal turn state",
    )
    terminal_record = terminal.get("record") if isinstance(terminal, dict) else {}
    if str((terminal_record or {}).get("latest_state") or "") in {"discarded_silence", "failed"}:
        write_json_file(scenario_dir / "pucky.turn.history.json", terminal.get("history") if isinstance(terminal, dict) else {})
        write_json_file(scenario_dir / f"pucky.turn.read.{turn_id}.json", read_turn_record(args, runner, config, turn_id))
        raise SuiteError(f"{scenario_name} turn failed before card save: {terminal_record}")

    final_snapshot, final_card = wait_for_snapshot_card(
        args,
        runner,
        config,
        card_id="",
        turn_id=turn_id,
        timeout=float(args.turn_timeout_seconds),
    )
    write_json_file(scenario_dir / "ui.reply_cards.final.json", final_snapshot)
    reset_walkie_thread_surface(args, runner, config)
    final_surface = wait_for_ui_surface(
        args,
        runner,
        config,
        lambda surface: len(visible_thread_cards(surface, str(card["origin"]["thread_id"]))) == 1
        and str(visible_thread_cards(surface, str(card["origin"]["thread_id"]))[0].get("kind") or "") != "pending_outbound",
        timeout_seconds=20.0,
        description=f"{scenario_name} final tile",
    )
    write_json_file(scenario_dir / "ui.surface.final.json", final_surface)
    write_json_file(scenario_dir / "pucky.turn.history.json", turn_history(args, runner, config, limit=30))
    write_json_file(scenario_dir / f"pucky.turn.read.{turn_id}.json", read_turn_record(args, runner, config, turn_id))
    write_json_file(
        scenario_dir / "turn.timing.json",
        build_turn_timing_artifact(args, runner, config, turn_ids=[turn_id], surface=final_surface),
    )
    if not runner.dry_run:
        capture_screenshot(args, runner, config, scenario_dir / "reply-complete.png")
    messages = final_card.get("transcript_messages") if isinstance(final_card.get("transcript_messages"), list) else []
    user_message = next((item for item in reversed(messages) if isinstance(item, dict) and item.get("role") == "user"), {})
    assistant_with_attachments = next((item for item in messages if isinstance(item, dict) and item.get("role") == "assistant" and item.get("attachments")), {})
    ui_debug_command(args, runner, config, "ui.debug.open_card_action", {"session_id": final_card.get("session_id") or turn_id, "action": "transcript"})
    wait_for_ui_surface(args, runner, config, lambda surface: str(surface.get("detail", {}).get("type") or "") == "transcript", description="history transcript reopened")
    ui_debug_command(args, runner, config, "ui.debug.open_card_action", {"session_id": final_card.get("session_id") or turn_id, "action": "attachment"})
    attachment_surface = wait_for_ui_surface(args, runner, config, lambda surface: str(surface.get("detail", {}).get("type") or "") == "attachment", description="history attachment viewer")
    write_json_file(scenario_dir / "ui.surface.attachment.json", attachment_surface)
    proof = {
        "schema": WALKIE_THREAD_LAB_RESULT_SCHEMA,
        "scenario": scenario_name,
        "passes": {
            "scope_existing_thread": scope_before.get("mode") == "existing_thread",
            "scope_source_surface": scope_before.get("source_surface") == "thread_transcript",
            "thread_reused": str((final_card.get("origin") or {}).get("thread_id") or "") == str(card["origin"]["thread_id"]),
            "single_visible_tile": len(visible_thread_cards(final_surface, str(card["origin"]["thread_id"]))) == 1,
            "user_audio_chip_present": bool(user_message.get("attachments")),
            "older_assistant_artifact_present": bool(assistant_with_attachments.get("attachments")),
            "attachment_scope_preserved": str(attachment_surface.get("detail", {}).get("thread_id") or "") == "thread-A",
        },
    }
    write_json_file(scenario_dir / "proof.json", proof)
    require_walkie_proof_passes(proof)
    return {"scenario": scenario_name, "turn_id": turn_id, "thread_id": str((final_card.get("origin") or {}).get("thread_id") or ""), "proof": proof}


def run_final_boss_overlap_scenario(
    args: argparse.Namespace,
    runner: Runner,
    config: SlotConfig,
    *,
    card_a: dict[str, Any],
    card_b: dict[str, Any],
    remote_paths: dict[str, str],
    fixture_transcripts: dict[str, str],
    proof_server: LocalProofTurnServer,
) -> dict[str, Any]:
    scenario_name = "final-boss-overlap"
    scenario_dir = scenario_evidence_dir(config, scenario_name)
    # The proof lane needs deterministic overlap ordering despite navigation
    # time between A, fresh-thread, and B turn starts.
    effective_delay_ms_a, effective_delay_ms_new, effective_delay_ms_b = final_boss_effective_delays(args)
    reset_walkie_thread_surface(args, runner, config)
    capture_walkie_stage(args, runner, config, scenario_dir, screenshot_name="home-before.png", surface_name="ui.surface.before.json")
    clear_button_events(args, runner, config)

    ui_debug_command(args, runner, config, "ui.debug.open_card_action", {"session_id": card_a["session_id"], "action": "transcript"})
    wait_for_ui_surface(args, runner, config, lambda surface: str(surface.get("detail", {}).get("type") or "") == "transcript", description="final boss thread A detail")
    wait_for_voice_thread_scope(
        args,
        runner,
        config,
        lambda scope: scope.get("mode") == "existing_thread"
        and scope.get("source_surface") == "thread_transcript"
        and str(scope.get("thread_id") or "") == str(card_a["origin"]["thread_id"]),
        description="final boss thread A native scope",
    )
    turn_a_id = str(start_fixture_turn(
        args,
        runner,
        config,
        fixture_name="final-boss-overlap-a",
        fixture_path=remote_paths["thread_alpha"],
        debug_fixture_transcript=fixture_transcripts["thread_alpha"],
        proof_reply_delay_ms=effective_delay_ms_a,
        fixture_start_delay_ms=FINAL_BOSS_FIXTURE_START_DELAY_MS,
        speech_start_timeout_ms=FINAL_BOSS_SPEECH_START_TIMEOUT_MS,
    ).get("turn_id") or "")

    ui_debug_command(args, runner, config, "ui.debug.goto_home", {})
    wait_for_voice_thread_scope(
        args,
        runner,
        config,
        lambda scope: scope.get("mode") == "new_thread" and not str(scope.get("thread_id") or ""),
        description="final boss fresh native scope",
    )
    pending_a_snapshot = wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="final boss thread A pending tile",
        predicate=lambda snapshot: len(visible_thread_cards(surface_from_snapshot(snapshot), "thread-A")) == 1
        and bool(visible_thread_cards(surface_from_snapshot(snapshot), "thread-A")[0].get("pending_outbound")),
        timeout=20.0,
        sleep_seconds=0.1,
    )
    pending_a_surface = surface_from_snapshot(pending_a_snapshot)
    turn_b_id = str(start_fixture_turn(
        args,
        runner,
        config,
        fixture_name="final-boss-overlap-new",
        fixture_path=remote_paths["fresh_thread"],
        debug_fixture_transcript=fixture_transcripts["fresh_thread"],
        proof_reply_delay_ms=effective_delay_ms_new,
        fixture_start_delay_ms=FINAL_BOSS_FIXTURE_START_DELAY_MS,
        speech_start_timeout_ms=FINAL_BOSS_SPEECH_START_TIMEOUT_MS,
    ).get("turn_id") or "")
    pending_new_snapshot = wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="final boss fresh thread pending tile",
        predicate=lambda snapshot: any(
            bool(item.get("pending_outbound")) and str(item.get("session_id") or "") == turn_b_id
            for item in visible_cards(surface_from_snapshot(snapshot))
        ),
        timeout=20.0,
        sleep_seconds=0.1,
    )
    pending_new_surface = surface_from_snapshot(pending_new_snapshot)

    ui_debug_command(args, runner, config, "ui.debug.refresh_cards", {})
    ui_debug_command(args, runner, config, "ui.debug.open_card_action", {"session_id": card_b["session_id"], "action": "transcript"})
    wait_for_ui_surface(args, runner, config, lambda surface: str(surface.get("detail", {}).get("type") or "") == "transcript", description="final boss thread B detail")
    wait_for_voice_thread_scope(
        args,
        runner,
        config,
        lambda scope: scope.get("mode") == "existing_thread"
        and scope.get("source_surface") == "thread_transcript"
        and str(scope.get("thread_id") or "") == str(card_b["origin"]["thread_id"]),
        description="final boss thread B native scope",
    )
    turn_c_id = str(start_fixture_turn(
        args,
        runner,
        config,
        fixture_name="final-boss-overlap-b",
        fixture_path=remote_paths["thread_bravo"],
        debug_fixture_transcript=fixture_transcripts["thread_bravo"],
        proof_reply_delay_ms=effective_delay_ms_b,
        fixture_start_delay_ms=FINAL_BOSS_FIXTURE_START_DELAY_MS,
        speech_start_timeout_ms=FINAL_BOSS_SPEECH_START_TIMEOUT_MS,
    ).get("turn_id") or "")

    ui_debug_command(args, runner, config, "ui.debug.goto_home", {})
    pending_snapshot = wait_for_snapshot_condition(
        args,
        runner,
        config,
        description="final boss thread B pending tile",
        predicate=lambda snapshot: len(visible_thread_cards(surface_from_snapshot(snapshot), "thread-B")) == 1
        and bool(visible_thread_cards(surface_from_snapshot(snapshot), "thread-B")[0].get("pending_outbound")),
        timeout=20.0,
        sleep_seconds=0.1,
    )
    pending_surface = surface_from_snapshot(pending_snapshot)
    write_json_file(scenario_dir / "ui.surface.pending.json", pending_surface)
    if not runner.dry_run:
        capture_screenshot(args, runner, config, scenario_dir / "pending.png")
    completion_order = wait_for_turn_remote_completion_order(
        args,
        runner,
        config,
        [turn_c_id, turn_b_id, turn_a_id],
        proof_server=proof_server,
        timeout_seconds=float(args.turn_timeout_seconds),
    )
    final_snapshot = reply_cards_snapshot(args, runner, config)
    write_json_file(scenario_dir / "ui.reply_cards.final.json", final_snapshot)
    final_surface = surface_from_snapshot(final_snapshot)
    write_json_file(scenario_dir / "ui.surface.final.json", final_surface)
    if not runner.dry_run:
        capture_screenshot(args, runner, config, scenario_dir / "reply-complete.png")
    write_json_file(scenario_dir / "pucky.turn.history.json", turn_history(args, runner, config, limit=40))
    for turn_id in (turn_a_id, turn_b_id, turn_c_id):
        write_json_file(scenario_dir / f"pucky.turn.read.{turn_id}.json", read_turn_record(args, runner, config, turn_id))
    write_json_file(
        scenario_dir / "turn.timing.json",
        build_turn_timing_artifact(args, runner, config, turn_ids=[turn_a_id, turn_b_id, turn_c_id], surface=final_surface),
    )
    card_a_final = snapshot_card_by_turn_id(final_snapshot, turn_a_id) or {}
    card_b_final = snapshot_card_by_turn_id(final_snapshot, turn_b_id) or {}
    card_c_final = snapshot_card_by_turn_id(final_snapshot, turn_c_id) or {}
    proof = {
        "schema": WALKIE_THREAD_LAB_RESULT_SCHEMA,
        "scenario": scenario_name,
        "passes": {
            "turn_a_thread": str((card_a_final.get("origin") or {}).get("thread_id") or "") == "thread-A",
            "turn_b_new_thread": str((card_b_final.get("origin") or {}).get("thread_id") or "") not in {"", "thread-A", "thread-B"},
            "turn_c_thread": str((card_c_final.get("origin") or {}).get("thread_id") or "") == "thread-B",
            "pending_thread_a": len(visible_thread_cards(pending_a_surface, "thread-A")) == 1
            and bool(visible_thread_cards(pending_a_surface, "thread-A")[0].get("pending_outbound")),
            "pending_thread_b": len(visible_thread_cards(pending_surface, "thread-B")) == 1
            and bool(visible_thread_cards(pending_surface, "thread-B")[0].get("pending_outbound")),
            "pending_new_thread_present": any(
                bool(item.get("pending_outbound")) and str(item.get("session_id") or "") == turn_b_id
                for item in visible_cards(pending_new_surface)
            ),
            "completion_order": completion_order == [turn_c_id, turn_b_id, turn_a_id],
            "final_tiles_isolated": len(visible_thread_cards(final_surface, "thread-A")) == 1 and len(visible_thread_cards(final_surface, "thread-B")) == 1,
        },
        "completion_order": completion_order,
        "requested_delays_ms": {
            "thread_a": int(args.final_boss_delay_ms_a),
            "fresh_thread": int(args.final_boss_delay_ms_new),
            "thread_b": int(args.final_boss_delay_ms_b),
        },
        "applied_delays_ms": {
            "thread_a": effective_delay_ms_a,
            "fresh_thread": effective_delay_ms_new,
            "thread_b": effective_delay_ms_b,
        },
    }
    write_json_file(scenario_dir / "proof.json", proof)
    require_walkie_proof_passes(proof)
    return {"scenario": scenario_name, "turn_ids": {"a": turn_a_id, "b": turn_b_id, "c": turn_c_id}, "proof": proof}


def cmd_walkie_thread_lab(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=args.dry_run)
    config = config_for_command(ROOT, args.slot, dry_run=args.dry_run)
    require_emulator_serial(config.serial)
    if not serial_is_connected(args, runner, config.serial):
        raise SuiteError(f"Emulator is not connected: {config.serial}")

    Path(config.evidence_dir).mkdir(parents=True, exist_ok=True)
    if args.dry_run:
        scenarios = walkie_thread_lab_scenarios_for_request(args.scenario)
        return {
            "ok": True,
            "schema": WALKIE_THREAD_LAB_RESULT_SCHEMA,
            "scenario": args.scenario,
            "config": asdict(config),
            "results": [{"scenario": name, "planned": True, "evidence_files": WALKIE_THREAD_LAB_EVIDENCE_FILES} for name in scenarios],
            "commands": runner.planned,
            "dry_run": True,
        }
    if not args.skip_refresh:
        run_official_refresh(args, runner, config)
    grant_runtime_permissions(args, runner, config)
    dismiss_permission_controller(args, runner, config)
    runner.run(launch_command(args, config), timeout=30)
    ensure_broker_command_channel(args, runner, config, stage="walkie_thread_lab", timeout_seconds=max(90, args.refresh_timeout_seconds))

    fixtures = prepare_turn_fixtures(config)
    fixture_transcripts = {
        "thread_continue": "Should we change these goals?",
        "file_revise": "Can you revise this file?",
        "fresh_thread": "Fresh thread follow up",
        "thread_bravo": "Bravo thread follow up",
        "thread_alpha": "Alpha thread continue",
    }
    remote_paths: dict[str, str] = {}
    for name in fixture_transcripts:
        transport_name = WALKIE_THREAD_TRANSPORT_FIXTURES.get(name, name)
        remote_paths[name] = push_turn_fixture(args, runner, config, fixtures[transport_name], name)
    scenarios = walkie_thread_lab_scenarios_for_request(args.scenario)
    results: list[dict[str, Any]] = []
    runtime: dict[str, Any] | None = None

    def run_named_scenario(scenario: str) -> dict[str, Any]:
        nonlocal runtime
        proof_server = LocalProofTurnServer(proof_reply_delay_enabled=True)
        proof_server.start()
        try:
            for name, transcript in fixture_transcripts.items():
                proof_server.register_fixture(fixtures[name], transcript)
            runtime = configure_turn_lab_runtime(args, runner, config, fake_turn=proof_server, reply_mode="card_only", relaunch=True)
            reset_walkie_thread_lab_state(args, runner, config)
            catalog = seed_walkie_thread_cards(args, runner, config)
            if scenario == "transcript-continuation":
                return run_continuation_scenario(args, runner, config, scenario_name=scenario, card=catalog["thread_a"], open_action="transcript", expected_detail_type="transcript", expected_source_surface="thread_transcript", remote_fixture_path=remote_paths["thread_continue"], transcript_text=fixture_transcripts["thread_continue"])
            if scenario == "page-continuation":
                return run_continuation_scenario(args, runner, config, scenario_name=scenario, card=catalog["thread_a"], open_action="page", expected_detail_type="page", expected_source_surface="thread_page", remote_fixture_path=remote_paths["file_revise"], transcript_text=fixture_transcripts["file_revise"])
            if scenario == "attachment-continuation":
                return run_continuation_scenario(args, runner, config, scenario_name=scenario, card=catalog["thread_b"], open_action="attachment", expected_detail_type="attachment", expected_source_surface="thread_attachment", remote_fixture_path=remote_paths["file_revise"], transcript_text=fixture_transcripts["file_revise"])
            if scenario == "negative-home":
                return run_negative_home_scenario(args, runner, config, remote_fixture_path=remote_paths["fresh_thread"], transcript_text=fixture_transcripts["fresh_thread"])
            if scenario == "history-retention":
                return run_history_retention_scenario(args, runner, config, card=catalog["thread_a"], remote_fixture_path=remote_paths["thread_continue"], transcript_text=fixture_transcripts["thread_continue"])
            if scenario == "final-boss-overlap":
                return run_final_boss_overlap_scenario(
                    args,
                    runner,
                    config,
                    card_a=catalog["thread_a"],
                    card_b=catalog["thread_b"],
                    remote_paths=remote_paths,
                    fixture_transcripts=fixture_transcripts,
                    proof_server=proof_server,
                )
            raise SuiteError(f"Unsupported scenario: {scenario}")
        finally:
            proof_server.stop()

    retriable_scenarios = {
        "transcript-continuation",
        "page-continuation",
        "attachment-continuation",
        "history-retention",
        "negative-home",
    }
    for scenario in scenarios:
        try:
            results.append(run_named_scenario(scenario))
        except Exception as exc:
            if args.dry_run or scenario not in retriable_scenarios:
                raise
            if should_recover_walkie_thread_lab_exception(exc):
                recover_walkie_thread_lab_slot(args)
            results.append(run_named_scenario(scenario))
    aggregate_proof = write_walkie_thread_lab_aggregate_proof(config, results) if args.scenario == "all" else None
    payload = {
        "ok": True,
        "schema": WALKIE_THREAD_LAB_RESULT_SCHEMA,
        "scenario": args.scenario,
        "config": asdict(config),
        "runtime": runtime or {},
        "results": results,
        "commands": runner.planned,
        "dry_run": args.dry_run,
    }
    if aggregate_proof is not None:
        payload["proof"] = aggregate_proof
    return payload


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


def cmd_free_slot(args: argparse.Namespace) -> dict[str, Any]:
    runner = Runner(dry_run=bool(args.dry_run))
    config = first_free_slot_config(args, runner, ROOT, start_slot=3, end_slot=10)
    return {
        "ok": True,
        "range": [3, 10],
        "config": asdict(config),
        "commands": runner.planned,
        "dry_run": bool(args.dry_run),
    }


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
    free_slot_parser = sub.add_parser("free-slot")
    add_common(free_slot_parser)
    for name in (
        "create",
        "start",
        "provision",
        "seed-ui",
        "smoke",
        "wake-lab",
        "stop",
        "clean",
        "prove-thread-origin",
        "prove-pending-outbound-feed",
        "prove-accepted-timeout-recovery",
        "prove-displayable-reply-files",
        "prove-apk-actions",
        "walkie-thread-lab",
    ):
        if name == "walkie-thread-lab":
            item = sub.add_parser(
                name,
                aliases=("walkie-continuation-proof",),
                help=WALKIE_THREAD_LAB_DESCRIPTION,
                description=WALKIE_THREAD_LAB_DESCRIPTION,
            )
        else:
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
        if name == "prove-accepted-timeout-recovery":
            item.add_argument("--turn-url", default=os.environ.get("PUCKY_TURN_URL", DEFAULT_TURN_URL))
            item.add_argument("--turn-token", default=os.environ.get("PUCKY_API_TOKEN", ""))
            item.add_argument("--vm-base-url", default="https://pucky.fly.dev")
            item.add_argument("--operator-token", default=os.environ.get("PUCKY_OPERATOR_TOKEN", ""))
            item.add_argument("--turn-timeout-seconds", type=int, default=180)
            item.add_argument("--refresh-timeout-seconds", type=int, default=180)
            item.add_argument("--ui-dwell-seconds", type=float, default=1.0)
            item.add_argument("--skip-refresh", action="store_true")
        if name == "prove-displayable-reply-files":
            item.add_argument("--turn-url", default=os.environ.get("PUCKY_TURN_URL", DEFAULT_TURN_URL))
            item.add_argument("--turn-token", default=os.environ.get("PUCKY_API_TOKEN", ""))
            item.add_argument("--vm-base-url", default="https://pucky.fly.dev")
            item.add_argument("--operator-token", default=os.environ.get("PUCKY_OPERATOR_TOKEN", ""))
            item.add_argument("--replay-broker-log", type=Path, default=None)
            item.add_argument("--turn-timeout-seconds", type=int, default=180)
            item.add_argument("--refresh-timeout-seconds", type=int, default=180)
            item.add_argument("--snapshot-timeout-seconds", type=int, default=120)
            item.add_argument("--viewer-timeout-seconds", type=int, default=30)
            item.add_argument("--ui-dwell-seconds", type=float, default=1.0)
            item.add_argument("--long-press-ms", type=int, default=420)
            item.add_argument("--skip-refresh", action="store_true")
        if name == "prove-apk-actions":
            item.add_argument("--location-lat", type=float, default=37.4220)
            item.add_argument("--location-lon", type=float, default=-122.0841)
        if name == "walkie-thread-lab":
            item.add_argument("--scenario", choices=WALKIE_THREAD_LAB_SCENARIOS, required=True)
            item.add_argument("--vm-base-url", default="https://pucky.fly.dev")
            item.add_argument("--operator-token", default=os.environ.get("PUCKY_OPERATOR_TOKEN", ""))
            item.add_argument("--turn-timeout-seconds", type=int, default=180)
            item.add_argument("--refresh-timeout-seconds", type=int, default=180)
            item.add_argument("--snapshot-timeout-seconds", type=int, default=120)
            item.add_argument("--viewer-timeout-seconds", type=int, default=30)
            item.add_argument("--ui-dwell-seconds", type=float, default=1.0)
            item.add_argument("--final-boss-delay-ms-a", type=int, default=6000)
            item.add_argument("--final-boss-delay-ms-new", type=int, default=3000)
            item.add_argument("--final-boss-delay-ms-b", type=int, default=0)
            item.add_argument("--page-surface", choices=("page", "attachment", "auto"), default="auto")
            item.add_argument("--skip-refresh", action="store_true")
    return parser


def dispatch(args: argparse.Namespace) -> dict[str, Any]:
    if args.command == "doctor":
        return doctor(args)
    if args.command == "free-slot":
        return cmd_free_slot(args)
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
    if args.command == "prove-accepted-timeout-recovery":
        return cmd_prove_accepted_timeout_recovery(args)
    if args.command == "prove-displayable-reply-files":
        return cmd_prove_displayable_reply_files(args)
    if args.command == "prove-apk-actions":
        return cmd_prove_apk_actions(args)
    if args.command in {"walkie-thread-lab", "walkie-continuation-proof"}:
        return cmd_walkie_thread_lab(args)
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
