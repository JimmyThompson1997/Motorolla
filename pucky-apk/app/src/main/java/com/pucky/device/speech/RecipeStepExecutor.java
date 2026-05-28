package com.pucky.device.speech;

import android.content.Context;

import com.pucky.device.broker.BrokerEventPoster;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.status.AppIdentity;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.UUID;

public final class RecipeStepExecutor {
    private final Context context;
    private final SettingsStore settings;
    private final RecipeDevicePrimitiveExecutor deviceExecutor;
    private final BrokerEventPoster brokerEventPoster;

    public RecipeStepExecutor(Context context) {
        this.context = context.getApplicationContext();
        this.settings = new SettingsStore(this.context);
        this.deviceExecutor = new RecipeDevicePrimitiveExecutor(this.context);
        this.brokerEventPoster = new BrokerEventPoster(this.context);
    }

    RecipeStepExecutor(
            Context context,
            RecipeDevicePrimitiveExecutor deviceExecutor,
            BrokerEventPoster brokerEventPoster) {
        this.context = context.getApplicationContext();
        this.settings = new SettingsStore(this.context);
        this.deviceExecutor = deviceExecutor;
        this.brokerEventPoster = brokerEventPoster;
    }

    public JSONObject execute(SpeechRecipeRegistry.RecipeMatch match, JSONObject session) throws CommandException {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.recipe_execution_result.v1");
        Json.put(out, "recipe_id", match.id);
        Json.put(out, "matched_phrase", match.phrase);
        Json.put(out, "status", "succeeded");
        JSONArray stepResults = new JSONArray();
        for (int i = 0; i < match.steps.length(); i++) {
            JSONObject step = match.steps.optJSONObject(i);
            if (step == null) {
                continue;
            }
            JSONObject stepResult = executeStep(match, step, session, i);
            Json.add(stepResults, stepResult);
            if ("pending".equals(stepResult.optString("status", ""))) {
                Json.put(out, "status", "pending");
                break;
            }
            if (!"succeeded".equals(stepResult.optString("status", ""))) {
                Json.put(out, "status", "failed");
                Json.put(out, "error_code", stepResult.optString("error_code", CommandErrorCodes.EXECUTION_FAILED));
                Json.put(out, "error_message", stepResult.optString("error_message", "recipe step failed"));
                break;
            }
        }
        Json.put(out, "step_results", stepResults);
        Json.put(out, "primary_action_command", primaryActionCommand(stepResults));
        Json.put(out, "primary_action_result", primaryActionResult(stepResults));
        return out;
    }

    public static JSONObject devicePrimitives() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.device_primitives.v1");
        Json.put(out, "execution_scope", "apk_allowlisted_only");
        Json.put(out, "unsafe_commands_allowed", false);
        Json.put(out, "primitives", primitivesArray());
        return out;
    }

    public JSONObject playSuccessChime(String schema) {
        return deviceExecutor.playSuccessChime(schema);
    }

    public JSONObject playFailureChime(String schema) {
        return deviceExecutor.playFailureChime(schema);
    }

    private JSONObject executeStep(
            SpeechRecipeRegistry.RecipeMatch match,
            JSONObject step,
            JSONObject session,
            int index) throws CommandException {
        String type = step.optString("type", "");
        if ("device".equals(type)) {
            return executeDeviceStep(step, index, session);
        }
        if ("vm_event".equals(type)) {
            return executeVmEventStep(match, step, session, index);
        }
        if ("chime".equals(type)) {
            return executeChimeStep(step, index);
        }
        JSONObject out = baseStepResult(index, type);
        Json.put(out, "status", "failed");
        Json.put(out, "error_code", CommandErrorCodes.COMMAND_NOT_ALLOWED);
        Json.put(out, "error_message", "Unsupported recipe step type: " + type);
        return out;
    }

    private JSONObject executeDeviceStep(JSONObject step, int index, JSONObject session) throws CommandException {
        JSONObject out = baseStepResult(index, "device");
        String command = step.optString("command", "");
        JSONObject action = new JSONObject();
        Json.put(action, "command", command);
        JSONObject args = step.optJSONObject("args") == null ? new JSONObject() : copy(step.optJSONObject("args"));
        if (session != null && !session.optString("pucky_clipboard_entry_id", "").trim().isEmpty()) {
            Json.put(args, "pucky_clipboard_entry_id", session.optString("pucky_clipboard_entry_id", ""));
        }
        Json.put(action, "args", args);
        try {
            JSONObject result = deviceExecutor.execute(action);
            JSONObject primitiveResult = result.optJSONObject("result");
            String state = primitiveResult == null ? "" : primitiveResult.optString("state", "");
            Json.put(out, "status", "pending".equals(state) ? "pending" : "succeeded");
            Json.put(out, "command", command);
            Json.put(out, "result", result);
            return out;
        } catch (CommandException exc) {
            Json.put(out, "status", "failed");
            Json.put(out, "command", command);
            Json.put(out, "error_code", exc.code());
            Json.put(out, "error_message", exc.getMessage());
            return out;
        }
    }

    private JSONObject executeVmEventStep(
            SpeechRecipeRegistry.RecipeMatch match,
            JSONObject step,
            JSONObject session,
            int index) {
        JSONObject out = baseStepResult(index, "vm_event");
        JSONObject event = vmEvent(match, step, session);
        try {
            JSONObject delivery = brokerEventPoster.post(event);
            Json.put(out, "status", delivery.optBoolean("ok", false) ? "succeeded" : "failed");
            Json.put(out, "event", event);
            Json.put(out, "delivery", delivery);
            if (!delivery.optBoolean("ok", false)) {
                Json.put(out, "error_code", CommandErrorCodes.EXECUTION_FAILED);
                Json.put(out, "error_message", "Broker event post failed http_" + delivery.optInt("http_status", 0));
            }
        } catch (Exception exc) {
            Json.put(out, "status", "failed");
            Json.put(out, "event", event);
            Json.put(out, "error_code", CommandErrorCodes.EXECUTION_FAILED);
            Json.put(out, "error_message", exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
        return out;
    }

    private JSONObject executeChimeStep(JSONObject step, int index) {
        JSONObject out = baseStepResult(index, "chime");
        String sound = step.optString("sound", "soft");
        JSONObject chime;
        if ("low_battery".equals(sound)) {
            chime = deviceExecutor.playFailureChime("pucky.recipe_step_chime.v1");
        } else if ("none".equals(sound)) {
            chime = new JSONObject();
            Json.put(chime, "played", false);
            Json.put(chime, "reason", "sound_none");
        } else {
            chime = deviceExecutor.playSuccessChime("pucky.recipe_step_chime.v1");
        }
        Json.put(out, "status", "succeeded");
        Json.put(out, "sound", sound);
        Json.put(out, "result", chime);
        return out;
    }

    private JSONObject vmEvent(SpeechRecipeRegistry.RecipeMatch match, JSONObject step, JSONObject session) {
        JSONObject event = new JSONObject();
        Json.put(event, "schema", "pucky.keyword_triggered.v1");
        Json.put(event, "event_id", "evt_" + UUID.randomUUID().toString().replace("-", ""));
        Json.put(event, "device_id", settings.getDeviceId());
        Json.put(event, "timestamp", Instant.now().toString());
        Json.put(event, "type", step.optString("event_type", "agent.recipe_triggered"));
        Json.put(event, "source", session == null
                ? "volume_down_lab"
                : session.optString("source", "volume_down_lab"));
        Json.put(event, "recipe_id", match.id);
        Json.put(event, "recipe_phrase", match.phrase);
        Json.put(event, "raw_transcript", match.rawTranscript);
        Json.put(event, "normalized_transcript", match.normalizedTranscript);
        Json.put(event, "match_strategy", "exact_utterance");
        Json.put(event, "args", step.optJSONObject("args") == null ? new JSONObject() : step.optJSONObject("args"));
        Json.put(event, "session_id", session == null ? JSONObject.NULL : session.optString("session_id", ""));
        Json.put(event, "route", session == null ? JSONObject.NULL : session.opt("route"));
        Json.put(event, "pucky_clipboard_entry_id",
                session == null ? JSONObject.NULL : session.optString("pucky_clipboard_entry_id", ""));
        Json.put(event, "app_identity", AppIdentity.json(context));
        Json.put(event, "artifacts", artifactsFromSession(session));
        return event;
    }

    private static JSONObject baseStepResult(int index, String type) {
        JSONObject out = new JSONObject();
        Json.put(out, "index", index);
        Json.put(out, "type", type);
        return out;
    }

    private static String primaryActionCommand(JSONArray results) {
        for (int i = 0; i < results.length(); i++) {
            JSONObject result = results.optJSONObject(i);
            if (result != null && "device".equals(result.optString("type", ""))) {
                return result.optString("command", "");
            }
            if (result != null && "vm_event".equals(result.optString("type", ""))) {
                return "vm_event.post";
            }
        }
        return "";
    }

    private static Object primaryActionResult(JSONArray results) {
        for (int i = 0; i < results.length(); i++) {
            JSONObject result = results.optJSONObject(i);
            if (result == null) {
                continue;
            }
            if ("device".equals(result.optString("type", ""))) {
                return result.opt("result");
            }
            if ("vm_event".equals(result.optString("type", ""))) {
                return result;
            }
        }
        return JSONObject.NULL;
    }

    private static JSONArray artifactsFromSession(JSONObject session) {
        JSONArray artifacts = new JSONArray();
        if (session == null) {
            return artifacts;
        }
        JSONObject actionResult = session.optJSONObject("keyword_action_result");
        if (actionResult == null) {
            return artifacts;
        }
        JSONObject result = actionResult.optJSONObject("result");
        if (result == null) {
            return artifacts;
        }
        JSONObject artifact = new JSONObject();
        Json.put(artifact, "private_path", result.optString("app_private_path", result.optString("path", "")));
        Json.put(artifact, "public_uri", result.optString("public_uri", result.optString("content_uri", "")));
        Json.put(artifact, "mime_type", result.optString("mime_type", ""));
        Json.put(artifact, "bytes", result.optLong("bytes", -1));
        Json.add(artifacts, artifact);
        return artifacts;
    }

    private static JSONArray primitivesArray() {
        JSONArray out = new JSONArray();
        Json.add(out, primitive(RecipeDevicePrimitiveExecutor.COMMAND_TORCH_SET,
                "Flashlight burst; auto_off_ms 100..1500."));
        Json.add(out, primitive(RecipeDevicePrimitiveExecutor.COMMAND_PHOTO_CAPTURE,
                "Capture JPEG and publish to MediaStore/DCIM/Pucky."));
        Json.add(out, primitive(RecipeDevicePrimitiveExecutor.COMMAND_LOCATION_PIN,
                "Capture current or recent device location; starts async pending acquisition when needed."));
        Json.add(out, primitive(RecipeDevicePrimitiveExecutor.COMMAND_SCREENSHOT_CAPTURE,
                "Capture active screen through Pucky AccessibilityService."));
        Json.add(out, primitive(RecipeDevicePrimitiveExecutor.COMMAND_VIDEO_CAPTURE_START,
                "Start silent local video recording."));
        Json.add(out, primitive(RecipeDevicePrimitiveExecutor.COMMAND_VIDEO_CAPTURE_STOP,
                "Stop active local video recording."));
        Json.add(out, primitive(RecipeDevicePrimitiveExecutor.COMMAND_NOTIFY_SHOW,
                "Show a local Pucky notification through the Android notification manager."));
        Json.add(out, primitive("vm_event.post",
                "Post pucky.keyword_triggered.v1 to the configured VM broker."));
        return out;
    }

    private static JSONObject primitive(String command, String note) {
        JSONObject out = new JSONObject();
        Json.put(out, "command", command);
        Json.put(out, "note", note);
        return out;
    }

    private static JSONObject copy(JSONObject object) {
        try {
            return new JSONObject(object == null ? "{}" : object.toString());
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }
}
