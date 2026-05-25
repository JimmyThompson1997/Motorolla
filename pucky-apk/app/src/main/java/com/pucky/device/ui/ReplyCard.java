package com.pucky.device.ui;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class ReplyCard {
    private final String cardId;
    private final String turnId;
    private final String sessionId;
    private final String title;
    private final String tag;
    private final String summary;
    private final String transcript;
    private final String transcriptMessages;
    private final String createdAt;
    private final String updatedAt;
    private final String icon;
    private final String accent;
    private final String audioPath;
    private final String audioPlaylistPath;
    private final String audioTimestamps;
    private final String htmlPath;
    private final String images;
    private final String trace;
    private final String origin;
    private final boolean archived;
    private final boolean read;
    private final boolean deleted;

    public ReplyCard(
            String cardId,
            String turnId,
            String title,
            String sessionId,
            String tag,
            String summary,
            String transcript,
            String transcriptMessages,
            String createdAt,
            String updatedAt,
            String icon,
            String accent,
            String audioPath,
            String audioPlaylistPath,
            String audioTimestamps,
            String htmlPath,
            String images,
            String trace,
            String origin,
            boolean archived,
            boolean read,
            boolean deleted) throws CommandException {
        this.cardId = optional(cardId);
        this.turnId = optional(turnId);
        this.sessionId = optional(sessionId);
        this.title = required(title, "title");
        this.tag = optional(tag);
        this.summary = optional(summary);
        this.transcript = optional(transcript);
        this.transcriptMessages = optional(transcriptMessages);
        this.createdAt = optional(createdAt);
        this.updatedAt = optional(updatedAt);
        this.icon = optional(icon);
        this.accent = optional(accent);
        this.audioPath = optional(audioPath);
        this.audioPlaylistPath = optional(audioPlaylistPath);
        this.audioTimestamps = jsonArrayOrBlank(audioTimestamps, "audio_timestamps");
        this.htmlPath = optional(htmlPath);
        this.images = jsonArrayOrBlank(images, "images");
        this.trace = jsonObjectOrBlank(trace, "trace");
        this.origin = jsonObjectOrBlank(origin, "origin");
        this.archived = archived;
        this.read = read;
        this.deleted = deleted;
    }

    public static ReplyCard fromJson(JSONObject input) throws CommandException {
        if (input == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "reply card must be an object");
        }
        return new ReplyCard(
                input.optString("card_id", ""),
                input.optString("turn_id", ""),
                input.optString("title", ""),
                input.optString("session_id", ""),
                input.optString("tag", ""),
                input.optString("summary", ""),
                input.optString("transcript", input.optString("transcript_text", "")),
                jsonArrayString(input, "transcript_messages"),
                input.optString("created_at", ""),
                input.optString("updated_at", ""),
                input.optString("icon", ""),
                input.optString("accent", ""),
                input.optString("audio_path", ""),
                input.optString("audio_playlist_path", ""),
                jsonArrayString(input, "audio_timestamps"),
                input.optString("html_path", ""),
                jsonArrayString(input, "images"),
                jsonObjectString(input, "trace"),
                jsonObjectString(input, "origin"),
                input.optBoolean("archived", false),
                input.optBoolean("read", false),
                input.optBoolean("deleted", false));
    }

    public static List<ReplyCard> listFromJson(JSONArray input) throws CommandException {
        if (input == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "ui.reply_cards.set requires cards array");
        }
        List<ReplyCard> cards = new ArrayList<>();
        for (int index = 0; index < input.length(); index++) {
            JSONObject item = input.optJSONObject(index);
            if (item == null) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "reply card at index " + index + " must be an object");
            }
            cards.add(fromJson(item));
        }
        return Collections.unmodifiableList(cards);
    }

    public static JSONArray listToJson(List<ReplyCard> cards) {
        JSONArray out = new JSONArray();
        if (cards == null) {
            return out;
        }
        for (ReplyCard card : cards) {
            Json.add(out, card.toJson());
        }
        return out;
    }

    public JSONObject toJson() {
        JSONObject out = new JSONObject();
        putOptional(out, "card_id", cardId);
        putOptional(out, "turn_id", turnId);
        putOptional(out, "session_id", sessionId);
        Json.put(out, "title", title);
        putOptional(out, "tag", tag);
        putOptional(out, "summary", summary);
        putOptional(out, "transcript", transcript);
        if (!transcriptMessages.isEmpty()) {
            try {
                Json.put(out, "transcript_messages", new JSONArray(transcriptMessages));
            } catch (Exception ignored) {
                putOptional(out, "transcript_messages", transcriptMessages);
            }
        }
        putOptional(out, "created_at", createdAt);
        putOptional(out, "updated_at", updatedAt);
        putOptional(out, "icon", icon);
        putOptional(out, "accent", accent);
        putOptional(out, "audio_path", audioPath);
        putOptional(out, "audio_playlist_path", audioPlaylistPath);
        putOptionalJsonArray(out, "audio_timestamps", audioTimestamps);
        putOptional(out, "html_path", htmlPath);
        putOptionalJsonArray(out, "images", images);
        putOptionalJsonObject(out, "trace", trace);
        putOptionalJsonObject(out, "origin", origin);
        Json.put(out, "archived", archived);
        Json.put(out, "read", read);
        Json.put(out, "deleted", deleted);
        return out;
    }

    public String cardId() {
        return cardId;
    }

    public String turnId() {
        return turnId;
    }

    public String title() {
        return title;
    }

    public String sessionId() {
        return sessionId;
    }

    public String tag() {
        return tag;
    }

    public String summary() {
        return summary;
    }

    public String transcript() {
        return transcript;
    }

    public String transcriptMessages() {
        return transcriptMessages;
    }

    public String createdAt() {
        return createdAt;
    }

    public String updatedAt() {
        return updatedAt;
    }

    public String icon() {
        return icon;
    }

    public String accent() {
        return accent;
    }

    public String audioPath() {
        return audioPath;
    }

    public String audioPlaylistPath() {
        return audioPlaylistPath;
    }

    public String audioTimestamps() {
        return audioTimestamps;
    }

    public String htmlPath() {
        return htmlPath;
    }

    public String images() {
        return images;
    }

    public String trace() {
        return trace;
    }

    public String origin() {
        return origin;
    }

    public boolean archived() {
        return archived;
    }

    public boolean read() {
        return read;
    }

    public boolean deleted() {
        return deleted;
    }

    public boolean hasAudio() {
        return !audioPath.isEmpty() || !audioPlaylistPath.isEmpty();
    }

    public boolean hasTranscript() {
        return !transcript.isEmpty() || !transcriptMessages.isEmpty();
    }

    public boolean hasHtml() {
        return !htmlPath.isEmpty();
    }

    private static String required(String value, String field) throws CommandException {
        String trimmed = optional(value);
        if (trimmed.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "reply card requires non-empty " + field);
        }
        return trimmed;
    }

    private static String optional(String value) {
        return value == null ? "" : value.trim();
    }

    private static String jsonArrayString(JSONObject input, String key) throws CommandException {
        Object value = input.opt(key);
        if (value == null) {
            return "";
        }
        if (value instanceof JSONArray) {
            return value.toString();
        }
        if (value instanceof String) {
            return jsonArrayOrBlank((String) value, key);
        }
        throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                "reply card " + key + " must be an array");
    }

    private static String jsonObjectString(JSONObject input, String key) throws CommandException {
        Object value = input.opt(key);
        if (value == null) {
            return "";
        }
        if (value instanceof JSONObject) {
            return value.toString();
        }
        if (value instanceof String) {
            return jsonObjectOrBlank((String) value, key);
        }
        throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                "reply card " + key + " must be an object");
    }

    private static String jsonArrayOrBlank(String value, String field) throws CommandException {
        String trimmed = optional(value);
        if (trimmed.isEmpty()) {
            return "";
        }
        try {
            return new JSONArray(trimmed).toString();
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "reply card " + field + " must be valid JSON array");
        }
    }

    private static String jsonObjectOrBlank(String value, String field) throws CommandException {
        String trimmed = optional(value);
        if (trimmed.isEmpty()) {
            return "";
        }
        try {
            return new JSONObject(trimmed).toString();
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "reply card " + field + " must be valid JSON object");
        }
    }

    private static void putOptional(JSONObject out, String key, String value) {
        if (!value.isEmpty()) {
            Json.put(out, key, value);
        }
    }

    private static void putOptionalJsonArray(JSONObject out, String key, String value) {
        if (value.isEmpty()) {
            return;
        }
        try {
            Json.put(out, key, new JSONArray(value));
        } catch (Exception ignored) {
            putOptional(out, key, value);
        }
    }

    private static void putOptionalJsonObject(JSONObject out, String key, String value) {
        if (value.isEmpty()) {
            return;
        }
        try {
            Json.put(out, key, new JSONObject(value));
        } catch (Exception ignored) {
            putOptional(out, key, value);
        }
    }
}
