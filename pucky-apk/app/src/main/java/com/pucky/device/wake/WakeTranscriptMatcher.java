package com.pucky.device.wake;

import com.pucky.device.speech.SpeechTextNormalizer;
import com.pucky.device.util.Json;

import org.json.JSONArray;

import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

public final class WakeTranscriptMatcher {
    private WakeTranscriptMatcher() {
    }

    public static JSONArray buildAlternatives(String transcript, JSONArray extras) {
        JSONArray out = new JSONArray();
        Set<String> seen = new LinkedHashSet<>();
        addCandidate(out, seen, transcript);
        if (extras != null) {
            for (int i = 0; i < extras.length(); i++) {
                addCandidate(out, seen, extras.optString(i, ""));
            }
        }
        return out;
    }

    public static String matchPartial(String transcript, JSONArray alternatives) {
        JSONArray combined = buildAlternatives(transcript, alternatives);
        for (int i = 0; i < combined.length(); i++) {
            String candidate = combined.optString(i, "");
            String matched = WakePhraseFamily.matchedPhrasePrefix(candidate);
            if (!matched.isEmpty() && matched.contains(" ")) {
                return matched;
            }
        }
        return "";
    }

    public static String matchFinal(String transcript, JSONArray alternatives) {
        JSONArray combined = buildAlternatives(transcript, alternatives);
        for (int i = 0; i < combined.length(); i++) {
            String candidate = combined.optString(i, "");
            String matched = WakePhraseFamily.matchedPhrasePrefix(candidate);
            if (!matched.isEmpty()) {
                return matched;
            }
        }
        return "";
    }

    private static void addCandidate(JSONArray out, Set<String> seen, String value) {
        String raw = value == null ? "" : value.trim();
        if (raw.isEmpty()) {
            return;
        }
        String normalized = SpeechTextNormalizer.normalize(raw).toLowerCase(Locale.US);
        String key = normalized.isEmpty() ? raw.toLowerCase(Locale.US) : normalized;
        if (!seen.add(key)) {
            return;
        }
        Json.add(out, raw);
    }
}
