package com.pucky.device.pucky;

public interface VadEngine {
    String name();

    boolean available();

    String unavailableReason();

    void reset();

    double speechProbability(float[] pcm16k, int sampleRate);
}
