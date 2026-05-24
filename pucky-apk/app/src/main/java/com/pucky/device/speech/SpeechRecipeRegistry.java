package com.pucky.device.speech;

import android.content.Context;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

public final class SpeechRecipeRegistry {
    public static final String PREF_RECIPE_BUNDLE = "recipe_bundle_json";
    private static final int MAX_RECIPES = 100;
    private static final int MAX_PHRASES_PER_RECIPE = 12;
    private static final int MAX_STEPS_PER_RECIPE = 8;
    private static final String FALLBACK_ASSET = "pucky_recipes_fallback.json";

    private SpeechRecipeRegistry() {
    }

    public static JSONObject schemaGuide() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.recipes_schema.v1");
        Json.put(out, "commands", commands());
        Json.put(out, "matching_rule", "exact_utterance_only");
        Json.put(out, "source_of_truth", "VM publishes recipe bundles; APK caches them and executes allowlisted steps.");
        Json.put(out, "step_types", stepTypes());
        Json.put(out, "device_primitives", RecipeStepExecutor.devicePrimitives());
        Json.put(out, "example_device_recipe", exampleDeviceRecipe());
        Json.put(out, "example_vm_recipe", exampleVmRecipe());
        return out;
    }

    public static JSONObject validationError(String operation, CommandException exc, JSONObject input) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.recipes_validation_error.v1");
        Json.put(out, "operation", operation);
        Json.put(out, "saved", false);
        Json.put(out, "error_code", exc == null ? CommandErrorCodes.MALFORMED_COMMAND : exc.code());
        Json.put(out, "error_message", exc == null ? "recipe validation failed" : exc.getMessage());
        Json.put(out, "input", input == null ? JSONObject.NULL : input);
        Json.put(out, "schema_help", schemaGuide());
        return out;
    }

    public static BundleResult loadStoredDetailed(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return new BundleResult(emptyStoredBundle(), new JSONArray(), false, "");
        }
        try {
            return new BundleResult(normalizeBundle(new JSONObject(raw), "stored_vm_bundle"),
                    new JSONArray(), false, "");
        } catch (Exception exc) {
            JSONArray invalid = new JSONArray();
            JSONObject item = new JSONObject();
            Json.put(item, "reason", exc.getMessage());
            Json.add(invalid, item);
            return new BundleResult(emptyStoredBundle(), invalid, true, exc.getMessage());
        }
    }

    public static JSONObject loadFallbackBundle(Context context) {
        try (InputStream input = context.getAssets().open(FALLBACK_ASSET)) {
            return normalizeBundle(new JSONObject(readUtf8(input)), "apk_fallback");
        } catch (Exception exc) {
            return hardcodedFallbackBundle();
        }
    }

    public static JSONObject normalizeBundle(JSONObject input, String defaultSource) throws CommandException {
        if (input == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "pucky.recipes.sync requires recipe bundle object");
        }
        JSONObject bundle = input.optJSONObject("bundle");
        if (bundle == null) {
            bundle = input;
        }
        String schema = bundle.optString("schema", "pucky.recipe_bundle.v1").trim();
        if (!"pucky.recipe_bundle.v1".equals(schema)) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "recipe bundle schema must be pucky.recipe_bundle.v1");
        }
        JSONArray recipes = bundle.optJSONArray("recipes");
        if (recipes == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "recipe bundle requires recipes array");
        }
        if (recipes.length() > MAX_RECIPES) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "recipe bundle has too many recipes");
        }
        JSONArray normalizedRecipes = new JSONArray();
        Set<String> ids = new HashSet<>();
        Set<String> phrases = new HashSet<>();
        for (int i = 0; i < recipes.length(); i++) {
            JSONObject recipe = normalizeRecipe(recipes.optJSONObject(i), i);
            String id = recipe.optString("id", "");
            if (!ids.add(id)) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "recipe id is duplicated: " + id);
            }
            reservePhrases(phrases, id, recipe.optJSONArray("phrases"));
            Json.add(normalizedRecipes, recipe);
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.recipe_bundle.v1");
        Json.put(out, "bundle_id", nonEmpty(bundle.optString("bundle_id", ""), "vm_live"));
        Json.put(out, "version", bundle.opt("version") == null ? 1 : bundle.opt("version"));
        Json.put(out, "updated_at", nonEmpty(bundle.optString("updated_at", ""), Instant.now().toString()));
        Json.put(out, "source", nonEmpty(bundle.optString("source", ""), defaultSource));
        Json.put(out, "recipes", normalizedRecipes);
        return out;
    }

    public static JSONObject list(Context context, String storedRaw) {
        BundleResult stored = loadStoredDetailed(storedRaw);
        JSONObject fallback = loadFallbackBundle(context);
        JSONArray active = activeRecipes(fallback, stored.bundle);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.recipes_list.v1");
        Json.put(out, "match_strategy", "exact_utterance");
        Json.put(out, "fallback_bundle", fallback);
        Json.put(out, "stored_bundle", stored.bundle);
        Json.put(out, "stored_parse_error", stored.parseError);
        Json.put(out, "stored_parse_error_message", stored.parseErrorMessage.isEmpty()
                ? JSONObject.NULL
                : stored.parseErrorMessage);
        Json.put(out, "invalid_stored_entries", stored.invalidEntries);
        Json.put(out, "active_recipes", active);
        Json.put(out, "active_count", active.length());
        Json.put(out, "schema_help", schemaGuide());
        return out;
    }

    public static RecipeMatch match(Context context, String transcript, String storedRaw) {
        JSONObject fallback = loadFallbackBundle(context);
        JSONObject stored = loadStoredDetailed(storedRaw).bundle;
        return match(transcript, activeRecipes(fallback, stored));
    }

    public static RecipeMatch matchStoredOnly(String transcript, String storedRaw) {
        BundleResult stored = loadStoredDetailed(storedRaw);
        JSONArray recipes = stored.bundle.optJSONArray("recipes");
        if (recipes == null || recipes.length() == 0) {
            return RecipeMatch.none(transcript, SpeechTextNormalizer.normalize(transcript));
        }
        return match(transcript, recipes);
    }

    public static RecipeMatch match(String transcript, JSONArray recipes) {
        String normalized = SpeechTextNormalizer.normalize(transcript);
        if (normalized.isEmpty()) {
            return RecipeMatch.none(transcript, normalized);
        }
        RecipeMatch best = RecipeMatch.none(transcript, normalized);
        JSONArray safeRecipes = recipes == null ? new JSONArray() : recipes;
        for (int recipeIndex = 0; recipeIndex < safeRecipes.length(); recipeIndex++) {
            JSONObject recipe = safeRecipes.optJSONObject(recipeIndex);
            if (recipe == null) {
                continue;
            }
            JSONArray phrases = recipe.optJSONArray("phrases");
            if (phrases == null) {
                continue;
            }
            for (int phraseIndex = 0; phraseIndex < phrases.length(); phraseIndex++) {
                String phrase = SpeechTextNormalizer.normalize(phrases.optString(phraseIndex, ""));
                if (!normalized.equals(phrase)) {
                    continue;
                }
                RecipeMatch candidate = RecipeMatch.found(transcript, normalized, recipe, phrase, phraseIndex);
                if (!best.matched || candidate.priority < best.priority) {
                    best = candidate;
                }
            }
        }
        return best;
    }

    public static JSONObject matchJson(RecipeMatch match) {
        JSONObject out = new JSONObject();
        Json.put(out, "matched", match.matched);
        Json.put(out, "raw_transcript", match.rawTranscript);
        Json.put(out, "normalized_transcript", match.normalizedTranscript);
        Json.put(out, "match_strategy", "exact_utterance");
        Json.put(out, "id", match.matched ? match.id : JSONObject.NULL);
        Json.put(out, "phrase", match.matched ? match.phrase : JSONObject.NULL);
        Json.put(out, "source", match.source);
        Json.put(out, "recipe", match.matched ? match.recipe : JSONObject.NULL);
        Json.put(out, "steps", match.matched ? match.steps : JSONObject.NULL);
        Json.put(out, "reply_text", match.matched ? match.replyText : JSONObject.NULL);
        return out;
    }

    public static JSONArray activeRecipes(JSONObject fallbackBundle, JSONObject storedBundle) {
        LinkedHashMap<String, JSONObject> byId = new LinkedHashMap<>();
        putRecipes(byId, fallbackBundle, "fallback", false);
        putRecipes(byId, storedBundle, "vm_sync", true);
        JSONArray out = new JSONArray();
        for (JSONObject recipe : byId.values()) {
            Json.add(out, recipe);
        }
        return out;
    }

    public static void requireNoActivePhraseConflicts(JSONArray recipes) throws CommandException {
        Map<String, String> owners = new HashMap<>();
        JSONArray safe = recipes == null ? new JSONArray() : recipes;
        for (int i = 0; i < safe.length(); i++) {
            JSONObject recipe = safe.optJSONObject(i);
            if (recipe == null) {
                continue;
            }
            String id = recipe.optString("id", "");
            JSONArray phrases = recipe.optJSONArray("phrases");
            if (phrases == null) {
                continue;
            }
            for (int j = 0; j < phrases.length(); j++) {
                String phrase = SpeechTextNormalizer.normalize(phrases.optString(j, ""));
                String existing = owners.get(phrase);
                if (existing != null && !existing.equals(id)) {
                    throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                            "recipe phrase duplicates active phrase: " + phrase);
                }
                owners.put(phrase, id);
            }
        }
    }

    private static JSONObject normalizeRecipe(JSONObject raw, int index) throws CommandException {
        if (raw == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "recipe at index " + index + " must be an object");
        }
        String id = normalizeId(raw.optString("id", ""));
        JSONArray phrases = normalizePhrases(raw);
        String match = raw.optString("match", "exact_utterance").trim();
        if (!"exact_utterance".equals(match)) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "recipe match must be exact_utterance");
        }
        JSONArray steps = normalizeSteps(raw.optJSONArray("steps"));
        JSONObject out = new JSONObject();
        Json.put(out, "id", id);
        Json.put(out, "phrases", phrases);
        Json.put(out, "phrase", phrases.optString(0, ""));
        Json.put(out, "match", "exact_utterance");
        Json.put(out, "reply_text", replyText(raw, id));
        String errorReplyText = raw.optString("error_reply_text", "").trim();
        if (!errorReplyText.isEmpty()) {
            Json.put(out, "error_reply_text", errorReplyText);
        }
        Json.put(out, "steps", steps);
        Json.put(out, "on_success", feedback(raw.optJSONObject("on_success"), "soft"));
        Json.put(out, "on_failure", feedback(raw.optJSONObject("on_failure"), "low_battery"));
        Json.put(out, "source", nonEmpty(raw.optString("source", ""), "vm"));
        if (raw.has("metadata") && raw.optJSONObject("metadata") != null) {
            Json.put(out, "metadata", raw.optJSONObject("metadata"));
        }
        Json.put(out, "priority", raw.optInt("priority", 1000 + index));
        return out;
    }

    private static JSONArray normalizeSteps(JSONArray rawSteps) throws CommandException {
        JSONArray raw = rawSteps == null ? new JSONArray() : rawSteps;
        if (raw.length() > MAX_STEPS_PER_RECIPE) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "recipe steps must contain 0..8 steps");
        }
        JSONArray out = new JSONArray();
        for (int i = 0; i < raw.length(); i++) {
            JSONObject step = raw.optJSONObject(i);
            if (step == null) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "recipe step must be an object");
            }
            String type = step.optString("type", "").trim();
            if ("device".equals(type)) {
                Json.add(out, normalizeDeviceStep(step));
            } else if ("vm_event".equals(type)) {
                Json.add(out, normalizeVmEventStep(step));
            } else if ("chime".equals(type)) {
                Json.add(out, normalizeChimeStep(step));
            } else {
                throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED,
                        "Unsupported recipe step type: " + type);
            }
        }
        return out;
    }

    private static JSONObject normalizeDeviceStep(JSONObject step) throws CommandException {
        JSONObject action = new JSONObject();
        Json.put(action, "command", step.optString("command", ""));
        Json.put(action, "args", step.optJSONObject("args") == null ? new JSONObject() : step.optJSONObject("args"));
        JSONObject safe = RecipeDevicePrimitiveExecutor.sanitize(action);
        JSONObject out = new JSONObject();
        Json.put(out, "type", "device");
        Json.put(out, "command", safe.optString("command", ""));
        Json.put(out, "args", safe.optJSONObject("args") == null ? new JSONObject() : safe.optJSONObject("args"));
        return out;
    }

    private static JSONObject normalizeVmEventStep(JSONObject step) throws CommandException {
        String eventType = step.optString("event_type", "agent.recipe_triggered").trim();
        if (eventType.isEmpty() || !eventType.matches("[a-zA-Z0-9._-]{1,96}")) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "vm_event event_type must match [a-zA-Z0-9._-]{1,96}");
        }
        JSONObject args = step.optJSONObject("args");
        if (step.has("args") && args == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "vm_event args must be a JSON object");
        }
        JSONObject out = new JSONObject();
        Json.put(out, "type", "vm_event");
        Json.put(out, "event_type", eventType);
        Json.put(out, "args", args == null ? new JSONObject() : args);
        return out;
    }

    private static JSONObject normalizeChimeStep(JSONObject step) throws CommandException {
        String sound = normalizeSound(step.optString("sound", "soft"));
        JSONObject out = new JSONObject();
        Json.put(out, "type", "chime");
        Json.put(out, "sound", sound);
        return out;
    }

    private static JSONObject feedback(JSONObject raw, String defaultSound) throws CommandException {
        JSONObject out = new JSONObject();
        Json.put(out, "sound", normalizeSound(raw == null ? defaultSound : raw.optString("sound", defaultSound)));
        return out;
    }

    private static String normalizeSound(String raw) throws CommandException {
        String sound = raw == null ? "" : raw.trim().toLowerCase(Locale.US);
        if ("soft".equals(sound) || "low_battery".equals(sound) || "none".equals(sound)) {
            return sound;
        }
        throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                "recipe sound must be soft, low_battery, or none");
    }

    private static String normalizeId(String raw) throws CommandException {
        String id = raw == null ? "" : raw.trim().toLowerCase(Locale.US);
        if (id.isEmpty() || !id.matches("[a-z0-9_-]{1,64}")) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "recipe id must match [a-z0-9_-]{1,64}");
        }
        return id;
    }

    private static JSONArray normalizePhrases(JSONObject input) throws CommandException {
        JSONArray raw = input.optJSONArray("phrases");
        if (raw == null && input.has("phrase")) {
            raw = new JSONArray();
            Json.add(raw, input.optString("phrase", ""));
        }
        if (raw == null || raw.length() == 0 || raw.length() > MAX_PHRASES_PER_RECIPE) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "recipe phrases must contain 1..12 phrases");
        }
        LinkedHashSet<String> phrases = new LinkedHashSet<>();
        for (int i = 0; i < raw.length(); i++) {
            String normalized = SpeechTextNormalizer.normalize(raw.optString(i, ""));
            if (normalized.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "recipe phrases cannot be empty");
            }
            if (!phrases.add(normalized)) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "recipe phrases cannot be duplicated: " + normalized);
            }
        }
        JSONArray out = new JSONArray();
        for (String phrase : phrases) {
            Json.add(out, phrase);
        }
        return out;
    }

    private static void reservePhrases(Set<String> reserved, String id, JSONArray phrases) throws CommandException {
        for (int i = 0; i < phrases.length(); i++) {
            String phrase = SpeechTextNormalizer.normalize(phrases.optString(i, ""));
            String key = phrase;
            if (!reserved.add(key)) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "recipe phrase duplicates existing phrase: " + phrase + " in " + id);
            }
        }
    }

    private static void putRecipes(Map<String, JSONObject> out, JSONObject bundle, String source, boolean override) {
        JSONArray recipes = bundle == null ? null : bundle.optJSONArray("recipes");
        if (recipes == null) {
            return;
        }
        for (int i = 0; i < recipes.length(); i++) {
            JSONObject recipe = recipes.optJSONObject(i);
            if (recipe == null) {
                continue;
            }
            JSONObject copy = copy(recipe);
            Json.put(copy, "active_source", source);
            String id = copy.optString("id", "");
            if (override || !out.containsKey(id)) {
                out.put(id, copy);
            }
        }
    }

    private static JSONObject copy(JSONObject object) {
        try {
            return new JSONObject(object == null ? "{}" : object.toString());
        } catch (JSONException ignored) {
            return new JSONObject();
        }
    }

    private static JSONObject emptyStoredBundle() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.recipe_bundle.v1");
        Json.put(out, "bundle_id", "empty");
        Json.put(out, "version", 0);
        Json.put(out, "updated_at", "");
        Json.put(out, "source", "none");
        Json.put(out, "recipes", new JSONArray());
        return out;
    }

    private static JSONObject hardcodedFallbackBundle() {
        try {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.recipe_bundle.v1");
            Json.put(out, "bundle_id", "apk_fallback_hardcoded");
            Json.put(out, "version", 1);
            Json.put(out, "updated_at", "2026-05-23T00:00:00Z");
            Json.put(out, "source", "apk_hardcoded");
            JSONArray recipes = new JSONArray();
            Json.add(recipes, builtinRecipe("hey_pucky",
                    new String[]{"hey pucky", "hey puppy", "hey lucky", "hay pucky", "hey pocky", "hey packy", "pucky", "puppy", "pocky", "packy"},
                    "Hey Pucky recognized."));
            Json.add(recipes, builtinRecipe("mic_on",
                    new String[]{"mic on", "mike on", "microphone on"},
                    "Mic on recognized."));
            Json.add(recipes, builtinRecipe("mic_off",
                    new String[]{"mic off", "mike off", "microphone off"},
                    "Mic off recognized."));
            Json.put(out, "recipes", recipes);
            return normalizeBundle(out, "apk_hardcoded");
        } catch (CommandException exc) {
            return emptyStoredBundle();
        }
    }

    private static JSONObject builtinRecipe(String id, String[] phrases, String reply) {
        JSONObject recipe = new JSONObject();
        Json.put(recipe, "id", id);
        JSONArray aliases = new JSONArray();
        for (String phrase : phrases) {
            Json.add(aliases, phrase);
        }
        Json.put(recipe, "phrases", aliases);
        Json.put(recipe, "match", "exact_utterance");
        Json.put(recipe, "reply_text", reply);
        Json.put(recipe, "steps", new JSONArray());
        return recipe;
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
            return "Recipe";
        }
        return cleaned.substring(0, 1).toUpperCase(Locale.US) + cleaned.substring(1);
    }

    private static String nonEmpty(String value, String fallback) {
        String text = value == null ? "" : value.trim();
        return text.isEmpty() ? fallback : text;
    }

    private static String readUtf8(InputStream input) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = input.read(buffer)) != -1) {
            output.write(buffer, 0, read);
        }
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private static JSONArray commands() {
        JSONArray out = new JSONArray();
        Json.add(out, "pucky.recipes.sync");
        Json.add(out, "pucky.recipes.list");
        Json.add(out, "pucky.recipes.test");
        Json.add(out, "pucky.recipes.clear");
        Json.add(out, "pucky.recipes.schema");
        Json.add(out, "device.primitives.list");
        return out;
    }

    private static JSONArray stepTypes() {
        JSONArray out = new JSONArray();
        Json.add(out, "device: execute one APK allowlisted primitive");
        Json.add(out, "vm_event: post pucky.keyword_triggered.v1 to the broker");
        Json.add(out, "chime: play soft or low_battery local feedback");
        return out;
    }

    private static JSONObject exampleDeviceRecipe() {
        JSONObject args = new JSONObject();
        Json.put(args, "enabled", true);
        Json.put(args, "auto_off_ms", 600);
        JSONObject step = new JSONObject();
        Json.put(step, "type", "device");
        Json.put(step, "command", RecipeDevicePrimitiveExecutor.COMMAND_TORCH_SET);
        Json.put(step, "args", args);
        JSONObject out = new JSONObject();
        Json.put(out, "id", "flashlight");
        Json.put(out, "phrases", array("flashlight", "flash light"));
        Json.put(out, "match", "exact_utterance");
        Json.put(out, "steps", new JSONArray().put(step));
        return out;
    }

    private static JSONObject exampleVmRecipe() {
        JSONObject stepArgs = new JSONObject();
        Json.put(stepArgs, "agent_prompt", "Check my latest email and summarize anything important.");
        JSONObject step = new JSONObject();
        Json.put(step, "type", "vm_event");
        Json.put(step, "event_type", "agent.recipe_triggered");
        Json.put(step, "args", stepArgs);
        JSONObject out = new JSONObject();
        Json.put(out, "id", "check_email");
        Json.put(out, "phrases", array("check email"));
        Json.put(out, "match", "exact_utterance");
        Json.put(out, "steps", new JSONArray().put(step));
        return out;
    }

    private static JSONArray array(String... values) {
        JSONArray out = new JSONArray();
        for (String value : values) {
            Json.add(out, value);
        }
        return out;
    }

    public static final class BundleResult {
        public final JSONObject bundle;
        public final JSONArray invalidEntries;
        public final boolean parseError;
        public final String parseErrorMessage;

        private BundleResult(JSONObject bundle, JSONArray invalidEntries, boolean parseError, String parseErrorMessage) {
            this.bundle = bundle == null ? emptyStoredBundle() : bundle;
            this.invalidEntries = invalidEntries == null ? new JSONArray() : invalidEntries;
            this.parseError = parseError;
            this.parseErrorMessage = parseErrorMessage == null ? "" : parseErrorMessage;
        }
    }

    public static final class RecipeMatch {
        public final boolean matched;
        public final String rawTranscript;
        public final String normalizedTranscript;
        public final String id;
        public final String phrase;
        public final String source;
        public final String replyText;
        public final String errorReplyText;
        public final JSONObject recipe;
        public final JSONArray steps;
        public final int priority;

        private RecipeMatch(
                boolean matched,
                String rawTranscript,
                String normalizedTranscript,
                String id,
                String phrase,
                String source,
                String replyText,
                String errorReplyText,
                JSONObject recipe,
                JSONArray steps,
                int priority) {
            this.matched = matched;
            this.rawTranscript = rawTranscript == null ? "" : rawTranscript;
            this.normalizedTranscript = normalizedTranscript == null ? "" : normalizedTranscript;
            this.id = id == null ? "" : id;
            this.phrase = phrase == null ? "" : phrase;
            this.source = source == null ? "" : source;
            this.replyText = replyText == null ? "" : replyText;
            this.errorReplyText = errorReplyText == null ? "" : errorReplyText;
            this.recipe = recipe;
            this.steps = steps == null ? new JSONArray() : steps;
            this.priority = priority;
        }

        private static RecipeMatch none(String rawTranscript, String normalizedTranscript) {
            return new RecipeMatch(false, rawTranscript, normalizedTranscript,
                    "", "", "none", "", "", null, new JSONArray(), Integer.MAX_VALUE);
        }

        private static RecipeMatch found(
                String rawTranscript, String normalizedTranscript, JSONObject recipe, String phrase, int phraseIndex) {
            return new RecipeMatch(true, rawTranscript, normalizedTranscript,
                    recipe.optString("id", ""),
                    phrase,
                    recipe.optString("active_source", recipe.optString("source", "vm")),
                    recipe.optString("reply_text", ""),
                    recipe.optString("error_reply_text", ""),
                    recipe,
                    recipe.optJSONArray("steps"),
                    recipe.optInt("priority", 1000) + phraseIndex);
        }

        public boolean hasSteps() {
            return steps.length() > 0;
        }

        public String firstDeviceCommand() {
            for (int i = 0; i < steps.length(); i++) {
                JSONObject step = steps.optJSONObject(i);
                if (step != null && "device".equals(step.optString("type", ""))) {
                    return step.optString("command", "");
                }
            }
            return "";
        }
    }
}
