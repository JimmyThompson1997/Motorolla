package com.pucky.device.wake;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class WakeRestartPolicyTest {
    @Test
    public void finalNoMatchDelayStaysShort() {
        assertEquals(250L, WakeRestartPolicy.FINAL_NO_MATCH_DELAY_MS);
    }

    @Test
    public void errorDelayBackoffCapsAtTwoSeconds() {
        assertEquals(250L, WakeRestartPolicy.errorDelayMs(0));
        assertEquals(250L, WakeRestartPolicy.errorDelayMs(1));
        assertEquals(500L, WakeRestartPolicy.errorDelayMs(2));
        assertEquals(1000L, WakeRestartPolicy.errorDelayMs(3));
        assertEquals(2000L, WakeRestartPolicy.errorDelayMs(4));
        assertEquals(2000L, WakeRestartPolicy.errorDelayMs(8));
    }
}
