package com.pucky.device.speech;

import android.content.Context;

import com.pucky.device.camera.CameraController;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class SpeechKeywordActionExecutor {
    public static final String COMMAND_TORCH_SET = "torch.set";
    public static final String COMMAND_PHOTO_CAPTURE = "photo.capture";
    public static final int DEFAULT_TORCH_AUTO_OFF_MS = 600;
    public static final int MIN_TORCH_AUTO_OFF_MS = 100;
    public static final int MAX_TORCH_AUTO_OFF_MS = 1500;
    public static final int DEFAULT_PHOTO_MAX_WIDTH = 1280;
    public static final long DEFAULT_PHOTO_TIMEOUT_MS = 8000L;
    public static final int MIN_PHOTO_MAX_WIDTH = 320;
    public static final int MAX_PHOTO_MAX_WIDTH = 1920;
    public static final long MIN_PHOTO_TIMEOUT_MS = 1000L;
    public static final long MAX_PHOTO_TIMEOUT_MS = 15000L;

    private final CameraController cameraController;

    public SpeechKeywordActionExecutor(Context context) {
        this(new CameraController(context));
    }

    SpeechKeywordActionExecutor(CameraController cameraController) {
        this.cameraController = cameraController;
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
        throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED,
                "Only torch.set and photo.capture keyword actions are supported");
    }

    private static JSONObject sanitizeTorch(JSONObject action) throws CommandException {
        JSONObject rawArgs = action.optJSONObject("args");
        if (rawArgs == null) {
            rawArgs = new JSONObject();
        }
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
        JSONObject rawArgs = action.optJSONObject("args");
        if (rawArgs == null) {
            rawArgs = new JSONObject();
        }
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
        String cameraId = rawArgs.optString("camera_id", "").trim();
        if (!cameraId.isEmpty()) {
            Json.put(args, "camera_id", cameraId);
        }
        JSONObject safe = new JSONObject();
        Json.put(safe, "command", COMMAND_PHOTO_CAPTURE);
        Json.put(safe, "args", args);
        return safe;
    }
}
