package com.pucky.device.ui;

import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;

public final class PuckyHomeStateTest {
    @Test
    public void defaultsToEmojiHomeScreen() throws Exception {
        PuckyHomeState state = new PuckyHomeState();

        JSONObject screen = state.snapshot().getJSONObject("screen");

        assertEquals("emoji", screen.getString("type"));
        assertEquals(PuckyHomeState.DEFAULT_EMOJI, screen.getString("emoji"));
        assertEquals(PuckyHomeState.DEFAULT_LABEL, screen.getString("label"));
        assertEquals(PuckyHomeState.DEFAULT_SUBTITLE, screen.getString("subtitle"));
    }

    @Test
    public void renderUpdatesEmojiHomeScreen() throws Exception {
        PuckyHomeState state = new PuckyHomeState();
        JSONObject input = new JSONObject()
                .put("screen", new JSONObject()
                        .put("emoji", "\uD83D\uDD25")
                        .put("label", "Tunnel online")
                        .put("subtitle", "Bridge ready"));

        JSONObject screen = state.render(input).getJSONObject("screen");

        assertEquals("\uD83D\uDD25", screen.getString("emoji"));
        assertEquals("Tunnel online", screen.getString("label"));
        assertEquals("Bridge ready", screen.getString("subtitle"));
    }
}
