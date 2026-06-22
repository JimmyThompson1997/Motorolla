from __future__ import annotations

import argparse
import base64
import json

import tools.proofs.phone.phone_links_auth_flow_emulator_proof as proof


def make_args(**overrides: object) -> argparse.Namespace:
    values = {
        "api_token": "api-token",
        "device_token": "device-token",
        "base_url": "https://pucky.fly.dev",
    }
    values.update(overrides)
    return argparse.Namespace(**values)


def test_provisioning_payload_keeps_explicit_api_token_and_optional_device_token() -> None:
    args = make_args()

    payload = json.loads(base64.b64decode(proof.provisioning_base64(args)).decode("utf-8"))

    assert payload == {
        "schema": "pucky.provisioning.v1",
        "device_id": "emu-links-auth-live-proof",
        "pucky_api_token": "api-token",
        "token": "device-token",
    }

    args = make_args(device_token="")
    payload = json.loads(base64.b64decode(proof.provisioning_base64(args)).decode("utf-8"))

    assert payload == {
        "schema": "pucky.provisioning.v1",
        "device_id": "emu-links-auth-live-proof",
        "pucky_api_token": "api-token",
    }


def test_auth_snapshot_validation_rejects_connect_page_and_accepts_auth_targets() -> None:
    assert not proof.auth_snapshot_is_valid(
        {
            "url": "https://pucky.fly.dev/ui/pucky/latest/?theme=light&route=connect",
            "title": "Pucky Cover",
            "body_text": "Slack Connect",
        },
        base_url="https://pucky.fly.dev",
    )

    assert proof.auth_snapshot_is_valid(
        {
            "url": "https://app.composio.dev/oauth/slack/start",
            "title": "Slack Sign in",
            "body_text": "Sign in to Slack",
        },
        base_url="https://pucky.fly.dev",
    )


def test_auth_snapshot_rendered_content_requires_more_than_blank_loading_surface() -> None:
    assert not proof.auth_snapshot_has_rendered_content(
        {
            "url": "https://slack.com/workspace-signin",
            "title": "",
            "body_text": "",
        }
    )

    assert proof.auth_snapshot_has_rendered_content(
        {
            "url": "https://slack.com/workspace-signin",
            "title": "Find your workspace | Slack",
            "body_text": "Sign in to your workspace",
        }
    )

    assert not proof.auth_snapshot_has_rendered_content(
        {
            "url": "https://platform.composio.dev/link/lk_123",
            "title": "Composio Platform",
            "body_text": "",
        }
    )


def test_has_forbidden_connect_error_requires_ready_session_and_no_inline_error() -> None:
    state = {
        "metrics": {
            "api_token_present": True,
            "portal_token_present": True,
            "inline_message": "",
        },
        "body_text": "Slack Slackbot",
    }

    assert proof.has_forbidden_connect_error(state) == ""
    assert "missing pucky_api_token" in proof.has_forbidden_connect_error(
        {
            "metrics": {
                "api_token_present": False,
                "portal_token_present": False,
                "inline_message": "Device provisioning missing pucky_api_token.",
            },
            "body_text": "Device provisioning missing pucky_api_token.",
        }
    ).lower()


def test_parse_focus_component_accepts_multiple_android_dumpsys_shapes() -> None:
    assert (
        proof.parse_focus_component(
            "mCurrentFocus=Window{d36cd6b u0 com.pucky.device.debug/com.pucky.device.MainActivity}"
        )
        == "com.pucky.device.debug/com.pucky.device.MainActivity"
    )


def test_browser_helper_timeout_covers_requested_operation_budget() -> None:
    request = {
        "timeout_ms": 30000,
        "operations": [
            {"kind": "wait_for_connect_ready", "timeout_ms": 60000},
            {"kind": "links_state"},
        ],
    }

    assert proof.browser_helper_timeout_seconds(request, 45) == 75
    assert (
        proof.parse_focus_component(
            "topResumedActivity=ActivityRecord{c48e3d5 u0 com.pucky.device.debug/com.pucky.device.MainActivity t8}"
        )
        == "com.pucky.device.debug/com.pucky.device.MainActivity"
    )
    assert (
        proof.parse_focus_component(
            "TASK 10207:com.pucky.device.debug id=8\n  ACTIVITY com.pucky.device.debug/com.pucky.device.MainActivity c48e3d5 pid=4230"
        )
        == "com.pucky.device.debug/com.pucky.device.MainActivity"
    )


def test_chrome_focus_requires_setup_only_for_first_run_activity() -> None:
    assert proof.chrome_focus_requires_setup(
        "com.android.chrome/org.chromium.chrome.browser.firstrun.FirstRunActivity"
    )
    assert not proof.chrome_focus_requires_setup(
        "com.android.chrome/org.chromium.chrome.browser.ChromeTabbedActivity"
    )
    assert not proof.chrome_focus_requires_setup(
        "com.pucky.device.debug/com.pucky.device.MainActivity"
    )


def test_find_devtools_sockets_keeps_plain_chrome_and_webview_targets() -> None:
    sockets = proof.find_devtools_sockets(
        "@chrome_devtools_remote ... @webview_devtools_remote_24828 ... @chrome_devtools_remote"
    )

    assert sockets == [
        "chrome_devtools_remote",
        "webview_devtools_remote_24828",
    ]
