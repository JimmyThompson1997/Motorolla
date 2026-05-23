package com.pucky.device.speech.lab;

import org.json.JSONObject;

public interface AudioFrameConsumer {
    String name();

    void onFrame(short[] frame, long timestampNanos);

    JSONObject snapshot();
}
