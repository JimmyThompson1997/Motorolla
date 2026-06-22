from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "pucky_vm" / "fly_start.sh"


def test_fly_start_prefers_existing_codex_and_node_runtimes() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert 'if command -v codex >/dev/null 2>&1; then' in source
    assert 'echo "Pucky Fly start: using existing Codex runtime"' in source
    assert 'if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then' in source
    assert 'echo "Pucky Fly start: using existing Node runtime"' in source


def test_fly_start_installs_xz_before_archive_unpack() -> None:
    source = SCRIPT_PATH.read_text(encoding="utf-8")

    assert "ensure_xz_runtime()" in source
    assert "apt-get install -y --no-install-recommends xz-utils" in source
    assert "ensure_xz_runtime" in source.split("require_cmd tar", 1)[1]
