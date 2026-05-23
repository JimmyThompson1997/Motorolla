package com.pucky.device.speech;

import java.util.Locale;

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
        String normalized = normalize(transcript);
        Match best = Match.none(transcript, normalized);
        if (normalized.isEmpty()) {
            return best;
        }
        for (KeywordSpec keyword : KEYWORDS) {
            for (String alias : keyword.aliases) {
                if (!normalized.equals(alias)) {
                    continue;
                }
                boolean canonical = alias.equals(keyword.phrase);
                Match candidate = Match.found(
                        transcript,
                        normalized,
                        keyword.id,
                        keyword.phrase,
                        canonical ? "canonical" : "alias:" + alias,
                        canonical ? 1.0 : 0.85,
                        keyword.replyText,
                        0,
                        keyword.priority);
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

    public static final class Match {
        public final boolean matched;
        public final String rawTranscript;
        public final String normalizedTranscript;
        public final String id;
        public final String phrase;
        public final String source;
        public final double confidence;
        public final String replyText;
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
            this.startIndex = startIndex;
            this.priority = priority;
        }

        private static Match none(String rawTranscript, String normalizedTranscript) {
            return new Match(false, rawTranscript, normalizedTranscript,
                    "", "", "none", 0.0, "", -1, Integer.MAX_VALUE);
        }

        private static Match found(
                String rawTranscript,
                String normalizedTranscript,
                String id,
                String phrase,
                String source,
                double confidence,
                String replyText,
                int startIndex,
                int priority) {
            return new Match(true, rawTranscript, normalizedTranscript,
                    id, phrase, source, confidence, replyText, startIndex, priority);
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
