package com.pucky.device.camera;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class CameraControllerSourceTest {
    @Test
    public void photoCaptureSavesPrivateAndPublishesToGallery() throws Exception {
        String source = read("src/main/java/com/pucky/device/camera/CameraController.java");

        assertTrue(source.contains("writePrivatePhoto(bytes, displayName)"));
        assertTrue(source.contains("publishPhoto(bytes, displayName)"));
        assertTrue(source.contains("PUBLIC_PHOTO_RELATIVE_DIR = Environment.DIRECTORY_DCIM + \"/Pucky\""));
        assertTrue(source.contains("MediaStore.Images.Media.EXTERNAL_CONTENT_URI"));
        assertTrue(source.contains("MediaStore.Images.Media.RELATIVE_PATH"));
        assertTrue(source.contains("MediaStore.Images.Media.IS_PENDING"));
        assertTrue(source.contains("public_saved"));
        assertTrue(source.contains("public_uri"));
        assertTrue(source.contains("public_relative_path"));
        assertTrue(source.contains("app_private_path"));
        assertTrue(source.contains("visible_in_gallery"));
        assertTrue(source.contains("playCaptureChime()"));
        assertTrue(source.contains("pucky.photo_capture_chime.v1"));
        assertTrue(source.contains("pucky-photo-capture-chime"));
        assertTrue(source.contains("capture_chime"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }
}
