package com.pucky.device.buttons;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.util.Log;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

public final class PuckyButtonAccessibilityService extends AccessibilityService {
    private static final String TAG = "PuckyButtonA11y";

    private ButtonController buttonController;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        buttonController = new ButtonController(this);
        AccessibilityServiceInfo info = getServiceInfo();
        if (info != null) {
            info.flags |= AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS;
            setServiceInfo(info);
        }
        Log.i(TAG, "global button capture connected");
    }

    @Override
    public boolean onKeyEvent(KeyEvent event) {
        if (buttonController == null || event == null) {
            return false;
        }
        boolean handled;
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            handled = buttonController.handleGlobalKeyDown(event.getKeyCode(), event);
        } else if (event.getAction() == KeyEvent.ACTION_UP) {
            handled = buttonController.handleGlobalKeyUp(event.getKeyCode(), event);
        } else {
            handled = false;
        }
        if (handled) {
            Log.i(TAG, "handled key=" + event.getKeyCode()
                    + " action=" + event.getAction()
                    + " repeat=" + event.getRepeatCount());
        }
        return handled;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Key filtering is the entire purpose of this service.
    }

    @Override
    public void onInterrupt() {
        Log.i(TAG, "global button capture interrupted");
    }
}
