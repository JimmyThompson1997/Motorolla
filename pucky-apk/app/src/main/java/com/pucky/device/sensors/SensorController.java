package com.pucky.device.sensors;

import com.pucky.device.util.Json;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.HandlerThread;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;
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

    private Sensor findSensor(SensorManager manager, JSONObject args) {
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

