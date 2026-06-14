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
        package_name="com.pucky.device.debug",
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
        "00000000: 00000002 00000000 00010000 0001 01 12345 @com.pucky.device.debug_devtools_remote",
        "00000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_27390",
    ])

    sockets = proof.find_webview_sockets(text)

    assert sockets == [
        "webview_devtools_remote_27390",
        "webview_devtools_remote_20000",
        "com.pucky.device.debug_devtools_remote",
    ]


def test_discover_cover_cdp_url_launches_cover_and_retries_until_cover_page(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    args = make_args(tmp_path)
    adb_calls: list[list[str]] = []
    unix_snapshots = iter([
        "",
        "00000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_15654",
    ])

    def fake_run_adb(inner_args: argparse.Namespace, serial: str, command: list[str], timeout_seconds: int | float = 30) -> str:
        adb_calls.append(list(command))
        if command[:4] == ["shell", "am", "start", "-n"]:
            return "Starting: Intent"
        if command == ["shell", "cat", "/proc/net/unix"]:
            return next(unix_snapshots)
        if command[:1] == ["forward"]:
            return ""
        raise AssertionError(f"unexpected adb command: {command}")

    monkeypatch.setattr(proof, "run_adb", fake_run_adb)
    monkeypatch.setattr(proof, "pick_free_port", lambda preferred=9222: 9333)
    monkeypatch.setattr(proof, "fetch_json", lambda url: [{"title": "Pucky Cover", "url": "file:///data/data/com.pucky.device.debug/files/ui_bundles/current/index.html"}])
    monkeypatch.setattr(proof.time, "sleep", lambda seconds: None)

    result = proof.discover_cover_cdp_url(args, "ZY22JZ26LK")

    assert adb_calls[0] == ["shell", "am", "start", "-n", "com.pucky.device.debug/com.pucky.device.MainActivity"]
    assert ["shell", "cat", "/proc/net/unix"] in adb_calls
    assert result == {
        "socket": "webview_devtools_remote_15654",
        "cdp_url": "http://127.0.0.1:9333",
        "forward_port": "9333",
    }


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

    delayed = proof.walkie_start_payload(
        "/data/user/0/com.pucky/files/demo.wav",
        "Should we change these goals?",
        proof_reply_delay_ms=2400,
    )
    assert delayed["proof_reply_delay_ms"] == 2400


def test_select_card_prefers_thread_backed_page_surface_and_excludes_threads() -> None:
    cards = [
        {
            "card_id": "pending-a",
            "session_id": "pending-a",
            "title": "Proof HTML Dashboard",
            "html_path": "/tmp/proof-pending.html",
            "pending_outbound": True,
            "origin": {"thread_id": "thread-pending"},
        },
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
    assert proof.select_card(cards, required_thread_id="thread-b", require_thread=True)["card_id"] == "b"


def test_select_feed_focus_card_prefers_first_visible_thread_when_unpinned() -> None:
    cards = [
        {
            "card_id": "a",
            "session_id": "a",
            "title": "Proof HTML Dashboard",
            "origin": {"thread_id": "thread-a"},
        },
        {
            "card_id": "b",
            "session_id": "b",
            "title": "Need tile context",
            "origin": {"thread_id": "thread-b"},
        },
    ]
    surface = {
        "visible_cards": [
            {"thread_id": "thread-b", "preview": "Need tile context"},
            {"thread_id": "thread-a", "preview": "Proof HTML Dashboard"},
        ]
    }

    result = proof.select_feed_focus_card(cards, surface)

    assert result["card_id"] == "b"
    assert proof.select_feed_focus_card(cards, surface, required_thread_id="thread-a")["card_id"] == "a"


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
    assert "PuckyUiDebug.describe" in source
    assert 'op.kind === "focus_card"' in source
    assert 'op.kind === "clear_focus"' in source
    assert '[data-route="feed"]' in source
    assert '[data-card-action="' in source
    assert "data-detail-type" in source
    assert 'if (op.kind === "screenshot")' in source
    assert 'if (op.kind === "click_selector")' in source
    assert 'if (op.kind === "wait_for_selector")' in source
    assert 'if (op.kind === "wait_for_text")' in source
    assert 'if (op.kind === "text_content")' in source
    assert 'if (op.kind === "selector_count")' in source
    assert 'if (op.kind === "click_frame_selector")' in source
    assert 'if (op.kind === "audio_state")' in source
    assert 'if (op.kind === "play_audio")' in source
    assert "page.screenshot" in source
    assert "scrollIntoViewIfNeeded" in source


def test_preferred_cover_display_id_prefers_secondary_display() -> None:
    text = (
        'Display 4627039422300187648 (HWC display 0): port=0 pnpId=MTK displayName="MTKDEV"\n'
        'Display 4627039422300187651 (HWC display 3): port=3 pnpId=MTK displayName="MTKDEV"\n'
    )

    assert proof.parse_surfaceflinger_displays(text) == [
        {"display_id": "4627039422300187648", "hwc_display": "0"},
        {"display_id": "4627039422300187651", "hwc_display": "3"},
    ]
    assert proof.preferred_cover_display_id(text) == "4627039422300187651"


def test_extract_png_bytes_strips_warning_prefix() -> None:
    body = b"WARNING: multiple displays\n\x89PNG\r\n\x1a\npayload"

    assert proof.extract_png_bytes(body) == b"\x89PNG\r\n\x1a\npayload"


def test_visible_thread_index_finds_matching_slot() -> None:
    surface = {
        "final_surface": {
            "visible_cards": [
                {"thread_id": "thread-a", "kind": "reply"},
                {"thread_id": "thread-b", "kind": "pending_outbound"},
            ]
        }
    }

    assert proof.visible_thread_index(surface, "thread-a") == 0
    assert proof.visible_thread_index(surface, "thread-b") == 1
    assert proof.visible_thread_index(surface, "missing") == -1


def test_visible_cards_accepts_direct_surface_snapshot() -> None:
    surface = {
        "visible_cards": [
            {"thread_id": "thread-a", "kind": "reply"},
            {"thread_id": "thread-b", "kind": "pending_outbound"},
        ]
    }

    assert proof.visible_cards(surface) == surface["visible_cards"]


def test_detail_helpers_extract_messages_from_final_surface() -> None:
    surface = {
        "final_surface": {
            "detail": {
                "open": True,
                "thread_id": "thread-a",
                "messages": [
                    {"role": "user", "text": "hello"},
                    {"role": "assistant", "text": "world", "extra": "ignored"},
                    "skip-me",
                ],
            }
        }
    }

    assert proof.detail_surface(surface)["thread_id"] == "thread-a"
    assert proof.detail_messages(surface) == [
        {"role": "user", "text": "hello"},
        {"role": "assistant", "text": "world"},
    ]


def test_scenario_checks_reports_overall_pass() -> None:
    passing = proof.scenario_checks({"one": True, "two": True})
    failing = proof.scenario_checks({"one": True, "two": False})

    assert passing == {"passed": True, "checks": {"one": True, "two": True}}
    assert failing == {"passed": False, "checks": {"one": True, "two": False}}


def test_reply_saved_turn_record_uses_visible_card_fallback(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = make_args(tmp_path)
    turn_id = "turn-123"

    monkeypatch.setattr(
        proof,
        "turn_read",
        lambda _args, _turn_id: {"turn_id": _turn_id, "latest_state": "completed", "server_telemetry": {"proof_reply_delay_ms_applied": 6000}},
    )
    monkeypatch.setattr(
        proof,
        "snapshot_cards",
        lambda _args: {
            "cards": [
                {
                    "card_id": "card-123",
                    "session_id": turn_id,
                    "turn_id": turn_id,
                    "title": "Dashboard continued",
                    "summary": "Updated `dashboard.html`.",
                    "transcript_messages": [
                        {"role": "user", "text": "Continue the dashboard thread."},
                        {"role": "assistant", "text": "Updated `dashboard.html`."},
                    ],
                    "origin": {"thread_id": "thread-new"},
                }
            ]
        },
    )

    result = proof.reply_saved_turn_record(args, turn_id)

    assert result["reply_card_saved"] is True
    assert result["card_id"] == "card-123"
    assert result["user_transcript"] == "Continue the dashboard thread."
    assert result["server_telemetry"]["proof_reply_delay_ms_applied"] == 6000


def test_card_text_helpers_cover_preview_placeholder_and_transcript() -> None:
    card = {
        "preview": "Sending your message...",
        "summary": "Continue this focused tile.",
        "origin": {"thread_id": "thread-a"},
    }

    assert "Sending your message..." in proof.card_text_blob(card)
    assert proof.card_has_pending_placeholder(card) is True
    assert proof.card_has_transcript_preview(card, "Continue this focused tile.") is True


def test_pending_user_preview_observed_accepts_transcript_when_placeholder_is_gone() -> None:
    pending = {"placeholder_seen": False, "transcript_preview_seen": True}
    card = {
        "preview": "Continue this focused tile.",
        "origin": {"thread_id": "thread-a"},
    }

    assert proof.pending_user_preview_observed(pending, card, "Continue this focused tile.") is True


def test_observe_pending_thread_card_returns_latest_pending_when_placeholder_is_missed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = make_args(tmp_path)
    snapshots = iter([
        {"cards": []},
        {
            "cards": [
                {
                    "card_id": "pending-1",
                    "session_id": "pending-1",
                    "pending_outbound": True,
                    "summary": "Continue this focused tile.",
                    "origin": {"thread_id": "thread-a"},
                }
            ]
        },
    ])
    current = {"value": 0.0}

    def fake_snapshot_cards(_args: argparse.Namespace) -> dict:
        try:
            return next(snapshots)
        except StopIteration:
            return {
                "cards": [
                    {
                        "card_id": "pending-1",
                        "session_id": "pending-1",
                        "pending_outbound": True,
                        "summary": "Continue this focused tile.",
                        "origin": {"thread_id": "thread-a"},
                    }
                ]
            }

    def fake_monotonic() -> float:
        current["value"] += 0.2
        return current["value"]

    monkeypatch.setattr(proof, "snapshot_cards", fake_snapshot_cards)
    monkeypatch.setattr(proof.time, "monotonic", fake_monotonic)
    monkeypatch.setattr(proof.time, "sleep", lambda _seconds: None)

    result = proof.observe_pending_thread_card(
        args,
        "thread-a",
        "Continue this focused tile.",
        timeout_seconds=0.6,
        description="pending thread card",
    )

    assert result["placeholder_seen"] is False
    assert result["transcript_preview_seen"] is True
    assert result["card"]["card_id"] == "pending-1"


def test_card_matches_continuation_thread_accepts_semantic_new_thread() -> None:
    source = {
        "title": "Thread A Continued",
        "summary": "Continuing Thread A with `dashboard.html` updates.",
        "origin": {"thread_id": "thread-a", "thread_title": "Thread A Continued"},
    }
    result = {
        "title": "Dashboard continued",
        "summary": "Updated `dashboard.html` and daily goals.",
        "origin": {"thread_id": "thread-a-next"},
    }

    tokens = proof.continuation_match_tokens(source)

    assert "dashboard.html" in tokens
    assert "thread a continued" in tokens
    assert proof.card_matches_continuation_thread(result, "thread-a", source_tokens=tokens, excluded_thread_ids={"thread-b"}) is True
    assert proof.card_matches_continuation_thread({"origin": {"thread_id": "thread-a"}}, "thread-a", source_tokens=tokens) is True
    assert proof.card_matches_continuation_thread(result, "thread-a", source_tokens=tokens, excluded_thread_ids={"thread-a-next"}) is False


def test_verify_target_identity_requires_matching_bundle_and_apk_identity(tmp_path: Path) -> None:
    args = make_args(tmp_path)
    local_git = {"head": "abc123", "upstream": "abc123"}
    bundle = {"installed": True, "ui_version": "git-abc123"}
    surface = {"ui_version": "git-abc123"}
    installed = {"version_name": "0.1", "version_code": "42"}
    identity = {"git_commit": "abc123", "git_dirty": False, "version_name": "0.1", "version_code": 42}

    result = proof.verify_target_identity(
        args,
        local_git=local_git,
        remote_manifest=None,
        bundle=bundle,
        surface=surface,
        installed_package=installed,
        identity=identity,
    )

    assert result["passed"] is True

    with pytest.raises(proof.PhoneProofError, match="target identity mismatch"):
        proof.verify_target_identity(
            args,
            local_git=local_git,
            remote_manifest=None,
            bundle=bundle,
            surface=surface,
            installed_package=installed,
            identity={"git_commit": "other", "git_dirty": False, "version_name": "0.1", "version_code": 42},
        )


def test_require_official_local_repo_rejects_noncanonical(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    other = tmp_path / "other"
    canonical = tmp_path / "canon"
    other.mkdir()
    canonical.mkdir()

    with pytest.raises(proof.PhoneProofError, match="must run from"):
        proof.require_official_local_repo(other, canonical)


def test_thread_scope_status_falls_back_to_surface_when_command_not_allowed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = make_args(tmp_path)

    def fake_run_pucky_command(_args: argparse.Namespace, command_type: str, payload: dict[str, object], **_: object) -> dict[str, object]:
        if command_type == "voice.thread_scope.get":
            raise proof.PhoneProofError("puckyctl command send voice.thread_scope.get failed: COMMAND_NOT_ALLOWED")
        if command_type == "ui.surface.get":
            return {
                "thread_scope": {
                    "mode": "existing_thread",
                    "thread_id": "thread-1",
                    "source_surface": "thread_transcript",
                }
            }
        raise AssertionError(f"unexpected command {command_type}")

    monkeypatch.setattr(proof, "run_pucky_command", fake_run_pucky_command)

    result = proof.thread_scope_status(args)

    assert result == {
        "mode": "existing_thread",
        "thread_id": "thread-1",
        "source_surface": "thread_transcript",
    }


def test_snapshot_cards_falls_back_to_ui_surface_when_reply_cards_not_allowed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    args = make_args(tmp_path)

    def fake_run_pucky_command(_args: argparse.Namespace, command_type: str, payload: dict[str, object], **_: object) -> dict[str, object]:
        if command_type == "ui.reply_cards.get":
            raise proof.PhoneProofError("puckyctl command send ui.reply_cards.get failed: COMMAND_NOT_ALLOWED")
        if command_type == "ui.surface.get":
            return {
                "visible_cards": [
                    {
                        "kind": "pending_outbound",
                        "card_id": "card-1",
                        "session_id": "session-1",
                        "thread_id": "thread-1",
                        "pending_outbound": True,
                        "preview": "Draft update",
                    },
                    {
                        "kind": "reply_card",
                        "card_id": "card-2",
                        "session_id": "session-2",
                        "thread_id": "thread-2",
                        "pending_outbound": False,
                        "preview": "Assistant reply",
                    },
                ]
            }
        raise AssertionError(f"unexpected command {command_type}")

    monkeypatch.setattr(proof, "run_pucky_command", fake_run_pucky_command)

    result = proof.snapshot_cards(args)

    assert result["source"] == "ui_surface_fallback"
    assert result["count"] == 2
    assert result["cards"] == [
        {
            "card_id": "card-1",
            "session_id": "session-1",
            "local_session_id": "session-1",
            "title": "Draft update",
            "preview": "Draft update",
            "summary": "Draft update",
            "kind": "pending_outbound",
            "pending_outbound": True,
            "origin": {"thread_id": "thread-1"},
            "surface_source": "ui_surface",
        },
        {
            "card_id": "card-2",
            "session_id": "session-2",
            "local_session_id": "session-2",
            "title": "Assistant reply",
            "preview": "Assistant reply",
            "summary": "Assistant reply",
            "kind": "reply_card",
            "pending_outbound": False,
            "origin": {"thread_id": "thread-2"},
            "surface_source": "ui_surface",
        },
    ]


def test_snapshot_cards_re_raises_unrelated_errors(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = make_args(tmp_path)

    def fake_run_pucky_command(_args: argparse.Namespace, command_type: str, payload: dict[str, object], **_: object) -> dict[str, object]:
        if command_type == "ui.reply_cards.get":
            raise proof.PhoneProofError("broker command failed: timeout")
        raise AssertionError(f"unexpected command {command_type}")

    monkeypatch.setattr(proof, "run_pucky_command", fake_run_pucky_command)

    with pytest.raises(proof.PhoneProofError, match="timeout"):
        proof.snapshot_cards(args)


def test_phone_proof_parser_includes_feed_focus_transcript_live_history_and_all_final_boss(tmp_path: Path) -> None:
    args = proof.parse_args([
        "--repo-root",
        str(tmp_path),
        "--canonical-root",
        str(tmp_path),
        "--scenario",
        "feed_focus",
    ])
    history = proof.parse_args([
        "--repo-root",
        str(tmp_path),
        "--canonical-root",
        str(tmp_path),
        "--scenario",
        "history",
    ])
    transcript_live = proof.parse_args([
        "--repo-root",
        str(tmp_path),
        "--canonical-root",
        str(tmp_path),
        "--scenario",
        "transcript_live",
    ])

    assert args.scenario == "feed_focus"
    assert history.scenario == "history"
    assert transcript_live.scenario == "transcript_live"
    assert args.feed_focus_text
    assert history.history_text


def test_card_history_helpers_find_user_audio_and_assistant_artifacts() -> None:
    card = {
        "html_path": "/tmp/page.html",
        "transcript_messages": [
            {"role": "user", "attachments": [{"kind": "audio", "mime_type": "audio/wav"}]},
            {"role": "assistant", "attachments": [{"kind": "document", "artifact": "doc"}]},
        ],
    }

    assert proof.card_has_user_audio_chip(card) is True
    assert proof.card_has_assistant_artifact(card) is True
