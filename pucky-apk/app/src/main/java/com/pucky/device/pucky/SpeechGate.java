package com.pucky.device.pucky;

import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class SpeechGate {
    private final long startedElapsedMs;
    private final int threshold;
    private final long startupGuardMs;

    private boolean speechDetected;
    private long speechStartedElapsedMs = -1L;
    private int peakAmplitude;
    private int samplesSeen;
    private int samplesOverThreshold;

    public SpeechGate(long startedElapsedMs, int threshold, long startupGuardMs) {
        this.startedElapsedMs = startedElapsedMs;
        this.threshold = Math.max(1, threshold);
        this.startupGuardMs = Math.max(0L, startupGuardMs);
    }

    public synchronized boolean sample(int amplitude, long nowElapsedMs) {
        int cleanAmplitude = Math.max(0, amplitude);
        samplesSeen += 1;
        peakAmplitude = Math.max(peakAmplitude, cleanAmplitude);
        boolean eligible = samplesSeen > 1 && nowElapsedMs - startedElapsedMs >= startupGuardMs;
        if (!eligible || cleanAmplitude < threshold) {
            return false;
        }
        samplesOverThreshold += 1;
        if (speechDetected) {
            return false;
        }
        speechDetected = true;
        speechStartedElapsedMs = nowElapsedMs;
        return true;
    }

    public synchronized boolean speechDetected() {
        return speechDetected;
    }

    public synchronized JSONObject statusJson(long nowElapsedMs) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_gate.v1");
        Json.put(out, "threshold", threshold);
        Json.put(out, "startup_guard_ms", startupGuardMs);
        Json.put(out, "speech_detected", speechDetected);
        Json.put(out, "speech_started_elapsed_ms", speechStartedElapsedMs);
        Json.put(out, "peak_amplitude", peakAmplitude);
        Json.put(out, "samples_seen", samplesSeen);
        Json.put(out, "samples_over_threshold", samplesOverThreshold);
        Json.put(out, "elapsed_ms", Math.max(0L, nowElapsedMs - startedElapsedMs));
        Json.put(out, "gate_latency_ms", speechStartedElapsedMs < 0L ? -1L : Math.max(0L, speechStartedElapsedMs - startedElapsedMs));
        return out;
    }
}
