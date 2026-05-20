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

        with urllib.request.urlopen(self.base_url + "/ui/pucky/latest/bundle.zip", timeout=10) as response:
            self.assertEqual(response.headers.get_content_type(), "application/zip")
            self.assertGreater(len(response.read()), 1000)

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

    def test_raw_audio_turn_returns_text_audio_and_card(self) -> None:
        body = self.post_audio(b"audio", "audio/mp4")

        self.assertTrue(body["session_id"].startswith("pucky_"))
        self.assertEqual(body["text"], "Sure, I can help.")
        self.assertEqual(body["audio_mime_type"], "audio/wav")
        self.assertEqual(base64.b64decode(body["audio_base64"]), b"RIFFaudio")
        self.assertEqual(body["card"]["title"], "Quick Help")
        self.assertEqual(body["card"]["icon"], "bolt")
        self.assertEqual(body["card"]["html_mime_type"], "text/html")
        self.assertIn("<!doctype html>", base64.b64decode(body["card"]["html_base64"]).decode("utf-8"))
        self.assertNotIn("transcript", body)
        self.assertEqual(self.stt.content_type, "audio/mp4")
        self.assertEqual(self.codex.turns, ["Pucky test turn"])
        self.assertEqual(self.tts.text, "Sure, I can help.")

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

    def get_json(self, path: str) -> dict:
        with urllib.request.urlopen(self.base_url + path, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))

    def post_audio(self, audio: bytes, content_type: str) -> dict:
        request = urllib.request.Request(
            self.base_url + "/api/turn",
            data=audio,
            method="POST",
            headers={
                "Authorization": "Bearer secret",
                "Content-Type": content_type,
            },
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
