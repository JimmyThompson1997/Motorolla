package com.pucky.device.pucky;

import static org.junit.Assert.assertEquals;

import org.json.JSONObject;
import org.junit.Test;

public class PuckyTurnThreadScopeMetadataTest {

    @Test
    public void mergeThreadScopeFromMatchedStatusCopiesMissingExistingThreadFields() throws Exception {
        JSONObject capture = new JSONObject();
        capture.put("session_id", "session-1");
        capture.put("turn_id", "turn-1");

        JSONObject fallback = new JSONObject();
        fallback.put("local_session_id", "session-1");
        fallback.put("turn_id", "turn-1");
        fallback.put("thread_mode", "existing");
        fallback.put("thread_id", "thread-1");
        fallback.put("thread_card_id", "card-1");
        fallback.put("thread_session_id", "thread-session-1");
        fallback.put("thread_scope_source", "thread_transcript");

        JSONObject merged = PuckyTurnController.mergeThreadScopeFromMatchedStatus(capture, fallback);

        assertEquals("existing", merged.optString("thread_mode", ""));
        assertEquals("thread-1", merged.optString("thread_id", ""));
        assertEquals("card-1", merged.optString("thread_card_id", ""));
        assertEquals("thread-session-1", merged.optString("thread_session_id", ""));
        assertEquals("thread_transcript", merged.optString("thread_scope_source", ""));
    }

    @Test
    public void mergeThreadScopeFromMatchedStatusDoesNotOverrideExplicitCaptureFields() throws Exception {
        JSONObject capture = new JSONObject();
        capture.put("session_id", "session-1");
        capture.put("turn_id", "turn-1");
        capture.put("thread_mode", "new");
        capture.put("thread_id", "");
        capture.put("thread_card_id", "capture-card");
        capture.put("thread_scope_source", "capture_surface");

        JSONObject fallback = new JSONObject();
        fallback.put("local_session_id", "session-1");
        fallback.put("turn_id", "turn-1");
        fallback.put("thread_mode", "existing");
        fallback.put("thread_id", "thread-1");
        fallback.put("thread_card_id", "fallback-card");
        fallback.put("thread_scope_source", "thread_transcript");

        JSONObject merged = PuckyTurnController.mergeThreadScopeFromMatchedStatus(capture, fallback);

        assertEquals("new", merged.optString("thread_mode", ""));
        assertEquals("", merged.optString("thread_id", ""));
        assertEquals("capture-card", merged.optString("thread_card_id", ""));
        assertEquals("capture_surface", merged.optString("thread_scope_source", ""));
    }

    @Test
    public void mergeThreadScopeFromMatchedStatusIgnoresDifferentTurnIds() throws Exception {
        JSONObject capture = new JSONObject();
        capture.put("session_id", "session-1");
        capture.put("turn_id", "turn-1");

        JSONObject fallback = new JSONObject();
        fallback.put("local_session_id", "session-1");
        fallback.put("turn_id", "turn-2");
        fallback.put("thread_mode", "existing");
        fallback.put("thread_id", "thread-1");
        fallback.put("thread_scope_source", "thread_transcript");

        JSONObject merged = PuckyTurnController.mergeThreadScopeFromMatchedStatus(capture, fallback);

        assertEquals("", merged.optString("thread_mode", ""));
        assertEquals("", merged.optString("thread_id", ""));
        assertEquals("", merged.optString("thread_scope_source", ""));
    }
}
