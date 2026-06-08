from __future__ import annotations

import argparse
import json
from pathlib import Path

import pytest

import tools.phone_meeting_mode_real_vm_proof as meeting_proof


def make_args(tmp_path: Path) -> argparse.Namespace:
    return argparse.Namespace(
        browser_summary=None,
        fixture_dir=None,
        scenarios=[],
        token="dev-token",
        vm_base_url="https://pucky.fly.dev",
        repo_root=tmp_path,
        canonical_root=tmp_path,
        evidence_dir=tmp_path / "evidence",
        browser_helper=tmp_path / "phone_walkie_thread_proof_browser.js",
        node=tmp_path / "node.exe",
        node_modules=tmp_path / "node_modules",
        adb=tmp_path / "adb.exe",
        package_name="com.pucky.device.debug",
        activity_name="com.pucky.device.CoverHomeActivity",
        skip_official_preproof_check=True,
        browser_timeout_seconds=60,
        command_timeout_seconds=120,
        devtools_port=9222,
    )


def write_browser_summary(path: Path, *, ok: bool = True) -> Path:
    path.write_text(json.dumps({"ok": ok, "report_dir": str(path.parent)}, indent=2), encoding="utf-8")
    return path


def make_fixture_dir(tmp_path: Path) -> Path:
    fixture_dir = tmp_path / "generated-fixtures"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    for spec in meeting_proof.scenario_specs():
        (fixture_dir / spec["fixture_name"]).write_bytes(b"RIFF" + b"\x00" * 44)
    return fixture_dir


def test_load_browser_summary_requires_green(tmp_path: Path) -> None:
    path = write_browser_summary(tmp_path / "summary.json", ok=False)

    with pytest.raises(meeting_proof.MeetingModePhoneProofError, match="Browser summary must be green"):
        meeting_proof.load_browser_summary(path)


def test_resolve_fixture_dir_from_browser_summary(tmp_path: Path) -> None:
    summary_path = write_browser_summary(tmp_path / "summary.json")
    fixture_dir = make_fixture_dir(tmp_path)
    args = make_args(tmp_path)
    args.browser_summary = summary_path

    resolved = meeting_proof.resolve_fixture_dir(args, meeting_proof.load_browser_summary(summary_path))

    assert resolved == fixture_dir


def test_choose_scenarios_filters_and_reuses_named_fixture_files(tmp_path: Path) -> None:
    fixture_dir = make_fixture_dir(tmp_path)

    scenarios = meeting_proof.choose_scenarios(fixture_dir, ["named_duo_3to5m", "anonymous_trio_3to5m"])

    assert [item["name"] for item in scenarios] == ["named_duo_3to5m", "anonymous_trio_3to5m"]
    assert scenarios[0]["fixture_path"].name == "named-duo-3to5m-generated.wav"
    assert scenarios[1]["fixture_path"].name == "anonymous-trio-3to5m-generated.wav"


def test_meetings_summary_ops_hide_left_icon_and_preview_and_open_summary() -> None:
    ops = meeting_proof.meetings_summary_ops("meeting-123", Path("summary.png"))

    assert ops[0]["kind"] == "goto_home"
    assert ops[1] == {"kind": "click_selector", "selector": '[data-route="meetings"]'}
    assert {"kind": "selector_count", "selector": '[data-card-session-id="meeting-123"] .identity'} in ops
    assert {"kind": "selector_count", "selector": '[data-card-session-id="meeting-123"] .preview'} in ops
    assert {"kind": "wait_for_text", "selector": meeting_proof.DETAIL_TITLE_SELECTOR, "text": "Meeting Summary"} in ops


def test_audio_ops_use_summary_frame_link_and_playback_probe() -> None:
    ops = meeting_proof.audio_from_summary_ops(Path("audio.png"))

    assert ops[0] == {"kind": "wait_for_selector", "selector": "#detail iframe.document-frame"}
    assert ops[1]["kind"] == "click_frame_selector"
    assert ops[1]["selector"] == "a.pucky-meeting-audio-link"
    assert ops[3] == {"kind": "audio_state", "selector": meeting_proof.AUDIO_SELECTOR}
    assert ops[4] == {"kind": "play_audio", "selector": meeting_proof.AUDIO_SELECTOR}
