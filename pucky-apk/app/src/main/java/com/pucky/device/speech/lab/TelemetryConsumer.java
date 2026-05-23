package com.pucky.device.speech.lab;

import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class TelemetryConsumer implements AudioFrameConsumer {
    private long frames;
    private long samples;
    private long sumAbs;
    private long sumSquares;
    private int maxAbs;
    private long firstTimestampNanos;
    private long lastTimestampNanos;

    @Override
    public String name() {
        return "telemetry";
    }

    @Override
    public synchronized void onFrame(short[] frame, long timestampNanos) {
        if (frame == null) {
            return;
        }
        if (frames == 0) {
            firstTimestampNanos = timestampNanos;
        }
        frames += 1;
        lastTimestampNanos = timestampNanos;
        for (short sample : frame) {
            int abs = Math.abs((int) sample);
            maxAbs = Math.max(maxAbs, abs);
            sumAbs += abs;
            sumSquares += (long) sample * sample;
            samples += 1;
        }
    }

    @Override
    public synchronized JSONObject snapshot() {
        double meanAbs = samples == 0 ? 0.0 : sumAbs / (double) samples;
        double rms = samples == 0 ? 0.0 : Math.sqrt(sumSquares / (double) samples);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_lab_telemetry.v1");
        Json.put(out, "frames", frames);
        Json.put(out, "samples", samples);
        Json.put(out, "first_timestamp_nanos", firstTimestampNanos);
        Json.put(out, "last_timestamp_nanos", lastTimestampNanos);
        Json.put(out, "max_abs_pcm16", maxAbs);
        Json.put(out, "mean_abs_pcm16", meanAbs);
        Json.put(out, "rms_pcm16", rms);
        Json.put(out, "noise_floor_dbfs_estimate", rms <= 0.0 ? JSONObject.NULL : 20.0 * Math.log10(rms / 32768.0));
        return out;
    }
}
