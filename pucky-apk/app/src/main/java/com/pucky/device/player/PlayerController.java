package com.pucky.device.player;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.MediaPlayer;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.files.FileDownloadController;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.time.Instant;

public final class PlayerController {
    private static final String PREFS = "pucky_player";
    private static final String BOOKMARKS = "bookmarks_json";
    private static PlayerController shared;

    private final Context context;
    private MediaPlayer player;
    private File currentFile;
    private String currentTitle = "";
    private String currentSource = "";
    private String playbackState = "idle";
    private JSONArray queue = new JSONArray();
    private int queueIndex = -1;

    public PlayerController(Context context) {
        this.context = context.getApplicationContext();
    }

    public static synchronized PlayerController shared(Context context) {
        if (shared == null) {
            shared = new PlayerController(context.getApplicationContext());
        }
        return shared;
    }

    public synchronized JSONObject assetPrepare(JSONObject args) throws CommandException {
        JSONObject download = new FileDownloadController(context).download(args);
        JSONObject out = download;
        Json.put(out, "schema", "pucky.player_asset_prepare.v1");
        Json.put(out, "prepared_for_player", true);
        return out;
    }

    public synchronized JSONObject load(JSONObject args) throws CommandException {
        File file = resolveAppOwnedPath(pathFromArgs(args));
        String title = args.optString("title", file.getName());
        String source = args.optString("source", "");
        loadFile(file, title, source);
        return state();
    }

    public synchronized JSONObject play(JSONObject args) throws CommandException {
        if (args.has("path") || args.has("device_path") || args.has("artifact_path")) {
            load(args);
        }
        requireLoaded();
        int startAtMs = args.optInt("start_at_ms", -1);
        if (startAtMs >= 0) {
            seekTo(startAtMs);
        }
        try {
            player.start();
            playbackState = "playing";
            return state();
        } catch (IllegalStateException exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to start playback: " + exc.getMessage());
        }
    }

    public synchronized JSONObject pause(JSONObject args) throws CommandException {
        requireLoaded();
        try {
            if (player.isPlaying()) {
                player.pause();
            }
            playbackState = "paused";
            return state();
        } catch (IllegalStateException exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to pause playback: " + exc.getMessage());
        }
    }

    public synchronized JSONObject stop(JSONObject args) throws CommandException {
        requireLoaded();
        try {
            if (player.isPlaying()) {
                player.pause();
            }
            seekTo(0);
            playbackState = "stopped";
            return state();
        } catch (IllegalStateException exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to stop playback: " + exc.getMessage());
        }
    }

    public synchronized JSONObject seek(JSONObject args) throws CommandException {
        requireLoaded();
        seekTo(args.optInt("position_ms", args.optInt("position", 0)));
        return state();
    }

    public synchronized JSONObject state() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.player_state.v1");
        Json.put(out, "available", true);
        Json.put(out, "loaded", player != null && currentFile != null);
        Json.put(out, "state", playbackState);
        Json.put(out, "title", currentTitle);
        Json.put(out, "source", currentSource.isEmpty() ? JSONObject.NULL : currentSource);
        Json.put(out, "path", currentFile == null ? JSONObject.NULL : currentFile.getAbsolutePath());
        Json.put(out, "filename", currentFile == null ? JSONObject.NULL : currentFile.getName());
        Json.put(out, "queue_index", queueIndex);
        Json.put(out, "queue_count", queue.length());
        if (player == null) {
            Json.put(out, "is_playing", false);
            Json.put(out, "position_ms", 0);
            Json.put(out, "duration_ms", 0);
            Json.put(out, "can_seek", false);
            return out;
        }
        try {
            Json.put(out, "is_playing", player.isPlaying());
            Json.put(out, "position_ms", player.getCurrentPosition());
            Json.put(out, "duration_ms", player.getDuration());
            Json.put(out, "can_seek", true);
        } catch (IllegalStateException exc) {
            Json.put(out, "is_playing", false);
            Json.put(out, "position_ms", 0);
            Json.put(out, "duration_ms", 0);
            Json.put(out, "can_seek", false);
            Json.put(out, "state_error", exc.getMessage());
        }
        return out;
    }

    public synchronized JSONObject queueSet(JSONObject args) throws CommandException {
        JSONArray items = args.optJSONArray("items");
        if (items == null || items.length() == 0) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "player.queue.set requires non-empty items");
        }
        queue = new JSONArray();
        for (int index = 0; index < items.length(); index++) {
            JSONObject item = normalizeQueueItem(items.opt(index));
            resolveAppOwnedPath(pathFromArgs(item));
            Json.add(queue, item);
        }
        queueIndex = Math.max(0, Math.min(args.optInt("index", 0), queue.length() - 1));
        if (args.optBoolean("load", true)) {
            loadQueueIndex(queueIndex);
        }
        JSONObject out = state();
        Json.put(out, "queue", queue);
        return out;
    }

    public synchronized JSONObject queueNext(JSONObject args) throws CommandException {
        if (queue.length() == 0) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Player queue is empty");
        }
        queueIndex = Math.min(queue.length() - 1, queueIndex + 1);
        loadQueueIndex(queueIndex);
        if (args.optBoolean("play", false)) {
            return play(new JSONObject());
        }
        return state();
    }

    public synchronized JSONObject queuePrevious(JSONObject args) throws CommandException {
        if (queue.length() == 0) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Player queue is empty");
        }
        queueIndex = Math.max(0, queueIndex - 1);
        loadQueueIndex(queueIndex);
        if (args.optBoolean("play", false)) {
            return play(new JSONObject());
        }
        return state();
    }

    public synchronized JSONObject bookmarkSave(JSONObject args) throws CommandException {
        requireLoaded();
        JSONObject bookmark = new JSONObject();
        String id = args.optString("id", "bm_" + Long.toHexString(System.currentTimeMillis()));
        Json.put(bookmark, "id", id);
        Json.put(bookmark, "created_at", Instant.now().toString());
        Json.put(bookmark, "path", currentFile.getAbsolutePath());
        Json.put(bookmark, "filename", currentFile.getName());
        Json.put(bookmark, "title", currentTitle);
        Json.put(bookmark, "source", currentSource.isEmpty() ? JSONObject.NULL : currentSource);
        Json.put(bookmark, "position_ms", args.has("position_ms") ? args.optInt("position_ms") : safePosition());
        Json.put(bookmark, "duration_ms", safeDuration());
        Json.put(bookmark, "note", args.optString("note", ""));

        JSONArray bookmarks = readBookmarks();
        Json.add(bookmarks, bookmark);
        prefs().edit().putString(BOOKMARKS, bookmarks.toString()).apply();

        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.player_bookmark.v1");
        Json.put(out, "bookmark", bookmark);
        Json.put(out, "count", bookmarks.length());
        return out;
    }

    public synchronized JSONObject bookmarkList(JSONObject args) {
        JSONArray bookmarks = readBookmarks();
        int limit = Math.max(1, Math.min(100, args.optInt("limit", 50)));
        JSONArray sliced = new JSONArray();
        int start = Math.max(0, bookmarks.length() - limit);
        for (int index = start; index < bookmarks.length(); index++) {
            Json.add(sliced, bookmarks.opt(index));
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.player_bookmarks.v1");
        Json.put(out, "bookmarks", sliced);
        Json.put(out, "count", sliced.length());
        Json.put(out, "total_count", bookmarks.length());
        return out;
    }

    private void loadQueueIndex(int index) throws CommandException {
        JSONObject item = queue.optJSONObject(index);
        if (item == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Queue item is not an object");
        }
        loadFile(resolveAppOwnedPath(pathFromArgs(item)), item.optString("title", ""), item.optString("source", ""));
    }

    private void loadFile(File file, String title, String source) throws CommandException {
        releasePlayer();
        try {
            MediaPlayer next = new MediaPlayer();
            next.setAudioAttributes(new AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .build());
            next.setDataSource(file.getAbsolutePath());
            next.setOnCompletionListener(mp -> playbackState = "completed");
            next.prepare();
            player = next;
            currentFile = file;
            currentTitle = title == null || title.trim().isEmpty() ? file.getName() : title.trim();
            currentSource = source == null ? "" : source.trim();
            playbackState = "loaded";
        } catch (Exception exc) {
            releasePlayer();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to load media: " + exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
    }

    private JSONObject normalizeQueueItem(Object raw) throws CommandException {
        if (raw instanceof JSONObject) {
            return (JSONObject) raw;
        }
        if (raw instanceof String) {
            JSONObject item = new JSONObject();
            Json.put(item, "path", raw);
            return item;
        }
        throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Queue items must be paths or objects");
    }

    private void requireLoaded() throws CommandException {
        if (player == null || currentFile == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No player asset is loaded");
        }
    }

    private void seekTo(int positionMs) throws CommandException {
        try {
            int bounded = Math.max(0, positionMs);
            int duration = player.getDuration();
            if (duration > 0) {
                bounded = Math.min(bounded, duration);
            }
            player.seekTo(bounded);
        } catch (IllegalStateException exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to seek: " + exc.getMessage());
        }
    }

    private int safePosition() {
        try {
            return player == null ? 0 : player.getCurrentPosition();
        } catch (IllegalStateException ignored) {
            return 0;
        }
    }

    private int safeDuration() {
        try {
            return player == null ? 0 : player.getDuration();
        } catch (IllegalStateException ignored) {
            return 0;
        }
    }

    private void releasePlayer() {
        if (player != null) {
            try {
                player.release();
            } catch (RuntimeException ignored) {
                // Release is best-effort during command replacement.
            }
        }
        player = null;
        currentFile = null;
        currentTitle = "";
        currentSource = "";
        playbackState = "idle";
    }

    private String pathFromArgs(JSONObject args) throws CommandException {
        String path = args.optString("path", "").trim();
        if (path.isEmpty()) {
            path = args.optString("device_path", "").trim();
        }
        if (path.isEmpty()) {
            path = args.optString("artifact_path", "").trim();
        }
        if (path.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "player command requires path, device_path, or artifact_path");
        }
        return path;
    }

    private File resolveAppOwnedPath(String path) throws CommandException {
        try {
            File file = new File(path).getCanonicalFile();
            if (!isWithin(file, context.getFilesDir())
                    && !isWithin(file, context.getCacheDir())
                    && !isWithin(file, context.getExternalFilesDir(null))) {
                throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "Path is outside app-owned storage");
            }
            if (!file.exists() || !file.isFile()) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Player asset file not found");
            }
            return file;
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, exc.getMessage());
        }
    }

    private boolean isWithin(File file, File root) throws Exception {
        if (root == null) {
            return false;
        }
        String filePath = file.getCanonicalPath();
        String rootPath = root.getCanonicalPath();
        return filePath.equals(rootPath) || filePath.startsWith(rootPath + File.separator);
    }

    private JSONArray readBookmarks() {
        String raw = prefs().getString(BOOKMARKS, "[]");
        try {
            return new JSONArray(raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
