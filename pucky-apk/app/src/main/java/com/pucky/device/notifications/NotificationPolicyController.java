package com.pucky.device.notifications;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.util.Locale;

public final class NotificationPolicyController {
    private final Context context;

    public NotificationPolicyController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject status() {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.notification_policy_status.v1");
        Json.put(out, "available", manager != null);
        Json.put(out, "policy_access_granted", manager != null && manager.isNotificationPolicyAccessGranted());
        Json.put(out, "interruption_filter", manager == null ? JSONObject.NULL : manager.getCurrentInterruptionFilter());
        Json.put(out, "full_screen_permission_supported", Build.VERSION.SDK_INT >= 34);
        Json.put(out, "can_use_full_screen_intent", canUseFullScreenIntent(manager));
        Json.put(out, "settings_action", Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
        Json.put(out, "full_screen_settings_action", Build.VERSION.SDK_INT >= 34 ? Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT : JSONObject.NULL);
        return out;
    }

    public JSONObject openSettings(JSONObject args) throws CommandException {
        String target = String.valueOf(args == null ? "" : args.optString("target", "policy")).trim().toLowerCase(Locale.US);
        Intent intent;
        if ("full_screen".equals(target)) {
            if (Build.VERSION.SDK_INT < 34) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Full-screen notification settings require Android 14+");
            }
            intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                    .setData(Uri.parse("package:" + context.getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        } else {
            intent = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        context.startActivity(intent);
        JSONObject out = status();
        Json.put(out, "schema", "pucky.notification_policy_open_settings.v1");
        Json.put(out, "opened", true);
        Json.put(out, "target", target);
        return out;
    }

    public boolean canUseFullScreenIntent(NotificationManager manager) {
        if (manager == null) {
            return false;
        }
        if (Build.VERSION.SDK_INT < 34) {
            return true;
        }
        return manager.canUseFullScreenIntent();
    }
}
