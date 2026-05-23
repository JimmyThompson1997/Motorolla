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
