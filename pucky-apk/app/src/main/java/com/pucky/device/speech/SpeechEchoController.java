package com.pucky.device.speech;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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

    private static SpeechEchoController shared;

    private final Context context;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());

    private SpeechRecognizer recognizer;
    private TextToSpeech speaker;
    private JSONObject active;
    private boolean stopRequested;
    private boolean recognizerStarted;
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
        Json.put(out, "recognizer_mode", "strict_on_device");
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

        active = session;
        stopRequested = false;
        recognizerStarted = false;
        ensureTtsReady();
        main.postDelayed(this::startRecognizerOnMain, START_DELAY_MS);
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
        if (recognizerStarted) {
            main.post(() -> {
                try {
                    if (recognizer != null) {
                        recognizer.stopListening();
                    }
                } catch (RuntimeException exc) {
                    failActive("stop_failed", exc.getClass().getSimpleName() + ": " + exc.getMessage(), false);
                }
            });
        } else {
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
        Json.put(session, "language", args.optString("language", Locale.getDefault().toLanguageTag()));
        Json.put(session, "partial_results", true);
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
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(context);
            recognizer.setRecognitionListener(new Listener(session.optString("session_id")));
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, session.optString("language", Locale.getDefault().toLanguageTag()));
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.getPackageName());
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
            patch(sessionId, "ready_at", Instant.now().toString());
            patch(sessionId, "ready_elapsed_ms", elapsedMsForSession(sessionId));
            buzzOneShot(READY_HAPTIC_MS, HAPTIC_AMPLITUDE);
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
        public void onEvent(int eventType, Bundle params) {
        }
    }

    private synchronized void completeActive(ArrayList<String> values, float[] confidences) {
        if (active == null) {
            cleanupRecognizer();
            return;
        }
        String text = first(values);
        Json.put(active, "completed_at", Instant.now().toString());
        Json.put(active, "completed_elapsed_ms", elapsedMs(active));
        Json.put(active, "alternatives", array(values));
        Json.put(active, "confidence_scores", array(confidences));
        Json.put(active, "text", text);
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

    private static String first(ArrayList<String> values) {
        if (values == null || values.isEmpty() || values.get(0) == null) {
            return "";
        }
        return values.get(0);
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
