package com.pucky.device.artifacts;

import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import android.util.Base64;
import android.webkit.WebResourceResponse;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

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
        addFiles(artifacts, context.getExternalFilesDir(Environment.DIRECTORY_MOVIES), "video");
        addFiles(artifacts, new File(context.getFilesDir(), "pictures"), "photo");
        addFiles(artifacts, new File(context.getFilesDir(), "videos"), "video");
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

    public JSONObject url(JSONObject args) throws CommandException {
        File file = resolveAppOwnedPath(args.optString("path", ""));
        JSONObject out = describe(file, "artifact");
        Json.put(out, "schema", "pucky.artifact_url.v1");
        Json.put(out, "path", file.getAbsolutePath());
        Json.put(out, "url", webUrl(file));
        return out;
    }

    public WebResourceResponse webResponse(String path, Map<String, String> requestHeaders)
            throws CommandException {
        File file = resolveAppOwnedPath(path);
        try {
            long length = file.length();
            String range = headerValue(requestHeaders, "Range");
            Range byteRange = parseRange(range, length);
            FileInputStream input = new FileInputStream(file);
            if (byteRange.start > 0) {
                skipFully(input, byteRange.start);
            }
            InputStream body = new LimitedInputStream(input, byteRange.length);
            Map<String, String> headers = new HashMap<>();
            headers.put("Accept-Ranges", "bytes");
            headers.put("Cache-Control", "no-store");
            headers.put("Content-Length", Long.toString(byteRange.length));
            if (byteRange.partial) {
                headers.put("Content-Range", "bytes " + byteRange.start + "-" + byteRange.end + "/" + length);
                return new WebResourceResponse(guessMime(file), null, 206, "Partial Content", headers, body);
            }
            return new WebResourceResponse(guessMime(file), null, 200, "OK", headers, body);
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

    private String webUrl(File file) {
        return new Uri.Builder()
                .scheme("https")
                .authority("pucky.local")
                .path("/artifact")
                .appendQueryParameter("path", file.getAbsolutePath())
                .build()
                .toString();
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
        if (name.endsWith(".mp4")) {
            return "video/mp4";
        }
        if (name.endsWith(".m4a")) {
            return "audio/mp4";
        }
        if (name.endsWith(".pdf")) {
            return "application/pdf";
        }
        if (name.endsWith(".html") || name.endsWith(".htm")) {
            return "text/html";
        }
        if (name.endsWith(".docx")) {
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        }
        if (name.endsWith(".xlsx")) {
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        }
        if (name.endsWith(".csv")) {
            return "text/csv";
        }
        if (name.endsWith(".mp3")) {
            return "audio/mpeg";
        }
        return "application/octet-stream";
    }

    private String headerValue(Map<String, String> headers, String name) {
        if (headers == null || name == null) {
            return "";
        }
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (name.equalsIgnoreCase(entry.getKey())) {
                return entry.getValue() == null ? "" : entry.getValue();
            }
        }
        return "";
    }

    private Range parseRange(String header, long fileLength) {
        if (header == null || !header.toLowerCase(Locale.US).startsWith("bytes=") || fileLength <= 0) {
            return Range.full(fileLength);
        }
        String spec = header.substring("bytes=".length()).trim();
        int dash = spec.indexOf('-');
        if (dash < 0) {
            return Range.full(fileLength);
        }
        try {
            String startText = spec.substring(0, dash).trim();
            String endText = spec.substring(dash + 1).trim();
            long start;
            long end;
            if (startText.isEmpty()) {
                long suffixLength = Long.parseLong(endText);
                start = Math.max(0, fileLength - suffixLength);
                end = fileLength - 1;
            } else {
                start = Math.max(0, Long.parseLong(startText));
                end = endText.isEmpty() ? fileLength - 1 : Math.min(fileLength - 1, Long.parseLong(endText));
            }
            if (start > end || start >= fileLength) {
                return Range.full(fileLength);
            }
            return new Range(start, end, true);
        } catch (Exception ignored) {
            return Range.full(fileLength);
        }
    }

    private void skipFully(InputStream input, long bytes) throws IOException {
        long remaining = bytes;
        while (remaining > 0) {
            long skipped = input.skip(remaining);
            if (skipped <= 0) {
                if (input.read() == -1) {
                    break;
                }
                skipped = 1;
            }
            remaining -= skipped;
        }
    }

    private static final class Range {
        final long start;
        final long end;
        final long length;
        final boolean partial;

        Range(long start, long end, boolean partial) {
            this.start = start;
            this.end = end;
            this.length = end >= start ? this.end - this.start + 1 : 0;
            this.partial = partial;
        }

        static Range full(long fileLength) {
            return new Range(0, fileLength - 1, false);
        }
    }

    private static final class LimitedInputStream extends FilterInputStream {
        private long remaining;

        LimitedInputStream(InputStream in, long remaining) {
            super(in);
            this.remaining = remaining;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) {
                return -1;
            }
            int value = super.read();
            if (value != -1) {
                remaining -= 1;
            }
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int count) throws IOException {
            if (remaining <= 0) {
                return -1;
            }
            int read = super.read(buffer, offset, (int) Math.min(count, remaining));
            if (read > 0) {
                remaining -= read;
            }
            return read;
        }
    }
}
