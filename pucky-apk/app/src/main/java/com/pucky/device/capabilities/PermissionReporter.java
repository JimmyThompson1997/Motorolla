package com.pucky.device.capabilities;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.telecom.TelecomManager;
import android.provider.Telephony;

import com.pucky.device.status.AppIdentity;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.HashSet;
import java.util.Set;

public final class PermissionReporter {
    private static final String APP_DETAILS_ACTION = Settings.ACTION_APPLICATION_DETAILS_SETTINGS;

    private final Context context;
    private final SettingsStore settingsStore;

    public PermissionReporter(Context context, SettingsStore settingsStore) {
        this.context = context.getApplicationContext();
        this.settingsStore = settingsStore;
    }

    public JSONObject read() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.permissions.v1");
        Json.put(out, "device_id", settingsStore.getDeviceId());
        Json.put(out, "apk_version", AppIdentity.versionName(context));
        Json.put(out, "apk_identity", AppIdentity.json(context));
        Json.put(out, "package_name", context.getPackageName());
        Json.put(out, "android_sdk", Build.VERSION.SDK_INT);
        Json.put(out, "generated_at", Instant.now().toString());
        Json.put(out, "permissions", permissions());
        Json.put(out, "active_warnings", activeWarnings());
        return out;
    }

    public JSONArray activeWarnings() {
        JSONArray warnings = new JSONArray();
        if (!isGranted(Manifest.permission.CAMERA)) {
            Json.add(warnings, "CAMERA denied: torch.set and photo.capture are blocked");
        }
        if (!isGranted(Manifest.permission.RECORD_AUDIO)) {
            Json.add(warnings, "RECORD_AUDIO denied: voice.capture and speech.native are blocked");
        }
        if (Build.VERSION.SDK_INT >= 33 && !isGranted(Manifest.permission.POST_NOTIFICATIONS)) {
            Json.add(warnings, "POST_NOTIFICATIONS denied: notify.show and timer notifications are blocked");
        }
        if (!isGranted(Manifest.permission.ACCESS_FINE_LOCATION)
                && !isGranted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
            Json.add(warnings, "LOCATION denied: location.get and location.watch are blocked");
        }
        return warnings;
    }

    public boolean isEffectivelyGranted(String permission) {
        if (permission == null || permission.trim().isEmpty()) {
            return true;
        }
        if (Manifest.permission.POST_NOTIFICATIONS.equals(permission) && Build.VERSION.SDK_INT < 33) {
            return true;
        }
        if ("android.permission.READ_BLOCKED_NUMBERS".equals(permission)
                || "android.permission.WRITE_BLOCKED_NUMBERS".equals(permission)) {
            return isGranted(permission) || holdsDialerRole() || holdsSmsRole();
        }
        if ("com.android.voicemail.permission.READ_VOICEMAIL".equals(permission)
                || "com.android.voicemail.permission.ADD_VOICEMAIL".equals(permission)) {
            return isGranted(permission) || holdsDialerRole();
        }
        return isGranted(permission);
    }

    private JSONArray permissions() {
        Set<String> declared = declaredPermissions();
        JSONArray out = new JSONArray();
        add(out, Manifest.permission.INTERNET, declared, false, true, "normal",
                array("broker websocket", "browser.open"));
        add(out, Manifest.permission.ACCESS_NETWORK_STATE, declared, false, true, "normal",
                array("network.get", "status.get"));
        add(out, Manifest.permission.FOREGROUND_SERVICE, declared, false, true, "normal",
                array("PuckyForegroundService"));
        add(out, Manifest.permission.FOREGROUND_SERVICE_DATA_SYNC, declared, false, Build.VERSION.SDK_INT >= 34, "normal",
                array("broker websocket"));
        add(out, Manifest.permission.FOREGROUND_SERVICE_CAMERA, declared, false, Build.VERSION.SDK_INT >= 34, "normal",
                array("photo.capture", "torch.set"));
        add(out, Manifest.permission.FOREGROUND_SERVICE_LOCATION, declared, false, Build.VERSION.SDK_INT >= 34, "normal",
                array("location.watch"));
        add(out, Manifest.permission.FOREGROUND_SERVICE_MICROPHONE, declared, false, Build.VERSION.SDK_INT >= 34, "normal",
                array("voice.capture"));
        add(out, Manifest.permission.CAMERA, declared, true, true, "dangerous",
                array("camera.info", "torch.set", "photo.capture"));
        add(out, Manifest.permission.RECORD_AUDIO, declared, true, true, "dangerous",
                array("voice.capture", "speech.native"));
        add(out, Manifest.permission.ACCESS_COARSE_LOCATION, declared, true, true, "dangerous",
                array("location.get", "location.watch"));
        add(out, Manifest.permission.ACCESS_FINE_LOCATION, declared, true, true, "dangerous",
                array("location.get", "location.watch"));
        add(out, Manifest.permission.POST_NOTIFICATIONS, declared, true, Build.VERSION.SDK_INT >= 33, "dangerous",
                array("notify.show", "timer.set", "foreground service notification"));
        add(out, Manifest.permission.READ_SMS, declared, true, true, "dangerous",
                array("android.substrate SMS query", "phone.sms.list", "phone.sms.get_thread"));
        add(out, Manifest.permission.SEND_SMS, declared, true, true, "dangerous",
                array("android.substrate SMS send", "phone.sms.send"));
        add(out, Manifest.permission.RECEIVE_SMS, declared, true, true, "dangerous",
                array("android.substrate inbound SMS"));
        add(out, Manifest.permission.CALL_PHONE, declared, true, true, "dangerous",
                array("android.substrate place call", "phone.calls.place"));
        add(out, Manifest.permission.ANSWER_PHONE_CALLS, declared, true, true, "dangerous",
                array("android.substrate hang up or answer calls", "phone.calls.answer", "phone.calls.hangup"));
        add(out, Manifest.permission.READ_PHONE_STATE, declared, true, true, "dangerous",
                array("android.substrate phone state", "phone.telephony.status", "phone.calls.state"));
        add(out, Manifest.permission.READ_CALL_LOG, declared, true, true, "dangerous",
                array("android.substrate call log query", "phone.calls.list", "phone.voicemail.list"));
        add(out, Manifest.permission.WRITE_CALL_LOG, declared, true, true, "dangerous",
                array("android.substrate call log mutation"));
        add(out, Manifest.permission.READ_CONTACTS, declared, true, true, "dangerous",
                array("android.substrate contacts query", "phone.contacts.search", "phone.contacts.get"));
        add(out, Manifest.permission.WRITE_CONTACTS, declared, true, true, "dangerous",
                array("android.substrate contacts mutation", "phone.contacts.create", "phone.contacts.replace", "phone.contacts.delete"));
        add(out, Manifest.permission.GET_ACCOUNTS, declared, true, true, "dangerous",
                array("android.substrate account-backed providers"));
        add(out, Manifest.permission.READ_CALENDAR, declared, true, true, "dangerous",
                array("android.substrate calendar query"));
        add(out, Manifest.permission.WRITE_CALENDAR, declared, true, true, "dangerous",
                array("android.substrate calendar mutation"));
        add(out, Manifest.permission.READ_EXTERNAL_STORAGE, declared, true, Build.VERSION.SDK_INT < 33, "dangerous",
                array("android.substrate media query"));
        add(out, Manifest.permission.READ_MEDIA_IMAGES, declared, true, Build.VERSION.SDK_INT >= 33, "dangerous",
                array("android.substrate image media query"));
        add(out, Manifest.permission.READ_MEDIA_VIDEO, declared, true, Build.VERSION.SDK_INT >= 33, "dangerous",
                array("android.substrate video media query"));
        add(out, Manifest.permission.READ_MEDIA_AUDIO, declared, true, Build.VERSION.SDK_INT >= 33, "dangerous",
                array("android.substrate audio media query"));
        add(out, "com.android.alarm.permission.SET_ALARM", declared, false, true, "normal",
                array("alarm.intent.set"));
        add(out, "com.android.voicemail.permission.READ_VOICEMAIL", declared, true, true, "dangerous",
                array("android.substrate voicemail query", "phone.voicemail.list"));
        add(out, "com.android.voicemail.permission.ADD_VOICEMAIL", declared, true, true, "dangerous",
                array("android.substrate voicemail insert"));
        add(out, "android.permission.READ_BLOCKED_NUMBERS", declared, true, true, "dangerous",
                array("android.substrate blocked number query", "phone.blocked_numbers.list"));
        add(out, "android.permission.WRITE_BLOCKED_NUMBERS", declared, true, true, "dangerous",
                array("android.substrate blocked number mutation", "phone.blocked_numbers.add", "phone.blocked_numbers.remove"));
        add(out, "android.permission.READ_USER_DICTIONARY", declared, true, true, "dangerous",
                array("android.substrate user dictionary query"));
        add(out, "android.permission.WRITE_USER_DICTIONARY", declared, true, true, "dangerous",
                array("android.substrate user dictionary mutation"));
        return out;
    }

    private void add(JSONArray out, String name, Set<String> declared, boolean runtime, boolean applicable,
            String protection, JSONArray requiredFor) {
        boolean isDeclared = declared.contains(name);
        boolean granted = applicable && isGranted(name);
        JSONObject item = new JSONObject();
        Json.put(item, "name", name);
        Json.put(item, "short_name", shortName(name));
        Json.put(item, "declared", isDeclared);
        Json.put(item, "runtime", runtime && applicable);
        Json.put(item, "applicable", applicable);
        Json.put(item, "protection", protection);
        Json.put(item, "granted", applicable ? granted : JSONObject.NULL);
        Json.put(item, "effective_granted", !applicable || granted);
        Json.put(item, "state", !applicable ? "not_applicable" : granted ? "granted" : "denied");
        Json.put(item, "can_request", runtime && applicable);
        Json.put(item, "settings_action", APP_DETAILS_ACTION);
        Json.put(item, "required_for", requiredFor);
        Json.add(out, item);
    }

    private boolean isGranted(String permission) {
        return context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean holdsDialerRole() {
        TelecomManager telecom = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
        return telecom != null && context.getPackageName().equals(telecom.getDefaultDialerPackage());
    }

    private boolean holdsSmsRole() {
        String defaultSmsPackage = Telephony.Sms.getDefaultSmsPackage(context);
        return context.getPackageName().equals(defaultSmsPackage);
    }

    private Set<String> declaredPermissions() {
        Set<String> out = new HashSet<>();
        try {
            PackageInfo info;
            if (Build.VERSION.SDK_INT >= 33) {
                info = context.getPackageManager().getPackageInfo(
                        context.getPackageName(),
                        PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS));
            } else {
                info = context.getPackageManager().getPackageInfo(
                        context.getPackageName(),
                        PackageManager.GET_PERMISSIONS);
            }
            if (info.requestedPermissions != null) {
                for (String permission : info.requestedPermissions) {
                    out.add(permission);
                }
            }
        } catch (PackageManager.NameNotFoundException ignored) {
        }
        return out;
    }

    private static JSONArray array(String... values) {
        JSONArray out = new JSONArray();
        for (String value : values) {
            Json.add(out, value);
        }
        return out;
    }

    private static String shortName(String permission) {
        int index = permission.lastIndexOf('.');
        return index < 0 ? permission : permission.substring(index + 1);
    }
}
