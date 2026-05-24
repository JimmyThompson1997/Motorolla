package com.pucky.device.service;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import com.pucky.device.storage.SettingsStore;

public final class PuckyBootReceiver extends BroadcastReceiver {
    private static final String TAG = "PuckyBootReceiver";
    public static final String ACTION_RESTART_SERVICE = "com.pucky.device.action.RESTART_SERVICE";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        String reason = intent == null ? "none" : intent.getStringExtra("reason");
        SettingsStore settings = new SettingsStore(context);
        Log.i(TAG, "onReceive action=" + action
                + " reason=" + reason
                + " autostart=" + settings.isAutostartEnabled()
                + " auto_connect=" + settings.isAutoConnectEnabled());
        if (!settings.isAutostartEnabled() || !settings.isAutoConnectEnabled()) {
            return;
        }
        try {
            PuckyForegroundService.start(context, settings.isAutoConnectEnabled());
        } catch (RuntimeException exc) {
            Log.w(TAG, "foreground service restart failed action=" + action, exc);
        }
    }
}
