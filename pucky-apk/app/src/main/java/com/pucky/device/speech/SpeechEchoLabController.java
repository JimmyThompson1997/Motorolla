package com.pucky.device.speech;

import android.content.Context;

import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

public final class SpeechEchoLabController {
    private static volatile SpeechEchoLabController shared;

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
    }

    public synchronized JSONObject status() {
        JSONObject out = reservedBase("pucky.speech_echo_lab_status.v1");
        Json.put(out, "state", "Idle");
        Json.put(out, "active_session", JSONObject.NULL);
        return out;
    }

    public synchronized JSONObject start(JSONObject args) {
        JSONObject out = reservedBase("pucky.speech_echo_lab_start.v1");
        Json.put(out, "result", "reserved_noop");
        Json.put(out, "state", "Idle");
        return out;
    }

    public synchronized JSONObject stop(JSONObject args) {
        JSONObject out = reservedBase("pucky.speech_echo_lab_stop.v1");
        Json.put(out, "result", "reserved_noop");
        Json.put(out, "state", "Idle");
        return out;
    }

    public synchronized JSONObject last(JSONObject args) {
        JSONObject out = reservedBase("pucky.speech_echo_lab_last.v1");
        Json.put(out, "session", JSONObject.NULL);
        Json.put(out, "found", false);
        return out;
    }

    public synchronized JSONObject list(JSONObject args) {
        JSONObject out = reservedBase("pucky.speech_echo_lab_list.v1");
        Json.put(out, "sessions", new JSONArray());
        Json.put(out, "count", 0);
        Json.put(out, "total_count", 0);
        return out;
    }

    private JSONObject reservedBase(String schema) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", schema);
        Json.put(out, "reserved", true);
        Json.put(out, "inactive", true);
        Json.put(out, "button_surface", "reserved");
        Json.put(out, "product_path", "volume_up_walkie_release_keyword_intercept");
        Json.put(out, "message", "Volume-down walkie lab is reserved. Product keyword interception now runs on volume-up release.");
        return out;
    }
}
