package com.pucky.device.location;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.HandlerThread;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

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
    private final Context context;

    public LocationController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject get(JSONObject args) throws CommandException {
        requireLocationPermission();
        LocationManager manager = manager();
        String provider = chooseProvider(manager, args.optString("provider", ""));
        Location last = bestLastKnown(manager, provider);
        boolean fresh = args.optBoolean("fresh", true);
        long timeoutMs = boundedLong(args.optLong("timeout_ms", 8000), 500, 30000);
        Location current = fresh ? awaitSingleLocation(manager, provider, timeoutMs) : null;
        Location selected = current != null ? current : last;
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.location.v1");
        Json.put(out, "available", selected != null);
        Json.put(out, "provider_requested", provider);
        Json.put(out, "fresh_requested", fresh);
        Json.put(out, "fresh", current != null);
        Json.put(out, "timeout_ms", timeoutMs);
        Json.put(out, "sample", selected == null ? JSONObject.NULL : sampleJson(selected));
        Json.put(out, "reason", selected == null ? "NO_LOCATION_SAMPLE" : JSONObject.NULL);
        return out;
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
            Location last = bestLastKnown(manager, provider);
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

    private Location bestLastKnown(LocationManager manager, String preferred) {
        Location best = null;
        try {
            best = manager.getLastKnownLocation(preferred);
        } catch (SecurityException ignored) {
            return null;
        } catch (Exception ignored) {
        }
        try {
            for (String provider : manager.getProviders(true)) {
                Location candidate = manager.getLastKnownLocation(provider);
                if (candidate == null) {
                    continue;
                }
                if (best == null || candidate.getTime() > best.getTime()) {
                    best = candidate;
                }
            }
        } catch (Exception ignored) {
        }
        return best;
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

    private static long boundedLong(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }

    private static String safeName(String value) {
        String raw = value == null || value.trim().isEmpty() ? "trace" : value.trim();
        return raw.replaceAll("[^A-Za-z0-9._-]", "_");
    }
}
