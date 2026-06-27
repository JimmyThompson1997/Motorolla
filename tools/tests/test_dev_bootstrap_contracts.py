from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_local_bootstrap_persists_downloaded_binaries_under_local_root() -> None:
    source = read_text(ROOT / "tools" / "bootstrap_local_dev_env.sh")

    assert 'TMP_DIR="$LOCAL_ROOT/tmp/bootstrap-local-dev"' in source
    assert 'LOCAL_TOOLS_DIR="$LOCAL_ROOT/tools"' in source
    assert 'tar -xJf "$NODE_ARCHIVE" -C "$LOCAL_TOOLS_DIR"' in source
    assert 'find "$LOCAL_TOOLS_DIR" -maxdepth 1 -type d -name \'node-v20*\'' in source
    assert 'FFMPEG_EXTRACT="$LOCAL_TOOLS_DIR/ffmpeg"' in source
    assert 'FFPROBE_EXTRACT="$LOCAL_TOOLS_DIR/ffprobe"' in source


def test_bootstrap_scripts_and_brewfile_cover_flyctl() -> None:
    local_source = read_text(ROOT / "tools" / "bootstrap_local_dev_env.sh")
    mac_source = read_text(ROOT / "tools" / "bootstrap_mac_dev.sh")
    brewfile = read_text(ROOT / "Brewfile")

    assert 'FLYCTL_INSTALL="$FLYCTL_ROOT"' in local_source
    assert "https://fly.io/install.sh" in local_source
    assert 'ln -sf "$FLYCTL_ROOT/bin/flyctl" "$BIN_DIR/flyctl"' in local_source
    assert 'formula "flyctl"' in brewfile
    assert 'FLYCTL_BIN="${FLYCTL_BIN:-$(command -v flyctl 2>/dev/null || true)}"' in mac_source
