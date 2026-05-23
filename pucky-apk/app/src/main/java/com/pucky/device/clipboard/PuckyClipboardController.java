package com.pucky.device.clipboard;

import android.content.Context;
import android.content.SharedPreferences;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.UUID;

public final class PuckyClipboardController {
    private static final String PREFS = "pucky_clipboard";
    private static final String ENTRIES = "entries_json";
    private static final int MAX_ENTRIES = 250;
    private static final long RETENTION_MS = 30L * 24L * 60L * 60L * 1000L;

    private static volatile PuckyClipboardController shared;

    private final SharedPreferences prefs;

    public static PuckyClipboardController shared(Context context) {
        PuckyClipboardController existing = shared;
        if (existing != null) {
            return existing;
        }
        synchronized (PuckyClipboardController.class) {
            if (shared == null) {
                shared = new PuckyClipboardController(context.getApplicationContext());
            }
            return shared;
        }
    }

    public PuckyClipboardController(Context context) {
        this.prefs = context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized JSONObject list(JSONObject args) {
        int limit = Math.max(1, Math.min(MAX_ENTRIES, args == null ? 50 : args.optInt("limit", 50)));
        JSONArray pruned = pruned(entriesJson(), Instant.now());
        save(pruned);
        JSONArray outEntries = new JSONArray();
        int start = Math.max(0, pruned.length() - limit);
        for (int i = start; i < pruned.length(); i++) {
            Json.add(outEntries, pruned.opt(i));
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.clipboard_list.v1");
        Json.put(out, "entries", outEntries);
        Json.put(out, "count", outEntries.length());
        Json.put(out, "total_count", pruned.length());
        Json.put(out, "max_entries", MAX_ENTRIES);
        Json.put(out, "retention_days", 30);
        Json.put(out, "store", "app_private_shared_preferences");
        Json.put(out, "android_system_clipboard", false);
        return out;
    }

    public synchronized JSONObject last() {
        JSONArray pruned = pruned(entriesJson(), Instant.now());
        save(pruned);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.clipboard_last.v1");
        Json.put(out, "entry", pruned.length() == 0 ? JSONObject.NULL : pruned.optJSONObject(pruned.length() - 1));
        Json.put(out, "found", pruned.length() > 0);
        return out;
    }

    public synchronized JSONObject read(JSONObject args) throws CommandException {
        String id = args == null ? "" : args.optString("entry_id", args.optString("id", "")).trim();
        if (id.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "pucky.clipboard.read requires entry_id");
        }
        JSONArray pruned = pruned(entriesJson(), Instant.now());
        save(pruned);
        for (int i = 0; i < pruned.length(); i++) {
            JSONObject entry = pruned.optJSONObject(i);
            if (entry != null && id.equals(entry.optString("entry_id", ""))) {
                JSONObject out = new JSONObject();
                Json.put(out, "schema", "pucky.clipboard_read.v1");
                Json.put(out, "found", true);
                Json.put(out, "entry", entry);
                return out;
            }
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.clipboard_read.v1");
        Json.put(out, "found", false);
        Json.put(out, "entry_id", id);
        return out;
    }

    public synchronized JSONObject delete(JSONObject args) throws CommandException {
        String id = args == null ? "" : args.optString("entry_id", args.optString("id", "")).trim();
        if (id.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "pucky.clipboard.delete requires entry_id");
        }
        JSONArray current = pruned(entriesJson(), Instant.now());
        JSONArray next = new JSONArray();
        JSONObject removed = null;
        for (int i = 0; i < current.length(); i++) {
            JSONObject entry = current.optJSONObject(i);
            if (entry != null && id.equals(entry.optString("entry_id", ""))) {
                removed = entry;
                continue;
            }
            Json.add(next, current.opt(i));
        }
        save(next);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.clipboard_delete.v1");
        Json.put(out, "entry_id", id);
        Json.put(out, "deleted", removed != null);
        Json.put(out, "entry", removed == null ? JSONObject.NULL : removed);
        Json.put(out, "total_count", next.length());
        return out;
    }

    public synchronized JSONObject clear() {
        int previous = entriesJson().length();
        save(new JSONArray());
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.clipboard_clear.v1");
        Json.put(out, "cleared", previous);
        Json.put(out, "total_count", 0);
        return out;
    }

    public synchronized JSONObject append(JSONObject rawEntry) {
        JSONObject entry = normalizeEntry(rawEntry);
        JSONArray current = pruned(entriesJson(), Instant.now());
        Json.add(current, entry);
        JSONArray next = trimToMax(current);
        save(next);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.clipboard_append.v1");
        Json.put(out, "saved", true);
        Json.put(out, "entry", entry);
        Json.put(out, "total_count", next.length());
        return out;
    }

    public static JSONObject entryFromLabSession(JSONObject session) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.clipboard_entry.v1");
        Json.put(out, "source", "volume_down_lab");
        Json.put(out, "session_id", session.optString("session_id", ""));
        Json.put(out, "raw_transcript", session.optString("keyword_raw_transcript",
                session.optString("final_transcript", "")));
        Json.put(out, "normalized_transcript", session.optString("keyword_normalized_transcript", ""));
        Json.put(out, "keyword_id", nullableString(session, "keyword_match_id"));
        Json.put(out, "keyword_phrase", nullableString(session, "keyword_match_phrase"));
        Json.put(out, "keyword_source", nullableString(session, "keyword_match_source"));
        Json.put(out, "match_strategy", session.optString("keyword_match_strategy", "exact_utterance"));
        Json.put(out, "action_command", nullableString(session, "keyword_action_command"));
        Json.put(out, "action_status", session.optString("keyword_action_status", "unknown"));
        Json.put(out, "action_result", session.opt("keyword_action_result"));
        Json.put(out, "action_error_code", nullableString(session, "keyword_action_error_code"));
        Json.put(out, "action_error_message", nullableString(session, "keyword_action_error_message"));
        Json.put(out, "artifacts", artifactsFromActionResult(session.optJSONObject("keyword_action_result")));
        JSONObject telemetry = new JSONObject();
        Json.put(telemetry, "route", session.opt("route"));
        Json.put(telemetry, "started_at", session.optString("started_at", ""));
        Json.put(telemetry, "ready_at", session.optString("ready_at", ""));
        Json.put(telemetry, "release_at", session.optString("release_at", ""));
        Json.put(telemetry, "completed_at", session.optString("completed_at", ""));
        Json.put(telemetry, "completed_elapsed_ms", session.optLong("completed_elapsed_ms", -1));
        Json.put(telemetry, "alternatives", session.opt("alternatives"));
        Json.put(telemetry, "confidence_scores", session.opt("confidence_scores"));
        Json.put(out, "telemetry", telemetry);
        return out;
    }

    private static JSONObject normalizeEntry(JSONObject raw) {
        JSONObject entry = raw == null ? new JSONObject() : raw;
        if (!entry.has("schema")) {
            Json.put(entry, "schema", "pucky.clipboard_entry.v1");
        }
        if (!entry.has("entry_id") || entry.optString("entry_id", "").trim().isEmpty()) {
            Json.put(entry, "entry_id", "clip_" + UUID.randomUUID().toString().replace("-", ""));
        }
        if (!entry.has("created_at") || entry.optString("created_at", "").trim().isEmpty()) {
            Json.put(entry, "created_at", Instant.now().toString());
        }
        if (!entry.has("android_system_clipboard")) {
            Json.put(entry, "android_system_clipboard", false);
        }
        return entry;
    }

    private JSONArray entriesJson() {
        try {
            return new JSONArray(prefs.getString(ENTRIES, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private void save(JSONArray entries) {
        prefs.edit().putString(ENTRIES, entries == null ? "[]" : entries.toString()).commit();
    }

    static JSONArray pruned(JSONArray entries, Instant now) {
        JSONArray bounded = trimToMax(entries == null ? new JSONArray() : entries);
        JSONArray out = new JSONArray();
        long cutoff = now.toEpochMilli() - RETENTION_MS;
        for (int i = 0; i < bounded.length(); i++) {
            JSONObject entry = bounded.optJSONObject(i);
            if (entry == null) {
                continue;
            }
            if (createdAtMillis(entry) < cutoff) {
                continue;
            }
            Json.add(out, entry);
        }
        return out;
    }

    private static JSONArray trimToMax(JSONArray entries) {
        JSONArray out = new JSONArray();
        int start = Math.max(0, entries.length() - MAX_ENTRIES);
        for (int i = start; i < entries.length(); i++) {
            Json.add(out, entries.opt(i));
        }
        return out;
    }

    private static long createdAtMillis(JSONObject entry) {
        try {
            return Instant.parse(entry.optString("created_at", "")).toEpochMilli();
        } catch (DateTimeParseException ignored) {
            return Instant.now().toEpochMilli();
        }
    }

    private static Object nullableString(JSONObject object, String key) {
        Object value = object.opt(key);
        if (value == null || JSONObject.NULL.equals(value)) {
            return JSONObject.NULL;
        }
        String text = String.valueOf(value);
        return text.trim().isEmpty() ? JSONObject.NULL : text;
    }

    private static JSONArray artifactsFromActionResult(JSONObject actionResult) {
        JSONArray artifacts = new JSONArray();
        if (actionResult == null) {
            return artifacts;
        }
        JSONObject result = actionResult.optJSONObject("result");
        if (result == null) {
            return artifacts;
        }
        JSONObject artifact = new JSONObject();
        String command = actionResult.optString("command", "");
        Json.put(artifact, "kind", artifactKind(command, result));
        Json.put(artifact, "mime_type", result.optString("mime_type", ""));
        Json.put(artifact, "private_path", result.optString("app_private_path", result.optString("path", "")));
        Json.put(artifact, "public_uri", result.optString("public_uri", result.optString("content_uri", "")));
        Json.put(artifact, "public_relative_path", result.optString("public_relative_path", result.optString("relative_path", "")));
        Json.put(artifact, "bytes", result.optLong("bytes", -1));
        if (!artifact.optString("private_path", "").isEmpty()
                || !artifact.optString("public_uri", "").isEmpty()
                || !artifact.optString("kind", "").isEmpty()) {
            Json.add(artifacts, artifact);
        }
        return artifacts;
    }

    private static String artifactKind(String command, JSONObject result) {
        if ("photo.capture".equals(command)) {
            return "photo";
        }
        if ("screenshot.capture".equals(command)) {
            return "screenshot";
        }
        if ("video.capture.start".equals(command) || "video.capture.stop".equals(command)) {
            return "video";
        }
        return result.optString("kind", "");
    }
}
