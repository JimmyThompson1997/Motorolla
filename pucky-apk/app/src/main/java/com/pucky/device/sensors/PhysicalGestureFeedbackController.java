package com.pucky.device.sensors;

import android.content.Context;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class PhysicalGestureFeedbackController {
    private static final String TAG = "PuckyPhysicalGesture";
    private static final String PREFS = "pucky_physical_gesture_feedback";
    private static final String ENABLED = "enabled";
    private static final String CHOP_ENABLED = "chop_enabled";
    private static final String DOUBLE_TAP_ENABLED = "double_tap_enabled";
    private static final String TAP_ACCEL_DELTA = "tap_accel_delta";
    private static final String TAP_MAX_GYRO = "tap_max_gyro";
    private static final String CHOP_GYRO = "chop_gyro";
    private static final String CHOP_GRAVITY_DELTA = "chop_gravity_delta";
    private static final String COOLDOWN_MS = "cooldown_ms";

    private static final String SENSOR_ACCEL_FLIP = "lsm6dso_acc-CAM_ALIGNED";
    private static final String SENSOR_GYRO_FLIP = "lsm6dso_gyro-CAM_ALIGNED";
    private static final String SENSOR_GRAVITY_FLIP = "gravity_flip-CAM_ALIGNED";
    private static final String SENSOR_HINGE_ANGLE = "Hinge Angle";
    private static final int SENSOR_TYPE_HINGE_ANGLE = 36;

    private static final long TAP_MIN_GAP_MS = 70L;
    private static final long TAP_MAX_GAP_MS = 450L;
    private static final long TAP_DEBOUNCE_MS = 100L;
    private static final long GYRO_TAP_GUARD_MS = 180L;
    private static final long GRAVITY_WINDOW_MS = 900L;
    private static final long START_ARM_DELAY_MS = 1_500L;
    private static final long CHOP_PING_DELAY_MS = 600L;
    private static final float HINGE_CLOSED_MAX_DEGREES = 20f;
    private static final long DOUBLE_TAP_BUZZ_DELAY_MS = 400L;
    private static final long DOUBLE_TAP_BUZZ_PULSE_MS = 500L;
    private static final long DOUBLE_TAP_BUZZ_GAP_MS = 120L;
    private static final int MAX_VIBRATION_AMPLITUDE = 255;
    private static final int SENSOR_RATE_US = 10_000;
    private static final int MAX_RECENT_EVENTS = 80;

    private static volatile PhysicalGestureFeedbackController instance;

    private final Context context;
    private final SharedPreferences prefs;
    private final Object lock = new Object();
    private final ArrayDeque<JSONObject> recentEvents = new ArrayDeque<>();
    private final ArrayDeque<TimedVector> gravitySamples = new ArrayDeque<>();
    private final ArrayDeque<TimedScalar> gyroPeaks = new ArrayDeque<>();
    private final List<Sensor> registeredSensors = new ArrayList<>();

    private SensorManager sensorManager;
    private HandlerThread sensorThread;
    private Handler sensorHandler;
    private SensorEventListener listener;

    private boolean running;
    private long startedAtMs;
    private long lastTapCandidateAtMs;
    private long lastTapPeakAtMs;
    private long cooldownUntilMs;
    private long chopCount;
    private long doubleTapCount;
    private String lastError = "";
    private float[] lastAccel;
    private boolean hingeKnown;
    private long lastHingeAtMs;
    private float lastHingeAngle = Float.NaN;

    private PhysicalGestureFeedbackController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static PhysicalGestureFeedbackController shared(Context context) {
        PhysicalGestureFeedbackController existing = instance;
        if (existing != null) {
            return existing;
        }
        synchronized (PhysicalGestureFeedbackController.class) {
            if (instance == null) {
                instance = new PhysicalGestureFeedbackController(context);
            }
            return instance;
        }
    }

    public JSONObject status() {
        synchronized (lock) {
            long now = SystemClock.elapsedRealtime();
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.physical_gesture_feedback_status.v1");
            Json.put(out, "enabled", enabled());
            Json.put(out, "chop_enabled", chopEnabled());
            Json.put(out, "double_tap_enabled", doubleTapEnabled());
            Json.put(out, "running", running);
            Json.put(out, "started_at_ms", startedAtMs);
            Json.put(out, "armed", running && now - startedAtMs >= START_ARM_DELAY_MS);
            Json.put(out, "tap_accel_delta", tapAccelDelta());
            Json.put(out, "tap_max_gyro", tapMaxGyro());
            Json.put(out, "chop_gyro", chopGyro());
            Json.put(out, "chop_gravity_delta", chopGravityDelta());
            Json.put(out, "cooldown_ms", cooldownMs());
            Json.put(out, "cooldown_remaining_ms", Math.max(0L, cooldownUntilMs - now));
            Json.put(out, "chop_count", chopCount);
            Json.put(out, "double_tap_count", doubleTapCount);
            Json.put(out, "closed_gate_known", closedGateKnownLocked(now));
            Json.put(out, "closed_gate_closed", closedForChopLocked(now));
            Json.put(out, "hinge_angle", hingeKnown ? lastHingeAngle : JSONObject.NULL);
            Json.put(out, "hinge_age_ms", hingeKnown ? now - lastHingeAtMs : JSONObject.NULL);
            Json.put(out, "registered_sensors", registeredSensorsLocked());
            Json.put(out, "recent_events", recentEventsLocked(40));
            Json.put(out, "last_error", lastError.isEmpty() ? JSONObject.NULL : lastError);
            return out;
        }
    }

    public JSONObject configure(JSONObject args) {
        synchronized (lock) {
            SharedPreferences.Editor editor = prefs.edit();
            if (args.has("enabled")) {
                editor.putBoolean(ENABLED, args.optBoolean("enabled", true));
            }
            if (args.has("chop_enabled")) {
                editor.putBoolean(CHOP_ENABLED, args.optBoolean("chop_enabled", true));
            }
            if (args.has("double_tap_enabled")) {
                editor.putBoolean(DOUBLE_TAP_ENABLED, args.optBoolean("double_tap_enabled", true));
            }
            if (args.has("tap_accel_delta")) {
                editor.putFloat(TAP_ACCEL_DELTA, clampFloat((float) args.optDouble("tap_accel_delta", defaultTapAccelDelta()), 4f, 80f));
            }
            if (args.has("tap_max_gyro")) {
                editor.putFloat(TAP_MAX_GYRO, clampFloat((float) args.optDouble("tap_max_gyro", defaultTapMaxGyro()), 1f, 20f));
            }
            if (args.has("chop_gyro")) {
                editor.putFloat(CHOP_GYRO, clampFloat((float) args.optDouble("chop_gyro", defaultChopGyro()), 2f, 30f));
            }
            if (args.has("chop_gravity_delta")) {
                editor.putFloat(CHOP_GRAVITY_DELTA, clampFloat((float) args.optDouble("chop_gravity_delta", defaultChopGravityDelta()), 0f, 20f));
            }
            if (args.has("cooldown_ms")) {
                editor.putLong(COOLDOWN_MS, clampLong(args.optLong("cooldown_ms", defaultCooldownMs()), 250L, 10_000L));
            }
            if (args.optBoolean("clear_events", false)) {
                recentEvents.clear();
                chopCount = 0L;
                doubleTapCount = 0L;
            }
            editor.apply();
        }
        if (enabled()) {
            start();
        } else {
            stop();
        }
        JSONObject out = status();
        Json.put(out, "saved", true);
        return out;
    }

    public JSONObject trigger(JSONObject args) {
        String gesture = args.optString("gesture", "double_back_tap").trim().toLowerCase(Locale.US);
        if ("chop".equals(gesture) || "single_chop".equals(gesture)) {
            playChopPing("manual_trigger");
        } else {
            playDoubleTapBuzz("manual_trigger");
        }
        synchronized (lock) {
            addEventLocked("manual_trigger", gesture, 0f, 0f);
        }
        JSONObject out = status();
        Json.put(out, "triggered", true);
        Json.put(out, "gesture", gesture);
        return out;
    }

    public void startIfEnabled() {
        if (enabled()) {
            start();
        }
    }

    public void start() {
        synchronized (lock) {
            if (!enabled() || running) {
                return;
            }
            sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
            if (sensorManager == null) {
                lastError = "SensorManager unavailable";
                addEventLocked("controller_error", "sensor_manager_unavailable", 0f, 0f);
                return;
            }
            sensorThread = new HandlerThread("PuckyPhysicalGestureFeedback");
            sensorThread.start();
            sensorHandler = new Handler(sensorThread.getLooper());
            listener = new SensorEventListener() {
                @Override
                public void onSensorChanged(SensorEvent event) {
                    handleSensorEvent(event);
                }

                @Override
                public void onAccuracyChanged(Sensor sensor, int accuracy) {
                }
            };
            registeredSensors.clear();
            registerSensorLocked(SENSOR_ACCEL_FLIP, Sensor.TYPE_ACCELEROMETER);
            registerSensorLocked(SENSOR_GYRO_FLIP, Sensor.TYPE_GYROSCOPE);
            registerSensorLocked(SENSOR_GRAVITY_FLIP, Sensor.TYPE_GRAVITY);
            registerSensorLocked(SENSOR_HINGE_ANGLE, SENSOR_TYPE_HINGE_ANGLE);
            if (registeredSensors.isEmpty()) {
                lastError = "No physical gesture sensors registered";
                stopLocked();
                addEventLocked("controller_error", "no_sensors_registered", 0f, 0f);
                return;
            }
            running = true;
            startedAtMs = SystemClock.elapsedRealtime();
            lastError = "";
            addEventLocked("controller_started", "registered_" + registeredSensors.size(), 0f, 0f);
        }
    }

    public void stop() {
        synchronized (lock) {
            stopLocked();
            addEventLocked("controller_stopped", "disabled", 0f, 0f);
        }
    }

    private void handleSensorEvent(SensorEvent event) {
        if (event.sensor == null || event.values == null) {
            return;
        }
        long now = SystemClock.elapsedRealtime();
        int role = sensorRole(event.sensor);
        float[] values = event.values.clone();
        synchronized (lock) {
            if (!running) {
                return;
            }
            if (role == SENSOR_TYPE_HINGE_ANGLE) {
                rememberHingeLocked(now, values);
                return;
            }
            if (now - startedAtMs < START_ARM_DELAY_MS) {
                return;
            }
            if (role == Sensor.TYPE_GRAVITY) {
                rememberGravityLocked(now, values);
                return;
            }
            if (role == Sensor.TYPE_GYROSCOPE) {
                handleGyroLocked(now, values);
                return;
            }
            if (role == Sensor.TYPE_ACCELEROMETER) {
                handleAccelLocked(now, values);
            }
        }
    }

    private void handleGyroLocked(long now, float[] values) {
        float gyro = magnitude(values);
        gyroPeaks.addLast(new TimedScalar(now, gyro));
        pruneGyroLocked(now);
        if (!chopEnabled() || now < cooldownUntilMs || gyro < chopGyro()) {
            return;
        }
        if (!closedForChopLocked(now)) {
            addEventLocked("chop_rejected", "not_closed", gyro, hingeKnown ? lastHingeAngle : -1f);
            return;
        }
        float gravityDelta = gravityDeltaLocked(now);
        if (gravityDelta < chopGravityDelta()) {
            addEventLocked("chop_rejected", "gravity_delta_low", gyro, gravityDelta);
            return;
        }
        chopCount++;
        cooldownUntilMs = now + cooldownMs();
        lastTapCandidateAtMs = 0L;
        lastTapPeakAtMs = 0L;
        addEventLocked("single_chop_detected", "delayed_ping", gyro, gravityDelta);
        playChopPing("single_chop");
    }

    private void handleAccelLocked(long now, float[] values) {
        float accelDelta = accelDeltaLocked(values);
        lastAccel = values;
        if (!doubleTapEnabled() || now < cooldownUntilMs || accelDelta < tapAccelDelta()) {
            return;
        }
        if (now - lastTapPeakAtMs < TAP_DEBOUNCE_MS) {
            return;
        }
        float recentGyro = recentGyroPeakLocked(now, GYRO_TAP_GUARD_MS);
        if (recentGyro > tapMaxGyro()) {
            addEventLocked("tap_rejected", "gyro_guard", accelDelta, recentGyro);
            return;
        }
        long previousTapAt = lastTapCandidateAtMs;
        lastTapPeakAtMs = now;
        if (previousTapAt > 0L) {
            long gap = now - previousTapAt;
            if (gap >= TAP_MIN_GAP_MS && gap <= TAP_MAX_GAP_MS) {
                doubleTapCount++;
                cooldownUntilMs = now + cooldownMs();
                lastTapCandidateAtMs = 0L;
                addEventLocked("double_back_tap_detected", "delayed_double_buzz", accelDelta, recentGyro);
                playDoubleTapBuzz("double_back_tap");
                return;
            }
            if (gap < TAP_MIN_GAP_MS) {
                return;
            }
        }
        lastTapCandidateAtMs = now;
        addEventLocked("tap_candidate", "waiting_for_second_tap", accelDelta, recentGyro);
    }

    private float accelDeltaLocked(float[] values) {
        if (lastAccel == null || lastAccel.length < 3 || values.length < 3) {
            return 0f;
        }
        return Math.abs(values[0] - lastAccel[0])
                + Math.abs(values[1] - lastAccel[1])
                + Math.abs(values[2] - lastAccel[2]);
    }

    private void rememberGravityLocked(long now, float[] values) {
        if (values.length < 3) {
            return;
        }
        gravitySamples.addLast(new TimedVector(now, values[0], values[1], values[2]));
        while (!gravitySamples.isEmpty() && now - gravitySamples.peekFirst().atMs > GRAVITY_WINDOW_MS) {
            gravitySamples.removeFirst();
        }
    }

    private void rememberHingeLocked(long now, float[] values) {
        if (values.length < 1) {
            return;
        }
        hingeKnown = true;
        lastHingeAtMs = now;
        lastHingeAngle = values[0];
    }

    private float gravityDeltaLocked(long now) {
        while (!gravitySamples.isEmpty() && now - gravitySamples.peekFirst().atMs > GRAVITY_WINDOW_MS) {
            gravitySamples.removeFirst();
        }
        if (gravitySamples.size() < 2) {
            return 0f;
        }
        TimedVector latest = gravitySamples.peekLast();
        float max = 0f;
        for (TimedVector sample : gravitySamples) {
            float delta = Math.abs(latest.x - sample.x)
                    + Math.abs(latest.y - sample.y)
                    + Math.abs(latest.z - sample.z);
            max = Math.max(max, delta);
        }
        return max;
    }

    private void pruneGyroLocked(long now) {
        while (!gyroPeaks.isEmpty() && now - gyroPeaks.peekFirst().atMs > GYRO_TAP_GUARD_MS) {
            gyroPeaks.removeFirst();
        }
    }

    private float recentGyroPeakLocked(long now, long windowMs) {
        pruneGyroLocked(now);
        float peak = 0f;
        for (TimedScalar sample : gyroPeaks) {
            if (now - sample.atMs <= windowMs) {
                peak = Math.max(peak, sample.value);
            }
        }
        return peak;
    }

    private void playChopPing(String reason) {
        try {
            new Handler(context.getMainLooper()).postDelayed(() -> runChopPing(reason), CHOP_PING_DELAY_MS);
            synchronized (lock) {
                addEventLocked("ping_scheduled", reason, 0f, 0f);
            }
        } catch (RuntimeException exc) {
            synchronized (lock) {
                lastError = "ping failed: " + exc.getMessage();
                addEventLocked("ping_failed", reason, 0f, 0f);
            }
            Log.w(TAG, "chop ping failed", exc);
        }
    }

    private void runChopPing(String reason) {
        try {
            ToneGenerator generator = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 85);
            generator.startTone(ToneGenerator.TONE_PROP_ACK, 120);
            synchronized (lock) {
                addEventLocked("ping_started", reason, 0f, 0f);
            }
            new Thread(() -> {
                try {
                    Thread.sleep(220L);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                generator.release();
            }, "pucky-chop-ping-release").start();
        } catch (RuntimeException exc) {
            synchronized (lock) {
                lastError = "ping failed: " + exc.getMessage();
                addEventLocked("ping_failed", reason, 0f, 0f);
            }
            Log.w(TAG, "delayed chop ping failed", exc);
        }
    }

    private void playDoubleTapBuzz(String reason) {
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) {
                synchronized (lock) {
                    addEventLocked("buzz_skipped", "no_vibrator:" + reason, 0f, 0f);
                }
                return;
            }
            new Handler(context.getMainLooper()).postDelayed(() -> runDoubleBuzz(vibrator, reason),
                    DOUBLE_TAP_BUZZ_DELAY_MS);
            synchronized (lock) {
                addEventLocked("buzz_scheduled", reason, 0f, 0f);
            }
        } catch (RuntimeException exc) {
            synchronized (lock) {
                lastError = "buzz failed: " + exc.getMessage();
                addEventLocked("buzz_failed", reason, 0f, 0f);
            }
            Log.w(TAG, "double tap buzz failed", exc);
        }
    }

    private void runDoubleBuzz(Vibrator vibrator, String reason) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(
                        new long[]{DOUBLE_TAP_BUZZ_PULSE_MS, DOUBLE_TAP_BUZZ_GAP_MS, DOUBLE_TAP_BUZZ_PULSE_MS},
                        new int[]{MAX_VIBRATION_AMPLITUDE, 0, MAX_VIBRATION_AMPLITUDE},
                        -1));
            } else {
                vibrator.vibrate(new long[]{0L, DOUBLE_TAP_BUZZ_PULSE_MS, DOUBLE_TAP_BUZZ_GAP_MS, DOUBLE_TAP_BUZZ_PULSE_MS}, -1);
            }
            synchronized (lock) {
                addEventLocked("buzz_started", reason, DOUBLE_TAP_BUZZ_PULSE_MS, 2f);
            }
        } catch (RuntimeException exc) {
            synchronized (lock) {
                lastError = "buzz failed: " + exc.getMessage();
                addEventLocked("buzz_failed", reason, 0f, 0f);
            }
            Log.w(TAG, "delayed double tap double buzz failed", exc);
        }
    }

    private void registerSensorLocked(String preferredName, int fallbackType) {
        Sensor sensor = findSensorByName(preferredName);
        if (sensor == null && sensorManager != null) {
            sensor = sensorManager.getDefaultSensor(fallbackType);
        }
        if (sensor == null || sensorManager == null || listener == null) {
            addEventLocked("sensor_missing", preferredName, 0f, 0f);
            return;
        }
        for (Sensor existing : registeredSensors) {
            if (existing.getName().equals(sensor.getName())
                    && existing.getStringType().equals(sensor.getStringType())
                    && existing.getType() == sensor.getType()) {
                return;
            }
        }
        boolean ok = sensorManager.registerListener(listener, sensor, SENSOR_RATE_US, sensorHandler);
        if (ok) {
            registeredSensors.add(sensor);
            addEventLocked("sensor_registered", sensor.getName(), 0f, 0f);
        } else {
            addEventLocked("sensor_register_failed", preferredName, 0f, 0f);
        }
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

    private int sensorRole(Sensor sensor) {
        String name = sensor.getName();
        if (SENSOR_HINGE_ANGLE.equals(name) || sensor.getType() == SENSOR_TYPE_HINGE_ANGLE) {
            return SENSOR_TYPE_HINGE_ANGLE;
        }
        if (SENSOR_ACCEL_FLIP.equals(name) || sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
            return Sensor.TYPE_ACCELEROMETER;
        }
        if (SENSOR_GYRO_FLIP.equals(name) || sensor.getType() == Sensor.TYPE_GYROSCOPE) {
            return Sensor.TYPE_GYROSCOPE;
        }
        if (SENSOR_GRAVITY_FLIP.equals(name) || sensor.getType() == Sensor.TYPE_GRAVITY) {
            return Sensor.TYPE_GRAVITY;
        }
        return sensor.getType();
    }

    private void stopLocked() {
        if (sensorManager != null && listener != null) {
            try {
                sensorManager.unregisterListener(listener);
            } catch (RuntimeException ignored) {
            }
        }
        if (sensorThread != null) {
            sensorThread.quitSafely();
        }
        sensorThread = null;
        sensorHandler = null;
        listener = null;
        sensorManager = null;
        registeredSensors.clear();
        gravitySamples.clear();
        gyroPeaks.clear();
        lastAccel = null;
        lastTapCandidateAtMs = 0L;
        lastTapPeakAtMs = 0L;
        cooldownUntilMs = 0L;
        hingeKnown = false;
        lastHingeAtMs = 0L;
        lastHingeAngle = Float.NaN;
        running = false;
    }

    private boolean closedGateKnownLocked(long now) {
        return hingeKnown;
    }

    private boolean closedForChopLocked(long now) {
        return closedGateKnownLocked(now) && lastHingeAngle <= HINGE_CLOSED_MAX_DEGREES;
    }

    private boolean enabled() {
        return prefs.getBoolean(ENABLED, false);
    }

    private boolean chopEnabled() {
        return prefs.getBoolean(CHOP_ENABLED, true);
    }

    private boolean doubleTapEnabled() {
        return prefs.getBoolean(DOUBLE_TAP_ENABLED, true);
    }

    private float tapAccelDelta() {
        return prefs.getFloat(TAP_ACCEL_DELTA, defaultTapAccelDelta());
    }

    private float tapMaxGyro() {
        return prefs.getFloat(TAP_MAX_GYRO, defaultTapMaxGyro());
    }

    private float chopGyro() {
        return prefs.getFloat(CHOP_GYRO, defaultChopGyro());
    }

    private float chopGravityDelta() {
        return prefs.getFloat(CHOP_GRAVITY_DELTA, defaultChopGravityDelta());
    }

    private long cooldownMs() {
        return prefs.getLong(COOLDOWN_MS, defaultCooldownMs());
    }

    private static float defaultTapAccelDelta() {
        return 12.0f;
    }

    private static float defaultTapMaxGyro() {
        return 5.0f;
    }

    private static float defaultChopGyro() {
        return 7.0f;
    }

    private static float defaultChopGravityDelta() {
        return 3.5f;
    }

    private static long defaultCooldownMs() {
        return 1_100L;
    }

    private JSONArray registeredSensorsLocked() {
        JSONArray out = new JSONArray();
        for (Sensor sensor : registeredSensors) {
            JSONObject item = new JSONObject();
            Json.put(item, "name", sensor.getName());
            Json.put(item, "string_type", sensor.getStringType());
            Json.put(item, "type", sensor.getType());
            Json.add(out, item);
        }
        return out;
    }

    private JSONArray recentEventsLocked(int limit) {
        JSONArray out = new JSONArray();
        int skip = Math.max(0, recentEvents.size() - limit);
        int index = 0;
        for (JSONObject event : recentEvents) {
            if (index++ >= skip) {
                Json.add(out, event);
            }
        }
        return out;
    }

    private void addEventLocked(String type, String detail, float primary, float secondary) {
        JSONObject event = new JSONObject();
        Json.put(event, "type", type);
        Json.put(event, "detail", detail == null ? "" : detail);
        Json.put(event, "at_ms", SystemClock.elapsedRealtime());
        Json.put(event, "timestamp", Instant.now().toString());
        Json.put(event, "primary", primary);
        Json.put(event, "secondary", secondary);
        Json.put(event, "chop_count", chopCount);
        Json.put(event, "double_tap_count", doubleTapCount);
        recentEvents.addLast(event);
        while (recentEvents.size() > MAX_RECENT_EVENTS) {
            recentEvents.removeFirst();
        }
    }

    private static float magnitude(float[] values) {
        if (values.length < 3) {
            return 0f;
        }
        return (float) Math.sqrt(values[0] * values[0] + values[1] * values[1] + values[2] * values[2]);
    }

    private static float clampFloat(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    private static long clampLong(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }

    private static final class TimedVector {
        final long atMs;
        final float x;
        final float y;
        final float z;

        TimedVector(long atMs, float x, float y, float z) {
            this.atMs = atMs;
            this.x = x;
            this.y = y;
            this.z = z;
        }
    }

    private static final class TimedScalar {
        final long atMs;
        final float value;

        TimedScalar(long atMs, float value) {
            this.atMs = atMs;
            this.value = value;
        }
    }
}
