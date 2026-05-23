package com.pucky.device.speech.lab;

import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class PcmCaptureConsumer implements AudioFrameConsumer {
    public static final int DEFAULT_MAX_SECONDS = 120;
    public static final int DEFAULT_MAX_SAMPLES = AudioFrameBus.SAMPLE_RATE * DEFAULT_MAX_SECONDS;

    private final int maxSamples;
    private short[] samples;
    private int sampleCount;
    private long framesSeen;
    private long samplesSeen;
    private long samplesDropped;
    private long firstTimestampNanos;
    private long lastTimestampNanos;
    private int maxAbsPcm16;

    public PcmCaptureConsumer() {
        this(DEFAULT_MAX_SAMPLES);
    }

    public PcmCaptureConsumer(int maxSamples) {
        this.maxSamples = Math.max(1, maxSamples);
        this.samples = new short[Math.min(this.maxSamples, AudioFrameBus.FRAME_SAMPLES * 16)];
    }

    @Override
    public String name() {
        return "pcm_capture";
    }

    @Override
    public synchronized void onFrame(short[] frame, long timestampNanos) {
        if (frame == null || frame.length == 0) {
            return;
        }
        framesSeen += 1;
        samplesSeen += frame.length;
        if (firstTimestampNanos == 0L) {
            firstTimestampNanos = timestampNanos;
            notifyAll();
        }
        lastTimestampNanos = timestampNanos;

        int accepted = Math.min(frame.length, maxSamples - sampleCount);
        if (accepted > 0) {
            ensureCapacity(sampleCount + accepted);
            System.arraycopy(frame, 0, samples, sampleCount, accepted);
            sampleCount += accepted;
        }
        if (accepted < frame.length) {
            samplesDropped += frame.length - accepted;
        }
        for (short value : frame) {
            int abs = Math.abs((int) value);
            if (abs > maxAbsPcm16) {
                maxAbsPcm16 = abs;
            }
        }
    }

    public synchronized short[] snapshotSamples() {
        short[] out = new short[sampleCount];
        System.arraycopy(samples, 0, out, 0, sampleCount);
        return out;
    }

    public synchronized boolean waitForFirstFrame(long timeoutMs) {
        if (framesSeen > 0) {
            return true;
        }
        long deadline = System.currentTimeMillis() + Math.max(0L, timeoutMs);
        while (framesSeen == 0) {
            long remaining = deadline - System.currentTimeMillis();
            if (remaining <= 0L) {
                return false;
            }
            try {
                wait(remaining);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
                return framesSeen > 0;
            }
        }
        return true;
    }

    @Override
    public synchronized JSONObject snapshot() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_lab_pcm_capture.v1");
        Json.put(out, "sample_rate", AudioFrameBus.SAMPLE_RATE);
        Json.put(out, "channels", 1);
        Json.put(out, "encoding", "PCM_16BIT");
        Json.put(out, "max_seconds", DEFAULT_MAX_SECONDS);
        Json.put(out, "max_samples", maxSamples);
        Json.put(out, "frames_seen", framesSeen);
        Json.put(out, "samples_seen", samplesSeen);
        Json.put(out, "samples_captured", sampleCount);
        Json.put(out, "samples_dropped", samplesDropped);
        Json.put(out, "bytes_captured", sampleCount * 2L);
        Json.put(out, "duration_ms_captured", sampleCount * 1_000L / AudioFrameBus.SAMPLE_RATE);
        Json.put(out, "first_timestamp_nanos", firstTimestampNanos == 0L ? JSONObject.NULL : firstTimestampNanos);
        Json.put(out, "last_timestamp_nanos", lastTimestampNanos == 0L ? JSONObject.NULL : lastTimestampNanos);
        Json.put(out, "max_abs_pcm16", maxAbsPcm16);
        Json.put(out, "truncated", samplesDropped > 0L);
        return out;
    }

    private void ensureCapacity(int needed) {
        if (samples.length >= needed) {
            return;
        }
        int next = samples.length;
        while (next < needed && next < maxSamples) {
            next = Math.min(maxSamples, next * 2);
        }
        short[] grown = new short[next];
        System.arraycopy(samples, 0, grown, 0, sampleCount);
        samples = grown;
    }
}
