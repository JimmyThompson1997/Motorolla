package com.pucky.device.capabilities;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.os.Build;
import android.speech.SpeechRecognizer;

import com.pucky.device.accessibility.PuckyAccessibilityService;
import com.pucky.device.status.AppIdentity;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;

public final class CapabilityReporter {
    private final Context context;
    private final SettingsStore settingsStore;
    private final PermissionReporter permissionReporter;

    public CapabilityReporter(Context context, SettingsStore settingsStore, PermissionReporter permissionReporter) {
        this.context = context.getApplicationContext();
        this.settingsStore = settingsStore;
        this.permissionReporter = permissionReporter;
    }

    public JSONObject read() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.capabilities.v1");
        Json.put(out, "device_id", settingsStore.getDeviceId());
        Json.put(out, "apk_version", AppIdentity.versionName(context));
        Json.put(out, "apk_identity", AppIdentity.json(context));
        Json.put(out, "package_name", context.getPackageName());
        Json.put(out, "android_sdk", Build.VERSION.SDK_INT);
        Json.put(out, "generated_at", Instant.now().toString());
        Json.put(out, "capabilities", capabilities());
        Json.put(out, "permission_warnings", permissionReporter.activeWarnings());
        return out;
    }

    private JSONArray capabilities() {
        JSONArray out = new JSONArray();
        Json.add(out, cap("command.ping", "ping", "implemented", "yes", "quiet", null, "not_recorded",
                "Command path liveness check."));
        Json.add(out, cap("device.status", "status.get", "implemented", "yes", "quiet", null, "not_recorded",
                "Returns identity, Android build, battery, network, and sensor inventory."));
        Json.add(out, cap("capability.report", "capabilities.get", "implemented", "yes", "quiet", null, "self_reported",
                "APK self-reported Phase 3 capability matrix."));
        Json.add(out, cap("permission.report", "permissions.get", "implemented", "yes", "quiet", null, "self_reported",
                "APK self-reported Android permission matrix."));
        Json.add(out, cap("battery.status", "battery.get", "implemented", "yes", "quiet", null, "not_recorded",
                "Sticky ACTION_BATTERY_CHANGED read."));
        Json.add(out, cap("network.status", "network.get", "implemented", "yes", "quiet",
                Manifest.permission.ACCESS_NETWORK_STATE, "not_recorded", "Active network capabilities and transport labels."));
        Json.add(out, cap("location.current", "location.get", locationStatus(), "yes", "privacy_sensitive",
                locationPermissionLabel(), locationPermissionGranted(), "not_recorded",
                "One-shot Android LocationManager sample, returning unavailable rather than inventing a location."));
        Json.add(out, cap("location.watch", "location.watch", locationStatus(), "yes", "privacy_sensitive",
                locationPermissionLabel(), locationPermissionGranted(), "not_recorded",
                "Bounded LocationManager trace saved in app-owned storage and returned to the broker."));
        Json.add(out, cap("location.tracker", "location.tracker.status/location.tracker.start/location.tracker.stop/location.tracker.query/location.tracker.clear/location.tracker.export",
                locationStatus(), "foreground_service", "privacy_sensitive",
                locationPermissionLabel(), locationPermissionGranted(), "not_recorded",
                "Pucky Map 30-second local location trail, stored app-private and rendered in the WebView map screen."));
        Json.add(out, cap("storage.app_summary", "storage.get", "implemented", "yes", "quiet", null, "not_recorded",
                "App files/cache storage stats only."));
        Json.add(out, cap("runtime.stats", "runtime.stats", "implemented", "yes", "quiet", null, "not_recorded",
                "Bounded Java runtime and app uptime diagnostics."));
        Json.add(out, cap("system.memory", "system.memory.get", "implemented", "yes", "quiet", null, "not_recorded",
                "ActivityManager memory snapshot plus app heap stats."));
        Json.add(out, cap("system.thermal", "system.thermal.get", Build.VERSION.SDK_INT >= 29 ? "implemented" : "blocked_by_platform",
                "yes", "quiet", null, "not_recorded", "Public PowerManager thermal status where available."));
        Json.add(out, cap("service.status", "service.status", "implemented", "yes", "quiet", null, "self_reported",
                "Foreground service, connection, and auto-connect state."));
        Json.add(out, cap("power.policy", "power.policy.get", "implemented", "yes", "quiet", null, "self_reported",
                "Power save, idle, interactive, and battery optimization state."));
        Json.add(out, cap("compute.benchmark", "compute.benchmark", "implemented", "yes", "quiet", null, "not_recorded",
                "Small bounded SHA-256 benchmark, capped by max_ms."));
        Json.add(out, cap("command.catalog", "command.catalog", "implemented", "yes", "quiet", null, "self_reported",
                "Lists the Pucky command bus subcommands available through the single pucky.command.v1 endpoint."));
        Json.add(out, cap("shell.exec", "shell.exec", "implemented_untested", "yes", "raw_device_shell", null,
                "not_recorded", "Runs /system/bin/sh -c as the Pucky app UID with bounded timeout/output. This is intentionally close to the device metal, not root."));
        Json.add(out, cap("artifact.list", "artifact.list", "implemented", "yes", "quiet", null, "not_recorded",
                "Lists app-owned artifacts only."));
        Json.add(out, cap("artifact.hash", "artifact.hash", "implemented", "yes", "quiet", null, "not_recorded",
                "Hashes app-owned artifact paths only."));
        Json.add(out, cap("artifact.read_base64", "artifact.read_base64", "implemented_untested", "yes", "privacy_sensitive", null, "not_recorded",
                "Reads a bounded app-owned artifact as base64 for VM-side validation and transcription tests."));
        Json.add(out, cap("artifact.url", "artifact.url", "implemented_untested", "yes", "privacy_sensitive", null, "not_recorded",
                "Returns a local WebView-safe URL for app-owned artifacts so HTML media and document viewers can stream cached files."));
        Json.add(out, cap("artifact.delete", "artifact.delete", "implemented", "yes", "privacy_sensitive", null, "not_recorded",
                "Deletes app-owned artifact paths only."));
        Json.add(out, cap("pucky.clipboard", "pucky.clipboard.list/pucky.clipboard.last/pucky.clipboard.read/pucky.clipboard.delete/pucky.clipboard.clear",
                "implemented", "yes", "privacy_sensitive", null, "local_app_private",
                "Structured app-private ledger for volume-down keyword action calls and artifact references. This is not Android's system clipboard."));
        Json.add(out, cap("command_log.tail", "log.tail", "implemented", "yes", "quiet", null, "not_recorded",
                "App-local command log tail."));
        Json.add(out, cap("sensor.inventory", "sensor.list", sensorManagerAvailable() ? "implemented" : "blocked_by_hardware",
                "yes", "quiet", null, "not_recorded", "Public Android sensor inventory."));
        Json.add(out, cap("sensor.sample", "sensor.sample", hasAnySensor() ? "implemented_untested" : "blocked_by_hardware",
                "yes", "quiet", null, "not_recorded", "Bounded foreground-safe sensor sample."));
        Json.add(out, cap("sensor.watch", "sensor.watch", hasAnySensor() ? "implemented_untested" : "blocked_by_hardware",
                "yes", "quiet", null, "not_recorded", "Bounded multi-sensor watch by exact sensor name/type for physical gesture mapping."));
        Json.add(out, cap("cover.wave", "cover.wave.status/cover.wave.config.set/cover.wave.trigger",
                hasAnySensor() ? "implemented_guarded" : "blocked_by_hardware",
                "foreground_service", "visible", "android.permission.VIBRATE", "not_recorded",
                "Cover-screen hand-wave detector gated by closed device state, face-up/stationary accelerometer checks, and Accessibility screen lock when enabled."));
        Json.add(out, cap("screen.lock", "screen.lock.status/screen.lock.request/screen.lock.open_accessibility_settings",
                PuckyAccessibilityService.canLockScreen(context) ? "implemented" : "blocked_by_permission",
                "user_enabled_accessibility", "visible", "android.permission.BIND_ACCESSIBILITY_SERVICE",
                "not_recorded", "Locks the screen through Pucky's user-enabled AccessibilityService; no ADB or shell command required."));
        Json.add(out, cap("camera.inventory", "camera.info", hasCamera() ? "implemented" : "blocked_by_hardware",
                "yes", "quiet", null, "not_recorded", "Camera2 inventory and default JPEG size."));
        Json.add(out, cap("camera.photo_capture", "photo.capture", cameraStatus(), "yes", "visible",
                Manifest.permission.CAMERA, "not_recorded", "Bounded still capture into app external files."));
        Json.add(out, cap("camera.video_capture_lab", "VM recipe device primitive video.capture.start/video.capture.stop", cameraStatus(), "foreground_activity", "visible",
                Manifest.permission.CAMERA, "local_artifact",
                "Volume-down keyword lab can start/stop silent local camera video, save app-private MP4, and publish to MediaStore Movies/Pucky."));
        Json.add(out, cap("camera.torch", "torch.set", torchStatus(), "yes", "visible",
                Manifest.permission.CAMERA, "not_recorded", "Flash torch with bounded auto-off."));
        Json.add(out, cap("screen.screenshot_lab", "VM recipe device primitive screenshot.capture",
                Build.VERSION.SDK_INT >= 30 ? "implemented_untested" : "blocked_by_platform",
                "user_enabled_accessibility", "visible", "BIND_ACCESSIBILITY_SERVICE", "local_artifact",
                "Volume-down keyword lab screenshot action uses Pucky AccessibilityService takeScreenshot on API 30+ and publishes image artifacts."));
        Json.add(out, cap("notification.show", "notify.show", notificationStatus(), "yes", "visible",
                Manifest.permission.POST_NOTIFICATIONS, "not_recorded", "Quiet local notification."));
        Json.add(out, cap("notification.ask_reply", "notify.ask", notificationStatus(), "yes", "visible",
                Manifest.permission.POST_NOTIFICATIONS, "not_recorded", "Android RemoteInput direct reply notification posted back to broker reply inbox."));
        Json.add(out, cap("notification.cancel", "notify.cancel", "implemented_untested", "yes", "quiet",
                null, "not_recorded", "Cancels Pucky-posted notification id."));
        Json.add(out, cap("notification.active", "notify.list_active", "implemented_untested", "yes", "quiet",
                null, "not_recorded", "Lists this app's active notifications where platform supports it."));
        Json.add(out, cap("notification.channels", "notify.channels.get", Build.VERSION.SDK_INT >= 26 ? "implemented" : "blocked_by_platform",
                "yes", "quiet", null, "not_recorded", "Lists app notification channels."));
        Json.add(out, cap("audio.tone", "audio.tone", "implemented_untested", "yes", "audible", null, "not_recorded",
                "Short bounded ToneGenerator beep."));
        Json.add(out, cap("audio.route", "audio.route.get", "implemented", "yes", "quiet", null, "not_recorded",
                "Modern AudioDeviceInfo input-route snapshot plus legacy debug booleans and media volume."));
        Json.add(out, cap("audio.volume", "audio.volume.set", "implemented_untested", "yes", "audible", null, "not_recorded",
                "Sets Android STREAM_MUSIC volume to a bounded level or percent for deterministic audio tests."));
        Json.add(out, cap("voice.capture", "voice.capture.start/voice.capture.stop/voice.capture.status/voice.capture.last/voice.capture.list/voice.capture.delete",
                permissionReporter.isEffectivelyGranted(Manifest.permission.RECORD_AUDIO) ? "implemented_untested" : "blocked_by_permission",
                "yes", "microphone_audible_haptic", Manifest.permission.RECORD_AUDIO, "local_artifact",
                "MediaRecorder hold-to-record capture to app-owned .m4a artifacts. Raw voice capture is save-only and does not replay recordings."));
        Json.add(out, cap("wake.word", "wake.status/wake.config.set/wake.start/wake.stop/wake.simulate",
                permissionReporter.isEffectivelyGranted(Manifest.permission.RECORD_AUDIO) ? "implemented_untested" : "blocked_by_permission",
                "foreground_service", "quiet", Manifest.permission.RECORD_AUDIO, "not_recorded",
                "Live Android SpeechRecognizer wake lab. Awake and unlocked foreground-service scope runs a restartable live transcript sentinel, latches the bounded wake family on partial and final results, and hands accepted wake into a real auto-ended Pucky turn. wake.simulate can inject deterministic recognizer events for lab testing."));
        Json.add(out, cap("speech.native", "speech.native.start/speech.native.stop/speech.native.status/speech.native.last/speech.native.list/speech.native.delete",
                nativeSpeechStatus(), "yes", "microphone", Manifest.permission.RECORD_AUDIO, "not_recorded",
                "Android SpeechRecognizer live transcription with local transcript history and broker reply-inbox delivery when online."));
        Json.add(out, cap("speech.echo", "speech.echo.start/speech.echo.stop/speech.echo.status/speech.echo.last/speech.echo.list/speech.echo.delete/speech.echo.voices",
                speechEchoStatus(), "yes", "microphone_audible_haptic", Manifest.permission.RECORD_AUDIO, "not_recorded",
                "Strict on-device SpeechRecognizer hold-to-talk echo test with formatted final transcripts, language-detection logging, and Android TTS playback. No raw audio capture, broker, or agent call."));
        Json.add(out, cap("speech.echo_lab", "speech.echo.lab.status/speech.echo.lab.start/speech.echo.lab.stop/speech.echo.lab.last/speech.echo.lab.list",
                speechEchoStatus(), "yes", "microphone_audible_haptic", Manifest.permission.RECORD_AUDIO, "not_recorded",
                "Reserved volume-down lab shell only. Product keyword interception now happens on volume-up walkie release; this surface remains as an inert future remap point."));
        Json.add(out, cap("pucky.recipes", "pucky.recipes.sync/pucky.recipes.list/pucky.recipes.test/pucky.recipes.clear/pucky.recipes.schema/device.primitives.list",
                "implemented", "yes", "privacy_sensitive", null, "local_app_private",
                "VM-owned recipe bundle cache and allowlisted device or VM-event execution surface. Cached recipes live in app-private pucky_recipes storage, separate from the reserved speech.echo.lab shell."));
        Json.add(out, cap("file.download", "file.download", "implemented_untested", "yes", "privacy_sensitive",
                Manifest.permission.INTERNET, "not_recorded", "Downloads HTTP/HTTPS URLs into Pucky app-owned storage."));
        Json.add(out, cap("file.put_base64", "file.put_base64", "implemented_untested", "yes", "privacy_sensitive",
                null, "not_recorded", "Writes a bounded base64 payload from the VM into Pucky app-owned storage."));
        Json.add(out, cap("app.update_install", "app.update.install_downloaded", "implemented_untested",
                "user_mediated", "visible", Manifest.permission.REQUEST_INSTALL_PACKAGES, "not_recorded",
                "Installs an app-owned downloaded APK through Android PackageInstaller. User confirmation is still required."));
        Json.add(out, cap("media.state", "media.state.get", "implemented_untested", "yes", "quiet", null,
                "not_recorded", "Best-effort Android audio/media state visible to a normal app."));
        Json.add(out, cap("media.key", "media.key", "implemented_untested", "yes", "audible", null,
                "not_recorded", "Best-effort AudioManager media-key dispatch for active media sessions."));
        Json.add(out, cap("media.open_uri", "media.open_uri", "implemented_untested", "user_mediated", "visible",
                null, "not_recorded", "Launches Android ACTION_VIEW for media/podcast URLs."));
        Json.add(out, cap("media.export_audio", "media.export.audio", "implemented_untested", "yes", "privacy_sensitive",
                null, "not_recorded", "Copies an app-owned audio artifact into Android's public MediaStore Music/Pucky collection."));
        Json.add(out, cap("media.export_list", "media.export.list", "implemented_untested", "yes", "quiet",
                null, "not_recorded", "Lists Pucky-exported public Android audio media."));
        Json.add(out, cap("media.export_delete", "media.export.delete", "implemented_untested", "yes", "privacy_sensitive",
                null, "not_recorded", "Deletes a public Android media item by content URI or id."));
        Json.add(out, cap("player.asset_prepare", "player.asset.prepare", "implemented_untested", "yes", "privacy_sensitive",
                Manifest.permission.INTERNET, "not_recorded", "Downloads an HTTP/HTTPS audio asset into app-owned storage for Pucky-native playback."));
        Json.add(out, cap("player.load", "player.load", "implemented_untested", "yes", "quiet", null,
                "not_recorded", "Loads an app-owned audio artifact or the prepared public audiobook folder into Pucky's native player."));
        Json.add(out, cap("player.play", "player.play", "implemented_untested", "yes", "audible", null,
                "not_recorded", "Starts Pucky-native local audio playback."));
        Json.add(out, cap("player.pause", "player.pause", "implemented_untested", "yes", "quiet", null,
                "not_recorded", "Pauses Pucky-native local audio playback."));
        Json.add(out, cap("player.stop", "player.stop", "implemented_untested", "yes", "quiet", null,
                "not_recorded", "Stops Pucky-native local audio playback and seeks to the start."));
        Json.add(out, cap("player.seek", "player.seek", "implemented_untested", "yes", "quiet", null,
                "not_recorded", "Seeks within the currently loaded Pucky-native audio asset."));
        Json.add(out, cap("player.speed", "player.speed", "implemented_untested", "yes", "audible", null,
                "not_recorded", "Sets Pucky-native playback speed for audiobook and podcast-style listening."));
        Json.add(out, cap("player.state", "player.state", "implemented_untested", "yes", "quiet", null,
                "not_recorded", "Reports loaded asset, playback state, position, duration, and queue state."));
        Json.add(out, cap("player.queue", "player.queue.set/player.queue.next/player.queue.previous", "implemented_untested", "yes", "quiet", null,
                "not_recorded", "Maintains an in-memory queue of app-owned audio artifacts or prepared audiobook files."));
        Json.add(out, cap("player.bookmark", "player.bookmark.save/player.bookmark.list", "implemented_untested", "yes", "quiet", null,
                "not_recorded", "Stores app-local playback bookmarks for audio/podcast-style resume points."));
        Json.add(out, cap("button.foreground_capture", "button.state/button.config.get/button.config.set/button.events.list/button.simulate/pucky.turn.start/pucky.turn.stop", "implemented_untested",
                "foreground_only", "quiet", null, "not_recorded",
                "Captures configurable volume-button gestures while Pucky Activity is foreground. Current policy keeps single volume presses as normal media volume, maps volume-up hold/release to the unified walkie path with local keyword intercept on release, and keeps volume-down hold/release on reserved speech.echo.lab endpoints. Global/screen-off capture remains future Device Owner/root research."));
        Json.add(out, cap("timer.local", "timer.set", notificationStatusForTimer(), "yes", "visible",
                Manifest.permission.POST_NOTIFICATIONS, "not_recorded", "AlarmManager elapsed timer; notification requires notification permission."));
        Json.add(out, cap("timer.cancel", "timer.cancel", "implemented_untested", "yes", "quiet", null, "not_recorded",
                "Cancel app-local timer PendingIntent by id."));
        Json.add(out, cap("intent.settings", "settings.open", "implemented", "user_mediated", "visible", null, "not_recorded",
                "Launches specific Android settings screens for user action."));
        Json.add(out, cap("intent.browser", "browser.open", "implemented", "user_mediated", "visible", null, "not_recorded",
                "Launches ACTION_VIEW for an explicit URI."));
        Json.add(out, cap("intent.share_text", "share.text", "implemented", "user_mediated", "visible", null, "not_recorded",
                "Launches ACTION_SEND text chooser."));
        Json.add(out, cap("intent.alarm", "alarm.intent.set", "implemented_untested", "user_mediated", "visible",
                "com.android.alarm.permission.SET_ALARM", "not_recorded", "Launches Android Clock alarm intent."));
        Json.add(out, cap("intent.calendar_insert", "calendar.intent.insert", "implemented_untested", "user_mediated", "visible",
                null, "not_recorded", "Launches user-mediated calendar insert intent."));
        Json.add(out, cap("intent.phone_dial", "phone.intent.dial", "implemented_untested", "user_mediated", "visible",
                null, "not_recorded", "Launches ACTION_DIAL only, not direct call."));
        Json.add(out, cap("notes.local", "note.create_local", "implemented", "yes", "quiet", null, "not_recorded",
                "Creates app-local Pucky note."));
        Json.add(out, cap("notes.local_list", "note.list_local", "implemented", "yes", "quiet", null, "not_recorded",
                "Lists app-local Pucky notes."));
        Json.add(out, cap("notes.local_delete", "note.delete_local", "implemented", "yes", "quiet", null, "not_recorded",
                "Tombstones app-local Pucky note."));
        Json.add(out, cap("ui.state", "ui.state.get", "implemented", "yes", "quiet", null, "self_reported",
                "App connection and command state snapshot."));
        Json.add(out, cap("ui.dashboard", "ui.dashboard.show", "implemented", "yes", "visible", null, "self_reported",
                "Brings the Pucky dashboard activity to the foreground."));
        Json.add(out, cap("ui.reply_cards", "ui.reply_cards.set/ui.reply_cards.merge/ui.reply_cards.get/ui.reply_cards.clear",
                "implemented", "yes", "visible", null, "self_reported",
                "Replaces, merges, or reads the local reply-card metadata consumed by the cached WebView UI."));
        Json.add(out, cap("launcher.home_activity", "launcher.capability.get", "requires_user_mediated_intent",
                "user_mediated", "visible", null, "manual_required",
                "Manifest advertises a reversible Home activity; the user must choose and can undo the default Home app."));
        Json.add(out, cap("settings.panels", "settings.panel", "implemented", "user_mediated", "visible", null,
                "not_recorded", "Launches supported Android settings panel targets where available."));
        Json.add(out, cap("wifi.radio_toggle", null, "blocked_by_platform", "no", "visible", null, "not_applicable",
                "Normal Android apps cannot silently toggle Wi-Fi on modern Android."));
        Json.add(out, cap("kiosk.device_owner", null, "requires_device_owner", "device_owner_only", "visible", null,
                "not_started", "Persistent launcher and lock task remain future Device Owner work."));
        Json.add(out, cap("adb.install", null, "requires_adb", "adb_only", "visible", null, "not_applicable",
                "Development-only installation path."));
        Json.add(out, cap("root.shell", null, "requires_root", "root_only", "visible", null, "not_applicable",
                "shell.exec is app-UID shell access only; root remains unavailable."));
        return out;
    }

    private JSONObject cap(String id, String command, String status, String directControl, String sensitivity, String permission,
            String lastTestStatus, String notes) {
        return cap(id, command, status, directControl, sensitivity, permission, null, lastTestStatus, notes);
    }

    private JSONObject cap(String id, String command, String status, String directControl, String sensitivity, String permission,
            Boolean permissionGranted, String lastTestStatus, String notes) {
        JSONObject out = new JSONObject();
        Json.put(out, "id", id);
        Json.put(out, "command", command == null ? JSONObject.NULL : command);
        Json.put(out, "status", status);
        Json.put(out, "direct_control", directControl);
        Json.put(out, "sensitivity", sensitivity);
        Json.put(out, "permission", permission == null ? JSONObject.NULL : shortPermission(permission));
        Json.put(out, "permission_granted",
                permission == null ? JSONObject.NULL
                        : permissionGranted == null ? permissionReporter.isEffectivelyGranted(permission) : permissionGranted);
        Json.put(out, "last_test_status", lastTestStatus);
        Json.put(out, "notes", notes);
        return out;
    }

    private String cameraStatus() {
        if (!hasCamera()) {
            return "blocked_by_hardware";
        }
        return permissionReporter.isEffectivelyGranted(Manifest.permission.CAMERA)
                ? "implemented_untested"
                : "blocked_by_permission";
    }

    private String torchStatus() {
        if (!hasFlash()) {
            return "blocked_by_hardware";
        }
        return permissionReporter.isEffectivelyGranted(Manifest.permission.CAMERA)
                ? "implemented_untested"
                : "blocked_by_permission";
    }

    private String notificationStatus() {
        return permissionReporter.isEffectivelyGranted(Manifest.permission.POST_NOTIFICATIONS)
                ? "implemented_untested"
                : "blocked_by_permission";
    }

    private String notificationStatusForTimer() {
        return permissionReporter.isEffectivelyGranted(Manifest.permission.POST_NOTIFICATIONS)
                ? "implemented_untested"
                : "blocked_by_permission";
    }

    private String nativeSpeechStatus() {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            return "blocked_by_platform";
        }
        return permissionReporter.isEffectivelyGranted(Manifest.permission.RECORD_AUDIO)
                ? "implemented_untested"
                : "blocked_by_permission";
    }

    private String speechEchoStatus() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || !SpeechRecognizer.isOnDeviceRecognitionAvailable(context)) {
            return "blocked_by_platform";
        }
        return permissionReporter.isEffectivelyGranted(Manifest.permission.RECORD_AUDIO)
                ? "implemented_untested"
                : "blocked_by_permission";
    }

    private String locationStatus() {
        return permissionReporter.isEffectivelyGranted(Manifest.permission.ACCESS_FINE_LOCATION)
                || permissionReporter.isEffectivelyGranted(Manifest.permission.ACCESS_COARSE_LOCATION)
                ? "implemented_untested"
                : "blocked_by_permission";
    }

    private String locationPermissionLabel() {
        return "ACCESS_FINE_LOCATION or ACCESS_COARSE_LOCATION";
    }

    private boolean locationPermissionGranted() {
        return permissionReporter.isEffectivelyGranted(Manifest.permission.ACCESS_FINE_LOCATION)
                || permissionReporter.isEffectivelyGranted(Manifest.permission.ACCESS_COARSE_LOCATION);
    }

    private boolean hasCamera() {
        PackageManager pm = context.getPackageManager();
        return pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)
                || pm.hasSystemFeature(PackageManager.FEATURE_CAMERA)
                || pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_FRONT);
    }

    private boolean hasFlash() {
        return context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_CAMERA_FLASH);
    }

    private boolean sensorManagerAvailable() {
        return context.getSystemService(Context.SENSOR_SERVICE) != null;
    }

    private boolean hasAnySensor() {
        SensorManager manager = (SensorManager) context.getSystemService(Context.SENSOR_SERVICE);
        return manager != null && !manager.getSensorList(Sensor.TYPE_ALL).isEmpty();
    }

    private static String shortPermission(String permission) {
        int index = permission.lastIndexOf('.');
        return index < 0 ? permission : permission.substring(index + 1);
    }
}
