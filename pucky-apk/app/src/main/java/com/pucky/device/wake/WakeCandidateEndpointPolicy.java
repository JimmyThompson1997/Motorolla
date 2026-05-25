package com.pucky.device.wake;

import com.pucky.device.speech.lab.AudioFrameBus;

public final class WakeCandidateEndpointPolicy {
    public static final int SPEECH_THRESHOLD_PERCENT = 50;
    public static final int TRAILING_SILENCE_MS = 450;
    public static final int MIN_SPEECH_MS = 180;
    public static final int MAX_CANDIDATE_MS = 1800;
    public static final int PRE_SPEECH_MS = 150;

    public static final String FINISH_TRAILING_SILENCE = "trailing_silence";
    public static final String FINISH_MAX_DURATION = "max_duration";
    public static final String FINISH_TOO_SHORT = "too_short";

    private WakeCandidateEndpointPolicy() {
    }

    public static int samplesForMs(int ms) {
        return Math.max(1, AudioFrameBus.SAMPLE_RATE * Math.max(1, ms) / 1000);
    }

    public static long durationMs(int samples) {
        return Math.max(0L, samples) * 1000L / AudioFrameBus.SAMPLE_RATE;
    }

    public static String finishReason(int candidateSamples, int speechSamples, int trailingSilenceSamples) {
        if (durationMs(candidateSamples) >= MAX_CANDIDATE_MS) {
            return speechSamples >= samplesForMs(MIN_SPEECH_MS) ? FINISH_MAX_DURATION : FINISH_TOO_SHORT;
        }
        if (speechSamples >= samplesForMs(MIN_SPEECH_MS)
                && trailingSilenceSamples >= samplesForMs(TRAILING_SILENCE_MS)) {
            return FINISH_TRAILING_SILENCE;
        }
        return "";
    }
}
