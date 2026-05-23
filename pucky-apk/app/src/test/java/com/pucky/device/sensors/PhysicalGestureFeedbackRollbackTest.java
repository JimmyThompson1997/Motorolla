package com.pucky.device.sensors;

import static org.junit.Assert.assertFalse;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class PhysicalGestureFeedbackRollbackTest {
    @Test
    public void physicalGestureFeedbackSurfaceIsRemoved() throws Exception {
        assertFalse(Files.exists(Path.of("src/main/java/com/pucky/device/sensors/PhysicalGestureFeedbackController.java")));

        assertAbsent("src/main/java/com/pucky/device/service/PuckyForegroundService.java",
                "PhysicalGestureFeedbackController",
                "physicalGestureFeedbackController");
        assertAbsent("src/main/java/com/pucky/device/command/NativeCommandExecutor.java",
                "physical.gesture.feedback");
        assertAbsent("src/main/java/com/pucky/device/capabilities/CapabilityReporter.java",
                "physical.gesture.feedback",
                "single chop",
                "double back tap",
                "two haptics");
        assertAbsent("src/main/java/com/pucky/device/system/SystemController.java",
                "PhysicalGestureFeedbackController",
                "physicalGestureFeedback");
    }

    private static void assertAbsent(String path, String... needles) throws Exception {
        String source = new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
        for (String needle : needles) {
            assertFalse(path + " should not contain " + needle, source.contains(needle));
        }
    }
}
