from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import tools.phone_proof_shared as phone_shared
import tools.phone_walkie_thread_proof as proof
import tools.refresh_pucky_html_official as official_html

CANONICAL_REPO_ROOT = Path(r"C:\Users\jimmy\Desktop\Motorolla-master-ui")
RESULT_SCHEMA = "pucky.meeting_mode_phone_real_vm_proof.v1"
DEFAULT_ACTIVITY_NAME = "com.pucky.device.CoverHomeActivity"
DETAIL_TITLE_SELECTOR = "#detail .detail-title"
AUDIO_SELECTOR = "#detail audio.attachment-audio-player"


class MeetingModePhoneProofError(RuntimeError):
    pass


def scenario_specs() -> list[dict[str, Any]]:
    return [
        {
            "name": "named_duo_3to5m",
            "fixture_name": "named-duo-3to5m-generated.wav",
            "expected_names": ["Jimmy", "Maya"],
            "forbidden_neutral_labels": ["speaker_0", "speaker_1"],
            "forbidden_names": [],
            "expected_neutral_speaker_count": 0,
            "expected_due_dates": ["June 8", "June 9", "June 10", "June 11", "June 12"],
        },
        {
            "name": "anonymous_duo_3to5m",
            "fixture_name": "anonymous-duo-3to5m-generated.wav",
            "expected_names": [],
            "forbidden_neutral_labels": [],
            "forbidden_names": ["Jimmy", "Jack", "Maya"],
            "expected_neutral_speaker_count": 2,
            "expected_due_dates": ["June 8", "June 9", "June 10", "June 11", "June 12"],
        },
        {
            "name": "named_trio_3to5m",
            "fixture_name": "named-trio-3to5m-generated.wav",
            "expected_names": ["Jimmy", "Jack", "Maya"],
            "forbidden_neutral_labels": ["speaker_0", "speaker_1", "speaker_2"],
            "forbidden_names": [],
            "expected_neutral_speaker_count": 0,
            "expected_due_dates": ["June 8", "June 9", "June 10", "June 11", "June 12"],
        },
        {
            "name": "anonymous_trio_3to5m",
            "fixture_name": "anonymous-trio-3to5m-generated.wav",
            "expected_names": [],
            "forbidden_neutral_labels": [],
            "forbidden_names": ["Jimmy", "Jack", "Maya"],
            "expected_neutral_speaker_count": 3,
            "expected_due_dates": ["June 8", "June 9", "June 10", "June 11", "June 12"],
        },
    ]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run real-phone Meeting Mode proof against the live VM-served cover WebView.")
    parser.add_argument("--scenario", action="append", dest="scenarios", default=[])
    parser.add_argument("--serial", default="")
    parser.add_argument("--device-id", default="pucky-cover-meeting-mode-phone")
    parser.add_argument("--token", default=os.environ.get("PUCKY_WEB_UI_TOKEN") or os.environ.get("PUCKY_API_TOKEN", ""))
    parser.add_argument("--vm-base-url", default=official_html.DEFAULT_VM_BASE_URL)
    parser.add_argument("--manifest-url", default="")
    parser.add_argument("--browser-summary", type=Path)
    parser.add_argument("--fixture-dir", type=Path)
    parser.add_argument("--skip-official-preproof-check", action="store_true")
    parser.add_argument("--evidence-dir", type=Path, default=ROOT / ".tmp" / "meeting-mode-phone-proof")
    parser.add_argument("--repo-root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--canonical-root", type=Path, default=CANONICAL_REPO_ROOT, help=argparse.SUPPRESS)
    parser.add_argument("--adb", type=Path, default=Path(r"C:\Users\jimmy\Desktop\Android\tools\android-sdk\platform-tools\adb.exe"), help=argparse.SUPPRESS)
    parser.add_argument("--broker", default=os.environ.get("PUCKY_BROKER_URL") or proof.DEFAULT_BROKER_URL, help=argparse.SUPPRESS)
    parser.add_argument("--puckyctl", type=Path, default=ROOT / "pucky-apk" / "puckyctl" / "puckyctl.py", help=argparse.SUPPRESS)
    parser.add_argument("--node", type=Path, default=proof.bundled_node_executable(), help=argparse.SUPPRESS)
    parser.add_argument("--node-modules", type=Path, default=proof.bundled_node_modules(), help=argparse.SUPPRESS)
    parser.add_argument("--browser-helper", type=Path, default=ROOT / "tools" / "phone_walkie_thread_proof_browser.js", help=argparse.SUPPRESS)
    parser.add_argument("--package-name", default=proof.DEFAULT_PACKAGE_NAME)
    parser.add_argument("--activity-name", default=DEFAULT_ACTIVITY_NAME)
    parser.add_argument("--browser-timeout-seconds", type=int, default=60)
    parser.add_argument("--command-timeout-seconds", type=int, default=120)
    parser.add_argument("--devtools-port", type=int, default=9222)
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
    args.browser_summary = args.browser_summary.resolve() if args.browser_summary else None
    args.fixture_dir = args.fixture_dir.resolve() if args.fixture_dir else None
    return args


def resolve_user_data_api_token(explicit_token: str = "") -> str:
    token = str(explicit_token or "").strip()
    if token:
        return token
    web_ui_token = str(os.environ.get("PUCKY_WEB_UI_TOKEN", "")).strip()
    if web_ui_token:
        return web_ui_token
    return str(os.environ.get("PUCKY_API_TOKEN", "")).strip()


def load_browser_summary(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("ok") is not True:
        raise MeetingModePhoneProofError("Browser summary must be green before Android verification")
    return payload


def resolve_fixture_dir(args: argparse.Namespace, browser_summary: dict[str, Any] | None) -> Path:
    if args.fixture_dir:
        fixture_dir = args.fixture_dir
    elif args.browser_summary:
        fixture_dir = args.browser_summary.parent / "generated-fixtures"
    elif browser_summary and browser_summary.get("report_dir"):
        fixture_dir = Path(str(browser_summary.get("report_dir") or "")).resolve() / "generated-fixtures"
    else:
        raise MeetingModePhoneProofError("Android meeting proof requires --browser-summary or --fixture-dir")
    if not fixture_dir.exists():
        raise MeetingModePhoneProofError(f"Fixture directory not found: {fixture_dir}")
    return fixture_dir


def choose_scenarios(fixture_dir: Path, names_filter: list[str]) -> list[dict[str, Any]]:
    allowed = set(names_filter or [])
    scenarios = []
    for index, spec in enumerate(scenario_specs()):
        if allowed and spec["name"] not in allowed:
            continue
        fixture_path = fixture_dir / spec["fixture_name"]
        if not fixture_path.exists():
            raise MeetingModePhoneProofError(f"Missing fixture for {spec['name']}: {fixture_path}")
        stamp = build_scenario_timestamp(index)
        scenarios.append({
            **spec,
            "fixture_path": fixture_path,
            "meeting_id": f"meeting-{stamp['date_part']}-codex-phone-{spec['name']}",
            "started_at": stamp["iso_start"],
        })
    if not scenarios:
        raise MeetingModePhoneProofError("No Android scenarios selected")
    return scenarios


def build_scenario_timestamp(offset_minutes: int) -> dict[str, str]:
    value = time.gmtime(time.time() + (offset_minutes * 60))
    year = value.tm_year
    month = f"{value.tm_mon:02d}"
    day = f"{value.tm_mday:02d}"
    hour = f"{value.tm_hour:02d}"
    minute = f"{value.tm_min:02d}"
    second = f"{value.tm_sec:02d}"
    return {
        "date_part": f"{year}{month}{day}-{hour}{minute}{second}",
        "iso_start": f"{year}-{month}-{day}T{hour}:{minute}:{second}Z",
    }


def wav_duration_ms(audio_path: Path) -> int:
    body = audio_path.read_bytes()
    if len(body) < 44 or body[:4] != b"RIFF" or body[8:12] != b"WAVE":
        raise MeetingModePhoneProofError(f"Expected PCM WAV fixture at {audio_path}")
    channels = 0
    sample_rate = 0
    bits_per_sample = 0
    data_size = 0
    cursor = 12
    while cursor + 8 <= len(body):
        chunk_id = body[cursor : cursor + 4]
        chunk_size = int.from_bytes(body[cursor + 4 : cursor + 8], "little")
        chunk_data_offset = cursor + 8
        if chunk_id == b"fmt " and chunk_size >= 16 and chunk_data_offset + 16 <= len(body):
            channels = int.from_bytes(body[chunk_data_offset + 2 : chunk_data_offset + 4], "little")
            sample_rate = int.from_bytes(body[chunk_data_offset + 4 : chunk_data_offset + 8], "little")
            bits_per_sample = int.from_bytes(body[chunk_data_offset + 14 : chunk_data_offset + 16], "little")
        elif chunk_id == b"data":
            data_size = chunk_size
            break
        cursor = chunk_data_offset + chunk_size + (chunk_size % 2)
    if not (channels > 0 and sample_rate > 0 and bits_per_sample > 0 and data_size > 0):
        raise MeetingModePhoneProofError(f"Unable to parse WAV metadata from {audio_path}")
    bytes_per_second = max(1, sample_rate * channels * max(1, bits_per_sample // 8))
    return max(1000, round((data_size / bytes_per_second) * 1000))


def live_payload(meeting_id: str, started_at: str, audio_path: Path) -> dict[str, Any]:
    duration_ms = wav_duration_ms(audio_path)
    started = datetime.strptime(started_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    stopped_at = (started + timedelta(milliseconds=duration_ms)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "meeting_id": meeting_id,
        "started_at": started_at,
        "stopped_at": stopped_at,
        "duration_ms": duration_ms,
        "device_id": "codex-phone-realvm-proof",
        "device_path": f"/data/user/0/com.pucky.device.debug/files/voice/{meeting_id}.wav",
        "mime_type": "audio/wav",
        "audio_base64": base64.b64encode(audio_path.read_bytes()).decode("ascii"),
    }


def api_json(base_url: str, token: str, path_name: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}{path_name}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            **({"Content-Type": "application/json"} if data is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="ignore")
        raise MeetingModePhoneProofError(f"{method} {path_name} failed: HTTP {error.code}: {payload}") from error


def fetch_meeting_detail(base_url: str, token: str, meeting_id: str) -> dict[str, Any]:
    return api_json(base_url, token, f"/api/meetings/{urllib.parse.quote(meeting_id)}")


def wait_for_meeting_processing(base_url: str, token: str, meeting_id: str, timeout_seconds: int | float = 180) -> dict[str, Any]:
    def check() -> dict[str, Any] | None:
        payload = fetch_meeting_detail(base_url, token, meeting_id)
        state = str((payload.get("meeting") or {}).get("state") or "")
        if state in {"processing", "completed"}:
            return payload
        if state == "failed":
            meeting = payload.get("meeting") or {}
            raise MeetingModePhoneProofError(f"{meeting_id} failed before processing: {meeting.get('failure_stage')}: {meeting.get('failure_reason')}")
        return None

    return proof.wait_for(check, timeout_seconds=timeout_seconds, description=f"{meeting_id} processing")


def wait_for_meeting_completed(base_url: str, token: str, meeting_id: str, timeout_seconds: int | float = 600) -> dict[str, Any]:
    def check() -> dict[str, Any] | None:
        payload = fetch_meeting_detail(base_url, token, meeting_id)
        state = str((payload.get("meeting") or {}).get("state") or "")
        if state == "completed":
            return payload
        if state == "failed":
            meeting = payload.get("meeting") or {}
            raise MeetingModePhoneProofError(f"{meeting_id} failed before completion: {meeting.get('failure_stage')}: {meeting.get('failure_reason')}")
        return None

    return proof.wait_for(check, timeout_seconds=timeout_seconds, description=f"{meeting_id} completed")


def normalize_proof_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def distinct_neutral_speakers(text: str) -> list[str]:
    return sorted({match.lower() for match in re.findall(r"speaker_\d+", str(text or ""), flags=re.I)})


def assert_human_like_title(label: str, title: str, meeting_id: str) -> None:
    clean = str(title or "").strip()
    if not clean:
        raise MeetingModePhoneProofError(f"{label} title is empty")
    if clean == str(meeting_id or "").strip():
        raise MeetingModePhoneProofError(f"{label} title fell back to raw meeting_id")
    if re.match(r"^meeting-\d{8,}", clean, flags=re.I):
        raise MeetingModePhoneProofError(f"{label} title still looks machine-generated: {clean}")


def screenshot_operation(path: Path) -> dict[str, Any]:
    return {"kind": "screenshot", "path": str(path)}


def operation_by_kind(payload: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [item for item in list(payload.get("operations") or []) if isinstance(item, dict) and item.get("kind") == kind]


def selector_count_value(payload: dict[str, Any], selector: str) -> int:
    for item in operation_by_kind(payload, "selector_count"):
        if str(item.get("selector") or "") == selector:
            return int(item.get("count") or 0)
    return 0


def text_content_value(payload: dict[str, Any], selector: str) -> str:
    for item in operation_by_kind(payload, "text_content"):
        if str(item.get("selector") or "") == selector:
            return str(item.get("text") or "").strip()
    return ""


def audio_playback_result(payload: dict[str, Any]) -> dict[str, Any]:
    items = operation_by_kind(payload, "play_audio")
    return items[-1] if items else {}


def meeting_title_selector(meeting_id: str) -> str:
    return f'[data-card-session-id="{meeting_id}"] .title'


def meeting_card_selector(meeting_id: str) -> str:
    return f'[data-card-session-id="{meeting_id}"]'


def run_browser_phase(
    args: argparse.Namespace,
    *,
    serial: str,
    cdp_url: str,
    operations: list[dict[str, Any]],
    scenario_dir: Path,
    browser_json_name: str,
    device_name: str,
    timeout_seconds: int | float | None = None,
) -> dict[str, Any]:
    payload = proof.capture_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=operations,
        scenario_dir=scenario_dir,
        browser_name=browser_json_name,
        device_name=device_name,
        timeout_seconds=timeout_seconds or args.browser_timeout_seconds,
    )
    return payload


def home_pending_ops(meeting_id: str, screenshot_path: Path) -> list[dict[str, Any]]:
    selector = meeting_card_selector(meeting_id)
    return [
        {"kind": "goto_home"},
        {"kind": "wait_for_selector", "selector": selector},
        {"kind": "wait_for_text", "selector": selector, "text": "Processing"},
        screenshot_operation(screenshot_path),
        {"kind": "describe"},
    ]


def meetings_route_base_ops() -> list[dict[str, Any]]:
    return [
        {"kind": "goto_home"},
        {"kind": "click_selector", "selector": '[data-route="meetings"]'},
        {"kind": "wait_for_selector", "selector": ".meetings-page"},
        {"kind": "click_selector", "selector": "button.meetings-refresh"},
    ]


def meetings_pending_ops(meeting_id: str, screenshot_path: Path) -> list[dict[str, Any]]:
    return meetings_route_base_ops() + [
        {"kind": "wait_for_selector", "selector": f'{meeting_card_selector(meeting_id)}.card-pending-thread'},
        screenshot_operation(screenshot_path),
        {"kind": "describe"},
    ]


def home_summary_ops(meeting_id: str, screenshot_path: Path) -> list[dict[str, Any]]:
    return [
        {"kind": "goto_home"},
        {"kind": "open_card_action", "session_id": meeting_id, "action": "attachment", "expected_detail_type": "attachment"},
        {"kind": "wait_for_text", "selector": DETAIL_TITLE_SELECTOR, "text": "Meeting Summary"},
        screenshot_operation(screenshot_path),
        {"kind": "describe"},
    ]


def meetings_summary_ops(meeting_id: str, screenshot_path: Path) -> list[dict[str, Any]]:
    selector = meeting_card_selector(meeting_id)
    return meetings_route_base_ops() + [
        {"kind": "wait_for_selector", "selector": selector},
        {"kind": "text_content", "selector": meeting_title_selector(meeting_id)},
        {"kind": "selector_count", "selector": f"{selector} .identity"},
        {"kind": "selector_count", "selector": f"{selector} .preview"},
        {"kind": "selector_count", "selector": f"{selector} .action.action-audio"},
        {"kind": "click_selector", "selector": f"{selector} .card-body"},
        {"kind": "wait_for_text", "selector": DETAIL_TITLE_SELECTOR, "text": "Meeting Summary"},
        screenshot_operation(screenshot_path),
        {"kind": "describe"},
    ]


def transcript_from_summary_ops(screenshot_path: Path) -> list[dict[str, Any]]:
    return [
        {"kind": "wait_for_selector", "selector": "#detail iframe.document-frame"},
        {"kind": "click_frame_selector", "frame_selector": "#detail iframe.document-frame", "selector": "a.pucky-meeting-transcript-link"},
        {"kind": "wait_for_text", "selector": DETAIL_TITLE_SELECTOR, "text": "Transcript"},
        screenshot_operation(screenshot_path),
        {"kind": "describe"},
    ]


def audio_from_summary_ops(screenshot_path: Path) -> list[dict[str, Any]]:
    return [
        {"kind": "wait_for_selector", "selector": "#detail iframe.document-frame"},
        {"kind": "click_frame_selector", "frame_selector": "#detail iframe.document-frame", "selector": "a.pucky-meeting-audio-link"},
        {"kind": "wait_for_text", "selector": DETAIL_TITLE_SELECTOR, "text": "Meeting Audio"},
        {"kind": "audio_state", "selector": AUDIO_SELECTOR},
        {"kind": "play_audio", "selector": AUDIO_SELECTOR},
        screenshot_operation(screenshot_path),
        {"kind": "describe"},
    ]


def audio_from_meetings_row_ops(meeting_id: str, screenshot_path: Path) -> list[dict[str, Any]]:
    selector = meeting_card_selector(meeting_id)
    return meetings_route_base_ops() + [
        {"kind": "wait_for_selector", "selector": selector},
        {"kind": "click_selector", "selector": f"{selector} .action.action-audio"},
        {"kind": "wait_for_text", "selector": DETAIL_TITLE_SELECTOR, "text": "Meeting Audio"},
        {"kind": "audio_state", "selector": AUDIO_SELECTOR},
        {"kind": "play_audio", "selector": AUDIO_SELECTOR},
        screenshot_operation(screenshot_path),
        {"kind": "describe"},
    ]


def verify_semantics(meeting: dict[str, Any], scenario: dict[str, Any]) -> None:
    meeting_id = str(meeting.get("meeting_id") or scenario["meeting_id"])
    assert_human_like_title("Feed card", str(meeting.get("title") or ""), meeting_id)
    assert_human_like_title("Recording", str(meeting.get("recording_title") or ""), meeting_id)
    transcript_text = str(meeting.get("transcript_text") or "")
    if not transcript_text.strip():
        raise MeetingModePhoneProofError(f"{scenario['name']} transcript_text is empty")
    for name in scenario["expected_names"]:
        if name not in transcript_text:
            raise MeetingModePhoneProofError(f"{scenario['name']} transcript is missing named speaker {name}")
    for label in scenario["forbidden_neutral_labels"]:
        if label in transcript_text:
            raise MeetingModePhoneProofError(f"{scenario['name']} transcript kept neutral label {label}")
    for name in scenario["forbidden_names"]:
        if name in transcript_text:
            raise MeetingModePhoneProofError(f"{scenario['name']} transcript invented forbidden name {name}")
    if scenario["expected_neutral_speaker_count"]:
        neutral_speakers = distinct_neutral_speakers(transcript_text)
        if len(neutral_speakers) != int(scenario["expected_neutral_speaker_count"]):
            raise MeetingModePhoneProofError(
                f"{scenario['name']} transcript did not preserve exactly {scenario['expected_neutral_speaker_count']} neutral speakers"
            )


def run_scenario(
    args: argparse.Namespace,
    *,
    serial: str,
    cdp_url: str,
    base_url: str,
    token: str,
    scenario_root: Path,
    scenario: dict[str, Any],
) -> dict[str, Any]:
    scenario_dir = scenario_root / scenario["name"]
    scenario_dir.mkdir(parents=True, exist_ok=True)
    payload = live_payload(scenario["meeting_id"], scenario["started_at"], scenario["fixture_path"])
    phone_shared.save_json(scenario_dir / "meeting_payload.json", payload)

    post_response = api_json(base_url, token, "/api/meetings", method="POST", body=payload)
    phone_shared.save_json(scenario_dir / "meeting_post_response.json", post_response)

    processing_payload = wait_for_meeting_processing(base_url, token, scenario["meeting_id"])
    phone_shared.save_json(scenario_dir / "meeting_processing.json", processing_payload)

    home_pending = run_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=home_pending_ops(scenario["meeting_id"], scenario_dir / "01-home-pending-browser.png"),
        scenario_dir=scenario_dir,
        browser_json_name="01-home-pending.json",
        device_name="01-home-pending-device.png",
    )
    meetings_pending = run_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=meetings_pending_ops(scenario["meeting_id"], scenario_dir / "02-meetings-pending-browser.png"),
        scenario_dir=scenario_dir,
        browser_json_name="02-meetings-pending.json",
        device_name="02-meetings-pending-device.png",
    )

    completed_payload = wait_for_meeting_completed(base_url, token, scenario["meeting_id"])
    phone_shared.save_json(scenario_dir / "meeting_completed.json", completed_payload)
    meeting = completed_payload.get("meeting") or {}
    verify_semantics(meeting, scenario)

    home_summary = run_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=home_summary_ops(scenario["meeting_id"], scenario_dir / "03-home-summary-browser.png"),
        scenario_dir=scenario_dir,
        browser_json_name="03-home-summary.json",
        device_name="03-home-summary-device.png",
    )
    meetings_summary = run_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=meetings_summary_ops(scenario["meeting_id"], scenario_dir / "04-meetings-summary-browser.png"),
        scenario_dir=scenario_dir,
        browser_json_name="04-meetings-summary.json",
        device_name="04-meetings-summary-device.png",
    )
    transcript_from_summary = run_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=meetings_summary_ops(scenario["meeting_id"], scenario_dir / "05-prep-summary-browser.png") + transcript_from_summary_ops(scenario_dir / "06-transcript-from-summary-browser.png"),
        scenario_dir=scenario_dir,
        browser_json_name="06-transcript-from-summary.json",
        device_name="06-transcript-from-summary-device.png",
    )
    audio_from_summary = run_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=meetings_summary_ops(scenario["meeting_id"], scenario_dir / "07-prep-audio-summary-browser.png") + audio_from_summary_ops(scenario_dir / "08-audio-from-summary-browser.png"),
        scenario_dir=scenario_dir,
        browser_json_name="08-audio-from-summary.json",
        device_name="08-audio-from-summary-device.png",
        timeout_seconds=90,
    )
    audio_from_row = run_browser_phase(
        args,
        serial=serial,
        cdp_url=cdp_url,
        operations=audio_from_meetings_row_ops(scenario["meeting_id"], scenario_dir / "09-audio-from-row-browser.png"),
        scenario_dir=scenario_dir,
        browser_json_name="09-audio-from-row.json",
        device_name="09-audio-from-row-device.png",
        timeout_seconds=90,
    )

    row_title = text_content_value(meetings_summary, meeting_title_selector(scenario["meeting_id"]))
    if row_title != str(meeting.get("recording_title") or "").strip():
        raise MeetingModePhoneProofError(f"{scenario['name']} Meetings row title did not use recording_title")
    if selector_count_value(meetings_summary, f'{meeting_card_selector(scenario["meeting_id"])} .identity') != 0:
        raise MeetingModePhoneProofError(f"{scenario['name']} Meetings row still showed a left icon")
    if selector_count_value(meetings_summary, f'{meeting_card_selector(scenario["meeting_id"])} .preview') != 0:
        raise MeetingModePhoneProofError(f"{scenario['name']} Meetings row still showed preview text")
    if selector_count_value(meetings_summary, f'{meeting_card_selector(scenario["meeting_id"])} .action.action-audio') != 1:
        raise MeetingModePhoneProofError(f"{scenario['name']} Meetings row did not render exactly one right-side mic action")

    summary_audio = audio_playback_result(audio_from_summary)
    row_audio = audio_playback_result(audio_from_row)
    if float((summary_audio.get("after") or {}).get("currentTime") or 0) <= float((summary_audio.get("before") or {}).get("currentTime") or 0):
        raise MeetingModePhoneProofError(f"{scenario['name']} summary audio did not advance on device")
    if float((row_audio.get("after") or {}).get("currentTime") or 0) <= float((row_audio.get("before") or {}).get("currentTime") or 0):
        raise MeetingModePhoneProofError(f"{scenario['name']} row-mic audio did not advance on device")

    result = {
        "schema": "pucky.meeting_mode_phone_scenario.v1",
        "name": scenario["name"],
        "meeting_id": scenario["meeting_id"],
        "recording_title": str(meeting.get("recording_title") or ""),
        "card_title": str(meeting.get("title") or ""),
        "home_pending_route": phone_shared.route_of(home_pending),
        "meetings_pending_route": phone_shared.route_of(meetings_pending),
        "home_summary_route": phone_shared.route_of(home_summary),
        "meetings_summary_route": phone_shared.route_of(meetings_summary),
        "transcript_route": phone_shared.route_of(transcript_from_summary),
        "audio_from_summary": summary_audio,
        "audio_from_row": row_audio,
    }
    phone_shared.save_json(scenario_dir / "scenario_summary.json", result)
    return result


def run(args: argparse.Namespace) -> dict[str, Any]:
    browser_summary = load_browser_summary(args.browser_summary)
    fixture_dir = resolve_fixture_dir(args, browser_summary)
    scenarios = choose_scenarios(fixture_dir, list(args.scenarios or []))

    token = resolve_user_data_api_token(str(args.token or ""))
    if not token:
        raise MeetingModePhoneProofError("Android meeting proof requires --token or PUCKY_WEB_UI_TOKEN/PUCKY_API_TOKEN")

    if args.skip_official_preproof_check:
        local_git = proof.local_git_state(args.repo_root)
    else:
        local_git = proof.require_official_local_repo(args.repo_root, args.canonical_root)
    serial = proof.resolve_adb_serial(args)
    cdp = proof.discover_cover_cdp_url(args, serial)

    bundle = proof.bundle_status(args)
    surface_before = proof.snapshot_surface(args)
    installed_package = proof.installed_package_info(args, serial)
    identity = proof.apk_identity(args)
    remote_manifest = proof.expected_ui_manifest(args, local_git)
    identity_checks = (
        {
            "passed": True,
            "checks": {
                "bundle_installed": bool(bundle.get("installed")),
                "surface_present": bool(surface_before),
                "apk_identity_present": bool(identity),
            },
        }
        if args.skip_official_preproof_check
        else proof.verify_target_identity(
            args,
            local_git=local_git,
            remote_manifest=remote_manifest,
            bundle=bundle,
            surface=surface_before,
            installed_package=installed_package,
            identity=identity,
        )
    )

    scenario_root = args.evidence_dir / time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    scenario_root.mkdir(parents=True, exist_ok=True)
    summary = {
        "schema": RESULT_SCHEMA,
        "created_at": phone_shared.utc_stamp(),
        "base_url": args.vm_base_url,
        "fixture_dir": str(fixture_dir),
        "target": {
            "type": "phone",
            "serial": serial,
            "cdp_url": cdp["cdp_url"],
        },
        "identity_checks": identity_checks,
        "bundle": bundle,
        "surface_before": surface_before,
        "scenarios": [],
    }

    for scenario in scenarios:
        summary["scenarios"].append(run_scenario(
            args,
            serial=serial,
            cdp_url=cdp["cdp_url"],
            base_url=args.vm_base_url,
            token=token,
            scenario_root=scenario_root,
            scenario=scenario,
        ))

    summary["ok"] = True
    summary_path = scenario_root / "summary.json"
    phone_shared.save_json(summary_path, summary)
    return summary


if __name__ == "__main__":
    try:
        result = run(parse_args())
    except Exception as exc:
        payload = {
            "schema": RESULT_SCHEMA,
            "ok": False,
            "error": str(exc),
        }
        print(json.dumps(payload, indent=2))
        raise
    print(json.dumps(result, indent=2))
