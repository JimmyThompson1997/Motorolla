package com.pucky.device.storage;

import com.pucky.device.util.Json;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class CommandLogStore {
    private static final String FILE_NAME = "pucky-command-log.jsonl";
    private static final int MAX_LINES = 2000;

    private final File file;

    public CommandLogStore(Context context) {
        file = new File(context.getFilesDir(), FILE_NAME);
    }

    public synchronized void append(String commandId, String type, String status, JSONObject body) {
        JSONObject entry = new JSONObject();
        Json.put(entry, "timestamp", Instant.now().toString());
        Json.put(entry, "command_id", commandId == null ? JSONObject.NULL : commandId);
        Json.put(entry, "type", type == null ? JSONObject.NULL : type);
        Json.put(entry, "status", status);
        Json.put(entry, "body", body == null ? new JSONObject() : body);
        try (FileWriter writer = new FileWriter(file, true)) {
            writer.write(entry.toString());
            writer.write("\n");
        } catch (IOException ignored) {
            // Logging must never crash command execution.
        }
        trimIfNeeded();
    }

    public synchronized JSONArray tailJson(int limit) {
        List<String> lines = readAllLines();
        JSONArray out = new JSONArray();
        int start = Math.max(0, lines.size() - Math.max(1, limit));
        for (int i = start; i < lines.size(); i++) {
            try {
                Json.add(out, new JSONObject(lines.get(i)));
            } catch (Exception ignored) {
                JSONObject bad = new JSONObject();
                Json.put(bad, "status", "LOG_PARSE_ERROR");
                Json.put(bad, "raw", lines.get(i));
                Json.add(out, bad);
            }
        }
        return out;
    }

    private void trimIfNeeded() {
        List<String> lines = readAllLines();
        if (lines.size() <= MAX_LINES) {
            return;
        }
        int start = lines.size() - MAX_LINES;
        try (FileWriter writer = new FileWriter(file, false)) {
            for (int i = start; i < lines.size(); i++) {
                writer.write(lines.get(i));
                writer.write("\n");
            }
        } catch (IOException ignored) {
        }
    }

    private List<String> readAllLines() {
        List<String> lines = new ArrayList<>();
        if (!file.exists()) {
            return lines;
        }
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.trim().isEmpty()) {
                    lines.add(line);
                }
            }
        } catch (IOException ignored) {
        }
        return lines;
    }
}

