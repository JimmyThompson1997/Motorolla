package com.pucky.device.command;

import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class CommandHandlingResult {
    private final String commandId;
    private final String type;
    private final String status;
    private final JSONObject ack;
    private final JSONObject result;

    public CommandHandlingResult(String commandId, String type, String status, JSONObject ack, JSONObject result) {
        this.commandId = commandId;
        this.type = type;
        this.status = status;
        this.ack = ack;
        this.result = result;
    }

    public String commandId() {
        return commandId;
    }

    public String type() {
        return type;
    }

    public String status() {
        return status;
    }

    public JSONObject ack() {
        return ack;
    }

    public JSONObject result() {
        return result;
    }

    public JSONObject toJson() {
        JSONObject out = new JSONObject();
        Json.put(out, "command_id", commandId);
        Json.put(out, "type", type);
        Json.put(out, "status", status);
        Json.put(out, "ack", ack == null ? JSONObject.NULL : ack);
        Json.put(out, "result", result == null ? JSONObject.NULL : result);
        return out;
    }
}

