package com.pucky.device.pucky;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;

import org.json.JSONObject;

import java.util.Base64;
import java.util.Locale;

public final class PuckyTurnResponse {
    private final String cardId;
    private final String sessionId;
    private final String turnId;
    private final String text;
    private final String summary;
    private final String audioMimeType;
    private final String audioBase64;
    private final String cardTitle;
    private final String cardIcon;
    private final String htmlMimeType;
    private final String htmlBase64;
    private final String createdAt;
    private final String updatedAt;
    private final boolean archived;
    private final boolean read;
    private final boolean deleted;
    private final JSONObject telemetry;

    private PuckyTurnResponse(String cardId, String sessionId, String turnId, String text, String summary,
                              String audioMimeType, String audioBase64, String cardTitle, String cardIcon,
                              String htmlMimeType, String htmlBase64, String createdAt, String updatedAt,
                              boolean archived, boolean read, boolean deleted, JSONObject telemetry) {
        this.cardId = cardId;
        this.sessionId = sessionId;
        this.turnId = turnId;
        this.text = text;
        this.summary = summary;
        this.audioMimeType = audioMimeType;
        this.audioBase64 = audioBase64;
        this.cardTitle = cardTitle;
        this.cardIcon = cardIcon;
        this.htmlMimeType = htmlMimeType;
        this.htmlBase64 = htmlBase64;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.archived = archived;
        this.read = read;
        this.deleted = deleted;
        this.telemetry = telemetry == null ? new JSONObject() : telemetry;
    }

    public static PuckyTurnResponse fromJson(String raw) throws CommandException {
        try {
            return fromJson(new JSONObject(raw));
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "Invalid Pucky turn response JSON: " + exc.getMessage());
        }
    }

    public static PuckyTurnResponse fromJson(JSONObject input) throws CommandException {
        String text = required(input.optString("text", ""), "text");
        String audioMimeType = optional(input.optString("audio_mime_type", ""));
        String audioBase64 = optional(input.optString("audio_base64", ""));
        if (!audioBase64.isEmpty()) {
            validateBase64(audioBase64, "audio_base64");
            if (audioMimeType.isEmpty()) {
                audioMimeType = "audio/wav";
            }
        }
        JSONObject card = input.optJSONObject("card");
        String title = optional(input.optString("title", ""));
        if (title.isEmpty() && card != null) {
            title = card.optString("title", "");
        }
        if (title.trim().isEmpty()) {
            title = fallbackTitle(text);
        }
        String summary = optional(input.optString("summary", ""));
        if (summary.isEmpty() && card != null) {
            summary = optional(card.optString("summary", ""));
        }
        if (summary.isEmpty()) {
            summary = text;
        }
        String htmlMimeType = optional(input.optString("html_mime_type", ""));
        if (htmlMimeType.isEmpty() && card != null) {
            htmlMimeType = card.optString("html_mime_type", "");
        }
        String htmlBase64 = optional(input.optString("html_base64", ""));
        if (htmlBase64.isEmpty() && card != null) {
            htmlBase64 = card.optString("html_base64", "");
        }
        if (!htmlBase64.trim().isEmpty()) {
            validateBase64(htmlBase64, "html_base64");
            if (htmlMimeType.trim().isEmpty()) {
                htmlMimeType = "text/html";
            }
        }
        String createdAt = optional(input.optString("created_at", ""));
        String updatedAt = optional(input.optString("updated_at", createdAt));
        String turnId = optional(input.optString("turn_id", ""));
        String sessionId = optional(input.optString("session_id", ""));
        String cardId = optional(input.optString("card_id", ""));
        if (sessionId.isEmpty()) {
            sessionId = turnId;
        }
        if (turnId.isEmpty()) {
            turnId = sessionId;
        }
        return new PuckyTurnResponse(
                cardId,
                sessionId,
                turnId,
                text,
                summary,
                audioMimeType,
                audioBase64,
                title.trim(),
                normalizeIcon(optional(input.optString("icon", card == null ? "" : card.optString("icon", "")))),
                htmlMimeType.trim(),
                htmlBase64.trim(),
                createdAt,
                updatedAt,
                input.optBoolean("archived", card != null && card.optBoolean("archived", false)),
                input.optBoolean("read", card != null && card.optBoolean("read", false)),
                input.optBoolean("deleted", card != null && card.optBoolean("deleted", false)),
                input.optJSONObject("telemetry"));
    }

    public String cardId() { return cardId; }
    public String sessionId() { return sessionId; }
    public String turnId() { return turnId; }
    public String text() { return text; }
    public String summary() { return summary; }
    public String audioMimeType() { return audioMimeType; }
    public String cardTitle() { return cardTitle; }
    public String cardIcon() { return cardIcon; }
    public String createdAt() { return createdAt; }
    public String updatedAt() { return updatedAt; }
    public boolean archived() { return archived; }
    public boolean read() { return read; }
    public boolean deleted() { return deleted; }
    public boolean hasAudio() { return !audioBase64.isEmpty(); }
    public boolean hasHtml() { return !htmlBase64.isEmpty(); }
    public JSONObject telemetry() { return telemetry; }
    public byte[] audioBytes() { return audioBase64.isEmpty() ? new byte[0] : Base64.getDecoder().decode(audioBase64); }
    public byte[] htmlBytes() { return htmlBase64.isEmpty() ? new byte[0] : Base64.getDecoder().decode(htmlBase64); }

    private static String required(String value, String field) throws CommandException {
        String clean = optional(value);
        if (clean.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "Pucky turn response requires " + field);
        }
        return clean;
    }

    private static String optional(String value) {
        return value == null ? "" : value.trim();
    }

    private static void validateBase64(String value, String field) throws CommandException {
        try {
            Base64.getDecoder().decode(value);
        } catch (IllegalArgumentException exc) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "Pucky turn response " + field + " is not valid base64");
        }
    }

    private static String normalizeIcon(String raw) {
        String icon = optional(raw).toLowerCase(Locale.US);
        switch (icon) {
            case "clock":
            case "bolt":
            case "calendar":
            case "moon":
            case "mail":
                return icon;
            default:
                return "mail";
        }
    }

    private static String fallbackTitle(String text) {
        String clean = text == null ? "" : text.trim().replaceAll("\\s+", " ");
        if (clean.isEmpty()) {
            return "Pucky";
        }
        return clean.length() <= 64 ? clean : clean.substring(0, 64).trim();
    }
}
