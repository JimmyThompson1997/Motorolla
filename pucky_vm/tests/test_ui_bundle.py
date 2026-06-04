from __future__ import annotations

import json
import zipfile
from pathlib import Path

import pytest

from pucky_vm.cover_fixtures import runtime_fixture_from_deploy
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
    assert "pucky-links-catalog.js" in manifest["files"]
    assert "fixtures/reply_cards.json" in manifest["files"]
    assert "fixtures/reply_cards_deploy.json" in manifest["files"]
    assert "fixtures/links_catalog.json" in manifest["files"]
    assert "fixtures/links_logo_overrides.json" in manifest["files"]

    with zipfile.ZipFile(result["bundle_path"]) as archive:
        names = set(archive.namelist())
        assert "manifest.json" in names
        assert "index.html" in names
        assert "pucky-links-catalog.js" in names
        assert "fixtures/reply_cards.json" in names
        assert "fixtures/links_logo_overrides.json" in names
        bundled_manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        assert bundled_manifest == manifest
        runtime_fixture = json.loads(archive.read("fixtures/reply_cards.json").decode("utf-8"))
        deploy_fixture = json.loads(archive.read("fixtures/reply_cards_deploy.json").decode("utf-8"))
        assert runtime_fixture == runtime_fixture_from_deploy(deploy_fixture)
        bundled_catalog = json.loads(archive.read("fixtures/links_catalog.json").decode("utf-8"))
        assert bundled_catalog["apps"][0]["logo_path"]
        catalog_script = archive.read("pucky-links-catalog.js").decode("utf-8")
        assert catalog_script == ui_bundle.links_catalog_script(bundled_catalog)
        logo_path = bundled_catalog["apps"][0]["logo_path"]
        assert logo_path in names


def test_ui_bundle_embeds_links_catalog_script_from_fixture(tmp_path, monkeypatch: pytest.MonkeyPatch):
    source_root = tmp_path / "ui_src"
    fixtures = source_root / "fixtures"
    fixtures.mkdir(parents=True)
    (source_root / "index.html").write_text("<!doctype html><script src='./pucky-config.js'></script><script src='./pucky-links-catalog.js'></script><script src='./app.js'></script>", encoding="utf-8")
    (source_root / "app.js").write_text("window.PUCKY_LINKS_CATALOG;", encoding="utf-8")
    (source_root / "styles.css").write_text("body{}", encoding="utf-8")
    (fixtures / "reply_cards_deploy.json").write_text('{"schema":"pucky.reply_cards_deploy.v1","cards":[]}', encoding="utf-8")
    (fixtures / "links_logo_overrides.json").write_text('{"github":{"source_url":"https://example.com/github.svg"}}', encoding="utf-8")
    (fixtures / "links_catalog.json").write_text('{"schema":"pucky.links_catalog_bundle.v1","apps":[{"slug":"github","name":"GitHub","logo_path":"fixtures/links_logos/github.svg","logo_source_url":"https://example.com/github.svg"}],"total":1,"catalog_version":"fixture-version"}', encoding="utf-8")
    logo_dir = fixtures / "links_logos"
    logo_dir.mkdir(parents=True)
    (logo_dir / "github.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'></svg>", encoding="utf-8")
    monkeypatch.setattr(ui_bundle, "UI_SRC", source_root)

    result = build_ui_bundle(tmp_path / "out", ui_version="test-ui", created_at="2026-05-20T00:00:00+00:00")

    with zipfile.ZipFile(Path(result["bundle_path"])) as archive:
        catalog_script = archive.read("pucky-links-catalog.js").decode("utf-8")
        assert "fixtures/links_logo_overrides.json" in archive.namelist()
        assert "fixtures/links_logos/github.svg" in archive.namelist()
    assert catalog_script == (
        'window.PUCKY_LINKS_CATALOG='
        '{"schema":"pucky.links_catalog_bundle.v1","apps":[{"slug":"github","name":"GitHub","logo_path":"fixtures/links_logos/github.svg","logo_source_url":"https://example.com/github.svg"}],"total":1,"catalog_version":"fixture-version"};\n'
    )


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
