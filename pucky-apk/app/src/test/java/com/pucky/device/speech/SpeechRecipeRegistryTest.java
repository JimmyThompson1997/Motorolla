package com.pucky.device.speech;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public final class SpeechRecipeRegistryTest {
    @Test
    public void recipeBundleNormalizesAndMatchesExactUtteranceOnly() throws Exception {
        JSONObject bundle = bundle(recipe("flashlight", phrases("flashlight", "flash light"),
                deviceStep("torch.set", new JSONObject().put("auto_off_ms", 600))));
        JSONObject normalized = SpeechRecipeRegistry.normalizeBundle(bundle, "test");
        SpeechRecipeRegistry.RecipeMatch exact = SpeechRecipeRegistry.match("Flash light!", normalized.optJSONArray("recipes"));
        SpeechRecipeRegistry.RecipeMatch prefix = SpeechRecipeRegistry.match("turn flashlight on", normalized.optJSONArray("recipes"));
        SpeechRecipeRegistry.RecipeMatch suffix = SpeechRecipeRegistry.match("flashlight please", normalized.optJSONArray("recipes"));

        assertTrue(exact.matched);
        assertEquals("flashlight", exact.id);
        assertEquals("flash light", exact.phrase);
        assertEquals("torch.set", exact.firstDeviceCommand());
        assertFalse(prefix.matched);
        assertFalse(suffix.matched);
    }

    @Test
    public void vmEventStepIsAllowedAndPreserved() throws Exception {
        JSONObject bundle = bundle(recipe("check_email", phrases("check email"),
                new JSONObject()
                        .put("type", "vm_event")
                        .put("event_type", "agent.recipe_triggered")
                        .put("args", new JSONObject().put("agent_prompt", "Check email."))));

        JSONObject normalized = SpeechRecipeRegistry.normalizeBundle(bundle, "test");
        SpeechRecipeRegistry.RecipeMatch match = SpeechRecipeRegistry.match("check email", normalized.optJSONArray("recipes"));

        assertTrue(match.matched);
        assertEquals("vm_event", match.steps.optJSONObject(0).optString("type"));
        assertEquals("agent.recipe_triggered", match.steps.optJSONObject(0).optString("event_type"));
    }

    @Test
    public void dangerousRecipeStepsAreRejected() throws Exception {
        CommandException shell = expectCommandException(() ->
                SpeechRecipeRegistry.normalizeBundle(bundle(recipe("danger", phrases("danger"),
                        deviceStep("shell.exec", new JSONObject().put("command", "date")))), "test"));
        CommandException badType = expectCommandException(() ->
                SpeechRecipeRegistry.normalizeBundle(bundle(recipe("danger", phrases("danger"),
                        new JSONObject().put("type", "network").put("url", "https://example.com"))), "test"));

        assertEquals(CommandErrorCodes.COMMAND_NOT_ALLOWED, shell.code());
        assertEquals(CommandErrorCodes.COMMAND_NOT_ALLOWED, badType.code());
    }

    @Test
    public void locationRecipeDefaultsToRecentOrPendingPolicy() throws Exception {
        JSONObject normalized = SpeechRecipeRegistry.normalizeBundle(bundle(recipe("location_pin", phrases("pin location"),
                deviceStep("location.pin", new JSONObject()))), "vm_sync");
        JSONObject step = normalized.optJSONArray("recipes")
                .optJSONObject(0)
                .optJSONArray("steps")
                .optJSONObject(0);
        JSONObject args = step.optJSONObject("args");

        assertEquals("location.pin", step.optString("command"));
        assertEquals(60000L, args.optLong("timeout_ms"));
        assertEquals(30000L, args.optLong("max_cache_age_ms"));
        assertTrue(args.optBoolean("allow_pending"));
    }

    @Test
    public void locationPrimitivePreservesClipboardEntryForPendingResolution() throws Exception {
        JSONObject safe = RecipeDevicePrimitiveExecutor.sanitize(new JSONObject()
                .put("command", "location.pin")
                .put("args", new JSONObject()
                        .put("pucky_clipboard_entry_id", "clip_location_pending")));
        JSONObject args = safe.optJSONObject("args");

        assertEquals("location.pin", safe.optString("command"));
        assertEquals("clip_location_pending", args.optString("pucky_clipboard_entry_id"));
    }

    @Test
    public void locationPrimitiveHonorsExplicitAllowPendingAndPublishFlags() throws Exception {
        JSONObject safe = RecipeDevicePrimitiveExecutor.sanitize(new JSONObject()
                .put("command", "location.pin")
                .put("args", new JSONObject()
                        .put("allow_pending", false)
                        .put("publish", true)));
        JSONObject args = safe.optJSONObject("args");

        assertEquals("location.pin", safe.optString("command"));
        assertFalse(args.optBoolean("allow_pending", true));
        assertTrue(args.optBoolean("publish", false));
    }

    @Test
    public void notificationRecipePrimitiveIsAllowlistedAndSanitized() throws Exception {
        JSONObject normalized = SpeechRecipeRegistry.normalizeBundle(bundle(recipe("notify_me", phrases("send a notification"),
                deviceStep("notify.show", new JSONObject()
                        .put("title", "Proof title")
                        .put("text", "Proof body")
                        .put("id", "proof_notification")))), "vm_sync");
        JSONObject step = normalized.optJSONArray("recipes")
                .optJSONObject(0)
                .optJSONArray("steps")
                .optJSONObject(0);
        JSONObject safe = RecipeDevicePrimitiveExecutor.sanitize(step);
        JSONObject args = safe.optJSONObject("args");

        assertEquals("notify.show", step.optString("command"));
        assertEquals("notify.show", safe.optString("command"));
        assertEquals("Proof title", args.optString("title"));
        assertEquals("Proof body", args.optString("text"));
        assertEquals("proof_notification", args.optString("id"));
    }

    @Test
    public void duplicatePhrasesInsideBundleAreRejected() throws Exception {
        CommandException exc = expectCommandException(() ->
                SpeechRecipeRegistry.normalizeBundle(bundle(
                        recipe("one", phrases("flashlight"), deviceStep("torch.set", new JSONObject())),
                        recipe("two", phrases("Flashlight!"), deviceStep("torch.set", new JSONObject()))
                ), "test"));

        assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
    }

    @Test
    public void activePhraseConflictsAreRejectedAcrossBundles() throws Exception {
        JSONObject fallback = SpeechRecipeRegistry.normalizeBundle(bundle(
                recipe("fallback_flashlight", phrases("flashlight"), new JSONObject()
                        .put("type", "chime")
                        .put("sound", "soft"))), "fallback");
        JSONObject vm = SpeechRecipeRegistry.normalizeBundle(bundle(
                recipe("custom_flashlight", phrases("Flashlight!"), deviceStep("torch.set", new JSONObject()))), "vm");

        CommandException exc = expectCommandException(() ->
                SpeechRecipeRegistry.requireNoActivePhraseConflicts(
                        SpeechRecipeRegistry.activeRecipes(fallback, vm)));

        assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
    }

    @Test
    public void activeRecipesUseVmSyncSourceForStoredBundle() throws Exception {
        JSONObject fallback = SpeechRecipeRegistry.normalizeBundle(bundle(
                recipe("fallback_ready", phrases("ready"), new JSONObject()
                        .put("type", "chime")
                        .put("sound", "soft"))), "fallback");
        JSONObject vm = SpeechRecipeRegistry.normalizeBundle(bundle(
                recipe("flashlight", phrases("flashlight"), deviceStep("torch.set", new JSONObject()))), "vm_sync");
        JSONArray active = SpeechRecipeRegistry.activeRecipes(fallback, vm);
        JSONObject recipe = active.optJSONObject(1);

        assertEquals("flashlight", recipe.optString("id"));
        assertEquals("vm_sync", recipe.optString("active_source"));
    }

    @Test
    public void schemaGuidePointsFutureAgentsToRecipeCommands() {
        JSONObject schema = SpeechRecipeRegistry.schemaGuide();

        assertEquals("pucky.recipes_schema.v1", schema.optString("schema"));
        assertTrue(schema.toString().contains("pucky.recipes.sync"));
        assertTrue(schema.toString().contains("device.primitives.list"));
        assertTrue(schema.toString().contains("vm_event"));
        assertTrue(schema.toString().contains("torch.set"));
    }

    @Test
    public void storedOnlyMatchDoesNotFallBackToApkBuiltins() throws Exception {
        SpeechRecipeRegistry.RecipeMatch none = SpeechRecipeRegistry.matchStoredOnly("ready", "");
        JSONObject normalized = SpeechRecipeRegistry.normalizeBundle(bundle(
                recipe("flashlight", phrases("flashlight"), deviceStep("torch.set", new JSONObject()))), "vm_sync");
        SpeechRecipeRegistry.RecipeMatch yes = SpeechRecipeRegistry.matchStoredOnly("flashlight", normalized.toString());

        assertFalse(none.matched);
        assertTrue(yes.matched);
        assertEquals("flashlight", yes.id);
    }

    private static JSONObject bundle(JSONObject... recipes) throws Exception {
        JSONArray array = new JSONArray();
        for (JSONObject recipe : recipes) {
            array.put(recipe);
        }
        return new JSONObject()
                .put("schema", "pucky.recipe_bundle.v1")
                .put("bundle_id", "test_bundle")
                .put("version", 1)
                .put("updated_at", "2026-05-23T00:00:00Z")
                .put("recipes", array);
    }

    private static JSONObject recipe(String id, JSONArray phrases, JSONObject step) throws Exception {
        return new JSONObject()
                .put("id", id)
                .put("phrases", phrases)
                .put("match", "exact_utterance")
                .put("steps", new JSONArray().put(step));
    }

    private static JSONObject deviceStep(String command, JSONObject args) throws Exception {
        return new JSONObject()
                .put("type", "device")
                .put("command", command)
                .put("args", args);
    }

    private static JSONArray phrases(String... values) {
        JSONArray out = new JSONArray();
        for (String value : values) {
            out.put(value);
        }
        return out;
    }

    private static CommandException expectCommandException(ThrowingRunnable runnable) throws Exception {
        try {
            runnable.run();
        } catch (CommandException exc) {
            return exc;
        }
        throw new AssertionError("Expected CommandException");
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
