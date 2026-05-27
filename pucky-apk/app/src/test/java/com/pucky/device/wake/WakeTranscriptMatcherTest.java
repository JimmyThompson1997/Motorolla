package com.pucky.device.wake;

import static org.junit.Assert.assertEquals;

import org.json.JSONArray;
import org.junit.Test;

public final class WakeTranscriptMatcherTest {
    @Test
    public void partialAcceptsMultiWordWakePhrases() {
        assertEquals("hey pucky", WakeTranscriptMatcher.matchPartial("Hey Pucky", null));
        assertEquals("hey bucky", WakeTranscriptMatcher.matchPartial("Hey Bucky what is this", null));
        assertEquals("hey pookie", WakeTranscriptMatcher.matchPartial("Hey Pookie", null));
    }

    @Test
    public void partialRejectsSingleWordWakePhrases() {
        assertEquals("", WakeTranscriptMatcher.matchPartial("Pucky", null));
        assertEquals("", WakeTranscriptMatcher.matchPartial("Pucky test 123", null));
    }

    @Test
    public void finalAcceptsSingleWordAndPrefixWakePhrases() {
        assertEquals("pucky", WakeTranscriptMatcher.matchFinal("Pucky", null));
        assertEquals("pucky", WakeTranscriptMatcher.matchFinal("Pucky test 123", null));
        assertEquals("hey pucky", WakeTranscriptMatcher.matchFinal("Hey Pucky", null));
    }

    @Test
    public void alternativesCanCarryTheWakeMatch() {
        JSONArray alternatives = new JSONArray();
        alternatives.put("Parking");
        alternatives.put("Hey Pucky");
        assertEquals("hey pucky", WakeTranscriptMatcher.matchFinal("Parking", alternatives));
    }

    @Test
    public void riskyCommonNearMissesStayRejected() {
        assertEquals("", WakeTranscriptMatcher.matchFinal("Parking", null));
        assertEquals("", WakeTranscriptMatcher.matchFinal("Can you hear me at all", null));
        assertEquals("", WakeTranscriptMatcher.matchPartial("Lucky day", null));
        assertEquals("", WakeTranscriptMatcher.matchFinal("Puppet show", null));
    }
}
