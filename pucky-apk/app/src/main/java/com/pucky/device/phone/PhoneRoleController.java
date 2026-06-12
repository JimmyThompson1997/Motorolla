package com.pucky.device.phone;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.role.RoleManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.telecom.TelecomManager;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class PhoneRoleController {
    private static final String CHANNEL_ID = "pucky_phone_role_setup";
    private static final int NOTIFICATION_ID = 4212;

    private PhoneRoleController() {
    }

    public static JSONObject status(Context context) {
        Context appContext = context.getApplicationContext();
        String packageName = appContext.getPackageName();
        boolean roleAvailable = false;
        boolean roleHeld = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager manager = appContext.getSystemService(RoleManager.class);
            if (manager != null) {
                roleAvailable = manager.isRoleAvailable(RoleManager.ROLE_DIALER);
                roleHeld = manager.isRoleHeld(RoleManager.ROLE_DIALER);
            }
        }
        boolean handlesDialIntent = handlesDialIntent(appContext);
        boolean inCallServiceDeclared = hasInCallServiceDeclared(appContext);
        boolean eligible = PhoneRoleState.isEligible(roleAvailable, handlesDialIntent, inCallServiceDeclared);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.phone_role_status.v1");
        Json.put(out, "package_name", packageName);
        Json.put(out, "role_name", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? RoleManager.ROLE_DIALER : "android.app.role.DIALER");
        Json.put(out, "role_available", roleAvailable);
        Json.put(out, "role_held", roleHeld);
        Json.put(out, "dial_intent_declared", handlesDialIntent);
        Json.put(out, "in_call_service_declared", inCallServiceDeclared);
        Json.put(out, "eligible", eligible);
        Json.put(out, "state", PhoneRoleState.classify(roleAvailable, handlesDialIntent, inCallServiceDeclared, roleHeld));
        Json.put(out, "default_dialer_package", defaultDialerPackage(appContext));
        Json.put(out, "setup_activity", PhoneRoleSetupActivity.class.getName());
        Json.put(out, "settings_action", Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
        return out;
    }

    public static JSONObject requestSetup(Context context, boolean showNotification, boolean openSetupUi) throws CommandException {
        JSONObject out = status(context);
        if (!out.optBoolean("eligible", false) && !out.optBoolean("role_held", false)) {
            throw new CommandException(
                    CommandErrorCodes.CAPABILITY_UNAVAILABLE,
                    "Pucky is not yet dialer-role eligible on this build");
        }
        if (showNotification) {
            showSetupNotification(context);
        }
        if (openSetupUi) {
            Intent intent = new Intent(context, PhoneRoleSetupActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
        }
        Json.put(out, "requested", true);
        Json.put(out, "notification_posted", showNotification);
        Json.put(out, "setup_ui_launched", openSetupUi);
        return out;
    }

    private static void showSetupNotification(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Pucky phone role setup",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }
        Intent setupIntent = new Intent(context, PhoneRoleSetupActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                NOTIFICATION_ID,
                setupIntent,
                flags);
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);
        builder.setContentTitle("Set Pucky as default phone app")
                .setContentText("Tap to open Android's phone-app role chooser.")
                .setStyle(new Notification.BigTextStyle().bigText(
                        "Pucky can use direct call controls, in-call state, and richer phone actions once it holds the default phone app role."))
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(false);
        if (Build.VERSION.SDK_INT < 26) {
            builder.setPriority(Notification.PRIORITY_HIGH);
        }
        manager.notify(NOTIFICATION_ID, builder.build());
    }

    private static boolean handlesDialIntent(Context context) {
        Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:5550100"));
        PackageManager manager = context.getPackageManager();
        for (android.content.pm.ResolveInfo resolveInfo : manager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)) {
            if (resolveInfo.activityInfo != null
                    && context.getPackageName().equals(resolveInfo.activityInfo.packageName)) {
                return true;
            }
        }
        return false;
    }

    private static boolean hasInCallServiceDeclared(Context context) {
        try {
            PackageInfo info;
            if (Build.VERSION.SDK_INT >= 33) {
                info = context.getPackageManager().getPackageInfo(
                        context.getPackageName(),
                        PackageManager.PackageInfoFlags.of(PackageManager.GET_SERVICES));
            } else {
                info = context.getPackageManager().getPackageInfo(
                        context.getPackageName(),
                        PackageManager.GET_SERVICES);
            }
            if (info.services == null) {
                return false;
            }
            for (android.content.pm.ServiceInfo service : info.services) {
                if (context.getPackageName().equals(service.packageName)
                        && service.name != null
                        && service.name.endsWith("PuckyInCallService")) {
                    return true;
                }
            }
        } catch (PackageManager.NameNotFoundException ignored) {
        }
        return false;
    }

    private static Object defaultDialerPackage(Context context) {
        TelecomManager telecom = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
        if (telecom == null) {
            return JSONObject.NULL;
        }
        String holder = telecom.getDefaultDialerPackage();
        return holder == null || holder.trim().isEmpty() ? JSONObject.NULL : holder;
    }
}
