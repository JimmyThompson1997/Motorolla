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


def test_cache_busted_url_appends_or_replaces_refresh_key() -> None:
    assert (
        official.cache_busted_url("https://pucky.fly.dev/ui/pucky/latest/manifest.json", "abc123")
        == "https://pucky.fly.dev/ui/pucky/latest/manifest.json?_pucky_refresh=abc123"
    )
    assert (
        official.cache_busted_url(
            "https://pucky.fly.dev/ui/pucky/latest/bundle.zip?foo=bar&_pucky_refresh=old",
            "new",
        )
        == "https://pucky.fly.dev/ui/pucky/latest/bundle.zip?foo=bar&_pucky_refresh=new"
    )


def test_parse_args_defaults_broker_to_official_vm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PUCKY_BROKER_URL", raising=False)
    monkeypatch.delenv("PUCKY_OPERATOR_TOKEN", raising=False)
    monkeypatch.delenv("PUCKY_API_TOKEN", raising=False)

    args = official.parse_args(["--target", "phone", "--device-id", "proof-phone"])

    assert args.broker == official.DEFAULT_VM_BASE_URL


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


def test_validate_browser_evidence_rejects_mismatch(tmp_path: Path) -> None:
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
        "schema": "pucky.task_workspace_live_vm_proof.v1",
        "ok": True,
        "source_commit_full": "other",
        "ui_version": "git-abcdef0",
        "remote_manifest": remote,
        "refresh_key": "abcdef0",
    }
    path = tmp_path / "browser.json"
    path.write_text(json.dumps(evidence), encoding="utf-8")

    with pytest.raises(official.OfficialRefreshError, match="commit does not match"):
        official.validate_browser_evidence(official.load_browser_evidence(path), remote, local)


def test_validate_browser_evidence_accepts_matching_commit_and_ui_version(tmp_path: Path) -> None:
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
        "schema": "pucky.task_workspace_live_vm_proof.v1",
        "ok": True,
        "source_commit_full": "abcdef",
        "source_commit_short": "abcdef0",
        "ui_version": "git-abcdef0",
        "remote_manifest": remote,
        "refresh_key": "abcdef0",
    }
    path = tmp_path / "browser.json"
    path.write_text(json.dumps(evidence), encoding="utf-8")

    validated = official.validate_browser_evidence(official.load_browser_evidence(path), remote, local)

    assert validated["source_commit_full"] == "abcdef"


def test_wait_for_broker_command_channel_retries_transient_ping_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    args = argparse.Namespace(command_timeout_seconds=30)
    attempts = {"count": 0}

    def fake_command(_args: argparse.Namespace, command_type: str, payload: dict) -> dict:
        assert command_type == "ping"
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise official.OfficialRefreshError("Command ping failed: DEVICE_OFFLINE")
        return {"ok": True, "echo": payload}

    monkeypatch.setattr(official, "run_pucky_command", fake_command)
    monkeypatch.setattr(official.time, "sleep", lambda *_args, **_kwargs: None)

    result = official.wait_for_broker_command_channel(args, timeout_seconds=5, sleep_seconds=0.0)

    assert attempts["count"] == 3
    assert result["ok"] is True


def test_run_pucky_command_resilient_waits_for_channel_after_transient_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    args = argparse.Namespace(command_timeout_seconds=30)
    attempts = {"count": 0}
    waits: list[float] = []

    def fake_command(_args: argparse.Namespace, command_type: str, payload: dict) -> dict:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise official.OfficialRefreshError("Command ui.bundle.refresh failed: DEVICE_OFFLINE")
        return {"installed": True, "payload": payload}

    monkeypatch.setattr(official, "run_pucky_command", fake_command)
    monkeypatch.setattr(
        official,
        "wait_for_broker_command_channel",
        lambda _args, *, timeout_seconds=None, sleep_seconds=2.0: waits.append(float(timeout_seconds or 0.0)) or {"ok": True},
    )

    result = official.run_pucky_command_resilient(
        args,
        "ui.bundle.refresh",
        {"url": "https://pucky.fly.dev/ui/pucky/latest/bundle.zip"},
    )

    assert attempts["count"] == 2
    assert waits == [30.0]
    assert result["installed"] is True


def test_refresh_target_uses_only_official_bundle_refresh_commands(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    calls: list[str] = []

    def fake_command(args: argparse.Namespace, command_type: str, payload: dict, *, attempts: int = 3) -> dict:
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

    monkeypatch.setattr(official, "wait_for_broker_command_channel", lambda *_args, **_kwargs: {"ok": True})
    monkeypatch.setattr(official, "run_pucky_command_resilient", fake_command)
    monkeypatch.setattr(official, "verify_live_shell_after_refresh", lambda _args: {"surface": {"route": "feed"}})

    args = argparse.Namespace(
        bundle_url="https://pucky.fly.dev/ui/pucky/latest/bundle.zip",
        max_bundle_bytes=10 * 1024 * 1024,
        command_timeout_seconds=120,
    )
    remote = {
        "ui_version": "git-abcdef0",
        "source_commit_short": "abcdef0",
    }
    local = {"head": "abcdef", "head_short": "abcdef0"}

    result = official.refresh_target(args, remote, local)

    assert calls == ["ui.bundle.refresh", "ui.shell.mode.set", "ui.bundle.status"]
    assert result["broker_channel"]["ok"] is True
    assert result["bundle_status"]["ui_version"] == "git-abcdef0"
    assert result["live_shell"]["surface"]["route"] == "feed"


def test_verify_live_shell_after_refresh_force_stops_relaunches_and_reads_surface(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    adb_calls: list[list[str]] = []
    channel_waits: list[float] = []
    args = argparse.Namespace(
        repo_root=tmp_path,
        adb=Path("adb.exe"),
        device_id="pucky-emulator-slot-06",
        adb_serial="emulator-5564",
        package_name="com.pucky.device.debug",
        activity_name="com.pucky.device.MainActivity",
        command_timeout_seconds=120,
        relaunch_settle_seconds=0.0,
        surface_timeout_seconds=30,
    )

    monkeypatch.setattr(
        official,
        "run_adb",
        lambda _args, serial, adb_args, *, timeout_seconds=30: adb_calls.append([serial, *adb_args]) or "",
    )
    monkeypatch.setattr(
        official,
        "wait_for_broker_command_channel",
        lambda _args, *, timeout_seconds=None, sleep_seconds=2.0: channel_waits.append(float(timeout_seconds or 0.0)) or {"ok": True},
    )
    monkeypatch.setattr(
        official,
        "wait_for_live_surface",
        lambda _args, *, timeout_seconds=None, interval_seconds=2.0: {"route": "links", "ui_version": "git-abcdef0"},
    )
    monkeypatch.setattr(official.phone_shared.time, "sleep", lambda *_args, **_kwargs: None)

    result = official.verify_live_shell_after_refresh(args)

    assert adb_calls == [
        ["emulator-5564", "shell", "am", "force-stop", "com.pucky.device.debug"],
        ["emulator-5564", "shell", "am", "start", "-n", "com.pucky.device.debug/com.pucky.device.MainActivity"],
    ]
    assert channel_waits == [60.0]
    assert result["surface"]["route"] == "links"


def test_run_cache_busts_manifest_and_bundle_urls(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    local_git = {
        "repo_root": str(tmp_path),
        "branch": "master",
        "head": "abcdef0123456789",
        "head_short": "abcdef0",
        "upstream": "abcdef0123456789",
        "dirty": False,
    }
    observed: dict[str, object] = {}

    def fake_fetch_json(url: str) -> dict[str, object]:
        observed["manifest_url"] = url
        return {
            "schema": "pucky.ui_bundle.v1",
            "ui_version": "git-abcdef0",
            "source_commit_full": local_git["head"],
            "source_commit_short": local_git["head_short"],
            "source_branch": "master",
            "source_dirty": False,
        }

    def fake_refresh_target(args: argparse.Namespace, remote_manifest: dict[str, object], local: dict[str, object]) -> dict[str, object]:
        observed["bundle_url"] = args.bundle_url
        return {
            "bundle_install": {},
            "shell_mode": {},
            "bundle_status": {
                "installed": True,
                "ui_version": "git-abcdef0",
                "source_commit_full": local_git["head"],
                "source_commit_short": local_git["head_short"],
                "source_branch": "master",
                "source_dirty": False,
            },
            "live_shell": {"surface": {"route": "feed"}},
        }

    monkeypatch.setattr(official, "require_official_local_repo", lambda root, canonical_root: local_git)
    monkeypatch.setattr(official, "fetch_json", fake_fetch_json)
    monkeypatch.setattr(official, "validate_remote_manifest", lambda manifest, local: manifest)
    monkeypatch.setattr(official, "refresh_target", fake_refresh_target)
    monkeypatch.setattr(
        official,
        "build_evidence",
        lambda args, local_git, remote_manifest, refresh_result, emulator_evidence=None, browser_evidence=None: {
            "manifest_url": args.manifest_url,
            "bundle_url": args.bundle_url,
        },
    )
    monkeypatch.setattr(official, "write_evidence", lambda args, evidence: tmp_path / "evidence.json")

    args = argparse.Namespace(
        target="emulator",
        device_id="pucky-emulator-slot-02",
        broker="http://127.0.0.1:18082",
        token="",
        vm_base_url="https://pucky.fly.dev",
        bundle_url="https://pucky.fly.dev/ui/pucky/latest/bundle.zip",
        manifest_url="https://pucky.fly.dev/ui/pucky/latest/manifest.json",
        emulator_evidence=None,
        max_bundle_bytes=10 * 1024 * 1024,
        command_timeout_seconds=120,
        evidence_dir=tmp_path,
        repo_root=tmp_path,
        canonical_root=tmp_path,
        puckyctl=tmp_path / "puckyctl.py",
    )

    result = official.run(args)

    assert result["ok"] is True
    assert observed["manifest_url"] == "https://pucky.fly.dev/ui/pucky/latest/manifest.json?_pucky_refresh=abcdef0"
    assert observed["bundle_url"] == "https://pucky.fly.dev/ui/pucky/latest/bundle.zip?_pucky_refresh=abcdef0"


def test_run_allows_phone_refresh_with_browser_evidence(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    local_git = {
        "repo_root": str(tmp_path),
        "branch": "master",
        "head": "abcdef0123456789",
        "head_short": "abcdef0",
        "upstream": "abcdef0123456789",
        "dirty": False,
    }
    remote_manifest = {
        "schema": "pucky.ui_bundle.v1",
        "ui_version": "git-abcdef0",
        "source_commit_full": local_git["head"],
        "source_commit_short": local_git["head_short"],
        "source_branch": "master",
        "source_dirty": False,
    }
    browser_evidence_path = tmp_path / "browser-summary.json"
    browser_evidence_path.write_text(json.dumps({
        "schema": "pucky.task_workspace_live_vm_proof.v1",
        "ok": True,
        "source_commit_full": local_git["head"],
        "source_commit_short": local_git["head_short"],
        "ui_version": remote_manifest["ui_version"],
        "remote_manifest": remote_manifest,
        "refresh_key": local_git["head_short"],
    }), encoding="utf-8")

    monkeypatch.setattr(official, "require_official_local_repo", lambda root, canonical_root: local_git)
    monkeypatch.setattr(official, "fetch_json", lambda url: remote_manifest)
    monkeypatch.setattr(official, "validate_remote_manifest", lambda manifest, local: manifest)
    monkeypatch.setattr(official, "refresh_target", lambda args, remote_manifest, local: {
        "broker_channel": {"ok": True},
        "bundle_install": {},
        "shell_mode": {},
        "bundle_status": {
            "installed": True,
            "ui_version": remote_manifest["ui_version"],
            "source_commit_full": local["head"],
            "source_commit_short": remote_manifest["source_commit_short"],
            "source_branch": "master",
            "source_dirty": False,
        },
        "live_shell": {"surface": {"route": "feed"}},
    })
    monkeypatch.setattr(official, "write_evidence", lambda args, evidence: tmp_path / "phone-evidence.json")

    args = argparse.Namespace(
        target="phone",
        device_id="ZY22JZ26LK",
        adb_serial="ZY22JZ26LK",
        broker="https://pucky.fly.dev",
        token="dev-token",
        vm_base_url="https://pucky.fly.dev",
        bundle_url="https://pucky.fly.dev/ui/pucky/latest/bundle.zip",
        manifest_url="https://pucky.fly.dev/ui/pucky/latest/manifest.json",
        emulator_evidence=None,
        browser_evidence=browser_evidence_path,
        max_bundle_bytes=10 * 1024 * 1024,
        command_timeout_seconds=120,
        evidence_dir=tmp_path,
        repo_root=tmp_path,
        canonical_root=tmp_path,
        puckyctl=tmp_path / "puckyctl.py",
        adb=tmp_path / "adb.exe",
        package_name="com.pucky.device.debug",
        activity_name="com.pucky.device.MainActivity",
        surface_timeout_seconds=60,
        relaunch_settle_seconds=2.0,
    )

    result = official.run(args)

    assert result["ok"] is True


def test_phone_refresh_requires_browser_or_emulator_evidence(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    local_git = {
        "repo_root": str(tmp_path),
        "branch": "master",
        "head": "abcdef0123456789",
        "head_short": "abcdef0",
        "upstream": "abcdef0123456789",
        "dirty": False,
    }
    remote_manifest = {
        "schema": "pucky.ui_bundle.v1",
        "ui_version": "git-abcdef0",
        "source_commit_full": local_git["head"],
        "source_commit_short": local_git["head_short"],
        "source_branch": "master",
        "source_dirty": False,
    }
    monkeypatch.setattr(official, "require_official_local_repo", lambda root, canonical_root: local_git)
    monkeypatch.setattr(official, "fetch_json", lambda url: remote_manifest)
    monkeypatch.setattr(official, "validate_remote_manifest", lambda manifest, local: manifest)

    args = argparse.Namespace(
        target="phone",
        device_id="ZY22JZ26LK",
        adb_serial="ZY22JZ26LK",
        broker="https://pucky.fly.dev",
        token="dev-token",
        vm_base_url="https://pucky.fly.dev",
        bundle_url="https://pucky.fly.dev/ui/pucky/latest/bundle.zip",
        manifest_url="https://pucky.fly.dev/ui/pucky/latest/manifest.json",
        emulator_evidence=None,
        browser_evidence=None,
        max_bundle_bytes=10 * 1024 * 1024,
        command_timeout_seconds=120,
        evidence_dir=tmp_path,
        repo_root=tmp_path,
        canonical_root=tmp_path,
        puckyctl=tmp_path / "puckyctl.py",
        adb=tmp_path / "adb.exe",
        package_name="com.pucky.device.debug",
        activity_name="com.pucky.device.MainActivity",
        surface_timeout_seconds=60,
        relaunch_settle_seconds=2.0,
    )

    with pytest.raises(official.OfficialRefreshError, match="requires --emulator-evidence or --browser-evidence"):
        official.run(args)


def test_puckyctl_args_forward_explicit_wait_timeout() -> None:
    args = argparse.Namespace(
        puckyctl=Path("puckyctl.py"),
        broker="http://127.0.0.1:18082",
        token="dev-token",
        device_id="pucky-emulator-slot-02",
        command_timeout_seconds=120,
    )

    command = official.puckyctl_args(args, "ui.bundle.status", {})

    assert command[:5] == [official.sys.executable, "puckyctl.py", "--json", "--timeout-ms", "120000"]
    assert "--broker" in command
    assert "--device-id" in command


def test_parse_args_accepts_hidden_adb_and_surface_settings(tmp_path: Path) -> None:
    args = official.parse_args(
        [
            "--target",
            "emulator",
            "--device-id",
            "pucky-emulator-slot-02",
            "--adb-serial",
            "emulator-5564",
            "--repo-root",
            str(tmp_path),
            "--adb",
            str(tmp_path / "adb.exe"),
            "--surface-timeout-seconds",
            "90",
            "--relaunch-settle-seconds",
            "1.5",
        ]
    )

    assert args.adb == (tmp_path / "adb.exe").resolve()
    assert args.adb_serial == "emulator-5564"
    assert args.surface_timeout_seconds == 90
    assert args.relaunch_settle_seconds == 1.5


def test_official_helper_source_does_not_reference_low_level_local_install_commands() -> None:
    source = Path(official.__file__).read_text(encoding="utf-8")

    assert "ui.bundle.refresh" in source
    assert "ui.bundle.status" in source
    assert "ui.shell.mode.set" in source
    assert "ui.surface.get" in source
    assert "file.put_base64" not in source
    assert "ui.bundle.install_downloaded" not in source


def test_official_tools_share_the_same_canonical_repo_root() -> None:
    deploy_source = Path(official.__file__).with_name("deploy-canonical-apk.ps1").read_text(encoding="utf-8")
    match = re.search(r'\$CanonicalRepoRoot = "([^"]+)"', deploy_source)

    assert match is not None
    assert Path(match.group(1)) == official.CANONICAL_REPO_ROOT


def test_task_live_browser_proof_source_records_manifest_identity_and_refresh_key() -> None:
    source = Path(official.__file__).with_name("task_workspace_live_vm_proof.mjs").read_text(encoding="utf-8")

    assert "remote_manifest" in source
    assert "source_commit_full" in source
    assert "source_commit_short" in source
    assert "ui_version" in source
    assert "refresh_key" in source
    assert "_pucky_refresh" in source
