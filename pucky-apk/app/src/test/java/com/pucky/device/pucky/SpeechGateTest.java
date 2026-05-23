package com.pucky.device.pucky;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

public final class SpeechGateTest {
    @Test
    public void ignoresFirstSampleAndTriggersOnThresholdWithinOnePoll() throws Exception {
        SpeechGate gate = new SpeechGate(1_000L, 1_200, 25L);

        assertFalse(gate.sample(8_000, 1_000L));
        assertFalse(gate.sample(1_199, 1_025L));
        assertTrue(gate.sample(1_200, 1_050L));

        JSONObject status = gate.statusJson(1_050L);
        assertTrue(status.getBoolean("speech_detected"));
        assertEquals(8_000, status.getInt("peak_amplitude"));
        assertEquals(3, status.getInt("samples_seen"));
        assertEquals(1, status.getInt("samples_over_threshold"));
        assertEquals(50, status.getLong("gate_latency_ms"));
    }

    @Test
    public void staysArmedBelowThreshold() throws Exception {
        SpeechGate gate = new SpeechGate(2_000L, 1_200, 25L);

        assertFalse(gate.sample(0, 2_000L));
        assertFalse(gate.sample(700, 2_040L));
        assertFalse(gate.sample(1_199, 2_080L));

        JSONObject status = gate.statusJson(2_080L);
        assertFalse(status.getBoolean("speech_detected"));
        assertEquals(1_199, status.getInt("peak_amplitude"));
        assertEquals(3, status.getInt("samples_seen"));
        assertEquals(0, status.getInt("samples_over_threshold"));
        assertEquals(-1, status.getLong("gate_latency_ms"));
    }
}
