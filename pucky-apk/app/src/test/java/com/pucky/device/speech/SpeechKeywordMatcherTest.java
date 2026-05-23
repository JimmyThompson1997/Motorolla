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
        assertReply("Hey Pocky!", "hey_pucky", "Hey Pucky recognized.", "alias:hey pocky");
        assertReply("Hey Packy!", "hey_pucky", "Hey Pucky recognized.", "alias:hey packy");
        assertReply("Pucky.", "hey_pucky", "Hey Pucky recognized.", "alias:pucky");
        assertReply("Puppy.", "hey_pucky", "Hey Pucky recognized.", "alias:puppy");
        assertReply("Pocky.", "hey_pucky", "Hey Pucky recognized.", "alias:pocky");
        assertReply("Packy.", "hey_pucky", "Hey Pucky recognized.", "alias:packy");
    }

    @Test
    public void recognizesMicOnCanonicalAndAliases() {
        assertReply("mic on", "mic_on", "Mic on recognized.", "canonical");
        assertReply("mike on", "mic_on", "Mic on recognized.", "alias:mike on");
        assertReply("microphone on", "mic_on", "Mic on recognized.", "alias:microphone on");
    }

    @Test
    public void recognizesMicOffCanonicalAndAliases() {
        assertReply("mic off", "mic_off", "Mic off recognized.", "canonical");
        assertReply("mike off", "mic_off", "Mic off recognized.", "alias:mike off");
        assertReply("microphone off", "mic_off", "Mic off recognized.", "alias:microphone off");
    }

    @Test
    public void doesNotMatchInsideLongerWords() {
        SpeechKeywordMatcher.Match match = SpeechKeywordMatcher.match("comic on stage");

        assertFalse(match.matched);
        assertEquals("comic on stage", match.normalizedTranscript);
    }

    @Test
    public void keywordsMustBeFullUtteranceMatches() {
        assertNoMatch("Hey Pucky please mic off", "hey pucky please mic off");
        assertNoMatch("please turn microphone on now", "please turn microphone on now");
        assertNoMatch("Microphone off hand?", "microphone off hand");
        assertNoMatch("You gotta skate to where the Pocky's going.", "you gotta skate to where the pocky s going");
        assertNoMatch("You gotta skate to where the Packy's going.", "you gotta skate to where the packy s going");
        assertNoMatch("camera on please", "camera on please");
    }

    @Test
    public void punctuationAndCaseAreIgnoredForExactUtterances() {
        assertReply("HEY, PUCKY!", "hey_pucky", "Hey Pucky recognized.", "canonical");
        assertReply("  microphone   off  ", "mic_off", "Mic off recognized.", "alias:microphone off");
    }

    @Test
    public void longerUtteranceWithMultipleKeywordsDoesNotMatch() {
        SpeechKeywordMatcher.Match match = SpeechKeywordMatcher.match("Hey Pucky please mic off");

        assertFalse(match.matched);
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

    private static void assertNoMatch(String raw, String expectedNormalized) {
        SpeechKeywordMatcher.Match match = SpeechKeywordMatcher.match(raw);

        assertFalse(match.matched);
        assertEquals(expectedNormalized, match.normalizedTranscript);
        assertEquals("none", match.source);
        assertEquals(-1, match.startIndex);
    }
}
