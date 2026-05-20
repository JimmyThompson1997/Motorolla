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
    private final String title;
    private final String tag;
    private final String summary;
    private final String transcript;
    private final String icon;
    private final String accent;
    private final String audioPath;
    private final String htmlPath;

    public ReplyCard(
            String title,
            String tag,
            String summary,
            String transcript,
            String icon,
            String accent,
            String audioPath,
            String htmlPath) throws CommandException {
        this.title = required(title, "title");
        this.tag = optional(tag);
        this.summary = optional(summary);
        this.transcript = optional(transcript);
        this.icon = optional(icon);
        this.accent = optional(accent);
        this.audioPath = optional(audioPath);
        this.htmlPath = optional(htmlPath);
    }

    public static ReplyCard fromJson(JSONObject input) throws CommandException {
        if (input == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "reply card must be an object");
        }
        return new ReplyCard(
                input.optString("title", ""),
                input.optString("tag", ""),
                input.optString("summary", ""),
                input.optString("transcript", input.optString("transcript_text", "")),
                input.optString("icon", ""),
                input.optString("accent", ""),
                input.optString("audio_path", ""),
                input.optString("html_path", ""));
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
        Json.put(out, "title", title);
        putOptional(out, "tag", tag);
        putOptional(out, "summary", summary);
        putOptional(out, "transcript", transcript);
        putOptional(out, "icon", icon);
        putOptional(out, "accent", accent);
        putOptional(out, "audio_path", audioPath);
        putOptional(out, "html_path", htmlPath);
        return out;
    }

    public String title() {
        return title;
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

    public String icon() {
        return icon;
    }

    public String accent() {
        return accent;
    }

    public String audioPath() {
        return audioPath;
    }

    public String htmlPath() {
        return htmlPath;
    }

    public boolean hasAudio() {
        return !audioPath.isEmpty();
    }

    public boolean hasTranscript() {
        return !transcript.isEmpty();
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

    private static void putOptional(JSONObject out, String key, String value) {
        if (!value.isEmpty()) {
            Json.put(out, key, value);
        }
    }
}
