from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


class ProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeepgramSTT:
    api_key: str
    url: str = "https://api.deepgram.com/v1/listen"
    model: str = "nova-3"
    timeout: float = 60.0

    def transcribe(self, audio: bytes, content_type: str) -> str:
        if not audio:
            raise ProviderError("Deepgram cannot transcribe empty audio")
        query = urllib.parse.urlencode({"model": self.model, "smart_format": "true", "diarize": "true"})
        request = urllib.request.Request(
            f"{self.url}?{query}",
            data=audio,
            method="POST",
            headers={"Authorization": f"Token {self.api_key}", "Content-Type": content_type or "application/octet-stream"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ProviderError(f"Deepgram HTTP {exc.code}: {detail}") from exc
        except Exception as exc:
            raise ProviderError(f"Deepgram request failed: {exc}") from exc
        transcript = _deepgram_transcript(payload)
        if not transcript:
            raise ProviderError("Deepgram returned an empty transcript")
        return transcript


@dataclass(frozen=True)
class KokoroTTS:
    api_key: str
    url: str = "https://api.deepinfra.com/v1/openai/audio/speech"
    model: str = "hexgrad/Kokoro-82M"
    voice: str = "af_heart"
    response_format: str = "wav"
    speed: float = 1.0
    timeout: float = 60.0

    def synthesize(self, text: str) -> tuple[bytes, str]:
        clean = text.strip()
        if not clean:
            raise ProviderError("Kokoro cannot synthesize empty text")
        body = json.dumps({
            "model": self.model,
            "input": clean,
            "voice": self.voice,
            "response_format": self.response_format,
            "speed": self.speed,
        }).encode("utf-8")
        request = urllib.request.Request(
            self.url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "audio/wav, audio/mpeg, application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                content_type = response.headers.get("Content-Type", "audio/wav").split(";", 1)[0].strip()
                data = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise ProviderError(f"DeepInfra HTTP {exc.code}: {detail}") from exc
        except Exception as exc:
            raise ProviderError(f"DeepInfra request failed: {exc}") from exc
        if content_type == "application/json":
            return _kokoro_json_audio(data)
        if not data:
            raise ProviderError("DeepInfra returned empty audio")
        return data, content_type or "audio/wav"


def _deepgram_transcript(payload: dict[str, Any]) -> str:
    channels = ((payload.get("results") or {}).get("channels") or [])
    for channel in channels:
        for alternative in channel.get("alternatives") or []:
            transcript = str(alternative.get("transcript") or "").strip()
            if transcript:
                return transcript
    return ""


def _kokoro_json_audio(data: bytes) -> tuple[bytes, str]:
    try:
        payload = json.loads(data.decode("utf-8"))
    except Exception as exc:
        raise ProviderError("DeepInfra returned invalid JSON audio payload") from exc
    encoded = payload.get("audio_base64") or payload.get("audio") or payload.get("data") or payload.get("b64_json")
    if not encoded:
        raise ProviderError("DeepInfra JSON payload did not contain audio")
    try:
        audio = base64.b64decode(str(encoded), validate=True)
    except Exception as exc:
        raise ProviderError("DeepInfra JSON audio was not valid base64") from exc
    if not audio:
        raise ProviderError("DeepInfra JSON payload contained empty audio")
    return audio, str(payload.get("audio_mime_type") or payload.get("mime_type") or "audio/wav")
