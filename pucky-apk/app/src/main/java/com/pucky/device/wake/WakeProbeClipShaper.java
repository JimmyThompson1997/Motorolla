package com.pucky.device.wake;

import com.pucky.device.speech.lab.AudioFrameBus;

import java.util.Arrays;

final class WakeProbeClipShaper {
    private static final int SAMPLE_RATE = AudioFrameBus.SAMPLE_RATE;
    private static final int MAX_PREROLL_SAMPLES = SAMPLE_RATE * 250 / 1000;
    private static final int MAX_CONFIRM_SAMPLES = SAMPLE_RATE * 1600 / 1000;
    private static final int PRE_SPEECH_PAD_SAMPLES = MAX_PREROLL_SAMPLES;
    private static final int POST_SPEECH_PAD_SAMPLES = SAMPLE_RATE * 120 / 1000;
    private static final int WINDOW_SAMPLES = SAMPLE_RATE * 20 / 1000;
    private static final double WINDOW_MEAN_ABS_THRESHOLD = 80.0;
    private static final int WINDOW_PEAK_ABS_THRESHOLD = 300;

    private WakeProbeClipShaper() {
    }

    static short[] limitPreRoll(short[] preRoll) {
        if (preRoll == null || preRoll.length <= MAX_PREROLL_SAMPLES) {
            return preRoll == null ? new short[0] : Arrays.copyOf(preRoll, preRoll.length);
        }
        return Arrays.copyOfRange(preRoll, preRoll.length - MAX_PREROLL_SAMPLES, preRoll.length);
    }

    static short[] shapeForConfirmation(short[] rawSamples) {
        if (rawSamples == null || rawSamples.length == 0) {
            return new short[0];
        }
        int firstSpeech = firstSpeechLikeOffset(rawSamples);
        int lastSpeech = lastSpeechLikeOffset(rawSamples);
        if (firstSpeech >= 0 && lastSpeech >= firstSpeech) {
            int start = Math.max(0, firstSpeech - PRE_SPEECH_PAD_SAMPLES);
            int endExclusive = Math.min(rawSamples.length, lastSpeech + POST_SPEECH_PAD_SAMPLES);
            return capDuration(Arrays.copyOfRange(rawSamples, start, endExclusive));
        }
        return capDuration(rawSamples);
    }

    private static short[] capDuration(short[] samples) {
        if (samples.length <= MAX_CONFIRM_SAMPLES) {
            return Arrays.copyOf(samples, samples.length);
        }
        return Arrays.copyOf(samples, MAX_CONFIRM_SAMPLES);
    }

    private static int firstSpeechLikeOffset(short[] samples) {
        for (int offset = 0; offset < samples.length; offset += WINDOW_SAMPLES) {
            int endExclusive = Math.min(samples.length, offset + WINDOW_SAMPLES);
            if (isSpeechLikeWindow(samples, offset, endExclusive)) {
                return offset;
            }
        }
        return -1;
    }

    private static int lastSpeechLikeOffset(short[] samples) {
        for (int endExclusive = samples.length; endExclusive > 0; endExclusive -= WINDOW_SAMPLES) {
            int start = Math.max(0, endExclusive - WINDOW_SAMPLES);
            if (isSpeechLikeWindow(samples, start, endExclusive)) {
                return endExclusive;
            }
        }
        return -1;
    }

    private static boolean isSpeechLikeWindow(short[] samples, int start, int endExclusive) {
        if (start >= endExclusive) {
            return false;
        }
        long sumAbs = 0L;
        int peakAbs = 0;
        for (int index = start; index < endExclusive; index += 1) {
            int abs = Math.abs(samples[index]);
            sumAbs += abs;
            if (abs > peakAbs) {
                peakAbs = abs;
            }
        }
        double meanAbs = sumAbs / (double) (endExclusive - start);
        return peakAbs >= WINDOW_PEAK_ABS_THRESHOLD || meanAbs >= WINDOW_MEAN_ABS_THRESHOLD;
    }
}
