package com.pucky.device.notes;

import android.content.Context;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public final class NoteController {
    private static final String FILE_NAME = "pucky-notes.jsonl";

    private final File file;

    public NoteController(Context context) {
        this.file = new File(context.getApplicationContext().getFilesDir(), FILE_NAME);
    }

    public synchronized JSONObject create(JSONObject args) throws CommandException {
        String body = args.optString("body", args.optString("text", ""));
        String title = args.optString("title", "");
        if (title.trim().isEmpty() && body.trim().isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "note.create_local requires title or body");
        }
        JSONObject note = new JSONObject();
        Json.put(note, "id", args.optString("id", "note_" + UUID.randomUUID()));
        Json.put(note, "title", title);
        Json.put(note, "body", body);
        Json.put(note, "tags", args.optJSONArray("tags") == null ? new JSONArray() : args.optJSONArray("tags"));
        Json.put(note, "created_at", Instant.now().toString());
        Json.put(note, "deleted", false);
        append(note);

        JSONObject out = new JSONObject();
        Json.put(out, "created", true);
        Json.put(out, "note", note);
        return out;
    }

    public synchronized JSONObject list(JSONObject args) {
        int limit = Math.max(1, Math.min(200, args.optInt("limit", 50)));
        JSONArray notes = new JSONArray();
        List<JSONObject> all = activeNotes();
        int start = Math.max(0, all.size() - limit);
        for (int i = start; i < all.size(); i++) {
            Json.add(notes, all.get(i));
        }
        JSONObject out = new JSONObject();
        Json.put(out, "notes", notes);
        Json.put(out, "count", notes.length());
        return out;
    }

    public synchronized JSONObject delete(JSONObject args) throws CommandException {
        String id = args.optString("id", "");
        if (id.trim().isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "note.delete_local requires id");
        }
        JSONObject marker = new JSONObject();
        Json.put(marker, "id", id);
        Json.put(marker, "deleted", true);
        Json.put(marker, "deleted_at", Instant.now().toString());
        append(marker);
        JSONObject out = new JSONObject();
        Json.put(out, "delete_recorded", true);
        Json.put(out, "id", id);
        return out;
    }

    private void append(JSONObject note) throws CommandException {
        try (FileWriter writer = new FileWriter(file, true)) {
            writer.write(note.toString());
            writer.write("\n");
        } catch (Exception e) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, e.getMessage());
        }
    }

    private List<JSONObject> activeNotes() {
        List<JSONObject> rows = readRows();
        java.util.LinkedHashMap<String, JSONObject> byId = new java.util.LinkedHashMap<>();
        for (JSONObject row : rows) {
            String id = row.optString("id", "");
            if (id.trim().isEmpty()) {
                continue;
            }
            if (row.optBoolean("deleted", false)) {
                byId.remove(id);
            } else {
                byId.put(id, row);
            }
        }
        return new ArrayList<>(byId.values());
    }

    private List<JSONObject> readRows() {
        List<JSONObject> rows = new ArrayList<>();
        if (!file.exists()) {
            return rows;
        }
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.trim().isEmpty()) {
                    rows.add(new JSONObject(line));
                }
            }
        } catch (Exception ignored) {
        }
        return rows;
    }
}
