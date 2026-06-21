from __future__ import annotations

import re
from pathlib import Path


UI = Path(__file__).resolve().parents[1] / "ui_src"
APP_SOURCE = (UI / "app.js").read_text(encoding="utf-8")
ROUTE_SOURCE = (UI / "pucky-routes.js").read_text(encoding="utf-8")
ICON_SOURCE = (UI / "pucky-icons.js").read_text(encoding="utf-8")


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
        '{ route: "tags", label: "Tags", semantic: "tags", kind: "real" }',
        '{ route: "contacts", label: "Contacts", semantic: "contacts", kind: "real" }',
        '{ route: "connect", label: "Connect", semantic: "connect", kind: "real" }',
        '{ route: "settings", label: "Settings", semantic: "settings", kind: "real" }',
    ):
        assert snippet in ROUTE_SOURCE
    assert 'icon: "mail", accent: "inbox"' not in ROUTE_SOURCE


def test_legacy_message_detail_alias_is_fully_retired() -> None:
    assert '"message-detail"' not in APP_SOURCE
    assert '"message-detail"' not in ROUTE_SOURCE


def test_shipped_workspace_semantic_ids_exist_in_registry() -> None:
    for semantic_key in (
        "inbox",
        "connect",
        "meetings",
        "settings",
        "messages",
        "meeting_notes",
        "reminders",
        "notes",
        "tasks",
        "calendar",
        "tags",
        "contacts",
    ):
        assert f"{semantic_key}: {{ icon:" in ICON_SOURCE


def test_shipped_semantic_registry_colors_are_unique_and_conservative() -> None:
    entries = {
        match.group("key"): (match.group("dark"), match.group("light"))
        for match in re.finditer(
            r'(?P<key>[a-z_]+): \{ icon: "[^"]+", colors: \{ dark: "(?P<dark>#[0-9a-f]{6})", light: "(?P<light>#[0-9a-f]{6})" \} \}',
            ICON_SOURCE,
        )
    }
    expected = {
        "inbox": "#2563eb",
        "connect": "#6366f1",
        "meetings": "#0ea5e9",
        "settings": "#64748b",
        "messages": "#10b981",
        "meeting_notes": "#14b8a6",
        "reminders": "#f59e0b",
        "notes": "#eab308",
        "tasks": "#22c55e",
        "calendar": "#ef4444",
        "tags": "#f97316",
        "contacts": "#f43f5e",
    }
    assert expected.keys() <= entries.keys()
    for semantic_key, color in expected.items():
        assert entries[semantic_key] == (color, color)
    shipped_colors = [entries[semantic_key][0] for semantic_key in expected]
    assert len(shipped_colors) == len(set(shipped_colors))
