package com.pucky.device.speech;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
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

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Locale;
import java.util.Set;

public final class SpeechEchoController {
    private static final String TAG = "PuckySpeechEcho";
    private static final String PREFS = "pucky_speech_echo";
    private static final String SESSIONS = "sessions_json";
    private static final int MAX_SESSIONS = 80;
    private static final long START_DELAY_MS = 50L;
    private static final long TTS_AFTER_ACCEPTED_CHIME_MS = 250L;
    private static final int READY_HAPTIC_MS = 55;
    private static final int RELEASE_HAPTIC_MS = 40;
    private static final int HAPTIC_AMPLITUDE = 220;
    private static final int ERROR_HAPTIC_AMPLITUDE = 255;
    private static final int ACCEPTED_CHIME_VOLUME = 85;
    private static final int DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000;
    private static final int HARD_MAX_DURATION_MS = 30 * 60 * 1000;
    private static final int AUDIO_SAMPLE_RATE_HZ = 16000;
    private static final int AUDIO_CHANNEL_COUNT = 1;
    private static final int AUDIO_CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_ENCODING = AudioFormat.ENCODING_PCM_16BIT;
    private static final int AUDIO_BITS_PER_SAMPLE = 16;
    private static final String FORMATTING_OFF = "off";
    private static final String FORMATTING_LATENCY = "latency";
    private static final String FORMATTING_QUALITY = "quality";
    private static final String LANGUAGE_SWITCH_OFF = "off";
    private static final String LANGUAGE_SWITCH_BALANCED = "balanced";
    private static final String LANGUAGE_SWITCH_QUICK_RESPONSE = "quick_response";
    private static final String LANGUAGE_SWITCH_HIGH_PRECISION = "high_precision";

    private static SpeechEchoController shared;

    private final Context context;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());

    private SpeechRecognizer recognizer;
    private TextToSpeech speaker;
    private AudioBridge audioBridge;
    private ParcelFileDescriptor recognizerAudioSource;
    private JSONObject active;
    private boolean stopRequested;
    private boolean recognizerStarted;
    private boolean readyBuzzed;
    private boolean ttsReady;
    private boolean ttsInitializing;
    private String ttsVoiceName = "";
    private boolean ttsVoiceNetworkRequired;

    public static synchronized SpeechEchoController shared(Context context) {
        if (shared == null) {
            shared = new SpeechEchoController(context.getApplicationContext());
        }
        return shared;
    }

    private SpeechEchoController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized JSONObject status() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_status.v1");
        Json.put(out, "record_audio_granted", hasRecordAudio());
        Json.put(out, "on_device_available", onDeviceRecognitionAvailable());
        Json.put(out, "injected_audio_available", injectedAudioAvailable());
        Json.put(out, "recognizer_mode", "strict_on_device");
        Json.put(out, "audio_source_mode", "injected_audio_record_wav");
        Json.put(out, "sample_rate_hz", AUDIO_SAMPLE_RATE_HZ);
        Json.put(out, "channel_count", AUDIO_CHANNEL_COUNT);
        Json.put(out, "encoding", "PCM_16BIT");
        Json.put(out, "default_formatting_mode", FORMATTING_QUALITY);
        Json.put(out, "default_language_detection", true);
        Json.put(out, "default_language_switch", LANGUAGE_SWITCH_OFF);
        Json.put(out, "tts_ready", ttsReady);
        Json.put(out, "tts_initializing", ttsInitializing);
        Json.put(out, "tts_voice", ttsVoiceName.isEmpty() ? JSONObject.NULL : ttsVoiceName);
        Json.put(out, "tts_voice_network_required", ttsReady ? ttsVoiceNetworkRequired : JSONObject.NULL);
        Json.put(out, "state", active == null ? "idle" : active.optString("state", "unknown"));
        Json.put(out, "active_session", active == null ? JSONObject.NULL : active);
        Json.put(out, "last_completed", lastSession());
        return out;
    }

    public synchronized JSONObject start(JSONObject args) {
        if (active != null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.speech_echo_start.v1");
            Json.put(out, "result", "already_active");
            Json.put(out, "state", active.optString("state", "unknown"));
            Json.put(out, "session", active);
            return out;
        }

        JSONObject session = newSession(args);
        if (!hasRecordAudio()) {
            appendFailedSession(session, "permission_missing", "RECORD_AUDIO is not granted");
            return startResult(session, "failed");
        }
        if (!onDeviceRecognitionAvailable()) {
            appendFailedSession(session, "on_device_unavailable",
                    "Android on-device SpeechRecognizer is unavailable on this device/build");
            return startResult(session, "failed");
        }
        if (!injectedAudioAvailable()) {
            appendFailedSession(session, "injected_audio_unavailable",
                    "Android RecognizerIntent injected audio is unavailable on this device/build");
            return startResult(session, "failed");
        }

        AudioBridge bridge;
        try {
            bridge = new AudioBridge(session);
        } catch (Exception exc) {
            appendFailedSession(session, "audio_pipe_failed",
                    exc.getClass().getSimpleName() + ": " + exc.getMessage());
            return startResult(session, "failed");
        }

        active = session;
        audioBridge = bridge;
        recognizerAudioSource = bridge.recognizerReadFd();
        stopRequested = false;
        recognizerStarted = false;
        readyBuzzed = false;
        ensureTtsReady();
        bridge.start();
        main.postDelayed(this::startRecognizerOnMain, START_DELAY_MS);
        scheduleAutoStop(session.optString("session_id"), session.optInt("max_duration_ms", DEFAULT_MAX_DURATION_MS));
        return startResult(session, "pending_start");
    }

    public synchronized JSONObject stop(JSONObject args) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_stop.v1");
        if (active == null) {
            Json.put(out, "state", "idle");
            Json.put(out, "result", "no_active_session");
            return out;
        }
        stopRequested = true;
        Json.put(active, "release_at", Instant.now().toString());
        Json.put(active, "release_elapsed_ms", elapsedMs(active));
        Json.put(active, "stop_reason", args.optString("reason", "button_release"));
        Json.put(active, "state", recognizerStarted ? "stopping" : "cancelled_before_recognizer_start");
        buzzOneShot(RELEASE_HAPTIC_MS, HAPTIC_AMPLITUDE);
        AudioBridge bridge = audioBridge;
        if (bridge != null) {
            bridge.requestStop();
        }
        if (!recognizerStarted) {
            failActive("stopped_before_start", "Button was released before SpeechRecognizer.startListening ran", false);
        }
        Json.put(out, "state", active == null ? "idle" : active.optString("state", "unknown"));
        Json.put(out, "session", active == null ? JSONObject.NULL : active);
        return out;
    }

    public synchronized JSONObject last(JSONObject args) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_last.v1");
        Json.put(out, "session", lastSession());
        return out;
    }

    public synchronized JSONObject list(JSONObject args) {
        int limit = Math.max(1, Math.min(MAX_SESSIONS, args.optInt("limit", 20)));
        JSONArray all = sessionsJson();
        JSONArray sliced = new JSONArray();
        int start = Math.max(0, all.length() - limit);
        for (int i = start; i < all.length(); i++) {
            Json.add(sliced, all.opt(i));
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_list.v1");
        Json.put(out, "sessions", sliced);
        Json.put(out, "count", sliced.length());
        Json.put(out, "total_count", all.length());
        return out;
    }

    public synchronized JSONObject delete(JSONObject args) throws CommandException {
        String sessionId = args.optString("session_id", "").trim();
        if (sessionId.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "speech.echo.delete requires session_id");
        }
        JSONArray all = sessionsJson();
        JSONArray kept = new JSONArray();
        boolean deleted = false;
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && sessionId.equals(item.optString("session_id"))) {
                deleted = true;
            } else {
                Json.add(kept, all.opt(i));
            }
        }
        prefs.edit().putString(SESSIONS, kept.toString()).commit();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_delete.v1");
        Json.put(out, "session_id", sessionId);
        Json.put(out, "deleted", deleted);
        return out;
    }

    public JSONObject voices(JSONObject args) {
        ensureTtsReady();
        waitForTtsReady(Math.max(0L, Math.min(2_500L, args.optLong("wait_ms", 1_200L))));
        boolean localOnly = args.optBoolean("local_only", false);
        int limit = Math.max(1, Math.min(200, args.optInt("limit", 120)));
        synchronized (this) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.speech_echo_voices.v1");
            Json.put(out, "tts_ready", ttsReady);
            Json.put(out, "tts_initializing", ttsInitializing);
            Json.put(out, "selected_voice", ttsVoiceName.isEmpty() ? JSONObject.NULL : ttsVoiceName);
            Json.put(out, "selected_voice_network_required", ttsReady ? ttsVoiceNetworkRequired : JSONObject.NULL);
            Json.put(out, "local_only", localOnly);
            Json.put(out, "voices", speaker == null ? new JSONArray() : voicesJson(speaker, localOnly, limit));
            return out;
        }
    }

    private JSONObject newSession(JSONObject args) {
        String sessionId = args.optString("session_id", "").trim();
        if (sessionId.isEmpty()) {
            sessionId = "echo_" + Long.toHexString(System.currentTimeMillis());
        }
        JSONObject session = new JSONObject();
        Json.put(session, "schema", "pucky.speech_echo_session.v1");
        Json.put(session, "session_id", sessionId);
        Json.put(session, "state", "pending_start");
        Json.put(session, "source", "android_speech_recognizer");
        Json.put(session, "recognizer_mode", "strict_on_device");
        Json.put(session, "audio_source_mode", "injected_audio_record_wav");
        Json.put(session, "raw_audio_container", "wav");
        Json.put(session, "raw_audio_encoding", "PCM_16BIT");
        Json.put(session, "sample_rate_hz", AUDIO_SAMPLE_RATE_HZ);
        Json.put(session, "channel_count", AUDIO_CHANNEL_COUNT);
        Json.put(session, "max_duration_ms", clamp(args.optInt("max_duration_ms", DEFAULT_MAX_DURATION_MS),
                1000, HARD_MAX_DURATION_MS));
        Json.put(session, "language", args.optString("language", Locale.getDefault().toLanguageTag()));
        String formattingMode = formattingMode(args);
        Json.put(session, "formatting_mode", formattingMode);
        Json.put(session, "formatting_enabled", !FORMATTING_OFF.equals(formattingMode));
        Json.put(session, "formatting_result_semantics",
                "when_supported_first_hypothesis_is_formatted_second_is_raw");
        Json.put(session, "language_detection_enabled", args.optBoolean("language_detection", true));
        Json.put(session, "language_switch", languageSwitchMode(args));
        Json.put(session, "partial_results", partialResults(args));
        Json.put(session, "started_at", Instant.now().toString());
        Json.put(session, "started_elapsed_ms", SystemClock.elapsedRealtime());
        Json.put(session, "echo_prefix", "");
        Json.put(session, "broker_delivery_status", "disabled_local_echo");
        Json.put(session, "agent_runtime", "none");
        return session;
    }

    private JSONObject startResult(JSONObject session, String state) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_start.v1");
        Json.put(out, "state", state);
        Json.put(out, "session", session);
        return out;
    }

    private void startRecognizerOnMain() {
        JSONObject session;
        synchronized (this) {
            if (active == null) {
                return;
            }
            if (stopRequested) {
                failActive("stopped_before_start", "Stop was requested before recognizer start delay elapsed", false);
                return;
            }
            session = active;
            Json.put(session, "recognizer_start_at", Instant.now().toString());
            Json.put(session, "recognizer_start_elapsed_ms", elapsedMs(session));
            Json.put(session, "state", "listening");
            recognizerStarted = true;
        }
        try {
            ParcelFileDescriptor audioSource;
            synchronized (this) {
                audioSource = recognizerAudioSource;
            }
            if (audioSource == null) {
                failActive("audio_source_missing", "No injected audio pipe is available for SpeechRecognizer", false);
                return;
            }
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
            recognizer.setRecognitionListener(new Listener(session.optString("session_id")));
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, session.optString("language", Locale.getDefault().toLanguageTag()));
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, session.optBoolean("partial_results", false));
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.getPackageName());
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, audioSource);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, AUDIO_CHANNEL_COUNT);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AUDIO_ENCODING);
            intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, AUDIO_SAMPLE_RATE_HZ);
            intent.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE);
            addFormattingExtras(intent, session);
            addLanguageExtras(intent, session);
            recognizer.startListening(intent);
        } catch (RuntimeException exc) {
            failActive("start_failed", exc.getClass().getSimpleName() + ": " + exc.getMessage(), false);
        }
    }

    private final class Listener implements RecognitionListener {
        private final String sessionId;

        Listener(String sessionId) {
            this.sessionId = sessionId;
        }

        @Override
        public void onReadyForSpeech(Bundle params) {
            markRecognizerReady(sessionId);
        }

        @Override
        public void onBeginningOfSpeech() {
            patch(sessionId, "speech_begin_at", Instant.now().toString());
            patch(sessionId, "speech_begin_elapsed_ms", elapsedMsForSession(sessionId));
        }

        @Override
        public void onRmsChanged(float rmsdB) {
        }

        @Override
        public void onBufferReceived(byte[] buffer) {
        }

        @Override
        public void onEndOfSpeech() {
            patch(sessionId, "speech_end_at", Instant.now().toString());
            patch(sessionId, "speech_end_elapsed_ms", elapsedMsForSession(sessionId));
        }

        @Override
        public void onError(int error) {
            failActive(errorName(error), "Android on-device SpeechRecognizer error " + error + " (" + errorName(error) + ")", true);
        }

        @Override
        public void onResults(Bundle results) {
            ArrayList<String> values = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            float[] confidences = results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
            completeActive(values, confidences);
        }

        @Override
        public void onPartialResults(Bundle partialResults) {
            ArrayList<String> values = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            synchronized (SpeechEchoController.this) {
                if (active != null && sessionId.equals(active.optString("session_id"))) {
                    Json.put(active, "partial_transcript", first(values));
                    Json.put(active, "partial_at", Instant.now().toString());
                    Json.put(active, "partial_elapsed_ms", elapsedMs(active));
                }
            }
        }

        @Override
        public void onLanguageDetection(Bundle results) {
            recordLanguageDetection(sessionId, results);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {
        }
    }

    private synchronized void completeActive(ArrayList<String> values, float[] confidences) {
        if (active == null) {
            cleanupRecognizer();
            return;
        }
        attachAudioSnapshot(active);
        String text = first(values);
        Json.put(active, "completed_at", Instant.now().toString());
        Json.put(active, "completed_elapsed_ms", elapsedMs(active));
        Json.put(active, "alternatives", array(values));
        Json.put(active, "confidence_scores", array(confidences));
        Json.put(active, "text", text);
        if (active.optBoolean("formatting_enabled", false)) {
            Json.put(active, "formatted_text", text);
            Json.put(active, "raw_text", second(values));
        }
        if (text.trim().isEmpty()) {
            failActive("empty_transcript", "SpeechRecognizer returned no transcript text", true);
            return;
        }
        Json.put(active, "state", "completed");
        Json.put(active, "accepted_at", Instant.now().toString());
        Json.put(active, "accepted_elapsed_ms", elapsedMs(active));
        String sessionId = active.optString("session_id");
        String echoText = text;
        Json.put(active, "tts_text", echoText);
        Json.put(active, "tts_status", "scheduled");
        JSONObject finished = active;
        appendSession(finished);
        active = null;
        cleanupRecognizer();
        playAcceptedChime(sessionId);
        main.postDelayed(() -> speakEcho(sessionId, echoText), TTS_AFTER_ACCEPTED_CHIME_MS);
    }

    private synchronized void failActive(String code, String message, boolean recognizerCallback) {
        if (active == null) {
            cleanupRecognizer();
            return;
        }
        AudioBridge bridge = audioBridge;
        if (bridge != null) {
            bridge.requestStop();
        }
        attachAudioSnapshot(active);
        Json.put(active, "completed_at", Instant.now().toString());
        Json.put(active, "completed_elapsed_ms", elapsedMs(active));
        Json.put(active, "state", "failed");
        Json.put(active, "error_code", code);
        Json.put(active, "error_message", message);
        Json.put(active, "recognizer_callback", recognizerCallback);
        Json.put(active, "tts_status", "skipped_failed_recognition");
        appendSession(active);
        active = null;
        cleanupRecognizer();
        buzzError();
    }

    private void appendFailedSession(JSONObject session, String code, String message) {
        Json.put(session, "completed_at", Instant.now().toString());
        Json.put(session, "completed_elapsed_ms", elapsedMs(session));
        Json.put(session, "state", "failed");
        Json.put(session, "error_code", code);
        Json.put(session, "error_message", message);
        Json.put(session, "tts_status", "skipped_failed_recognition");
        appendSession(session);
        buzzError();
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
                EchoTtsInitListener listener = new EchoTtsInitListener();
                TextToSpeech created = new TextToSpeech(context, listener);
                listener.attach(created);
            } catch (RuntimeException exc) {
                synchronized (this) {
                    ttsInitializing = false;
                    ttsReady = false;
                    ttsVoiceName = "";
                }
                Log.w(TAG, "TTS init failed", exc);
            }
        });
    }

    private void handleTtsInit(TextToSpeech created, int status) {
        if (created == null || status != TextToSpeech.SUCCESS) {
            synchronized (this) {
                ttsInitializing = false;
                ttsReady = false;
                ttsVoiceName = "";
            }
            if (created != null) {
                created.shutdown();
            }
            return;
        }
        Locale locale = Locale.US;
        int language = created.setLanguage(locale);
        if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) {
            locale = Locale.getDefault();
            created.setLanguage(locale);
        }
        Voice localVoice = chooseLocalVoice(created, locale);
        if (localVoice != null) {
            created.setVoice(localVoice);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            created.setAudioAttributes(new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .build());
        }
        Voice selected = created.getVoice();
        synchronized (this) {
            speaker = created;
            ttsReady = true;
            ttsInitializing = false;
            ttsVoiceName = selected == null ? "" : selected.getName();
            ttsVoiceNetworkRequired = selected != null && selected.isNetworkConnectionRequired();
            notifyAll();
        }
    }

    private void waitForTtsReady(long waitMs) {
        long deadline = SystemClock.elapsedRealtime() + waitMs;
        synchronized (this) {
            while (!ttsReady && ttsInitializing && waitMs > 0L) {
                long remaining = deadline - SystemClock.elapsedRealtime();
                if (remaining <= 0L) {
                    return;
                }
                try {
                    wait(remaining);
                } catch (InterruptedException exc) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
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

    private JSONArray voicesJson(TextToSpeech tts, boolean localOnly, int limit) {
        ArrayList<Voice> voices = new ArrayList<>();
        Set<Voice> raw = tts.getVoices();
        if (raw != null) {
            for (Voice voice : raw) {
                if (voice == null) {
                    continue;
                }
                boolean local = !voice.isNetworkConnectionRequired() && !voiceNeedsInstall(voice);
                if (!localOnly || local) {
                    voices.add(voice);
                }
            }
        }
        Collections.sort(voices, Comparator.comparing(Voice::getName));
        JSONArray out = new JSONArray();
        int count = Math.min(limit, voices.size());
        for (int i = 0; i < count; i++) {
            Voice voice = voices.get(i);
            JSONObject item = new JSONObject();
            Locale locale = voice.getLocale();
            Json.put(item, "name", voice.getName());
            Json.put(item, "locale", locale == null ? JSONObject.NULL : locale.toLanguageTag());
            Json.put(item, "network_required", voice.isNetworkConnectionRequired());
            Json.put(item, "needs_install", voiceNeedsInstall(voice));
            Json.put(item, "quality", voice.getQuality());
            Json.put(item, "latency", voice.getLatency());
            Json.add(out, item);
        }
        return out;
    }

    private void speakEcho(String sessionId, String text) {
        try {
            ensureTtsReady();
            TextToSpeech localSpeaker;
            synchronized (this) {
                localSpeaker = ttsReady ? speaker : null;
            }
            if (localSpeaker == null) {
                markTts(sessionId, "failed_not_ready", text, "TTS engine was not ready");
                buzzError();
                return;
            }
            Bundle params = new Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
            int result = localSpeaker.speak(text, TextToSpeech.QUEUE_FLUSH, params, "pucky_echo_" + sessionId);
            if (result == TextToSpeech.SUCCESS) {
                markTts(sessionId, "started", text, null);
            } else {
                markTts(sessionId, "failed_speak_" + result, text, "TextToSpeech.speak returned " + result);
                buzzError();
            }
        } catch (RuntimeException exc) {
            markTts(sessionId, "failed_exception", text, exc.getClass().getSimpleName() + ": " + exc.getMessage());
            buzzError();
        }
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
            }, "pucky-speech-echo-accepted-chime").start();
        } catch (RuntimeException exc) {
            markTts(sessionId, "accepted_chime_failed", "", exc.getClass().getSimpleName() + ": " + exc.getMessage());
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

    private synchronized void markRecognizerReady(String sessionId) {
        if (active == null || !sessionId.equals(active.optString("session_id"))) {
            return;
        }
        Json.put(active, "recognizer_ready", true);
        Json.put(active, "recognizer_ready_at", Instant.now().toString());
        Json.put(active, "recognizer_ready_elapsed_ms", elapsedMs(active));
        maybeBuzzReadyLocked(sessionId);
    }

    private synchronized void markAudioCaptureStarted(String sessionId, File file, int bufferSizeBytes) {
        if (active == null || !sessionId.equals(active.optString("session_id"))) {
            return;
        }
        Json.put(active, "audio_capture_ready", true);
        Json.put(active, "audio_capture_started_at", Instant.now().toString());
        Json.put(active, "audio_capture_started_elapsed_ms", elapsedMs(active));
        Json.put(active, "audio_record_buffer_size_bytes", bufferSizeBytes);
        Json.put(active, "raw_audio", rawAudioJson(file, file.length(), 0L));
        maybeBuzzReadyLocked(sessionId);
    }

    private void maybeBuzzReadyLocked(String sessionId) {
        if (readyBuzzed || stopRequested || active == null || !sessionId.equals(active.optString("session_id"))) {
            return;
        }
        if (!active.optBoolean("audio_capture_ready", false)
                || !active.optBoolean("recognizer_ready", false)) {
            return;
        }
        readyBuzzed = true;
        Json.put(active, "ready_at", Instant.now().toString());
        Json.put(active, "ready_elapsed_ms", elapsedMs(active));
        buzzOneShot(READY_HAPTIC_MS, HAPTIC_AMPLITUDE);
    }

    private void markAudioCaptureClosed(String sessionId, File file, long bytes, long durationMs, String error) {
        patchSession(sessionId, session -> {
            Json.put(session, "audio_closed_at", Instant.now().toString());
            Json.put(session, "audio_closed_elapsed_ms", elapsedMs(session));
            Json.put(session, "raw_audio_bytes", bytes);
            Json.put(session, "raw_audio_duration_ms", durationMs);
            Json.put(session, "raw_audio", rawAudioJson(file, bytes, durationMs));
            if (error != null && !error.isEmpty()) {
                Json.put(session, "audio_capture_error", error);
            }
        });
    }

    private void markAudioCaptureFailed(String sessionId, String error) {
        patchSession(sessionId, session -> {
            Json.put(session, "audio_capture_error", error);
            Json.put(session, "audio_capture_failed_at", Instant.now().toString());
            Json.put(session, "audio_capture_failed_elapsed_ms", elapsedMs(session));
        });
        failActive("audio_capture_failed", error, false);
    }

    private void attachAudioSnapshot(JSONObject session) {
        AudioBridge bridge = audioBridge;
        if (bridge == null) {
            return;
        }
        Json.put(session, "raw_audio_bytes", bridge.bytesWritten());
        Json.put(session, "raw_audio_duration_ms", bridge.durationMs());
        Json.put(session, "raw_audio", rawAudioJson(bridge.file(), bridge.bytesWritten(), bridge.durationMs()));
    }

    private JSONObject rawAudioJson(File file, long bytes, long durationMs) {
        JSONObject out = new JSONObject();
        Json.put(out, "artifact_id", "art_" + Integer.toHexString(file.getAbsolutePath().hashCode()));
        Json.put(out, "kind", "speech_echo_raw_audio");
        Json.put(out, "container", "wav");
        Json.put(out, "mime_type", "audio/wav");
        Json.put(out, "encoding", "PCM_16BIT");
        Json.put(out, "sample_rate_hz", AUDIO_SAMPLE_RATE_HZ);
        Json.put(out, "channel_count", AUDIO_CHANNEL_COUNT);
        Json.put(out, "bits_per_sample", AUDIO_BITS_PER_SAMPLE);
        Json.put(out, "path", file.getAbsolutePath());
        Json.put(out, "device_path", file.getAbsolutePath());
        Json.put(out, "filename", file.getName());
        Json.put(out, "bytes", file.exists() ? file.length() : bytes);
        Json.put(out, "pcm_bytes", bytes);
        Json.put(out, "duration_ms", durationMs);
        Json.put(out, "exists", file.exists());
        Json.put(out, "last_modified_ms", file.exists() ? file.lastModified() : 0L);
        return out;
    }

    private interface SessionPatch {
        void apply(JSONObject session);
    }

    private synchronized void patchSession(String sessionId, SessionPatch patch) {
        if (active != null && sessionId.equals(active.optString("session_id"))) {
            patch.apply(active);
            return;
        }
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

    private synchronized void markAcceptedChime(String sessionId) {
        JSONArray all = sessionsJson();
        for (int i = all.length() - 1; i >= 0; i--) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && sessionId.equals(item.optString("session_id"))) {
                Json.put(item, "accepted_chime_at", Instant.now().toString());
                Json.put(item, "accepted_chime_elapsed_ms", elapsedMs(item));
                prefs.edit().putString(SESSIONS, all.toString()).commit();
                return;
            }
        }
    }

    private synchronized void markTts(String sessionId, String status, String text, String error) {
        JSONArray all = sessionsJson();
        for (int i = all.length() - 1; i >= 0; i--) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && sessionId.equals(item.optString("session_id"))) {
                Json.put(item, "tts_status", status);
                Json.put(item, "tts_at", Instant.now().toString());
                Json.put(item, "tts_elapsed_ms", elapsedMs(item));
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
                prefs.edit().putString(SESSIONS, all.toString()).commit();
                return;
            }
        }
    }

    private synchronized void patch(String sessionId, String key, Object value) {
        if (active != null && sessionId.equals(active.optString("session_id"))) {
            Json.put(active, key, value);
        }
    }

    private synchronized void recordLanguageDetection(String sessionId, Bundle results) {
        if (active == null || !sessionId.equals(active.optString("session_id"))) {
            return;
        }
        JSONObject item = new JSONObject();
        String detected = results.getString(SpeechRecognizer.DETECTED_LANGUAGE);
        int confidence = results.getInt(SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL,
                SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_UNKNOWN);
        int switchResult = results.getInt(SpeechRecognizer.LANGUAGE_SWITCH_RESULT,
                SpeechRecognizer.LANGUAGE_SWITCH_RESULT_NOT_ATTEMPTED);
        Json.put(item, "at", Instant.now().toString());
        Json.put(item, "elapsed_ms", elapsedMs(active));
        Json.put(item, "detected_language", detected == null ? JSONObject.NULL : detected);
        Json.put(item, "confidence_level", confidence);
        Json.put(item, "confidence_name", languageConfidenceName(confidence));
        Json.put(item, "language_switch_result", switchResult);
        Json.put(item, "language_switch_result_name", languageSwitchResultName(switchResult));

        JSONArray events = active.optJSONArray("language_detection_events");
        if (events == null) {
            events = new JSONArray();
            Json.put(active, "language_detection_events", events);
        }
        Json.add(events, item);
        Json.put(active, "detected_language", detected == null ? JSONObject.NULL : detected);
        Json.put(active, "language_detection_confidence_level", confidence);
        Json.put(active, "language_detection_confidence_name", languageConfidenceName(confidence));
        Json.put(active, "language_switch_result", languageSwitchResultName(switchResult));
    }

    private long elapsedMsForSession(String sessionId) {
        synchronized (this) {
            if (active != null && sessionId.equals(active.optString("session_id"))) {
                return elapsedMs(active);
            }
        }
        return 0L;
    }

    private long elapsedMs(JSONObject session) {
        long start = session.optLong("started_elapsed_ms", 0L);
        return start <= 0L ? 0L : Math.max(0L, SystemClock.elapsedRealtime() - start);
    }

    private boolean hasRecordAudio() {
        return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean onDeviceRecognitionAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && SpeechRecognizer.isOnDeviceRecognitionAvailable(context);
    }

    private boolean injectedAudioAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU;
    }

    private void addFormattingExtras(Intent intent, JSONObject session) {
        if (!session.optBoolean("formatting_enabled", false)
                || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        String mode = session.optString("formatting_mode", FORMATTING_QUALITY);
        String strategy = FORMATTING_LATENCY.equals(mode)
                ? RecognizerIntent.FORMATTING_OPTIMIZE_LATENCY
                : RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY;
        intent.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, strategy);
        intent.putExtra(RecognizerIntent.EXTRA_HIDE_PARTIAL_TRAILING_PUNCTUATION, true);
    }

    private void addLanguageExtras(Intent intent, JSONObject session) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return;
        }
        if (session.optBoolean("language_detection_enabled", true)) {
            intent.putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_DETECTION, true);
        }
        String switchMode = session.optString("language_switch", LANGUAGE_SWITCH_OFF);
        if (LANGUAGE_SWITCH_OFF.equals(switchMode)) {
            return;
        }
        if (LANGUAGE_SWITCH_QUICK_RESPONSE.equals(switchMode)) {
            intent.putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_SWITCH,
                    RecognizerIntent.LANGUAGE_SWITCH_QUICK_RESPONSE);
        } else if (LANGUAGE_SWITCH_HIGH_PRECISION.equals(switchMode)) {
            intent.putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_SWITCH,
                    RecognizerIntent.LANGUAGE_SWITCH_HIGH_PRECISION);
        } else {
            intent.putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_SWITCH,
                    RecognizerIntent.LANGUAGE_SWITCH_BALANCED);
        }
    }

    private JSONObject lastSession() {
        JSONArray all = sessionsJson();
        if (all.length() == 0) {
            return null;
        }
        return all.optJSONObject(all.length() - 1);
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

    private void cleanupRecognizer() {
        AudioBridge bridge;
        ParcelFileDescriptor audioSource;
        synchronized (this) {
            bridge = audioBridge;
            audioBridge = null;
            audioSource = recognizerAudioSource;
            recognizerAudioSource = null;
        }
        if (bridge != null) {
            bridge.requestStop();
        }
        safeClose(audioSource);
        main.post(() -> {
            if (recognizer != null) {
                try {
                    recognizer.destroy();
                } catch (RuntimeException ignored) {
                }
                recognizer = null;
            }
            recognizerStarted = false;
            stopRequested = false;
        });
    }

    private void scheduleAutoStop(String sessionId, int maxDurationMs) {
        new Thread(() -> {
            try {
                Thread.sleep(maxDurationMs + 250L);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
                return;
            }
            synchronized (SpeechEchoController.this) {
                if (active == null || !sessionId.equals(active.optString("session_id"))) {
                    return;
                }
            }
            JSONObject args = new JSONObject();
            Json.put(args, "reason", "max_duration");
            stop(args);
        }, "pucky-speech-echo-autostop").start();
    }

    private final class AudioBridge implements Runnable {
        private final String sessionId;
        private final File file;
        private final ParcelFileDescriptor readFd;
        private final ParcelFileDescriptor writeFd;
        private volatile boolean stop;
        private volatile AudioRecord audioRecord;
        private volatile long bytesWritten;
        private volatile long startedElapsedMs;
        private volatile long closedElapsedMs;

        AudioBridge(JSONObject session) throws IOException {
            this.sessionId = safeSessionId(session.optString("session_id"));
            Json.put(session, "session_id", this.sessionId);
            File dir = new File(context.getFilesDir(), "voice");
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IOException("Unable to create voice directory");
            }
            this.file = uniqueFile(dir, this.sessionId + ".wav");
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
            this.readFd = pipe[0];
            this.writeFd = pipe[1];
            Json.put(session, "raw_audio", rawAudioJson(file, 0L, 0L));
        }

        ParcelFileDescriptor recognizerReadFd() {
            return readFd;
        }

        File file() {
            return file;
        }

        long bytesWritten() {
            return bytesWritten;
        }

        long durationMs() {
            long end = closedElapsedMs > 0L ? closedElapsedMs : SystemClock.elapsedRealtime();
            return startedElapsedMs <= 0L ? 0L : Math.max(0L, end - startedElapsedMs);
        }

        void start() {
            new Thread(this, "pucky-speech-echo-audio-bridge").start();
        }

        void requestStop() {
            stop = true;
            AudioRecord local = audioRecord;
            if (local != null) {
                try {
                    local.stop();
                } catch (RuntimeException ignored) {
                }
            } else {
                safeClose(writeFd);
            }
        }

        @Override
        public void run() {
            FileOutputStream wav = null;
            OutputStream pipe = null;
            AudioRecord local = null;
            String error = "";
            try {
                wav = new FileOutputStream(file);
                writeWavHeader(wav, 0L);
                pipe = new ParcelFileDescriptor.AutoCloseOutputStream(writeFd);
                int minBufferSize = AudioRecord.getMinBufferSize(
                        AUDIO_SAMPLE_RATE_HZ, AUDIO_CHANNEL_CONFIG, AUDIO_ENCODING);
                if (minBufferSize <= 0) {
                    throw new IOException("AudioRecord.getMinBufferSize returned " + minBufferSize);
                }
                int bufferSize = Math.max(minBufferSize, AUDIO_SAMPLE_RATE_HZ * AUDIO_CHANNEL_COUNT);
                AudioFormat format = new AudioFormat.Builder()
                        .setSampleRate(AUDIO_SAMPLE_RATE_HZ)
                        .setChannelMask(AUDIO_CHANNEL_CONFIG)
                        .setEncoding(AUDIO_ENCODING)
                        .build();
                AudioRecord.Builder builder = new AudioRecord.Builder()
                        .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                        .setAudioFormat(format)
                        .setBufferSizeInBytes(bufferSize);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    builder.setContext(context);
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    builder.setPrivacySensitive(true);
                }
                local = builder.build();
                audioRecord = local;
                if (local.getState() != AudioRecord.STATE_INITIALIZED) {
                    throw new IOException("AudioRecord failed to initialize");
                }
                local.startRecording();
                if (local.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                    throw new IOException("AudioRecord did not enter recording state");
                }
                startedElapsedMs = SystemClock.elapsedRealtime();
                markAudioCaptureStarted(sessionId, file, bufferSize);
                byte[] buffer = new byte[Math.max(4096, Math.min(bufferSize, 16384))];
                while (!stop) {
                    int read = local.read(buffer, 0, buffer.length, AudioRecord.READ_BLOCKING);
                    if (read > 0) {
                        wav.write(buffer, 0, read);
                        pipe.write(buffer, 0, read);
                        bytesWritten += read;
                    } else if (read < 0 && !stop) {
                        throw new IOException("AudioRecord.read returned " + read);
                    }
                }
            } catch (Exception exc) {
                error = exc.getClass().getSimpleName() + ": " + exc.getMessage();
                if (!stop) {
                    markAudioCaptureFailed(sessionId, error);
                }
            } finally {
                stop = true;
                safeClose(pipe);
                safeClose(wav);
                if (local != null) {
                    try {
                        if (local.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                            local.stop();
                        }
                    } catch (RuntimeException ignored) {
                    }
                    try {
                        local.release();
                    } catch (RuntimeException ignored) {
                    }
                }
                audioRecord = null;
                closedElapsedMs = SystemClock.elapsedRealtime();
                patchWavHeader(file, bytesWritten);
                markAudioCaptureClosed(sessionId, file, bytesWritten(), durationMs(), error);
            }
        }
    }

    private static void writeWavHeader(OutputStream out, long pcmBytes) throws IOException {
        long totalBytes = 36L + pcmBytes;
        long byteRate = (long) AUDIO_SAMPLE_RATE_HZ * AUDIO_CHANNEL_COUNT * AUDIO_BITS_PER_SAMPLE / 8L;
        byte[] header = new byte[44];
        writeAscii(header, 0, "RIFF");
        writeLittleEndianInt(header, 4, (int) Math.min(totalBytes, 0xFFFFFFFFL));
        writeAscii(header, 8, "WAVE");
        writeAscii(header, 12, "fmt ");
        writeLittleEndianInt(header, 16, 16);
        writeLittleEndianShort(header, 20, 1);
        writeLittleEndianShort(header, 22, AUDIO_CHANNEL_COUNT);
        writeLittleEndianInt(header, 24, AUDIO_SAMPLE_RATE_HZ);
        writeLittleEndianInt(header, 28, (int) byteRate);
        writeLittleEndianShort(header, 32, AUDIO_CHANNEL_COUNT * AUDIO_BITS_PER_SAMPLE / 8);
        writeLittleEndianShort(header, 34, AUDIO_BITS_PER_SAMPLE);
        writeAscii(header, 36, "data");
        writeLittleEndianInt(header, 40, (int) Math.min(pcmBytes, 0xFFFFFFFFL));
        out.write(header);
    }

    private static void patchWavHeader(File file, long pcmBytes) {
        if (file == null || !file.exists()) {
            return;
        }
        try (RandomAccessFile raf = new RandomAccessFile(file, "rw")) {
            byte[] sizes = new byte[4];
            writeLittleEndianInt(sizes, 0, (int) Math.min(36L + pcmBytes, 0xFFFFFFFFL));
            raf.seek(4L);
            raf.write(sizes);
            writeLittleEndianInt(sizes, 0, (int) Math.min(pcmBytes, 0xFFFFFFFFL));
            raf.seek(40L);
            raf.write(sizes);
        } catch (IOException ignored) {
        }
    }

    private static void writeAscii(byte[] target, int offset, String value) {
        for (int i = 0; i < value.length(); i++) {
            target[offset + i] = (byte) value.charAt(i);
        }
    }

    private static void writeLittleEndianInt(byte[] target, int offset, int value) {
        target[offset] = (byte) (value & 0xFF);
        target[offset + 1] = (byte) ((value >> 8) & 0xFF);
        target[offset + 2] = (byte) ((value >> 16) & 0xFF);
        target[offset + 3] = (byte) ((value >> 24) & 0xFF);
    }

    private static void writeLittleEndianShort(byte[] target, int offset, int value) {
        target[offset] = (byte) (value & 0xFF);
        target[offset + 1] = (byte) ((value >> 8) & 0xFF);
    }

    private static void safeClose(OutputStream stream) {
        if (stream == null) {
            return;
        }
        try {
            stream.close();
        } catch (IOException ignored) {
        }
    }

    private static void safeClose(ParcelFileDescriptor fd) {
        if (fd == null) {
            return;
        }
        try {
            fd.close();
        } catch (IOException ignored) {
        }
    }

    private static String safeSessionId(String raw) {
        String value = raw == null || raw.trim().isEmpty()
                ? "echo_" + Long.toHexString(System.currentTimeMillis())
                : raw.trim();
        value = value.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!value.startsWith("echo_")) {
            value = "echo_" + value;
        }
        return value.length() > 80 ? value.substring(0, 80) : value;
    }

    private static File uniqueFile(File dir, String name) {
        File first = new File(dir, name);
        if (!first.exists()) {
            return first;
        }
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; i < 1000; i++) {
            File candidate = new File(dir, base + "-" + i + ext);
            if (!candidate.exists()) {
                return candidate;
            }
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
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

    private static boolean partialResults(JSONObject args) {
        if (args.has("partial_results")) {
            return args.optBoolean("partial_results", false);
        }
        return args.optBoolean("partials", false);
    }

    private static String formattingMode(JSONObject args) {
        String raw = args.optString("formatting_mode", args.optString("formatting", FORMATTING_QUALITY))
                .trim()
                .toLowerCase(Locale.US);
        if (FORMATTING_OFF.equals(raw) || "none".equals(raw) || "false".equals(raw)) {
            return FORMATTING_OFF;
        }
        if (FORMATTING_LATENCY.equals(raw) || "fast".equals(raw)) {
            return FORMATTING_LATENCY;
        }
        return FORMATTING_QUALITY;
    }

    private static String languageSwitchMode(JSONObject args) {
        String raw = args.optString("language_switch", LANGUAGE_SWITCH_OFF).trim().toLowerCase(Locale.US);
        if (LANGUAGE_SWITCH_BALANCED.equals(raw) || "true".equals(raw) || "on".equals(raw)) {
            return LANGUAGE_SWITCH_BALANCED;
        }
        if (LANGUAGE_SWITCH_QUICK_RESPONSE.equals(raw) || "quick".equals(raw)) {
            return LANGUAGE_SWITCH_QUICK_RESPONSE;
        }
        if (LANGUAGE_SWITCH_HIGH_PRECISION.equals(raw) || "precision".equals(raw)) {
            return LANGUAGE_SWITCH_HIGH_PRECISION;
        }
        return LANGUAGE_SWITCH_OFF;
    }

    private static String languageConfidenceName(int value) {
        switch (value) {
            case SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_NOT_CONFIDENT:
                return "not_confident";
            case SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_CONFIDENT:
                return "confident";
            case SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_HIGHLY_CONFIDENT:
                return "highly_confident";
            case SpeechRecognizer.LANGUAGE_DETECTION_CONFIDENCE_LEVEL_UNKNOWN:
            default:
                return "unknown";
        }
    }

    private static String languageSwitchResultName(int value) {
        switch (value) {
            case SpeechRecognizer.LANGUAGE_SWITCH_RESULT_SUCCEEDED:
                return "succeeded";
            case SpeechRecognizer.LANGUAGE_SWITCH_RESULT_FAILED:
                return "failed";
            case SpeechRecognizer.LANGUAGE_SWITCH_RESULT_SKIPPED_NO_MODEL:
                return "skipped_no_model";
            case SpeechRecognizer.LANGUAGE_SWITCH_RESULT_NOT_ATTEMPTED:
            default:
                return "not_attempted";
        }
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

    private final class EchoTtsInitListener implements TextToSpeech.OnInitListener {
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
}
