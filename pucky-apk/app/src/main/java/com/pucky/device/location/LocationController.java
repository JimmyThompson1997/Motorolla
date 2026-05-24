package com.pucky.device.location;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.HandlerThread;
import android.os.SystemClock;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;
import com.google.android.gms.location.CurrentLocationRequest;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;
import com.google.android.gms.tasks.Tasks;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileWriter;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class LocationController {
    public static final long DEFAULT_MAX_CACHE_AGE_MS = 30000L;
    public static final long DEFAULT_PIN_TIMEOUT_MS = 60000L;

    private final Context context;

    public LocationController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject get(JSONObject args) throws CommandException {
        return resolve(args == null ? new JSONObject() : args, false, null);
    }

    public JSONObject pin(JSONObject args, PendingCallback callback) throws CommandException {
        JSONObject safeArgs = args == null ? new JSONObject() : args;
        return resolve(safeArgs, safeArgs.optBoolean("allow_pending", true), callback);
    }

    private JSONObject resolve(JSONObject args, boolean allowPending, PendingCallback callback) throws CommandException {
        requireLocationPermission();
        LocationManager manager = manager();
        String provider = chooseProvider(manager, args.optString("provider", ""));
        long requestedAtMs = System.currentTimeMillis();
        String requestedAt = Instant.ofEpochMilli(requestedAtMs).toString();
        long maxCacheAgeMs = boundedLong(args.optLong("max_cache_age_ms", DEFAULT_MAX_CACHE_AGE_MS), 0, 300000);
        long timeoutMs = boundedLong(args.optLong("timeout_ms", allowPending
                ? DEFAULT_PIN_TIMEOUT_MS
                : 8000), 500, 60000);
        boolean fresh = args.optBoolean("fresh", true);
        Location last = bestLastKnown(manager, provider, maxCacheAgeMs);
        if (!fresh && last != null) {
            return success(provider, fresh, timeoutMs, maxCacheAgeMs, requestedAt, last, "recent_cache", last);
        }
        if (isRecent(last, maxCacheAgeMs, requestedAtMs)) {
            return success(provider, fresh, timeoutMs, maxCacheAgeMs, requestedAt, last, "recent_cache", last);
        }
        if (allowPending && callback != null) {
            JSONObject pending = pending(provider, fresh, timeoutMs, maxCacheAgeMs, requestedAt, last);
            startPendingResolution(args, provider, timeoutMs, maxCacheAgeMs, requestedAt, last, callback);
            return pending;
        }
        Location current = fresh ? awaitCurrentLocation(manager, provider, timeoutMs, maxCacheAgeMs) : null;
        if (current != null) {
            return success(provider, fresh, timeoutMs, maxCacheAgeMs, requestedAt, current, "current_fix", last);
        }
        return failure(provider, fresh, timeoutMs, maxCacheAgeMs, requestedAt, last, "LOCATION_TIMEOUT",
                last == null
                        ? "No current or recent last-known location sample"
                        : "Last-known location is older than max_cache_age_ms");
    }

    public JSONObject watch(JSONObject args) throws CommandException {
        requireLocationPermission();
        LocationManager manager = manager();
        String provider = chooseProvider(manager, args.optString("provider", ""));
        long durationMs = boundedLong(args.optLong("duration_ms", 15000), 1000, 900000);
        long intervalMs = boundedLong(args.optLong("interval_ms", 5000), 1000, 60000);
        float minDistance = (float) Math.max(0.0, Math.min(10000.0, args.optDouble("min_distance_m", 0.0)));
        int maxSamples = Math.max(1, Math.min(500, args.optInt("max_samples", 100)));
        String traceId = args.optString("trace_id", "trace_" + UUID.randomUUID());
        JSONArray samples = new JSONArray();
        CountDownLatch latch = new CountDownLatch(1);
        HandlerThread thread = new HandlerThread("pucky-location-watch");
        thread.start();
        LocationListener listener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                synchronized (samples) {
                    Json.add(samples, sampleJson(location));
                    if (samples.length() >= maxSamples) {
                        latch.countDown();
                    }
                }
            }

            @Override
            public void onProviderDisabled(String disabledProvider) {
                if (provider.equals(disabledProvider)) {
                    latch.countDown();
                }
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {
                // Deprecated platform callback; retained for older devices.
            }
        };
        try {
            Location last = bestLastKnown(manager, provider, Long.MAX_VALUE);
            if (last != null) {
                Json.add(samples, sampleJson(last));
            }
            manager.requestLocationUpdates(provider, intervalMs, minDistance, listener, thread.getLooper());
            latch.await(durationMs, TimeUnit.MILLISECONDS);
        } catch (SecurityException e) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Interrupted while watching location");
        } finally {
            try {
                manager.removeUpdates(listener);
            } catch (Exception ignored) {
            }
            thread.quitSafely();
        }
        File artifact = writeTrace(traceId, samples, provider);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.location_trace.v1");
        Json.put(out, "trace_id", traceId);
        Json.put(out, "provider", provider);
        Json.put(out, "duration_ms", durationMs);
        Json.put(out, "interval_ms", intervalMs);
        Json.put(out, "min_distance_m", minDistance);
        Json.put(out, "sample_count", samples.length());
        Json.put(out, "samples", samples);
        Json.put(out, "path", artifact.getAbsolutePath());
        Json.put(out, "artifact_id", "art_" + Integer.toHexString(artifact.getAbsolutePath().hashCode()));
        Json.put(out, "kind", "location_trace");
        Json.put(out, "mime_type", "application/json");
        Json.put(out, "bytes", artifact.length());
        return out;
    }

    private void requireLocationPermission() throws CommandException {
        boolean fine = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!fine && !coarse) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING,
                    "ACCESS_FINE_LOCATION or ACCESS_COARSE_LOCATION is not granted");
        }
    }

    private LocationManager manager() throws CommandException {
        LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "LocationManager unavailable");
        }
        return manager;
    }

    private String chooseProvider(LocationManager manager, String requested) throws CommandException {
        if (requested != null && !requested.trim().isEmpty() && manager.isProviderEnabled(requested)) {
            return requested;
        }
        if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            return LocationManager.GPS_PROVIDER;
        }
        if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
            return LocationManager.NETWORK_PROVIDER;
        }
        if (manager.isProviderEnabled(LocationManager.PASSIVE_PROVIDER)) {
            return LocationManager.PASSIVE_PROVIDER;
        }
        List<String> providers = manager.getProviders(true);
        if (providers != null && !providers.isEmpty()) {
            return providers.get(0);
        }
        throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No enabled Android location provider");
    }

    private Location bestLastKnown(LocationManager manager, String preferred, long maxCacheAgeMs) {
        Location best = null;
        Location fused = fusedLastKnown(maxCacheAgeMs);
        if (fused != null) {
            best = fused;
        }
        try {
            Location preferredLast = manager.getLastKnownLocation(preferred);
            if (isNewer(preferredLast, best)) {
                best = preferredLast;
            }
        } catch (SecurityException ignored) {
            return best;
        } catch (Exception ignored) {
        }
        try {
            for (String provider : manager.getProviders(true)) {
                Location candidate = manager.getLastKnownLocation(provider);
                if (candidate == null) {
                    continue;
                }
                if (isNewer(candidate, best)) {
                    best = candidate;
                }
            }
        } catch (Exception ignored) {
        }
        return best;
    }

    private Location fusedLastKnown(long maxCacheAgeMs) {
        try {
            FusedLocationProviderClient client = LocationServices.getFusedLocationProviderClient(context);
            return Tasks.await(client.getLastLocation(), Math.min(1000L, Math.max(250L, maxCacheAgeMs)), TimeUnit.MILLISECONDS);
        } catch (SecurityException ignored) {
            return null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private Location awaitCurrentLocation(
            LocationManager manager, String provider, long timeoutMs, long maxCacheAgeMs) throws CommandException {
        Location fused = awaitFusedCurrentLocation(timeoutMs, maxCacheAgeMs);
        if (fused != null) {
            return fused;
        }
        return awaitSingleLocation(manager, provider, timeoutMs);
    }

    private Location awaitFusedCurrentLocation(long timeoutMs, long maxCacheAgeMs) {
        CancellationTokenSource cancellation = new CancellationTokenSource();
        try {
            CurrentLocationRequest request = new CurrentLocationRequest.Builder()
                    .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                    .setDurationMillis(timeoutMs)
                    .setMaxUpdateAgeMillis(maxCacheAgeMs)
                    .build();
            FusedLocationProviderClient client = LocationServices.getFusedLocationProviderClient(context);
            return Tasks.await(client.getCurrentLocation(request, cancellation.getToken()),
                    timeoutMs + 1000L,
                    TimeUnit.MILLISECONDS);
        } catch (SecurityException ignored) {
            return null;
        } catch (Exception ignored) {
            return null;
        } finally {
            cancellation.cancel();
        }
    }

    private Location awaitSingleLocation(LocationManager manager, String provider, long timeoutMs) throws CommandException {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<Location> location = new AtomicReference<>();
        HandlerThread thread = new HandlerThread("pucky-location-once");
        thread.start();
        LocationListener listener = new LocationListener() {
            @Override
            public void onLocationChanged(Location value) {
                location.set(value);
                latch.countDown();
            }

            @Override
            public void onProviderDisabled(String disabledProvider) {
                if (provider.equals(disabledProvider)) {
                    latch.countDown();
                }
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {
                // Deprecated platform callback; retained for older devices.
            }
        };
        try {
            manager.requestLocationUpdates(provider, 0, 0, listener, thread.getLooper());
            latch.await(timeoutMs, TimeUnit.MILLISECONDS);
            return location.get();
        } catch (SecurityException e) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Interrupted while waiting for location");
        } finally {
            try {
                manager.removeUpdates(listener);
            } catch (Exception ignored) {
            }
            thread.quitSafely();
        }
    }

    private void startPendingResolution(
            JSONObject args,
            String provider,
            long timeoutMs,
            long maxCacheAgeMs,
            String requestedAt,
            Location last,
            PendingCallback callback) {
        new Thread(() -> {
            try {
                Location current = awaitCurrentLocation(manager(), provider, timeoutMs, maxCacheAgeMs);
                JSONObject resolved = current == null
                        ? failure(provider, true, timeoutMs, maxCacheAgeMs, requestedAt, last, "LOCATION_TIMEOUT",
                                last == null
                                        ? "No current or recent last-known location sample"
                                        : "Last-known location is older than max_cache_age_ms")
                        : success(provider, true, timeoutMs, maxCacheAgeMs, requestedAt, current, "current_fix", last);
                callback.onResolved(resolved);
            } catch (CommandException exc) {
                JSONObject out = new JSONObject();
                Json.put(out, "schema", "pucky.location.v1");
                Json.put(out, "available", false);
                Json.put(out, "state", "failed");
                Json.put(out, "pending", false);
                Json.put(out, "freshness", "unavailable");
                Json.put(out, "requested_at", requestedAt);
                Json.put(out, "resolved_at", Instant.now().toString());
                Json.put(out, "provider_requested", provider);
                Json.put(out, "timeout_ms", timeoutMs);
                Json.put(out, "accepted_max_age_ms", maxCacheAgeMs);
                Json.put(out, "reason", exc.code());
                Json.put(out, "error_message", exc.getMessage());
                callback.onResolved(out);
            }
        }, "pucky-location-pin-pending").start();
    }

    private JSONObject success(
            String provider,
            boolean freshRequested,
            long timeoutMs,
            long maxCacheAgeMs,
            String requestedAt,
            Location selected,
            String freshness,
            Location lastKnown) {
        long resolvedAtMs = System.currentTimeMillis();
        long sampleAgeMs = ageMs(selected, resolvedAtMs);
        JSONObject out = baseResult(provider, freshRequested, timeoutMs, maxCacheAgeMs, requestedAt, resolvedAtMs, lastKnown);
        Json.put(out, "available", true);
        Json.put(out, "state", "succeeded");
        Json.put(out, "pending", false);
        Json.put(out, "freshness", freshness);
        Json.put(out, "fresh", "current_fix".equals(freshness));
        Json.put(out, "stale", false);
        Json.put(out, "sample_age_ms", sampleAgeMs);
        Json.put(out, "provider", selected.getProvider());
        Json.put(out, "accuracy_m", selected.hasAccuracy() ? selected.getAccuracy() : JSONObject.NULL);
        Json.put(out, "sample", sampleJson(selected));
        Json.put(out, "reason", JSONObject.NULL);
        return out;
    }

    private JSONObject pending(
            String provider,
            boolean freshRequested,
            long timeoutMs,
            long maxCacheAgeMs,
            String requestedAt,
            Location lastKnown) {
        JSONObject out = baseResult(provider, freshRequested, timeoutMs, maxCacheAgeMs, requestedAt,
                System.currentTimeMillis(), lastKnown);
        Json.put(out, "available", false);
        Json.put(out, "state", "pending");
        Json.put(out, "pending", true);
        Json.put(out, "fresh", false);
        Json.put(out, "stale", lastKnown != null);
        Json.put(out, "freshness", lastKnown == null ? "unavailable" : "stale_last_known");
        Json.put(out, "reason", "PENDING_CURRENT_FIX");
        Json.put(out, "error_message", JSONObject.NULL);
        return out;
    }

    private JSONObject failure(
            String provider,
            boolean freshRequested,
            long timeoutMs,
            long maxCacheAgeMs,
            String requestedAt,
            Location lastKnown,
            String reason,
            String message) {
        JSONObject out = baseResult(provider, freshRequested, timeoutMs, maxCacheAgeMs, requestedAt,
                System.currentTimeMillis(), lastKnown);
        Json.put(out, "available", false);
        Json.put(out, "state", "failed");
        Json.put(out, "pending", false);
        Json.put(out, "fresh", false);
        Json.put(out, "stale", lastKnown != null);
        Json.put(out, "freshness", lastKnown == null ? "unavailable" : "stale_last_known");
        Json.put(out, "reason", reason);
        Json.put(out, "error_message", message);
        return out;
    }

    private JSONObject baseResult(
            String provider,
            boolean freshRequested,
            long timeoutMs,
            long maxCacheAgeMs,
            String requestedAt,
            long resolvedAtMs,
            Location lastKnown) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.location.v1");
        Json.put(out, "provider_requested", provider);
        Json.put(out, "fresh_requested", freshRequested);
        Json.put(out, "timeout_ms", timeoutMs);
        Json.put(out, "accepted_max_age_ms", maxCacheAgeMs);
        Json.put(out, "requested_at", requestedAt);
        Json.put(out, "resolved_at", Instant.ofEpochMilli(resolvedAtMs).toString());
        Json.put(out, "last_known_sample", lastKnown == null ? JSONObject.NULL : sampleJson(lastKnown));
        Json.put(out, "last_known_sample_age_ms", lastKnown == null ? JSONObject.NULL : ageMs(lastKnown, resolvedAtMs));
        return out;
    }

    private File writeTrace(String traceId, JSONArray samples, String provider) throws CommandException {
        File file = new File(context.getFilesDir(), safeName(traceId) + ".location-trace.json");
        JSONObject body = new JSONObject();
        Json.put(body, "schema", "pucky.location_trace_file.v1");
        Json.put(body, "trace_id", traceId);
        Json.put(body, "provider", provider);
        Json.put(body, "created_at", Instant.now().toString());
        Json.put(body, "samples", samples);
        try (FileWriter writer = new FileWriter(file, false)) {
            writer.write(body.toString());
            writer.write("\n");
        } catch (Exception e) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, e.getMessage());
        }
        return file;
    }

    private static JSONObject sampleJson(Location location) {
        JSONObject out = new JSONObject();
        Json.put(out, "provider", location.getProvider());
        Json.put(out, "timestamp_ms", location.getTime());
        Json.put(out, "elapsed_realtime_nanos", location.getElapsedRealtimeNanos());
        Json.put(out, "lat", location.getLatitude());
        Json.put(out, "lon", location.getLongitude());
        Json.put(out, "accuracy_m", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
        Json.put(out, "altitude_m", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
        Json.put(out, "speed_mps", location.hasSpeed() ? location.getSpeed() : JSONObject.NULL);
        Json.put(out, "bearing_deg", location.hasBearing() ? location.getBearing() : JSONObject.NULL);
        return out;
    }

    private static boolean isNewer(Location candidate, Location current) {
        return candidate != null && (current == null || candidate.getTime() > current.getTime());
    }

    private static boolean isRecent(Location location, long maxAgeMs, long nowMs) {
        return location != null && ageMs(location, nowMs) <= maxAgeMs;
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

    private static String safeName(String value) {
        String raw = value == null || value.trim().isEmpty() ? "trace" : value.trim();
        return raw.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    public interface PendingCallback {
        void onResolved(JSONObject result);
    }
}
