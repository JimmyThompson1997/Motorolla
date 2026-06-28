from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from dataclasses import replace

import pytest

from pucky_vm.server import Config, PuckyVoiceService, make_handler


BROWSER_TEST_TOKEN = "browser-test-token"

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

    def send_turn(
        self,
        text: str,
        *,
        thread_id: str | None = None,
        model: str | None = None,
        reasoning_effort: str | None = None,
        output_schema: dict[str, object] | None = None,
        developer_instructions: str | None = None,
        **_kwargs,
    ):
        return type(
            "FakeTurnResult",
            (),
            {
                "reply_text": json.dumps(
                    {
                        "reply_text": f"Echo: {text}",
                        "card_title": "Workspace Echo",
                        "card_icon": "mail",
                        "html": None,
                    }
                ),
                "used_thread_id": str(thread_id or "thread-1"),
                "requested_thread_id": str(thread_id or ""),
                "thread_mode": "existing" if thread_id else "new",
                "reused_existing_thread": bool(thread_id),
                "fallback_reason": "",
            },
        )()

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
        pucky_web_ui_token=BROWSER_TEST_TOKEN,
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
        connect_portal_secret="test-connect-secret",
    )


def start_server(
    tmp_path: Path,
    *,
    strict_browser_user_auth: bool = False,
    strict_composio_user_scoping: bool = False,
) -> tuple[ThreadingHTTPServer, str]:
    server, base_url, _service = start_server_with_service(
        tmp_path,
        strict_browser_user_auth=strict_browser_user_auth,
        strict_composio_user_scoping=strict_composio_user_scoping,
    )
    return server, base_url


def start_server_with_service(
    tmp_path: Path,
    *,
    strict_browser_user_auth: bool = False,
    strict_composio_user_scoping: bool = False,
) -> tuple[ThreadingHTTPServer, str, PuckyVoiceService]:
    base_config = config(tmp_path)
    service = PuckyVoiceService(
        replace(
            base_config,
            strict_browser_user_auth=strict_browser_user_auth,
            strict_composio_user_scoping=strict_composio_user_scoping,
        ),
        stt=FakeSTT(),
        tts=FakeTTS(),
        codex=FakeCodex(),
        meeting_codex=FakeCodex(),
        composio=FakeComposio(),
    )
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(service))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_address[1]}", service


def request_json(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    token: str | None = BROWSER_TEST_TOKEN,
    cookie: str | None = None,
    headers: dict[str, str] | None = None,
    body: dict[str, object] | None = None,
) -> dict[str, object]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request_headers = {"Accept": "application/json"}
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    if cookie:
        request_headers["Cookie"] = cookie
    if headers:
        request_headers.update(headers)
    req = urllib.request.Request(base_url + path, data=data, headers=request_headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def request_json_response(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    token: str | None = BROWSER_TEST_TOKEN,
    cookie: str | None = None,
    headers: dict[str, str] | None = None,
    body: dict[str, object] | None = None,
) -> tuple[dict[str, object], object]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request_headers = {"Accept": "application/json"}
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    if cookie:
        request_headers["Cookie"] = cookie
    if headers:
        request_headers.update(headers)
    req = urllib.request.Request(base_url + path, data=data, headers=request_headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read().decode("utf-8")), response.headers


def request_bytes(
    base_url: str,
    path: str,
    *,
    token: str | None = BROWSER_TEST_TOKEN,
    cookie: str | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, bytes]:
    request_headers = {"Accept": "*/*"}
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    if cookie:
        request_headers["Cookie"] = cookie
    if headers:
        request_headers.update(headers)
    req = urllib.request.Request(base_url + path, headers=request_headers, method="GET")
    with urllib.request.urlopen(req, timeout=10) as response:
        return int(response.status), response.read()


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


def test_workspace_api_session_auth_isolates_users_and_artifacts(tmp_path: Path) -> None:
    server, base_url, service = start_server_with_service(
        tmp_path,
        strict_browser_user_auth=True,
        strict_composio_user_scoping=True,
    )
    try:
        service.composio.configured = True
        try:
            request_json(base_url, "/api/workspace/notes", token="", method="GET")
        except urllib.error.HTTPError as exc:
            assert exc.code == 401
        else:
            raise AssertionError("strict workspace read unexpectedly succeeded without auth")

        try:
            request_json(base_url, "/api/links/composio/portal-url?auth_mode=browser", token=BROWSER_TEST_TOKEN, method="GET")
        except urllib.error.HTTPError as exc:
            assert exc.code == 401
        else:
            raise AssertionError("strict composio scope unexpectedly allowed a default browser principal")

        user_a_code = str(service.request_auth_code("user-a@example.com")["test_code"])
        verify_a, headers_a = request_json_response(
            base_url,
            "/api/auth/verify-code",
            method="POST",
            token="",
            body={"email": "user-a@example.com", "code": user_a_code},
        )
        cookie_a = str(headers_a.get("Set-Cookie") or "").split(";", 1)[0]
        session_token_a = cookie_a.split("=", 1)[1]

        user_b_code = str(service.request_auth_code("user-b@example.com")["test_code"])
        verify_b, headers_b = request_json_response(
            base_url,
            "/api/auth/verify-code",
            method="POST",
            token="",
            body={"email": "user-b@example.com", "code": user_b_code},
        )
        cookie_b = str(headers_b.get("Set-Cookie") or "").split(";", 1)[0]

        assert verify_a["workspace_id"] != verify_b["workspace_id"]

        session_a = request_json(base_url, "/api/auth/session", token="", cookie=cookie_a)
        session_b = request_json(base_url, "/api/auth/session", token="", cookie=cookie_b)
        assert session_a["signed_in"] is True
        assert session_b["signed_in"] is True
        assert session_a["workspace_id"] != session_b["workspace_id"]

        created_note = request_json(
            base_url,
            "/api/workspace/notes",
            method="POST",
            token="",
            cookie=cookie_a,
            body={"id": "user-a-note", "title": "User A Note", "html": "<!doctype html><h1>User A</h1>"},
        )
        assert created_note["id"] == "user-a-note"

        turn = request_json(
            base_url,
            "/api/turn/text",
            method="POST",
            token="",
            cookie=cookie_a,
            body={"text": "Create a quick card", "turn_id": "user-a-turn"},
        )
        assert turn["card_id"].startswith("pucky_card_")

        owner_note = request_json(base_url, "/api/workspace/notes/user-a-note", token="", cookie=cookie_a)
        assert owner_note["title"] == "User A Note"

        user_b_notes = request_json(base_url, "/api/workspace/notes", token="", cookie=cookie_b)
        assert all(str(item.get("id") or "") != "user-a-note" for item in list(user_b_notes.get("items") or []))
        try:
            request_json(base_url, "/api/workspace/notes/user-a-note", token="", cookie=cookie_b)
        except urllib.error.HTTPError as exc:
            assert exc.code in {401, 403, 404}
        else:
            raise AssertionError("User B fetched User A note")

        portal_a = request_json(base_url, "/api/links/composio/portal-url?auth_mode=browser", token="", cookie=cookie_a)
        portal_b = request_json(base_url, "/api/links/composio/portal-url?auth_mode=browser", token="", cookie=cookie_b)
        assert str(portal_a["user_id"]).startswith("ws_")
        assert str(portal_b["user_id"]).startswith("ws_")
        assert portal_a["user_id"] != portal_b["user_id"]
    finally:
        server.shutdown()


def test_workspace_api_app_badges_tracks_seen_state_and_reminder_activity(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        baseline = request_json(base_url, "/api/app-badges", token="test-token")
        baseline_badges = baseline["badges"]

        meeting_note = request_json(
            base_url,
            "/api/workspace/meeting-notes",
            method="POST",
            token="test-token",
            body={
                "id": "proof-meeting-note-badge",
                "title": "Proof Meeting Note Badge",
                "summary": "Unread until opened from detail.",
                "date": "2026-06-26",
                "start_at_ms": 1782462000000,
                "end_at_ms": 1782465600000,
            },
        )
        task = request_json(
            base_url,
            "/api/workspace/tasks",
            method="POST",
            token="test-token",
            body={
                "id": "proof-task-badge",
                "title": "Proof Task Badge",
                "summary": "Unread task badge proof.",
                "status": "todo",
                "due_at_ms": 1782469200000,
            },
        )
        request_json(
            base_url,
            "/api/workspace/reminders",
            method="POST",
            token="test-token",
            body={
                "id": "proof-reminder-badge",
                "title": "Proof Reminder Badge",
                "summary": "Live reminder badge proof.",
                "status": "open",
                "due_at_ms": 1782469800000,
            },
        )

        after_create = request_json(base_url, "/api/app-badges", token="test-token")
        created_badges = after_create["badges"]
        assert created_badges["meeting-notes"]["count"] == baseline_badges["meeting-notes"]["count"] + 1
        assert created_badges["tasks"]["count"] == baseline_badges["tasks"]["count"] + 1
        assert created_badges["reminders"]["count"] == baseline_badges["reminders"]["count"] + 1
        assert created_badges["inbox"]["kind"] == "unread"
        assert created_badges["reminders"]["kind"] == "active"

        task_seen = request_json(
            base_url,
            "/api/workspace/tasks/proof-task-badge",
            method="PATCH",
            token="test-token",
            body={"metadata": {"seen_at_ms": task["content_updated_at_ms"]}},
        )
        note_seen = request_json(
            base_url,
            "/api/workspace/meeting-notes/proof-meeting-note-badge",
            method="PATCH",
            token="test-token",
            body={"metadata": {"seen_at_ms": meeting_note["content_updated_at_ms"]}},
        )
        assert task_seen["metadata"]["seen_at_ms"] == task["content_updated_at_ms"]
        assert task_seen["content_updated_at_ms"] == task["content_updated_at_ms"]
        assert note_seen["metadata"]["seen_at_ms"] == meeting_note["content_updated_at_ms"]
        assert note_seen["content_updated_at_ms"] == meeting_note["content_updated_at_ms"]

        after_seen = request_json(base_url, "/api/app-badges", token="test-token")
        seen_badges = after_seen["badges"]
        assert seen_badges["meeting-notes"]["count"] == baseline_badges["meeting-notes"]["count"]
        assert seen_badges["tasks"]["count"] == baseline_badges["tasks"]["count"]
        assert seen_badges["reminders"]["count"] == baseline_badges["reminders"]["count"] + 1

        task_updated = request_json(
            base_url,
            "/api/workspace/tasks/proof-task-badge",
            method="PATCH",
            token="test-token",
            body={"summary": "Task changed after being seen."},
        )
        note_updated = request_json(
            base_url,
            "/api/workspace/meeting-notes/proof-meeting-note-badge",
            method="PATCH",
            token="test-token",
            body={"summary": "Meeting note changed after being seen."},
        )
        assert task_updated["content_updated_at_ms"] > task_seen["metadata"]["seen_at_ms"]
        assert note_updated["content_updated_at_ms"] > note_seen["metadata"]["seen_at_ms"]

        after_update = request_json(base_url, "/api/app-badges", token="test-token")
        updated_badges = after_update["badges"]
        assert updated_badges["meeting-notes"]["count"] == baseline_badges["meeting-notes"]["count"] + 1
        assert updated_badges["tasks"]["count"] == baseline_badges["tasks"]["count"] + 1
        assert updated_badges["reminders"]["count"] == baseline_badges["reminders"]["count"] + 1
        assert after_update["schema"] == "pucky.app_badges.v1"
        assert int(after_update["generated_at_ms"]) > 0
    finally:
        server.shutdown()


def test_workspace_api_allows_same_origin_public_task_status_and_archive_patch_only(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        task = request_json(
            base_url,
            "/api/workspace/tasks",
            method="POST",
            token="test-token",
            body={"id": "public-task", "title": "Public Task", "status": "todo", "due_at_ms": 2_000_000_000_000},
        )
        assert "completed_at_ms" not in task
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
        assert int(checklist_done["completed_at_ms"]) > 0

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
        assert "completed_at_ms" not in checklist_reopen

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

        archived = request_json(
            base_url,
            f"/api/workspace/tasks/{task['id']}",
            method="PATCH",
            token="",
            headers=same_origin_headers,
            body={"archived": True},
        )
        active_tasks = request_json(base_url, "/api/workspace/tasks", method="GET", token="test-token")
        all_tasks = request_json(base_url, "/api/workspace/tasks?include_archived=1", method="GET", token="test-token")
        assert archived["archived"] is True
        assert task["id"] not in {item["id"] for item in active_tasks["items"]}
        assert task["id"] in {item["id"] for item in all_tasks["items"]}

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


def test_workspace_api_task_archive_patch_hides_task_from_default_reads(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        task = request_json(
            base_url,
            "/api/workspace/tasks",
            method="POST",
            token="test-token",
            body={"id": "archive-task", "title": "Archive Task", "status": "todo"},
        )
        archived = request_json(
            base_url,
            f"/api/workspace/tasks/{task['id']}",
            method="PATCH",
            token="test-token",
            body={"archived": True},
        )
        visible = request_json(base_url, "/api/workspace/tasks", method="GET", token="test-token")
        all_tasks = request_json(base_url, "/api/workspace/tasks?include_archived=1", method="GET", token="test-token")

        assert archived["archived"] is True
        assert task["id"] not in {item["id"] for item in visible["items"]}
        assert task["id"] in {item["id"] for item in all_tasks["items"]}
    finally:
        server.shutdown()


def test_workspace_api_allows_same_origin_public_reminder_actions_only(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        reminder = request_json(
            base_url,
            "/api/workspace/reminders",
            method="POST",
            token="test-token",
            body={
                "id": "public-reminder",
                "title": "Public Reminder",
                "status": "open",
                "due_at_ms": 2_000_000_000_000,
                "metadata": {"delivery_state": "pending"},
            },
        )
        same_origin_headers = {
            "Origin": base_url,
            "Referer": f"{base_url}/ui/pucky/latest/?theme=light&route=reminder-detail",
        }

        dismissed = request_json(
            base_url,
            f"/api/workspace/reminders/{reminder['id']}",
            method="PATCH",
            token="",
            headers=same_origin_headers,
            body={"status": "done"},
        )
        assert dismissed["status"] == "done"

        reminder = request_json(
            base_url,
            "/api/workspace/reminders",
            method="POST",
            token="test-token",
            body={
                "id": "public-reminder-snooze",
                "title": "Public Reminder Snooze",
                "status": "open",
                "due_at_ms": 2_000_000_000_000,
                "metadata": {"delivery_state": "pending"},
            },
        )
        snoozed_until_ms = 2_100_000_000_000
        snoozed = request_json(
            base_url,
            f"/api/workspace/reminders/{reminder['id']}",
            method="PATCH",
            token="",
            headers=same_origin_headers,
            body={
                "due_at_ms": snoozed_until_ms,
                "metadata": {
                    "snoozed_until_ms": snoozed_until_ms,
                    "delivery_state": "pending",
                    "last_fired_at_ms": 0,
                    "last_fired_due_at_ms": 0,
                    "last_delivery_error": "",
                },
            },
        )
        assert snoozed["due_at_ms"] == snoozed_until_ms
        assert snoozed["metadata"]["snoozed_until_ms"] == snoozed_until_ms

        for bad_body in (
            {"status": "open"},
            {"status": "done", "title": "Sneaky"},
            {"due_at_ms": snoozed_until_ms},
            {
                "due_at_ms": snoozed_until_ms,
                "metadata": {
                    "snoozed_until_ms": snoozed_until_ms - 1,
                    "delivery_state": "pending",
                    "last_fired_at_ms": 0,
                    "last_fired_due_at_ms": 0,
                    "last_delivery_error": "",
                },
            },
            {
                "due_at_ms": snoozed_until_ms,
                "metadata": {
                    "snoozed_until_ms": snoozed_until_ms,
                    "delivery_state": "sent",
                    "last_fired_at_ms": 0,
                    "last_fired_due_at_ms": 0,
                    "last_delivery_error": "",
                },
            },
        ):
            with pytest.raises(urllib.error.HTTPError) as caught:
                request_json(
                    base_url,
                    f"/api/workspace/reminders/{reminder['id']}",
                    method="PATCH",
                    token="",
                    headers=same_origin_headers,
                    body=bad_body,
                )
            assert caught.value.code == 400

        with pytest.raises(urllib.error.HTTPError) as caught:
            request_json(
                base_url,
                f"/api/workspace/reminders/{reminder['id']}",
                method="PATCH",
                token="",
                body={"status": "done"},
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
        assert int(patched["completed_at_ms"]) > 0
    finally:
        server.shutdown()


def test_workspace_api_task_completed_timestamp_is_durable(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        active = request_json(
            base_url,
            "/api/workspace/tasks",
            method="POST",
            token="test-token",
            body={"id": "durable-task", "title": "Durable Task", "status": "todo"},
        )
        assert "completed_at_ms" not in active

        created_done = request_json(
            base_url,
            "/api/workspace/tasks",
            method="POST",
            token="test-token",
            body={
                "id": "durable-created-done",
                "title": "Durable Created Done",
                "status": "done",
                "created_at_ms": 1_700_000_000_123,
            },
        )
        assert created_done["completed_at_ms"] == 1_700_000_000_123

        first_done = request_json(
            base_url,
            f"/api/workspace/tasks/{active['id']}",
            method="PATCH",
            token="test-token",
            body={"status": "done"},
        )
        first_completed_at = int(first_done["completed_at_ms"])
        assert first_completed_at > 0

        preserved = request_json(
            base_url,
            f"/api/workspace/tasks/{active['id']}",
            method="PATCH",
            token="test-token",
            body={"summary": "Edited after done"},
        )
        assert preserved["status"] == "done"
        assert preserved["completed_at_ms"] == first_completed_at

        reopened = request_json(
            base_url,
            f"/api/workspace/tasks/{active['id']}",
            method="PATCH",
            token="test-token",
            body={"status": "waiting"},
        )
        assert reopened["status"] == "waiting"
        assert "completed_at_ms" not in reopened

        time.sleep(0.02)
        redone = request_json(
            base_url,
            f"/api/workspace/tasks/{active['id']}",
            method="PATCH",
            token="test-token",
            body={"status": "done"},
        )
        assert int(redone["completed_at_ms"]) > first_completed_at
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


def test_workspace_api_allows_dismiss_patch_for_orphaned_recipient_reminder(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        request_json(
            base_url,
            "/api/workspace/contacts",
            method="POST",
            token="test-token",
            body={
                "id": "orphan-contact",
                "title": "Orphan Contact",
                "metadata": {
                    "phone": "+14155550168",
                },
            },
        )
        request_json(
            base_url,
            "/api/workspace/reminders",
            method="POST",
            token="test-token",
            body={
                "id": "orphan-reminder",
                "title": "Orphan reminder",
                "status": "open",
                "due_at_ms": 60_000,
                "metadata": {
                    "recipients": [
                        {"id": "self", "kind": "self", "label": "Me"},
                        {"id": "orphan-contact", "kind": "contact", "contact_id": "orphan-contact", "label": "Orphan Contact"},
                    ],
                    "destinations": [
                        {"channel": "phone_notification", "recipient_ids": ["self"]},
                        {"channel": "sms", "recipient_ids": ["orphan-contact"]},
                    ],
                },
            },
        )
        request_json(
            base_url,
            "/api/workspace/contacts/orphan-contact",
            method="DELETE",
            token="test-token",
        )

        done = request_json(
            base_url,
            "/api/workspace/reminders/orphan-reminder",
            method="PATCH",
            token="test-token",
            body={"status": "done"},
        )
        assert done["status"] == "done"
        assert done["metadata"]["snoozed_until_ms"] == 0
        assert done["metadata"]["destinations"][1]["channel"] == "sms"
        assert done["metadata"]["recipients"][1]["id"] == "orphan-contact"
    finally:
        server.shutdown()


def test_workspace_api_allows_snooze_patch_for_orphaned_recipient_reminder(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        request_json(
            base_url,
            "/api/workspace/contacts",
            method="POST",
            token="test-token",
            body={
                "id": "orphan-contact",
                "title": "Orphan Contact",
                "metadata": {
                    "phone": "+14155550168",
                },
            },
        )
        request_json(
            base_url,
            "/api/workspace/reminders",
            method="POST",
            token="test-token",
            body={
                "id": "orphan-reminder",
                "title": "Orphan reminder",
                "status": "open",
                "due_at_ms": 60_000,
                "metadata": {
                    "recipients": [
                        {"id": "self", "kind": "self", "label": "Me"},
                        {"id": "orphan-contact", "kind": "contact", "contact_id": "orphan-contact", "label": "Orphan Contact"},
                    ],
                    "destinations": [
                        {"channel": "phone_notification", "recipient_ids": ["self"]},
                        {"channel": "sms", "recipient_ids": ["orphan-contact"]},
                    ],
                },
            },
        )
        request_json(
            base_url,
            "/api/workspace/contacts/orphan-contact",
            method="DELETE",
            token="test-token",
        )

        snoozed = request_json(
            base_url,
            "/api/workspace/reminders/orphan-reminder",
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
        assert snoozed["metadata"]["destinations"][1]["channel"] == "sms"
        assert snoozed["metadata"]["recipients"][1]["id"] == "orphan-contact"
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


def test_workspace_api_preserves_self_contact_and_allows_updates(tmp_path: Path) -> None:
    server, base_url = start_server(tmp_path)
    try:
        me = request_json(base_url, "/api/workspace/contacts/contact-me")
        assert me["id"] == "contact-me"
        assert me["metadata"]["is_self"] is True
        assert me["metadata"]["avatar"] == "M"

        renamed = request_json(
            base_url,
            "/api/workspace/contacts/contact-me",
            method="PATCH",
            token="test-token",
            body={
                "metadata": {
                    "first_name": "Jordan",
                    "last_name": "Taylor",
                }
            },
        )
        assert renamed["title"] == "Jordan Taylor"
        assert renamed["metadata"]["display_name"] == "Jordan Taylor"
        assert renamed["metadata"]["avatar"] == "JT"

        renamed = request_json(
            base_url,
            "/api/workspace/contacts/contact-me",
            method="PATCH",
            token="test-token",
            body={
                "metadata": {
                    "first_name": "Updated",
                    "last_name": "Proof Contact",
                }
            },
        )
        assert renamed["title"] == "Updated Proof Contact"
        assert renamed["metadata"]["display_name"] == "Updated Proof Contact"
        assert renamed["metadata"]["avatar"] == "UC"

        updated = request_json(
            base_url,
            "/api/workspace/contacts/contact-me",
            method="PATCH",
            token="test-token",
            body={
                "metadata": {
                    "email": "me@example.com",
                    "phone": "+14155550123",
                    "notification_device_id": "phone-1",
                }
            },
        )
        assert updated["metadata"]["email"] == "me@example.com"
        assert updated["metadata"]["phone"] == "+14155550123"
        assert updated["metadata"]["notification_device_id"] == "phone-1"
        assert updated["metadata"]["is_self"] is True
        assert updated["pinned"] is False
        assert updated["archived"] is False
        assert updated["deleted"] is False

        preserved = request_json(
            base_url,
            "/api/workspace/contacts/contact-me",
            method="DELETE",
            token="test-token",
        )
        assert preserved["id"] == "contact-me"
        assert preserved["title"] == "Updated Proof Contact"
        assert preserved["archived"] is False
        assert preserved["deleted"] is False
    finally:
        server.shutdown()
