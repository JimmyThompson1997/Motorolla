from __future__ import annotations

from pathlib import Path


UI = Path(__file__).resolve().parents[1] / "ui_src"
APP_SOURCE = (UI / "app.js").read_text(encoding="utf-8")
ROUTE_SOURCE = (UI / "pucky-routes.js").read_text(encoding="utf-8")


def test_shipped_workspace_apps_are_marked_real() -> None:
    assert "const LIGHT_APPS = Array.isArray(routeCatalog.LIGHT_APPS)" in APP_SOURCE
    for snippet in (
        '{ route: "meeting-notes", label: "Meeting Notes", icon: "record_voice_over", accent: "meeting_notes", kind: "real" }',
        '{ route: "notes", label: "Notes", icon: "note", accent: "notes", kind: "real" }',
        '{ route: "tasks", label: "Tasks", icon: "checklist", accent: "tasks", kind: "real" }',
        '{ route: "calendar", label: "Calendar", icon: "calendar", accent: "calendar", kind: "real" }',
        '{ route: "projects", label: "Projects", icon: "folder", accent: "projects", kind: "real" }',
        '{ route: "contacts", label: "Contacts", icon: "contacts", accent: "contacts", kind: "real" }',
    ):
        assert snippet in ROUTE_SOURCE


def test_legacy_message_detail_alias_is_fully_retired() -> None:
    assert '"message-detail"' not in APP_SOURCE
    assert '"message-detail"' not in ROUTE_SOURCE
