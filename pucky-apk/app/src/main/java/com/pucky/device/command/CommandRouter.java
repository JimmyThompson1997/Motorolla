package com.pucky.device.command;

import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.time.Instant;

public final class CommandRouter {
    private final CommandExecutor executor;

    public CommandRouter(CommandExecutor executor) {
        this.executor = executor;
    }

    public CommandHandlingResult handle(String raw) {
        CommandEnvelope command;
        try {
            command = CommandEnvelope.parse(raw);
        } catch (CommandException e) {
            JSONObject rejected = ack("unknown", "unknown", "rejected", e.code(), e.getMessage());
            return new CommandHandlingResult("unknown", "unknown", "rejected", rejected, null);
        }

        if (command.expired(Instant.now())) {
            JSONObject rejected = ack(command.id(), command.type(), "rejected",
                    CommandErrorCodes.COMMAND_EXPIRED, "Command TTL has elapsed");
            return new CommandHandlingResult(command.id(), command.type(), "rejected", rejected, null);
        }

        JSONObject accepted = ack(command.id(), command.type(), "accepted", null, null);
        try {
            JSONObject payload = executor.execute(command);
            JSONObject completed = result(command.id(), command.type(), "completed", payload, null, null);
            return new CommandHandlingResult(command.id(), command.type(), "completed", accepted, completed);
        } catch (CommandException e) {
            JSONObject failed = result(command.id(), command.type(), "failed", null, e.code(), e.getMessage());
            return new CommandHandlingResult(command.id(), command.type(), "failed", accepted, failed);
        } catch (Exception e) {
            JSONObject failed = result(command.id(), command.type(), "failed", null,
                    CommandErrorCodes.EXECUTION_FAILED, e.getMessage());
            return new CommandHandlingResult(command.id(), command.type(), "failed", accepted, failed);
        }
    }

    private static JSONObject ack(String id, String type, String status, String code, String message) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.command_ack.v1");
        Json.put(out, "id", id);
        Json.put(out, "type", type);
        Json.put(out, "status", status);
        Json.put(out, "timestamp", Instant.now().toString());
        if (code != null) {
            Json.put(out, "error", error(code, message));
        } else {
            Json.put(out, "error", JSONObject.NULL);
        }
        return out;
    }

    private static JSONObject result(String id, String type, String status, JSONObject payload, String code, String message) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.command_result.v1");
        Json.put(out, "id", id);
        Json.put(out, "type", type);
        Json.put(out, "status", status);
        Json.put(out, "completed_at", Instant.now().toString());
        Json.put(out, "result", payload == null ? JSONObject.NULL : payload);
        if (code != null) {
            Json.put(out, "error", error(code, message));
        } else {
            Json.put(out, "error", JSONObject.NULL);
        }
        return out;
    }

    private static JSONObject error(String code, String message) {
        JSONObject out = new JSONObject();
        Json.put(out, "code", code);
        Json.put(out, "message", message == null ? "" : message);
        return out;
    }
}

