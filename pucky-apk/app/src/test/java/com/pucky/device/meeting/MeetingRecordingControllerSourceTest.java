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

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8).replace("\r\n", "\n");
    }
}
