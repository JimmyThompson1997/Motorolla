package com.pucky.device.camera;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class VideoCaptureControllerSourceTest {
    @Test
    public void videoCaptureIsSilentPrivateThenPublishedToMovies() throws Exception {
        String source = read("src/main/java/com/pucky/device/camera/VideoCaptureController.java");

        assertTrue(source.contains("recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)"));
        assertTrue(source.contains("MediaRecorder.VideoEncoder.H264"));
        assertTrue(source.contains("PUBLIC_VIDEO_RELATIVE_DIR = Environment.DIRECTORY_MOVIES + \"/Pucky\""));
        assertTrue(source.contains("MediaStore.Video.Media.EXTERNAL_CONTENT_URI"));
        assertTrue(source.contains("silent_video"));
        assertTrue(source.contains("reply_text_override\", \"Video was off.\""));
        assertTrue(source.contains("reply_text_override\", \"Video turned off.\""));
        assertTrue(source.contains("DEFAULT_MAX_DURATION_MS = 60000L"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }
}
