package com.pucky.device.speech.lab;

import android.content.Context;

import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class OpenWakeWordConsumer implements AudioFrameConsumer {
    private static final String MODEL_ASSET = "hey_pucky.onnx";

    private final boolean modelAvailable;
    private long frames;
    private double threshold = 0.5;
    private double maxScore;
    private long detectionFrame = -1L;

    public OpenWakeWordConsumer(Context context) {
        this.modelAvailable = assetExists(context, MODEL_ASSET);
    }

    @Override
    public String name() {
        return "openwakeword";
    }

    @Override
    public synchronized void onFrame(short[] frame, long timestampNanos) {
        frames += 1;
        if (!modelAvailable || frame == null || frame.length == 0) {
            return;
        }
        double score = energyScore(frame);
        maxScore = Math.max(maxScore, score);
        if (detectionFrame < 0L && score >= threshold) {
            detectionFrame = frames;
        }
    }

    @Override
    public synchronized JSONObject snapshot() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_lab_wake_report.v1");
        Json.put(out, "engine", "openwakeword");
        Json.put(out, "runtime", modelAvailable ? "placeholder_without_onnx_runtime" : "unavailable");
        Json.put(out, "model_asset", MODEL_ASSET);
        Json.put(out, "model_available", modelAvailable);
        Json.put(out, "status", modelAvailable ? "placeholder_metrics_only" : "unavailable");
        Json.put(out, "frames", frames);
        Json.put(out, "threshold", threshold);
        Json.put(out, "max_score", maxScore);
        Json.put(out, "detected", detectionFrame >= 0L);
        Json.put(out, "detection_frame", detectionFrame < 0L ? JSONObject.NULL : detectionFrame);
        Json.put(out, "action", "none_lab_metrics_only");
        Json.put(out, "warning", modelAvailable
                ? "ONNX Runtime integration is not enabled in this build yet."
                : "openWakeWord model asset is missing; wake metrics are unavailable.");
        return out;
    }

    private static double energyScore(short[] frame) {
        long sumAbs = 0L;
        for (short sample : frame) {
            sumAbs += Math.abs((int) sample);
        }
        double meanAbs = sumAbs / (double) frame.length;
        return Math.max(0.0, Math.min(1.0, meanAbs / 6_000.0));
    }

    private static boolean assetExists(Context context, String asset) {
        try {
            context.getAssets().open(asset).close();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
}
