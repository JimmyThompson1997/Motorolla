from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import replace
from http.server import ThreadingHTTPServer
from pathlib import Path

from pucky_vm.server import Config, PuckyVoiceService, make_handler


class ProofSTT:
    def __init__(self) -> None:
        self.model = "nova-3"

    def transcribe(self, audio: bytes, content_type: str) -> str:
        return str(self.transcribe_with_metadata(audio, content_type).get("transcript") or "")

    def transcribe_with_metadata(self, audio: bytes, content_type: str) -> dict[str, object]:
        if b"unknown-speakers" in audio:
            return {
                "schema": "pucky.deepgram_transcript.v1",
                "provider": "deepgram",
                "model": self.model,
                "transcript": "We should send the revised deck by Friday. I can handle the budget table.",
                "diarization_requested": True,
                "speaker_turns": [
                    {"speaker": "speaker_0", "text": "We should send the revised deck by Friday.", "start": 0.0, "end": 2.0},
                    {"speaker": "speaker_1", "text": "I can handle the budget table.", "start": 2.0, "end": 4.0},
                ],
                "raw": {},
            }
        if b"silent-audio" in audio:
            return {
                "schema": "pucky.deepgram_transcript.v1",
                "provider": "deepgram",
                "model": self.model,
                "transcript": "",
                "diarization_requested": True,
                "speaker_turns": [],
                "raw": {},
            }
        return {
            "schema": "pucky.deepgram_transcript.v1",
            "provider": "deepgram",
            "model": self.model,
            "transcript": "I'm Jimmy and this is Jack. Pucky, after this meeting, prepare follow-up notes for both of us.",
            "diarization_requested": True,
            "speaker_turns": [
                {"speaker": "speaker_0", "text": "I'm Jimmy and this is Jack.", "start": 0.0, "end": 2.0},
                {"speaker": "speaker_1", "text": "Pucky, after this meeting, prepare follow-up notes for both of us.", "start": 2.0, "end": 5.0},
            ],
            "raw": {},
        }


class ProofTTS:
    model = ""
    voice = ""
    response_format = "wav"
    speed = 1.0

    def synthesize(self, text: str) -> tuple[bytes, str]:
        return b"RIFFaudio", "audio/wav"


def meeting_summary_html(
    *,
    title: str,
    overview: str,
    participants: str,
    action_items: str,
    follow_up: str,
) -> str:
    safe_title = _escape_html(title)
    return (
        "<!doctype html><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>Meeting Summary</title>"
        f"<h1>{safe_title}</h1>"
        "<h2>Overview</h2>"
        f"{overview}"
        "<h2>Participants</h2>"
        f"{participants}"
        "<h2>Action Items by Person</h2>"
        f"{action_items}"
        "<h2>Pucky Follow-Up</h2>"
        f"{follow_up}"
        "<h2>Resources</h2>"
        "<p>{{PUCKY_MEETING_TRANSCRIPT_LINK}}</p>"
        "<p>{{PUCKY_MEETING_AUDIO_LINK}}</p>"
    )


def _escape_html(value: str) -> str:
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def build_fake_meeting_reply(meeting_id: str, transcript: str, attachment_text: str) -> dict[str, object]:
    if "raw-title" in meeting_id:
        card_title = meeting_id
        recording_title = meeting_id
        return {
            "reply_text": "Meeting processed and stored.",
            "card_title": card_title,
            "recording_title": recording_title,
            "card_icon": "mic",
            "html": {
                "title": "Meeting Summary",
                "content": meeting_summary_html(
                    title=recording_title,
                    overview="<p>Stored the meeting exactly as titled by the agent.</p>",
                    participants="<p>Jimmy and Jack</p>",
                    action_items="<ul><li>Jimmy: send the transcript.</li></ul>",
                    follow_up="<p>No automatic follow-up was executed.</p>",
                ),
            },
            "attachments": [
                {
                    "title": "Meeting Transcript",
                    "mime_type": "text/plain",
                    "kind": "text",
                    "text": "[00:00-00:02] Jimmy: I'm Jimmy and this is Jack.\n[00:02-00:05] Jack: Pucky, after this meeting, prepare follow-up notes for both of us.",
                }
            ],
        }
    if "I'm Jimmy and this is Jack" in transcript:
        card_title = "Meeting Notes"
        recording_title = "Jimmy and Jack Follow-ups"
        return {
            "reply_text": "Meeting processed. I found follow-up notes and one explicit Pucky instruction.",
            "card_title": card_title,
            "recording_title": recording_title,
            "card_icon": "mic",
            "html": {
                "title": "Meeting Summary",
                "content": meeting_summary_html(
                    title=recording_title,
                    overview="<p>Follow-up notes prepared.</p>",
                    participants="<p>Jimmy and Jack</p>",
                    action_items="<ul><li>Jimmy: send the transcript.</li><li>Jack: prepare notes.</li></ul>",
                    follow_up="<p>Pucky drafted follow-up notes.</p>",
                ),
            },
            "attachments": [
                {
                    "title": "Meeting Transcript",
                    "mime_type": "text/plain",
                    "kind": "text",
                    "text": "[00:00-00:02] Jimmy: I'm Jimmy and this is Jack.\n[00:02-00:05] Jack: Pucky, after this meeting, prepare follow-up notes for both of us.",
                }
            ],
        }
    if not transcript and not attachment_text:
        card_title = "Meeting Notes"
        recording_title = "Silent Audio Check"
        return {
            "reply_text": "Meeting saved. No clear speech was detected in the recording.",
            "card_title": card_title,
            "recording_title": recording_title,
            "card_icon": "mic",
            "html": {
                "title": "Meeting Summary",
                "content": meeting_summary_html(
                    title=recording_title,
                    overview="<p>The clip was captured and stored, but no clear speech was detected.</p>",
                    participants="<p>Unknown participants</p>",
                    action_items="<p>No action items were confidently identified.</p>",
                    follow_up="<p>No automatic follow-up was executed.</p>",
                ),
            },
            "attachments": [
                {
                    "title": "Meeting Transcript",
                    "mime_type": "text/plain",
                    "kind": "text",
                    "text": "[No clear speech detected.]",
                }
            ],
        }
    card_title = "Meeting Notes"
    recording_title = "Deck Follow-up Review"
    return {
        "reply_text": "Meeting processed with speaker-separated transcript.",
        "card_title": card_title,
        "recording_title": recording_title,
        "card_icon": "mic",
        "html": {
            "title": "Meeting Summary",
            "content": meeting_summary_html(
                title=recording_title,
                overview="<p>Follow-up items were captured.</p>",
                participants="<p>speaker_0 and speaker_1</p>",
                action_items="<ul><li>speaker_0: send the revised deck by Friday.</li><li>speaker_1: handle the budget table.</li></ul>",
                follow_up="<p>No automatic follow-up was executed.</p>",
            ),
        },
        "attachments": [
            {
                "title": "Meeting Transcript",
                "mime_type": "text/plain",
                "kind": "text",
                "text": attachment_text or "[No clear speech detected.]",
            }
        ],
    }


class ProofCodex:
    ready = True

    def __init__(self, *, meeting: bool = False) -> None:
        self.meeting = meeting
        self.thread_id = "meeting-thread-1" if meeting else "thread-1"
        self.last_turn_routing = {
            "requested_thread_id": "",
            "used_thread_id": self.thread_id,
            "thread_mode": "new",
            "reused_existing_thread": False,
            "fallback_reason": "",
        }
        self.service: PuckyVoiceService | None = None

    def attach_service(self, service: PuckyVoiceService) -> None:
        self.service = service

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
        requested_thread_id = str(thread_id or "").strip()
        used_thread_id = requested_thread_id or self.thread_id
        self.thread_id = used_thread_id
        self.last_turn_routing = {
            "requested_thread_id": requested_thread_id,
            "used_thread_id": used_thread_id,
            "thread_mode": "existing" if requested_thread_id else "new",
            "reused_existing_thread": bool(requested_thread_id),
            "fallback_reason": "",
        }
        if not self.meeting:
            reply = {
                "reply_text": "Sure, I can help.",
                "card_title": "Quick Help",
                "card_icon": "bolt",
                "html": None,
                "attachments": None,
            }
            return _proof_turn_result(reply, used_thread_id, requested_thread_id)
        if self.service is None:
            raise RuntimeError("proof meeting codex is missing attached service")
        time.sleep(1.25)
        meeting_id = ""
        for line in text.splitlines():
            if line.strip().startswith("- meeting_id:"):
                meeting_id = line.split(":", 1)[1].strip()
                break
        tool_result = self.service.meeting_deepgram_transcribe_tool(
            {"meeting_id": meeting_id},
            thread_id=used_thread_id,
            turn_id=meeting_id,
        )
        transcript = str(tool_result.get("transcript") or "")
        attachment_text = str(tool_result.get("transcript_attachment_text") or "")
        reply = build_fake_meeting_reply(meeting_id, transcript, attachment_text)
        return _proof_turn_result(reply, used_thread_id, requested_thread_id)

    def set_thread_title(self, title: str, *, thread_id: str | None = None) -> None:
        if thread_id:
            self.thread_id = str(thread_id)

    def runtime_call(self, method: str, params: dict[str, object] | None = None, *, timeout: float | None = None) -> dict[str, object]:
        return {"ok": True, "method": method, "params": params or {}}

    def thread_origin(self, thread_id: str | None = None, *, retries: int = 5, delay: float = 0.15) -> dict[str, str]:
        resolved_thread_id = str(thread_id or self.thread_id)
        return {
            "runtime": "codex",
            "thread_id": resolved_thread_id,
            "thread_title": "Meeting proof",
            "rollout_path": f"/tmp/{resolved_thread_id}.jsonl",
            "source": "proof",
            "model": "gpt-5.5",
            "model_provider": "openai",
            "reasoning_effort": "high",
            "sandbox_policy": "danger-full-access",
            "approval_mode": "never",
        }


def _proof_turn_result(reply: dict[str, object], used_thread_id: str, requested_thread_id: str):
    return type(
        "ProofTurnResult",
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


def build_config(port: int, report_dir: Path, *, mode: str) -> Config:
    meeting_instructions = (
        Path(__file__).resolve().parents[3] / "docs" / "pucky-meeting-developer-instructions.txt"
    ).read_text(encoding="utf-8")
    base = Config.from_env()
    if mode == "fake":
        base = replace(
            base,
            deepgram_api_key="dg-proof",
            deepinfra_api_key="di-proof",
            developer_instructions="test",
        )
    return replace(
        base,
        host="127.0.0.1",
        port=port,
        pucky_api_token="secret",
        max_audio_bytes=8 * 1024 * 1024,
        max_html_bytes=512 * 1024,
        max_attachment_count=4,
        max_attachment_bytes=8 * 1024 * 1024,
        max_attachment_viewer_bytes=16 * 1024 * 1024,
        tts_voice="af_heart",
        tts_response_format="wav",
        tts_speed=1.0,
        feed_db_path=str((report_dir / "pucky_feed.sqlite3").resolve()),
        connect_portal_secret="portal-secret",
        connect_portal_ttl_seconds=3600,
        proof_reply_delay_enabled=False,
        meeting_developer_instructions=meeting_instructions,
    )


def create_service(config: Config, *, mode: str) -> PuckyVoiceService:
    if mode == "fake":
        codex = ProofCodex(meeting=False)
        meeting_codex = ProofCodex(meeting=True)
        service = PuckyVoiceService(
            config,
            stt=ProofSTT(),
            tts=ProofTTS(),
            codex=codex,
            meeting_codex=meeting_codex,
        )
        codex.attach_service(service)
        meeting_codex.attach_service(service)
        return service
    if not str(config.deepgram_api_key or "").strip():
        raise RuntimeError("DEEPGRAM_API_KEY is required for live meeting proof mode")
    default_codex = ProofCodex(meeting=False)
    service = PuckyVoiceService(
        config,
        tts=ProofTTS(),
        codex=default_codex,
    )
    default_codex.attach_service(service)
    return service


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--report-dir", type=Path, required=True)
    parser.add_argument("--mode", choices=("fake", "live"), default="fake")
    args = parser.parse_args()
    args.report_dir.mkdir(parents=True, exist_ok=True)

    config = build_config(args.port, args.report_dir, mode=args.mode)
    service = create_service(config, mode=args.mode)
    service.start()
    server = ThreadingHTTPServer((config.host, config.port), make_handler(service))
    print(f"Meeting mode proof server listening on {config.host}:{config.port} ({args.mode})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        service.feed.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

