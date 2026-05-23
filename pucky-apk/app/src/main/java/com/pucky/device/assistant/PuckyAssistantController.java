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

import com.pucky.device.service.PuckyForegroundService;
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
        new Thread(() -> handleAssistantSession(appContext, args, showFlags), "pucky-assistant-session").start();
    }

    private static void handleAssistantSession(Context context, Bundle args, int showFlags) {
        try {
            PuckyForegroundService.start(context, true);
            JSONObject event = new JSONObject();
            Json.put(event, "schema", "pucky.assistant_invocation.v1");
            Json.put(event, "source", "assistant_power_hold");
            Json.put(event, "show_flags", showFlags);
            Json.put(event, "assistant_bundle_keys", args == null ? 0 : args.keySet().size());
            Json.put(event, "open_line_backend", "none");
            Log.i(TAG, "assistant power hold received result=" + event);
        } catch (Exception exc) {
            Log.e(TAG, "assistant power hold failed", exc);
        }
    }

    private static boolean containsPackage(String value, String packageName) {
        return value != null && packageName != null && value.contains(packageName);
    }
}
