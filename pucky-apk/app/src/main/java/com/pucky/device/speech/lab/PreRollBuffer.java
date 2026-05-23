package com.pucky.device.speech.lab;

import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class PreRollBuffer implements AudioFrameConsumer {
    public static final int SAMPLE_RATE = 16_000;
    public static final int DURATION_MS = 1_500;
    public static final int CAPACITY_SAMPLES = SAMPLE_RATE * DURATION_MS / 1_000;

    private final short[] buffer = new short[CAPACITY_SAMPLES];
    private int writeIndex;
    private int size;
    private long frames;
    private long samples;
    private long lastTimestampNanos;

    @Override
    public String name() {
        return "pre_roll";
    }

    @Override
    public synchronized void onFrame(short[] frame, long timestampNanos) {
        if (frame == null) {
            return;
        }
        for (short sample : frame) {
            buffer[writeIndex] = sample;
            writeIndex = (writeIndex + 1) % buffer.length;
            if (size < buffer.length) {
                size += 1;
            }
        }
        frames += 1;
        samples += frame.length;
        lastTimestampNanos = timestampNanos;
    }

    public synchronized short[] snapshotSamples() {
        short[] out = new short[size];
        int start = (writeIndex - size + buffer.length) % buffer.length;
        for (int i = 0; i < size; i++) {
            out[i] = buffer[(start + i) % buffer.length];
        }
        return out;
    }

    @Override
    public synchronized JSONObject snapshot() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_lab_preroll.v1");
        Json.put(out, "capacity_ms", DURATION_MS);
        Json.put(out, "capacity_samples", CAPACITY_SAMPLES);
        Json.put(out, "sample_rate", SAMPLE_RATE);
        Json.put(out, "frames_seen", frames);
        Json.put(out, "samples_seen", samples);
        Json.put(out, "samples_available", size);
        Json.put(out, "duration_ms_available", Math.round((size * 1000.0) / SAMPLE_RATE));
        Json.put(out, "last_timestamp_nanos", lastTimestampNanos);
        return out;
    }
}
