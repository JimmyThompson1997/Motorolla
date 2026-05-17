package com.pucky.device.service;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import com.pucky.device.storage.SettingsStore;

public final class PuckyBootReceiver extends BroadcastReceiver {
    private static final String TAG = "PuckyBootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        SettingsStore settings = new SettingsStore(context);
        Log.i(TAG, "onReceive action=" + action
                + " autostart=" + settings.isAutostartEnabled()
                + " auto_connect=" + settings.isAutoConnectEnabled());
        if (!settings.isAutostartEnabled() || !settings.isAutoConnectEnabled()) {
            return;
        }
        PuckyForegroundService.start(context, true);
    }
}
