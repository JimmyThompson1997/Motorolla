package com.pucky.device.wake;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class WakeProbeClipShaperTest {
    private static final int SAMPLE_RATE = 16000;

    @Test
    public void limitPreRollKeepsOnlyLastQuarterSecond() {
        short[] preRoll = rampSamples(SAMPLE_RATE);

        short[] limited = WakeProbeClipShaper.limitPreRoll(preRoll);

        assertEquals(SAMPLE_RATE * 250 / 1000, limited.length);
        assertEquals(preRoll[preRoll.length - limited.length], limited[0]);
    }

    @Test
    public void shapeForConfirmationTrimsSilenceAndCapsDuration() {
        short[] leading = constantSamples(300, (short) 0);
        short[] speech = constantSamples(900, (short) 1200);
        short[] trailing = constantSamples(900, (short) 0);
        short[] raw = concat(leading, speech, trailing);

        short[] shaped = WakeProbeClipShaper.shapeForConfirmation(raw);

        assertTrue(shaped.length <= SAMPLE_RATE * 1600 / 1000);
        assertTrue(shaped.length >= SAMPLE_RATE);
    }

    private static short[] rampSamples(int count) {
        short[] out = new short[count];
        for (int i = 0; i < out.length; i += 1) {
            out[i] = (short) i;
        }
        return out;
    }

    private static short[] constantSamples(int durationMs, short value) {
        int count = SAMPLE_RATE * durationMs / 1000;
        short[] out = new short[count];
        for (int i = 0; i < out.length; i += 1) {
            out[i] = value;
        }
        return out;
    }

    private static short[] concat(short[]... parts) {
        int total = 0;
        for (short[] part : parts) {
            total += part.length;
        }
        short[] out = new short[total];
        int offset = 0;
        for (short[] part : parts) {
            System.arraycopy(part, 0, out, offset, part.length);
            offset += part.length;
        }
        return out;
    }
}
