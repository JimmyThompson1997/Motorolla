package com.pucky.device.location;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class LocationControllerSourceTest {
    @Test
    public void locationPinUsesFusedRecentOrPendingSemantics() throws Exception {
        String source = read("src/main/java/com/pucky/device/location/LocationController.java");
        String gradle = read("build.gradle");

        assertTrue(gradle.contains("com.google.android.gms:play-services-location:21.3.0"));
        assertTrue(source.contains("FusedLocationProviderClient"));
        assertTrue(source.contains("getCurrentLocation"));
        assertTrue(source.contains("DEFAULT_MAX_CACHE_AGE_MS = 30000L"));
        assertTrue(source.contains("DEFAULT_PIN_TIMEOUT_MS = 60000L"));
        assertTrue(source.contains("\"state\", \"pending\""));
        assertTrue(source.contains("recent_cache"));
        assertTrue(source.contains("current_fix"));
        assertTrue(source.contains("stale_last_known"));
        assertTrue(source.contains("\"sample_age_ms\""));
        assertTrue(source.contains("\"accepted_max_age_ms\""));
        assertTrue(source.contains("startPendingResolution"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }
}
