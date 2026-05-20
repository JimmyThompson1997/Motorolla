package com.pucky.device.ui;

import android.content.Context;
import android.content.Intent;
import android.provider.Settings;

import com.pucky.device.MainActivity;
import com.pucky.device.state.PuckyState;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

public final class PuckyUiController {
    private final Context context;
    private final ReplyCardStore replyCards;

    public PuckyUiController(Context context) {
        this.context = context.getApplicationContext();
        this.replyCards = new ReplyCardStore(this.context);
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

    public JSONObject replyCardsSet(JSONObject args) throws com.pucky.device.command.CommandException {
        JSONArray cards = args.optJSONArray("cards");
        JSONObject out = replyCards.replace(cards);
        PuckyState.get().setLifecycleEvent("reply_cards.updated");
        PuckyState.get().broadcast(context);
        return out;
    }

    public JSONObject replyCardsGet() {
        return replyCards.snapshot();
    }

    public JSONObject replyCardsClear() {
        JSONObject out = replyCards.clear();
        PuckyState.get().setLifecycleEvent("reply_cards.cleared");
        PuckyState.get().broadcast(context);
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
