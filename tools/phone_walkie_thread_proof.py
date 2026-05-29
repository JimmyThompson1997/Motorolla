from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.request import urlopen

import tools.refresh_pucky_html_official as official_html


ROOT = Path(__file__).resolve().parents[1]
CANONICAL_REPO_ROOT = Path(r"C:\Users\jimmy\Desktop\Motorolla-master-ui")
DEFAULT_PACKAGE_NAME = "com.pucky.device.debug"
DEFAULT_BROKER_URL = "https://pucky.fly.dev"
RESULT_SCHEMA = "pucky.walkie_thread_phone_proof.v1"


class PhoneProofError(RuntimeError):
    pass


def utc_stamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def bundled_node_executable() -> Path:
    return Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "bin" / "node.exe"


def bundled_node_modules() -> Path:
    return Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "node" / "node_modules"


def run_subprocess(
    argv: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    timeout: int | float | None = None,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        cwd=str(cwd or ROOT),
        text=True,
        capture_output=True,
        env=env,
        timeout=timeout,
        check=False,
    )


def run_subprocess_bytes(
    argv: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    timeout: int | float | None = None,
) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        argv,
        cwd=str(cwd or ROOT),
        capture_output=True,
        env=env,
        timeout=timeout,
        check=False,
    )


def run_git(root: Path, *args: str) -> str:
    completed = run_subprocess(["git", *args], cwd=root, timeout=30)
    if completed.returncode != 0:
        raise PhoneProofError(f"git {' '.join(args)} failed: {(completed.stderr or completed.stdout).strip()}")
    return completed.stdout.strip()


def local_git_state(root: Path) -> dict[str, object]:
    return {
        "repo_root": str(root),
        "branch": run_git(root, "rev-parse", "--abbrev-ref", "HEAD"),
        "head": run_git(root, "rev-parse", "HEAD"),
        "head_short": run_git(root, "rev-parse", "--short", "HEAD"),
        "upstream": run_git(root, "rev-parse", "@{u}"),
        "dirty": bool(run_git(root, "status", "--short")),
    }


def require_official_local_repo(root: Path, canonical_root: Path = CANONICAL_REPO_ROOT) -> dict[str, object]:
    if root.resolve() != canonical_root.resolve():
        raise PhoneProofError(f"Real phone proof must run from {canonical_root}")
    state = local_git_state(root)
    if state["branch"] != "master":
        raise PhoneProofError("Real phone proof requires branch master")
    if state["dirty"]:
        raise PhoneProofError("Real phone proof refuses dirty workspaces")
    if state["head"] != state["upstream"]:
        raise PhoneProofError("Real phone proof requires local HEAD == origin/master")
    return state


def extract_json(text: str) -> dict[str, Any] | None:
    objects: list[dict[str, Any]] = []
    raw = str(text or "")
    for start, char in enumerate(raw):
        if char != "{":
            continue
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(raw)):
            current = raw[index]
            if in_string:
                if escaped:
                    escaped = False
                elif current == "\\":
                    escaped = True
                elif current == '"':
                    in_string = False
                continue
            if current == '"':
                in_string = True
            elif current == "{":
                depth += 1
            elif current == "}":
                depth -= 1
                if depth == 0:
                    candidate = raw[start:index + 1]
                    try:
                        parsed = json.loads(candidate)
                    except json.JSONDecodeError:
                        parsed = None
                    if isinstance(parsed, dict):
                        objects.append(parsed)
                    break
    for obj in objects:
        if obj.get("schema") == "puckyctl.result.v1":
            return obj
    return objects[-1] if objects else None


def puckyctl_base_args(args: argparse.Namespace, *, timeout_ms: int) -> list[str]:
    argv = [
        sys.executable,
        str(args.puckyctl),
        "--json",
        "--timeout-ms",
        str(timeout_ms),
    ]
    if args.broker:
        argv += ["--broker", args.broker]
    if args.token:
        argv += ["--token", args.token]
    if args.device_id:
        argv += ["--device-id", args.device_id]
    return argv


def run_pucky_resource(
    args: argparse.Namespace,
    resource_args: list[str],
    *,
    timeout_seconds: int | float | None = None,
) -> dict[str, Any]:
    timeout_ms = max(1000, int((timeout_seconds or args.command_timeout_seconds) * 1000))
    argv = puckyctl_base_args(args, timeout_ms=timeout_ms) + resource_args
    attempts = 3
    for attempt in range(1, attempts + 1):
        completed = run_subprocess(argv, cwd=args.repo_root, timeout=(timeout_seconds or args.command_timeout_seconds) + 5)
        combined = "\n".join(part for part in (completed.stdout, completed.stderr) if part).strip()
        parsed = extract_json(completed.stdout or combined)
        transient = (
            "BROKER_UNAVAILABLE" in combined
            or "WinError 10054" in combined
            or "forcibly closed by the remote host" in combined.lower()
        )
        if isinstance(parsed, dict) and completed.returncode == 0 and parsed.get("ok", False):
            result = parsed.get("result")
            return result if isinstance(result, dict) else {}
        if attempt < attempts and transient:
            time.sleep(1.5 * attempt)
            continue
        if not isinstance(parsed, dict):
            raise PhoneProofError(f"Unable to parse puckyctl JSON for {' '.join(resource_args)}: {combined}")
        raise PhoneProofError(f"puckyctl {' '.join(resource_args)} failed: {combined}")
    raise PhoneProofError(f"puckyctl {' '.join(resource_args)} failed after retries")


def run_pucky_command(
    args: argparse.Namespace,
    command_type: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: int | float | None = None,
) -> dict[str, Any]:
    return run_pucky_resource(
        args,
        ["command", "send", command_type, "--args-json", json.dumps(payload, separators=(",", ":")), "--wait"],
        timeout_seconds=timeout_seconds,
    )


def run_pucky_file_put(
    args: argparse.Namespace,
    local_path: Path,
    *,
    filename: str = "",
    timeout_seconds: int | float | None = None,
) -> dict[str, Any]:
    resource_args = ["file", "put", str(local_path), "--wait"]
    if filename:
        resource_args += ["--filename", filename]
    return run_pucky_resource(args, resource_args, timeout_seconds=timeout_seconds or 180)


def adb_command(args: argparse.Namespace, serial: str, adb_args: list[str]) -> list[str]:
    return [str(args.adb), "-s", serial, *adb_args]


def run_adb(args: argparse.Namespace, serial: str, adb_args: list[str], *, timeout_seconds: int | float = 30) -> str:
    completed = run_subprocess(adb_command(args, serial, adb_args), cwd=args.repo_root, timeout=timeout_seconds)
    if completed.returncode != 0:
        raise PhoneProofError(
            f"adb {' '.join(adb_args)} failed for {serial}: {(completed.stderr or completed.stdout).strip()}"
        )
    return completed.stdout.strip()


def run_adb_bytes(
    args: argparse.Namespace,
    serial: str,
    adb_args: list[str],
    *,
    timeout_seconds: int | float = 30,
) -> bytes:
    completed = run_subprocess_bytes(adb_command(args, serial, adb_args), cwd=args.repo_root, timeout=timeout_seconds)
    if completed.returncode != 0:
        stderr = (completed.stderr or b"").decode("utf-8", errors="replace").strip()
        stdout = (completed.stdout or b"").decode("utf-8", errors="replace").strip()
        raise PhoneProofError(f"adb {' '.join(adb_args)} failed for {serial}: {stderr or stdout}")
    return completed.stdout or b""


def list_adb_devices(args: argparse.Namespace) -> list[str]:
    completed = run_subprocess([str(args.adb), "devices"], cwd=args.repo_root, timeout=20)
    if completed.returncode != 0:
        raise PhoneProofError(f"adb devices failed: {(completed.stderr or completed.stdout).strip()}")
    serials: list[str] = []
    for line in completed.stdout.splitlines():
        match = re.match(r"^(\S+)\s+device$", line.strip())
        if match:
            serials.append(match.group(1))
    return serials


def resolve_adb_serial(args: argparse.Namespace) -> str:
    if args.serial:
        return args.serial
    real_devices = [serial for serial in list_adb_devices(args) if not serial.startswith("emulator-")]
    if len(real_devices) == 1:
        return real_devices[0]
    raise PhoneProofError("Provide --serial or connect exactly one physical Android device")


def fetch_json(url: str) -> Any:
    with urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def find_webview_sockets(text: str) -> list[str]:
    found = re.findall(r"@((?:webview_)?devtools_remote_[0-9]+|webview_devtools_remote_[0-9]+)", str(text or ""))
    ordered: list[str] = []
    for socket_name in found:
        if socket_name not in ordered:
            ordered.append(socket_name)
    def socket_sort_key(name: str) -> tuple[int, str]:
        match = re.search(r"(\d+)$", name)
        return (int(match.group(1)) if match else -1, name)
    return sorted(ordered, key=socket_sort_key, reverse=True)


def pick_free_port(preferred: int = 9222) -> int:
    for port in range(preferred, preferred + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def discover_cover_cdp_url(args: argparse.Namespace, serial: str) -> dict[str, str]:
    sockets_text = run_adb(args, serial, ["shell", "cat", "/proc/net/unix"], timeout_seconds=30)
    sockets = find_webview_sockets(sockets_text)
    if not sockets:
        raise PhoneProofError("Could not find any WebView DevTools sockets on the phone")
    errors: list[str] = []
    for socket_name in sockets:
        port = pick_free_port(args.devtools_port)
        run_adb(args, serial, ["forward", f"tcp:{port}", f"localabstract:{socket_name}"], timeout_seconds=15)
        try:
            pages = fetch_json(f"http://127.0.0.1:{port}/json/list")
            if any("Pucky Cover" in str(page.get("title", "")) for page in (pages or [])):
                return {
                    "socket": socket_name,
                    "cdp_url": f"http://127.0.0.1:{port}",
                    "forward_port": str(port),
                }
            errors.append(f"{socket_name}: cover page not present")
        except Exception as exc:
            errors.append(f"{socket_name}: {exc}")
            run_subprocess(adb_command(args, serial, ["forward", "--remove", f"tcp:{port}"]), cwd=args.repo_root, timeout=10)
            continue
        run_subprocess(adb_command(args, serial, ["forward", "--remove", f"tcp:{port}"]), cwd=args.repo_root, timeout=10)
    raise PhoneProofError("Unable to find Pucky Cover WebView via DevTools sockets: " + "; ".join(errors))


def browser_helper_args(
    args: argparse.Namespace,
    *,
    cdp_url: str,
    request_path: Path,
    output_path: Path,
) -> tuple[list[str], dict[str, str]]:
    env = os.environ.copy()
    node_path = str(args.node_modules)
    env["NODE_PATH"] = node_path if not env.get("NODE_PATH") else os.pathsep.join([node_path, env["NODE_PATH"]])
    argv = [
        str(args.node),
        str(args.browser_helper),
        str(request_path),
    ]
    return argv, env


def run_browser_helper(
    args: argparse.Namespace,
    cdp_url: str,
    operations: list[dict[str, Any]],
    *,
    timeout_seconds: int | float | None = None,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="pucky-phone-proof-") as temp_dir:
        temp_root = Path(temp_dir)
        request_path = temp_root / "request.json"
        output_path = temp_root / "output.json"
        request = {
            "cdp_url": cdp_url,
            "page_title": "Pucky Cover",
            "page_url_contains": "index.html",
            "timeout_ms": int((timeout_seconds or args.browser_timeout_seconds) * 1000),
            "operations": operations,
            "output_path": str(output_path),
        }
        request_path.write_text(json.dumps(request, indent=2) + "\n", encoding="utf-8")
        argv, env = browser_helper_args(args, cdp_url=cdp_url, request_path=request_path, output_path=output_path)
        completed = run_subprocess(argv, cwd=args.repo_root, env=env, timeout=(timeout_seconds or args.browser_timeout_seconds) + 10)
        if completed.returncode != 0 and not output_path.exists():
            raise PhoneProofError(
                f"Browser helper failed: {(completed.stderr or completed.stdout).strip()}"
            )
        payload = json.loads(output_path.read_text(encoding="utf-8"))
        if not payload.get("ok", False):
            raise PhoneProofError(f"Browser helper reported failure: {payload.get('error', 'unknown')}")
        return payload


def shell_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def sapi_wave_command(text: str, output_path: Path, *, voice: str = "", rate: int = 0) -> str:
    lines = [
        "Add-Type -AssemblyName System.Speech",
        "$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    ]
    if voice:
        lines.append(f"$speaker.SelectVoice({shell_quote(voice)})")
    lines += [
        f"$speaker.Rate = {int(rate)}",
        f"$speaker.SetOutputToWaveFile({shell_quote(str(output_path))})",
        f"$speaker.Speak({shell_quote(text)})",
        "$speaker.Dispose()",
    ]
    return "; ".join(lines)


def generate_tts_fixture(args: argparse.Namespace, text: str, label: str) -> Path:
    safe_label = re.sub(r"[^a-z0-9_-]+", "-", label.lower()).strip("-") or "fixture"
    output_path = args.evidence_dir / "fixtures" / f"{safe_label}.wav"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = sapi_wave_command(text, output_path, voice=args.tts_voice, rate=args.tts_rate)
    completed = run_subprocess(
        ["powershell", "-NoProfile", "-Command", command],
        cwd=args.repo_root,
        timeout=90,
    )
    if completed.returncode != 0 or not output_path.exists():
        raise PhoneProofError(f"Unable to synthesize WAV fixture: {(completed.stderr or completed.stdout).strip()}")
    return output_path


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def snapshot_cards(args: argparse.Namespace) -> dict[str, Any]:
    return run_pucky_command(args, "ui.reply_cards.get", {})


def snapshot_surface(args: argparse.Namespace) -> dict[str, Any]:
    return run_pucky_command(args, "ui.surface.get", {})


def thread_scope_status(args: argparse.Namespace) -> dict[str, Any]:
    try:
        return run_pucky_command(args, "voice.thread_scope.get", {})
    except PhoneProofError as exc:
        message = str(exc)
        if "COMMAND_NOT_ALLOWED" not in message and "not allowed" not in message.lower():
            raise
        surface = snapshot_surface(args)
        thread_scope = surface.get("thread_scope")
        if isinstance(thread_scope, dict):
            return thread_scope
        raise PhoneProofError(f"voice.thread_scope.get is unavailable and ui.surface.get had no thread_scope: {message}") from exc


def parse_surfaceflinger_displays(text: str) -> list[dict[str, str]]:
    displays: list[dict[str, str]] = []
    for match in re.finditer(r"Display (\d+) \(HWC display (\d+)\):", str(text or "")):
        displays.append({"display_id": match.group(1), "hwc_display": match.group(2)})
    return displays


def preferred_cover_display_id(text: str) -> str:
    displays = parse_surfaceflinger_displays(text)
    if not displays:
        return ""
    return sorted(displays, key=lambda item: int(item["hwc_display"]))[-1]["display_id"]


def extract_png_bytes(body: bytes) -> bytes:
    header = b"\x89PNG\r\n\x1a\n"
    index = body.find(header)
    if index < 0:
        raise PhoneProofError("device screenshot did not return a PNG")
    return body[index:]


def bundle_status(args: argparse.Namespace) -> dict[str, Any]:
    return run_pucky_command(args, "ui.bundle.status", {})


def status_get(args: argparse.Namespace) -> dict[str, Any]:
    return run_pucky_command(args, "status.get", {})


def turn_status(args: argparse.Namespace) -> dict[str, Any]:
    return run_pucky_command(args, "pucky.turn.status", {})


def turn_read(args: argparse.Namespace, turn_id: str) -> dict[str, Any]:
    result = run_pucky_command(args, "pucky.turn.read", {"turn_id": turn_id})
    turn = result.get("turn")
    return turn if isinstance(turn, dict) else {}


def origin_thread_id(card: dict[str, Any]) -> str:
    origin = card.get("origin")
    if isinstance(origin, dict):
        return str(origin.get("thread_id") or "").strip()
    return ""


def cards_from_snapshot(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    cards = snapshot.get("cards")
    return list(cards) if isinstance(cards, list) else []


def card_text_blob(card: dict[str, Any]) -> str:
    parts = [
        str(card.get("title") or ""),
        str(card.get("summary") or ""),
        str(card.get("transcript") or ""),
    ]
    origin = card.get("origin")
    if isinstance(origin, dict):
        parts.append(str(origin.get("thread_title") or ""))
    for message in transcript_messages(card):
        parts.append(str(message.get("text") or ""))
    return "\n".join(part for part in parts if part)


def continuation_match_tokens(card: dict[str, Any]) -> list[str]:
    tokens: list[str] = []
    for value in (str(card.get("summary") or ""), str(card.get("transcript") or "")):
        for match in re.findall(r"`([^`]+)`", value):
            clean = str(match or "").strip().lower()
            if clean and clean not in tokens:
                tokens.append(clean)
    title = str(((card.get("origin") or {}).get("thread_title") if isinstance(card.get("origin"), dict) else "") or card.get("title") or "").strip().lower()
    if title and title not in tokens:
        tokens.append(title)
    return tokens


def card_matches_continuation_thread(
    card: dict[str, Any],
    source_thread_id: str,
    *,
    source_tokens: list[str],
    excluded_thread_ids: set[str] | None = None,
) -> bool:
    thread_id = origin_thread_id(card)
    if not thread_id:
        return False
    clean_source = str(source_thread_id or "").strip()
    if clean_source and thread_id == clean_source:
        return True
    excluded = {str(item or "").strip() for item in (excluded_thread_ids or set()) if str(item or "").strip()}
    if clean_source:
        excluded.add(clean_source)
    if thread_id in excluded:
        return False
    blob = card_text_blob(card).lower()
    return any(token and token in blob for token in source_tokens)


def card_matches_title(card: dict[str, Any], title_contains: str) -> bool:
    needle = str(title_contains or "").strip().lower()
    if not needle:
        return True
    return needle in card_text_blob(card).lower()


def card_has_page_surface(card: dict[str, Any]) -> bool:
    if str(card.get("html_path") or "").strip():
        return True
    messages = card.get("transcript_messages")
    if not isinstance(messages, list):
        return False
    for message in messages:
        attachments = message.get("attachments") if isinstance(message, dict) else None
        if not isinstance(attachments, list):
            continue
        if attachments:
            return True
    return False


def transcript_messages(card: dict[str, Any]) -> list[dict[str, Any]]:
    messages = card.get("transcript_messages")
    return [item for item in messages if isinstance(item, dict)] if isinstance(messages, list) else []


def message_attachments(message: dict[str, Any]) -> list[dict[str, Any]]:
    attachments = message.get("attachments")
    return [item for item in attachments if isinstance(item, dict)] if isinstance(attachments, list) else []


def card_has_user_audio_chip(card: dict[str, Any]) -> bool:
    for message in transcript_messages(card):
        if str(message.get("role") or "").lower() != "user":
            continue
        for attachment in message_attachments(message):
            kind = str(attachment.get("kind") or "").lower()
            mime = str(attachment.get("mime_type") or "").lower()
            if kind == "audio" or mime.startswith("audio/"):
                return True
    return False


def card_has_assistant_artifact(card: dict[str, Any]) -> bool:
    if str(card.get("html_path") or "").strip():
        return True
    for key in ("attachments", "images"):
        value = card.get(key)
        if isinstance(value, list) and value:
            return True
    for message in transcript_messages(card):
        if str(message.get("role") or "").lower() == "assistant" and message_attachments(message):
            return True
    return False


def select_card(
    cards: list[dict[str, Any]],
    *,
    title_contains: str = "",
    required_thread_id: str = "",
    require_thread: bool = True,
    require_page: bool = False,
    excluded_thread_ids: set[str] | None = None,
) -> dict[str, Any]:
    excluded = excluded_thread_ids or set()
    required_thread = str(required_thread_id or "").strip()
    matches: list[dict[str, Any]] = []
    for card in cards:
        if bool(card.get("pending_outbound")):
            continue
        thread_id = origin_thread_id(card)
        if require_thread and not thread_id:
            continue
        if required_thread and thread_id != required_thread:
            continue
        if thread_id and thread_id in excluded:
            continue
        if require_page and not card_has_page_surface(card):
            continue
        if not card_matches_title(card, title_contains):
            continue
        matches.append(card)
    if not matches:
        raise PhoneProofError(
            f"No reply card matched title={title_contains!r} require_thread={require_thread} require_page={require_page}"
        )
    return matches[0]


def thread_cards(snapshot: dict[str, Any], thread_id: str) -> list[dict[str, Any]]:
    clean = str(thread_id or "").strip()
    return [card for card in cards_from_snapshot(snapshot) if origin_thread_id(card) == clean]


def pending_thread_card(snapshot: dict[str, Any], thread_id: str) -> dict[str, Any] | None:
    for card in thread_cards(snapshot, thread_id):
        if bool(card.get("pending_outbound")):
            return card
    return None


def final_thread_card(snapshot: dict[str, Any], thread_id: str) -> dict[str, Any] | None:
    cards = thread_cards(snapshot, thread_id)
    for card in cards:
        if not bool(card.get("pending_outbound")):
            return card
    return cards[0] if cards else None


def card_for_turn(snapshot: dict[str, Any], turn_id: str) -> dict[str, Any] | None:
    clean = str(turn_id or "").strip()
    if not clean:
        return None
    for card in cards_from_snapshot(snapshot):
        candidate = str(card.get("turn_id") or card.get("session_id") or "").strip()
        if candidate == clean and not bool(card.get("pending_outbound")):
            return card
    return None


def turn_record_with_reply_card(record: dict[str, Any], card: dict[str, Any], turn_id: str) -> dict[str, Any]:
    merged = dict(record)
    merged["reply_card_saved"] = True
    merged.setdefault("turn_id", str(turn_id or ""))
    merged.setdefault("card_id", str(card.get("card_id") or ""))
    merged.setdefault("session_id", str(card.get("session_id") or ""))
    if not str(merged.get("user_transcript") or "").strip():
        for message in transcript_messages(card):
            if str(message.get("role") or "").lower() == "user" and str(message.get("text") or "").strip():
                merged["user_transcript"] = str(message.get("text") or "")
                break
    if not isinstance(merged.get("server_telemetry"), dict):
        merged["server_telemetry"] = {}
    return merged


def reply_saved_turn_record(args: argparse.Namespace, turn_id: str) -> dict[str, Any]:
    record = turn_read(args, turn_id)
    if record.get("reply_card_saved"):
        return record
    card = card_for_turn(snapshot_cards(args), turn_id)
    if card is not None:
        return turn_record_with_reply_card(record, card, turn_id)
    return record


def wait_for(
    predicate: Callable[[], Any],
    *,
    timeout_seconds: int | float,
    interval_seconds: float = 0.5,
    description: str,
) -> Any:
    deadline = time.monotonic() + timeout_seconds
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except Exception as exc:  # pragma: no cover - polling should tolerate transient failures
            last_error = exc
        time.sleep(interval_seconds)
    if last_error is not None:
        raise PhoneProofError(f"Timed out waiting for {description}: {last_error}")
    raise PhoneProofError(f"Timed out waiting for {description}")


def walkie_start_payload(
    fixture_path: str,
    transcript_hint: str,
    *,
    proof_reply_delay_ms: int = 0,
) -> dict[str, Any]:
    payload = {
        "trigger_source": "volume_up_hold",
        "capture_source": "fixture",
        "fixture_path": fixture_path,
        "debug_fixture_transcript": transcript_hint,
        "fixture_start_delay_ms": 250,
        "auto_endpoint": True,
        "speech_start_timeout_ms": 3000,
        "trailing_silence_ms": 800,
        "min_speech_ms": 180,
        "max_duration_ms": 20000,
        "feedback": False,
    }
    if int(proof_reply_delay_ms or 0) > 0:
        payload["proof_reply_delay_ms"] = int(proof_reply_delay_ms)
    return payload


def put_fixture_for_text(args: argparse.Namespace, text: str, label: str) -> dict[str, Any]:
    local_fixture = generate_tts_fixture(args, text, label)
    remote_fixture = run_pucky_file_put(args, local_fixture, filename=local_fixture.name, timeout_seconds=180)
    if not str(remote_fixture.get("path") or "").strip():
        raise PhoneProofError("file.put did not return a remote path")
    return {
        "local_path": str(local_fixture),
        "remote": remote_fixture,
    }


def start_fixture_turn(
    args: argparse.Namespace,
    fixture_path: str,
    transcript_hint: str,
    *,
    proof_reply_delay_ms: int = 0,
) -> dict[str, Any]:
    return run_pucky_command(
        args,
        "pucky.turn.start",
        walkie_start_payload(fixture_path, transcript_hint, proof_reply_delay_ms=proof_reply_delay_ms),
        timeout_seconds=120,
    )


def wait_for_scope(args: argparse.Namespace, thread_id: str, source_surface: str) -> dict[str, Any]:
    def check() -> dict[str, Any] | None:
        current = thread_scope_status(args)
        if current.get("mode") == "existing_thread" and current.get("thread_id") == thread_id:
            if source_surface and current.get("source_surface") != source_surface:
                return None
            return current
        return None
    return wait_for(check, timeout_seconds=20, interval_seconds=0.5, description=f"scope {thread_id} {source_surface}")


def wait_for_new_thread_scope(args: argparse.Namespace) -> dict[str, Any]:
    def check() -> dict[str, Any] | None:
        current = thread_scope_status(args)
        if current.get("mode") == "new_thread" and not str(current.get("thread_id") or "").strip():
            return current
        return None
    return wait_for(check, timeout_seconds=20, interval_seconds=0.5, description="new-thread scope")


def wait_for_turn_not_recording(args: argparse.Namespace, turn_id: str) -> dict[str, Any]:
    def check() -> dict[str, Any] | None:
        record = turn_read(args, turn_id)
        if str(record.get("latest_state") or "") not in {"", "armed", "recording"}:
            return record
        return None
    return wait_for(check, timeout_seconds=30, interval_seconds=0.5, description=f"turn {turn_id} to leave recording")


def wait_for_turn_transcript(args: argparse.Namespace, turn_id: str) -> dict[str, Any]:
    def check() -> dict[str, Any] | None:
        record = turn_read(args, turn_id)
        if str(record.get("user_transcript") or "").strip():
            return record
        return None
    return wait_for(check, timeout_seconds=90, interval_seconds=0.75, description=f"user transcript for {turn_id}")


def wait_for_turn_reply_saved(args: argparse.Namespace, turn_id: str) -> dict[str, Any]:
    def check() -> dict[str, Any] | None:
        record = reply_saved_turn_record(args, turn_id)
        if record.get("reply_card_saved"):
            return record
        return None
    return wait_for(check, timeout_seconds=180, interval_seconds=1.0, description=f"reply for {turn_id}")


def browser_ops_for_card_open(card: dict[str, Any], action: str, expected_detail_type: str) -> list[dict[str, Any]]:
    return [
        {"kind": "goto_home"},
        {"kind": "open_card_action", "session_id": str(card.get("session_id") or card.get("local_session_id") or ""), "action": action, "expected_detail_type": expected_detail_type},
        {"kind": "describe"},
    ]


def screenshot_operation(path: Path) -> dict[str, Any]:
    return {"kind": "screenshot", "path": str(path)}


def installed_package_info(args: argparse.Namespace, serial: str) -> dict[str, str]:
    text = run_adb(args, serial, ["shell", "dumpsys", "package", args.package_name], timeout_seconds=30)
    version_code = ""
    version_name = ""
    code_match = re.search(r"versionCode=(\d+)", text)
    name_match = re.search(r"versionName=([^\s]+)", text)
    if code_match:
        version_code = code_match.group(1)
    if name_match:
        version_name = name_match.group(1)
    return {
        "package_name": args.package_name,
        "version_code": version_code,
        "version_name": version_name,
    }


def apk_identity(args: argparse.Namespace) -> dict[str, Any]:
    status = status_get(args)
    identity = status.get("apk_identity")
    return identity if isinstance(identity, dict) else {}


def capture_device_screenshot(args: argparse.Namespace, serial: str, path: Path) -> Path:
    display_text = run_adb(args, serial, ["shell", "dumpsys", "SurfaceFlinger", "--display-id"], timeout_seconds=30)
    display_id = preferred_cover_display_id(display_text)
    screencap_args = ["exec-out", "screencap", "-p"] if not display_id else ["exec-out", "screencap", "-d", display_id, "-p"]
    body = extract_png_bytes(run_adb_bytes(args, serial, screencap_args, timeout_seconds=30))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return path


def visible_cards(surface_result: dict[str, Any]) -> list[dict[str, Any]]:
    final_surface = surface_result.get("final_surface") if isinstance(surface_result, dict) else {}
    cards = final_surface.get("visible_cards") if isinstance(final_surface, dict) else []
    return [card for card in cards if isinstance(card, dict)]


def visible_thread_index(surface_result: dict[str, Any], thread_id: str) -> int:
    for index, card in enumerate(visible_cards(surface_result)):
        if str(card.get("thread_id") or "").strip() == str(thread_id or "").strip():
            return index
    return -1


def visible_thread_card(surface_result: dict[str, Any], thread_id: str) -> dict[str, Any] | None:
    for card in visible_cards(surface_result):
        if str(card.get("thread_id") or "").strip() == str(thread_id or "").strip():
            return card
    return None


def scenario_checks(checks: dict[str, bool]) -> dict[str, Any]:
    normalized = {key: bool(value) for key, value in checks.items()}
    return {"passed": all(normalized.values()), "checks": normalized}


def expected_ui_manifest(args: argparse.Namespace, local_git: dict[str, object]) -> dict[str, Any] | None:
    if args.skip_official_preproof_check:
        return None
    manifest_url = official_html.cache_busted_url(args.manifest_url, local_git["head_short"])
    remote_manifest = official_html.fetch_json(manifest_url)
    return official_html.validate_remote_manifest(remote_manifest, local_git)


def verify_target_identity(
    args: argparse.Namespace,
    *,
    local_git: dict[str, object],
    remote_manifest: dict[str, Any] | None,
    bundle: dict[str, Any],
    surface: dict[str, Any],
    installed_package: dict[str, str],
    identity: dict[str, Any],
) -> dict[str, Any]:
    checks = {
        "local_head_matches_upstream": str(local_git.get("head") or "") == str(local_git.get("upstream") or ""),
        "bundle_installed": bool(bundle.get("installed")),
        "apk_git_commit_matches": str(identity.get("git_commit") or "") == str(local_git.get("head") or ""),
        "apk_git_dirty_false": bool(identity.get("git_dirty")) is False,
        "package_version_name_matches_identity": str(installed_package.get("version_name") or "") == str(identity.get("version_name") or ""),
        "package_version_code_matches_identity": str(installed_package.get("version_code") or "") == str(identity.get("version_code") or ""),
    }
    if remote_manifest is not None:
        official_html.verify_bundle_status(bundle, remote_manifest, local_git)
        checks["bundle_ui_version_matches_manifest"] = str(bundle.get("ui_version") or "") == str(remote_manifest.get("ui_version") or "")
        checks["surface_ui_version_matches_manifest"] = str(surface.get("ui_version") or "") == str(remote_manifest.get("ui_version") or "")
    result = scenario_checks(checks)
    if not result["passed"]:
        raise PhoneProofError(f"target identity mismatch: {json.dumps(result['checks'], sort_keys=True)}")
    return result


def wait_for_turns_reply_saved(args: argparse.Namespace, turn_ids: list[str]) -> tuple[dict[str, dict[str, Any]], list[str]]:
    pending = [turn_id for turn_id in turn_ids if turn_id]
    completed: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    deadline = time.time() + 240
    while pending and time.time() < deadline:
        for turn_id in list(pending):
            record = reply_saved_turn_record(args, turn_id)
            if record.get("reply_card_saved"):
                completed[turn_id] = record
                order.append(turn_id)
                pending.remove(turn_id)
        if pending:
            time.sleep(0.5)
    if pending:
        raise PhoneProofError(f"Timed out waiting for replies: {', '.join(pending)}")
    return completed, order


def capture_phase(
    args: argparse.Namespace,
    *,
    serial: str,
    cdp_url: str,
    operations: list[dict[str, Any]],
    scenario_dir: Path,
    browser_name: str,
    device_name: str,
    timeout_seconds: int | float,
) -> dict[str, Any]:
    result = run_browser_helper(args, cdp_url, operations, timeout_seconds=timeout_seconds)
    save_json(scenario_dir / browser_name, result)
    capture_device_screenshot(args, serial, scenario_dir / device_name)
    return result


def run_continuation_scenario(
    args: argparse.Namespace,
    *,
    serial: str,
    name: str,
    cdp_url: str,
    card: dict[str, Any],
    action: str,
    expected_surface: str,
    text: str,
    scenario_dir: Path,
) -> dict[str, Any]:
    before_cards = snapshot_cards(args)
    before_surface = snapshot_surface(args)
    source_thread_id = origin_thread_id(card)
    if not source_thread_id:
        raise PhoneProofError(f"{name} source card is missing origin.thread_id")
    home_before = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "goto_home"}, {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="home-before.json",
        device_name="home-before-device.png",
        timeout_seconds=30,
    )
    open_result = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=browser_ops_for_card_open(
            card,
            action,
            "transcript" if action == "transcript" else ("page" if action == "page" else "attachment"),
        ) + [screenshot_operation(scenario_dir / "before-send.png")],
        scenario_dir=scenario_dir,
        browser_name="before-send.json",
        device_name="before-send-device.png",
        timeout_seconds=60,
    )
    scope_before = wait_for_scope(args, source_thread_id, expected_surface)
    turn_status_before = turn_status(args)
    fixture = put_fixture_for_text(args, text, name)
    start = start_fixture_turn(args, str(fixture["remote"]["path"]), text)
    turn_id = str(start.get("turn_id") or "")
    if not turn_id:
        raise PhoneProofError(f"{name} did not return a turn_id")
    home_after_start = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "back"}, {"kind": "goto_home"}, screenshot_operation(scenario_dir / "pending.png"), {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="pending.json",
        device_name="pending-device.png",
        timeout_seconds=60,
    )

    def pending_check() -> dict[str, Any] | None:
        snapshot = snapshot_cards(args)
        card_now = pending_thread_card(snapshot, source_thread_id)
        if card_now is None:
            return None
        if card_now.get("title") != "Sent message":
            return None
        if len(thread_cards(snapshot, source_thread_id)) != 1:
            raise PhoneProofError(f"{name} produced multiple visible tiles for thread {source_thread_id}")
        return {"snapshot": snapshot, "card": card_now}

    pending = wait_for(pending_check, timeout_seconds=60, interval_seconds=0.75, description=f"{name} pending sent card")
    turn_status_pending = turn_status(args)
    transcript_turn = wait_for_turn_transcript(args, turn_id)
    transcript_snapshot = snapshot_cards(args)
    home_with_transcript = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "goto_home"}, screenshot_operation(scenario_dir / "transcript-known.png"), {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="transcript-known.json",
        device_name="transcript-known-device.png",
        timeout_seconds=45,
    )
    turn_status_transcript = turn_status(args)
    final_turn = wait_for_turn_reply_saved(args, turn_id)
    final_snapshot = snapshot_cards(args)
    home_after_reply = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "goto_home"}, screenshot_operation(scenario_dir / "reply-complete.png"), {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="reply-complete.json",
        device_name="reply-complete-device.png",
        timeout_seconds=45,
    )
    turn_status_final = turn_status(args)
    final_card = final_thread_card(final_snapshot, source_thread_id)
    if final_card is None:
        raise PhoneProofError(f"{name} did not leave a final visible tile on thread {source_thread_id}")
    if len(thread_cards(final_snapshot, source_thread_id)) != 1:
        raise PhoneProofError(f"{name} left multiple visible cards on thread {source_thread_id}")
    before_index = visible_thread_index(home_before, source_thread_id)
    pending_card = visible_thread_card(home_after_start, source_thread_id) or {}
    transcript_card = visible_thread_card(home_with_transcript, source_thread_id) or {}
    reply_card = visible_thread_card(home_after_reply, source_thread_id) or {}
    checks = scenario_checks(
        {
            "scope_matches_thread": str(scope_before.get("thread_id") or "") == source_thread_id,
            "scope_matches_surface": str(scope_before.get("source_surface") or "") == expected_surface,
            "pending_tile_reused_thread": origin_thread_id(pending["card"]) == source_thread_id,
            "pending_tile_kind": str(pending_card.get("kind") or "") == "pending_outbound",
            "pending_placeholder_visible": "sending your message" in str(pending_card.get("preview") or "").strip().lower(),
            "pending_same_visible_slot": before_index >= 0 and visible_thread_index(home_after_start, source_thread_id) == before_index,
            "pending_single_visible_tile": len(thread_cards(pending["snapshot"], source_thread_id)) == 1,
            "transcript_preview_matches_user": str(transcript_turn.get("user_transcript") or "").strip().lower() in str(transcript_card.get("preview") or "").strip().lower(),
            "final_thread_reused": origin_thread_id(final_card) == source_thread_id,
            "final_single_visible_tile": len(thread_cards(final_snapshot, source_thread_id)) == 1,
            "final_same_visible_slot": before_index >= 0 and visible_thread_index(home_after_reply, source_thread_id) == before_index,
            "no_duplicate_visible_tile": sum(1 for item in cards_from_snapshot(final_snapshot) if origin_thread_id(item) == source_thread_id) == 1,
            "reply_home_is_not_pending": str(reply_card.get("kind") or "") != "pending_outbound",
        }
    )
    if not checks["passed"]:
        raise PhoneProofError(f"{name} checks failed: {json.dumps(checks['checks'], sort_keys=True)}")
    return {
        "scenario": name,
        "source_card": card,
        "source_thread_id": source_thread_id,
        "before_surface": before_surface,
        "before_cards": before_cards,
        "home_before": home_before,
        "open_result": open_result,
        "scope_before": scope_before,
        "turn_status_before": turn_status_before,
        "fixture": fixture,
        "turn_start": start,
        "pending": pending,
        "turn_status_pending": turn_status_pending,
        "turn_with_transcript": transcript_turn,
        "transcript_snapshot": transcript_snapshot,
        "turn_status_transcript": turn_status_transcript,
        "turn_final": final_turn,
        "final_snapshot": final_snapshot,
        "turn_status_final": turn_status_final,
        "final_card": final_card,
        "home_after_start": home_after_start,
        "home_with_transcript": home_with_transcript,
        "home_after_reply": home_after_reply,
        "checks": checks,
    }


def run_feed_focus_scenario(
    args: argparse.Namespace,
    *,
    serial: str,
    cdp_url: str,
    card: dict[str, Any],
    text: str,
    scenario_dir: Path,
) -> dict[str, Any]:
    before_cards = snapshot_cards(args)
    source_thread_id = origin_thread_id(card)
    if not source_thread_id:
        raise PhoneProofError("feed focus source card is missing origin.thread_id")
    home_before = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "goto_home"}, {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="home-before.json",
        device_name="home-before-device.png",
        timeout_seconds=30,
    )
    focused = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[
            {"kind": "goto_home"},
            {"kind": "focus_card", "session_id": str(card.get("session_id") or card.get("local_session_id") or "")},
            screenshot_operation(scenario_dir / "before-send.png"),
            {"kind": "describe"},
        ],
        scenario_dir=scenario_dir,
        browser_name="before-send.json",
        device_name="before-send-device.png",
        timeout_seconds=45,
    )
    scope_before = wait_for_scope(args, source_thread_id, "feed_tile_selected")
    turn_status_before = turn_status(args)
    fixture = put_fixture_for_text(args, text, "feed-focus")
    start = start_fixture_turn(args, str(fixture["remote"]["path"]), text)
    turn_id = str(start.get("turn_id") or "")
    if not turn_id:
        raise PhoneProofError("feed focus scenario did not return a turn_id")
    home_after_start = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "clear_focus"}, {"kind": "goto_home"}, screenshot_operation(scenario_dir / "pending.png"), {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="pending.json",
        device_name="pending-device.png",
        timeout_seconds=60,
    )

    def pending_check() -> dict[str, Any] | None:
        snapshot = snapshot_cards(args)
        card_now = pending_thread_card(snapshot, source_thread_id)
        if card_now is None or card_now.get("title") != "Sent message":
            return None
        if len(thread_cards(snapshot, source_thread_id)) != 1:
            raise PhoneProofError(f"feed focus produced multiple visible tiles for thread {source_thread_id}")
        return {"snapshot": snapshot, "card": card_now}

    pending = wait_for(pending_check, timeout_seconds=60, interval_seconds=0.75, description="feed focus pending sent card")
    turn_status_pending = turn_status(args)
    transcript_turn = wait_for_turn_transcript(args, turn_id)
    home_with_transcript = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "goto_home"}, screenshot_operation(scenario_dir / "transcript-known.png"), {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="transcript-known.json",
        device_name="transcript-known-device.png",
        timeout_seconds=45,
    )
    final_turn = wait_for_turn_reply_saved(args, turn_id)
    final_snapshot = snapshot_cards(args)
    home_after_reply = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "goto_home"}, screenshot_operation(scenario_dir / "reply-complete.png"), {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="reply-complete.json",
        device_name="reply-complete-device.png",
        timeout_seconds=45,
    )
    final_card = final_thread_card(final_snapshot, source_thread_id)
    if final_card is None:
        raise PhoneProofError("feed focus did not leave a final visible tile")
    before_index = visible_thread_index(home_before, source_thread_id)
    pending_card = visible_thread_card(home_after_start, source_thread_id) or {}
    transcript_card = visible_thread_card(home_with_transcript, source_thread_id) or {}
    reply_card = visible_thread_card(home_after_reply, source_thread_id) or {}
    checks = scenario_checks(
        {
            "focused_card_matches_thread": ((focused.get("final_surface") or {}).get("focused_card") or {}).get("thread_id") == source_thread_id,
            "scope_matches_thread": str(scope_before.get("thread_id") or "") == source_thread_id,
            "scope_matches_surface": str(scope_before.get("source_surface") or "") == "feed_tile_selected",
            "pending_tile_reused_thread": origin_thread_id(pending["card"]) == source_thread_id,
            "pending_tile_kind": str(pending_card.get("kind") or "") == "pending_outbound",
            "pending_placeholder_visible": "sending your message" in str(pending_card.get("preview") or "").strip().lower(),
            "pending_same_visible_slot": before_index >= 0 and visible_thread_index(home_after_start, source_thread_id) == before_index,
            "pending_single_visible_tile": len(thread_cards(pending["snapshot"], source_thread_id)) == 1,
            "transcript_preview_matches_user": str(transcript_turn.get("user_transcript") or "").strip().lower() in str(transcript_card.get("preview") or "").strip().lower(),
            "final_thread_reused": origin_thread_id(final_card) == source_thread_id,
            "final_same_visible_slot": before_index >= 0 and visible_thread_index(home_after_reply, source_thread_id) == before_index,
            "no_duplicate_visible_tile": sum(1 for item in cards_from_snapshot(final_snapshot) if origin_thread_id(item) == source_thread_id) == 1,
            "reply_home_is_not_pending": str(reply_card.get("kind") or "") != "pending_outbound",
        }
    )
    if not checks["passed"]:
        raise PhoneProofError(f"feed focus checks failed: {json.dumps(checks['checks'], sort_keys=True)}")
    return {
        "scenario": "feed_focus",
        "source_card": card,
        "source_thread_id": source_thread_id,
        "before_cards": before_cards,
        "home_before": home_before,
        "focused": focused,
        "scope_before": scope_before,
        "turn_status_before": turn_status_before,
        "fixture": fixture,
        "turn_start": start,
        "pending": pending,
        "turn_status_pending": turn_status_pending,
        "turn_with_transcript": transcript_turn,
        "turn_final": final_turn,
        "final_snapshot": final_snapshot,
        "final_card": final_card,
        "home_after_reply": home_after_reply,
        "checks": checks,
    }


def run_history_scenario(
    args: argparse.Namespace,
    *,
    serial: str,
    cdp_url: str,
    card: dict[str, Any],
    text: str,
    scenario_dir: Path,
) -> dict[str, Any]:
    setup = run_continuation_scenario(
        args,
        serial=serial,
        name="history_retention_setup",
        cdp_url=cdp_url,
        card=card,
        action="transcript",
        expected_surface="thread_transcript",
        text=text,
        scenario_dir=scenario_dir / "setup",
    )
    source_thread_id = str(setup.get("source_thread_id") or "")
    final_card = setup.get("final_card") if isinstance(setup.get("final_card"), dict) else {}
    transcript_open = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=browser_ops_for_card_open(final_card, "transcript", "transcript") + [screenshot_operation(scenario_dir / "before-send.png")],
        scenario_dir=scenario_dir,
        browser_name="history-transcript.json",
        device_name="history-transcript-device.png",
        timeout_seconds=60,
    )
    transcript_scope = wait_for_scope(args, source_thread_id, "thread_transcript")
    attachment_open = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[
            {"kind": "open_card_action", "session_id": str(final_card.get("session_id") or ""), "action": "attachment", "expected_detail_type": "attachment"},
            screenshot_operation(scenario_dir / "reply-complete.png"),
            {"kind": "describe"},
        ],
        scenario_dir=scenario_dir,
        browser_name="history-attachment.json",
        device_name="history-attachment-device.png",
        timeout_seconds=60,
    )
    attachment_scope = wait_for_scope(args, source_thread_id, "thread_attachment")
    final_snapshot = snapshot_cards(args)
    checks = scenario_checks(
        {
            "thread_transcript_scope": str(transcript_scope.get("thread_id") or "") == source_thread_id,
            "thread_attachment_scope": str(attachment_scope.get("thread_id") or "") == source_thread_id,
            "user_audio_chip_exists": card_has_user_audio_chip(final_card),
            "assistant_artifact_exists": card_has_assistant_artifact(final_card),
            "home_single_latest_tile": len(thread_cards(final_snapshot, source_thread_id)) == 1,
            "attachment_detail_matches_thread": ((attachment_open.get("final_surface") or {}).get("detail") or {}).get("thread_id") == source_thread_id,
        }
    )
    if not checks["passed"]:
        raise PhoneProofError(f"history checks failed: {json.dumps(checks['checks'], sort_keys=True)}")
    return {
        "scenario": "history",
        "setup": setup,
        "source_thread_id": source_thread_id,
        "transcript_open": transcript_open,
        "attachment_open": attachment_open,
        "transcript_scope": transcript_scope,
        "attachment_scope": attachment_scope,
        "final_snapshot": final_snapshot,
        "checks": checks,
    }


def run_negative_scenario(
    args: argparse.Namespace,
    *,
    serial: str,
    cdp_url: str,
    text: str,
    scenario_dir: Path,
) -> dict[str, Any]:
    before_cards = snapshot_cards(args)
    before_thread_ids = {origin_thread_id(card) for card in cards_from_snapshot(before_cards) if origin_thread_id(card)}
    home_before = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "back"}, {"kind": "goto_home"}, screenshot_operation(scenario_dir / "before-send.png"), {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="before-send.json",
        device_name="before-send-device.png",
        timeout_seconds=45,
    )
    scope_before = wait_for_new_thread_scope(args)
    turn_status_before = turn_status(args)
    fixture = put_fixture_for_text(args, text, "negative-home")
    start = start_fixture_turn(args, str(fixture["remote"]["path"]), text)
    turn_id = str(start.get("turn_id") or "")
    if not turn_id:
        raise PhoneProofError("negative scenario did not return a turn_id")
    final_turn = wait_for_turn_reply_saved(args, turn_id)
    final_snapshot = snapshot_cards(args)
    final_card_id = str(final_turn.get("card_id") or "")
    final_card = None
    for card in cards_from_snapshot(final_snapshot):
        if str(card.get("card_id") or "") == final_card_id:
            final_card = card
            break
    if final_card is None:
        raise PhoneProofError("negative scenario did not create a visible new thread tile")
    final_thread_id = origin_thread_id(final_card)
    if final_thread_id and final_thread_id in before_thread_ids:
        raise PhoneProofError("negative scenario reused an existing thread instead of creating a new one")
    turn_status_final = turn_status(args)
    home_after_reply = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "goto_home"}, screenshot_operation(scenario_dir / "reply-complete.png"), {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="reply-complete.json",
        device_name="reply-complete-device.png",
        timeout_seconds=45,
    )
    checks = scenario_checks(
        {
            "scope_is_new_thread": str(scope_before.get("mode") or "") == "new_thread",
            "scope_has_no_thread_id": not str(scope_before.get("thread_id") or "").strip(),
            "final_card_exists": final_card is not None,
            "result_thread_is_new": bool(final_thread_id) and final_thread_id not in before_thread_ids,
            "home_has_visible_result_thread": visible_thread_index(home_after_reply, final_thread_id) >= 0 if final_thread_id else True,
        }
    )
    if not checks["passed"]:
        raise PhoneProofError(f"negative scenario checks failed: {json.dumps(checks['checks'], sort_keys=True)}")
    return {
        "scenario": "negative_home",
        "before_cards": before_cards,
        "home_before": home_before,
        "scope_before": scope_before,
        "turn_status_before": turn_status_before,
        "fixture": fixture,
        "turn_start": start,
        "turn_final": final_turn,
        "turn_status_final": turn_status_final,
        "final_snapshot": final_snapshot,
        "final_card": final_card,
        "home_after_reply": home_after_reply,
        "checks": checks,
    }


def run_final_boss_scenario(
    args: argparse.Namespace,
    *,
    serial: str,
    cdp_url: str,
    scenario_dir: Path,
) -> dict[str, Any]:
    cards = cards_from_snapshot(snapshot_cards(args))
    card_a = select_card(
        cards,
        title_contains=args.final_boss_thread_a_title_contains,
        required_thread_id=args.final_boss_thread_a_id,
        require_thread=True,
    )
    card_b = select_card(
        cards,
        title_contains=args.final_boss_thread_b_title_contains,
        required_thread_id=args.final_boss_thread_b_id,
        require_thread=True,
        excluded_thread_ids={origin_thread_id(card_a)},
    )
    thread_a = origin_thread_id(card_a)
    thread_b = origin_thread_id(card_b)
    if not thread_a or not thread_b or thread_a == thread_b:
        raise PhoneProofError("Final boss requires two different thread-backed cards")

    fixture_a = put_fixture_for_text(args, args.final_boss_text_a, "final-boss-a")
    fixture_b = put_fixture_for_text(args, args.final_boss_text_new, "final-boss-new")
    fixture_c = put_fixture_for_text(args, args.final_boss_text_b, "final-boss-b")

    home_before = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "goto_home"}, {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="home-before.json",
        device_name="home-before-device.png",
        timeout_seconds=30,
    )
    open_a = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=browser_ops_for_card_open(card_a, "transcript", "transcript") + [screenshot_operation(scenario_dir / "thread-a-before.png")],
        scenario_dir=scenario_dir,
        browser_name="thread-a-before.json",
        device_name="thread-a-before-device.png",
        timeout_seconds=60,
    )
    scope_a = wait_for_scope(args, thread_a, "thread_transcript")
    turn_status_before_a = turn_status(args)
    start_a = start_fixture_turn(
        args,
        str(fixture_a["remote"]["path"]),
        args.final_boss_text_a,
        proof_reply_delay_ms=args.final_boss_delay_ms_a,
    )
    turn_a = str(start_a.get("turn_id") or "")
    wait_for_turn_not_recording(args, turn_a)

    open_new = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "back"}, {"kind": "goto_home"}, screenshot_operation(scenario_dir / "new-thread-before.png"), {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="new-thread-before.json",
        device_name="new-thread-before-device.png",
        timeout_seconds=45,
    )
    scope_new = wait_for_new_thread_scope(args)
    turn_status_before_new = turn_status(args)
    start_b = start_fixture_turn(
        args,
        str(fixture_b["remote"]["path"]),
        args.final_boss_text_new,
        proof_reply_delay_ms=args.final_boss_delay_ms_new,
    )
    turn_b = str(start_b.get("turn_id") or "")
    wait_for_turn_not_recording(args, turn_b)

    open_b = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=browser_ops_for_card_open(card_b, "transcript", "transcript") + [screenshot_operation(scenario_dir / "thread-b-before.png")],
        scenario_dir=scenario_dir,
        browser_name="thread-b-before.json",
        device_name="thread-b-before-device.png",
        timeout_seconds=60,
    )
    scope_b = wait_for_scope(args, thread_b, "thread_transcript")
    turn_status_before_b = turn_status(args)
    start_c = start_fixture_turn(
        args,
        str(fixture_c["remote"]["path"]),
        args.final_boss_text_b,
        proof_reply_delay_ms=args.final_boss_delay_ms_b,
    )
    turn_c = str(start_c.get("turn_id") or "")

    results_by_turn, completion_order = wait_for_turns_reply_saved(args, [turn_a, turn_b, turn_c])
    final_a = results_by_turn[turn_a]
    final_b = results_by_turn[turn_b]
    final_c = results_by_turn[turn_c]
    final_snapshot = snapshot_cards(args)
    turn_status_final = turn_status(args)
    home_after_reply = capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=[{"kind": "goto_home"}, screenshot_operation(scenario_dir / "reply-complete.png"), {"kind": "describe"}],
        scenario_dir=scenario_dir,
        browser_name="reply-complete.json",
        device_name="reply-complete-device.png",
        timeout_seconds=45,
    )

    def card_by_id(snapshot: dict[str, Any], card_id: str) -> dict[str, Any] | None:
        for item in cards_from_snapshot(snapshot):
            if str(item.get("card_id") or "") == str(card_id or ""):
                return item
        return None

    card_result_a = card_by_id(final_snapshot, str(final_a.get("card_id") or ""))
    card_result_b = card_by_id(final_snapshot, str(final_b.get("card_id") or ""))
    card_result_c = card_by_id(final_snapshot, str(final_c.get("card_id") or ""))
    continuation_tokens_a = continuation_match_tokens(card_a)
    continuation_tokens_b = continuation_match_tokens(card_b)
    turn_a_matches = card_result_a is not None and card_matches_continuation_thread(
        card_result_a,
        thread_a,
        source_tokens=continuation_tokens_a,
        excluded_thread_ids={thread_b},
    )
    turn_c_matches = card_result_c is not None and card_matches_continuation_thread(
        card_result_c,
        thread_b,
        source_tokens=continuation_tokens_b,
        excluded_thread_ids={thread_a},
    )
    if not turn_a_matches:
        raise PhoneProofError("Final boss turn A did not land back on thread A")
    if not turn_c_matches:
        raise PhoneProofError("Final boss turn C did not land back on thread B")
    middle_thread = origin_thread_id(card_result_b or {})
    if middle_thread in {thread_a, thread_b}:
        raise PhoneProofError("Final boss middle turn reused an existing thread unexpectedly")
    expected_order = [turn_c, turn_b, turn_a]
    checks = scenario_checks(
        {
            "scope_a_matches": str(scope_a.get("thread_id") or "") == thread_a,
            "scope_new_is_unscoped": str(scope_new.get("mode") or "") == "new_thread",
            "scope_b_matches": str(scope_b.get("thread_id") or "") == thread_b,
            "turn_a_continued_thread_a": turn_a_matches,
            "turn_b_created_new_thread": middle_thread not in {thread_a, thread_b} and bool(middle_thread),
            "turn_c_continued_thread_b": turn_c_matches,
            "completion_order_out_of_order": completion_order == expected_order,
            "delay_a_applied": int((final_a.get("server_telemetry") or {}).get("proof_reply_delay_ms_applied") or 0) == args.final_boss_delay_ms_a,
            "delay_b_applied": int((final_b.get("server_telemetry") or {}).get("proof_reply_delay_ms_applied") or 0) == args.final_boss_delay_ms_new,
            "delay_c_applied": int((final_c.get("server_telemetry") or {}).get("proof_reply_delay_ms_applied") or 0) == args.final_boss_delay_ms_b,
            "home_has_thread_a": visible_thread_index(home_after_reply, thread_a) >= 0,
            "home_has_thread_b": visible_thread_index(home_after_reply, thread_b) >= 0,
        }
    )
    if not checks["passed"]:
        raise PhoneProofError(f"final boss checks failed: {json.dumps(checks['checks'], sort_keys=True)}")
    return {
        "scenario": "final_boss",
        "home_before": home_before,
        "thread_a_open": open_a,
        "new_thread_open": open_new,
        "thread_b_open": open_b,
        "thread_a": {"card": card_a, "scope": scope_a, "turn_status_before": turn_status_before_a, "start": start_a, "final": final_a, "result_card": card_result_a},
        "thread_new": {"scope": scope_new, "turn_status_before": turn_status_before_new, "start": start_b, "final": final_b, "result_card": card_result_b},
        "thread_b": {"card": card_b, "scope": scope_b, "turn_status_before": turn_status_before_b, "start": start_c, "final": final_c, "result_card": card_result_c},
        "final_snapshot": final_snapshot,
        "turn_status_final": turn_status_final,
        "completion_order": completion_order,
        "home_after_reply": home_after_reply,
        "checks": checks,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run real-phone Walkie thread-continuation proof against the Pucky cover WebView.")
    parser.add_argument("--scenario", choices=("feed_focus", "transcript", "page", "negative", "history", "all", "final_boss"), default="all")
    parser.add_argument("--serial", default=os.environ.get("PUCKY_PHONE_SERIAL", ""))
    parser.add_argument("--device-id", default=os.environ.get("PUCKY_DEVICE_ID", ""))
    parser.add_argument("--broker", default=os.environ.get("PUCKY_BROKER_URL", DEFAULT_BROKER_URL))
    parser.add_argument("--token", default=os.environ.get("PUCKY_OPERATOR_TOKEN", ""))
    parser.add_argument("--package-name", default=DEFAULT_PACKAGE_NAME)
    parser.add_argument("--vm-base-url", default=official_html.DEFAULT_VM_BASE_URL)
    parser.add_argument("--manifest-url", default="")
    parser.add_argument("--command-timeout-seconds", type=int, default=120)
    parser.add_argument("--browser-timeout-seconds", type=int, default=45)
    parser.add_argument("--devtools-port", type=int, default=9222)
    parser.add_argument("--transcript-card-title-contains", default="Proof HTML Dashboard")
    parser.add_argument("--transcript-thread-id", default="")
    parser.add_argument("--feed-focus-card-title-contains", default="Proof HTML Dashboard")
    parser.add_argument("--feed-focus-thread-id", default="")
    parser.add_argument("--page-card-title-contains", default="Proof HTML Dashboard")
    parser.add_argument("--page-thread-id", default="")
    parser.add_argument("--history-card-title-contains", default="Proof HTML Dashboard")
    parser.add_argument("--history-thread-id", default="")
    parser.add_argument("--page-surface", choices=("auto", "page", "attachment"), default="auto")
    parser.add_argument("--feed-focus-text", default="Continue this focused tile.")
    parser.add_argument("--transcript-text", default="Should we change these goals?")
    parser.add_argument("--page-text", default="Can you revise this file?")
    parser.add_argument("--negative-text", default="Start a fresh thread.")
    parser.add_argument("--history-text", default="Keep this history together.")
    parser.add_argument("--final-boss-thread-a-title-contains", default="Proof HTML Dashboard")
    parser.add_argument("--final-boss-thread-a-id", default="")
    parser.add_argument("--final-boss-thread-b-title-contains", default="Proof CSV Table")
    parser.add_argument("--final-boss-thread-b-id", default="")
    parser.add_argument("--final-boss-text-a", default="Continue thread A please.")
    parser.add_argument("--final-boss-text-new", default="Make this a fresh thread.")
    parser.add_argument("--final-boss-text-b", default="Continue thread B please.")
    parser.add_argument("--final-boss-delay-ms-a", type=int, default=6000)
    parser.add_argument("--final-boss-delay-ms-new", type=int, default=3000)
    parser.add_argument("--final-boss-delay-ms-b", type=int, default=0)
    parser.add_argument("--tts-voice", default="")
    parser.add_argument("--tts-rate", type=int, default=0)
    parser.add_argument("--skip-official-preproof-check", action="store_true")
    parser.add_argument("--evidence-dir", type=Path, default=ROOT / ".tmp" / "walkie-thread-phone-proof")
    parser.add_argument("--repo-root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--canonical-root", type=Path, default=CANONICAL_REPO_ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--adb", type=Path, default=Path("adb"), help=argparse.SUPPRESS)
    parser.add_argument("--node", type=Path, default=bundled_node_executable(), help=argparse.SUPPRESS)
    parser.add_argument("--node-modules", type=Path, default=bundled_node_modules(), help=argparse.SUPPRESS)
    parser.add_argument("--browser-helper", type=Path, default=ROOT / "tools" / "phone_walkie_thread_proof_browser.js", help=argparse.SUPPRESS)
    parser.add_argument("--puckyctl", type=Path, default=ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    args.repo_root = args.repo_root.resolve()
    args.canonical_root = args.canonical_root.resolve()
    args.evidence_dir = args.evidence_dir.resolve()
    args.browser_helper = args.browser_helper.resolve()
    args.puckyctl = args.puckyctl.resolve()
    args.node = args.node.resolve() if args.node.exists() else args.node
    args.node_modules = args.node_modules.resolve()
    args.adb = args.adb.resolve() if isinstance(args.adb, Path) and args.adb.exists() else args.adb
    args.vm_base_url = str(args.vm_base_url).rstrip("/")
    args.manifest_url = str(args.manifest_url or official_html.urljoin(args.vm_base_url + "/", official_html.DEFAULT_MANIFEST_PATH.lstrip("/")))
    return args


def run(args: argparse.Namespace) -> dict[str, Any]:
    local_git = require_official_local_repo(args.repo_root, args.canonical_root) if not args.skip_official_preproof_check else local_git_state(args.repo_root)
    serial = resolve_adb_serial(args)
    cdp = discover_cover_cdp_url(args, serial)
    try:
        scenario_root = args.evidence_dir / datetime.now().strftime("%Y%m%d-%H%M%S")
        scenario_root.mkdir(parents=True, exist_ok=True)

        surface_before = snapshot_surface(args)
        cards_before = snapshot_cards(args)
        bundle = bundle_status(args)
        package = installed_package_info(args, serial)
        identity = apk_identity(args)
        remote_manifest = expected_ui_manifest(args, local_git)
        identity_checks = verify_target_identity(
            args,
            local_git=local_git,
            remote_manifest=remote_manifest,
            bundle=bundle,
            surface=surface_before,
            installed_package=package,
            identity=identity,
        )

        scenarios: list[dict[str, Any]] = []
        cards = cards_from_snapshot(cards_before)

        if args.scenario in {"feed_focus", "all"}:
            feed_card = select_card(
                cards,
                title_contains=args.feed_focus_card_title_contains,
                required_thread_id=args.feed_focus_thread_id,
                require_thread=True,
            )
            scenarios.append(
                run_feed_focus_scenario(
                    args,
                    serial=serial,
                    cdp_url=cdp["cdp_url"],
                    card=feed_card,
                    text=args.feed_focus_text,
                    scenario_dir=scenario_root / "feed-focus",
                )
            )
            cards = cards_from_snapshot(snapshot_cards(args))

        if args.scenario in {"transcript", "all"}:
            transcript_card = select_card(
                cards,
                title_contains=args.transcript_card_title_contains,
                required_thread_id=args.transcript_thread_id,
                require_thread=True,
            )
            scenarios.append(
                run_continuation_scenario(
                    args,
                    serial=serial,
                    name="transcript_thread_continue",
                    cdp_url=cdp["cdp_url"],
                    card=transcript_card,
                    action="transcript",
                    expected_surface="thread_transcript",
                    text=args.transcript_text,
                    scenario_dir=scenario_root / "transcript",
                )
            )
            cards = cards_from_snapshot(snapshot_cards(args))

        if args.scenario in {"page", "all"}:
            page_card = select_card(
                cards,
                title_contains=args.page_card_title_contains,
                required_thread_id=args.page_thread_id,
                require_thread=True,
                require_page=True,
            )
            action = "page"
            expected_surface = "thread_page"
            if args.page_surface == "attachment" or (args.page_surface == "auto" and not str(page_card.get("html_path") or "").strip()):
                action = "attachment"
                expected_surface = "thread_attachment"
            scenarios.append(
                run_continuation_scenario(
                    args,
                    serial=serial,
                    name="page_thread_continue",
                    cdp_url=cdp["cdp_url"],
                    card=page_card,
                    action=action,
                    expected_surface=expected_surface,
                    text=args.page_text,
                    scenario_dir=scenario_root / "page",
                )
            )
            cards = cards_from_snapshot(snapshot_cards(args))

        if args.scenario in {"negative", "all"}:
            scenarios.append(
                run_negative_scenario(
                    args,
                    serial=serial,
                    cdp_url=cdp["cdp_url"],
                    text=args.negative_text,
                    scenario_dir=scenario_root / "negative-home",
                )
            )
            cards = cards_from_snapshot(snapshot_cards(args))

        if args.scenario in {"history", "all"}:
            history_card = select_card(
                cards,
                title_contains=args.history_card_title_contains,
                required_thread_id=args.history_thread_id,
                require_thread=True,
                require_page=True,
            )
            scenarios.append(
                run_history_scenario(
                    args,
                    serial=serial,
                    cdp_url=cdp["cdp_url"],
                    card=history_card,
                    text=args.history_text,
                    scenario_dir=scenario_root / "history",
                )
            )
            cards = cards_from_snapshot(snapshot_cards(args))

        if args.scenario in {"final_boss", "all"}:
            scenarios.append(
                run_final_boss_scenario(
                    args,
                    serial=serial,
                    cdp_url=cdp["cdp_url"],
                    scenario_dir=scenario_root / "final-boss",
                )
            )

        summary_checks = {str(item.get("scenario") or f"scenario_{index}"): bool((item.get("checks") or {}).get("passed")) for index, item in enumerate(scenarios)}
        summary = scenario_checks(summary_checks)

        evidence = {
            "schema": RESULT_SCHEMA,
            "created_at": utc_stamp(),
            "repo_root": str(args.repo_root),
            "local_git": local_git,
            "remote_manifest": remote_manifest or {},
            "adb": {
                "serial": serial,
                "package": package,
                "apk_identity": identity,
            },
            "device_id": args.device_id,
            "cdp": cdp,
            "ui_surface_before": surface_before,
            "ui_bundle_status": bundle,
            "cards_before": cards_before,
            "identity_checks": identity_checks,
            "scenarios": scenarios,
            "summary": summary,
            "evidence_dir": str(scenario_root),
        }
        evidence_path = scenario_root / "proof.json"
        save_json(evidence_path, evidence)
        if not summary["passed"]:
            raise PhoneProofError(f"one or more scenarios failed: {json.dumps(summary['checks'], sort_keys=True)}")
        return {
            "ok": True,
            "schema": RESULT_SCHEMA,
            "evidence_path": str(evidence_path),
            "scenario_count": len(scenarios),
            "serial": serial,
            "ui_version": str(bundle.get("ui_version") or surface_before.get("ui_version") or ""),
            "passed": True,
        }
    finally:
        forward_port = str(cdp.get("forward_port") or "").strip()
        if forward_port:
            run_subprocess(adb_command(args, serial, ["forward", "--remove", f"tcp:{forward_port}"]), cwd=args.repo_root, timeout=10)


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(argv)
        result = run(args)
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
