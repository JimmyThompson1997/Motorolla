package com.pucky.device.location;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.HandlerThread;
import android.os.SystemClock;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.Tasks;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.service.PuckyForegroundService;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

public final class LocationTrackerController {
    public static final long DEFAULT_INTERVAL_MS = 30000L;
    private static final long MIN_INTERVAL_MS = 1000L;
    private static final long MAX_INTERVAL_MS = 600000L;
    private static final int DEFAULT_QUERY_LIMIT = 500;
    private static final int MAX_QUERY_LIMIT = 5000;

    private static LocationTrackerController shared;

    private final Context context;
    private final Object lock = new Object();
    private HandlerThread thread;
    private FusedLocationProviderClient fusedClient;
    private LocationCallback callback;
    private boolean running;
    private String trackId = "";
    private long startedAtMs;
    private long intervalMs = DEFAULT_INTERVAL_MS;
    private int sampleCount;
    private JSONObject lastPoint;

    private LocationTrackerController(Context context) {
        this.context = context.getApplicationContext();
    }

    public static synchronized LocationTrackerController shared(Context context) {
        if (shared == null) {
            shared = new LocationTrackerController(context);
        }
        return shared;
    }

    public JSONObject start(JSONObject args) throws CommandException {
        requireLocationPermission();
        JSONObject safeArgs = args == null ? new JSONObject() : args;
        synchronized (lock) {
            if (running) {
                JSONObject out = statusLocked();
                Json.put(out, "start_status", "already_running");
                return out;
            }
            if (safeArgs.optBoolean("clear_existing", false)) {
                deleteStore();
            }
            try {
                PuckyForegroundService.start(context, false);
            } catch (Exception ignored) {
                // Foreground UI tracking can still work if the service is already alive or start is denied.
            }
            intervalMs = boundedLong(safeArgs.optLong("interval_ms", DEFAULT_INTERVAL_MS),
                    MIN_INTERVAL_MS, MAX_INTERVAL_MS);
            trackId = safeArgs.optString("track_id", "").trim();
            if (trackId.isEmpty()) {
                trackId = "track_" + UUID.randomUUID();
            }
            startedAtMs = System.currentTimeMillis();
            sampleCount = 0;
            lastPoint = null;
            thread = new HandlerThread("pucky-location-tracker");
            thread.start();
            fusedClient = LocationServices.getFusedLocationProviderClient(context);
            callback = new LocationCallback() {
                @Override
                public void onLocationResult(LocationResult result) {
                    if (result == null) {
                        return;
                    }
                    for (Location location : result.getLocations()) {
                        appendPoint(location);
                    }
                }
            };
            LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
                    .setMinUpdateIntervalMillis(Math.min(intervalMs, 5000L))
                    .setMaxUpdateDelayMillis(Math.max(intervalMs, intervalMs * 2L))
                    .build();
            try {
                Tasks.await(fusedClient.requestLocationUpdates(request, callback, thread.getLooper()),
                        2500L, TimeUnit.MILLISECONDS);
            } catch (SecurityException exc) {
                cleanupLocked();
                throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, exc.getMessage());
            } catch (Exception exc) {
                cleanupLocked();
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "Location tracker failed to start: " + exc.getMessage());
            }
            running = true;
            JSONObject out = statusLocked();
            Json.put(out, "start_status", "started");
            return out;
        }
    }

    public JSONObject stop(JSONObject args) {
        synchronized (lock) {
            boolean wasRunning = running;
            cleanupLocked();
            JSONObject out = statusLocked();
            Json.put(out, "stop_status", wasRunning ? "stopped" : "already_stopped");
            return out;
        }
    }

    public JSONObject status() {
        synchronized (lock) {
            return statusLocked();
        }
    }

    public JSONObject query(JSONObject args) throws CommandException {
        JSONObject safeArgs = args == null ? new JSONObject() : args;
        long now = System.currentTimeMillis();
        long sinceMs = safeArgs.optLong("since_ms", Long.MIN_VALUE);
        long untilMs = safeArgs.optLong("until_ms", Long.MAX_VALUE);
        if (safeArgs.optBoolean("today", false)) {
            sinceMs = LocalDate.now(ZoneId.systemDefault())
                    .atStartOfDay(ZoneId.systemDefault())
                    .toInstant()
                    .toEpochMilli();
            untilMs = now;
        }
        int limit = Math.max(1, Math.min(MAX_QUERY_LIMIT, safeArgs.optInt("limit", DEFAULT_QUERY_LIMIT)));
        JSONArray points = new JSONArray();
        File store = storeFile();
        if (store.exists()) {
            try (BufferedReader reader = new BufferedReader(new FileReader(store))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.trim().isEmpty()) {
                        continue;
                    }
                    JSONObject point = new JSONObject(line);
                    long capturedAtMs = point.optLong("captured_at_ms", 0L);
                    if (capturedAtMs < sinceMs || capturedAtMs > untilMs) {
                        continue;
                    }
                    Json.add(points, point);
                    if (points.length() > limit) {
                        points.remove(0);
                    }
                }
            } catch (Exception exc) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "Location tracker query failed: " + exc.getMessage());
            }
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.location_tracker_query.v1");
        Json.put(out, "running", running);
        Json.put(out, "track_id", trackId);
        Json.put(out, "since_ms", sinceMs == Long.MIN_VALUE ? JSONObject.NULL : sinceMs);
        Json.put(out, "until_ms", untilMs == Long.MAX_VALUE ? JSONObject.NULL : untilMs);
        Json.put(out, "limit", limit);
        Json.put(out, "count", points.length());
        Json.put(out, "points", points);
        return out;
    }

    public JSONObject clear(JSONObject args) {
        synchronized (lock) {
            cleanupLocked();
            boolean deleted = deleteStore();
            trackId = "";
            sampleCount = 0;
            lastPoint = null;
            JSONObject out = statusLocked();
            Json.put(out, "cleared", deleted);
            return out;
        }
    }

    public JSONObject export(JSONObject args) {
        File store = storeFile();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.location_tracker_export.v1");
        Json.put(out, "path", store.getAbsolutePath());
        Json.put(out, "exists", store.exists());
        Json.put(out, "bytes", store.exists() ? store.length() : 0L);
        Json.put(out, "kind", "location_tracker_jsonl");
        Json.put(out, "mime_type", "application/x-ndjson");
        return out;
    }

    private void appendPoint(Location location) {
        if (location == null) {
            return;
        }
        JSONObject point = pointJson(location);
        synchronized (lock) {
            File store = storeFile();
            File parent = store.getParentFile();
            if (parent != null) {
                parent.mkdirs();
            }
            try (FileWriter writer = new FileWriter(store, true)) {
                writer.write(point.toString());
                writer.write("\n");
                sampleCount += 1;
                lastPoint = point;
            } catch (Exception ignored) {
                // Status still reports the last successfully written point.
            }
        }
    }

    private JSONObject pointJson(Location location) {
        long capturedAtMs = System.currentTimeMillis();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.location_point.v1");
        Json.put(out, "point_id", "pt_" + UUID.randomUUID());
        Json.put(out, "track_id", trackId);
        Json.put(out, "captured_at", Instant.ofEpochMilli(capturedAtMs).toString());
        Json.put(out, "captured_at_ms", capturedAtMs);
        Json.put(out, "provider", location.getProvider());
        Json.put(out, "lat", location.getLatitude());
        Json.put(out, "lon", location.getLongitude());
        Json.put(out, "accuracy_m", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
        Json.put(out, "altitude_m", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
        Json.put(out, "speed_mps", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
        Json.put(out, "bearing_deg", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
        Json.put(out, "source", "pucky_map_30s_tracker");
        Json.put(out, "sample_timestamp_ms", location.getTime());
        Json.put(out, "sample_age_ms", ageMs(location, capturedAtMs));
        return out;
    }

    private JSONObject statusLocked() {
        File store = storeFile();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.location_tracker_status.v1");
        Json.put(out, "running", running);
        Json.put(out, "track_id", trackId);
        Json.put(out, "interval_ms", intervalMs);
        Json.put(out, "started_at", startedAtMs > 0 ? Instant.ofEpochMilli(startedAtMs).toString() : JSONObject.NULL);
        Json.put(out, "started_at_ms", startedAtMs > 0 ? startedAtMs : JSONObject.NULL);
        Json.put(out, "sample_count", sampleCount);
        Json.put(out, "last_point", lastPoint == null ? JSONObject.NULL : lastPoint);
        Json.put(out, "store_path", store.getAbsolutePath());
        Json.put(out, "bytes", store.exists() ? store.length() : 0L);
        Json.put(out, "default_interval_ms", DEFAULT_INTERVAL_MS);
        return out;
    }

    private void cleanupLocked() {
        if (fusedClient != null && callback != null) {
            try {
                fusedClient.removeLocationUpdates(callback);
            } catch (Exception ignored) {
            }
        }
        if (thread != null) {
            try {
                thread.quitSafely();
            } catch (Exception ignored) {
            }
        }
        fusedClient = null;
        callback = null;
        thread = null;
        running = false;
    }

    private void requireLocationPermission() throws CommandException {
        boolean fine = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!fine && !coarse) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING,
                    "ACCESS_FINE_LOCATION or ACCESS_COARSE_LOCATION is not granted");
        }
    }

    private File storeFile() {
        return new File(new File(context.getFilesDir(), "location-tracker"), "points.jsonl");
    }

    private boolean deleteStore() {
        File store = storeFile();
        return !store.exists() || store.delete();
    }

    private static long ageMs(Location location, long nowMs) {
        if (location == null || location.getTime() <= 0L) {
            return Long.MAX_VALUE;
        }
        long wallAge = Math.max(0L, nowMs - location.getTime());
        if (location.getElapsedRealtimeNanos() > 0L) {
            long elapsedAge = Math.max(0L,
                    (SystemClock.elapsedRealtimeNanos() - location.getElapsedRealtimeNanos()) / 1_000_000L);
            return Math.min(wallAge, elapsedAge);
        }
        return wallAge;
    }

    private static long boundedLong(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }
}
