package com.pucky.device.speech;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class SpeechKeywordMatcherTest {
    @Test
    public void recognizesHeyPuckyCanonicalAndAliases() {
        assertReply("Hey Pucky", "hey_pucky", "Hey Pucky recognized.", "canonical");
        assertReply("Hey Puppy!", "hey_pucky", "Hey Pucky recognized.", "alias:hey puppy");
        assertReply("Hey lucky.", "hey_pucky", "Hey Pucky recognized.", "alias:hey lucky");
        assertReply("hay pucky", "hey_pucky", "Hey Pucky recognized.", "alias:hay pucky");
        assertReply("Pucky.", "hey_pucky", "Hey Pucky recognized.", "alias:pucky");
        assertReply("Puppy.", "hey_pucky", "Hey Pucky recognized.", "alias:puppy");
    }

    @Test
    public void recognizesMicOnCanonicalAndAliases() {
        assertReply("mic on", "mic_on", "Mic on recognized.", "canonical");
        assertReply("mike on", "mic_on", "Mic on recognized.", "alias:mike on");
        assertReply("please turn microphone on now", "mic_on", "Mic on recognized.", "alias:microphone on");
    }

    @Test
    public void recognizesMicOffCanonicalAndAliases() {
        assertReply("mic off", "mic_off", "Mic off recognized.", "canonical");
        assertReply("mike off", "mic_off", "Mic off recognized.", "alias:mike off");
        assertReply("please microphone off now", "mic_off", "Mic off recognized.", "alias:microphone off");
    }

    @Test
    public void doesNotMatchInsideLongerWords() {
        SpeechKeywordMatcher.Match match = SpeechKeywordMatcher.match("comic on stage");

        assertFalse(match.matched);
        assertEquals("comic on stage", match.normalizedTranscript);
    }

    @Test
    public void earliestKeywordWins() {
        SpeechKeywordMatcher.Match match = SpeechKeywordMatcher.match("Hey Pucky please mic off");

        assertTrue(match.matched);
        assertEquals("hey_pucky", match.id);
        assertEquals("Hey Pucky recognized.", match.replyText);
    }

    @Test
    public void tiedKeywordsUsePriority() {
        SpeechKeywordMatcher.Match match = SpeechKeywordMatcher.match("microphone off");

        assertTrue(match.matched);
        assertEquals("mic_off", match.id);
        assertEquals("Mic off recognized.", match.replyText);
    }

    @Test
    public void unmatchedTextReturnsNormalizedTranscriptForTelemetry() {
        SpeechKeywordMatcher.Match match = SpeechKeywordMatcher.match("Four score and seven.");

        assertFalse(match.matched);
        assertEquals("four score and seven", match.normalizedTranscript);
        assertEquals("", match.replyText);
    }

    private static void assertReply(String raw, String expectedId, String expectedReply, String expectedSource) {
        SpeechKeywordMatcher.Match match = SpeechKeywordMatcher.match(raw);

        assertTrue(match.matched);
        assertEquals(expectedId, match.id);
        assertEquals(expectedReply, match.replyText);
        assertEquals(expectedSource, match.source);
    }
}
