package com.pucky.device.clipboard;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.time.Instant;

public final class PuckyClipboardControllerTest {
    @Test
    public void labSessionEntryPreservesKeywordActionAndArtifact() throws Exception {
        JSONObject result = new JSONObject()
                .put("command", "photo.capture")
                .put("result", new JSONObject()
                        .put("app_private_path", "/storage/emulated/0/Android/data/com.pucky.device/files/Pictures/pucky.jpg")
                        .put("public_uri", "content://media/external/images/media/1")
                        .put("public_relative_path", "DCIM/Pucky")
                        .put("mime_type", "image/jpeg")
                        .put("bytes", 1234));
        JSONObject session = new JSONObject()
                .put("session_id", "lab_1")
                .put("pucky_clipboard_entry_id", "clip_recipe_1")
                .put("keyword_raw_transcript", "photo")
                .put("keyword_normalized_transcript", "photo")
                .put("keyword_match_id", "photo")
                .put("keyword_match_phrase", "photo")
                .put("keyword_match_strategy", "exact_utterance")
                .put("keyword_action_command", "photo.capture")
                .put("keyword_action_status", "succeeded")
                .put("keyword_action_result", result);

        JSONObject entry = PuckyClipboardController.entryFromLabSession(session);

        assertEquals("pucky.clipboard_entry.v1", entry.optString("schema"));
        assertEquals("clip_recipe_1", entry.optString("entry_id"));
        assertEquals("volume_down_lab", entry.optString("source"));
        assertEquals("photo.capture", entry.optString("action_command"));
        assertEquals("succeeded", entry.optString("action_status"));
        assertEquals(1, entry.optJSONArray("artifacts").length());
        assertEquals("photo", entry.optJSONArray("artifacts").optJSONObject(0).optString("kind"));
        assertEquals("content://media/external/images/media/1",
                entry.optJSONArray("artifacts").optJSONObject(0).optString("public_uri"));
    }

    @Test
    public void pruningKeepsRecentEntriesOnly() throws Exception {
        JSONArray entries = new JSONArray();
        entries.put(new JSONObject()
                .put("entry_id", "old")
                .put("created_at", "2020-01-01T00:00:00Z"));
        entries.put(new JSONObject()
                .put("entry_id", "recent")
                .put("created_at", "2026-05-20T00:00:00Z"));

        JSONArray pruned = PuckyClipboardController.pruned(entries, Instant.parse("2026-05-23T00:00:00Z"));

        assertEquals(1, pruned.length());
        assertEquals("recent", pruned.optJSONObject(0).optString("entry_id"));
    }

    @Test
    public void entryDoesNotUseAndroidSystemClipboard() throws Exception {
        JSONObject entry = PuckyClipboardController.entryFromLabSession(new JSONObject()
                .put("session_id", "lab_2")
                .put("keyword_action_status", "failed"));

        assertFalse(entry.has("android_system_clipboard"));
        assertTrue(PuckyClipboardController.pruned(new JSONArray().put(entry), Instant.now()).length() == 1);
    }
}
