package com.pucky.device.wake;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class WakeProbeCapturePolicyTest {
    @Test
    public void stopsOnTrailingSilenceAfterObservedSpeech() {
        WakeProbeCapturePolicy policy = new WakeProbeCapturePolicy(600L, 2500L, 0.5);
        policy.begin(0L);

        assertEquals(WakeProbeCapturePolicy.Action.NONE, policy.observe(100L, 0.8));
        assertEquals(WakeProbeCapturePolicy.Action.NONE, policy.observe(500L, 0.1));
        assertEquals(WakeProbeCapturePolicy.Action.STOP_TRAILING_SILENCE, policy.observe(705L, 0.1));
    }

    @Test
    public void stopsAtMaxDurationWhenProbeKeepsRunning() {
        WakeProbeCapturePolicy policy = new WakeProbeCapturePolicy(600L, 2500L, 0.5);
        policy.begin(0L);

        assertEquals(WakeProbeCapturePolicy.Action.NONE, policy.observe(100L, 0.7));
        assertEquals(WakeProbeCapturePolicy.Action.NONE, policy.observe(2400L, 0.7));
        assertEquals(WakeProbeCapturePolicy.Action.STOP_MAX_DURATION, policy.observe(2500L, 0.7));
    }
}
