from __future__ import annotations

import argparse
from pathlib import Path

import pytest

import tools.phone_walkie_thread_proof as proof


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
    )


def test_extract_json_prefers_puckyctl_result() -> None:
    text = "noise\n{\"ignored\":true}\nmore\n{\"schema\":\"puckyctl.result.v1\",\"ok\":true,\"result\":{\"value\":1}}\n"

    parsed = proof.extract_json(text)

    assert parsed == {"schema": "puckyctl.result.v1", "ok": True, "result": {"value": 1}}


def test_find_webview_sockets_deduplicates_and_sorts_latest_first() -> None:
    text = "\n".join([
        "00000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_27390",
        "00000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_20000",
        "00000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_27390",
    ])

    sockets = proof.find_webview_sockets(text)

    assert sockets == ["webview_devtools_remote_27390", "webview_devtools_remote_20000"]


def test_walkie_start_payload_uses_fixture_volume_up_auto_endpoint_defaults() -> None:
    payload = proof.walkie_start_payload("/data/user/0/com.pucky/files/demo.wav", "Should we change these goals?")

    assert payload["trigger_source"] == "volume_up_hold"
    assert payload["capture_source"] == "fixture"
    assert payload["fixture_path"].endswith("demo.wav")
    assert payload["debug_fixture_transcript"] == "Should we change these goals?"
    assert payload["auto_endpoint"] is True
    assert payload["speech_start_timeout_ms"] == 3000
    assert payload["trailing_silence_ms"] == 800
    assert payload["min_speech_ms"] == 180
    assert payload["max_duration_ms"] == 20000
    assert payload["feedback"] is False


def test_select_card_prefers_thread_backed_page_surface_and_excludes_threads() -> None:
    cards = [
        {
            "card_id": "a",
            "session_id": "a",
            "title": "Proof HTML Dashboard",
            "html_path": "/tmp/proof.html",
            "origin": {"thread_id": "thread-a"},
        },
        {
            "card_id": "b",
            "session_id": "b",
            "title": "Proof CSV Table",
            "transcript_messages": [{"attachments": [{"artifact": "table.csv"}]}],
            "origin": {"thread_id": "thread-b"},
        },
    ]

    first = proof.select_card(cards, title_contains="proof", require_thread=True, require_page=True)
    second = proof.select_card(cards, title_contains="proof", require_thread=True, excluded_thread_ids={"thread-a"})

    assert first["card_id"] == "a"
    assert second["card_id"] == "b"


def test_browser_helper_args_sets_node_path_and_request_file(tmp_path: Path) -> None:
    args = make_args(tmp_path)
    request = tmp_path / "request.json"
    output = tmp_path / "output.json"

    argv, env = proof.browser_helper_args(
        args,
        cdp_url="http://127.0.0.1:9222",
        request_path=request,
        output_path=output,
    )

    assert argv == [str(args.node), str(args.browser_helper), str(request)]
    assert env["NODE_PATH"] == str(args.node_modules)


def test_sapi_wave_command_uses_system_speech_and_wave_output(tmp_path: Path) -> None:
    command = proof.sapi_wave_command("Can you revise this file?", tmp_path / "fixture.wav", voice="Microsoft Zira Desktop", rate=-1)

    assert "Add-Type -AssemblyName System.Speech" in command
    assert "$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer" in command
    assert "$speaker.SelectVoice('Microsoft Zira Desktop')" in command
    assert "$speaker.Rate = -1" in command
    assert "$speaker.SetOutputToWaveFile" in command
    assert "$speaker.Speak('Can you revise this file?')" in command


def test_browser_ops_for_card_open_uses_transcript_session_id() -> None:
    card = {"session_id": "proof-session"}

    operations = proof.browser_ops_for_card_open(card, "transcript", "transcript")

    assert operations[0]["kind"] == "goto_home"
    assert operations[1] == {
        "kind": "open_card_action",
        "session_id": "proof-session",
        "action": "transcript",
        "expected_detail_type": "transcript",
    }


def test_browser_helper_source_uses_cdp_and_thread_scope_dom_hooks() -> None:
    source = (Path(proof.__file__).with_name("phone_walkie_thread_proof_browser.js")).read_text(encoding="utf-8")

    assert 'chromium.connectOverCDP' in source
    assert '[data-route="feed"]' in source
    assert '[data-card-action="' in source
    assert "data-detail-type" in source
    assert "page.screenshot" in source


def test_require_official_local_repo_rejects_noncanonical(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    other = tmp_path / "other"
    canonical = tmp_path / "canon"
    other.mkdir()
    canonical.mkdir()

    with pytest.raises(proof.PhoneProofError, match="must run from"):
        proof.require_official_local_repo(other, canonical)
