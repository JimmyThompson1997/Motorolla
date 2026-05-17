package com.pucky.device.sensors;

import com.pucky.device.util.Json;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class SensorController {
    private final Context context;

    public SensorController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject list() {
        SensorManager manager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        JSONObject out = new JSONObject();
        JSONArray sensors = new JSONArray();
        boolean hasProximity = false;
        if (manager != null) {
            List<Sensor> all = manager.getSensorList(Sensor.TYPE_ALL);
            for (Sensor sensor : all) {
                JSONObject item = new JSONObject();
                Json.put(item, "name", sensor.getName());
                Json.put(item, "type", sensor.getType());
                Json.put(item, "string_type", sensor.getStringType());
                Json.put(item, "vendor", sensor.getVendor());
                Json.put(item, "version", sensor.getVersion());
                Json.put(item, "power_ma", sensor.getPower());
                Json.put(item, "max_range", sensor.getMaximumRange());
                Json.put(item, "resolution", sensor.getResolution());
                Json.add(sensors, item);
                if (sensor.getType() == Sensor.TYPE_PROXIMITY) {
                    hasProximity = true;
                }
            }
        }
        Json.put(out, "available", manager != null);
        Json.put(out, "count", sensors.length());
        Json.put(out, "has_proximity", hasProximity);
        Json.put(out, "sensors", sensors);
        return out;
    }

    public JSONObject sample(JSONObject args) throws CommandException {
        SensorManager manager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "SensorManager unavailable");
        }
        Sensor sensor = findSensor(manager, args);
        if (sensor == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Requested sensor unavailable");
        }

        int maxEvents = Math.max(1, Math.min(100, args.optInt("max_events", 10)));
        long timeoutMs = Math.max(100, Math.min(15000, args.optLong("timeout_ms", 2000)));
        int rateUs = Math.max(0, args.optInt("rate_us", SensorManager.SENSOR_DELAY_NORMAL));

        HandlerThread thread = new HandlerThread("PuckySensorSample");
        thread.start();
        Handler handler = new Handler(thread.getLooper());
        CountDownLatch done = new CountDownLatch(1);
        JSONArray events = new JSONArray();
        Object eventLock = new Object();

        SensorEventListener listener = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent event) {
                synchronized (eventLock) {
                    if (events.length() >= maxEvents) {
                        return;
                    }
                    JSONObject item = new JSONObject();
                    JSONArray values = new JSONArray();
                    for (float value : event.values) {
                        Json.add(values, value);
                    }
                    Json.put(item, "timestamp_ns", event.timestamp);
                    Json.put(item, "accuracy", event.accuracy);
                    Json.put(item, "values", values);
                    Json.add(events, item);
                    if (events.length() >= maxEvents) {
                        done.countDown();
                    }
                }
            }

            @Override
            public void onAccuracyChanged(Sensor sensor, int accuracy) {
            }
        };

        boolean registered = manager.registerListener(listener, sensor, rateUs, handler);
        if (!registered) {
            thread.quitSafely();
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Sensor listener registration failed");
        }

        try {
            done.await(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Sensor sampling interrupted");
        } finally {
            manager.unregisterListener(listener);
            thread.quitSafely();
        }

        JSONObject out = new JSONObject();
        Json.put(out, "sensor", describe(sensor));
        Json.put(out, "events", events);
        Json.put(out, "event_count", events.length());
        Json.put(out, "timeout_ms", timeoutMs);
        return out;
    }

    public JSONObject watch(JSONObject args) throws CommandException {
        SensorManager manager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "SensorManager unavailable");
        }

        List<Sensor> sensors = findSensors(manager, args);
        if (sensors.isEmpty()) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No requested sensors available");
        }

        long durationMs = Math.max(1000, Math.min(90000, args.optLong("duration_ms", 10000)));
        int maxTotalEvents = Math.max(1, Math.min(5000, args.optInt("max_total_events", 1000)));
        int maxEventsPerSensor = Math.max(1, Math.min(1000, args.optInt("max_events_per_sensor", 200)));
        int rateUs = Math.max(0, args.optInt("rate_us", SensorManager.SENSOR_DELAY_NORMAL));
        boolean includeStaleInitial = args.optBoolean("include_stale_initial", false);
        long staleGraceNs = Math.max(0, Math.min(5000, args.optLong("stale_grace_ms", 250))) * 1000000L;

        HandlerThread thread = new HandlerThread("PuckySensorWatch");
        thread.start();
        Handler handler = new Handler(thread.getLooper());
        CountDownLatch done = new CountDownLatch(1);
        JSONArray events = new JSONArray();
        int[] perSensorCounts = new int[sensors.size()];
        int[] staleInitialCounts = new int[sensors.size()];
        Object eventLock = new Object();
        long startedNs = SystemClock.elapsedRealtimeNanos();

        List<SensorEventListener> listeners = new ArrayList<>();
        JSONArray registered = new JSONArray();
        for (int index = 0; index < sensors.size(); index++) {
            final int sensorIndex = index;
            final Sensor watchedSensor = sensors.get(index);
            SensorEventListener listener = new SensorEventListener() {
                @Override
                public void onSensorChanged(SensorEvent event) {
                    synchronized (eventLock) {
                        if (!includeStaleInitial && event.timestamp < startedNs - staleGraceNs) {
                            staleInitialCounts[sensorIndex]++;
                            return;
                        }
                        if (events.length() >= maxTotalEvents || perSensorCounts[sensorIndex] >= maxEventsPerSensor) {
                            return;
                        }
                        perSensorCounts[sensorIndex]++;
                        JSONObject item = new JSONObject();
                        JSONArray values = new JSONArray();
                        for (float value : event.values) {
                            Json.add(values, value);
                        }
                        Json.put(item, "sensor_index", sensorIndex);
                        Json.put(item, "sensor_name", watchedSensor.getName());
                        Json.put(item, "string_type", watchedSensor.getStringType());
                        Json.put(item, "type", watchedSensor.getType());
                        Json.put(item, "timestamp_ns", event.timestamp);
                        Json.put(item, "relative_ms", Math.round((event.timestamp - startedNs) / 1000000.0));
                        Json.put(item, "accuracy", event.accuracy);
                        Json.put(item, "values", values);
                        Json.add(events, item);
                        if (events.length() >= maxTotalEvents) {
                            done.countDown();
                        }
                    }
                }

                @Override
                public void onAccuracyChanged(Sensor sensor, int accuracy) {
                }
            };
            boolean ok = manager.registerListener(listener, watchedSensor, rateUs, handler);
            if (ok) {
                listeners.add(listener);
                JSONObject item = describe(watchedSensor);
                Json.put(item, "sensor_index", sensorIndex);
                Json.add(registered, item);
            }
        }

        if (listeners.isEmpty()) {
            thread.quitSafely();
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No sensor listeners registered");
        }

        try {
            done.await(durationMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Sensor watch interrupted");
        } finally {
            for (SensorEventListener listener : listeners) {
                manager.unregisterListener(listener);
            }
            thread.quitSafely();
        }

        JSONObject counts = new JSONObject();
        JSONObject staleCounts = new JSONObject();
        for (int index = 0; index < sensors.size(); index++) {
            Json.put(counts, sensors.get(index).getName(), perSensorCounts[index]);
            Json.put(staleCounts, sensors.get(index).getName(), staleInitialCounts[index]);
        }

        JSONObject out = new JSONObject();
        Json.put(out, "registered_sensors", registered);
        Json.put(out, "duration_ms", durationMs);
        Json.put(out, "include_stale_initial", includeStaleInitial);
        Json.put(out, "stale_grace_ms", staleGraceNs / 1000000L);
        Json.put(out, "event_count", events.length());
        Json.put(out, "events", events);
        Json.put(out, "counts_by_sensor", counts);
        Json.put(out, "stale_initial_counts_by_sensor", staleCounts);
        Json.put(out, "truncated", events.length() >= maxTotalEvents);
        return out;
    }

    private Sensor findSensor(SensorManager manager, JSONObject args) {
        String name = args.optString("name", "");
        if (!name.trim().isEmpty()) {
            List<Sensor> all = manager.getSensorList(Sensor.TYPE_ALL);
            for (Sensor sensor : all) {
                if (name.equals(sensor.getName())) {
                    return sensor;
                }
            }
            return null;
        }
        if (args.has("type")) {
            return manager.getDefaultSensor(args.optInt("type"));
        }
        String stringType = args.optString("string_type", "");
        if (!stringType.trim().isEmpty()) {
            List<Sensor> all = manager.getSensorList(Sensor.TYPE_ALL);
            for (Sensor sensor : all) {
                if (stringType.equals(sensor.getStringType())) {
                    return sensor;
                }
            }
            return null;
        }
        Sensor proximity = manager.getDefaultSensor(Sensor.TYPE_PROXIMITY);
        if (proximity != null) {
            return proximity;
        }
        return manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
    }

    private List<Sensor> findSensors(SensorManager manager, JSONObject args) {
        List<Sensor> out = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();

        JSONArray names = args.optJSONArray("names");
        if (names != null) {
            for (int i = 0; i < names.length(); i++) {
                addSensorByName(manager, out, seen, names.optString(i, ""));
            }
        }

        JSONArray stringTypes = args.optJSONArray("string_types");
        if (stringTypes != null) {
            List<Sensor> all = manager.getSensorList(Sensor.TYPE_ALL);
            for (int i = 0; i < stringTypes.length(); i++) {
                String stringType = stringTypes.optString(i, "");
                if (stringType.trim().isEmpty()) {
                    continue;
                }
                for (Sensor sensor : all) {
                    if (stringType.equals(sensor.getStringType())) {
                        addSensor(out, seen, sensor);
                    }
                }
            }
        }

        JSONArray sensorRequests = args.optJSONArray("sensors");
        if (sensorRequests != null) {
            for (int i = 0; i < sensorRequests.length(); i++) {
                Object request = sensorRequests.opt(i);
                if (request instanceof JSONObject) {
                    Sensor sensor = findSensor(manager, (JSONObject) request);
                    if (sensor != null) {
                        addSensor(out, seen, sensor);
                    }
                } else {
                    addSensorByName(manager, out, seen, String.valueOf(request));
                }
            }
        }

        if (out.isEmpty()) {
            Sensor sensor = findSensor(manager, args);
            if (sensor != null) {
                addSensor(out, seen, sensor);
            }
        }
        return out;
    }

    private void addSensorByName(SensorManager manager, List<Sensor> out, Set<String> seen, String name) {
        if (name == null || name.trim().isEmpty()) {
            return;
        }
        List<Sensor> all = manager.getSensorList(Sensor.TYPE_ALL);
        for (Sensor sensor : all) {
            if (name.equals(sensor.getName())) {
                addSensor(out, seen, sensor);
                return;
            }
        }
    }

    private void addSensor(List<Sensor> out, Set<String> seen, Sensor sensor) {
        String key = sensor.getName() + "\n" + sensor.getStringType() + "\n" + sensor.getType();
        if (seen.add(key)) {
            out.add(sensor);
        }
    }

    private JSONObject describe(Sensor sensor) {
        JSONObject item = new JSONObject();
        Json.put(item, "name", sensor.getName());
        Json.put(item, "type", sensor.getType());
        Json.put(item, "string_type", sensor.getStringType());
        Json.put(item, "vendor", sensor.getVendor());
        Json.put(item, "version", sensor.getVersion());
        Json.put(item, "power_ma", sensor.getPower());
        Json.put(item, "max_range", sensor.getMaximumRange());
        Json.put(item, "resolution", sensor.getResolution());
        return item;
    }
}

