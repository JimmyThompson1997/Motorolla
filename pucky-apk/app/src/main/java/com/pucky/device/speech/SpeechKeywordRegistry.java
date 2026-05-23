package com.pucky.device.speech;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Iterator;
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
        return loadCustomDetailed(raw).entries;
    }

    public static LoadResult loadCustomDetailed(String raw) {
        JSONArray entries = new JSONArray();
        JSONArray invalid = new JSONArray();
        if (raw == null || raw.trim().isEmpty()) {
            return new LoadResult(entries, invalid, false, "");
        }
        JSONArray parsed;
        try {
            parsed = new JSONArray(raw);
        } catch (JSONException exc) {
            Json.add(invalid, invalidStoredEntry(-1, null, "Stored keyword registry is not a JSON array: " + exc.getMessage()));
            return new LoadResult(entries, invalid, true, exc.getMessage());
        }
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < parsed.length(); i++) {
            Object rawEntry = parsed.opt(i);
            if (!(rawEntry instanceof JSONObject)) {
                Json.add(invalid, invalidStoredEntry(i, rawEntry, "Stored keyword entry must be a JSON object"));
                continue;
            }
            JSONObject object = (JSONObject) rawEntry;
            try {
                JSONObject normalized = normalizeCustomEntry(object, entries);
                String id = normalized.optString("id", "");
                if (!ids.add(id)) {
                    throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                            "stored speech keyword id is duplicated: " + id);
                }
                Json.add(entries, normalized);
            } catch (CommandException exc) {
                Json.add(invalid, invalidStoredEntry(i, object, exc.getMessage()));
            }
        }
        return new LoadResult(entries, invalid, false, "");
    }

    public static JSONObject list(JSONArray customEntries) {
        return list(new LoadResult(customEntries == null ? new JSONArray() : customEntries,
                new JSONArray(), false, ""));
    }

    public static JSONObject list(LoadResult loadResult) {
        LoadResult safe = loadResult == null
                ? new LoadResult(new JSONArray(), new JSONArray(), false, "")
                : loadResult;
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_keyword_list.v1");
        Json.put(out, "match_strategy", "exact_utterance");
        Json.put(out, "builtins", SpeechKeywordMatcher.builtInEntries());
        Json.put(out, "custom", safe.entries);
        Json.put(out, "custom_count", safe.entries.length());
        Json.put(out, "invalid_custom_entries", safe.invalidEntries);
        Json.put(out, "invalid_custom_entries_count", safe.invalidEntries.length());
        Json.put(out, "stored_parse_error", safe.parseError);
        Json.put(out, "stored_parse_error_message", safe.parseErrorMessage.isEmpty()
                ? JSONObject.NULL
                : safe.parseErrorMessage);
        Json.put(out, "schema_help", schemaGuide());
        return out;
    }

    public static JSONObject schemaGuide() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_keyword_schema.v1");
        Json.put(out, "command", "speech.echo.lab.keyword.set");
        Json.put(out, "accepted_request_shapes", requestShapes());
        Json.put(out, "matching_rule", "exact_utterance_only");
        Json.put(out, "matching_rule_note",
                "The whole normalized transcript must equal one configured phrase; longer sentences are intentionally ignored.");
        Json.put(out, "required_fields", requiredFields());
        Json.put(out, "allowed_actions", allowedActions());
        Json.put(out, "example", exampleKeyword());
        Json.put(out, "notes", notes());
        return out;
    }

    public static JSONObject validationError(String operation, CommandException exc, JSONObject input) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_keyword_validation_error.v1");
        Json.put(out, "operation", operation == null || operation.trim().isEmpty()
                ? "speech.echo.lab.keyword.set"
                : operation);
        Json.put(out, "saved", false);
        Json.put(out, "error_code", exc == null ? CommandErrorCodes.MALFORMED_COMMAND : exc.code());
        Json.put(out, "error_message", exc == null ? "speech keyword validation failed" : exc.getMessage());
        Json.put(out, "keyword", input == null ? JSONObject.NULL : input);
        Json.put(out, "schema_help", schemaGuide());
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

    private static JSONObject invalidStoredEntry(int index, Object rawEntry, String reason) {
        JSONObject out = new JSONObject();
        Json.put(out, "index", index);
        Json.put(out, "reason", reason == null || reason.trim().isEmpty() ? "invalid stored keyword entry" : reason);
        if (rawEntry instanceof JSONObject) {
            JSONObject object = (JSONObject) rawEntry;
            Json.put(out, "id", object.optString("id", JSONObject.NULL.toString()));
            Json.put(out, "keys", objectKeys(object));
        } else if (rawEntry != null) {
            Json.put(out, "raw_type", rawEntry.getClass().getSimpleName());
        } else {
            Json.put(out, "raw_type", JSONObject.NULL);
        }
        return out;
    }

    private static JSONArray objectKeys(JSONObject object) {
        JSONArray out = new JSONArray();
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) {
            Json.add(out, keys.next());
        }
        return out;
    }

    private static JSONArray requestShapes() {
        JSONArray out = new JSONArray();
        Json.add(out, "direct_keyword_object");
        Json.add(out, "wrapped_as_{\"keyword\":{...}}");
        return out;
    }

    private static JSONArray requiredFields() {
        JSONArray out = new JSONArray();
        Json.add(out, "id: lowercase id matching [a-z0-9_-]{1,64}");
        Json.add(out, "phrases: 1..12 exact spoken phrases");
        Json.add(out, "reply_text: Android TTS text for matched keyword when action is not chime-only");
        Json.add(out, "action.command: one allowlisted command");
        Json.add(out, "action.args: JSON object only; omit or use {} when no args are needed");
        return out;
    }

    private static JSONArray allowedActions() {
        JSONArray out = new JSONArray();
        Json.add(out, actionSpec(SpeechKeywordActionExecutor.COMMAND_TORCH_SET,
                "Flashlight burst only; enabled is forced true; auto_off_ms 100..1500, default 600."));
        Json.add(out, actionSpec(SpeechKeywordActionExecutor.COMMAND_PHOTO_CAPTURE,
                "Capture JPEG; max_width 320..1920 default 1280; timeout_ms 1000..15000 default 8000."));
        Json.add(out, actionSpec(SpeechKeywordActionExecutor.COMMAND_LOCATION_PIN,
                "Pin current or last-known location; timeout_ms defaults to 4000; publish defaults false."));
        Json.add(out, actionSpec(SpeechKeywordActionExecutor.COMMAND_SCREENSHOT_CAPTURE,
                "Capture screen through Pucky AccessibilityService; publish defaults true."));
        Json.add(out, actionSpec(SpeechKeywordActionExecutor.COMMAND_VIDEO_CAPTURE_START,
                "Start silent video capture; max_duration_ms 5000..300000 default 60000."));
        Json.add(out, actionSpec(SpeechKeywordActionExecutor.COMMAND_VIDEO_CAPTURE_STOP,
                "Stop active silent video capture; args must be omitted or {}."));
        return out;
    }

    private static JSONObject actionSpec(String command, String note) {
        JSONObject out = new JSONObject();
        Json.put(out, "command", command);
        Json.put(out, "note", note);
        return out;
    }

    private static JSONObject exampleKeyword() {
        JSONObject args = new JSONObject();
        Json.put(args, "publish", true);
        JSONObject action = new JSONObject();
        Json.put(action, "command", SpeechKeywordActionExecutor.COMMAND_SCREENSHOT_CAPTURE);
        Json.put(action, "args", args);
        JSONObject out = new JSONObject();
        Json.put(out, "id", "screenshot");
        Json.put(out, "phrases", examplePhrases());
        Json.put(out, "reply_text", "Screenshot captured.");
        Json.put(out, "error_reply_text", "Screenshot failed.");
        Json.put(out, "action", action);
        return out;
    }

    private static JSONArray examplePhrases() {
        JSONArray out = new JSONArray();
        Json.add(out, "screenshot");
        Json.add(out, "screen shot");
        Json.add(out, "capture screen");
        return out;
    }

    private static JSONArray notes() {
        JSONArray out = new JSONArray();
        Json.add(out, "Use exact short command phrases only; do not configure natural-language sentence matching here.");
        Json.add(out, "action.args must be a JSON object. Arrays, strings, and PowerShell DictionaryEntry/Count/value shapes are rejected.");
        Json.add(out, "Built-in keywords cannot be overwritten, and duplicate normalized phrases are rejected.");
        Json.add(out, "Matched keyword actions are volume-down lab only and are recorded to Pucky Clipboard.");
        return out;
    }

    public static final class LoadResult {
        public final JSONArray entries;
        public final JSONArray invalidEntries;
        public final boolean parseError;
        public final String parseErrorMessage;

        private LoadResult(JSONArray entries, JSONArray invalidEntries, boolean parseError, String parseErrorMessage) {
            this.entries = entries == null ? new JSONArray() : entries;
            this.invalidEntries = invalidEntries == null ? new JSONArray() : invalidEntries;
            this.parseError = parseError;
            this.parseErrorMessage = parseErrorMessage == null ? "" : parseErrorMessage;
        }
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
