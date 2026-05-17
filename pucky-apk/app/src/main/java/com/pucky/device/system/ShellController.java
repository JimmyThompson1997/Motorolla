package com.pucky.device.system;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

public final class ShellController {
    private static final long DEFAULT_TIMEOUT_MS = 10000L;
    private static final long MAX_TIMEOUT_MS = 120000L;
    private static final int MAX_OUTPUT_BYTES = 256 * 1024;

    public JSONObject exec(JSONObject args) throws CommandException {
        String command = args.optString("command", "").trim();
        if (command.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "shell.exec requires args.command");
        }
        long timeoutMs = Math.max(1000L, Math.min(MAX_TIMEOUT_MS, args.optLong("timeout_ms", DEFAULT_TIMEOUT_MS)));
        long started = System.currentTimeMillis();
        Process process = null;
        try {
            ProcessBuilder builder = new ProcessBuilder("/system/bin/sh", "-c", command);
            builder.redirectErrorStream(true);
            process = builder.start();
            Process startedProcess = process;
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            Thread reader = new Thread(() -> readBounded(startedProcess.getInputStream(), output), "pucky-shell-reader");
            reader.start();
            boolean finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
            if (!finished) {
                process.destroyForcibly();
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "shell.exec timed out after " + timeoutMs + "ms");
            }
            reader.join(500L);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.shell_exec.v1");
            Json.put(out, "command", command);
            Json.put(out, "exit_code", process.exitValue());
            Json.put(out, "duration_ms", System.currentTimeMillis() - started);
            Json.put(out, "output", output.toString(StandardCharsets.UTF_8.name()));
            Json.put(out, "output_truncated", output.size() >= MAX_OUTPUT_BYTES);
            return out;
        } catch (CommandException e) {
            throw e;
        } catch (Exception e) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, e.getMessage());
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    private static void readBounded(InputStream input, ByteArrayOutputStream output) {
        byte[] buffer = new byte[4096];
        try {
            int read;
            while ((read = input.read(buffer)) != -1) {
                int remaining = MAX_OUTPUT_BYTES - output.size();
                if (remaining <= 0) {
                    continue;
                }
                output.write(buffer, 0, Math.min(read, remaining));
            }
        } catch (Exception ignored) {
        }
    }
}
