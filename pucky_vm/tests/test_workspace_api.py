from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from pucky_vm.server import Config, PuckyVoiceService, make_handler

class FakeSTT:
    def transcribe(self, audio: bytes, content_type: str) -> str:
        return ""


class FakeTTS:
    def synthesize(self, text: str) -> tuple[bytes, str]:
        return b"", "audio/wav"


class FakeCodex:
    ready = True

    def start(self) -> None:
        return None

    def runtime_call(self, method: str, params: dict[str, object] | None = None, *, timeout: float | None = None) -> dict[str, object]:
        return {"method": method, "params": params or {}}


class FakeComposio:
    configured = False

    def list_apps(self) -> dict[str, object]:
        return {"apps": []}

    def list_connected_apps(self, user_id: str, *, force: bool = False) -> dict[str, object]:
        return {"connected_apps": []}

    def start_oauth(self, user_id: str, app_slug: str, redirect_url: str | None = None) -> dict[str, object]:
        return {}


def config(tmp_path: Path) -> Config:
    return Config(
        host="127.0.0.1",
        port=0,
        pucky_api_token="test-token",
        deepgram_api_key="",
        deepinfra_api_key="",
        max_audio_bytes=1024,
        max_html_bytes=1024 * 1024,
        max_attachment_count=4,
        max_attachment_bytes=1024 * 1024,
        max_attachment_viewer_bytes=1024 * 1024,
        tts_voice="voice",
        tts_response_format="wav",
        tts_speed=1.0,
        codex_command=[],
        codex_cwd=None,
        codex_startup_timeout=1,
        codex_turn_timeout=7,
        developer_instructions="test",
        feed_db_path=str(tmp_path / "feed.sqlite3"),
        workspace_db_path=str(tmp_path / "workspace.sqlite3"),
        action_ledger_path=str(tmp_path / "actions.sqlite3"),
    )


def start_server(tmp_path: Path) -> tuple[ThreadingHTTPServer, str]:
    service = PuckyVoiceService(
        config(tmp_path),
        stt=FakeSTT(),
        tts=FakeTTS(),
        codex=FakeCodex(),
        meeting_codex=FakeCodex(),
        composio=FakeComposio(),
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(service))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def request_json(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    token: str | None = "",
    headers: dict[str, str] | None = None,
    body: dict[str, object] | None = None,
) -> dict[str, object]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request_headers = {"Accept": "application/json"}
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    if headers:
        request_headers.update(headers)
    req = urllib.request.Request(base_url + path, data=data, headers=request_headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def test_workspace_api_allows_unauthenticated_reads_but_keeps_writes_protected(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        notes = request_json(base_url, "/api/workspace/notes")
        assert notes["count"] >= 1
        anonymous_notes = request_json(base_url, "/api/workspace/notes", token="", method="GET")
        assert anonymous_notes["count"] >= 1
        try:
            request_json(base_url, "/api/workspace/notes", method="POST", token="", body={"id": "x", "title": "X"})
        except urllib.error.HTTPError as exc:
            assert exc.code == 401
        else:
            raise AssertionError("unauthorized write succeeded")
        public_notes = request_json(base_url, "/api/workspace/notes", token="test-operator-token", method="GET")
        assert public_notes["count"] >= 1
    finally:
        server.shutdown()


def test_workspace_api_allows_same_origin_public_task_status_patch_only(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        task = request_json(
            base_url,
            "/api/workspace/tasks",
            method="POST",
            token="test-token",
            body={"id": "public-task", "title": "Public Task", "status": "todo", "due_at_ms": 2_000_000_000_000},
        )
        same_origin_headers = {
            "Origin": base_url,
            "Referer": f"{base_url}/ui/pucky/latest/?theme=light&route=tasks",
        }

        patched = request_json(
            base_url,
            f"/api/workspace/tasks/{task['id']}",
            method="PATCH",
            token="",
            headers=same_origin_headers,
            body={"status": "waiting"},
        )
        assert patched["status"] == "waiting"

        checklist_only = request_json(
            base_url,
            f"/api/workspace/tasks/{task['id']}",
            method="PATCH",
            token="",
            headers=same_origin_headers,
            body={
                "checklist": [
                    {"id": "x", "label": "Checklist row", "done": True},
                    {"id": "y", "label": "Another row", "done": False},
                ],
            },
        )
        assert [item["done"] for item in checklist_only["checklist"]] == [True, False]

        checklist_done = request_json(
            base_url,
            f"/api/workspace/tasks/{task['id']}",
            method="PATCH",
            token="",
            headers=same_origin_headers,
            body={
                "status": "done",
                "checklist": [
                    {"id": "x", "label": "Checklist row", "done": True},
                    {"id": "y", "label": "Another row", "done": True},
                ],
            },
        )
        assert checklist_done["status"] == "done"
        assert [item["done"] for item in checklist_done["checklist"]] == [True, True]

        checklist_reopen = request_json(
            base_url,
            f"/api/workspace/tasks/{task['id']}",
            method="PATCH",
            token="",
            headers=same_origin_headers,
            body={
                "status": "in_progress",
                "checklist": [
                    {"id": "x", "label": "Checklist row", "done": True},
                    {"id": "y", "label": "Another row", "done": False},
                ],
            },
        )
        assert checklist_reopen["status"] == "in_progress"
        assert [item["done"] for item in checklist_reopen["checklist"]] == [True, False]

        for bad_body in (
            {"status": "open"},
            {"status": "done", "owner": "Jordan"},
            {"checklist": "not-a-list"},
            {"status": "done", "checklist": [{"id": "x", "label": "Checklist row", "done": False}]},
            {"status": "in_progress", "checklist": [{"id": "x", "label": "Checklist row", "done": True}]},
        ):
            with pytest.raises(urllib.error.HTTPError) as caught:
                request_json(
                    base_url,
                    f"/api/workspace/tasks/{task['id']}",
                    method="PATCH",
                    token="",
                    headers=same_origin_headers,
                    body=bad_body,
                )
            assert caught.value.code == 400

        with pytest.raises(urllib.error.HTTPError) as caught:
            request_json(
                base_url,
                f"/api/workspace/tasks/{task['id']}",
                method="PATCH",
                token="",
                body={"status": "done"},
            )
        assert caught.value.code == 401

        with pytest.raises(urllib.error.HTTPError) as caught:
            request_json(
                base_url,
                f"/api/workspace/tasks/{task['id']}",
                method="PATCH",
                token="",
                headers={
                    "Origin": "https://evil.example",
                    "Referer": "https://evil.example/ui/pucky/latest/?route=tasks",
                },
                body={"status": "done"},
            )
        assert caught.value.code == 401

        note = request_json(
            base_url,
            "/api/workspace/notes",
            method="POST",
            token="test-token",
            body={"id": "public-note", "title": "Public Note"},
        )
        with pytest.raises(urllib.error.HTTPError) as caught:
            request_json(
                base_url,
                f"/api/workspace/notes/{note['id']}",
                method="PATCH",
                token="",
                headers=same_origin_headers,
                body={"pinned": True},
            )
        assert caught.value.code == 401
    finally:
        server.shutdown()


def test_workspace_api_authenticated_task_patch_persists_checklist_and_status(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        task = request_json(
            base_url,
            "/api/workspace/tasks",
            method="POST",
            token="test-token",
            body={
                "id": "combined-task",
                "title": "Combined Task",
                "status": "todo",
                "checklist": [
                    {"id": "one", "label": "First", "done": False},
                    {"id": "two", "label": "Second", "done": False},
                ],
            },
        )

        patched = request_json(
            base_url,
            f"/api/workspace/tasks/{task['id']}",
            method="PATCH",
            token="test-token",
            body={
                "status": "done",
                "checklist": [
                    {"id": "one", "label": "First", "done": True},
                    {"id": "two", "label": "Second", "done": True},
                ],
            },
        )
        assert patched["status"] == "done"
        assert [item["done"] for item in patched["checklist"]] == [True, True]
    finally:
        server.shutdown()


def test_workspace_api_rejects_removed_web_ui_token_for_note_writes(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        note = request_json(
            base_url,
            "/api/workspace/notes",
            method="POST",
            token="test-token",
            body={"id": "web-token-note", "title": "Web Token Note", "pinned": False},
        )

        with pytest.raises(urllib.error.HTTPError) as exc_info:
            request_json(
                base_url,
                f"/api/workspace/notes/{note['id']}",
                method="PATCH",
                token="web-token",
                body={"pinned": True},
            )
        assert exc_info.value.code == 401
    finally:
        server.shutdown()


def test_workspace_api_crud_assets_links_and_task_deadlines(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        catalog = request_json(base_url, "/api/workspace/")
        assert "messages" not in set(catalog["collections"])
        assert {"meeting-notes", "reminders"}.issubset(set(catalog["collections"]))
        try:
            request_json(base_url, "/api/workspace/messages")
        except urllib.error.HTTPError as exc:
            assert exc.code == 404
        else:
            raise AssertionError("messages endpoint should be removed")

        asset = request_json(
            base_url,
            "/api/workspace/assets",
            method="POST",
            token="test-token",
            body={"id": "api-html", "title": "API HTML", "html": "<!doctype html><h1>API</h1>"},
        )
        assert asset["asset_id"] == "api-html"

        note = request_json(
            base_url,
            "/api/workspace/notes",
            method="POST",
            token="test-token",
            body={"id": "api-note", "title": "API Note", "pinned": True, "html_asset_id": "api-html"},
        )
        assert note["pinned"] is True

        patched = request_json(
            base_url,
            "/api/workspace/notes/api-note",
            method="PATCH",
            token="test-token",
            body={"title": "API Note Updated"},
        )
        assert patched["title"] == "API Note Updated"

        task = request_json(
            base_url,
            "/api/workspace/tasks",
            method="POST",
            token="test-token",
            body={
                "id": "api-task",
                "title": "API Task",
                "status": "open",
                "due_at_ms": 1,
                "created_by": "Maya Chen",
                "owner": "Sam Rivera",
            },
        )
        assert task["derived_group"] == "overdue"
        assert task["created_by"] == "Maya Chen"
        assert task["owner"] == "Sam Rivera"
        done = request_json(
            base_url,
            "/api/workspace/tasks/api-task",
            method="PATCH",
            token="test-token",
            body={"status": "done", "owner": "Jordan Lee"},
        )
        assert done["derived_group"] == "done"
        assert done["created_by"] == "Maya Chen"
        assert done["owner"] == "Jordan Lee"
        task_asset = request_json(
            base_url,
            "/api/workspace/tasks",
            method="POST",
            token="test-token",
            body={"id": "api-task-asset", "title": "API Task Asset", "status": "open", "due_at_ms": 1000, "html_asset_id": "api-html"},
        )
        assert task_asset["html_asset_id"] == ""
        assert task_asset["html"] == ""
        task_empty = request_json(
            base_url,
            "/api/workspace/tasks",
            method="POST",
            token="test-token",
            body={"id": "api-task-empty", "title": "API Task Empty", "status": "open", "due_at_ms": 2000},
        )
        assert task_empty["html"] == ""
        assert task_empty["html_asset_id"] == ""

        project = request_json(
            base_url,
            "/api/workspace/projects",
            method="POST",
            token="test-token",
            body={"id": "api-project", "title": "API Project", "metadata": {"threads": ["Thread A", "Thread B"]}},
        )
        assert project["metadata"]["threads"] == ["Thread A", "Thread B"]

        link = request_json(
            base_url,
            "/api/workspace/links",
            method="POST",
            token="test-token",
            body={
                "id": "api-project-note",
                "source_kind": "project",
                "source_id": "api-project",
                "target_kind": "note",
                "target_id": "api-note",
                "label": "Notes",
            },
        )
        assert link["target_id"] == "api-note"
        linked_project = request_json(base_url, "/api/workspace/projects/api-project")
        assert any(item["target_id"] == "api-note" for item in linked_project["links"])

        contact = request_json(
            base_url,
            "/api/workspace/contacts",
            method="POST",
            token="test-token",
            body={"id": "api-contact", "title": "API Contact", "summary": "Personal contact", "metadata": {"email": "api@example.com"}},
        )
        assert contact["kind"] == "contact"
        calendar_event = request_json(
            base_url,
            "/api/workspace/calendar-events",
            method="POST",
            token="test-token",
            body={"id": "api-event", "title": "API Event", "date": "2026-06-11", "start_at_ms": 1000, "end_at_ms": 2000},
        )
        assert calendar_event["kind"] == "calendar_event"
        meeting_note = request_json(
            base_url,
            "/api/workspace/meeting-notes",
            method="POST",
            token="test-token",
            body={
                "id": "api-meeting-note",
                "title": "API Meeting Note",
                "summary": "Graph meeting",
                "metadata": {"participants": ["API Contact"], "source_kind": "calendar_event", "source_id": "api-event"},
            },
        )
        assert meeting_note["kind"] == "meeting_note"

        reminder = request_json(
            base_url,
            "/api/workspace/reminders",
            method="POST",
            token="test-token",
            body={"id": "api-reminder", "title": "API Reminder", "status": "open", "due_at_ms": 1000, "metadata": {"source_kind": "task", "source_id": "api-task"}},
        )
        assert reminder["kind"] == "reminder"

        for link_id, source_kind, source_id, target_kind, target_id, label in [
            ("api-meeting-contact", "meeting_note", "api-meeting-note", "contact", "api-contact", "API Contact"),
            ("api-meeting-calendar", "meeting_note", "api-meeting-note", "calendar_event", "api-event", "API Event"),
            ("api-meeting-note", "meeting_note", "api-meeting-note", "note", "api-note", "API Note Updated"),
            ("api-meeting-task", "meeting_note", "api-meeting-note", "task", "api-task", "API Task"),
            ("api-meeting-project", "meeting_note", "api-meeting-note", "project", "api-project", "API Project"),
            ("api-meeting-reminder", "meeting_note", "api-meeting-note", "reminder", "api-reminder", "API Reminder"),
            ("api-project-contact", "project", "api-project", "contact", "api-contact", "API Contact"),
            ("api-project-task", "project", "api-project", "task", "api-task", "API Task"),
            ("api-project-note", "project", "api-project", "note", "api-note", "API Note Updated"),
            ("api-reminder-task", "reminder", "api-reminder", "task", "api-task", "API Task"),
            ("api-reminder-meeting", "reminder", "api-reminder", "meeting_note", "api-meeting-note", "API Meeting Note"),
        ]:
            graph_link = request_json(
                base_url,
                "/api/workspace/links",
                method="POST",
                token="test-token",
                body={
                    "id": link_id,
                    "source_kind": source_kind,
                    "source_id": source_id,
                    "target_kind": target_kind,
                    "target_id": target_id,
                    "label": label,
                },
            )
            assert graph_link["source_kind"] == source_kind

        linked_meeting = request_json(base_url, "/api/workspace/meeting-notes/api-meeting-note")
        assert any(item["target_kind"] == "contact" and item["target_id"] == "api-contact" for item in linked_meeting["links"])
        assert any(item["target_kind"] == "calendar_event" and item["target_id"] == "api-event" for item in linked_meeting["links"])
        assert any(item["target_kind"] == "task" and item["target_id"] == "api-task" for item in linked_meeting["links"])
        assert any(item["target_kind"] == "project" and item["target_id"] == "api-project" for item in linked_meeting["links"])
        assert any(item["target_kind"] == "reminder" and item["target_id"] == "api-reminder" for item in linked_meeting["links"])

        linked_reminder = request_json(base_url, "/api/workspace/reminders/api-reminder")
        assert any(item["target_kind"] == "task" and item["target_id"] == "api-task" for item in linked_reminder["links"])
        assert any(item["target_kind"] == "meeting_note" and item["target_id"] == "api-meeting-note" for item in linked_reminder["links"])

        linked_project = request_json(base_url, "/api/workspace/projects/api-project")
        assert any(item["target_kind"] == "contact" and item["target_id"] == "api-contact" for item in linked_project["links"])
        assert any(item["target_kind"] == "task" and item["target_id"] == "api-task" for item in linked_project["links"])
        assert any(item["target_kind"] == "note" and item["target_id"] == "api-note" for item in linked_project["links"])

        linked_contact = request_json(base_url, "/api/workspace/contacts/api-contact")
        assert any(item["source_kind"] == "meeting_note" and item["source_id"] == "api-meeting-note" for item in linked_contact["links"])
        assert any(item["source_kind"] == "project" and item["source_id"] == "api-project" for item in linked_contact["links"])
    finally:
        server.shutdown()


def test_workspace_api_multi_day_calendar_and_archived_contacts(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        request_json(base_url, "/api/workspace/calendar-events", method="POST", token="test-token", body={"id": "day-a", "title": "Day A", "date": "2026-06-10", "start_at_ms": 10})
        request_json(base_url, "/api/workspace/calendar-events", method="POST", token="test-token", body={"id": "day-b", "title": "Day B", "date": "2026-06-11", "start_at_ms": 20})
        day_a = request_json(base_url, "/api/workspace/calendar-events?date=2026-06-10")
        assert "day-a" in {item["id"] for item in day_a["items"]}
        assert "day-b" not in {item["id"] for item in day_a["items"]}

        request_json(
            base_url,
            "/api/workspace/contacts",
            method="POST",
            token="test-token",
            body={"id": "api-contact", "title": "API Contact", "summary": "Partner", "metadata": {"email": "api@example.com"}},
        )
        request_json(base_url, "/api/workspace/contacts/api-contact", method="DELETE", token="test-token")
        visible = request_json(base_url, "/api/workspace/contacts")
        hidden_ids = {item["id"] for item in visible["items"]}
        assert "api-contact" not in hidden_ids
        all_contacts = request_json(base_url, "/api/workspace/contacts?include_archived=1&include_deleted=1")
        assert "api-contact" in {item["id"] for item in all_contacts["items"]}
    finally:
        server.shutdown()


def test_workspace_api_reminder_delivery_metadata_and_snooze_done_paths(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        created = request_json(
            base_url,
            "/api/workspace/reminders",
            method="POST",
            token="test-token",
            body={
                "id": "api-reminder-proof",
                "title": "Reminder proof",
                "summary": "Reminder summary",
                "status": "open",
                "due_at_ms": 60_000,
                "metadata": {"source_kind": "task", "source_id": "api-task"},
            },
        )
        assert created["metadata"]["delivery_state"] == "pending"
        assert created["metadata"]["last_notification_command_id"] == ""
        assert created["metadata"]["last_delivery_mode_requested"] == ""
        assert created["metadata"]["last_delivery_mode_effective"] == ""
        assert created["metadata"]["last_delivery_degraded_to"] == ""
        assert created["metadata"]["last_delivery_warnings"] == []
        assert created["metadata"]["notification_payload"] == {}
        assert created["metadata"]["recipients"] == [{"id": "self", "kind": "self", "contact_id": "", "label": "Me"}]
        assert created["metadata"]["destinations"][0]["channel"] == "phone_notification"
        assert created["metadata"]["last_delivery_results"] == []
        assert created["metadata"]["recurrence"] == {}

        snoozed = request_json(
            base_url,
            "/api/workspace/reminders/api-reminder-proof",
            method="PATCH",
            token="test-token",
            body={
                "due_at_ms": 120_000,
                "metadata": {
                    "delivery_state": "pending",
                    "last_fired_at_ms": 0,
                    "last_fired_due_at_ms": 0,
                    "last_delivery_error": "",
                    "snoozed_until_ms": 120_000,
                },
            },
        )
        assert snoozed["due_at_ms"] == 120_000
        assert snoozed["metadata"]["delivery_state"] == "pending"
        assert snoozed["metadata"]["snoozed_until_ms"] == 120_000

        failed = request_json(
            base_url,
            "/api/workspace/reminders/api-reminder-proof",
            method="PATCH",
            token="test-token",
            body={
                "metadata": {
                    "delivery_state": "failed",
                    "last_delivery_error": "no_online_device",
                    "notification_device_id": "phone-1",
                    "last_notification_command_id": "cmd_api",
                    "last_delivery_mode_requested": "heads_up",
                    "last_delivery_mode_effective": "heads_up",
                }
            },
        )
        assert failed["metadata"]["delivery_state"] == "failed"
        assert failed["metadata"]["last_delivery_error"] == "no_online_device"
        assert failed["metadata"]["notification_device_id"] == "phone-1"
        assert failed["metadata"]["last_notification_command_id"] == "cmd_api"
        assert failed["metadata"]["last_delivery_mode_requested"] == "heads_up"
        assert failed["metadata"]["last_delivery_mode_effective"] == "heads_up"

        done = request_json(
            base_url,
            "/api/workspace/reminders/api-reminder-proof",
            method="PATCH",
            token="test-token",
            body={"status": "done"},
        )
        assert done["status"] == "done"
        assert done["metadata"]["delivery_state"] == "failed"
        assert done["metadata"]["snoozed_until_ms"] == 0
    finally:
        server.shutdown()


def test_workspace_api_rejects_unconfigured_reminder_destinations(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        with pytest.raises(urllib.error.HTTPError) as email_error:
            request_json(
                base_url,
                "/api/workspace/reminders",
                method="POST",
                token="test-token",
                body={
                    "id": "api-reminder-email",
                    "title": "Email reminder",
                    "status": "open",
                    "due_at_ms": 60_000,
                    "metadata": {
                        "recipients": [{"id": "self", "kind": "self", "label": "Me"}],
                        "destinations": [{"channel": "email", "recipient_ids": ["self"]}],
                    },
                },
            )
        assert email_error.value.code == 400
        assert "reminder_destination_not_configured:gmail" in email_error.value.read().decode("utf-8")

        with pytest.raises(urllib.error.HTTPError) as connected_error:
            request_json(
                base_url,
                "/api/workspace/reminders",
                method="POST",
                token="test-token",
                body={
                    "id": "api-reminder-connected",
                    "title": "Connected reminder",
                    "status": "open",
                    "due_at_ms": 60_000,
                    "metadata": {
                        "destinations": [{"channel": "connected_app", "app_slug": "slack", "endpoint": "/chat.postMessage"}],
                    },
                },
            )
        assert connected_error.value.code == 400
        assert "reminder_destination_not_configured:slack" in connected_error.value.read().decode("utf-8")
    finally:
        server.shutdown()


def test_workspace_api_preserves_me_contact_and_allows_updates(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        me = request_json(base_url, "/api/workspace/contacts/contact-me")
        assert me["id"] == "contact-me"
        assert me["title"] == "Me"
        assert me["metadata"]["is_self"] is True

        photo_asset = request_json(
            base_url,
            "/api/workspace/assets",
            method="POST",
            token="test-token",
            body={
                "id": "contact-me-photo",
                "title": "Contact Me Photo",
                "mime_type": "image/png",
                "base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO0r3n8AAAAASUVORK5CYII=",
                "metadata": {"kind": "contact_photo"},
            },
        )
        assert photo_asset["asset_id"] == "contact-me-photo"
        assert photo_asset["mime_type"] == "image/png"

        updated = request_json(
            base_url,
            "/api/workspace/contacts/contact-me",
            method="PATCH",
            token="test-token",
            body={
                "title": "Jimmy Thompson",
                "summary": "My primary contact card",
                "metadata": {
                    "first_name": "Jimmy",
                    "last_name": "Thompson",
                    "avatar": "JT",
                    "email": "me@example.com",
                    "phone": "+14155550123",
                    "notification_device_id": "phone-1",
                    "photo_asset_id": "contact-me-photo",
                    "photo": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO0r3n8AAAAASUVORK5CYII=",
                }
            },
        )
        assert updated["title"] == "Jimmy Thompson"
        assert updated["summary"] == "My primary contact card"
        assert updated["metadata"]["first_name"] == "Jimmy"
        assert updated["metadata"]["last_name"] == "Thompson"
        assert updated["metadata"]["email"] == "me@example.com"
        assert updated["metadata"]["phone"] == "+14155550123"
        assert updated["metadata"]["notification_device_id"] == "phone-1"
        assert updated["metadata"]["photo_asset_id"] == "contact-me-photo"
        assert updated["metadata"]["photo"].startswith("data:image/png;base64,")
        assert updated["metadata"]["is_self"] is True
        assert updated["pinned"] is True
        assert updated["archived"] is False
        assert updated["deleted"] is False

        preserved = request_json(
            base_url,
            "/api/workspace/contacts/contact-me",
            method="DELETE",
            token="test-token",
        )
        assert preserved["id"] == "contact-me"
        assert preserved["title"] == "Jimmy Thompson"
        assert preserved["archived"] is False
        assert preserved["deleted"] is False
    finally:
        server.shutdown()
