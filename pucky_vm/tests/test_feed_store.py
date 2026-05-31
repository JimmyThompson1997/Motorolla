from __future__ import annotations

import base64

from pucky_vm.feed_store import FeedStore


def test_turn_upsert_replaces_html_and_attachment_artifacts(tmp_path) -> None:
    store = FeedStore(str(tmp_path / "feed.sqlite3"))
    attachment = tmp_path / "old.txt"
    attachment.write_text("old attachment", encoding="utf-8")
    try:
        store.upsert_turn_result(
            turn_id="replace-turn",
            session_id="session",
            reply_mode="card_only",
            reply_text="old",
            title="Old",
            summary="old summary",
            icon="bolt",
            origin={},
            telemetry={},
            transcript_messages=[
                {
                    "role": "assistant",
                    "attachments": [
                        {
                            "artifact": "pucky_card_replace-turn:attachment:1:original",
                            "path": str(attachment),
                            "mime_type": "text/plain",
                        }
                    ],
                }
            ],
            request_audio_mime_type="audio/wav",
            request_audio_base64=base64.b64encode(b"request audio").decode("ascii"),
            audio_mime_type="audio/wav",
            audio_base64=base64.b64encode(b"reply audio").decode("ascii"),
            html_mime_type="text/html",
            html_base64=base64.b64encode(b"<p>old</p>").decode("ascii"),
        )

        assert store.get_artifact("pucky_card_replace-turn:html") is not None
        assert store.get_artifact("pucky_card_replace-turn:request_audio") is not None
        assert store.get_artifact("pucky_card_replace-turn:attachment:1:original") is not None

        item = store.upsert_turn_result(
            turn_id="replace-turn",
            session_id="session",
            reply_mode="card_only",
            reply_text="new",
            title="New",
            summary="new summary",
            icon="calendar",
            origin={},
            telemetry={},
            transcript_messages=[{"role": "assistant", "attachments": []}],
            request_audio_mime_type="audio/wav",
            request_audio_base64="",
            audio_mime_type="audio/wav",
            audio_base64=base64.b64encode(b"new reply audio").decode("ascii"),
            html_mime_type="text/html",
            html_base64="",
        )

        assert "html_base64" not in item
        assert store.get_artifact("pucky_card_replace-turn:audio") is not None
        assert store.get_artifact("pucky_card_replace-turn:html") is None
        assert store.get_artifact("pucky_card_replace-turn:request_audio") is None
        assert store.get_artifact("pucky_card_replace-turn:attachment:1:original") is None
    finally:
        store.close()
