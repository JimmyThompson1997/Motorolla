package com.pucky.device.wake;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.junit.Test;

public final class WakeSttSentinelDecisionTest {
    @Test
    public void finalResultAcceptsSingleWordWake() {
        WakeSttSentinelDecision decision = WakeSttSentinelDecision.decide(values("Pucky"), false);

        assertTrue(decision.accepted);
        assertEquals("pucky", decision.matchedPhrase);
        assertEquals("Pucky", decision.transcript);
    }

    @Test
    public void partialResultAcceptsMultiWordWakeForSpeed() {
        WakeSttSentinelDecision decision = WakeSttSentinelDecision.decide(values("Hey Bucky"), true);

        assertTrue(decision.accepted);
        assertEquals("hey bucky", decision.matchedPhrase);
    }

    @Test
    public void partialResultRejectsSingleWordWakeUntilFinal() {
        WakeSttSentinelDecision decision = WakeSttSentinelDecision.decide(values("Pucky"), true);

        assertFalse(decision.accepted);
    }

    @Test
    public void alternativesCanAcceptWakeWhenPrimaryMisses() {
        WakeSttSentinelDecision decision = WakeSttSentinelDecision.decide(
                values("Cheap Android devices", "Hey Pucky"),
                false);

        assertTrue(decision.accepted);
        assertEquals("hey pucky", decision.matchedPhrase);
        assertEquals("Hey Pucky", decision.transcript);
    }

    @Test
    public void unrelatedPhraseRemainsRejected() {
        WakeSttSentinelDecision decision = WakeSttSentinelDecision.decide(values("Parking"), false);

        assertFalse(decision.accepted);
    }

    private static JSONArray values(String... items) {
        JSONArray out = new JSONArray();
        for (String item : items) {
            Json.add(out, item);
        }
        return out;
    }
}
