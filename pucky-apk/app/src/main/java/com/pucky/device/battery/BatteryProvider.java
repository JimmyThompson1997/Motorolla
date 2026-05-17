package com.pucky.device.battery;

import com.pucky.device.util.Json;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;

import org.json.JSONObject;

public final class BatteryProvider {
    private final Context context;

    public BatteryProvider(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject read() {
        Intent intent = context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        JSONObject out = new JSONObject();
        if (intent == null) {
            Json.put(out, "available", false);
            return out;
        }
        int level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        int status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        int plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1);
        Json.put(out, "available", true);
        Json.put(out, "level", level);
        Json.put(out, "scale", scale);
        Json.put(out, "percent", level >= 0 && scale > 0 ? Math.round((level * 100.0f) / scale) : JSONObject.NULL);
        Json.put(out, "status", status);
        Json.put(out, "plugged", plugged);
        Json.put(out, "charging", status == BatteryManager.BATTERY_STATUS_CHARGING
                || status == BatteryManager.BATTERY_STATUS_FULL);
        return out;
    }
}

