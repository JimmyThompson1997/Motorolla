from __future__ import annotations

from pathlib import Path


def test_cover_shared_resolves_chrome_from_env_and_cross_platform_locations() -> None:
    root = Path(__file__).resolve().parents[2]
    source = (root / "tools" / "support" / "cover_shared.mjs").read_text(encoding="utf-8")

    assert "process.env.CHROME_PATH" in source
    assert "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH" in source
    assert "ms-playwright" in source
    assert "Google Chrome.app" in source
    assert "Chromium.app" in source
    assert 'animations: "disabled"' in source
    assert 'if (error?.name !== "TimeoutError") {' in source
    assert "fullPage: false" in source
