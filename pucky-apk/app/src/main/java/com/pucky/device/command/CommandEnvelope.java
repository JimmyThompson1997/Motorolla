package com.pucky.device.command;

import org.json.JSONObject;

import java.time.Duration;
import java.time.Instant;

public final class CommandEnvelope {
    private final String id;
    private final String type;
    private final JSONObject args;
    private final String createdAt;
    private final long ttlMs;

    private CommandEnvelope(String id, String type, JSONObject args, String createdAt, long ttlMs) {
        this.id = id;
        this.type = type;
        this.args = args;
        this.createdAt = createdAt;
        this.ttlMs = ttlMs;
    }

    public static CommandEnvelope parse(String raw) throws CommandException {
        try {
            JSONObject json = new JSONObject(raw);
            String schema = json.optString("schema", "");
            if (!"pucky.command.v1".equals(schema)) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Unsupported schema: " + schema);
            }
            String id = json.optString("id", "").trim();
            String type = json.optString("type", "").trim();
            if (id.isEmpty() || type.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Command requires id and type");
            }
            JSONObject args = json.optJSONObject("args");
            if (args == null) {
                args = new JSONObject();
            }
            return new CommandEnvelope(
                    id,
                    type,
                    args,
                    json.optString("created_at", ""),
                    json.optLong("ttl_ms", 30000));
        } catch (CommandException e) {
            throw e;
        } catch (Exception e) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, e.getMessage());
        }
    }

    public boolean expired(Instant now) {
        if (createdAt == null || createdAt.isEmpty() || ttlMs <= 0) {
            return true;
        }
        try {
            Instant created = Instant.parse(createdAt);
            return Duration.between(created, now).toMillis() > ttlMs;
        } catch (Exception ignored) {
            return true;
        }
    }

    public String id() {
        return id;
    }

    public String type() {
        return type;
    }

    public JSONObject args() {
        return args;
    }
}
