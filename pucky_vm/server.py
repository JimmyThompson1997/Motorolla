from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import threading
import time
import uuid
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Protocol
from urllib.parse import unquote

from .codex_app_server import CodexAppServerClient, command_from_env
from .providers import DeepgramSTT, KokoroTTS
from .ui_bundle import UI_SRC, build_ui_bundle


DEFAULT_DEVELOPER_INSTRUCTIONS = (
    "You are Pucky, a concise voice assistant. Return only strict JSON with keys "
    "reply_text, card_title, card_icon, and html. reply_text is the spoken user-facing answer. "
    "card_title is a short title. card_icon must be one of clock, bolt, calendar, moon, mail. "
    "html is either null or an object with title and content, where content is a complete HTML document. "
    "Do not include markdown fences or any text outside the JSON object."
)
ALLOWED_CONTENT_TYPES = {"audio/mp4", "audio/wav", "audio/x-wav", "audio/mpeg", "application/octet-stream"}
ALLOWED_CARD_ICONS = {"clock", "bolt", "calendar", "moon", "mail"}
DEFAULT_CARD_ICON = "mail"
MAX_CARD_TITLE_CHARS = 64


class STTProvider(Protocol):
    def transcribe(self, audio: bytes, content_type: str) -> str: ...


class TTSProvider(Protocol):
    def synthesize(self, text: str) -> tuple[bytes, str]: ...


class CodexProvider(Protocol):
    @property
    def ready(self) -> bool: ...

    @property
    def thread_id(self) -> str | None: ...

    def start(self) -> None: ...

    def send_turn(self, text: str) -> str: ...


@dataclass(frozen=True)
class ReplyEnvelope:
    reply_text: str
    card_title: str
    card_icon: str
    html_title: str = ""
    html_content: str = ""


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    pucky_api_token: str
    deepgram_api_key: str
    deepinfra_api_key: str
    max_audio_bytes: int
    max_html_bytes: int
    tts_voice: str
    tts_response_format: str
    tts_speed: float
    codex_command: list[str]
    codex_cwd: str | None
    codex_startup_timeout: float
    codex_turn_timeout: float
    developer_instructions: str

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            host=os.environ.get("PUCKY_HOST", "0.0.0.0"),
            port=int(os.environ.get("PORT", os.environ.get("PUCKY_PORT", "8080"))),
            pucky_api_token=os.environ.get("PUCKY_API_TOKEN", ""),
            deepgram_api_key=os.environ.get("DEEPGRAM_API_KEY", ""),
            deepinfra_api_key=os.environ.get("DEEPINFRA_API_KEY", ""),
            max_audio_bytes=int(os.environ.get("PUCKY_MAX_AUDIO_BYTES", str(32 * 1024 * 1024))),
            max_html_bytes=int(os.environ.get("PUCKY_MAX_HTML_BYTES", str(512 * 1024))),
            tts_voice=os.environ.get("PUCKY_TTS_VOICE", "af_heart"),
            tts_response_format=os.environ.get("PUCKY_TTS_FORMAT", "wav"),
            tts_speed=float(os.environ.get("PUCKY_TTS_SPEED", "1.0")),
            codex_command=command_from_env(os.environ.get("CODEX_APP_SERVER_COMMAND")),
            codex_cwd=os.environ.get("PUCKY_CODEX_CWD") or None,
            codex_startup_timeout=float(os.environ.get("PUCKY_CODEX_STARTUP_TIMEOUT", "60")),
            codex_turn_timeout=float(os.environ.get("PUCKY_CODEX_TURN_TIMEOUT", "300")),
            developer_instructions=os.environ.get("PUCKY_CODEX_DEVELOPER_INSTRUCTIONS") or DEFAULT_DEVELOPER_INSTRUCTIONS,
        )


class PuckyVoiceService:
    def __init__(self, config: Config, *, stt: STTProvider | None = None, tts: TTSProvider | None = None, codex: CodexProvider | None = None) -> None:
        self.config = config
        self.stt = stt or DeepgramSTT(config.deepgram_api_key)
        self.tts = tts or KokoroTTS(
            config.deepinfra_api_key,
            voice=config.tts_voice,
            response_format=config.tts_response_format,
            speed=config.tts_speed,
        )
        self.codex = codex or CodexAppServerClient(
            command=config.codex_command,
            cwd=config.codex_cwd,
            startup_timeout=config.codex_startup_timeout,
            turn_timeout=config.codex_turn_timeout,
            developer_instructions=config.developer_instructions,
        )
        self._turn_lock = threading.Lock()

    def start(self) -> None:
        self.codex.start()

    def health(self) -> dict[str, object]:
        return {
            "ok": self.codex.ready,
            "codex_app_server": "ready" if self.codex.ready else "not_ready",
            "thread": "per_turn",
            "deepgram_key": "present" if self.config.deepgram_api_key else "missing",
            "deepinfra_key": "present" if self.config.deepinfra_api_key else "missing",
            "pucky_api_token": "present" if self.config.pucky_api_token else "missing",
        }

    def handle_audio_turn(self, audio: bytes, content_type: str) -> dict[str, object]:
        if not audio:
            raise ValueError("audio body is empty")
        session_id = "pucky_" + uuid.uuid4().hex
        total_start = time.perf_counter()
        telemetry: dict[str, object] = {
            "event": "pucky.turn.completed",
            "session_id": session_id,
            "content_type": content_type,
            "request_audio_bytes": len(audio),
            "stt_provider": "deepgram",
            "stt_model": getattr(self.stt, "model", ""),
            "tts_provider": "deepinfra",
            "tts_model": getattr(self.tts, "model", ""),
            "tts_voice": getattr(self.tts, "voice", ""),
            "tts_format": getattr(self.tts, "response_format", ""),
            "tts_speed": getattr(self.tts, "speed", ""),
        }
        stage = "stt"
        with self._turn_lock:
            try:
                start = time.perf_counter()
                transcript = self.stt.transcribe(audio, content_type)
                telemetry["stt_ms"] = _elapsed_ms(start)
                telemetry["transcript_chars"] = len(transcript)

                stage = "codex"
                start = time.perf_counter()
                raw_reply = self.codex.send_turn(transcript)
                telemetry["codex_ms"] = _elapsed_ms(start)
                telemetry["codex_thread_id"] = self.codex.thread_id or ""
                telemetry["raw_reply_chars"] = len(raw_reply)

                stage = "envelope"
                envelope = parse_reply_envelope(raw_reply)
                telemetry["envelope_parse"] = "ok"
                telemetry["reply_chars"] = len(envelope.reply_text)
                telemetry["card_title"] = envelope.card_title
                telemetry["card_icon"] = envelope.card_icon
                telemetry["has_html"] = bool(envelope.html_content)

                stage = "tts"
                start = time.perf_counter()
                reply_audio, audio_mime_type = self.tts.synthesize(envelope.reply_text)
                telemetry["tts_ms"] = _elapsed_ms(start)
                telemetry["reply_audio_bytes"] = len(reply_audio)
                telemetry["audio_mime_type"] = audio_mime_type
            except Exception as exc:
                telemetry["event"] = "pucky.turn.failed"
                telemetry["status"] = "failed"
                telemetry["stage"] = stage
                telemetry["error_type"] = exc.__class__.__name__
                telemetry["total_ms"] = _elapsed_ms(total_start)
                _log_json(telemetry)
                raise
        card: dict[str, str] = {"title": envelope.card_title, "icon": envelope.card_icon}
        if envelope.html_content:
            html_bytes = envelope.html_content.encode("utf-8")
            if len(html_bytes) <= self.config.max_html_bytes:
                card["html_mime_type"] = "text/html"
                card["html_base64"] = base64.b64encode(html_bytes).decode("ascii")
        telemetry["total_ms"] = _elapsed_ms(total_start)
        telemetry["status"] = "ok"
        _log_json(telemetry)
        return {
            "session_id": session_id,
            "text": envelope.reply_text,
            "audio_mime_type": audio_mime_type,
            "audio_base64": base64.b64encode(reply_audio).decode("ascii"),
            "card": card,
        }


def parse_reply_envelope(raw: str) -> ReplyEnvelope:
    clean = (raw or "").strip()
    if not clean:
        return ReplyEnvelope("", "Pucky", DEFAULT_CARD_ICON)
    try:
        data = json.loads(_strip_json_fence(clean))
    except Exception:
        return ReplyEnvelope(clean, fallback_title(clean), DEFAULT_CARD_ICON)
    if not isinstance(data, dict):
        return ReplyEnvelope(clean, fallback_title(clean), DEFAULT_CARD_ICON)
    reply_text = str(data.get("reply_text") or "").strip() or clean
    card_title = (str(data.get("card_title") or "").strip() or fallback_title(reply_text))[:MAX_CARD_TITLE_CHARS].strip() or "Pucky"
    html_title = ""
    html_content = ""
    html = data.get("html")
    if isinstance(html, dict):
        html_title = str(html.get("title") or "").strip()
        html_content = str(html.get("content") or "").strip()
    return ReplyEnvelope(reply_text, card_title, normalize_card_icon(data.get("card_icon")), html_title, html_content)


def normalize_card_icon(value: object) -> str:
    icon = str(value or "").strip().lower()
    return icon if icon in ALLOWED_CARD_ICONS else DEFAULT_CARD_ICON


def fallback_title(text: str) -> str:
    clean = re.sub(r"\s+", " ", (text or "").strip())
    return (clean[:MAX_CARD_TITLE_CHARS].strip() if clean else "Pucky") or "Pucky"


def _elapsed_ms(start: float) -> int:
    return round((time.perf_counter() - start) * 1000)


def _log_json(payload: dict[str, object]) -> None:
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def make_handler(service: PuckyVoiceService):
    class Handler(BaseHTTPRequestHandler):
        server_version = "PuckyVoice/0.1"

        def do_GET(self) -> None:
            path = self.path.split("?", 1)[0]
            if path == "/healthz":
                self._json(HTTPStatus.OK, service.health())
                return
            if path == "/ui/pucky/latest/manifest.json":
                result = build_ui_bundle()
                self._json(HTTPStatus.OK, result["manifest"])
                return
            if path == "/ui/pucky/latest/bundle.zip":
                result = build_ui_bundle()
                self._file(Path(str(result["bundle_path"])), "application/zip")
                return
            if path == "/ui/pucky/fixtures/reply_cards.json":
                self._file(UI_SRC / "fixtures" / "reply_cards.json", "application/json")
                return
            if path == "/ui/pucky/latest" or path == "/ui/pucky/latest/":
                self._file(UI_SRC / "index.html", "text/html; charset=utf-8")
                return
            if path.startswith("/ui/pucky/latest/"):
                relative = unquote(path.removeprefix("/ui/pucky/latest/")).lstrip("/")
                self._safe_ui_file(relative)
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

        def do_POST(self) -> None:
            if self.path.split("?", 1)[0] != "/api/turn":
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            if not service.config.pucky_api_token or self.headers.get("Authorization", "") != f"Bearer {service.config.pucky_api_token}":
                self._json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
                return
            content_type = self.headers.get("Content-Type", "application/octet-stream").split(";", 1)[0].strip()
            if content_type not in ALLOWED_CONTENT_TYPES:
                self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "unsupported_content_type"})
                return
            try:
                result = service.handle_audio_turn(self._read_body(service.config.max_audio_bytes), content_type)
            except ValueError as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            except Exception as exc:
                self.log_error("turn failed: %s", exc)
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "turn_failed", "detail": str(exc)})
                return
            self._json(HTTPStatus.OK, result)

        def log_message(self, fmt: str, *args: object) -> None:
            print(f"{self.address_string()} - {fmt % args}", flush=True)

        def _read_body(self, limit: int) -> bytes:
            length_text = self.headers.get("Content-Length")
            if length_text:
                length = int(length_text)
                if length > limit:
                    raise ValueError("audio body is too large")
                return self.rfile.read(length)
            data = self.rfile.read(limit + 1)
            if len(data) > limit:
                raise ValueError("audio body is too large")
            return data

        def _json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(int(status))
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _safe_ui_file(self, relative: str) -> None:
            try:
                root = UI_SRC.resolve()
                target = (root / relative).resolve()
                if root != target and root not in target.parents:
                    self._json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                    return
                if not target.is_file():
                    self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                    return
                self._file(target)
            except Exception as exc:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "ui_file_failed", "detail": str(exc)})

        def _file(self, path: Path, content_type: str | None = None) -> None:
            if not path.exists() or not path.is_file():
                self._json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
                return
            body = path.read_bytes()
            guessed = content_type or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            self.send_response(int(HTTPStatus.OK))
            self.send_header("Content-Type", guessed)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return Handler


def serve(service: PuckyVoiceService) -> None:
    service.start()
    server = ThreadingHTTPServer((service.config.host, service.config.port), make_handler(service))
    print(f"Pucky voice service listening on {service.config.host}:{service.config.port}", flush=True)
    server.serve_forever()


def main() -> int:
    config = Config.from_env()
    missing = [name for name, value in (("PUCKY_API_TOKEN", config.pucky_api_token), ("DEEPGRAM_API_KEY", config.deepgram_api_key), ("DEEPINFRA_API_KEY", config.deepinfra_api_key)) if not value]
    if missing:
        raise SystemExit(f"Missing required environment variables: {', '.join(missing)}")
    serve(PuckyVoiceService(config))
    return 0


def _strip_json_fence(text: str) -> str:
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text
