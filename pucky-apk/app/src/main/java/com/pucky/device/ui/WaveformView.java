package com.pucky.device.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.media.audiofx.Visualizer;
import android.view.View;

import java.lang.ref.WeakReference;
import java.util.HashMap;
import java.util.Map;

public final class WaveformView extends View {
    private static final int TARGET_CAPTURE_RATE_MHZ = 30_000;
    private static final int TARGET_CAPTURE_SIZE = 256;
    private static final int SAMPLE_COUNT = 92;
    private static final Object OWNER_LOCK = new Object();
    private static final Object HISTORY_LOCK = new Object();
    private static final Map<Integer, float[]> SESSION_LEVEL_HISTORY = new HashMap<>();
    private static WeakReference<WaveformView> activeCaptureOwner = new WeakReference<>(null);
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final float[] levels = new float[SAMPLE_COUNT];
    private final Object sampleLock = new Object();
    private int accent = Color.rgb(58, 132, 255);
    private boolean playing;
    private int audioSessionId;
    private int capturePriority;
    private Visualizer visualizer;
    private boolean visualizerUnavailable;

    public WaveformView(Context context) {
        super(context);
        setMinimumHeight(dp(32));
    }

    public void setAccentColor(int accent) {
        this.accent = accent;
        invalidate();
    }

    public void setAudioSessionId(int audioSessionId) {
        if (this.audioSessionId == audioSessionId) {
            return;
        }
        this.audioSessionId = audioSessionId;
        releaseVisualizer();
        visualizerUnavailable = false;
        restoreHistoryForSession(audioSessionId);
        if (isAttachedToWindow() && playing) {
            attachVisualizer();
        }
        invalidate();
    }

    public void setCapturePriority(int capturePriority) {
        this.capturePriority = capturePriority;
        if (isAttachedToWindow() && playing) {
            attachVisualizer();
        }
    }

    public void setPlaying(boolean playing) {
        if (this.playing == playing) {
            return;
        }
        this.playing = playing;
        if (playing) {
            attachVisualizer();
        } else {
            releaseVisualizer();
        }
        invalidate();
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        if (playing) {
            attachVisualizer();
        }
    }

    @Override
    protected void onDetachedFromWindow() {
        releaseVisualizer();
        super.onDetachedFromWindow();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();
        int height = getHeight();
        if (width <= 0 || height <= 0) {
            return;
        }

        float center = height / 2f;
        paint.setColor(Color.argb(226, Color.red(accent), Color.green(accent), Color.blue(accent)));
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(Math.max(1f, dp(1)));
        paint.setStrokeCap(Paint.Cap.ROUND);

        if (hasLiveSamples()) {
            drawLiveWaveform(canvas, width, height, center);
        } else {
            drawIdleWaveform(canvas, width, height, center);
        }
        if (playing) {
            postInvalidateDelayed(80L);
        }
    }

    private void attachVisualizer() {
        if (!playing || visualizer != null || visualizerUnavailable || audioSessionId <= 0 || !isAttachedToWindow()) {
            return;
        }
        if (!claimCaptureOwnership()) {
            return;
        }
        Visualizer next = null;
        try {
            next = new Visualizer(audioSessionId);
            next.setEnabled(false);
            next.setCaptureSize(preferredCaptureSize());
            int captureRate = Math.min(Visualizer.getMaxCaptureRate(), TARGET_CAPTURE_RATE_MHZ);
            next.setDataCaptureListener(new Visualizer.OnDataCaptureListener() {
                @Override
                public void onWaveFormDataCapture(Visualizer visualizer, byte[] waveform, int samplingRate) {
                    updateSamples(waveform);
                }

                @Override
                public void onFftDataCapture(Visualizer visualizer, byte[] fft, int samplingRate) {
                    // Waveform capture is intentionally enough for the thin speech line.
                }
            }, captureRate, true, false);
            next.setEnabled(true);
            visualizer = next;
        } catch (RuntimeException exc) {
            visualizerUnavailable = true;
            if (next != null) {
                try {
                    next.release();
                } catch (RuntimeException ignored) {
                    // Release is best effort; fallback drawing keeps the UI safe.
                }
            }
            releaseVisualizer();
        }
    }

    private boolean claimCaptureOwnership() {
        synchronized (OWNER_LOCK) {
            WaveformView currentOwner = activeCaptureOwner.get();
            if (currentOwner == this) {
                return true;
            }
            if (currentOwner != null && currentOwner.capturePriority > capturePriority) {
                return false;
            }
            if (currentOwner != null) {
                currentOwner.releaseVisualizer();
            }
            activeCaptureOwner = new WeakReference<>(this);
            return true;
        }
    }

    private int preferredCaptureSize() {
        try {
            int[] range = Visualizer.getCaptureSizeRange();
            int min = range == null || range.length < 2 ? TARGET_CAPTURE_SIZE : range[0];
            int max = range == null || range.length < 2 ? TARGET_CAPTURE_SIZE : range[1];
            return Math.max(min, Math.min(max, TARGET_CAPTURE_SIZE));
        } catch (RuntimeException ignored) {
            return TARGET_CAPTURE_SIZE;
        }
    }

    private void releaseVisualizer() {
        if (visualizer == null) {
            return;
        }
        try {
            visualizer.setEnabled(false);
        } catch (RuntimeException ignored) {
            // Release is best effort; fallback drawing keeps the UI safe.
        }
        try {
            visualizer.release();
        } catch (RuntimeException ignored) {
            // Release is best effort; fallback drawing keeps the UI safe.
        }
        visualizer = null;
        synchronized (OWNER_LOCK) {
            if (activeCaptureOwner.get() == this) {
                activeCaptureOwner = new WeakReference<>(null);
            }
        }
    }

    private void updateSamples(byte[] waveform) {
        if (waveform == null || waveform.length == 0) {
            return;
        }
        synchronized (sampleLock) {
            float squareTotal = 0f;
            float peak = 0f;
            for (byte raw : waveform) {
                float centered = ((raw & 0xFF) - 128) / 128f;
                float absolute = Math.abs(centered);
                squareTotal += absolute * absolute;
                peak = Math.max(peak, absolute);
            }
            float rms = (float) Math.sqrt(squareTotal / waveform.length);
            float next = Math.min(1f, Math.max(0f, (rms - 0.018f) * 2.8f + peak * 0.22f));
            System.arraycopy(levels, 1, levels, 0, SAMPLE_COUNT - 1);
            levels[SAMPLE_COUNT - 1] = levels[SAMPLE_COUNT - 2] * 0.52f + next * 0.48f;
            saveHistoryForSessionLocked();
        }
        postInvalidateOnAnimation();
    }

    private void restoreHistoryForSession(int audioSessionId) {
        synchronized (sampleLock) {
            if (audioSessionId <= 0) {
                for (int index = 0; index < levels.length; index++) {
                    levels[index] = 0f;
                }
                return;
            }
            synchronized (HISTORY_LOCK) {
                float[] history = SESSION_LEVEL_HISTORY.get(audioSessionId);
                if (history == null || history.length != SAMPLE_COUNT) {
                    return;
                }
                System.arraycopy(history, 0, levels, 0, SAMPLE_COUNT);
            }
        }
    }

    private void saveHistoryForSessionLocked() {
        if (audioSessionId <= 0) {
            return;
        }
        float[] copy = new float[SAMPLE_COUNT];
        System.arraycopy(levels, 0, copy, 0, SAMPLE_COUNT);
        synchronized (HISTORY_LOCK) {
            SESSION_LEVEL_HISTORY.put(audioSessionId, copy);
        }
    }

    private boolean hasLiveSamples() {
        synchronized (sampleLock) {
            for (float level : levels) {
                if (level > 0.025f) {
                    return true;
                }
            }
        }
        return false;
    }

    private void drawLiveWaveform(Canvas canvas, int width, int height, float center) {
        float baseline = Math.max(dp(1), height * 0.035f);
        float maxAmplitude = Math.max(dp(6), height * 0.47f);
        float step = width / (float) Math.max(1, SAMPLE_COUNT - 1);
        synchronized (sampleLock) {
            for (int index = 0; index < SAMPLE_COUNT; index++) {
                float x = index * step;
                float shaped = (float) Math.pow(Math.max(0f, levels[index]), 0.72f);
                float halfHeight = baseline + shaped * maxAmplitude;
                canvas.drawLine(x, center - halfHeight, x, center + halfHeight, paint);
            }
        }
    }

    private void drawIdleWaveform(Canvas canvas, int width, int height, float center) {
        float step = width / (float) Math.max(1, SAMPLE_COUNT - 1);
        float baseline = Math.max(dp(1), height * 0.035f);
        for (int index = 0; index < SAMPLE_COUNT; index++) {
            float x = index * step;
            canvas.drawLine(x, center - baseline, x, center + baseline, paint);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
