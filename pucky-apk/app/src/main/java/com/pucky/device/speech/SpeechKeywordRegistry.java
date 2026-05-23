package com.pucky.device.speech;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

public final class SpeechKeywordRegistry {
    public static final String PREF_CUSTOM_KEYWORDS = "keyword_actions_json";
    private static final int MAX_CUSTOM_KEYWORDS = 50;
    private static final int MAX_PHRASES_PER_KEYWORD = 12;

    private SpeechKeywordRegistry() {
    }

    public static JSONArray loadCustom(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new JSONArray();
        }
        try {
            return new JSONArray(raw);
        } catch (JSONException exc) {
            return new JSONArray();
        }
    }

    public static JSONObject list(JSONArray customEntries) {
        JSONArray custom = customEntries == null ? new JSONArray() : customEntries;
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_keyword_list.v1");
        Json.put(out, "match_strategy", "exact_utterance");
        Json.put(out, "builtins", SpeechKeywordMatcher.builtInEntries());
        Json.put(out, "custom", custom);
        Json.put(out, "custom_count", custom.length());
        return out;
    }

    public static SetResult set(JSONArray currentCustom, JSONObject input) throws CommandException {
        JSONArray current = currentCustom == null ? new JSONArray() : currentCustom;
        JSONObject entry = normalizeCustomEntry(input, current);
        JSONArray next = new JSONArray();
        boolean replaced = false;
        String id = entry.optString("id", "");
        for (int i = 0; i < current.length(); i++) {
            JSONObject existing = current.optJSONObject(i);
            if (existing == null) {
                continue;
            }
            if (id.equals(existing.optString("id", ""))) {
                replaced = true;
                continue;
            }
            Json.add(next, existing);
        }
        if (!replaced && next.length() >= MAX_CUSTOM_KEYWORDS) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "Too many custom speech keywords");
        }
        Json.add(next, entry);
        return new SetResult(entry, next, replaced);
    }

    public static DeleteResult delete(JSONArray currentCustom, String rawId) throws CommandException {
        String id = normalizeId(rawId);
        JSONArray current = currentCustom == null ? new JSONArray() : currentCustom;
        JSONArray next = new JSONArray();
        JSONObject removed = null;
        for (int i = 0; i < current.length(); i++) {
            JSONObject existing = current.optJSONObject(i);
            if (existing == null) {
                continue;
            }
            if (id.equals(existing.optString("id", ""))) {
                removed = existing;
                continue;
            }
            Json.add(next, existing);
        }
        return new DeleteResult(removed, next);
    }

    public static SpeechKeywordMatcher.Match match(String transcript, JSONArray customEntries) {
        return SpeechKeywordMatcher.match(transcript, customEntries == null ? new JSONArray() : customEntries);
    }

    public static JSONObject matchJson(SpeechKeywordMatcher.Match match) {
        JSONObject out = new JSONObject();
        Json.put(out, "matched", match.matched);
        Json.put(out, "raw_transcript", match.rawTranscript);
        Json.put(out, "normalized_transcript", match.normalizedTranscript);
        Json.put(out, "match_strategy", "exact_utterance");
        Json.put(out, "id", match.matched ? match.id : JSONObject.NULL);
        Json.put(out, "phrase", match.matched ? match.phrase : JSONObject.NULL);
        Json.put(out, "source", match.source);
        Json.put(out, "confidence", match.confidence);
        Json.put(out, "reply_text", match.matched ? match.replyText : JSONObject.NULL);
        Json.put(out, "builtin", match.matched ? match.builtin : JSONObject.NULL);
        Json.put(out, "action", match.hasAction() ? match.action : JSONObject.NULL);
        return out;
    }

    private static JSONObject normalizeCustomEntry(JSONObject input, JSONArray currentCustom) throws CommandException {
        if (input == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "speech keyword set requires keyword object");
        }
        String id = normalizeId(input.optString("id", ""));
        if (builtInIds().contains(id)) {
            throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED,
                    "Built-in speech keywords cannot be overwritten");
        }
        JSONArray phrases = normalizePhrases(input);
        rejectDuplicatePhrases(id, phrases, currentCustom);
        JSONObject action = SpeechKeywordActionExecutor.sanitize(input.optJSONObject("action"));
        JSONObject out = new JSONObject();
        Json.put(out, "id", id);
        Json.put(out, "phrase", phrases.optString(0));
        Json.put(out, "phrases", phrases);
        Json.put(out, "reply_text", replyText(input, id));
        String errorReplyText = input.optString("error_reply_text", "").trim();
        if (!errorReplyText.isEmpty()) {
            Json.put(out, "error_reply_text", errorReplyText);
        }
        Json.put(out, "builtin", false);
        Json.put(out, "action", action);
        return out;
    }

    private static String normalizeId(String raw) throws CommandException {
        String id = raw == null ? "" : raw.trim().toLowerCase(Locale.US);
        if (id.isEmpty() || !id.matches("[a-z0-9_-]{1,64}")) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "speech keyword id must match [a-z0-9_-]{1,64}");
        }
        return id;
    }

    private static JSONArray normalizePhrases(JSONObject input) throws CommandException {
        JSONArray raw = input.optJSONArray("phrases");
        if (raw == null && input.has("phrase")) {
            raw = new JSONArray();
            Json.add(raw, input.optString("phrase", ""));
        }
        if (raw == null || raw.length() == 0 || raw.length() > MAX_PHRASES_PER_KEYWORD) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "speech keyword phrases must contain 1..12 phrases");
        }
        LinkedHashSet<String> phrases = new LinkedHashSet<>();
        for (int i = 0; i < raw.length(); i++) {
            String normalized = SpeechKeywordMatcher.normalize(raw.optString(i, ""));
            if (normalized.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "speech keyword phrases cannot be empty");
            }
            if (!phrases.add(normalized)) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "speech keyword phrases cannot be duplicated: " + normalized);
            }
        }
        JSONArray out = new JSONArray();
        for (String phrase : phrases) {
            Json.add(out, phrase);
        }
        return out;
    }

    private static void rejectDuplicatePhrases(String id, JSONArray phrases, JSONArray currentCustom)
            throws CommandException {
        Set<String> reserved = new HashSet<>();
        addReservedPhrases(reserved, SpeechKeywordMatcher.builtInEntries(), "");
        addReservedPhrases(reserved, currentCustom == null ? new JSONArray() : currentCustom, id);
        for (int i = 0; i < phrases.length(); i++) {
            String phrase = phrases.optString(i, "");
            if (reserved.contains(phrase)) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "speech keyword phrase duplicates existing phrase: " + phrase);
            }
        }
    }

    private static void addReservedPhrases(Set<String> out, JSONArray entries, String skipId) {
        for (int i = 0; i < entries.length(); i++) {
            JSONObject entry = entries.optJSONObject(i);
            if (entry == null || skipId.equals(entry.optString("id", ""))) {
                continue;
            }
            JSONArray phrases = entry.optJSONArray("phrases");
            if (phrases == null) {
                continue;
            }
            for (int j = 0; j < phrases.length(); j++) {
                out.add(SpeechKeywordMatcher.normalize(phrases.optString(j, "")));
            }
        }
    }

    private static Set<String> builtInIds() {
        Set<String> ids = new HashSet<>();
        JSONArray builtins = SpeechKeywordMatcher.builtInEntries();
        for (int i = 0; i < builtins.length(); i++) {
            JSONObject item = builtins.optJSONObject(i);
            if (item != null) {
                ids.add(item.optString("id", ""));
            }
        }
        return ids;
    }

    private static String replyText(JSONObject input, String id) {
        String reply = input.optString("reply_text", "").trim();
        if (!reply.isEmpty()) {
            return reply;
        }
        return title(id) + " recognized.";
    }

    private static String title(String id) {
        String cleaned = id.replace('_', ' ').replace('-', ' ').trim();
        if (cleaned.isEmpty()) {
            return "Keyword";
        }
        return cleaned.substring(0, 1).toUpperCase(Locale.US) + cleaned.substring(1);
    }

    public static final class SetResult {
        public final JSONObject entry;
        public final JSONArray entries;
        public final boolean replaced;

        private SetResult(JSONObject entry, JSONArray entries, boolean replaced) {
            this.entry = entry;
            this.entries = entries;
            this.replaced = replaced;
        }
    }

    public static final class DeleteResult {
        public final JSONObject removed;
        public final JSONArray entries;

        private DeleteResult(JSONObject removed, JSONArray entries) {
            this.removed = removed;
            this.entries = entries;
        }
    }
}
