from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pytest

import tools.refresh_pucky_html_official as official


def test_require_official_local_repo_rejects_noncanonical(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    other = tmp_path / "other"
    other.mkdir()
    canonical = tmp_path / "canon"
    canonical.mkdir()

    with pytest.raises(official.OfficialRefreshError, match="Official HTML refresh must run from"):
        official.require_official_local_repo(other, canonical)


def test_require_official_local_repo_rejects_nonmaster_dirty_or_unpushed(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    root = tmp_path / "canon"
    root.mkdir()

    monkeypatch.setattr(
        official,
        "local_git_state",
        lambda repo_root: {
            "repo_root": str(repo_root),
            "branch": "feature",
            "head": "abc",
            "head_short": "abc",
            "upstream": "abc",
            "dirty": False,
        },
    )
    with pytest.raises(official.OfficialRefreshError, match="branch master"):
        official.require_official_local_repo(root, root)

    monkeypatch.setattr(
        official,
        "local_git_state",
        lambda repo_root: {
            "repo_root": str(repo_root),
            "branch": "master",
            "head": "abc",
            "head_short": "abc",
            "upstream": "abc",
            "dirty": True,
        },
    )
    with pytest.raises(official.OfficialRefreshError, match="dirty workspaces"):
        official.require_official_local_repo(root, root)

    monkeypatch.setattr(
        official,
        "local_git_state",
        lambda repo_root: {
            "repo_root": str(repo_root),
            "branch": "master",
            "head": "abc",
            "head_short": "abc",
            "upstream": "def",
            "dirty": False,
        },
    )
    with pytest.raises(official.OfficialRefreshError, match="HEAD == origin/master"):
        official.require_official_local_repo(root, root)


def test_validate_remote_manifest_rejects_bad_provenance() -> None:
    local = {"head": "abcdef0123456789", "head_short": "abcdef0"}

    with pytest.raises(official.OfficialRefreshError, match="commit does not match"):
        official.validate_remote_manifest(
            {
                "schema": "pucky.ui_bundle.v1",
                "ui_version": "git-abcdef0",
                "source_commit_full": "other",
                "source_commit_short": "abcdef0",
                "source_branch": "master",
                "source_dirty": False,
            },
            local,
        )

    with pytest.raises(official.OfficialRefreshError, match="branch must be master"):
        official.validate_remote_manifest(
                {
                    "schema": "pucky.ui_bundle.v1",
                    "ui_version": "git-abcdef0",
                    "source_commit_full": local["head"],
                    "source_commit_short": "abcdef0",
                    "source_branch": "develop",
                    "source_dirty": False,
                },
                local,
        )

    with pytest.raises(official.OfficialRefreshError, match="clean master checkout"):
        official.validate_remote_manifest(
                {
                    "schema": "pucky.ui_bundle.v1",
                    "ui_version": "git-abcdef0",
                    "source_commit_full": local["head"],
                    "source_commit_short": "abcdef0",
                    "source_branch": "master",
                    "source_dirty": True,
                },
                local,
        )


def test_validate_remote_manifest_accepts_prefix_compatible_short_commit() -> None:
    local = {"head": "929427768099b4ba8703d09bb0cd128e6297e0ef", "head_short": "92942776"}

    manifest = official.validate_remote_manifest(
        {
            "schema": "pucky.ui_bundle.v1",
            "ui_version": "git-929427768",
            "source_commit_full": local["head"],
            "source_commit_short": "929427768",
            "source_branch": "master",
            "source_dirty": False,
        },
        local,
    )

    assert manifest["source_commit_short"] == "929427768"


def test_validate_emulator_evidence_rejects_mismatch(tmp_path: Path) -> None:
    local = {"head": "abcdef", "head_short": "abcdef0"}
    remote = {
        "schema": "pucky.ui_bundle.v1",
        "ui_version": "git-abcdef0",
        "source_commit_full": "abcdef",
        "source_commit_short": "abcdef0",
        "source_branch": "master",
        "source_dirty": False,
    }
    evidence = {
        "schema": official.RESULT_SCHEMA,
        "target": {"type": "emulator", "id": "emu-1"},
        "local_git": {"head": "other"},
        "remote_manifest": remote,
        "bundle_status": {
            "installed": True,
            "ui_version": "git-abcdef0",
            "source_commit_full": "abcdef",
            "source_commit_short": "abcdef0",
            "source_branch": "master",
            "source_dirty": False,
        },
    }
    path = tmp_path / "emu.json"
    path.write_text(json.dumps(evidence), encoding="utf-8")

    with pytest.raises(official.OfficialRefreshError, match="commit does not match"):
        official.validate_emulator_evidence(official.load_emulator_evidence(path), remote, local)


def test_refresh_target_uses_only_official_bundle_refresh_commands(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[str] = []

    def fake_command(args: argparse.Namespace, command_type: str, payload: dict) -> dict:
        calls.append(command_type)
        if command_type == "ui.bundle.refresh":
            return {"installed": True}
        if command_type == "ui.shell.mode.set":
            return {"mode": "web_cached"}
        if command_type == "ui.bundle.status":
            return {
                "installed": True,
                "ui_version": "git-abcdef0",
                "source_commit_full": "abcdef",
                "source_commit_short": "abcdef0",
                "source_branch": "master",
                "source_dirty": False,
            }
        raise AssertionError(command_type)

    monkeypatch.setattr(official, "run_pucky_command", fake_command)

    args = argparse.Namespace(bundle_url="https://pucky.fly.dev/ui/pucky/latest/bundle.zip", max_bundle_bytes=10 * 1024 * 1024)
    remote = {
        "ui_version": "git-abcdef0",
        "source_commit_short": "abcdef0",
    }
    local = {"head": "abcdef", "head_short": "abcdef0"}

    result = official.refresh_target(args, remote, local)

    assert calls == ["ui.bundle.refresh", "ui.shell.mode.set", "ui.bundle.status"]
    assert result["bundle_status"]["ui_version"] == "git-abcdef0"


def test_official_helper_source_does_not_reference_low_level_local_install_commands() -> None:
    source = Path(official.__file__).read_text(encoding="utf-8")

    assert "ui.bundle.refresh" in source
    assert "ui.bundle.status" in source
    assert "ui.shell.mode.set" in source
    assert "file.put_base64" not in source
    assert "ui.bundle.install_downloaded" not in source


def test_official_tools_share_the_same_canonical_repo_root() -> None:
    deploy_source = Path(official.__file__).with_name("deploy-canonical-apk.ps1").read_text(encoding="utf-8")
    match = re.search(r'\$CanonicalRepoRoot = "([^"]+)"', deploy_source)

    assert match is not None
    assert Path(match.group(1)) == official.CANONICAL_REPO_ROOT
