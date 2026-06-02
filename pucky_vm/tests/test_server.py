from __future__ import annotations

import base64
import json
import socket
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

from pucky_vm.server import (
    Config,
    PuckyVoiceService,
    make_handler,
    meeting_reply_output_schema,
    parse_reply_envelope,
    reply_output_schema,
    reset_broker_for_tests,
)


class FakeSTT:
    def __init__(self) -> None:
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
        return {
            "schema": "pucky.deepgram_transcript.v1",
            "provider": "deepgram",
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


class FakeCodex:
    ready = True
    thread_id = "thread-1"

    def __init__(self) -> None:
        self.turns: list[str] = []
        self.turn_requests: list[dict[str, str]] = []
        self.output_schemas: list[dict[str, object] | None] = []
        self.renamed_titles: list[str] = []
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
        output_schema: dict[str, object] | None = None,
    ):
        self.turns.append(text)
        self.output_schemas.append(output_schema)
        requested_thread_id = str(thread_id or "").strip()
        used_thread_id = requested_thread_id or self.thread_id
        self.thread_id = used_thread_id
        self.turn_requests.append(
            {
                "text": text,
                "requested_thread_id": requested_thread_id,
                "used_thread_id": used_thread_id,
            }
        )
        self.last_turn_routing = {
            "requested_thread_id": requested_thread_id,
            "used_thread_id": used_thread_id,
            "thread_mode": "existing" if requested_thread_id else "new",
            "reused_existing_thread": bool(requested_thread_id),
            "fallback_reason": "",
        }
        if "Meeting Recording Agent Handoff" in text:
            reply = {
                "reply_text": "Meeting processed. I found follow-up notes and one explicit Pucky instruction.",
                "card_title": "Jimmy and Jack Follow-ups",
                "card_icon": "mic",
                "html": {
                    "title": "Meeting Summary",
                    "content": "<!doctype html><title>Meeting Summary</title><p>Follow-up notes prepared.</p>",
                },
                "attachments": [],
                "meeting_result": {
                    "title": "Jimmy and Jack Follow-ups",
                    "transcript_status": "completed",
                    "transcript_text": "I'm Jimmy and this is Jack. Pucky, after this meeting, email the transcript to jimmy@example.com.",
                    "diarization_requested": True,
                    "diarization_status": "speaker_turns",
                    "speaker_turns": [
                        {"speaker": "Jimmy", "text": "I'm Jimmy and this is Jack.", "start": 0.1, "end": 2.2},
                        {"speaker": "Jack", "text": "Pucky, after this meeting, email the transcript to jimmy@example.com.", "start": 2.4, "end": 5.1},
                    ],
                    "speaker_labels": {"speaker_0": "Jimmy", "speaker_1": "Jack"},
                    "participants": ["Jimmy", "Jack"],
                    "action_items": ["Prepare follow-up notes."],
                    "pucky_directed_instructions": ["Email the transcript to jimmy@example.com."],
                    "executed_actions": [
                        {
                            "tool": "email",
                            "status": "completed",
                            "recipient": "jimmy@example.com",
                            "description": "Sent meeting transcript.",
                        }
                    ],
                    "action_errors": [],
                    "transcription_provider": "deepgram",
                },
            }
            reply_text = json.dumps(reply)
        else:
            reply_text = json.dumps(
                {
                    "reply_text": "Sure, I can help.",
                    "card_title": "Quick Help",
                    "card_icon": "bolt",
                    "html": {
                        "title": "Mini Page",
                        "content": "<!doctype html><title>Mini Page</title><p>Hello</p>",
                    },
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
        return {
            "runtime": "codex",
            "thread_id": resolved_thread_id,
            "thread_title": self.renamed_titles[-1] if self.renamed_titles else "thread-1",
            "rollout_path": f"/data/home/codex/sessions/{resolved_thread_id}.jsonl",
            "source": "vscode",
            "model": "gpt-5.5",
            "model_provider": "openai",
            "reasoning_effort": "high",
            "sandbox_policy": "danger-full-access",
            "approval_mode": "never",
        }


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
        feed_db_path=str(tempfile.gettempdir()) + f"/pucky-feed-tests-{uuid.uuid4().hex}.sqlite3",
        codex_sandbox="danger-full-access",
        codex_approval_policy="never",
        codex_model="gpt-5.5",
        codex_reasoning_effort="high",
        composio_api_key="composio-test-key",
        composio_base_url="https://backend.composio.dev/api/v3",
        composio_default_user_id="jimmythompson323",
        connect_portal_secret="portal-secret",
        connect_portal_ttl_seconds=3600,
        composio_default_auth_mode="browser",
        proof_reply_delay_enabled=proof_reply_delay_enabled,
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
        self.composio = FakeComposio()
        self.service = PuckyVoiceService(make_config(), stt=self.stt, tts=self.tts, codex=self.codex, composio=self.composio)
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

    def test_healthz_reports_ready_without_secrets(self) -> None:
        payload = self.get_json("/healthz")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["codex_app_server"], "ready")
        self.assertEqual(payload["thread"], "per_turn")
        self.assertEqual(payload["feed_store"], "ready")
        self.assertEqual(payload["feed_items_count"], 0)
        self.assertEqual(payload["deepgram_key"], "present")
        self.assertNotIn("secret", json.dumps(payload))

    def test_config_defaults_codex_model_to_spark_low(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True):
            config = Config.from_env()

        self.assertEqual(config.codex_model, "gpt-5.3-codex-spark")
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

        fixture = self.get_json("/ui/pucky/fixtures/reply_cards.json")
        self.assertEqual(fixture["schema"], "pucky.reply_cards.v1")
        self.assertGreaterEqual(fixture["count"], 4)
        self.assertNotIn("artifact_base_path", fixture)
        self.assertIn("audio_path", fixture["cards"][0])

        with urllib.request.urlopen(self.base_url + "/ui/pucky/latest/pucky-config.js", timeout=10) as response:
            config_script = response.read().decode("utf-8")
            self.assertIn("window.PUCKY_BUNDLE_CONFIG", config_script)
            self.assertNotIn('"links_url"', config_script)

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
        self.assertEqual(body["card"]["html_mime_type"], "text/html")
        self.assertEqual(body["html_mime_type"], "text/html")
        self.assertIn("<!doctype html>", base64.b64decode(body["card"]["html_base64"]).decode("utf-8"))
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

        compact = self.get_json("/api/feed?limit=10&compact=1", headers={"Authorization": "Bearer secret"})
        self.assertNotIn("audio_base64", compact["items"][0])
        self.assertNotIn("html_base64", compact["items"][0])
        self.assertEqual(compact["items"][0]["card_id"], turn["card_id"])

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
        self.assertTrue(Path(payload["audio_path"]).is_file())
        self.assertEqual(self.stt.transcribe_calls, 0)
        self.assertEqual(self.stt.transcribe_with_metadata_calls, 0)
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
        self.assertIn("I'm Jimmy", meeting["transcript_text"])
        self.assertIn("email the transcript", meeting["transcript_text"])
        self.assertTrue(meeting["diarization_requested"])
        self.assertEqual(meeting["diarization_status"], "speaker_turns")
        self.assertGreaterEqual(len(meeting["speaker_turns"]), 2)
        self.assertEqual(meeting["speaker_turns"][0]["speaker"], "Jimmy")
        self.assertEqual(meeting["feed_item"]["card"]["title"], "Jimmy and Jack Follow-ups")
        self.assertEqual(meeting["card_id"], payload["meeting"]["card_id"])
        self.assertEqual(self.stt.transcribe_calls, 0)
        self.assertEqual(self.stt.transcribe_with_metadata_calls, 0)
        self.assertEqual(meeting["executed_actions"][0]["recipient"], "jimmy@example.com")
        self.assertIn("meeting_result", self.codex.output_schemas[-1]["required"])
        prompt = self.codex.turns[-1]
        self.assertIn("Meeting Recording Agent Handoff", prompt)
        self.assertIn("audio_path:", prompt)
        self.assertIn("Use Deepgram", prompt)
        self.assertIn("speaker naming", prompt)
        self.assertIn("Directly execute explicit and unambiguous Pucky-directed actions", prompt)
        self.assertNotIn("Transcript:\nI'm Jimmy", prompt)

        persisted = self.service.feed.get_item(meeting["card_id"])
        self.assertIsNotNone(persisted)
        self.assertEqual(persisted["title"], "Jimmy and Jack Follow-ups")
        self.assertFalse(persisted["read"])
        self.assertFalse(persisted["archived"])
        messages = persisted["transcript_messages"]
        self.assertEqual(messages[0]["text"], "Meeting recording")
        self.assertNotIn("Meeting Recording Agent Handoff", json.dumps(messages))
        meetings = self.get_json("/api/meetings", headers={"Authorization": "Bearer secret"})
        self.assertEqual(meetings["schema"], "pucky.meetings.v1")
        self.assertTrue(any(
            item["meeting_id"] == "meeting-20260601-120000-device-abc123ef"
            for item in meetings["meetings"]
        ))

    def test_meeting_ingest_creates_processing_feed_card_before_agent_finishes(self) -> None:
        blocking = BlockingCodex()
        self.service.codex = blocking
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

    def test_meeting_agent_missing_result_is_not_marked_successful(self) -> None:
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
                            {
                                "reply_text": "I processed the meeting.",
                                "card_title": "Meeting Summary",
                                "card_icon": "mic",
                                "html": None,
                                "attachments": [],
                            }
                        ),
                        "used_thread_id": "thread-missing-result",
                        "requested_thread_id": "",
                        "thread_mode": "new",
                        "reused_existing_thread": False,
                        "fallback_reason": "",
                    },
                )()

        self.service.codex = MissingMeetingResultCodex()
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
            if meeting.get("state") == "completed_with_missing_result":
                break
            time.sleep(0.1)
        self.assertEqual(meeting["state"], "completed_with_missing_result")
        self.assertEqual(meeting["transcript_status"], "missing_agent_result")
        self.assertEqual(meeting["diarization_status"], "missing_agent_result")
        self.assertEqual(meeting["failure_reason"], "meeting_agent_missing_result")
        self.assertEqual(meeting["feed_item"]["card"]["title"], "Meeting needs review")
        self.assertFalse(meeting["feed_item"]["read"])
        self.assertIn("meeting_result", self.service.codex.output_schemas[-1]["required"])

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

    def test_meeting_ingest_requires_authorization(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json("/api/meetings")

        self.assertEqual(caught.exception.code, 401)

    def test_turn_status_requires_auth(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json("/api/turn/status?turn_id=missing")

        self.assertEqual(caught.exception.code, 401)

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
        user_attachments = messages[0]["attachments"]
        self.assertEqual(user_attachments[0]["kind"], "audio")
        artifact_id = user_attachments[0]["artifact"]
        request = urllib.request.Request(
            self.base_url + "/api/artifacts/" + urllib.parse.quote(artifact_id, safe=""),
            headers={"Authorization": "Bearer secret"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            self.assertEqual(response.headers.get_content_type(), "audio/wav")
            self.assertEqual(response.read(), b"RIFFdemo")

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
        self.assertEqual(attachments["type"], ["array", "null"])
        self.assertIn("attachments", schema["required"])
        self.assertNotIn("meeting_result", schema["properties"])
        item_schema = attachments["items"]
        self.assertEqual(
            item_schema["required"],
            ["path", "mime_type", "title", "kind", "viewer_path", "preview_path", "text"],
        )
        for key in item_schema["required"]:
            self.assertEqual(item_schema["properties"][key]["type"], ["string", "null"])

    def test_meeting_reply_output_schema_requires_meeting_result_without_changing_normal_schema(self) -> None:
        normal_schema = reply_output_schema()
        meeting_schema = meeting_reply_output_schema()

        self.assertNotIn("meeting_result", normal_schema["required"])
        self.assertIn("meeting_result", meeting_schema["required"])
        self.assertIn("speaker_turns", meeting_schema["properties"]["meeting_result"]["properties"])
        self.assertIn("executed_actions", meeting_schema["properties"]["meeting_result"]["properties"])

    def test_reply_envelope_accepts_safe_icon_slug(self) -> None:
        envelope = parse_reply_envelope(
            json.dumps(
                {
                    "reply_text": "Text",
                    "card_title": "Title",
                    "card_icon": "sparkles",
                    "html": None,
                }
            )
        )

        self.assertEqual(envelope.reply_text, "Text")
        self.assertEqual(envelope.card_icon, "sparkles")
        self.assertEqual(envelope.html_content, "")

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
