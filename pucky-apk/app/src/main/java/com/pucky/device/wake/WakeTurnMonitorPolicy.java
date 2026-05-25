package com.pucky.device.wake;

final class WakeTurnMonitorPolicy {
    enum Action {
        NONE,
        STOP_NO_SPEECH,
        STOP_ENDPOINT,
        STOP_MAX_DURATION
    }

    private final long speechStartTimeoutMs;
    private final long trailingSilenceMs;
    private final long maxTurnMs;
    private final double speechProbabilityThreshold;

    private boolean speechSeen;
    private long lastSpeechMs = -1L;

    WakeTurnMonitorPolicy(long speechStartTimeoutMs, long trailingSilenceMs, long maxTurnMs, double speechProbabilityThreshold) {
        this.speechStartTimeoutMs = speechStartTimeoutMs;
        this.trailingSilenceMs = trailingSilenceMs;
        this.maxTurnMs = maxTurnMs;
        this.speechProbabilityThreshold = speechProbabilityThreshold;
    }

    Action observe(long startedMs, long nowMs, boolean speechDetected, double vadProbability) {
        long elapsedMs = Math.max(0L, nowMs - startedMs);
        if (elapsedMs >= maxTurnMs) {
            return Action.STOP_MAX_DURATION;
        }
        if (!speechSeen) {
            if (!speechDetected) {
                return elapsedMs >= speechStartTimeoutMs ? Action.STOP_NO_SPEECH : Action.NONE;
            }
            speechSeen = true;
            lastSpeechMs = nowMs;
            return Action.NONE;
        }
        if (speechDetected && vadProbability >= speechProbabilityThreshold) {
            lastSpeechMs = nowMs;
            return Action.NONE;
        }
        if (lastSpeechMs > 0L && Math.max(0L, nowMs - lastSpeechMs) >= trailingSilenceMs) {
            return Action.STOP_ENDPOINT;
        }
        return Action.NONE;
    }
}
