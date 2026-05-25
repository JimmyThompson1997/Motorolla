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
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.pucky.device.assistant.PuckyAssistantController;
import com.pucky.device.pucky.SileroVadEngine;
import com.pucky.device.pucky.VadEngine;
import com.pucky.device.speech.OnDeviceInjectedAudioRecognizer;
import com.pucky.device.speech.RecipeDevicePrimitiveExecutor;
import com.pucky.device.speech.lab.AudioFrameBus;
import com.pucky.device.speech.lab.AudioFrameConsumer;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;

public final class WakeWordController {
    private static final String TAG = "PuckyWakeWord";
    private static final String PREFS = "pucky_wake_word";

    private static final String KEY_REQUESTED_ENABLED = "requested_enabled";
    private static final String KEY_SCOPE = "scope";
    private static final String KEY_LAST_CONFIG_SET_AT = "last_config_set_at";
    private static final String KEY_LAST_START_REQUESTED_AT = "last_start_requested_at";
    private static final String KEY_LAST_STOP_REQUESTED_AT = "last_stop_requested_at";
    private static final String KEY_LAST_SIMULATE_REQUESTED_AT = "last_simulate_requested_at";
    private static final String KEY_LAST_CANDIDATE_JSON = "last_candidate_json";
    private static final String KEY_LAST_CONFIRMATION_JSON = "last_confirmation_json";
    private static final String KEY_LAST_MATCHED_PHRASE = "last_matched_phrase";
    private static final String KEY_LAST_MATCH_SOURCE = "last_match_source";
    private static final String KEY_LAST_MATCH_AT = "last_match_at";
    private static final String KEY_LAST_REJECT_REASON = "last_reject_reason";

    private static final String MODE_PCM_WAKE = "pcm_wake";
    private static final String ENGINE_PCM_VAD_INJECTED_STT = "pcm_vad_injected_stt";
    private static final String DEFAULT_SCOPE = "awake_and_unlocked_foreground";
    private static final String SCOPE_ASSISTANT_RESERVED = "assistant_screen_off_reserved";
    private static final long PROOF_WINDOW_MS = 3000L;
    private static final long CONFIRM_TIMEOUT_MS = 8000L;

    private static WakeWordController instance;

    public static synchronized WakeWordController shared(Context context) {
        if (instance == null) {
            instance = new WakeWordController(context.getApplicationContext());
        }
        return instance;
    }

    private final Context context;
    private final SharedPreferences prefs;
    private final RecipeDevicePrimitiveExecutor recipeExecutor;
    private final OnDeviceInjectedAudioRecognizer injectedRecognizer;
    private final PowerManager powerManager;
    private final KeyguardManager keyguardManager;
    private final Object lock = new Object();

    private BroadcastReceiver screenReceiver;
    private boolean receiverRegistered;
    private boolean serviceStarted;
    private boolean running;
    private String state = "idle";
    private String suspendedReason = "";
    private AudioFrameBus bus;
    private WakeCandidateConsumer candidateConsumer;
    private int generation;
    private long proofUntilElapsedMs;
    private String proofMatchedPhrase = "";
    private String proofTranscript = "";
    private String activeTurnId = "";
    private String activeTurnSource = "";

    private WakeWordController(Context context) {
        this.context = context;
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.recipeExecutor = new RecipeDevicePrimitiveExecutor(context);
        this.injectedRecognizer = new OnDeviceInjectedAudioRecognizer(context);
        this.powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        this.keyguardManager = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
    }

    public JSONObject status() {
        synchronized (lock) {
            boolean requested = isRequestedEnabledLocked();
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.wake_word_status.v3");
            Json.put(out, "wake_word", "Hey Pucky");
            Json.put(out, "wake_family", WakePhraseFamily.statusJson());
            Json.put(out, "enabled", requested);
            Json.put(out, "configured", requested);
            Json.put(out, "requested_enabled", requested);
            Json.put(out, "running", running);
            Json.put(out, "state", state);
            Json.put(out, "mode", MODE_PCM_WAKE);
            Json.put(out, "engine", ENGINE_PCM_VAD_INJECTED_STT);
            Json.put(out, "requested_engine", ENGINE_PCM_VAD_INJECTED_STT);
            Json.put(out, "effective_engine", running ? ENGINE_PCM_VAD_INJECTED_STT : "stopped");
            Json.put(out, "scope", prefs.getString(KEY_SCOPE, DEFAULT_SCOPE));
            Json.put(out, "supported_scopes", supportedScopesJson());
            Json.put(out, "suspended_reason", suspendedReason);
            Json.put(out, "audio_source", "VOICE_RECOGNITION");
            Json.put(out, "sample_rate", AudioFrameBus.SAMPLE_RATE);
            Json.put(out, "channels", 1);
            Json.put(out, "encoding", "PCM_16BIT");
            Json.put(out, "candidate_policy", policyJson());
            Json.put(out, "vad", candidateConsumer == null ? JSONObject.NULL : candidateConsumer.snapshot());
            Json.put(out, "audio_frame_bus", bus == null ? JSONObject.NULL : bus.snapshot());
            Json.put(out, "last_candidate", jsonPref(KEY_LAST_CANDIDATE_JSON));
            Json.put(out, "last_confirmation", jsonPref(KEY_LAST_CONFIRMATION_JSON));
            Json.put(out, "last_reject_reason", prefs.getString(KEY_LAST_REJECT_REASON, ""));
            Json.put(out, "last_match", lastMatchJsonLocked());
            Json.put(out, "proof_indicator", proofIndicatorJsonLocked());
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
        String matched = WakePhraseFamily.matchedPhrasePrefix(alternatives);
        boolean accepted = !matched.isEmpty();
        JSONObject confirmation = confirmationJson("simulate", phrase, alternatives, new JSONArray(),
                accepted ? "accepted" : "wake_phrase_no_match", 0L);
        synchronized (lock) {
            prefs.edit()
                    .putString(KEY_LAST_CONFIRMATION_JSON, confirmation.toString())
                    .putString(KEY_LAST_REJECT_REASON, accepted ? "" : "wake_phrase_no_match")
                    .apply();
            if (accepted) {
                markProofLocked(matched, phrase, "simulate");
            }
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.wake_simulate.v3");
        Json.put(out, "accepted", accepted);
        Json.put(out, "transcript", phrase);
        Json.put(out, "matched_phrase", matched);
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
            stopAudioLocked("service_stopped", true);
        }
    }

    public void onTurnStarting(String turnId, String source) {
        synchronized (lock) {
            activeTurnId = safe(turnId);
            activeTurnSource = safe(source);
            stopAudioLocked("turn_active", true);
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
                stopAudioLocked("disabled", true);
                return;
            }
            if (!serviceStarted) {
                stopAudioLocked("service_not_started", true);
                return;
            }
            String scope = prefs.getString(KEY_SCOPE, DEFAULT_SCOPE);
            if (SCOPE_ASSISTANT_RESERVED.equals(scope)) {
                stopAudioLocked("assistant_scope_reserved", true);
                return;
            }
            if (!isDeviceInteractiveLocked()) {
                stopAudioLocked("device_not_interactive", true);
                return;
            }
            if (isDeviceLockedLocked()) {
                stopAudioLocked("device_locked", true);
                return;
            }
            if (hasActiveTurnLocked()) {
                stopAudioLocked("turn_active", true);
                return;
            }
            if (!hasRecordAudioPermission()) {
                stopAudioLocked("record_audio_permission_missing", true);
                return;
            }
            if (!running && !"confirming".equals(state)) {
                startAudioLocked(reason);
            }
        }
    }

    private void startAudioLocked(String reason) {
        generation += 1;
        int currentGeneration = generation;
        suspendedReason = "";
        state = "armed";
        running = true;
        AudioFrameBus nextBus = new AudioFrameBus(context);
        WakeCandidateConsumer consumer = new WakeCandidateConsumer(
                new SileroVadEngine(context),
                candidate -> onCandidateReady(currentGeneration, candidate));
        nextBus.addSynchronousConsumer(consumer);
        JSONObject start = nextBus.start();
        if (!"started".equals(start.optString("result")) && !"already_running".equals(start.optString("result"))) {
            running = false;
            state = "error";
            suspendedReason = start.optString("error", "audio_frame_bus_failed");
            Log.i(TAG, "pcm_wake start_failed reason=" + reason + " error=" + suspendedReason);
            return;
        }
        bus = nextBus;
        candidateConsumer = consumer;
        Log.i(TAG, "pcm_wake armed reason=" + reason + " generation=" + currentGeneration);
    }

    private void onCandidateReady(int candidateGeneration, WakeCandidate candidate) {
        synchronized (lock) {
            if (candidateGeneration != generation || !"armed".equals(state) || !running) {
                return;
            }
            state = "confirming";
            running = false;
            prefs.edit().putString(KEY_LAST_CANDIDATE_JSON, candidate.toJson().toString()).apply();
        }
        Thread worker = new Thread(() -> confirmCandidate(candidateGeneration, candidate), "pucky-wake-confirm");
        worker.setDaemon(true);
        worker.start();
    }

    private void confirmCandidate(int candidateGeneration, WakeCandidate candidate) {
        AudioFrameBus toStop;
        synchronized (lock) {
            toStop = bus;
            bus = null;
            candidateConsumer = null;
        }
        if (toStop != null) {
            toStop.stop();
        }

        long startedMs = SystemClock.elapsedRealtime();
        String status;
        String transcript = "";
        JSONArray alternatives = new JSONArray();
        JSONArray confidences = new JSONArray();
        String rejectReason = "";
        String matched = "";
        if (WakeCandidateEndpointPolicy.FINISH_TOO_SHORT.equals(candidate.finishReason)) {
            status = "rejected";
            rejectReason = WakeCandidateEndpointPolicy.FINISH_TOO_SHORT;
        } else {
            OnDeviceInjectedAudioRecognizer.RecognitionOutcome recognition = injectedRecognizer.recognize(
                    OnDeviceInjectedAudioRecognizer.padSamplesForRecognition(candidate.samples),
                    CONFIRM_TIMEOUT_MS);
            transcript = recognition.transcript;
            alternatives = alternativesWithTranscript(recognition.transcript, recognition.alternatives);
            confidences = recognition.confidences;
            if (!recognition.succeeded || transcript.trim().isEmpty()) {
                status = "error";
                rejectReason = recognition.errorCode.isEmpty() ? "stt_no_transcript" : recognition.errorCode;
            } else {
                matched = WakePhraseFamily.matchedPhrasePrefix(alternatives);
                status = matched.isEmpty() ? "rejected" : "accepted";
                rejectReason = matched.isEmpty() ? "wake_phrase_no_match" : "";
            }
        }
        long latencyMs = Math.max(0L, SystemClock.elapsedRealtime() - startedMs);
        JSONObject confirmation = confirmationJson(status, transcript, alternatives, confidences, rejectReason, latencyMs);
        boolean accepted = "accepted".equals(status);
        synchronized (lock) {
            prefs.edit()
                    .putString(KEY_LAST_CONFIRMATION_JSON, confirmation.toString())
                    .putString(KEY_LAST_REJECT_REASON, rejectReason)
                    .apply();
            if (accepted) {
                markProofLocked(matched, transcript, "pcm_wake");
            }
            if (candidateGeneration == generation) {
                state = accepted ? "matched" : "rejected";
            }
        }
        Log.i(TAG, "pcm_wake confirmation status=" + status
                + " reason=" + rejectReason
                + " matched=" + matched
                + " transcript=" + transcript
                + " duration_ms=" + candidate.durationMs);
        if (accepted) {
            recipeExecutor.playWakeListeningChime("pucky.wake_pcm_match_chime.v1");
        }
        reevaluate("candidate_confirmed");
    }

    private void stopAudioLocked(String reason, boolean invalidate) {
        if (invalidate) {
            generation += 1;
        }
        AudioFrameBus toStop = bus;
        bus = null;
        candidateConsumer = null;
        running = false;
        suspendedReason = reason;
        state = "idle";
        if (toStop != null) {
            Thread worker = new Thread(toStop::stop, "pucky-wake-audio-stop");
            worker.setDaemon(true);
            worker.start();
        }
        Log.i(TAG, "pcm_wake stopped reason=" + reason);
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

    private JSONObject confirmationJson(
            String status,
            String transcript,
            JSONArray alternatives,
            JSONArray confidences,
            String rejectReason,
            long latencyMs) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.wake_confirmation.v1");
        Json.put(out, "status", status);
        Json.put(out, "transcript", safe(transcript));
        Json.put(out, "alternatives", alternatives == null ? new JSONArray() : alternatives);
        Json.put(out, "confidences", confidences == null ? new JSONArray() : confidences);
        Json.put(out, "matched_phrase", WakePhraseFamily.matchedPhrasePrefix(alternatives));
        Json.put(out, "reject_reason", safe(rejectReason));
        Json.put(out, "latency_ms", latencyMs);
        Json.put(out, "confirmed_at", nowIso());
        return out;
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
        Json.put(out, "matched_phrase", prefs.getString(KEY_LAST_MATCHED_PHRASE, ""));
        Json.put(out, "match_source", prefs.getString(KEY_LAST_MATCH_SOURCE, ""));
        Json.put(out, "matched_at", prefs.getString(KEY_LAST_MATCH_AT, ""));
        return out;
    }

    private JSONObject policyJson() {
        JSONObject out = new JSONObject();
        Json.put(out, "speech_threshold_percent", WakeCandidateEndpointPolicy.SPEECH_THRESHOLD_PERCENT);
        Json.put(out, "trailing_silence_ms", WakeCandidateEndpointPolicy.TRAILING_SILENCE_MS);
        Json.put(out, "minimum_speech_ms", WakeCandidateEndpointPolicy.MIN_SPEECH_MS);
        Json.put(out, "max_candidate_ms", WakeCandidateEndpointPolicy.MAX_CANDIDATE_MS);
        Json.put(out, "pre_speech_ms", WakeCandidateEndpointPolicy.PRE_SPEECH_MS);
        return out;
    }

    private JSONObject jsonPref(String key) {
        String raw = prefs.getString(key, "");
        if (raw == null || raw.trim().isEmpty()) {
            return new JSONObject();
        }
        try {
            return new JSONObject(raw);
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private JSONArray alternativesWithTranscript(String transcript, JSONArray alternatives) {
        JSONArray out = new JSONArray();
        if (!safe(transcript).isEmpty()) {
            Json.add(out, transcript);
        }
        if (alternatives != null) {
            for (int i = 0; i < alternatives.length(); i++) {
                String value = alternatives.optString(i, "");
                if (!safe(value).isEmpty()) {
                    Json.add(out, value);
                }
            }
        }
        return out;
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

    private interface CandidateListener {
        void onCandidate(WakeCandidate candidate);
    }

    private static final class WakeCandidate {
        final short[] samples;
        final String finishReason;
        final long durationMs;
        final long speechDurationMs;
        final long trailingSilenceMs;
        final long startedElapsedMs;
        final long finishedElapsedMs;
        final int peakAmplitude;
        final double maxVadProbability;
        final long framesSeen;
        final long vadWindowsSeen;
        final boolean vadAvailable;
        final String vadUnavailableReason;

        WakeCandidate(
                short[] samples,
                String finishReason,
                long durationMs,
                long speechDurationMs,
                long trailingSilenceMs,
                long startedElapsedMs,
                long finishedElapsedMs,
                int peakAmplitude,
                double maxVadProbability,
                long framesSeen,
                long vadWindowsSeen,
                boolean vadAvailable,
                String vadUnavailableReason) {
            this.samples = samples;
            this.finishReason = finishReason;
            this.durationMs = durationMs;
            this.speechDurationMs = speechDurationMs;
            this.trailingSilenceMs = trailingSilenceMs;
            this.startedElapsedMs = startedElapsedMs;
            this.finishedElapsedMs = finishedElapsedMs;
            this.peakAmplitude = peakAmplitude;
            this.maxVadProbability = maxVadProbability;
            this.framesSeen = framesSeen;
            this.vadWindowsSeen = vadWindowsSeen;
            this.vadAvailable = vadAvailable;
            this.vadUnavailableReason = vadUnavailableReason;
        }

        JSONObject toJson() {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.wake_candidate.v1");
            Json.put(out, "finish_reason", finishReason);
            Json.put(out, "duration_ms", durationMs);
            Json.put(out, "speech_duration_ms", speechDurationMs);
            Json.put(out, "trailing_silence_ms", trailingSilenceMs);
            Json.put(out, "sample_rate", AudioFrameBus.SAMPLE_RATE);
            Json.put(out, "samples", samples.length);
            Json.put(out, "bytes", samples.length * 2L);
            Json.put(out, "peak_amplitude", peakAmplitude);
            Json.put(out, "max_vad_probability", maxVadProbability);
            Json.put(out, "frames_seen", framesSeen);
            Json.put(out, "vad_windows_seen", vadWindowsSeen);
            Json.put(out, "vad_available", vadAvailable);
            Json.put(out, "vad_unavailable_reason", safe(vadUnavailableReason));
            Json.put(out, "started_elapsed_ms", startedElapsedMs);
            Json.put(out, "finished_elapsed_ms", finishedElapsedMs);
            Json.put(out, "finished_at", nowIso());
            return out;
        }
    }

    private static final class WakeCandidateConsumer implements AudioFrameConsumer {
        private static final double SPEECH_THRESHOLD =
                WakeCandidateEndpointPolicy.SPEECH_THRESHOLD_PERCENT / 100.0;
        private static final int WINDOW_SAMPLES = 512;

        private final VadEngine engine;
        private final CandidateListener listener;
        private final short[] preSpeech = new short[WakeCandidateEndpointPolicy.samplesForMs(
                WakeCandidateEndpointPolicy.PRE_SPEECH_MS)];
        private final float[] vadWindow = new float[WINDOW_SAMPLES];

        private short[] candidate = new short[AudioFrameBus.SAMPLE_RATE];
        private int preSpeechCount;
        private int preSpeechWriteIndex;
        private int candidateSamples;
        private int firstSpeechSample = -1;
        private int lastSpeechSample = -1;
        private int vadWindowSamples;
        private boolean capturing;
        private boolean finished;
        private long startedElapsedMs;
        private long framesSeen;
        private long samplesSeen;
        private long vadWindowsSeen;
        private int peakAmplitude;
        private double latestVadProbability;
        private double maxVadProbability;
        private String lastError = "";

        WakeCandidateConsumer(VadEngine engine, CandidateListener listener) {
            this.engine = engine;
            this.listener = listener;
            this.engine.reset();
        }

        @Override
        public String name() {
            return "wake_candidate_pcm_vad";
        }

        @Override
        public synchronized void onFrame(short[] frame, long timestampNanos) {
            if (finished || frame == null || frame.length == 0) {
                return;
            }
            framesSeen += 1;
            samplesSeen += frame.length;
            for (short value : frame) {
                int abs = Math.abs((int) value);
                if (abs > peakAmplitude) {
                    peakAmplitude = abs;
                }
                if (!capturing) {
                    appendPreSpeech(value);
                } else {
                    appendCandidate(value);
                }
                vadWindow[vadWindowSamples++] = value / 32768.0f;
                if (vadWindowSamples == WINDOW_SAMPLES) {
                    evaluateWindow();
                    vadWindowSamples = 0;
                }
            }
            maybeFinish();
        }

        @Override
        public synchronized JSONObject snapshot() {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.wake_candidate_vad.v1");
            Json.put(out, "vad_engine", engine.name());
            Json.put(out, "vad_available", engine.available());
            Json.put(out, "unavailable_reason", engine.available() ? "" : safe(engine.unavailableReason()));
            Json.put(out, "capturing", capturing);
            Json.put(out, "finished", finished);
            Json.put(out, "frames_seen", framesSeen);
            Json.put(out, "samples_seen", samplesSeen);
            Json.put(out, "candidate_samples", candidateSamples);
            Json.put(out, "candidate_duration_ms", WakeCandidateEndpointPolicy.durationMs(candidateSamples));
            Json.put(out, "pre_speech_samples", preSpeechCount);
            Json.put(out, "peak_amplitude", peakAmplitude);
            Json.put(out, "vad_windows_seen", vadWindowsSeen);
            Json.put(out, "vad_probability", latestVadProbability);
            Json.put(out, "max_vad_probability", maxVadProbability);
            Json.put(out, "last_error", lastError.isEmpty() ? JSONObject.NULL : lastError);
            return out;
        }

        private void appendPreSpeech(short value) {
            preSpeech[preSpeechWriteIndex] = value;
            preSpeechWriteIndex = (preSpeechWriteIndex + 1) % preSpeech.length;
            preSpeechCount = Math.min(preSpeech.length, preSpeechCount + 1);
        }

        private void beginCandidate() {
            if (capturing || finished) {
                return;
            }
            capturing = true;
            startedElapsedMs = SystemClock.elapsedRealtime();
            int start = (preSpeechWriteIndex - preSpeechCount + preSpeech.length) % preSpeech.length;
            for (int i = 0; i < preSpeechCount; i++) {
                appendCandidate(preSpeech[(start + i) % preSpeech.length]);
            }
            firstSpeechSample = Math.max(0, candidateSamples - WINDOW_SAMPLES);
            lastSpeechSample = candidateSamples;
        }

        private void appendCandidate(short value) {
            if (candidateSamples >= WakeCandidateEndpointPolicy.samplesForMs(
                    WakeCandidateEndpointPolicy.MAX_CANDIDATE_MS)) {
                return;
            }
            ensureCandidateCapacity(candidateSamples + 1);
            candidate[candidateSamples++] = value;
        }

        private void evaluateWindow() {
            vadWindowsSeen += 1;
            if (!engine.available()) {
                latestVadProbability = 0.0;
                return;
            }
            try {
                latestVadProbability = clampProbability(engine.speechProbability(vadWindow.clone(), AudioFrameBus.SAMPLE_RATE));
                maxVadProbability = Math.max(maxVadProbability, latestVadProbability);
                if (latestVadProbability < SPEECH_THRESHOLD) {
                    return;
                }
                if (!capturing) {
                    beginCandidate();
                }
                lastSpeechSample = Math.max(candidateSamples, lastSpeechSample);
            } catch (RuntimeException exc) {
                lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
            }
        }

        private void maybeFinish() {
            if (!capturing || finished) {
                return;
            }
            int speechSamples = firstSpeechSample < 0 || lastSpeechSample < firstSpeechSample
                    ? 0
                    : lastSpeechSample - firstSpeechSample;
            int trailingSamples = lastSpeechSample < 0 ? candidateSamples : candidateSamples - lastSpeechSample;
            String reason = WakeCandidateEndpointPolicy.finishReason(candidateSamples, speechSamples, trailingSamples);
            if (reason.isEmpty()) {
                return;
            }
            finished = true;
            short[] out = new short[candidateSamples];
            System.arraycopy(candidate, 0, out, 0, candidateSamples);
            WakeCandidate wakeCandidate = new WakeCandidate(
                    out,
                    reason,
                    WakeCandidateEndpointPolicy.durationMs(candidateSamples),
                    WakeCandidateEndpointPolicy.durationMs(speechSamples),
                    WakeCandidateEndpointPolicy.durationMs(trailingSamples),
                    startedElapsedMs,
                    SystemClock.elapsedRealtime(),
                    peakAmplitude,
                    maxVadProbability,
                    framesSeen,
                    vadWindowsSeen,
                    engine.available(),
                    engine.available() ? "" : engine.unavailableReason());
            listener.onCandidate(wakeCandidate);
        }

        private void ensureCandidateCapacity(int needed) {
            if (candidate.length >= needed) {
                return;
            }
            int max = WakeCandidateEndpointPolicy.samplesForMs(WakeCandidateEndpointPolicy.MAX_CANDIDATE_MS);
            int next = candidate.length;
            while (next < needed && next < max) {
                next = Math.min(max, next * 2);
            }
            short[] grown = new short[next];
            System.arraycopy(candidate, 0, grown, 0, candidateSamples);
            candidate = grown;
        }

        private static double clampProbability(double value) {
            if (Double.isNaN(value) || Double.isInfinite(value)) {
                return 0.0;
            }
            return Math.max(0.0, Math.min(1.0, value));
        }
    }
}
