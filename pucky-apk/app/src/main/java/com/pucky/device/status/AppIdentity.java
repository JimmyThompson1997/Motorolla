package com.pucky.device.status;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

import com.pucky.device.BuildConfig;
import com.pucky.device.util.Json;

import org.json.JSONObject;

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

    public static long versionCode(Context context) {
        try {
            PackageInfo info;
            if (Build.VERSION.SDK_INT >= 33) {
                info = context.getPackageManager().getPackageInfo(
                        context.getPackageName(),
                        PackageManager.PackageInfoFlags.of(0));
            } else {
                info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return info.getLongVersionCode();
            }
            return info.versionCode;
        } catch (PackageManager.NameNotFoundException e) {
            return -1L;
        }
    }

    public static JSONObject json(Context context) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.apk_identity.v1");
        Json.put(out, "package_name", context.getPackageName());
        Json.put(out, "version_code", versionCode(context));
        Json.put(out, "version_name", versionName(context));
        Json.put(out, "git_commit", BuildConfig.PUCKY_GIT_COMMIT);
        Json.put(out, "git_branch", BuildConfig.PUCKY_GIT_BRANCH);
        Json.put(out, "git_dirty", BuildConfig.PUCKY_GIT_DIRTY);
        Json.put(out, "build_time", BuildConfig.PUCKY_BUILD_TIME);
        return out;
    }
}
