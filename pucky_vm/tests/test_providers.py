from __future__ import annotations

import base64
import json
import unittest
from unittest.mock import patch

from pucky_vm.providers import DeepgramSTT, KokoroTTS


class FakeResponse:
    def __init__(self, body: bytes, content_type: str = "application/json") -> None:
        self._body = body
        self.headers = {"Content-Type": content_type}

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self) -> bytes:
        return self._body


class ProviderTests(unittest.TestCase):
    def test_deepgram_posts_raw_audio_without_keyterms(self) -> None:
        seen = {}

        def fake_urlopen(request, timeout):
            seen["url"] = request.full_url
            seen["body"] = request.data
            seen["headers"] = request.headers
            payload = {"results": {"channels": [{"alternatives": [{"transcript": "Pucky test turn."}]}]}}
            return FakeResponse(json.dumps(payload).encode("utf-8"))

        with patch("urllib.request.urlopen", fake_urlopen):
            transcript = DeepgramSTT("dg-key").transcribe(b"audio", "audio/mp4")

        self.assertEqual(transcript, "Pucky test turn.")
        self.assertEqual(seen["body"], b"audio")
        self.assertIn("model=nova-3", seen["url"])
        self.assertIn("smart_format=true", seen["url"])
        self.assertIn("diarize=true", seen["url"])
        self.assertNotIn("keyterm", seen["url"])
        self.assertEqual(seen["headers"]["Authorization"], "Token dg-key")

    def test_deepgram_metadata_extracts_diarized_speaker_turns(self) -> None:
        seen = {}

        def fake_urlopen(request, timeout):
            seen["url"] = request.full_url
            payload = {
                "results": {
                    "channels": [
                        {
                            "alternatives": [
                                {
                                    "transcript": "Hello there. Follow up please.",
                                    "words": [
                                        {"word": "Hello", "speaker": 0, "start": 0.0, "end": 0.2},
                                        {"word": "there", "speaker": 0, "start": 0.2, "end": 0.4},
                                        {"word": "Follow", "speaker": 1, "start": 0.5, "end": 0.7},
                                        {"word": "up", "speaker": 1, "start": 0.7, "end": 0.8},
                                        {"word": "please", "speaker": 1, "start": 0.8, "end": 1.0},
                                    ],
                                }
                            ]
                        }
                    ]
                }
            }
            return FakeResponse(json.dumps(payload).encode("utf-8"))

        with patch("urllib.request.urlopen", fake_urlopen):
            result = DeepgramSTT("dg-key").transcribe_with_metadata(b"audio", "audio/mp4")

        self.assertIn("diarize=true", seen["url"])
        self.assertEqual(result["transcript"], "Hello there. Follow up please.")
        self.assertTrue(result["diarization_requested"])
        self.assertEqual(result["speaker_turns"][0]["speaker"], "speaker_0")
        self.assertEqual(result["speaker_turns"][1]["speaker"], "speaker_1")
        self.assertIn("Follow", result["speaker_turns"][1]["text"])

    def test_kokoro_accepts_raw_audio_response(self) -> None:
        def fake_urlopen(request, timeout):
            body = json.loads(request.data.decode("utf-8"))
            self.assertEqual(body["model"], "hexgrad/Kokoro-82M")
            self.assertEqual(body["input"], "hello")
            self.assertEqual(body["voice"], "af_heart")
            self.assertEqual(body["response_format"], "wav")
            self.assertEqual(body["speed"], 1.0)
            self.assertEqual(request.headers["Authorization"], "Bearer di-key")
            return FakeResponse(b"RIFFaudio", "audio/wav")

        with patch("urllib.request.urlopen", fake_urlopen):
            audio, mime_type = KokoroTTS("di-key").synthesize("hello")

        self.assertEqual(audio, b"RIFFaudio")
        self.assertEqual(mime_type, "audio/wav")

    def test_kokoro_accepts_json_audio_response(self) -> None:
        payload = {"audio_base64": base64.b64encode(b"audio").decode("ascii"), "audio_mime_type": "audio/wav"}

        def fake_urlopen(_request, timeout):
            return FakeResponse(json.dumps(payload).encode("utf-8"), "application/json")

        with patch("urllib.request.urlopen", fake_urlopen):
            audio, mime_type = KokoroTTS("di-key").synthesize("hello")

        self.assertEqual(audio, b"audio")
        self.assertEqual(mime_type, "audio/wav")


if __name__ == "__main__":
    unittest.main()
