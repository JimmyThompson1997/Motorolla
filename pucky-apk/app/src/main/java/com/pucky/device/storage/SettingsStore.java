package com.pucky.device.storage;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;

import com.pucky.device.util.Json;

import org.json.JSONException;
import org.json.JSONObject;

public final class SettingsStore {
    private static final String PREFS = "pucky_settings";
    private static final String DEVICE_ID = "device_id";
    private static final String BROKER_URL = "broker_url";
    private static final String TOKEN = "token";
    private static final String PUCKY_TURN_URL = "pucky_turn_url";
    private static final String PUCKY_API_TOKEN = "pucky_api_token";
    private static final String PUCKY_TURN_REPLY_MODE = "pucky_turn_reply_mode";
    private static final String PUCKY_TURN_ARRIVAL_CUE_MODE = "pucky_turn_arrival_cue_mode";
    private static final String PUCKY_TURN_ACCEPTED_CHIME_ENABLED = "pucky_turn_accepted_chime_enabled";
    public static final String PUCKY_TURN_REPLY_CARD_ONLY = "card_only";
    public static final String PUCKY_TURN_REPLY_CARD_AND_SPOKEN = "card_and_spoken";
    public static final String PUCKY_TURN_ARRIVAL_CUE_NONE = "none";
    public static final String PUCKY_TURN_ARRIVAL_CUE_HAPTIC = "haptic";
    public static final String PUCKY_TURN_ARRIVAL_CUE_CHIME = "chime";
    public static final String PUCKY_TURN_ARRIVAL_CUE_HAPTIC_AND_CHIME = "haptic_and_chime";
    private static final String UI_SHELL_MODE = "ui_shell_mode";
    private static final String AUTO_CONNECT = "auto_connect";
    private static final String AUTOSTART = "autostart";
    private static final String[] LEGACY_REMOTE_ADB_KEYS = new String[] {
            "adb_transport"
    };
    private static final String[] LEGACY_REMOTE_ADB_PREFIXES = new String[] {
            "remote_adb_",
            "tunnel_"
    };

    private final Context context;
    private final SharedPreferences prefs;

    public SettingsStore(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        clearLegacyRemoteAdbState();
    }

    public String getDeviceId() {
        String value = prefs.getString(DEVICE_ID, null);
        if (value != null && !value.trim().isEmpty()) {
            return value;
        }
        String androidId = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        return "pucky-" + (androidId == null ? "debug" : androidId);
    }

    public String getBrokerUrl() {
        String value = prefs.getString(BROKER_URL, null);
        if (value != null && !value.trim().isEmpty()) {
            return value;
        }
        return "wss://pucky.fly.dev/v1/devices/" + getDeviceId() + "/connect";
    }

    public String getToken() {
        String value = prefs.getString(TOKEN, "");
        String clean = value == null ? "" : value.trim();
        return "dev-token".equals(clean) ? "" : clean;
    }

    public Context context() {
        return context;
    }

    public String getPuckyTurnUrl() {
        return prefs.getString(PUCKY_TURN_URL, "https://pucky.fly.dev/api/turn").trim();
    }

    public String getPuckyTurnAuthToken() {
        String explicit = prefs.getString(PUCKY_API_TOKEN, "").trim();
        if (!explicit.isEmpty()) {
            return explicit;
        }
        String brokerToken = getToken();
        String clean = brokerToken == null ? "" : brokerToken.trim();
        return clean;
    }

    public String getPuckyApiToken() {
        return getPuckyTurnAuthToken();
    }

    public String getPuckyTurnReplyMode() {
        return normalizePuckyTurnReplyMode(prefs.getString(PUCKY_TURN_REPLY_MODE, PUCKY_TURN_REPLY_CARD_ONLY));
    }

    public boolean isPuckyTurnSpokenReplyEnabled() {
        return PUCKY_TURN_REPLY_CARD_AND_SPOKEN.equals(getPuckyTurnReplyMode());
    }

    public void setPuckyTurnReplyMode(String mode) {
        prefs.edit().putString(PUCKY_TURN_REPLY_MODE, normalizePuckyTurnReplyMode(mode)).commit();
    }

    public String getPuckyTurnArrivalCueMode() {
        if (prefs.contains(PUCKY_TURN_ARRIVAL_CUE_MODE)) {
            return normalizePuckyTurnArrivalCueMode(prefs.getString(PUCKY_TURN_ARRIVAL_CUE_MODE, PUCKY_TURN_ARRIVAL_CUE_CHIME));
        }
        if (prefs.contains(PUCKY_TURN_ACCEPTED_CHIME_ENABLED)) {
            return prefs.getBoolean(PUCKY_TURN_ACCEPTED_CHIME_ENABLED, true)
                    ? PUCKY_TURN_ARRIVAL_CUE_CHIME
                    : PUCKY_TURN_ARRIVAL_CUE_NONE;
        }
        return PUCKY_TURN_ARRIVAL_CUE_CHIME;
    }

    public void setPuckyTurnArrivalCueMode(String mode) {
        String normalized = normalizePuckyTurnArrivalCueMode(mode);
        prefs.edit()
                .putString(PUCKY_TURN_ARRIVAL_CUE_MODE, normalized)
                .putBoolean(PUCKY_TURN_ACCEPTED_CHIME_ENABLED, arrivalCueModeIncludesChime(normalized))
                .commit();
    }

    public boolean isPuckyTurnAcceptedChimeEnabled() {
        return arrivalCueModeIncludesChime(getPuckyTurnArrivalCueMode());
    }

    public void setPuckyTurnAcceptedChimeEnabled(boolean enabled) {
        setPuckyTurnArrivalCueMode(enabled ? PUCKY_TURN_ARRIVAL_CUE_CHIME : PUCKY_TURN_ARRIVAL_CUE_NONE);
    }

    public String getUiShellMode() {
        return "web_cached";
    }

    public boolean isWebCachedUiEnabled() {
        return true;
    }

    public void setUiShellMode(String mode) {
        prefs.edit().putString(UI_SHELL_MODE, "web_cached").apply();
    }

    public boolean isAutoConnectEnabled() {
        return prefs.getBoolean(AUTO_CONNECT, false);
    }

    public boolean isAutostartEnabled() {
        return prefs.getBoolean(AUTOSTART, true);
    }

    public void setAutoConnectEnabled(boolean enabled) {
        prefs.edit().putBoolean(AUTO_CONNECT, enabled).commit();
    }

    public void setAutostartEnabled(boolean enabled) {
        prefs.edit().putBoolean(AUTOSTART, enabled).commit();
    }

    public void save(String deviceId, String brokerUrl, String token) {
        prefs.edit()
                .putString(DEVICE_ID, nonEmpty(deviceId, getDeviceId()))
                .putString(BROKER_URL, nonEmpty(brokerUrl, getBrokerUrl()))
                .putString(TOKEN, nonEmpty(token, getToken()))
                .commit();
    }

    public JSONObject importProvisioningJson(String raw) throws JSONException {
        JSONObject input = new JSONObject(raw);
        String schema = input.optString("schema", "pucky.provisioning.v1");
        if (!"pucky.provisioning.v1".equals(schema)) {
            throw new JSONException("Unsupported provisioning schema: " + schema);
        }
        String token = input.optString("device_token", input.optString("token", getToken()));
        save(
                input.optString("device_id", getDeviceId()),
                input.optString("broker_url", getBrokerUrl()),
                token);
        SharedPreferences.Editor editor = prefs.edit();
        putString(editor, input, "pucky_turn_url", PUCKY_TURN_URL);
        putString(editor, input, "pucky_api_token", PUCKY_API_TOKEN);
        putString(editor, input, "pucky_turn_reply_mode", PUCKY_TURN_REPLY_MODE);
        if (input.has("pucky_turn_arrival_cue_mode")) {
            String arrivalCueMode = normalizePuckyTurnArrivalCueMode(input.optString("pucky_turn_arrival_cue_mode", PUCKY_TURN_ARRIVAL_CUE_CHIME));
            editor.putString(PUCKY_TURN_ARRIVAL_CUE_MODE, arrivalCueMode);
            editor.putBoolean(PUCKY_TURN_ACCEPTED_CHIME_ENABLED, arrivalCueModeIncludesChime(arrivalCueMode));
        } else if (input.has("pucky_turn_accepted_chime_enabled")) {
            boolean acceptedChimeEnabled = input.optBoolean("pucky_turn_accepted_chime_enabled", true);
            editor.putString(
                    PUCKY_TURN_ARRIVAL_CUE_MODE,
                    acceptedChimeEnabled ? PUCKY_TURN_ARRIVAL_CUE_CHIME : PUCKY_TURN_ARRIVAL_CUE_NONE);
            editor.putBoolean(PUCKY_TURN_ACCEPTED_CHIME_ENABLED, acceptedChimeEnabled);
        }
        putString(editor, input, "ui_shell_mode", UI_SHELL_MODE);
        editor.commit();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", schema);
        Json.put(out, "device_id", getDeviceId());
        Json.put(out, "broker_url", getBrokerUrl());
        Json.put(out, "has_token", getToken() != null && !getToken().trim().isEmpty());
        return out;
    }

    private void clearLegacyRemoteAdbState() {
        SharedPreferences.Editor editor = prefs.edit();
        boolean changed = false;
        for (String key : LEGACY_REMOTE_ADB_KEYS) {
            if (prefs.contains(key)) {
                editor.remove(key);
                changed = true;
            }
        }
        for (String key : prefs.getAll().keySet()) {
            for (String prefix : LEGACY_REMOTE_ADB_PREFIXES) {
                if (key.startsWith(prefix)) {
                    editor.remove(key);
                    changed = true;
                    break;
                }
            }
        }
        if (changed) {
            editor.commit();
        }
    }

    private static String nonEmpty(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
    }

    private static String normalizePuckyTurnReplyMode(String mode) {
        String value = mode == null ? "" : mode.trim().toLowerCase();
        if (PUCKY_TURN_REPLY_CARD_AND_SPOKEN.equals(value)
                || "spoken".equals(value)
                || "voice".equals(value)
                || "card_voice".equals(value)) {
            return PUCKY_TURN_REPLY_CARD_AND_SPOKEN;
        }
        return PUCKY_TURN_REPLY_CARD_ONLY;
    }

    private static String normalizePuckyTurnArrivalCueMode(String mode) {
        String value = mode == null ? "" : mode.trim().toLowerCase();
        if (PUCKY_TURN_ARRIVAL_CUE_HAPTIC_AND_CHIME.equals(value)
                || "both".equals(value)
                || "buzz_and_chime".equals(value)
                || "haptic+chime".equals(value)) {
            return PUCKY_TURN_ARRIVAL_CUE_HAPTIC_AND_CHIME;
        }
        if (PUCKY_TURN_ARRIVAL_CUE_HAPTIC.equals(value)
                || "buzz".equals(value)
                || "vibrate".equals(value)) {
            return PUCKY_TURN_ARRIVAL_CUE_HAPTIC;
        }
        if (PUCKY_TURN_ARRIVAL_CUE_NONE.equals(value)
                || "off".equals(value)
                || "disabled".equals(value)
                || "silent".equals(value)) {
            return PUCKY_TURN_ARRIVAL_CUE_NONE;
        }
        return PUCKY_TURN_ARRIVAL_CUE_CHIME;
    }

    private static boolean arrivalCueModeIncludesChime(String mode) {
        String normalized = normalizePuckyTurnArrivalCueMode(mode);
        return PUCKY_TURN_ARRIVAL_CUE_CHIME.equals(normalized)
                || PUCKY_TURN_ARRIVAL_CUE_HAPTIC_AND_CHIME.equals(normalized);
    }

    private static void putString(SharedPreferences.Editor editor, JSONObject input, String jsonKey, String prefKey) {
        if (!input.has(jsonKey)) {
            return;
        }
        String value = input.optString(jsonKey, "").trim();
        if (value.isEmpty()) {
            editor.remove(prefKey);
        } else {
            editor.putString(prefKey, value);
        }
    }

    private static void putBoolean(SharedPreferences.Editor editor, JSONObject input, String jsonKey, String prefKey) {
        if (input.has(jsonKey)) {
            editor.putBoolean(prefKey, input.optBoolean(jsonKey, false));
        }
    }

    private static void putInt(
            SharedPreferences.Editor editor,
            JSONObject input,
            String jsonKey,
            String prefKey,
            int min,
            int max) {
        if (!input.has(jsonKey)) {
            return;
        }
        int value = input.optInt(jsonKey, min);
        editor.putInt(prefKey, Math.max(min, Math.min(max, value)));
    }
}
