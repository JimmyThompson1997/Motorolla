package com.pucky.device.accessibility;

import android.content.Context;

import com.pucky.device.command.CommandException;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class PuckyAccessibilityController {
    private final Context context;
    private final SettingsStore settingsStore;

    public PuckyAccessibilityController(Context context, SettingsStore settingsStore) {
        this.context = context.getApplicationContext();
        this.settingsStore = settingsStore;
    }

    public JSONObject status() {
        JSONObject out = PuckyAccessibilityService.status(context, settingsStore.isAccessibilityLabEnabled());
        Json.put(out, "curated_surfaces", PuckyAccessibilityService.curatedSurfaces());
        return out;
    }

    public JSONObject snapshot(JSONObject args, boolean lab) throws CommandException {
        if (lab) {
            AccessibilitySurfacePolicy.requireLabEnabled(settingsStore.isAccessibilityLabEnabled());
        }
        return PuckyAccessibilityService.snapshot(context, args, lab, settingsStore.isAccessibilityLabEnabled());
    }

    public JSONObject waitFor(JSONObject args, boolean lab) throws CommandException {
        if (lab) {
            AccessibilitySurfacePolicy.requireLabEnabled(settingsStore.isAccessibilityLabEnabled());
        }
        return PuckyAccessibilityService.waitFor(context, args, lab, settingsStore.isAccessibilityLabEnabled());
    }

    public JSONObject action(JSONObject args, boolean lab) throws CommandException {
        if (lab) {
            AccessibilitySurfacePolicy.requireLabEnabled(settingsStore.isAccessibilityLabEnabled());
        }
        return PuckyAccessibilityService.performNodeAction(context, args, lab, settingsStore.isAccessibilityLabEnabled());
    }

    public JSONObject type(JSONObject args, boolean lab) throws CommandException {
        if (lab) {
            AccessibilitySurfacePolicy.requireLabEnabled(settingsStore.isAccessibilityLabEnabled());
        }
        return PuckyAccessibilityService.typeIntoNode(context, args, lab, settingsStore.isAccessibilityLabEnabled());
    }

    public JSONObject globalAction(JSONObject args) throws CommandException {
        return PuckyAccessibilityService.performGlobalActionCommand(context, args);
    }

    public JSONObject gesture(JSONObject args) throws CommandException {
        AccessibilitySurfacePolicy.requireLabEnabled(settingsStore.isAccessibilityLabEnabled());
        return PuckyAccessibilityService.performGestureCommand(context, args, settingsStore.isAccessibilityLabEnabled());
    }
}
