package com.pucky.device.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.media.audiofx.Visualizer;
import android.view.View;

public final class WaveformView extends View {
    private static final int TARGET_CAPTURE_RATE_MHZ = 30_000;
    private static final int TARGET_CAPTURE_SIZE = 256;
    private static final int SAMPLE_COUNT = 56;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint idlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final float[] samples = new float[SAMPLE_COUNT];
    private final Object sampleLock = new Object();
    private int accent = Color.rgb(58, 132, 255);
    private boolean playing;
    private int audioSessionId;
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
        if (isAttachedToWindow() && playing) {
            attachVisualizer();
        }
        invalidate();
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
        idlePaint.setColor(Color.argb(88, Color.red(accent), Color.green(accent), Color.blue(accent)));
        idlePaint.setStyle(Paint.Style.STROKE);
        idlePaint.setStrokeWidth(dp(1));
        idlePaint.setStrokeCap(Paint.Cap.ROUND);
        canvas.drawLine(0, center, width, center, idlePaint);

        paint.setColor(Color.argb(238, Color.red(accent), Color.green(accent), Color.blue(accent)));
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dp(2));
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);

        path.reset();
        if (hasLiveSamples()) {
            drawLiveWaveform(width, height, center);
        } else {
            drawIdleWaveform(width, height, center);
        }
        canvas.drawPath(path, paint);
        if (playing) {
            postInvalidateDelayed(80L);
        }
    }

    private void attachVisualizer() {
        if (!playing || visualizer != null || visualizerUnavailable || audioSessionId <= 0 || !isAttachedToWindow()) {
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
    }

    private void updateSamples(byte[] waveform) {
        if (waveform == null || waveform.length == 0) {
            return;
        }
        synchronized (sampleLock) {
            for (int index = 0; index < SAMPLE_COUNT; index++) {
                int start = index * waveform.length / SAMPLE_COUNT;
                int end = Math.max(start + 1, (index + 1) * waveform.length / SAMPLE_COUNT);
                float total = 0f;
                int count = 0;
                for (int sample = start; sample < end && sample < waveform.length; sample++) {
                    total += ((waveform[sample] & 0xFF) - 128) / 128f;
                    count++;
                }
                float next = count == 0 ? 0f : total / count;
                samples[index] = samples[index] * 0.62f + next * 0.38f;
            }
        }
        postInvalidateOnAnimation();
    }

    private boolean hasLiveSamples() {
        synchronized (sampleLock) {
            for (float sample : samples) {
                if (Math.abs(sample) > 0.015f) {
                    return true;
                }
            }
        }
        return false;
    }

    private void drawLiveWaveform(int width, int height, float center) {
        float maxAmplitude = Math.max(dp(4), height * 0.36f);
        synchronized (sampleLock) {
            for (int index = 0; index < SAMPLE_COUNT; index++) {
                float x = SAMPLE_COUNT == 1 ? 0 : width * (index / (float) (SAMPLE_COUNT - 1));
                float y = center + samples[index] * maxAmplitude;
                if (index == 0) {
                    path.moveTo(x, y);
                } else {
                    path.lineTo(x, y);
                }
            }
        }
    }

    private void drawIdleWaveform(int width, int height, float center) {
        long now = System.currentTimeMillis();
        float maxAmplitude = playing ? Math.max(dp(3), height * 0.12f) : dp(1);
        for (int index = 0; index < SAMPLE_COUNT; index++) {
            float progress = index / (float) (SAMPLE_COUNT - 1);
            float x = width * progress;
            float envelope = 0.25f + 0.75f * (float) Math.sin(Math.PI * progress);
            float wave = (float) Math.sin(progress * Math.PI * 8f + now / 220f);
            float y = center + wave * envelope * maxAmplitude;
            if (index == 0) {
                path.moveTo(x, y);
            } else {
                path.lineTo(x, y);
            }
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
