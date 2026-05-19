package com.pucky.device.sensors;

import android.app.ActivityOptions;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import android.view.Display;

import com.pucky.device.CoverHomeActivity;
import com.pucky.device.MainActivity;
import com.pucky.device.accessibility.PuckyAccessibilityService;
import com.pucky.device.notifications.NotificationController;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

public final class CoverDisplayGestureController {
    private static final String TAG = "PuckyCoverGesture";
    private static final String PREFS = "pucky_cover_display_gesture";
    private static final String ENABLED = "enabled";
    private static final String ACTION_ENABLED = "action_enabled";
    private static final String ACTION_MODE = "action_mode";
    private static final String MIN_SWIPE_MS = "min_swipe_ms";
    private static final String MAX_SWIPE_MS = "max_swipe_ms";
    private static final String COOLDOWN_MS = "cooldown_ms";
    private static final String DISPLAY_ID = "display_id";
    private static final String MODE_NOTIFY = "notify";
    private static final String MODE_LOCK_SCREEN = "lock_screen";
    private static final String LEGACY_MODE_POWER = "power";
    private static final String LEGACY_MODE_DISPLAY = "display";
    private static final int DEFAULT_DISPLAY_ID = 1;
    private static final int WAKE_REQUEST_CODE = 41005;
    private static final int DEVICE_STATE_CLOSED_HALL = 0;
    private static final int DEVICE_STATE_CLOSED = 1;
    private static final long DEFAULT_MIN_SWIPE_MS = 50L;
    private static final long DEFAULT_MAX_SWIPE_MS = 500L;
    private static final long DEFAULT_COOLDOWN_MS = 800L;
    private static final long PREFLIGHT_MAX_AGE_MS = 1_250L;
    private static final long ACCEL_SAMPLE_MAX_AGE_MS = 350L;
    private static final long ACCEL_BUFFER_MS = 700L;
    private static final float ACCEL_FACE_UP_Z_MAX = -8.0f;
    private static final float ACCEL_FACE_UP_XY_MAX = 3.0f;
    private static final float ACCEL_DELTA_SPIKE = 0.75f;
    private static final int MAX_EVENTS = 80;

    private static final String SENSOR_AOA = "stk3bfx_aoa";
    private static final String SENSOR_FLIP_APPROACH = "mot_flip_approach";
    private static final String SENSOR_ULTRASOUND = "Ultrasound Proximity";
    private static final String SENSOR_ACCEL = "lsm6dso_acc-CAM_ALIGNED";

    private static volatile CoverDisplayGestureController instance;

    private final Context context;
    private final SharedPreferences prefs;
    private final Object lock = new Object();
    private final ArrayDeque<JSONObject> recentEvents = new ArrayDeque<>();
    private final ArrayDeque<AccelSample> accelSamples = new ArrayDeque<>();
    private final BooleanBySensor proximity = new BooleanBySensor();

    private SensorManager sensorManager;
    private HandlerThread sensorThread;
    private Handler sensorHandler;
    private SensorEventListener listener;
    private final List<Sensor> registeredSensors = new ArrayList<>();

    private boolean running;
    private boolean handNear;
    private long nearStartedAtMs;
    private long activeCandidateId;
    private long lastGestureAtMs;
    private PreflightSnapshot candidatePreflight;
    private String lastError = "";

    private CoverDisplayGestureController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static CoverDisplayGestureController shared(Context context) {
        CoverDisplayGestureController existing = instance;
        if (existing != null) {
            return existing;
        }
        synchronized (CoverDisplayGestureController.class) {
            if (instance == null) {
                instance = new CoverDisplayGestureController(context);
            }
            return instance;
        }
    }

    public JSONObject status() {
        JSONObject gates = currentGateSnapshot();
        synchronized (lock) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.cover_display_gesture_status.v2");
            Json.put(out, "enabled", enabled());
            Json.put(out, "action_enabled", actionEnabled());
            Json.put(out, "action_mode", actionMode());
            Json.put(out, "running", running);
            Json.put(out, "display_id", displayId());
            Json.put(out, "display_state", displayStateName(readDisplayState()));
            Json.put(out, "accessibility_lock_available", PuckyAccessibilityService.canLockScreen(context));
            Json.put(out, "min_swipe_ms", minSwipeMs());
            Json.put(out, "max_swipe_ms", maxSwipeMs());
            Json.put(out, "cooldown_ms", cooldownMs());
            Json.put(out, "preflight_max_age_ms", PREFLIGHT_MAX_AGE_MS);
            Json.put(out, "hand_near", handNear);
            Json.put(out, "near_duration_ms", handNear && nearStartedAtMs > 0
                    ? SystemClock.elapsedRealtime() - nearStartedAtMs
                    : 0L);
            Json.put(out, "gates", gates);
            Json.put(out, "registered_sensors", registeredSensorsLocked());
            Json.put(out, "recent_events", recentEventsLocked(30));
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
            if (args.has("action_enabled")) {
                editor.putBoolean(ACTION_ENABLED, args.optBoolean("action_enabled", false));
            }
            if (args.has("action_mode") && !args.isNull("action_mode")) {
                String mode = args.optString("action_mode", MODE_NOTIFY).trim().toLowerCase(Locale.US);
                if (MODE_NOTIFY.equals(mode)) {
                    editor.putString(ACTION_MODE, MODE_NOTIFY);
                } else if (MODE_LOCK_SCREEN.equals(mode)
                        || LEGACY_MODE_POWER.equals(mode)
                        || LEGACY_MODE_DISPLAY.equals(mode)) {
                    editor.putString(ACTION_MODE, MODE_LOCK_SCREEN);
                } else {
                    lastError = "action_mode must be notify or lock_screen";
                }
            }
            if (args.has("min_swipe_ms")) {
                editor.putLong(MIN_SWIPE_MS,
                        clamp(args.optLong("min_swipe_ms", DEFAULT_MIN_SWIPE_MS), 25L, 2_000L));
            }
            if (args.has("max_swipe_ms")) {
                editor.putLong(MAX_SWIPE_MS,
                        clamp(args.optLong("max_swipe_ms", DEFAULT_MAX_SWIPE_MS), 50L, 4_000L));
            }
            if (args.has("cooldown_ms")) {
                editor.putLong(COOLDOWN_MS,
                        clamp(args.optLong("cooldown_ms", DEFAULT_COOLDOWN_MS), 250L, 10_000L));
            }
            if (args.has("display_id")) {
                editor.putInt(DISPLAY_ID, Math.max(1, args.optInt("display_id", DEFAULT_DISPLAY_ID)));
            }
            editor.apply();
            if (args.optBoolean("clear_events", false)) {
                recentEvents.clear();
            }
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
        String requested = args.optString("action", "toggle").trim().toLowerCase(Locale.US);
        boolean force = args.optBoolean("force", false);
        String action = "toggle";
        synchronized (lock) {
            if (!"toggle".equals(requested) && !requested.isEmpty()) {
                JSONObject out = status();
                Json.put(out, "triggered", false);
                Json.put(out, "trigger_error", "power key mode supports toggle only");
                return out;
            }
            if (!force && !actionEnabled()) {
                addEventLocked("power_action_skipped", "dry_run_trigger_" + action, 0L, null, null);
                JSONObject out = status();
                Json.put(out, "triggered", false);
                Json.put(out, "trigger_error", "action_enabled is false; pass force=true for test trigger");
                return out;
            }
            addEventLocked("power_action_requested", "trigger_" + action, 0L, null, currentGateSnapshot());
        }
        runAction(action, "trigger_" + action);
        JSONObject out = status();
        Json.put(out, "triggered", true);
        Json.put(out, "trigger_action", action);
        Json.put(out, "trigger_force", force);
        return out;
    }

    public void start() {
        synchronized (lock) {
            if (!enabled() || running) {
                return;
            }
            sensorManager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
            if (sensorManager == null) {
                lastError = "SensorManager unavailable";
                addEventLocked("controller_error", "sensor_manager_unavailable", 0L, null, null);
                return;
            }
            sensorThread = new HandlerThread("PuckyCoverDisplayGesture");
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
            registerSensorLocked(SENSOR_AOA);
            registerSensorLocked(SENSOR_FLIP_APPROACH);
            registerSensorLocked(SENSOR_ULTRASOUND);
            registerSensorLocked(SENSOR_ACCEL);
            if (registeredSensors.isEmpty()) {
                lastError = "No cover gesture sensors registered";
                stopLocked();
                addEventLocked("controller_error", "no_sensors_registered", 0L, null, null);
                return;
            }
            running = true;
            lastError = "";
            addEventLocked("controller_started", "registered_" + registeredSensors.size(), 0L, null, null);
        }
    }

    public void stop() {
        synchronized (lock) {
            stopLocked();
            addEventLocked("controller_stopped", "disabled", 0L, null, null);
        }
    }

    private void handleSensorEvent(SensorEvent event) {
        String name = event.sensor == null ? "" : event.sensor.getName();
        long now = SystemClock.elapsedRealtime();
        if (SENSOR_ACCEL.equals(name)) {
            synchronized (lock) {
                updateAccelLocked(now, event.values);
            }
            return;
        }

        float[] values = event.values == null ? new float[0] : event.values.clone();
        boolean shouldEvaluate = false;
        long candidateId = 0L;
        long durationMs = 0L;
        synchronized (lock) {
            if (SENSOR_AOA.equals(name)) {
                proximity.aoaKnown = true;
                proximity.aoaNear = values.length > 0 && values[0] <= 0.5f;
            } else if (SENSOR_FLIP_APPROACH.equals(name)) {
                proximity.flipKnown = true;
                proximity.flipNear = values.length > 0 && values[0] >= 0.5f;
            } else if (SENSOR_ULTRASOUND.equals(name)) {
                proximity.ultrasoundKnown = true;
                proximity.ultrasoundNear = values.length > 0 && values[0] < 2.5f;
            } else {
                return;
            }

            if (!proximity.anyKnown()) {
                return;
            }
            boolean near = proximity.anyNear();
            if (near == handNear) {
                return;
            }
            handNear = near;
            if (near) {
                activeCandidateId++;
                candidateId = activeCandidateId;
                nearStartedAtMs = now;
                candidatePreflight = null;
                addEventLocked("near_started", name, 0L, values, null);
                startPreflight(candidateId, "near_start");
                return;
            }
            durationMs = nearStartedAtMs <= 0 ? 0L : now - nearStartedAtMs;
            nearStartedAtMs = 0L;
            candidateId = activeCandidateId;
            shouldEvaluate = true;
        }
        if (shouldEvaluate) {
            evaluateCandidate(candidateId, durationMs, name, values);
        }
    }

    private void evaluateCandidate(long candidateId, long durationMs, String sourceSensor, float[] values) {
        String earlyReject = earlyRejectReason(durationMs);
        if (earlyReject != null) {
            synchronized (lock) {
                addEventLocked("gesture_rejected", earlyReject, durationMs, values, null);
            }
            return;
        }

        PreflightSnapshot preflight = preflightForCandidate(candidateId);
        AccelGate accelGate;
        synchronized (lock) {
            accelGate = accelGateLocked(SystemClock.elapsedRealtime());
        }
        JSONObject gates = gateSnapshot(preflight, accelGate);
        String rejectReason = rejectionReason(preflight, accelGate, gates);
        if (rejectReason != null) {
            synchronized (lock) {
                addEventLocked("gesture_rejected", rejectReason, durationMs, values, gates);
            }
            return;
        }

        String action = "toggle";
        synchronized (lock) {
            lastGestureAtMs = SystemClock.elapsedRealtime();
            addEventLocked("gesture_accepted", action + ":" + sourceSensor, durationMs, values, gates);
            if (!actionEnabled()) {
                addEventLocked("power_action_skipped", "dry_run", durationMs, values, gates);
                return;
            }
        }
        runAction(action, "gesture_" + action);
    }

    private String earlyRejectReason(long durationMs) {
        long now = SystemClock.elapsedRealtime();
        synchronized (lock) {
            if (durationMs < minSwipeMs()) {
                return "too_short_" + durationMs + "ms";
            }
            if (durationMs > maxSwipeMs()) {
                return "too_long_" + durationMs + "ms";
            }
            long cooldownRemaining = cooldownMs() - (now - lastGestureAtMs);
            if (lastGestureAtMs > 0 && cooldownRemaining > 0) {
                return "cooldown_" + cooldownRemaining + "ms";
            }
        }
        return null;
    }

    private String rejectionReason(PreflightSnapshot preflight, AccelGate accelGate, JSONObject gates) {
        if (!preflight.available) {
            return "preflight_unavailable";
        }
        if (!preflight.closed) {
            return "not_closed_state_" + preflight.deviceState;
        }
        if (!preflight.displayKnown) {
            return "cover_display_unknown";
        }
        if (!accelGate.fresh) {
            return "accelerometer_stale";
        }
        if (!accelGate.faceUp) {
            return "not_face_up";
        }
        if (!accelGate.stationary) {
            return "accelerometer_spike";
        }
        return null;
    }

    private void startPreflight(long candidateId, String reason) {
        new Thread(() -> {
            PreflightSnapshot snapshot = readPreflight(reason);
            synchronized (lock) {
                if (candidateId == activeCandidateId && handNear) {
                    candidatePreflight = snapshot;
                    addEventLocked("preflight_ready", reason, snapshot.durationMs, null, snapshot.toJson());
                }
            }
        }, "pucky-cover-preflight").start();
    }

    private PreflightSnapshot preflightForCandidate(long candidateId) {
        long now = SystemClock.elapsedRealtime();
        synchronized (lock) {
            if (candidateId == activeCandidateId
                    && candidatePreflight != null
                    && now - candidatePreflight.completedAtMs <= PREFLIGHT_MAX_AGE_MS) {
                return candidatePreflight;
            }
        }
        return readPreflight("near_end");
    }

    private PreflightSnapshot readPreflight(String reason) {
        long started = SystemClock.elapsedRealtime();
        int deviceState = readDeviceState();
        int displayState = readDisplayState();
        boolean displayKnown = displayState != Display.STATE_UNKNOWN;
        long completed = SystemClock.elapsedRealtime();
        boolean closed = deviceState == DEVICE_STATE_CLOSED_HALL || deviceState == DEVICE_STATE_CLOSED;
        return new PreflightSnapshot(
                deviceState >= 0,
                deviceState,
                closed,
                displayKnown,
                displayState,
                reason,
                started,
                completed,
                completed - started);
    }

    private int readDeviceState() {
        ShellResult result = exec("cmd device_state print-state", 2_000L);
        if (result.exitCode != 0) {
            return -1;
        }
        String output = result.output.trim();
        int newline = output.indexOf('\n');
        if (newline >= 0) {
            output = output.substring(0, newline).trim();
        }
        try {
            return Integer.parseInt(output);
        } catch (NumberFormatException ignored) {
            return -1;
        }
    }

    private int readDisplayState() {
        DisplayManager manager = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
        Display display = manager == null ? null : manager.getDisplay(displayId());
        return display == null ? Display.STATE_UNKNOWN : display.getState();
    }

    private void updateAccelLocked(long now, float[] values) {
        if (values.length < 3) {
            return;
        }
        accelSamples.addLast(new AccelSample(now, values[0], values[1], values[2]));
        pruneAccelLocked(now);
    }

    private void pruneAccelLocked(long now) {
        while (!accelSamples.isEmpty() && now - accelSamples.peekFirst().atMs > ACCEL_BUFFER_MS) {
            accelSamples.removeFirst();
        }
    }

    private AccelGate accelGateLocked(long now) {
        pruneAccelLocked(now);
        if (accelSamples.isEmpty()) {
            return new AccelGate(false, false, false, 0, 0f, 0f, 0f, 0f);
        }
        AccelSample latest = accelSamples.peekLast();
        boolean fresh = latest != null && now - latest.atMs <= ACCEL_SAMPLE_MAX_AGE_MS;
        float xy = latest == null ? 0f : (float) Math.sqrt(latest.x * latest.x + latest.y * latest.y);
        boolean faceUp = fresh && latest.z <= ACCEL_FACE_UP_Z_MAX && xy <= ACCEL_FACE_UP_XY_MAX;
        boolean stationary = fresh;
        float maxDelta = 0f;
        AccelSample previous = null;
        int count = 0;
        for (AccelSample sample : accelSamples) {
            if (now - sample.atMs > ACCEL_SAMPLE_MAX_AGE_MS) {
                continue;
            }
            count++;
            if (previous != null) {
                float delta = Math.abs(sample.x - previous.x)
                        + Math.abs(sample.y - previous.y)
                        + Math.abs(sample.z - previous.z);
                maxDelta = Math.max(maxDelta, delta);
                if (delta > ACCEL_DELTA_SPIKE) {
                    stationary = false;
                }
            }
            float magnitude = (float) Math.sqrt(sample.x * sample.x + sample.y * sample.y + sample.z * sample.z);
            if (Math.abs(magnitude - 9.81f) > 1.75f) {
                stationary = false;
            }
            previous = sample;
        }
        if (count < 3) {
            stationary = false;
        }
        return new AccelGate(
                fresh,
                faceUp,
                stationary,
                count,
                latest == null ? 0f : latest.x,
                latest == null ? 0f : latest.y,
                latest == null ? 0f : latest.z,
                maxDelta);
    }

    private JSONObject currentGateSnapshot() {
        PreflightSnapshot preflight = readPreflight("status");
        AccelGate accelGate;
        synchronized (lock) {
            accelGate = accelGateLocked(SystemClock.elapsedRealtime());
        }
        return gateSnapshot(preflight, accelGate);
    }

    private JSONObject gateSnapshot(PreflightSnapshot preflight, AccelGate accelGate) {
        JSONObject out = new JSONObject();
        Json.put(out, "device_state_available", preflight.available);
        Json.put(out, "device_state", preflight.deviceState >= 0 ? preflight.deviceState : JSONObject.NULL);
        Json.put(out, "device_closed", preflight.closed);
        Json.put(out, "display_known", preflight.displayKnown);
        Json.put(out, "display_state", displayStateName(preflight.displayState));
        Json.put(out, "preflight_reason", preflight.reason);
        Json.put(out, "preflight_duration_ms", preflight.durationMs);
        Json.put(out, "accel_fresh", accelGate.fresh);
        Json.put(out, "accel_face_up", accelGate.faceUp);
        Json.put(out, "accel_stationary", accelGate.stationary);
        Json.put(out, "accel_sample_count", accelGate.sampleCount);
        Json.put(out, "accel_x", accelGate.x);
        Json.put(out, "accel_y", accelGate.y);
        Json.put(out, "accel_z", accelGate.z);
        Json.put(out, "accel_max_delta", accelGate.maxDelta);
        return out;
    }

    private void runAction(String action, String reason) {
        if (MODE_NOTIFY.equals(actionMode())) {
            runNotifyAction(action, reason);
            return;
        }
        runLockOrWakeAction(action, reason);
    }

    private void runNotifyAction(String action, String reason) {
        buzz();
        try {
            JSONObject args = new JSONObject();
            Json.put(args, "id", "cover_wave_" + action);
            Json.put(args, "title", "Pucky cover wave");
            Json.put(args, "text", "Wave accepted: " + action);
            Json.put(args, "big_text", "Cover wave accepted for " + action + " via " + reason + ".");
            Json.put(args, "timeout_ms", 4_000L);
            new NotificationController(context).show(args);
            synchronized (lock) {
                addEventLocked("notify_action", reason, 0L, null, currentGateSnapshot());
            }
        } catch (Exception exc) {
            synchronized (lock) {
                lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
                addEventLocked("notify_action_failed", reason, 0L, null, currentGateSnapshot());
            }
        }
    }

    private void runLockOrWakeAction(String action, String reason) {
        int displayState = readDisplayState();
        if (displayState == Display.STATE_ON) {
            runLockScreenAction(action, reason);
        } else {
            runWakeCoverAction(action, reason, displayState);
        }
    }

    private void runLockScreenAction(String action, String reason) {
        buzz();
        boolean success = PuckyAccessibilityService.lockScreen();
        synchronized (lock) {
            if (success) {
                addEventLocked("lock_screen_" + action, reason, 0L, null, currentGateSnapshot());
            } else {
                lastError = "Accessibility screen lock is unavailable";
                addEventLocked("lock_screen_unavailable", reason, 0L, null, currentGateSnapshot());
            }
        }
        if (!success) {
            notifyActionUnavailable();
        }
    }

    private void runWakeCoverAction(String action, String reason, int displayState) {
        buzz();
        new Handler(context.getMainLooper()).post(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_MAIN)
                        .addCategory("android.intent.category.SECONDARY_HOME")
                        .setClass(context, CoverHomeActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                                | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        .putExtra(MainActivity.EXTRA_WAKE_SCREEN, true);
                Bundle options = coverLaunchOptions(displayId(), true);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        flags |= PendingIntent.FLAG_IMMUTABLE;
                    }
                    PendingIntent pendingIntent = PendingIntent.getActivity(
                            context,
                            WAKE_REQUEST_CODE,
                            intent,
                            flags);
                    pendingIntent.send(context, 0, null, null, null, null, options);
                } else {
                    context.startActivity(intent, options);
                }
                synchronized (lock) {
                    addEventLocked("wake_cover_" + action, displayStateName(displayState),
                            0L, null, currentGateSnapshot());
                }
            } catch (Exception exc) {
                synchronized (lock) {
                    lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
                    addEventLocked("wake_cover_failed", reason, 0L, null, currentGateSnapshot());
                }
            }
        });
    }

    private static Bundle coverLaunchOptions(int displayId, boolean forPendingIntent) {
        ActivityOptions options = ActivityOptions.makeBasic()
                .setLaunchDisplayId(displayId);
        if (forPendingIntent && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            options.setPendingIntentBackgroundActivityLaunchAllowed(true);
            options.setPendingIntentBackgroundActivityStartMode(
                    ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
        }
        return options.toBundle();
    }

    private void notifyActionUnavailable() {
        try {
            JSONObject args = new JSONObject();
            Json.put(args, "id", "cover_wave_lock_unavailable");
            Json.put(args, "title", "Pucky screen lock needs setup");
            Json.put(args, "text", "Enable Pucky screen lock in Accessibility settings.");
            Json.put(args, "big_text", "The hand-wave gesture was accepted, but Android requires the Pucky Accessibility service before Pucky can lock the screen.");
            Json.put(args, "timeout_ms", 6_000L);
            new NotificationController(context).show(args);
        } catch (Exception exc) {
            Log.w(TAG, "cover wave unavailable notification failed", exc);
        }
    }

    private void buzz() {
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                vibrator.vibrate(60);
            }
        } catch (RuntimeException exc) {
            Log.w(TAG, "cover wave vibration failed", exc);
        }
    }

    private void registerSensorLocked(String name) {
        Sensor sensor = findSensorByName(name);
        if (sensor == null || sensorManager == null || listener == null) {
            return;
        }
        boolean ok = sensorManager.registerListener(listener, sensor, 20_000, sensorHandler);
        if (ok) {
            registeredSensors.add(sensor);
        } else {
            addEventLocked("sensor_register_failed", name, 0L, null, null);
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
        proximity.clear();
        accelSamples.clear();
        handNear = false;
        nearStartedAtMs = 0L;
        candidatePreflight = null;
        running = false;
    }

    private boolean enabled() {
        return prefs.getBoolean(ENABLED, false);
    }

    private boolean actionEnabled() {
        return prefs.getBoolean(ACTION_ENABLED, false);
    }

    private String actionMode() {
        String mode = prefs.getString(ACTION_MODE, MODE_NOTIFY);
        return MODE_LOCK_SCREEN.equals(mode)
                || LEGACY_MODE_POWER.equals(mode)
                || LEGACY_MODE_DISPLAY.equals(mode)
                ? MODE_LOCK_SCREEN
                : MODE_NOTIFY;
    }

    private long minSwipeMs() {
        return prefs.getLong(MIN_SWIPE_MS, DEFAULT_MIN_SWIPE_MS);
    }

    private long maxSwipeMs() {
        return prefs.getLong(MAX_SWIPE_MS, DEFAULT_MAX_SWIPE_MS);
    }

    private long cooldownMs() {
        return prefs.getLong(COOLDOWN_MS, DEFAULT_COOLDOWN_MS);
    }

    private int displayId() {
        return prefs.getInt(DISPLAY_ID, DEFAULT_DISPLAY_ID);
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
        int skip = Math.max(0, recentEvents.size() - Math.max(1, limit));
        int index = 0;
        for (JSONObject event : recentEvents) {
            if (index++ >= skip) {
                Json.add(out, event);
            }
        }
        return out;
    }

    private void addEventLocked(String type, String reason, long durationMs, float[] values, JSONObject gates) {
        JSONObject event = new JSONObject();
        Json.put(event, "at", Instant.now().toString());
        Json.put(event, "type", type);
        Json.put(event, "reason", reason == null ? "" : reason);
        Json.put(event, "duration_ms", durationMs);
        Json.put(event, "display_state", displayStateName(readDisplayState()));
        Json.put(event, "hand_near", handNear);
        Json.put(event, "near", proximity.toJson());
        if (values != null) {
            JSONArray array = new JSONArray();
            for (float value : values) {
                Json.add(array, value);
            }
            Json.put(event, "values", array);
        }
        if (gates != null) {
            Json.put(event, "gates", gates);
        }
        recentEvents.addLast(event);
        while (recentEvents.size() > MAX_EVENTS) {
            recentEvents.removeFirst();
        }
        Log.i(TAG, type + " reason=" + reason + " duration_ms=" + durationMs);
    }

    private static String displayStateName(int state) {
        switch (state) {
            case Display.STATE_OFF:
                return "OFF";
            case Display.STATE_ON:
                return "ON";
            case Display.STATE_DOZE:
                return "DOZE";
            case Display.STATE_DOZE_SUSPEND:
                return "DOZE_SUSPEND";
            case Display.STATE_VR:
                return "VR";
            case Display.STATE_ON_SUSPEND:
                return "ON_SUSPEND";
            case Display.STATE_UNKNOWN:
                return "UNKNOWN";
            default:
                return String.valueOf(state);
        }
    }

    private static ShellResult exec(String command, long timeoutMs) {
        long started = SystemClock.elapsedRealtime();
        Process process = null;
        try {
            process = new ProcessBuilder("/system/bin/sh", "-c", command)
                    .redirectErrorStream(true)
                    .start();
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            Process startedProcess = process;
            Thread reader = new Thread(() -> readOutput(startedProcess.getInputStream(), output),
                    "pucky-cover-display-shell-reader");
            reader.start();
            boolean finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
            if (!finished) {
                process.destroyForcibly();
                return new ShellResult(-1, "timeout", SystemClock.elapsedRealtime() - started);
            }
            reader.join(250L);
            return new ShellResult(
                    process.exitValue(),
                    output.toString(StandardCharsets.UTF_8.name()).trim(),
                    SystemClock.elapsedRealtime() - started);
        } catch (Exception exc) {
            return new ShellResult(-2, exc.getClass().getSimpleName() + ": " + exc.getMessage(),
                    SystemClock.elapsedRealtime() - started);
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    private static void readOutput(InputStream input, ByteArrayOutputStream output) {
        byte[] buffer = new byte[2048];
        try {
            int read;
            while ((read = input.read(buffer)) != -1 && output.size() < 16 * 1024) {
                output.write(buffer, 0, read);
            }
        } catch (Exception ignored) {
        }
    }

    private static long clamp(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }

    private static final class AccelSample {
        final long atMs;
        final float x;
        final float y;
        final float z;

        AccelSample(long atMs, float x, float y, float z) {
            this.atMs = atMs;
            this.x = x;
            this.y = y;
            this.z = z;
        }
    }

    private static final class AccelGate {
        final boolean fresh;
        final boolean faceUp;
        final boolean stationary;
        final int sampleCount;
        final float x;
        final float y;
        final float z;
        final float maxDelta;

        AccelGate(boolean fresh, boolean faceUp, boolean stationary, int sampleCount,
                float x, float y, float z, float maxDelta) {
            this.fresh = fresh;
            this.faceUp = faceUp;
            this.stationary = stationary;
            this.sampleCount = sampleCount;
            this.x = x;
            this.y = y;
            this.z = z;
            this.maxDelta = maxDelta;
        }
    }

    private static final class PreflightSnapshot {
        final boolean available;
        final int deviceState;
        final boolean closed;
        final boolean displayKnown;
        final int displayState;
        final String reason;
        final long startedAtMs;
        final long completedAtMs;
        final long durationMs;

        PreflightSnapshot(boolean available, int deviceState, boolean closed, boolean displayKnown,
                int displayState, String reason, long startedAtMs, long completedAtMs, long durationMs) {
            this.available = available;
            this.deviceState = deviceState;
            this.closed = closed;
            this.displayKnown = displayKnown;
            this.displayState = displayState;
            this.reason = reason;
            this.startedAtMs = startedAtMs;
            this.completedAtMs = completedAtMs;
            this.durationMs = durationMs;
        }

        JSONObject toJson() {
            JSONObject out = new JSONObject();
            Json.put(out, "device_state_available", available);
            Json.put(out, "device_state", deviceState >= 0 ? deviceState : JSONObject.NULL);
            Json.put(out, "device_closed", closed);
            Json.put(out, "display_known", displayKnown);
            Json.put(out, "display_state", displayStateName(displayState));
            Json.put(out, "preflight_reason", reason);
            Json.put(out, "preflight_duration_ms", durationMs);
            return out;
        }
    }

    private static final class ShellResult {
        final int exitCode;
        final String output;
        final long durationMs;

        ShellResult(int exitCode, String output, long durationMs) {
            this.exitCode = exitCode;
            this.output = output == null ? "" : output;
            this.durationMs = durationMs;
        }
    }

    private static final class BooleanBySensor {
        boolean aoaKnown;
        boolean aoaNear;
        boolean flipKnown;
        boolean flipNear;
        boolean ultrasoundKnown;
        boolean ultrasoundNear;

        boolean anyKnown() {
            return aoaKnown || flipKnown || ultrasoundKnown;
        }

        boolean anyNear() {
            return (aoaKnown && aoaNear)
                    || (flipKnown && flipNear)
                    || (ultrasoundKnown && ultrasoundNear);
        }

        void clear() {
            aoaKnown = false;
            aoaNear = false;
            flipKnown = false;
            flipNear = false;
            ultrasoundKnown = false;
            ultrasoundNear = false;
        }

        JSONObject toJson() {
            JSONObject out = new JSONObject();
            Json.put(out, "stk3bfx_aoa", aoaKnown ? aoaNear : JSONObject.NULL);
            Json.put(out, "mot_flip_approach", flipKnown ? flipNear : JSONObject.NULL);
            Json.put(out, "ultrasound", ultrasoundKnown ? ultrasoundNear : JSONObject.NULL);
            Json.put(out, "any", anyKnown() ? anyNear() : JSONObject.NULL);
            return out;
        }
    }
}
