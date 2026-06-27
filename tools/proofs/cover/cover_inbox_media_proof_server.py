from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import sys
import tempfile
import threading
import time
from http import HTTPStatus
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.cover_fixtures import load_deploy_fixture, runtime_fixture_from_deploy, runtime_fixture_text_from_deploy
from pucky_vm.server import Config, PuckyVoiceService, make_handler
from pucky_vm.ui_bundle import UI_SRC


class FakeSTT:
    def transcribe(self, audio: bytes, content_type: str) -> str:
        return ""


class FakeTTS:
    def synthesize(self, text: str) -> tuple[bytes, str]:
        return b"", "audio/wav"


class FakeCodex:
    ready = True
    thread_id = "thread-compose-proof-seed"

    def __init__(self) -> None:
        self.thread_counter = 0
        self.thread_titles: dict[str, str] = {}
        self.last_turn_routing = {
            "requested_thread_id": "",
            "used_thread_id": self.thread_id,
            "thread_mode": "new",
            "reused_existing_thread": False,
            "fallback_reason": "",
        }

    def start(self) -> None:
        return None

    def _next_thread_id(self) -> str:
        self.thread_counter += 1
        return f"thread-compose-proof-{self.thread_counter}"

    def _derive_reply_text(self, text: str) -> str:
        text_attach = re.search(r"TEXT-ATTACH-ACK\s+([A-Z0-9-]+)", text)
        if text_attach:
            return f"TEXT-ATTACH-ACK {text_attach.group(1)} thread-compose-note.txt"
        image_attach = re.search(r"IMAGE-ATTACH-ACK\s+([A-Z0-9-]+)", text)
        if image_attach:
            return f"IMAGE-ATTACH-ACK {image_attach.group(1)}"
        ack = re.search(r"ACK\s+(THREAD-COMPOSE-[A-Z0-9-]+)", text)
        if ack:
            return f"ACK {ack.group(1)}"
        cheerful = re.search(r"say hello back in one cheerful sentence", text, flags=re.IGNORECASE)
        if cheerful:
            return "Hello back! Hope your day is going wonderfully!"
        return "Thread compose proof reply."

    def _derive_card_title(self, text: str) -> str:
        compact = " ".join(str(text or "").split())
        if not compact:
            return "Thread Compose Proof"
        if ". Reply with exactly " in compact:
            compact = compact.split(". Reply with exactly ", 1)[0].strip()
        return compact[:80] or "Thread Compose Proof"

    def send_turn(
        self,
        text: str,
        *,
        thread_id: str | None = None,
        model: str | None = None,
        reasoning_effort: str | None = None,
        output_schema: dict[str, object] | None = None,
        developer_instructions: str | None = None,
        **_kwargs,
    ):
        del model, reasoning_effort, output_schema, developer_instructions
        requested_thread_id = str(thread_id or "").strip()
        used_thread_id = requested_thread_id or self._next_thread_id()
        self.thread_id = used_thread_id
        self.last_turn_routing = {
            "requested_thread_id": requested_thread_id,
            "used_thread_id": used_thread_id,
            "thread_mode": "existing" if requested_thread_id else "new",
            "reused_existing_thread": bool(requested_thread_id),
            "fallback_reason": "",
        }
        time.sleep(0.25)
        card_title = self._derive_card_title(text)
        self.thread_titles[used_thread_id] = card_title
        reply = {
            "reply_text": self._derive_reply_text(text),
            "card_title": card_title,
            "card_icon": "message",
            "recording_title": "",
            "attachments": [],
            "graph_records": [],
            "graph_links": [],
            "connected_records": [],
        }
        return type(
            "FakeTurnResult",
            (),
            {
                "reply_text": json.dumps(reply),
                "used_thread_id": used_thread_id,
                "requested_thread_id": requested_thread_id,
                "thread_mode": "existing" if requested_thread_id else "new",
                "reused_existing_thread": bool(requested_thread_id),
                "fallback_reason": "",
            },
        )()

    def set_thread_title(self, title: str, *, thread_id: str | None = None) -> None:
        resolved_thread_id = str(thread_id or self.thread_id or "").strip()
        if resolved_thread_id:
            self.thread_titles[resolved_thread_id] = str(title or "").strip()
            self.thread_id = resolved_thread_id

    def thread_origin(self, thread_id: str | None = None, *, retries: int = 5, delay: float = 0.15) -> dict[str, str]:
        del retries, delay
        resolved_thread_id = str(thread_id or self.thread_id or "thread-compose-proof-seed").strip()
        return {
            "runtime": "codex",
            "thread_id": resolved_thread_id,
            "thread_title": self.thread_titles.get(resolved_thread_id, "Thread Compose Proof"),
            "rollout_path": f"/tmp/{resolved_thread_id}.jsonl",
            "source": "inbox-media-proof-server",
            "model": "gpt-5.5",
            "model_provider": "openai",
            "reasoning_effort": "high",
            "sandbox_policy": "danger-full-access",
            "approval_mode": "never",
        }

    def runtime_call(self, method: str, params: dict[str, object] | None = None, *, timeout: float | None = None) -> dict[str, object]:
        del timeout
        return {"ok": True, "method": method, "params": params or {}}


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
        developer_instructions="inbox media proof server",
        feed_db_path=str(root / "feed.sqlite3"),
        workspace_db_path=str(root / "workspace.sqlite3"),
        action_ledger_path=str(root / "actions.sqlite3"),
        self_email="proof@example.com",
        self_phone_number="+14155550123",
        proof_reply_delay_enabled=True,
    )


def build_handler(service: PuckyVoiceService):
    base_handler = make_handler(service)
    runtime_fixture_path = UI_SRC / "fixtures" / "reply_cards_deploy.json"
    artifact_root = (UI_SRC / "fixtures" / "artifacts").resolve()
    runtime_fixture = runtime_fixture_from_deploy(
        load_deploy_fixture(runtime_fixture_path),
        mock_artifact_prefix="fixtures/artifacts",
    )

    def browser_cards() -> list[dict[str, object]]:
        cards = []
        for raw_card in list(runtime_fixture.get("cards") or []):
            card = json.loads(json.dumps(raw_card))
            audio_artifact = str(card.get("audio_artifact") or "").strip()
            html_artifact = str(card.get("html_artifact") or "").strip()
            if audio_artifact:
                card["audio_url"] = f"/api/artifacts/{quote(audio_artifact, safe='')}"
            if html_artifact:
                card["html_url"] = f"/api/artifacts/{quote(html_artifact, safe='')}"
            cards.append(card)
        return cards

    class Handler(base_handler):
        def do_GET(self) -> None:  # type: ignore[override]
            parsed = urlsplit(self.path)
            if parsed.path == "/ui/pucky/fixtures/reply_cards.json":
                self._text(
                    HTTPStatus.OK,
                    runtime_fixture_text_from_deploy(
                        runtime_fixture_path,
                        mock_artifact_prefix="fixtures/artifacts",
                    ),
                    "application/json; charset=utf-8",
                )
                return
            if parsed.path == "/api/feed":
                query = parse_qs(parsed.query or "")
                limit = max(1, min(100, int((query.get("limit") or ["100"])[0] or "100")))
                live_payload = service.feed_sync("", limit, include_archived=True, compact=False, base_url="")
                live_items = list(live_payload.get("items") or [])
                fixture_items = browser_cards()
                items = (live_items + fixture_items)[:limit]
                self._json(
                    HTTPStatus.OK,
                    {
                        "schema": "pucky.feed_sync.v1",
                        "items": items,
                        "next_cursor": "",
                        "has_more": False,
                    },
                )
                return
            if parsed.path.startswith("/api/artifacts/"):
                artifact_name = unquote(parsed.path.removeprefix("/api/artifacts/")).lstrip("/")
                artifact_path = (artifact_root / artifact_name).resolve()
                if artifact_root not in artifact_path.parents or not artifact_path.is_file():
                    self.send_error(HTTPStatus.NOT_FOUND, "Artifact not found")
                    return
                body = artifact_path.read_bytes()
                mime_type, _ = mimetypes.guess_type(str(artifact_path))
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", mime_type or "application/octet-stream")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            super().do_GET()

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Serve Pucky UI + workspace APIs for local inbox media proofs without mock-path rewriting"
        )
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8768)
    parser.add_argument("--api-token", default="proof-token")
    parser.add_argument("--state-dir", default="")
    args = parser.parse_args()

    temp_dir = None
    if args.state_dir:
        root = Path(args.state_dir).resolve()
        root.mkdir(parents=True, exist_ok=True)
    else:
        temp_dir = tempfile.TemporaryDirectory(prefix="pucky-inbox-media-proof-")
        root = Path(temp_dir.name)

    os.environ.setdefault("PUCKY_DB_PATH", str((root / "broker.sqlite3").resolve()))

    service = PuckyVoiceService(
        build_config(root, args.host, args.port, args.api_token),
        stt=FakeSTT(),
        tts=FakeTTS(),
        codex=FakeCodex(),
        meeting_codex=FakeCodex(),
        composio=FakeComposio(),
    )

    handler = build_handler(service)
    service.start()
    server = ThreadingHTTPServer((args.host, args.port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"inbox media proof server: http://{args.host}:{server.server_port}", flush=True)
    print(f"state dir: {root}", flush=True)
    try:
        thread.join()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
        if temp_dir is not None:
            temp_dir.cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
