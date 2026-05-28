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
    completed = run_subprocess(argv, cwd=args.repo_root, timeout=(timeout_seconds or args.command_timeout_seconds) + 5)
    combined = "\n".join(part for part in (completed.stdout, completed.stderr) if part).strip()
    parsed = extract_json(completed.stdout or combined)
    if not isinstance(parsed, dict):
        raise PhoneProofError(f"Unable to parse puckyctl JSON for {' '.join(resource_args)}: {combined}")
    if completed.returncode != 0 or not parsed.get("ok", False):
        raise PhoneProofError(f"puckyctl {' '.join(resource_args)} failed: {combined}")
    result = parsed.get("result")
    return result if isinstance(result, dict) else {}


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
    return run_pucky_command(args, "voice.thread_scope.get", {})


def bundle_status(args: argparse.Namespace) -> dict[str, Any]:
    return run_pucky_command(args, "ui.bundle.status", {})


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


def card_matches_title(card: dict[str, Any], title_contains: str) -> bool:
    needle = str(title_contains or "").strip().lower()
    if not needle:
        return True
    values = [
        str(card.get("title") or ""),
        str(card.get("summary") or ""),
        str(card.get("transcript") or ""),
    ]
    return any(needle in value.lower() for value in values)


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


def select_card(
    cards: list[dict[str, Any]],
    *,
    title_contains: str = "",
    require_thread: bool = True,
    require_page: bool = False,
    excluded_thread_ids: set[str] | None = None,
) -> dict[str, Any]:
    excluded = excluded_thread_ids or set()
    matches: list[dict[str, Any]] = []
    for card in cards:
        thread_id = origin_thread_id(card)
        if require_thread and not thread_id:
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


def walkie_start_payload(fixture_path: str, transcript_hint: str) -> dict[str, Any]:
    return {
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


def put_fixture_for_text(args: argparse.Namespace, text: str, label: str) -> dict[str, Any]:
    local_fixture = generate_tts_fixture(args, text, label)
    remote_fixture = run_pucky_file_put(args, local_fixture, filename=local_fixture.name, timeout_seconds=180)
    if not str(remote_fixture.get("path") or "").strip():
        raise PhoneProofError("file.put did not return a remote path")
    return {
        "local_path": str(local_fixture),
        "remote": remote_fixture,
    }


def start_fixture_turn(args: argparse.Namespace, fixture_path: str, transcript_hint: str) -> dict[str, Any]:
    return run_pucky_command(args, "pucky.turn.start", walkie_start_payload(fixture_path, transcript_hint), timeout_seconds=120)


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
        record = turn_read(args, turn_id)
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


def run_continuation_scenario(
    args: argparse.Namespace,
    *,
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
    open_result = run_browser_helper(
        args,
        cdp_url,
        browser_ops_for_card_open(card, action, "transcript" if action == "transcript" else ("page" if action == "page" else "attachment"))
        + [screenshot_operation(scenario_dir / "before-send.png")],
        timeout_seconds=60,
    )
    scope_before = wait_for_scope(args, source_thread_id, expected_surface)
    fixture = put_fixture_for_text(args, text, name)
    start = start_fixture_turn(args, str(fixture["remote"]["path"]), text)
    turn_id = str(start.get("turn_id") or "")
    if not turn_id:
        raise PhoneProofError(f"{name} did not return a turn_id")
    home_after_start = run_browser_helper(
        args,
        cdp_url,
        [{"kind": "back"}, {"kind": "goto_home"}, screenshot_operation(scenario_dir / "pending.png"), {"kind": "describe"}],
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
    transcript_turn = wait_for_turn_transcript(args, turn_id)
    transcript_snapshot = snapshot_cards(args)
    run_browser_helper(
        args,
        cdp_url,
        [{"kind": "goto_home"}, screenshot_operation(scenario_dir / "transcript-known.png"), {"kind": "describe"}],
        timeout_seconds=45,
    )
    final_turn = wait_for_turn_reply_saved(args, turn_id)
    final_snapshot = snapshot_cards(args)
    run_browser_helper(
        args,
        cdp_url,
        [{"kind": "goto_home"}, screenshot_operation(scenario_dir / "reply-complete.png"), {"kind": "describe"}],
        timeout_seconds=45,
    )
    final_card = final_thread_card(final_snapshot, source_thread_id)
    if final_card is None:
        raise PhoneProofError(f"{name} did not leave a final visible tile on thread {source_thread_id}")
    if len(thread_cards(final_snapshot, source_thread_id)) != 1:
        raise PhoneProofError(f"{name} left multiple visible cards on thread {source_thread_id}")
    return {
        "scenario": name,
        "source_card": card,
        "source_thread_id": source_thread_id,
        "before_surface": before_surface,
        "before_cards": before_cards,
        "open_result": open_result,
        "scope_before": scope_before,
        "fixture": fixture,
        "turn_start": start,
        "pending": pending,
        "turn_with_transcript": transcript_turn,
        "transcript_snapshot": transcript_snapshot,
        "turn_final": final_turn,
        "final_snapshot": final_snapshot,
        "final_card": final_card,
        "home_after_start": home_after_start,
    }


def run_negative_scenario(args: argparse.Namespace, *, cdp_url: str, text: str, scenario_dir: Path) -> dict[str, Any]:
    before_cards = snapshot_cards(args)
    before_thread_ids = {origin_thread_id(card) for card in cards_from_snapshot(before_cards) if origin_thread_id(card)}
    run_browser_helper(
        args,
        cdp_url,
        [{"kind": "back"}, {"kind": "goto_home"}, screenshot_operation(scenario_dir / "before-send.png"), {"kind": "describe"}],
        timeout_seconds=45,
    )
    scope_before = wait_for_new_thread_scope(args)
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
    run_browser_helper(
        args,
        cdp_url,
        [{"kind": "goto_home"}, screenshot_operation(scenario_dir / "reply-complete.png"), {"kind": "describe"}],
        timeout_seconds=45,
    )
    return {
        "scenario": "negative_home",
        "before_cards": before_cards,
        "scope_before": scope_before,
        "fixture": fixture,
        "turn_start": start,
        "turn_final": final_turn,
        "final_snapshot": final_snapshot,
        "final_card": final_card,
    }


def run_final_boss_scenario(args: argparse.Namespace, *, cdp_url: str, scenario_dir: Path) -> dict[str, Any]:
    cards = cards_from_snapshot(snapshot_cards(args))
    card_a = select_card(cards, title_contains=args.final_boss_thread_a_title_contains, require_thread=True)
    card_b = select_card(
        cards,
        title_contains=args.final_boss_thread_b_title_contains,
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

    run_browser_helper(
        args,
        cdp_url,
        browser_ops_for_card_open(card_a, "transcript", "transcript") + [screenshot_operation(scenario_dir / "thread-a-before.png")],
        timeout_seconds=60,
    )
    scope_a = wait_for_scope(args, thread_a, "thread_transcript")
    start_a = start_fixture_turn(args, str(fixture_a["remote"]["path"]), args.final_boss_text_a)
    turn_a = str(start_a.get("turn_id") or "")
    wait_for_turn_not_recording(args, turn_a)

    run_browser_helper(
        args,
        cdp_url,
        [{"kind": "back"}, {"kind": "goto_home"}, screenshot_operation(scenario_dir / "new-thread-before.png")],
        timeout_seconds=45,
    )
    scope_new = wait_for_new_thread_scope(args)
    start_b = start_fixture_turn(args, str(fixture_b["remote"]["path"]), args.final_boss_text_new)
    turn_b = str(start_b.get("turn_id") or "")
    wait_for_turn_not_recording(args, turn_b)

    run_browser_helper(
        args,
        cdp_url,
        browser_ops_for_card_open(card_b, "transcript", "transcript") + [screenshot_operation(scenario_dir / "thread-b-before.png")],
        timeout_seconds=60,
    )
    scope_b = wait_for_scope(args, thread_b, "thread_transcript")
    start_c = start_fixture_turn(args, str(fixture_c["remote"]["path"]), args.final_boss_text_b)
    turn_c = str(start_c.get("turn_id") or "")

    final_a = wait_for_turn_reply_saved(args, turn_a)
    final_b = wait_for_turn_reply_saved(args, turn_b)
    final_c = wait_for_turn_reply_saved(args, turn_c)
    final_snapshot = snapshot_cards(args)
    run_browser_helper(
        args,
        cdp_url,
        [{"kind": "goto_home"}, screenshot_operation(scenario_dir / "reply-complete.png"), {"kind": "describe"}],
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
    if card_result_a is None or origin_thread_id(card_result_a) != thread_a:
        raise PhoneProofError("Final boss turn A did not land back on thread A")
    if card_result_c is None or origin_thread_id(card_result_c) != thread_b:
        raise PhoneProofError("Final boss turn C did not land back on thread B")
    middle_thread = origin_thread_id(card_result_b or {})
    if middle_thread in {thread_a, thread_b}:
        raise PhoneProofError("Final boss middle turn reused an existing thread unexpectedly")
    return {
        "scenario": "final_boss",
        "thread_a": {"card": card_a, "scope": scope_a, "start": start_a, "final": final_a, "result_card": card_result_a},
        "thread_new": {"scope": scope_new, "start": start_b, "final": final_b, "result_card": card_result_b},
        "thread_b": {"card": card_b, "scope": scope_b, "start": start_c, "final": final_c, "result_card": card_result_c},
        "final_snapshot": final_snapshot,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run real-phone Walkie thread-continuation proof against the Pucky cover WebView.")
    parser.add_argument("--scenario", choices=("transcript", "page", "negative", "all", "final_boss"), default="all")
    parser.add_argument("--serial", default=os.environ.get("PUCKY_PHONE_SERIAL", ""))
    parser.add_argument("--device-id", default=os.environ.get("PUCKY_DEVICE_ID", ""))
    parser.add_argument("--broker", default=os.environ.get("PUCKY_BROKER_URL", DEFAULT_BROKER_URL))
    parser.add_argument("--token", default=os.environ.get("PUCKY_OPERATOR_TOKEN", ""))
    parser.add_argument("--package-name", default=DEFAULT_PACKAGE_NAME)
    parser.add_argument("--command-timeout-seconds", type=int, default=120)
    parser.add_argument("--browser-timeout-seconds", type=int, default=45)
    parser.add_argument("--devtools-port", type=int, default=9222)
    parser.add_argument("--transcript-card-title-contains", default="Proof HTML Dashboard")
    parser.add_argument("--page-card-title-contains", default="Proof HTML Dashboard")
    parser.add_argument("--page-surface", choices=("auto", "page", "attachment"), default="auto")
    parser.add_argument("--transcript-text", default="Should we change these goals?")
    parser.add_argument("--page-text", default="Can you revise this file?")
    parser.add_argument("--negative-text", default="Start a fresh thread.")
    parser.add_argument("--final-boss-thread-a-title-contains", default="Proof HTML Dashboard")
    parser.add_argument("--final-boss-thread-b-title-contains", default="Proof CSV Table")
    parser.add_argument("--final-boss-text-a", default="Continue thread A please.")
    parser.add_argument("--final-boss-text-new", default="Make this a fresh thread.")
    parser.add_argument("--final-boss-text-b", default="Continue thread B please.")
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

        scenarios: list[dict[str, Any]] = []
        cards = cards_from_snapshot(cards_before)

        if args.scenario in {"transcript", "all"}:
            transcript_card = select_card(cards, title_contains=args.transcript_card_title_contains, require_thread=True)
            scenarios.append(
                run_continuation_scenario(
                    args,
                    name="transcript_thread_continue",
                    cdp_url=cdp["cdp_url"],
                    card=transcript_card,
                    action="transcript",
                    expected_surface="thread_transcript",
                    text=args.transcript_text,
                    scenario_dir=scenario_root / "transcript",
                )
            )

        if args.scenario in {"page", "all"}:
            page_card = select_card(cards, title_contains=args.page_card_title_contains, require_thread=True, require_page=True)
            action = "page"
            expected_surface = "thread_page"
            if args.page_surface == "attachment" or (args.page_surface == "auto" and not str(page_card.get("html_path") or "").strip()):
                action = "attachment"
                expected_surface = "thread_attachment"
            scenarios.append(
                run_continuation_scenario(
                    args,
                    name="page_thread_continue",
                    cdp_url=cdp["cdp_url"],
                    card=page_card,
                    action=action,
                    expected_surface=expected_surface,
                    text=args.page_text,
                    scenario_dir=scenario_root / "page",
                )
            )

        if args.scenario in {"negative", "all"}:
            scenarios.append(
                run_negative_scenario(
                    args,
                    cdp_url=cdp["cdp_url"],
                    text=args.negative_text,
                    scenario_dir=scenario_root / "negative-home",
                )
            )

        if args.scenario == "final_boss":
            scenarios.append(run_final_boss_scenario(args, cdp_url=cdp["cdp_url"], scenario_dir=scenario_root / "final-boss"))

        evidence = {
            "schema": RESULT_SCHEMA,
            "created_at": utc_stamp(),
            "repo_root": str(args.repo_root),
            "local_git": local_git,
            "adb": {
                "serial": serial,
                "package": package,
            },
            "device_id": args.device_id,
            "cdp": cdp,
            "ui_surface_before": surface_before,
            "ui_bundle_status": bundle,
            "cards_before": cards_before,
            "scenarios": scenarios,
            "evidence_dir": str(scenario_root),
        }
        evidence_path = scenario_root / "proof.json"
        save_json(evidence_path, evidence)
        return {
            "ok": True,
            "schema": RESULT_SCHEMA,
            "evidence_path": str(evidence_path),
            "scenario_count": len(scenarios),
            "serial": serial,
            "ui_version": str(bundle.get("ui_version") or surface_before.get("ui_version") or ""),
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
