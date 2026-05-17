package com.pucky.device.sensors;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Log;

import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.util.List;

public final class CoverGestureController {
    public interface Callback {
        boolean isCoverDisplayAvailable();

        void onCoverGestureSleep(long durationMs);

        void onCoverGestureWake(long durationMs);
    }

    private static final String TAG = "PuckyCoverGesture";
    private static final String PREFS = "pucky_cover_gesture";
    private static final String PREF_ENABLED = "enabled";
    private static final String PREF_SLEEPING = "sleeping";
    private static final String PREF_LAST_ACTION = "last_action";
    private static final String PREF_LAST_DETAIL = "last_detail";

    private static final long WARMUP_MS = 2_000L;
    private static final long GESTURE_MIN_MS = 50L;
    private static final long GESTURE_MAX_MS = 400L;
    private static final long ACTION_COOLDOWN_MS = 1_600L;
    private static final long ACCEL_FRESH_MS = 2_500L;
    private static final long STILL_SETTLE_MS = 900L;
    private static final float MOTION_STEP_THRESHOLD = 0.85f;
    private static final float FLAT_XY_MAX = 2.5f;
    private static final float COVER_UP_Z_MAX = -8.5f;

    private final Context context;
    private final Callback callback;
    private final SharedPreferences prefs;

    private SensorManager sensorManager;
    private HandlerThread thread;
    private Handler handler;
    private boolean running;
    private long startedAtMs;
    private long lastActionAtMs;
    private long gestureStartedAtMs = -1L;
    private String lastGate = "not_started";

    private boolean aoaNear;
    private boolean approachNear;
    private boolean lastNear;
    private boolean folded;
    private long lastFlipAtMs;
    private boolean flatCoverUp;
    private long lastAccelAtMs;
    private long lastMotionAtMs;
    private boolean hasLastAccel;
    private float lastAccelX;
    private float lastAccelY;
    private float lastAccelZ;

    private final SensorEventListener listener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            handleSensorChanged(event);
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
        }
    };

    public CoverGestureController(Context context, Callback callback) {
        this.context = context.getApplicationContext();
        this.callback = callback;
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(PREF_ENABLED, false);
    }

    public static boolean isSleeping(Context context) {
        return prefs(context).getBoolean(PREF_SLEEPING, false);
    }

    public static void setEnabledPreference(Context context, boolean enabled) {
        prefs(context).edit().putBoolean(PREF_ENABLED, enabled).commit();
    }

    public static void setSleepingPreference(Context context, boolean sleeping) {
        prefs(context).edit().putBoolean(PREF_SLEEPING, sleeping).commit();
    }

    public static JSONObject readStatus(Context context) {
        SharedPreferences prefs = prefs(context);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.cover_gesture_status.v1");
        Json.put(out, "enabled", prefs.getBoolean(PREF_ENABLED, false));
        Json.put(out, "sleeping", prefs.getBoolean(PREF_SLEEPING, false));
        Json.put(out, "last_action", prefs.getString(PREF_LAST_ACTION, "none"));
        Json.put(out, "last_detail", prefs.getString(PREF_LAST_DETAIL, "none"));
        Json.put(out, "action_min_ms", GESTURE_MIN_MS);
        Json.put(out, "action_max_ms", GESTURE_MAX_MS);
        Json.put(out, "mode", "one clean near/far hand pass toggles sleep/wake");
        Json.put(out, "gate", "cover display present + last Flip Position=2 + raw accel flat/still/cover-up");
        return out;
    }

    public synchronized void startIfEnabled() {
        if (prefs.getBoolean(PREF_ENABLED, false)) {
            start();
        }
    }

    public synchronized void setEnabled(boolean enabled) {
        prefs.edit().putBoolean(PREF_ENABLED, enabled).commit();
        if (enabled) {
            start();
        } else {
            setSleeping(false);
            stop();
            remember("disabled", "cover gesture listener disabled");
        }
    }

    public synchronized boolean isSleeping() {
        return prefs.getBoolean(PREF_SLEEPING, false);
    }

    public synchronized void setSleeping(boolean sleeping) {
        prefs.edit().putBoolean(PREF_SLEEPING, sleeping).commit();
    }

    public synchronized void stop() {
        if (!running) {
            return;
        }
        try {
            if (sensorManager != null) {
                sensorManager.unregisterListener(listener);
            }
        } catch (RuntimeException ignored) {
            // SensorManager may already have dropped listeners during process teardown.
        }
        if (thread != null) {
            thread.quitSafely();
        }
        thread = null;
        handler = null;
        running = false;
        lastGate = "stopped";
        resetGestureState();
        Log.i(TAG, "stopped");
    }

    private synchronized void start() {
        if (running) {
            return;
        }
        sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager == null) {
            remember("unavailable", "SensorManager unavailable");
            return;
        }

        Sensor aoa = findSensorByName("stk3bfx_aoa");
        Sensor approach = findSensorByName("mot_flip_approach");
        Sensor accel = findSensorByName("lsm6dso_acc-CAM_ALIGNED");
        if (accel == null) {
            accel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        }
        Sensor flip = findSensorByName("Flip Position");

        if (aoa == null && approach == null) {
            remember("unavailable", "No approach sensors found");
            return;
        }
        if (accel == null) {
            remember("unavailable", "No accelerometer found");
            return;
        }

        thread = new HandlerThread("PuckyCoverGesture");
        thread.start();
        handler = new Handler(thread.getLooper());
        startedAtMs = SystemClock.elapsedRealtime();
        lastMotionAtMs = startedAtMs;
        resetGestureState();

        int registered = 0;
        registered += register(aoa) ? 1 : 0;
        registered += register(approach) ? 1 : 0;
        registered += register(accel) ? 1 : 0;
        registered += register(flip) ? 1 : 0;
        running = true;
        if (registered == 0) {
            stop();
            remember("unavailable", "No sensor listeners registered");
            return;
        }
        lastGate = "warming_up";
        remember("enabled", "registered_sensors=" + registered);
        Log.i(TAG, "started registered_sensors=" + registered
                + " aoa=" + sensorName(aoa)
                + " approach=" + sensorName(approach)
                + " accel=" + sensorName(accel)
                + " flip=" + sensorName(flip));
    }

    private boolean register(Sensor sensor) {
        return sensor != null
                && sensorManager.registerListener(
                        listener,
                        sensor,
                        SensorManager.SENSOR_DELAY_NORMAL,
                        handler);
    }

    private void handleSensorChanged(SensorEvent event) {
        long now = SystemClock.elapsedRealtime();
        String name = event.sensor.getName();
        if ("stk3bfx_aoa".equals(name)) {
            aoaNear = event.values.length > 0 && event.values[0] == 0f;
            updateNearState(now);
            return;
        }
        if ("mot_flip_approach".equals(name)) {
            approachNear = event.values.length > 0 && event.values[0] == 1f;
            updateNearState(now);
            return;
        }
        if ("Flip Position".equals(name)) {
            folded = event.values.length > 0 && Math.round(event.values[0]) == 2;
            lastFlipAtMs = now;
            return;
        }
        updateAccel(event, now);
    }

    private void updateAccel(SensorEvent event, long now) {
        if (event.values.length < 3) {
            return;
        }
        float x = event.values[0];
        float y = event.values[1];
        float z = event.values[2];
        if (hasLastAccel) {
            float dx = x - lastAccelX;
            float dy = y - lastAccelY;
            float dz = z - lastAccelZ;
            float step = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (step > MOTION_STEP_THRESHOLD) {
                lastMotionAtMs = now;
            }
        }
        hasLastAccel = true;
        lastAccelX = x;
        lastAccelY = y;
        lastAccelZ = z;
        lastAccelAtMs = now;
        flatCoverUp = z <= COVER_UP_Z_MAX
                && Math.sqrt(x * x + y * y) <= FLAT_XY_MAX;
    }

    private void updateNearState(long now) {
        boolean near = aoaNear || approachNear;
        if (near == lastNear) {
            return;
        }
        lastNear = near;
        if (near) {
            if (isGateOpen(now)) {
                gestureStartedAtMs = now;
            } else {
                gestureStartedAtMs = -1L;
            }
        } else {
            finishGesture(now);
        }
    }

    private void finishGesture(long now) {
        if (gestureStartedAtMs < 0L) {
            return;
        }
        long durationMs = now - gestureStartedAtMs;
        gestureStartedAtMs = -1L;
        if (durationMs < GESTURE_MIN_MS || durationMs > GESTURE_MAX_MS) {
            remember("ignored", "duration_ms=" + durationMs + " outside gesture window");
            return;
        }
        if (!isGateOpen(now)) {
            remember("ignored", "gate_closed=" + lastGate + " duration_ms=" + durationMs);
            return;
        }
        if (now - lastActionAtMs < ACTION_COOLDOWN_MS) {
            remember("ignored", "cooldown duration_ms=" + durationMs);
            return;
        }
        if (isSleeping()) {
            lastActionAtMs = now;
            setSleeping(false);
            remember("wake", "duration_ms=" + durationMs);
            callback.onCoverGestureWake(durationMs);
            return;
        }
        lastActionAtMs = now;
        setSleeping(true);
        remember("sleep", "duration_ms=" + durationMs);
        callback.onCoverGestureSleep(durationMs);
    }

    private boolean isGateOpen(long now) {
        if (now - startedAtMs < WARMUP_MS) {
            lastGate = "warming_up";
            return false;
        }
        if (!callback.isCoverDisplayAvailable()) {
            lastGate = "no_cover_display";
            return false;
        }
        if (!folded || lastFlipAtMs <= 0L) {
            lastGate = "not_folded";
            return false;
        }
        if (!flatCoverUp || now - lastAccelAtMs > ACCEL_FRESH_MS) {
            lastGate = "not_flat_cover_up";
            return false;
        }
        if (now - lastMotionAtMs < STILL_SETTLE_MS) {
            lastGate = "moving";
            return false;
        }
        lastGate = "open";
        return true;
    }

    private void resetGestureState() {
        aoaNear = false;
        approachNear = false;
        lastNear = false;
        folded = false;
        flatCoverUp = false;
        hasLastAccel = false;
        lastFlipAtMs = 0L;
        lastAccelAtMs = 0L;
        gestureStartedAtMs = -1L;
    }

    private Sensor findSensorByName(String name) {
        if (sensorManager == null) {
            return null;
        }
        List<Sensor> sensors = sensorManager.getSensorList(Sensor.TYPE_ALL);
        for (Sensor sensor : sensors) {
            if (name.equals(sensor.getName())) {
                return sensor;
            }
        }
        return null;
    }

    private void remember(String action, String detail) {
        prefs.edit()
                .putString(PREF_LAST_ACTION, action)
                .putString(PREF_LAST_DETAIL, detail)
                .commit();
        Log.i(TAG, action + " " + detail);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static String sensorName(Sensor sensor) {
        return sensor == null ? "none" : sensor.getName();
    }
}
