from __future__ import annotations

import json
import zipfile

import pytest

from pucky_vm.ui_bundle import build_ui_bundle
import pucky_vm.ui_bundle as ui_bundle


def test_ui_bundle_contains_manifest_and_entrypoint(tmp_path):
    result = build_ui_bundle(tmp_path, ui_version="test-ui", created_at="2026-05-20T00:00:00+00:00")

    manifest = result["manifest"]
    assert manifest["schema"] == "pucky.ui_bundle.v1"
    assert manifest["ui_version"] == "test-ui"
    assert manifest["entrypoint"] == "index.html"
    assert manifest["min_native_bridge_version"] == 1
    assert "source_commit_full" in manifest
    assert "source_commit_short" in manifest
    assert "source_branch" in manifest
    assert "source_dirty" in manifest
    assert "index.html" in manifest["files"]
    assert "app.js" in manifest["files"]
    assert "styles.css" in manifest["files"]

    with zipfile.ZipFile(result["bundle_path"]) as archive:
        names = set(archive.namelist())
        assert "manifest.json" in names
        assert "index.html" in names
        bundled_manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        assert bundled_manifest == manifest


def test_ui_bundle_can_embed_explicit_source_provenance(tmp_path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        ui_bundle,
        "source_provenance",
        lambda repo_root=None: {
            "source_commit_full": "abc123def456",
            "source_commit_short": "abc123d",
            "source_branch": "master",
            "source_dirty": False,
        },
    )

    result = build_ui_bundle(tmp_path, ui_version="test-ui", created_at="2026-05-20T00:00:00+00:00")
    manifest = result["manifest"]

    assert manifest["source_commit_full"] == "abc123def456"
    assert manifest["source_commit_short"] == "abc123d"
    assert manifest["source_branch"] == "master"
    assert manifest["source_dirty"] is False


def test_default_version_can_read_archive_revision_file(monkeypatch, tmp_path):
    revision = tmp_path / ".pucky_ui_version"
    revision.write_text("git-test123\n", encoding="utf-8")
    monkeypatch.setattr(ui_bundle, "UI_SRC", tmp_path / "ui_src")
    (tmp_path / "ui_src").mkdir()
    monkeypatch.delenv("PUCKY_UI_VERSION", raising=False)

    assert ui_bundle.default_version() == "git-test123"


def test_build_ui_bundle_uses_runtime_default_version(monkeypatch: pytest.MonkeyPatch, tmp_path):
    monkeypatch.setattr(ui_bundle, "default_version", lambda: "git-live123")

    result = ui_bundle.build_ui_bundle(tmp_path, created_at="2026-05-20T00:00:00+00:00")

    assert result["manifest"]["ui_version"] == "git-live123"


def test_source_provenance_falls_back_when_git_is_unavailable(monkeypatch: pytest.MonkeyPatch):
    def fail(*args, **kwargs):
        raise RuntimeError("no git")

    monkeypatch.setattr(ui_bundle.subprocess, "run", fail)
    provenance = ui_bundle.source_provenance()

    assert provenance["source_commit_full"] == ""
    assert provenance["source_commit_short"] == ""
    assert provenance["source_branch"] == ""
    assert provenance["source_dirty"] is True


def test_source_provenance_ignores_untracked_runtime_artifacts(monkeypatch: pytest.MonkeyPatch):
    calls: list[list[str]] = []

    def fake_run(args, **kwargs):
        calls.append(list(args))
        stdout = ""
        if args[:3] == ["git", "rev-parse", "HEAD"]:
            stdout = "abcdef1234567890\n"
        elif args[:4] == ["git", "rev-parse", "--short", "HEAD"]:
            stdout = "abcdef1\n"
        elif args[:4] == ["git", "rev-parse", "--abbrev-ref", "HEAD"]:
            stdout = "master\n"
        elif args[:4] == ["git", "status", "--short", "--untracked-files=no"]:
            stdout = ""
        else:
            raise AssertionError(args)
        return type("Completed", (), {"stdout": stdout})()

    monkeypatch.setattr(ui_bundle.subprocess, "run", fake_run)

    provenance = ui_bundle.source_provenance()

    assert provenance["source_commit_full"] == "abcdef1234567890"
    assert provenance["source_commit_short"] == "abcdef1"
    assert provenance["source_branch"] == "master"
    assert provenance["source_dirty"] is False
    assert ["git", "status", "--short", "--untracked-files=no"] in calls
