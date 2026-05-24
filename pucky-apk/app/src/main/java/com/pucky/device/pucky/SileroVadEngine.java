package com.pucky.device.pucky;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.LongBuffer;
import java.util.HashMap;
import java.util.Map;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

public final class SileroVadEngine implements VadEngine {
    public static final String MODEL_ASSET = "silero_vad.onnx";
    private static final int SAMPLE_RATE = WalkieSpeechGate.SAMPLE_RATE;
    private static final int CONTEXT_SAMPLES = 64;
    private static final int STATE_LAYERS = 2;
    private static final int STATE_BATCH = 1;
    private static final int STATE_SIZE = 128;

    private final Context context;
    private OrtEnvironment environment;
    private OrtSession session;
    private float[][][] state = new float[STATE_LAYERS][STATE_BATCH][STATE_SIZE];
    private float[] contextWindow = new float[CONTEXT_SAMPLES];
    private String unavailableReason = "";

    public SileroVadEngine(Context context) {
        this.context = context.getApplicationContext();
        try {
            ensureSession();
        } catch (RuntimeException exc) {
            unavailableReason = exc.getMessage();
        }
    }

    @Override
    public String name() {
        return "silero_vad_onnx";
    }

    @Override
    public synchronized boolean available() {
        try {
            ensureSession();
            return true;
        } catch (RuntimeException exc) {
            unavailableReason = exc.getMessage();
            return false;
        }
    }

    @Override
    public synchronized String unavailableReason() {
        return unavailableReason == null ? "" : unavailableReason;
    }

    @Override
    public synchronized void reset() {
        state = new float[STATE_LAYERS][STATE_BATCH][STATE_SIZE];
        contextWindow = new float[CONTEXT_SAMPLES];
    }

    @Override
    public synchronized double speechProbability(float[] pcm16k, int sampleRate) {
        if (sampleRate != SAMPLE_RATE) {
            throw new IllegalArgumentException("Silero VAD requires 16000 Hz PCM");
        }
        if (pcm16k == null || pcm16k.length != WalkieSpeechGate.WINDOW_SAMPLES) {
            throw new IllegalArgumentException("Silero VAD requires 512 sample windows");
        }
        ensureSession();
        float[] input = new float[CONTEXT_SAMPLES + pcm16k.length];
        System.arraycopy(contextWindow, 0, input, 0, CONTEXT_SAMPLES);
        System.arraycopy(pcm16k, 0, input, CONTEXT_SAMPLES, pcm16k.length);

        try (OnnxTensor inputTensor = OnnxTensor.createTensor(environment, new float[][]{input});
             OnnxTensor stateTensor = OnnxTensor.createTensor(environment, state);
             OnnxTensor srTensor = OnnxTensor.createTensor(environment, LongBuffer.wrap(new long[]{SAMPLE_RATE}), new long[]{});
             OrtSession.Result result = session.run(inputs(inputTensor, stateTensor, srTensor))) {
            double probability = probabilityFrom(result.get(0).getValue());
            state = stateFrom(result.get(1).getValue());
            System.arraycopy(input, input.length - CONTEXT_SAMPLES, contextWindow, 0, CONTEXT_SAMPLES);
            unavailableReason = "";
            return probability;
        } catch (OrtException exc) {
            unavailableReason = "onnx_inference_failed: " + exc.getMessage();
            throw new IllegalStateException(unavailableReason, exc);
        }
    }

    private void ensureSession() {
        if (session != null && environment != null) {
            return;
        }
        try {
            File model = materializeModelAsset();
            environment = OrtEnvironment.getEnvironment();
            OrtSession.SessionOptions options = new OrtSession.SessionOptions();
            options.setIntraOpNumThreads(1);
            options.setInterOpNumThreads(1);
            session = environment.createSession(model.getAbsolutePath(), options);
            unavailableReason = "";
        } catch (Exception exc) {
            throw new IllegalStateException("silero_vad_unavailable: " + exc.getMessage(), exc);
        }
    }

    private File materializeModelAsset() throws Exception {
        File dir = new File(context.getFilesDir(), "models");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("unable_to_create_model_dir");
        }
        File model = new File(dir, MODEL_ASSET);
        if (model.exists() && model.length() > 0) {
            return model;
        }
        try (InputStream input = context.getAssets().open(MODEL_ASSET);
             FileOutputStream output = new FileOutputStream(model)) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                output.write(buffer, 0, read);
            }
        }
        if (!model.exists() || model.length() <= 0) {
            throw new IllegalStateException("model_asset_empty");
        }
        return model;
    }

    private static Map<String, OnnxTensor> inputs(OnnxTensor input, OnnxTensor state, OnnxTensor sr) {
        Map<String, OnnxTensor> inputs = new HashMap<>();
        inputs.put("input", input);
        inputs.put("state", state);
        inputs.put("sr", sr);
        return inputs;
    }

    private static double probabilityFrom(Object value) {
        if (value instanceof float[][]) {
            float[][] matrix = (float[][]) value;
            return matrix.length == 0 || matrix[0].length == 0 ? 0.0 : matrix[0][0];
        }
        if (value instanceof float[]) {
            float[] vector = (float[]) value;
            return vector.length == 0 ? 0.0 : vector[0];
        }
        throw new IllegalStateException("unexpected_probability_output");
    }

    private static float[][][] stateFrom(Object value) {
        if (value instanceof float[][][]) {
            return (float[][][]) value;
        }
        throw new IllegalStateException("unexpected_state_output");
    }
}
