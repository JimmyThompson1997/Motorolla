from __future__ import annotations

import argparse

import tools.apk_command_certification as cert


def test_certification_recipes_cover_current_command_universe() -> None:
    commands = cert.source_commands()
    coverage = cert.validate_recipe_coverage(commands, cert.static_recipes("unit-cert"))

    assert len(commands) == 237
    assert len(commands) == len(set(commands))
    assert coverage == {"missing": [], "extra": [], "duplicates": []}


def test_command_universe_contains_android_plane_aliases_and_fallback() -> None:
    commands = set(cert.source_commands())

    required = {
        "android.catalog",
        "android.content.query",
        "android.sms.send",
        "android.calls.answer",
        "android.contacts.photo.put",
        "android.notifications.listener.messages",
        "phone.sms.send",
        "phone.calls.answer",
        "notify.listener.messages",
        "ui.debug.goto_home",
        "ui.debug.back",
        "ui.debug.open_card_action",
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
