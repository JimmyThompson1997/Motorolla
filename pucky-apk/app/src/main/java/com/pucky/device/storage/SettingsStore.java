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
    private static final String UI_SHELL_MODE = "ui_shell_mode";
    private static final String AUTO_CONNECT = "auto_connect";
    private static final String AUTOSTART = "autostart";
    private static final String TUNNEL_ENABLED = "tunnel_enabled";
    private static final String TUNNEL_HOST = "tunnel_host";
    private static final String TUNNEL_USER = "tunnel_user";
    private static final String TUNNEL_PORT = "tunnel_port";
    private static final String TUNNEL_REMOTE_BIND = "tunnel_remote_bind";
    private static final String TUNNEL_REMOTE_ADB_PORT = "tunnel_remote_adb_port";
    private static final String TUNNEL_PHONE_ADB_HOST = "tunnel_phone_adb_host";
    private static final String TUNNEL_PHONE_ADB_PORT = "tunnel_phone_adb_port";
    private static final String TUNNEL_TLS_ENABLED = "tunnel_tls_enabled";
    private static final String TUNNEL_TLS_SERVER_NAME = "tunnel_tls_server_name";
    private static final String TUNNEL_STRICT_HOST_KEY = "tunnel_strict_host_key";
    private static final String TUNNEL_CONNECT_TIMEOUT_MS = "tunnel_connect_timeout_ms";
    private static final String TUNNEL_RECONNECT_DELAY_MS = "tunnel_reconnect_delay_ms";
    private static final String ADB_TRANSPORT = "adb_transport";

    private final Context context;
    private final SharedPreferences prefs;

    public SettingsStore(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
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
        return "ws://127.0.0.1:8787/v1/devices/" + getDeviceId() + "/connect";
    }

    public String getToken() {
        return prefs.getString(TOKEN, "dev-token");
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
        return "dev-token".equals(clean) ? "" : clean;
    }

    public String getPuckyApiToken() {
        return getPuckyTurnAuthToken();
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

    public boolean isTunnelEnabled() {
        return prefs.getBoolean(TUNNEL_ENABLED, false);
    }

    public boolean hasTunnelConfig() {
        return !getTunnelHost().isEmpty() && !getTunnelUser().isEmpty();
    }

    public String getTunnelHost() {
        return prefs.getString(TUNNEL_HOST, "").trim();
    }

    public String getTunnelUser() {
        return prefs.getString(TUNNEL_USER, "pucky-adb").trim();
    }

    public int getTunnelPort() {
        return prefs.getInt(TUNNEL_PORT, 22);
    }

    public String getTunnelRemoteBindAddress() {
        return prefs.getString(TUNNEL_REMOTE_BIND, "127.0.0.1").trim();
    }

    public int getTunnelRemoteAdbPort() {
        return prefs.getInt(TUNNEL_REMOTE_ADB_PORT, 15555);
    }

    public int getTunnelVmAdbPort() {
        return getTunnelRemoteAdbPort();
    }

    public String getTunnelPhoneAdbHost() {
        return prefs.getString(TUNNEL_PHONE_ADB_HOST, "127.0.0.1").trim();
    }

    public int getTunnelPhoneAdbPort() {
        return prefs.getInt(TUNNEL_PHONE_ADB_PORT, 5555);
    }

    public String getAdbTransport() {
        String value = prefs.getString(ADB_TRANSPORT, "classic_tcp").trim();
        return value.isEmpty() ? "classic_tcp" : value;
    }

    public boolean isTunnelTlsEnabled() {
        return prefs.getBoolean(TUNNEL_TLS_ENABLED, false);
    }

    public String getTunnelTlsServerName() {
        String value = prefs.getString(TUNNEL_TLS_SERVER_NAME, "").trim();
        return value.isEmpty() ? getTunnelHost() : value;
    }

    public boolean isTunnelStrictHostKeyChecking() {
        return prefs.getBoolean(TUNNEL_STRICT_HOST_KEY, true);
    }

    public int getTunnelConnectTimeoutMs() {
        return prefs.getInt(TUNNEL_CONNECT_TIMEOUT_MS, 15000);
    }

    public int getTunnelReconnectDelayMs() {
        return prefs.getInt(TUNNEL_RECONNECT_DELAY_MS, 10000);
    }

    public JSONObject tunnelSettingsJson() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.tunnel_settings.v1");
        Json.put(out, "enabled", isTunnelEnabled());
        Json.put(out, "configured", hasTunnelConfig());
        Json.put(out, "host", getTunnelHost());
        Json.put(out, "user", getTunnelUser());
        Json.put(out, "port", getTunnelPort());
        Json.put(out, "remote_bind_address", getTunnelRemoteBindAddress());
        Json.put(out, "adb_transport", getAdbTransport());
        Json.put(out, "vm_adb_port", getTunnelVmAdbPort());
        Json.put(out, "remote_adb_port", getTunnelRemoteAdbPort());
        Json.put(out, "phone_adb_host", getTunnelPhoneAdbHost());
        Json.put(out, "phone_adb_port", getTunnelPhoneAdbPort());
        Json.put(out, "tls_enabled", isTunnelTlsEnabled());
        Json.put(out, "tls_server_name", getTunnelTlsServerName());
        Json.put(out, "strict_host_key_checking", isTunnelStrictHostKeyChecking());
        Json.put(out, "connect_timeout_ms", getTunnelConnectTimeoutMs());
        Json.put(out, "reconnect_delay_ms", getTunnelReconnectDelayMs());
        return out;
    }

    public void setAutoConnectEnabled(boolean enabled) {
        prefs.edit().putBoolean(AUTO_CONNECT, enabled).commit();
    }

    public void setAutostartEnabled(boolean enabled) {
        prefs.edit().putBoolean(AUTOSTART, enabled).commit();
    }

    public void saveTunnelSettings(JSONObject input) {
        SharedPreferences.Editor editor = prefs.edit();
        putBoolean(editor, input, "enabled", TUNNEL_ENABLED);
        putString(editor, input, "host", TUNNEL_HOST);
        putString(editor, input, "user", TUNNEL_USER);
        putInt(editor, input, "port", TUNNEL_PORT, 1, 65535);
        putString(editor, input, "remote_bind_address", TUNNEL_REMOTE_BIND);
        putInt(editor, input, "vm_adb_port", TUNNEL_REMOTE_ADB_PORT, 1, 65535);
        putInt(editor, input, "remote_adb_port", TUNNEL_REMOTE_ADB_PORT, 1, 65535);
        putString(editor, input, "phone_adb_host", TUNNEL_PHONE_ADB_HOST);
        putInt(editor, input, "phone_adb_port", TUNNEL_PHONE_ADB_PORT, 1, 65535);
        putString(editor, input, "adb_transport", ADB_TRANSPORT);
        putBoolean(editor, input, "tls_enabled", TUNNEL_TLS_ENABLED);
        putString(editor, input, "tls_server_name", TUNNEL_TLS_SERVER_NAME);
        putBoolean(editor, input, "strict_host_key_checking", TUNNEL_STRICT_HOST_KEY);
        putInt(editor, input, "connect_timeout_ms", TUNNEL_CONNECT_TIMEOUT_MS, 1000, 120000);
        putInt(editor, input, "reconnect_delay_ms", TUNNEL_RECONNECT_DELAY_MS, 1000, 300000);
        editor.commit();
    }

    public void save(String deviceId, String brokerUrl, String token) {
        prefs.edit()
                .putString(DEVICE_ID, nonEmpty(deviceId, getDeviceId()))
                .putString(BROKER_URL, nonEmpty(brokerUrl, getBrokerUrl()))
                .putString(TOKEN, nonEmpty(token, "dev-token"))
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
        JSONObject tunnel = input.optJSONObject("tunnel");
        if (tunnel != null) {
            saveTunnelSettings(tunnel);
        }
        SharedPreferences.Editor editor = prefs.edit();
        putString(editor, input, "pucky_turn_url", PUCKY_TURN_URL);
        putString(editor, input, "pucky_api_token", PUCKY_API_TOKEN);
        putString(editor, input, "ui_shell_mode", UI_SHELL_MODE);
        editor.commit();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", schema);
        Json.put(out, "device_id", getDeviceId());
        Json.put(out, "broker_url", getBrokerUrl());
        Json.put(out, "has_token", getToken() != null && !getToken().trim().isEmpty());
        Json.put(out, "tunnel", tunnelSettingsJson());
        return out;
    }

    private static String nonEmpty(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value.trim();
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
