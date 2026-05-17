package com.pucky.device.speech;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.pucky.device.PuckyApplication;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.livekit.LiveKitController;
import com.pucky.device.net.Ipv4FirstDns;
import com.pucky.device.notifications.NotificationController;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class NativeSpeechController {
    private static final String PREFS = "pucky_native_speech";
    private static final String SESSIONS = "sessions_json";
    private static final int MAX_SESSIONS = 80;
    private static final long DEFAULT_START_DELAY_MS = 150L;
    private static final int DEFAULT_CHIME_VOLUME = 80;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private static NativeSpeechController shared;

    private final Context context;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final OkHttpClient http = new OkHttpClient.Builder()
            .dns(Ipv4FirstDns.INSTANCE)
            .build();

    private SpeechRecognizer recognizer;
    private JSONObject active;
    private boolean stopRequested;
    private boolean recognizerStarted;

    public static synchronized NativeSpeechController shared(Context context) {
        if (shared == null) {
            shared = new NativeSpeechController(context.getApplicationContext());
        }
        return shared;
    }

    private NativeSpeechController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized JSONObject status() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.native_speech_status.v1");
        Json.put(out, "available", SpeechRecognizer.isRecognitionAvailable(context));
        Json.put(out, "record_audio_granted", hasRecordAudio());
        Json.put(out, "state", active == null ? "idle" : active.optString("state", "unknown"));
        Json.put(out, "active_session", active == null ? JSONObject.NULL : active);
        Json.put(out, "last_completed", lastSession());
        return out;
    }

    public synchronized JSONObject start(JSONObject args) throws CommandException {
        if (!hasRecordAudio()) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "RECORD_AUDIO is not granted");
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No Android speech recognizer is available");
        }
        if (active != null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.native_speech_start.v1");
            Json.put(out, "state", active.optString("state", "unknown"));
            Json.put(out, "result", "already_active");
            Json.put(out, "session", active);
            return out;
        }
        String sessionId = args.optString("session_id", "").trim();
        if (sessionId.isEmpty()) {
            sessionId = "ns_" + Long.toHexString(System.currentTimeMillis());
        }
        active = new JSONObject();
        Json.put(active, "schema", "pucky.native_speech_session.v1");
        Json.put(active, "session_id", sessionId);
        Json.put(active, "state", "pending_start");
        Json.put(active, "source", "android_speech_recognizer");
        Json.put(active, "language", args.optString("language", Locale.getDefault().toLanguageTag()));
        Json.put(active, "prefer_offline", args.optBoolean("prefer_offline", false));
        Json.put(active, "partial_results", args.optBoolean("partial_results", true));
        Json.put(active, "started_at", Instant.now().toString());
        Json.put(active, "start_delay_ms", Math.max(0L, Math.min(1000L, args.optLong("start_delay_ms", DEFAULT_START_DELAY_MS))));
        Json.put(active, "chime_volume", Math.max(1, Math.min(100, args.optInt("chime_volume", DEFAULT_CHIME_VOLUME))));
        Json.put(active, "broker_delivery_status", "not_ready");
        stopRequested = false;
        recognizerStarted = false;
        playChime("start", active.optInt("chime_volume", DEFAULT_CHIME_VOLUME));
        long delay = active.optLong("start_delay_ms", DEFAULT_START_DELAY_MS);
        main.postDelayed(this::startRecognizerOnMain, delay);

        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.native_speech_start.v1");
        Json.put(out, "state", "pending_start");
        Json.put(out, "session", active);
        return out;
    }

    public synchronized JSONObject stop(JSONObject args) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.native_speech_stop.v1");
        if (active == null) {
            Json.put(out, "state", "idle");
            Json.put(out, "result", "no_active_session");
            return out;
        }
        stopRequested = true;
        Json.put(active, "release_at", Instant.now().toString());
        Json.put(active, "stop_reason", args.optString("reason", "button_release"));
        Json.put(active, "state", recognizerStarted ? "stopping" : "cancelled_before_recognizer_start");
        playChime("stop", active.optInt("chime_volume", DEFAULT_CHIME_VOLUME));
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
        Json.put(out, "schema", "pucky.native_speech_last.v1");
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
        Json.put(out, "schema", "pucky.native_speech_list.v1");
        Json.put(out, "sessions", sliced);
        Json.put(out, "count", sliced.length());
        Json.put(out, "total_count", all.length());
        return out;
    }

    public synchronized JSONObject delete(JSONObject args) throws CommandException {
        String sessionId = args.optString("session_id", "").trim();
        if (sessionId.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "speech.native.delete requires session_id");
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
        Json.put(out, "schema", "pucky.native_speech_delete.v1");
        Json.put(out, "session_id", sessionId);
        Json.put(out, "deleted", deleted);
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
            Json.put(session, "state", "listening");
            recognizerStarted = true;
        }
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(context);
            recognizer.setRecognitionListener(new Listener(session.optString("session_id")));
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, session.optString("language", Locale.getDefault().toLanguageTag()));
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, session.optBoolean("partial_results", true));
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, session.optBoolean("prefer_offline", false));
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
        }

        @Override
        public void onBeginningOfSpeech() {
            patch(sessionId, "speech_begin_at", Instant.now().toString());
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
        }

        @Override
        public void onError(int error) {
            failActive(errorName(error), "Android SpeechRecognizer error " + error + " (" + errorName(error) + ")", true);
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
            synchronized (NativeSpeechController.this) {
                if (active != null && sessionId.equals(active.optString("session_id"))) {
                    Json.put(active, "partial_transcript", first(values));
                    Json.put(active, "partial_at", Instant.now().toString());
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
        Json.put(active, "alternatives", array(values));
        Json.put(active, "confidence_scores", array(confidences));
        Json.put(active, "text", text);
        if (text.trim().isEmpty()) {
            Json.put(active, "state", "failed");
            Json.put(active, "error_code", "empty_transcript");
            Json.put(active, "error_message", "SpeechRecognizer returned no transcript text");
            appendSession(active);
            active = null;
            cleanupRecognizer();
            return;
        }
        Json.put(active, "state", "completed");
        Json.put(active, "broker_delivery_status", "pending");
        JSONObject finished = active;
        appendSession(finished);
        active = null;
        cleanupRecognizer();
        submitToBroker(finished);
    }

    private synchronized void failActive(String code, String message, boolean recognizerCallback) {
        if (active == null) {
            cleanupRecognizer();
            return;
        }
        Json.put(active, "completed_at", Instant.now().toString());
        Json.put(active, "state", "failed");
        Json.put(active, "error_code", code);
        Json.put(active, "error_message", message);
        Json.put(active, "recognizer_callback", recognizerCallback);
        Json.put(active, "broker_delivery_status", "not_sent_failed");
        appendSession(active);
        active = null;
        cleanupRecognizer();
    }

    private void submitToBroker(JSONObject session) {
        SettingsStore settings = ((PuckyApplication) context).settingsStore();
        String endpoint = brokerReplyEndpoint(settings.getBrokerUrl(), settings.getDeviceId());
        if (endpoint.isEmpty()) {
            markDelivery(session.optString("session_id"), "skipped_no_broker_url", null);
            return;
        }
        JSONObject body = new JSONObject();
        Json.put(body, "schema", "pucky.speech_transcript.v1");
        Json.put(body, "reply_id", "speech_" + session.optString("session_id"));
        Json.put(body, "prompt_id", "native_speech_ptt");
        Json.put(body, "text", session.optString("text", ""));
        JSONObject extra = new JSONObject();
        Json.put(extra, "source", "android_speech_recognizer");
        Json.put(extra, "session", session);
        JSONObject livekit = LiveKitController.shared(context, settings).status();
        String livekitState = livekit.optString("state", "");
        String livekitRoom = livekit.optString("room", "").trim();
        Json.put(extra, "livekit_state", livekitState);
        if (isLiveKitActiveState(livekitState) && !livekitRoom.isEmpty()) {
            Json.put(body, "room", livekitRoom);
            Json.put(body, "livekit_room", livekitRoom);
            Json.put(extra, "livekit_room", livekitRoom);
        }
        Json.put(body, "extra", extra);
        Request request = new Request.Builder()
                .url(endpoint)
                .header("Authorization", "Bearer " + settings.getToken())
                .post(RequestBody.create(body.toString(), JSON))
                .build();
        http.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                markDelivery(session.optString("session_id"), "send_failed", e.getClass().getSimpleName() + ": " + e.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (Response ignored = response) {
                    String responseText = "";
                    try {
                        responseText = response.body() == null ? "" : response.body().string();
                    } catch (IOException e) {
                        markDelivery(session.optString("session_id"), "send_failed_response_read", e.getClass().getSimpleName() + ": " + e.getMessage());
                        return;
                    }
                    if (response.isSuccessful()) {
                        markDelivery(session.optString("session_id"), "sent_to_broker", null);
                        String finalText = finalTextFromResponse(responseText);
                        markBrokerResponse(session.optString("session_id"), responseText, finalText);
                        if (!finalText.isEmpty()) {
                            showBrokerResponse(session.optString("session_id"), finalText);
                        }
                        playChime("sent", session.optInt("chime_volume", DEFAULT_CHIME_VOLUME));
                    } else {
                        markDelivery(session.optString("session_id"), "send_failed_http_" + response.code(), null);
                    }
                }
            }
        });
    }

    private static boolean isLiveKitActiveState(String state) {
        return "connected".equals(state)
                || "connected_talking".equals(state)
                || "connected_muted".equals(state)
                || "reconnecting".equals(state);
    }

    private synchronized void markBrokerResponse(String sessionId, String responseText, String finalText) {
        JSONArray all = sessionsJson();
        for (int i = all.length() - 1; i >= 0; i--) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && sessionId.equals(item.optString("session_id"))) {
                Json.put(item, "broker_response_at", Instant.now().toString());
                Json.put(item, "broker_response_final_text", finalText);
                Json.put(item, "broker_response_raw", truncate(responseText, 4000));
                prefs.edit().putString(SESSIONS, all.toString()).commit();
                return;
            }
        }
    }

    private void showBrokerResponse(String sessionId, String finalText) {
        try {
            JSONObject args = new JSONObject();
            Json.put(args, "id", "native_speech_reply_" + sessionId);
            Json.put(args, "title", "Pucky");
            Json.put(args, "text", finalText.length() > 180 ? finalText.substring(0, 177) + "..." : finalText);
            Json.put(args, "big_text", finalText);
            Json.put(args, "silent", true);
            Json.put(args, "audible", false);
            Json.put(args, "only_alert_once", true);
            new NotificationController(context).show(args);
        } catch (Exception ignored) {
            // Notification display is best-effort; the transcript delivery log is the durable debugging path.
        }
    }

    private synchronized void markDelivery(String sessionId, String status, String error) {
        JSONArray all = sessionsJson();
        for (int i = all.length() - 1; i >= 0; i--) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && sessionId.equals(item.optString("session_id"))) {
                Json.put(item, "broker_delivery_status", status);
                Json.put(item, "broker_delivery_at", Instant.now().toString());
                if (error != null) {
                    Json.put(item, "broker_delivery_error", error);
                }
                prefs.edit().putString(SESSIONS, all.toString()).commit();
                return;
            }
        }
    }

    private void playChime(String kind, int volume) {
        int tone;
        int duration;
        if ("start".equals(kind)) {
            tone = ToneGenerator.TONE_PROP_ACK;
            duration = 140;
        } else if ("stop".equals(kind)) {
            tone = ToneGenerator.TONE_PROP_BEEP2;
            duration = 110;
        } else {
            tone = ToneGenerator.TONE_PROP_PROMPT;
            duration = 160;
        }
        ToneGenerator generator = new ToneGenerator(AudioManager.STREAM_MUSIC, Math.max(1, Math.min(100, volume)));
        generator.startTone(tone, duration);
        new Thread(() -> {
            try {
                Thread.sleep(duration + 120L);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            generator.release();
        }, "pucky-native-speech-chime").start();
    }

    private void patch(String sessionId, String key, Object value) {
        synchronized (this) {
            if (active != null && sessionId.equals(active.optString("session_id"))) {
                Json.put(active, key, value);
            }
        }
    }

    private boolean hasRecordAudio() {
        return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
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

    private static String brokerReplyEndpoint(String brokerUrl, String deviceId) {
        if (brokerUrl == null || brokerUrl.trim().isEmpty() || deviceId == null || deviceId.trim().isEmpty()) {
            return "";
        }
        String value = brokerUrl.trim();
        value = value.replaceFirst("^wss://", "https://").replaceFirst("^ws://", "http://");
        int marker = value.indexOf("/v1/devices/");
        String base = marker >= 0 ? value.substring(0, marker) : value;
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base + "/v1/devices/" + deviceId + "/replies";
    }

    private static String finalTextFromResponse(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return "";
        }
        try {
            JSONObject json = new JSONObject(raw);
            String direct = json.optString("final_text", "").trim();
            if (!direct.isEmpty()) {
                return direct;
            }
            JSONObject voiceTurn = json.optJSONObject("voice_turn");
            if (voiceTurn != null) {
                return voiceTurn.optString("final_text", "").trim();
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    private static String truncate(String value, int maxChars) {
        if (value == null) {
            return "";
        }
        if (value.length() <= maxChars) {
            return value;
        }
        return value.substring(0, Math.max(0, maxChars));
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
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                return "ERROR_SPEECH_TIMEOUT";
            default:
                return "ERROR_" + error;
        }
    }
}
