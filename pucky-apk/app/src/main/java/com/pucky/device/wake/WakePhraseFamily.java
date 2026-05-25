package com.pucky.device.wake;

import com.pucky.device.speech.SpeechTextNormalizer;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

public final class WakePhraseFamily {
    public static final String ID = "hey_pucky";

    private static final String[] PHRASES = new String[] {
            "hey pucky",
            "hey puppy",
            "hey lucky",
            "hay pucky",
            "hey pocky",
            "hey packy",
            "pucky",
            "puppy",
            "pocky",
            "packy"
    };

    private static final Set<String> NORMALIZED = buildNormalized();

    private WakePhraseFamily() {
    }

    public static boolean matches(String transcript) {
        return !matchedPhrase(transcript).isEmpty();
    }

    public static String matchedPhrase(String transcript) {
        String normalized = SpeechTextNormalizer.normalize(transcript);
        return NORMALIZED.contains(normalized) ? normalized : "";
    }

    public static boolean isSingleWordVariant(String transcript) {
        String phrase = matchedPhrase(transcript);
        return !phrase.isEmpty() && !phrase.contains(" ");
    }

    public static JSONArray phrasesJson() {
        JSONArray out = new JSONArray();
        for (String phrase : PHRASES) {
            Json.add(out, phrase);
        }
        return out;
    }

    public static JSONObject statusJson() {
        JSONObject out = new JSONObject();
        Json.put(out, "id", ID);
        Json.put(out, "canonical_phrase", "Hey Pucky");
        Json.put(out, "accepted_phrases", phrasesJson());
        Json.put(out, "single_word_variants", singleWordVariants());
        return out;
    }

    private static JSONArray singleWordVariants() {
        JSONArray out = new JSONArray();
        for (String phrase : PHRASES) {
            String normalized = SpeechTextNormalizer.normalize(phrase);
            if (!normalized.contains(" ")) {
                Json.add(out, normalized);
            }
        }
        return out;
    }

    private static Set<String> buildNormalized() {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        for (String phrase : PHRASES) {
            String normalized = SpeechTextNormalizer.normalize(phrase).toLowerCase(Locale.US);
            if (!normalized.isEmpty()) {
                out.add(normalized);
            }
        }
        return out;
    }
}
