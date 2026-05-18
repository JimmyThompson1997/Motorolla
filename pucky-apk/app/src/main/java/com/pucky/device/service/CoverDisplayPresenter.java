package com.pucky.device.service;

import android.app.ActivityOptions;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.hardware.display.DisplayManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Display;

import com.pucky.device.MainActivity;
import com.pucky.device.state.PuckyState;

final class CoverDisplayPresenter {
    private static final String TAG = "PuckyCoverPresenter";
    private static final int COVER_PRESENT_REQUEST_CODE = 41004;
    private static final int RAZR_COVER_DISPLAY_ID = 1;
    private static final long INITIAL_DELAY_MS = 750L;
    private static final long ARM_TIMEOUT_MS = 30_000L;

    private final Context context;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private DisplayManager displayManager;
    private DisplayManager.DisplayListener displayListener;
    private boolean armed;
    private boolean attempted;

    CoverDisplayPresenter(Context context) {
        this.context = context.getApplicationContext();
    }

    void armOnce(String reason) {
        if (armed || attempted) {
            return;
        }
        armed = true;
        displayManager = (DisplayManager) context.getSystemService(Context.DISPLAY_SERVICE);
        registerListener();
        handler.postDelayed(() -> maybePresent(reason), INITIAL_DELAY_MS);
        handler.postDelayed(() -> shutdown("timeout"), ARM_TIMEOUT_MS);
        logEvent("cover_presenter.armed." + safeReason(reason));
    }

    void shutdown(String reason) {
        unregisterListener();
        armed = false;
        handler.removeCallbacksAndMessages(null);
        Log.i(TAG, "shutdown reason=" + reason + " attempted=" + attempted);
    }

    private void registerListener() {
        if (displayManager == null || displayListener != null) {
            return;
        }
        displayListener = new DisplayManager.DisplayListener() {
            @Override
            public void onDisplayAdded(int displayId) {
                if (displayId != Display.DEFAULT_DISPLAY) {
                    maybePresent("display_added_" + displayId);
                }
            }

            @Override
            public void onDisplayChanged(int displayId) {
                if (displayId != Display.DEFAULT_DISPLAY) {
                    maybePresent("display_changed_" + displayId);
                }
            }

            @Override
            public void onDisplayRemoved(int displayId) {
                if (displayId != Display.DEFAULT_DISPLAY) {
                    Log.i(TAG, "cover display removed id=" + displayId);
                }
            }
        };
        displayManager.registerDisplayListener(displayListener, handler);
    }

    private void unregisterListener() {
        if (displayManager != null && displayListener != null) {
            try {
                displayManager.unregisterDisplayListener(displayListener);
            } catch (RuntimeException ignored) {
                // Display services can already be tearing down while the app process exits.
            }
        }
        displayListener = null;
    }

    private void maybePresent(String reason) {
        if (!armed || attempted) {
            return;
        }
        Display display = findCoverDisplay();
        if (display == null) {
            Log.i(TAG, "present skipped; cover display unavailable reason=" + reason);
            return;
        }
        attempted = true;
        armed = false;
        unregisterListener();
        launchOnCover(display, reason);
    }

    private Display findCoverDisplay() {
        if (displayManager == null) {
            return null;
        }
        Display preferred = displayManager.getDisplay(RAZR_COVER_DISPLAY_ID);
        if (isCoverDisplay(preferred)) {
            return preferred;
        }
        Display[] displays = displayManager.getDisplays();
        for (Display display : displays) {
            if (isCoverDisplay(display)) {
                return display;
            }
        }
        return null;
    }

    private static boolean isCoverDisplay(Display display) {
        return display != null
                && display.getDisplayId() != Display.DEFAULT_DISPLAY;
    }

    private void launchOnCover(Display display, String reason) {
        int displayId = display.getDisplayId();
        try {
            Intent intent = new Intent(Intent.ACTION_MAIN)
                    .addCategory(Intent.CATEGORY_SECONDARY_HOME)
                    .setClass(context, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP
                            | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    .putExtra("home", true)
                    .putExtra("source", "cover_presenter")
                    .putExtra("present_reason", reason);
            Bundle options = ActivityOptions.makeBasic()
                    .setLaunchDisplayId(displayId)
                    .toBundle();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ActivityOptions creatorOptions = ActivityOptions.makeBasic()
                        .setLaunchDisplayId(displayId);
                creatorOptions.setPendingIntentCreatorBackgroundActivityStartMode(
                        ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                ActivityOptions senderOptions = ActivityOptions.makeBasic()
                        .setLaunchDisplayId(displayId);
                senderOptions.setPendingIntentBackgroundActivityStartMode(
                        ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
                options = senderOptions.toBundle();
                int flags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    flags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent pendingIntent = PendingIntent.getActivity(
                        context,
                        COVER_PRESENT_REQUEST_CODE,
                        intent,
                        flags,
                        creatorOptions.toBundle());
                pendingIntent.send(context, 0, null, null, null, null, options);
            } else {
                context.startActivity(intent, options);
            }
            logEvent("cover_presenter.requested." + safeReason(reason));
            Log.i(TAG, "present requested display=" + displayId
                    + " state=" + display.getState()
                    + " reason=" + reason);
        } catch (Exception exc) {
            logEvent("cover_presenter.failed");
            PuckyState.get().setLastError(exc.getClass().getSimpleName() + ": " + exc.getMessage());
            PuckyState.get().broadcast(context);
            Log.w(TAG, "present failed display=" + displayId + " reason=" + reason, exc);
        }
    }

    private void logEvent(String event) {
        PuckyState.get().setLifecycleEvent(event);
        PuckyState.get().broadcast(context);
    }

    private static String safeReason(String reason) {
        if (reason == null || reason.trim().isEmpty()) {
            return "unknown";
        }
        return reason.replaceAll("[^A-Za-z0-9_]+", "_");
    }
}
