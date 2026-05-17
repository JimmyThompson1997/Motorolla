package com.pucky.device.ui;

import com.pucky.device.util.Json;

import org.json.JSONException;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class PuckyHomeState {
    public interface Listener {
        void onHomeStateChanged();
    }

    public static final String DEFAULT_EMOJI = "\uD83D\uDFE2";
    public static final String DEFAULT_LABEL = "Pucky";
    public static final String DEFAULT_SUBTITLE = "Rendered from the Vox VM";

    private final List<Listener> listeners = new ArrayList<>();
    private JSONObject state;

    public PuckyHomeState() {
        state = normalizedScreen(DEFAULT_EMOJI, DEFAULT_LABEL);
    }

    public synchronized JSONObject snapshot() {
        return copy(state);
    }

    public JSONObject render(JSONObject input) {
        JSONObject next;
        synchronized (this) {
            JSONObject screen = input.optJSONObject("screen");
            if (screen == null) {
                screen = input;
            }
            String emoji = screen.optString("emoji", DEFAULT_EMOJI);
            String label = screen.optString("label", DEFAULT_LABEL);
            String subtitle = screen.optString("subtitle", DEFAULT_SUBTITLE);
            next = normalizedScreen(emoji, label, subtitle);
            state = copy(next);
        }
        notifyListeners();
        return copy(next);
    }

    public synchronized void addListener(Listener listener) {
        if (listener != null && !listeners.contains(listener)) {
            listeners.add(listener);
        }
    }

    public synchronized void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    private void notifyListeners() {
        List<Listener> snapshot;
        synchronized (this) {
            snapshot = new ArrayList<>(listeners);
        }
        for (Listener listener : snapshot) {
            listener.onHomeStateChanged();
        }
    }

    private static JSONObject normalizedScreen(String emoji, String label) {
        return normalizedScreen(emoji, label, DEFAULT_SUBTITLE);
    }

    private static JSONObject normalizedScreen(String emoji, String label, String subtitle) {
        JSONObject screen = new JSONObject();
        Json.put(screen, "type", "emoji");
        Json.put(screen, "emoji", emoji == null || emoji.trim().isEmpty() ? DEFAULT_EMOJI : emoji);
        Json.put(screen, "label", label == null ? "" : label);
        Json.put(screen, "subtitle", subtitle == null ? "" : subtitle);

        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.home.v1");
        Json.put(out, "updated_at", Instant.now().toString());
        Json.put(out, "screen", screen);
        return out;
    }

    private static JSONObject copy(JSONObject object) {
        try {
            return new JSONObject(object.toString());
        } catch (JSONException e) {
            throw new IllegalStateException(e);
        }
    }
}
