from __future__ import annotations

import argparse

import tools.apk_command_certification as cert


def test_certification_recipes_cover_current_command_universe() -> None:
    commands = cert.source_commands()
    coverage = cert.validate_recipe_coverage(commands, cert.static_recipes("unit-cert"))

    assert len(commands) == 258
    assert len(commands) == len(set(commands))
    assert coverage == {"missing": [], "extra": [], "duplicates": []}


def test_command_universe_contains_android_plane_aliases_and_fallback() -> None:
    commands = set(cert.source_commands())

    required = {
        "android.catalog",
        "android.sms.send",
        "android.calls.answer",
        "android.contacts.photo.put",
        "android.notifications.listener.messages",
        "phone.sms.send",
        "phone.calls.answer",
        "notify.listener.messages",
        "ui.debug.goto_home",
        "ui.debug.back",
        "ui.debug.focus_card",
        "ui.debug.clear_focus",
        "ui.debug.refresh_cards",
        "ui.debug.open_card_action",
        "voice.thread_scope.get",
        "voice.thread_scope.set",
        "voice.thread_scope.clear",
        "android.substrate",
    }

    assert required <= commands


def test_live_comms_and_user_mediated_recipes_are_explicitly_gated() -> None:
    recipes = cert.static_recipes("unit-cert")
    base = argparse.Namespace(include_live_comms=False, include_user_mediated=False)

    sms = cert.recipe_for("android.sms.send", recipes, base)
    settings = cert.recipe_for("android.settings.open", recipes, base)

    assert sms is not None
    assert sms.expected == "blocked_environment"
    assert "live comms disabled" in sms.notes
    assert settings is not None
    assert settings.expected == "user_mediated_verified"
    assert "not run" in settings.notes


def test_outcome_mapping_accepts_honest_failures() -> None:
    honest = cert.Recipe("pass_or_honest_failure")
    strict = cert.Recipe("pass")
    failed_response = {"ok": False, "error": {"code": "PERMISSION_MISSING"}}
    ok_response = {"ok": True, "result": {}}

    assert cert.outcome_for(honest, failed_response) == "pass_honest_failure"
    assert cert.outcome_for(honest, ok_response) == "pass"
    assert cert.outcome_for(strict, failed_response) == "fail"


def test_should_retry_response_only_for_transient_failures() -> None:
    assert cert.should_retry_response({"ok": False, "status": "device_offline", "error": {"code": "DEVICE_OFFLINE"}}) is True
    assert cert.should_retry_response({"ok": False, "status": "accepted", "error": {"code": ""}}) is True
    assert cert.should_retry_response({"ok": False, "status": "failed", "error": {"code": "BROKER_UNAVAILABLE"}}) is True
    assert cert.should_retry_response({"ok": False, "status": "failed", "error": {"message": "[WinError 10054] An existing connection was forcibly closed by the remote host"}}) is True
    assert cert.should_retry_response({"ok": False, "status": "completed", "error": {"code": "PERMISSION_MISSING"}}) is False


def test_run_command_retries_until_success(monkeypatch) -> None:
    calls = []
    responses = iter(
        [
            {"ok": False, "status": "device_offline", "error": {"code": "DEVICE_OFFLINE"}, "result": {}, "command_id": "one", "type": "ping", "returncode": 1, "raw_tail": ""},
            {"ok": True, "status": "completed", "error": None, "result": {"schema": "ok"}, "command_id": "two", "type": "ping", "returncode": 0, "raw_tail": ""},
        ]
    )

    def fake_once(args, command, payload, *, timeout_seconds=60):
        calls.append((command, payload, timeout_seconds))
        return next(responses)

    monkeypatch.setattr(cert, "run_command_once", fake_once)
    monkeypatch.setattr(cert.time, "sleep", lambda *_args, **_kwargs: None)

    args = argparse.Namespace(command_attempts=3)
    result = cert.run_command(args, "ping", {})

    assert len(calls) == 2
    assert result["ok"] is True
    assert result["attempt"] == 2
