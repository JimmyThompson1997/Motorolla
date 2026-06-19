from __future__ import annotations

import argparse
from pathlib import Path

import pytest

import tools.support.phone_proof_shared as shared


def make_args(tmp_path: Path) -> argparse.Namespace:
    return argparse.Namespace(
        package_name="com.pucky.device.debug",
        activity_name="com.pucky.device.CoverHomeActivity",
        repo_root=tmp_path,
    )


def test_parse_named_float_pref_reads_requested_key() -> None:
    xml = """<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n<float name=\"default_tile_audio_speed\" value=\"1.25\" />\n</map>\n"""

    assert shared.parse_named_float_pref(xml, "default_tile_audio_speed") == 1.25
    assert shared.parse_named_float_pref(xml, "missing") is None


def test_operation_text_and_route_helpers_use_final_entries() -> None:
    payload = {
        "operations": [
            {"kind": "text_content", "text": "1x"},
            {"kind": "text_content", "text": "1.25x"},
        ],
        "final_surface": {"route": "settings"},
    }

    assert shared.operation_text(payload) == "1.25x"
    assert shared.route_of(payload) == "settings"


def test_ensure_route_raises_on_mismatch() -> None:
    with pytest.raises(RuntimeError, match="expected route feed"):
        shared.ensure_route({"final_surface": {"route": "settings"}}, "feed", "proof", error_cls=RuntimeError)


def test_relaunch_activity_uses_package_and_activity(tmp_path: Path) -> None:
    args = make_args(tmp_path)
    calls: list[list[str]] = []

    def fake_run_adb(_args, _serial, adb_args, *, timeout_seconds):
        calls.append(adb_args)
        return ""

    shared.relaunch_activity(fake_run_adb, args, "ZY22JZ26LK", settle_seconds=0)

    assert calls == [["shell", "am", "start", "-n", "com.pucky.device.debug/com.pucky.device.CoverHomeActivity"]]
