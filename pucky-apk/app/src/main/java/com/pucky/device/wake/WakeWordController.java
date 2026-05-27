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
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.speech.SpeechRecognizer;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.pucky.device.BuildConfig;
import com.pucky.device.assistant.PuckyAssistantController;
import com.pucky.device.pucky.PuckyTurnController;
import com.pucky.device.speech.RecipeDevicePrimitiveExecutor;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
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
    private static final String KEY_LAST_MATCHED_PHRASE = "last_matched_phrase";
    private static final String KEY_LAST_MATCH_SOURCE = "last_match_source";
    private static final String KEY_LAST_MATCH_AT = "last_match_at";
    private static final String KEY_TRANSCRIPT_HISTORY_JSON = "transcript_history_json";
    private static final String KEY_LAST_TRANSCRIPT = "last_transcript";
    private static final String KEY_LAST_ALTERNATIVES_JSON = "last_alternatives_json";
    private static final String KEY_LAST_ERROR_CODE = "last_error_code";
    private static final String KEY_LAST_ERROR_MESSAGE = "last_error_message";
    private static final String KEY_LAST_ERROR_AT = "last_error_at";
    private static final String KEY_LAST_ARM_AT = "last_arm_at";
    private static final String KEY_LAST_DISARM_AT = "last_disarm_at";
    private static final String KEY_LAST_DISARM_REASON = "last_disarm_reason";
    private static final String KEY_LAST_HANDOFF_AT = "last_handoff_at";
    private static final String KEY_LAST_HANDOFF_RESULT = "last_handoff_result";
    private static final String KEY_DEBUG_RECOGNIZER_MODE = "debug_recognizer_mode";
    private static final String KEY_DEBUG_TURN_CAPTURE_SOURCE = "debug_turn_capture_source";
    private static final String KEY_DEBUG_TURN_FIXTURE_NAME = "debug_turn_fixture_name";
    private static final String KEY_DEBUG_TURN_FIXTURE_TRANSCRIPT = "debug_turn_fixture_transcript";
    private static final String KEY_DEBUG_TURN_FIXTURE_START_DELAY_MS = "debug_turn_fixture_start_delay_ms";
    private static final String KEY_PREFS_SCHEMA = "prefs_schema";

    private static final String MODE_ANDROID_STT_WAKE = "android_stt_wake";
    private static final String ENGINE_ANDROID_STT_SENTINEL = "android_stt_sentinel";
    private static final String DEBUG_RECOGNIZER_MODE_ANDROID = "android";
    private static final String DEBUG_RECOGNIZER_MODE_FAKE = "fake";
    private static final String DEFAULT_SCOPE = "awake_and_unlocked_foreground";
    private static final String SCOPE_ASSISTANT_RESERVED = "assistant_screen_off_reserved";
    private static final long PROOF_WINDOW_MS = 3000L;
    private static final long LATCHED_WAKE_DEBOUNCE_MS = 250L;
    private static final int MAX_HISTORY = 10;
    private static final int PREFS_SCHEMA_V4 = 4;

    private static final String[] LEGACY_WAKE_KEYS = new String[] {
            "last_candidate_json",
            "last_confirmation_json",
            "last_reject_reason",
            "last_candidate_at",
            "last_candidate_duration_ms",
            "last_candidate_samples",
            "last_confirmation_status",
            "last_confirmation_transcript",
            "last_confirmation_alternatives",
            "last_confirmation_confidences",
            "last_debug_clip_path",
            "debug_keep_last_clip",
            "candidate_count",
            "last_wake_raw_duration_ms",
            "last_wake_shaped_duration_ms",
            "last_wake_padded_duration_ms",
            "last_wake_recognizer_runtime_ms",
            "last_confirmation_confidences_json",
            "last_confirmation_alternatives_json",
            "last_confirmation_error_code",
            "last_confirmation_error_message",
            "last_event_at",
            "android_stt_last_confidences_json",
            "android_stt_last_error_code",
            "android_stt_last_session_at",
            "android_stt_last_error_message",
            "android_stt_session_to_speech_begin_ms",
            "android_stt_last_alternatives_json",
            "android_stt_last_transcript",
            "android_stt_session_to_first_partial_ms",
            "android_stt_restart_count",
            "android_stt_session_to_ready_ms",
            "android_stt_session_to_final_or_error_ms",
            "android_stt_last_restart_reason",
            "android_stt_last_event",
            "android_stt_last_state",
            "wake_engine"
    };

    private static WakeWordController instance;

    public static synchronized WakeWordController shared(Context context) {
        if (instance == null) {
            instance = new WakeWordController(context.getApplicationContext(), new AndroidWakeRecognizer.Factory(context));
        }
        return instance;
    }

    private final Context context;
    private final SharedPreferences prefs;
    private final RecipeDevicePrimitiveExecutor recipeExecutor;
    private final PowerManager powerManager;
    private final KeyguardManager keyguardManager;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object lock = new Object();
    private final WakeRecognizerFactory recognizerFactory;
    private final Runnable rearmRunnable = this::runScheduledRearm;
    private final Runnable latchedHandoffRunnable = this::runLatchedHandoff;

    private BroadcastReceiver screenReceiver;
    private boolean receiverRegistered;
    private boolean serviceStarted;
    private boolean running;
    private String state = "idle";
    private String phase = "idle";
    private String suspendedReason = "";
    private WakeRecognizer recognizer;
    private int generation;
    private long proofUntilElapsedMs;
    private String proofMatchedPhrase = "";
    private String proofTranscript = "";
    private String activeTurnId = "";
    private String activeTurnSource = "";
    private boolean wakeLatched;
    private String latchedMatchedPhrase = "";
    private String latchedTranscript = "";
    private String latchedMatchSource = "";
    private String recognizerState = "idle";
    private int restartCount;
    private int consecutiveErrorCount;
    private String lastRestartReason = "";
    private boolean rearmScheduled;
    private String scheduledRearmReason = "";
    private boolean latchedHandoffScheduled;

    WakeWordController(Context context, WakeRecognizerFactory recognizerFactory) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.recipeExecutor = new RecipeDevicePrimitiveExecutor(context);
        this.powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        this.keyguardManager = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        this.recognizerFactory = recognizerFactory;
        migratePrefs();
    }

    public JSONObject status() {
        synchronized (lock) {
            boolean requested = isRequestedEnabledLocked();
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.wake_word_status.v4");
            Json.put(out, "wake_word", "Hey Pucky");
            Json.put(out, "wake_family", WakePhraseFamily.statusJson());
            Json.put(out, "enabled", requested);
            Json.put(out, "configured", requested);
            Json.put(out, "requested_enabled", requested);
            Json.put(out, "running", running);
            Json.put(out, "state", state);
            Json.put(out, "phase", phase);
            Json.put(out, "mode", MODE_ANDROID_STT_WAKE);
            Json.put(out, "engine", ENGINE_ANDROID_STT_SENTINEL);
            Json.put(out, "requested_engine", ENGINE_ANDROID_STT_SENTINEL);
            Json.put(out, "effective_engine", running ? ENGINE_ANDROID_STT_SENTINEL : "stopped");
            Json.put(out, "scope", stringPref(KEY_SCOPE, DEFAULT_SCOPE));
            Json.put(out, "supported_scopes", supportedScopesJson());
            Json.put(out, "suspended_reason", suspendedReason);
            Json.put(out, "audio_source", "VOICE_RECOGNITION");
            Json.put(out, "recognizer_state", recognizerState);
            Json.put(out, "restart_count", restartCount);
            Json.put(out, "last_restart_reason", lastRestartReason);
            Json.put(out, "debug_recognizer_mode", debugRecognizerModeLocked());
            Json.put(out, "debug_turn_capture_source", stringPref(KEY_DEBUG_TURN_CAPTURE_SOURCE, ""));
            Json.put(out, "debug_turn_fixture_name", stringPref(KEY_DEBUG_TURN_FIXTURE_NAME, ""));
            Json.put(out, "debug_turn_fixture_start_delay_ms", intPref(KEY_DEBUG_TURN_FIXTURE_START_DELAY_MS, 0));
            Json.put(out, "last_transcript", stringPref(KEY_LAST_TRANSCRIPT, ""));
            Json.put(out, "last_alternatives", jsonArrayPref(KEY_LAST_ALTERNATIVES_JSON));
            Json.put(out, "last_error_code", stringPref(KEY_LAST_ERROR_CODE, ""));
            Json.put(out, "last_error_message", stringPref(KEY_LAST_ERROR_MESSAGE, ""));
            Json.put(out, "last_error_at", stringPref(KEY_LAST_ERROR_AT, ""));
            Json.put(out, "transcript_history", jsonArrayPref(KEY_TRANSCRIPT_HISTORY_JSON));
            Json.put(out, "last_match", lastMatchJsonLocked());
            Json.put(out, "proof_indicator", proofIndicatorJsonLocked());
            Json.put(out, "assistant_status", PuckyAssistantController.status(context));
            Json.put(out, "active_turn_id", activeTurnId);
            Json.put(out, "last_arm_at", stringPref(KEY_LAST_ARM_AT, ""));
            Json.put(out, "last_disarm_at", stringPref(KEY_LAST_DISARM_AT, ""));
            Json.put(out, "last_disarm_reason", stringPref(KEY_LAST_DISARM_REASON, ""));
            Json.put(out, "last_handoff_at", stringPref(KEY_LAST_HANDOFF_AT, ""));
            Json.put(out, "last_handoff_result", stringPref(KEY_LAST_HANDOFF_RESULT, ""));
            Json.put(out, "last_config_set_at", stringPref(KEY_LAST_CONFIG_SET_AT, ""));
            Json.put(out, "last_start_requested_at", stringPref(KEY_LAST_START_REQUESTED_AT, ""));
            Json.put(out, "last_stop_requested_at", stringPref(KEY_LAST_STOP_REQUESTED_AT, ""));
            Json.put(out, "last_simulate_requested_at", stringPref(KEY_LAST_SIMULATE_REQUESTED_AT, ""));
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
        SharedPreferences.Editor editor = prefs.edit()
                .putBoolean(KEY_REQUESTED_ENABLED, enabled)
                .putString(KEY_SCOPE, scope)
                .putString(KEY_LAST_CONFIG_SET_AT, nowIso());
        if (BuildConfig.DEBUG && args != null && args.has("recognizer_mode")) {
            editor.putString(KEY_DEBUG_RECOGNIZER_MODE,
                    normalizeDebugRecognizerMode(args.optString("recognizer_mode", DEBUG_RECOGNIZER_MODE_ANDROID)));
        }
        if (BuildConfig.DEBUG && args != null) {
            if (args.has("capture_source")) {
                editor.putString(KEY_DEBUG_TURN_CAPTURE_SOURCE, safe(args.optString("capture_source", "")));
            }
            if (args.has("fixture_name")) {
                editor.putString(KEY_DEBUG_TURN_FIXTURE_NAME, safe(args.optString("fixture_name", "")));
            }
            if (args.has("debug_fixture_transcript")) {
                editor.putString(KEY_DEBUG_TURN_FIXTURE_TRANSCRIPT, safe(args.optString("debug_fixture_transcript", "")));
            }
            if (args.has("fixture_start_delay_ms")) {
                editor.putInt(KEY_DEBUG_TURN_FIXTURE_START_DELAY_MS,
                        Math.max(0, args.optInt("fixture_start_delay_ms", 0)));
            }
        }
        editor.apply();
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
        if (!BuildConfig.DEBUG) {
            throw new IllegalArgumentException("wake.simulate is debug-only");
        }
        String event = safe(args == null ? "" : args.optString("event", "")).toLowerCase(Locale.US);
        String transcript = args == null
                ? ""
                : safe(args.optString("transcript", args.optString("phrase", args.optString("text", ""))));
        JSONArray alternatives = WakeTranscriptMatcher.buildAlternatives(transcript,
                args == null ? null : args.optJSONArray("alternatives"));
        String errorCode = args == null ? "" : safe(args.optString("error_code", ""));
        String errorMessage = args == null ? "" : safe(args.optString("error_message", ""));
        if (event.isEmpty()) {
            event = "final";
        }
        if (!"error".equals(event) && alternatives.length() == 0) {
            throw new IllegalArgumentException("wake.simulate requires transcript or alternatives");
        }
        prefs.edit().putString(KEY_LAST_SIMULATE_REQUESTED_AT, nowIso()).apply();

        Action action;
        synchronized (lock) {
            if ("partial".equals(event)) {
                action = handleTranscriptEventLocked("simulate", "partial", transcript, alternatives, false);
            } else if ("final".equals(event)) {
                action = handleTranscriptEventLocked("simulate", "final", transcript, alternatives, true);
            } else if ("error".equals(event)) {
                String code = errorCode.isEmpty() ? "ERROR_CLIENT" : errorCode;
                String message = errorMessage.isEmpty() ? "Simulated recognizer error" : errorMessage;
                action = handleRecognizerErrorLocked("simulate", code, message);
            } else {
                throw new IllegalArgumentException("wake.simulate event must be partial, final, or error");
            }
        }
        applyAction(action);

        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.wake_simulate.v4");
        Json.put(out, "event", event);
        Json.put(out, "accepted", action.accepted);
        Json.put(out, "matched_phrase", action.matchedPhrase);
        Json.put(out, "transcript", transcript);
        Json.put(out, "proof_indicator", proofIndicatorJsonLockedSafe());
        Json.put(out, "status", status());
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
        Action action;
        synchronized (lock) {
            serviceStarted = false;
            unregisterReceiverLocked();
            action = stopForReasonLocked("service_stopped", true);
        }
        applyAction(action);
    }

    public void onTurnStarting(String turnId, String source) {
        Action action;
        synchronized (lock) {
            activeTurnId = safe(turnId);
            activeTurnSource = safe(source);
            phase = "turn_paused";
            action = stopForReasonLocked("turn_active", true);
        }
        applyAction(action);
    }

    public void onTurnStatusChanged(String turnId, String nextState, JSONObject status) {
        synchronized (lock) {
            if (activeTurnId.isEmpty() || activeTurnId.equals(safe(turnId)) || isTerminalTurnState(nextState)) {
                if (isTerminalTurnState(nextState)) {
                    activeTurnId = "";
                    activeTurnSource = "";
                    phase = "idle";
                } else if (!safe(turnId).isEmpty()) {
                    phase = "turn_paused";
                }
            }
        }
        if (isTerminalTurnState(nextState)) {
            reevaluate("turn_idle");
        }
    }

    private void reevaluate(String reason) {
        Action action = null;
        synchronized (lock) {
            if (!isRequestedEnabledLocked()) {
                action = stopForReasonLocked("disabled", true);
            } else if (!serviceStarted) {
                action = stopForReasonLocked("service_not_started", true);
            } else {
                String scope = stringPref(KEY_SCOPE, DEFAULT_SCOPE);
                if (SCOPE_ASSISTANT_RESERVED.equals(scope)) {
                    action = stopForReasonLocked("assistant_scope_reserved", true);
                } else if (!isDeviceInteractiveLocked()) {
                    action = stopForReasonLocked("device_not_interactive", true);
                } else if (isDeviceLockedLocked()) {
                    action = stopForReasonLocked("device_locked", true);
                } else if (hasActiveTurnLocked()) {
                    action = stopForReasonLocked("turn_active", true);
                } else if (!hasRecordAudioPermission()) {
                    action = stopForReasonLocked("record_audio_permission_missing", true);
                } else if (usesAndroidRecognizerLocked() && !SpeechRecognizer.isRecognitionAvailable(context)) {
                    action = stopForReasonLocked("speech_recognition_unavailable", true);
                } else if (recognizer == null) {
                    action = startRecognizerLocked(reason);
                }
            }
        }
        applyAction(action);
    }

    private Action startRecognizerLocked(String reason) {
        cancelScheduledRearmLocked();
        generation += 1;
        int currentGeneration = generation;
        suspendedReason = "";
        state = "armed";
        phase = "wake_armed";
        running = true;
        recognizerState = "starting";
        clearLatchedWakeLocked();
        prefs.edit()
                .putString(KEY_LAST_ARM_AT, nowIso())
                .apply();
        try {
            recognizer = createRecognizerLocked();
            recognizer.start(new WakeRecognizer.Callback() {
                @Override
                public void onReady() {
                    handleRecognizerReady(currentGeneration);
                }

                @Override
                public void onBeginningOfSpeech() {
                    handleRecognizerSpeechBegin(currentGeneration);
                }

                @Override
                public void onPartial(String transcript, JSONArray alternatives) {
                    handleRecognizerTranscript(currentGeneration, "android_stt_sentinel", "partial", transcript, alternatives, false);
                }

                @Override
                public void onFinal(String transcript, JSONArray alternatives) {
                    handleRecognizerTranscript(currentGeneration, "android_stt_sentinel", "final", transcript, alternatives, true);
                }

                @Override
                public void onError(String errorCode, String errorMessage) {
                    handleRecognizerError(currentGeneration, errorCode, errorMessage);
                }

                @Override
                public void onStopped() {
                    handleRecognizerStopped(currentGeneration);
                }
            });
            Log.i(TAG, "android_stt_wake armed reason=" + reason + " generation=" + currentGeneration);
            return null;
        } catch (RuntimeException exc) {
            recognizer = null;
            running = false;
            state = "error";
            recognizerState = "error";
            suspendedReason = "recognizer_start_failed";
            restartCount += 1;
            consecutiveErrorCount += 1;
            lastRestartReason = "recognizer_start_failed";
            persistLastErrorLocked("recognizer_start_failed", exc.getClass().getSimpleName() + ": " + exc.getMessage());
            appendHistoryLocked("start_failed", "", new JSONArray(), "", "recognizer_start_failed",
                    exc.getClass().getSimpleName() + ": " + exc.getMessage());
            Action action = detachRecognizerLocked("recognizer_start_failed");
            action.rearmDelayMs = WakeRestartPolicy.errorDelayMs(consecutiveErrorCount);
            action.rearmReason = "recognizer_start_failed";
            scheduleRearmLocked(action.rearmReason, action.rearmDelayMs);
            return action;
        }
    }

    private void handleRecognizerReady(int callbackGeneration) {
        synchronized (lock) {
            if (callbackGeneration != generation || recognizer == null) {
                return;
            }
            running = true;
            recognizerState = "ready";
            state = "armed";
            phase = "wake_armed";
            consecutiveErrorCount = 0;
            appendHistoryLocked("ready", "", new JSONArray(), "", "", "");
        }
    }

    private void handleRecognizerSpeechBegin(int callbackGeneration) {
        synchronized (lock) {
            if (callbackGeneration != generation || recognizer == null) {
                return;
            }
            recognizerState = "speech";
            if (!wakeLatched) {
                phase = "wake_armed";
            }
            appendHistoryLocked("speech_begin", "", new JSONArray(), "", "", "");
        }
    }

    private void handleRecognizerTranscript(
            int callbackGeneration,
            String source,
            String eventType,
            String transcript,
            JSONArray alternatives,
            boolean finalResult) {
        Action action;
        synchronized (lock) {
            if (callbackGeneration != generation) {
                return;
            }
            action = handleTranscriptEventLocked(source, eventType, transcript, alternatives, finalResult);
        }
        applyAction(action);
    }

    private void handleRecognizerError(int callbackGeneration, String errorCode, String errorMessage) {
        Action action;
        synchronized (lock) {
            if (callbackGeneration != generation) {
                return;
            }
            action = handleRecognizerErrorLocked("android_stt_sentinel", errorCode, errorMessage);
        }
        applyAction(action);
    }

    private void handleRecognizerStopped(int callbackGeneration) {
        synchronized (lock) {
            if (callbackGeneration != generation || recognizer != null) {
                return;
            }
            recognizerState = "stopped";
        }
    }

    private Action handleTranscriptEventLocked(
            String source,
            String eventType,
            String transcript,
            JSONArray alternatives,
            boolean finalResult) {
        JSONArray combined = WakeTranscriptMatcher.buildAlternatives(transcript, alternatives);
        persistLastTranscriptLocked(transcript, combined);
        String matched = finalResult
                ? WakeTranscriptMatcher.matchFinal(transcript, alternatives)
                : WakeTranscriptMatcher.matchPartial(transcript, alternatives);
        clearLastErrorLocked();
        if (!matched.isEmpty()) {
            latchWakeMatchLocked(matched, transcript, source + "_" + eventType);
            appendHistoryLocked(eventType, transcript, combined, matched, "", "");
            Action action = new Action();
            action.accepted = true;
            action.matchedPhrase = matched;
            if (finalResult) {
                action = beginWakeTurnHandoffLocked("final_result");
                action.accepted = true;
                action.matchedPhrase = matched;
            } else {
                scheduleLatchedHandoffLocked();
            }
            Log.i(TAG, "android_stt_wake matched event=" + eventType + " matched=" + matched + " transcript=" + transcript);
            return action;
        }
        appendHistoryLocked(eventType, transcript, combined, "", "", "");
        if (finalResult && wakeLatched) {
            Action action = beginWakeTurnHandoffLocked("latched_final_result");
            action.accepted = true;
            action.matchedPhrase = latchedMatchedPhrase;
            Log.i(TAG, "android_stt_wake latched_final_handoff transcript=" + transcript);
            return action;
        }
        if (!finalResult) {
            Log.i(TAG, "android_stt_wake partial_no_match transcript=" + transcript);
            return new Action();
        }
        consecutiveErrorCount = 0;
        state = "rejected";
        recognizerState = "rejected";
        suspendedReason = "";
        Action action = detachRecognizerLocked("wake_phrase_no_match");
        action.rearmDelayMs = WakeRestartPolicy.FINAL_NO_MATCH_DELAY_MS;
        action.rearmReason = "final_no_match";
        scheduleRearmLocked(action.rearmReason, action.rearmDelayMs);
        Log.i(TAG, "android_stt_wake final_no_match transcript=" + transcript);
        return action;
    }

    private Action handleRecognizerErrorLocked(String source, String errorCode, String errorMessage) {
        String code = safe(errorCode);
        if (code.isEmpty()) {
            code = "ERROR_CLIENT";
        }
        String message = safe(errorMessage);
        if (wakeLatched) {
            appendHistoryLocked("error", "", new JSONArray(), latchedMatchedPhrase, code, message);
            Action action = beginWakeTurnHandoffLocked("latched_error_" + code.toLowerCase(Locale.US));
            action.accepted = true;
            action.matchedPhrase = latchedMatchedPhrase;
            Log.i(TAG, "android_stt_wake latched_error_handoff source=" + source + " code=" + code);
            return action;
        }
        persistLastErrorLocked(code, message);
        appendHistoryLocked("error", "", new JSONArray(), "", code, message);
        state = "error";
        recognizerState = "error";
        phase = "idle";
        suspendedReason = "";
        Action action = detachRecognizerLocked(code);
        restartCount += 1;
        consecutiveErrorCount += 1;
        lastRestartReason = code;
        action.rearmDelayMs = WakeRestartPolicy.errorDelayMs(consecutiveErrorCount);
        action.rearmReason = "recognizer_error";
        scheduleRearmLocked(action.rearmReason, action.rearmDelayMs);
        Log.i(TAG, "android_stt_wake error source=" + source + " code=" + code + " delay_ms=" + action.rearmDelayMs);
        return action;
    }

    private Action stopForReasonLocked(String reason, boolean clearToIdle) {
        cancelScheduledRearmLocked();
        cancelLatchedHandoffLocked();
        clearLatchedWakeLocked();
        Action action = detachRecognizerLocked(reason);
        if (clearToIdle) {
            state = "idle";
            suspendedReason = reason;
            phase = hasActiveTurnLocked() ? "turn_paused" : "idle";
        }
        return action;
    }

    private Action detachRecognizerLocked(String reason) {
        Action action = new Action();
        cancelScheduledRearmLocked();
        cancelLatchedHandoffLocked();
        generation += 1;
        action.toStop = recognizer;
        recognizer = null;
        if (action.toStop != null || running || !"idle".equals(recognizerState)) {
            prefs.edit()
                    .putString(KEY_LAST_DISARM_AT, nowIso())
                    .putString(KEY_LAST_DISARM_REASON, safe(reason))
                    .apply();
        }
        running = false;
        recognizerState = "stopped";
        return action;
    }

    private void applyAction(Action action) {
        if (action == null) {
            return;
        }
        if (action.toStop != null) {
            action.toStop.stop();
        }
        boolean turnStarted = false;
        if (action.turnStartArgs != null) {
            try {
                PuckyTurnController.shared(context).start(action.turnStartArgs);
                turnStarted = true;
                synchronized (lock) {
                    prefs.edit()
                            .putString(KEY_LAST_HANDOFF_AT, nowIso())
                            .putString(KEY_LAST_HANDOFF_RESULT, "turn_started")
                            .apply();
                    phase = hasActiveTurnLocked() ? "turn_paused" : phase;
                }
            } catch (Exception exc) {
                synchronized (lock) {
                    persistLastErrorLocked("turn_start_failed",
                            exc.getClass().getSimpleName() + ": " + safe(exc.getMessage()));
                    prefs.edit()
                            .putString(KEY_LAST_HANDOFF_AT, nowIso())
                            .putString(KEY_LAST_HANDOFF_RESULT, "turn_start_failed")
                            .apply();
                    state = "error";
                    phase = "idle";
                    suspendedReason = "turn_start_failed";
                }
                recipeExecutor.playFailureChime("pucky.wake_turn_start_failure_chime.v1");
                reevaluate("turn_start_failed");
            }
        }
        if (action.playChime && (action.turnStartArgs == null || turnStarted)) {
            recipeExecutor.playWakeListeningChime("pucky.wake_stt_sentinel_match_chime.v1");
        }
    }

    private void runScheduledRearm() {
        String reason;
        synchronized (lock) {
            rearmScheduled = false;
            reason = scheduledRearmReason.isEmpty() ? "scheduled_rearm" : scheduledRearmReason;
            scheduledRearmReason = "";
        }
        reevaluate(reason);
    }

    private void scheduleRearmLocked(String reason, long delayMs) {
        cancelScheduledRearmLocked();
        rearmScheduled = true;
        scheduledRearmReason = safe(reason).isEmpty() ? "scheduled_rearm" : safe(reason);
        main.postDelayed(rearmRunnable, Math.max(0L, delayMs));
    }

    private void cancelScheduledRearmLocked() {
        if (!rearmScheduled) {
            return;
        }
        main.removeCallbacks(rearmRunnable);
        rearmScheduled = false;
        scheduledRearmReason = "";
    }

    private void runLatchedHandoff() {
        Action action;
        synchronized (lock) {
            latchedHandoffScheduled = false;
            if (!wakeLatched || recognizer == null) {
                return;
            }
            action = beginWakeTurnHandoffLocked("partial_debounce");
            action.accepted = true;
            action.matchedPhrase = latchedMatchedPhrase;
        }
        applyAction(action);
    }

    private void scheduleLatchedHandoffLocked() {
        cancelLatchedHandoffLocked();
        latchedHandoffScheduled = true;
        main.postDelayed(latchedHandoffRunnable, LATCHED_WAKE_DEBOUNCE_MS);
    }

    private void cancelLatchedHandoffLocked() {
        if (!latchedHandoffScheduled) {
            return;
        }
        main.removeCallbacks(latchedHandoffRunnable);
        latchedHandoffScheduled = false;
    }

    private void latchWakeMatchLocked(String matched, String transcript, String source) {
        wakeLatched = true;
        latchedMatchedPhrase = safe(matched);
        latchedTranscript = safe(transcript);
        latchedMatchSource = safe(source);
        markProofLocked(matched, transcript, source);
        state = "matched";
        phase = "wake_latched";
        suspendedReason = "";
        recognizerState = "matched";
    }

    private void clearLatchedWakeLocked() {
        wakeLatched = false;
        latchedMatchedPhrase = "";
        latchedTranscript = "";
        latchedMatchSource = "";
    }

    private Action beginWakeTurnHandoffLocked(String reason) {
        cancelLatchedHandoffLocked();
        markProofLocked(latchedMatchedPhrase, latchedTranscript, latchedMatchSource);
        state = "matched";
        phase = "turn_starting";
        suspendedReason = "";
        recognizerState = "matched";
        prefs.edit()
                .putString(KEY_LAST_HANDOFF_AT, nowIso())
                .putString(KEY_LAST_HANDOFF_RESULT, safe(reason))
                .apply();
        Action action = detachRecognizerLocked("wake_turn_handoff");
        action.accepted = true;
        action.matchedPhrase = latchedMatchedPhrase;
        action.playChime = true;
        action.turnStartArgs = buildWakeTurnStartArgsLocked();
        clearLatchedWakeLocked();
        return action;
    }

    private JSONObject buildWakeTurnStartArgsLocked() {
        JSONObject out = new JSONObject();
        Json.put(out, "auto_endpoint", true);
        Json.put(out, "speech_start_timeout_ms", PuckyTurnController.WAKE_SPEECH_START_TIMEOUT_MS);
        Json.put(out, "trailing_silence_ms", PuckyTurnController.WAKE_TRAILING_SILENCE_MS);
        Json.put(out, "min_speech_ms", PuckyTurnController.WAKE_MIN_SPEECH_MS);
        Json.put(out, "max_duration_ms", PuckyTurnController.WAKE_AUTO_ENDPOINT_MAX_DURATION_MS);
        Json.put(out, "feedback", false);
        Json.put(out, "trigger_source", PuckyTurnController.TRIGGER_SOURCE_WAKE_WORD);
        Json.put(out, "wake_phrase_family", "hey_pucky");
        Json.put(out, "wake_phrase_detected", latchedMatchedPhrase);
        if (BuildConfig.DEBUG) {
            String captureSource = safe(stringPref(KEY_DEBUG_TURN_CAPTURE_SOURCE, ""));
            String fixtureName = safe(stringPref(KEY_DEBUG_TURN_FIXTURE_NAME, ""));
            String fixtureTranscript = safe(stringPref(KEY_DEBUG_TURN_FIXTURE_TRANSCRIPT, ""));
            int fixtureStartDelayMs = Math.max(0, intPref(KEY_DEBUG_TURN_FIXTURE_START_DELAY_MS, 0));
            if (!captureSource.isEmpty()) {
                Json.put(out, "capture_source", captureSource);
            }
            if (!fixtureName.isEmpty()) {
                Json.put(out, "fixture_name", fixtureName);
            }
            if (fixtureStartDelayMs > 0) {
                Json.put(out, "fixture_start_delay_ms", fixtureStartDelayMs);
            }
            if (!fixtureTranscript.isEmpty()) {
                Json.put(out, "debug_fixture_transcript", fixtureTranscript);
            }
        }
        return out;
    }

    private void migratePrefs() {
        synchronized (lock) {
            int version = prefs.getInt(KEY_PREFS_SCHEMA, 0);
            if (version >= PREFS_SCHEMA_V4) {
                return;
            }
            SharedPreferences.Editor editor = prefs.edit();
            for (String key : LEGACY_WAKE_KEYS) {
                editor.remove(key);
            }
            coerceStringPref(editor, KEY_LAST_ERROR_CODE, "");
            coerceStringPref(editor, KEY_LAST_ERROR_MESSAGE, "");
            coerceStringPref(editor, KEY_LAST_ERROR_AT, "");
            coerceStringPref(editor, KEY_LAST_TRANSCRIPT, "");
            coerceStringPref(editor, KEY_LAST_ALTERNATIVES_JSON, "[]");
            coerceStringPref(editor, KEY_LAST_MATCHED_PHRASE, "");
            coerceStringPref(editor, KEY_LAST_MATCH_SOURCE, "");
            coerceStringPref(editor, KEY_LAST_MATCH_AT, "");
            coerceStringPref(editor, KEY_LAST_ARM_AT, "");
            coerceStringPref(editor, KEY_LAST_DISARM_AT, "");
            coerceStringPref(editor, KEY_LAST_DISARM_REASON, "");
            coerceStringPref(editor, KEY_LAST_HANDOFF_AT, "");
            coerceStringPref(editor, KEY_LAST_HANDOFF_RESULT, "");
            coerceStringPref(editor, KEY_DEBUG_TURN_CAPTURE_SOURCE, "");
            coerceStringPref(editor, KEY_DEBUG_TURN_FIXTURE_NAME, "");
            coerceStringPref(editor, KEY_DEBUG_TURN_FIXTURE_TRANSCRIPT, "");
            editor.putInt(KEY_DEBUG_TURN_FIXTURE_START_DELAY_MS, intPref(KEY_DEBUG_TURN_FIXTURE_START_DELAY_MS, 0));
            coerceStringPref(editor, KEY_LAST_CONFIG_SET_AT, "");
            coerceStringPref(editor, KEY_LAST_START_REQUESTED_AT, "");
            coerceStringPref(editor, KEY_LAST_STOP_REQUESTED_AT, "");
            coerceStringPref(editor, KEY_LAST_SIMULATE_REQUESTED_AT, "");
            coerceStringPref(editor, KEY_SCOPE, DEFAULT_SCOPE);
            coerceStringPref(editor, KEY_TRANSCRIPT_HISTORY_JSON, "[]");
            editor.putInt(KEY_PREFS_SCHEMA, PREFS_SCHEMA_V4);
            if (BuildConfig.DEBUG && stringPref(KEY_DEBUG_RECOGNIZER_MODE, "").trim().isEmpty()) {
                editor.putString(KEY_DEBUG_RECOGNIZER_MODE, DEBUG_RECOGNIZER_MODE_ANDROID);
            }
            editor.apply();
        }
    }

    private WakeRecognizer createRecognizerLocked() {
        if (BuildConfig.DEBUG && DEBUG_RECOGNIZER_MODE_FAKE.equals(debugRecognizerModeLocked())) {
            return new FakeWakeRecognizer.Factory().create();
        }
        return recognizerFactory.create();
    }

    private void persistLastTranscriptLocked(String transcript, JSONArray alternatives) {
        prefs.edit()
                .putString(KEY_LAST_TRANSCRIPT, safe(transcript))
                .putString(KEY_LAST_ALTERNATIVES_JSON,
                        (alternatives == null ? new JSONArray() : alternatives).toString())
                .apply();
    }

    private void persistLastErrorLocked(String code, String message) {
        prefs.edit()
                .putString(KEY_LAST_ERROR_CODE, safe(code))
                .putString(KEY_LAST_ERROR_MESSAGE, safe(message))
                .putString(KEY_LAST_ERROR_AT, nowIso())
                .apply();
    }

    private void clearLastErrorLocked() {
        prefs.edit()
                .putString(KEY_LAST_ERROR_CODE, "")
                .putString(KEY_LAST_ERROR_MESSAGE, "")
                .putString(KEY_LAST_ERROR_AT, "")
                .apply();
    }

    private void appendHistoryLocked(
            String eventType,
            String transcript,
            JSONArray alternatives,
            String matchedPhrase,
            String errorCode,
            String errorMessage) {
        JSONArray history = jsonArrayPref(KEY_TRANSCRIPT_HISTORY_JSON);
        JSONObject entry = new JSONObject();
        Json.put(entry, "event", safe(eventType));
        Json.put(entry, "at", nowIso());
        Json.put(entry, "transcript", safe(transcript));
        Json.put(entry, "alternatives", alternatives == null ? new JSONArray() : alternatives);
        Json.put(entry, "matched_phrase", safe(matchedPhrase));
        Json.put(entry, "error_code", safe(errorCode));
        Json.put(entry, "error_message", safe(errorMessage));
        Json.add(history, entry);
        JSONArray trimmed = new JSONArray();
        int start = Math.max(0, history.length() - MAX_HISTORY);
        for (int i = start; i < history.length(); i++) {
            Json.add(trimmed, history.opt(i));
        }
        prefs.edit().putString(KEY_TRANSCRIPT_HISTORY_JSON, trimmed.toString()).apply();
    }

    private JSONObject proofIndicatorJsonLockedSafe() {
        synchronized (lock) {
            return proofIndicatorJsonLocked();
        }
    }

    private JSONObject proofIndicatorJsonLocked() {
        long remaining = Math.max(0L, proofUntilElapsedMs - SystemClock.elapsedRealtime());
        boolean active = remaining > 0L;
        JSONObject out = new JSONObject();
        Json.put(out, "active", active);
        Json.put(out, "visual_state", active ? "armed" : "idle");
        Json.put(out, "matched_phrase", active ? proofMatchedPhrase : "");
        Json.put(out, "transcript", active ? proofTranscript : "");
        Json.put(out, "remaining_ms", remaining);
        Json.put(out, "expires_at_elapsed_ms", proofUntilElapsedMs);
        return out;
    }

    private JSONObject lastMatchJsonLocked() {
        JSONObject out = new JSONObject();
        Json.put(out, "matched_phrase", stringPref(KEY_LAST_MATCHED_PHRASE, ""));
        Json.put(out, "match_source", stringPref(KEY_LAST_MATCH_SOURCE, ""));
        Json.put(out, "matched_at", stringPref(KEY_LAST_MATCH_AT, ""));
        return out;
    }

    private void markProofLocked(String matched, String transcript, String source) {
        String at = nowIso();
        proofUntilElapsedMs = SystemClock.elapsedRealtime() + PROOF_WINDOW_MS;
        proofMatchedPhrase = safe(matched);
        proofTranscript = safe(transcript);
        prefs.edit()
                .putString(KEY_LAST_MATCHED_PHRASE, safe(matched))
                .putString(KEY_LAST_MATCH_SOURCE, safe(source))
                .putString(KEY_LAST_MATCH_AT, at)
                .apply();
    }

    private boolean proofWindowActiveLocked() {
        return proofUntilElapsedMs > SystemClock.elapsedRealtime();
    }

    private JSONArray jsonArrayPref(String key) {
        String raw = stringPref(key, "");
        if (raw == null || raw.trim().isEmpty()) {
            return new JSONArray();
        }
        try {
            return new JSONArray(raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
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

    private boolean usesAndroidRecognizerLocked() {
        return !BuildConfig.DEBUG || DEBUG_RECOGNIZER_MODE_ANDROID.equals(debugRecognizerModeLocked());
    }

    private String debugRecognizerModeLocked() {
        return normalizeDebugRecognizerMode(stringPref(KEY_DEBUG_RECOGNIZER_MODE, DEBUG_RECOGNIZER_MODE_ANDROID));
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

    private void registerReceiverLocked() {
        if (receiverRegistered) {
            return;
        }
        screenReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ignored, Intent intent) {
                reevaluate(intent == null ? "screen_event" : safe(intent.getAction()));
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
        } catch (IllegalArgumentException ignored) {
        }
        receiverRegistered = false;
        screenReceiver = null;
    }

    private static JSONArray supportedScopesJson() {
        JSONArray out = new JSONArray();
        Json.add(out, DEFAULT_SCOPE);
        Json.add(out, SCOPE_ASSISTANT_RESERVED);
        return out;
    }

    private void coerceStringPref(SharedPreferences.Editor editor, String key, String fallback) {
        editor.putString(key, stringPref(key, fallback));
    }

    private String stringPref(String key, String fallback) {
        Object value = prefs.getAll().get(key);
        if (value == null) {
            return fallback;
        }
        if (value instanceof String) {
            return (String) value;
        }
        return String.valueOf(value);
    }

    private int intPref(String key, int fallback) {
        Object value = prefs.getAll().get(key);
        if (value == null) {
            return fallback;
        }
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        if (value instanceof String) {
            try {
                return Integer.parseInt(((String) value).trim());
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private static boolean isTerminalTurnState(String value) {
        return "idle".equals(value)
                || "completed".equals(value)
                || "failed".equals(value)
                || "discarded_silence".equals(value)
                || "upload_blocked".equals(value);
    }

    private static String nowIso() {
        return Instant.now().toString();
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static String normalizeDebugRecognizerMode(String raw) {
        String value = safe(raw).toLowerCase(Locale.US);
        if (DEBUG_RECOGNIZER_MODE_FAKE.equals(value)) {
            return DEBUG_RECOGNIZER_MODE_FAKE;
        }
        return DEBUG_RECOGNIZER_MODE_ANDROID;
    }

    private static final class Action {
        WakeRecognizer toStop;
        boolean playChime;
        boolean accepted;
        String matchedPhrase = "";
        long rearmDelayMs;
        String rearmReason = "";
        JSONObject turnStartArgs;
    }
}
