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

    @Test
    public void locationTrackerExposesThirtySecondLocalTrailCommands() throws Exception {
        String tracker = read("src/main/java/com/pucky/device/location/LocationTrackerController.java");
        String controller = read("src/main/java/com/pucky/device/location/LocationController.java");
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String capability = read("src/main/java/com/pucky/device/capabilities/CapabilityReporter.java");

        assertTrue(tracker.contains("DEFAULT_INTERVAL_MS = 30000L"));
        assertTrue(tracker.contains("pucky.location_tracker_status.v1"));
        assertTrue(tracker.contains("pucky.location_tracker_query.v1"));
        assertTrue(tracker.contains("pucky.location_point.v1"));
        assertTrue(tracker.contains("requestLocationUpdates"));
        assertTrue(tracker.contains("location-tracker"));
        assertTrue(tracker.contains("points.jsonl"));
        assertTrue(tracker.contains("pucky_map_30s_tracker"));
        assertTrue(tracker.contains("PuckyForegroundService.start"));
        assertTrue(controller.contains("trackerStart(JSONObject args)"));
        assertTrue(controller.contains("trackerQuery(JSONObject args)"));
        assertTrue(executor.contains("\"location.tracker.status\""));
        assertTrue(executor.contains("\"location.tracker.start\""));
        assertTrue(executor.contains("\"location.tracker.stop\""));
        assertTrue(executor.contains("\"location.tracker.query\""));
        assertTrue(executor.contains("\"location.tracker.clear\""));
        assertTrue(executor.contains("\"location.tracker.export\""));
        assertTrue(capability.contains("Pucky Map 30-second local location trail"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }
}
