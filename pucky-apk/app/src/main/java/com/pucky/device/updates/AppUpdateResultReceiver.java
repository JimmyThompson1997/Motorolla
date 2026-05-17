package com.pucky.device.updates;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;

import com.pucky.device.state.PuckyState;

public final class AppUpdateResultReceiver extends BroadcastReceiver {
    public static final String ACTION_INSTALL_RESULT = "com.pucky.device.APP_UPDATE_INSTALL_RESULT";

    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(
                PackageInstaller.EXTRA_STATUS,
                PackageInstaller.STATUS_FAILURE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        PuckyState.get().setLifecycleEvent("app_update.status_" + status);
        if (message != null && !message.trim().isEmpty()) {
            PuckyState.get().setLastError(message);
        }
        PuckyState.get().broadcast(context);

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmation != null) {
                confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(confirmation);
            }
        }
    }
}
