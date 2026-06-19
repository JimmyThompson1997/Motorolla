from __future__ import annotations

import argparse
import os
import tempfile
import threading
import sys
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.server import Config, PuckyVoiceService, make_handler


class FakeSTT:
    def transcribe(self, audio: bytes, content_type: str) -> str:
        return ""


class FakeTTS:
    def synthesize(self, text: str) -> tuple[bytes, str]:
        return b"", "audio/wav"


class FakeCodex:
    ready = True

    def start(self) -> None:
        return None

    def runtime_call(self, method: str, params: dict[str, object] | None = None, *, timeout: float | None = None) -> dict[str, object]:
        return {"method": method, "params": params or {}}


class FakeComposio:
    configured = False

    def list_apps(self) -> dict[str, object]:
        return {"apps": []}

    def list_connected_apps(self, user_id: str, *, force: bool = False) -> dict[str, object]:
        return {"connected_apps": []}

    def start_oauth(self, user_id: str, app_slug: str, redirect_url: str | None = None) -> dict[str, object]:
        return {}


def build_config(root: Path, host: str, port: int, token: str) -> Config:
    return Config(
        host=host,
        port=port,
        pucky_api_token=token,
        deepgram_api_key="proof",
        deepinfra_api_key="proof",
        max_audio_bytes=1024 * 1024,
        max_html_bytes=1024 * 1024,
        max_attachment_count=4,
        max_attachment_bytes=1024 * 1024,
        max_attachment_viewer_bytes=1024 * 1024,
        tts_voice="proof",
        tts_response_format="wav",
        tts_speed=1.0,
        codex_command=[],
        codex_cwd=None,
        codex_startup_timeout=1,
        codex_turn_timeout=30,
        developer_instructions="workspace proof server",
        feed_db_path=str(root / "feed.sqlite3"),
        workspace_db_path=str(root / "workspace.sqlite3"),
        action_ledger_path=str(root / "actions.sqlite3"),
        self_email="proof@example.com",
        self_phone_number="+14155550123",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve Pucky UI + workspace APIs for local Playwright proof without launching real Codex/STT/TTS providers.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--api-token", default="proof-token")
    parser.add_argument("--state-dir", default="")
    args = parser.parse_args()

    temp = None
    if args.state_dir:
        root = Path(args.state_dir).resolve()
        root.mkdir(parents=True, exist_ok=True)
    else:
        temp = tempfile.TemporaryDirectory(prefix="pucky-workspace-proof-")
        root = Path(temp.name)

    # Keep the embedded broker in the proof state dir so browser phone-role
    # polling does not try to initialize VM-only /data paths during local proof.
    os.environ.setdefault("PUCKY_DB_PATH", str((root / "broker.sqlite3").resolve()))

    service = PuckyVoiceService(
        build_config(root, args.host, args.port, args.api_token),
        stt=FakeSTT(),
        tts=FakeTTS(),
        codex=FakeCodex(),
        meeting_codex=FakeCodex(),
        composio=FakeComposio(),
    )
    service.start()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(service))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"workspace proof server: http://{args.host}:{server.server_port}", flush=True)
    print(f"state dir: {root}", flush=True)
    try:
        thread.join()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
        if temp is not None:
            temp.cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
