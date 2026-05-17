package com.pucky.device.assistant;

import android.app.Activity;
import android.app.role.RoleManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;

import com.pucky.device.livekit.LiveKitController;
import com.pucky.device.service.PuckyForegroundService;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class PuckyAssistantController {
    private static final String TAG = "PuckyAssistant";

    private PuckyAssistantController() {
    }

    public static JSONObject status(Context context) {
        Context appContext = context.getApplicationContext();
        JSONObject out = new JSONObject();
        String packageName = appContext.getPackageName();
        String assistant = Settings.Secure.getString(appContext.getContentResolver(), "assistant");
        String voiceInteractionService =
                Settings.Secure.getString(appContext.getContentResolver(), "voice_interaction_service");
        boolean roleAvailable = false;
        boolean roleHeld = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roleManager = appContext.getSystemService(RoleManager.class);
            if (roleManager != null) {
                roleAvailable = roleManager.isRoleAvailable(RoleManager.ROLE_ASSISTANT);
                roleHeld = roleManager.isRoleHeld(RoleManager.ROLE_ASSISTANT);
            }
        }
        Json.put(out, "schema", "pucky.assistant_status.v1");
        Json.put(out, "package_name", packageName);
        Json.put(out, "role_available", roleAvailable);
        Json.put(out, "role_held", roleHeld);
        Json.put(out, "assistant", assistant == null ? JSONObject.NULL : assistant);
        Json.put(out, "voice_interaction_service",
                voiceInteractionService == null ? JSONObject.NULL : voiceInteractionService);
        Json.put(out, "configured",
                roleHeld
                        || containsPackage(assistant, packageName)
                        || containsPackage(voiceInteractionService, packageName));
        return out;
    }

    public static void openAssistantSetup(Activity activity) {
        if (startSettingsActivity(activity, Settings.ACTION_VOICE_INPUT_SETTINGS)) {
            return;
        }
        startSettingsActivity(activity, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
    }

    private static boolean startSettingsActivity(Activity activity, String action) {
        Intent intent = new Intent(action);
        if (intent.resolveActivity(activity.getPackageManager()) == null) {
            return false;
        }
        try {
            Log.i(TAG, "opening assistant setup settings action=" + action);
            activity.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException exc) {
            Log.w(TAG, "assistant setup settings failed action=" + action, exc);
            return false;
        }
    }

    public static void handleAssistantInvocation(Context context, Bundle args, int showFlags) {
        Context appContext = context.getApplicationContext();
        new Thread(() -> toggleOpenLine(appContext, args, showFlags), "pucky-assistant-toggle").start();
    }

    public static boolean isOpenLineActive(JSONObject liveKitStatus) {
        if (liveKitStatus == null) {
            return false;
        }
        String activeTurnId = liveKitStatus.optString("active_ptt_turn_id", "").trim();
        if ("null".equalsIgnoreCase(activeTurnId)) {
            activeTurnId = "";
        }
        return liveKitStatus.optBoolean("mic_enabled", false)
                || "connected_talking".equals(liveKitStatus.optString("state", ""))
                || !activeTurnId.isEmpty();
    }

    private static void toggleOpenLine(Context context, Bundle args, int showFlags) {
        try {
            PuckyForegroundService.start(context, true);
            SettingsStore settings = new SettingsStore(context);
            LiveKitController liveKit = LiveKitController.shared(context, settings);
            JSONObject before = liveKit.status();
            JSONObject commandArgs = new JSONObject();
            Json.put(commandArgs, "source", "assistant_power_hold");
            Json.put(commandArgs, "show_flags", showFlags);
            Json.put(commandArgs, "assistant_bundle_keys", args == null ? 0 : args.keySet().size());
            if (isOpenLineActive(before)) {
                Json.put(commandArgs, "reason", "assistant_power_hold_stop");
                Json.put(commandArgs, "haptic_on_stop", true);
                JSONObject result = liveKit.pttStop(commandArgs);
                Log.i(TAG, "assistant power hold stopped open line result=" + result);
            } else {
                Json.put(commandArgs, "reason", "assistant_power_hold_start");
                Json.put(commandArgs, "ptt_turn_id", "assistant_" + Long.toHexString(System.currentTimeMillis()));
                Json.put(commandArgs, "force_new_session", true);
                Json.put(commandArgs, "force_new_session_reason", "assistant_power_hold_start");
                JSONObject result = liveKit.pttStart(commandArgs);
                Log.i(TAG, "assistant power hold started open line result=" + result);
            }
        } catch (Exception exc) {
            Log.e(TAG, "assistant power hold failed", exc);
        }
    }

    private static boolean containsPackage(String value, String packageName) {
        return value != null && packageName != null && value.contains(packageName);
    }
}
