from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read_source(name: str) -> str:
    return (ROOT / "tools" / name).read_text(encoding="utf-8")


def test_browser_facing_proofs_prefer_web_ui_token() -> None:
    for script_name in (
        "cover_calendar_playwright.mjs",
        "cover_links_scroll_probe.mjs",
        "cover_workspace_apps_playwright.mjs",
        "meeting_mode_agent_real_vm_playwright.mjs",
        "meetings_load_probe.mjs",
        "reminders_v3_browser_proof.mjs",
        "task_workspace_live_vm_proof.mjs",
    ):
        assert "PUCKY_WEB_UI_TOKEN" in read_source(script_name), script_name


def test_canonical_browser_proof_routes_use_inbox_and_connect() -> None:
    assert "route=inbox" in read_source("meetings_load_probe.mjs")
    assert "route=connect" in read_source("cover_links_scroll_probe.mjs")
