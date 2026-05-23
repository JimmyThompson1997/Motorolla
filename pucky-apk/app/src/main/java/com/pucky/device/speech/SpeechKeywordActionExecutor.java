package com.pucky.device.speech;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.ToneGenerator;

import com.pucky.device.camera.CameraController;
import com.pucky.device.camera.VideoCaptureController;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.location.LocationController;
import com.pucky.device.screenshot.ScreenshotController;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.io.File;

public final class SpeechKeywordActionExecutor {
    public static final String COMMAND_TORCH_SET = "torch.set";
    public static final String COMMAND_PHOTO_CAPTURE = "photo.capture";
    public static final String COMMAND_LOCATION_PIN = "location.pin";
    public static final String COMMAND_SCREENSHOT_CAPTURE = "screenshot.capture";
    public static final String COMMAND_VIDEO_CAPTURE_START = "video.capture.start";
    public static final String COMMAND_VIDEO_CAPTURE_STOP = "video.capture.stop";
    public static final int DEFAULT_TORCH_AUTO_OFF_MS = 600;
    public static final int MIN_TORCH_AUTO_OFF_MS = 100;
    public static final int MAX_TORCH_AUTO_OFF_MS = 1500;
    public static final int DEFAULT_PHOTO_MAX_WIDTH = 1280;
    public static final long DEFAULT_PHOTO_TIMEOUT_MS = 8000L;
    public static final int MIN_PHOTO_MAX_WIDTH = 320;
    public static final int MAX_PHOTO_MAX_WIDTH = 1920;
    public static final long MIN_PHOTO_TIMEOUT_MS = 1000L;
    public static final long MAX_PHOTO_TIMEOUT_MS = 15000L;
    public static final long DEFAULT_LOCATION_TIMEOUT_MS = 4000L;
    public static final long DEFAULT_SCREENSHOT_TIMEOUT_MS = 4000L;
    public static final long DEFAULT_VIDEO_MAX_DURATION_MS = 60000L;
    private static final String SUCCESS_SOUND_PATH = "/product/media/audio/notifications/Soft.ogg";
    private static final String FAILURE_SOUND_PATH = "/product/media/audio/ui/LowBattery.ogg";

    private final CameraController cameraController;
    private final LocationController locationController;
    private final ScreenshotController screenshotController;
    private final VideoCaptureController videoCaptureController;

    public SpeechKeywordActionExecutor(Context context) {
        this(new CameraController(context),
                new LocationController(context),
                new ScreenshotController(context),
                VideoCaptureController.shared(context));
    }

    SpeechKeywordActionExecutor(CameraController cameraController) {
        this(cameraController, null, null, null);
    }

    SpeechKeywordActionExecutor(
            CameraController cameraController,
            LocationController locationController,
            ScreenshotController screenshotController,
            VideoCaptureController videoCaptureController) {
        this.cameraController = cameraController;
        this.locationController = locationController;
        this.screenshotController = screenshotController;
        this.videoCaptureController = videoCaptureController;
    }

    public JSONObject execute(JSONObject action) throws CommandException {
        JSONObject safe = sanitize(action);
        String command = safe.optString("command", "");
        JSONObject args = safe.optJSONObject("args");
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.speech_echo_lab_keyword_action_result.v1");
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
            JSONObject location = requireLocationController().get(args == null ? new JSONObject() : args);
            if (!location.optBoolean("available", false)) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "Location unavailable: " + location.optString("reason", "NO_LOCATION_SAMPLE"));
            }
            Json.put(location, "stale", !location.optBoolean("fresh", false));
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
        throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED,
                "Unsupported keyword action command: " + command);
    }

    public static JSONObject sanitize(JSONObject action) throws CommandException {
        if (action == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "keyword action requires action object");
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
        throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED,
                "Only torch.set, photo.capture, location.pin, screenshot.capture, video.capture.start, and video.capture.stop keyword actions are supported");
    }

    private static JSONObject sanitizeTorch(JSONObject action) throws CommandException {
        JSONObject rawArgs = actionArgsObject(action, COMMAND_TORCH_SET);
        int autoOffMs = DEFAULT_TORCH_AUTO_OFF_MS;
        if (rawArgs.has("auto_off_ms")) {
            autoOffMs = rawArgs.optInt("auto_off_ms", -1);
        }
        if (autoOffMs < MIN_TORCH_AUTO_OFF_MS || autoOffMs > MAX_TORCH_AUTO_OFF_MS) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "torch.set keyword action auto_off_ms must be 100..1500");
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
                    "photo.capture keyword action max_width must be 320..1920");
        }
        if (timeoutMs < MIN_PHOTO_TIMEOUT_MS || timeoutMs > MAX_PHOTO_TIMEOUT_MS) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "photo.capture keyword action timeout_ms must be 1000..15000");
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
        if (timeoutMs < 500L || timeoutMs > 30000L) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "location.pin keyword action timeout_ms must be 500..30000");
        }
        JSONObject args = new JSONObject();
        Json.put(args, "timeout_ms", timeoutMs);
        Json.put(args, "fresh", true);
        Json.put(args, "publish", false);
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
                    "screenshot.capture keyword action timeout_ms must be 500..10000");
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
                    "video.capture.start keyword action max_width must be 320..1920");
        }
        if (timeoutMs < MIN_PHOTO_TIMEOUT_MS || timeoutMs > MAX_PHOTO_TIMEOUT_MS) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "video.capture.start keyword action timeout_ms must be 1000..15000");
        }
        if (maxDurationMs < 5000L || maxDurationMs > 300000L) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "video.capture.start keyword action max_duration_ms must be 5000..300000");
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

    private static JSONObject actionArgsObject(JSONObject action, String command) throws CommandException {
        if (!action.has("args") || action.isNull("args")) {
            return new JSONObject();
        }
        JSONObject args = action.optJSONObject("args");
        if (args == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    command + " keyword action args must be a JSON object");
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

    public JSONObject playSuccessChime(String schema) {
        return playFileChime(schema, SUCCESS_SOUND_PATH, "Soft.ogg",
                ToneGenerator.TONE_PROP_ACK, 140, "pucky-keyword-action-chime");
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

    private JSONObject playToneChime(String schema, int tone, int durationMs, String threadName) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", schema);
        Json.put(out, "stream", "music");
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
}
