package com.pucky.device.speech;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.pucky.device.speech.lab.AudioFrameBus;
import com.pucky.device.speech.lab.PcmCaptureConsumer;
import com.pucky.device.speech.lab.PreRollBuffer;
import com.pucky.device.speech.lab.TelemetryConsumer;

import org.json.JSONObject;
import org.junit.Test;

public final class AudioLabPureUnitTest {
    @Test
    public void frameConstantsMatchSixteenKhzThirtyMilliseconds() {
        assertEquals(16_000, AudioFrameBus.SAMPLE_RATE);
        assertEquals(30, AudioFrameBus.FRAME_MS);
        assertEquals(480, AudioFrameBus.FRAME_SAMPLES);
        assertEquals(24_000, PreRollBuffer.CAPACITY_SAMPLES);
    }

    @Test
    public void preRollSnapshotKeepsMostRecentSamplesImmutably() throws Exception {
        PreRollBuffer buffer = new PreRollBuffer();
        short[] first = new short[] {1, 2, 3};
        short[] second = new short[] {4, 5};

        buffer.onFrame(first, 10L);
        short[] snapshot = buffer.snapshotSamples();
        first[0] = 99;
        buffer.onFrame(second, 20L);

        assertArrayEquals(new short[] {1, 2, 3}, snapshot);
        assertArrayEquals(new short[] {1, 2, 3, 4, 5}, buffer.snapshotSamples());
        JSONObject report = buffer.snapshot();
        assertEquals(2, report.getLong("frames_seen"));
        assertEquals(5, report.getLong("samples_available"));
    }

    @Test
    public void telemetryReportsBasicPcmStats() throws Exception {
        TelemetryConsumer telemetry = new TelemetryConsumer();

        telemetry.onFrame(new short[] {-100, 0, 100}, 10L);
        JSONObject report = telemetry.snapshot();

        assertEquals(1, report.getLong("frames"));
        assertEquals(3, report.getLong("samples"));
        assertEquals(100, report.getInt("max_abs_pcm16"));
        assertTrue(report.getDouble("rms_pcm16") > 0.0);
    }

    @Test
    public void pcmCaptureKeepsFullHeldClipUntilCapacity() throws Exception {
        PcmCaptureConsumer capture = new PcmCaptureConsumer(5);

        capture.onFrame(new short[] {1, 2, 3}, 10L);
        capture.onFrame(new short[] {4, 5, 6}, 20L);

        assertArrayEquals(new short[] {1, 2, 3, 4, 5}, capture.snapshotSamples());
        JSONObject report = capture.snapshot();
        assertEquals(2, report.getLong("frames_seen"));
        assertEquals(6, report.getLong("samples_seen"));
        assertEquals(5, report.getLong("samples_captured"));
        assertEquals(1, report.getLong("samples_dropped"));
        assertTrue(report.getBoolean("truncated"));
    }
}
