#!/usr/bin/env python3
import argparse
import base64
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


DEVICE_ID = "pucky-6ee8e85c12910b5c"
EVIDENCE_DIR = pathlib.Path("pucky-apk-evidence")
PUCKYCTL = pathlib.Path("pucky-apk") / "puckyctl" / "puckyctl.py"
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
DEFAULT_TTS_MODEL = "eleven_multilingual_v2"
DEFAULT_STT_MODEL = "scribe_v2"
DEFAULT_PHRASE = "Pucky acoustic checkpoint delta fourteen violet moon."
EXPECTED_TERMS = ["acoustic", "checkpoint", "delta", "fourteen", "violet", "moon"]


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_dotenv(path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        clean = line.strip()
        if not clean or clean.startswith("#") or "=" not in clean:
            continue
        key, value = clean.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def extract_json(text):
    objects = []
    starts = [index for index, char in enumerate(text) if char == "{"]
    for start in starts:
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(text)):
            char = text[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    try:
                        objects.append(json.loads(text[start:index + 1]))
                    except json.JSONDecodeError:
                        pass
                    break
    for obj in objects:
        if obj.get("schema") == "puckyctl.result.v1":
            return obj
    return objects[-1] if objects else None


def puckyctl(args, broker, token, timeout=120, redact_content=False):
    cmd = ["python", str(PUCKYCTL), "--json"]
    if broker:
        cmd += ["--broker", broker]
    if token:
        cmd += ["--token", token]
    cmd += args
    started = time.monotonic()
    proc = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)
    combined = "\n".join(part for part in [proc.stdout, proc.stderr] if part)
    parsed = extract_json(combined)
    if redact_content:
        parsed = redact_base64(parsed)
    return {
        "argv": cmd,
        "returncode": proc.returncode,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "stdout": "[redacted base64 payload]" if redact_content else proc.stdout,
        "stderr": proc.stderr,
        "json": parsed,
    }


def redact_base64(value):
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            if key == "content_base64":
                out[key] = f"<redacted:{len(item) if isinstance(item, str) else 0} chars>"
            else:
                out[key] = redact_base64(item)
        return out
    if isinstance(value, list):
        return [redact_base64(item) for item in value]
    return value


def result(parsed):
    value = parsed.get("result") if isinstance(parsed, dict) else None
    return value if isinstance(value, dict) else {}


def require_ok(label, execution):
    parsed = execution.get("json") or {}
    if not parsed.get("ok"):
        raise RuntimeError(f"{label} failed: {json.dumps(parsed.get('error'), ensure_ascii=False)}")
    return result(parsed)


def eleven_tts(api_key, voice_id, model_id, text, output_path):
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{urllib.parse.quote(voice_id)}?output_format=mp3_44100_128"
    body = json.dumps({
        "text": text,
        "model_id": model_id,
        "voice_settings": {
            "stability": 0.55,
            "similarity_boost": 0.75,
        },
    }).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        data = response.read()
    output_path.write_bytes(data)
    return {
        "path": str(output_path),
        "bytes": len(data),
        "voice_id": voice_id,
        "model_id": model_id,
    }


def multipart_form(fields, file_field, file_path, content_type):
    boundary = "----pucky" + uuid.uuid4().hex
    chunks = []
    for key, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}\r\n".encode("utf-8"))
    chunks.append(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{file_path.name}"\r\n'.encode("utf-8")
    )
    chunks.append(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
    chunks.append(file_path.read_bytes())
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def eleven_stt(api_key, model_id, audio_path):
    body, content_type = multipart_form(
        {
            "model_id": model_id,
            "language_code": "en",
            "tag_audio_events": "false",
            "timestamps_granularity": "word",
        },
        "file",
        audio_path,
        "audio/mp4",
    )
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/speech-to-text",
        data=body,
        method="POST",
        headers={
            "xi-api-key": api_key,
            "Content-Type": content_type,
        },
    )
    with urllib.request.urlopen(req, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def score_transcript(text):
    normalized = re.sub(r"[^a-z0-9 ]+", " ", text.lower())
    found = [term for term in EXPECTED_TERMS if term in normalized]
    return {
        "text": text,
        "expected_terms": EXPECTED_TERMS,
        "found_terms": found,
        "score": len(found),
        "pass": len(found) >= 4,
    }


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--broker", default="https://pucky-bridge-dev-jt323.fly.dev")
    parser.add_argument("--token", default="")
    parser.add_argument("--env", default=".env")
    parser.add_argument("--phrase", default=DEFAULT_PHRASE)
    parser.add_argument("--volume-percent", type=int, default=85)
    parser.add_argument("--label", default="phase12-acoustic-loop")
    args = parser.parse_args()

    load_dotenv(pathlib.Path(args.env))
    api_key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("ELEVENLABS_API_KEY is not set")
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID", DEFAULT_VOICE_ID).strip() or DEFAULT_VOICE_ID
    tts_model = os.environ.get("ELEVENLABS_TTS_MODEL", DEFAULT_TTS_MODEL).strip() or DEFAULT_TTS_MODEL
    stt_model = os.environ.get("ELEVENLABS_STT_MODEL", DEFAULT_STT_MODEL).strip() or DEFAULT_STT_MODEL

    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")
    out_dir = EVIDENCE_DIR / "phase12-acoustic-loop"
    out_dir.mkdir(parents=True, exist_ok=True)
    tts_path = out_dir / f"{stamp}-tts.mp3"
    capture_path = out_dir / f"{stamp}-capture.m4a"
    results_path = out_dir / f"{stamp}-{args.label}-results.json"
    summary_path = out_dir / f"{stamp}-{args.label}-summary.md"

    run = {
        "schema": "pucky.phase12_acoustic_loop_results.v1",
        "started_at": utc_now(),
        "broker": args.broker,
        "device_id": DEVICE_ID,
        "phrase": args.phrase,
        "secret_status": {
            "elevenlabs_api_key_present": True,
        },
        "steps": [],
    }

    previous_volume = None
    try:
        tts = eleven_tts(api_key, voice_id, tts_model, args.phrase, tts_path)
        run["steps"].append({"step": "elevenlabs.tts", "passed": True, "result": tts})

        route_exec = puckyctl(["audio", "route", "--wait"], args.broker, args.token)
        route = require_ok("audio.route", route_exec)
        previous_volume = route.get("music_volume")
        run["steps"].append({"step": "audio.route.before", "passed": True, "result": route})

        volume_exec = puckyctl(["audio", "volume", "--percent", str(args.volume_percent), "--wait"], args.broker, args.token)
        volume = require_ok("audio.volume", volume_exec)
        run["steps"].append({"step": "audio.volume.set", "passed": True, "result": volume})

        put_exec = puckyctl(["file", "put", str(tts_path), "--filename", tts_path.name, "--wait"], args.broker, args.token, timeout=180)
        put = require_ok("file.put", put_exec)
        run["steps"].append({"step": "file.put_base64", "passed": True, "result": put})
        remote_tts_path = put["path"]

        session_id = "acoustic-" + stamp
        start_exec = puckyctl([
            "voice", "start",
            "--session-id", session_id,
            "--sample-tag", "phase12-acoustic-loop",
            "--max-duration-ms", "45000",
            "--wait",
        ], args.broker, args.token)
        start = require_ok("voice.start", start_exec)
        run["steps"].append({"step": "voice.capture.start", "passed": True, "result": start})

        time.sleep(0.75)
        play_exec = puckyctl([
            "player", "play",
            "--path", remote_tts_path,
            "--title", "Pucky acoustic checkpoint",
            "--source", "elevenlabs-tts",
            "--wait",
        ], args.broker, args.token)
        play = require_ok("player.play", play_exec)
        run["steps"].append({"step": "player.play", "passed": True, "result": play})
        wait_ms = play.get("duration_ms", 5000)
        time.sleep(max(5.0, min(15.0, (wait_ms / 1000.0) + 2.0)))

        stop_player_exec = puckyctl(["player", "stop", "--wait"], args.broker, args.token)
        run["steps"].append({"step": "player.stop", "passed": bool((stop_player_exec.get("json") or {}).get("ok")),
                             "result": result(stop_player_exec.get("json") or {})})

        stop_exec = puckyctl([
            "voice", "stop",
            "--session-id", "vc_" + session_id,
            "--reason", "phase12_acoustic_loop",
            "--wait",
        ], args.broker, args.token, timeout=180)
        stop = require_ok("voice.stop", stop_exec)
        capture = stop.get("capture", {})
        run["steps"].append({"step": "voice.capture.stop", "passed": True, "result": capture})

        read_exec_raw = puckyctl([
            "artifact-local", "read",
            "--path", capture["path"],
            "--max-bytes", "3000000",
            "--wait",
        ], args.broker, args.token, timeout=180)
        read_raw = require_ok("artifact.read_base64", read_exec_raw)
        capture_bytes = base64.b64decode(read_raw["content_base64"])
        capture_path.write_bytes(capture_bytes)
        read_redacted = dict(read_raw)
        read_redacted["content_base64"] = f"<redacted:{len(read_raw['content_base64'])} chars>"
        run["steps"].append({"step": "artifact.read_base64", "passed": True, "result": read_redacted})
        run["captured_audio_path"] = str(capture_path)

        stt = eleven_stt(api_key, stt_model, capture_path)
        stt_path = out_dir / f"{stamp}-stt.json"
        write_json(stt_path, stt)
        score = score_transcript(stt.get("text", ""))
        run["steps"].append({"step": "elevenlabs.stt", "passed": score["pass"], "result": {
            "model_id": stt_model,
            "transcript_path": str(stt_path),
            "score": score,
        }})
        run["summary"] = {
            "passed": score["pass"],
            "transcript": stt.get("text", ""),
            "score": score,
        }
    except Exception as exc:
        run["summary"] = {
            "passed": False,
            "failure": type(exc).__name__ + ": " + str(exc),
        }
    finally:
        if previous_volume is not None:
            try:
                restore_exec = puckyctl(["audio", "volume", "--level", str(previous_volume), "--wait"], args.broker, args.token)
                run["steps"].append({"step": "audio.volume.restore", "passed": bool((restore_exec.get("json") or {}).get("ok")),
                                     "result": result(restore_exec.get("json") or {})})
            except Exception as exc:
                run["steps"].append({"step": "audio.volume.restore", "passed": False,
                                     "result": {"error": type(exc).__name__ + ": " + str(exc)}})
        run["completed_at"] = utc_now()
        write_json(results_path, run)
        lines = [
            "# Pucky Phase 12 Acoustic Loop Summary",
            "",
            f"Started: {run['started_at']}",
            f"Completed: {run['completed_at']}",
            f"Passed: {run.get('summary', {}).get('passed')}",
            f"Phrase: `{args.phrase}`",
            f"Transcript: `{run.get('summary', {}).get('transcript', '')}`",
            f"Results: `{results_path}`",
            f"Captured audio: `{capture_path}`",
            "",
        ]
        if not run.get("summary", {}).get("passed"):
            lines.append(f"Failure: {run.get('summary', {}).get('failure', 'transcript score below threshold')}")
        summary_path.write_text("\n".join(lines), encoding="utf-8")
        print(json.dumps({
            "results": str(results_path),
            "summary": str(summary_path),
            "passed": run.get("summary", {}).get("passed"),
            "transcript": run.get("summary", {}).get("transcript", ""),
            "failure": run.get("summary", {}).get("failure"),
        }, indent=2))
    return 0 if run.get("summary", {}).get("passed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
