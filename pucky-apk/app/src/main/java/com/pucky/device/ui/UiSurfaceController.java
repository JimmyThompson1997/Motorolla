package com.pucky.device.ui;

import android.content.Context;
import android.content.SharedPreferences;

import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.time.Instant;

public final class UiSurfaceController {
    private static final String PREFS = "pucky_ui_surface";
    private static final String HOSTED_UI_PREFIX = "https://pucky.fly.dev/ui/pucky/latest/index.html";
    private static final String REQUESTED_URL = "requested_url";
    private static final String ACTIVE_URL = "active_url";
    private static final String REQUESTED_AT = "requested_at";
    private static final String LOADED_AT = "loaded_at";

    private final SharedPreferences prefs;

    public UiSurfaceController(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public void recordRequested(String requestedUrl, UiBundleController bundles) {
        prefs.edit()
                .putString(REQUESTED_URL, safe(requestedUrl))
                .putString(REQUESTED_AT, Instant.now().toString())
                .apply();
    }

    public void recordLoaded(String activeUrl, UiBundleController bundles) {
        prefs.edit()
                .putString(ACTIVE_URL, safe(activeUrl))
                .putString(LOADED_AT, Instant.now().toString())
                .apply();
    }

    public JSONObject status(UiBundleController bundles) {
        JSONObject bundle = bundles.status();
        JSONObject live = UiAutomationController.describe();
        String requestedUrl = prefs.getString(REQUESTED_URL, "");
        String activeUrl = prefs.getString(ACTIVE_URL, "");
        String entrypointUrl = bundle.optString("entrypoint_url", "");
        String fallbackAssetUrl = bundle.optString("fallback_asset_url", "");
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.ui_surface.v1");
        Json.put(out, "requested_url", requestedUrl);
        Json.put(out, "active_url", activeUrl);
        Json.put(out, "entrypoint_url", entrypointUrl);
        Json.put(out, "fallback_asset_url", fallbackAssetUrl);
        Json.put(out, "ui_version", live.optString("ui_version", bundle.optString("ui_version", "")));
        Json.put(out, "bundle_ui_version", bundle.optString("ui_version", ""));
        Json.put(out, "live_ui_version", live.optString("ui_version", ""));
        Json.put(out, "source_kind", sourceKind(activeUrl, requestedUrl, entrypointUrl, fallbackAssetUrl));
        Json.put(out, "requested_at", prefs.getString(REQUESTED_AT, ""));
        Json.put(out, "loaded_at", prefs.getString(LOADED_AT, ""));
        Json.put(out, "bridge_connected", true);
        Json.put(out, "route", live.optString("route", ""));
        Json.put(out, "detail", live.optJSONObject("detail") == null ? new JSONObject() : live.optJSONObject("detail"));
        Json.put(out, "focused_card", live.optJSONObject("focused_card") == null ? new JSONObject() : live.optJSONObject("focused_card"));
        Json.put(out, "thread_scope", live.optJSONObject("thread_scope") == null ? new JSONObject() : live.optJSONObject("thread_scope"));
        Json.put(out, "voice_status", live.optJSONObject("voice_status") == null ? new JSONObject() : live.optJSONObject("voice_status"));
        Json.put(out, "visible_cards", live.optJSONArray("visible_cards") == null ? new org.json.JSONArray() : live.optJSONArray("visible_cards"));
        Json.put(out, "ui_debug_available", live.optBoolean("ui_debug_available", false));
        Json.put(out, "ui_debug_error", live.optString("error", ""));
        return out;
    }

    private static String sourceKind(String activeUrl, String requestedUrl, String entrypointUrl, String fallbackAssetUrl) {
        String effectiveUrl = comparableUrl(!safe(activeUrl).isEmpty() ? safe(activeUrl) : safe(requestedUrl));
        String expectedEntrypoint = comparableUrl(entrypointUrl);
        String expectedFallback = comparableUrl(fallbackAssetUrl);
        if (!effectiveUrl.isEmpty() && effectiveUrl.equals(expectedEntrypoint)) {
            return "bundle_current";
        }
        if (!effectiveUrl.isEmpty() && effectiveUrl.equals(comparableUrl(HOSTED_UI_PREFIX))) {
            return "hosted_vm";
        }
        if (!effectiveUrl.isEmpty() && effectiveUrl.equals(expectedFallback)) {
            return "fallback_asset";
        }
        if (!effectiveUrl.isEmpty() && effectiveUrl.contains("/ui_bundles/previous/")) {
            return "bundle_previous";
        }
        return "legacy_placeholder";
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static String comparableUrl(String value) {
        String cleaned = safe(value);
        if (cleaned.isEmpty()) {
            return "";
        }
        int fragment = cleaned.indexOf('#');
        if (fragment >= 0) {
            cleaned = cleaned.substring(0, fragment);
        }
        int query = cleaned.indexOf('?');
        if (query >= 0) {
            cleaned = cleaned.substring(0, query);
        }
        return cleaned;
    }
}
