from __future__ import annotations

import json
import zipfile

from pucky_vm.ui_bundle import build_ui_bundle


def test_ui_bundle_contains_manifest_and_entrypoint(tmp_path):
    result = build_ui_bundle(tmp_path, ui_version="test-ui", created_at="2026-05-20T00:00:00+00:00")

    manifest = result["manifest"]
    assert manifest["schema"] == "pucky.ui_bundle.v1"
    assert manifest["ui_version"] == "test-ui"
    assert manifest["entrypoint"] == "index.html"
    assert manifest["min_native_bridge_version"] == 1
    assert "index.html" in manifest["files"]
    assert "app.js" in manifest["files"]
    assert "styles.css" in manifest["files"]

    with zipfile.ZipFile(result["bundle_path"]) as archive:
        names = set(archive.namelist())
        assert "manifest.json" in names
        assert "index.html" in names
        bundled_manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
        assert bundled_manifest == manifest


def test_default_version_can_read_archive_revision_file(monkeypatch, tmp_path):
    import pucky_vm.ui_bundle as ui_bundle

    revision = tmp_path / ".pucky_ui_version"
    revision.write_text("git-test123\n", encoding="utf-8")
    monkeypatch.setattr(ui_bundle, "UI_SRC", tmp_path / "ui_src")
    (tmp_path / "ui_src").mkdir()
    monkeypatch.delenv("PUCKY_UI_VERSION", raising=False)

    assert ui_bundle.default_version() == "git-test123"
