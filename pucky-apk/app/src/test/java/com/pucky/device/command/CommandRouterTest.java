package com.pucky.device.command;

import com.pucky.device.util.Json;

import org.json.JSONObject;
import org.junit.Test;

import java.time.Instant;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

public final class CommandRouterTest {
    @Test
    public void pingCompletes() throws Exception {
        CommandRouter router = new CommandRouter(command -> {
            JSONObject out = new JSONObject();
            Json.put(out, "ok", true);
            return out;
        });

        CommandHandlingResult result = router.handle(command("cmd_1", "ping", 30000));

        assertEquals("cmd_1", result.commandId());
        assertEquals("completed", result.status());
        assertEquals("accepted", result.ack().getString("status"));
        assertEquals("completed", result.result().getString("status"));
        assertEquals(true, result.result().getJSONObject("result").getBoolean("ok"));
    }

    @Test
    public void malformedCommandRejects() throws Exception {
        CommandRouter router = new CommandRouter(command -> new JSONObject());

        CommandHandlingResult result = router.handle("{ bad json");

        assertEquals("rejected", result.status());
        assertEquals("MALFORMED_COMMAND", result.ack().getJSONObject("error").getString("code"));
    }

    @Test
    public void expiredCommandRejects() throws Exception {
        CommandRouter router = new CommandRouter(command -> new JSONObject());

        CommandHandlingResult result = router.handle(command(
                "cmd_old",
                "ping",
                1,
                Instant.now().minusSeconds(60).toString()));

        assertEquals("rejected", result.status());
        assertEquals("COMMAND_EXPIRED", result.ack().getJSONObject("error").getString("code"));
    }

    @Test
    public void executorErrorBecomesFailedResult() throws Exception {
        CommandRouter router = new CommandRouter(command -> {
            throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED, "no");
        });

        CommandHandlingResult result = router.handle(command("cmd_no", "torch.set", 30000));

        assertEquals("failed", result.status());
        assertEquals("accepted", result.ack().getString("status"));
        assertEquals("COMMAND_NOT_ALLOWED", result.result().getJSONObject("error").getString("code"));
    }

    @Test
    public void commandEnvelopeParsesArgs() throws Exception {
        CommandEnvelope envelope = CommandEnvelope.parse(command("cmd_args", "status.get", 30000));
        assertEquals("cmd_args", envelope.id());
        assertEquals("status.get", envelope.type());
        assertNotNull(envelope.args());
    }

    private static String command(String id, String type, long ttlMs) {
        return command(id, type, ttlMs, Instant.now().toString());
    }

    private static String command(String id, String type, long ttlMs, String createdAt) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.command.v1");
        Json.put(out, "id", id);
        Json.put(out, "type", type);
        Json.put(out, "args", new JSONObject());
        Json.put(out, "created_at", createdAt);
        Json.put(out, "ttl_ms", ttlMs);
        return out.toString();
    }
}

