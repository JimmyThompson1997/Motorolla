package com.pucky.device.assistant;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class PuckyAssistantControllerTest {
    @Test
    public void assistantInvocationDoesNotStartOpenLineBackend() throws Exception {
        String source = new String(
                Files.readAllBytes(Path.of("src/main/java/com/pucky/device/assistant/PuckyAssistantController.java")),
                StandardCharsets.UTF_8);

        assertFalse(source.contains("LiveKitController"));
        assertFalse(source.contains("isOpenLineActive"));
        assertFalse(source.contains("pttStart"));
        assertFalse(source.contains("pttStop"));
        assertFalse(source.contains("active_ptt_turn_id"));
        assertFalse(source.contains("mic_enabled"));
        assertFalse(source.contains("connected_talking"));
        assertFalse(source.contains("connected_muted"));
        assertFalse(source.contains("toggleOpenLine"));
        assertFalse(source.contains("pucky.device.livekit"));
        assertFalse(source.contains("open_line_backend\", \"livekit\""));
        assertTrue(source.contains("open_line_backend\", \"none\""));
    }
}
