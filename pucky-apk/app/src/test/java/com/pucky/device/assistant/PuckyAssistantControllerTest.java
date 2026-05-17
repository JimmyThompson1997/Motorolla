package com.pucky.device.assistant;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

public final class PuckyAssistantControllerTest {
    @Test
    public void openLineActiveWhenMicEnabled() throws Exception {
        JSONObject status = new JSONObject();
        status.put("mic_enabled", true);
        status.put("state", "connected_talking");
        assertTrue(PuckyAssistantController.isOpenLineActive(status));
    }

    @Test
    public void openLineActiveWhenPttTurnIsPresent() throws Exception {
        JSONObject status = new JSONObject();
        status.put("mic_enabled", false);
        status.put("state", "connected_muted");
        status.put("active_ptt_turn_id", "assistant_123");
        assertTrue(PuckyAssistantController.isOpenLineActive(status));
    }

    @Test
    public void openLineInactiveWhenMutedWithoutActiveTurn() throws Exception {
        JSONObject status = new JSONObject();
        status.put("mic_enabled", false);
        status.put("state", "connected_muted");
        status.put("active_ptt_turn_id", JSONObject.NULL);
        assertFalse(PuckyAssistantController.isOpenLineActive(status));
    }
}
