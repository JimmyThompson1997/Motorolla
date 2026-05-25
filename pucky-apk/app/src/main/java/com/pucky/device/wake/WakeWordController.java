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

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Locale;

public final class WakeWordController {
    private static final String TAG = "PuckyWakeWord";

    private static final String PREFS = "pucky_wake_word";
    private static final String KEY_REQUESTED_ENABLED = "requested_enabled";
    private static final String KEY_WAKE_ENGINE = "wake_engine";
    private static final String KEY_SCOPE = "scope";
    private static final String KEY_LAST_CONFIG_SET_AT = "last_config_set_at";
    private static final String KEY_LAST_START_REQUESTED_AT = "last_start_requested_at";
    private static final String KEY_LAST_STOP_REQUESTED_AT = "last_stop_requested_at";
    private static final String KEY_LAST_SIMULATE_REQUESTED_AT = "last_simulate_requested_at";
    private static final String KEY_DEBUG_KEEP_LAST_CLIP = "debug_keep_last_clip";
    private static final String KEY_CANDIDATE_COUNT = "candidate_count";
    private static final String KEY_LAST_CANDIDATE_AT = "last_candidate_at";
    private static final String KEY_LAST_CANDIDATE_DURATION_MS = "last_candidate_duration_ms";
    private static final String KEY_LAST_CANDIDATE_SAMPLES = "last_candidate_samples";
    private static final String KEY_LAST_CANDIDATE_PEAK = "last_candidate_peak";
    private static final String KEY_LAST_CANDIDATE_RMS = "last_candidate_rms";
    private static final String KEY_LAST_CANDIDATE_MAX_VAD_PROBABILITY = "last_candidate_max_vad_probability";
    private static final String KEY_LAST_CANDIDATE_FINISH_REASON = "last_candidate_finish_reason";
    private static final String KEY_LAST_CONFIRMATION_RAW_DURATION_MS = "last_confirmation_raw_duration_ms";
    private static final String KEY_LAST_CONFIRMATION_CLIP_DURATION_MS = "last_confirmation_clip_duration_ms";
    private static final String KEY_LAST_CONFIRMATION_PADDED_DURATION_MS = "last_confirmation_padded_duration_ms";
    private static final String KEY_LAST_CONFIRMATION_RECOGNIZER_MS = "last_confirmation_recognizer_ms";
    private static final String KEY_LAST_WAKE_CAPTURE_MS = "last_wake_capture_ms";
    private static final String KEY_LAST_WAKE_GATE_TO_CAPTURE_START_MS = "last_wake_gate_to_capture_start_ms";
    private static final String KEY_LAST_WAKE_CAPTURE_FINISH_TO_CONFIRM_START_MS =
            "last_wake_capture_finish_to_confirm_start_ms";
    private static final String KEY_LAST_WAKE_CONFIRM_FINISH_TO_DECISION_MS =
            "last_wake_confirm_finish_to_decision_ms";
    private static final String KEY_LAST_WAKE_CAPTURE_FINISH_TO_CHIME_MS =
            "last_wake_capture_finish_to_chime_ms";
    private static final String KEY_LAST_WAKE_GATE_TO_CHIME_MS = "last_wake_gate_to_chime_ms";
    private static final String KEY_LAST_WAKE_GATE_TO_TURN_START_REQUEST_MS =
            "last_wake_gate_to_turn_start_request_ms";
    private static final String KEY_LAST_CONFIRMATION_STATUS = "last_confirmation_status";
    private static final String KEY_LAST_CONFIRMATION_TRANSCRIPT = "last_confirmation_transcript";
    private static final String KEY_LAST_CONFIRMATION_ALTERNATIVES_JSON = "last_confirmation_alternatives_json";
    private static final String KEY_LAST_CONFIRMATION_CONFIDENCES_JSON = "last_confirmation_confidences_json";
    private static final String KEY_LAST_CONFIRMATION_ERROR_CODE = "last_confirmation_error_code";
    private static final String KEY_LAST_CONFIRMATION_ERROR_MESSAGE = "last_confirmation_error_message";
    private static final String KEY_LAST_REJECT_REASON = "last_reject_reason";
    private static final String KEY_LAST_DEBUG_CLIP_PATH = "last_debug_clip_path";
    private static final String KEY_ANDROID_STT_LAST_SESSION_AT = "android_stt_last_session_at";
    private static final String KEY_ANDROID_STT_LAST_STATE = "android_stt_last_state";
    private static final String KEY_ANDROID_STT_LAST_EVENT = "android_stt_last_event";
    private static final String KEY_ANDROID_STT_LAST_TRANSCRIPT = "android_stt_last_transcript";
    private static final String KEY_ANDROID_STT_LAST_ALTERNATIVES_JSON = "android_stt_last_alternatives_json";
    private static final String KEY_ANDROID_STT_LAST_CONFIDENCES_JSON = "android_stt_last_confidences_json";
    private static final String KEY_ANDROID_STT_LAST_ERROR_CODE = "android_stt_last_error_code";
    private static final String KEY_ANDROID_STT_LAST_ERROR_MESSAGE = "android_stt_last_error_message";
    private static final String KEY_ANDROID_STT_RESTART_COUNT = "android_stt_restart_count";
    private static final String KEY_ANDROID_STT_LAST_RESTART_REASON = "android_stt_last_restart_reason";
    private static final String KEY_ANDROID_STT_SESSION_TO_READY_MS = "android_stt_session_to_ready_ms";
    private static final String KEY_ANDROID_STT_SESSION_TO_SPEECH_BEGIN_MS = "android_stt_session_to_speech_begin_ms";
    private static final String KEY_ANDROID_STT_SESSION_TO_FIRST_PARTIAL_MS = "android_stt_session_to_first_partial_ms";
    private static final String KEY_ANDROID_STT_SESSION_TO_FINAL_OR_ERROR_MS =
            "android_stt_session_to_final_or_error_ms";
    private static final String KEY_ANDROID_STT_SESSION_TO_ACCEPT_MS = "android_stt_session_to_accept_ms";
    private static final String KEY_ANDROID_STT_READY_TO_ACCEPT_MS = "android_stt_ready_to_accept_ms";
    private static final String KEY_ANDROID_STT_SPEECH_BEGIN_TO_ACCEPT_MS =
            "android_stt_speech_begin_to_accept_ms";
    private static final String KEY_ANDROID_STT_ACCEPT_TO_CHIME_MS = "android_stt_accept_to_chime_ms";
    private static final String KEY_ANDROID_STT_ACCEPT_TO_TURN_START_REQUEST_MS =
            "android_stt_accept_to_turn_start_request_ms";

    private static final String MODE_PHASE_2A = "phase2a_unlocked_service";
    private static final String MODE_PHASE_2B = "assistant_screen_off_reserved";
    private static final String SCOPE_UNLOCKED_SERVICE = "unlocked_service";
    private static final String SCOPE_ASSISTANT_SCREEN_OFF = "assistant_screen_off";
    private static final String ENGINE_VAD_CONFIRM = "vad_confirm";
    private static final String ENGINE_ANDROID_STT_SENTINEL = "android_stt_sentinel";
    private static final String ENGINE_DESCRIPTION_VAD_CONFIRM =
            "silero_vad_candidate_plus_android_stt_confirmation";

    private static final long PROBE_TRAILING_SILENCE_MS = 600L;
    private static final long PROBE_MAX_DURATION_MS = 2500L;
    private static final long PROBE_POLL_MS = 50L;
    private static final long CONFIRM_TIMEOUT_MS = 5000L;
    private static final long ANDROID_STT_RESTART_BASE_MS = 250L;
    private static final long ANDROID_STT_RESTART_MAX_MS = 2000L;
    private static final long SPEECH_START_TIMEOUT_MS = 3000L;
    private static final long TRAILING_SILENCE_MS = 1000L;
    private static final long MAX_TURN_MS = 20000L;
    private static final double TURN_SPEECH_THRESHOLD = WalkieSpeechGate.DEFAULT_SPEECH_THRESHOLD;

    private static volatile WakeWordController instance;

    private final Context context;
    private final SharedPreferences prefs;
    private final Handler main;
    private final RecipeDevicePrimitiveExecutor recipeExecutor;
    private final OnDeviceInjectedAudioRecognizer recognizer;
    private final WakeDebugClipStore debugClipStore;
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
    private String effectiveWakeEngine = "";
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
    private WakeProbeRecorder candidateRecorder;
    private WakeTurnMonitor turnMonitor;
    private SpeechRecognizer androidSttRecognizer;
    private String androidSttSessionId = "";
    private String androidSttState = "idle";
    private boolean androidSttListening;
    private int androidSttRestartCount;
    private long androidSttSessionStartedMs = -1L;
    private long androidSttReadyMs = -1L;
    private long androidSttSpeechBeginMs = -1L;
    private long androidSttFirstPartialMs = -1L;
    private long androidSttFinalOrErrorMs = -1L;
    private long androidSttAcceptedMs = -1L;
    private Runnable androidSttRestartRunnable;

    private WakeWordController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.main = new Handler(Looper.getMainLooper());
        this.recipeExecutor = new RecipeDevicePrimitiveExecutor(this.context);
        this.recognizer = new OnDeviceInjectedAudioRecognizer(this.context);
        this.debugClipStore = new WakeDebugClipStore(this.context.getFilesDir());
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
            Json.put(out, "engine", effectiveWakeEngineLocked());
            Json.put(out, "wake_engine", requestedWakeEngine());
            Json.put(out, "effective_wake_engine", effectiveWakeEngineLocked());
            Json.put(out, "vad_confirm_engine", ENGINE_DESCRIPTION_VAD_CONFIRM);
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
            Json.put(out, "debug_keep_last_clip", debugKeepLastClip());
            Json.put(out, "candidate_count", prefs.getInt(KEY_CANDIDATE_COUNT, 0));
            Json.put(out, "last_candidate_at", nullable(prefs.getString(KEY_LAST_CANDIDATE_AT, "")));
            Json.put(out, "last_candidate_duration_ms", nullableInt(KEY_LAST_CANDIDATE_DURATION_MS));
            Json.put(out, "last_candidate_samples", nullableInt(KEY_LAST_CANDIDATE_SAMPLES));
            Json.put(out, "last_candidate_peak", nullableInt(KEY_LAST_CANDIDATE_PEAK));
            Json.put(out, "last_candidate_rms", nullableInt(KEY_LAST_CANDIDATE_RMS));
            Json.put(out, "last_candidate_max_vad_probability",
                    nullableDouble(KEY_LAST_CANDIDATE_MAX_VAD_PROBABILITY));
            Json.put(out, "last_candidate_finish_reason",
                    nullable(prefs.getString(KEY_LAST_CANDIDATE_FINISH_REASON, "")));
            Json.put(out, "last_confirmation_raw_duration_ms", nullableInt(KEY_LAST_CONFIRMATION_RAW_DURATION_MS));
            Json.put(out, "last_confirmation_clip_duration_ms", nullableInt(KEY_LAST_CONFIRMATION_CLIP_DURATION_MS));
            Json.put(out, "last_confirmation_padded_duration_ms",
                    nullableInt(KEY_LAST_CONFIRMATION_PADDED_DURATION_MS));
            Json.put(out, "last_confirmation_recognizer_ms", nullableInt(KEY_LAST_CONFIRMATION_RECOGNIZER_MS));
            Json.put(out, "last_wake_capture_ms", nullableInt(KEY_LAST_WAKE_CAPTURE_MS));
            Json.put(out, "last_wake_gate_to_capture_start_ms",
                    nullableInt(KEY_LAST_WAKE_GATE_TO_CAPTURE_START_MS));
            Json.put(out, "last_wake_capture_finish_to_confirm_start_ms",
                    nullableInt(KEY_LAST_WAKE_CAPTURE_FINISH_TO_CONFIRM_START_MS));
            Json.put(out, "last_wake_confirm_finish_to_decision_ms",
                    nullableInt(KEY_LAST_WAKE_CONFIRM_FINISH_TO_DECISION_MS));
            Json.put(out, "last_wake_capture_finish_to_chime_ms",
                    nullableInt(KEY_LAST_WAKE_CAPTURE_FINISH_TO_CHIME_MS));
            Json.put(out, "last_wake_gate_to_chime_ms", nullableInt(KEY_LAST_WAKE_GATE_TO_CHIME_MS));
            Json.put(out, "last_wake_gate_to_turn_start_request_ms",
                    nullableInt(KEY_LAST_WAKE_GATE_TO_TURN_START_REQUEST_MS));
            Json.put(out, "active_turn_id", activeTurnId.isEmpty() ? JSONObject.NULL : activeTurnId);
            Json.put(out, "active_turn_source", activeTurnSource.isEmpty() ? JSONObject.NULL : activeTurnSource);
            Json.put(out, "suspended_reason", suspendedReason.isEmpty() ? JSONObject.NULL : suspendedReason);
            Json.put(out, "last_error", lastError.isEmpty() ? JSONObject.NULL : lastError);
            Json.put(out, "last_wake_phrase", lastWakePhrase.isEmpty() ? JSONObject.NULL : lastWakePhrase);
            Json.put(out, "last_wake_at", lastWakeAt.isEmpty() ? JSONObject.NULL : lastWakeAt);
            Json.put(out, "last_confirmation_status",
                    nullable(prefs.getString(KEY_LAST_CONFIRMATION_STATUS, WakeConfirmationDecision.STATUS_NOT_RUN)));
            Json.put(out, "last_confirmation_transcript",
                    nullable(prefs.getString(KEY_LAST_CONFIRMATION_TRANSCRIPT, lastConfirmationTranscript)));
            Json.put(out, "last_confirmation_alternatives",
                    jsonArrayPref(KEY_LAST_CONFIRMATION_ALTERNATIVES_JSON));
            Json.put(out, "last_confirmation_confidences",
                    jsonArrayPref(KEY_LAST_CONFIRMATION_CONFIDENCES_JSON));
            Json.put(out, "last_confirmation_error_code",
                    nullable(prefs.getString(KEY_LAST_CONFIRMATION_ERROR_CODE, "")));
            Json.put(out, "last_confirmation_error_message",
                    nullable(prefs.getString(KEY_LAST_CONFIRMATION_ERROR_MESSAGE, "")));
            Json.put(out, "last_reject_reason",
                    nullable(prefs.getString(KEY_LAST_REJECT_REASON,
                            WakeConfirmationDecision.REASON_NO_CANDIDATE_DETECTED)));
            Json.put(out, "last_debug_clip_path",
                    nullable(storedDebugClipPath()));
            Json.put(out, "last_config_set_at", nullable(prefs.getString(KEY_LAST_CONFIG_SET_AT, "")));
            Json.put(out, "last_start_requested_at", nullable(prefs.getString(KEY_LAST_START_REQUESTED_AT, "")));
            Json.put(out, "last_stop_requested_at", nullable(prefs.getString(KEY_LAST_STOP_REQUESTED_AT, "")));
            Json.put(out, "last_simulate_requested_at", nullable(prefs.getString(KEY_LAST_SIMULATE_REQUESTED_AT, "")));
            Json.put(out, "sentinel_started_at",
                    sentinelStartedWallMs <= 0L ? JSONObject.NULL : Instant.ofEpochMilli(sentinelStartedWallMs).toString());
            Json.put(out, "android_stt", androidSttStatusLocked());
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
        if (args != null && args.has("wake_engine")) {
            editor.putString(KEY_WAKE_ENGINE, sanitizeWakeEngine(args.optString("wake_engine", "")));
        }
        boolean clearDebugForensics = false;
        if (args != null && args.has("debug_keep_last_clip")) {
            boolean enabled = args.optBoolean("debug_keep_last_clip", false);
            editor.putBoolean(KEY_DEBUG_KEEP_LAST_CLIP, enabled);
            clearDebugForensics = !enabled;
        }
        editor.putString(KEY_LAST_CONFIG_SET_AT, Instant.now().toString());
        editor.apply();
        if (clearDebugForensics) {
            clearWakeDebugForensics();
        }
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
            recordConfirmationDirect(
                    WakeConfirmationDecision.STATUS_REJECTED,
                    requested,
                    singleValueArray(requested),
                    new JSONArray(),
                    WakeConfirmationDecision.REASON_CONFIRMATION_NO_MATCH);
            out = status();
            Json.put(out, "simulated", false);
            Json.put(out, "error_code", "invalid_wake_phrase");
            Json.put(out, "error_message", "wake.simulate phrase must match the hey_pucky wake family");
            Log.i(TAG, "wake rejected trigger=wake_simulate reason="
                    + WakeConfirmationDecision.REASON_CONFIRMATION_NO_MATCH
                    + " transcript=" + requested);
            return out;
        }
        recordConfirmationDirect(
                WakeConfirmationDecision.STATUS_ACCEPTED,
                requested,
                singleValueArray(requested),
                new JSONArray(),
                WakeConfirmationDecision.REASON_ACCEPTED);
        boolean accepted = handleWakeAccepted(matchedPhrase, requested, "wake_simulate");
        out = status();
        Json.put(out, "simulated", accepted);
        Json.put(out, "simulated_phrase", matchedPhrase);
        return out;
    }

    public synchronized JSONObject confirmArtifact(JSONObject args) throws Exception {
        String path = args == null ? "" : args.optString("path", args.optString("device_path", "")).trim();
        if (path.isEmpty()) {
            throw new IllegalArgumentException("wake.debug.confirm_artifact requires path");
        }
        short[] candidateSamples = OnDeviceInjectedAudioRecognizer.readPcm16MonoWav(readArtifactBytes(path));
        String debugClipPath = recordCandidateAttempt(candidateSamples);
        WakeRecognitionAttempt attempt = recognizeCandidate(candidateSamples);
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(attempt.outcome);
        recordConfirmationOutcome(attempt, decision, debugClipPath, null);
        synchronized (lock) {
            lastConfirmationTranscript = attempt.outcome.transcript;
            lastError = attempt.outcome.succeeded ? "" : attempt.outcome.errorCode + ": "
                    + attempt.outcome.errorMessage;
        }

        boolean startTurn = args != null && args.optBoolean("start_turn", false);
        boolean turnStarted = false;
        if (decision.accepted && startTurn) {
            turnStarted = handleWakeAccepted(decision.matchedPhrase, attempt.outcome.transcript,
                    "wake_debug_confirm_artifact");
        }

        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.wake_debug_confirm_artifact.v1");
        Json.put(out, "path", path);
        Json.put(out, "samples", candidateSamples.length);
        Json.put(out, "duration_ms", WakeDebugClipStore.durationMs(candidateSamples));
        Json.put(out, "confirmation_clip_duration_ms", attempt.shapedDurationMs);
        Json.put(out, "confirmation_padded_duration_ms", attempt.paddedDurationMs);
        Json.put(out, "confirmation_recognizer_ms", attempt.recognizerMs);
        Json.put(out, "accepted", decision.accepted);
        Json.put(out, "matched_phrase", decision.matchedPhrase.isEmpty() ? JSONObject.NULL : decision.matchedPhrase);
        Json.put(out, "confirmation_status", decision.confirmationStatus);
        Json.put(out, "reject_reason", decision.reason);
        Json.put(out, "transcript", attempt.outcome.transcript);
        Json.put(out, "alternatives", attempt.outcome.alternatives);
        Json.put(out, "confidences", attempt.outcome.confidences);
        Json.put(out, "recognizer_succeeded", attempt.outcome.succeeded);
        Json.put(out, "error_code", attempt.outcome.errorCode.isEmpty() ? JSONObject.NULL : attempt.outcome.errorCode);
        Json.put(out, "error_message", attempt.outcome.errorMessage.isEmpty() ? JSONObject.NULL
                : attempt.outcome.errorMessage);
        Json.put(out, "debug_clip_path", debugClipPath.isEmpty() ? JSONObject.NULL : debugClipPath);
        Json.put(out, "start_turn", startTurn);
        Json.put(out, "turn_started", turnStarted);
        if (turnStarted) {
            Json.put(out, "turn_status", status());
        }
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
            String requestedEngine = requestedWakeEngine();
            if (sentinelRunning && !requestedEngine.equals(effectiveWakeEngine)) {
                stopSentinelLocked("wake_engine_changed");
            }
            if (!sentinelRunning) {
                startSentinelLocked();
            }
        }
    }

    private boolean handleWakeAccepted(String matchedPhrase, String transcript, String trigger) {
        return handleWakeAccepted(matchedPhrase, transcript, trigger, null, -1L);
    }

    private boolean handleWakeAccepted(String matchedPhrase, String transcript, String trigger, WakeTiming timing) {
        return handleWakeAccepted(matchedPhrase, transcript, trigger, timing, -1L);
    }

    private boolean handleWakeAccepted(String matchedPhrase,
                                       String transcript,
                                       String trigger,
                                       WakeTiming timing,
                                       long androidAcceptedMs) {
        if (timing != null) {
            timing.chimeRequestedMs = SystemClock.elapsedRealtime();
            persistAcceptedTiming(timing);
        }
        long chimeRequestedMs = SystemClock.elapsedRealtime();
        if (androidAcceptedMs > 0L) {
            prefs.edit()
                    .putInt(KEY_ANDROID_STT_ACCEPT_TO_CHIME_MS, elapsedInt(androidAcceptedMs, chimeRequestedMs))
                    .apply();
        }
        JSONObject chime = recipeExecutor.playWakeListeningChime("pucky.wake_listening_chime.v1");
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
            if (timing != null) {
                timing.turnStartRequestedMs = SystemClock.elapsedRealtime();
                persistAcceptedTiming(timing);
            }
            long turnStartRequestedMs = SystemClock.elapsedRealtime();
            if (androidAcceptedMs > 0L) {
                prefs.edit()
                        .putInt(KEY_ANDROID_STT_ACCEPT_TO_TURN_START_REQUEST_MS,
                                elapsedInt(androidAcceptedMs, turnStartRequestedMs))
                        .apply();
            }
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
        if (ENGINE_ANDROID_STT_SENTINEL.equals(requestedWakeEngine())) {
            startAndroidSttSentinelLocked();
            return;
        }
        startVadConfirmSentinelLocked();
    }

    private void startVadConfirmSentinelLocked() {
        AudioFrameBus bus = new AudioFrameBus(context);
        PreRollBuffer preRoll = new PreRollBuffer();
        WakeProbeRecorder recorder = new WakeProbeRecorder(new SileroVadEngine(context));
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
        effectiveWakeEngine = ENGINE_VAD_CONFIRM;
        candidateActive = false;
        confirmingCandidate = false;
        suspendedReason = "";
        lastError = "";
        sentinelStartedElapsedMs = SystemClock.elapsedRealtime();
        sentinelStartedWallMs = System.currentTimeMillis();
    }

    private void stopSentinelLocked(String reason) {
        stopAndroidSttSentinelLocked(reason);
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
        effectiveWakeEngine = "";
        if (reason != null && !reason.trim().isEmpty()) {
            suspendedReason = reason;
        }
    }

    private void startAndroidSttSentinelLocked() {
        if (!hasRecordAudio()) {
            suspendedReason = "record_audio_permission_missing";
            lastError = "RECORD_AUDIO is not granted";
            return;
        }
        if (!onDeviceRecognitionAvailable()) {
            suspendedReason = "android_stt_unavailable";
            lastError = "Android on-device SpeechRecognizer is unavailable";
            return;
        }
        sentinelRunning = true;
        effectiveWakeEngine = ENGINE_ANDROID_STT_SENTINEL;
        candidateActive = false;
        confirmingCandidate = false;
        suspendedReason = "";
        lastError = "";
        sentinelStartedElapsedMs = SystemClock.elapsedRealtime();
        sentinelStartedWallMs = System.currentTimeMillis();
        androidSttRestartCount = 0;
        prefs.edit().putInt(KEY_ANDROID_STT_RESTART_COUNT, 0).apply();
        startAndroidSttSessionLocked("initial_start");
    }

    private void startAndroidSttSessionLocked(String reason) {
        String sessionId = "wake_stt_" + Long.toHexString(System.currentTimeMillis());
        androidSttSessionId = sessionId;
        androidSttState = "pending_start";
        androidSttListening = false;
        androidSttSessionStartedMs = SystemClock.elapsedRealtime();
        androidSttReadyMs = -1L;
        androidSttSpeechBeginMs = -1L;
        androidSttFirstPartialMs = -1L;
        androidSttFinalOrErrorMs = -1L;
        androidSttAcceptedMs = -1L;
        persistAndroidSttEventLocked("session_start", "", new JSONArray(), new JSONArray(), "", "");
        Log.i(TAG, "wake android_stt session_start reason=" + reason + " session_id=" + sessionId);
        main.post(() -> startAndroidSttRecognizerOnMain(sessionId));
    }

    private void startAndroidSttRecognizerOnMain(String sessionId) {
        synchronized (lock) {
            if (!sentinelRunning
                    || !ENGINE_ANDROID_STT_SENTINEL.equals(effectiveWakeEngine)
                    || !sessionId.equals(androidSttSessionId)) {
                return;
            }
            androidSttState = "starting";
        }
        try {
            SpeechRecognizer created = SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
            synchronized (lock) {
                if (!sentinelRunning
                        || !ENGINE_ANDROID_STT_SENTINEL.equals(effectiveWakeEngine)
                        || !sessionId.equals(androidSttSessionId)) {
                    try {
                        created.destroy();
                    } catch (RuntimeException ignored) {
                    }
                    return;
                }
                androidSttRecognizer = created;
            }
            created.setRecognitionListener(new AndroidSttListener(sessionId));
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.getPackageName());
            addFormattingExtras(intent);
            created.startListening(intent);
        } catch (RuntimeException exc) {
            handleAndroidSttError(sessionId, "start_failed",
                    exc.getClass().getSimpleName() + ": " + exc.getMessage(), false);
        }
    }

    private void stopAndroidSttSentinelLocked(String reason) {
        if (androidSttRestartRunnable != null) {
            main.removeCallbacks(androidSttRestartRunnable);
            androidSttRestartRunnable = null;
        }
        String sessionId = androidSttSessionId;
        androidSttSessionId = "";
        androidSttListening = false;
        androidSttState = "idle";
        if (androidSttRecognizer != null) {
            main.post(() -> cleanupAndroidSttRecognizer(sessionId));
        }
        if (reason != null && !reason.trim().isEmpty()) {
            prefs.edit()
                    .putString(KEY_ANDROID_STT_LAST_EVENT, "stopped")
                    .putString(KEY_ANDROID_STT_LAST_STATE, "idle")
                    .putString(KEY_ANDROID_STT_LAST_RESTART_REASON, reason)
                    .apply();
        }
    }

    private void cleanupAndroidSttRecognizer(String sessionId) {
        SpeechRecognizer recognizerToDestroy;
        synchronized (lock) {
            if (sessionId != null && !sessionId.isEmpty() && !sessionId.equals(androidSttSessionId)
                    && androidSttRecognizer == null) {
                return;
            }
            recognizerToDestroy = androidSttRecognizer;
            androidSttRecognizer = null;
            androidSttListening = false;
        }
        if (recognizerToDestroy != null) {
            try {
                recognizerToDestroy.destroy();
            } catch (RuntimeException ignored) {
            }
        }
    }

    private void scheduleAndroidSttRestart(String sessionId, String reason) {
        synchronized (lock) {
            if (!sentinelRunning
                    || !ENGINE_ANDROID_STT_SENTINEL.equals(effectiveWakeEngine)
                    || !sessionId.equals(androidSttSessionId)
                    || !activeTurnId.isEmpty()) {
                return;
            }
            androidSttRestartCount += 1;
            int persistedCount = prefs.getInt(KEY_ANDROID_STT_RESTART_COUNT, 0) + 1;
            prefs.edit()
                    .putInt(KEY_ANDROID_STT_RESTART_COUNT, persistedCount)
                    .putString(KEY_ANDROID_STT_LAST_RESTART_REASON, reason)
                    .apply();
            long delayMs = Math.min(ANDROID_STT_RESTART_MAX_MS,
                    ANDROID_STT_RESTART_BASE_MS * Math.max(1L, Math.min(8L, androidSttRestartCount)));
            androidSttState = "restart_scheduled";
            androidSttListening = false;
            Log.i(TAG, "wake android_stt restart reason=" + reason
                    + " delay_ms=" + delayMs
                    + " count=" + persistedCount);
            androidSttRestartRunnable = () -> {
                synchronized (lock) {
                    if (!sentinelRunning
                            || !ENGINE_ANDROID_STT_SENTINEL.equals(effectiveWakeEngine)
                            || !sessionId.equals(androidSttSessionId)
                            || !activeTurnId.isEmpty()) {
                        return;
                    }
                    cleanupAndroidSttRecognizer(sessionId);
                    startAndroidSttSessionLocked(reason);
                }
            };
            main.postDelayed(androidSttRestartRunnable, delayMs);
        }
    }

    private void handleAndroidSttError(String sessionId, String code, String message, boolean recognizerCallback) {
        long nowMs = SystemClock.elapsedRealtime();
        synchronized (lock) {
            if (!sessionId.equals(androidSttSessionId)) {
                return;
            }
            androidSttFinalOrErrorMs = nowMs;
            androidSttState = "error";
            androidSttListening = false;
            lastError = code + ": " + message;
            persistAndroidSttEventLocked("error", "", new JSONArray(), new JSONArray(), code, message);
            recordConfirmationDirect(
                    WakeConfirmationDecision.STATUS_ERROR,
                    "",
                    new JSONArray(),
                    new JSONArray(),
                    WakeConfirmationDecision.REASON_CONFIRMATION_ERROR,
                    code,
                    message);
        }
        Log.i(TAG, "wake android_stt error session_id=" + sessionId
                + " callback=" + recognizerCallback
                + " code=" + code
                + " message=" + message);
        cleanupAndroidSttRecognizer(sessionId);
        scheduleAndroidSttRestart(sessionId, code);
    }

    private void handleAndroidSttNoMatch(String sessionId, JSONArray alternatives, JSONArray confidences) {
        synchronized (lock) {
            if (!sessionId.equals(androidSttSessionId)) {
                return;
            }
            androidSttFinalOrErrorMs = SystemClock.elapsedRealtime();
            androidSttState = "no_match";
            androidSttListening = false;
            String transcript = alternatives == null || alternatives.length() == 0
                    ? ""
                    : alternatives.optString(0, "");
            persistAndroidSttEventLocked("no_match", transcript, alternatives, confidences, "", "");
            recordConfirmationDirect(
                    WakeConfirmationDecision.STATUS_REJECTED,
                    transcript,
                    alternatives,
                    confidences,
                    WakeConfirmationDecision.REASON_CONFIRMATION_NO_MATCH);
        }
        Log.i(TAG, "wake android_stt final_no_match alternatives=" + alternatives);
        cleanupAndroidSttRecognizer(sessionId);
        scheduleAndroidSttRestart(sessionId, WakeConfirmationDecision.REASON_CONFIRMATION_NO_MATCH);
    }

    private void handleAndroidSttAccepted(String sessionId,
                                          WakeSttSentinelDecision decision,
                                          JSONArray alternatives,
                                          JSONArray confidences) {
        long acceptedMs = SystemClock.elapsedRealtime();
        synchronized (lock) {
            if (!sessionId.equals(androidSttSessionId)) {
                return;
            }
            androidSttAcceptedMs = acceptedMs;
            androidSttFinalOrErrorMs = acceptedMs;
            androidSttState = "accepted";
            androidSttListening = false;
            lastError = "";
            persistAndroidSttEventLocked("accepted", decision.transcript, alternatives, confidences, "", "");
            recordConfirmationDirect(
                    WakeConfirmationDecision.STATUS_ACCEPTED,
                    decision.transcript,
                    alternatives,
                    confidences,
                    WakeConfirmationDecision.REASON_ACCEPTED);
        }
        Log.i(TAG, "wake android_stt accepted session_id=" + sessionId
                + " partial=" + decision.partial
                + " phrase=" + decision.matchedPhrase
                + " transcript=" + decision.transcript);
        cleanupAndroidSttRecognizer(sessionId);
        handleWakeAccepted(decision.matchedPhrase, decision.transcript, "android_stt_sentinel", null, acceptedMs);
    }

    private final class AndroidSttListener implements RecognitionListener {
        private final String sessionId;

        AndroidSttListener(String sessionId) {
            this.sessionId = sessionId;
        }

        @Override
        public void onReadyForSpeech(Bundle params) {
            synchronized (lock) {
                if (!sessionId.equals(androidSttSessionId)) {
                    return;
                }
                androidSttReadyMs = SystemClock.elapsedRealtime();
                androidSttState = "ready";
                androidSttListening = true;
                persistAndroidSttEventLocked("ready", "", new JSONArray(), new JSONArray(), "", "");
            }
            Log.i(TAG, "wake android_stt ready session_id=" + sessionId);
        }

        @Override
        public void onBeginningOfSpeech() {
            synchronized (lock) {
                if (!sessionId.equals(androidSttSessionId)) {
                    return;
                }
                androidSttSpeechBeginMs = SystemClock.elapsedRealtime();
                androidSttState = "speech_begin";
                persistAndroidSttEventLocked("speech_begin", "", new JSONArray(), new JSONArray(), "", "");
            }
            Log.i(TAG, "wake android_stt speech_begin session_id=" + sessionId);
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
                if (sessionId.equals(androidSttSessionId)) {
                    androidSttState = "speech_end";
                    persistAndroidSttEventLocked("speech_end", "", new JSONArray(), new JSONArray(), "", "");
                }
            }
            Log.i(TAG, "wake android_stt speech_end session_id=" + sessionId);
        }

        @Override
        public void onError(int error) {
            handleAndroidSttError(sessionId, errorName(error),
                    "Android on-device SpeechRecognizer error " + error + " (" + errorName(error) + ")",
                    true);
        }

        @Override
        public void onResults(Bundle results) {
            JSONArray alternatives = alternatives(results);
            JSONArray confidences = confidences(results);
            WakeSttSentinelDecision decision = WakeSttSentinelDecision.decide(alternatives, false);
            synchronized (lock) {
                if (!sessionId.equals(androidSttSessionId)) {
                    return;
                }
                androidSttFinalOrErrorMs = SystemClock.elapsedRealtime();
                androidSttState = "final";
                persistAndroidSttEventLocked("final", alternatives.optString(0, ""), alternatives, confidences, "", "");
            }
            Log.i(TAG, "wake android_stt final session_id=" + sessionId
                    + " alternatives=" + alternatives);
            if (decision.accepted) {
                handleAndroidSttAccepted(sessionId, decision, alternatives, confidences);
            } else {
                handleAndroidSttNoMatch(sessionId, alternatives, confidences);
            }
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            JSONArray alternatives = alternatives(partialResults);
            WakeSttSentinelDecision decision = WakeSttSentinelDecision.decide(alternatives, true);
            synchronized (lock) {
                if (!sessionId.equals(androidSttSessionId)) {
                    return;
                }
                if (androidSttFirstPartialMs <= 0L) {
                    androidSttFirstPartialMs = SystemClock.elapsedRealtime();
                }
                androidSttState = "partial";
                persistAndroidSttEventLocked("partial", alternatives.optString(0, ""), alternatives,
                        new JSONArray(), "", "");
            }
            Log.i(TAG, "wake android_stt partial session_id=" + sessionId
                    + " alternatives=" + alternatives);
            if (decision.accepted) {
                handleAndroidSttAccepted(sessionId, decision, alternatives, new JSONArray());
            }
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
        }

        @Override
        public void onLanguageDetection(Bundle results) {
        }
    }

    private void onSentinelSpeechDetected() {
        short[] preRoll;
        WakeTiming timing = WakeTiming.start(SystemClock.elapsedRealtime());
        synchronized (lock) {
            if (!sentinelRunning || candidateRecorder == null || candidateActive || confirmingCandidate) {
                return;
            }
            preRoll = preRollBuffer == null
                    ? new short[0]
                    : WakeProbeClipShaper.limitPreRoll(preRollBuffer.snapshotSamples());
            timing.captureStartedMs = SystemClock.elapsedRealtime();
            candidateRecorder.begin(preRoll);
            candidateActive = true;
            suspendedReason = "candidate_capturing";
        }
        Thread worker = new Thread(() -> {
            while (true) {
                try {
                    Thread.sleep(PROBE_POLL_MS);
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
                WakeCandidateMetrics metrics;
                synchronized (lock) {
                    if (candidateRecorder == null) {
                        candidateActive = false;
                        return;
                    }
                    if (!candidateRecorder.readyToFinish()) {
                        continue;
                    }
                    timing.captureFinishedMs = SystemClock.elapsedRealtime();
                    metrics = candidateRecorder.metrics();
                    candidateSamples = candidateRecorder.finish();
                    candidateActive = false;
                    confirmingCandidate = true;
                    stopSentinelLocked("candidate_confirming");
                }
                confirmCandidate(candidateSamples, timing, metrics);
                return;
            }
        }, "pucky-wake-candidate");
        worker.setDaemon(true);
        worker.start();
    }

    private void confirmCandidate(short[] candidateSamples, WakeTiming timing, WakeCandidateMetrics metrics) {
        String debugClipPath = recordCandidateAttempt(candidateSamples, metrics);
        if (timing != null) {
            timing.confirmStartedMs = SystemClock.elapsedRealtime();
        }
        WakeRecognitionAttempt attempt = recognizeCandidate(candidateSamples);
        if (timing != null) {
            timing.confirmFinishedMs = SystemClock.elapsedRealtime();
        }
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(attempt.outcome);
        if (timing != null) {
            timing.decisionMs = SystemClock.elapsedRealtime();
        }
        recordConfirmationOutcome(attempt, decision, debugClipPath, timing);
        synchronized (lock) {
            confirmingCandidate = false;
            lastConfirmationTranscript = attempt.outcome.transcript;
            if (!attempt.outcome.succeeded) {
                lastError = attempt.outcome.errorCode + ": " + attempt.outcome.errorMessage;
            } else {
                lastError = "";
            }
        }
        if (decision.accepted && handleWakeAccepted(decision.matchedPhrase, attempt.outcome.transcript, "voice",
                timing)) {
            return;
        }
        Log.i(TAG, "wake rejected trigger=voice reason=" + decision.reason
                + " status=" + decision.confirmationStatus
                + " transcript=" + attempt.outcome.transcript);
        reevaluate();
    }

    private WakeRecognitionAttempt recognizeCandidate(short[] candidateSamples) {
        short[] shaped = WakeProbeClipShaper.shapeForConfirmation(candidateSamples);
        short[] padded = OnDeviceInjectedAudioRecognizer.padSamplesForRecognition(shaped);
        long startedMs = SystemClock.elapsedRealtime();
        OnDeviceInjectedAudioRecognizer.RecognitionOutcome outcome = recognizer.recognize(padded, CONFIRM_TIMEOUT_MS);
        long finishedMs = SystemClock.elapsedRealtime();
        return new WakeRecognitionAttempt(
                outcome,
                WakeDebugClipStore.durationMs(candidateSamples),
                WakeDebugClipStore.durationMs(shaped),
                WakeDebugClipStore.durationMs(padded),
                elapsedInt(startedMs, finishedMs));
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

    private String requestedWakeEngine() {
        return sanitizeWakeEngine(prefs.getString(KEY_WAKE_ENGINE, ENGINE_VAD_CONFIRM));
    }

    private String effectiveWakeEngineLocked() {
        if (!effectiveWakeEngine.isEmpty()) {
            return effectiveWakeEngine;
        }
        return requestedWakeEngine();
    }

    private static String sanitizeWakeEngine(String raw) {
        String engine = raw == null ? "" : raw.trim().toLowerCase(Locale.US);
        if (ENGINE_ANDROID_STT_SENTINEL.equals(engine)) {
            return ENGINE_ANDROID_STT_SENTINEL;
        }
        return ENGINE_VAD_CONFIRM;
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

    private Object nullableInt(String key) {
        return prefs.contains(key) ? prefs.getInt(key, 0) : JSONObject.NULL;
    }

    private Object nullableDouble(String key) {
        return prefs.contains(key) ? Double.longBitsToDouble(prefs.getLong(key, 0L)) : JSONObject.NULL;
    }

    private static void putDouble(SharedPreferences.Editor editor, String key, double value) {
        editor.putLong(key, Double.doubleToRawLongBits(value));
    }

    private boolean debugKeepLastClip() {
        return prefs.getBoolean(KEY_DEBUG_KEEP_LAST_CLIP, false);
    }

    private String storedDebugClipPath() {
        String stored = prefs.getString(KEY_LAST_DEBUG_CLIP_PATH, "");
        String existing = debugClipStore.currentPathIfExists();
        if (!stored.isEmpty() && stored.equals(existing)) {
            return stored;
        }
        return existing;
    }

    private JSONArray jsonArrayPref(String key) {
        String raw = prefs.getString(key, "");
        if (raw == null || raw.trim().isEmpty()) {
            return new JSONArray();
        }
        try {
            return new JSONArray(raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private String recordCandidateAttempt(short[] candidateSamples) {
        return recordCandidateAttempt(candidateSamples, WakeCandidateMetrics.fromSamples(candidateSamples, "", 0.0));
    }

    private String recordCandidateAttempt(short[] candidateSamples, WakeCandidateMetrics metrics) {
        int samples = candidateSamples == null ? 0 : candidateSamples.length;
        int durationMs = WakeDebugClipStore.durationMs(candidateSamples);
        WakeCandidateMetrics safeMetrics = metrics == null
                ? WakeCandidateMetrics.fromSamples(candidateSamples, "", 0.0)
                : metrics;
        SharedPreferences.Editor editor = prefs.edit();
        editor.putInt(KEY_CANDIDATE_COUNT, prefs.getInt(KEY_CANDIDATE_COUNT, 0) + 1);
        editor.putString(KEY_LAST_CANDIDATE_AT, Instant.now().toString());
        editor.putInt(KEY_LAST_CANDIDATE_DURATION_MS, durationMs);
        editor.putInt(KEY_LAST_CANDIDATE_SAMPLES, samples);
        editor.putInt(KEY_LAST_CANDIDATE_PEAK, safeMetrics.peak);
        editor.putInt(KEY_LAST_CANDIDATE_RMS, safeMetrics.rms);
        putDouble(editor, KEY_LAST_CANDIDATE_MAX_VAD_PROBABILITY, safeMetrics.maxVadProbability);
        editor.putString(KEY_LAST_CANDIDATE_FINISH_REASON, safeMetrics.finishReason);
        editor.putString(KEY_LAST_CONFIRMATION_STATUS, WakeConfirmationDecision.STATUS_PENDING);
        editor.putString(KEY_LAST_REJECT_REASON, "");
        String debugClipPath = "";
        if (debugKeepLastClip()) {
            try {
                debugClipPath = debugClipStore.save(candidateSamples);
                editor.putString(KEY_LAST_DEBUG_CLIP_PATH, debugClipPath);
            } catch (IOException exc) {
                lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
                editor.remove(KEY_LAST_DEBUG_CLIP_PATH);
            }
        } else {
            editor.remove(KEY_LAST_DEBUG_CLIP_PATH);
        }
        editor.apply();
        Log.i(TAG, "wake candidate captured samples=" + samples
                + " duration_ms=" + durationMs
                + " peak=" + safeMetrics.peak
                + " rms=" + safeMetrics.rms
                + " max_vad_probability=" + safeMetrics.maxVadProbability
                + " finish_reason=" + safeMetrics.finishReason
                + " debug_clip=" + (!debugClipPath.isEmpty()));
        return debugClipPath;
    }

    private void recordConfirmationOutcome(WakeRecognitionAttempt attempt,
                                           WakeConfirmationDecision decision,
                                           String debugClipPath,
                                           WakeTiming timing) {
        SharedPreferences.Editor editor = prefs.edit();
        editor.putString(KEY_LAST_CONFIRMATION_STATUS, decision.confirmationStatus);
        editor.putString(KEY_LAST_CONFIRMATION_TRANSCRIPT, attempt.outcome.transcript);
        editor.putString(KEY_LAST_CONFIRMATION_ALTERNATIVES_JSON, attempt.outcome.alternatives.toString());
        editor.putString(KEY_LAST_CONFIRMATION_CONFIDENCES_JSON, attempt.outcome.confidences.toString());
        editor.putString(KEY_LAST_CONFIRMATION_ERROR_CODE, attempt.outcome.errorCode);
        editor.putString(KEY_LAST_CONFIRMATION_ERROR_MESSAGE, attempt.outcome.errorMessage);
        editor.putString(KEY_LAST_REJECT_REASON, decision.reason);
        editor.putInt(KEY_LAST_CONFIRMATION_RAW_DURATION_MS, attempt.rawDurationMs);
        editor.putInt(KEY_LAST_CONFIRMATION_CLIP_DURATION_MS, attempt.shapedDurationMs);
        editor.putInt(KEY_LAST_CONFIRMATION_PADDED_DURATION_MS, attempt.paddedDurationMs);
        editor.putInt(KEY_LAST_CONFIRMATION_RECOGNIZER_MS, attempt.recognizerMs);
        putTiming(editor, timing);
        if (!debugClipPath.isEmpty()) {
            editor.putString(KEY_LAST_DEBUG_CLIP_PATH, debugClipPath);
        }
        editor.apply();
        Log.i(TAG, "wake timing status=" + decision.confirmationStatus
                + " reason=" + decision.reason
                + " raw_ms=" + attempt.rawDurationMs
                + " shaped_ms=" + attempt.shapedDurationMs
                + " padded_ms=" + attempt.paddedDurationMs
                + " recognizer_ms=" + attempt.recognizerMs
                + " capture_ms=" + durationOrNull(timing == null ? -1L : timing.captureStartedMs,
                timing == null ? -1L : timing.captureFinishedMs)
                + " finish_to_confirm_start_ms=" + durationOrNull(timing == null ? -1L : timing.captureFinishedMs,
                timing == null ? -1L : timing.confirmStartedMs)
                + " error_code=" + attempt.outcome.errorCode
                + " transcript=" + attempt.outcome.transcript);
    }

    private void recordConfirmationDirect(String status,
                                          String transcript,
                                          JSONArray alternatives,
                                          JSONArray confidences,
                                          String reason) {
        recordConfirmationDirect(status, transcript, alternatives, confidences, reason, "", "");
    }

    private void recordConfirmationDirect(String status,
                                          String transcript,
                                          JSONArray alternatives,
                                          JSONArray confidences,
                                          String reason,
                                          String errorCode,
                                          String errorMessage) {
        lastConfirmationTranscript = transcript == null ? "" : transcript;
        SharedPreferences.Editor editor = prefs.edit();
        editor.putString(KEY_LAST_CONFIRMATION_STATUS, status);
        editor.putString(KEY_LAST_CONFIRMATION_TRANSCRIPT, transcript == null ? "" : transcript);
        editor.putString(KEY_LAST_CONFIRMATION_ALTERNATIVES_JSON,
                alternatives == null ? new JSONArray().toString() : alternatives.toString());
        editor.putString(KEY_LAST_CONFIRMATION_CONFIDENCES_JSON,
                confidences == null ? new JSONArray().toString() : confidences.toString());
        editor.putString(KEY_LAST_CONFIRMATION_ERROR_CODE, errorCode == null ? "" : errorCode);
        editor.putString(KEY_LAST_CONFIRMATION_ERROR_MESSAGE, errorMessage == null ? "" : errorMessage);
        editor.putString(KEY_LAST_REJECT_REASON, reason == null ? "" : reason);
        editor.remove(KEY_LAST_CONFIRMATION_RAW_DURATION_MS);
        editor.remove(KEY_LAST_CONFIRMATION_CLIP_DURATION_MS);
        editor.remove(KEY_LAST_CONFIRMATION_PADDED_DURATION_MS);
        editor.remove(KEY_LAST_CONFIRMATION_RECOGNIZER_MS);
        editor.remove(KEY_LAST_WAKE_CAPTURE_MS);
        editor.remove(KEY_LAST_WAKE_GATE_TO_CAPTURE_START_MS);
        editor.remove(KEY_LAST_WAKE_CAPTURE_FINISH_TO_CONFIRM_START_MS);
        editor.remove(KEY_LAST_WAKE_CONFIRM_FINISH_TO_DECISION_MS);
        editor.remove(KEY_LAST_WAKE_CAPTURE_FINISH_TO_CHIME_MS);
        editor.remove(KEY_LAST_WAKE_GATE_TO_CHIME_MS);
        editor.remove(KEY_LAST_WAKE_GATE_TO_TURN_START_REQUEST_MS);
        editor.apply();
    }

    private void clearWakeDebugForensics() {
        debugClipStore.clear();
        lastConfirmationTranscript = "";
        lastError = "";
        prefs.edit()
                .putInt(KEY_CANDIDATE_COUNT, 0)
                .remove(KEY_LAST_CANDIDATE_AT)
                .remove(KEY_LAST_CANDIDATE_DURATION_MS)
                .remove(KEY_LAST_CANDIDATE_SAMPLES)
                .remove(KEY_LAST_CANDIDATE_PEAK)
                .remove(KEY_LAST_CANDIDATE_RMS)
                .remove(KEY_LAST_CANDIDATE_MAX_VAD_PROBABILITY)
                .remove(KEY_LAST_CANDIDATE_FINISH_REASON)
                .remove(KEY_LAST_CONFIRMATION_RAW_DURATION_MS)
                .remove(KEY_LAST_CONFIRMATION_CLIP_DURATION_MS)
                .remove(KEY_LAST_CONFIRMATION_PADDED_DURATION_MS)
                .remove(KEY_LAST_CONFIRMATION_RECOGNIZER_MS)
                .remove(KEY_LAST_WAKE_CAPTURE_MS)
                .remove(KEY_LAST_WAKE_GATE_TO_CAPTURE_START_MS)
                .remove(KEY_LAST_WAKE_CAPTURE_FINISH_TO_CONFIRM_START_MS)
                .remove(KEY_LAST_WAKE_CONFIRM_FINISH_TO_DECISION_MS)
                .remove(KEY_LAST_WAKE_CAPTURE_FINISH_TO_CHIME_MS)
                .remove(KEY_LAST_WAKE_GATE_TO_CHIME_MS)
                .remove(KEY_LAST_WAKE_GATE_TO_TURN_START_REQUEST_MS)
                .putString(KEY_LAST_CONFIRMATION_STATUS, WakeConfirmationDecision.STATUS_NOT_RUN)
                .remove(KEY_LAST_CONFIRMATION_TRANSCRIPT)
                .putString(KEY_LAST_CONFIRMATION_ALTERNATIVES_JSON, new JSONArray().toString())
                .putString(KEY_LAST_CONFIRMATION_CONFIDENCES_JSON, new JSONArray().toString())
                .remove(KEY_LAST_CONFIRMATION_ERROR_CODE)
                .remove(KEY_LAST_CONFIRMATION_ERROR_MESSAGE)
                .putString(KEY_LAST_REJECT_REASON, WakeConfirmationDecision.REASON_NO_CANDIDATE_DETECTED)
                .remove(KEY_LAST_DEBUG_CLIP_PATH)
                .remove(KEY_ANDROID_STT_LAST_SESSION_AT)
                .remove(KEY_ANDROID_STT_LAST_STATE)
                .remove(KEY_ANDROID_STT_LAST_EVENT)
                .remove(KEY_ANDROID_STT_LAST_TRANSCRIPT)
                .remove(KEY_ANDROID_STT_LAST_ALTERNATIVES_JSON)
                .remove(KEY_ANDROID_STT_LAST_CONFIDENCES_JSON)
                .remove(KEY_ANDROID_STT_LAST_ERROR_CODE)
                .remove(KEY_ANDROID_STT_LAST_ERROR_MESSAGE)
                .remove(KEY_ANDROID_STT_RESTART_COUNT)
                .remove(KEY_ANDROID_STT_LAST_RESTART_REASON)
                .remove(KEY_ANDROID_STT_SESSION_TO_READY_MS)
                .remove(KEY_ANDROID_STT_SESSION_TO_SPEECH_BEGIN_MS)
                .remove(KEY_ANDROID_STT_SESSION_TO_FIRST_PARTIAL_MS)
                .remove(KEY_ANDROID_STT_SESSION_TO_FINAL_OR_ERROR_MS)
                .remove(KEY_ANDROID_STT_SESSION_TO_ACCEPT_MS)
                .remove(KEY_ANDROID_STT_READY_TO_ACCEPT_MS)
                .remove(KEY_ANDROID_STT_SPEECH_BEGIN_TO_ACCEPT_MS)
                .remove(KEY_ANDROID_STT_ACCEPT_TO_CHIME_MS)
                .remove(KEY_ANDROID_STT_ACCEPT_TO_TURN_START_REQUEST_MS)
                .apply();
    }

    private static JSONArray singleValueArray(String value) {
        JSONArray out = new JSONArray();
        if (value != null && !value.trim().isEmpty()) {
            Json.add(out, value);
        }
        return out;
    }

    private byte[] readArtifactBytes(String path) throws Exception {
        File file = resolveAppOwnedPath(path);
        byte[] data = new byte[(int) file.length()];
        int offset = 0;
        try (FileInputStream input = new FileInputStream(file)) {
            while (offset < data.length) {
                int read = input.read(data, offset, data.length - offset);
                if (read < 0) {
                    break;
                }
                offset += read;
            }
        }
        if (offset == data.length) {
            return data;
        }
        return Arrays.copyOf(data, offset);
    }

    private void persistAcceptedTiming(WakeTiming timing) {
        if (timing == null) {
            return;
        }
        prefs.edit()
                .putInt(KEY_LAST_WAKE_CAPTURE_FINISH_TO_CHIME_MS,
                        elapsedInt(timing.captureFinishedMs, timing.chimeRequestedMs))
                .putInt(KEY_LAST_WAKE_GATE_TO_CHIME_MS,
                        elapsedInt(timing.gateDetectedMs, timing.chimeRequestedMs))
                .putInt(KEY_LAST_WAKE_GATE_TO_TURN_START_REQUEST_MS,
                        elapsedInt(timing.gateDetectedMs, timing.turnStartRequestedMs))
                .apply();
    }

    private static void putTiming(SharedPreferences.Editor editor, WakeTiming timing) {
        if (timing == null) {
            return;
        }
        editor.putInt(KEY_LAST_WAKE_CAPTURE_MS, elapsedInt(timing.captureStartedMs, timing.captureFinishedMs));
        editor.putInt(KEY_LAST_WAKE_GATE_TO_CAPTURE_START_MS,
                elapsedInt(timing.gateDetectedMs, timing.captureStartedMs));
        editor.putInt(KEY_LAST_WAKE_CAPTURE_FINISH_TO_CONFIRM_START_MS,
                elapsedInt(timing.captureFinishedMs, timing.confirmStartedMs));
        editor.putInt(KEY_LAST_WAKE_CONFIRM_FINISH_TO_DECISION_MS,
                elapsedInt(timing.confirmFinishedMs, timing.decisionMs));
    }

    private static int elapsedInt(long startMs, long endMs) {
        if (startMs <= 0L || endMs <= 0L || endMs < startMs) {
            return -1;
        }
        long value = endMs - startMs;
        return value > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) value;
    }

    private static String durationOrNull(long startMs, long endMs) {
        int value = elapsedInt(startMs, endMs);
        return value < 0 ? "null" : String.valueOf(value);
    }

    private File resolveAppOwnedPath(String path) throws Exception {
        if (path == null || path.trim().isEmpty()) {
            throw new IllegalArgumentException("artifact path is required");
        }
        File file = new File(path).getCanonicalFile();
        if (!isWithin(file, context.getFilesDir())
                && !isWithin(file, context.getCacheDir())
                && !isWithin(file, context.getExternalFilesDir(null))) {
            throw new IllegalArgumentException("Path is outside app-owned storage");
        }
        if (!file.exists() || !file.isFile()) {
            throw new IllegalArgumentException("Artifact file not found");
        }
        return file;
    }

    private static boolean isWithin(File file, File root) throws Exception {
        if (root == null) {
            return false;
        }
        String filePath = file.getCanonicalPath();
        String rootPath = root.getCanonicalPath();
        return filePath.equals(rootPath) || filePath.startsWith(rootPath + File.separator);
    }

    private JSONObject androidSttStatusLocked() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.wake_android_stt_status.v1");
        Json.put(out, "available", onDeviceRecognitionAvailable());
        Json.put(out, "record_audio_granted", hasRecordAudio());
        Json.put(out, "state", androidSttState);
        Json.put(out, "listening", androidSttListening);
        Json.put(out, "session_id", androidSttSessionId.isEmpty() ? JSONObject.NULL : androidSttSessionId);
        Json.put(out, "restart_count", prefs.getInt(KEY_ANDROID_STT_RESTART_COUNT, 0));
        Json.put(out, "last_restart_reason",
                nullable(prefs.getString(KEY_ANDROID_STT_LAST_RESTART_REASON, "")));
        Json.put(out, "last_session_at", nullable(prefs.getString(KEY_ANDROID_STT_LAST_SESSION_AT, "")));
        Json.put(out, "last_state", nullable(prefs.getString(KEY_ANDROID_STT_LAST_STATE, "")));
        Json.put(out, "last_event", nullable(prefs.getString(KEY_ANDROID_STT_LAST_EVENT, "")));
        Json.put(out, "last_transcript", nullable(prefs.getString(KEY_ANDROID_STT_LAST_TRANSCRIPT, "")));
        Json.put(out, "last_alternatives", jsonArrayPref(KEY_ANDROID_STT_LAST_ALTERNATIVES_JSON));
        Json.put(out, "last_confidences", jsonArrayPref(KEY_ANDROID_STT_LAST_CONFIDENCES_JSON));
        Json.put(out, "last_error_code", nullable(prefs.getString(KEY_ANDROID_STT_LAST_ERROR_CODE, "")));
        Json.put(out, "last_error_message", nullable(prefs.getString(KEY_ANDROID_STT_LAST_ERROR_MESSAGE, "")));
        Json.put(out, "session_to_ready_ms", nullableInt(KEY_ANDROID_STT_SESSION_TO_READY_MS));
        Json.put(out, "session_to_speech_begin_ms", nullableInt(KEY_ANDROID_STT_SESSION_TO_SPEECH_BEGIN_MS));
        Json.put(out, "session_to_first_partial_ms", nullableInt(KEY_ANDROID_STT_SESSION_TO_FIRST_PARTIAL_MS));
        Json.put(out, "session_to_final_or_error_ms", nullableInt(KEY_ANDROID_STT_SESSION_TO_FINAL_OR_ERROR_MS));
        Json.put(out, "session_to_accept_ms", nullableInt(KEY_ANDROID_STT_SESSION_TO_ACCEPT_MS));
        Json.put(out, "ready_to_accept_ms", nullableInt(KEY_ANDROID_STT_READY_TO_ACCEPT_MS));
        Json.put(out, "speech_begin_to_accept_ms", nullableInt(KEY_ANDROID_STT_SPEECH_BEGIN_TO_ACCEPT_MS));
        Json.put(out, "accept_to_chime_ms", nullableInt(KEY_ANDROID_STT_ACCEPT_TO_CHIME_MS));
        Json.put(out, "accept_to_turn_start_request_ms",
                nullableInt(KEY_ANDROID_STT_ACCEPT_TO_TURN_START_REQUEST_MS));
        return out;
    }

    private void persistAndroidSttEventLocked(String event,
                                              String transcript,
                                              JSONArray alternatives,
                                              JSONArray confidences,
                                              String errorCode,
                                              String errorMessage) {
        SharedPreferences.Editor editor = prefs.edit();
        editor.putString(KEY_ANDROID_STT_LAST_SESSION_AT, Instant.now().toString());
        editor.putString(KEY_ANDROID_STT_LAST_STATE, androidSttState);
        editor.putString(KEY_ANDROID_STT_LAST_EVENT, event == null ? "" : event);
        editor.putString(KEY_ANDROID_STT_LAST_TRANSCRIPT, transcript == null ? "" : transcript);
        editor.putString(KEY_ANDROID_STT_LAST_ALTERNATIVES_JSON,
                alternatives == null ? new JSONArray().toString() : alternatives.toString());
        editor.putString(KEY_ANDROID_STT_LAST_CONFIDENCES_JSON,
                confidences == null ? new JSONArray().toString() : confidences.toString());
        editor.putString(KEY_ANDROID_STT_LAST_ERROR_CODE, errorCode == null ? "" : errorCode);
        editor.putString(KEY_ANDROID_STT_LAST_ERROR_MESSAGE, errorMessage == null ? "" : errorMessage);
        if (androidSttReadyMs > 0L) {
            editor.putInt(KEY_ANDROID_STT_SESSION_TO_READY_MS,
                    elapsedInt(androidSttSessionStartedMs, androidSttReadyMs));
        }
        if (androidSttSpeechBeginMs > 0L) {
            editor.putInt(KEY_ANDROID_STT_SESSION_TO_SPEECH_BEGIN_MS,
                    elapsedInt(androidSttSessionStartedMs, androidSttSpeechBeginMs));
        }
        if (androidSttFirstPartialMs > 0L) {
            editor.putInt(KEY_ANDROID_STT_SESSION_TO_FIRST_PARTIAL_MS,
                    elapsedInt(androidSttSessionStartedMs, androidSttFirstPartialMs));
        }
        if (androidSttFinalOrErrorMs > 0L) {
            editor.putInt(KEY_ANDROID_STT_SESSION_TO_FINAL_OR_ERROR_MS,
                    elapsedInt(androidSttSessionStartedMs, androidSttFinalOrErrorMs));
        }
        if (androidSttAcceptedMs > 0L) {
            editor.putInt(KEY_ANDROID_STT_SESSION_TO_ACCEPT_MS,
                    elapsedInt(androidSttSessionStartedMs, androidSttAcceptedMs));
            editor.putInt(KEY_ANDROID_STT_READY_TO_ACCEPT_MS,
                    elapsedInt(androidSttReadyMs, androidSttAcceptedMs));
            editor.putInt(KEY_ANDROID_STT_SPEECH_BEGIN_TO_ACCEPT_MS,
                    elapsedInt(androidSttSpeechBeginMs, androidSttAcceptedMs));
        }
        editor.apply();
    }

    private boolean hasRecordAudio() {
        return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean onDeviceRecognitionAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && SpeechRecognizer.isOnDeviceRecognitionAvailable(context);
    }

    private static void addFormattingExtras(Intent intent) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        intent.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_LATENCY);
        intent.putExtra(RecognizerIntent.EXTRA_HIDE_PARTIAL_TRAILING_PUNCTUATION, true);
    }

    private static JSONArray alternatives(Bundle results) {
        ArrayList<String> values = results == null
                ? null
                : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        JSONArray out = new JSONArray();
        if (values != null) {
            for (String value : values) {
                Json.add(out, value == null ? "" : value);
            }
        }
        return out;
    }

    private static JSONArray confidences(Bundle results) {
        float[] values = results == null ? null : results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
        JSONArray out = new JSONArray();
        if (values != null) {
            for (float value : values) {
                Json.add(out, value);
            }
        }
        return out;
    }

    private static String errorName(int error) {
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
            case SpeechRecognizer.ERROR_SERVER_DISCONNECTED:
                return "ERROR_SERVER_DISCONNECTED";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "ERROR_SPEECH_TIMEOUT";
            case SpeechRecognizer.ERROR_TOO_MANY_REQUESTS:
                return "ERROR_TOO_MANY_REQUESTS";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
                return "ERROR_LANGUAGE_NOT_SUPPORTED";
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
                return "ERROR_LANGUAGE_UNAVAILABLE";
            default:
                return "ERROR_" + error;
        }
    }

    private static final class WakeCandidateMetrics {
        final int peak;
        final int rms;
        final double maxVadProbability;
        final String finishReason;

        private WakeCandidateMetrics(int peak, int rms, double maxVadProbability, String finishReason) {
            this.peak = peak;
            this.rms = rms;
            this.maxVadProbability = maxVadProbability;
            this.finishReason = finishReason == null || finishReason.trim().isEmpty() ? "unknown" : finishReason;
        }

        static WakeCandidateMetrics fromSamples(short[] samples, String finishReason, double maxVadProbability) {
            if (samples == null || samples.length == 0) {
                return new WakeCandidateMetrics(0, 0, maxVadProbability, finishReason);
            }
            long sumSquares = 0L;
            int peak = 0;
            for (short sample : samples) {
                int abs = Math.abs(sample);
                if (abs > peak) {
                    peak = abs;
                }
                sumSquares += (long) sample * sample;
            }
            int rms = (int) Math.round(Math.sqrt(sumSquares / (double) samples.length));
            return new WakeCandidateMetrics(peak, rms, maxVadProbability, finishReason);
        }
    }

    private static final class WakeRecognitionAttempt {
        final OnDeviceInjectedAudioRecognizer.RecognitionOutcome outcome;
        final int rawDurationMs;
        final int shapedDurationMs;
        final int paddedDurationMs;
        final int recognizerMs;

        WakeRecognitionAttempt(OnDeviceInjectedAudioRecognizer.RecognitionOutcome outcome,
                               int rawDurationMs,
                               int shapedDurationMs,
                               int paddedDurationMs,
                               int recognizerMs) {
            this.outcome = outcome;
            this.rawDurationMs = rawDurationMs;
            this.shapedDurationMs = shapedDurationMs;
            this.paddedDurationMs = paddedDurationMs;
            this.recognizerMs = recognizerMs;
        }
    }

    private static final class WakeTiming {
        final long gateDetectedMs;
        long captureStartedMs = -1L;
        long captureFinishedMs = -1L;
        long confirmStartedMs = -1L;
        long confirmFinishedMs = -1L;
        long decisionMs = -1L;
        long chimeRequestedMs = -1L;
        long turnStartRequestedMs = -1L;

        private WakeTiming(long gateDetectedMs) {
            this.gateDetectedMs = gateDetectedMs;
        }

        static WakeTiming start(long gateDetectedMs) {
            return new WakeTiming(gateDetectedMs);
        }
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

    private static final class WakeProbeRecorder implements AudioFrameConsumer {
        private final SileroVadEngine vadEngine;
        private final WakeProbeCapturePolicy policy =
                new WakeProbeCapturePolicy(PROBE_TRAILING_SILENCE_MS, PROBE_MAX_DURATION_MS, TURN_SPEECH_THRESHOLD);
        private final float[] window = new float[WalkieSpeechGate.WINDOW_SAMPLES];

        private short[] samples = new short[0];
        private boolean collecting;
        private boolean readyToFinish;
        private int windowSamples;
        private double maxVadProbability;
        private String finishReason = "";

        WakeProbeRecorder(SileroVadEngine vadEngine) {
            this.vadEngine = vadEngine;
        }

        @Override
        public String name() {
            return "wake_probe_recorder";
        }

        @Override
        public synchronized void onFrame(short[] frame, long timestampNanos) {
            if (!collecting || frame == null || frame.length == 0) {
                return;
            }
            append(frame);
            evaluate(frame);
        }

        @Override
        public synchronized JSONObject snapshot() {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.wake_probe_recorder.v1");
            Json.put(out, "collecting", collecting);
            Json.put(out, "ready_to_finish", readyToFinish);
            Json.put(out, "samples", samples.length);
            return out;
        }

        synchronized void begin(short[] preRoll) {
            samples = preRoll == null ? new short[0] : Arrays.copyOf(preRoll, preRoll.length);
            collecting = true;
            readyToFinish = false;
            windowSamples = 0;
            maxVadProbability = 0.0;
            finishReason = "";
            vadEngine.reset();
            long nowMs = SystemClock.elapsedRealtime();
            policy.begin(nowMs);
            policy.observe(nowMs, TURN_SPEECH_THRESHOLD);
        }

        synchronized short[] finish() {
            collecting = false;
            readyToFinish = false;
            return Arrays.copyOf(samples, samples.length);
        }

        synchronized void cancel() {
            collecting = false;
            readyToFinish = false;
            samples = new short[0];
            windowSamples = 0;
            maxVadProbability = 0.0;
            finishReason = "";
        }

        synchronized boolean readyToFinish() {
            return readyToFinish;
        }

        synchronized WakeCandidateMetrics metrics() {
            return WakeCandidateMetrics.fromSamples(samples, finishReason, maxVadProbability);
        }

        private void append(short[] frame) {
            short[] next = Arrays.copyOf(samples, samples.length + frame.length);
            System.arraycopy(frame, 0, next, samples.length, frame.length);
            samples = next;
        }

        private void evaluate(short[] frame) {
            long nowMs = SystemClock.elapsedRealtime();
            for (short value : frame) {
                window[windowSamples++] = value / 32768.0f;
                if (windowSamples == WalkieSpeechGate.WINDOW_SAMPLES) {
                    double probability = 0.0;
                    if (vadEngine.available()) {
                        try {
                            probability = vadEngine.speechProbability(window.clone(), WalkieSpeechGate.SAMPLE_RATE);
                        } catch (RuntimeException ignored) {
                            probability = 0.0;
                        }
                    }
                    if (probability > maxVadProbability) {
                        maxVadProbability = probability;
                    }
                    WakeProbeCapturePolicy.Action action = policy.observe(nowMs, probability);
                    if (action != WakeProbeCapturePolicy.Action.NONE) {
                        finishReason = action.name().toLowerCase(Locale.US);
                        readyToFinish = true;
                    }
                    windowSamples = 0;
                }
            }
        }
    }
}
