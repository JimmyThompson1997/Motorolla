package com.pucky.device.wake;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class WakeTurnMonitorPolicyTest {
    @Test
    public void stopsWhenNoSpeechBeginsWithinTimeout() {
        WakeTurnMonitorPolicy policy = new WakeTurnMonitorPolicy(3000L, 1000L, 20000L, 0.5);

        assertEquals(WakeTurnMonitorPolicy.Action.NONE, policy.observe(0L, 2500L, false, 0.0));
        assertEquals(WakeTurnMonitorPolicy.Action.STOP_NO_SPEECH, policy.observe(0L, 3000L, false, 0.0));
    }

    @Test
    public void stopsAfterTrailingSilenceOnceSpeechHasStarted() {
        WakeTurnMonitorPolicy policy = new WakeTurnMonitorPolicy(3000L, 1000L, 20000L, 0.5);

        assertEquals(WakeTurnMonitorPolicy.Action.NONE, policy.observe(0L, 500L, true, 0.8));
        assertEquals(WakeTurnMonitorPolicy.Action.NONE, policy.observe(0L, 900L, true, 0.7));
        assertEquals(WakeTurnMonitorPolicy.Action.NONE, policy.observe(0L, 1500L, true, 0.1));
        assertEquals(WakeTurnMonitorPolicy.Action.STOP_ENDPOINT, policy.observe(0L, 1905L, true, 0.1));
    }

    @Test
    public void stopsAtMaxDurationEvenIfSpeechContinues() {
        WakeTurnMonitorPolicy policy = new WakeTurnMonitorPolicy(3000L, 1000L, 2000L, 0.5);

        assertEquals(WakeTurnMonitorPolicy.Action.NONE, policy.observe(0L, 200L, true, 0.7));
        assertEquals(WakeTurnMonitorPolicy.Action.STOP_MAX_DURATION, policy.observe(0L, 2000L, true, 0.7));
    }
}
