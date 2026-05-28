package com.pucky.device.speech;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.ToneGenerator;
import android.net.Uri;

import com.pucky.device.R;
import com.pucky.device.camera.CameraController;
import com.pucky.device.camera.VideoCaptureController;
import com.pucky.device.clipboard.PuckyClipboardController;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.location.LocationController;
import com.pucky.device.notifications.NotificationController;
import com.pucky.device.screenshot.ScreenshotController;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;

public final class RecipeDevicePrimitiveExecutor {
    public static final String COMMAND_TORCH_SET = "torch.set";
    public static final String COMMAND_PHOTO_CAPTURE = "photo.capture";
    public static final String COMMAND_LOCATION_PIN = "location.pin";
    public static final String COMMAND_SCREENSHOT_CAPTURE = "screenshot.capture";
    public static final String COMMAND_VIDEO_CAPTURE_START = "video.capture.start";
    public static final String COMMAND_VIDEO_CAPTURE_STOP = "video.capture.stop";
    public static final String COMMAND_NOTIFY_SHOW = "notify.show";
    public static final int DEFAULT_TORCH_AUTO_OFF_MS = 600;
    public static final int MIN_TORCH_AUTO_OFF_MS = 100;
    public static final int MAX_TORCH_AUTO_OFF_MS = 1500;
    public static final int DEFAULT_PHOTO_MAX_WIDTH = 1280;
    public static final long DEFAULT_PHOTO_TIMEOUT_MS = 8000L;
    public static final int MIN_PHOTO_MAX_WIDTH = 320;
    public static final int MAX_PHOTO_MAX_WIDTH = 1920;
    public static final long MIN_PHOTO_TIMEOUT_MS = 1000L;
    public static final long MAX_PHOTO_TIMEOUT_MS = 15000L;
    public static final long DEFAULT_LOCATION_TIMEOUT_MS = 60000L;
    public static final long DEFAULT_LOCATION_MAX_CACHE_AGE_MS = 30000L;
    public static final long DEFAULT_SCREENSHOT_TIMEOUT_MS = 4000L;
    public static final long DEFAULT_VIDEO_MAX_DURATION_MS = 60000L;
    private static final String SUCCESS_SOUND_PATH = "/product/media/audio/notifications/Soft.ogg";
    private static final String FAILURE_SOUND_PATH = "/product/media/audio/ui/LowBattery.ogg";
    private static final String TURN_SENT_SOUND_NAME = "pucky_system_notification.mp3";
    private static final String TURN_RECEIVED_SOUND_NAME = "pucky_new_message_2.mp3";

    private final Context context;
    private final CameraController cameraController;
    private final LocationController locationController;
    private final NotificationController notificationController;
    private final ScreenshotController screenshotController;
    private final VideoCaptureController videoCaptureController;

    public RecipeDevicePrimitiveExecutor(Context context) {
        this.context = context.getApplicationContext();
        this.cameraController = new CameraController(this.context);
        this.locationController = new LocationController(this.context);
        this.notificationController = new NotificationController(this.context);
        this.screenshotController = new ScreenshotController(this.context);
        this.videoCaptureController = VideoCaptureController.shared(this.context);
    }

    RecipeDevicePrimitiveExecutor(CameraController cameraController) {
        this(cameraController, null, null, null, null);
    }

    RecipeDevicePrimitiveExecutor(
            CameraController cameraController,
            LocationController locationController,
            NotificationController notificationController,
            ScreenshotController screenshotController,
            VideoCaptureController videoCaptureController) {
        this.context = null;
        this.cameraController = cameraController;
        this.locationController = locationController;
        this.notificationController = notificationController;
        this.screenshotController = screenshotController;
        this.videoCaptureController = videoCaptureController;
    }

    public JSONObject execute(JSONObject action) throws CommandException {
        JSONObject safe = sanitize(action);
        String command = safe.optString("command", "");
        JSONObject args = safe.optJSONObject("args");
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.recipe_device_primitive_result.v1");
        Json.put(out, "command", command);
        Json.put(out, "args", args == null ? new JSONObject() : args);
        if (COMMAND_TORCH_SET.equals(command)) {
            Json.put(out, "result", cameraController.setTorch(args == null ? new JSONObject() : args));
            return out;
        }
        if (COMMAND_PHOTO_CAPTURE.equals(command)) {
            Json.put(out, "result", cameraController.capture(args == null ? new JSONObject() : args));
            return out;
        }
        if (COMMAND_LOCATION_PIN.equals(command)) {
            JSONObject locationArgs = args == null ? new JSONObject() : args;
            JSONObject location = requireLocationController().pin(locationArgs,
                    result -> handlePendingLocationResolution(locationArgs, result));
            if ("failed".equals(location.optString("state", ""))) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "Location unavailable: " + location.optString("reason", "NO_LOCATION_SAMPLE"));
            }
            Json.put(out, "result", location);
            return out;
        }
        if (COMMAND_SCREENSHOT_CAPTURE.equals(command)) {
            Json.put(out, "result", requireScreenshotController().capture(args == null ? new JSONObject() : args));
            return out;
        }
        if (COMMAND_VIDEO_CAPTURE_START.equals(command)) {
            Json.put(out, "result", requireVideoCaptureController().start(args == null ? new JSONObject() : args));
            return out;
        }
        if (COMMAND_VIDEO_CAPTURE_STOP.equals(command)) {
            Json.put(out, "result", requireVideoCaptureController().stop(args == null ? new JSONObject() : args));
            return out;
        }
        if (COMMAND_NOTIFY_SHOW.equals(command)) {
            Json.put(out, "result", requireNotificationController().show(args == null ? new JSONObject() : args));
            return out;
        }
        throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED,
                "Unsupported recipe device primitive command: " + command);
    }

    public static JSONObject sanitize(JSONObject action) throws CommandException {
        if (action == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "recipe device primitive requires action object");
        }
        String command = action.optString("command", "").trim();
        if (COMMAND_TORCH_SET.equals(command)) {
            return sanitizeTorch(action);
        }
        if (COMMAND_PHOTO_CAPTURE.equals(command)) {
            return sanitizePhoto(action);
        }
        if (COMMAND_LOCATION_PIN.equals(command)) {
            return sanitizeLocation(action);
        }
        if (COMMAND_SCREENSHOT_CAPTURE.equals(command)) {
            return sanitizeScreenshot(action);
        }
        if (COMMAND_VIDEO_CAPTURE_START.equals(command)) {
            return sanitizeVideoStart(action);
        }
        if (COMMAND_VIDEO_CAPTURE_STOP.equals(command)) {
            return sanitizeVideoStop(action);
        }
        if (COMMAND_NOTIFY_SHOW.equals(command)) {
            return sanitizeNotify(action);
        }
        throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED,
                "Only torch.set, photo.capture, location.pin, screenshot.capture, video.capture.start, video.capture.stop, and notify.show recipe device primitives are supported");
    }

    private static JSONObject sanitizeTorch(JSONObject action) throws CommandException {
        JSONObject rawArgs = actionArgsObject(action, COMMAND_TORCH_SET);
        int autoOffMs = DEFAULT_TORCH_AUTO_OFF_MS;
        if (rawArgs.has("auto_off_ms")) {
            autoOffMs = rawArgs.optInt("auto_off_ms", -1);
        }
        if (autoOffMs < MIN_TORCH_AUTO_OFF_MS || autoOffMs > MAX_TORCH_AUTO_OFF_MS) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "torch.set recipe device primitive auto_off_ms must be 100..1500");
        }
        JSONObject args = new JSONObject();
        Json.put(args, "enabled", true);
        Json.put(args, "auto_off_ms", autoOffMs);
        JSONObject safe = new JSONObject();
        Json.put(safe, "command", COMMAND_TORCH_SET);
        Json.put(safe, "args", args);
        return safe;
    }

    private static JSONObject sanitizePhoto(JSONObject action) throws CommandException {
        JSONObject rawArgs = actionArgsObject(action, COMMAND_PHOTO_CAPTURE);
        int maxWidth = rawArgs.optInt("max_width", DEFAULT_PHOTO_MAX_WIDTH);
        long timeoutMs = rawArgs.optLong("timeout_ms", DEFAULT_PHOTO_TIMEOUT_MS);
        if (maxWidth < MIN_PHOTO_MAX_WIDTH || maxWidth > MAX_PHOTO_MAX_WIDTH) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "photo.capture recipe device primitive max_width must be 320..1920");
        }
        if (timeoutMs < MIN_PHOTO_TIMEOUT_MS || timeoutMs > MAX_PHOTO_TIMEOUT_MS) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "photo.capture recipe device primitive timeout_ms must be 1000..15000");
        }
        JSONObject args = new JSONObject();
        Json.put(args, "max_width", maxWidth);
        Json.put(args, "timeout_ms", timeoutMs);
        Json.put(args, "suppress_chime", true);
        String cameraId = rawArgs.optString("camera_id", "").trim();
        if (!cameraId.isEmpty()) {
            Json.put(args, "camera_id", cameraId);
        }
        JSONObject safe = new JSONObject();
        Json.put(safe, "command", COMMAND_PHOTO_CAPTURE);
        Json.put(safe, "args", args);
        return safe;
    }

    private static JSONObject sanitizeLocation(JSONObject action) throws CommandException {
        JSONObject rawArgs = actionArgsObject(action, COMMAND_LOCATION_PIN);
        long timeoutMs = rawArgs.optLong("timeout_ms", DEFAULT_LOCATION_TIMEOUT_MS);
        if (timeoutMs < 500L || timeoutMs > 60000L) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "location.pin recipe device primitive timeout_ms must be 500..60000");
        }
        long maxCacheAgeMs = rawArgs.optLong("max_cache_age_ms", DEFAULT_LOCATION_MAX_CACHE_AGE_MS);
        if (maxCacheAgeMs < 0L || maxCacheAgeMs > 300000L) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "location.pin recipe device primitive max_cache_age_ms must be 0..300000");
        }
        JSONObject args = new JSONObject();
        Json.put(args, "timeout_ms", timeoutMs);
        Json.put(args, "max_cache_age_ms", maxCacheAgeMs);
        Json.put(args, "fresh", true);
        Json.put(args, "allow_pending", rawArgs.optBoolean("allow_pending", true));
        Json.put(args, "publish", rawArgs.optBoolean("publish", false));
        String clipboardEntryId = rawArgs.optString("pucky_clipboard_entry_id", "").trim();
        if (!clipboardEntryId.isEmpty()) {
            Json.put(args, "pucky_clipboard_entry_id", clipboardEntryId);
        }
        String provider = rawArgs.optString("provider", "").trim();
        if (!provider.isEmpty()) {
            Json.put(args, "provider", provider);
        }
        JSONObject safe = new JSONObject();
        Json.put(safe, "command", COMMAND_LOCATION_PIN);
        Json.put(safe, "args", args);
        return safe;
    }

    private static JSONObject sanitizeScreenshot(JSONObject action) throws CommandException {
        JSONObject rawArgs = actionArgsObject(action, COMMAND_SCREENSHOT_CAPTURE);
        long timeoutMs = rawArgs.optLong("timeout_ms", DEFAULT_SCREENSHOT_TIMEOUT_MS);
        if (timeoutMs < 500L || timeoutMs > 10000L) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "screenshot.capture recipe device primitive timeout_ms must be 500..10000");
        }
        JSONObject args = new JSONObject();
        Json.put(args, "timeout_ms", timeoutMs);
        Json.put(args, "publish", rawArgs.optBoolean("publish", true));
        JSONObject safe = new JSONObject();
        Json.put(safe, "command", COMMAND_SCREENSHOT_CAPTURE);
        Json.put(safe, "args", args);
        return safe;
    }

    private static JSONObject sanitizeVideoStart(JSONObject action) throws CommandException {
        JSONObject rawArgs = actionArgsObject(action, COMMAND_VIDEO_CAPTURE_START);
        int maxWidth = rawArgs.optInt("max_width", DEFAULT_PHOTO_MAX_WIDTH);
        long timeoutMs = rawArgs.optLong("timeout_ms", DEFAULT_PHOTO_TIMEOUT_MS);
        long maxDurationMs = rawArgs.optLong("max_duration_ms", DEFAULT_VIDEO_MAX_DURATION_MS);
        if (maxWidth < MIN_PHOTO_MAX_WIDTH || maxWidth > MAX_PHOTO_MAX_WIDTH) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "video.capture.start recipe device primitive max_width must be 320..1920");
        }
        if (timeoutMs < MIN_PHOTO_TIMEOUT_MS || timeoutMs > MAX_PHOTO_TIMEOUT_MS) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "video.capture.start recipe device primitive timeout_ms must be 1000..15000");
        }
        if (maxDurationMs < 5000L || maxDurationMs > 300000L) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "video.capture.start recipe device primitive max_duration_ms must be 5000..300000");
        }
        JSONObject args = new JSONObject();
        Json.put(args, "max_width", maxWidth);
        Json.put(args, "timeout_ms", timeoutMs);
        Json.put(args, "max_duration_ms", maxDurationMs);
        Json.put(args, "suppress_chime", true);
        String cameraId = rawArgs.optString("camera_id", "").trim();
        if (!cameraId.isEmpty()) {
            Json.put(args, "camera_id", cameraId);
        }
        JSONObject safe = new JSONObject();
        Json.put(safe, "command", COMMAND_VIDEO_CAPTURE_START);
        Json.put(safe, "args", args);
        return safe;
    }

    private static JSONObject sanitizeVideoStop(JSONObject action) throws CommandException {
        actionArgsObject(action, COMMAND_VIDEO_CAPTURE_STOP);
        JSONObject safe = new JSONObject();
        Json.put(safe, "command", COMMAND_VIDEO_CAPTURE_STOP);
        Json.put(safe, "args", new JSONObject());
        return safe;
    }

    private static JSONObject sanitizeNotify(JSONObject action) throws CommandException {
        JSONObject rawArgs = actionArgsObject(action, COMMAND_NOTIFY_SHOW);
        JSONObject args = new JSONObject();
        Json.put(args, "title", rawArgs.optString("title", "Pucky"));
        Json.put(args, "text", rawArgs.optString("text", "Pucky notification"));
        Json.put(args, "id", rawArgs.optString("id", "pucky_recipe_notification"));
        Json.put(args, "auto_cancel", rawArgs.optBoolean("auto_cancel", true));
        Json.put(args, "audible", rawArgs.optBoolean("audible", false));
        if (rawArgs.has("timeout_ms")) {
            Json.put(args, "timeout_ms", Math.max(0L, rawArgs.optLong("timeout_ms", 0L)));
        }
        JSONObject safe = new JSONObject();
        Json.put(safe, "command", COMMAND_NOTIFY_SHOW);
        Json.put(safe, "args", args);
        return safe;
    }

    private static JSONObject actionArgsObject(JSONObject action, String command) throws CommandException {
        if (!action.has("args") || action.isNull("args")) {
            return new JSONObject();
        }
        JSONObject args = action.optJSONObject("args");
        if (args == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    command + " recipe device primitive args must be a JSON object");
        }
        return args;
    }

    private LocationController requireLocationController() throws CommandException {
        if (locationController == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "location.pin controller unavailable");
        }
        return locationController;
    }

    private ScreenshotController requireScreenshotController() throws CommandException {
        if (screenshotController == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "screenshot.capture controller unavailable");
        }
        return screenshotController;
    }

    private VideoCaptureController requireVideoCaptureController() throws CommandException {
        if (videoCaptureController == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "video.capture controller unavailable");
        }
        return videoCaptureController;
    }

    private NotificationController requireNotificationController() throws CommandException {
        if (notificationController == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "notify.show controller unavailable");
        }
        return notificationController;
    }

    public JSONObject playSuccessChime(String schema) {
        return playFileChime(schema, SUCCESS_SOUND_PATH, "Soft.ogg",
                ToneGenerator.TONE_PROP_ACK, 140, "pucky-keyword-action-chime");
    }

    public JSONObject playTurnSentChime(String schema) {
        return playRawResourceChime(schema, R.raw.pucky_system_notification, TURN_SENT_SOUND_NAME,
                ToneGenerator.TONE_PROP_ACK, 140, "pucky-turn-sent-chime");
    }

    public JSONObject playTurnReceivedChime(String schema) {
        return playRawResourceChime(schema, R.raw.pucky_new_message_2, TURN_RECEIVED_SOUND_NAME,
                ToneGenerator.TONE_PROP_ACK, 160, "pucky-turn-received-chime");
    }

    public JSONObject playWakeListeningChime(String schema) {
        return playRawResourceChime(schema, R.raw.pucky_system_notification, TURN_SENT_SOUND_NAME,
                ToneGenerator.TONE_PROP_ACK, 140, "pucky-wake-listening-chime");
    }

    public JSONObject playFailureChime(String schema) {
        return playFileChime(schema, FAILURE_SOUND_PATH, "LowBattery.ogg",
                ToneGenerator.TONE_PROP_NACK, 220, "pucky-keyword-action-failure-chime");
    }

    private JSONObject playFileChime(
            String schema, String assetPath, String assetName, int fallbackTone, int fallbackDurationMs, String threadName) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", schema);
        Json.put(out, "stream", "music");
        Json.put(out, "asset_name", assetName);
        Json.put(out, "asset_path", assetPath);
        Json.put(out, "player", "MediaPlayer");
        Json.put(out, "usage", "media_sonification");
        Json.put(out, "played", false);
        Json.put(out, "fallback_used", false);
        Json.put(out, "asset_exists", new File(assetPath).exists());
        try {
            MediaPlayer player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(assetPath);
            player.setOnCompletionListener(MediaPlayer::release);
            player.setOnErrorListener((mp, what, extra) -> {
                mp.release();
                return true;
            });
            player.prepare();
            player.start();
            Json.put(out, "played", true);
            return out;
        } catch (Exception exc) {
            Json.put(out, "asset_error", exc.getClass().getSimpleName() + ": " + exc.getMessage());
            JSONObject fallback = playToneChime(schema + ".fallback", fallbackTone, fallbackDurationMs, threadName);
            Json.put(out, "played", fallback.optBoolean("played", false));
            Json.put(out, "fallback_used", true);
            Json.put(out, "fallback", fallback);
            return out;
        }
    }

    private JSONObject playRawResourceChime(
            String schema, int resourceId, String assetName, int fallbackTone, int fallbackDurationMs, String threadName) {
        JSONObject out = new JSONObject();
        String assetPath = context == null
                ? "android.resource://missing/raw/" + assetName.replace('.', '_')
                : Uri.parse("android.resource://" + context.getPackageName() + "/" + resourceId).toString();
        Json.put(out, "schema", schema);
        Json.put(out, "stream", "music");
        Json.put(out, "asset_name", assetName);
        Json.put(out, "asset_path", assetPath);
        Json.put(out, "player", "MediaPlayer");
        Json.put(out, "usage", "media_sonification");
        Json.put(out, "played", false);
        Json.put(out, "fallback_used", false);
        Json.put(out, "asset_exists", context != null);
        if (context == null) {
            Json.put(out, "asset_error", "IllegalStateException: context unavailable");
            JSONObject fallback = playToneChime(schema + ".fallback", fallbackTone, fallbackDurationMs, threadName);
            Json.put(out, "played", fallback.optBoolean("played", false));
            Json.put(out, "fallback_used", true);
            Json.put(out, "fallback", fallback);
            return out;
        }
        AssetFileDescriptor descriptor = null;
        MediaPlayer player = null;
        try {
            descriptor = context.getResources().openRawResourceFd(resourceId);
            if (descriptor == null) {
                throw new IOException("missing raw resource");
            }
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setDataSource(descriptor.getFileDescriptor(), descriptor.getStartOffset(), descriptor.getLength());
            final AssetFileDescriptor playbackDescriptor = descriptor;
            player.setOnCompletionListener(mp -> {
                mp.release();
                closeQuietly(playbackDescriptor);
            });
            player.setOnErrorListener((mp, what, extra) -> {
                mp.release();
                closeQuietly(playbackDescriptor);
                return true;
            });
            player.prepare();
            player.start();
            Json.put(out, "played", true);
            return out;
        } catch (Exception exc) {
            if (player != null) {
                try {
                    player.release();
                } catch (RuntimeException ignored) {
                    // Best-effort release after playback setup failure.
                }
            }
            closeQuietly(descriptor);
            Json.put(out, "asset_error", exc.getClass().getSimpleName() + ": " + exc.getMessage());
            JSONObject fallback = playToneChime(schema + ".fallback", fallbackTone, fallbackDurationMs, threadName);
            Json.put(out, "played", fallback.optBoolean("played", false));
            Json.put(out, "fallback_used", true);
            Json.put(out, "fallback", fallback);
            return out;
        }
    }

    private JSONObject playToneChime(String schema, int tone, int durationMs, String threadName) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", schema);
        Json.put(out, "stream", "music");
        Json.put(out, "usage", "media_sonification");
        Json.put(out, "volume", 85);
        Json.put(out, "duration_ms", durationMs);
        Json.put(out, "played", false);
        try {
            ToneGenerator generator = new ToneGenerator(AudioManager.STREAM_MUSIC, 85);
            generator.startTone(tone, durationMs);
            new Thread(() -> {
                try {
                    Thread.sleep(durationMs + 100L);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                generator.release();
            }, threadName).start();
            Json.put(out, "played", true);
            Json.put(out, "tone", tone);
        } catch (RuntimeException exc) {
            Json.put(out, "error", exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
        return out;
    }

    private static void closeQuietly(AssetFileDescriptor descriptor) {
        if (descriptor == null) {
            return;
        }
        try {
            descriptor.close();
        } catch (IOException ignored) {
            // Best-effort close for raw-resource playback descriptors.
        }
    }

    private void handlePendingLocationResolution(JSONObject args, JSONObject result) {
        String entryId = args == null ? "" : args.optString("pucky_clipboard_entry_id", "").trim();
        String status = "succeeded".equals(result.optString("state", "")) ? "succeeded" : "failed";
        if ("succeeded".equals(status)) {
            playSuccessChime("pucky.location_pending_success_chime.v1");
        } else {
            playFailureChime("pucky.location_pending_failure_chime.v1");
        }
        if (context == null || entryId.isEmpty()) {
            return;
        }
        for (int attempt = 0; attempt < 6; attempt++) {
            JSONObject patched = PuckyClipboardController.shared(context).patchActionResolution(entryId, status, result);
            if (patched.optBoolean("patched", false)) {
                return;
            }
            try {
                Thread.sleep(250L);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }
}
