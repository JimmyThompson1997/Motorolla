package com.pucky.device.speech.lab;

import android.content.Context;

import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class SileroVadConsumer implements AudioFrameConsumer {
    private static final String MODEL_ASSET = "silero_vad.onnx";

    private final boolean modelAvailable;
    private long frames;
    private long firstSpeechCandidateFrame = -1L;
    private long lastSpeechCandidateFrame = -1L;
    private double maxSpeechProbability;
    private double sumSpeechProbability;

    public SileroVadConsumer(Context context) {
        this.modelAvailable = assetExists(context, MODEL_ASSET);
    }

    @Override
    public String name() {
        return "silero_vad";
    }

    @Override
    public synchronized void onFrame(short[] frame, long timestampNanos) {
        frames += 1;
        if (!modelAvailable || frame == null || frame.length == 0) {
            return;
        }
        double probability = rmsProbability(frame);
        maxSpeechProbability = Math.max(maxSpeechProbability, probability);
        sumSpeechProbability += probability;
        if (probability >= 0.7) {
            if (firstSpeechCandidateFrame < 0L) {
                firstSpeechCandidateFrame = frames;
            }
            lastSpeechCandidateFrame = frames;
        }
    }

    @Override
    public synchronized JSONObject snapshot() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_lab_vad_report.v1");
        Json.put(out, "engine", "silero_vad");
        Json.put(out, "runtime", modelAvailable ? "placeholder_without_onnx_runtime" : "unavailable");
        Json.put(out, "model_asset", MODEL_ASSET);
        Json.put(out, "model_available", modelAvailable);
        Json.put(out, "status", modelAvailable ? "placeholder_metrics_only" : "unavailable");
        Json.put(out, "frames", frames);
        Json.put(out, "max_speech_probability", maxSpeechProbability);
        Json.put(out, "mean_speech_probability", frames == 0 ? 0.0 : sumSpeechProbability / frames);
        Json.put(out, "first_speech_candidate_frame", firstSpeechCandidateFrame < 0L ? JSONObject.NULL : firstSpeechCandidateFrame);
        Json.put(out, "last_speech_candidate_frame", lastSpeechCandidateFrame < 0L ? JSONObject.NULL : lastSpeechCandidateFrame);
        Json.put(out, "endpointing", "report_only");
        Json.put(out, "warning", modelAvailable
                ? "ONNX Runtime integration is not enabled in this build yet."
                : "Silero model asset is missing; VAD is report-only unavailable.");
        return out;
    }

    private static double rmsProbability(short[] frame) {
        long sumSquares = 0L;
        for (short sample : frame) {
            sumSquares += (long) sample * sample;
        }
        double rms = Math.sqrt(sumSquares / (double) frame.length);
        return Math.max(0.0, Math.min(1.0, rms / 4_000.0));
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
