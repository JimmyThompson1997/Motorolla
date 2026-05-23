package com.pucky.device.speech;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public final class SpeechKeywordRegistryTest {
    @Test
    public void dynamicKeywordMatchesExactUtteranceOnly() throws Exception {
        SpeechKeywordRegistry.SetResult result = SpeechKeywordRegistry.set(new JSONArray(), flashlightKeyword());

        SpeechKeywordMatcher.Match exact = SpeechKeywordRegistry.match("Flash light!", result.entries);
        SpeechKeywordMatcher.Match prefix = SpeechKeywordRegistry.match("turn flashlight on", result.entries);
        SpeechKeywordMatcher.Match suffix = SpeechKeywordRegistry.match("flashlight please", result.entries);
        SpeechKeywordMatcher.Match containing = SpeechKeywordRegistry.match("you said flashlight", result.entries);

        assertTrue(exact.matched);
        assertEquals("flashlight", exact.id);
        assertEquals("custom:flash light", exact.source);
        assertTrue(exact.hasAction());
        assertFalse(prefix.matched);
        assertFalse(suffix.matched);
        assertFalse(containing.matched);
    }

    @Test
    public void setListAndDeleteCustomKeyword() throws Exception {
        SpeechKeywordRegistry.SetResult set = SpeechKeywordRegistry.set(new JSONArray(), flashlightKeyword());
        JSONObject list = SpeechKeywordRegistry.list(set.entries);
        SpeechKeywordRegistry.DeleteResult deleted = SpeechKeywordRegistry.delete(set.entries, "flashlight");

        assertFalse(set.replaced);
        assertEquals(1, set.entries.length());
        assertEquals(1, list.optInt("custom_count"));
        assertEquals("flashlight", deleted.removed.optString("id"));
        assertEquals(0, deleted.entries.length());
    }

    @Test
    public void malformedStoredRegistryEntriesAreIgnoredAndReported() throws Exception {
        JSONArray corrupt = new JSONArray()
                .put(new JSONObject()
                        .put("Count", 2)
                        .put("value", new JSONArray().put(flashlightKeyword())))
                .put(keyword("location_pin", phrases("pin location"), "Location pinned.",
                        new JSONObject()
                                .put("command", "location.pin")
                                .put("args", new JSONArray().put("screenshot"))));

        SpeechKeywordRegistry.LoadResult loaded = SpeechKeywordRegistry.loadCustomDetailed(corrupt.toString());
        JSONObject list = SpeechKeywordRegistry.list(loaded);

        assertEquals(0, loaded.entries.length());
        assertEquals(2, loaded.invalidEntries.length());
        assertEquals(2, list.optInt("invalid_custom_entries_count"));
        assertEquals(0, list.optInt("custom_count"));
    }

    @Test
    public void cleanScreenshotKeywordMatchesAfterMalformedStoredEntriesAreIgnored() throws Exception {
        JSONArray corrupt = new JSONArray().put(new JSONObject().put("Count", 2).put("value", new JSONArray()));
        JSONArray valid = SpeechKeywordRegistry.loadCustomDetailed(corrupt.toString()).entries;
        SpeechKeywordRegistry.SetResult set = SpeechKeywordRegistry.set(valid,
                keyword("screenshot", phrases("screenshot", "screen shot", "capture screen", "take screenshot"),
                        "Screenshot captured.", screenshotAction()));

        SpeechKeywordMatcher.Match match = SpeechKeywordRegistry.match("Screenshot.", set.entries);

        assertTrue(match.matched);
        assertEquals("screenshot", match.id);
        assertEquals("screenshot.capture", match.action.optString("command"));

        SpeechKeywordMatcher.Match takeScreenshot = SpeechKeywordRegistry.match("Take screenshot.", set.entries);
        assertTrue(takeScreenshot.matched);
        assertEquals("screenshot", takeScreenshot.id);
    }

    @Test
    public void schemaGuideExplainsKeywordShapeForFutureAgents() {
        JSONObject schema = SpeechKeywordRegistry.schemaGuide();

        assertEquals("pucky.speech_echo_lab_keyword_schema.v1", schema.optString("schema"));
        assertEquals("speech.echo.lab.keyword.set", schema.optString("command"));
        assertEquals("exact_utterance_only", schema.optString("matching_rule"));
        assertEquals("screenshot", schema.optJSONObject("example").optString("id"));
        assertTrue(schema.optJSONArray("allowed_actions").length() >= 6);
        assertTrue(schema.toString().contains("action.args must be a JSON object"));
        assertTrue(schema.toString().contains("take screenshot"));
    }

    @Test
    public void setPersistsReplacementForSameCustomId() throws Exception {
        JSONArray first = SpeechKeywordRegistry.set(new JSONArray(), flashlightKeyword()).entries;
        JSONObject replacement = keyword("flashlight", phrases("torch"), "Torch recognized.", torchAction(700));
        SpeechKeywordRegistry.SetResult second = SpeechKeywordRegistry.set(first, replacement);

        assertTrue(second.replaced);
        assertEquals(1, second.entries.length());
        assertTrue(SpeechKeywordRegistry.match("torch", second.entries).matched);
        assertFalse(SpeechKeywordRegistry.match("flashlight", second.entries).matched);
    }

    @Test
    public void builtinsCannotBeOverwritten() throws Exception {
        CommandException exc = expectCommandException(() ->
                SpeechKeywordRegistry.set(new JSONArray(),
                        keyword("hey_pucky", phrases("hello"), "Hello.", torchAction(600))));

        assertEquals(CommandErrorCodes.COMMAND_NOT_ALLOWED, exc.code());
    }

    @Test
    public void duplicateNormalizedPhrasesAreRejected() throws Exception {
        CommandException exc = expectCommandException(() ->
                SpeechKeywordRegistry.set(new JSONArray(),
                        keyword("flashlight", phrases("flashlight", "Flash light!", "flashlight"),
                                "Flashlight recognized.", torchAction(600))));

        assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
    }

    @Test
    public void duplicateBuiltinPhraseIsRejected() throws Exception {
        CommandException exc = expectCommandException(() ->
                SpeechKeywordRegistry.set(new JSONArray(),
                        keyword("custom_mic", phrases("mic on"), "Custom recognized.", torchAction(600))));

        assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
    }

    @Test
    public void disallowedActionsAreRejected() throws Exception {
        JSONObject action = new JSONObject()
                .put("command", "shell.exec")
                .put("args", new JSONObject().put("command", "date"));

        CommandException exc = expectCommandException(() ->
                SpeechKeywordRegistry.set(new JSONArray(),
                        keyword("danger", phrases("danger"), "Danger recognized.", action)));

        assertEquals(CommandErrorCodes.COMMAND_NOT_ALLOWED, exc.code());
    }

    @Test
    public void torchActionDefaultsAndBoundsAreEnforced() throws Exception {
        JSONObject noArgs = new JSONObject().put("command", "torch.set");
        JSONObject sanitized = SpeechKeywordActionExecutor.sanitize(noArgs);

        assertEquals("torch.set", sanitized.optString("command"));
        assertTrue(sanitized.optJSONObject("args").optBoolean("enabled"));
        assertEquals(600, sanitized.optJSONObject("args").optInt("auto_off_ms"));

        CommandException tooLong = expectCommandException(() ->
                SpeechKeywordActionExecutor.sanitize(torchAction(1600)));
        CommandException tooShort = expectCommandException(() ->
                SpeechKeywordActionExecutor.sanitize(torchAction(99)));

        assertEquals(CommandErrorCodes.MALFORMED_COMMAND, tooLong.code());
        assertEquals(CommandErrorCodes.MALFORMED_COMMAND, tooShort.code());
    }

    @Test
    public void photoCaptureActionDefaultsAndBoundsAreEnforced() throws Exception {
        JSONObject noArgs = new JSONObject().put("command", "photo.capture");
        JSONObject sanitized = SpeechKeywordActionExecutor.sanitize(noArgs);

        assertEquals("photo.capture", sanitized.optString("command"));
        assertEquals(1280, sanitized.optJSONObject("args").optInt("max_width"));
        assertEquals(8000, sanitized.optJSONObject("args").optLong("timeout_ms"));

        JSONObject custom = SpeechKeywordActionExecutor.sanitize(new JSONObject()
                .put("command", "photo.capture")
                .put("args", new JSONObject()
                        .put("max_width", 1920)
                        .put("timeout_ms", 15000)
                        .put("camera_id", "0")
                        .put("ignored", "not forwarded")));

        assertEquals(1920, custom.optJSONObject("args").optInt("max_width"));
        assertEquals(15000, custom.optJSONObject("args").optLong("timeout_ms"));
        assertEquals("0", custom.optJSONObject("args").optString("camera_id"));
        assertFalse(custom.optJSONObject("args").has("ignored"));

        CommandException tooWide = expectCommandException(() ->
                SpeechKeywordActionExecutor.sanitize(photoAction(4096, 8000)));
        CommandException tooSlow = expectCommandException(() ->
                SpeechKeywordActionExecutor.sanitize(photoAction(1280, 20000)));

        assertEquals(CommandErrorCodes.MALFORMED_COMMAND, tooWide.code());
        assertEquals(CommandErrorCodes.MALFORMED_COMMAND, tooSlow.code());
    }

    @Test
    public void locationPinActionDefaultsToFourSecondFreshRequest() throws Exception {
        JSONObject sanitized = SpeechKeywordActionExecutor.sanitize(
                new JSONObject().put("command", "location.pin"));

        assertEquals("location.pin", sanitized.optString("command"));
        assertEquals(4000L, sanitized.optJSONObject("args").optLong("timeout_ms"));
        assertTrue(sanitized.optJSONObject("args").optBoolean("fresh"));
        assertFalse(sanitized.optJSONObject("args").optBoolean("publish"));

        CommandException tooSlow = expectCommandException(() ->
                SpeechKeywordActionExecutor.sanitize(new JSONObject()
                        .put("command", "location.pin")
                        .put("args", new JSONObject().put("timeout_ms", 45000))));

        assertEquals(CommandErrorCodes.MALFORMED_COMMAND, tooSlow.code());
    }

    @Test
    public void screenshotCaptureActionDefaultsToPublishing() throws Exception {
        JSONObject sanitized = SpeechKeywordActionExecutor.sanitize(
                new JSONObject().put("command", "screenshot.capture"));

        assertEquals("screenshot.capture", sanitized.optString("command"));
        assertEquals(4000L, sanitized.optJSONObject("args").optLong("timeout_ms"));
        assertTrue(sanitized.optJSONObject("args").optBoolean("publish"));
    }

    @Test
    public void videoCaptureStartStopActionsAreAllowlisted() throws Exception {
        JSONObject start = SpeechKeywordActionExecutor.sanitize(
                new JSONObject().put("command", "video.capture.start"));
        JSONObject stop = SpeechKeywordActionExecutor.sanitize(
                new JSONObject().put("command", "video.capture.stop")
                        .put("args", new JSONObject().put("ignored", true)));

        assertEquals("video.capture.start", start.optString("command"));
        assertEquals(1280, start.optJSONObject("args").optInt("max_width"));
        assertEquals(60000L, start.optJSONObject("args").optLong("max_duration_ms"));
        assertEquals("video.capture.stop", stop.optString("command"));
        assertFalse(stop.optJSONObject("args").has("ignored"));
    }

    @Test
    public void keywordActionArgsMustBeJsonObjectWhenPresent() throws Exception {
        CommandException exc = expectCommandException(() ->
                SpeechKeywordActionExecutor.sanitize(new JSONObject()
                        .put("command", "screenshot.capture")
                        .put("args", new JSONArray().put("bad"))));

        assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
    }

    @Test
    public void dynamicPhotoKeywordMatchesExactUtteranceOnly() throws Exception {
        SpeechKeywordRegistry.SetResult result = SpeechKeywordRegistry.set(new JSONArray(),
                keyword("photo", phrases("photo"), "Photo captured.", photoAction(1280, 8000)));

        SpeechKeywordMatcher.Match exact = SpeechKeywordRegistry.match("Photo!", result.entries);
        SpeechKeywordMatcher.Match longer = SpeechKeywordRegistry.match("take a photo", result.entries);

        assertTrue(exact.matched);
        assertEquals("photo", exact.id);
        assertEquals("photo.capture", exact.action.optString("command"));
        assertFalse(longer.matched);
    }

    @Test
    public void emptyPhrasesAreRejected() throws Exception {
        CommandException exc = expectCommandException(() ->
                SpeechKeywordRegistry.set(new JSONArray(),
                        keyword("flashlight", phrases("   "), "Flashlight recognized.", torchAction(600))));

        assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
    }

    private static JSONObject flashlightKeyword() throws Exception {
        return keyword("flashlight", phrases("flashlight", "flash light"),
                "Flashlight recognized.", torchAction(600));
    }

    private static JSONObject keyword(String id, JSONArray phrases, String reply, JSONObject action)
            throws Exception {
        return new JSONObject()
                .put("id", id)
                .put("phrases", phrases)
                .put("reply_text", reply)
                .put("action", action);
    }

    private static JSONArray phrases(String... values) {
        JSONArray out = new JSONArray();
        for (String value : values) {
            out.put(value);
        }
        return out;
    }

    private static JSONObject torchAction(int autoOffMs) throws Exception {
        return new JSONObject()
                .put("command", "torch.set")
                .put("args", new JSONObject().put("auto_off_ms", autoOffMs));
    }

    private static JSONObject photoAction(int maxWidth, long timeoutMs) throws Exception {
        return new JSONObject()
                .put("command", "photo.capture")
                .put("args", new JSONObject()
                        .put("max_width", maxWidth)
                        .put("timeout_ms", timeoutMs));
    }

    private static JSONObject screenshotAction() throws Exception {
        return new JSONObject()
                .put("command", "screenshot.capture")
                .put("args", new JSONObject().put("publish", true));
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
