from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read_source(name: str) -> str:
    matches = sorted((ROOT / "tools").rglob(name))
    assert matches, f"Missing proof source {name}"
    nested = [path for path in matches if "proofs" in path.parts or "support" in path.parts]
    target = nested[0] if nested else matches[0]
    return target.read_text(encoding="utf-8")


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


def test_workspace_apps_browser_proof_covers_preview_api_token_lock() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert "Preview needs api_token" in source
    assert 'url.searchParams.set("api_token", String(apiToken || "").trim());' in source
    assert "Web preview is locked. Use Unlock web preview to load live ${expectedLabel} from the VM in this browser." in source
    assert "!/unauthorized/i.test(text)" in source
    assert "Unlock web preview" in source
    assert 'await unlockBrowserPreview(page, config.apiToken, config.timeoutMs);' in source
    assert 'await page.getByRole("button", { name: "Save token" }).click();' in source


def test_workspace_tasks_press_proof_uses_real_row_control() -> None:
    source = read_source("cover_workspace_apps_playwright.mjs")

    assert 'rowAButton.locator(".light-task-row-main")' in source
    assert 'rowAPressTarget.dispatchEvent("pointerdown"' in source
    assert "button instanceof HTMLButtonElement" not in source


def test_workspace_proof_server_keeps_broker_state_out_of_vm_only_data_dir() -> None:
    source = read_source("workspace_apps_proof_server.py")

    assert 'os.environ.setdefault("PUCKY_DB_PATH", str((root / "broker.sqlite3").resolve()))' in source
