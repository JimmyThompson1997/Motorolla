package com.pucky.device.ui;

import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import com.pucky.device.MainActivity;
import com.pucky.device.state.PuckyState;
import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class PuckyUiController {
    private final Context context;

    public PuckyUiController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject state() {
        return PuckyState.get().snapshotJson();
    }

    public JSONObject showDashboard(JSONObject args) {
        Intent intent = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra("show_home", true);
        String surface = args.optString("surface", "").trim();
        if (!surface.isEmpty()) {
            intent.putExtra("surface", surface);
        }
        if (args.optBoolean("connect", false)) {
            intent.putExtra("connect", true);
        }
        context.startActivity(intent);
        JSONObject out = new JSONObject();
        Json.put(out, "launched", true);
        Json.put(out, "target", "dashboard");
        Json.put(out, "connect_requested", args.optBoolean("connect", false));
        Json.put(out, "risk", "visible");
        return out;
    }

    public JSONObject surfaceGet(UiBundleController bundles) {
        return new UiSurfaceController(context).status(bundles);
    }

    public JSONObject voiceThreadScopeGet() {
        return VoiceThreadScopeController.shared(context).get();
    }

    public JSONObject voiceThreadScopeSet(JSONObject args) throws com.pucky.device.command.CommandException {
        return VoiceThreadScopeController.shared(context).set(args);
    }

    public JSONObject voiceThreadScopeClear(JSONObject args) {
        return VoiceThreadScopeController.shared(context).clear(args);
    }

    public JSONObject debugGotoHome(JSONObject args) {
        return UiAutomationController.dispatch("goto_home", args);
    }

    public JSONObject debugBack(JSONObject args) {
        return UiAutomationController.dispatch("back", args);
    }

    public JSONObject debugFocusCard(JSONObject args) {
        return UiAutomationController.dispatch("focus_card", args);
    }

    public JSONObject debugClearFocus(JSONObject args) {
        return UiAutomationController.dispatch("clear_focus", args);
    }

    public JSONObject debugRefreshCards(JSONObject args) {
        return UiAutomationController.dispatch("refresh_cards", args);
    }

    public JSONObject debugOpenCardAction(JSONObject args) {
        return UiAutomationController.dispatch("open_card_action", args);
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
