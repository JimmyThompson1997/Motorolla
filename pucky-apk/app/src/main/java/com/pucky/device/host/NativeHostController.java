package com.pucky.device.host;

import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import com.pucky.device.MainActivity;
import com.pucky.device.state.PuckyState;
import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class NativeHostController {
    private final Context context;

    public NativeHostController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject status() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.native_host_status.v1");
        Json.put(out, "state", PuckyState.get().snapshotJson());
        return out;
    }

    public JSONObject showHost(JSONObject args) {
        Intent intent = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (args.optBoolean("connect", false)) {
            intent.putExtra("connect", true);
        }
        context.startActivity(intent);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.native_host_show_result.v1");
        Json.put(out, "launched", true);
        Json.put(out, "connect_requested", args.optBoolean("connect", false));
        Json.put(out, "risk", "visible");
        return out;
    }

    public JSONObject launcherCapability() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.launcher_capability.v1");
        Json.put(out, "package_name", context.getPackageName());
        Json.put(out, "launcher_activity", MainActivity.class.getName());
        Json.put(out, "normal_launcher_icon", true);
        Json.put(out, "home_activity_declared", true);
        Json.put(out, "home_category", "android.intent.category.HOME");
        Json.put(out, "manual_default_selection_required", true);
        Json.put(out, "reversible_by_user", true);
        Json.put(out, "persistent_preferred_launcher", false);
        Json.put(out, "persistent_launcher_requires_device_owner", true);
        Json.put(out, "home_settings_action", Settings.ACTION_HOME_SETTINGS);
        Json.put(out, "app_settings_action", Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        return out;
    }
}
