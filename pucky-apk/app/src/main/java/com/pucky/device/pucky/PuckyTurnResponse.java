package com.pucky.device.pucky;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;

import org.json.JSONObject;

import java.util.Base64;
import java.util.Locale;

public final class PuckyTurnResponse {
    private final String sessionId;
    private final String turnId;
    private final String text;
    private final String audioMimeType;
    private final String audioBase64;
    private final String cardTitle;
    private final String cardIcon;
    private final String htmlMimeType;
    private final String htmlBase64;
    private final JSONObject telemetry;

    private PuckyTurnResponse(String sessionId, String turnId, String text, String audioMimeType, String audioBase64,
                              String cardTitle, String cardIcon, String htmlMimeType, String htmlBase64,
                              JSONObject telemetry) {
        this.sessionId = sessionId;
        this.turnId = turnId;
        this.text = text;
        this.audioMimeType = audioMimeType;
        this.audioBase64 = audioBase64;
        this.cardTitle = cardTitle;
        this.cardIcon = cardIcon;
        this.htmlMimeType = htmlMimeType;
        this.htmlBase64 = htmlBase64;
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
        String audioMimeType = required(input.optString("audio_mime_type", ""), "audio_mime_type");
        String audioBase64 = required(input.optString("audio_base64", ""), "audio_base64");
        validateBase64(audioBase64, "audio_base64");
        JSONObject card = input.optJSONObject("card");
        String title = card == null ? "" : card.optString("title", "");
        if (title.trim().isEmpty()) {
            title = fallbackTitle(text);
        }
        String htmlMimeType = card == null ? "" : card.optString("html_mime_type", "");
        String htmlBase64 = card == null ? "" : card.optString("html_base64", "");
        if (!htmlBase64.trim().isEmpty()) {
            validateBase64(htmlBase64, "html_base64");
            if (htmlMimeType.trim().isEmpty()) {
                htmlMimeType = "text/html";
            }
        }
        String turnId = optional(input.optString("turn_id", ""));
        String sessionId = optional(input.optString("session_id", ""));
        if (sessionId.isEmpty()) {
            sessionId = turnId;
        }
        if (turnId.isEmpty()) {
            turnId = sessionId;
        }
        return new PuckyTurnResponse(
                sessionId,
                turnId,
                text,
                audioMimeType,
                audioBase64,
                title.trim(),
                normalizeIcon(card == null ? "" : card.optString("icon", "")),
                htmlMimeType.trim(),
                htmlBase64.trim(),
                input.optJSONObject("telemetry"));
    }

    public String sessionId() { return sessionId; }
    public String turnId() { return turnId; }
    public String text() { return text; }
    public String audioMimeType() { return audioMimeType; }
    public String cardTitle() { return cardTitle; }
    public String cardIcon() { return cardIcon; }
    public boolean hasHtml() { return !htmlBase64.isEmpty(); }
    public JSONObject telemetry() { return telemetry; }
    public byte[] audioBytes() { return Base64.getDecoder().decode(audioBase64); }
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
