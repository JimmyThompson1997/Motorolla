package com.pucky.device.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.view.View;

public final class WaveformView extends View {
    private static final int BAR_COUNT = 28;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private int accent = Color.rgb(58, 132, 255);
    private boolean playing;

    public WaveformView(Context context) {
        super(context);
        setMinimumHeight(dp(32));
    }

    public void setAccentColor(int accent) {
        this.accent = accent;
        invalidate();
    }

    public void setPlaying(boolean playing) {
        this.playing = playing;
        invalidate();
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        if (playing) {
            postInvalidateOnAnimation();
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();
        int height = getHeight();
        if (width <= 0 || height <= 0) {
            return;
        }
        float gap = dp(3);
        float barWidth = Math.max(dp(2), (width - gap * (BAR_COUNT - 1)) / BAR_COUNT);
        float center = height / 2f;
        long now = System.currentTimeMillis();
        paint.setColor(accent);
        paint.setStrokeCap(Paint.Cap.ROUND);
        for (int index = 0; index < BAR_COUNT; index++) {
            float phase = (now / 150f) + index * 0.62f;
            float wave = playing ? (float) ((Math.sin(phase) + 1f) / 2f) : 0.35f;
            float normalized = 0.22f + wave * 0.72f;
            float barHeight = Math.max(dp(6), normalized * height);
            float left = index * (barWidth + gap);
            canvas.drawRoundRect(
                    left,
                    center - barHeight / 2f,
                    left + barWidth,
                    center + barHeight / 2f,
                    barWidth / 2f,
                    barWidth / 2f,
                    paint);
        }
        if (playing) {
            postInvalidateDelayed(72L);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
