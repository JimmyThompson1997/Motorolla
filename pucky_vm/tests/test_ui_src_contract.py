from __future__ import annotations

from pathlib import Path


UI = Path(__file__).resolve().parents[1] / "ui_src"
APP_SOURCE = (UI / "app.js").read_text(encoding="utf-8")
ROUTE_SOURCE = (UI / "pucky-routes.js").read_text(encoding="utf-8")


def test_shipped_workspace_apps_are_marked_real() -> None:
    assert "const LIGHT_APPS = Array.isArray(routeCatalog.LIGHT_APPS)" in APP_SOURCE
    for snippet in (
        '{ route: "inbox", label: "Inbox", semantic: "inbox", kind: "real" }',
        '{ route: "meetings", label: "Meetings", semantic: "meetings", kind: "real" }',
        '{ route: "meeting-notes", label: "Meeting Notes", semantic: "meeting_notes", kind: "real" }',
        '{ route: "reminders", label: "Reminders", semantic: "reminders", kind: "real" }',
        '{ route: "notes", label: "Notes", semantic: "notes", kind: "real" }',
        '{ route: "tasks", label: "Tasks", semantic: "tasks", kind: "real" }',
        '{ route: "calendar", label: "Calendar", semantic: "calendar", kind: "real" }',
        '{ route: "projects", label: "Projects", semantic: "projects", kind: "real" }',
        '{ route: "contacts", label: "Contacts", semantic: "contacts", kind: "real" }',
        '{ route: "connect", label: "Connect", semantic: "connect", kind: "real" }',
        '{ route: "settings", label: "Settings", semantic: "settings", kind: "real" }',
    ):
        assert snippet in ROUTE_SOURCE
    assert 'icon: "mail", accent: "inbox"' not in ROUTE_SOURCE


def test_legacy_message_detail_alias_is_fully_retired() -> None:
    assert '"message-detail"' not in APP_SOURCE
    assert '"message-detail"' not in ROUTE_SOURCE
