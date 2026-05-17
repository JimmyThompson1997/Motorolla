package com.pucky.device.files;

import android.content.Context;
import android.webkit.MimeTypeMap;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.Locale;

import android.util.Base64;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

public final class FileDownloadController {
    private static final long DEFAULT_MAX_BYTES = 10L * 1024L * 1024L;
    private static final long HARD_MAX_BYTES = 100L * 1024L * 1024L;
    private static final long DEFAULT_PUT_MAX_BYTES = 5L * 1024L * 1024L;
    private static final long HARD_PUT_MAX_BYTES = 25L * 1024L * 1024L;

    private final Context context;
    private final OkHttpClient client;

    public FileDownloadController(Context context) {
        this.context = context.getApplicationContext();
        this.client = new OkHttpClient.Builder().build();
    }

    public JSONObject download(JSONObject args) throws CommandException {
        String url = args.optString("url", args.optString("uri", "")).trim();
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "file.download requires http or https url");
        }
        long maxBytes = clampMaxBytes(args.optLong("max_bytes", DEFAULT_MAX_BYTES));
        File dir = new File(context.getFilesDir(), "downloads");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to create downloads directory");
        }
        String filename = safeFilename(args.optString("filename", filenameFromUrl(url)));
        File output = uniqueFile(dir, filename);

        Request request = new Request.Builder()
                .url(url)
                .header("User-Agent", "PuckyAPK/0.2")
                .build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "Download failed with HTTP " + response.code());
            }
            ResponseBody body = response.body();
            if (body == null) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Download response body was empty");
            }
            long contentLength = body.contentLength();
            if (contentLength > maxBytes) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "Download exceeds max_bytes: " + contentLength + " > " + maxBytes);
            }
            byte[] buffer = new byte[8192];
            long written = 0;
            try (FileOutputStream out = new FileOutputStream(output)) {
                java.io.InputStream input = body.byteStream();
                int read;
                while ((read = input.read(buffer)) != -1) {
                    written += read;
                    if (written > maxBytes) {
                        out.close();
                        //noinspection ResultOfMethodCallIgnored
                        output.delete();
                        throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                                "Download exceeded max_bytes while streaming");
                    }
                    out.write(buffer, 0, read);
                }
            }
            JSONObject result = describe(output);
            Json.put(result, "schema", "pucky.file_download.v1");
            Json.put(result, "url", url);
            Json.put(result, "http_status", response.code());
            Json.put(result, "content_length", contentLength);
            Json.put(result, "max_bytes", maxBytes);
            Json.put(result, "app_owned", true);
            return result;
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            //noinspection ResultOfMethodCallIgnored
            output.delete();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
    }

    public JSONObject putBase64(JSONObject args) throws CommandException {
        String encoded = args.optString("content_base64", args.optString("base64", "")).trim();
        if (encoded.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "file.put_base64 requires content_base64");
        }
        String filename = safeFilename(args.optString("filename", "upload.bin"));
        long maxBytes = clampPutMaxBytes(args.optLong("max_bytes", DEFAULT_PUT_MAX_BYTES));
        File dir = new File(context.getFilesDir(), "downloads");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to create downloads directory");
        }
        File output = uniqueFile(dir, filename);
        byte[] decoded;
        try {
            decoded = Base64.decode(encoded, Base64.DEFAULT);
        } catch (IllegalArgumentException exc) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "content_base64 is not valid base64");
        }
        if (decoded.length > maxBytes) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Decoded file exceeds max_bytes: " + decoded.length + " > " + maxBytes);
        }
        try (FileOutputStream out = new FileOutputStream(output)) {
            out.write(decoded);
            JSONObject result = describe(output);
            Json.put(result, "schema", "pucky.file_put_base64.v1");
            Json.put(result, "max_bytes", maxBytes);
            Json.put(result, "app_owned", true);
            return result;
        } catch (Exception exc) {
            //noinspection ResultOfMethodCallIgnored
            output.delete();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
    }

    private long clampMaxBytes(long value) {
        if (value <= 0) {
            return DEFAULT_MAX_BYTES;
        }
        return Math.min(value, HARD_MAX_BYTES);
    }

    private long clampPutMaxBytes(long value) {
        if (value <= 0) {
            return DEFAULT_PUT_MAX_BYTES;
        }
        return Math.min(value, HARD_PUT_MAX_BYTES);
    }

    private JSONObject describe(File file) throws Exception {
        JSONObject out = new JSONObject();
        Json.put(out, "artifact_id", "art_" + Integer.toHexString(file.getAbsolutePath().hashCode()));
        Json.put(out, "kind", "download");
        Json.put(out, "path", file.getAbsolutePath());
        Json.put(out, "device_path", file.getAbsolutePath());
        Json.put(out, "filename", file.getName());
        Json.put(out, "bytes", file.length());
        Json.put(out, "last_modified_ms", file.lastModified());
        Json.put(out, "mime_type", guessMime(file));
        Json.put(out, "sha256", sha256(file));
        return out;
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[8192];
        try (FileInputStream input = new FileInputStream(file)) {
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder out = new StringBuilder();
        for (byte bit : digest.digest()) {
            out.append(String.format(Locale.US, "%02x", bit));
        }
        return out.toString();
    }

    private String guessMime(File file) {
        String name = file.getName();
        int dot = name.lastIndexOf('.');
        if (dot <= 0 || dot == name.length() - 1) {
            return "application/octet-stream";
        }
        String extension = name.substring(dot + 1).toLowerCase(Locale.US);
        String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return type == null ? "application/octet-stream" : type;
    }

    private String filenameFromUrl(String url) {
        int query = url.indexOf('?');
        String clean = query >= 0 ? url.substring(0, query) : url;
        int slash = clean.lastIndexOf('/');
        String name = slash >= 0 ? clean.substring(slash + 1) : clean;
        return name.trim().isEmpty() ? "download.bin" : name;
    }

    private String safeFilename(String raw) {
        String name = raw == null || raw.trim().isEmpty() ? "download.bin" : raw.trim();
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (name.equals(".") || name.equals("..")) {
            return "download.bin";
        }
        return name.length() > 80 ? name.substring(0, 80) : name;
    }

    private File uniqueFile(File dir, String name) {
        File first = new File(dir, name);
        if (!first.exists()) {
            return first;
        }
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; i < 1000; i++) {
            File candidate = new File(dir, base + "-" + i + ext);
            if (!candidate.exists()) {
                return candidate;
            }
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }
}
