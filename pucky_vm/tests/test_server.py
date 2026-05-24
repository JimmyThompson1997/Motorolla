from __future__ import annotations

import base64
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from pucky_vm.server import Config, PuckyVoiceService, make_handler, parse_reply_envelope


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


def test_config(max_html_bytes: int = 512 * 1024) -> Config:
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
    )


class ServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.stt = FakeSTT()
        self.tts = FakeTTS()
        self.codex = FakeCodex()
        self.service = PuckyVoiceService(test_config(), stt=self.stt, tts=self.tts, codex=self.codex)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.service))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def test_healthz_reports_ready_without_secrets(self) -> None:
        payload = self.get_json("/healthz")

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["codex_app_server"], "ready")
        self.assertEqual(payload["thread"], "per_turn")
        self.assertEqual(payload["deepgram_key"], "present")
        self.assertNotIn("secret", json.dumps(payload))

    def test_ui_bundle_endpoints_serve_manifest_bundle_and_browser_app(self) -> None:
        manifest = self.get_json("/ui/pucky/latest/manifest.json")

        self.assertEqual(manifest["schema"], "pucky.ui_bundle.v1")
        self.assertEqual(manifest["entrypoint"], "index.html")
        self.assertIn("app.js", manifest["files"])
        self.assertIn("styles.css", manifest["files"])
        self.assertIn("fixtures/reply_cards_deploy.json", manifest["files"])
        self.assertIn("fixtures/artifacts/morning.wav", manifest["files"])

        with urllib.request.urlopen(self.base_url + "/ui/pucky/latest/bundle.zip", timeout=10) as response:
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

    def test_raw_audio_turn_defaults_to_card_only_without_tts(self) -> None:
        body = self.post_audio(b"audio", "audio/mp4")

        self.assertTrue(body["session_id"].startswith("pucky_"))
        self.assertEqual(body["turn_id"], body["session_id"])
        self.assertEqual(body["text"], "Sure, I can help.")
        self.assertEqual(body["reply_mode"], "card_only")
        self.assertNotIn("audio_mime_type", body)
        self.assertNotIn("audio_base64", body)
        self.assertEqual(body["card"]["title"], "Quick Help")
        self.assertEqual(body["card"]["icon"], "bolt")
        self.assertEqual(body["card"]["html_mime_type"], "text/html")
        self.assertIn("<!doctype html>", base64.b64decode(body["card"]["html_base64"]).decode("utf-8"))
        self.assertNotIn("transcript", body)
        self.assertEqual(self.stt.content_type, "audio/mp4")
        self.assertEqual(self.codex.turns, ["Pucky test turn"])
        self.assertFalse(hasattr(self.tts, "text"))
        telemetry = body["telemetry"]
        self.assertEqual(telemetry["turn_id"], body["turn_id"])
        self.assertEqual(telemetry["request_audio_bytes"], 5)
        self.assertEqual(telemetry["reply_mode"], "card_only")
        self.assertIn("stt_ms", telemetry)
        self.assertIn("codex_ms", telemetry)
        self.assertNotIn("tts_ms", telemetry)
        self.assertEqual(telemetry["tts_status"], "skipped_card_only")
        self.assertEqual(telemetry["reply_audio_bytes"], 0)
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

    def test_turn_status_requires_auth(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get_json("/api/turn/status?turn_id=missing")

        self.assertEqual(caught.exception.code, 401)

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
        self.assertNotIn("Pucky test turn", json.dumps(status))

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
        self.service.config = test_config(max_html_bytes=4)

        body = self.post_audio(b"audio", "audio/mp4")

        self.assertNotIn("html_base64", body["card"])
        self.assertNotIn("html_mime_type", body["card"])

    def get_json(self, path: str, headers: dict[str, str] | None = None) -> dict:
        request = urllib.request.Request(self.base_url + path, headers=headers or {})
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

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


if __name__ == "__main__":
    unittest.main()
