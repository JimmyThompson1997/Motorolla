package com.pucky.device.wake;

final class WakeProbeCapturePolicy {
    enum Action {
        NONE,
        STOP_TRAILING_SILENCE,
        STOP_MAX_DURATION
    }

    private final long trailingSilenceMs;
    private final long maxDurationMs;
    private final double speechProbabilityThreshold;

    private long startedMs;
    private long lastSpeechMs = -1L;
    private boolean speechObserved;

    WakeProbeCapturePolicy(long trailingSilenceMs, long maxDurationMs, double speechProbabilityThreshold) {
        this.trailingSilenceMs = trailingSilenceMs;
        this.maxDurationMs = maxDurationMs;
        this.speechProbabilityThreshold = speechProbabilityThreshold;
    }

    void begin(long startedMs) {
        this.startedMs = startedMs;
        this.lastSpeechMs = -1L;
        this.speechObserved = false;
    }

    Action observe(long nowMs, double vadProbability) {
        if (vadProbability >= speechProbabilityThreshold) {
            speechObserved = true;
            lastSpeechMs = nowMs;
        }
        if (nowMs - startedMs >= maxDurationMs) {
            return Action.STOP_MAX_DURATION;
        }
        if (speechObserved && lastSpeechMs > 0L && nowMs - lastSpeechMs >= trailingSilenceMs) {
            return Action.STOP_TRAILING_SILENCE;
        }
        return Action.NONE;
    }
}
