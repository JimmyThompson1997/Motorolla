package com.pucky.device.artifacts;

import android.content.Context;
import android.os.Environment;
import android.util.Base64;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.security.MessageDigest;

public final class ArtifactController {
    private static final long DEFAULT_READ_MAX_BYTES = 1024L * 1024L;
    private static final long HARD_READ_MAX_BYTES = 10L * 1024L * 1024L;

    private final Context context;

    public ArtifactController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject list(JSONObject args) {
        JSONArray artifacts = new JSONArray();
        addFiles(artifacts, context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "photo");
        addFiles(artifacts, new File(context.getFilesDir(), "pictures"), "photo");
        addFiles(artifacts, new File(context.getFilesDir(), "downloads"), "download");
        addFiles(artifacts, new File(context.getFilesDir(), "voice"), "voice_capture");
        addFiles(artifacts, context.getFilesDir(), "app_file");
        JSONObject out = new JSONObject();
        Json.put(out, "artifacts", artifacts);
        Json.put(out, "count", artifacts.length());
        Json.put(out, "scope", "app_owned_files_only");
        return out;
    }

    public JSONObject hash(JSONObject args) throws CommandException {
        File file = resolveAppOwnedPath(args.optString("path", ""));
        JSONObject out = describe(file, "artifact");
        Json.put(out, "sha256", sha256(file));
        return out;
    }

    public JSONObject readBase64(JSONObject args) throws CommandException {
        File file = resolveAppOwnedPath(args.optString("path", ""));
        long maxBytes = clampReadMaxBytes(args.optLong("max_bytes", DEFAULT_READ_MAX_BYTES));
        if (file.length() > maxBytes) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Artifact exceeds max_bytes: " + file.length() + " > " + maxBytes);
        }
        try {
            byte[] data = readAll(file);
            JSONObject out = describe(file, "artifact");
            Json.put(out, "schema", "pucky.artifact_read_base64.v1");
            Json.put(out, "sha256", sha256(file));
            Json.put(out, "max_bytes", maxBytes);
            Json.put(out, "content_base64", Base64.encodeToString(data, Base64.NO_WRAP));
            return out;
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
    }

    public JSONObject delete(JSONObject args) throws CommandException {
        File file = resolveAppOwnedPath(args.optString("path", ""));
        boolean existed = file.exists();
        boolean deleted = existed && file.delete();
        JSONObject out = new JSONObject();
        Json.put(out, "path", file.getAbsolutePath());
        Json.put(out, "existed", existed);
        Json.put(out, "deleted", deleted);
        return out;
    }

    private void addFiles(JSONArray out, File dir, String kind) {
        if (dir == null || !dir.exists() || !dir.isDirectory()) {
            return;
        }
        File[] files = dir.listFiles();
        if (files == null) {
            return;
        }
        for (File file : files) {
            if (file.isFile()) {
                Json.add(out, describe(file, kind));
            } else if (file.isDirectory()) {
                if ("app_file".equals(kind) && ("downloads".equals(file.getName())
                        || "pictures".equals(file.getName())
                        || "voice".equals(file.getName()))) {
                    continue;
                }
                addFiles(out, file, kind);
            }
        }
    }

    private JSONObject describe(File file, String kind) {
        JSONObject out = new JSONObject();
        Json.put(out, "artifact_id", "art_" + Integer.toHexString(file.getAbsolutePath().hashCode()));
        Json.put(out, "kind", kind);
        Json.put(out, "device_path", file.getAbsolutePath());
        Json.put(out, "bytes", file.length());
        Json.put(out, "last_modified_ms", file.lastModified());
        Json.put(out, "mime_type", guessMime(file));
        return out;
    }

    private File resolveAppOwnedPath(String path) throws CommandException {
        if (path == null || path.trim().isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "artifact path is required");
        }
        try {
            File file = new File(path).getCanonicalFile();
            if (!isWithin(file, context.getFilesDir())
                    && !isWithin(file, context.getCacheDir())
                    && !isWithin(file, context.getExternalFilesDir(null))) {
                throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "Path is outside app-owned storage");
            }
            if (!file.exists() || !file.isFile()) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Artifact file not found");
            }
            return file;
        } catch (CommandException e) {
            throw e;
        } catch (Exception e) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, e.getMessage());
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

    private String sha256(File file) throws CommandException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            try (FileInputStream input = new FileInputStream(file)) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    digest.update(buffer, 0, read);
                }
            }
            byte[] hash = digest.digest();
            StringBuilder builder = new StringBuilder();
            for (byte value : hash) {
                builder.append(String.format("%02x", value));
            }
            return builder.toString();
        } catch (Exception e) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, e.getMessage());
        }
    }

    private byte[] readAll(File file) throws Exception {
        byte[] data = new byte[(int) file.length()];
        int offset = 0;
        try (FileInputStream input = new FileInputStream(file)) {
            while (offset < data.length) {
                int read = input.read(data, offset, data.length - offset);
                if (read < 0) {
                    break;
                }
                offset += read;
            }
        }
        if (offset != data.length) {
            byte[] truncated = new byte[offset];
            System.arraycopy(data, 0, truncated, 0, offset);
            return truncated;
        }
        return data;
    }

    private long clampReadMaxBytes(long value) {
        if (value <= 0) {
            return DEFAULT_READ_MAX_BYTES;
        }
        return Math.min(value, HARD_READ_MAX_BYTES);
    }

    private String guessMime(File file) {
        String name = file.getName().toLowerCase();
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) {
            return "image/jpeg";
        }
        if (name.endsWith(".png")) {
            return "image/png";
        }
        if (name.endsWith(".json") || name.endsWith(".jsonl")) {
            return "application/json";
        }
        if (name.endsWith(".txt") || name.endsWith(".log")) {
            return "text/plain";
        }
        if (name.endsWith(".m4a") || name.endsWith(".mp4")) {
            return "audio/mp4";
        }
        if (name.endsWith(".mp3")) {
            return "audio/mpeg";
        }
        return "application/octet-stream";
    }
}
