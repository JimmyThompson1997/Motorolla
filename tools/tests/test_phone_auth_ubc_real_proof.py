from __future__ import annotations

import argparse
import json
from pathlib import Path

import pytest

import tools.proofs.auth.phone_auth_ubc_real_proof as proof_script


def test_android_auth_proof_fails_closed_on_transport_before_serial_resolution(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    report_dir = tmp_path / "report"
    args = argparse.Namespace(
        report_dir=report_dir,
        package_name="com.pucky.app",
        apk=tmp_path / "app-debug.apk",
        login_url="https://example.test/sign-in",
        workspace_host_pattern="",
        major_routes=["home", "inbox", "connect", "settings"],
    )

    monkeypatch.setattr(proof_script, "parse_args", lambda argv=None: args)

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("should not be called before transport preflight")

    monkeypatch.setattr(proof_script, "ensure_inputs", fail_if_called)
    monkeypatch.setattr(proof_script.proof, "resolve_adb_serial", fail_if_called)
    monkeypatch.setattr(proof_script, "current_git_head", lambda: "deadbeef")
    monkeypatch.setattr(proof_script.phone_shared, "utc_stamp", lambda: "2026-06-26T00:00:00Z")
    monkeypatch.setattr(
        proof_script,
        "transport_preflight",
        lambda _args: (_ for _ in ()).throw(proof_script.AndroidAuthProofError("Android transport is blocked. usb_ready")),
    )

    with pytest.raises(proof_script.AndroidAuthProofError):
        proof_script.main([])

    summary = json.loads((report_dir / "summary.json").read_text(encoding="utf-8"))
    verdict = json.loads((report_dir / "verdict.json").read_text(encoding="utf-8"))

    assert summary["ok"] is False
    assert summary["device_serial"] == ""
    assert "Android transport is blocked." in summary["error"]
    assert verdict["status"] == "fail"
    assert "Android transport is blocked." in verdict["reason"]
