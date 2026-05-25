package com.pucky.device.wake;

import com.pucky.device.speech.SpeechTextNormalizer;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

public final class WakePhraseFamily {
    public static final String ID = "hey_pucky";

    private static final String[] CANONICAL_PHRASES = new String[] {
            "hey pucky",
            "hey puppy",
            "hey lucky",
            "hay pucky",
            "hey pocky",
            "hey packy",
            "hey pookie",
            "hey pokey",
            "hey bucky",
            "pucky",
            "puppy",
            "pocky",
            "packy",
            "pookie",
            "pokey",
            "bucky"
    };

    private static final String[][] RECOGNIZED_VARIANTS = new String[][] {
            {"hey pucky", "hey pucky"},
            {"hey puppy", "hey puppy"},
            {"hey lucky", "hey lucky"},
            {"hay pucky", "hay pucky"},
            {"hey pocky", "hey pocky"},
            {"hey packy", "hey packy"},
            {"hey pookie", "hey pookie"},
            {"hey pokey", "hey pokey"},
            {"hey bucky", "hey bucky"},
            {"pucky", "pucky"},
            {"puppy", "puppy"},
            {"pocky", "pocky"},
            {"packy", "packy"},
            {"pookie", "pookie"},
            {"pokey", "pokey"},
            {"bucky", "bucky"},
            {"hey pucking", "hey pucky"},
            {"pucking", "pucky"},
            {"hey pooking", "hey pookie"},
            {"pooking", "pookie"}
    };

    private static final Map<String, String> NORMALIZED = buildNormalized();

    private WakePhraseFamily() {
    }

    public static boolean matches(String transcript) {
        return !matchedPhrase(transcript).isEmpty();
    }

    public static String matchedPhrase(String transcript) {
        String normalized = SpeechTextNormalizer.normalize(transcript);
        String matched = NORMALIZED.get(normalized);
        return matched == null ? "" : matched;
    }

    public static boolean isSingleWordVariant(String transcript) {
        String phrase = matchedPhrase(transcript);
        return !phrase.isEmpty() && !phrase.contains(" ");
    }

    public static JSONArray phrasesJson() {
        JSONArray out = new JSONArray();
        for (String[] variant : RECOGNIZED_VARIANTS) {
            Json.add(out, variant[0]);
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
        for (String phrase : CANONICAL_PHRASES) {
            String normalized = SpeechTextNormalizer.normalize(phrase);
            if (!normalized.contains(" ")) {
                Json.add(out, normalized);
            }
        }
        return out;
    }

    private static Map<String, String> buildNormalized() {
        LinkedHashMap<String, String> out = new LinkedHashMap<>();
        for (String[] variant : RECOGNIZED_VARIANTS) {
            if (variant == null || variant.length < 2) {
                continue;
            }
            String recognized = SpeechTextNormalizer.normalize(variant[0]).toLowerCase(Locale.US);
            String canonical = SpeechTextNormalizer.normalize(variant[1]).toLowerCase(Locale.US);
            if (!recognized.isEmpty() && !canonical.isEmpty()) {
                out.put(recognized, canonical);
            }
        }
        return out;
    }
}
