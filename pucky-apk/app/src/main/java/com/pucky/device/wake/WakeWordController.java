package com.pucky.device.wake;

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import com.pucky.device.assistant.PuckyAssistantController;
import com.pucky.device.pucky.PuckyTurnController;
import com.pucky.device.pucky.WalkieAudioCaptureController;
import com.pucky.device.pucky.WalkieSpeechGate;
import com.pucky.device.pucky.SileroVadEngine;
import com.pucky.device.speech.OnDeviceInjectedAudioRecognizer;
import com.pucky.device.speech.RecipeDevicePrimitiveExecutor;
import com.pucky.device.speech.lab.AudioFrameBus;
import com.pucky.device.speech.lab.AudioFrameConsumer;
import com.pucky.device.speech.lab.PreRollBuffer;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.Arrays;

public final class WakeWordController {
    private static final String TAG = "PuckyWakeWord";

    private static final String PREFS = "pucky_wake_word";
    private static final String KEY_REQUESTED_ENABLED = "requested_enabled";
    private static final String KEY_SCOPE = "scope";
    private static final String KEY_LAST_CONFIG_SET_AT = "last_config_set_at";
    private static final String KEY_LAST_START_REQUESTED_AT = "last_start_requested_at";
    private static final String KEY_LAST_STOP_REQUESTED_AT = "last_stop_requested_at";
    private static final String KEY_LAST_SIMULATE_REQUESTED_AT = "last_simulate_requested_at";

    private static final String MODE_PHASE_2A = "phase2a_unlocked_service";
    private static final String MODE_PHASE_2B = "assistant_screen_off_reserved";
    private static final String SCOPE_UNLOCKED_SERVICE = "unlocked_service";
    private static final String SCOPE_ASSISTANT_SCREEN_OFF = "assistant_screen_off";
    private static final String ENGINE = "silero_vad_candidate_plus_android_stt_confirmation";

    private static final long CANDIDATE_CAPTURE_MS = 1800L;
    private static final long CONFIRM_TIMEOUT_MS = 5000L;
    private static final long SPEECH_START_TIMEOUT_MS = 3000L;
    private static final long TRAILING_SILENCE_MS = 1000L;
    private static final long MAX_TURN_MS = 20000L;
    private static final double TURN_SPEECH_THRESHOLD = WalkieSpeechGate.DEFAULT_SPEECH_THRESHOLD;
    private static final double SINGLE_WORD_CONFIDENCE_THRESHOLD = 0.60;

    private static volatile WakeWordController instance;

    private final Context context;
    private final SharedPreferences prefs;
    private final Handler main;
    private final RecipeDevicePrimitiveExecutor recipeExecutor;
    private final OnDeviceInjectedAudioRecognizer recognizer;
    private final PowerManager powerManager;
    private final KeyguardManager keyguardManager;

    private final BroadcastReceiver deviceStateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            reevaluate();
        }
    };

    private final Object lock = new Object();

    private boolean serviceStarted;
    private boolean receiverRegistered;
    private boolean sentinelRunning;
    private boolean candidateActive;
    private boolean confirmingCandidate;
    private String suspendedReason = "service_inactive";
    private String lastError = "";
    private String lastWakePhrase = "";
    private String lastWakeAt = "";
    private String lastConfirmationTranscript = "";
    private long sentinelStartedElapsedMs;
    private long sentinelStartedWallMs;
    private String activeTurnId = "";
    private String activeTurnSource = "";

    private AudioFrameBus sentinelBus;
    private PreRollBuffer preRollBuffer;
    private WakeCandidateRecorder candidateRecorder;
    private WakeTurnMonitor turnMonitor;

    private WakeWordController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.main = new Handler(Looper.getMainLooper());
        this.recipeExecutor = new RecipeDevicePrimitiveExecutor(this.context);
        this.recognizer = new OnDeviceInjectedAudioRecognizer(this.context);
        this.powerManager = (PowerManager) this.context.getSystemService(Context.POWER_SERVICE);
        this.keyguardManager = (KeyguardManager) this.context.getSystemService(Context.KEYGUARD_SERVICE);
    }

    public static WakeWordController shared(Context context) {
        WakeWordController existing = instance;
        if (existing != null) {
            return existing;
        }
        synchronized (WakeWordController.class) {
            if (instance == null) {
                instance = new WakeWordController(context);
            }
            return instance;
        }
    }

    public void onServiceStarted() {
        synchronized (lock) {
            serviceStarted = true;
            registerReceiverLocked();
        }
        reevaluate();
    }

    public void onServiceStopped() {
        synchronized (lock) {
            serviceStarted = false;
            unregisterReceiverLocked();
            stopSentinelLocked("service_stopped");
        }
        clearTurnTracking(false);
    }

    public synchronized JSONObject status() {
        synchronized (lock) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.wake_word_status.v1");
            Json.put(out, "engine", ENGINE);
            Json.put(out, "wake_word", "Hey Pucky");
            Json.put(out, "wake_family", WakePhraseFamily.statusJson());
            Json.put(out, "enabled", requestedEnabled());
            Json.put(out, "configured", true);
            Json.put(out, "mode", requestedScope().equals(SCOPE_ASSISTANT_SCREEN_OFF) ? MODE_PHASE_2B : MODE_PHASE_2A);
            Json.put(out, "scope", requestedScope());
            Json.put(out, "requested_enabled", requestedEnabled());
            Json.put(out, "running", sentinelRunning);
            Json.put(out, "service_started", serviceStarted);
            Json.put(out, "candidate_active", candidateActive);
            Json.put(out, "confirming_candidate", confirmingCandidate);
            Json.put(out, "active_turn_id", activeTurnId.isEmpty() ? JSONObject.NULL : activeTurnId);
            Json.put(out, "active_turn_source", activeTurnSource.isEmpty() ? JSONObject.NULL : activeTurnSource);
            Json.put(out, "suspended_reason", suspendedReason.isEmpty() ? JSONObject.NULL : suspendedReason);
            Json.put(out, "last_error", lastError.isEmpty() ? JSONObject.NULL : lastError);
            Json.put(out, "last_wake_phrase", lastWakePhrase.isEmpty() ? JSONObject.NULL : lastWakePhrase);
            Json.put(out, "last_wake_at", lastWakeAt.isEmpty() ? JSONObject.NULL : lastWakeAt);
            Json.put(out, "last_confirmation_transcript",
                    lastConfirmationTranscript.isEmpty() ? JSONObject.NULL : lastConfirmationTranscript);
            Json.put(out, "last_config_set_at", nullable(prefs.getString(KEY_LAST_CONFIG_SET_AT, "")));
            Json.put(out, "last_start_requested_at", nullable(prefs.getString(KEY_LAST_START_REQUESTED_AT, "")));
            Json.put(out, "last_stop_requested_at", nullable(prefs.getString(KEY_LAST_STOP_REQUESTED_AT, "")));
            Json.put(out, "last_simulate_requested_at", nullable(prefs.getString(KEY_LAST_SIMULATE_REQUESTED_AT, "")));
            Json.put(out, "sentinel_started_at",
                    sentinelStartedWallMs <= 0L ? JSONObject.NULL : Instant.ofEpochMilli(sentinelStartedWallMs).toString());
            Json.put(out, "assistant_status", PuckyAssistantController.status(context));
            Json.put(out, "supported_scopes", supportedScopes());
            if (sentinelBus != null) {
                Json.put(out, "audio_frame_bus", sentinelBus.snapshot());
            }
            return out;
        }
    }

    public synchronized JSONObject configSet(JSONObject args) {
        SharedPreferences.Editor editor = prefs.edit();
        if (args != null && args.has("enabled")) {
            editor.putBoolean(KEY_REQUESTED_ENABLED, args.optBoolean("enabled", false));
        }
        if (args != null && args.has("scope")) {
            editor.putString(KEY_SCOPE, sanitizeScope(args.optString("scope", "")));
        }
        editor.putString(KEY_LAST_CONFIG_SET_AT, Instant.now().toString());
        editor.apply();
        reevaluate();
        JSONObject out = status();
        Json.put(out, "saved", true);
        return out;
    }

    public synchronized JSONObject start(JSONObject args) {
        prefs.edit()
                .putBoolean(KEY_REQUESTED_ENABLED, true)
                .putString(KEY_LAST_START_REQUESTED_AT, Instant.now().toString())
                .apply();
        reevaluate();
        JSONObject out = status();
        Json.put(out, "start_requested", true);
        return out;
    }

    public synchronized JSONObject stop(JSONObject args) {
        prefs.edit()
                .putBoolean(KEY_REQUESTED_ENABLED, false)
                .putString(KEY_LAST_STOP_REQUESTED_AT, Instant.now().toString())
                .apply();
        reevaluate();
        JSONObject out = status();
        Json.put(out, "stop_requested", true);
        return out;
    }

    public synchronized JSONObject simulate(JSONObject args) {
        prefs.edit().putString(KEY_LAST_SIMULATE_REQUESTED_AT, Instant.now().toString()).apply();
        String requested = args == null ? "hey pucky" : args.optString("phrase", "hey pucky");
        String matchedPhrase = WakePhraseFamily.matchedPhrase(requested);
        JSONObject out = status();
        if (matchedPhrase.isEmpty()) {
            Json.put(out, "simulated", false);
            Json.put(out, "error_code", "invalid_wake_phrase");
            Json.put(out, "error_message", "wake.simulate phrase must match the hey_pucky wake family");
            return out;
        }
        boolean accepted = handleWakeAccepted(matchedPhrase, requested, "wake_simulate");
        out = status();
        Json.put(out, "simulated", accepted);
        Json.put(out, "simulated_phrase", matchedPhrase);
        return out;
    }

    public boolean enabled() {
        return requestedEnabled();
    }

    public void onTurnStarting(String turnId, String source) {
        synchronized (lock) {
            activeTurnId = turnId == null ? "" : turnId;
            activeTurnSource = source == null ? "" : source;
            stopSentinelLocked("turn_starting");
        }
    }

    public void onTurnStatusChanged(String turnId, String state, JSONObject detail) {
        boolean terminal = isTerminalState(state);
        synchronized (lock) {
            if (!activeTurnId.isEmpty() && activeTurnId.equals(turnId) && terminal) {
                clearTurnTrackingLocked();
            }
        }
        if (terminal) {
            reevaluate();
        }
    }

    private void reevaluate() {
        synchronized (lock) {
            if (!requestedEnabled()) {
                suspendedReason = "disabled";
                stopSentinelLocked("disabled");
                return;
            }
            if (!serviceStarted) {
                suspendedReason = "service_inactive";
                stopSentinelLocked("service_inactive");
                return;
            }
            if (SCOPE_ASSISTANT_SCREEN_OFF.equals(requestedScope())) {
                suspendedReason = "assistant_scope_not_implemented";
                stopSentinelLocked("assistant_scope_not_implemented");
                return;
            }
            if (!isWakeAllowedNowLocked()) {
                stopSentinelLocked(suspendedReason);
                return;
            }
            if (!activeTurnId.isEmpty() || confirmingCandidate) {
                suspendedReason = activeTurnId.isEmpty() ? "candidate_confirming" : "turn_active";
                stopSentinelLocked(suspendedReason);
                return;
            }
            if (!sentinelRunning) {
                startSentinelLocked();
            }
        }
    }

    private boolean handleWakeAccepted(String matchedPhrase, String transcript, String trigger) {
        JSONObject chime = recipeExecutor.playSuccessChime("pucky.wake_listening_chime.v1");
        synchronized (lock) {
            lastWakePhrase = matchedPhrase;
            lastWakeAt = Instant.now().toString();
            lastConfirmationTranscript = transcript == null ? matchedPhrase : transcript;
            lastError = "";
            suspendedReason = "wake_handoff";
        }
        try {
            JSONObject args = new JSONObject();
            Json.put(args, "feedback", false);
            Json.put(args, "max_duration_ms", MAX_TURN_MS);
            Json.put(args, "trigger_source", "wake_word");
            Json.put(args, "wake_phrase_family", WakePhraseFamily.ID);
            Json.put(args, "wake_phrase_detected", matchedPhrase);
            JSONObject started = PuckyTurnController.shared(context).start(args);
            String turnId = started.optString("turn_id", "");
            synchronized (lock) {
                activeTurnId = turnId;
                activeTurnSource = "wake_word";
                stopSentinelLocked("wake_handoff_started");
                turnMonitor = new WakeTurnMonitor(turnId);
                turnMonitor.start();
            }
            Log.i(TAG, "wake accepted trigger=" + trigger + " phrase=" + matchedPhrase
                    + " turn_id=" + turnId + " chime_played=" + chime.optBoolean("played", false));
            return true;
        } catch (Exception exc) {
            synchronized (lock) {
                lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
            }
            recipeExecutor.playFailureChime("pucky.wake_start_failure_chime.v1");
            reevaluate();
            return false;
        }
    }

    private void startSentinelLocked() {
        AudioFrameBus bus = new AudioFrameBus(context);
        PreRollBuffer preRoll = new PreRollBuffer();
        WakeCandidateRecorder recorder = new WakeCandidateRecorder();
        WalkieSpeechGate gate = new WalkieSpeechGate(SystemClock.elapsedRealtime(), new SileroVadEngine(context),
                SystemClock::elapsedRealtime, status -> onSentinelSpeechDetected());
        bus.addSynchronousConsumer(preRoll);
        bus.addSynchronousConsumer(recorder);
        bus.addConsumer(gate);
        JSONObject start = bus.start();
        if (!"started".equals(start.optString("result")) && !"already_running".equals(start.optString("result"))) {
            sentinelBus = null;
            preRollBuffer = null;
            candidateRecorder = null;
            sentinelRunning = false;
            suspendedReason = "audio_frame_bus_failed";
            lastError = start.optString("error", "audio_frame_bus_failed");
            return;
        }
        sentinelBus = bus;
        preRollBuffer = preRoll;
        candidateRecorder = recorder;
        sentinelRunning = true;
        candidateActive = false;
        confirmingCandidate = false;
        suspendedReason = "";
        lastError = "";
        sentinelStartedElapsedMs = SystemClock.elapsedRealtime();
        sentinelStartedWallMs = System.currentTimeMillis();
    }

    private void stopSentinelLocked(String reason) {
        if (candidateRecorder != null) {
            candidateRecorder.cancel();
        }
        candidateActive = false;
        if (sentinelBus != null) {
            try {
                sentinelBus.stop();
            } catch (RuntimeException ignored) {
            }
        }
        sentinelBus = null;
        preRollBuffer = null;
        candidateRecorder = null;
        sentinelRunning = false;
        if (reason != null && !reason.trim().isEmpty()) {
            suspendedReason = reason;
        }
    }

    private void onSentinelSpeechDetected() {
        short[] preRoll;
        synchronized (lock) {
            if (!sentinelRunning || candidateRecorder == null || candidateActive || confirmingCandidate) {
                return;
            }
            preRoll = preRollBuffer == null ? new short[0] : preRollBuffer.snapshotSamples();
            candidateRecorder.begin(preRoll);
            candidateActive = true;
            suspendedReason = "candidate_capturing";
        }
        Thread worker = new Thread(() -> {
            try {
                Thread.sleep(CANDIDATE_CAPTURE_MS);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
                synchronized (lock) {
                    candidateActive = false;
                    if (candidateRecorder != null) {
                        candidateRecorder.cancel();
                    }
                }
                reevaluate();
                return;
            }
            short[] candidateSamples;
            synchronized (lock) {
                if (candidateRecorder == null) {
                    candidateActive = false;
                    return;
                }
                candidateSamples = candidateRecorder.finish();
                candidateActive = false;
                confirmingCandidate = true;
                stopSentinelLocked("candidate_confirming");
            }
            confirmCandidate(candidateSamples);
        }, "pucky-wake-candidate");
        worker.setDaemon(true);
        worker.start();
    }

    private void confirmCandidate(short[] candidateSamples) {
        OnDeviceInjectedAudioRecognizer.RecognitionOutcome outcome =
                recognizer.recognize(OnDeviceInjectedAudioRecognizer.padSamplesForRecognition(candidateSamples),
                        CONFIRM_TIMEOUT_MS);
        String matchedPhrase = WakePhraseFamily.matchedPhrase(outcome.transcript);
        boolean accepted = !matchedPhrase.isEmpty() && acceptsSingleWordVariant(outcome, matchedPhrase);
        synchronized (lock) {
            confirmingCandidate = false;
            lastConfirmationTranscript = outcome.transcript;
            if (!outcome.succeeded) {
                lastError = outcome.errorCode + ": " + outcome.errorMessage;
            }
        }
        if (accepted && handleWakeAccepted(matchedPhrase, outcome.transcript, "voice")) {
            return;
        }
        reevaluate();
    }

    private boolean acceptsSingleWordVariant(OnDeviceInjectedAudioRecognizer.RecognitionOutcome outcome, String matchedPhrase) {
        if (!WakePhraseFamily.isSingleWordVariant(matchedPhrase)) {
            return true;
        }
        double topConfidence = topConfidence(outcome.confidences);
        return topConfidence < 0.0 || topConfidence >= SINGLE_WORD_CONFIDENCE_THRESHOLD;
    }

    private static double topConfidence(JSONArray confidences) {
        if (confidences == null || confidences.length() == 0) {
            return -1.0;
        }
        Object first = confidences.opt(0);
        if (!(first instanceof Number)) {
            return -1.0;
        }
        return ((Number) first).doubleValue();
    }

    private boolean isWakeAllowedNowLocked() {
        if (powerManager == null || !powerManager.isInteractive()) {
            suspendedReason = "screen_off";
            return false;
        }
        if (keyguardManager != null && keyguardManager.isKeyguardLocked()) {
            suspendedReason = "device_locked";
            return false;
        }
        suspendedReason = "";
        return true;
    }

    private void registerReceiverLocked() {
        if (receiverRegistered) {
            return;
        }
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        main.post(() -> {
            try {
                context.registerReceiver(deviceStateReceiver, filter);
            } catch (RuntimeException exc) {
                Log.w(TAG, "wake receiver register failed: " + exc.getMessage());
            }
        });
        receiverRegistered = true;
    }

    private void unregisterReceiverLocked() {
        if (!receiverRegistered) {
            return;
        }
        main.post(() -> {
            try {
                context.unregisterReceiver(deviceStateReceiver);
            } catch (RuntimeException ignored) {
            }
        });
        receiverRegistered = false;
    }

    private void clearTurnTracking(boolean rearm) {
        synchronized (lock) {
            clearTurnTrackingLocked();
        }
        if (rearm) {
            reevaluate();
        }
    }

    private void clearTurnTrackingLocked() {
        activeTurnId = "";
        activeTurnSource = "";
        if (turnMonitor != null) {
            turnMonitor.cancel();
            turnMonitor = null;
        }
    }

    private boolean requestedEnabled() {
        return prefs.getBoolean(KEY_REQUESTED_ENABLED, false);
    }

    private String requestedScope() {
        return sanitizeScope(prefs.getString(KEY_SCOPE, SCOPE_UNLOCKED_SERVICE));
    }

    private static String sanitizeScope(String raw) {
        String scope = raw == null ? "" : raw.trim();
        if (SCOPE_ASSISTANT_SCREEN_OFF.equals(scope)) {
            return SCOPE_ASSISTANT_SCREEN_OFF;
        }
        return SCOPE_UNLOCKED_SERVICE;
    }

    private static JSONArray supportedScopes() {
        JSONArray out = new JSONArray();
        Json.add(out, SCOPE_UNLOCKED_SERVICE);
        Json.add(out, SCOPE_ASSISTANT_SCREEN_OFF);
        return out;
    }

    private static boolean isTerminalState(String state) {
        return "discarded_silence".equals(state)
                || "completed".equals(state)
                || "failed".equals(state)
                || "upload_blocked".equals(state)
                || "idle".equals(state);
    }

    private static Object nullable(String value) {
        return value == null || value.trim().isEmpty() ? JSONObject.NULL : value;
    }

    private final class WakeTurnMonitor extends Thread {
        private final String turnId;
        private final WakeTurnMonitorPolicy policy;
        private final long startedMs;
        private volatile boolean cancelled;

        WakeTurnMonitor(String turnId) {
            super("pucky-wake-turn-monitor");
            this.turnId = turnId;
            this.policy = new WakeTurnMonitorPolicy(
                    SPEECH_START_TIMEOUT_MS,
                    TRAILING_SILENCE_MS,
                    MAX_TURN_MS,
                    TURN_SPEECH_THRESHOLD);
            this.startedMs = SystemClock.elapsedRealtime();
            setDaemon(true);
        }

        void cancel() {
            cancelled = true;
            interrupt();
        }

        @Override
        public void run() {
            while (!cancelled) {
                JSONObject voice = WalkieAudioCaptureController.shared(context).status();
                JSONObject active = voice.optJSONObject("active_session");
                JSONObject gate = voice.optJSONObject("speech_gate");
                if (active == null || !turnId.equals(active.optString("turn_id", ""))) {
                    return;
                }
                long nowMs = SystemClock.elapsedRealtime();
                WakeTurnMonitorPolicy.Action action = policy.observe(
                        startedMs,
                        nowMs,
                        gate != null && gate.optBoolean("speech_detected", false),
                        gate == null ? 0.0 : gate.optDouble("vad_probability", 0.0));
                if (action == WakeTurnMonitorPolicy.Action.STOP_NO_SPEECH) {
                    stopWakeTurn("wake_no_speech_timeout", true);
                    return;
                }
                if (action == WakeTurnMonitorPolicy.Action.STOP_ENDPOINT) {
                    stopWakeTurn("wake_auto_endpoint", false);
                    return;
                }
                if (action == WakeTurnMonitorPolicy.Action.STOP_MAX_DURATION) {
                    stopWakeTurn("wake_max_duration", false);
                    return;
                }
                try {
                    Thread.sleep(100L);
                } catch (InterruptedException exc) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }

        private void stopWakeTurn(String reason, boolean failureChime) {
            try {
                JSONObject args = new JSONObject();
                Json.put(args, "reason", reason);
                Json.put(args, "feedback", false);
                PuckyTurnController.shared(context).stop(args);
            } catch (Exception exc) {
                synchronized (lock) {
                    lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
                }
            }
            if (failureChime) {
                recipeExecutor.playFailureChime("pucky.wake_no_speech_failure_chime.v1");
            }
        }
    }

    private static final class WakeCandidateRecorder implements AudioFrameConsumer {
        private short[] samples = new short[0];
        private boolean collecting;

        @Override
        public String name() {
            return "wake_candidate_recorder";
        }

        @Override
        public synchronized void onFrame(short[] frame, long timestampNanos) {
            if (!collecting || frame == null || frame.length == 0) {
                return;
            }
            append(frame);
        }

        @Override
        public synchronized JSONObject snapshot() {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.wake_candidate_recorder.v1");
            Json.put(out, "collecting", collecting);
            Json.put(out, "samples", samples.length);
            return out;
        }

        synchronized void begin(short[] preRoll) {
            samples = preRoll == null ? new short[0] : Arrays.copyOf(preRoll, preRoll.length);
            collecting = true;
        }

        synchronized short[] finish() {
            collecting = false;
            return Arrays.copyOf(samples, samples.length);
        }

        synchronized void cancel() {
            collecting = false;
            samples = new short[0];
        }

        private void append(short[] frame) {
            short[] next = Arrays.copyOf(samples, samples.length + frame.length);
            System.arraycopy(frame, 0, next, samples.length, frame.length);
            samples = next;
        }
    }
}
