from __future__ import annotations

import argparse
import base64
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

    def __init__(self) -> None:
        self.thread_id = "proof-thread-compose-1"
        self.thread_defaults: dict[str, dict[str, str]] = {}
        self.turn_requests: list[dict[str, object]] = []
        self.developer_instructions: list[str] = []
        self.last_turn_routing = {
            "requested_thread_id": "",
            "used_thread_id": self.thread_id,
            "thread_mode": "new",
            "reused_existing_thread": False,
            "fallback_reason": "",
        }

    def start(self) -> None:
        return None

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
        del model, reasoning_effort, output_schema
        requested_thread_id = str(thread_id or "").strip()
        used_thread_id = requested_thread_id or self.thread_id
        self.thread_id = used_thread_id
        self.thread_defaults.setdefault(
            used_thread_id,
            {"model": "gpt-5.5", "reasoning_effort": "medium"},
        )
        self.developer_instructions.append(str(developer_instructions or ""))
        reply_text = self._reply_text_for_prompt(text)
        self.turn_requests.append(
            {
                "text": text,
                "requested_thread_id": requested_thread_id,
                "used_thread_id": used_thread_id,
                "reply_text": reply_text,
            }
        )
        self.last_turn_routing = {
            "requested_thread_id": requested_thread_id,
            "used_thread_id": used_thread_id,
            "thread_mode": "existing" if requested_thread_id else "new",
            "reused_existing_thread": bool(requested_thread_id),
            "fallback_reason": "",
        }
        return type(
            "FakeTurnResult",
            (),
            {
                "reply_text": json.dumps(
                    {
                        "reply_text": reply_text,
                        "card_title": "Thread Compose Seed",
                        "card_icon": "mail",
                        "html": None,
                        "attachments": [],
                    }
                ),
                "used_thread_id": used_thread_id,
                "requested_thread_id": requested_thread_id,
                "thread_mode": "existing" if requested_thread_id else "new",
                "reused_existing_thread": bool(requested_thread_id),
                "fallback_reason": "",
            },
        )()

    def set_thread_title(self, title: str, *, thread_id: str | None = None) -> None:
        clean_thread_id = str(thread_id or self.thread_id).strip()
        if clean_thread_id:
            self.thread_id = clean_thread_id
        if clean_thread_id and title:
            self.thread_defaults.setdefault(clean_thread_id, {})
            self.thread_defaults[clean_thread_id]["title"] = str(title)

    def thread_origin(self, thread_id: str | None = None, *, retries: int = 1, delay: float = 0.0) -> dict[str, str]:
        del retries, delay
        resolved_thread_id = str(thread_id or self.thread_id).strip() or self.thread_id
        defaults = self.thread_defaults.get(resolved_thread_id, {})
        return {
            "thread_id": resolved_thread_id,
            "model": str(defaults.get("model") or "gpt-5.5"),
            "reasoning_effort": str(defaults.get("reasoning_effort") or "medium"),
            "rollout_path": f"/data/home/codex/sessions/{resolved_thread_id}.jsonl",
        }

    def _reply_text_for_prompt(self, text: str) -> str:
        clean = str(text or "").strip()
        text_attach = re.search(r"TEXT-ATTACH-ACK\s+([A-Z0-9]+)", clean)
        if text_attach:
            return f"TEXT-ATTACH-ACK {text_attach.group(1)} thread-compose-note.txt"
        image_attach = re.search(r"IMAGE-ATTACH-ACK\s+([A-Z0-9]+)", clean)
        if image_attach:
            return f"IMAGE-ATTACH-ACK {image_attach.group(1)}"
        ack_match = re.search(r"ACK\s+(THREAD-COMPOSE-[A-Z0-9-]+)", clean)
        if ack_match:
            return f"ACK {ack_match.group(1)}"
        if "thread-compose-note.txt" in clean:
            return "TEXT-ATTACH-ACK LOCAL-RUN thread-compose-note.txt"
        return "ACK THREAD-COMPOSE-LOCAL"


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


def seed_thread_compose_card(service: PuckyVoiceService) -> None:
    created_at = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    service.feed.upsert_turn_result(
        turn_id="proof-thread-compose-seed",
        session_id="proof_thread_compose_seed",
        reply_mode="card_only",
        reply_text="Ready for a real transcript-thread reply proof.",
        title="Thread Compose Seed",
        summary="Use this transcript detail to verify real composer sends, pending states, and attachments.",
        icon="mail",
        origin={"thread_id": "proof-thread-compose-1"},
        telemetry={"seed": True, "requested_thread_mode": "existing", "thread_mode": "existing"},
        transcript_messages=[
            {
                "role": "user",
                "text": "Kick off the thread compose proof.",
                "created_at": created_at,
            },
            {
                "role": "assistant",
                "text": "Ready for a real transcript-thread reply proof.",
                "created_at": created_at,
            },
        ],
        request_audio_mime_type="",
        request_audio_base64="",
        audio_mime_type="",
        audio_base64="",
        html_mime_type="",
        html_base64="",
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
        compact_items = list(service.feed_sync("", 20, include_archived=False, compact=True).get("items") or [])
        dynamic: list[dict[str, object]] = []
        seen_group_keys: set[str] = set()
        for item in compact_items:
            origin = item.get("origin") if isinstance(item.get("origin"), dict) else {}
            thread_id = str(origin.get("thread_id") or "").strip()
            session_id = str(item.get("session_id") or "").strip()
            full_item = service.feed.get_thread_item(thread_id, compact=False) if thread_id else None
            if isinstance(full_item, dict):
                item = full_item
                origin = item.get("origin") if isinstance(item.get("origin"), dict) else {}
                session_id = str(item.get("session_id") or "").strip()
            dynamic.append(item)
            if thread_id:
                seen_group_keys.add(f"thread:{thread_id}")
            elif session_id:
                seen_group_keys.add(f"session:{session_id}")

        cards = []
        for raw_card in list(runtime_fixture.get("cards") or []):
            card = json.loads(json.dumps(raw_card))
            session_id = str(card.get("session_id") or "").strip()
            group_key = f"session:{session_id}" if session_id else ""
            if group_key and group_key in seen_group_keys:
                continue
            audio_artifact = str(card.get("audio_artifact") or "").strip()
            html_artifact = str(card.get("html_artifact") or "").strip()
            if audio_artifact:
                card["audio_url"] = f"/api/artifacts/{quote(audio_artifact, safe='')}"
            if html_artifact:
                card["html_url"] = f"/api/artifacts/{quote(html_artifact, safe='')}"
            cards.append(card)
        return dynamic + cards

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
                self._json(
                    HTTPStatus.OK,
                    {
                        "schema": "pucky.feed_sync.v1",
                        "items": browser_cards()[:limit],
                        "next_cursor": "",
                        "has_more": False,
                    },
                )
                return
            if parsed.path.startswith("/api/artifacts/"):
                artifact_name = unquote(parsed.path.removeprefix("/api/artifacts/")).lstrip("/")
                artifact = service.artifact(artifact_name)
                if artifact is not None:
                    try:
                        body = base64.b64decode(str(artifact.get("content_base64") or ""))
                    except Exception:
                        self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "Artifact decode failed")
                        return
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", str(artifact.get("mime_type") or "application/octet-stream"))
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
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

    service.start()
    seed_thread_compose_card(service)
    handler = build_handler(service)
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
