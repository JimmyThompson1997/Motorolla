package com.pucky.device.wake;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.pucky.device.assistant.PuckyAssistantController;
import com.pucky.device.speech.RecipeDevicePrimitiveExecutor;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Locale;

public final class WakeWordController {
    private static final String TAG = "PuckyWakeWord";
    private static final String PREFS = "pucky_wake_word";

    private static final String KEY_REQUESTED_ENABLED = "requested_enabled";
    private static final String KEY_SCOPE = "scope";
    private static final String KEY_LAST_CONFIG_SET_AT = "last_config_set_at";
    private static final String KEY_LAST_START_REQUESTED_AT = "last_start_requested_at";
    private static final String KEY_LAST_STOP_REQUESTED_AT = "last_stop_requested_at";
    private static final String KEY_LAST_SIMULATE_REQUESTED_AT = "last_simulate_requested_at";
    private static final String KEY_TRANSCRIPT_HISTORY_JSON = "transcript_history_json";
    private static final String KEY_LAST_RESTART_REASON = "last_restart_reason";
    private static final String KEY_RESTART_COUNT = "restart_count";
    private static final String KEY_LAST_ERROR_CODE = "last_error_code";
    private static final String KEY_LAST_ERROR_MESSAGE = "last_error_message";
    private static final String KEY_LAST_EVENT_AT = "last_event_at";
    private static final String KEY_LAST_TRANSCRIPT = "last_transcript";
    private static final String KEY_LAST_MATCHED_PHRASE = "last_matched_phrase";
    private static final String KEY_LAST_MATCH_SOURCE = "last_match_source";
    private static final String KEY_LAST_MATCH_AT = "last_match_at";

    private static final String MODE_TRANSCRIPT_LAB = "transcript_lab";
    private static final String ENGINE_TRANSCRIPT_LAB = "android_stt_transcript_lab";
    private static final String DEFAULT_SCOPE = "awake_and_unlocked_foreground";
    private static final String SCOPE_ASSISTANT_RESERVED = "assistant_screen_off_reserved";
    private static final int MAX_TRANSCRIPT_EVENTS = 10;
    private static final long PROOF_WINDOW_MS = 3000L;
    private static final long RESTART_BASE_MS = 1000L;
    private static final long RESTART_MAX_MS = 10000L;
    private static final long RESTART_THROTTLED_MS = 8000L;

    private static WakeWordController instance;

    public static synchronized WakeWordController shared(Context context) {
        if (instance == null) {
            instance = new WakeWordController(context.getApplicationContext());
        }
        return instance;
    }

    private final Context context;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final RecipeDevicePrimitiveExecutor recipeExecutor;
    private final PowerManager powerManager;
    private final KeyguardManager keyguardManager;
    private final Object lock = new Object();

    private BroadcastReceiver screenReceiver;
    private boolean receiverRegistered;
    private boolean serviceStarted;
    private boolean running;
    private boolean recognizerListening;
    private String recognizerState = "idle";
    private String suspendedReason = "";
    private SpeechRecognizer recognizer;
    private int sessionCounter;
    private String activeSessionId = "";
    private String matchedSessionId = "";
    private long sessionStartElapsedMs;
    private long readyElapsedMs;
    private long speechBeginElapsedMs;
    private long firstPartialElapsedMs;
    private long finalOrErrorElapsedMs;
    private long proofUntilElapsedMs;
    private String proofMatchedPhrase = "";
    private String proofTranscript = "";
    private String activeTurnId = "";
    private String activeTurnSource = "";

    private final Runnable restartRunnable = new Runnable() {
        @Override
        public void run() {
            synchronized (lock) {
                if (!running || hasActiveTurnLocked()) {
                    return;
                }
                startRecognizerSessionLocked("scheduled_restart");
            }
        }
    };

    private WakeWordController(Context context) {
        this.context = context;
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.recipeExecutor = new RecipeDevicePrimitiveExecutor(context);
        this.powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        this.keyguardManager = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
    }

    public JSONObject status() {
        synchronized (lock) {
            JSONObject out = new JSONObject();
            boolean requested = isRequestedEnabledLocked();
            Json.put(out, "schema", "pucky.wake_word_status.v2");
            Json.put(out, "wake_word", "Hey Pucky");
            Json.put(out, "wake_family", WakePhraseFamily.statusJson());
            Json.put(out, "enabled", requested);
            Json.put(out, "configured", requested);
            Json.put(out, "requested_enabled", requested);
            Json.put(out, "running", running);
            Json.put(out, "service_started", serviceStarted);
            Json.put(out, "mode", MODE_TRANSCRIPT_LAB);
            Json.put(out, "engine", ENGINE_TRANSCRIPT_LAB);
            Json.put(out, "requested_engine", ENGINE_TRANSCRIPT_LAB);
            Json.put(out, "effective_engine", running ? ENGINE_TRANSCRIPT_LAB : "stopped");
            Json.put(out, "scope", prefs.getString(KEY_SCOPE, DEFAULT_SCOPE));
            Json.put(out, "supported_scopes", supportedScopesJson());
            Json.put(out, "suspended_reason", suspendedReason);
            Json.put(out, "recognizer_state", recognizerState);
            Json.put(out, "recognizer_listening", recognizerListening);
            Json.put(out, "session_id", activeSessionId);
            Json.put(out, "restart_count", prefs.getInt(KEY_RESTART_COUNT, 0));
            Json.put(out, "last_restart_reason", prefs.getString(KEY_LAST_RESTART_REASON, ""));
            Json.put(out, "last_error_code", prefs.getInt(KEY_LAST_ERROR_CODE, 0));
            Json.put(out, "last_error_message", prefs.getString(KEY_LAST_ERROR_MESSAGE, ""));
            Json.put(out, "last_event_at", prefs.getString(KEY_LAST_EVENT_AT, ""));
            Json.put(out, "last_transcript", prefs.getString(KEY_LAST_TRANSCRIPT, ""));
            Json.put(out, "last_match", lastMatchJsonLocked());
            Json.put(out, "proof_indicator", proofIndicatorJsonLocked());
            Json.put(out, "transcript_history", transcriptHistoryJsonLocked());
            Json.put(out, "last_transcript_event", lastTranscriptEventLocked());
            Json.put(out, "assistant_status", PuckyAssistantController.status(context));
            Json.put(out, "last_config_set_at", prefs.getString(KEY_LAST_CONFIG_SET_AT, ""));
            Json.put(out, "last_start_requested_at", prefs.getString(KEY_LAST_START_REQUESTED_AT, ""));
            Json.put(out, "last_stop_requested_at", prefs.getString(KEY_LAST_STOP_REQUESTED_AT, ""));
            Json.put(out, "last_simulate_requested_at", prefs.getString(KEY_LAST_SIMULATE_REQUESTED_AT, ""));
            return out;
        }
    }

    public JSONObject configSet(JSONObject args) {
        boolean enabled = args != null && args.has("enabled")
                ? args.optBoolean("enabled", isRequestedEnabled())
                : isRequestedEnabled();
        String scope = args == null ? DEFAULT_SCOPE : args.optString("scope", DEFAULT_SCOPE).trim();
        if (scope.isEmpty()) {
            scope = DEFAULT_SCOPE;
        }
        if (!DEFAULT_SCOPE.equals(scope) && !SCOPE_ASSISTANT_RESERVED.equals(scope)) {
            throw new IllegalArgumentException("unsupported wake scope: " + scope);
        }
        prefs.edit()
                .putBoolean(KEY_REQUESTED_ENABLED, enabled)
                .putString(KEY_SCOPE, scope)
                .putString(KEY_LAST_CONFIG_SET_AT, nowIso())
                .apply();
        reevaluate("config_set");
        return status();
    }

    public JSONObject start(JSONObject args) {
        prefs.edit()
                .putBoolean(KEY_REQUESTED_ENABLED, true)
                .putString(KEY_LAST_START_REQUESTED_AT, nowIso())
                .apply();
        reevaluate("start_command");
        return status();
    }

    public JSONObject stop(JSONObject args) {
        prefs.edit()
                .putBoolean(KEY_REQUESTED_ENABLED, false)
                .putString(KEY_LAST_STOP_REQUESTED_AT, nowIso())
                .apply();
        reevaluate("stop_command");
        return status();
    }

    public JSONObject simulate(JSONObject args) {
        String phrase = args == null ? "" : args.optString("phrase", args.optString("text", "")).trim();
        if (phrase.isEmpty()) {
            throw new IllegalArgumentException("wake.simulate requires phrase");
        }
        prefs.edit().putString(KEY_LAST_SIMULATE_REQUESTED_AT, nowIso()).apply();
        JSONArray alternatives = new JSONArray();
        Json.add(alternatives, phrase);
        TranscriptEvent event = recordTranscriptEvent("simulate", alternatives, new JSONArray(), 0, "");
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.wake_simulate.v2");
        Json.put(out, "accepted", event.accepted);
        Json.put(out, "transcript", phrase);
        Json.put(out, "matched_phrase", event.matchedPhrase);
        Json.put(out, "proof_indicator", proofIndicatorJsonLockedSafe());
        return out;
    }

    public boolean enabled() {
        return isRequestedEnabled();
    }

    public void onServiceStarted() {
        synchronized (lock) {
            serviceStarted = true;
            registerReceiverLocked();
        }
        reevaluate("service_started");
    }

    public void onServiceStopped() {
        synchronized (lock) {
            serviceStarted = false;
            unregisterReceiverLocked();
            stopLabLocked("service_stopped");
        }
    }

    public void onTurnStarting(String turnId, String source) {
        synchronized (lock) {
            activeTurnId = safe(turnId);
            activeTurnSource = safe(source);
            stopLabLocked("turn_active");
        }
    }

    public void onTurnStatusChanged(String turnId, String state, JSONObject status) {
        synchronized (lock) {
            if (activeTurnId.isEmpty() || activeTurnId.equals(safe(turnId)) || isTerminalTurnState(state)) {
                if (isTerminalTurnState(state)) {
                    activeTurnId = "";
                    activeTurnSource = "";
                }
            }
        }
        if (isTerminalTurnState(state)) {
            reevaluate("turn_idle");
        }
    }

    private void reevaluate(String reason) {
        synchronized (lock) {
            if (!isRequestedEnabledLocked()) {
                stopLabLocked("disabled");
                return;
            }
            if (!serviceStarted) {
                stopLabLocked("service_not_started");
                return;
            }
            String scope = prefs.getString(KEY_SCOPE, DEFAULT_SCOPE);
            if (SCOPE_ASSISTANT_RESERVED.equals(scope)) {
                stopLabLocked("assistant_scope_reserved");
                return;
            }
            if (!isDeviceInteractiveLocked()) {
                stopLabLocked("device_not_interactive");
                return;
            }
            if (isDeviceLockedLocked()) {
                stopLabLocked("device_locked");
                return;
            }
            if (hasActiveTurnLocked()) {
                stopLabLocked("turn_active");
                return;
            }
            if (!hasRecordAudioPermission()) {
                stopLabLocked("record_audio_permission_missing");
                return;
            }
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                    || !SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
                stopLabLocked("on_device_speech_recognizer_unavailable");
                return;
            }
            if (!running) {
                running = true;
                suspendedReason = "";
                recognizerState = "starting";
                recognizerListening = false;
                prefs.edit()
                        .putInt(KEY_RESTART_COUNT, 0)
                        .putString(KEY_LAST_RESTART_REASON, reason)
                        .apply();
                startRecognizerSessionLocked(reason);
                return;
            }
            if (recognizer == null && !"starting".equals(recognizerState)) {
                startRecognizerSessionLocked(reason);
            }
        }
    }

    private void startRecognizerSessionLocked(String reason) {
        if (!running || hasActiveTurnLocked()) {
            return;
        }
        main.removeCallbacks(restartRunnable);
        cleanupRecognizerOnMain();
        sessionCounter += 1;
        activeSessionId = "wake-lab-" + sessionCounter;
        matchedSessionId = "";
        sessionStartElapsedMs = SystemClock.elapsedRealtime();
        readyElapsedMs = 0L;
        speechBeginElapsedMs = 0L;
        firstPartialElapsedMs = 0L;
        finalOrErrorElapsedMs = 0L;
        recognizerState = "starting";
        recognizerListening = false;
        prefs.edit().putString(KEY_LAST_RESTART_REASON, reason).apply();
        Log.i(TAG, "transcript_lab session_start session=" + activeSessionId + " reason=" + reason);
        String sessionId = activeSessionId;
        main.post(() -> startRecognizerOnMain(sessionId));
    }

    private void startRecognizerOnMain(String sessionId) {
        synchronized (lock) {
            if (!running || !sessionId.equals(activeSessionId) || hasActiveTurnLocked()) {
                return;
            }
            try {
                recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
                recognizer.setRecognitionListener(new LabRecognitionListener(sessionId));
                recognizerState = "listening";
                recognizerListening = true;
                recognizer.startListening(recognizerIntent());
            } catch (Exception exc) {
                recognizerState = "error";
                recognizerListening = false;
                recordErrorLocked(0, exc.getClass().getSimpleName() + ": " + exc.getMessage());
                Log.i(TAG, "transcript_lab error session=" + sessionId + " message=" + exc.getMessage());
                scheduleRestartLocked("start_error");
            }
        }
    }

    private Intent recognizerIntent() {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag());
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
        intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
        return intent;
    }

    private TranscriptEvent recordTranscriptEvent(
            String eventType,
            JSONArray alternatives,
            JSONArray confidences,
            int errorCode,
            String errorMessage) {
        TranscriptEvent event = new TranscriptEvent();
        long nowElapsed = SystemClock.elapsedRealtime();
        String transcript = alternatives.length() > 0 ? alternatives.optString(0, "") : "";
        String matched = WakePhraseFamily.matchedPhrasePrefix(alternatives);
        event.accepted = !matched.isEmpty();
        event.matchedPhrase = matched;
        synchronized (lock) {
            if ("partial".equals(eventType) && firstPartialElapsedMs == 0L) {
                firstPartialElapsedMs = nowElapsed;
            }
            if ("final".equals(eventType) || "error".equals(eventType)) {
                finalOrErrorElapsedMs = nowElapsed;
            }
            JSONObject item = new JSONObject();
            Json.put(item, "schema", "pucky.wake_transcript_event.v1");
            Json.put(item, "event", eventType);
            Json.put(item, "at", nowIso());
            Json.put(item, "session_id", activeSessionId);
            Json.put(item, "transcript", transcript);
            Json.put(item, "alternatives", alternatives);
            Json.put(item, "confidences", confidences);
            Json.put(item, "accepted", event.accepted);
            Json.put(item, "matched_phrase", matched);
            Json.put(item, "match_source", event.accepted ? eventType : "");
            Json.put(item, "error_code", errorCode);
            Json.put(item, "error_message", safe(errorMessage));
            Json.put(item, "timing", timingJsonLocked(nowElapsed));
            appendTranscriptHistoryLocked(item);
            SharedPreferences.Editor editor = prefs.edit()
                    .putString(KEY_LAST_EVENT_AT, item.optString("at", ""))
                    .putString(KEY_LAST_TRANSCRIPT, transcript);
            if (errorCode != 0 || !safe(errorMessage).isEmpty()) {
                editor.putInt(KEY_LAST_ERROR_CODE, errorCode)
                        .putString(KEY_LAST_ERROR_MESSAGE, safe(errorMessage));
            }
            if (event.accepted) {
                editor.putString(KEY_LAST_MATCHED_PHRASE, matched)
                        .putString(KEY_LAST_MATCH_SOURCE, eventType)
                        .putString(KEY_LAST_MATCH_AT, item.optString("at", ""));
                proofUntilElapsedMs = nowElapsed + PROOF_WINDOW_MS;
                proofMatchedPhrase = matched;
                proofTranscript = transcript;
            }
            editor.apply();
        }
        if (event.accepted) {
            playProofChimeOnce(eventType, transcript, matched);
        }
        return event;
    }

    private void playProofChimeOnce(String eventType, String transcript, String matched) {
        boolean shouldPlay;
        synchronized (lock) {
            shouldPlay = activeSessionId.isEmpty() || !activeSessionId.equals(matchedSessionId);
            if (shouldPlay && !activeSessionId.isEmpty()) {
                matchedSessionId = activeSessionId;
            }
        }
        Log.i(TAG, "transcript_lab " + eventType + " transcript=" + transcript
                + " matched=" + matched + " accepted=true");
        if (shouldPlay) {
            recipeExecutor.playWakeListeningChime("pucky.wake_transcript_lab_match_chime.v1");
        }
    }

    private void appendTranscriptHistoryLocked(JSONObject item) {
        JSONArray current = transcriptHistoryJsonLocked();
        JSONArray next = new JSONArray();
        Json.add(next, item);
        for (int i = 0; i < current.length() && next.length() < MAX_TRANSCRIPT_EVENTS; i++) {
            Json.add(next, current.optJSONObject(i) == null ? current.opt(i) : current.optJSONObject(i));
        }
        prefs.edit().putString(KEY_TRANSCRIPT_HISTORY_JSON, next.toString()).apply();
    }

    private void scheduleRestartLocked(String reason) {
        if (!running || hasActiveTurnLocked()) {
            return;
        }
        int count = prefs.getInt(KEY_RESTART_COUNT, 0) + 1;
        long delay = restartDelayMs(reason, count);
        prefs.edit()
                .putInt(KEY_RESTART_COUNT, count)
                .putString(KEY_LAST_RESTART_REASON, reason)
                .apply();
        recognizerState = "restarting";
        recognizerListening = false;
        Log.i(TAG, "transcript_lab restart session=" + activeSessionId
                + " reason=" + reason + " delay_ms=" + delay + " count=" + count);
        main.removeCallbacks(restartRunnable);
        main.postDelayed(restartRunnable, delay);
    }

    private void stopLabLocked(String reason) {
        if (!running && recognizer == null) {
            suspendedReason = reason;
            recognizerState = "idle";
            recognizerListening = false;
            return;
        }
        running = false;
        suspendedReason = reason;
        recognizerState = "idle";
        recognizerListening = false;
        activeSessionId = "";
        matchedSessionId = "";
        main.removeCallbacks(restartRunnable);
        cleanupRecognizerOnMain();
        Log.i(TAG, "transcript_lab stopped reason=" + reason);
    }

    private void cleanupRecognizerOnMain() {
        SpeechRecognizer toDestroy = recognizer;
        recognizer = null;
        if (toDestroy == null) {
            return;
        }
        main.post(() -> {
            try {
                toDestroy.cancel();
            } catch (Exception ignored) {
            }
            try {
                toDestroy.destroy();
            } catch (Exception ignored) {
            }
        });
    }

    private void recordErrorLocked(int code, String message) {
        prefs.edit()
                .putInt(KEY_LAST_ERROR_CODE, code)
                .putString(KEY_LAST_ERROR_MESSAGE, safe(message))
                .apply();
    }

    private boolean isRequestedEnabled() {
        synchronized (lock) {
            return isRequestedEnabledLocked();
        }
    }

    private boolean isRequestedEnabledLocked() {
        return prefs.getBoolean(KEY_REQUESTED_ENABLED, false);
    }

    private boolean hasRecordAudioPermission() {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isDeviceInteractiveLocked() {
        return powerManager == null || powerManager.isInteractive();
    }

    private boolean isDeviceLockedLocked() {
        return keyguardManager != null && keyguardManager.isKeyguardLocked();
    }

    private boolean hasActiveTurnLocked() {
        return !activeTurnId.isEmpty();
    }

    private JSONObject timingJsonLocked(long nowElapsedMs) {
        JSONObject out = new JSONObject();
        Json.put(out, "session_elapsed_ms", elapsedSince(sessionStartElapsedMs, nowElapsedMs));
        Json.put(out, "ready_elapsed_ms", elapsedSince(sessionStartElapsedMs, readyElapsedMs));
        Json.put(out, "speech_begin_elapsed_ms", elapsedSince(sessionStartElapsedMs, speechBeginElapsedMs));
        Json.put(out, "first_partial_elapsed_ms", elapsedSince(sessionStartElapsedMs, firstPartialElapsedMs));
        Json.put(out, "final_or_error_elapsed_ms", elapsedSince(sessionStartElapsedMs, finalOrErrorElapsedMs));
        return out;
    }

    private JSONObject lastMatchJsonLocked() {
        JSONObject out = new JSONObject();
        Json.put(out, "matched_phrase", prefs.getString(KEY_LAST_MATCHED_PHRASE, ""));
        Json.put(out, "match_source", prefs.getString(KEY_LAST_MATCH_SOURCE, ""));
        Json.put(out, "matched_at", prefs.getString(KEY_LAST_MATCH_AT, ""));
        return out;
    }

    private JSONObject proofIndicatorJsonLockedSafe() {
        synchronized (lock) {
            return proofIndicatorJsonLocked();
        }
    }

    private JSONObject proofIndicatorJsonLocked() {
        long nowElapsed = SystemClock.elapsedRealtime();
        long remaining = Math.max(0L, proofUntilElapsedMs - nowElapsed);
        boolean active = remaining > 0L;
        JSONObject out = new JSONObject();
        Json.put(out, "active", active);
        Json.put(out, "visual_state", active ? "armed" : "idle");
        Json.put(out, "matched_phrase", active ? proofMatchedPhrase : prefs.getString(KEY_LAST_MATCHED_PHRASE, ""));
        Json.put(out, "transcript", active ? proofTranscript : prefs.getString(KEY_LAST_TRANSCRIPT, ""));
        Json.put(out, "remaining_ms", remaining);
        Json.put(out, "expires_at_elapsed_ms", proofUntilElapsedMs);
        return out;
    }

    private JSONArray transcriptHistoryJsonLocked() {
        String raw = prefs.getString(KEY_TRANSCRIPT_HISTORY_JSON, "[]");
        try {
            return new JSONArray(raw == null || raw.isEmpty() ? "[]" : raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private JSONObject lastTranscriptEventLocked() {
        JSONArray history = transcriptHistoryJsonLocked();
        JSONObject item = history.optJSONObject(0);
        return item == null ? new JSONObject() : item;
    }

    private JSONArray supportedScopesJson() {
        JSONArray out = new JSONArray();
        Json.add(out, DEFAULT_SCOPE);
        Json.add(out, SCOPE_ASSISTANT_RESERVED);
        return out;
    }

    private void registerReceiverLocked() {
        if (receiverRegistered) {
            return;
        }
        screenReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ignoredContext, Intent ignoredIntent) {
                reevaluate("device_state_changed");
            }
        };
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(screenReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(screenReceiver, filter);
        }
        receiverRegistered = true;
    }

    private void unregisterReceiverLocked() {
        if (!receiverRegistered || screenReceiver == null) {
            return;
        }
        try {
            context.unregisterReceiver(screenReceiver);
        } catch (Exception ignored) {
        }
        receiverRegistered = false;
        screenReceiver = null;
    }

    private static long elapsedSince(long startMs, long endMs) {
        if (startMs <= 0L || endMs <= 0L || endMs < startMs) {
            return 0L;
        }
        return endMs - startMs;
    }

    private static String nowIso() {
        return Instant.now().toString();
    }

    private static String safe(String value) {
        return value == null ? "" : value;
    }

    private static boolean isTerminalTurnState(String state) {
        String normalized = safe(state).trim().toLowerCase(Locale.US);
        return "succeeded".equals(normalized)
                || "failed".equals(normalized)
                || "cancelled".equals(normalized)
                || "canceled".equals(normalized)
                || "idle".equals(normalized)
                || "complete".equals(normalized)
                || "completed".equals(normalized);
    }

    private final class LabRecognitionListener implements RecognitionListener {
        private final String sessionId;

        LabRecognitionListener(String sessionId) {
            this.sessionId = sessionId;
        }

        @Override
        public void onReadyForSpeech(Bundle params) {
            synchronized (lock) {
                if (!sessionId.equals(activeSessionId)) {
                    return;
                }
                readyElapsedMs = SystemClock.elapsedRealtime();
                recognizerState = "ready";
                recognizerListening = true;
            }
            Log.i(TAG, "transcript_lab ready session=" + sessionId);
        }

        @Override
        public void onBeginningOfSpeech() {
            synchronized (lock) {
                if (!sessionId.equals(activeSessionId)) {
                    return;
                }
                speechBeginElapsedMs = SystemClock.elapsedRealtime();
                recognizerState = "speech";
            }
            Log.i(TAG, "transcript_lab speech_begin session=" + sessionId);
        }

        @Override
        public void onRmsChanged(float rmsdB) {
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
        }

        @Override
        public void onEndOfSpeech() {
            synchronized (lock) {
                if (sessionId.equals(activeSessionId)) {
                    recognizerState = "speech_end";
                }
            }
            Log.i(TAG, "transcript_lab speech_end session=" + sessionId);
        }

        @Override
        public void onError(int error) {
            String message = speechErrorName(error);
            synchronized (lock) {
                if (!sessionId.equals(activeSessionId)) {
                    return;
                }
                recognizerState = "error";
                recognizerListening = false;
                recordErrorLocked(error, message);
            }
            JSONArray alternatives = new JSONArray();
            recordTranscriptEvent("error", alternatives, new JSONArray(), error, message);
            Log.i(TAG, "transcript_lab error session=" + sessionId + " code=" + error + " message=" + message);
            synchronized (lock) {
                if (sessionId.equals(activeSessionId)) {
                    scheduleRestartLocked("recognizer_error_" + error);
                }
            }
        }

        @Override
        public void onResults(Bundle results) {
            JSONArray alternatives = alternativesFrom(results);
            JSONArray confidences = confidencesFrom(results);
            TranscriptEvent event = recordTranscriptEvent("final", alternatives, confidences, 0, "");
            Log.i(TAG, "transcript_lab final session=" + sessionId
                    + " transcript=" + alternatives.optString(0, "")
                    + " accepted=" + event.accepted
                    + " matched=" + event.matchedPhrase);
            synchronized (lock) {
                if (sessionId.equals(activeSessionId)) {
                    recognizerState = "final";
                    recognizerListening = false;
                    scheduleRestartLocked("final_result");
                }
            }
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            JSONArray alternatives = alternativesFrom(partialResults);
            JSONArray confidences = confidencesFrom(partialResults);
            TranscriptEvent event = recordTranscriptEvent("partial", alternatives, confidences, 0, "");
            Log.i(TAG, "transcript_lab partial session=" + sessionId
                    + " transcript=" + alternatives.optString(0, "")
                    + " accepted=" + event.accepted
                    + " matched=" + event.matchedPhrase);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
        }
    }

    private static JSONArray alternativesFrom(Bundle bundle) {
        JSONArray out = new JSONArray();
        if (bundle == null) {
            return out;
        }
        ArrayList<String> values = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        if (values == null) {
            return out;
        }
        for (String value : values) {
            Json.add(out, safe(value));
        }
        return out;
    }

    private static JSONArray confidencesFrom(Bundle bundle) {
        JSONArray out = new JSONArray();
        if (bundle == null) {
            return out;
        }
        float[] values = bundle.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
        if (values == null) {
            return out;
        }
        for (float value : values) {
            Json.add(out, value);
        }
        return out;
    }

    private static String speechErrorName(int error) {
        switch (error) {
            case SpeechRecognizer.ERROR_AUDIO:
                return "ERROR_AUDIO";
            case SpeechRecognizer.ERROR_CLIENT:
                return "ERROR_CLIENT";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "ERROR_INSUFFICIENT_PERMISSIONS";
            case SpeechRecognizer.ERROR_NETWORK:
                return "ERROR_NETWORK";
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                return "ERROR_NETWORK_TIMEOUT";
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "ERROR_NO_MATCH";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "ERROR_RECOGNIZER_BUSY";
            case SpeechRecognizer.ERROR_SERVER:
                return "ERROR_SERVER";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "ERROR_SPEECH_TIMEOUT";
            case 11:
                return "ERROR_TOO_MANY_REQUESTS";
            default:
                return "ERROR_" + error;
        }
    }

    private static long restartDelayMs(String reason, int count) {
        String normalized = safe(reason).toLowerCase(Locale.US);
        if (normalized.contains("_11") || normalized.contains("too_many_requests")) {
            return RESTART_THROTTLED_MS;
        }
        return Math.min(RESTART_MAX_MS, RESTART_BASE_MS * Math.max(1, count));
    }

    private static final class TranscriptEvent {
        boolean accepted;
        String matchedPhrase = "";
    }
}
