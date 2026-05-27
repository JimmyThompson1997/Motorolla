package com.pucky.device.pucky;

import com.pucky.device.speech.lab.AudioFrameBus;
import com.pucky.device.speech.lab.AudioFrameConsumer;
import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class WalkieSpeechGate implements AudioFrameConsumer {
    public static final int SAMPLE_RATE = AudioFrameBus.SAMPLE_RATE;
    public static final int WINDOW_SAMPLES = 512;
    public static final double DEFAULT_SPEECH_THRESHOLD = 0.5;

    private final long startedElapsedMs;
    private final VadEngine engine;
    private final ElapsedClock clock;
    private final Listener listener;
    private final float[] window = new float[WINDOW_SAMPLES];

    private int windowSamples;
    private boolean speechDetected;
    private long speechStartedElapsedMs = -1L;
    private long lastSpeechElapsedMs = -1L;
    private int peakAmplitude;
    private long framesSeen;
    private long vadWindowsSeen;
    private long speechFrames;
    private double latestVadProbability;
    private double maxVadProbability;
    private String lastError = "";

    public interface ElapsedClock {
        long elapsedRealtimeMs();
    }

    public interface Listener {
        void onSpeechDetected(JSONObject status);
    }

    public WalkieSpeechGate(long startedElapsedMs, VadEngine engine, ElapsedClock clock, Listener listener) {
        this.startedElapsedMs = startedElapsedMs;
        this.engine = engine;
        this.clock = clock;
        this.listener = listener;
        this.engine.reset();
    }

    @Override
    public String name() {
        return "walkie_speech_gate";
    }

    @Override
    public synchronized void onFrame(short[] frame, long timestampNanos) {
        framesSeen += 1;
        if (frame == null || frame.length == 0) {
            return;
        }
        for (short value : frame) {
            int abs = Math.abs((int) value);
            if (abs > peakAmplitude) {
                peakAmplitude = abs;
            }
            window[windowSamples++] = value / 32768.0f;
            if (windowSamples == WINDOW_SAMPLES) {
                evaluateWindow();
                windowSamples = 0;
            }
        }
    }

    @Override
    public synchronized JSONObject snapshot() {
        return statusJson();
    }

    public synchronized boolean speechDetected() {
        return speechDetected;
    }

    public synchronized JSONObject statusJson() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.walkie_speech_gate.v1");
        Json.put(out, "vad_engine", engine.name());
        Json.put(out, "vad_available", engine.available());
        Json.put(out, "unavailable_reason", engine.available() ? "" : cleanUnavailableReason());
        Json.put(out, "speech_threshold", DEFAULT_SPEECH_THRESHOLD);
        Json.put(out, "speech_detected", speechDetected);
        Json.put(out, "speech_started_elapsed_ms", speechStartedElapsedMs);
        Json.put(out, "last_speech_elapsed_ms", lastSpeechElapsedMs);
        Json.put(out, "speech_duration_ms",
                speechStartedElapsedMs < 0L ? 0L : Math.max(0L, clock.elapsedRealtimeMs() - speechStartedElapsedMs));
        Json.put(out, "trailing_silence_ms",
                lastSpeechElapsedMs < 0L ? 0L : Math.max(0L, clock.elapsedRealtimeMs() - lastSpeechElapsedMs));
        Json.put(out, "peak_amplitude", peakAmplitude);
        Json.put(out, "frames_seen", framesSeen);
        Json.put(out, "vad_windows_seen", vadWindowsSeen);
        Json.put(out, "speech_frames", speechFrames);
        Json.put(out, "vad_probability", latestVadProbability);
        Json.put(out, "max_vad_probability", maxVadProbability);
        Json.put(out, "sample_rate", SAMPLE_RATE);
        Json.put(out, "window_samples", WINDOW_SAMPLES);
        Json.put(out, "elapsed_ms", Math.max(0L, clock.elapsedRealtimeMs() - startedElapsedMs));
        Json.put(out, "gate_latency_ms", speechStartedElapsedMs < 0L ? -1L : Math.max(0L, speechStartedElapsedMs - startedElapsedMs));
        Json.put(out, "last_error", lastError.isEmpty() ? JSONObject.NULL : lastError);
        return out;
    }

    private void evaluateWindow() {
        vadWindowsSeen += 1;
        if (!engine.available()) {
            latestVadProbability = 0.0;
            return;
        }
        try {
            latestVadProbability = clampProbability(engine.speechProbability(window.clone(), SAMPLE_RATE));
            maxVadProbability = Math.max(maxVadProbability, latestVadProbability);
            if (latestVadProbability < DEFAULT_SPEECH_THRESHOLD) {
                return;
            }
            speechFrames += 1;
            lastSpeechElapsedMs = clock.elapsedRealtimeMs();
            if (speechDetected) {
                return;
            }
            speechDetected = true;
            speechStartedElapsedMs = lastSpeechElapsedMs;
            listener.onSpeechDetected(statusJson());
        } catch (RuntimeException exc) {
            lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
        }
    }

    private String cleanUnavailableReason() {
        String reason = engine.unavailableReason();
        return reason == null || reason.trim().isEmpty() ? "vad_unavailable" : reason.trim();
    }

    private static double clampProbability(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value)) {
            return 0.0;
        }
        return Math.max(0.0, Math.min(1.0, value));
    }
}
