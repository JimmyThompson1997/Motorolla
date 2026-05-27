package com.pucky.device.pucky;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.concurrent.atomic.AtomicInteger;

public final class WalkieSpeechGateTest {
    @Test
    public void silenceAndImpulsesDoNotCommitWithoutVadSpeech() throws Exception {
        FakeVadEngine engine = new FakeVadEngine(true, 0.01, 0.02, 0.04);
        MutableClock clock = new MutableClock(1_000L);
        AtomicInteger commits = new AtomicInteger();
        WalkieSpeechGate gate = new WalkieSpeechGate(1_000L, engine, clock, status -> commits.incrementAndGet());

        clock.now = 1_030L;
        gate.onFrame(frame(0), 1L);
        clock.now = 1_060L;
        gate.onFrame(frame(30_000), 2L);
        clock.now = 1_090L;
        gate.onFrame(frame(200), 3L);

        JSONObject status = gate.statusJson();
        assertFalse(gate.speechDetected());
        assertFalse(status.getBoolean("speech_detected"));
        assertEquals(0, commits.get());
        assertEquals(30_000, status.getInt("peak_amplitude"));
        assertEquals(3, status.getInt("frames_seen"));
        assertEquals(0, status.getInt("speech_frames"));
        assertEquals(-1, status.getLong("gate_latency_ms"));
    }

    @Test
    public void firstVadPositiveFrameCommitsAndLatchesThroughSilence() throws Exception {
        FakeVadEngine engine = new FakeVadEngine(true, 0.04, 0.78, 0.01, 0.82);
        MutableClock clock = new MutableClock(2_000L);
        AtomicInteger commits = new AtomicInteger();
        WalkieSpeechGate gate = new WalkieSpeechGate(2_000L, engine, clock, status -> commits.incrementAndGet());

        clock.now = 2_032L;
        gate.onFrame(frame(500), 1L);
        assertFalse(gate.speechDetected());

        clock.now = 2_064L;
        gate.onFrame(frame(1_200), 2L);
        assertTrue(gate.speechDetected());

        clock.now = 2_096L;
        gate.onFrame(frame(0), 3L);
        clock.now = 2_128L;
        gate.onFrame(frame(1_500), 4L);

        JSONObject status = gate.statusJson();
        assertTrue(status.getBoolean("speech_detected"));
        assertEquals(1, commits.get());
        assertEquals(2, status.getInt("speech_frames"));
        assertEquals(64, status.getLong("gate_latency_ms"));
        assertEquals(0.82, status.getDouble("max_vad_probability"), 0.001);
    }

    @Test
    public void unavailableVadFailsClosedInsteadOfAmplitudeFallback() throws Exception {
        FakeVadEngine engine = new FakeVadEngine(false, 0.99, 0.99);
        MutableClock clock = new MutableClock(3_000L);
        WalkieSpeechGate gate = new WalkieSpeechGate(3_000L, engine, clock, status -> {
            throw new AssertionError("unavailable VAD must not commit");
        });

        clock.now = 3_032L;
        gate.onFrame(frame(32_000), 1L);
        clock.now = 3_064L;
        gate.onFrame(frame(31_000), 2L);

        JSONObject status = gate.statusJson();
        assertFalse(gate.speechDetected());
        assertFalse(status.getBoolean("vad_available"));
        assertEquals("vad_unavailable", status.getString("unavailable_reason"));
        assertEquals(32_000, status.getInt("peak_amplitude"));
        assertEquals(0, status.getInt("speech_frames"));
    }

    @Test
    public void trailingSilenceMarksSpeechEndedForAutoEndpointTurns() throws Exception {
        FakeVadEngine engine = new FakeVadEngine(true, 0.91, 0.92, 0.04, 0.03, 0.02);
        MutableClock clock = new MutableClock(4_000L);
        AtomicInteger detected = new AtomicInteger();
        AtomicInteger ended = new AtomicInteger();
        WalkieSpeechGate gate = new WalkieSpeechGate(
                4_000L,
                engine,
                clock,
                new WalkieSpeechGate.Listener() {
                    @Override
                    public void onSpeechDetected(JSONObject status) {
                        detected.incrementAndGet();
                    }

                    @Override
                    public void onSpeechEnded(JSONObject status) {
                        ended.incrementAndGet();
                    }
                },
                60,
                30);

        clock.now = 4_032L;
        gate.onFrame(frame(1_000), 1L);
        clock.now = 4_064L;
        gate.onFrame(frame(1_200), 2L);
        clock.now = 4_128L;
        gate.onFrame(frame(0), 3L);
        clock.now = 4_192L;
        gate.onFrame(frame(0), 4L);
        clock.now = 4_256L;
        gate.onFrame(frame(0), 5L);

        JSONObject status = gate.statusJson();
        assertEquals(1, detected.get());
        assertEquals(1, ended.get());
        assertTrue(status.getBoolean("speech_detected"));
        assertTrue(status.getBoolean("speech_ended"));
        assertTrue(status.getLong("speech_duration_ms") >= 30L);
        assertTrue(status.getLong("silence_after_speech_ms") >= 60L);
    }

    @Test
    public void customSpeechThresholdAllowsDebugFixtureSpeechDetection() throws Exception {
        FakeVadEngine engine = new FakeVadEngine(true, 0.12, 0.01);
        MutableClock clock = new MutableClock(5_000L);
        AtomicInteger commits = new AtomicInteger();
        WalkieSpeechGate gate = new WalkieSpeechGate(
                5_000L,
                engine,
                clock,
                status -> commits.incrementAndGet(),
                0,
                0,
                0.05);

        clock.now = 5_032L;
        gate.onFrame(frame(10_000), 1L);

        JSONObject status = gate.statusJson();
        assertTrue(gate.speechDetected());
        assertTrue(status.getBoolean("speech_detected"));
        assertEquals(1, commits.get());
        assertEquals(0.05, status.getDouble("speech_threshold"), 0.0001);
    }

    private static short[] frame(int amplitude) {
        short[] frame = new short[WalkieSpeechGate.WINDOW_SAMPLES];
        short value = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, amplitude));
        for (int i = 0; i < frame.length; i++) {
            frame[i] = value;
        }
        return frame;
    }

    private static final class MutableClock implements WalkieSpeechGate.ElapsedClock {
        long now;

        MutableClock(long now) {
            this.now = now;
        }

        @Override
        public long elapsedRealtimeMs() {
            return now;
        }
    }

    private static final class FakeVadEngine implements VadEngine {
        private final boolean available;
        private final double[] probabilities;
        private int index;

        FakeVadEngine(boolean available, double... probabilities) {
            this.available = available;
            this.probabilities = probabilities;
        }

        @Override
        public String name() {
            return "fake_vad";
        }

        @Override
        public boolean available() {
            return available;
        }

        @Override
        public String unavailableReason() {
            return available ? "" : "vad_unavailable";
        }

        @Override
        public void reset() {
            index = 0;
        }

        @Override
        public double speechProbability(float[] pcm16k, int sampleRate) {
            double probability = index < probabilities.length ? probabilities[index] : 0.0;
            index += 1;
            return probability;
        }
    }
}
