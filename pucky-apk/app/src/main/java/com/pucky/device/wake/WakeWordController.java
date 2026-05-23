package com.pucky.device.wake;

import android.content.Context;
import android.content.SharedPreferences;

import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;

public final class WakeWordController {
    private static final String PREFS = "pucky_wake_word";
    private static final String REASON = "porcupine_removed_license_risk";
    private static final String REPLACEMENT = "volume_down_lab_openwakeword_experiment";

    private static volatile WakeWordController instance;

    private final SharedPreferences prefs;

    private WakeWordController(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
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
        JSONObject out = disabledStatus();
        Json.put(out, "requested_enabled", prefs.getBoolean("requested_enabled", false));
        Json.put(out, "last_config_set_at", nullable(prefs.getString("last_config_set_at", "")));
        Json.put(out, "last_start_requested_at", nullable(prefs.getString("last_start_requested_at", "")));
        Json.put(out, "last_stop_requested_at", nullable(prefs.getString("last_stop_requested_at", "")));
        Json.put(out, "last_simulate_requested_at", nullable(prefs.getString("last_simulate_requested_at", "")));
        return out;
    }

    public synchronized JSONObject configSet(JSONObject args) {
        SharedPreferences.Editor editor = prefs.edit();
        if (args != null && args.has("enabled")) {
            editor.putBoolean("requested_enabled", args.optBoolean("enabled", false));
        }
        editor.putString("last_config_set_at", Instant.now().toString());
        editor.apply();
        JSONObject out = status();
        Json.put(out, "saved", true);
        Json.put(out, "ignored_keys", ignoredKeys(args));
        return out;
    }

    public synchronized JSONObject start(JSONObject args) {
        prefs.edit().putString("last_start_requested_at", Instant.now().toString()).apply();
        JSONObject out = status();
        Json.put(out, "start_requested", true);
        return out;
    }

    public synchronized JSONObject stop(JSONObject args) {
        prefs.edit().putString("last_stop_requested_at", Instant.now().toString()).apply();
        JSONObject out = status();
        Json.put(out, "stop_requested", true);
        return out;
    }

    public synchronized JSONObject simulate(JSONObject args) {
        prefs.edit().putString("last_simulate_requested_at", Instant.now().toString()).apply();
        JSONObject out = status();
        Json.put(out, "simulated", false);
        Json.put(out, "simulation_ignored", true);
        return out;
    }

    public boolean enabled() {
        return false;
    }

    private JSONObject disabledStatus() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.wake_word_status.v1");
        Json.put(out, "engine", "none");
        Json.put(out, "wake_word", "Pucky");
        Json.put(out, "enabled", false);
        Json.put(out, "running", false);
        Json.put(out, "configured", false);
        Json.put(out, "reason", REASON);
        Json.put(out, "replacement", REPLACEMENT);
        Json.put(out, "commercial_dependency_removed", true);
        return out;
    }

    private static Object nullable(String value) {
        return value == null || value.trim().isEmpty() ? JSONObject.NULL : value;
    }

    private static JSONArray ignoredKeys(JSONObject args) {
        JSONArray out = new JSONArray();
        if (args == null) {
            return out;
        }
        JSONArray names = args.names();
        if (names == null) {
            return out;
        }
        for (int i = 0; i < names.length(); i++) {
            Json.add(out, names.optString(i));
        }
        return out;
    }
}
