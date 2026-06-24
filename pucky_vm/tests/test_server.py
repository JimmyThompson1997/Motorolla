from __future__ import annotations

import base64
from dataclasses import replace
import hashlib
import html
import json
import socket
import sqlite3
import tempfile
import threading
import time
import unittest
import uuid
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from unittest.mock import patch

import pucky_vm.server as server_module
from pucky_vm.server import (
    Config,
    PuckyVoiceService,
    _meeting_canonical_basename,
    _meeting_request_audio_attachment,
    _meeting_summary_html_with_vm_links,
    make_handler,
    meeting_reply_output_schema,
    parse_reply_envelope,
    reply_output_schema,
    reset_broker_for_tests,
)


class FakeSTT:
    def __init__(self) -> None:
        self.model = "nova-3"
        self.transcribe_calls = 0
        self.transcribe_with_metadata_calls = 0

    def transcribe(self, audio: bytes, content_type: str) -> str:
        self.transcribe_calls += 1
        self.audio = audio
        self.content_type = content_type
        return "Pucky test turn"

    def transcribe_with_metadata(self, audio: bytes, content_type: str) -> dict[str, object]:
        self.transcribe_with_metadata_calls += 1
        self.audio = audio
        self.content_type = content_type
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
        return {
            "schema": "pucky.deepgram_transcript.v1",
            "provider": "deepgram",
            "model": self.model,
            "transcript": "I'm Jimmy and this is Jack. Pucky, after this meeting, prepare follow-up notes for both of us.",
            "diarization_requested": True,
            "speaker_turns": [
                {"speaker": "speaker_0", "text": "I'm Jimmy and this is Jack.", "start": 0.1, "end": 2.2},
                {"speaker": "speaker_1", "text": "Pucky, after this meeting, prepare follow-up notes for both of us.", "start": 2.4, "end": 5.1},
            ],
            "raw": {},
        }


class FakeTTS:
    def synthesize(self, text: str) -> tuple[bytes, str]:
        self.text = text
        return b"RIFFaudio", "audio/wav"


def meeting_summary_html(
    *,
    title: str,
    overview: str,
    participants: str,
    action_items: str,
    follow_up: str,
) -> str:
    safe_title = html.escape(title, quote=True)
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


def note_graph_record(
    *,
    record_key: str,
    record_id: str,
    title: str,
    summary: str,
    html_content: str = "",
) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": record_id,
        "title": title,
        "summary": summary,
    }
    if html_content:
        payload["html"] = html_content
    return {
        "record_key": record_key,
        "kind": "note",
        "payload": payload,
    }


def meeting_graph_reply(
    *,
    reply_text: str,
    card_title: str,
    recording_title: str,
    note_id: str,
    note_title: str,
    note_summary: str,
    note_html: str,
    transcript_text: str = "",
    attachments: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "reply_text": reply_text,
        "card_title": card_title,
        "recording_title": recording_title,
        "card_icon": "mic",
        "transcript_text": transcript_text,
        "attachments": list(attachments or []),
        "graph_records": [
            note_graph_record(
                record_key="meeting_note",
                record_id=note_id,
                title=note_title,
                summary=note_summary,
                html_content=note_html,
            )
        ],
        "graph_links": [],
        "connected_records": [
            {"record_key": "meeting_note"}
        ],
    }


class FakeCodex:
    ready = True
    thread_id = "thread-1"

    def __init__(self) -> None:
        self.turns: list[str] = []
        self.turn_requests: list[dict[str, str]] = []
        self.output_schemas: list[dict[str, object] | None] = []
        self.developer_instructions: list[str] = []
        self.renamed_titles: list[str] = []
        self.thread_defaults: dict[str, dict[str, str]] = {}
        self.last_turn_routing = {
            "requested_thread_id": "",
            "used_thread_id": self.thread_id,
            "thread_mode": "new",
            "reused_existing_thread": False,
            "fallback_reason": "",
        }

    def start(self) -> None:
        self.started = True

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
        self.turns.append(text)
        self.output_schemas.append(output_schema)
        self.developer_instructions.append(str(developer_instructions or ""))
        requested_thread_id = str(thread_id or "").strip()
        requested_model = str(model or "").strip()
        requested_reasoning_effort = str(reasoning_effort or "").strip()
        used_thread_id = requested_thread_id or self.thread_id
        self.thread_id = used_thread_id
        if requested_thread_id:
            self.thread_defaults.setdefault(
                used_thread_id,
                {"model": "gpt-5.5", "reasoning_effort": "high"},
            )
        else:
            self.thread_defaults[used_thread_id] = {
                "model": requested_model or "gpt-5.5",
                "reasoning_effort": requested_reasoning_effort or "high",
            }
        self.turn_requests.append(
            {
                "text": text,
                "requested_thread_id": requested_thread_id,
                "used_thread_id": used_thread_id,
                "model": requested_model,
                "reasoning_effort": requested_reasoning_effort,
            }
        )
        self.last_turn_routing = {
            "requested_thread_id": requested_thread_id,
            "used_thread_id": used_thread_id,
            "thread_mode": "existing" if requested_thread_id else "new",
            "reused_existing_thread": bool(requested_thread_id),
            "fallback_reason": "",
        }
        if "Meeting Mode Agent Handoff" in text:
            card_title = "Meeting Notes"
            recording_title = "Jimmy and Jack Follow-ups"
            transcript_text = "[00:00-00:02] Jimmy: I'm Jimmy and this is Jack.\n[00:02-00:05] Jack: Pucky, after this meeting, prepare follow-up notes for both of us."
            reply = meeting_graph_reply(
                reply_text="Meeting processed. I found follow-up notes and one explicit Pucky instruction.",
                card_title=card_title,
                recording_title=recording_title,
                note_id="note-meeting-jimmy-jack",
                note_title=recording_title,
                note_summary="Follow-up notes prepared.",
                note_html=meeting_summary_html(
                    title=recording_title,
                    overview="<p>Follow-up notes prepared.</p>",
                    participants="<p>Jimmy and Jack</p>",
                    action_items="<ul><li>Jimmy: send the transcript.</li><li>Jack: prepare notes.</li></ul>",
                    follow_up="<p>Pucky prepared follow-up notes.</p>",
                ),
                transcript_text=transcript_text,
                attachments=[
                    {
                        "title": "Meeting Transcript",
                        "mime_type": "text/plain",
                        "kind": "text",
                        "text": transcript_text,
                    }
                ],
            )
            reply_text = json.dumps(reply)
        else:
            reply_text = json.dumps(
                {
                    "reply_text": "Sure, I can help.",
                    "card_title": "Quick Help",
                    "card_icon": "bolt",
                    "recording_title": "",
                    "attachments": [],
                    "graph_records": [],
                    "graph_links": [],
                    "connected_records": [],
                }
            )
        return type(
            "FakeTurnResult",
            (),
            {
                "reply_text": reply_text,
                "used_thread_id": used_thread_id,
                "requested_thread_id": requested_thread_id,
                "thread_mode": "existing" if requested_thread_id else "new",
                "reused_existing_thread": bool(requested_thread_id),
                "fallback_reason": "",
            },
        )()

    def set_thread_title(self, title: str, *, thread_id: str | None = None) -> None:
        self.renamed_titles.append(title)
        if thread_id:
            self.thread_id = str(thread_id)

    def thread_origin(self, thread_id: str | None = None, *, retries: int = 5, delay: float = 0.15) -> dict[str, str]:
        resolved_thread_id = str(thread_id or self.thread_id)
        defaults = self.thread_defaults.get(
            resolved_thread_id,
            {"model": "gpt-5.5", "reasoning_effort": "high"},
        )
        return {
            "runtime": "codex",
            "thread_id": resolved_thread_id,
            "thread_title": self.renamed_titles[-1] if self.renamed_titles else "thread-1",
            "rollout_path": f"/data/home/codex/sessions/{resolved_thread_id}.jsonl",
            "source": "vscode",
            "model": defaults["model"],
            "model_provider": "openai",
            "reasoning_effort": defaults["reasoning_effort"],
            "sandbox_policy": "danger-full-access",
            "approval_mode": "never",
        }


class MeetingToolCallingCodex(FakeCodex):
    thread_id = "meeting-thread-1"

    def __init__(self) -> None:
        super().__init__()
        self.tool_calls: list[dict[str, object]] = []
        self.service = None

    def attach_service(self, service: PuckyVoiceService) -> None:
        self.service = service

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
        if "Meeting Mode Agent Handoff" not in text or self.service is None:
            return super().send_turn(
                text,
                thread_id=thread_id,
                model=model,
                reasoning_effort=reasoning_effort,
                output_schema=output_schema,
                developer_instructions=developer_instructions,
            )
        self.turns.append(text)
        self.output_schemas.append(output_schema)
        self.developer_instructions.append(str(developer_instructions or ""))
        meeting_id = ""
        for line in text.splitlines():
            if line.strip().startswith("- meeting_id:"):
                meeting_id = line.split(":", 1)[1].strip()
        tool_result = self.service.meeting_deepgram_transcribe_tool(
            {"meeting_id": meeting_id},
            thread_id=str(thread_id or self.thread_id),
            turn_id=meeting_id,
        )
        self.tool_calls.append(tool_result)
        transcript = str(tool_result.get("transcript") or "")
        attachment_text = str(tool_result.get("transcript_attachment_text") or "")
        if "raw-title" in meeting_id:
            card_title = meeting_id
            recording_title = meeting_id
            transcript_text = "[00:00-00:02] Jimmy: I'm Jimmy and this is Jack.\n[00:02-00:05] Jack: Pucky, after this meeting, prepare follow-up notes for both of us."
            reply = meeting_graph_reply(
                reply_text="Meeting processed and stored.",
                card_title=card_title,
                recording_title=recording_title,
                note_id="note-meeting-raw-title",
                note_title=recording_title,
                note_summary="Stored the meeting exactly as titled by the agent.",
                note_html=meeting_summary_html(
                    title=recording_title,
                    overview="<p>Stored the meeting exactly as titled by the agent.</p>",
                    participants="<p>Jimmy and Jack</p>",
                    action_items="<ul><li>Jimmy: send the transcript.</li></ul>",
                    follow_up="<p>No automatic follow-up was executed.</p>",
                ),
                transcript_text=transcript_text,
                attachments=[
                    {
                        "title": "Meeting Transcript",
                        "mime_type": "text/plain",
                        "kind": "text",
                        "text": transcript_text,
                    }
                ],
            )
        elif "I'm Jimmy and this is Jack" in transcript:
            card_title = "Meeting Notes"
            recording_title = "Jimmy and Jack Follow-ups"
            transcript_text = "[00:00-00:02] Jimmy: I'm Jimmy and this is Jack.\n[00:02-00:05] Jack: Pucky, after this meeting, prepare follow-up notes for both of us."
            reply = meeting_graph_reply(
                reply_text="Meeting processed. I found follow-up notes and one explicit Pucky instruction.",
                card_title=card_title,
                recording_title=recording_title,
                note_id="note-meeting-followups",
                note_title=recording_title,
                note_summary="Follow-up notes prepared.",
                note_html=meeting_summary_html(
                    title=recording_title,
                    overview="<p>Follow-up notes prepared.</p>",
                    participants="<p>Jimmy and Jack</p>",
                    action_items="<ul><li>Jimmy: send the transcript.</li><li>Jack: prepare notes.</li></ul>",
                    follow_up="<p>Pucky drafted follow-up notes.</p>",
                ),
                transcript_text=transcript_text,
                attachments=[
                    {
                        "title": "Meeting Transcript",
                        "mime_type": "text/plain",
                        "kind": "text",
                        "text": transcript_text,
                    }
                ],
            )
        elif not transcript and not attachment_text:
            card_title = "Meeting Notes"
            recording_title = "Silent Audio Check"
            transcript_text = "[No clear speech detected.]"
            reply = meeting_graph_reply(
                reply_text="Meeting saved. No clear speech was detected in the recording.",
                card_title=card_title,
                recording_title=recording_title,
                note_id="note-meeting-silent-audio",
                note_title=recording_title,
                note_summary="The clip was captured and stored, but no clear speech was detected.",
                note_html=meeting_summary_html(
                    title=recording_title,
                    overview="<p>The clip was captured and stored, but no clear speech was detected.</p>",
                    participants="<p>Unknown participants</p>",
                    action_items="<p>No action items were confidently identified.</p>",
                    follow_up="<p>No automatic follow-up was executed.</p>",
                ),
                transcript_text=transcript_text,
                attachments=[
                    {
                        "title": "Meeting Transcript",
                        "mime_type": "text/plain",
                        "kind": "text",
                        "text": transcript_text,
                    }
                ],
            )
        else:
            card_title = "Meeting Notes"
            recording_title = "Deck Follow-up Review"
            transcript_text = attachment_text or "[No clear speech detected.]"
            reply = meeting_graph_reply(
                reply_text="Meeting processed with speaker-separated transcript.",
                card_title=card_title,
                recording_title=recording_title,
                note_id="note-meeting-deck-followup",
                note_title=recording_title,
                note_summary="Follow-up items were captured.",
                note_html=meeting_summary_html(
                    title=recording_title,
                    overview="<p>Follow-up items were captured.</p>",
                    participants="<p>speaker_0 and speaker_1</p>",
                    action_items="<ul><li>speaker_0: send the revised deck by Friday.</li><li>speaker_1: handle the budget table.</li></ul>",
                    follow_up="<p>No automatic follow-up was executed.</p>",
                ),
                transcript_text=transcript_text,
                attachments=[
                    {
                        "title": "Meeting Transcript",
                        "mime_type": "text/plain",
                        "kind": "text",
                        "text": transcript_text,
                    }
                ],
            )
        requested_thread_id = str(thread_id or "").strip()
        used_thread_id = requested_thread_id or self.thread_id
        self.thread_id = used_thread_id
        self.turn_requests.append(
            {
                "text": text,
                "requested_thread_id": requested_thread_id,
                "used_thread_id": used_thread_id,
                "model": str(model or ""),
                "reasoning_effort": str(reasoning_effort or ""),
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
                "reply_text": json.dumps(reply),
                "used_thread_id": used_thread_id,
                "requested_thread_id": requested_thread_id,
                "thread_mode": "existing" if requested_thread_id else "new",
                "reused_existing_thread": bool(requested_thread_id),
                "fallback_reason": "",
            },
        )()


class BlockingCodex(FakeCodex):
    def __init__(self) -> None:
        super().__init__()
        self.codex_started = threading.Event()
        self.release_codex = threading.Event()

    def send_turn(
        self,
        text: str,
        *,
        thread_id: str | None = None,
        model: str | None = None,
        reasoning_effort: str | None = None,
        output_schema: dict[str, object] | None = None,
    ):
        self.turns.append(text)
        self.output_schemas.append(output_schema)
        self.codex_started.set()
        if not self.release_codex.wait(timeout=5):
            raise TimeoutError("test did not release codex")
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
        return type(
            "FakeTurnResult",
            (),
            {
                "reply_text": json.dumps(
                    {
                        "reply_text": "Codex status observed.",
                        "card_title": "Status",
                        "card_icon": "bolt",
                        "html": None,
                    }
                ),
                "used_thread_id": used_thread_id,
                "requested_thread_id": requested_thread_id,
                "thread_mode": "existing" if requested_thread_id else "new",
                "reused_existing_thread": bool(requested_thread_id),
                "fallback_reason": "",
            },
        )()

class FakeComposio:
    def __init__(self) -> None:
        self.configured = True
        self.starts: list[dict[str, object]] = []
        self.deleted: list[tuple[str, str]] = []
        self.invalidated: list[str] = []
        self.proxy_calls: list[dict[str, object]] = []
        self.tool_calls: list[dict[str, object]] = []
        self.tool_results: dict[str, object] = {}
        self.tool_errors: dict[str, BaseException] = {}
        self.list_apps_calls = 0
        self.list_connected_calls = 0
        self.apps = [
            {
                "slug": "gmail",
                "name": "Gmail",
                "logo": "https://logos.example.invalid/gmail.png",
                "description": "Read, search, and send Gmail.",
                "tools_count": 61,
                "connectable": True,
                "auth_schemes": ["OAUTH2"],
                "managed_auth_schemes": ["OAUTH2"],
            },
            {
                "slug": "googlecalendar",
                "name": "Google Calendar",
                "logo": "https://logos.example.invalid/googlecalendar.png",
                "description": "Manage your calendar.",
                "tools_count": 18,
                "connectable": True,
                "auth_schemes": ["OAUTH2"],
                "managed_auth_schemes": ["OAUTH2"],
            },
            {
                "slug": "linkedin",
                "name": "LinkedIn",
                "logo": "https://logos.example.invalid/linkedin.png",
                "description": "Read profile info and publish LinkedIn posts.",
                "tools_count": 4,
                "connectable": True,
                "auth_schemes": ["OAUTH2"],
                "managed_auth_schemes": ["OAUTH2"],
            },
            {
                "slug": "notion",
                "name": "Notion",
                "logo": "https://logos.example.invalid/notion.png",
                "description": "Read and write workspace pages.",
                "tools_count": 12,
                "connectable": True,
                "auth_schemes": ["OAUTH2", "API_KEY"],
                "managed_auth_schemes": ["OAUTH2"],
            },
            {
                "slug": "composio",
                "name": "Composio",
                "logo": "",
                "description": "Internal utility.",
                "tools_count": 24,
                "connectable": False,
                "auth_schemes": ["NO_AUTH"],
                "managed_auth_schemes": [],
            },
        ]
        self.connected = [
            {
                "slug": "gmail",
                "name": "Gmail",
                "logo": "https://logos.example.invalid/gmail.png",
                "status": "active",
                "id": "ca_gmail_active",
                "instance_name": "Jimmy Gmail",
            },
            {
                "slug": "linkedin",
                "name": "LinkedIn",
                "logo": "https://logos.example.invalid/linkedin.png",
                "status": "initiated",
                "id": "ca_linkedin_pending",
                "instance_name": "LinkedIn",
            },
            {
                "slug": "linkedin",
                "name": "LinkedIn",
                "logo": "https://logos.example.invalid/linkedin.png",
                "status": "expired",
                "id": "ca_linkedin_expired",
                "instance_name": "LinkedIn stale",
            },
        ]

    def list_apps(self) -> dict[str, object]:
        self.list_apps_calls += 1
        return {"ok": True, "apps": list(self.apps)}

    def list_connected_apps(self, user_id: str, *, force: bool = False) -> dict[str, object]:
        self.list_connected_calls += 1
        return {"connected_apps": list(self.connected), "user_id": user_id, "force": force}

    def invalidate_connected_cache(self, user_id: str) -> None:
        self.invalidated.append(user_id)

    def start_oauth(self, user_id: str, app_slug: str, redirect_url: str | None = None) -> dict[str, object]:
        payload = {
            "user_id": user_id,
            "app_slug": app_slug,
            "redirect_url": redirect_url,
            "auth_url": f"https://connect.example.invalid/{app_slug}",
            "connection_id": f"ca_{app_slug}_new",
        }
        self.starts.append(payload)
        return {"ok": True, **payload}

    def delete_connection(self, user_id: str, connection_id: str) -> dict[str, object]:
        owned_ids = {item["id"] for item in self.connected}
        if connection_id not in owned_ids:
            return {"ok": False, "error": "forbidden", "status_code": 403}
        self.deleted.append((user_id, connection_id))
        self.connected = [item for item in self.connected if item["id"] != connection_id]
        return {"ok": True, "deleted": connection_id}

    def execute_proxy(
        self,
        *,
        connected_account_id: str,
        endpoint: str,
        method: str = "GET",
        parameters: list[dict[str, object]] | None = None,
        body: dict[str, object] | None = None,
    ) -> dict[str, object]:
        call = {
            "connected_account_id": connected_account_id,
            "endpoint": endpoint,
            "method": method,
            "parameters": list(parameters or []),
            "body": dict(body or {}),
        }
        self.proxy_calls.append(call)
        if "fail" in endpoint:
            raise RuntimeError("proxy_failed")
        return {"ok": True, "endpoint": endpoint, "connected_account_id": connected_account_id}

    def execute_tool(
        self,
        *,
        tool_slug: str,
        connected_account_id: str,
        user_id: str = "",
        arguments: dict[str, object] | None = None,
    ) -> dict[str, object]:
        call = {
            "tool_slug": tool_slug,
            "connected_account_id": connected_account_id,
            "user_id": user_id,
            "arguments": dict(arguments or {}),
        }
        self.tool_calls.append(call)
        error = self.tool_errors.get(tool_slug)
        if error is not None:
            raise error
        result = self.tool_results.get(tool_slug)
        if isinstance(result, dict):
            return dict(result)
        return {"ok": True, "tool_slug": tool_slug, "connected_account_id": connected_account_id}


class BlockingSTT(FakeSTT):
    def __init__(self) -> None:
        self.stt_started = threading.Event()
        self.release_stt = threading.Event()

    def transcribe(self, audio: bytes, content_type: str) -> str:
        self.audio = audio
        self.content_type = content_type
        self.stt_started.set()
        if not self.release_stt.wait(timeout=5):
            raise TimeoutError("test did not release stt")
        return "Pucky test turn"


class ScriptedCodex(FakeCodex):
    def __init__(self, *, invalid_thread_ids: set[str] | None = None) -> None:
        super().__init__()
        self.invalid_thread_ids = set(invalid_thread_ids or set())
        self.next_thread_number = 100

    def send_turn(
        self,
        text: str,
        *,
        thread_id: str | None = None,
        model: str | None = None,
        reasoning_effort: str | None = None,
        output_schema: dict[str, object] | None = None,
    ):
        self.output_schemas.append(output_schema)
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
        self.turns.append(text)
        self.turn_requests.append(
            {
                "text": text,
                "requested_thread_id": requested_thread_id,
                "used_thread_id": used_thread_id,
                "thread_mode": thread_mode,
                "fallback_reason": fallback_reason,
            }
        )
        title = "Weather Plan" if "weather" in text.lower() else ("Thread Continue" if requested_thread_id else "Fresh Thread")
        icon = "calendar" if "weather" in text.lower() else "bolt"
        self.last_turn_routing = {
            "requested_thread_id": requested_thread_id,
            "used_thread_id": used_thread_id,
            "thread_mode": thread_mode,
            "reused_existing_thread": bool(requested_thread_id and thread_mode == "existing"),
            "fallback_reason": fallback_reason,
        }
        return type(
            "FakeTurnResult",
            (),
            {
                "reply_text": json.dumps(
                    {
                        "reply_text": f"Reply for {text}",
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


class OutOfOrderCodex(FakeCodex):
    def __init__(self) -> None:
        super().__init__()
        self.events = {
            "turn-a": threading.Event(),
            "turn-b": threading.Event(),
            "turn-c": threading.Event(),
        }

    def release(self, key: str) -> None:
        self.events[key].set()

    def send_turn(
        self,
        text: str,
        *,
        thread_id: str | None = None,
        model: str | None = None,
        reasoning_effort: str | None = None,
        output_schema: dict[str, object] | None = None,
    ):
        self.output_schemas.append(output_schema)
        requested_thread_id = str(thread_id or "").strip()
        used_thread_id = requested_thread_id or f"thread-new-{len(self.turn_requests) + 1}"
        key = "turn-a" if "alpha" in text.lower() else ("turn-b" if "fresh" in text.lower() else "turn-c")
        self.turns.append(text)
        self.turn_requests.append(
            {
                "text": text,
                "requested_thread_id": requested_thread_id,
                "used_thread_id": used_thread_id,
                "key": key,
            }
        )
        self.thread_id = used_thread_id
        self.last_turn_routing = {
            "requested_thread_id": requested_thread_id,
            "used_thread_id": used_thread_id,
            "thread_mode": "existing" if requested_thread_id else "new",
            "reused_existing_thread": bool(requested_thread_id),
            "fallback_reason": "",
        }
        if not self.events[key].wait(timeout=5):
            raise TimeoutError(f"test did not release {key}")
        title = "Thread A" if key == "turn-a" else ("Fresh Thread" if key == "turn-b" else "Thread B")
        icon = "bolt" if key != "turn-c" else "calendar"
        return type(
            "FakeTurnResult",
            (),
            {
                "reply_text": json.dumps(
                    {
                        "reply_text": f"Reply for {text}",
                        "card_title": title,
                        "card_icon": icon,
                        "html": None,
                    }
                ),
                "used_thread_id": used_thread_id,
                "requested_thread_id": requested_thread_id,
                "thread_mode": "existing" if requested_thread_id else "new",
                "reused_existing_thread": bool(requested_thread_id),
                "fallback_reason": "",
            },
        )()
def make_config(max_html_bytes: int = 512 * 1024, *, proof_reply_delay_enabled: bool = False) -> Config:
    meeting_instructions = (
        Path(__file__).resolve().parents[2] / "docs" / "pucky-meeting-developer-instructions.txt"
    ).read_text(encoding="utf-8")
    return Config(
        host="127.0.0.1",
        port=0,
        pucky_api_token="secret",
        deepgram_api_key="dg",
        deepinfra_api_key="di",
        max_audio_bytes=1024 * 1024,
        max_html_bytes=max_html_bytes,
        max_attachment_count=4,
        max_attachment_bytes=8 * 1024 * 1024,
        max_attachment_viewer_bytes=16 * 1024 * 1024,
        tts_voice="af_heart",
        tts_response_format="wav",
        tts_speed=1.0,
        codex_command=["codex", "app-server", "--listen", "stdio://"],
        codex_cwd=None,
        codex_startup_timeout=1.0,
        codex_turn_timeout=1.0,
        developer_instructions="test",
        feed_db_path=str(Path(tempfile.gettempdir()) / f"pucky-feed-tests-{uuid.uuid4().hex}" / "feed.sqlite3"),
        codex_sandbox="danger-full-access",
        codex_approval_policy="never",
        codex_model="gpt-5.5",
        codex_reasoning_effort="high",
        composio_api_key="composio-test-key",
        composio_base_url="https://backend.composio.dev/api/v3",
        composio_default_user_id="jimmythompson323",
        connect_portal_secret="portal-secret",
        connect_portal_ttl_seconds=3600,
        meeting_artifact_link_secret="meeting-artifact-secret",
        composio_default_auth_mode="browser",
        proof_reply_delay_enabled=proof_reply_delay_enabled,
        meeting_developer_instructions=meeting_instructions,
        self_email="jimmy@example.com",
        self_phone_number="+14155550123",
    )


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.env_patch = mock.patch.dict(
            "os.environ",
            {
                "PUCKY_OPERATOR_TOKEN": "test-operator-token",
                "PUCKY_DEVICE_TOKEN": "test-device-token",
            },
        )
        self.env_patch.start()
        self.broker = reset_broker_for_tests(self.tmp.name + "/broker.sqlite3")
        self.stt = FakeSTT()
        self.tts = FakeTTS()
        self.codex = FakeCodex()
        self.meeting_codex = MeetingToolCallingCodex()
        self.composio = FakeComposio()
        self.service = PuckyVoiceService(
            make_config(),
            stt=self.stt,
            tts=self.tts,
            codex=self.codex,
            meeting_codex=self.meeting_codex,
            composio=self.composio,
        )
        self.meeting_codex.attach_service(self.service)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.service))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.service.feed.close()
        if getattr(self.broker, "DB", None) is not None:
            self.broker.DB.close()
            self.broker.DB = None
        self.broker.DEVICES.clear()
        self.env_patch.stop()
        self.tmp.cleanup()

    def clear_active_reminders(self) -> None:
        for item in self.service.workspace.list_records("reminders", include_archived=True, include_deleted=True)["items"]:
            self.service.workspace.patch_record("reminders", str(item["id"]), {"archived": True, "deleted": True})

    def test_service_start_initializes_broker_before_reminder_thread(self) -> None:
        events: list[str] = []

        class FakeReminderThread:
            def is_alive(self) -> bool:
                return False

            def start(self) -> None:
                events.append("thread-start")

        with (
            mock.patch.object(self.codex, "start", side_effect=lambda: events.append("codex-start")),
            mock.patch.object(self.meeting_codex, "start", side_effect=lambda: events.append("meeting-codex-start")),
            mock.patch("pucky_vm.server.ensure_broker_initialized", side_effect=lambda *args, **kwargs: events.append("broker-init") or self.broker),
            mock.patch("pucky_vm.server.threading.Thread", side_effect=lambda *args, **kwargs: FakeReminderThread()),
        ):
            self.service._reminder_poll_thread = None
            self.service.start()

        self.assertIn("broker-init", events)
        self.assertIn("thread-start", events)
        self.assertLess(events.index("broker-init"), events.index("thread-start"))

    def test_ensure_broker_initialized_serializes_concurrent_first_load(self) -> None:
        class FakeDb:
            def close(self) -> None:
                return None

        class FakeBroker:
            DEFAULT_DB_PATH = "/tmp/pucky-broker-race.sqlite3"

            def __init__(self) -> None:
                self.DB = None
                self.DEVICES: dict[str, object] = {}
                self.init_calls: list[str] = []

            def init_db(self, path: str) -> None:
                self.init_calls.append(path)
                time.sleep(0.05)
                self.DB = FakeDb()

        fake_broker = FakeBroker()
        ready = threading.Event()
        results: list[object] = []

        def worker() -> None:
            ready.wait(timeout=5)
            results.append(server_module.ensure_broker_initialized(fake_broker.DEFAULT_DB_PATH))

        with (
            mock.patch("pucky_vm.server._load_broker_module", return_value=fake_broker),
            mock.patch("pucky_vm.server._BROKER_DB_PATH", None),
        ):
            first = threading.Thread(target=worker)
            second = threading.Thread(target=worker)
            first.start()
            second.start()
            ready.set()
            first.join(timeout=5)
            second.join(timeout=5)

        self.assertEqual(fake_broker.init_calls, [fake_broker.DEFAULT_DB_PATH])
        self.assertEqual(len(results), 2)
        self.assertTrue(all(item is fake_broker for item in results))

    def test_healthz_reports_ready_without_secrets(self) -> None:
        payload = self.get_json("/healthz")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["codex_app_server"], "ready")
        self.assertEqual(payload["thread"], "per_turn")
        self.assertEqual(payload["feed_store"], "ready")
        self.assertEqual(payload["feed_items_count"], 0)
        self.assertEqual(payload["deepgram_key"], "present")
        self.assertNotIn("secret", json.dumps(payload))

    def test_config_defaults_codex_model_to_gpt_5_4_mini_low(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True):
            config = Config.from_env()

        self.assertEqual(config.codex_model, "gpt-5.4-mini")
        self.assertEqual(config.codex_reasoning_effort, "low")

    def test_config_env_overrides_codex_defaults(self) -> None:
        with mock.patch.dict(
            "os.environ",
            {"PUCKY_CODEX_MODEL": "custom-model", "PUCKY_CODEX_REASONING_EFFORT": "high"},
            clear=True,
        ):
            config = Config.from_env()

        self.assertEqual(config.codex_model, "custom-model")
        self.assertEqual(config.codex_reasoning_effort, "high")

    def test_config_from_env_loads_api_token_and_requires_explicit_link_secrets(self) -> None:
        with mock.patch.dict(
            "os.environ",
            {
                "PUCKY_API_TOKEN": "owner-token",
                "PUCKY_CONNECT_PORTAL_SECRET": "",
                "PUCKY_MEETING_ARTIFACT_LINK_SECRET": "",
            },
            clear=True,
        ):
            config = Config.from_env()

        self.assertEqual(config.pucky_api_token, "owner-token")
        self.assertEqual(config.connect_portal_secret, "")
        self.assertEqual(config.meeting_artifact_link_secret, "")

    def test_links_portal_url_accepts_api_token(self) -> None:
        payload = self.get_json("/api/links/composio/portal-url", headers={"Authorization": "Bearer secret"})

        self.assertTrue(payload["ok"])
        self.assertTrue(payload["portal_url"].startswith(self.base_url + "/links/connect/apps?token="))

    def test_ui_route_perf_events_endpoint_records_and_lists_run_slice(self) -> None:
        create = self.post_json(
            "/api/ui/route-perf-events",
            {
                "schema": "pucky.ui_route_perf_event.v1",
                "surface": "android_webview",
                "route": "calendar",
                "run_id": "proof-run-1",
                "session_id": "session-a",
                "sample_reason": "debug_perf",
                "wall_elapsed_ms": 1200,
                "route_ready_elapsed_ms": 440,
                "bridge_calls_by_command": {"pucky.turn.status": 2},
            },
        )

        self.assertTrue(create["ok"])

        payload = self.get_json(
            "/api/ui/route-perf-events?run_id=proof-run-1&limit=5",
            headers={"Authorization": "Bearer secret"},
        )

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["schema"], "pucky.ui_route_perf_events.v1")
        self.assertEqual(len(payload["items"]), 1)
        self.assertEqual(payload["items"][0]["route"], "calendar")
        self.assertEqual(payload["items"][0]["bridge_calls_by_command"]["pucky.turn.status"], 2)

    def test_unauthenticated_browser_reads_allow_feed_meetings_workspace_and_artifacts(self) -> None:
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": "meeting-20260601-130000-browser-proof",
                "started_at": "2026-06-01T13:00:00Z",
                "duration_ms": 2000,
                "device_id": "device-browser",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(b"RIFFbrowser-proof-audio").decode("ascii"),
            },
        )
        feed = self.get_json("/api/feed?limit=5")
        meetings = self.get_json("/api/meetings?compact=1")
        workspace = self.get_json("/api/workspace/notes")
        artifacts = self.service.feed.list_media_artifacts(limit=1)
        artifact_id = str(artifacts[0]["artifact_id"] if artifacts else "")

        self.assertEqual(feed["schema"], "pucky.feed_sync.v1")
        self.assertEqual(meetings["schema"], "pucky.meetings.v1")
        self.assertEqual(workspace["schema"], "pucky.workspace.list.v1")
        self.assertTrue(artifact_id)

        with urllib.request.urlopen(self.base_url + f"/api/artifacts/{urllib.parse.quote(artifact_id, safe='')}", timeout=10) as response:
            self.assertEqual(response.status, 200)
            self.assertGreater(len(response.read()), 0)

    def test_same_origin_public_task_status_patch_allows_status_only_and_rejects_other_writes(self) -> None:
        task = self.post_json(
            "/api/workspace/tasks",
            {
                "id": "browser-public-task",
                "title": "Browser Public Task",
                "status": "todo",
                "due_at_ms": 2_000_000_000_000,
            },
        )
        same_origin_headers = {
            "Origin": self.base_url,
            "Referer": f"{self.base_url}/ui/pucky/latest/?theme=light&route=tasks",
            "Content-Type": "application/json",
        }
        request = urllib.request.Request(
            self.base_url + f"/api/workspace/tasks/{urllib.parse.quote(str(task['id']), safe='')}",
            data=json.dumps({"status": "in_progress"}).encode("utf-8"),
            method="PATCH",
            headers=same_origin_headers,
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.assertEqual(payload["status"], "in_progress")

        for body, expected_code in (
            ({"status": "open"}, 400),
            ({"status": "done", "owner": "Jordan"}, 400),
            ({"status": "done"}, 401),
        ):
            headers = dict(same_origin_headers)
            if body == {"status": "done"}:
                headers.pop("Origin", None)
                headers.pop("Referer", None)
            failing = urllib.request.Request(
                self.base_url + f"/api/workspace/tasks/{urllib.parse.quote(str(task['id']), safe='')}",
                data=json.dumps(body).encode("utf-8"),
                method="PATCH",
                headers=headers,
            )
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(failing, timeout=10)
            self.assertEqual(caught.exception.code, expected_code)

        note = self.post_json("/api/workspace/notes", {"id": "browser-public-note", "title": "Browser Public Note"})
        note_request = urllib.request.Request(
            self.base_url + f"/api/workspace/notes/{urllib.parse.quote(str(note['id']), safe='')}",
            data=json.dumps({"pinned": True}).encode("utf-8"),
            method="PATCH",
            headers=same_origin_headers,
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(note_request, timeout=10)
        self.assertEqual(caught.exception.code, 401)

    def test_same_origin_public_reminder_patch_allows_dismiss_and_snooze_only(self) -> None:
        reminder = self.post_json(
            "/api/workspace/reminders",
            {
                "id": "browser-public-reminder",
                "title": "Browser Public Reminder",
                "status": "open",
                "due_at_ms": 2_000_000_000_000,
                "metadata": {"delivery_state": "pending"},
            },
        )
        same_origin_headers = {
            "Origin": self.base_url,
            "Referer": f"{self.base_url}/ui/pucky/latest/?theme=light&route=reminder-detail",
            "Content-Type": "application/json",
        }
        dismiss_request = urllib.request.Request(
            self.base_url + f"/api/workspace/reminders/{urllib.parse.quote(str(reminder['id']), safe='')}",
            data=json.dumps({"status": "done"}).encode("utf-8"),
            method="PATCH",
            headers=same_origin_headers,
        )
        with urllib.request.urlopen(dismiss_request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.assertEqual(payload["status"], "done")

        reminder = self.post_json(
            "/api/workspace/reminders",
            {
                "id": "browser-public-reminder-snooze",
                "title": "Browser Public Reminder Snooze",
                "status": "open",
                "due_at_ms": 2_000_000_000_000,
                "metadata": {"delivery_state": "pending"},
            },
        )
        snoozed_until_ms = 2_100_000_000_000
        snooze_request = urllib.request.Request(
            self.base_url + f"/api/workspace/reminders/{urllib.parse.quote(str(reminder['id']), safe='')}",
            data=json.dumps(
                {
                    "due_at_ms": snoozed_until_ms,
                    "metadata": {
                        "snoozed_until_ms": snoozed_until_ms,
                        "delivery_state": "pending",
                        "last_fired_at_ms": 0,
                        "last_fired_due_at_ms": 0,
                        "last_delivery_error": "",
                    },
                }
            ).encode("utf-8"),
            method="PATCH",
            headers=same_origin_headers,
        )
        with urllib.request.urlopen(snooze_request, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.assertEqual(payload["due_at_ms"], snoozed_until_ms)
        self.assertEqual(payload["metadata"]["snoozed_until_ms"], snoozed_until_ms)

        for body, expected_code in (
            ({"status": "open"}, 400),
            ({"status": "done", "title": "Sneaky"}, 400),
            ({"status": "done"}, 401),
        ):
            headers = dict(same_origin_headers)
            if body == {"status": "done"}:
                headers.pop("Origin", None)
                headers.pop("Referer", None)
            failing = urllib.request.Request(
                self.base_url + f"/api/workspace/reminders/{urllib.parse.quote(str(reminder['id']), safe='')}",
                data=json.dumps(body).encode("utf-8"),
                method="PATCH",
                headers=headers,
            )
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(failing, timeout=10)
            self.assertEqual(caught.exception.code, expected_code)

    def test_unknown_operator_token_still_does_not_authorize_protected_browser_routes(self) -> None:
        headers = {"Authorization": "Bearer test-operator-token"}
        for path in (
            "/api/links/composio/portal-url",
            "/api/device/phone-role-status",
            "/api/feed/actions",
            "/api/meetings/actions",
        ):
            if path.endswith("/actions"):
                request = urllib.request.Request(
                    self.base_url + path,
                    data=json.dumps({"client_action_id": "bad", "action": "archive"}).encode("utf-8"),
                    method="POST",
                    headers={
                        "Authorization": "Bearer test-operator-token",
                        "Content-Type": "application/json",
                    },
                )
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(request, timeout=10)
            else:
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    self.get_json(path, headers=headers)

            self.assertEqual(caught.exception.code, 401, msg=path)

    def test_unauthorized_feed_action_drains_body_before_keep_alive_get(self) -> None:
        body = json.dumps(
            {
                "client_action_id": "unauthorized_keepalive_mark_read",
                "card_id": "pucky_card_missing",
                "action": "mark_read",
            }
        ).encode("utf-8")
        post = "\r\n".join(
            [
                "POST /api/feed/actions HTTP/1.1",
                f"Host: 127.0.0.1:{self.server.server_port}",
                "Content-Type: application/json",
                f"Content-Length: {len(body)}",
                "Connection: keep-alive",
                "",
                "",
            ]
        ).encode("ascii") + body
        get = "\r\n".join(
            [
                "GET /api/feed?limit=1 HTTP/1.1",
                f"Host: 127.0.0.1:{self.server.server_port}",
                "Connection: close",
                "",
                "",
            ]
        ).encode("ascii")

        with socket.create_connection(("127.0.0.1", self.server.server_port), timeout=2) as sock:
            sock.settimeout(2)
            sock.sendall(post + get)
            first_status, _, first_body = self.read_raw_http_response(sock)
            second_status, _, second_body = self.read_raw_http_response(sock)

        self.assertIn(" 401 ", first_status)
        self.assertEqual(json.loads(first_body.decode("utf-8"))["error"], "unauthorized")
        self.assertIn(" 200 ", second_status)
        self.assertEqual(json.loads(second_body.decode("utf-8"))["schema"], "pucky.feed_sync.v1")

    def test_ui_bundle_endpoints_serve_manifest_bundle_and_browser_app(self) -> None:
        manifest = self.get_json("/ui/pucky/latest/manifest.json")

        self.assertEqual(manifest["schema"], "pucky.ui_bundle.v1")
        self.assertEqual(manifest["entrypoint"], "index.html")
        self.assertTrue(manifest["source_commit_full"])
        self.assertTrue(manifest["source_commit_short"])
        self.assertTrue(manifest["source_branch"])
        self.assertIn(manifest["source_dirty"], {True, False})
        self.assertIn("app.js", manifest["files"])
        self.assertIn("pucky-config.js", manifest["files"])
        self.assertIn("pucky-icons.js", manifest["files"])
        self.assertIn("pucky-routes.js", manifest["files"])
        self.assertIn("styles.css", manifest["files"])
        self.assertIn("fixtures/reply_cards.json", manifest["files"])
        self.assertIn("fixtures/reply_cards_deploy.json", manifest["files"])
        self.assertIn("fixtures/artifacts/morning.wav", manifest["files"])

        with urllib.request.urlopen(self.base_url + "/ui/pucky/latest/bundle.zip", timeout=20) as response:
            self.assertEqual(response.headers.get_content_type(), "application/zip")
            self.assertGreater(len(response.read()), 1000)

        with urllib.request.urlopen(self.base_url + "/ui/pucky/latest/fixtures/artifacts/morning.wav", timeout=10) as response:
            self.assertIn(response.headers.get_content_type(), {"audio/wav", "audio/x-wav"})
            self.assertTrue(response.read(4).startswith(b"RIFF"))

        with urllib.request.urlopen(self.base_url + "/ui/pucky/latest/", timeout=10) as response:
            html = response.read().decode("utf-8")
            self.assertIn("Pucky Cover", html)
            self.assertIn("window.__PUCKY_BOOTSTRAP_STATUS__", html)
            self.assertIn("const ESSENTIAL_ASSETS = [", html)
            self.assertIn('"pucky-ui-state.js"', html)
            self.assertEqual(response.headers.get("Cache-Control"), "no-cache")

        with urllib.request.urlopen(self.base_url + "/ui/pucky/latest/manifest.json", timeout=10) as response:
            self.assertEqual(response.headers.get("Cache-Control"), "no-cache")

        fixture = self.get_json("/ui/pucky/fixtures/reply_cards.json")
        self.assertEqual(fixture["schema"], "pucky.reply_cards.v1")
        self.assertGreaterEqual(fixture["count"], 4)
        self.assertNotIn("artifact_base_path", fixture)
        artifact_cards = [
            card for card in fixture.get("cards", [])
            if str(card.get("audio_path", "")).startswith("fixtures/artifacts/")
            and str(card.get("html_path", "")).startswith("fixtures/artifacts/")
        ]
        self.assertGreaterEqual(len(artifact_cards), 1)
        sample = artifact_cards[0]
        self.assertIn("audio_path", sample)
        self.assertIn("html_path", sample)
        self.assertIn("audio_url", sample)
        self.assertIn("html_url", sample)
        self.assertTrue(str(sample["audio_path"]).startswith("fixtures/artifacts/"))
        self.assertTrue(str(sample["html_path"]).startswith("fixtures/artifacts/"))
        self.assertTrue(str(sample["audio_url"]).startswith("fixtures/artifacts/"))
        self.assertTrue(str(sample["html_url"]).startswith("fixtures/artifacts/"))
        self.assertEqual(sample["audio_url"], sample["audio_path"])
        self.assertEqual(sample["html_url"], sample["html_path"])
        self.assertNotIn("/mock/", str(sample["audio_path"]))
        self.assertNotIn("/mock/", str(sample["audio_url"]))
        self.assertNotIn("/mock/", str(sample["html_path"]))
        self.assertNotIn("/mock/", str(sample["html_url"]))

        with urllib.request.urlopen(self.base_url + "/ui/pucky/latest/pucky-config.js", timeout=10) as response:
            config_script = response.read().decode("utf-8")
            self.assertIn("window.PUCKY_BUNDLE_CONFIG", config_script)
            self.assertNotIn('"links_url"', config_script)
            self.assertNotIn("api_token", config_script)
            self.assertEqual(response.headers.get("Cache-Control"), "public, max-age=300, stale-while-revalidate=30")

        with urllib.request.urlopen(self.base_url + "/ui/pucky/latest/styles.css", timeout=10) as response:
            self.assertEqual(response.headers.get("Cache-Control"), "public, max-age=300, stale-while-revalidate=30")

        for _ in range(3):
            with urllib.request.urlopen(self.base_url + "/ui/pucky/latest/", timeout=10) as response:
                self.assertEqual(response.status, 200)

    def test_favicon_request_is_quiet_for_browser_sessions(self) -> None:
        request = urllib.request.Request(self.base_url + "/favicon.ico")
        with urllib.request.urlopen(request, timeout=10) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.read(), b"")

    def test_links_portal_url_endpoint_returns_signed_first_party_url(self) -> None:
        payload = self.get_json("/api/links/composio/portal-url", headers={"Authorization": "Bearer secret"})

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["schema"], "pucky.links_portal_url.v1")
        self.assertEqual(payload["auth_mode"], "browser")
        self.assertEqual(payload["user_id"], "jimmythompson323")
        self.assertTrue(payload["token"])
        self.assertTrue(payload["portal_url"].startswith(self.base_url + "/links/connect/apps?token="))
        token = str(payload["token"])
        verified = self.service._verify_links_portal_token(token)
        self.assertIsNotNone(verified)
        self.assertEqual(verified["user_id"], "jimmythompson323")

    def test_links_portal_url_ignores_forged_forwarded_host_when_public_base_url_is_configured(self) -> None:
        self.service.config = replace(self.service.config, public_base_url="https://pucky.fly.dev/")

        payload = self.get_json(
            "/api/links/composio/portal-url",
            headers={
                "Authorization": "Bearer secret",
                "Host": "evil.example",
                "X-Forwarded-Host": "evil.example",
                "X-Forwarded-Proto": "https",
            },
        )

        self.assertTrue(payload["portal_url"].startswith("https://pucky.fly.dev/links/connect/apps?token="))
        self.assertNotIn("evil.example", payload["portal_url"])

    def test_links_portal_url_endpoint_requires_auth(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json("/api/links/composio/portal-url")

        self.assertEqual(caught.exception.code, 401)

    def test_links_portal_page_renders_first_party_apps_portal(self) -> None:
        token = self.issue_portal_token()
        text = self.get_text(f"/links/connect/apps?token={token}")

        self.assertIn("Pucky Links", text)
        self.assertIn("Search apps", text)
        self.assertIn("Connected", text)
        self.assertIn("All Apps", text)
        self.assertIn("/api/links/composio/my-apps", text)
        self.assertIn("/api/links/composio/all-apps", text)
        self.assertIn("?route=connect", text)
        self.assertIn("browser.open", text)
        self.assertIn("window.location.assign(href);", text)
        self.assertIn("if (!/browser\\.open/i.test(detail)) {", text)
        self.assertNotIn("Refresh My Apps", text)
        self.assertNotIn("This view", text)
        self.assertNotIn("/api/links/composio/disconnect", text)
        self.assertNotIn("/api/links/composio/app-details", text)

    def test_links_my_apps_groups_connected_needs_attention_and_details(self) -> None:
        token = self.issue_portal_token()
        payload = self.get_json(f"/api/links/composio/my-apps?token={token}")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["schema"], "pucky.links_my_apps.v1")
        self.assertEqual(payload["summary"]["connected"], 1)
        self.assertEqual(payload["summary"]["needs_attention"], 1)
        self.assertEqual(payload["apps"][0]["slug"], "gmail")
        self.assertEqual(payload["apps"][0]["state"], "connected")
        linkedin = next(item for item in payload["apps"] if item["slug"] == "linkedin")
        self.assertEqual(linkedin["state"], "needs-attention")
        self.assertEqual(linkedin["counts"]["pending"], 1)
        self.assertEqual(linkedin["counts"]["expired"], 1)
        self.assertEqual(len(linkedin["details"]), 2)

    def test_links_read_endpoints_allow_hosted_single_user_mode_without_token(self) -> None:
        payload = self.get_json("/api/links/composio/my-apps")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["user_id"], "jimmythompson323")
        self.assertEqual(payload["summary"]["connected"], 1)
        self.assertEqual(payload["apps"][0]["slug"], "gmail")

        details = self.get_json("/api/links/composio/app-details?slug=gmail")
        self.assertTrue(details["ok"])
        self.assertEqual(details["slug"], "gmail")
        self.assertEqual(details["details"][0]["id"], "ca_gmail_active")

    def test_links_catalog_returns_cached_snapshot_headers_without_connected_overlay(self) -> None:
        token = self.issue_portal_token()
        payload, headers = self.get_json_response(f"/api/links/composio/catalog?token={token}")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["schema"], "pucky.links_catalog.v1")
        self.assertEqual(payload["total"], len(payload["apps"]))
        self.assertTrue(payload["generated_at"].endswith("Z"))
        self.assertTrue(payload["catalog_version"])
        self.assertEqual(headers["Cache-Control"], "private, max-age=600")
        self.assertTrue(headers["ETag"].startswith('W/"'))
        self.assertGreaterEqual(len(payload["apps"]), 4)
        self.assertIn("auth_label", payload["apps"][0])
        self.assertNotIn("state", payload["apps"][0])
        self.assertNotIn("counts", payload["apps"][0])
        self.assertEqual(self.composio.list_connected_calls, 0)

        request = urllib.request.Request(
            self.base_url + f"/api/links/composio/catalog?token={token}",
            headers={"If-None-Match": headers["ETag"]},
        )
        with self.assertRaises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(request, timeout=10)
        self.assertEqual(exc.exception.code, 304)
        self.assertEqual(exc.exception.headers["ETag"], headers["ETag"])

    def test_links_catalog_and_all_apps_allow_hosted_single_user_mode_without_token(self) -> None:
        payload, headers = self.get_json_response("/api/links/composio/catalog")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["schema"], "pucky.links_catalog.v1")
        self.assertEqual(headers["Cache-Control"], "private, max-age=600")

        all_apps = self.get_json("/api/links/composio/all-apps?offset=0&limit=20")
        slugs = [item["slug"] for item in all_apps["apps"]]
        self.assertIn("gmail", slugs)
        self.assertIn("googlecalendar", slugs)

    def test_links_all_apps_filters_search_and_hides_nonconnectable(self) -> None:
        token = self.issue_portal_token()
        payload = self.get_json(f"/api/links/composio/all-apps?token={token}&q=git&offset=0&limit=20")

        self.assertTrue(payload["ok"])
        names = [item["name"] for item in payload["apps"]]
        self.assertEqual(names, [])

        payload = self.get_json(f"/api/links/composio/all-apps?token={token}&q=link&offset=0&limit=20")
        self.assertEqual([item["slug"] for item in payload["apps"]], ["linkedin"])

        payload = self.get_json(f"/api/links/composio/all-apps?token={token}&offset=0&limit=20")
        slugs = [item["slug"] for item in payload["apps"]]
        self.assertIn("gmail", slugs)
        self.assertIn("googlecalendar", slugs)
        self.assertIn("linkedin", slugs)
        self.assertNotIn("composio", slugs)
        gmail = next(item for item in payload["apps"] if item["slug"] == "gmail")
        googlecalendar = next(item for item in payload["apps"] if item["slug"] == "googlecalendar")
        notion = next(item for item in payload["apps"] if item["slug"] == "notion")
        self.assertEqual(gmail["logo"], "https://logos.example.invalid/gmail.png")
        self.assertEqual(gmail["auth_label"], "OAuth")
        self.assertEqual(googlecalendar["auth_label"], "OAuth")
        self.assertEqual(notion["auth_label"], "OAuth + API key")

    def test_links_oauth_start_uses_token_user_and_webview_callback(self) -> None:
        token = self.issue_portal_token()
        payload = self.get_json(f"/api/links/composio/oauth/start?token={token}&app=linkedin&auth_mode=webview")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["schema"], "pucky.links_oauth_start.v1")
        self.assertEqual(payload["user_id"], "jimmythompson323")
        self.assertEqual(payload["slug"], "linkedin")
        self.assertEqual(payload["auth_mode"], "webview")
        self.assertEqual(payload["auth_url"], "https://connect.example.invalid/linkedin")
        self.assertIn("just_connected=linkedin", self.composio.starts[-1]["redirect_url"])
        self.assertEqual(self.composio.starts[-1]["app_slug"], "linkedin")

    def test_links_oauth_start_ignores_forged_forwarded_host_when_public_base_url_is_configured(self) -> None:
        self.service.config = replace(self.service.config, public_base_url="https://pucky.fly.dev/")
        token = self.issue_portal_token()

        payload = self.get_json(
            f"/api/links/composio/oauth/start?token={token}&app=linkedin&auth_mode=webview",
            headers={
                "Host": "evil.example",
                "X-Forwarded-Host": "evil.example",
                "X-Forwarded-Proto": "https",
            },
        )

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["auth_url"], "https://connect.example.invalid/linkedin")
        self.assertEqual(
            self.composio.starts[-1]["redirect_url"],
            "https://pucky.fly.dev/links/connect/apps?token="
            + token
            + "&auth_mode=webview&tab=my&just_connected=linkedin",
        )

    def test_links_disconnect_requires_owned_connection(self) -> None:
        token = self.issue_portal_token()
        payload = self.post_empty(f"/api/links/composio/disconnect?token={token}&connection_id=ca_linkedin_pending")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["deleted"], "ca_linkedin_pending")
        self.assertEqual(self.composio.deleted[-1], ("jimmythompson323", "ca_linkedin_pending"))

        request = urllib.request.Request(
            self.base_url + f"/api/links/composio/disconnect?token={token}&connection_id=ca_missing",
            data=b"",
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=10)
        self.assertEqual(caught.exception.code, 403)

    def test_links_refresh_and_disconnect_stay_protected_without_portal_token(self) -> None:
        refresh_request = urllib.request.Request(
            self.base_url + "/api/links/composio/my-apps/refresh",
            data=b"",
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as refresh_error:
            urllib.request.urlopen(refresh_request, timeout=10)
        self.assertEqual(refresh_error.exception.code, 401)

        disconnect_request = urllib.request.Request(
            self.base_url + "/api/links/composio/disconnect?connection_id=ca_gmail_active",
            data=b"",
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as disconnect_error:
            urllib.request.urlopen(disconnect_request, timeout=10)
        self.assertEqual(disconnect_error.exception.code, 401)

    def test_unauthorized_turn_is_rejected(self) -> None:
        request = urllib.request.Request(
            self.base_url + "/api/turn",
            data=b"audio",
            method="POST",
            headers={"Content-Type": "audio/mp4"},
        )

        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=10)

        self.assertEqual(caught.exception.code, 401)

    def test_raw_audio_turn_defaults_to_card_only_with_canonical_feed_item_and_tts(self) -> None:
        body = self.post_audio(b"audio", "audio/mp4")

        self.assertTrue(body["session_id"].startswith("pucky_"))
        self.assertEqual(body["turn_id"], body["session_id"])
        self.assertEqual(body["card_id"], "pucky_card_" + body["turn_id"])
        self.assertEqual(body["text"], "Sure, I can help.")
        self.assertEqual(body["summary"], "Sure, I can help.")
        self.assertEqual(body["title"], "Quick Help")
        self.assertEqual(body["icon"], "bolt")
        self.assertEqual(body["reply_mode"], "card_only")
        self.assertEqual(body["audio_mime_type"], "audio/wav")
        self.assertEqual(base64.b64decode(body["audio_base64"]), b"RIFFaudio")
        self.assertFalse(body["archived"])
        self.assertFalse(body["read"])
        self.assertFalse(body["deleted"])
        self.assertEqual(body["card"]["title"], "Quick Help")
        self.assertEqual(body["card"]["summary"], "Sure, I can help.")
        self.assertEqual(body["card"]["icon"], "bolt")
        self.assertEqual(body["origin"]["thread_id"], "thread-1")
        self.assertEqual(body["origin"]["thread_title"], "Quick Help")
        self.assertEqual(body["origin"]["model"], "gpt-5.5")
        self.assertEqual(body["origin"]["reasoning_effort"], "high")
        self.assertEqual(body["card"]["origin"]["thread_id"], "thread-1")
        self.assertEqual(body["connected_records"], [])
        self.assertEqual(body["card"]["connected_records"], [])
        self.assertNotIn("html_mime_type", body["card"])
        self.assertNotIn("html_mime_type", body)
        self.assertNotIn("transcript", body)
        self.assertEqual(self.stt.content_type, "audio/mp4")
        self.assertEqual(self.codex.turns, ["Pucky test turn"])
        self.assertEqual(self.codex.renamed_titles, ["Quick Help"])
        self.assertEqual(self.tts.text, "Sure, I can help.")
        telemetry = body["telemetry"]
        self.assertEqual(telemetry["turn_id"], body["turn_id"])
        self.assertEqual(telemetry["card_id"], body["card_id"])
        self.assertEqual(telemetry["request_audio_bytes"], 5)
        self.assertEqual(telemetry["reply_mode"], "card_only")
        self.assertTrue(telemetry["feed_persisted"])
        self.assertIn("stt_ms", telemetry)
        self.assertIn("codex_ms", telemetry)
        self.assertIn("tts_ms", telemetry)
        self.assertEqual(telemetry["tts_status"], "ok")
        self.assertEqual(telemetry["reply_audio_bytes"], len(b"RIFFaudio"))
        self.assertIn("response_bytes", telemetry)
        self.assertNotIn("transcript", telemetry)
        self.assertNotIn("Pucky test turn", json.dumps(telemetry))

    def test_wav_audio_turn_is_accepted_for_walkie_capture(self) -> None:
        body = self.post_audio(b"RIFF....WAVEfmt ", "audio/wav", turn_id="client_wav_walkie")

        self.assertEqual(body["turn_id"], "client_wav_walkie")
        self.assertEqual(body["reply_mode"], "card_only")
        self.assertEqual(self.stt.content_type, "audio/wav")
        telemetry = body["telemetry"]
        self.assertEqual(telemetry["content_type"], "audio/wav")
        self.assertEqual(telemetry["request_audio_bytes"], len(b"RIFF....WAVEfmt "))

    def test_card_and_spoken_turn_returns_audio_and_tts_telemetry(self) -> None:
        body = self.post_audio(b"audio", "audio/mp4", reply_mode="card_and_spoken")

        self.assertEqual(body["reply_mode"], "card_and_spoken")
        self.assertEqual(body["audio_mime_type"], "audio/wav")
        self.assertEqual(base64.b64decode(body["audio_base64"]), b"RIFFaudio")
        self.assertEqual(self.tts.text, "Sure, I can help.")
        telemetry = body["telemetry"]
        self.assertEqual(telemetry["reply_mode"], "card_and_spoken")
        self.assertIn("tts_ms", telemetry)
        self.assertEqual(telemetry["reply_audio_bytes"], len(b"RIFFaudio"))

    def test_feed_sync_returns_canonical_item(self) -> None:
        turn = self.post_audio(b"audio", "audio/mp4", turn_id="feed_sync_turn")

        payload = self.get_json("/api/feed?limit=10", headers={"Authorization": "Bearer secret"})

        self.assertEqual(payload["schema"], "pucky.feed_sync.v1")
        self.assertEqual(payload["has_more"], False)
        self.assertTrue(payload["next_cursor"])
        self.assertEqual(len(payload["items"]), 1)
        item = payload["items"][0]
        self.assertEqual(item["card_id"], turn["card_id"])
        self.assertEqual(item["turn_id"], "feed_sync_turn")
        self.assertEqual(item["origin"]["thread_id"], "thread-1")
        self.assertEqual(item["card"]["origin"]["thread_title"], "Quick Help")
        self.assertEqual(item["audio_mime_type"], "audio/wav")
        self.assertFalse(item["archived"])
        self.assertFalse(item["read"])
        self.assertFalse(item["deleted"])
        self.assertEqual(item["transcript_messages"][0]["role"], "user")
        self.assertEqual(item["transcript_messages"][0]["text"], "Pucky test turn")
        self.assertEqual(item["transcript_messages"][1]["role"], "assistant")
        mark_read = self.post_json(
            "/api/feed/actions",
            {
                "client_action_id": "feed_sync_mark_read",
                "card_id": turn["card_id"],
                "action": "mark_read",
            },
        )
        self.assertTrue(mark_read["ok"])
        self.assertTrue(mark_read["item"]["read"])
        archive = self.post_json(
            "/api/feed/actions",
            {
                "client_action_id": "feed_sync_archive",
                "card_id": turn["card_id"],
                "action": "archive",
            },
        )
        self.assertTrue(archive["ok"])
        self.assertTrue(archive["item"]["archived"])

    def test_feed_sync_supports_compact_active_home_feed(self) -> None:
        turn = self.post_audio(b"audio", "audio/mp4", turn_id="feed_compact_turn")

        full = self.get_json("/api/feed?limit=10", headers={"Authorization": "Bearer secret"})
        self.assertIn("audio_base64", full["items"][0])
        self.assertNotIn("html_base64", full["items"][0])
        self.assertEqual(full["items"][0]["connected_records"], [])

        compact = self.get_json("/api/feed?limit=10&compact=1", headers={"Authorization": "Bearer secret"})
        self.assertNotIn("audio_base64", compact["items"][0])
        self.assertNotIn("html_base64", compact["items"][0])
        self.assertEqual(compact["items"][0]["card_id"], turn["card_id"])
        self.assertEqual(compact["items"][0]["audio_mime_type"], "audio/wav")
        self.assertEqual(compact["items"][0]["audio_bytes"], len(b"RIFFaudio"))
        self.assertEqual(compact["items"][0]["audio_sha256"], hashlib.sha256(b"RIFFaudio").hexdigest())
        self.assertEqual(compact["items"][0]["audio_media_id"], f"feed:{turn['card_id']}:audio")
        self.assertEqual(compact["items"][0]["connected_records"], [])
        self.assertTrue(compact["items"][0]["audio_url"].startswith(self.base_url + "/api/artifacts/"))
        self.assertNotIn(str(self.tmp.name), compact["items"][0]["audio_url"])

        archive = self.post_json(
            "/api/feed/actions",
            {
                "client_action_id": "feed_compact_archive",
                "card_id": turn["card_id"],
                "action": "archive",
            },
        )
        self.assertTrue(archive["ok"])

        active = self.get_json(
            "/api/feed?limit=10&compact=1&include_archived=0",
            headers={"Authorization": "Bearer secret"},
        )
        self.assertEqual(active["items"], [])

    def test_feed_sync_allows_unauthenticated_browser_reads_but_not_actions(self) -> None:
        turn = self.post_audio(b"audio", "audio/mp4", turn_id="feed_browser_turn")

        payload = self.get_json("/api/feed?limit=10&compact=1&include_archived=0")
        self.assertEqual(payload["schema"], "pucky.feed_sync.v1")
        self.assertEqual(payload["items"][0]["card_id"], turn["card_id"])

        with self.assertRaises(urllib.error.HTTPError) as action_caught:
            self.post_json(
                "/api/feed/actions",
                {
                    "client_action_id": "feed_browser_archive",
                    "card_id": turn["card_id"],
                    "action": "archive",
                },
                headers={"Authorization": ""},
            )

        self.assertEqual(action_caught.exception.code, 401)

    def test_feed_sync_and_actions_accept_api_token(self) -> None:
        turn = self.post_audio(b"audio", "audio/mp4", turn_id="feed_browser_token_turn")

        payload = self.get_json(
            "/api/feed?limit=10&compact=1&include_archived=0",
            headers={"Authorization": "Bearer secret"},
        )

        self.assertEqual(payload["schema"], "pucky.feed_sync.v1")
        self.assertEqual(payload["items"][0]["card_id"], turn["card_id"])
        self.assertNotIn("audio_base64", payload["items"][0])
        action = self.post_json(
            "/api/feed/actions",
            {
                "client_action_id": "feed_browser_token_archive",
                "card_id": turn["card_id"],
                "action": "archive",
            },
            headers={"Authorization": "Bearer secret"},
        )
        self.assertTrue(action["ok"])
        self.assertTrue(action["item"]["archived"])

    def test_feed_sync_orders_newest_groups_first_and_excludes_archived_before_ordering(self) -> None:
        older = self.post_json(
            "/api/turn/text",
            {"text": "Older grouped feed card", "turn_id": "feed_order_older"},
            headers={"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": "feed_order_older_thread"},
        )
        time.sleep(0.01)
        newer = self.post_json(
            "/api/turn/text",
            {"text": "Newer grouped feed card", "turn_id": "feed_order_newer"},
            headers={"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": "feed_order_newer_thread"},
        )

        payload = self.get_json("/api/feed?limit=10&compact=1&include_archived=0", headers={"Authorization": "Bearer secret"})
        self.assertEqual([item["card_id"] for item in payload["items"][:2]], [newer["card_id"], older["card_id"]])

        archive = self.post_json(
            "/api/feed/actions",
            {
                "client_action_id": "feed_order_archive_newer",
                "card_id": newer["card_id"],
                "action": "archive",
            },
        )
        self.assertTrue(archive["ok"])
        active = self.get_json("/api/feed?limit=10&compact=1&include_archived=0", headers={"Authorization": "Bearer secret"})
        self.assertEqual(active["items"][0]["card_id"], older["card_id"])
        self.assertNotIn(newer["card_id"], [item["card_id"] for item in active["items"]])

    def test_feed_sync_thread_group_order_uses_latest_turn_activity(self) -> None:
        newest_single = self.post_json(
            "/api/turn/text",
            {"text": "Newest single before grouped update", "turn_id": "feed_group_single"},
            headers={"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": "feed_group_single_thread"},
        )
        time.sleep(0.01)
        self.post_json(
            "/api/turn/text",
            {"text": "Old grouped thread turn", "turn_id": "feed_group_old"},
            headers={"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": "feed_group_thread"},
        )
        time.sleep(0.01)
        latest_grouped = self.post_json(
            "/api/turn/text",
            {"text": "Latest grouped thread turn", "turn_id": "feed_group_latest"},
            headers={"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": "feed_group_thread"},
        )

        payload = self.get_json("/api/feed?limit=10&compact=1&include_archived=0", headers={"Authorization": "Bearer secret"})
        self.assertEqual([item["card_id"] for item in payload["items"][:2]], [latest_grouped["card_id"], newest_single["card_id"]])
        self.assertEqual(payload["items"][0]["thread_history_count"], 2)

    def test_feed_sync_descending_pagination_has_no_duplicates(self) -> None:
        created: list[str] = []
        for index in range(5):
            time.sleep(0.01)
            item = self.post_json(
                "/api/turn/text",
                {"text": f"Paged feed card {index}", "turn_id": f"feed_page_{index}"},
                headers={"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": f"feed_page_thread_{index}"},
            )
            created.append(item["card_id"])

        first = self.get_json("/api/feed?limit=2&compact=1&include_archived=0", headers={"Authorization": "Bearer secret"})
        second = self.get_json(
            f"/api/feed?limit=2&compact=1&include_archived=0&cursor={urllib.parse.quote(first['next_cursor'], safe='')}",
            headers={"Authorization": "Bearer secret"},
        )
        third = self.get_json(
            f"/api/feed?limit=2&compact=1&include_archived=0&cursor={urllib.parse.quote(second['next_cursor'], safe='')}",
            headers={"Authorization": "Bearer secret"},
        )

        seen = [item["card_id"] for item in first["items"] + second["items"] + third["items"]]
        self.assertEqual(seen[:5], list(reversed(created)))
        self.assertEqual(len(seen[:5]), len(set(seen[:5])))
        self.assertTrue(first["has_more"])
        self.assertTrue(second["has_more"])
        self.assertFalse(third["has_more"])

    def test_feed_sync_compact_thread_group_omits_heavy_history_payloads(self) -> None:
        self.post_json(
            "/api/turn/text",
            {"text": "First compact thread turn", "turn_id": "feed_compact_thread_a"},
            headers={"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": "thread_compact_feed"},
        )
        latest = self.post_json(
            "/api/turn/text",
            {"text": "Second compact thread turn", "turn_id": "feed_compact_thread_b"},
            headers={"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": "thread_compact_feed"},
        )

        full = self.get_json("/api/feed?limit=10", headers={"Authorization": "Bearer secret"})
        self.assertEqual(len(full["items"]), 1)
        self.assertGreaterEqual(len(full["items"][0]["transcript_messages"]), 2)
        self.assertIn("audio_base64", full["items"][0])

        compact = self.get_json("/api/feed?limit=10&compact=1", headers={"Authorization": "Bearer secret"})
        self.assertEqual(len(compact["items"]), 1)
        self.assertEqual(compact["items"][0]["card_id"], latest["card_id"])
        self.assertNotIn("audio_base64", compact["items"][0])
        self.assertNotIn("html_base64", compact["items"][0])
        self.assertEqual([message["text"] for message in compact["items"][0]["transcript_messages"]], [
            "Second compact thread turn",
            "Sure, I can help.",
        ])

    def test_turn_fails_closed_when_feed_readback_is_missing(self) -> None:
        original_get_item = self.service.feed.get_item
        self.service.feed.get_item = lambda card_id: None  # type: ignore[assignment]
        try:
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.post_audio(b"audio", "audio/mp4", turn_id="feed_persist_missing")
        finally:
            self.service.feed.get_item = original_get_item  # type: ignore[assignment]

        self.assertEqual(caught.exception.code, 500)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error"], "turn_failed")
        self.assertEqual(payload["detail"], "feed_persist_failed")

    def test_feed_actions_are_idempotent_and_ack_gated(self) -> None:
        turn = self.post_audio(b"audio", "audio/mp4", turn_id="feed_action_turn")
        body = {
            "client_action_id": "client_action_1",
            "card_id": turn["card_id"],
            "action": "archive",
        }

        first = self.post_json("/api/feed/actions", body)
        second = self.post_json("/api/feed/actions", body)

        self.assertTrue(first["ok"])
        self.assertEqual(first, second)
        self.assertEqual(first["item"]["card_id"], turn["card_id"])
        self.assertTrue(first["item"]["archived"])
        payload = self.get_json("/api/feed?limit=10", headers={"Authorization": "Bearer secret"})
        self.assertTrue(payload["items"][0]["archived"])

    def test_feed_unarchive_action_restores_card_to_active_feed(self) -> None:
        turn = self.post_audio(b"audio", "audio/mp4", turn_id="feed_unarchive_turn")
        archive = self.post_json(
            "/api/feed/actions",
            {
                "client_action_id": "client_action_archive_restore",
                "card_id": turn["card_id"],
                "action": "archive",
            },
        )
        self.assertTrue(archive["ok"])
        self.assertTrue(archive["item"]["archived"])
        active_after_archive = self.get_json(
            "/api/feed?limit=10&include_archived=0",
            headers={"Authorization": "Bearer secret"},
        )
        self.assertEqual(active_after_archive["items"], [])

        body = {
            "client_action_id": "client_action_unarchive_restore",
            "card_id": turn["card_id"],
            "action": "unarchive",
        }
        first = self.post_json("/api/feed/actions", body)
        second = self.post_json("/api/feed/actions", body)

        self.assertTrue(first["ok"])
        self.assertEqual(first, second)
        self.assertEqual(first["item"]["card_id"], turn["card_id"])
        self.assertFalse(first["item"]["archived"])
        active_after_restore = self.get_json(
            "/api/feed?limit=10&include_archived=0",
            headers={"Authorization": "Bearer secret"},
        )
        self.assertEqual(active_after_restore["items"][0]["card_id"], turn["card_id"])
        self.assertFalse(active_after_restore["items"][0]["archived"])

    def test_feed_archive_missing_card_fails_with_not_found(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post_json(
                "/api/feed/actions",
                {
                    "client_action_id": "missing_card_archive",
                    "card_id": "pucky_card_missing",
                    "action": "archive",
                },
            )

        self.assertEqual(caught.exception.code, 404)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error"], "card_not_found")

    def test_media_manifest_lists_meeting_and_feed_media_without_raw_paths(self) -> None:
        meeting_audio = b"RIFFmeeting-cache-audio"
        meeting_id = "meeting-20260601-120000-device-abc123ef"
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": meeting_id,
                "started_at": "2026-06-01T12:00:00Z",
                "stopped_at": "2026-06-01T12:00:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(meeting_audio).decode("ascii"),
            },
        )
        turn = self.post_audio(b"feed request audio", "audio/mp4", turn_id="media_manifest_turn")

        payload = self.get_json(
            "/api/media/manifest?scope=meetings,feed&limit=20",
            headers={"Authorization": "Bearer secret"},
        )

        self.assertEqual(payload["schema"], "pucky.media_manifest.v1")
        self.assertEqual(payload["scopes"], ["meetings", "feed"])
        items = payload["items"]
        meeting_item = next(item for item in items if item["media_id"] == f"meeting:{meeting_id}:audio")
        self.assertEqual(meeting_item["owner_type"], "meeting")
        self.assertEqual(meeting_item["owner_id"], meeting_id)
        self.assertEqual(meeting_item["kind"], "audio")
        self.assertEqual(meeting_item["bytes"], len(meeting_audio))
        self.assertEqual(meeting_item["sha256"], hashlib.sha256(meeting_audio).hexdigest())
        self.assertTrue(meeting_item["url"].endswith(f"/api/meetings/{meeting_id}/audio"))

        feed_item = next(item for item in items if item["media_id"] == f"feed:{turn['card_id']}:audio")
        self.assertEqual(feed_item["owner_type"], "feed")
        self.assertEqual(feed_item["owner_id"], turn["card_id"])
        self.assertEqual(feed_item["kind"], "audio")
        self.assertEqual(feed_item["bytes"], len(b"RIFFaudio"))
        self.assertEqual(feed_item["sha256"], hashlib.sha256(b"RIFFaudio").hexdigest())
        self.assertIn("/api/artifacts/", feed_item["url"])

        dumped = json.dumps(payload)
        self.assertNotIn(str(Path(self.tmp.name)), dumped)
        self.assertNotIn("/data/user/0/com.pucky.device.debug/files", dumped)
        for item in items:
            self.assertEqual(
                set(item),
                {"media_id", "owner_type", "owner_id", "kind", "title", "url", "mime_type", "bytes", "sha256", "updated_at"},
            )

    def test_media_manifest_and_media_bytes_are_authorized(self) -> None:
        audio = b"RIFFauthorized-meeting-audio"
        meeting_id = "meeting-20260601-121000-device-abc123ef"
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": meeting_id,
                "started_at": "2026-06-01T12:10:00Z",
                "duration_ms": 3000,
                "device_id": "device-1",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(audio).decode("ascii"),
            },
        )

        with self.assertRaises(urllib.error.HTTPError) as manifest_error:
            self.get_json("/api/media/manifest?scope=meetings")
        self.assertEqual(manifest_error.exception.code, 401)

        manifest = self.get_json(
            "/api/media/manifest?scope=meetings",
            headers={"Authorization": "Bearer secret"},
        )
        media_url = manifest["items"][0]["url"]
        media_path = urllib.parse.urlsplit(media_url).path
        with urllib.request.urlopen(self.base_url + media_path, timeout=10) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), audio)

        request = urllib.request.Request(
            self.base_url + media_path,
            headers={"Authorization": "Bearer secret"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            self.assertEqual(response.read(), audio)

    def test_meeting_ingest_stores_audio_queues_agent_and_updates_single_feed_card(self) -> None:
        audio = b"RIFFmeeting-audio"
        payload = self.post_json(
            "/api/meetings",
            {
                "meeting_id": "meeting-20260601-120000-device-abc123ef",
                "started_at": "2026-06-01T12:00:00Z",
                "stopped_at": "2026-06-01T12:00:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(audio).decode("ascii"),
            },
        )

        self.assertEqual(payload["schema"], "pucky.meeting_ingest.v1")
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["state"], "processing")
        self.assertEqual(payload["audio_bytes"], len(audio))
        self.assertTrue(str(payload["audio_path"]).endswith(".m4a"))
        self.assertEqual(self.codex.turns, [])
        self.assertEqual(payload["card"]["title"], "Processing meeting recording")
        self.assertEqual(payload["card"]["card_kind"], "meeting_processing")
        self.assertEqual(payload["card"]["meeting_state"], "processing")
        self.assertEqual(payload["meeting"]["card_id"], "pucky_card_meeting-20260601-120000-device-abc123ef")

        meeting = {}
        for _ in range(50):
            meetings = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"})
            rows = meetings.get("meetings", [])
            meeting = next(
                (item for item in rows if item.get("meeting_id") == "meeting-20260601-120000-device-abc123ef"),
                {},
            )
            if meeting.get("state") == "completed":
                break
            time.sleep(0.1)
        self.assertEqual(meeting["state"], "completed")
        self.assertEqual(meeting["transcript_status"], "completed")
        self.assertIn("[00:00-00:02] Jimmy: I'm Jimmy and this is Jack.", meeting["transcript_text"])
        self.assertIn("[00:02-00:05] Jack: Pucky, after this meeting, prepare follow-up notes for both of us.", meeting["transcript_text"])
        self.assertTrue(meeting["diarization_requested"])
        self.assertEqual(meeting["diarization_status"], "speaker_turns")
        self.assertGreaterEqual(len(meeting["speaker_turns"]), 2)
        self.assertEqual(meeting["speaker_turns"][0]["speaker"], "Jimmy")
        self.assertEqual(meeting["feed_item"]["card"]["title"], "Meeting Notes")
        self.assertEqual(meeting["recording_title"], "Jimmy and Jack Follow-ups")
        self.assertEqual(meeting["recording_title_source"], "agent")
        self.assertEqual(meeting["card_id"], payload["meeting"]["card_id"])
        self.assertTrue(Path(meeting["audio_path"]).is_file())
        self.assertEqual(self.stt.transcribe_calls, 0)
        self.assertEqual(self.stt.transcribe_with_metadata_calls, 1)
        self.assertNotIn("meeting_result", self.meeting_codex.output_schemas[-1]["properties"])
        prompt = self.meeting_codex.turns[-1]
        self.assertIn("Meeting Mode Agent Handoff", prompt)
        self.assertIn("audio_path:", prompt)
        self.assertIn("Use Deepgram for the meeting transcript and diarization.", prompt)
        self.assertIn("keep distinct anonymous speakers separated as neutral labels", prompt)
        self.assertIn("Return the cleaned labeled transcript in transcript_text.", prompt)
        self.assertIn("Do not emit reply-level HTML.", prompt)
        self.assertIn("create exactly one primary regular note in graph_records", prompt)
        self.assertIn("connected_records with the primary note first", prompt)
        self.assertIn("Use due dates only when the meeting explicitly states them.", prompt)
        self.assertIn("Meeting Mode Agent", self.meeting_codex.developer_instructions[-1])
        self.assertIn("Transcribe and diarize it with Deepgram.", self.meeting_codex.developer_instructions[-1])
        self.assertIn("relabel them to real names only when clearly justified", self.meeting_codex.developer_instructions[-1])
        self.assertIn("recording_title", self.meeting_codex.developer_instructions[-1])
        self.assertIn("Create exactly one primary regular note in graph_records.", self.meeting_codex.developer_instructions[-1])
        self.assertIn("Do not emit reply-level HTML pages.", self.meeting_codex.developer_instructions[-1])
        self.assertIn("due date only when explicitly stated", self.meeting_codex.developer_instructions[-1])
        self.assertNotIn("Your job is to turn one finished meeting recording into", self.meeting_codex.developer_instructions[-1])
        self.assertNotIn("Hard constraints:", self.meeting_codex.developer_instructions[-1])
        self.assertNotIn("Output shape:", self.meeting_codex.developer_instructions[-1])
        self.assertEqual(meeting["agent"]["transcription_provider"], "deepgram")
        self.assertEqual(meeting["agent"]["transcription_model"], "nova-3")
        self.assertEqual(meeting["agent"]["last_meeting_tool_name"], "meeting_deepgram_transcribe")
        self.assertEqual(meeting["agent"]["basename_sync_status"], "renamed")
        self.assertTrue(meeting["agent"]["last_meeting_tool_call_at"])
        self.assertEqual(meeting["agent"]["title_quality"], "human_like")
        self.assertEqual(meeting["agent"]["recording_title_quality"], "human_like")
        self.assertTrue(meeting["agent"]["transcript_attachment_present"])
        self.assertEqual(meeting["feed_item"]["telemetry"]["transcription_provider"], "deepgram")
        self.assertEqual(meeting["feed_item"]["telemetry"]["meeting_title_quality"], "human_like")
        self.assertEqual(meeting["feed_item"]["telemetry"]["meeting_recording_title"], "Jimmy and Jack Follow-ups")
        self.assertEqual(meeting["connected_records"][0]["kind"], "note")
        self.assertEqual(meeting["connected_records"][0]["id"], "note-meeting-followups")

        persisted = self.service.feed.get_item(meeting["card_id"])
        self.assertIsNotNone(persisted)
        self.assertEqual(persisted["title"], "Meeting Notes")
        self.assertFalse(persisted["read"])
        self.assertFalse(persisted["archived"])
        self.assertEqual(persisted["connected_records"][0]["kind"], "note")
        self.assertEqual(persisted["connected_records"][0]["id"], "note-meeting-followups")
        messages = persisted["transcript_messages"]
        self.assertEqual(messages[0]["text"], "Meeting recording")
        self.assertNotIn("Meeting Mode Agent Handoff", json.dumps(messages))
        self.assertNotIn("attachments", messages[0])
        attachments = messages[1]["attachments"]
        transcript_attachment = next(item for item in attachments if item["title"] == "Transcript (Plain Text)")
        audio_attachment = next(item for item in attachments if item["title"] == "Meeting Audio")
        self.assertEqual(transcript_attachment["kind"], "text")
        self.assertIn("Jimmy:", transcript_attachment["text"])
        self.assertIn("meeting_transcript", transcript_attachment["artifact"])
        self.assertEqual(transcript_attachment["recording_title"], "Jimmy and Jack Follow-ups")
        self.assertIn("/api/shared/artifacts/", str(transcript_attachment["src"]))
        self.assertIn("token=", str(transcript_attachment["src"]))
        self.assertEqual(audio_attachment["kind"], "audio")
        self.assertEqual(audio_attachment["meeting_id"], "meeting-20260601-120000-device-abc123ef")
        self.assertEqual(audio_attachment["canonical_basename"], "Jimmy_and_Jack_Follow_ups_06.01.26")
        self.assertEqual(audio_attachment["recording_title"], "Jimmy and Jack Follow-ups")
        self.assertIn("meeting_audio", audio_attachment["artifact"])
        self.assertTrue(str(audio_attachment["path"]).endswith(".m4a"))
        self.assertIn("/api/shared/meetings/meeting-20260601-120000-device-abc123ef/audio", str(audio_attachment["url"]))
        self.assertIn("token=", str(audio_attachment["url"]))
        self.assertEqual(meeting["canonical_basename"], "Jimmy_and_Jack_Follow_ups_06.01.26")
        self.assertTrue(Path(meeting["audio_path"]).name.startswith("Jimmy_and_Jack_Follow_ups_06.01.26"))
        self.assertTrue(Path(meeting["transcript_path"]).name.startswith("Jimmy_and_Jack_Follow_ups_06.01.26"))
        self.assertTrue(Path(meeting["transcript_html_path"]).name.startswith("Jimmy_and_Jack_Follow_ups_06.01.26"))
        note = self.service.workspace.get_record("notes", "note-meeting-followups")
        self.assertIsNotNone(note)
        self.assertEqual(note["title"], "Jimmy and Jack Follow-ups")
        self.assertIn("Follow-up notes prepared.", note["html"])
        self.assertEqual(self.meeting_codex.tool_calls[-1]["schema"], "pucky.meeting_deepgram_transcribe.v1")
        meetings = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"})
        self.assertEqual(meetings["schema"], "pucky.meetings.v1")
        self.assertTrue(any(
            item["meeting_id"] == "meeting-20260601-120000-device-abc123ef"
            for item in meetings["meetings"]
        ))

    def test_meeting_tool_catalog_is_scoped_to_meeting_client(self) -> None:
        default_tools = [tool["name"] for tool in self.service.codex_tools_for_thread()]
        meeting_tools = [tool["name"] for tool in self.service.meeting_codex_tools_for_thread()]

        self.assertNotIn("meeting_deepgram_transcribe", default_tools)
        self.assertNotIn("meeting_record_update", default_tools)
        self.assertIn("meeting_deepgram_transcribe", meeting_tools)
        self.assertIn("meeting_record_update", meeting_tools)
        self.assertIn("composio_execute_action", meeting_tools)

    def test_meeting_record_update_tool_can_retitle_and_rename_persisted_artifacts(self) -> None:
        audio = b"RIFFmeeting-audio"
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": "meeting-20260601-120000-device-abc123ef",
                "started_at": "2026-06-01T12:00:00Z",
                "stopped_at": "2026-06-01T12:00:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(audio).decode("ascii"),
            },
        )
        meeting = {}
        for _ in range(50):
            rows = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"}).get("meetings", [])
            meeting = next((item for item in rows if item.get("meeting_id") == "meeting-20260601-120000-device-abc123ef"), {})
            if meeting.get("state") == "completed":
                break
            time.sleep(0.1)
        self.assertEqual(meeting["state"], "completed")

        updated = self.service.meeting_record_update_tool(
            {
                "meeting_id": "meeting-20260601-120000-device-abc123ef",
                "title": "Quarterly Deck Review",
                "recording_title": "Quarterly Deck Recording",
            },
            thread_id="meeting-thread-1",
            turn_id="meeting-20260601-120000-device-abc123ef",
        )

        self.assertTrue(updated["ok"])
        renamed = updated["meeting"]
        self.assertEqual(renamed["title"], "Quarterly Deck Review")
        self.assertEqual(renamed["recording_title"], "Quarterly Deck Recording")
        self.assertEqual(renamed["canonical_basename"], "Quarterly_Deck_Recording_06.01.26")
        self.assertTrue(Path(renamed["audio_path"]).name.startswith("Quarterly_Deck_Recording_06.01.26"))
        self.assertTrue(Path(renamed["transcript_path"]).name.startswith("Quarterly_Deck_Recording_06.01.26"))
        self.assertTrue(Path(renamed["transcript_html_path"]).name.startswith("Quarterly_Deck_Recording_06.01.26"))
        self.assertEqual(renamed["agent"]["last_meeting_tool_name"], "meeting_record_update")
        self.assertEqual(renamed["agent"]["title_quality"], "human_like")
        self.assertEqual(renamed["agent"]["recording_title_quality"], "human_like")
        transcript_attachment = next(
            item
            for item in renamed["feed_item"]["transcript_messages"][1]["attachments"]
            if item["title"] == "Transcript (Plain Text)"
        )
        transcript_html_attachment = next(
            item
            for item in renamed["feed_item"]["transcript_messages"][1]["attachments"]
            if item["title"] == "Transcript"
        )
        self.assertEqual(transcript_attachment["canonical_basename"], "Quarterly_Deck_Recording_06.01.26")
        self.assertEqual(transcript_attachment["recording_title"], "Quarterly Deck Recording")
        self.assertEqual(transcript_html_attachment["canonical_basename"], "Quarterly_Deck_Recording_06.01.26")
        self.assertEqual(transcript_html_attachment["recording_title"], "Quarterly Deck Recording")

    def test_meeting_signed_summary_transcript_and_audio_urls_are_browser_readable_without_auth(self) -> None:
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": "meeting-20260601-120000-device-abc123ef",
                "started_at": "2026-06-01T12:00:00Z",
                "stopped_at": "2026-06-01T12:00:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(b"RIFFmeeting-audio").decode("ascii"),
            },
        )
        meeting = {}
        for _ in range(50):
            rows = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"}).get("meetings", [])
            meeting = next((item for item in rows if item.get("meeting_id") == "meeting-20260601-120000-device-abc123ef"), {})
            if meeting.get("state") == "completed":
                break
            time.sleep(0.1)
        self.assertEqual(meeting["state"], "completed")
        attachments = meeting["feed_item"]["transcript_messages"][1]["attachments"]
        summary_attachment = next(item for item in attachments if item["title"] == "Meeting Summary")
        transcript_attachment = next(item for item in attachments if item["title"] == "Transcript")
        audio_attachment = next(item for item in attachments if item["title"] == "Meeting Audio")

        for url in (
            str(summary_attachment["viewer_url"]),
            str(transcript_attachment["viewer_url"]),
            str(audio_attachment["url"]),
        ):
            with urllib.request.urlopen(urllib.parse.urljoin(self.base_url, url), timeout=10) as response:
                body = response.read()
                self.assertTrue(body)

    def test_meeting_summary_html_rewrites_placeholder_anchors_without_nested_links(self) -> None:
        raw = (
            '<p><a href="{{PUCKY_MEETING_TRANSCRIPT_LINK}}">Transcript</a> | '
            '<a href="{{PUCKY_MEETING_AUDIO_LINK}}">Audio</a></p>'
        )
        rendered = _meeting_summary_html_with_vm_links(
            raw,
            "/api/shared/artifacts/transcript?token=test-token",
            "/api/shared/meetings/meeting-1/audio?token=test-token",
        )
        self.assertIn('class="document-open-link pucky-meeting-transcript-link"', rendered)
        self.assertIn('class="document-open-link pucky-meeting-audio-link"', rendered)
        self.assertNotIn('href="<a', rendered)
        self.assertNotIn('>Transcript</a>">', rendered)
        self.assertNotIn('>Audio</a>">', rendered)

    def test_meeting_canonical_basename_does_not_duplicate_date_suffix_from_recording_title(self) -> None:
        record = {"started_at": "2026-06-07T01:57:22Z"}
        self.assertEqual(
            _meeting_canonical_basename(record, "partner_rollout_launch_readiness_06.07.26"),
            "partner_rollout_launch_readiness_06_07_26",
        )

    def test_meeting_deepgram_transcribe_tool_keeps_neutral_speakers_when_names_are_unknown(self) -> None:
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": "meeting-20260602-120000-device-abc123ef",
                "started_at": "2026-06-02T12:00:00Z",
                "stopped_at": "2026-06-02T12:00:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(b"RIFFunknown-speakers").decode("ascii"),
            },
        )
        for _ in range(50):
            rows = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"}).get("meetings", [])
            meeting = next((item for item in rows if item.get("meeting_id") == "meeting-20260602-120000-device-abc123ef"), {})
            if meeting.get("state") == "completed":
                break
            time.sleep(0.1)

        result = self.service.meeting_deepgram_transcribe_tool(
            {"meeting_id": "meeting-20260602-120000-device-abc123ef"},
            thread_id="meeting-thread-1",
            turn_id="meeting-20260602-120000-device-abc123ef",
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["speaker_turns"][0]["speaker"], "speaker_0")
        self.assertIn("speaker_0:", result["transcript_attachment_text"])
        self.assertEqual(result["agent"]["diarization_status"], "speaker_turns")

    def test_short_silent_meeting_completes_with_native_audio_attachment(self) -> None:
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": "meeting-20260603-120000-device-silent-audio",
                "started_at": "2026-06-03T12:00:00Z",
                "stopped_at": "2026-06-03T12:00:03Z",
                "duration_ms": 3000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/silent.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(b"RIFFsilent-audio").decode("ascii"),
            },
        )
        meeting = {}
        for _ in range(50):
            rows = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"}).get("meetings", [])
            meeting = next((item for item in rows if item.get("meeting_id") == "meeting-20260603-120000-device-silent-audio"), {})
            if meeting.get("state") == "completed":
                break
            time.sleep(0.1)

        self.assertEqual(meeting["state"], "completed")
        self.assertEqual(meeting["title"], "Meeting Notes")
        self.assertEqual(meeting["recording_title"], "Silent Audio Check")
        self.assertEqual(meeting["transcript_status"], "completed")
        self.assertEqual(meeting["diarization_status"], "plain_transcript")
        self.assertEqual(meeting["speaker_turns"], [])
        self.assertIn("No clear speech detected", meeting["transcript_text"])
        self.assertEqual(meeting["agent"]["title_quality"], "human_like")
        attachments = meeting["feed_item"]["transcript_messages"][1]["attachments"]
        self.assertTrue(any(item["title"] == "Meeting Audio" and item["kind"] == "audio" for item in attachments))
        self.assertTrue(any(item["title"] == "Transcript (Plain Text)" for item in attachments))
        self.assertTrue(any(item["title"] == "Transcript" for item in attachments))

    def test_raw_meeting_title_is_allowed_and_flagged_machine_like(self) -> None:
        raw_meeting_id = "meeting-20260603-121500-device-raw-title"
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": raw_meeting_id,
                "started_at": "2026-06-03T12:15:00Z",
                "stopped_at": "2026-06-03T12:15:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/raw-title.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(b"RIFFmeeting-audio").decode("ascii"),
            },
        )
        meeting = {}
        for _ in range(50):
            rows = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"}).get("meetings", [])
            meeting = next((item for item in rows if item.get("meeting_id") == raw_meeting_id), {})
            if meeting.get("state") == "completed":
                break
            time.sleep(0.1)

        self.assertEqual(meeting["state"], "completed")
        self.assertEqual(meeting["title"], raw_meeting_id)
        self.assertEqual(meeting["recording_title"], raw_meeting_id)
        self.assertEqual(meeting["feed_item"]["card"]["title"], raw_meeting_id)
        self.assertEqual(meeting["agent"]["title_quality"], "machine_like")
        self.assertEqual(meeting["agent"]["recording_title_quality"], "machine_like")
        self.assertEqual(meeting["feed_item"]["telemetry"]["meeting_title_quality"], "machine_like")

    def test_meeting_transcript_attachment_relabels_named_speakers_in_user_facing_transcript(self) -> None:
        record = {"meeting_id": "meeting-20260601-120000-device-abc123ef", "started_at": "2026-06-01T12:00:00Z"}
        PuckyVoiceService._apply_meeting_agent_reply(
            record,
            {
                "card": {"title": "Review"},
                "transcript_messages": [
                    {
                        "role": "assistant",
                        "attachments": [
                            {
                                "title": "Meeting Transcript",
                                "kind": "text",
                                "text": "[00:00-00:02] Jimmy: I'm Jimmy and this is Jack.\n[00:02-00:05] Jack: Let's ship the migration plan."
                            }
                        ],
                    }
                ],
            },
        )

        self.assertEqual(record["speaker_turns"][0]["speaker"], "Jimmy")
        self.assertEqual(record["speaker_turns"][1]["speaker"], "Jack")
        self.assertEqual(record["diarization_status"], "speaker_turns")
        self.assertIn("[00:00-00:02] Jimmy: I'm Jimmy and this is Jack.", record["transcript_text"])

    def test_meeting_transcript_attachment_keeps_neutral_speakers_when_names_are_unknown(self) -> None:
        record = {"meeting_id": "meeting-20260601-120000-device-abc123ef", "started_at": "2026-06-01T12:00:00Z"}
        PuckyVoiceService._apply_meeting_agent_reply(
            record,
            {
                "card": {"title": "Anonymous Meeting"},
                "transcript_messages": [
                    {
                        "role": "assistant",
                        "attachments": [
                            {
                                "title": "Meeting Transcript",
                                "kind": "text",
                                "text": "[00:00-00:02] speaker_0: Let's launch on Friday.\n[00:02-00:04] speaker_1: I can own QA coverage."
                            }
                        ],
                    }
                ],
            },
        )

        self.assertEqual(record["speaker_turns"][0]["speaker"], "speaker_0")
        self.assertEqual(record["speaker_turns"][1]["speaker"], "speaker_1")
        self.assertEqual(record["diarization_status"], "speaker_turns")

    def test_meeting_transcript_attachment_falls_back_to_plain_transcript_without_speaker_turns(self) -> None:
        record = {"meeting_id": "meeting-20260601-120000-device-abc123ef", "started_at": "2026-06-01T12:00:00Z"}
        PuckyVoiceService._apply_meeting_agent_reply(
            record,
            {
                "card": {"title": "Plain Transcript"},
                "transcript_messages": [
                    {
                        "role": "assistant",
                        "attachments": [
                            {
                                "title": "Meeting Transcript",
                                "kind": "text",
                                "text": "Plain transcript only."
                            }
                        ],
                    }
                ],
            },
        )

        self.assertEqual(record["transcript_text"], "Plain transcript only.")
        self.assertEqual(record["speaker_turns"], [])
        self.assertEqual(record["diarization_status"], "plain_transcript")

    def test_meeting_ingest_creates_processing_feed_card_before_agent_finishes(self) -> None:
        blocking = BlockingCodex()
        self.service.meeting_codex = blocking
        meeting_id = "meeting-20260601-120500-device-abc123ef"
        payload = self.post_json(
            "/api/meetings",
            {
                "meeting_id": meeting_id,
                "started_at": "2026-06-01T12:05:00Z",
                "stopped_at": "2026-06-01T12:05:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(b"RIFFmeeting-audio").decode("ascii"),
            },
        )

        self.assertTrue(blocking.codex_started.wait(timeout=2))
        self.assertEqual(payload["meeting"]["card_id"], "pucky_card_" + meeting_id)
        placeholder = self.service.feed.get_item("pucky_card_" + meeting_id)
        self.assertIsNotNone(placeholder)
        self.assertEqual(placeholder["title"], "Processing meeting recording")
        self.assertEqual(placeholder["origin"]["card_kind"], "meeting_processing")
        self.assertEqual(placeholder["origin"]["meeting_state"], "processing")
        self.assertEqual(self.stt.transcribe_calls, 0)
        self.assertEqual(self.stt.transcribe_with_metadata_calls, 0)
        blocking.release_codex.set()

    def test_failed_meeting_agent_updates_same_feed_card_out_of_processing(self) -> None:
        class LockedMeetingCodex(FakeCodex):
            def send_turn(
                self,
                text: str,
                *,
                thread_id: str | None = None,
                output_schema: dict[str, object] | None = None,
            ):
                self.turns.append(text)
                self.output_schemas.append(output_schema)
                raise sqlite3.OperationalError("database is locked")

        self.service.meeting_codex = LockedMeetingCodex()
        meeting_id = "meeting-20260601-121500-device-diarbench-two_intro_once"
        payload = self.post_json(
            "/api/meetings",
            {
                "meeting_id": meeting_id,
                "started_at": "2026-06-01T12:15:00Z",
                "stopped_at": "2026-06-01T12:15:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(b"RIFFmeeting-audio").decode("ascii"),
            },
        )
        self.assertEqual(payload["meeting"]["card_id"], "pucky_card_" + meeting_id)

        meeting = {}
        for _ in range(50):
            meetings = self.get_json("/api/meetings?include_archived=1", headers={"Authorization": "Bearer secret"})
            meeting = next((item for item in meetings.get("meetings", []) if item.get("meeting_id") == meeting_id), {})
            if meeting.get("state") == "failed":
                break
            time.sleep(0.1)

        self.assertEqual(meeting["state"], "failed")
        self.assertEqual(meeting["failure_reason"], "OperationalError: database is locked")
        self.assertEqual(meeting["failure_stage"], "meeting_agent_call")
        self.assertEqual(meeting["transcript_status"], "failed")
        self.assertEqual(meeting["diarization_status"], "failed")
        self.assertEqual(meeting["card_id"], "pucky_card_" + meeting_id)
        self.assertEqual(meeting["card"]["card_kind"], "meeting_failed")
        self.assertEqual(meeting["card"]["meeting_state"], "failed")
        self.assertEqual(meeting["card"]["failure_stage"], "meeting_agent_call")
        self.assertEqual(meeting["card"]["title"], "Meeting processing failed")
        self.assertIn("meeting_agent_call", meeting["card"]["summary"])
        self.assertIn("database is locked", meeting["card"]["summary"])

        persisted = self.service.feed.get_item("pucky_card_" + meeting_id)
        self.assertIsNotNone(persisted)
        self.assertEqual(persisted["origin"]["card_kind"], "meeting_failed")
        self.assertEqual(persisted["origin"]["meeting_state"], "failed")
        self.assertNotEqual(persisted["origin"]["card_kind"], "meeting_processing")
        feed = self.get_json("/api/feed?limit=50", headers={"Authorization": "Bearer secret"})
        self.assertEqual(
            sum(1 for item in feed.get("items", []) if item.get("card_id") == "pucky_card_" + meeting_id),
            1,
        )

    def test_failed_meetings_list_normalizes_stale_processing_card_metadata(self) -> None:
        meeting_id = "meeting-20260602-091500-device-diarbench-three-anon"
        stale_record = {
            "schema": "pucky.meeting_record.v1",
            "meeting_id": meeting_id,
            "state": "failed",
            "created_at": "2026-06-02T09:15:00Z",
            "updated_at": "2026-06-02T09:16:00Z",
            "started_at": "2026-06-02T09:15:00Z",
            "stopped_at": "2026-06-02T09:16:00Z",
            "duration_ms": 60000,
            "device_id": "device-1",
            "failure_reason": "OperationalError: database is locked",
            "failure_stage": "meeting_agent_call",
            "transcript_status": "failed",
            "diarization_status": "failed",
            "card_id": f"pucky_card_{meeting_id}",
            "card": {
                "title": "Processing meeting recording",
                "summary": "Transcribing, diarizing, and checking for follow-up instructions...",
                "icon": "mic",
                "card_kind": "meeting_processing",
                "meeting_state": "processing",
            },
            "feed_item": {
                "card_id": f"pucky_card_{meeting_id}",
                "card_kind": "meeting_processing",
                "meeting_state": "processing",
                "origin": {
                    "runtime": "pucky",
                    "thread_id": meeting_id,
                    "source": "meeting_recording",
                    "meeting_id": meeting_id,
                    "card_kind": "meeting_processing",
                    "meeting_state": "processing",
                },
            },
        }
        self.service._upsert_meeting(stale_record)

        payload = self.get_json("/api/meetings?compact=1&include_archived=1", headers={"Authorization": "Bearer secret"})
        meeting = next(item for item in payload["meetings"] if item["meeting_id"] == meeting_id)

        self.assertEqual(meeting["state"], "failed")
        self.assertEqual(meeting["card_id"], f"pucky_card_{meeting_id}")
        self.assertEqual(meeting["card"]["card_kind"], "meeting_failed")
        self.assertEqual(meeting["card"]["meeting_state"], "failed")
        self.assertEqual(meeting["card"]["title"], "Meeting processing failed")
        self.assertIn("meeting_agent_call", meeting["card"]["summary"])
        self.assertIn("database is locked", meeting["card"]["summary"])

    def test_feed_sync_reconciles_failed_meeting_placeholder_card(self) -> None:
        meeting_id = "meeting-20260602-091700-device-feed-reconcile"
        stale_record = {
            "schema": "pucky.meeting_record.v1",
            "meeting_id": meeting_id,
            "state": "failed",
            "created_at": "2026-06-02T09:17:00Z",
            "updated_at": "2026-06-02T09:17:30Z",
            "started_at": "2026-06-02T09:17:00Z",
            "stopped_at": "2026-06-02T09:17:30Z",
            "duration_ms": 30000,
            "device_id": "device-1",
            "failure_reason": "OperationalError: database is locked",
            "failure_stage": "meeting_agent_call",
            "transcript_status": "failed",
            "diarization_status": "failed",
            "card_id": f"pucky_card_{meeting_id}",
            "card": {
                "title": "Processing meeting recording",
                "summary": "Transcribing, diarizing, and checking for follow-up instructions...",
                "icon": "mic",
                "card_kind": "meeting_processing",
                "meeting_state": "processing",
            },
            "feed_item": {
                "card_id": f"pucky_card_{meeting_id}",
                "card_kind": "meeting_processing",
                "meeting_state": "processing",
                "origin": {
                    "runtime": "pucky",
                    "thread_id": meeting_id,
                    "source": "meeting_recording",
                    "meeting_id": meeting_id,
                    "card_kind": "meeting_processing",
                    "meeting_state": "processing",
                },
            },
        }
        self.service._upsert_meeting(stale_record)
        self.service.feed.upsert_turn_result(
            turn_id=meeting_id,
            session_id=meeting_id,
            reply_mode="card_only",
            reply_text="Transcribing, diarizing, and checking for follow-up instructions...",
            title="Processing meeting recording",
            summary="Transcribing, diarizing, and checking for follow-up instructions...",
            icon="mic",
            origin={
                "runtime": "pucky",
                "thread_id": meeting_id,
                "source": "meeting_recording",
                "meeting_id": meeting_id,
                "card_kind": "meeting_processing",
                "meeting_state": "processing",
            },
            telemetry={"event": "pucky.meeting.processing_placeholder"},
            transcript_messages=[],
            request_audio_mime_type="audio/mp4",
            request_audio_base64="",
            audio_mime_type="",
            audio_base64="",
            html_mime_type="",
            html_base64="",
        )

        feed = self.get_json("/api/feed?limit=50", headers={"Authorization": "Bearer secret"})
        item = next(item for item in feed["items"] if item["card_id"] == f"pucky_card_{meeting_id}")

        self.assertEqual(item["title"], "Meeting processing failed")
        self.assertEqual(item["card_kind"], "meeting_failed")
        self.assertEqual(item["meeting_state"], "failed")
        self.assertEqual(item["origin"]["card_kind"], "meeting_failed")
        self.assertEqual(item["origin"]["meeting_state"], "failed")
        self.assertEqual(item["origin"]["failure_stage"], "meeting_agent_call")
        self.assertIn("database is locked", item["summary"])

    def test_failed_meeting_detail_synthesizes_missing_failed_card_metadata(self) -> None:
        meeting_id = "meeting-20260602-092000-device-real-failure"
        stale_record = {
            "schema": "pucky.meeting_record.v1",
            "meeting_id": meeting_id,
            "state": "failed",
            "created_at": "2026-06-02T09:20:00Z",
            "updated_at": "2026-06-02T09:20:30Z",
            "started_at": "2026-06-02T09:20:00Z",
            "stopped_at": "2026-06-02T09:20:30Z",
            "duration_ms": 30000,
            "device_id": "device-1",
            "failure_reason": "Upload completed but meeting agent timed out",
            "failure_stage": "meeting_agent_timeout",
            "transcript_status": "failed",
            "diarization_status": "failed",
            "card": None,
            "feed_item": {
                "card_id": f"pucky_card_{meeting_id}",
                "origin": {
                    "runtime": "pucky",
                    "thread_id": meeting_id,
                    "source": "meeting_recording",
                    "meeting_id": meeting_id,
                },
            },
        }
        self.service._upsert_meeting(stale_record)

        detail = self.get_json(
            f"/api/meetings/{meeting_id}",
            headers={"Authorization": "Bearer secret"},
        )
        meeting = detail["meeting"]

        self.assertEqual(meeting["state"], "failed")
        self.assertEqual(meeting["card_kind"], "meeting_failed")
        self.assertEqual(meeting["meeting_state"], "failed")
        self.assertEqual(meeting["card_id"], f"pucky_card_{meeting_id}")
        self.assertEqual(meeting["card"]["card_kind"], "meeting_failed")
        self.assertEqual(meeting["card"]["meeting_state"], "failed")
        self.assertEqual(meeting["feed_item"]["card_kind"], "meeting_failed")
        self.assertEqual(meeting["feed_item"]["meeting_state"], "failed")
        self.assertEqual(meeting["feed_item"]["origin"]["card_kind"], "meeting_failed")
        self.assertEqual(meeting["feed_item"]["origin"]["meeting_state"], "failed")
        self.assertEqual(meeting["feed_item"]["origin"]["failure_stage"], "meeting_agent_timeout")
        self.assertNotEqual(meeting["card"]["title"], "Processing meeting recording")
        self.assertIn("timed out", meeting["card"]["summary"])

    def test_meeting_agent_retries_transient_sqlite_lock_and_completes(self) -> None:
        class RetryMeetingCodex(FakeCodex):
            def __init__(self) -> None:
                super().__init__()
                self.failures_remaining = 2

            def send_turn(
                self,
                text: str,
                *,
                thread_id: str | None = None,
                output_schema: dict[str, object] | None = None,
            ):
                if self.failures_remaining > 0:
                    self.failures_remaining -= 1
                    raise sqlite3.OperationalError("database is locked")
                return super().send_turn(text, thread_id=thread_id, output_schema=output_schema)

        self.service.meeting_codex = RetryMeetingCodex()
        meeting_id = "meeting-20260601-121600-device-retrycodex"
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": meeting_id,
                "started_at": "2026-06-01T12:16:00Z",
                "stopped_at": "2026-06-01T12:16:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting_retry.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(b"RIFFmeeting-audio").decode("ascii"),
            },
        )

        meeting = {}
        for _ in range(50):
            meetings = self.get_json("/api/meetings?include_archived=1", headers={"Authorization": "Bearer secret"})
            meeting = next((item for item in meetings.get("meetings", []) if item.get("meeting_id") == meeting_id), {})
            if meeting.get("state") == "completed":
                break
            time.sleep(0.1)

        self.assertEqual(meeting["state"], "completed")
        self.assertEqual(meeting["failure_stage"], "")
        self.assertEqual(self.service.meeting_codex.failures_remaining, 0)
        self.assertEqual(len(self.service.meeting_codex.turns), 1)

    def test_feed_persist_retries_transient_sqlite_lock_and_completes(self) -> None:
        original_upsert = self.service.feed.upsert_turn_result
        failures_remaining = {"count": 2}

        def flaky_upsert(*args, **kwargs):
            title = kwargs.get("title")
            if title != "Processing meeting recording" and failures_remaining["count"] > 0:
                failures_remaining["count"] -= 1
                raise sqlite3.OperationalError("database is locked")
            return original_upsert(*args, **kwargs)

        with patch.object(self.service.feed, "upsert_turn_result", side_effect=flaky_upsert):
            meeting_id = "meeting-20260601-121700-device-retrypersist"
            self.post_json(
                "/api/meetings",
                {
                    "meeting_id": meeting_id,
                    "started_at": "2026-06-01T12:17:00Z",
                    "stopped_at": "2026-06-01T12:17:05Z",
                    "duration_ms": 5000,
                    "device_id": "device-1",
                    "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting_retry_persist.m4a",
                    "mime_type": "audio/mp4",
                    "audio_base64": base64.b64encode(b"RIFFmeeting-audio").decode("ascii"),
                },
            )

            meeting = {}
            for _ in range(50):
                meetings = self.get_json("/api/meetings?include_archived=1", headers={"Authorization": "Bearer secret"})
                meeting = next((item for item in meetings.get("meetings", []) if item.get("meeting_id") == meeting_id), {})
                if meeting.get("state") == "completed":
                    break
                time.sleep(0.1)

        self.assertEqual(meeting["state"], "completed")
        self.assertEqual(failures_remaining["count"], 0)
        feed = self.get_json("/api/feed?limit=50", headers={"Authorization": "Bearer secret"})
        self.assertEqual(
            sum(1 for item in feed.get("items", []) if item.get("card_id") == "pucky_card_" + meeting_id),
            1,
        )

    def test_meeting_request_audio_attachment_uses_generic_title_for_seeded_benchmark(self) -> None:
        attachment = _meeting_request_audio_attachment(
            {
                "device_path": "/proof-fixtures/two_intro_once.wav",
            }
        )
        self.assertEqual(attachment["title"], "Meeting Audio")
        self.assertNotIn("path", attachment)

    def test_meeting_agent_transcript_text_fallback_completes_successfully(self) -> None:
        class TranscriptTextOnlyCodex(FakeCodex):
            def send_turn(
                self,
                text: str,
                *,
                thread_id: str | None = None,
                output_schema: dict[str, object] | None = None,
            ):
                self.turns.append(text)
                self.output_schemas.append(output_schema)
                return type(
                    "FakeTurnResult",
                    (),
                    {
                        "reply_text": json.dumps(
                            meeting_graph_reply(
                                reply_text="I processed the meeting.",
                                card_title="Meeting Summary",
                                recording_title="Transcript Text Fallback",
                                note_id="note-transcript-text-fallback",
                                note_title="Transcript Text Fallback",
                                note_summary="Transcript text fallback note.",
                                note_html="<h1>Transcript Text Fallback</h1><p>Transcript text fallback note.</p>",
                                transcript_text=(
                                    "[00:00-00:02] Jimmy: We should ship on Thursday.\n"
                                    "[00:02-00:04] Jack: I can own the deploy."
                                ),
                                attachments=[],
                            )
                        ),
                        "used_thread_id": "thread-transcript-text",
                        "requested_thread_id": "",
                        "thread_mode": "new",
                        "reused_existing_thread": False,
                        "fallback_reason": "",
                    },
                )()

        self.service.meeting_codex = TranscriptTextOnlyCodex()
        meeting_id = "meeting-20260601-120655-device-abc123ef"
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": meeting_id,
                "started_at": "2026-06-01T12:06:55Z",
                "stopped_at": "2026-06-01T12:07:00Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(b"RIFFmeeting-audio").decode("ascii"),
            },
        )
        meeting = {}
        for _ in range(50):
            rows = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"}).get("meetings", [])
            meeting = next((item for item in rows if item.get("meeting_id") == meeting_id), {})
            if meeting.get("state") == "completed":
                break
            time.sleep(0.1)
        self.assertEqual(meeting["state"], "completed")
        self.assertEqual(meeting["transcript_status"], "completed")
        self.assertEqual(meeting["diarization_status"], "speaker_turns")
        self.assertIn("[00:00-00:02] Jimmy: We should ship on Thursday.", meeting["transcript_text"])
        self.assertFalse(meeting.get("failure_reason"))
        self.assertNotIn("meeting_result", self.service.meeting_codex.output_schemas[-1]["properties"])

    def test_meeting_agent_missing_result_is_hard_failed(self) -> None:
        class MissingMeetingResultCodex(FakeCodex):
            def send_turn(
                self,
                text: str,
                *,
                thread_id: str | None = None,
                output_schema: dict[str, object] | None = None,
            ):
                self.turns.append(text)
                self.output_schemas.append(output_schema)
                return type(
                    "FakeTurnResult",
                    (),
                    {
                        "reply_text": json.dumps(
                            meeting_graph_reply(
                                reply_text="I processed the meeting.",
                                card_title="Meeting Summary",
                                recording_title="Missing Transcript Result",
                                note_id="note-missing-transcript-result",
                                note_title="Missing Transcript Result",
                                note_summary="Meeting output without transcript fallback.",
                                note_html="<h1>Missing Transcript Result</h1><p>Transcript missing.</p>",
                                attachments=[],
                            )
                        ),
                        "used_thread_id": "thread-missing-result",
                        "requested_thread_id": "",
                        "thread_mode": "new",
                        "reused_existing_thread": False,
                        "fallback_reason": "",
                    },
                )()

        self.service.meeting_codex = MissingMeetingResultCodex()
        meeting_id = "meeting-20260601-120700-device-abc123ef"
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": meeting_id,
                "started_at": "2026-06-01T12:07:00Z",
                "stopped_at": "2026-06-01T12:07:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(b"RIFFmeeting-audio").decode("ascii"),
            },
        )
        meeting = {}
        for _ in range(50):
            rows = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"}).get("meetings", [])
            meeting = next((item for item in rows if item.get("meeting_id") == meeting_id), {})
            if meeting.get("state") == "failed":
                break
            time.sleep(0.1)
        self.assertEqual(meeting["state"], "failed")
        self.assertEqual(meeting["transcript_status"], "failed")
        self.assertEqual(meeting["diarization_status"], "failed")
        self.assertEqual(meeting["failure_stage"], "meeting_transcript_validation")
        self.assertEqual(meeting["failure_reason"], "Meeting Transcript attachment missing or empty.")
        self.assertEqual(meeting["feed_item"]["card"]["title"], "Meeting processing failed")
        self.assertEqual(meeting["feed_item"]["card_kind"], "meeting_failed")
        self.assertEqual(meeting["feed_item"]["origin"]["card_kind"], "meeting_failed")
        self.assertEqual(meeting["feed_item"]["origin"]["failure_stage"], "meeting_transcript_validation")
        self.assertFalse(meeting["feed_item"]["read"])
        feed = self.get_json("/api/feed?limit=50", headers={"Authorization": "Bearer secret"})
        item = next(item for item in feed["items"] if item["card_id"] == f"pucky_card_{meeting_id}")
        self.assertEqual(item["card_kind"], "meeting_failed")
        self.assertEqual(item["meeting_state"], "failed")
        self.assertEqual(item["origin"]["card_kind"], "meeting_failed")
        self.assertEqual(item["origin"]["failure_stage"], "meeting_transcript_validation")
        self.assertNotEqual(item["title"], "Meeting needs review")
        self.assertNotIn("meeting_result", self.service.meeting_codex.output_schemas[-1]["properties"])

    def test_meeting_agent_timeout_is_hard_failed(self) -> None:
        blocking = BlockingCodex()
        self.service.meeting_codex = blocking
        meeting_id = "meeting-20260601-120706-device-timeoutproof"
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": meeting_id,
                "started_at": "2026-06-01T12:07:06Z",
                "stopped_at": "2026-06-01T12:07:11Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(b"RIFFmeeting-audio").decode("ascii"),
            },
        )
        self.assertTrue(blocking.codex_started.wait(timeout=2))
        meeting = {}
        for _ in range(90):
            rows = self.get_json("/api/meetings?include_archived=1", headers={"Authorization": "Bearer secret"}).get("meetings", [])
            meeting = next((item for item in rows if item.get("meeting_id") == meeting_id), {})
            if meeting.get("state") == "failed":
                break
            time.sleep(0.1)
        self.assertEqual(meeting["state"], "failed")
        self.assertEqual(meeting["failure_stage"], "meeting_agent_timeout")
        self.assertEqual(meeting["transcript_status"], "failed")
        self.assertEqual(meeting["diarization_status"], "failed")
        self.assertTrue(str(meeting["failure_reason"]).startswith("TimeoutError:"))
        self.assertEqual(meeting["feed_item"]["card_kind"], "meeting_failed")
        self.assertEqual(meeting["feed_item"]["origin"]["failure_stage"], "meeting_agent_timeout")
        feed = self.get_json("/api/feed?limit=50", headers={"Authorization": "Bearer secret"})
        item = next(item for item in feed["items"] if item["card_id"] == f"pucky_card_{meeting_id}")
        self.assertEqual(item["card_kind"], "meeting_failed")
        self.assertEqual(item["origin"]["failure_stage"], "meeting_agent_timeout")

    def test_meeting_attachment_builder_falls_back_to_tool_transcript_when_agent_omits_transcript_attachment(self) -> None:
        meeting_id = "meeting-20260601-120701-device-abc123ef"
        record = {
            "meeting_id": meeting_id,
            "title": "Meeting Summary",
            "recording_title": "Launch Readiness Recording",
            "audio_path": "C:\\fake\\meeting.wav",
            "mime_type": "audio/wav",
        }
        latest_record = {
            **record,
            "tool_transcript_text": "Hello from Jimmy. Hello from Jack.",
            "tool_transcript_attachment_text": "[00:00-00:02] Jimmy: Hello from Jimmy.\n[00:02-00:04] Jack: Hello from Jack.",
            "tool_speaker_turns": [
                {"speaker": "Jimmy", "text": "Hello from Jimmy.", "start": 0.0, "end": 2.0},
                {"speaker": "Jack", "text": "Hello from Jack.", "start": 2.0, "end": 4.0},
            ],
        }
        envelope = parse_reply_envelope(
            json.dumps(
                meeting_graph_reply(
                    reply_text="I processed the meeting.",
                    card_title="Meeting Summary",
                    recording_title="Launch Readiness Recording",
                    note_id="note-launch-readiness-recording",
                    note_title="Launch Readiness Recording",
                    note_summary="Meeting summary.",
                    note_html="<section><h1>Overview</h1><p>Meeting summary.</p></section>",
                    attachments=[],
                )
            )
        )
        with patch.object(self.service, "_meeting_record_by_id", return_value=latest_record):
            attachments, attachment_meta = self.service._prepare_meeting_reply_attachments(
                meeting_id=meeting_id,
                record=record,
                envelope=envelope,
            )
        titles = [str(item.get("title") or "") for item in attachments]
        self.assertIn("Transcript (Plain Text)", titles)
        self.assertIn("Meeting Audio", titles)
        transcript_attachment = next(item for item in attachments if item["title"] == "Transcript (Plain Text)")
        self.assertIn("Jimmy:", str(transcript_attachment.get("text") or ""))
        self.assertNotIn("summary_html_content", attachment_meta)

    def test_meetings_list_is_compact_by_default_and_detail_is_full(self) -> None:
        audio = b"RIFFmeeting-audio"
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": "meeting-20260601-121000-device-abc123ef",
                "started_at": "2026-06-01T12:10:00Z",
                "stopped_at": "2026-06-01T12:10:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(audio).decode("ascii"),
            },
        )

        meeting = {}
        for _ in range(50):
            payload = self.get_json("/api/meetings?compact=1", headers={"Authorization": "Bearer secret"})
            rows = payload.get("meetings", [])
            meeting = next(
                (item for item in rows if item.get("meeting_id") == "meeting-20260601-121000-device-abc123ef"),
                {},
            )
            if meeting.get("state") == "completed":
                break
            time.sleep(0.1)

        self.assertEqual(payload["schema"], "pucky.meetings.v1")
        self.assertTrue(payload["compact"])
        self.assertNotIn("transcript_result", meeting)
        self.assertNotIn("feed_item", meeting)
        self.assertNotIn("metadata", meeting)

        detail = self.get_json(
            "/api/meetings/meeting-20260601-121000-device-abc123ef",
            headers={"Authorization": "Bearer secret"},
        )
        self.assertEqual(detail["schema"], "pucky.meeting_detail.v1")
        self.assertEqual(detail["meeting"]["transcript_status"], "completed")
        self.assertIn("transcript_result", detail["meeting"])
        self.assertGreaterEqual(len(detail["meeting"]["speaker_turns"]), 2)

    def test_meeting_archive_hides_meeting_without_archiving_feed_card(self) -> None:
        audio = b"RIFFmeeting-audio"
        self.post_json(
            "/api/meetings",
            {
                "meeting_id": "meeting-20260601-122000-device-abc123ef",
                "started_at": "2026-06-01T12:20:00Z",
                "stopped_at": "2026-06-01T12:20:05Z",
                "duration_ms": 5000,
                "device_id": "device-1",
                "device_path": "/data/user/0/com.pucky.device.debug/files/voice/meeting.m4a",
                "mime_type": "audio/mp4",
                "audio_base64": base64.b64encode(audio).decode("ascii"),
            },
        )
        meeting = {}
        for _ in range(50):
            meetings = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"})
            rows = meetings.get("meetings", [])
            meeting = next(
                (item for item in rows if item.get("meeting_id") == "meeting-20260601-122000-device-abc123ef"),
                {},
            )
            if meeting.get("state") == "completed":
                break
            time.sleep(0.1)

        card_id = meeting["card_id"]
        archive = self.post_json(
            "/api/meetings/actions",
            {
                "client_action_id": "meeting_archive_once",
                "meeting_id": "meeting-20260601-122000-device-abc123ef",
                "action": "archive",
            },
        )
        self.assertTrue(archive["ok"])
        self.assertTrue(archive["meeting"]["archived"])

        default_list = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"})
        self.assertFalse(any(
            item["meeting_id"] == "meeting-20260601-122000-device-abc123ef"
            for item in default_list["meetings"]
        ))
        archived_list = self.get_json("/api/meetings?include_archived=1", headers={"Authorization": "Bearer secret"})
        archived = next(
            item for item in archived_list["meetings"]
            if item["meeting_id"] == "meeting-20260601-122000-device-abc123ef"
        )
        self.assertTrue(archived["archived"])

        feed_item = self.service.feed.get_item(card_id)
        self.assertIsNotNone(feed_item)
        self.assertFalse(feed_item["archived"])

    def test_meeting_archive_missing_meeting_fails_with_not_found(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post_json(
                "/api/meetings/actions",
                {
                    "client_action_id": "missing_meeting_archive",
                    "meeting_id": "meeting-20260601-missing-device-abc123ef",
                    "action": "archive",
                },
            )

        self.assertEqual(caught.exception.code, 404)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error"], "meeting_not_found")

    def test_meetings_compact_list_and_detail_allow_unauthenticated_browser_reads(self) -> None:
        payload = self.get_json("/api/meetings?compact=1")
        self.assertEqual(payload["schema"], "pucky.meetings.v1")
        self.assertTrue(payload["compact"])

        with self.assertRaises(urllib.error.HTTPError) as detail_caught:
            self.get_json("/api/meetings/missing-meeting")

        self.assertEqual(detail_caught.exception.code, 404)

    def test_meetings_compact_list_and_detail_accept_api_token(self) -> None:
        payload = self.get_json("/api/meetings?compact=1", headers={"Authorization": "Bearer secret"})
        self.assertEqual(payload["schema"], "pucky.meetings.v1")
        self.assertTrue(payload["compact"])

        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json(
                "/api/meetings/missing-meeting",
                headers={"Authorization": "Bearer secret"},
            )

        self.assertEqual(caught.exception.code, 404)

    def test_turn_status_requires_auth(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json("/api/turn/status?turn_id=missing")

        self.assertEqual(caught.exception.code, 401)

    def test_phone_role_status_requires_auth(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json("/api/device/phone-role-status")

        self.assertEqual(caught.exception.code, 401)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error_code"], "unauthorized")
        self.assertTrue(payload["read_only"])

    def test_phone_role_status_accepts_api_token(self) -> None:
        self.broker.set_device("phone-browser", True)
        with self.broker.LOCK:
            self.broker.DEVICES["phone-browser"] = {"socket": object()}

        def ws_send_side_effect(_socket, message):
            payload = json.loads(message)
            self.broker.update_command_from_device(
                {
                    "schema": "pucky.command_result.v1",
                    "id": payload["id"],
                    "type": payload["type"],
                    "status": "completed",
                    "result": {
                        "schema": "pucky.phone_role_status.v1",
                        "state": "held",
                        "role_held": True,
                        "eligible": True,
                        "default_dialer_package": "com.pucky.device.debug",
                        "default_dialer_label": "Pucky",
                    },
                }
            )
            return None

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), mock.patch.object(self.broker, "ws_send", side_effect=ws_send_side_effect):
            payload = self.get_json("/api/device/phone-role-status", headers={"Authorization": "Bearer secret"})

        self.assertEqual(payload["schema"], "pucky.phone_role_status.v1")

    def test_phone_role_status_uses_single_online_device_fallback(self) -> None:
        self.broker.set_device("phone-1", True)
        with self.broker.LOCK:
            self.broker.DEVICES["phone-1"] = {"socket": object()}

        def ws_send_side_effect(_socket, message):
            payload = json.loads(message)
            self.broker.update_command_from_device(
                {
                    "schema": "pucky.command_result.v1",
                    "id": payload["id"],
                    "type": payload["type"],
                    "status": "completed",
                    "result": {
                        "schema": "pucky.phone_role_status.v1",
                        "state": "held",
                        "role_held": True,
                        "eligible": True,
                        "default_dialer_package": "com.pucky.device.debug",
                        "default_dialer_label": "Pucky",
                    },
                }
            )
            return None

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), mock.patch.object(self.broker, "ws_send", side_effect=ws_send_side_effect):
            payload = self.get_json("/api/device/phone-role-status", headers={"Authorization": "Bearer secret"})

        self.assertEqual(payload["source"], "browser_live_api")
        self.assertEqual(payload["device_id"], "phone-1")
        self.assertTrue(payload["role_held"])
        self.assertEqual(payload["default_dialer_label"], "Pucky")
        self.assertTrue(payload["read_only"])

    def test_phone_role_status_honors_explicit_device_id(self) -> None:
        socket_one = object()
        socket_two = object()
        self.broker.set_device("phone-1", True)
        self.broker.set_device("phone-2", True)
        with self.broker.LOCK:
            self.broker.DEVICES["phone-1"] = {"socket": socket_one}
            self.broker.DEVICES["phone-2"] = {"socket": socket_two}

        def ws_send_side_effect(socket_value, message):
            payload = json.loads(message)
            label = "Desk Phone" if socket_value is socket_two else "Ignored Phone"
            self.broker.update_command_from_device(
                {
                    "schema": "pucky.command_result.v1",
                    "id": payload["id"],
                    "type": payload["type"],
                    "status": "completed",
                    "result": {
                        "schema": "pucky.phone_role_status.v1",
                        "state": "not_held",
                        "role_held": False,
                        "eligible": True,
                        "default_dialer_package": "com.google.android.dialer",
                        "default_dialer_label": label,
                    },
                }
            )
            return None

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), mock.patch.object(self.broker, "ws_send", side_effect=ws_send_side_effect):
            payload = self.get_json(
                "/api/device/phone-role-status?device_id=phone-2",
                headers={"Authorization": "Bearer secret"},
            )

        self.assertEqual(payload["device_id"], "phone-2")
        self.assertEqual(payload["default_dialer_label"], "Desk Phone")
        self.assertFalse(payload["role_held"])

    def test_phone_role_status_requires_unambiguous_device_context(self) -> None:
        self.broker.set_device("phone-1", True)
        self.broker.set_device("phone-2", True)
        with self.broker.LOCK:
            self.broker.DEVICES["phone-1"] = {"socket": object()}
            self.broker.DEVICES["phone-2"] = {"socket": object()}

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json("/api/device/phone-role-status", headers={"Authorization": "Bearer secret"})

        self.assertEqual(caught.exception.code, 409)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error_code"], "device_context_unavailable")

    def test_phone_role_status_reports_offline_device(self) -> None:
        self.broker.set_device("phone-1", False)

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json(
                "/api/device/phone-role-status?device_id=phone-1",
                headers={"Authorization": "Bearer secret"},
            )

        self.assertEqual(caught.exception.code, 503)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error_code"], "device_offline")
        self.assertEqual(payload["device_id"], "phone-1")

    def test_phone_role_status_surfaces_broker_command_failure(self) -> None:
        self.broker.set_device("phone-1", True)
        with self.broker.LOCK:
            self.broker.DEVICES["phone-1"] = {"socket": object()}

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), mock.patch.object(self.broker, "ws_send", return_value=None), self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json(
                "/api/device/phone-role-status?device_id=phone-1",
                headers={"Authorization": "Bearer secret"},
            )

        self.assertEqual(caught.exception.code, 502)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error_code"], "broker_command_failed")
        self.assertEqual(payload["device_id"], "phone-1")

    def test_broker_routes_share_the_same_server(self) -> None:
        health = self.get_json("/health")
        self.assertTrue(health["ok"])
        self.assertEqual(health["devices_online"], 0)

        devices = self.get_json("/v1/devices", headers={"Authorization": "Bearer test-operator-token"})
        self.assertEqual(devices["devices"], [])

        request = urllib.request.Request(
            self.base_url + "/v1/devices/pucky-test/commands",
            data=json.dumps({"type": "status.get", "args": {}}).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": "Bearer test-operator-token",
                "Content-Type": "application/json",
            },
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=10)
        self.assertEqual(caught.exception.code, 409)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error"], "DEVICE_OFFLINE")
        self.assertEqual(payload["command"]["status"], "device_offline")

    def test_turn_text_rejects_bad_content_length_without_waiting_for_body(self) -> None:
        for content_length in ("-1", "not-a-number"):
            response = self.raw_http(
                "\r\n".join(
                    [
                        "POST /api/turn/text HTTP/1.1",
                        f"Host: 127.0.0.1:{self.server.server_port}",
                        "Authorization: Bearer secret",
                        "Content-Type: application/json",
                        f"Content-Length: {content_length}",
                        "Connection: close",
                        "",
                        "",
                    ]
                ).encode("ascii")
            )
            self.assertIn(" 400 ", response.splitlines()[0])

    def test_turn_status_missing_turn_id_is_rejected(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json("/api/turn/status", headers={"Authorization": "Bearer secret"})

        self.assertEqual(caught.exception.code, 400)

    def test_turn_status_tracks_client_turn_id_and_codex_stage_without_transcripts(self) -> None:
        blocking = BlockingCodex()
        self.service.codex = blocking
        client_turn_id = "client_turn_status_1"
        result: dict[str, object] = {}
        error: dict[str, BaseException] = {}

        def post_turn() -> None:
            try:
                result["body"] = self.post_audio(b"audio", "audio/mp4", turn_id=client_turn_id)
            except BaseException as exc:
                error["exc"] = exc

        post_thread = threading.Thread(target=post_turn, daemon=True)
        post_thread.start()
        self.assertTrue(blocking.codex_started.wait(timeout=5))

        status = self.get_json(
            f"/api/turn/status?turn_id={client_turn_id}",
            headers={"Authorization": "Bearer secret"},
        )
        self.assertEqual(status["schema"], "pucky.turn_remote_status.v1")
        self.assertEqual(status["turn_id"], client_turn_id)
        self.assertEqual(status["stage"], "codex_running")
        self.assertEqual(status["status"], "running")
        self.assertTrue(status["codex_running"])
        self.assertEqual(status["transcript_chars"], len("Pucky test turn"))
        self.assertEqual(status["user_transcript"], "Pucky test turn")

        blocking.release_codex.set()
        post_thread.join(timeout=5)
        self.assertNotIn("exc", error)
        body = result["body"]
        self.assertIsInstance(body, dict)
        self.assertEqual(body["turn_id"], client_turn_id)
        self.assertEqual(body["session_id"], client_turn_id)

        completed = self.get_json(
            f"/api/turn/status?turn_id={client_turn_id}",
            headers={"Authorization": "Bearer secret"},
        )
        self.assertEqual(completed["stage"], "completed")
        self.assertEqual(completed["status"], "ok")
        self.assertTrue(completed["completed"])
        self.assertIn("total_ms", completed)
        self.assertIn("response_bytes", completed)

    def test_turn_status_hides_user_transcript_until_stt_completes(self) -> None:
        blocking_stt = BlockingSTT()
        self.service.stt = blocking_stt
        client_turn_id = "client_turn_status_2"
        result: dict[str, object] = {}
        error: dict[str, BaseException] = {}

        def post_turn() -> None:
            try:
                result["body"] = self.post_audio(b"audio", "audio/mp4", turn_id=client_turn_id)
            except BaseException as exc:
                error["exc"] = exc

        post_thread = threading.Thread(target=post_turn, daemon=True)
        post_thread.start()
        self.assertTrue(blocking_stt.stt_started.wait(timeout=5))

        status = self.get_json(
            f"/api/turn/status?turn_id={client_turn_id}",
            headers={"Authorization": "Bearer secret"},
        )
        self.assertEqual(status["stage"], "stt_running")
        self.assertEqual(status["status"], "running")
        self.assertTrue(status["stt_running"])
        self.assertNotIn("user_transcript", status)
        self.assertNotIn("Pucky test turn", json.dumps(status))

        blocking_stt.release_stt.set()
        post_thread.join(timeout=5)
        self.assertNotIn("exc", error)
        self.assertIsInstance(result["body"], dict)

    def test_turn_status_surfaces_root_failure_reason_and_failed_stage(self) -> None:
        class FailingCodex(FakeCodex):
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
                self.turns.append(text)
                self.output_schemas.append(output_schema)
                raise RuntimeError("Codex turn failed: refresh token revoked")

        self.service.codex = FailingCodex()

        with self.assertRaises(RuntimeError):
            self.service.handle_text_turn("Show the live failure", turn_id="client_turn_status_failed")

        status = self.service.turn_status("client_turn_status_failed")
        self.assertIsNotNone(status)
        self.assertEqual(status["stage"], "failed")
        self.assertEqual(status["status"], "failed")
        self.assertEqual(status["failed_stage"], "codex_turn")
        self.assertEqual(status["error_type"], "RuntimeError")
        self.assertEqual(status["error_message"], "Codex turn failed: refresh token revoked")
        self.assertEqual(status["failure_reason"], "Codex turn failed: refresh token revoked")

    def test_text_turn_reuses_existing_thread_and_falls_back_on_invalid_thread(self) -> None:
        scripted = ScriptedCodex(invalid_thread_ids={"thread-missing"})
        self.service.codex = scripted

        reused = self.post_json(
            "/api/turn/text",
            {"text": "Continue on this thread", "turn_id": "thread-reuse-1"},
            headers={
                "X-Pucky-Thread-Mode": "existing",
                "X-Pucky-Thread-Id": "thread-keep",
                "X-Pucky-Thread-Scope-Source": "thread_transcript",
                "X-Pucky-Thread-Card-Id": "card-keep",
            },
        )

        self.assertEqual(scripted.turn_requests[0]["requested_thread_id"], "thread-keep")
        self.assertEqual(reused["origin"]["thread_id"], "thread-keep")
        self.assertEqual(reused["telemetry"]["requested_thread_mode"], "existing")
        self.assertTrue(reused["telemetry"]["thread_reused"])
        self.assertEqual(reused["telemetry"]["thread_scope_source"], "thread_transcript")
        self.assertEqual(reused["telemetry"]["thread_scope_card_id"], "card-keep")

        fallback = self.post_json(
            "/api/turn/text",
            {"text": "Continue on missing thread", "turn_id": "thread-reuse-2"},
            headers={
                "X-Pucky-Thread-Mode": "existing",
                "X-Pucky-Thread-Id": "thread-missing",
                "X-Pucky-Thread-Scope-Source": "thread_page",
            },
        )

        self.assertEqual(scripted.turn_requests[1]["requested_thread_id"], "thread-missing")
        self.assertEqual(fallback["telemetry"]["requested_thread_id"], "thread-missing")
        self.assertEqual(fallback["telemetry"]["thread_mode"], "new")
        self.assertEqual(fallback["telemetry"]["thread_fallback_reason"], "thread_not_found")
        self.assertNotEqual(fallback["origin"]["thread_id"], "thread-missing")

    def test_text_turn_new_session_applies_requested_model_and_reasoning(self) -> None:
        body = self.post_json(
            "/api/turn/text",
            {
                "text": "Start a fresh planning thread",
                "turn_id": "model-default-1",
                "model": "gpt-5.4-mini",
                "reasoning_effort": "low",
            },
        )

        self.assertEqual(self.codex.turn_requests[-1]["requested_thread_id"], "")
        self.assertEqual(self.codex.turn_requests[-1]["model"], "gpt-5.4-mini")
        self.assertEqual(self.codex.turn_requests[-1]["reasoning_effort"], "low")
        self.assertEqual(body["origin"]["model"], "gpt-5.4-mini")
        self.assertEqual(body["origin"]["reasoning_effort"], "low")
        self.assertEqual(body["telemetry"]["requested_model"], "gpt-5.4-mini")
        self.assertEqual(body["telemetry"]["requested_reasoning_effort"], "low")
        self.assertEqual(body["telemetry"]["origin_reasoning_effort"], "low")

    def test_text_turn_existing_thread_preserves_thread_reasoning_and_ignores_new_session_model(self) -> None:
        self.codex.thread_defaults["thread-keep"] = {
            "model": "gpt-5.4",
            "reasoning_effort": "high",
        }

        body = self.post_json(
            "/api/turn/text",
            {
                "text": "Continue this conversation",
                "turn_id": "model-existing-1",
                "model": "gpt-5.4-mini",
                "reasoning_effort": "low",
            },
            headers={
                "X-Pucky-Thread-Mode": "existing",
                "X-Pucky-Thread-Id": "thread-keep",
            },
        )

        self.assertEqual(self.codex.turn_requests[-1]["requested_thread_id"], "thread-keep")
        self.assertEqual(self.codex.turn_requests[-1]["model"], "")
        self.assertEqual(self.codex.turn_requests[-1]["reasoning_effort"], "high")
        self.assertEqual(body["origin"]["thread_id"], "thread-keep")
        self.assertEqual(body["origin"]["model"], "gpt-5.4")
        self.assertEqual(body["origin"]["reasoning_effort"], "high")
        self.assertEqual(body["telemetry"]["origin_reasoning_effort"], "high")
    def test_text_turn_proof_reply_delay_is_guarded_and_telemetry_visible(self) -> None:
        delayed_service = PuckyVoiceService(
            make_config(proof_reply_delay_enabled=True),
            stt=self.stt,
            tts=self.tts,
            codex=self.codex,
            composio=self.composio,
        )
        delayed_server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(delayed_service))
        delayed_thread = threading.Thread(target=delayed_server.serve_forever, daemon=True)
        delayed_thread.start()
        delayed_base_url = f"http://127.0.0.1:{delayed_server.server_port}"
        try:
            sleep_calls: list[float] = []
            with patch("pucky_vm.server.time.sleep", side_effect=lambda seconds: sleep_calls.append(seconds)):
                body = self.post_json(
                    "/api/turn/text",
                    {"text": "delay this turn", "turn_id": "delay-proof-1"},
                    headers={"X-Pucky-Proof-Reply-Delay-Ms": "1500"},
                    base_url=delayed_base_url,
                )
            self.assertEqual(sleep_calls, [1.5])
            self.assertEqual(body["telemetry"]["proof_reply_delay_enabled"], True)
            self.assertEqual(body["telemetry"]["proof_reply_delay_ms_requested"], 1500)
            self.assertEqual(body["telemetry"]["proof_reply_delay_ms_applied"], 1500)

            body_disabled = self.post_json(
                "/api/turn/text",
                {"text": "delay ignored", "turn_id": "delay-proof-2"},
                headers={"X-Pucky-Proof-Reply-Delay-Ms": "1200"},
            )
            self.assertEqual(body_disabled["telemetry"]["proof_reply_delay_enabled"], False)
            self.assertEqual(body_disabled["telemetry"]["proof_reply_delay_ms_requested"], 1200)
            self.assertEqual(body_disabled["telemetry"]["proof_reply_delay_ms_applied"], 0)
            self.assertEqual(body_disabled["telemetry"]["proof_reply_delay_ignored"], "disabled")
        finally:
            delayed_server.shutdown()
            delayed_server.server_close()
            delayed_thread.join(timeout=5)
            delayed_service.feed.close()

    def test_text_turn_proof_reply_delay_is_guarded_and_telemetry_visible(self) -> None:
        delayed_service = PuckyVoiceService(
            make_config(proof_reply_delay_enabled=True),
            stt=self.stt,
            tts=self.tts,
            codex=self.codex,
            composio=self.composio,
        )
        delayed_server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(delayed_service))
        delayed_thread = threading.Thread(target=delayed_server.serve_forever, daemon=True)
        delayed_thread.start()
        delayed_base_url = f"http://127.0.0.1:{delayed_server.server_port}"
        try:
            sleep_calls: list[float] = []
            with patch("pucky_vm.server.time.sleep", side_effect=lambda seconds: sleep_calls.append(seconds)):
                body = self.post_json(
                    "/api/turn/text",
                    {"text": "delay this turn", "turn_id": "delay-proof-1"},
                    headers={"X-Pucky-Proof-Reply-Delay-Ms": "1500"},
                    base_url=delayed_base_url,
                )
            self.assertEqual(sleep_calls, [1.5])
            self.assertEqual(body["telemetry"]["proof_reply_delay_enabled"], True)
            self.assertEqual(body["telemetry"]["proof_reply_delay_ms_requested"], 1500)
            self.assertEqual(body["telemetry"]["proof_reply_delay_ms_applied"], 1500)

            body_disabled = self.post_json(
                "/api/turn/text",
                {"text": "delay ignored", "turn_id": "delay-proof-2"},
                headers={"X-Pucky-Proof-Reply-Delay-Ms": "1200"},
            )
            self.assertEqual(body_disabled["telemetry"]["proof_reply_delay_enabled"], False)
            self.assertEqual(body_disabled["telemetry"]["proof_reply_delay_ms_requested"], 1200)
            self.assertEqual(body_disabled["telemetry"]["proof_reply_delay_ms_applied"], 0)
            self.assertEqual(body_disabled["telemetry"]["proof_reply_delay_ignored"], "disabled")
        finally:
            delayed_server.shutdown()
            delayed_server.server_close()
            delayed_thread.join(timeout=5)
            delayed_service.feed.close()

    def test_audio_turn_keeps_user_transcript_audio_as_history_artifact(self) -> None:
        body = self.post_audio(b"RIFFdemo", "audio/wav", turn_id="audio-history-1")

        messages = body["transcript_messages"]
        self.assertEqual(messages[0]["role"], "user")
        self.assertEqual(messages[0]["text"], "Pucky test turn")
        self.assertEqual(messages[1]["role"], "assistant")
        self.assertNotIn("attachments", messages[0])

    def test_audio_turn_allows_debug_fixture_transcript_override_for_proof_lane(self) -> None:
        body = self.post_audio(
            b"RIFFdemo",
            "audio/wav",
            turn_id="audio-history-override",
            headers={"X-Pucky-Debug-Fixture-Transcript": "Should we change these goals?"},
        )

        self.assertEqual(body["transcript_messages"][0]["text"], "Should we change these goals?")
        self.assertTrue(body["telemetry"]["debug_fixture_transcript_used"])

    def test_feed_collapses_same_thread_to_latest_card_but_keeps_history(self) -> None:
        scripted = ScriptedCodex()
        self.service.codex = scripted

        first = self.post_json(
            "/api/turn/text",
            {"text": "First thread turn", "turn_id": "thread-collapse-1"},
            headers={"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": "thread-collapse"},
        )
        second = self.post_json(
            "/api/turn/text",
            {"text": "weather follow up", "turn_id": "thread-collapse-2"},
            headers={"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": "thread-collapse"},
        )

        self.assertEqual(first["origin"]["thread_id"], "thread-collapse")
        self.assertEqual(second["origin"]["thread_id"], "thread-collapse")
        feed = self.get_json("/api/feed?limit=10", headers={"Authorization": "Bearer secret"})
        self.assertEqual(feed["count"] if "count" in feed else len(feed["items"]), 1)
        item = feed["items"][0]
        self.assertEqual(item["origin"]["thread_id"], "thread-collapse")
        self.assertEqual(item["title"], "Weather Plan")
        self.assertEqual(item["icon"], "calendar")
        self.assertEqual(item["thread_history_count"], 2)
        self.assertEqual([message["role"] for message in item["transcript_messages"]], ["user", "assistant", "user", "assistant"])

    def test_final_boss_overlapping_turns_keep_thread_routes_and_feed_tiles_isolated(self) -> None:
        codex = OutOfOrderCodex()
        self.service.codex = codex
        results: dict[str, dict[str, object]] = {}
        errors: dict[str, BaseException] = {}

        def post_turn(name: str, text: str, headers: dict[str, str]) -> None:
            try:
                results[name] = self.post_json(
                    "/api/turn/text",
                    {"text": text, "turn_id": name},
                    headers=headers,
                )
            except BaseException as exc:
                errors[name] = exc

        turn_a = threading.Thread(
            target=post_turn,
            args=("turn-a", "alpha request", {"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": "thread-A"}),
            daemon=True,
        )
        turn_b = threading.Thread(
            target=post_turn,
            args=("turn-b", "fresh request", {}),
            daemon=True,
        )
        turn_c = threading.Thread(
            target=post_turn,
            args=("turn-c", "beta request", {"X-Pucky-Thread-Mode": "existing", "X-Pucky-Thread-Id": "thread-B"}),
            daemon=True,
        )
        turn_a.start()
        turn_b.start()
        turn_c.start()

        codex.release("turn-c")
        codex.release("turn-b")
        codex.release("turn-a")
        turn_a.join(timeout=5)
        turn_b.join(timeout=5)
        turn_c.join(timeout=5)

        self.assertEqual(errors, {})
        self.assertEqual(results["turn-a"]["origin"]["thread_id"], "thread-A")
        self.assertEqual(results["turn-c"]["origin"]["thread_id"], "thread-B")
        self.assertNotIn(results["turn-b"]["origin"]["thread_id"], {"thread-A", "thread-B"})

        feed = self.get_json("/api/feed?limit=10", headers={"Authorization": "Bearer secret"})
        thread_ids = [item["origin"].get("thread_id", "") for item in feed["items"]]
        self.assertIn("thread-A", thread_ids)
        self.assertIn("thread-B", thread_ids)
        self.assertEqual(len(feed["items"]), 3)
        summaries = {item["origin"].get("thread_id", item["card_id"]): item["summary"] for item in feed["items"]}
        self.assertEqual(summaries["thread-A"], "Reply for alpha request")
        self.assertEqual(summaries["thread-B"], "Reply for beta request")
        self.assertTrue(any(summary == "Reply for fresh request" for summary in summaries.values()))

    def test_due_reminder_sends_once_and_marks_sent(self) -> None:
        self.clear_active_reminders()
        reminder = self.service.workspace.upsert_record(
            "reminders",
            {
                "id": "due-reminder",
                "title": "Due reminder",
                "summary": "Reminder due now",
                "status": "open",
                "due_at_ms": self.service.workspace.now_ms() - 1_000,
            },
        )
        self.assertIsNotNone(reminder)

        self.broker.set_device("phone-1", True)
        with self.broker.LOCK:
            self.broker.DEVICES["phone-1"] = {"socket": object()}

        def ws_send_side_effect(_socket, message):
            payload = json.loads(message)
            self.broker.update_command_from_device(
                {
                    "schema": "pucky.command_result.v1",
                    "id": payload["id"],
                    "type": payload["type"],
                    "status": "completed",
                    "result": {
                        "shown": True,
                        "requested_surface_mode": "heads_up",
                        "effective_surface_mode": "heads_up",
                        "warnings": [],
                    },
                }
            )
            return None

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), mock.patch.object(self.broker, "ws_send", side_effect=ws_send_side_effect) as ws_send:
            first = self.service.process_due_reminders()
            second = self.service.process_due_reminders()

        self.assertEqual(first["count"], 1)
        self.assertEqual(second["count"], 0)
        ws_send.assert_called_once()
        updated = self.service.workspace.get_record("reminders", "due-reminder")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["metadata"]["delivery_state"], "sent")
        self.assertEqual(updated["metadata"]["notification_device_id"], "phone-1")
        self.assertEqual(updated["metadata"]["last_fired_due_at_ms"], updated["due_at_ms"])
        self.assertTrue(str(updated["metadata"]["last_notification_command_id"]).startswith("cmd_"))
        self.assertEqual(updated["metadata"]["last_delivery_mode_requested"], "heads_up")
        self.assertEqual(updated["metadata"]["last_delivery_mode_effective"], "heads_up")
        self.assertEqual(updated["metadata"]["last_delivery_degraded_to"], "")
        self.assertEqual(updated["metadata"]["last_delivery_warnings"], [])

    def test_reminder_email_validation_requires_self_email_target(self) -> None:
        self.service.config = replace(self.service.config, self_email="")
        self.service.workspace.patch_record(
            "contacts",
            "contact-me",
            {"metadata": {"email": "", "notification_device_id": "", "preferred_reminder_device_id": ""}},
        )
        metadata = {
            "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
            "destinations": [{"channel": "email", "recipient_ids": ["self"]}],
        }
        with self.assertRaisesRegex(ValueError, "reminder_email_target_missing:self"):
            self.service._validate_reminder_metadata(metadata)

    def test_reminder_sms_validation_requires_self_phone_target(self) -> None:
        self.service.config = replace(self.service.config, self_phone_number="")
        self.service.workspace.patch_record(
            "contacts",
            "contact-me",
            {"metadata": {"phone": "", "notification_device_id": "", "preferred_reminder_device_id": ""}},
        )
        metadata = {
            "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
            "destinations": [{"channel": "sms", "recipient_ids": ["self"]}],
        }
        with self.assertRaisesRegex(ValueError, "reminder_phone_target_missing:self"):
            self.service._validate_reminder_metadata(metadata)

    def test_reminder_email_validation_can_resolve_self_from_connected_gmail_profile(self) -> None:
        self.service.config = replace(self.service.config, self_email="")
        self.service.workspace.patch_record(
            "contacts",
            "contact-me",
            {"metadata": {"email": "", "notification_device_id": "", "preferred_reminder_device_id": ""}},
        )
        self.composio.tool_results["GMAIL_GET_PROFILE"] = {
            "data": {"emailAddress": "jimmy@gmail.example"}
        }
        metadata = {
            "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
            "destinations": [{"channel": "email", "recipient_ids": ["self"]}],
        }

        self.service._validate_reminder_metadata(metadata)
        me = self.service.workspace.get_record("contacts", "contact-me")
        self.assertIsNotNone(me)
        self.assertEqual((me.get("metadata") or {}).get("email"), "jimmy@gmail.example")
        self.assertNotIn("endpoints", me.get("metadata") or {})

    def test_reminder_email_validation_falls_back_to_gmail_send_as_profile(self) -> None:
        self.service.config = replace(self.service.config, self_email="")
        self.service.workspace.patch_record(
            "contacts",
            "contact-me",
            {"metadata": {"email": "", "notification_device_id": "", "preferred_reminder_device_id": ""}},
        )
        self.composio.tool_results["GMAIL_GET_PROFILE"] = {"data": {}}
        self.composio.tool_results["GMAIL_LIST_SEND_AS"] = {
            "data": {"sendAs": [{"sendAsEmail": "jimmy.alias@gmail.example"}]}
        }
        metadata = {
            "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
            "destinations": [{"channel": "email", "recipient_ids": ["self"]}],
        }

        self.service._validate_reminder_metadata(metadata)
        me = self.service.workspace.get_record("contacts", "contact-me")
        self.assertIsNotNone(me)
        self.assertEqual((me.get("metadata") or {}).get("email"), "jimmy.alias@gmail.example")
        self.assertNotIn("endpoints", me.get("metadata") or {})

    def test_self_contact_delivery_profile_resolves_self_targets_and_device(self) -> None:
        self.service.config = replace(self.service.config, self_email="", self_phone_number="")
        self.service.workspace.patch_record(
            "contacts",
            "contact-me",
            {
                "metadata": {
                    "email": "me@example.com",
                    "phone": "+14155550123",
                    "notification_device_id": "phone-1",
                }
            },
        )
        recipient = {"id": "self", "kind": "self", "label": "Me"}
        self.assertEqual(
            self.service._resolve_reminder_email_target(recipient, {"channel": "email", "recipient_ids": ["self"]}),
            "me@example.com",
        )
        self.assertEqual(
            self.service._resolve_reminder_phone_target(recipient, {"channel": "sms", "recipient_ids": ["self"]}),
            "+14155550123",
        )
        self.broker.set_device("phone-1", True)
        with self.broker.LOCK:
            self.broker.DEVICES["phone-1"] = {"socket": object()}
        reminder = self.service.workspace_upsert_record(
            "reminders",
            {"id": "self-device-reminder", "title": "Self device", "status": "open", "due_at_ms": self.service.workspace.now_ms() + 60_000},
        )
        self.assertIsNotNone(reminder)
        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker):
            device_id, error = self.service._reminder_target_device_id(reminder)
        self.assertEqual(device_id, "phone-1")
        self.assertEqual(error, "")

    def test_reminder_email_validation_requires_contact_email_target(self) -> None:
        contact = self.service.workspace.get_record("contacts", "sam-rivera")
        self.assertIsNotNone(contact)
        self.service.workspace.patch_record(
            "contacts",
            "sam-rivera",
            {"metadata": {**(contact.get("metadata") or {}), "email": ""}},
        )
        metadata = {
            "recipients": [{"id": "sam-rivera", "kind": "contact", "contact_id": "sam-rivera", "label": "Sam Rivera"}],
            "destinations": [{"channel": "email", "recipient_ids": ["sam-rivera"]}],
        }
        with self.assertRaisesRegex(ValueError, "reminder_email_target_missing:sam-rivera"):
            self.service._validate_reminder_metadata(metadata)

    def test_reminder_sms_validation_requires_contact_phone_target(self) -> None:
        contact = self.service.workspace.get_record("contacts", "sam-rivera")
        self.assertIsNotNone(contact)
        self.service.workspace.patch_record(
            "contacts",
            "sam-rivera",
            {"metadata": {**(contact.get("metadata") or {}), "phone": ""}},
        )
        metadata = {
            "recipients": [{"id": "sam-rivera", "kind": "contact", "contact_id": "sam-rivera", "label": "Sam Rivera"}],
            "destinations": [{"channel": "sms", "recipient_ids": ["sam-rivera"]}],
        }
        with self.assertRaisesRegex(ValueError, "reminder_phone_target_missing:sam-rivera"):
            self.service._validate_reminder_metadata(metadata)

    def test_reminder_email_validation_ignores_contact_endpoint_only_metadata(self) -> None:
        self.service.workspace.upsert_record(
            "contacts",
            {
                "id": "endpoint-only-email",
                "title": "Endpoint Only Email",
                "metadata": {"email": "", "endpoints": [{"label": "Email", "value": "endpoint-only@example.com"}]},
            },
        )
        contact = self.service.workspace.get_record("contacts", "endpoint-only-email")
        self.assertIsNotNone(contact)
        self.assertNotIn("endpoints", contact.get("metadata") or {})
        metadata = {
            "recipients": [{"id": "endpoint-only-email", "kind": "contact", "contact_id": "endpoint-only-email", "label": "Endpoint Only Email"}],
            "destinations": [{"channel": "email", "recipient_ids": ["endpoint-only-email"]}],
        }
        with self.assertRaisesRegex(ValueError, "reminder_email_target_missing:endpoint-only-email"):
            self.service._validate_reminder_metadata(metadata)

    def test_reminder_sms_validation_ignores_contact_endpoint_only_metadata(self) -> None:
        self.service.workspace.upsert_record(
            "contacts",
            {
                "id": "endpoint-only-phone",
                "title": "Endpoint Only Phone",
                "metadata": {"phone": "", "endpoints": [{"label": "Phone", "value": "+14155550123"}]},
            },
        )
        contact = self.service.workspace.get_record("contacts", "endpoint-only-phone")
        self.assertIsNotNone(contact)
        self.assertNotIn("endpoints", contact.get("metadata") or {})
        metadata = {
            "recipients": [{"id": "endpoint-only-phone", "kind": "contact", "contact_id": "endpoint-only-phone", "label": "Endpoint Only Phone"}],
            "destinations": [{"channel": "sms", "recipient_ids": ["endpoint-only-phone"]}],
        }
        with self.assertRaisesRegex(ValueError, "reminder_phone_target_missing:endpoint-only-phone"):
            self.service._validate_reminder_metadata(metadata)

    def test_due_reminder_custom_payload_records_effective_mode_and_downgrade(self) -> None:
        self.clear_active_reminders()
        self.service.workspace.upsert_record(
            "reminders",
            {
                "id": "custom-reminder",
                "title": "Custom reminder",
                "summary": "Escalate now",
                "status": "open",
                "due_at_ms": self.service.workspace.now_ms() - 1_000,
                "metadata": {
                    "notification_payload": {
                        "surface": {"mode": "full_screen"},
                        "full_screen_activity": "home",
                        "importance": "high",
                        "category": "reminder",
                        "default_sound": True,
                    }
                },
            },
        )
        self.broker.set_device("phone-1", True)
        with self.broker.LOCK:
            self.broker.DEVICES["phone-1"] = {"socket": object()}

        def ws_send_side_effect(_socket, message):
            payload = json.loads(message)
            self.broker.update_command_from_device(
                {
                    "schema": "pucky.command_result.v1",
                    "id": payload["id"],
                    "type": payload["type"],
                    "status": "completed",
                    "result": {
                        "shown": True,
                        "requested_surface_mode": "full_screen",
                        "effective_surface_mode": "heads_up",
                        "degraded_to": "heads_up",
                        "warnings": ["full_screen_permission_missing"],
                    },
                }
            )
            return None

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), mock.patch.object(self.broker, "ws_send", side_effect=ws_send_side_effect):
            result = self.service.process_due_reminders()

        self.assertEqual(result["count"], 1)
        updated = self.service.workspace.get_record("reminders", "custom-reminder")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["metadata"]["delivery_state"], "sent")
        self.assertEqual(updated["metadata"]["last_delivery_mode_requested"], "full_screen")
        self.assertEqual(updated["metadata"]["last_delivery_mode_effective"], "heads_up")
        self.assertEqual(updated["metadata"]["last_delivery_degraded_to"], "heads_up")
        self.assertEqual(updated["metadata"]["last_delivery_warnings"], ["full_screen_permission_missing"])

    def test_due_reminder_without_online_device_marks_failed(self) -> None:
        self.clear_active_reminders()
        self.service.workspace.upsert_record(
            "reminders",
            {
                "id": "failed-reminder",
                "title": "Failed reminder",
                "status": "open",
                "due_at_ms": self.service.workspace.now_ms() - 1_000,
            },
        )

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker):
            result = self.service.process_due_reminders()

        self.assertEqual(result["count"], 1)
        updated = self.service.workspace.get_record("reminders", "failed-reminder")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["metadata"]["delivery_state"], "failed")
        self.assertEqual(updated["metadata"]["last_delivery_error"], "no_online_device")
        self.assertEqual(updated["metadata"]["last_fired_due_at_ms"], 0)

    def test_due_reminder_prefers_specific_device_and_does_not_fallback(self) -> None:
        self.clear_active_reminders()
        self.service.workspace.upsert_record(
            "reminders",
            {
                "id": "preferred-reminder",
                "title": "Preferred reminder",
                "status": "open",
                "due_at_ms": self.service.workspace.now_ms() - 1_000,
                "metadata": {"notification_device_id": "offline-phone"},
            },
        )
        self.broker.set_device("other-phone", True)
        with self.broker.LOCK:
            self.broker.DEVICES["other-phone"] = {"socket": object()}

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), mock.patch.object(self.broker, "ws_send", return_value=None) as ws_send:
            result = self.service.process_due_reminders()

        self.assertEqual(result["count"], 1)
        ws_send.assert_not_called()
        updated = self.service.workspace.get_record("reminders", "preferred-reminder")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["metadata"]["delivery_state"], "failed")
        self.assertEqual(updated["metadata"]["last_delivery_error"], "preferred_device_offline")
        self.assertEqual(updated["metadata"]["notification_device_id"], "offline-phone")

    def test_failed_reminder_retries_and_multiple_due_reminders_fire_independently(self) -> None:
        self.clear_active_reminders()
        now_ms = self.service.workspace.now_ms()
        self.service.workspace.upsert_record(
            "reminders",
            {"id": "retry-a", "title": "Retry A", "status": "open", "due_at_ms": now_ms - 5_000},
        )
        self.service.workspace.upsert_record(
            "reminders",
            {"id": "retry-b", "title": "Retry B", "status": "open", "due_at_ms": now_ms - 4_000},
        )

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker):
            first = self.service.process_due_reminders()
        self.assertEqual(first["count"], 2)
        failed_a = self.service.workspace.get_record("reminders", "retry-a")
        failed_b = self.service.workspace.get_record("reminders", "retry-b")
        self.assertEqual(failed_a["metadata"]["delivery_state"], "failed")
        self.assertEqual(failed_b["metadata"]["delivery_state"], "failed")

        self.broker.set_device("phone-1", True)
        with self.broker.LOCK:
            self.broker.DEVICES["phone-1"] = {"socket": object()}

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), mock.patch.object(self.broker, "ws_send", return_value=None) as ws_send:
            second = self.service.process_due_reminders()

        self.assertEqual(second["count"], 2)
        self.assertEqual(ws_send.call_count, 2)
        sent_a = self.service.workspace.get_record("reminders", "retry-a")
        sent_b = self.service.workspace.get_record("reminders", "retry-b")
        self.assertEqual(sent_a["metadata"]["delivery_state"], "sent")
        self.assertEqual(sent_b["metadata"]["delivery_state"], "sent")
        self.assertEqual(sent_a["metadata"]["last_fired_due_at_ms"], sent_a["due_at_ms"])
        self.assertEqual(sent_b["metadata"]["last_fired_due_at_ms"], sent_b["due_at_ms"])

    def test_due_reminder_fans_out_to_phone_email_and_sms(self) -> None:
        self.clear_active_reminders()
        reminder = self.service.workspace_upsert_record(
            "reminders",
            {
                "id": "fanout-reminder",
                "title": "Fanout reminder",
                "summary": "Use all the adapters",
                "status": "open",
                "due_at_ms": self.service.workspace.now_ms() - 1_000,
                "metadata": {
                    "recipients": [
                        {"id": "self", "kind": "self", "label": "Me"},
                        {"id": "sam-rivera", "kind": "contact", "contact_id": "sam-rivera", "label": "Sam Rivera"},
                    ],
                    "destinations": [
                        {"channel": "phone_notification", "recipient_ids": ["self"]},
                        {"channel": "email", "recipient_ids": ["self"]},
                        {"channel": "sms", "recipient_ids": ["sam-rivera"]},
                    ],
                },
            },
        )
        self.assertIsNotNone(reminder)
        self.broker.set_device("phone-1", True)
        with self.broker.LOCK:
            self.broker.DEVICES["phone-1"] = {"socket": object()}

        def ws_send_side_effect(_socket, message):
            payload = json.loads(message)
            if payload.get("type") == "notify.show":
                self.broker.update_command_from_device(
                    {
                        "schema": "pucky.command_result.v1",
                        "id": payload["id"],
                        "type": payload["type"],
                        "status": "completed",
                        "result": {
                            "shown": True,
                            "requested_surface_mode": "heads_up",
                            "effective_surface_mode": "heads_up",
                            "warnings": [],
                        },
                    }
                )
            return None

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), mock.patch.object(self.broker, "ws_send", side_effect=ws_send_side_effect) as ws_send:
            result = self.service.process_due_reminders()

        self.assertEqual(result["count"], 1)
        self.assertEqual(ws_send.call_count, 2)
        updated = self.service.workspace.get_record("reminders", "fanout-reminder")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["metadata"]["delivery_state"], "sent")
        self.assertEqual(updated["metadata"]["last_fired_due_at_ms"], updated["due_at_ms"])
        channels = {row["channel"] for row in updated["metadata"]["last_delivery_results"]}
        self.assertEqual(channels, {"phone_notification", "email", "sms"})
        self.assertEqual(len(self.composio.proxy_calls), 1)
        email_call = self.composio.proxy_calls[0]
        self.assertEqual(email_call["endpoint"], "/gmail/v1/users/me/messages/send")
        self.assertIn("raw", email_call["body"])

    def test_due_reminder_email_falls_back_to_gmail_tool_execute(self) -> None:
        self.clear_active_reminders()
        self.service.workspace_upsert_record(
            "reminders",
            {
                "id": "email-fallback-reminder",
                "title": "Fallback email reminder",
                "summary": "Use Gmail tool fallback",
                "status": "open",
                "due_at_ms": self.service.workspace.now_ms() - 1_000,
                "metadata": {
                    "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
                    "destinations": [{"channel": "email", "recipient_ids": ["self"]}],
                },
            },
        )
        self.composio.tool_results["GMAIL_SEND_EMAIL"] = {"data": {"id": "gmail-message-1"}}

        with mock.patch.object(self.composio, "execute_proxy", side_effect=RuntimeError("proxy execute disabled")):
            result = self.service.process_due_reminders()

        self.assertEqual(result["count"], 1)
        updated = self.service.workspace.get_record("reminders", "email-fallback-reminder")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["metadata"]["delivery_state"], "sent")
        email_result = next(
            row for row in list(updated["metadata"]["last_delivery_results"] or [])
            if row["channel"] == "email"
        )
        self.assertTrue(email_result["ok"])
        self.assertEqual(len(self.composio.tool_calls), 1)
        self.assertEqual(self.composio.tool_calls[0]["tool_slug"], "GMAIL_SEND_EMAIL")

    def test_due_reminder_call_delivery_places_phone_call(self) -> None:
        self.clear_active_reminders()
        reminder = self.service.workspace_upsert_record(
            "reminders",
            {
                "id": "call-reminder",
                "title": "Call reminder",
                "summary": "Place the real call",
                "status": "open",
                "due_at_ms": self.service.workspace.now_ms() - 1_000,
                "metadata": {
                    "recipients": [
                        {"id": "sam-rivera", "kind": "contact", "contact_id": "sam-rivera", "label": "Sam Rivera"},
                    ],
                    "destinations": [
                        {"channel": "call", "recipient_ids": ["sam-rivera"]},
                    ],
                },
            },
        )
        self.assertIsNotNone(reminder)
        self.broker.set_device("phone-1", True)
        with self.broker.LOCK:
            self.broker.DEVICES["phone-1"] = {"socket": object()}

        def ws_send_side_effect(_socket, message):
            payload = json.loads(message)
            self.broker.update_command_from_device(
                {
                    "schema": "pucky.command_result.v1",
                    "id": payload["id"],
                    "type": payload["type"],
                    "status": "completed",
                    "result": {"ok": True},
                }
            )
            return None

        with mock.patch("pucky_vm.server.ensure_broker_initialized", return_value=self.broker), mock.patch.object(self.broker, "ws_send", side_effect=ws_send_side_effect) as ws_send:
            result = self.service.process_due_reminders()

        self.assertEqual(result["count"], 1)
        ws_send.assert_called_once()
        updated = self.service.workspace.get_record("reminders", "call-reminder")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["metadata"]["delivery_state"], "sent")
        self.assertEqual(len(updated["metadata"]["last_delivery_results"]), 1)
        self.assertEqual(updated["metadata"]["last_delivery_results"][0]["channel"], "call")
        self.assertEqual(updated["metadata"]["last_delivery_results"][0]["target"], "+1 (415) 555-0168")

    def test_due_reminder_connected_app_delivery_uses_proxy_template(self) -> None:
        self.clear_active_reminders()
        self.composio.connected.append(
            {
                "slug": "slack",
                "name": "Slack",
                "logo": "https://logos.example.invalid/slack.png",
                "status": "active",
                "id": "ca_slack_active",
                "instance_name": "Workspace Slack",
            }
        )
        reminder = self.service.workspace_upsert_record(
            "reminders",
            {
                "id": "connected-reminder",
                "title": "Connected reminder",
                "summary": "Ping Slack too",
                "status": "open",
                "due_at_ms": self.service.workspace.now_ms() - 1_000,
                "metadata": {
                    "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
                    "destinations": [
                        {
                            "channel": "connected_app",
                            "recipient_ids": ["self"],
                            "app_slug": "slack",
                            "endpoint": "/chat.postMessage",
                            "parameters": {"text": "{{title}} for {{recipient_name}}"},
                        }
                    ],
                },
            },
        )
        self.assertIsNotNone(reminder)

        result = self.service.process_due_reminders()

        self.assertEqual(result["count"], 1)
        updated = self.service.workspace.get_record("reminders", "connected-reminder")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["metadata"]["delivery_state"], "sent")
        self.assertEqual(len(updated["metadata"]["last_delivery_results"]), 1)
        self.assertEqual(updated["metadata"]["last_delivery_results"][0]["channel"], "connected_app")
        self.assertEqual(self.composio.proxy_calls[-1]["endpoint"], "/chat.postMessage")
        self.assertEqual(self.composio.proxy_calls[-1]["body"]["text"], "Connected reminder for Me")

    def test_empty_audio_is_rejected(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post_audio(b"", "audio/mp4")
        self.assertEqual(caught.exception.code, 400)

    def test_reply_envelope_falls_back_on_malformed_json(self) -> None:
        envelope = parse_reply_envelope("Plain answer text.")

        self.assertEqual(envelope.reply_text, "Plain answer text.")
        self.assertEqual(envelope.card_title, "Plain answer text.")
        self.assertEqual(envelope.card_icon, "mail")

    def test_reply_output_schema_requires_nullable_attachment_fields(self) -> None:
        schema = reply_output_schema()
        attachments = schema["properties"]["attachments"]
        self.assertIn("recording_title", schema["properties"])
        self.assertIn("recording_title", schema["required"])
        self.assertEqual(schema["properties"]["recording_title"]["type"], ["string", "null"])
        self.assertEqual(attachments["type"], ["array", "null"])
        self.assertIn("attachments", schema["required"])
        self.assertNotIn("meeting_result", schema["properties"])
        self.assertIn("graph_records", schema["properties"])
        self.assertIn("graph_links", schema["properties"])
        self.assertIn("connected_records", schema["properties"])
        self.assertIn("graph_records", schema["required"])
        self.assertIn("graph_links", schema["required"])
        self.assertIn("connected_records", schema["required"])
        item_schema = attachments["items"]
        self.assertEqual(
            item_schema["required"],
            ["path", "mime_type", "title", "kind", "viewer_path", "preview_path", "text"],
        )
        for key in item_schema["required"]:
            self.assertEqual(item_schema["properties"][key]["type"], ["string", "null"])

    def test_meeting_reply_output_schema_requires_transcript_text(self) -> None:
        schema = meeting_reply_output_schema()

        self.assertIn("transcript_text", schema["properties"])
        self.assertIn("transcript_text", schema["required"])
        self.assertNotIn("meeting_result", schema["required"])
        self.assertNotIn("meeting_result", schema["properties"])

    def test_reply_envelope_accepts_safe_icon_slug(self) -> None:
        envelope = parse_reply_envelope(
            json.dumps(
                {
                    "reply_text": "Text",
                    "card_title": "Title",
                    "recording_title": "Recording Title",
                    "card_icon": "sparkles",
                    "html": None,
                }
            )
        )

        self.assertEqual(envelope.reply_text, "Text")
        self.assertEqual(envelope.recording_title, "Recording Title")
        self.assertEqual(envelope.card_icon, "sparkles")
        self.assertEqual(envelope.transcript_text, "")
        self.assertEqual(envelope.graph_records, ())
        self.assertEqual(envelope.graph_links, ())
        self.assertEqual(envelope.connected_records, ())
        self.assertFalse(envelope.legacy_html_requested)

    def test_large_html_is_omitted(self) -> None:
        self.service.config = make_config(max_html_bytes=4)

        body = self.post_audio(b"audio", "audio/mp4")

        self.assertNotIn("html_base64", body["card"])
        self.assertNotIn("html_mime_type", body["card"])
        self.assertNotIn("html_base64", body)
        self.assertNotIn("html_mime_type", body)

    def test_reply_envelope_parses_structured_attachments(self) -> None:
        envelope = parse_reply_envelope(
            json.dumps(
                {
                    "reply_text": "Done",
                    "card_title": "Files",
                    "card_icon": "sparkles",
                    "html": None,
                    "attachments": [
                        {
                            "path": "/data/home/codex/report.csv",
                            "mime_type": "text/csv",
                            "title": "Report CSV",
                        }
                    ],
                }
            )
        )

        self.assertEqual(envelope.card_icon, "sparkles")
        self.assertEqual(len(envelope.attachments), 1)
        self.assertEqual(envelope.attachments[0]["path"], "/data/home/codex/report.csv")

    def test_text_turn_returns_transcript_attachments_and_artifact_downloads(self) -> None:
        csv_path = Path(self.tmp.name) / "report.csv"
        csv_path.write_text("name,value\nA,1\nB,2\n", encoding="utf-8")
        viewer_path = Path(self.tmp.name) / "brief-viewer.html"
        viewer_path.write_text("<!doctype html><title>Brief</title><p>Viewer</p>", encoding="utf-8")
        pdf_path = Path(self.tmp.name) / "brief.pdf"
        pdf_path.write_bytes(b"%PDF-1.4 demo")
        object.__setattr__(self.service.config, "codex_cwd", self.tmp.name)

        def reply(_text: str) -> str:
            return json.dumps(
                {
                    "reply_text": "Done. I created the files you asked for.",
                    "card_title": "Quarterly Summary",
                    "card_icon": "sunny",
                    "html": None,
                    "attachments": [
                        {
                            "path": str(csv_path),
                            "mime_type": "text/csv",
                            "title": "Report CSV",
                        },
                        {
                            "path": str(pdf_path),
                            "mime_type": "application/pdf",
                            "title": "Brief PDF",
                            "viewer_path": str(viewer_path),
                        },
                    ],
                }
            )

        self.codex.send_turn = reply  # type: ignore[assignment]

        body = self.post_json("/api/turn/text", {"text": "Create a CSV and a PDF viewer.", "turn_id": "text-turn-files"})

        self.assertEqual(body["card_id"], "pucky_card_text-turn-files")
        self.assertEqual(body["icon"], "sunny")
        messages = body["transcript_messages"]
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["role"], "user")
        self.assertEqual(messages[1]["role"], "assistant")
        attachments = messages[1]["attachments"]
        self.assertEqual(attachments[0]["viewer"]["type"], "table")
        self.assertEqual(attachments[1]["viewer"]["type"], "document_html")
        artifact_id = attachments[0]["artifact"]
        request = urllib.request.Request(
            self.base_url + "/api/artifacts/" + urllib.parse.quote(artifact_id, safe=""),
            headers={"Authorization": "Bearer secret"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            self.assertEqual(response.headers.get_content_type(), "text/csv")
            self.assertIn("name,value", response.read().decode("utf-8"))
        feed = self.get_json("/api/feed?limit=10", headers={"Authorization": "Bearer secret"})
        self.assertEqual(feed["items"][0]["transcript_messages"][1]["attachments"][0]["artifact"], artifact_id)

    def test_reply_text_path_fallback_promotes_displayable_file(self) -> None:
        html_path = Path(self.tmp.name) / "fallback.html"
        html_path.write_text("<!doctype html><title>Fallback</title><p>Hello</p>", encoding="utf-8")
        object.__setattr__(self.service.config, "codex_cwd", self.tmp.name)
        self.codex.send_turn = lambda _text: json.dumps(  # type: ignore[assignment]
            {
                "reply_text": f"Created {html_path}",
                "card_title": "Fallback Page",
                "card_icon": "bolt",
                "html": None,
            }
        )

        body = self.post_json("/api/turn/text", {"text": "Create an HTML page.", "turn_id": "text-turn-fallback"})

        attachments = body["transcript_messages"][1]["attachments"]
        self.assertEqual(len(attachments), 1)
        self.assertEqual(attachments[0]["kind"], "html")
        self.assertTrue(body["telemetry"]["attachment_fallback_from_reply_text"])

    def test_text_turn_caps_attachment_count_and_skips_outside_paths(self) -> None:
        first = Path(self.tmp.name) / "first.html"
        first.write_text("<!doctype html><title>First</title>", encoding="utf-8")
        second = Path(self.tmp.name) / "second.csv"
        second.write_text("name,value\nA,1\n", encoding="utf-8")
        third = Path(self.tmp.name) / "third.txt"
        third.write_text("hello", encoding="utf-8")
        with tempfile.TemporaryDirectory() as outside_tmp:
            outside = Path(outside_tmp) / "outside.html"
            outside.write_text("<!doctype html><title>Outside</title>", encoding="utf-8")
            object.__setattr__(self.service.config, "codex_cwd", self.tmp.name)
            object.__setattr__(self.service.config, "max_attachment_count", 2)
            self.codex.send_turn = lambda _text: json.dumps(  # type: ignore[assignment]
                {
                    "reply_text": "Done",
                    "card_title": "Many Files",
                    "card_icon": "bolt",
                    "html": None,
                    "attachments": [
                        {"path": str(outside), "mime_type": "text/html", "title": "Outside"},
                        {"path": str(first), "mime_type": "text/html", "title": "First"},
                        {"path": str(second), "mime_type": "text/csv", "title": "Second"},
                        {"path": str(third), "mime_type": "text/plain", "title": "Third"},
                    ],
                }
            )

            body = self.post_json("/api/turn/text", {"text": "Create many files.", "turn_id": "text-turn-cap"})

        attachments = body["transcript_messages"][1]["attachments"]
        self.assertEqual([item["title"] for item in attachments], ["First", "Second"])
        self.assertEqual(len(attachments), 2)
        self.assertEqual(body["telemetry"]["attachment_count"], 2)

    def test_text_turn_marks_zip_attachment_as_download_only(self) -> None:
        zip_path = Path(self.tmp.name) / "bundle.zip"
        zip_path.write_bytes(b"PK\x03\x04demo")
        object.__setattr__(self.service.config, "codex_cwd", self.tmp.name)
        self.codex.send_turn = lambda _text: json.dumps(  # type: ignore[assignment]
            {
                "reply_text": "Created a ZIP archive.",
                "card_title": "Archive",
                "card_icon": "mail",
                "html": None,
                "attachments": [
                    {
                        "path": str(zip_path),
                        "mime_type": "application/zip",
                        "title": "Bundle ZIP",
                    }
                ],
            }
        )

        body = self.post_json("/api/turn/text", {"text": "Create a zip archive.", "turn_id": "text-turn-zip"})

        attachment = body["transcript_messages"][1]["attachments"][0]
        self.assertEqual(attachment["kind"], "archive")
        self.assertEqual(attachment["viewer"]["type"], "download_only")

    def test_card_icons_endpoint_lists_defaults_and_persists_runtime_icons(self) -> None:
        before = self.get_json("/api/card-icons")
        self.assertTrue(any(item["name"] == "mail" for item in before["icons"]))

        result = self.post_json(
            "/api/card-icons",
            {
                "name": "sunny",
                "label": "Sunny",
                "filled_svg": '<path d="M12 5V2"/>',
                "outline_svg": '<circle cx="12" cy="12" r="4"/>',
            },
        )
        self.assertTrue(result["ok"])
        after = self.get_json("/api/card-icons")
        self.assertTrue(any(item["name"] == "sunny" for item in after["icons"]))

    def get_json(self, path: str, headers: dict[str, str] | None = None) -> dict:
        request = urllib.request.Request(self.base_url + path, headers=headers or {})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def get_json_response(self, path: str, headers: dict[str, str] | None = None) -> tuple[dict, dict[str, str]]:
        request = urllib.request.Request(self.base_url + path, headers=headers or {})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8")), dict(response.headers.items())

    def get_text(self, path: str, headers: dict[str, str] | None = None) -> str:
        request = urllib.request.Request(self.base_url + path, headers=headers or {})
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.read().decode("utf-8")

    def raw_http(self, request: bytes) -> str:
        with socket.create_connection(("127.0.0.1", self.server.server_port), timeout=2) as sock:
            sock.settimeout(2)
            sock.sendall(request)
            try:
                return sock.recv(4096).decode("utf-8", errors="replace")
            except socket.timeout as exc:
                self.fail(f"server did not answer before reading the declared body: {exc}")

    def read_raw_http_response(self, sock: socket.socket) -> tuple[str, dict[str, str], bytes]:
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
        header_bytes, _, body = data.partition(b"\r\n\r\n")
        header_text = header_bytes.decode("iso-8859-1", errors="replace")
        lines = header_text.splitlines()
        status_line = lines[0] if lines else ""
        headers: dict[str, str] = {}
        for line in lines[1:]:
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.strip().lower()] = value.strip()
        content_length = int(headers.get("content-length") or "0")
        while len(body) < content_length:
            chunk = sock.recv(content_length - len(body))
            if not chunk:
                break
            body += chunk
        return status_line, headers, body[:content_length]

    def post_audio(
        self,
        audio: bytes,
        content_type: str,
        turn_id: str = "",
        reply_mode: str = "",
        headers: dict[str, str] | None = None,
    ) -> dict:
        request_headers = {
            "Authorization": "Bearer secret",
            "Content-Type": content_type,
        }
        if turn_id:
            request_headers["X-Pucky-Turn-Id"] = turn_id
        if reply_mode:
            request_headers["X-Pucky-Reply-Mode"] = reply_mode
        if headers is not None:
            request_headers.update(headers)
        request = urllib.request.Request(
            self.base_url + "/api/turn",
            data=audio,
            method="POST",
            headers=request_headers,
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def post_json(
        self,
        path: str,
        body: dict,
        headers: dict[str, str] | None = None,
        *,
        base_url: str | None = None,
    ) -> dict:
        merged = {
            "Authorization": "Bearer secret",
            "Content-Type": "application/json",
        }
        if headers:
            merged.update(headers)
        request = urllib.request.Request(
            (base_url or self.base_url) + path,
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers=merged,
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def post_empty(self, path: str, headers: dict[str, str] | None = None) -> dict:
        request = urllib.request.Request(
            self.base_url + path,
            data=b"",
            method="POST",
            headers=headers or {},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def portal_token(self, portal_url: str) -> str:
        parsed = urllib.parse.urlsplit(portal_url)
        return urllib.parse.parse_qs(parsed.query).get("token", [""])[0]

    def issue_portal_token(self) -> str:
        payload = self.get_json("/api/links/composio/portal-url", headers={"Authorization": "Bearer secret"})
        return self.portal_token(payload["portal_url"])


if __name__ == "__main__":
    unittest.main()
