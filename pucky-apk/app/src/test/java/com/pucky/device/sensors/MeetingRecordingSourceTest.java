package com.pucky.device.sensors;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class MeetingRecordingSourceTest {
    @Test
    public void coverHoverHoldTogglesMeetingRecordingInsteadOfShortWave() throws Exception {
        String source = read("src/main/java/com/pucky/device/sensors/CoverDisplayGestureController.java");

        assertTrue(source.contains("MEETING_HOVER_HOLD_MS = 3_000L"));
        assertTrue(source.contains("scheduleHoverHold"));
        assertTrue(source.contains("evaluateHoverCandidate"));
        assertTrue(source.contains("\"hover_started\""));
        assertTrue(source.contains("\"hover_progress\""));
        assertTrue(source.contains("\"hover_cancelled\""));
        assertTrue(source.contains("\"meeting_recording_started\""));
        assertTrue(source.contains("\"meeting_recording_stopped\""));
        assertTrue(source.contains("\"meeting_recording_failed\""));
        assertTrue(source.contains("MeetingRecordingController.shared(context).toggleFromHover"));
        assertTrue(source.contains("JSONObject result = MeetingRecordingController.shared(context).toggleFromHover"));
        assertTrue(source.contains("addEventLocked(\n                        \"recording\".equals(state) ? \"meeting_recording_started\" : \"meeting_recording_stopped\""));
        assertTrue(source.contains("result);"));
        assertTrue(source.contains("Json.put(event, \"detail\", detail)"));
        assertTrue(source.contains("MEETING_HOVER_FALSE_GAP_MS = 350L"));
        assertTrue(source.contains("ACCEL_DELTA_SPIKE = 2.25f"));
        assertTrue(source.contains("\"hover_false_gap_ignored\""));
        assertTrue(source.contains("scheduleHoverFalseGapCancel"));
        assertTrue(source.contains("cancelHoverIfStillAway"));
        assertFalse(source.contains("maxSwipeMs()"));
        assertFalse(source.contains("minSwipeMs()"));
        assertFalse(source.contains("DEFAULT_MAX_SWIPE_MS = 500L"));
        assertFalse(source.contains("runNotifyAction"));
        assertFalse(source.contains("runLockScreenAction"));
        assertFalse(source.contains("PuckyAccessibilityService"));
    }

    @Test
    public void commandAndCapabilitySurfacesExposeMeetingRecording() throws Exception {
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String capability = read("src/main/java/com/pucky/device/capabilities/CapabilityReporter.java");

        assertTrue(executor.contains("\"meeting.recording.status\""));
        assertTrue(executor.contains("\"meeting.recording.start\""));
        assertTrue(executor.contains("\"meeting.recording.stop\""));
        assertTrue(executor.contains("\"meeting.recording.trigger_hover\""));
        assertTrue(executor.contains("\"meeting.hover.status\""));
        assertTrue(executor.contains("\"meeting.hover.config.set\""));
        assertTrue(executor.contains("MeetingRecordingController.shared(settingsStore.context())"));
        assertTrue(capability.contains("meeting.recording.status/meeting.recording.start/meeting.recording.stop"));
        assertTrue(capability.contains("meeting.hover.status/meeting.hover.config.set/meeting.recording.trigger_hover"));
        assertTrue(capability.contains("Three-second cover hover toggles Meeting Recording Mode"));
        assertTrue(capability.contains("no lock or notify action"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8).replace("\r\n", "\n");
    }
}
