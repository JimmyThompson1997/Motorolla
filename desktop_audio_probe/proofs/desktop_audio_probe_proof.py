from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
PROBE_ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pucky_vm.server import Config, PuckyVoiceService, make_handler, reset_broker_for_tests


class FakeSTT:
    def transcribe(self, audio: bytes, content_type: str) -> str:
        return "desktop audio proof"


class FakeTTS:
    def synthesize(self, text: str) -> tuple[bytes, str]:
        return b"RIFFreply", "audio/wav"


class FakeCodex:
    ready = True
    thread_id = None
    last_turn_routing: dict[str, str | bool] = {}

    def start(self) -> None:
        return

    def send_turn(self, text: str, *, thread_id: str | None = None, output_schema: dict[str, object] | None = None):
        raise RuntimeError("desktop audio proof should not call Codex")

    def set_thread_title(self, title: str, *, thread_id: str | None = None) -> None:
        return

    def runtime_call(self, method: str, params: dict[str, object] | None = None, *, timeout: float | None = None) -> dict[str, object]:
        return {"ok": False, "error": "not_available"}

    def thread_origin(self, thread_id: str | None = None, *, retries: int = 5, delay: float = 0.15) -> dict[str, str]:
        return {}


class FakeComposio:
    configured = False

    def list_apps(self) -> dict[str, object]:
        return {"items": []}

    def list_connected_apps(self, user_id: str, *, force: bool = False) -> dict[str, object]:
        return {"items": []}

    def retrieve_connected_account(self, connection_id: str) -> dict[str, object]:
        return {}

    def initiate_connection(self, user_id: str, app_slug: str, *, callback_url: str = "", auth_mode: str = "") -> dict[str, object]:
        return {}

    def delete_connected_account(self, connection_id: str) -> dict[str, object]:
        return {}

    def execute_action(self, app_slug: str, action: str, payload: dict[str, object], *, user_id: str) -> dict[str, object]:
        return {}


def make_config(tmp: Path, token: str) -> Config:
    return Config(
        host="127.0.0.1",
        port=0,
        pucky_api_token=token,
        deepgram_api_key="dg",
        deepinfra_api_key="di",
        max_audio_bytes=8 * 1024 * 1024,
        max_html_bytes=512 * 1024,
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
        developer_instructions="desktop audio proof",
        feed_db_path=str(tmp / "feed.sqlite3"),
        codex_sandbox="danger-full-access",
        codex_approval_policy="never",
        codex_model="gpt-5.4-mini",
        codex_reasoning_effort="low",
    )


def start_local_server(tmp: Path, token: str):
    broker = reset_broker_for_tests(str(tmp / "broker.sqlite3"))
    service = PuckyVoiceService(
        make_config(tmp, token),
        stt=FakeSTT(),
        tts=FakeTTS(),
        codex=FakeCodex(),
        meeting_codex=FakeCodex(),
        composio=FakeComposio(),
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(service))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    return broker, service, server, thread, base_url


def build_probe(skip_build: bool) -> Path:
    binary = PROBE_ROOT / ".build" / "debug" / "desktop-audio-probe"
    if not skip_build:
        subprocess.run(["swift", "build"], cwd=PROBE_ROOT, check=True)
    if not binary.exists():
        raise RuntimeError(f"desktop-audio-probe binary missing at {binary}")
    return binary


def run_probe(binary: Path, *, mode: str, duration: float, base_url: str, token: str, bundle_id: str, out_dir: Path) -> dict[str, Any]:
    command = [
        str(binary),
        "--mode",
        mode,
        "--duration",
        str(duration),
        "--base-url",
        base_url,
        "--token",
        token,
        "--bundle-id",
        bundle_id,
        "--device-id",
        "mac-desktop-proof",
        "--out-dir",
        str(out_dir),
    ]
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=max(30, int(duration) + 45))
    if completed.returncode != 0:
        raise RuntimeError(f"probe failed rc={completed.returncode}\nstdout={completed.stdout}\nstderr={completed.stderr}")
    return json.loads(completed.stdout)


def write_tone_wav(path: Path, *, duration: float, sample_rate: int = 44_100) -> None:
    import math
    import struct

    frame_count = max(1, int(duration * sample_rate))
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        frames = bytearray()
        for index in range(frame_count):
            sample = math.sin(2.0 * math.pi * 660.0 * index / sample_rate)
            frames.extend(struct.pack("<h", int(sample * 16_000)))
        handle.writeframes(bytes(frames))


def maybe_start_system_tone(mode: str, duration: float, evidence_dir: Path) -> tuple[subprocess.Popen | None, dict[str, Any]]:
    if mode not in {"system", "dual"}:
        return None, {"played": False}
    tone_path = evidence_dir / "system-proof-tone.wav"
    write_tone_wav(tone_path, duration=duration + 2.0)
    try:
        process = subprocess.Popen(["afplay", str(tone_path)])
    except FileNotFoundError:
        return None, {"played": False, "error": "afplay_not_found", "path": str(tone_path)}
    time.sleep(0.25)
    return process, {
        "played": True,
        "path": str(tone_path),
        "bytes": tone_path.stat().st_size,
        "sha256": hashlib.sha256(tone_path.read_bytes()).hexdigest(),
    }


def afinfo(path: Path) -> dict[str, Any]:
    try:
        completed = subprocess.run(["afinfo", str(path)], text=True, capture_output=True, timeout=10)
    except FileNotFoundError:
        return {"ok": False, "error": "afinfo_not_found"}
    return {
        "ok": completed.returncode == 0,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def api_json(base_url: str, token: str, path: str) -> dict[str, Any]:
    request = urllib.request.Request(
        urllib.parse.urljoin(base_url.rstrip("/") + "/", path.lstrip("/")),
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def assert_unauthorized(base_url: str, path: str) -> int:
    request = urllib.request.Request(urllib.parse.urljoin(base_url.rstrip("/") + "/", path.lstrip("/")))
    try:
        urllib.request.urlopen(request, timeout=20)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            return exc.code
        raise
    raise AssertionError(f"{path} unexpectedly allowed unauthenticated access")


def verify_probe_summary(summary: dict[str, Any], detail: dict[str, Any]) -> dict[str, Any]:
    if summary.get("ok") is not True:
        raise AssertionError("probe summary was not ok")
    bundle = detail.get("bundle") or {}
    if bundle.get("state") != "complete":
        raise AssertionError(f"bundle did not complete: {bundle}")
    detail_tracks = {item["track_id"]: item for item in bundle.get("tracks", [])}
    checks = []
    for track in summary.get("tracks", []):
        track_id = str(track["track_id"])
        path = Path(str(track["path"]))
        data = path.read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        if sha != track["sha256"]:
            raise AssertionError(f"local sha mismatch for {track_id}")
        remote = detail_tracks.get(track_id)
        if not remote:
            raise AssertionError(f"server detail missing {track_id}")
        if remote.get("sha256") != sha or int(remote.get("bytes") or 0) != len(data):
            raise AssertionError(f"server metadata mismatch for {track_id}: {remote}")
        checks.append({"track_id": track_id, "bytes": len(data), "sha256": sha})
    return {"tracks": checks, "track_count": len(checks)}


def run(args: argparse.Namespace) -> dict[str, Any]:
    evidence_dir = args.evidence_dir.resolve()
    evidence_dir.mkdir(parents=True, exist_ok=True)
    token = args.token or os.environ.get("PUCKY_API_TOKEN", "")
    if not token:
        token = "desktop-audio-proof-token"
    binary = build_probe(args.skip_build)
    bundle_id = args.bundle_id or f"desktop-audio-proof-{args.mode}-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    local_handles = None
    tmp_context = None
    try:
        if args.target == "local":
            tmp_context = tempfile.TemporaryDirectory()
            tmp = Path(tmp_context.name)
            local_handles = start_local_server(tmp, token)
            broker, service, server, thread, base_url = local_handles
        else:
            if not args.base_url:
                raise RuntimeError("--base-url is required for --target live")
            base_url = args.base_url.rstrip("/")
            service = None
        probe_dir = evidence_dir / bundle_id
        tone_process, tone_summary = maybe_start_system_tone(args.mode, args.duration, evidence_dir)
        try:
            probe_summary = run_probe(
                binary,
                mode=args.mode,
                duration=args.duration,
                base_url=base_url,
                token=token,
                bundle_id=bundle_id,
                out_dir=probe_dir,
            )
        finally:
            if tone_process is not None and tone_process.poll() is None:
                tone_process.terminate()
                try:
                    tone_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    tone_process.kill()
        detail = api_json(base_url, token, f"/api/desktop-audio/v1/bundles/{bundle_id}")
        unauthorized_code = assert_unauthorized(base_url, f"/api/desktop-audio/v1/bundles/{bundle_id}")
        verification = verify_probe_summary(probe_summary, detail)
        media_info = {
            str(track["track_id"]): afinfo(Path(str(track["path"])))
            for track in probe_summary.get("tracks", [])
        }
        result = {
            "schema": "pucky.desktop_audio_probe_proof.v1",
            "ok": True,
            "target": args.target,
            "mode": args.mode,
            "base_url": base_url,
            "bundle_id": bundle_id,
            "unauthorized_metadata_status": unauthorized_code,
            "verification": verification,
            "tone_playback": tone_summary,
            "media_info": media_info,
            "probe_summary": probe_summary,
            "server_detail": detail,
        }
        if service is not None:
            result["server_storage_dir"] = str(service._desktop_audio_dir)
        summary_path = evidence_dir / "summary.json"
        summary_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return result
    finally:
        if local_handles is not None:
            broker, service, server, thread, base_url = local_handles
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
            service.feed.close()
            if getattr(broker, "DB", None) is not None:
                broker.DB.close()
                broker.DB = None
            broker.DEVICES.clear()
        if tmp_context is not None:
            tmp_context.cleanup()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prove desktop audio capture/upload against local or live Pucky.")
    parser.add_argument("--target", choices=["local", "live"], default="local")
    parser.add_argument("--mode", choices=["fixture", "mic", "system", "dual"], default="fixture")
    parser.add_argument("--duration", type=float, default=1.0)
    parser.add_argument("--base-url", default="")
    parser.add_argument("--token", default=os.environ.get("PUCKY_API_TOKEN", ""))
    parser.add_argument("--bundle-id", default="")
    parser.add_argument("--evidence-dir", type=Path, default=ROOT / ".tmp" / "desktop-audio-probe-proof")
    parser.add_argument("--skip-build", action="store_true")
    return parser.parse_args()


def main() -> int:
    try:
        result = run(parse_args())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, "summary": str(Path(result["probe_summary"]["out_dir"]).parent / "summary.json"), "bundle_id": result["bundle_id"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
