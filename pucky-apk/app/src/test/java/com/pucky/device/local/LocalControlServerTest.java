package com.pucky.device.local;

import com.pucky.device.ui.PuckyHomeState;

import org.json.JSONObject;
import org.junit.Test;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public final class LocalControlServerTest {
    @Test
    public void healthReturnsCurrentHomeState() throws Exception {
        PuckyHomeState state = new PuckyHomeState();
        try (LocalControlServer server = new LocalControlServer(state, 0)) {
            server.start();

            JSONObject response = getJson(server.port(), "/v1/health");

            assertTrue(response.getBoolean("ok"));
            assertEquals(PuckyHomeState.DEFAULT_EMOJI,
                    response.getJSONObject("ui_state").getJSONObject("screen").getString("emoji"));
        }
    }

    @Test
    public void renderEndpointUpdatesHomeState() throws Exception {
        PuckyHomeState state = new PuckyHomeState();
        try (LocalControlServer server = new LocalControlServer(state, 0)) {
            server.start();

            JSONObject response = postJson(server.port(), "/v1/ui/render",
                    new JSONObject()
                            .put("screen", new JSONObject()
                                    .put("emoji", "\uD83D\uDCA1")
                                    .put("label", "Local tunnel")));

            assertTrue(response.getBoolean("ok"));
            assertEquals("\uD83D\uDCA1",
                    state.snapshot().getJSONObject("screen").getString("emoji"));
            assertEquals("Local tunnel",
                    response.getJSONObject("state").getJSONObject("screen").getString("label"));
        }
    }

    private static JSONObject getJson(int port, String path) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        connection.setRequestMethod("GET");
        return new JSONObject(new String(connection.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
    }

    private static JSONObject postJson(int port, String path, JSONObject body) throws Exception {
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + port + path).openConnection();
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Content-Length", String.valueOf(bytes.length));
        try (OutputStream output = connection.getOutputStream()) {
            output.write(bytes);
        }
        return new JSONObject(new String(connection.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
    }
}
