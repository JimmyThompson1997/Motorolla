package com.pucky.device.wake;

public final class WakeRestartPolicy {
    public static final long FINAL_NO_MATCH_DELAY_MS = 250L;
    public static final long MAX_ERROR_DELAY_MS = 2000L;

    private WakeRestartPolicy() {
    }

    public static long errorDelayMs(int consecutiveErrorCount) {
        if (consecutiveErrorCount <= 1) {
            return 250L;
        }
        long delay = 250L;
        for (int i = 1; i < consecutiveErrorCount; i++) {
            delay = Math.min(MAX_ERROR_DELAY_MS, delay * 2L);
        }
        return Math.min(MAX_ERROR_DELAY_MS, delay);
    }
}
