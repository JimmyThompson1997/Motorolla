package com.pucky.device.notifications;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.pucky.device.command.CommandException;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public final class NotificationPayloadNormalizerTest {
    @Test
    public void fullScreenPayloadNormalizesExpectedFields() throws Exception {
        JSONObject payload = new JSONObject()
                .put("id", "proof-alert")
                .put("title", "Wake up")
                .put("text", "Critical event")
                .put("surface", new JSONObject().put("mode", "full_screen"))
                .put("importance", "high")
                .put("category", "alarm")
                .put("full_screen_activity", "home")
                .put("default_sound", true)
                .put("vibration_pattern_ms", new JSONArray().put(0).put(120).put(80).put(240))
                .put("actions", new JSONArray()
                        .put(new JSONObject().put("id", "ack").put("title", "Acknowledge").put("kind", "button"))
                        .put(new JSONObject().put("id", "reply").put("title", "Reply").put("kind", "reply")));

        NotificationPayloadNormalizer.NormalizedPayload normalized =
                NotificationPayloadNormalizer.normalize("cmd-proof", payload);

        assertEquals("proof-alert", normalized.id);
        assertEquals("cmd-proof", normalized.commandId);
        assertEquals("full_screen", normalized.surfaceMode);
        assertEquals(4, normalized.importance);
        assertEquals("alarm", normalized.category);
        assertEquals("home", normalized.fullScreenActivity);
        assertTrue(normalized.defaultSound);
        assertEquals(2, normalized.actions.size());
        assertEquals("reply", normalized.actions.get(1).kind);
        assertTrue(normalized.channel.profileKey.length() >= 8);
    }

    @Test
    public void normalizeRejectsTooManyActions() throws Exception {
        JSONObject payload = new JSONObject()
                .put("surface", new JSONObject().put("mode", "heads_up"))
                .put("actions", new JSONArray()
                        .put(new JSONObject().put("id", "a").put("title", "A"))
                        .put(new JSONObject().put("id", "b").put("title", "B"))
                        .put(new JSONObject().put("id", "c").put("title", "C"))
                        .put(new JSONObject().put("id", "d").put("title", "D")));

        expectMalformed(payload, "at most 3");
    }

    @Test
    public void normalizeRejectsMultipleReplyActions() throws Exception {
        JSONObject payload = new JSONObject()
                .put("surface", new JSONObject().put("mode", "heads_up"))
                .put("actions", new JSONArray()
                        .put(new JSONObject().put("id", "reply-a").put("title", "Reply A").put("kind", "reply"))
                        .put(new JSONObject().put("id", "reply-b").put("title", "Reply B").put("kind", "reply")));

        expectMalformed(payload, "at most one reply");
    }

    @Test
    public void normalizeRejectsFullScreenWithoutTargetActivity() throws Exception {
        JSONObject payload = new JSONObject()
                .put("surface", new JSONObject().put("mode", "full_screen"));

        expectMalformed(payload, "full_screen_activity");
    }

    @Test
    public void identicalSignalProfilesReuseSameChannelKey() throws Exception {
        JSONObject first = new JSONObject()
                .put("surface", new JSONObject().put("mode", "heads_up"))
                .put("importance", "high")
                .put("default_sound", true)
                .put("vibration_pattern_ms", new JSONArray().put(0).put(120).put(80).put(180));
        JSONObject second = new JSONObject(first.toString());
        JSONObject third = new JSONObject(first.toString())
                .put("vibration_pattern_ms", new JSONArray().put(0).put(200).put(80).put(280));

        NotificationPayloadNormalizer.NormalizedPayload normalizedFirst =
                NotificationPayloadNormalizer.normalize("cmd-a", first);
        NotificationPayloadNormalizer.NormalizedPayload normalizedSecond =
                NotificationPayloadNormalizer.normalize("cmd-b", second);
        NotificationPayloadNormalizer.NormalizedPayload normalizedThird =
                NotificationPayloadNormalizer.normalize("cmd-c", third);

        assertEquals(normalizedFirst.channel.profileKey, normalizedSecond.channel.profileKey);
        assertFalse(normalizedFirst.channel.profileKey.equals(normalizedThird.channel.profileKey));
    }

    @Test
    public void askPayloadBuildsReplyActionCompatibly() throws Exception {
        JSONObject payload = NotificationPayloadNormalizer.askPayload("cmd-ask", new JSONObject().put("title", "Prompt"));

        assertEquals("Prompt", payload.optString("title"));
        assertEquals("cmd-ask", payload.optString("prompt_id"));
        assertTrue(payload.optBoolean("ongoing"));
        assertFalse(payload.optBoolean("auto_cancel"));
        assertEquals(1, payload.optJSONArray("actions").length());
        assertEquals("reply", payload.optJSONArray("actions").optJSONObject(0).optString("kind"));
    }

    private static void expectMalformed(JSONObject payload, String expectedFragment) throws Exception {
        try {
            NotificationPayloadNormalizer.normalize("cmd-proof", payload);
            fail("Expected CommandException");
        } catch (CommandException exc) {
            assertTrue(exc.getMessage().contains(expectedFragment));
        }
    }
}
