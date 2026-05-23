package com.pucky.device.screenshot;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class ScreenshotControllerSourceTest {
    @Test
    public void screenshotUsesAccessibilityAndPublishesImage() throws Exception {
        String controller = read("src/main/java/com/pucky/device/screenshot/ScreenshotController.java");
        String service = read("src/main/java/com/pucky/device/accessibility/PuckyAccessibilityService.java");
        String xml = read("src/main/res/xml/pucky_accessibility_service.xml");

        assertTrue(controller.contains("DisplayManager"));
        assertTrue(controller.contains("display.getState() == Display.STATE_ON"));
        assertTrue(controller.contains("CommandErrorCodes.NO_DISPLAY_ON"));
        assertTrue(controller.contains("service.takeScreenshot(display.displayId"));
        assertTrue(controller.contains("\"selected_display_id\""));
        assertTrue(controller.contains("Bitmap.wrapHardwareBuffer"));
        assertTrue(controller.contains("PUBLIC_SCREENSHOT_RELATIVE_DIR = Environment.DIRECTORY_DCIM + \"/Pucky\""));
        assertTrue(controller.contains("MediaStore.Images.Media.EXTERNAL_CONTENT_URI"));
        assertTrue(controller.contains("visible_in_gallery"));
        assertTrue(controller.contains("ERROR_TAKE_SCREENSHOT_SECURE_WINDOW"));
        assertTrue(service.contains("public static PuckyAccessibilityService activeService()"));
        assertTrue(xml.contains("android:canTakeScreenshot=\"true\""));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }
}
