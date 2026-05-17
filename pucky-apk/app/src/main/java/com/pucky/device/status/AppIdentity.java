package com.pucky.device.status;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

public final class AppIdentity {
    private AppIdentity() {
    }

    public static String versionName(Context context) {
        try {
            PackageInfo info;
            if (Build.VERSION.SDK_INT >= 33) {
                info = context.getPackageManager().getPackageInfo(
                        context.getPackageName(),
                        PackageManager.PackageInfoFlags.of(0));
            } else {
                info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            }
            return info.versionName == null ? "unknown" : info.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "unknown";
        }
    }
}
