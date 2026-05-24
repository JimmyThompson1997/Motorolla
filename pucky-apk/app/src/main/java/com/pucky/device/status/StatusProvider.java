package com.pucky.device.status;

import com.pucky.device.util.Json;

import android.content.Context;
import android.os.Build;

import com.pucky.device.battery.BatteryProvider;
import com.pucky.device.network.NetworkProvider;
import com.pucky.device.sensors.SensorController;
import com.pucky.device.storage.SettingsStore;
import org.json.JSONObject;

public final class StatusProvider {
    private final Context context;
    private final SettingsStore settingsStore;

    public StatusProvider(Context context, SettingsStore settingsStore) {
        this.context = context.getApplicationContext();
        this.settingsStore = settingsStore;
    }

    public JSONObject read() {
        JSONObject out = new JSONObject();
        Json.put(out, "device_id", settingsStore.getDeviceId());
        Json.put(out, "apk_version", AppIdentity.versionName(context));
        Json.put(out, "apk_identity", AppIdentity.json(context));
        Json.put(out, "android", androidJson());
        Json.put(out, "battery", new BatteryProvider(context).read());
        Json.put(out, "network", new NetworkProvider(context).read());
        Json.put(out, "sensors", new SensorController(context).list());
        return out;
    }

    private JSONObject androidJson() {
        JSONObject out = new JSONObject();
        Json.put(out, "manufacturer", Build.MANUFACTURER);
        Json.put(out, "model", Build.MODEL);
        Json.put(out, "product", Build.PRODUCT);
        Json.put(out, "hardware", Build.HARDWARE);
        Json.put(out, "sdk", Build.VERSION.SDK_INT);
        Json.put(out, "release", Build.VERSION.RELEASE);
        return out;
    }
}

