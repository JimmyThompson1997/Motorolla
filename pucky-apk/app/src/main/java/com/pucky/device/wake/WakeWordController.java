package com.pucky.device.wake;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import ai.picovoice.porcupine.PorcupineManager;
import ai.picovoice.porcupine.PorcupineManagerCallback;

import com.pucky.device.livekit.LiveKitController;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.InputStream;
import java.time.Instant;

public final class WakeWordController {
    private static final String TAG = "PuckyWakeWord";
    private static final String PREFS = "pucky_wake_word";
    private static final String ACCESS_KEY = "picovoice_access_key";
    private static final String KEYWORD_PATH = "keyword_path";
    private static final String ENABLED = "enabled";
    private static final String DEFAULT_KEYWORD_PATH = "pucky_android.ppn";
    private static final long NO_SPEECH_TIMEOUT_MS = 20_000L;

    private static volatile WakeWordController instance;

    private final Context context;
    private final SharedPreferences prefs;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private PorcupineManager manager;
    private boolean running;
    private String lastError = "";
    private String lastDetectionAt = "";
    private Runnable noSpeechTimeout;

    private WakeWordController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
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

    public synchronized JSONObject status() {
        JSONObject out = new JSONObject();
        String keywordPath = keywordPath();
        boolean configured = accessKeySet() && keywordAvailable(keywordPath);
        Json.put(out, "schema", "pucky.wake_word_status.v1");
        Json.put(out, "engine", "picovoice_porcupine");
        Json.put(out, "wake_word", "Pucky");
        Json.put(out, "enabled", enabled());
        Json.put(out, "running", running);
        Json.put(out, "configured", configured);
        Json.put(out, "access_key_set", accessKeySet());
        Json.put(out, "keyword_path", keywordPath);
        Json.put(out, "keyword_available", keywordAvailable(keywordPath));
        Json.put(out, "no_speech_timeout_ms", NO_SPEECH_TIMEOUT_MS);
        Json.put(out, "last_detection_at", lastDetectionAt.isEmpty() ? JSONObject.NULL : lastDetectionAt);
        Json.put(out, "last_error", lastError.isEmpty() ? JSONObject.NULL : lastError);
        return out;
    }

    public synchronized JSONObject configSet(JSONObject args) {
        SharedPreferences.Editor editor = prefs.edit();
        if (args.has("enabled")) {
            editor.putBoolean(ENABLED, args.optBoolean("enabled", true));
        }
        if (args.has("access_key") && !args.isNull("access_key")) {
            editor.putString(ACCESS_KEY, args.optString("access_key", "").trim());
        }
        if (args.has("keyword_path") && !args.isNull("keyword_path")) {
            editor.putString(KEYWORD_PATH, args.optString("keyword_path", DEFAULT_KEYWORD_PATH).trim());
        }
        editor.apply();
        if (running) {
            stop(new JSONObject());
            if (enabled()) {
                start(new JSONObject());
            }
        }
        JSONObject out = status();
        Json.put(out, "saved", true);
        return out;
    }

    public synchronized JSONObject start(JSONObject args) {
        if (args != null && args.length() > 0) {
            configSet(args);
        }
        JSONObject out = status();
        if (running) {
            return out;
        }
        if (!enabled()) {
            lastError = "wake word disabled";
            return status();
        }
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            lastError = "RECORD_AUDIO permission is required";
            return status();
        }
        String accessKey = accessKey();
        String keywordPath = keywordPath();
        if (accessKey.isEmpty()) {
            lastError = "Picovoice AccessKey is required";
            return status();
        }
        if (!keywordAvailable(keywordPath)) {
            lastError = "Pucky keyword model not found: " + keywordPath;
            return status();
        }
        try {
            PorcupineManagerCallback callback = keywordIndex -> handleDetection("porcupine", keywordIndex);
            manager = new PorcupineManager.Builder()
                    .setAccessKey(accessKey)
                    .setKeywordPath(keywordPath)
                    .build(context, callback);
            manager.start();
            running = true;
            lastError = "";
            return status();
        } catch (Exception exc) {
            lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
            running = false;
            manager = null;
            return status();
        }
    }

    public synchronized JSONObject stop(JSONObject args) {
        cancelNoSpeechTimeout();
        if (manager != null) {
            try {
                manager.stop();
            } catch (Exception exc) {
                lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
            }
            try {
                manager.delete();
            } catch (Exception exc) {
                lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
            }
        }
        manager = null;
        running = false;
        return status();
    }

    public JSONObject simulate(JSONObject args) {
        handleDetection("simulated_command", 0);
        JSONObject out = status();
        Json.put(out, "simulated", true);
        return out;
    }

    public boolean enabled() {
        return prefs.getBoolean(ENABLED, true);
    }

    private void handleDetection(String source, int keywordIndex) {
        int transcriptionCountBefore = transcriptionEventCount();
        lastDetectionAt = Instant.now().toString();
        lastError = "";
        Log.i(TAG, "wake detected source=" + source + " keywordIndex=" + keywordIndex);
        new Thread(() -> {
            try {
                JSONObject args = new JSONObject();
                Json.put(args, "reason", "wake_word_pucky");
                Json.put(args, "source", source);
                Json.put(args, "force_new_session", false);
                LiveKitController.shared(context, new SettingsStore(context)).pttStart(args);
                scheduleNoSpeechTimeout(transcriptionCountBefore);
            } catch (Exception exc) {
                lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
                Log.w(TAG, "wake LiveKit start failed", exc);
            }
        }, "pucky-wake-livekit").start();
    }

    private void scheduleNoSpeechTimeout(int transcriptionCountBefore) {
        cancelNoSpeechTimeout();
        noSpeechTimeout = () -> {
            int after = transcriptionEventCount();
            if (after > transcriptionCountBefore) {
                return;
            }
            try {
                JSONObject args = new JSONObject();
                Json.put(args, "reason", "wake_word_no_speech_timeout");
                LiveKitController.shared(context, new SettingsStore(context)).disconnect(args);
                Log.i(TAG, "wake no-speech timeout disconnected LiveKit");
            } catch (Exception exc) {
                lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
            }
        };
        mainHandler.postDelayed(noSpeechTimeout, NO_SPEECH_TIMEOUT_MS);
    }

    private void cancelNoSpeechTimeout() {
        if (noSpeechTimeout != null) {
            mainHandler.removeCallbacks(noSpeechTimeout);
            noSpeechTimeout = null;
        }
    }

    private int transcriptionEventCount() {
        try {
            JSONObject args = new JSONObject();
            Json.put(args, "limit", 200);
            JSONArray events = LiveKitController.shared(context, new SettingsStore(context))
                    .eventsList(args)
                    .optJSONArray("events");
            if (events == null) {
                return 0;
            }
            int count = 0;
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.optJSONObject(i);
                if (event != null && "transcription_received".equals(event.optString("event", ""))) {
                    count += 1;
                }
            }
            return count;
        } catch (Exception ignored) {
            return 0;
        }
    }

    private boolean accessKeySet() {
        return !accessKey().isEmpty();
    }

    private String accessKey() {
        return prefs.getString(ACCESS_KEY, "").trim();
    }

    private String keywordPath() {
        String value = prefs.getString(KEYWORD_PATH, DEFAULT_KEYWORD_PATH);
        if (value == null || value.trim().isEmpty()) {
            return DEFAULT_KEYWORD_PATH;
        }
        return value.trim();
    }

    private boolean keywordAvailable(String path) {
        if (path == null || path.trim().isEmpty()) {
            return false;
        }
        if (path.startsWith("/")) {
            return new File(path).isFile();
        }
        try (InputStream ignored = context.getAssets().open(path)) {
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
}
