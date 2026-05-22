package com.pucky.device.ui;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.List;

public final class ReplyCardTest {
    @Test
    public void parsesRequiredTitleAndOptionalFieldsWithoutId() throws Exception {
        JSONArray messages = new JSONArray()
                .put(new JSONObject()
                        .put("sender", "user")
                        .put("text", "What is next?")
                        .put("timestamp", "8:42 PM"))
                .put(new JSONObject()
                        .put("sender", "pucky")
                        .put("text", "Brief me")
                        .put("media_type", "image")
                        .put("media_label", "Inbox chart"));
        JSONArray images = new JSONArray()
                .put(new JSONObject()
                        .put("path", "/data/user/0/com.pucky.device.debug/files/pictures/morning.png")
                        .put("mime_type", "image/png")
                        .put("title", "Morning image"));
        JSONArray audioTimestamps = new JSONArray()
                .put(new JSONObject()
                        .put("id", "chapter-01")
                        .put("title", "Prologue")
                        .put("start_ms", 0)
                        .put("end_ms", 403260)
                        .put("detail", "6:43"));
        JSONObject trace = new JSONObject()
                .put("schema", "pucky.turn_trace.v1")
                .put("turn_id", "turn_fixture")
                .put("sections", new JSONArray()
                        .put(new JSONObject()
                                .put("kind", "thinking")
                                .put("title", "Checking context")
                                .put("items", new JSONArray()
                                        .put(new JSONObject()
                                                .put("label", "web_search")
                                                .put("status", "completed")))));
        JSONObject input = new JSONObject()
                .put("title", " Morning launch ")
                .put("session_id", " pucky_abc123 ")
                .put("tag", " Today ")
                .put("summary", "Brief me")
                .put("transcript", "User: what is next?\nPucky: Brief me")
                .put("transcript_messages", messages)
                .put("created_at", "2026-05-20T11:05:00-07:00")
                .put("icon", "clock")
                .put("accent", "#ffb000")
                .put("audio_path", "/tmp/audio.m4a")
                .put("audio_playlist_path", "/tmp/book.m3u")
                .put("audio_timestamps", audioTimestamps)
                .put("html_path", "/tmp/reply.html")
                .put("images", images)
                .put("trace", trace);

        ReplyCard card = ReplyCard.fromJson(input);

        assertEquals("Morning launch", card.title());
        assertEquals("pucky_abc123", card.sessionId());
        assertEquals("Today", card.tag());
        assertEquals("Brief me", card.summary());
        assertEquals("User: what is next?\nPucky: Brief me", card.transcript());
        assertEquals(messages.toString(), card.transcriptMessages());
        assertEquals("2026-05-20T11:05:00-07:00", card.createdAt());
        assertEquals("clock", card.icon());
        assertEquals("#ffb000", card.accent());
        assertEquals("/tmp/audio.m4a", card.audioPath());
        assertEquals("/tmp/book.m3u", card.audioPlaylistPath());
        assertEquals(audioTimestamps.toString(), card.audioTimestamps());
        assertEquals("/tmp/reply.html", card.htmlPath());
        assertEquals(images.toString(), card.images());
        assertEquals(trace.toString(), card.trace());
        assertTrue(card.hasTranscript());
        assertFalse(card.toJson().has("id"));
        assertEquals("pucky_abc123", card.toJson().getString("session_id"));
        assertEquals("2026-05-20T11:05:00-07:00", card.toJson().getString("created_at"));
        assertEquals("User: what is next?\nPucky: Brief me", card.toJson().getString("transcript"));
        assertEquals("/tmp/book.m3u", card.toJson().getString("audio_playlist_path"));
        assertEquals(1, card.toJson().getJSONArray("audio_timestamps").length());
        assertEquals(2, card.toJson().getJSONArray("transcript_messages").length());
        assertEquals(1, card.toJson().getJSONArray("images").length());
        assertEquals("pucky.turn_trace.v1", card.toJson().getJSONObject("trace").getString("schema"));
    }

    @Test
    public void rejectsMissingOrBlankTitle() throws Exception {
        try {
            ReplyCard.fromJson(new JSONObject().put("summary", "No title"));
            fail("Expected blank title to fail");
        } catch (CommandException exc) {
            assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
        }

        try {
            ReplyCard.fromJson(new JSONObject().put("title", "   "));
            fail("Expected blank title to fail");
        } catch (CommandException exc) {
            assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
        }
    }

    @Test
    public void listParsingPreservesArrayOrder() throws Exception {
        JSONArray input = new JSONArray()
                .put(new JSONObject().put("title", "First"))
                .put(new JSONObject().put("title", "Second"));

        List<ReplyCard> cards = ReplyCard.listFromJson(input);

        assertEquals(2, cards.size());
        assertEquals("First", cards.get(0).title());
        assertEquals("Second", cards.get(1).title());
        assertTrue(ReplyCard.listToJson(cards).getJSONObject(0).has("title"));
    }

    @Test
    public void rejectsMalformedImageAndTraceJson() throws Exception {
        try {
            ReplyCard.fromJson(new JSONObject()
                    .put("title", "Bad images")
                    .put("images", new JSONObject()));
            fail("Expected object images to fail");
        } catch (CommandException exc) {
            assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
        }

        try {
            ReplyCard.fromJson(new JSONObject()
                    .put("title", "Bad trace")
                    .put("trace", new JSONArray()));
            fail("Expected array trace to fail");
        } catch (CommandException exc) {
            assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
        }

        try {
            ReplyCard.fromJson(new JSONObject()
                    .put("title", "Bad timestamps")
                    .put("audio_timestamps", new JSONObject()));
            fail("Expected object audio_timestamps to fail");
        } catch (CommandException exc) {
            assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
        }
    }
}
