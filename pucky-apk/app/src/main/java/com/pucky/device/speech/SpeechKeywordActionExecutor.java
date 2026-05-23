package com.pucky.device.speech;

import android.content.Context;

import com.pucky.device.camera.CameraController;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class SpeechKeywordActionExecutor {
    public static final String COMMAND_TORCH_SET = "torch.set";
    public static final int DEFAULT_TORCH_AUTO_OFF_MS = 600;
    public static final int MIN_TORCH_AUTO_OFF_MS = 100;
    public static final int MAX_TORCH_AUTO_OFF_MS = 1500;

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
        throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED,
                "Unsupported keyword action command: " + command);
    }

    public static JSONObject sanitize(JSONObject action) throws CommandException {
        if (action == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "keyword action requires action object");
        }
        String command = action.optString("command", "").trim();
        if (!COMMAND_TORCH_SET.equals(command)) {
            throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED,
                    "Only torch.set keyword actions are supported");
        }
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
}
