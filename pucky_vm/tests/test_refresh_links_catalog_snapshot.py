from __future__ import annotations

from pathlib import Path

import pytest

import tools.refresh_links_catalog_snapshot as snapshot


def test_logo_url_candidates_prefers_override_before_original_and_composio() -> None:
    item = {"slug": "github", "logo": "https://origin.example.invalid/github.png"}
    overrides = {"github": {"source_url": "https://override.example.invalid/github.svg"}}

    assert snapshot.logo_url_candidates(item, overrides) == [
        "https://override.example.invalid/github.svg",
        "https://origin.example.invalid/github.png",
        "https://logos.composio.dev/api/github",
    ]


def test_infer_logo_extension_uses_content_type_then_url_suffix() -> None:
    assert snapshot.infer_logo_extension(content_type="image/svg+xml", url="https://example.com/logo") == ".svg"
    assert snapshot.infer_logo_extension(content_type="", url="https://example.com/logo.png") == ".png"


def test_cache_logo_assets_writes_files_from_override_source(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def fake_fetch_binary(url: str) -> tuple[bytes, str, str]:
        return (b"<svg xmlns='http://www.w3.org/2000/svg'></svg>", "image/svg+xml", url)

    monkeypatch.setattr(snapshot, "fetch_binary", fake_fetch_binary)
    items = [{"slug": "github", "name": "GitHub", "logo": "https://origin.example.invalid/github.png"}]
    overrides = {"github": {"source_url": "https://override.example.invalid/github.svg"}}

    resolved_items, summary = snapshot.cache_logo_assets(items, logo_dir=tmp_path / "links_logos", overrides=overrides)

    assert summary["logo_count"] == 1
    assert resolved_items == [
        {
            "slug": "github",
            "name": "GitHub",
            "logo": "https://origin.example.invalid/github.png",
            "logo_path": "fixtures/links_logos/github.svg",
            "logo_source_url": "https://override.example.invalid/github.svg",
        }
    ]
    assert (tmp_path / "links_logos" / "github.svg").read_text(encoding="utf-8") == "<svg xmlns='http://www.w3.org/2000/svg'></svg>"


def test_cache_logo_assets_raises_when_logo_cannot_be_resolved(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def always_fail(url: str) -> tuple[bytes, str, str]:
        raise RuntimeError(f"nope: {url}")

    monkeypatch.setattr(snapshot, "fetch_binary", always_fail)

    with pytest.raises(RuntimeError, match="Could not cache logos for"):
        snapshot.cache_logo_assets(
            [{"slug": "github", "name": "GitHub", "logo": "https://origin.example.invalid/github.png"}],
            logo_dir=tmp_path / "links_logos",
            overrides={},
        )


def test_normalized_catalog_requires_cached_logo_metadata() -> None:
    with pytest.raises(ValueError, match="Missing cached logo metadata"):
        snapshot.normalized_catalog([{"slug": "github", "name": "GitHub", "logo": "https://example.com/github.svg"}])
