package com.pucky.device.ui;

import android.os.Looper;
import android.webkit.WebView;

import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class UiAutomationController {
    private static final long DEFAULT_TIMEOUT_MS = 4_000L;
    private static WeakReference<WebView> activeWebView = new WeakReference<>(null);

    private UiAutomationController() {
    }

    public static synchronized void attach(WebView webView) {
        activeWebView = new WeakReference<>(webView);
    }

    public static synchronized void detach(WebView webView) {
        WebView current = activeWebView.get();
        if (current == webView) {
            activeWebView = new WeakReference<>(null);
        }
    }

    public static JSONObject describe() {
        JSONObject result = evaluate(describeScript(), "pucky.ui_surface.v1");
        if (!result.has("ui_debug_available")) {
            Json.put(result, "ui_debug_available", result.optBoolean("ok", true));
        }
        return result;
    }

    public static JSONObject dispatch(String action, JSONObject args) {
        JSONObject payload = args == null ? new JSONObject() : args;
        return evaluate(dispatchScript(action, payload), "pucky.ui_debug_action.v1");
    }

    private static JSONObject evaluate(String script, String schema) {
        WebView webView = activeWebView();
        if (webView == null) {
            return unavailable(schema, "webview_unavailable");
        }
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> resultRef = new AtomicReference<>("");
        webView.post(() -> webView.evaluateJavascript(script, value -> {
            resultRef.set(value);
            latch.countDown();
        }));
        try {
            if (!latch.await(DEFAULT_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                return unavailable(schema, "webview_timeout");
            }
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            return unavailable(schema, "webview_interrupted");
        }
        String decoded = decodeJavascriptResult(resultRef.get());
        if (decoded.isEmpty()) {
            return unavailable(schema, "empty_js_result");
        }
        try {
            JSONObject out = new JSONObject(decoded);
            if (!out.has("schema")) {
                Json.put(out, "schema", schema);
            }
            return out;
        } catch (Exception exc) {
            JSONObject out = unavailable(schema, "invalid_js_result");
            Json.put(out, "raw", decoded);
            return out;
        }
    }

    private static synchronized WebView activeWebView() {
        return activeWebView.get();
    }

    private static String describeScript() {
        return "(function(){try{var result=(window.PuckyUiDebug&&window.PuckyUiDebug.describe)?window.PuckyUiDebug.describe():{schema:\"pucky.ui_surface.v1\",ui_debug_available:false,error:\"PuckyUiDebug missing\"};return JSON.stringify(result||{});}catch(e){return JSON.stringify({schema:\"pucky.ui_surface.v1\",ui_debug_available:false,error:String((e&&e.message)||e)});}})();";
    }

    private static String dispatchScript(String action, JSONObject args) {
        return "(function(){try{var payload=" + args.toString() + ";var result=(window.PuckyUiDebug&&window.PuckyUiDebug.dispatch)?window.PuckyUiDebug.dispatch("
                + JSONObject.quote(action) + ",payload):{schema:\"pucky.ui_debug_action.v1\",ok:false,action:" + JSONObject.quote(action)
                + ",handled:false,error:\"PuckyUiDebug missing\"};return JSON.stringify(result||{});}catch(e){return JSON.stringify({schema:\"pucky.ui_debug_action.v1\",ok:false,action:"
                + JSONObject.quote(action) + ",handled:false,error:String((e&&e.message)||e)});}})();";
    }

    private static JSONObject unavailable(String schema, String error) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", schema);
        Json.put(out, "ok", false);
        Json.put(out, "ui_debug_available", false);
        Json.put(out, "error", error);
        return out;
    }

    private static String decodeJavascriptResult(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty() || "null".equals(value)) {
            return "";
        }
        if (value.startsWith("\"")) {
            try {
                return new JSONArray("[" + value + "]").getString(0);
            } catch (Exception ignored) {
                return value;
            }
        }
        return value;
    }
}
