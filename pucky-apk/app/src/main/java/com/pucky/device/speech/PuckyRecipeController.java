package com.pucky.device.speech;

import android.content.Context;
import android.content.SharedPreferences;

import com.pucky.device.clipboard.PuckyClipboardController;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.time.Instant;
import java.util.UUID;

public final class PuckyRecipeController {
    static final String PREFS = "pucky_recipes";
    static final String LEGACY_PREFS = "pucky_speech_echo_lab";
    static final String KEY_MIGRATED_FROM = "migrated_from";
    static final String KEY_MIGRATED_AT = "migrated_at";
    static final String KEY_SCHEMA_VERSION = "schema_version";
    static final int CURRENT_SCHEMA_VERSION = 1;

    private static volatile PuckyRecipeController shared;

    private final Context context;
    private final SharedPreferences prefs;
    private final SharedPreferences legacyPrefs;
    private final RecipeStepExecutor recipeStepExecutor;
    private final PuckyClipboardController clipboardController;

    private boolean migrationChecked;

    public static PuckyRecipeController shared(Context context) {
        PuckyRecipeController existing = shared;
        if (existing != null) {
            return existing;
        }
        synchronized (PuckyRecipeController.class) {
            if (shared == null) {
                shared = new PuckyRecipeController(context.getApplicationContext());
            }
            return shared;
        }
    }

    private PuckyRecipeController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.legacyPrefs = this.context.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE);
        this.recipeStepExecutor = new RecipeStepExecutor(this.context);
        this.clipboardController = PuckyClipboardController.shared(this.context);
    }

    public synchronized JSONObject schema() {
        ensureMigrated();
        return SpeechRecipeRegistry.schemaGuide();
    }

    public synchronized JSONObject list() {
        ensureMigrated();
        return SpeechRecipeRegistry.list(context, storedRecipeBundleRaw());
    }

    public synchronized JSONObject sync(JSONObject args) {
        ensureMigrated();
        JSONObject input = args == null ? null : args.optJSONObject("bundle");
        if (input == null) {
            input = args;
        }
        JSONObject normalized;
        try {
            normalized = SpeechRecipeRegistry.normalizeBundle(input, "vm_sync");
            SpeechRecipeRegistry.requireNoActivePhraseConflicts(SpeechRecipeRegistry.activeRecipes(
                    SpeechRecipeRegistry.loadFallbackBundle(context),
                    normalized));
        } catch (CommandException exc) {
            return SpeechRecipeRegistry.validationError("pucky.recipes.sync", exc, input);
        }
        prefs.edit()
                .putInt(KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)
                .putString(SpeechRecipeRegistry.PREF_RECIPE_BUNDLE, normalized.toString())
                .commit();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.recipes_sync.v1");
        Json.put(out, "saved", true);
        Json.put(out, "bundle", normalized);
        Json.put(out, "active", list());
        return out;
    }

    public synchronized JSONObject clear() {
        ensureMigrated();
        String previous = storedRecipeBundleRaw();
        prefs.edit().remove(SpeechRecipeRegistry.PREF_RECIPE_BUNDLE).commit();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.recipes_clear.v1");
        Json.put(out, "cleared", previous.trim().isEmpty() ? 0 : 1);
        Json.put(out, "active", list());
        return out;
    }

    public synchronized JSONObject test(JSONObject args) throws CommandException {
        ensureMigrated();
        if (args == null || !args.has("text")) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "pucky.recipes.test requires text");
        }
        boolean execute = args.optBoolean("execute", false);
        SpeechRecipeRegistry.RecipeMatch recipe = recipeMatch(args.optString("text", ""));
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.recipes_test.v1");
        Json.put(out, "execute", execute);
        Json.put(out, "match", SpeechRecipeRegistry.matchJson(recipe));
        if (!recipe.matched || !recipe.hasSteps()) {
            Json.put(out, "execution_status", recipe.matched ? "not_applicable" : "skipped_no_match");
            return out;
        }
        Json.put(out, "execution_status", execute ? "pending" : "planned");
        if (!execute) {
            return out;
        }

        JSONObject session = recipeTestSession(args.optString("text", ""), recipe);
        try {
            JSONObject execution = recipeStepExecutor.execute(recipe, session);
            Json.put(out, "execution", execution);
            Json.put(out, "execution_status", execution.optString("status", "unknown"));
            if ("succeeded".equals(execution.optString("status", ""))) {
                Json.put(out, "success_chime", recipeStepExecutor.playSuccessChime("pucky.recipe_success_chime.v1"));
            } else if ("failed".equals(execution.optString("status", ""))) {
                Json.put(out, "failure_chime", recipeStepExecutor.playFailureChime("pucky.recipe_failure_chime.v1"));
            }
        } catch (CommandException exc) {
            Json.put(out, "execution_status", "failed");
            Json.put(out, "error_code", exc.code());
            Json.put(out, "error_message", exc.getMessage());
            Json.put(out, "failure_chime", recipeStepExecutor.playFailureChime("pucky.recipe_failure_chime.v1"));
        }
        Json.put(session, "keyword_action_result", out.opt("execution"));
        Json.put(session, "keyword_action_status", out.optString("execution_status", "unknown"));
        JSONObject clipboard = clipboardController.append(
                PuckyClipboardController.entryFromRecipeSession(session, "recipe_test"));
        Json.put(out, "pucky_clipboard", clipboard);
        return out;
    }

    public JSONObject devicePrimitivesList() {
        ensureMigrated();
        return RecipeStepExecutor.devicePrimitives();
    }

    synchronized String storedRecipeBundleRaw() {
        ensureMigrated();
        return prefs.getString(SpeechRecipeRegistry.PREF_RECIPE_BUNDLE, "");
    }

    private void ensureMigrated() {
        if (migrationChecked) {
            return;
        }
        MigrationPlan plan = planMigration(
                prefs.getString(SpeechRecipeRegistry.PREF_RECIPE_BUNDLE, ""),
                legacyPrefs.getString(SpeechRecipeRegistry.PREF_RECIPE_BUNDLE, ""),
                !legacyPrefs.getAll().isEmpty(),
                Instant.now().toString());
        SharedPreferences.Editor editor = prefs.edit();
        editor.putInt(KEY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
        if (plan.importLegacyBundle) {
            editor.putString(SpeechRecipeRegistry.PREF_RECIPE_BUNDLE, plan.bundleToKeep);
        }
        if (plan.clearLegacy) {
            editor.putString(KEY_MIGRATED_FROM, LEGACY_PREFS);
            editor.putString(KEY_MIGRATED_AT, plan.migratedAt);
        }
        editor.commit();
        if (plan.clearLegacy) {
            legacyPrefs.edit().clear().commit();
        }
        migrationChecked = true;
    }

    private SpeechRecipeRegistry.RecipeMatch recipeMatch(String text) {
        return SpeechRecipeRegistry.match(context, text, storedRecipeBundleRaw());
    }

    private static JSONObject recipeTestSession(String text, SpeechRecipeRegistry.RecipeMatch recipe) {
        JSONObject session = new JSONObject();
        Json.put(session, "schema", "pucky.recipe_test_session.v1");
        Json.put(session, "source", "recipe_test");
        Json.put(session, "session_id", "recipe_test_" + UUID.randomUUID().toString().replace("-", ""));
        Json.put(session, "started_at", Instant.now().toString());
        Json.put(session, "completed_at", Instant.now().toString());
        Json.put(session, "final_transcript", text);
        Json.put(session, "keyword_raw_transcript", recipe.rawTranscript);
        Json.put(session, "keyword_normalized_transcript", recipe.normalizedTranscript);
        Json.put(session, "keyword_match_strategy", "exact_utterance");
        Json.put(session, "keyword_match", recipe.matched);
        Json.put(session, "keyword_match_id", recipe.id);
        Json.put(session, "keyword_match_phrase", recipe.phrase);
        Json.put(session, "keyword_match_source", recipe.source);
        Json.put(session, "keyword_reply_text", recipe.replyText);
        Json.put(session, "keyword_action", recipe.steps);
        Json.put(session, "keyword_action_command",
                recipe.firstDeviceCommand().isEmpty() ? "vm_event.post" : recipe.firstDeviceCommand());
        Json.put(session, "pucky_clipboard_entry_id", "clip_" + UUID.randomUUID().toString().replace("-", ""));
        return session;
    }

    static MigrationPlan planMigration(
            String currentBundleRaw,
            String legacyBundleRaw,
            boolean legacyHasAnyData,
            String nowIso) {
        String current = clean(currentBundleRaw);
        String legacy = clean(legacyBundleRaw);
        boolean importLegacyBundle = current.isEmpty() && !legacy.isEmpty();
        boolean clearLegacy = legacyHasAnyData;
        String bundleToKeep = importLegacyBundle ? legacy : current;
        return new MigrationPlan(importLegacyBundle, clearLegacy, bundleToKeep, clean(nowIso));
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    static final class MigrationPlan {
        final boolean importLegacyBundle;
        final boolean clearLegacy;
        final String bundleToKeep;
        final String migratedAt;

        MigrationPlan(boolean importLegacyBundle, boolean clearLegacy, String bundleToKeep, String migratedAt) {
            this.importLegacyBundle = importLegacyBundle;
            this.clearLegacy = clearLegacy;
            this.bundleToKeep = bundleToKeep == null ? "" : bundleToKeep;
            this.migratedAt = migratedAt == null ? "" : migratedAt;
        }
    }
}
