package com.pucky.device.audio;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;

import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

public final class AudioRouteDetector {
    public enum Route {
        Phone,
        Bluetooth,
        WiredHeadset,
        Unknown
    }

    private final Context context;

    public AudioRouteDetector(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject snapshot() {
        AudioManager manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_route.v1");
        Json.put(out, "available", manager != null);
        if (manager == null) {
            Json.put(out, "route", Route.Unknown.name());
            return out;
        }
        AudioDeviceInfo[] devices = manager.getDevices(AudioManager.GET_DEVICES_INPUTS);
        Route route = classify(devices);
        Json.put(out, "route", route.name());
        Json.put(out, "input_devices", devicesJson(devices));
        Json.put(out, "mode", manager.getMode());
        Json.put(out, "speakerphone_on", manager.isSpeakerphoneOn());
        Json.put(out, "bluetooth_sco_on_legacy", manager.isBluetoothScoOn());
        Json.put(out, "wired_headset_on_legacy", manager.isWiredHeadsetOn());
        Json.put(out, "microphone_mute", manager.isMicrophoneMute());
        return out;
    }

    public Route currentRoute() {
        AudioManager manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        return manager == null ? Route.Unknown : classify(manager.getDevices(AudioManager.GET_DEVICES_INPUTS));
    }

    public static Route classify(AudioDeviceInfo[] devices) {
        if (devices == null || devices.length == 0) {
            return Route.Unknown;
        }
        boolean phone = false;
        boolean wired = false;
        boolean bluetooth = false;
        for (AudioDeviceInfo device : devices) {
            if (device == null || !device.isSource()) {
                continue;
            }
            int type = device.getType();
            if (isBluetoothType(type)) {
                bluetooth = true;
            } else if (isWiredType(type)) {
                wired = true;
            } else if (type == AudioDeviceInfo.TYPE_BUILTIN_MIC) {
                phone = true;
            }
        }
        if (bluetooth) {
            return Route.Bluetooth;
        }
        if (wired) {
            return Route.WiredHeadset;
        }
        if (phone) {
            return Route.Phone;
        }
        return Route.Unknown;
    }

    static Route classifyTypesForTest(int[] deviceTypes) {
        if (deviceTypes == null || deviceTypes.length == 0) {
            return Route.Unknown;
        }
        boolean phone = false;
        boolean wired = false;
        boolean bluetooth = false;
        for (int type : deviceTypes) {
            if (isBluetoothType(type)) {
                bluetooth = true;
            } else if (isWiredType(type)) {
                wired = true;
            } else if (type == AudioDeviceInfo.TYPE_BUILTIN_MIC) {
                phone = true;
            }
        }
        if (bluetooth) {
            return Route.Bluetooth;
        }
        if (wired) {
            return Route.WiredHeadset;
        }
        if (phone) {
            return Route.Phone;
        }
        return Route.Unknown;
    }

    private static boolean isBluetoothType(int type) {
        return type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                || type == AudioDeviceInfo.TYPE_BLE_HEADSET;
    }

    private static boolean isWiredType(int type) {
        return type == AudioDeviceInfo.TYPE_WIRED_HEADSET
                || type == AudioDeviceInfo.TYPE_USB_HEADSET
                || type == AudioDeviceInfo.TYPE_USB_DEVICE
                || type == AudioDeviceInfo.TYPE_USB_ACCESSORY;
    }

    private static JSONArray devicesJson(AudioDeviceInfo[] devices) {
        JSONArray out = new JSONArray();
        if (devices == null) {
            return out;
        }
        for (AudioDeviceInfo device : devices) {
            if (device == null) {
                continue;
            }
            JSONObject item = new JSONObject();
            Json.put(item, "id", device.getId());
            Json.put(item, "type", device.getType());
            Json.put(item, "type_name", typeName(device.getType()));
            Json.put(item, "is_source", device.isSource());
            Json.put(item, "is_sink", device.isSink());
            Json.put(item, "product_name", device.getProductName() == null
                    ? JSONObject.NULL
                    : device.getProductName().toString());
            Json.add(out, item);
        }
        return out;
    }

    private static String typeName(int type) {
        switch (type) {
            case AudioDeviceInfo.TYPE_BUILTIN_MIC:
                return "builtin_mic";
            case AudioDeviceInfo.TYPE_BLUETOOTH_SCO:
                return "bluetooth_sco";
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
                return "ble_headset";
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
                return "wired_headset";
            case AudioDeviceInfo.TYPE_USB_HEADSET:
                return "usb_headset";
            case AudioDeviceInfo.TYPE_USB_DEVICE:
                return "usb_device";
            case AudioDeviceInfo.TYPE_USB_ACCESSORY:
                return "usb_accessory";
            default:
                return "type_" + type;
        }
    }
}
