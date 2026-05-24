package com.pucky.device.speech.lab;

import android.content.Context;
import android.os.SystemClock;

import com.pucky.device.pucky.SileroVadEngine;
import com.pucky.device.pucky.WalkieSpeechGate;
import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class SileroVadConsumer implements AudioFrameConsumer {
    private final WalkieSpeechGate gate;

    public SileroVadConsumer(Context context) {
        long started = SystemClock.elapsedRealtime();
        this.gate = new WalkieSpeechGate(started, new SileroVadEngine(context),
                SystemClock::elapsedRealtime, status -> {
        });
    }

    @Override
    public String name() {
        return "silero_vad";
    }

    @Override
    public void onFrame(short[] frame, long timestampNanos) {
        gate.onFrame(frame, timestampNanos);
    }

    @Override
    public JSONObject snapshot() {
        JSONObject gateStatus = gate.statusJson();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_lab_vad_report.v1");
        Json.put(out, "engine", "silero_vad");
        Json.put(out, "runtime", gateStatus.optBoolean("vad_available", false) ? "onnx_runtime" : "unavailable");
        Json.put(out, "model_asset", SileroVadEngine.MODEL_ASSET);
        Json.put(out, "model_available", gateStatus.optBoolean("vad_available", false));
        Json.put(out, "status", gateStatus.optBoolean("vad_available", false) ? "ok" : "unavailable");
        Json.put(out, "frames", gateStatus.optLong("frames_seen", 0L));
        Json.put(out, "vad_windows_seen", gateStatus.optLong("vad_windows_seen", 0L));
        Json.put(out, "speech_frames", gateStatus.optLong("speech_frames", 0L));
        Json.put(out, "max_speech_probability", gateStatus.optDouble("max_vad_probability", 0.0));
        Json.put(out, "latest_speech_probability", gateStatus.optDouble("vad_probability", 0.0));
        Json.put(out, "speech_detected", gateStatus.optBoolean("speech_detected", false));
        Json.put(out, "endpointing", "report_only");
        Json.put(out, "warning", gateStatus.optBoolean("vad_available", false)
                ? JSONObject.NULL
                : gateStatus.optString("unavailable_reason", "Silero VAD unavailable."));
        return out;
    }
}
