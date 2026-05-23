package com.pucky.device.speech;

import java.util.Locale;

import org.json.JSONArray;
import org.json.JSONObject;

import com.pucky.device.util.Json;

public final class SpeechKeywordMatcher {
    private static final KeywordSpec[] KEYWORDS = new KeywordSpec[] {
            new KeywordSpec("hey_pucky", "hey pucky", "Hey Pucky recognized.",
                    3, new String[] {"hey pucky", "hey puppy", "hey lucky", "hay pucky",
                            "hey pocky", "hey packy", "pucky", "puppy", "pocky", "packy"}),
            new KeywordSpec("mic_on", "mic on", "Mic on recognized.",
                    2, new String[] {"mic on", "mike on", "microphone on"}),
            new KeywordSpec("mic_off", "mic off", "Mic off recognized.",
                    1, new String[] {"mic off", "mike off", "microphone off"})
    };

    private SpeechKeywordMatcher() {
    }

    public static Match match(String transcript) {
        return match(transcript, new JSONArray());
    }

    public static Match match(String transcript, JSONArray customEntries) {
        String normalized = normalize(transcript);
        Match best = Match.none(transcript, normalized);
        if (normalized.isEmpty()) {
            return best;
        }
        JSONArray entries = allEntries(customEntries);
        for (int entryIndex = 0; entryIndex < entries.length(); entryIndex++) {
            JSONObject entry = entries.optJSONObject(entryIndex);
            if (entry == null) {
                continue;
            }
            String id = entry.optString("id", "");
            String phrase = entry.optString("phrase", "");
            String replyText = entry.optString("reply_text", "");
            String errorReplyText = entry.optString("error_reply_text", "");
            boolean builtin = entry.optBoolean("builtin", false);
            int priority = entry.optInt("priority", builtin ? 100 : 1000 + entryIndex);
            JSONObject action = entry.optJSONObject("action");
            JSONArray aliases = entry.optJSONArray("phrases");
            if (id.isEmpty() || replyText.isEmpty() || aliases == null) {
                continue;
            }
            for (int aliasIndex = 0; aliasIndex < aliases.length(); aliasIndex++) {
                String alias = normalize(aliases.optString(aliasIndex, ""));
                if (!normalized.equals(alias)) {
                    continue;
                }
                boolean canonical = alias.equals(phrase);
                Match candidate = Match.found(
                        transcript,
                        normalized,
                        id,
                        phrase,
                        sourceFor(alias, phrase, builtin),
                        canonical || !builtin ? 1.0 : 0.85,
                        replyText,
                        errorReplyText,
                        action,
                        builtin,
                        0,
                        priority);
                if (!best.matched || candidate.isBetterThan(best)) {
                    best = candidate;
                }
            }
        }
        return best;
    }

    public static String normalize(String raw) {
        if (raw == null) {
            return "";
        }
        return raw.toLowerCase(Locale.US)
                .replaceAll("[^a-z0-9\\s]", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    public static JSONArray builtInEntries() {
        JSONArray out = new JSONArray();
        for (KeywordSpec keyword : KEYWORDS) {
            JSONObject entry = new JSONObject();
            Json.put(entry, "id", keyword.id);
            Json.put(entry, "phrase", keyword.phrase);
            Json.put(entry, "phrases", phrases(keyword.aliases));
            Json.put(entry, "reply_text", keyword.replyText);
            Json.put(entry, "builtin", true);
            Json.put(entry, "priority", keyword.priority);
            Json.add(out, entry);
        }
        return out;
    }

    private static JSONArray allEntries(JSONArray customEntries) {
        JSONArray out = builtInEntries();
        if (customEntries == null) {
            return out;
        }
        for (int i = 0; i < customEntries.length(); i++) {
            JSONObject entry = customEntries.optJSONObject(i);
            if (entry != null) {
                Json.add(out, entry);
            }
        }
        return out;
    }

    private static JSONArray phrases(String[] aliases) {
        JSONArray out = new JSONArray();
        for (String alias : aliases) {
            Json.add(out, alias);
        }
        return out;
    }

    private static String sourceFor(String alias, String phrase, boolean builtin) {
        if (!builtin) {
            return "custom:" + alias;
        }
        return alias.equals(phrase) ? "canonical" : "alias:" + alias;
    }

    public static final class Match {
        public final boolean matched;
        public final String rawTranscript;
        public final String normalizedTranscript;
        public final String id;
        public final String phrase;
        public final String source;
        public final double confidence;
        public final String replyText;
        public final String errorReplyText;
        public final JSONObject action;
        public final boolean builtin;
        public final int startIndex;
        private final int priority;

        private Match(
                boolean matched,
                String rawTranscript,
                String normalizedTranscript,
                String id,
                String phrase,
                String source,
                double confidence,
                String replyText,
                String errorReplyText,
                JSONObject action,
                boolean builtin,
                int startIndex,
                int priority) {
            this.matched = matched;
            this.rawTranscript = rawTranscript == null ? "" : rawTranscript;
            this.normalizedTranscript = normalizedTranscript == null ? "" : normalizedTranscript;
            this.id = id == null ? "" : id;
            this.phrase = phrase == null ? "" : phrase;
            this.source = source == null ? "" : source;
            this.confidence = confidence;
            this.replyText = replyText == null ? "" : replyText;
            this.errorReplyText = errorReplyText == null ? "" : errorReplyText;
            this.action = action;
            this.builtin = builtin;
            this.startIndex = startIndex;
            this.priority = priority;
        }

        private static Match none(String rawTranscript, String normalizedTranscript) {
            return new Match(false, rawTranscript, normalizedTranscript,
                    "", "", "none", 0.0, "", "", null, false, -1, Integer.MAX_VALUE);
        }

        private static Match found(
                String rawTranscript,
                String normalizedTranscript,
                String id,
                String phrase,
                String source,
                double confidence,
                String replyText,
                String errorReplyText,
                JSONObject action,
                boolean builtin,
                int startIndex,
                int priority) {
            return new Match(true, rawTranscript, normalizedTranscript,
                    id, phrase, source, confidence, replyText, errorReplyText, action, builtin, startIndex, priority);
        }

        public boolean hasAction() {
            return action != null && action.length() > 0;
        }

        private boolean isBetterThan(Match other) {
            if (startIndex != other.startIndex) {
                return startIndex < other.startIndex;
            }
            return priority < other.priority;
        }
    }

    private static final class KeywordSpec {
        private final String id;
        private final String phrase;
        private final String replyText;
        private final int priority;
        private final String[] aliases;

        private KeywordSpec(String id, String phrase, String replyText, int priority, String[] aliases) {
            this.id = id;
            this.phrase = phrase;
            this.replyText = replyText;
            this.priority = priority;
            this.aliases = aliases;
        }
    }
}
