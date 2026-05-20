package com.pucky.device.ui;

import android.view.MotionEvent;
import android.view.VelocityTracker;
import android.view.View;
import android.view.ViewConfiguration;

public final class InteractivePanelController {
    private static final long ANIMATION_MS = 180L;
    private static final float DISMISS_FRACTION = 0.30f;
    private static final float FLING_VELOCITY_DP = 720f;

    private InteractivePanelController() {
    }

    public static void slideInFromRight(View panel) {
        panel.post(() -> {
            panel.setTranslationX(panel.getWidth());
            panel.animate()
                    .translationX(0f)
                    .setDuration(ANIMATION_MS)
                    .start();
        });
    }

    public static void slideUp(View panel) {
        panel.post(() -> {
            panel.setTranslationY(panel.getHeight());
            panel.animate()
                    .translationY(0f)
                    .setDuration(ANIMATION_MS)
                    .start();
        });
    }

    public static void installRightSwipeDismiss(View touchTarget, View panel, Runnable onDismiss) {
        touchTarget.setOnTouchListener(new DragDismissTouchListener(panel, onDismiss, true));
    }

    public static void installDownSwipeDismiss(View touchTarget, View panel, Runnable onDismiss) {
        touchTarget.setOnTouchListener(new DragDismissTouchListener(panel, onDismiss, false));
    }

    private static final class DragDismissTouchListener implements View.OnTouchListener {
        private final View panel;
        private final Runnable onDismiss;
        private final boolean horizontal;
        private final float touchSlop;
        private final float flingVelocity;
        private float downX;
        private float downY;
        private boolean dragging;
        private boolean dismissed;
        private VelocityTracker velocityTracker;

        DragDismissTouchListener(View panel, Runnable onDismiss, boolean horizontal) {
            this.panel = panel;
            this.onDismiss = onDismiss;
            this.horizontal = horizontal;
            ViewConfiguration config = ViewConfiguration.get(panel.getContext());
            this.touchSlop = config.getScaledTouchSlop();
            this.flingVelocity = FLING_VELOCITY_DP * panel.getResources().getDisplayMetrics().density;
        }

        @Override
        public boolean onTouch(View view, MotionEvent event) {
            if (dismissed) {
                return true;
            }
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = event.getRawX();
                    downY = event.getRawY();
                    dragging = false;
                    velocityTracker = VelocityTracker.obtain();
                    velocityTracker.addMovement(event);
                    return false;
                case MotionEvent.ACTION_MOVE:
                    if (velocityTracker != null) {
                        velocityTracker.addMovement(event);
                    }
                    float dx = event.getRawX() - downX;
                    float dy = event.getRawY() - downY;
                    float primary = horizontal ? dx : dy;
                    float cross = horizontal ? Math.abs(dy) : Math.abs(dx);
                    if (!dragging) {
                        if (primary <= touchSlop || primary <= cross * 1.15f) {
                            return false;
                        }
                        dragging = true;
                        view.getParent().requestDisallowInterceptTouchEvent(true);
                    }
                    if (dragging) {
                        float offset = Math.max(0f, primary);
                        if (horizontal) {
                            panel.setTranslationX(offset);
                        } else {
                            panel.setTranslationY(offset);
                        }
                        return true;
                    }
                    return false;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    boolean shouldDismiss = false;
                    if (dragging) {
                        float offset = horizontal ? panel.getTranslationX() : panel.getTranslationY();
                        int size = horizontal ? panel.getWidth() : panel.getHeight();
                        float velocity = 0f;
                        if (velocityTracker != null) {
                            velocityTracker.addMovement(event);
                            velocityTracker.computeCurrentVelocity(1000);
                            velocity = horizontal ? velocityTracker.getXVelocity() : velocityTracker.getYVelocity();
                        }
                        shouldDismiss = offset >= size * DISMISS_FRACTION || velocity >= flingVelocity;
                    }
                    recycleVelocityTracker();
                    dragging = false;
                    if (shouldDismiss) {
                        dismiss();
                        return true;
                    }
                    snapBack();
                    return false;
                default:
                    return false;
            }
        }

        private void dismiss() {
            dismissed = true;
            float target = horizontal ? panel.getWidth() : panel.getHeight();
            panel.animate()
                    .translationX(horizontal ? target : 0f)
                    .translationY(horizontal ? 0f : target)
                    .setDuration(ANIMATION_MS)
                    .withEndAction(onDismiss)
                    .start();
        }

        private void snapBack() {
            panel.animate()
                    .translationX(0f)
                    .translationY(0f)
                    .setDuration(ANIMATION_MS)
                    .start();
        }

        private void recycleVelocityTracker() {
            if (velocityTracker != null) {
                velocityTracker.recycle();
                velocityTracker = null;
            }
        }
    }
}
