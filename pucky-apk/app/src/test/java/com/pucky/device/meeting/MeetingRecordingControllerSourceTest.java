package com.pucky.device.meeting;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class MeetingRecordingControllerSourceTest {
    @Test
    public void meetingIdsAreStableAndUploadsUseVmMeetingIngest() throws Exception {
        String source = read("src/main/java/com/pucky/device/meeting/MeetingRecordingController.java");

        assertTrue(source.contains("meeting-"));
        assertTrue(source.contains("DateTimeFormatter.ofPattern(\"yyyyMMdd-HHmmss\")"));
        assertTrue(source.contains("safeDeviceId"));
        assertTrue(source.contains("UUID.randomUUID()"));
        assertTrue(source.contains("meeting_id"));
        assertTrue(source.contains("audio_base64"));
        assertTrue(source.contains("device_path"));
        assertTrue(source.contains("upload_status"));
        assertTrue(source.contains("\"/api/meetings\""));
    }

    @Test
    public void meetingRecordingReusesVoiceCaptureWithHapticFeedback() throws Exception {
        String source = read("src/main/java/com/pucky/device/meeting/MeetingRecordingController.java");

        assertTrue(source.contains("VoiceCaptureController.shared(context).start(startArgs)"));
        assertTrue(source.contains("VoiceCaptureController.shared(context).stop(stopArgs)"));
        assertTrue(source.contains("activeVoiceSessionId"));
        assertTrue(source.contains("started.optJSONObject(\"active_session\")"));
        assertTrue(source.contains("activeSession = started"));
        assertTrue(source.contains("activeSession.optString(\"session_id\", \"\")"));
        assertTrue(source.contains("activeVoiceSessionId.isEmpty() ? meetingId : activeVoiceSessionId"));
        assertTrue(source.contains("startUpload(record, capture)"));
        assertTrue(source.contains("new Thread(() ->"));
        assertTrue(source.contains("\"uploading\""));
        assertTrue(source.contains("args.optBoolean(\"feedback\", true)"));
        assertTrue(source.contains("sample_tag"));
        assertTrue(source.contains("meeting_recording"));
        assertTrue(source.contains("max_duration_ms"));
    }

    @Test
    public void activeMeetingToggleRestoresFromVoiceCaptureAcrossCommandReentry() throws Exception {
        String source = read("src/main/java/com/pucky/device/meeting/MeetingRecordingController.java");

        assertTrue(source.contains("ACTIVE_MEETING_ID"));
        assertTrue(source.contains("ACTIVE_VOICE_SESSION_ID"));
        assertTrue(source.contains("persistActiveIds()"));
        assertTrue(source.contains("clearActiveIds()"));
        assertTrue(source.contains("restoreActiveFromVoiceCaptureLocked()"));
        assertTrue(source.contains("VoiceCaptureController.shared(context).status()"));
        assertTrue(source.contains("\"meeting_recording\".equals(activeSession.optString(\"sample_tag\", \"\"))"));
        assertTrue(source.contains("meetingIdFromVoiceSession"));
        assertTrue(source.contains("value.startsWith(\"vc_\") ? value.substring(3) : value"));
        String hoverBody = source.split("public synchronized JSONObject toggleFromHover\\(String reason\\)", 2)[1]
                .split("private JSONObject playMeetingHoverChime", 2)[0];
        assertTrue(hoverBody.contains("restoreActiveFromVoiceCaptureLocked()"));
    }

    @Test
    public void hoverTriggeredRecordingAddsAudibleChimeWithoutChangingPlainStartStop() throws Exception {
        String source = read("src/main/java/com/pucky/device/meeting/MeetingRecordingController.java");

        assertTrue(source.contains("ToneGenerator"));
        assertTrue(source.contains("playMeetingHoverChime"));
        assertTrue(source.contains("\"chime_attempted\""));
        assertTrue(source.contains("\"chime_played\""));
        assertTrue(source.contains("\"chime_tone\""));
        assertTrue(source.contains("\"chime_duration_ms\""));
        assertTrue(source.contains("TONE_PROP_ACK"));
        assertTrue(source.contains("TONE_PROP_BEEP2"));

        String startBody = source.split("public synchronized JSONObject start\\(JSONObject args\\)", 2)[1]
                .split("public synchronized JSONObject stop\\(JSONObject args\\)", 2)[0];
        String stopBody = source.split("public synchronized JSONObject stop\\(JSONObject args\\)", 2)[1]
                .split("private void startUpload", 2)[0];
        String hoverBody = source.split("public synchronized JSONObject toggleFromHover\\(String reason\\)", 2)[1]
                .split("private String newMeetingId", 2)[0];

        assertTrue(hoverBody.contains("playMeetingHoverChime(starting)"));
        assertTrue(hoverBody.contains("Json.put(result, \"hover_chime\", chime)"));
        assertTrue(hoverBody.contains("copyChimeField(result, chime, \"chime_attempted\")"));
        assertTrue(hoverBody.contains("copyChimeField(result, chime, \"chime_played\")"));
        assertTrue(hoverBody.contains("copyChimeField(result, chime, \"chime_tone\")"));
        assertTrue(hoverBody.contains("copyChimeField(result, chime, \"chime_duration_ms\")"));
        assertTrue(!startBody.contains("playMeetingHoverChime"));
        assertTrue(!stopBody.contains("playMeetingHoverChime"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8).replace("\r\n", "\n");
    }
}
