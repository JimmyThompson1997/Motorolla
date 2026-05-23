package com.pucky.device.speech;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.util.Log;

import com.pucky.device.audio.AudioRouteDetector;
import com.pucky.device.clipboard.PuckyClipboardController;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.speech.lab.AudioFrameBus;
import com.pucky.device.speech.lab.OpenWakeWordConsumer;
import com.pucky.device.speech.lab.PcmCaptureConsumer;
import com.pucky.device.speech.lab.PreRollBuffer;
import com.pucky.device.speech.lab.SileroVadConsumer;
import com.pucky.device.speech.lab.TelemetryConsumer;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Locale;
import java.util.Set;

public final class SpeechEchoLabController {
    private static final String TAG = "PuckySpeechEchoLab";
    private static final String PREFS = "pucky_speech_echo_lab";
    private static final String SESSIONS = "sessions_json";
    private static final String ENGINE = "engine";
    private static final String SAVE_DEBUG_AUDIO = "save_debug_audio";
    private static final String ROUTE_REQUIRED = "route_required";
    private static final String CONFIG_VERSION = "config_version";
    private static final int MAX_SESSIONS = 80;
    private static final int CURRENT_CONFIG_VERSION = 3;
    private static final int READY_HAPTIC_MS = 55;
    private static final int RELEASE_HAPTIC_MS = 40;
    private static final int HAPTIC_AMPLITUDE = 220;
    private static final int ERROR_HAPTIC_AMPLITUDE = 255;
    private static final int ACCEPTED_CHIME_VOLUME = 85;
    private static final long TTS_AFTER_ACCEPTED_CHIME_MS = 250L;
    private static final int STT_EDGE_PADDING_MS = 200;
    private static final long FIRST_AUDIO_FRAME_READY_TIMEOUT_MS = 250L;
    private static final long TTS_READY_RETRY_MS = 150L;
    private static final int TTS_READY_RETRY_LIMIT = 12;

    public static final String ENGINE_ANDROID_DIRECT_ECHO = "android_direct_echo";
    public static final String ENGINE_ANDROID_CAPTURED_AUDIO_ECHO = "android_captured_audio_echo";
    public static final String ENGINE_FRAME_BUS_METRICS = "frame_bus_metrics";
    public static final String ENGINE_FRAME_BUS_VAD = "frame_bus_vad";
    public static final String ENGINE_FRAME_BUS_WAKE = "frame_bus_wake";

    private static volatile SpeechEchoLabController shared;

    private final Context context;
    private final SharedPreferences prefs;
    private final SpeechEchoController directEcho;
    private final AudioRouteDetector routeDetector;
    private final SpeechKeywordActionExecutor keywordActionExecutor;
    private final PuckyClipboardController clipboardController;
    private final Handler main;

    private JSONObject active;
    private AudioFrameBus frameBus;
    private PcmCaptureConsumer pcmCapture;
    private SpeechRecognizer capturedRecognizer;
    private ParcelFileDescriptor capturedAudioRead;
    private TextToSpeech speaker;
    private boolean ttsReady;
    private boolean ttsInitializing;
    private String ttsVoiceName = "";
    private boolean ttsVoiceNetworkRequired;

    public static SpeechEchoLabController shared(Context context) {
        SpeechEchoLabController existing = shared;
        if (existing != null) {
            return existing;
        }
        synchronized (SpeechEchoLabController.class) {
            if (shared == null) {
                shared = new SpeechEchoLabController(context.getApplicationContext());
            }
            return shared;
        }
    }

    private SpeechEchoLabController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.directEcho = SpeechEchoController.shared(this.context);
        this.routeDetector = new AudioRouteDetector(this.context);
        this.keywordActionExecutor = new SpeechKeywordActionExecutor(this.context);
        this.clipboardController = PuckyClipboardController.shared(this.context);
        this.main = new Handler(Looper.getMainLooper());
        ensureDefaults();
    }

    public synchronized JSONObject status() {
        syncDirectEchoCompletions();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_status.v1");
        Json.put(out, "state", active == null ? "Idle" : active.optString("state", "unknown"));
        Json.put(out, "config", configJson());
        Json.put(out, "route", routeDetector.snapshot());
        Json.put(out, "active_session", active == null ? JSONObject.NULL : active);
        Json.put(out, "last_completed", lastSession());
        Json.put(out, "direct_echo_status", directEcho.status());
        Json.put(out, "captured_audio_echo_available", capturedAudioEchoAvailable());
        Json.put(out, "keyword_registry", SpeechKeywordRegistry.list(customKeywordLoadResult()));
        Json.put(out, "tts_ready", ttsReady);
        Json.put(out, "tts_initializing", ttsInitializing);
        Json.put(out, "tts_voice", ttsVoiceName.isEmpty() ? JSONObject.NULL : ttsVoiceName);
        if (frameBus != null) {
            Json.put(out, "frame_bus", frameBus.snapshot());
        }
        return out;
    }

    public synchronized JSONObject start(JSONObject args) {
        if (args == null) {
            args = new JSONObject();
        }
        if (active != null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.speech_echo_lab_start.v1");
            Json.put(out, "result", "already_active");
            Json.put(out, "session", active);
            return out;
        }

        JSONObject config = mergedConfig(args);
        JSONObject route = routeDetector.snapshot();
        String routeRequired = config.optString(ROUTE_REQUIRED, "none");
        if (!routeAllowed(routeRequired, route.optString("route", "Unknown"))) {
            JSONObject session = newSession(config, route);
            failSession(session, "route_requirement_not_met",
                    "route_required=" + routeRequired + " current_route=" + route.optString("route", "Unknown"));
            return startResult(session, "failed");
        }

        JSONObject session = newSession(config, route);
        active = session;
        String engine = session.optString("engine", ENGINE_ANDROID_DIRECT_ECHO);
        if (ENGINE_ANDROID_DIRECT_ECHO.equals(engine)) {
            return startDirectEcho(session, args == null ? new JSONObject() : args);
        }
        if (ENGINE_ANDROID_CAPTURED_AUDIO_ECHO.equals(engine)) {
            return startCapturedAudioEcho(session);
        }
        return startFrameBus(session);
    }

    public synchronized JSONObject stop(JSONObject args) {
        if (args == null) {
            args = new JSONObject();
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_stop.v1");
        if (active == null) {
            Json.put(out, "result", "no_active_session");
            Json.put(out, "state", "Idle");
            return out;
        }
        JSONObject session = active;
        Json.put(session, "release_at", Instant.now().toString());
        Json.put(session, "stop_reason", args.optString("reason", "button_release"));
        String engine = session.optString("engine", ENGINE_ANDROID_DIRECT_ECHO);
        if (ENGINE_ANDROID_DIRECT_ECHO.equals(engine)) {
            JSONObject directStop = directEcho.stop(args);
            Json.put(session, "state", "Recognizing");
            Json.put(session, "direct_echo_stop", directStop);
            appendSession(session);
            active = null;
            scheduleDirectEchoSync();
            Json.put(out, "result", "stopped_direct_echo");
            Json.put(out, "session", session);
            return out;
        }
        if (ENGINE_ANDROID_CAPTURED_AUDIO_ECHO.equals(engine)) {
            return stopCapturedAudioEcho(out, session);
        }

        JSONObject busStop = frameBus == null ? new JSONObject() : frameBus.stop();
        Json.put(session, "state", "Completed");
        Json.put(session, "completed_at", Instant.now().toString());
        Json.put(session, "frame_bus_stop", busStop);
        Json.put(session, "metrics", busStop.optJSONObject("snapshot"));
        appendSession(session);
        active = null;
        frameBus = null;
        Json.put(out, "result", "stopped_frame_bus");
        Json.put(out, "session", session);
        return out;
    }

    public synchronized JSONObject last(JSONObject args) {
        if (args == null) {
            args = new JSONObject();
        }
        syncDirectEchoCompletions();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_last.v1");
        Json.put(out, "session", lastSession());
        Json.put(out, "direct_echo_last", directEcho.last(args));
        return out;
    }

    public synchronized JSONObject list(JSONObject args) {
        if (args == null) {
            args = new JSONObject();
        }
        syncDirectEchoCompletions();
        int limit = Math.max(1, Math.min(MAX_SESSIONS, args.optInt("limit", 20)));
        JSONArray all = sessionsJson();
        JSONArray sliced = new JSONArray();
        int start = Math.max(0, all.length() - limit);
        for (int i = start; i < all.length(); i++) {
            Json.add(sliced, all.opt(i));
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_list.v1");
        Json.put(out, "sessions", sliced);
        Json.put(out, "count", sliced.length());
        Json.put(out, "total_count", all.length());
        return out;
    }

    public synchronized JSONObject configGet() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_config.v1");
        Json.put(out, "config", configJson());
        return out;
    }

    public synchronized JSONObject configSet(JSONObject args) {
        if (args == null) {
            args = new JSONObject();
        }
        JSONObject current = configJson();
        if (args.has(ENGINE)) {
            Json.put(current, ENGINE, normalizeEngine(args.optString(ENGINE, ENGINE_ANDROID_DIRECT_ECHO)));
        }
        if (args.has(SAVE_DEBUG_AUDIO)) {
            Json.put(current, SAVE_DEBUG_AUDIO, args.optBoolean(SAVE_DEBUG_AUDIO, false));
        }
        if (args.has(ROUTE_REQUIRED)) {
            Json.put(current, ROUTE_REQUIRED, normalizeRouteRequired(args.optString(ROUTE_REQUIRED, "none")));
        }
        prefs.edit()
                .putInt(CONFIG_VERSION, CURRENT_CONFIG_VERSION)
                .putString(ENGINE, current.optString(ENGINE, ENGINE_ANDROID_CAPTURED_AUDIO_ECHO))
                .putBoolean(SAVE_DEBUG_AUDIO, current.optBoolean(SAVE_DEBUG_AUDIO, false))
                .putString(ROUTE_REQUIRED, current.optString(ROUTE_REQUIRED, "none"))
                .commit();
        JSONObject out = configGet();
        Json.put(out, "saved", true);
        return out;
    }

    public synchronized JSONObject keywordList() {
        return SpeechKeywordRegistry.list(customKeywordLoadResult());
    }

    public synchronized JSONObject keywordSchema() {
        return SpeechKeywordRegistry.schemaGuide();
    }

    public synchronized JSONObject keywordSet(JSONObject args) throws CommandException {
        JSONObject input = args == null ? null : args.optJSONObject("keyword");
        if (input == null) {
            input = args;
        }
        SpeechKeywordRegistry.SetResult result;
        try {
            result = SpeechKeywordRegistry.set(customKeywordEntries(), input);
        } catch (CommandException exc) {
            return SpeechKeywordRegistry.validationError("speech.echo.lab.keyword.set", exc, input);
        }
        saveCustomKeywordEntries(result.entries);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_keyword_set.v1");
        Json.put(out, "saved", true);
        Json.put(out, "replaced", result.replaced);
        Json.put(out, "keyword", result.entry);
        Json.put(out, "custom_count", result.entries.length());
        return out;
    }

    public synchronized JSONObject keywordDelete(JSONObject args) throws CommandException {
        String id = args == null ? "" : args.optString("id", "");
        SpeechKeywordRegistry.DeleteResult result = SpeechKeywordRegistry.delete(customKeywordEntries(), id);
        saveCustomKeywordEntries(result.entries);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_keyword_delete.v1");
        Json.put(out, "id", id);
        Json.put(out, "deleted", result.removed != null);
        Json.put(out, "keyword", result.removed == null ? JSONObject.NULL : result.removed);
        Json.put(out, "custom_count", result.entries.length());
        return out;
    }

    public synchronized JSONObject keywordClear() {
        JSONArray previous = customKeywordEntries();
        saveCustomKeywordEntries(new JSONArray());
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_keyword_clear.v1");
        Json.put(out, "cleared", previous.length());
        Json.put(out, "custom_count", 0);
        return out;
    }

    public synchronized JSONObject keywordTest(JSONObject args) throws CommandException {
        if (args == null || !args.has("text")) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "speech.echo.lab.keyword.test requires text");
        }
        boolean execute = args.optBoolean("execute", false);
        SpeechKeywordMatcher.Match keyword = SpeechKeywordRegistry.match(args.optString("text", ""), customKeywordEntries());
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_keyword_test.v1");
        Json.put(out, "execute", execute);
        Json.put(out, "match", SpeechKeywordRegistry.matchJson(keyword));
        if (!keyword.matched || !keyword.hasAction()) {
            Json.put(out, "action_status", keyword.matched ? "not_applicable" : "skipped_no_match");
            return out;
        }
        Json.put(out, "action_status", execute ? "pending" : "planned");
        Json.put(out, "action", keyword.action);
        if (execute) {
            try {
                JSONObject actionResult = keywordActionExecutor.execute(keyword.action);
                Json.put(out, "action_result", actionResult);
                Json.put(out, "action_status", "succeeded");
                Json.put(out, "action_success_chime", keywordActionExecutor.playSuccessChime(
                        "pucky.keyword_action_success_chime.v1"));
            } catch (CommandException exc) {
                Json.put(out, "action_status", "failed");
                Json.put(out, "action_error_code", exc.code());
                Json.put(out, "action_error_message", exc.getMessage());
                JSONObject failureChime = playKeywordFailureChimeIfNeeded(keyword);
                if (failureChime != null) {
                    Json.put(out, "action_failure_chime", failureChime);
                }
            }
            Json.put(out, "pucky_clipboard",
                    clipboardController.append(keywordTestClipboardEntry(args.optString("text", ""), keyword, out)));
        }
        return out;
    }

    private JSONObject startDirectEcho(JSONObject session, JSONObject args) {
        Json.put(session, "state", "Starting");
        JSONObject directArgs = new JSONObject();
        Json.put(directArgs, "session_id", session.optString("session_id") + "_direct");
        Json.put(session, "direct_echo_session_id", directArgs.optString("session_id"));
        Json.put(directArgs, "language", args.optString("language", Locale.getDefault().toLanguageTag()));
        Json.put(directArgs, "formatting_mode", args.optString("formatting_mode", "quality"));
        Json.put(directArgs, "language_detection", args.optBoolean("language_detection", true));
        Json.put(directArgs, "language_switch", args.optString("language_switch", "off"));
        Json.put(directArgs, "partial_results", args.optBoolean("partial_results", false));
        JSONObject directStart = directEcho.start(directArgs);
        Json.put(session, "direct_echo_start", directStart);
        JSONObject directSession = directStart.optJSONObject("session");
        if ("failed".equals(directStart.optString("state", ""))
                || (directSession != null && "failed".equals(directSession.optString("state", "")))) {
            String code = directSession == null ? "direct_echo_start_failed" : directSession.optString("error_code", "direct_echo_start_failed");
            String message = directSession == null ? "Direct Android echo failed to start" : directSession.optString("error_message", "Direct Android echo failed to start");
            failSession(session, code, message);
            return startResult(session, "failed");
        }
        Json.put(session, "state", "Recording");
        JSONObject out = startResult(session, directStart.optString("state", "pending_start"));
        Json.put(out, "engine", ENGINE_ANDROID_DIRECT_ECHO);
        return out;
    }

    private JSONObject startCapturedAudioEcho(JSONObject session) {
        Json.put(session, "state", "Starting");
        Json.put(session, "recognizer_mode", "strict_on_device_injected_audio");
        Json.put(session, "capture_boundary", "volume_down_hold_release");
        Json.put(session, "endpointing", "button_release_only");
        if (!hasRecordAudio()) {
            failSession(session, "permission_missing", "RECORD_AUDIO is not granted");
            buzzError();
            return startResult(session, "failed");
        }
        if (!capturedAudioEchoAvailable()) {
            failSession(session, "captured_audio_echo_unavailable",
                    "Android injected-audio on-device SpeechRecognizer requires API 33+ and on-device recognition");
            buzzError();
            return startResult(session, "failed");
        }

        frameBus = new AudioFrameBus(context);
        pcmCapture = new PcmCaptureConsumer();
        frameBus.addSynchronousConsumer(pcmCapture);
        ensureTtsReady();
        JSONObject busStart = frameBus.start();
        Json.put(session, "frame_bus_start", busStart);
        if (!"started".equals(busStart.optString("result", ""))) {
            failSession(session, "frame_bus_start_failed", busStart.optString("error", "AudioFrameBus failed to start"));
            frameBus = null;
            pcmCapture = null;
            buzzError();
            return startResult(session, "failed");
        }

        boolean firstFrameReady = pcmCapture.waitForFirstFrame(FIRST_AUDIO_FRAME_READY_TIMEOUT_MS);
        Json.put(session, "state", "Recording");
        Json.put(session, "ready_at", Instant.now().toString());
        Json.put(session, "ready_elapsed_ms", elapsedMs(session));
        Json.put(session, "ready_after_first_audio_frame", firstFrameReady);
        if (!firstFrameReady) {
            Json.put(session, "ready_warning", "first_audio_frame_timeout");
            Log.w(TAG, "captured audio echo ready before first frame session=" + session.optString("session_id"));
        }
        Json.put(session, "audio_capture", pcmCapture.snapshot());
        Log.i(TAG, "captured audio echo recording started session=" + session.optString("session_id"));
        buzzOneShot(READY_HAPTIC_MS, HAPTIC_AMPLITUDE);
        JSONObject out = startResult(session, "recording");
        Json.put(out, "engine", ENGINE_ANDROID_CAPTURED_AUDIO_ECHO);
        return out;
    }

    private JSONObject stopCapturedAudioEcho(JSONObject out, JSONObject session) {
        buzzOneShot(RELEASE_HAPTIC_MS, HAPTIC_AMPLITUDE);
        JSONObject busStop = frameBus == null ? new JSONObject() : frameBus.stop();
        PcmCaptureConsumer capture = pcmCapture;
        short[] samples = capture == null ? new short[0] : capture.snapshotSamples();
        JSONObject captureReport = capture == null ? new JSONObject() : capture.snapshot();
        Json.put(session, "state", "Recognizing");
        Json.put(session, "audio_closed_at", Instant.now().toString());
        Json.put(session, "audio_closed_elapsed_ms", elapsedMs(session));
        Json.put(session, "frame_bus_stop", busStop);
        Json.put(session, "metrics", busStop.optJSONObject("snapshot"));
        Json.put(session, "captured_audio", captureReport);
        frameBus = null;
        pcmCapture = null;

        if (samples.length == 0) {
            failActiveCapturedSession(session, "empty_captured_audio", "No PCM samples were captured before release");
            Json.put(out, "result", "failed_empty_captured_audio");
            Json.put(out, "session", session);
            return out;
        }

        short[] recognizerSamples = padSamplesForRecognition(samples);
        Json.put(session, "captured_audio_samples_for_stt", samples.length);
        Json.put(session, "captured_audio_bytes_for_stt", samples.length * 2L);
        Json.put(session, "captured_audio_duration_ms_for_stt", samples.length * 1_000L / AudioFrameBus.SAMPLE_RATE);
        Json.put(session, "recognizer_leading_padding_ms", STT_EDGE_PADDING_MS);
        Json.put(session, "recognizer_trailing_padding_ms", STT_EDGE_PADDING_MS);
        Json.put(session, "recognizer_samples_for_stt", recognizerSamples.length);
        Json.put(session, "recognizer_audio_duration_ms_for_stt",
                recognizerSamples.length * 1_000L / AudioFrameBus.SAMPLE_RATE);
        Log.i(TAG, "captured audio echo release session=" + session.optString("session_id")
                + " samples=" + samples.length
                + " durationMs=" + captureReport.optLong("duration_ms_captured", 0L)
                + " maxAbs=" + captureReport.optInt("max_abs_pcm16", 0));
        main.post(() -> startCapturedRecognizerOnMain(session.optString("session_id"), recognizerSamples));
        Json.put(out, "result", "stopped_captured_audio_started_recognition");
        Json.put(out, "session", session);
        return out;
    }

    private JSONObject startFrameBus(JSONObject session) {
        Json.put(session, "state", "Starting");
        frameBus = new AudioFrameBus(context);
        frameBus.addConsumer(new PreRollBuffer());
        frameBus.addConsumer(new TelemetryConsumer());
        String engine = session.optString("engine", ENGINE_FRAME_BUS_METRICS);
        if (ENGINE_FRAME_BUS_VAD.equals(engine) || ENGINE_FRAME_BUS_WAKE.equals(engine)) {
            frameBus.addConsumer(new SileroVadConsumer(context));
        }
        if (ENGINE_FRAME_BUS_WAKE.equals(engine)) {
            frameBus.addConsumer(new OpenWakeWordConsumer(context));
        }
        JSONObject busStart = frameBus.start();
        Json.put(session, "frame_bus_start", busStart);
        if (!"started".equals(busStart.optString("result", ""))) {
            failSession(session, "frame_bus_start_failed", busStart.optString("error", "AudioFrameBus failed to start"));
            frameBus = null;
            return startResult(session, "failed");
        }
        Json.put(session, "state", "Recording");
        JSONObject out = startResult(session, "recording");
        Json.put(out, "engine", engine);
        return out;
    }

    private JSONObject newSession(JSONObject config, JSONObject route) {
        JSONObject session = new JSONObject();
        Json.put(session, "schema", "pucky.speech_echo_lab_session.v1");
        Json.put(session, "session_id", "lab_" + Long.toHexString(System.currentTimeMillis()));
        Json.put(session, "state", "Idle");
        Json.put(session, "mode", "volume_down_lab");
        Json.put(session, "engine", config.optString(ENGINE, ENGINE_ANDROID_DIRECT_ECHO));
        Json.put(session, "save_debug_audio", config.optBoolean(SAVE_DEBUG_AUDIO, false));
        Json.put(session, "route_required", config.optString(ROUTE_REQUIRED, "none"));
        Json.put(session, "route", route);
        Json.put(session, "started_at", Instant.now().toString());
        Json.put(session, "started_elapsed_ms", SystemClock.elapsedRealtime());
        Json.put(session, "raw_audio_saved", false);
        Json.put(session, "broker_delivery_status", "disabled_lab_local");
        Json.put(session, "agent_runtime", "none");
        return session;
    }

    private JSONObject startResult(JSONObject session, String state) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_start.v1");
        Json.put(out, "state", state);
        Json.put(out, "session", session);
        return out;
    }

    private void failSession(JSONObject session, String code, String message) {
        Json.put(session, "state", "Failed");
        Json.put(session, "completed_at", Instant.now().toString());
        Json.put(session, "completed_elapsed_ms", elapsedMs(session));
        Json.put(session, "error_code", code);
        Json.put(session, "error_message", message);
        appendSession(session);
        if (active == session) {
            active = null;
        }
    }

    private void startCapturedRecognizerOnMain(String sessionId, short[] samples) {
        synchronized (this) {
            if (active == null || !sessionId.equals(active.optString("session_id"))) {
                return;
            }
            Json.put(active, "recognizer_start_at", Instant.now().toString());
            Json.put(active, "recognizer_start_elapsed_ms", elapsedMs(active));
            Json.put(active, "recognizer_audio_source", "EXTRA_AUDIO_SOURCE");
            Json.put(active, "recognizer_segmented_session", "EXTRA_AUDIO_SOURCE");
            Json.put(active, "recognizer_sample_rate", AudioFrameBus.SAMPLE_RATE);
            Json.put(active, "recognizer_channel_count", 1);
            Json.put(active, "recognizer_encoding", "PCM_16BIT");
            Json.put(active, "recognizer_language_detection", "disabled_for_button_bounded_echo");
        }
        try {
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
            ParcelFileDescriptor read = pipe[0];
            ParcelFileDescriptor write = pipe[1];
            synchronized (this) {
                capturedAudioRead = read;
                capturedRecognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
                capturedRecognizer.setRecognitionListener(new CapturedRecognitionListener(sessionId));
            }
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.getPackageName());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, read);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, AudioFrameBus.SAMPLE_RATE);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1);
                intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT);
                intent.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);
                intent.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY);
                intent.putExtra(RecognizerIntent.EXTRA_HIDE_PARTIAL_TRAILING_PUNCTUATION, true);
            }
            capturedRecognizer.startListening(intent);
            writeCapturedPcmAsync(sessionId, write, samples);
        } catch (RuntimeException | IOException exc) {
            failActiveCapturedSessionById(sessionId, "captured_recognizer_start_failed",
                    exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
    }

    private static short[] padSamplesForRecognition(short[] samples) {
        if (samples == null || samples.length == 0 || STT_EDGE_PADDING_MS <= 0) {
            return samples == null ? new short[0] : samples;
        }
        int paddingSamples = AudioFrameBus.SAMPLE_RATE * STT_EDGE_PADDING_MS / 1_000;
        short[] out = new short[samples.length + paddingSamples * 2];
        System.arraycopy(samples, 0, out, paddingSamples, samples.length);
        return out;
    }

    private void writeCapturedPcmAsync(String sessionId, ParcelFileDescriptor write, short[] samples) {
        new Thread(() -> {
            long bytesWritten = 0L;
            patchActiveCapturedSession(sessionId, "pipe_write_started_at", Instant.now().toString());
            try (ParcelFileDescriptor.AutoCloseOutputStream out =
                         new ParcelFileDescriptor.AutoCloseOutputStream(write)) {
                byte[] buffer = new byte[Math.min(8_192, Math.max(2, samples.length * 2))];
                int offset = 0;
                while (offset < samples.length) {
                    int sampleCount = Math.min(buffer.length / 2, samples.length - offset);
                    for (int i = 0; i < sampleCount; i++) {
                        short value = samples[offset + i];
                        buffer[i * 2] = (byte) (value & 0xff);
                        buffer[i * 2 + 1] = (byte) ((value >> 8) & 0xff);
                    }
                    int byteCount = sampleCount * 2;
                    out.write(buffer, 0, byteCount);
                    bytesWritten += byteCount;
                    offset += sampleCount;
                }
                out.flush();
                patchActiveCapturedSession(sessionId, "pipe_write_result", "closed_after_full_clip");
            } catch (IOException exc) {
                patchActiveCapturedSession(sessionId, "pipe_write_result", "failed");
                patchActiveCapturedSession(sessionId, "pipe_write_error",
                        exc.getClass().getSimpleName() + ": " + exc.getMessage());
            } finally {
                patchActiveCapturedSession(sessionId, "pipe_write_completed_at", Instant.now().toString());
                patchActiveCapturedSession(sessionId, "pipe_bytes_written", bytesWritten);
                Log.i(TAG, "captured audio pipe closed session=" + sessionId + " bytes=" + bytesWritten);
            }
        }, "pucky-captured-audio-stt-pipe").start();
    }

    private final class CapturedRecognitionListener implements RecognitionListener {
        private final String sessionId;
        private ArrayList<String> latestSegmentValues;
        private float[] latestSegmentConfidences;
        private boolean completed;

        CapturedRecognitionListener(String sessionId) {
            this.sessionId = sessionId;
        }

        @Override
        public void onReadyForSpeech(Bundle params) {
            patchActiveCapturedSession(sessionId, "recognizer_ready_at", Instant.now().toString());
            patchActiveCapturedSession(sessionId, "recognizer_ready_elapsed_ms", elapsedMsForActive(sessionId));
        }

        @Override
        public void onBeginningOfSpeech() {
            patchActiveCapturedSession(sessionId, "speech_begin_at", Instant.now().toString());
            patchActiveCapturedSession(sessionId, "speech_begin_elapsed_ms", elapsedMsForActive(sessionId));
        }

        @Override
        public void onRmsChanged(float rmsdB) {
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
            patchActiveCapturedSession(sessionId, "recognizer_buffer_received", true);
        }

        @Override
        public void onEndOfSpeech() {
            patchActiveCapturedSession(sessionId, "speech_end_at", Instant.now().toString());
            patchActiveCapturedSession(sessionId, "speech_end_elapsed_ms", elapsedMsForActive(sessionId));
        }

        @Override
        public void onError(int error) {
            if (completed) {
                return;
            }
            completed = true;
            failActiveCapturedSessionById(sessionId, errorName(error),
                    "Android on-device SpeechRecognizer injected-audio error " + error + " (" + errorName(error) + ")");
        }

        @Override
        public void onResults(Bundle results) {
            if (completed) {
                return;
            }
            completed = true;
            completeActiveCapturedSession(sessionId,
                    results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION),
                    results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES),
                    "results");
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
            patchActiveCapturedSession(sessionId, "last_recognizer_event", eventType);
        }

        @Override
        public void onSegmentResults(Bundle segmentResults) {
            latestSegmentValues = segmentResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            latestSegmentConfidences = segmentResults.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
            appendSegmentResult(sessionId, latestSegmentValues, latestSegmentConfidences);
        }

        @Override
        public void onEndOfSegmentedSession() {
            patchActiveCapturedSession(sessionId, "segmented_session_end_at", Instant.now().toString());
            patchActiveCapturedSession(sessionId, "segmented_session_end_elapsed_ms", elapsedMsForActive(sessionId));
            if (completed) {
                return;
            }
            completed = true;
            completeActiveCapturedSession(sessionId, latestSegmentValues, latestSegmentConfidences, "segmented_session");
        }

        @Override
        public void onLanguageDetection(Bundle results) {
            recordCapturedLanguageDetection(sessionId, results);
        }
    }

    private synchronized void completeActiveCapturedSession(
            String sessionId, ArrayList<String> values, float[] confidences, String completionSource) {
        if (active == null || !sessionId.equals(active.optString("session_id"))) {
            cleanupCapturedRecognizer();
            return;
        }
        String text = first(values);
        Json.put(active, "recognition_completion_source", completionSource);
        Json.put(active, "completed_at", Instant.now().toString());
        Json.put(active, "completed_elapsed_ms", elapsedMs(active));
        Json.put(active, "alternatives", array(values));
        Json.put(active, "confidence_scores", array(confidences));
        Json.put(active, "final_transcript", text);
        Json.put(active, "formatted_text", text);
        Json.put(active, "raw_text", second(values));
        if (text.trim().isEmpty()) {
            failActiveCapturedSession(active, "empty_transcript", "Injected-audio SpeechRecognizer returned no transcript");
            return;
        }
        SpeechKeywordMatcher.Match keyword = SpeechKeywordRegistry.match(text, customKeywordEntries());
        String ttsText = keyword.matched ? keyword.replyText : text;
        String actionStatus = keyword.matched && keyword.hasAction() ? "planned" : "not_applicable";
        JSONObject actionResult = null;
        String actionErrorCode = "";
        String actionErrorMessage = "";
        boolean actionFailed = false;
        JSONObject keywordSuccessChime = null;
        JSONObject actionFailureChime = null;
        if (keyword.matched && keyword.hasAction()) {
            try {
                actionResult = keywordActionExecutor.execute(keyword.action);
                actionStatus = "succeeded";
            } catch (CommandException exc) {
                actionFailed = true;
                actionStatus = "failed";
                actionErrorCode = exc.code();
                actionErrorMessage = exc.getMessage();
                ttsText = CommandErrorCodes.NO_DISPLAY_ON.equals(actionErrorCode)
                        ? "Failed. Phone screen is off."
                        : failureReply(keyword);
                actionFailureChime = playKeywordFailureChimeIfNeeded(keyword);
            }
        }
        String replyOverride = actionResultReplyOverride(actionResult);
        if (replyOverride != null) {
            ttsText = replyOverride;
        }
        boolean skipSuccessTts = keyword.matched && !actionFailed && shouldSkipSuccessTts(keyword, actionResult);
        if (skipSuccessTts) {
            ttsText = "";
        }
        if (keyword.matched && !actionFailed) {
            keywordSuccessChime = keywordActionExecutor.playSuccessChime("pucky.keyword_success_chime.v1");
        }
        Json.put(active, "keyword_lab_enabled", true);
        Json.put(active, "keyword_raw_transcript", keyword.rawTranscript);
        Json.put(active, "keyword_normalized_transcript", keyword.normalizedTranscript);
        Json.put(active, "keyword_match_strategy", "exact_utterance");
        Json.put(active, "keyword_match", keyword.matched);
        Json.put(active, "keyword_match_id", keyword.matched ? keyword.id : JSONObject.NULL);
        Json.put(active, "keyword_match_phrase", keyword.matched ? keyword.phrase : JSONObject.NULL);
        Json.put(active, "keyword_match_source", keyword.source);
        Json.put(active, "keyword_match_confidence", keyword.confidence);
        Json.put(active, "keyword_match_start_index", keyword.startIndex);
        Json.put(active, "keyword_reply_text", keyword.matched ? keyword.replyText : JSONObject.NULL);
        Json.put(active, "keyword_reply_tts_replaces_echo", keyword.matched && !skipSuccessTts);
        Json.put(active, "keyword_reply_tts_skipped_reason",
                skipSuccessTts ? "keyword_action_confirms_with_local_chime" : JSONObject.NULL);
        Json.put(active, "keyword_builtin", keyword.matched ? keyword.builtin : JSONObject.NULL);
        Json.put(active, "keyword_action", keyword.hasAction() ? keyword.action : JSONObject.NULL);
        Json.put(active, "keyword_action_command",
                keyword.hasAction() ? keyword.action.optString("command", "") : JSONObject.NULL);
        Json.put(active, "keyword_action_status", actionStatus);
        Json.put(active, "keyword_action_result", actionResult == null ? JSONObject.NULL : actionResult);
        Json.put(active, "keyword_success_chime",
                keywordSuccessChime == null ? JSONObject.NULL : keywordSuccessChime);
        Json.put(active, "keyword_action_failure_chime",
                actionFailureChime == null ? JSONObject.NULL : actionFailureChime);
        Json.put(active, "keyword_action_error_code", actionErrorCode.isEmpty() ? JSONObject.NULL : actionErrorCode);
        Json.put(active, "keyword_action_error_message", actionErrorMessage.isEmpty() ? JSONObject.NULL : actionErrorMessage);
        if (keyword.matched && keyword.hasAction()) {
            JSONObject clipboard = clipboardController.append(PuckyClipboardController.entryFromLabSession(active));
            Json.put(active, "pucky_clipboard_entry", clipboard.optJSONObject("entry"));
            Json.put(active, "pucky_clipboard_saved", clipboard.optBoolean("saved", false));
        } else {
            Json.put(active, "pucky_clipboard_saved", false);
        }
        Json.put(active, "state", "Speaking");
        Json.put(active, "accepted_at", Instant.now().toString());
        Json.put(active, "accepted_elapsed_ms", elapsedMs(active));
        Json.put(active, "tts_text", ttsText);
        Json.put(active, "tts_status", skipSuccessTts ? "skipped_keyword_action_chime" : "scheduled");
        JSONObject finished = active;
        appendSession(finished);
        active = null;
        cleanupCapturedRecognizer();
        if (actionFailed) {
            buzzError();
        } else if (!keyword.matched && !skipSuccessTts) {
            playAcceptedChime(sessionId);
        }
        if (!skipSuccessTts) {
            String finalTtsText = ttsText;
            main.postDelayed(() -> speakEcho(sessionId, finalTtsText), TTS_AFTER_ACCEPTED_CHIME_MS);
        } else {
            markTts(sessionId, "skipped_keyword_action_chime", "", null);
        }
        Log.i(TAG, "captured audio echo recognized session=" + sessionId
                + " text_len=" + text.length()
                + " keyword=" + (keyword.matched ? keyword.id : "none"));
    }

    private static boolean shouldSkipSuccessTts(SpeechKeywordMatcher.Match keyword, JSONObject actionResult) {
        return keyword != null
                && keyword.hasAction()
                && actionResultReplyOverride(actionResult) == null
                && isChimeOnlySuccessAction(keyword.action.optString("command", ""));
    }

    private JSONObject playKeywordFailureChimeIfNeeded(SpeechKeywordMatcher.Match keyword) {
        if (keyword == null || !keyword.hasAction()) {
            return null;
        }
        return keywordActionExecutor.playFailureChime("pucky.keyword_action_failure_chime.v1");
    }

    private static boolean isChimeOnlySuccessAction(String command) {
        return SpeechKeywordActionExecutor.COMMAND_PHOTO_CAPTURE.equals(command)
                || SpeechKeywordActionExecutor.COMMAND_LOCATION_PIN.equals(command)
                || SpeechKeywordActionExecutor.COMMAND_SCREENSHOT_CAPTURE.equals(command)
                || SpeechKeywordActionExecutor.COMMAND_VIDEO_CAPTURE_START.equals(command);
    }

    private static String actionResultReplyOverride(JSONObject actionResult) {
        if (actionResult == null) {
            return null;
        }
        JSONObject result = actionResult.optJSONObject("result");
        if (result == null || !result.has("reply_text_override")) {
            return null;
        }
        return result.optString("reply_text_override", "");
    }

    private synchronized void failActiveCapturedSessionById(String sessionId, String code, String message) {
        if (active == null || !sessionId.equals(active.optString("session_id"))) {
            cleanupCapturedRecognizer();
            return;
        }
        failActiveCapturedSession(active, code, message);
    }

    private synchronized void failActiveCapturedSession(JSONObject session, String code, String message) {
        Json.put(session, "state", "Failed");
        Json.put(session, "completed_at", Instant.now().toString());
        Json.put(session, "completed_elapsed_ms", elapsedMs(session));
        Json.put(session, "error_code", code);
        Json.put(session, "error_message", message);
        Json.put(session, "tts_status", "skipped_failed_recognition");
        appendSession(session);
        if (active == session) {
            active = null;
        }
        cleanupCapturedRecognizer();
        buzzError();
        Log.w(TAG, "captured audio echo failed code=" + code + " message=" + message);
    }

    private synchronized void patchActiveCapturedSession(String sessionId, String key, Object value) {
        if (active != null && sessionId.equals(active.optString("session_id"))) {
            Json.put(active, key, value);
            return;
        }
        updateStoredSession(sessionId, item -> Json.put(item, key, value));
    }

    private synchronized void appendSegmentResult(String sessionId, ArrayList<String> values, float[] confidences) {
        if (active == null || !sessionId.equals(active.optString("session_id"))) {
            return;
        }
        JSONArray segments = active.optJSONArray("segment_results");
        if (segments == null) {
            segments = new JSONArray();
            Json.put(active, "segment_results", segments);
        }
        JSONObject segment = new JSONObject();
        Json.put(segment, "at", Instant.now().toString());
        Json.put(segment, "elapsed_ms", elapsedMs(active));
        Json.put(segment, "alternatives", array(values));
        Json.put(segment, "confidence_scores", array(confidences));
        Json.put(segment, "text", first(values));
        Json.add(segments, segment);
    }

    private synchronized void recordCapturedLanguageDetection(String sessionId, Bundle results) {
        if (active == null || !sessionId.equals(active.optString("session_id"))) {
            return;
        }
        JSONObject item = new JSONObject();
        String detected = results.getString(SpeechRecognizer.DETECTED_LANGUAGE);
        int confidence = results.getInt(SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL,
                SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_UNKNOWN);
        Json.put(item, "at", Instant.now().toString());
        Json.put(item, "elapsed_ms", elapsedMs(active));
        Json.put(item, "detected_language", detected == null ? JSONObject.NULL : detected);
        Json.put(item, "confidence_level", confidence);
        JSONArray events = active.optJSONArray("language_detection_events");
        if (events == null) {
            events = new JSONArray();
            Json.put(active, "language_detection_events", events);
        }
        Json.add(events, item);
        Json.put(active, "detected_language", detected == null ? JSONObject.NULL : detected);
        Json.put(active, "language_detection_confidence_level", confidence);
    }

    private synchronized long elapsedMsForActive(String sessionId) {
        if (active != null && sessionId.equals(active.optString("session_id"))) {
            return elapsedMs(active);
        }
        return 0L;
    }

    private synchronized void cleanupCapturedRecognizer() {
        main.post(() -> {
            if (capturedRecognizer != null) {
                try {
                    capturedRecognizer.destroy();
                } catch (RuntimeException ignored) {
                }
                capturedRecognizer = null;
            }
            if (capturedAudioRead != null) {
                try {
                    capturedAudioRead.close();
                } catch (IOException ignored) {
                }
                capturedAudioRead = null;
            }
        });
    }

    private JSONObject mergedConfig(JSONObject args) {
        JSONObject config = configJson();
        if (args != null && args.has(ENGINE)) {
            Json.put(config, ENGINE, normalizeEngine(args.optString(ENGINE, config.optString(ENGINE))));
        }
        if (args != null && args.has(SAVE_DEBUG_AUDIO)) {
            Json.put(config, SAVE_DEBUG_AUDIO, args.optBoolean(SAVE_DEBUG_AUDIO, false));
        }
        if (args != null && args.has(ROUTE_REQUIRED)) {
            Json.put(config, ROUTE_REQUIRED, normalizeRouteRequired(args.optString(ROUTE_REQUIRED, "none")));
        }
        return config;
    }

    private JSONObject configJson() {
        ensureDefaults();
        JSONObject out = new JSONObject();
        Json.put(out, CONFIG_VERSION, prefs.getInt(CONFIG_VERSION, CURRENT_CONFIG_VERSION));
        Json.put(out, ENGINE, normalizeEngine(prefs.getString(ENGINE, ENGINE_ANDROID_CAPTURED_AUDIO_ECHO)));
        Json.put(out, SAVE_DEBUG_AUDIO, prefs.getBoolean(SAVE_DEBUG_AUDIO, false));
        Json.put(out, ROUTE_REQUIRED, normalizeRouteRequired(prefs.getString(ROUTE_REQUIRED, "none")));
        Json.put(out, "captured_audio_echo_available", capturedAudioEchoAvailable());
        Json.put(out, "vad_enabled", ENGINE_FRAME_BUS_VAD.equals(out.optString(ENGINE))
                || ENGINE_FRAME_BUS_WAKE.equals(out.optString(ENGINE)));
        Json.put(out, "wake_enabled", ENGINE_FRAME_BUS_WAKE.equals(out.optString(ENGINE)));
        Json.put(out, "raw_audio_default", "not_stored");
        return out;
    }

    private JSONArray customKeywordEntries() {
        return customKeywordLoadResult().entries;
    }

    private SpeechKeywordRegistry.LoadResult customKeywordLoadResult() {
        return SpeechKeywordRegistry.loadCustomDetailed(
                prefs.getString(SpeechKeywordRegistry.PREF_CUSTOM_KEYWORDS, "[]"));
    }

    private void saveCustomKeywordEntries(JSONArray entries) {
        prefs.edit()
                .putString(SpeechKeywordRegistry.PREF_CUSTOM_KEYWORDS,
                        entries == null ? "[]" : entries.toString())
                .commit();
    }

    private static JSONObject keywordTestClipboardEntry(
            String text,
            SpeechKeywordMatcher.Match keyword,
            JSONObject testResult) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.clipboard_entry.v1");
        Json.put(out, "source", "keyword_test");
        Json.put(out, "raw_transcript", text);
        Json.put(out, "normalized_transcript", keyword.normalizedTranscript);
        Json.put(out, "keyword_id", keyword.id);
        Json.put(out, "keyword_phrase", keyword.phrase);
        Json.put(out, "keyword_source", keyword.source);
        Json.put(out, "match_strategy", "exact_utterance");
        Json.put(out, "action_command", keyword.action == null ? JSONObject.NULL : keyword.action.optString("command", ""));
        Json.put(out, "action_status", testResult.optString("action_status", "unknown"));
        Json.put(out, "action_result", testResult.opt("action_result"));
        Json.put(out, "action_error_code", testResult.opt("action_error_code"));
        Json.put(out, "action_error_message", testResult.opt("action_error_message"));
        return out;
    }

    private static String failureReply(SpeechKeywordMatcher.Match keyword) {
        if (keyword != null && keyword.errorReplyText != null && !keyword.errorReplyText.trim().isEmpty()) {
            return keyword.errorReplyText.trim();
        }
        String label = keyword == null ? "" : keyword.id.replace('_', ' ').replace('-', ' ').trim();
        if (label.isEmpty()) {
            label = "Keyword";
        } else {
            label = label.substring(0, 1).toUpperCase(Locale.US) + label.substring(1);
        }
        return label + " failed.";
    }

    private void ensureDefaults() {
        int storedVersion = prefs.getInt(CONFIG_VERSION, 1);
        boolean needsDefaults = !prefs.contains(ENGINE) || storedVersion < CURRENT_CONFIG_VERSION;
        if (!needsDefaults) {
            return;
        }
        SharedPreferences.Editor editor = prefs.edit()
                .putInt(CONFIG_VERSION, CURRENT_CONFIG_VERSION)
                .putString(ENGINE, ENGINE_ANDROID_CAPTURED_AUDIO_ECHO)
                .putBoolean(SAVE_DEBUG_AUDIO, false)
                .putString(ROUTE_REQUIRED, "none");
        if (storedVersion < 3) {
            maybeAppendTakeScreenshotPhrase(editor);
        }
        editor.commit();
    }

    private void maybeAppendTakeScreenshotPhrase(SharedPreferences.Editor editor) {
        SpeechKeywordRegistry.LoadResult loaded = customKeywordLoadResult();
        JSONArray entries = loaded.entries;
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.optJSONObject(i);
            if (entry == null || !"screenshot".equals(entry.optString("id", ""))) {
                continue;
            }
            JSONObject action = entry.optJSONObject("action");
            if (action == null || !SpeechKeywordActionExecutor.COMMAND_SCREENSHOT_CAPTURE.equals(action.optString("command", ""))) {
                return;
            }
            JSONArray phrases = entry.optJSONArray("phrases");
            if (phrases == null || containsPhrase(phrases, "take screenshot")) {
                return;
            }
            try {
                JSONObject migrated = new JSONObject(entry.toString());
                JSONArray migratedPhrases = new JSONArray(phrases.toString());
                Json.add(migratedPhrases, "take screenshot");
                Json.put(migrated, "phrases", migratedPhrases);
                SpeechKeywordRegistry.SetResult set = SpeechKeywordRegistry.set(entries, migrated);
                editor.putString(SpeechKeywordRegistry.PREF_CUSTOM_KEYWORDS, set.entries.toString());
            } catch (CommandException | JSONException exc) {
                Log.w(TAG, "Unable to migrate screenshot keyword phrase", exc);
            }
            return;
        }
    }

    private static boolean containsPhrase(JSONArray phrases, String phrase) {
        String needle = SpeechKeywordMatcher.normalize(phrase);
        for (int i = 0; i < phrases.length(); i++) {
            if (needle.equals(SpeechKeywordMatcher.normalize(phrases.optString(i, "")))) {
                return true;
            }
        }
        return false;
    }

    private boolean hasRecordAudio() {
        return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean capturedAudioEchoAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && SpeechRecognizer.isOnDeviceRecognitionAvailable(context);
    }

    private long elapsedMs(JSONObject session) {
        long start = session.optLong("started_elapsed_ms", 0L);
        return start <= 0L ? 0L : Math.max(0L, SystemClock.elapsedRealtime() - start);
    }

    private void playAcceptedChime(String sessionId) {
        try {
            ToneGenerator generator = new ToneGenerator(AudioManager.STREAM_MUSIC, ACCEPTED_CHIME_VOLUME);
            generator.startTone(ToneGenerator.TONE_PROP_PROMPT, 150);
            markAcceptedChime(sessionId);
            new Thread(() -> {
                try {
                    Thread.sleep(280L);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                generator.release();
            }, "pucky-lab-echo-accepted-chime").start();
        } catch (RuntimeException exc) {
            markTts(sessionId, "accepted_chime_failed", "", exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
    }

    private void speakEcho(String sessionId, String text) {
        speakEcho(sessionId, text, 0);
    }

    private void speakEcho(String sessionId, String text, int attempt) {
        try {
            ensureTtsReady();
            TextToSpeech localSpeaker;
            synchronized (this) {
                localSpeaker = ttsReady ? speaker : null;
            }
            if (localSpeaker == null) {
                if (attempt < TTS_READY_RETRY_LIMIT) {
                    markTts(sessionId, "waiting_for_tts", text,
                            "TTS engine not ready; retry " + (attempt + 1) + "/" + TTS_READY_RETRY_LIMIT);
                    main.postDelayed(() -> speakEcho(sessionId, text, attempt + 1), TTS_READY_RETRY_MS);
                    return;
                }
                markTts(sessionId, "failed_not_ready", text, "TTS engine was not ready after retries");
                buzzError();
                return;
            }
            Bundle params = new Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
            params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
            int result = localSpeaker.speak(text, TextToSpeech.QUEUE_FLUSH, params, "pucky_lab_echo_" + sessionId);
            if (result == TextToSpeech.SUCCESS) {
                markTts(sessionId, "started", text, null);
                Log.i(TAG, "captured audio echo TTS started session=" + sessionId
                        + " usage=media stream=music voice=" + ttsVoiceName);
            } else {
                markTts(sessionId, "failed_speak_" + result, text, "TextToSpeech.speak returned " + result);
                buzzError();
            }
        } catch (RuntimeException exc) {
            markTts(sessionId, "failed_exception", text, exc.getClass().getSimpleName() + ": " + exc.getMessage());
            buzzError();
        }
    }

    private void ensureTtsReady() {
        synchronized (this) {
            if (speaker != null || ttsInitializing) {
                return;
            }
            ttsInitializing = true;
        }
        main.post(() -> {
            try {
                LabTtsInitListener listener = new LabTtsInitListener();
                TextToSpeech created = new TextToSpeech(context, listener);
                listener.attach(created);
            } catch (RuntimeException exc) {
                synchronized (this) {
                    ttsInitializing = false;
                    ttsReady = false;
                    ttsVoiceName = "";
                    notifyAll();
                }
            }
        });
    }

    private void handleTtsInit(TextToSpeech created, int status) {
        if (created == null || status != TextToSpeech.SUCCESS) {
            synchronized (this) {
                ttsReady = false;
                ttsInitializing = false;
                ttsVoiceName = "";
                notifyAll();
            }
            return;
        }
        Locale locale = Locale.getDefault();
        int language = created.setLanguage(locale);
        if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
            created.setLanguage(Locale.US);
            locale = Locale.US;
        }
        Voice selected = chooseLocalVoice(created, locale);
        if (selected != null) {
            try {
                created.setVoice(selected);
            } catch (RuntimeException ignored) {
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            created.setAudioAttributes(new android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
        }
        synchronized (this) {
            speaker = created;
            ttsReady = true;
            ttsInitializing = false;
            ttsVoiceName = selected == null ? "" : selected.getName();
            ttsVoiceNetworkRequired = selected != null && selected.isNetworkConnectionRequired();
            notifyAll();
        }
    }

    private Voice chooseLocalVoice(TextToSpeech created, Locale preferredLocale) {
        Set<Voice> voices = created.getVoices();
        if (voices == null || voices.isEmpty()) {
            return null;
        }
        Voice fallback = null;
        for (Voice voice : voices) {
            if (voice == null || voice.isNetworkConnectionRequired() || voiceNeedsInstall(voice)) {
                continue;
            }
            if (fallback == null) {
                fallback = voice;
            }
            Locale locale = voice.getLocale();
            if (locale != null && preferredLocale.getLanguage().equals(locale.getLanguage())) {
                return voice;
            }
        }
        return fallback;
    }

    private boolean voiceNeedsInstall(Voice voice) {
        Set<String> features = voice.getFeatures();
        return features != null && features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED);
    }

    private synchronized void markAcceptedChime(String sessionId) {
        updateStoredSession(sessionId, item -> {
            Json.put(item, "accepted_chime_at", Instant.now().toString());
            Json.put(item, "accepted_chime_elapsed_ms", elapsedMs(item));
        });
    }

    private synchronized void markTts(String sessionId, String status, String text, String error) {
        updateStoredSession(sessionId, item -> {
            Json.put(item, "tts_status", status);
            Json.put(item, "tts_at", Instant.now().toString());
            Json.put(item, "tts_elapsed_ms", elapsedMs(item));
            Json.put(item, "tts_audio_usage", "media");
            Json.put(item, "tts_stream", "music");
            if (text != null && !text.isEmpty()) {
                Json.put(item, "tts_text", text);
            }
            if (ttsReady) {
                Json.put(item, "tts_voice", ttsVoiceName.isEmpty() ? JSONObject.NULL : ttsVoiceName);
                Json.put(item, "tts_voice_network_required", ttsVoiceNetworkRequired);
            }
            if (error != null) {
                Json.put(item, "tts_error", error);
            }
        });
    }

    private synchronized void updateStoredSession(String sessionId, SessionPatch patch) {
        JSONArray all = sessionsJson();
        for (int i = all.length() - 1; i >= 0; i--) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && sessionId.equals(item.optString("session_id"))) {
                patch.apply(item);
                prefs.edit().putString(SESSIONS, all.toString()).commit();
                return;
            }
        }
    }

    private void buzzOneShot(long millis, int amplitude) {
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(millis, Math.max(1, Math.min(255, amplitude))));
            } else {
                vibrator.vibrate(millis);
            }
        } catch (RuntimeException ignored) {
        }
    }

    private void buzzError() {
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(
                        new long[] {0L, 80L, 80L, 120L},
                        new int[] {0, ERROR_HAPTIC_AMPLITUDE, 0, ERROR_HAPTIC_AMPLITUDE},
                        -1));
            } else {
                vibrator.vibrate(new long[] {0L, 80L, 80L, 120L}, -1);
            }
        } catch (RuntimeException ignored) {
        }
    }

    private boolean routeAllowed(String required, String current) {
        if (required == null || required.trim().isEmpty() || "none".equalsIgnoreCase(required)) {
            return true;
        }
        if ("external".equalsIgnoreCase(required)) {
            return "Bluetooth".equals(current) || "WiredHeadset".equals(current);
        }
        return required.equalsIgnoreCase(current);
    }

    private static String normalizeEngine(String raw) {
        String value = raw == null ? "" : raw.trim().toLowerCase(Locale.US);
        if (ENGINE_ANDROID_DIRECT_ECHO.equals(value)
                || ENGINE_ANDROID_CAPTURED_AUDIO_ECHO.equals(value)
                || ENGINE_FRAME_BUS_METRICS.equals(value)
                || ENGINE_FRAME_BUS_VAD.equals(value)
                || ENGINE_FRAME_BUS_WAKE.equals(value)) {
            return value;
        }
        return ENGINE_ANDROID_CAPTURED_AUDIO_ECHO;
    }

    private static String normalizeRouteRequired(String raw) {
        String value = raw == null ? "" : raw.trim();
        if ("Bluetooth".equalsIgnoreCase(value)) {
            return "Bluetooth";
        }
        if ("WiredHeadset".equalsIgnoreCase(value)) {
            return "WiredHeadset";
        }
        if ("Phone".equalsIgnoreCase(value)) {
            return "Phone";
        }
        if ("external".equalsIgnoreCase(value)) {
            return "external";
        }
        return "none";
    }

    private JSONObject lastSession() {
        JSONArray all = sessionsJson();
        if (all.length() == 0) {
            return null;
        }
        return all.optJSONObject(all.length() - 1);
    }

    private void syncDirectEchoCompletions() {
        JSONObject directLast = directEcho.last(new JSONObject()).optJSONObject("session");
        if (directLast == null) {
            return;
        }
        String directId = directLast.optString("session_id", "");
        String directState = directLast.optString("state", "");
        if (directId.isEmpty() || (!"completed".equals(directState) && !"failed".equals(directState))) {
            return;
        }
        JSONArray all = sessionsJson();
        boolean changed = false;
        for (int i = 0; i < all.length(); i++) {
            JSONObject session = all.optJSONObject(i);
            if (session == null || session.optBoolean("direct_echo_final_synced", false)) {
                continue;
            }
            if (!ENGINE_ANDROID_DIRECT_ECHO.equals(session.optString("engine", ENGINE_ANDROID_DIRECT_ECHO))) {
                continue;
            }
            String expectedDirectId = session.optString("direct_echo_session_id", "");
            if (expectedDirectId.isEmpty()) {
                expectedDirectId = session.optString("session_id", "") + "_direct";
            }
            if (!directId.equals(expectedDirectId)) {
                continue;
            }
            Json.put(session, "direct_echo_final", directLast);
            Json.put(session, "direct_echo_final_synced", true);
            Json.put(session, "completed_at", directLast.optString("completed_at", Instant.now().toString()));
            if (directLast.has("completed_elapsed_ms")) {
                Json.put(session, "completed_elapsed_ms", directLast.optLong("completed_elapsed_ms"));
            }
            if ("completed".equals(directState)) {
                Json.put(session, "state", "Completed");
                Json.put(session, "final_transcript", directLast.optString("text", ""));
                Json.put(session, "formatted_text", directLast.optString("formatted_text", ""));
                Json.put(session, "raw_text", directLast.optString("raw_text", ""));
                Json.put(session, "tts_status", directLast.optString("tts_status", ""));
                Json.put(session, "tts_voice", directLast.optString("tts_voice", ""));
            } else {
                Json.put(session, "state", "Failed");
                Json.put(session, "error_code", directLast.optString("error_code", "direct_echo_failed"));
                Json.put(session, "error_message", directLast.optString("error_message", "Direct Android echo failed"));
                Json.put(session, "tts_status", directLast.optString("tts_status", "skipped_failed_recognition"));
            }
            changed = true;
        }
        if (changed) {
            prefs.edit().putString(SESSIONS, all.toString()).commit();
        }
    }

    private void scheduleDirectEchoSync() {
        long[] delaysMs = new long[] {300L, 800L, 1_500L, 3_000L};
        for (long delayMs : delaysMs) {
            main.postDelayed(() -> {
                synchronized (SpeechEchoLabController.this) {
                    syncDirectEchoCompletions();
                }
            }, delayMs);
        }
    }

    private static String first(ArrayList<String> values) {
        if (values == null || values.isEmpty() || values.get(0) == null) {
            return "";
        }
        return values.get(0);
    }

    private static String second(ArrayList<String> values) {
        if (values == null || values.size() < 2 || values.get(1) == null) {
            return "";
        }
        return values.get(1);
    }

    private static JSONArray array(ArrayList<String> values) {
        JSONArray out = new JSONArray();
        if (values != null) {
            for (String value : values) {
                Json.add(out, value == null ? "" : value);
            }
        }
        return out;
    }

    private static JSONArray array(float[] values) {
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

    private interface SessionPatch {
        void apply(JSONObject session);
    }

    private final class LabTtsInitListener implements TextToSpeech.OnInitListener {
        private TextToSpeech created;

        void attach(TextToSpeech created) {
            this.created = created;
        }

        @Override
        public void onInit(int status) {
            if (created == null) {
                main.postDelayed(() -> handleTtsInit(created, status), 25L);
                return;
            }
            handleTtsInit(created, status);
        }
    }

    private JSONArray sessionsJson() {
        try {
            return new JSONArray(prefs.getString(SESSIONS, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private void appendSession(JSONObject session) {
        JSONArray all = sessionsJson();
        JSONArray next = new JSONArray();
        int start = Math.max(0, all.length() - (MAX_SESSIONS - 1));
        for (int i = start; i < all.length(); i++) {
            Json.add(next, all.opt(i));
        }
        Json.add(next, session);
        prefs.edit().putString(SESSIONS, next.toString()).commit();
    }
}
