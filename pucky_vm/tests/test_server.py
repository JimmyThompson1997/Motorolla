from __future__ import annotations

import base64
import json
import tempfile
import threading
import unittest
import uuid
import urllib.error
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer

from pucky_vm.server import Config, PuckyVoiceService, make_handler, parse_reply_envelope, reset_broker_for_tests


class FakeSTT:
    def transcribe(self, audio: bytes, content_type: str) -> str:
        self.audio = audio
        self.content_type = content_type
        return "Pucky test turn"


class FakeTTS:
    def synthesize(self, text: str) -> tuple[bytes, str]:
        self.text = text
        return b"RIFFaudio", "audio/wav"


class FakeCodex:
    ready = True
    thread_id = "thread-1"

    def __init__(self) -> None:
        self.turns: list[str] = []
        self.renamed_titles: list[str] = []

    def start(self) -> None:
        self.started = True

    def send_turn(self, text: str) -> str:
        self.turns.append(text)
        return json.dumps(
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

    def set_thread_title(self, title: str) -> None:
        self.renamed_titles.append(title)

    def thread_origin(self, *, retries: int = 5, delay: float = 0.15) -> dict[str, str]:
        return {
            "runtime": "codex",
            "thread_id": self.thread_id,
            "thread_title": self.renamed_titles[-1] if self.renamed_titles else "thread-1",
            "rollout_path": "/data/home/codex/sessions/fake-thread-1.jsonl",
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

    def send_turn(self, text: str) -> str:
        self.turns.append(text)
        self.codex_started.set()
        if not self.release_codex.wait(timeout=5):
            raise TimeoutError("test did not release codex")
        return json.dumps(
            {
                "reply_text": "Codex status observed.",
                "card_title": "Status",
                "card_icon": "bolt",
                "html": None,
            }
        )

class FakeComposio:
    def __init__(self) -> None:
        self.configured = True
        self.starts: list[dict[str, object]] = []
        self.deleted: list[tuple[str, str]] = []
        self.invalidated: list[str] = []
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
                "auth_schemes": ["OAUTH2"],
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
        return {"ok": True, "apps": list(self.apps)}

    def list_connected_apps(self, user_id: str, *, force: bool = False) -> dict[str, object]:
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


def make_config(max_html_bytes: int = 512 * 1024) -> Config:
    return Config(
        host="127.0.0.1",
        port=0,
        pucky_api_token="secret",
        deepgram_api_key="dg",
        deepinfra_api_key="di",
        max_audio_bytes=1024 * 1024,
        max_html_bytes=max_html_bytes,
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
    )


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
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

        with urllib.request.urlopen(self.base_url + "/ui/pucky/latest/pucky-config.js", timeout=10) as response:
            config_script = response.read().decode("utf-8")
            self.assertIn("window.PUCKY_BUNDLE_CONFIG", config_script)
            self.assertNotIn('"links_url"', config_script)

    def test_links_portal_url_endpoint_returns_signed_first_party_url(self) -> None:
        payload = self.get_json("/api/links/composio/portal-url")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["schema"], "pucky.links_portal_url.v1")
        self.assertEqual(payload["auth_mode"], "browser")
        self.assertEqual(payload["user_id"], "jimmythompson323")
        self.assertTrue(payload["portal_url"].startswith(self.base_url + "/links/connect/apps?token="))
        token = self.portal_token(payload["portal_url"])
        verified = self.service._verify_links_portal_token(token)
        self.assertIsNotNone(verified)
        self.assertEqual(verified["user_id"], "jimmythompson323")

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
        self.assertIn("linkedin", slugs)
        self.assertNotIn("composio", slugs)

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
        self.assertNotIn("Pucky test turn", json.dumps(item))
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

    def test_turn_status_requires_auth(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json("/api/turn/status?turn_id=missing")

        self.assertEqual(caught.exception.code, 401)

    def test_broker_routes_share_the_same_server(self) -> None:
        health = self.get_json("/health")
        self.assertTrue(health["ok"])
        self.assertEqual(health["devices_online"], 0)

        devices = self.get_json("/v1/devices", headers={"Authorization": "Bearer operator-dev-token"})
        self.assertEqual(devices["devices"], [])

        request = urllib.request.Request(
            self.base_url + "/v1/devices/pucky-test/commands",
            data=json.dumps({"type": "status.get", "args": {}}).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": "Bearer operator-dev-token",
                "Content-Type": "application/json",
            },
        )
        with self.assertRaises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(request, timeout=10)
        self.assertEqual(caught.exception.code, 409)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error"], "DEVICE_OFFLINE")
        self.assertEqual(payload["command"]["status"], "device_offline")

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

    def test_empty_audio_is_rejected(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post_audio(b"", "audio/mp4")
        self.assertEqual(caught.exception.code, 400)

    def test_reply_envelope_falls_back_on_malformed_json(self) -> None:
        envelope = parse_reply_envelope("Plain answer text.")

        self.assertEqual(envelope.reply_text, "Plain answer text.")
        self.assertEqual(envelope.card_title, "Plain answer text.")
        self.assertEqual(envelope.card_icon, "mail")

    def test_reply_envelope_normalizes_unknown_icon(self) -> None:
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
        self.assertEqual(envelope.card_icon, "mail")
        self.assertEqual(envelope.html_content, "")

    def test_large_html_is_omitted(self) -> None:
        self.service.config = make_config(max_html_bytes=4)

        body = self.post_audio(b"audio", "audio/mp4")

        self.assertNotIn("html_base64", body["card"])
        self.assertNotIn("html_mime_type", body["card"])
        self.assertNotIn("html_base64", body)
        self.assertNotIn("html_mime_type", body)

    def get_json(self, path: str, headers: dict[str, str] | None = None) -> dict:
        request = urllib.request.Request(self.base_url + path, headers=headers or {})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def get_text(self, path: str, headers: dict[str, str] | None = None) -> str:
        request = urllib.request.Request(self.base_url + path, headers=headers or {})
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.read().decode("utf-8")

    def post_audio(self, audio: bytes, content_type: str, turn_id: str = "", reply_mode: str = "") -> dict:
        headers = {
            "Authorization": "Bearer secret",
            "Content-Type": content_type,
        }
        if turn_id:
            headers["X-Pucky-Turn-Id"] = turn_id
        if reply_mode:
            headers["X-Pucky-Reply-Mode"] = reply_mode
        request = urllib.request.Request(
            self.base_url + "/api/turn",
            data=audio,
            method="POST",
            headers=headers,
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def post_json(self, path: str, body: dict, headers: dict[str, str] | None = None) -> dict:
        merged = {
            "Authorization": "Bearer secret",
            "Content-Type": "application/json",
        }
        if headers:
            merged.update(headers)
        request = urllib.request.Request(
            self.base_url + path,
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
        payload = self.get_json("/api/links/composio/portal-url")
        return self.portal_token(payload["portal_url"])


if __name__ == "__main__":
    unittest.main()
