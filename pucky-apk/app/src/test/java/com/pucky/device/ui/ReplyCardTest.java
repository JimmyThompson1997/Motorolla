package com.pucky.device.ui;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.List;

public final class ReplyCardTest {
    @Test
    public void parsesRequiredTitleAndOptionalFieldsWithoutId() throws Exception {
        JSONObject input = new JSONObject()
                .put("title", " Morning launch ")
                .put("tag", " Today ")
                .put("summary", "Brief me")
                .put("icon", "clock")
                .put("emoji", "\uD83D\uDCBC")
                .put("accent", "#ffb000")
                .put("audio_path", "/tmp/audio.m4a")
                .put("html_path", "/tmp/reply.html");

        ReplyCard card = ReplyCard.fromJson(input);

        assertEquals("Morning launch", card.title());
        assertEquals("Today", card.tag());
        assertEquals("Brief me", card.summary());
        assertEquals("clock", card.icon());
        assertEquals("\uD83D\uDCBC", card.emoji());
        assertEquals("#ffb000", card.accent());
        assertEquals("/tmp/audio.m4a", card.audioPath());
        assertEquals("/tmp/reply.html", card.htmlPath());
        assertFalse(card.toJson().has("id"));
        assertEquals("\uD83D\uDCBC", card.toJson().getString("emoji"));
    }

    @Test
    public void rejectsMissingOrBlankTitle() throws Exception {
        try {
            ReplyCard.fromJson(new JSONObject().put("summary", "No title"));
            fail("Expected blank title to fail");
        } catch (CommandException exc) {
            assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
        }

        try {
            ReplyCard.fromJson(new JSONObject().put("title", "   "));
            fail("Expected blank title to fail");
        } catch (CommandException exc) {
            assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
        }
    }

    @Test
    public void listParsingPreservesArrayOrder() throws Exception {
        JSONArray input = new JSONArray()
                .put(new JSONObject().put("title", "First"))
                .put(new JSONObject().put("title", "Second"));

        List<ReplyCard> cards = ReplyCard.listFromJson(input);

        assertEquals(2, cards.size());
        assertEquals("First", cards.get(0).title());
        assertEquals("Second", cards.get(1).title());
        assertTrue(ReplyCard.listToJson(cards).getJSONObject(0).has("title"));
    }
}
