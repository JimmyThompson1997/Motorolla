package com.pucky.device.ui;

import android.app.Activity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;

import com.pucky.device.R;

public final class DetailSurfaceController {
    private static final int EDGE_START_DP = 72;
    private static final int DISMISS_DISTANCE_DP = 120;

    private DetailSurfaceController() {
    }

    public static void applyOpenTransition(Activity activity) {
        activity.overridePendingTransition(R.anim.pucky_detail_slide_in_right, R.anim.pucky_detail_hold);
    }

    public static void applyCloseTransition(Activity activity) {
        activity.overridePendingTransition(R.anim.pucky_detail_hold, R.anim.pucky_detail_slide_out_right);
    }

    public static void installEdgeSwipeDismiss(Activity activity, View view) {
        EdgeSwipeDismissTouchListener listener = new EdgeSwipeDismissTouchListener(activity);
        view.setOnTouchListener(listener);
    }

    private static final class EdgeSwipeDismissTouchListener implements View.OnTouchListener {
        private final Activity activity;
        private final float edgeStartPx;
        private final float dismissDistancePx;
        private final float touchSlopPx;
        private float downX;
        private float downY;
        private boolean tracking;
        private boolean dismissed;

        EdgeSwipeDismissTouchListener(Activity activity) {
            this.activity = activity;
            float density = activity.getResources().getDisplayMetrics().density;
            this.edgeStartPx = EDGE_START_DP * density;
            this.dismissDistancePx = DISMISS_DISTANCE_DP * density;
            this.touchSlopPx = ViewConfiguration.get(activity).getScaledTouchSlop();
        }

        @Override
        public boolean onTouch(View view, MotionEvent event) {
            if (dismissed) {
                return true;
            }
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = event.getX();
                    downY = event.getY();
                    tracking = downX <= edgeStartPx;
                    return false;
                case MotionEvent.ACTION_MOVE:
                    if (!tracking) {
                        return false;
                    }
                    float dx = event.getX() - downX;
                    float dy = Math.abs(event.getY() - downY);
                    if (dx > touchSlopPx && dy > Math.max(touchSlopPx, dx * 0.7f)) {
                        tracking = false;
                        return false;
                    }
                    if (dx >= dismissDistancePx) {
                        dismissed = true;
                        activity.finish();
                        applyCloseTransition(activity);
                        return true;
                    }
                    return dx > touchSlopPx;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    tracking = false;
                    return false;
                default:
                    return false;
            }
        }
    }
}
