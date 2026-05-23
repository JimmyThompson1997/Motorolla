package com.pucky.device.accessibility;

import android.accessibilityservice.AccessibilityService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

public final class PuckyAccessibilityService extends AccessibilityService {
    private static final String TAG = "PuckyAccessibility";
    private static volatile PuckyAccessibilityService activeService;

    public static boolean canLockScreen(Context context) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && activeService != null;
    }

    public static PuckyAccessibilityService activeService() {
        return activeService;
    }

    public static boolean lockScreen() {
        PuckyAccessibilityService service = activeService;
        if (service == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            return false;
        }
        return service.performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
    }

    public static boolean isEnabledInSettings(Context context) {
        try {
            String enabledServices = Settings.Secure.getString(
                    context.getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (TextUtils.isEmpty(enabledServices)) {
                return false;
            }
            String expected = new ComponentName(context, PuckyAccessibilityService.class)
                    .flattenToString();
            TextUtils.SimpleStringSplitter splitter = new TextUtils.SimpleStringSplitter(':');
            splitter.setString(enabledServices);
            while (splitter.hasNext()) {
                if (expected.equalsIgnoreCase(splitter.next())) {
                    return true;
                }
            }
        } catch (RuntimeException exc) {
            Log.w(TAG, "Unable to read accessibility setting", exc);
        }
        return false;
    }

    @Override
    protected void onServiceConnected() {
        activeService = this;
        Log.i(TAG, "Pucky accessibility service connected");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Pucky only needs the user-enabled global lock action; it does not inspect UI events.
    }

    @Override
    public void onInterrupt() {
        // No ongoing accessibility work to interrupt.
    }

    @Override
    public void onDestroy() {
        if (activeService == this) {
            activeService = null;
        }
        super.onDestroy();
    }
}
