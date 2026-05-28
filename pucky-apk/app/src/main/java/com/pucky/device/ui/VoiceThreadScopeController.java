package com.pucky.device.ui;

import android.content.Context;
import android.content.SharedPreferences;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.time.Instant;

public final class VoiceThreadScopeController {
    private static final String PREFS = "pucky_voice_thread_scope";
    private static final String KEY_SCOPE = "scope_json";
    private static final String LABEL = "Talk to continue...";
    private static VoiceThreadScopeController shared;

    private final SharedPreferences prefs;

    public static synchronized VoiceThreadScopeController shared(Context context) {
        if (shared == null) {
            shared = new VoiceThreadScopeController(context.getApplicationContext());
        }
        return shared;
    }

    private VoiceThreadScopeController(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized JSONObject get() {
        JSONObject stored = readScope();
        if (!"existing_thread".equals(stored.optString("mode", ""))) {
            return newThreadScope();
        }
        return stored;
    }

    public synchronized JSONObject set(JSONObject args) throws CommandException {
        JSONObject normalized = normalize(args);
        prefs.edit().putString(KEY_SCOPE, normalized.toString()).apply();
        return normalized;
    }

    public synchronized JSONObject clear(JSONObject args) {
        prefs.edit().remove(KEY_SCOPE).apply();
        return newThreadScope();
    }

    private JSONObject normalize(JSONObject args) throws CommandException {
        String mode = String.valueOf(args == null ? "" : args.optString("mode", "")).trim();
        String threadId = String.valueOf(args == null ? "" : args.optString("thread_id", "")).trim();
        String sourceSurface = String.valueOf(args == null ? "" : args.optString("source_surface", "")).trim();
        String cardId = String.valueOf(args == null ? "" : args.optString("card_id", "")).trim();
        String sessionId = String.valueOf(args == null ? "" : args.optString("session_id", "")).trim();
        if (!"existing_thread".equals(mode) || threadId.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "voice.thread_scope.set requires mode=existing_thread and thread_id");
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.voice_thread_scope.v1");
        Json.put(out, "mode", "existing_thread");
        Json.put(out, "thread_id", threadId);
        Json.put(out, "card_id", cardId);
        Json.put(out, "session_id", sessionId);
        Json.put(out, "source_surface", sourceSurface);
        Json.put(out, "label", LABEL);
        Json.put(out, "updated_at", Instant.now().toString());
        Json.put(out, "active", true);
        return out;
    }

    private JSONObject readScope() {
        try {
            return new JSONObject(String.valueOf(prefs.getString(KEY_SCOPE, "{}")));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static JSONObject newThreadScope() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.voice_thread_scope.v1");
        Json.put(out, "mode", "new_thread");
        Json.put(out, "thread_id", "");
        Json.put(out, "card_id", "");
        Json.put(out, "session_id", "");
        Json.put(out, "source_surface", "");
        Json.put(out, "label", "");
        Json.put(out, "updated_at", Instant.now().toString());
        Json.put(out, "active", false);
        return out;
    }
}
