from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools"
ALLOWED_WRAPPERS = {
    "cover_archive_reveal_playwright.mjs": 'import "./proofs/cover/cover_archive_reveal_playwright.mjs";',
    "cover_canonical_native_light_theme_playwright.mjs": 'import "./proofs/cover/cover_canonical_native_light_theme_playwright.mjs";',
    "cover_default_audio_speed_playwright.mjs": 'import "./proofs/cover/cover_default_audio_speed_playwright.mjs";',
    "cover_links_scroll_probe.mjs": 'import "./proofs/cover/cover_links_scroll_probe.mjs";',
    "cover_live_user_session_playwright.mjs": 'import "./proofs/cover/cover_live_user_session_playwright.mjs";',
    "cover_pause_scrubber_playwright.mjs": 'import "./proofs/cover/cover_pause_scrubber_playwright.mjs";',
    "cover_voice_status_dot_playwright.mjs": 'import "./proofs/cover/cover_voice_status_dot_playwright.mjs";',
    "meeting_mode_agent_real_vm_playwright.mjs": 'import "./proofs/meeting/meeting_mode_agent_real_vm_playwright.mjs";',
    "session_model_defaults_playwright.mjs": 'import "./proofs/cover/session_model_defaults_playwright.mjs";',
}


def test_top_level_proof_names_are_either_gone_or_thin_wrappers() -> None:
    proof_names = {
        path.name
        for path in (TOOLS / "proofs").rglob("*")
        if path.is_file() and path.suffix in {".mjs", ".py", ".js"}
    }
    top_level_files = {
        path.name: path
        for path in TOOLS.iterdir()
        if path.is_file() and path.suffix in {".mjs", ".py", ".js"} and path.name in proof_names
    }

    assert set(top_level_files) == set(ALLOWED_WRAPPERS)
    for name, path in top_level_files.items():
        assert path.read_text(encoding="utf-8").strip() == ALLOWED_WRAPPERS[name]


def test_top_level_tool_tests_have_moved_under_tools_tests() -> None:
    top_level_tests = sorted(path.name for path in TOOLS.glob("test_*.py"))
    assert top_level_tests == []


def test_package_scripts_target_canonical_nested_proof_paths() -> None:
    payload = json.loads((TOOLS / "package.json").read_text(encoding="utf-8"))
    for script, command in payload["scripts"].items():
        assert "./proofs/" in command, script
