package com.pucky.device.speech;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;

import com.pucky.device.audio.AudioRouteDetector;
import com.pucky.device.speech.lab.AudioFrameBus;
import com.pucky.device.speech.lab.OpenWakeWordConsumer;
import com.pucky.device.speech.lab.PreRollBuffer;
import com.pucky.device.speech.lab.SileroVadConsumer;
import com.pucky.device.speech.lab.TelemetryConsumer;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.Locale;

public final class SpeechEchoLabController {
    private static final String PREFS = "pucky_speech_echo_lab";
    private static final String SESSIONS = "sessions_json";
    private static final String ENGINE = "engine";
    private static final String SAVE_DEBUG_AUDIO = "save_debug_audio";
    private static final String ROUTE_REQUIRED = "route_required";
    private static final int MAX_SESSIONS = 80;

    public static final String ENGINE_ANDROID_DIRECT_ECHO = "android_direct_echo";
    public static final String ENGINE_FRAME_BUS_METRICS = "frame_bus_metrics";
    public static final String ENGINE_FRAME_BUS_VAD = "frame_bus_vad";
    public static final String ENGINE_FRAME_BUS_WAKE = "frame_bus_wake";

    private static volatile SpeechEchoLabController shared;

    private final Context context;
    private final SharedPreferences prefs;
    private final SpeechEchoController directEcho;
    private final AudioRouteDetector routeDetector;
    private final Handler main;

    private JSONObject active;
    private AudioFrameBus frameBus;

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
                .putString(ENGINE, current.optString(ENGINE, ENGINE_ANDROID_DIRECT_ECHO))
                .putBoolean(SAVE_DEBUG_AUDIO, current.optBoolean(SAVE_DEBUG_AUDIO, false))
                .putString(ROUTE_REQUIRED, current.optString(ROUTE_REQUIRED, "none"))
                .commit();
        JSONObject out = configGet();
        Json.put(out, "saved", true);
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
        Json.put(session, "error_code", code);
        Json.put(session, "error_message", message);
        appendSession(session);
        if (active == session) {
            active = null;
        }
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
        Json.put(out, ENGINE, normalizeEngine(prefs.getString(ENGINE, ENGINE_ANDROID_DIRECT_ECHO)));
        Json.put(out, SAVE_DEBUG_AUDIO, prefs.getBoolean(SAVE_DEBUG_AUDIO, false));
        Json.put(out, ROUTE_REQUIRED, normalizeRouteRequired(prefs.getString(ROUTE_REQUIRED, "none")));
        Json.put(out, "vad_enabled", ENGINE_FRAME_BUS_VAD.equals(out.optString(ENGINE))
                || ENGINE_FRAME_BUS_WAKE.equals(out.optString(ENGINE)));
        Json.put(out, "wake_enabled", ENGINE_FRAME_BUS_WAKE.equals(out.optString(ENGINE)));
        Json.put(out, "raw_audio_default", "not_stored");
        return out;
    }

    private void ensureDefaults() {
        if (!prefs.contains(ENGINE)) {
            prefs.edit()
                    .putString(ENGINE, ENGINE_ANDROID_DIRECT_ECHO)
                    .putBoolean(SAVE_DEBUG_AUDIO, false)
                    .putString(ROUTE_REQUIRED, "none")
                    .commit();
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
        if (ENGINE_FRAME_BUS_METRICS.equals(value)
                || ENGINE_FRAME_BUS_VAD.equals(value)
                || ENGINE_FRAME_BUS_WAKE.equals(value)) {
            return value;
        }
        return ENGINE_ANDROID_DIRECT_ECHO;
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
