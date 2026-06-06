from __future__ import annotations

import argparse
import json
from pathlib import Path

import pytest

import tools.sync_pucky_vm_official as sync


def test_sync_helper_uses_flyctl_ssh_console_command() -> None:
    remote_command = sync.build_remote_sync_shell_command("/data/pucky-src")
    command = sync.fly_ssh_command(
        flyctl=Path("flyctl"),
        app="pucky",
        remote_command=remote_command,
    )

    assert command[:4] == ["flyctl", "ssh", "console", "-a"]
    assert "--command" in command
    assert "pucky" in command
    assert remote_command.startswith("sh -lc ")


def test_choose_machine_id_prefers_started_machine() -> None:
    stdout = json.dumps(
        [
            {"id": "stopped-1", "state": "stopped"},
            {"id": "started-2", "state": "started"},
        ]
    )

    assert sync.choose_machine_id(stdout) == "started-2"


def test_has_only_ignorable_fly_stderr_accepts_known_console_noise() -> None:
    stderr = "\n".join(
        [
            "Connecting to fdaa:47:ec5c:a7b:4d5:202b:9ccc:2...",
            "Already on 'master'",
            "From https://github.com/JimmyThompson1997/Motorolla",
            " * branch            master     -> FETCH_HEAD",
            "Already up to date.",
            "Warning: Metrics token unavailable: context canceled",
            "Error: The handle is invalid.",
        ]
    )

    assert sync.has_only_ignorable_fly_stderr(stderr) is True
    assert sync.has_only_ignorable_fly_stderr("Error: ssh shell: ssh: command failed") is False


def test_wait_for_manifest_match_times_out_on_commit_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    args = argparse.Namespace(
        manifest_url="https://pucky.fly.dev/ui/pucky/latest/manifest.json",
        manifest_timeout_seconds=1,
        poll_interval_seconds=0.0,
    )
    local_git = {"head": "abcdef0123456789", "head_short": "abcdef0"}

    monkeypatch.setattr(
        sync.official_html,
        "fetch_json",
        lambda _url: {
            "schema": "pucky.ui_bundle.v1",
            "ui_version": "git-other",
            "source_commit_full": "other",
            "source_commit_short": "other",
            "source_branch": "master",
            "source_dirty": False,
        },
    )
    monkeypatch.setattr(sync.time, "sleep", lambda *_args, **_kwargs: None)

    with pytest.raises(sync.OfficialVmSyncError, match="Timed out waiting for VM manifest match"):
        sync.wait_for_manifest_match(args, local_git)


def test_write_evidence_captures_vm_sync_and_manifest_identity(tmp_path: Path) -> None:
    args = argparse.Namespace(evidence_dir=tmp_path)
    evidence = {
        "schema": sync.RESULT_SCHEMA,
        "vm_sync": {"remote_head": "abcdef"},
        "manifest_check": {"manifest": {"ui_version": "git-abcdef0", "source_commit_full": "abcdef"}},
    }

    path = sync.write_evidence(args, evidence)
    written = json.loads(path.read_text(encoding="utf-8"))

    assert written["schema"] == sync.RESULT_SCHEMA
    assert written["vm_sync"]["remote_head"] == "abcdef"
    assert written["manifest_check"]["manifest"]["ui_version"] == "git-abcdef0"


def test_run_rejects_remote_head_mismatch(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    local_git = {
        "repo_root": str(tmp_path),
        "branch": "master",
        "head": "abcdef0123456789",
        "head_short": "abcdef0",
        "upstream": "abcdef0123456789",
        "dirty": False,
    }
    args = argparse.Namespace(
        repo_root=tmp_path,
        canonical_root=tmp_path,
        app="pucky",
        vm_repo_path="/data/pucky-src",
        flyctl=Path("flyctl"),
        manifest_url="https://pucky.fly.dev/ui/pucky/latest/manifest.json",
        evidence_dir=tmp_path,
        sync_timeout_seconds=1,
        restart_timeout_seconds=1,
        manifest_timeout_seconds=1,
        poll_interval_seconds=0.0,
    )

    monkeypatch.setattr(sync.official_html, "require_official_local_repo", lambda *_args, **_kwargs: local_git)
    monkeypatch.setattr(
        sync,
        "sync_vm_source",
        lambda _args: {"remote_command": "cmd", "result": {}, "remote_head": "other"},
    )

    with pytest.raises(sync.OfficialVmSyncError, match="does not match local master HEAD"):
        sync.run(args)
