package com.pucky.device.pucky;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;

import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

public final class PuckyTurnResponseTest {
    @Test
    public void parsesReplyAudioAndOptionalHtmlCard() throws Exception {
        String audio = Base64.getEncoder().encodeToString(new byte[] {1, 2, 3, 4});
        String html = Base64.getEncoder().encodeToString("<!doctype html>".getBytes(StandardCharsets.UTF_8));
        PuckyTurnResponse response = PuckyTurnResponse.fromJson(new JSONObject()
                .put("session_id", " pucky_session_1 ")
                .put("text", " Sure, here you go. ")
                .put("audio_mime_type", "audio/wav")
                .put("audio_base64", audio)
                .put("origin", new JSONObject()
                        .put("runtime", "codex")
                        .put("thread_id", "thread-1")
                        .put("model", "gpt-5.5"))
                .put("card", new JSONObject()
                        .put("title", " Helpful Thing ")
                        .put("icon", "bolt")
                        .put("html_base64", html)));

        assertEquals("pucky_session_1", response.sessionId());
        assertEquals("Sure, here you go.", response.text());
        assertEquals("audio/wav", response.audioMimeType());
        assertTrue(response.hasAudio());
        assertArrayEquals(new byte[] {1, 2, 3, 4}, response.audioBytes());
        assertEquals("Helpful Thing", response.cardTitle());
        assertEquals("bolt", response.cardIcon());
        assertEquals("thread-1", response.origin().getString("thread_id"));
        assertEquals("gpt-5.5", response.origin().getString("model"));
        assertTrue(response.hasHtml());
        assertEquals("<!doctype html>", new String(response.htmlBytes(), StandardCharsets.UTF_8));
    }

    @Test
    public void fallsBackTitleIconAndNoHtml() throws Exception {
        PuckyTurnResponse response = PuckyTurnResponse.fromJson(new JSONObject()
                .put("text", "This is a reply.")
                .put("audio_mime_type", "audio/wav")
                .put("audio_base64", Base64.getEncoder().encodeToString(new byte[] {9}))
                .put("card", new JSONObject().put("icon", "sparkles")));

        assertEquals("This is a reply.", response.cardTitle());
        assertEquals("mail", response.cardIcon());
        assertFalse(response.hasHtml());
    }

    @Test
    public void parsesCardOnlyTurnWithoutAudio() throws Exception {
        PuckyTurnResponse response = PuckyTurnResponse.fromJson(new JSONObject()
                .put("turn_id", "pucky_card_only")
                .put("text", "Card only answer.")
                .put("reply_mode", "card_only")
                .put("card", new JSONObject().put("title", "Answer")));

        assertEquals("pucky_card_only", response.turnId());
        assertEquals("pucky_card_only", response.sessionId());
        assertEquals("Card only answer.", response.text());
        assertFalse(response.hasAudio());
        assertEquals("", response.audioMimeType());
        assertArrayEquals(new byte[0], response.audioBytes());
        assertEquals("Answer", response.cardTitle());
    }

    @Test
    public void rejectsMalformedJsonAndBadBase64() throws Exception {
        try {
            PuckyTurnResponse.fromJson("{not json");
            fail("Expected malformed JSON to fail");
        } catch (CommandException exc) {
            assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
        }

        try {
            PuckyTurnResponse.fromJson(new JSONObject()
                    .put("text", "Reply")
                    .put("audio_mime_type", "audio/wav")
                    .put("audio_base64", "not base64"));
            fail("Expected bad audio base64 to fail");
        } catch (CommandException exc) {
            assertEquals(CommandErrorCodes.MALFORMED_COMMAND, exc.code());
        }
    }
}
