from __future__ import annotations

import argparse
from pathlib import Path

import tools.proofs.phone.phone_default_audio_speed_proof as audio_proof


def make_args(tmp_path: Path) -> argparse.Namespace:
    return argparse.Namespace(
        repo_root=tmp_path,
        canonical_root=tmp_path,
        evidence_dir=tmp_path / "evidence",
        browser_helper=tmp_path / "phone_walkie_thread_proof_browser.js",
        puckyctl=tmp_path / "puckyctl.py",
        node=tmp_path / "node.exe",
        node_modules=tmp_path / "node_modules",
        broker="https://pucky.fly.dev",
        token="dev-token",
        device_id="pucky-cover-settings-phone",
        command_timeout_seconds=120,
        browser_timeout_seconds=45,
        adb=tmp_path / "adb.exe",
        devtools_port=9222,
        package_name="com.pucky.device.debug",
        activity_name="com.pucky.device.CoverHomeActivity",
        skip_official_preproof_check=True,
    )


def test_format_speed_text_matches_ui_labels() -> None:
    assert audio_proof.speed_attr_value(1.0) == "1"
    assert audio_proof.speed_attr_value(1.25) == "1.25"
    assert audio_proof.speed_attr_value(2.0) == "2"
    assert audio_proof.format_speed_text(1.0) == "1x"
    assert audio_proof.format_speed_text(1.25) == "1.25x"
    assert audio_proof.format_speed_text(2.0) == "2x"


def test_settings_speed_ops_clicks_settings_row_and_expected_speed() -> None:
    ops = audio_proof.settings_speed_ops(1.25)

    assert ops[0]["kind"] == "goto_home"
    assert ops[1] == {"kind": "click_selector", "selector": '[data-route="settings"]'}
    assert ops[2] == {"kind": "wait_for_selector", "selector": '[data-setting-id="default-audio-speed"]'}
    assert ops[3] == {"kind": "click_selector", "selector": '[data-setting-id="default-audio-speed"]'}
    assert ops[4] == {"kind": "wait_for_selector", "selector": "#speedOverlay.is-open"}
    assert ops[5] == {"kind": "click_selector", "selector": '[data-speed-value="1.25"]'}
    assert ops[6] == {"kind": "wait_for_text", "selector": audio_proof.SETTINGS_VALUE_SELECTOR, "text": "1.25x"}
    assert ops[7] == {"kind": "text_content", "selector": audio_proof.SETTINGS_VALUE_SELECTOR}


def test_audio_detail_ops_target_audio_panel_and_speed_control() -> None:
    open_ops = audio_proof.audio_detail_open_ops("session-123", 1.25)
    override_ops = audio_proof.audio_detail_override_ops(2.0)
    reopen_ops = audio_proof.audio_detail_reopen_ops("session-123", 2.0)

    assert open_ops[1] == {
        "kind": "open_card_action",
        "session_id": "session-123",
        "action": "audio",
        "expected_detail_type": "audio",
    }
    assert open_ops[2] == {"kind": "wait_for_text", "selector": audio_proof.AUDIO_SPEED_SELECTOR, "text": "1.25x"}
    assert override_ops[0] == {"kind": "click_selector", "selector": audio_proof.AUDIO_SPEED_SELECTOR}
    assert override_ops[2] == {"kind": "click_selector", "selector": '[data-speed-value="2"]'}
    assert reopen_ops[0]["kind"] == "back"
    assert reopen_ops[2]["kind"] == "open_card_action"


def test_parse_default_tile_audio_speed_reads_shared_prefs_float() -> None:
    xml = """<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n<float name=\"default_tile_audio_speed\" value=\"1.25\" />\n</map>\n"""

    assert audio_proof.parse_default_tile_audio_speed(xml) == 1.25
    assert audio_proof.parse_default_tile_audio_speed("<map></map>") is None


def test_operation_text_picks_last_text_content_result() -> None:
    payload = {
        "operations": [
            {"kind": "text_content", "text": "1x"},
            {"kind": "describe"},
            {"kind": "text_content", "text": "1.25x"},
        ]
    }

    assert audio_proof.operation_text(payload) == "1.25x"


def test_relaxed_identity_requires_bundle_surface_and_apk_identity() -> None:
    result = audio_proof.relaxed_identity({"installed": True}, {"route": "feed"}, {"git_commit": "abc"})

    assert result["passed"] is True
    assert audio_proof.relaxed_identity({}, {}, {})["passed"] is False


def test_wait_for_player_speed_polls_until_match(monkeypatch, tmp_path: Path) -> None:
    args = make_args(tmp_path)
    states = iter([
        {"speed": 1.0},
        {"speed": 1.25},
    ])

    monkeypatch.setattr(audio_proof.proof, "run_pucky_command", lambda *_args, **_kwargs: next(states))

    result = audio_proof.wait_for_player_speed(args, 1.25)

    assert result["speed"] == 1.25
