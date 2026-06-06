package com.pucky.device.media;

import android.content.Context;
import android.webkit.MimeTypeMap;

import com.pucky.device.artifacts.ArtifactController;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.net.Ipv4FirstDns;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.URI;
import java.security.MessageDigest;
import java.util.Locale;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

public final class MediaCacheController {
    private static final long DEFAULT_MAX_BYTES = 96L * 1024L * 1024L;
    private static final long HARD_MAX_BYTES = 512L * 1024L * 1024L;

    private final Context context;
    private final SettingsStore settings;
    private final OkHttpClient client;

    public MediaCacheController(Context context, SettingsStore settings) {
        this.context = context.getApplicationContext();
        this.settings = settings;
        this.client = new OkHttpClient.Builder()
                .dns(Ipv4FirstDns.INSTANCE)
                .build();
    }

    public JSONObject status(JSONObject args) throws CommandException {
        JSONArray items = args.optJSONArray("items");
        if (items != null) {
            JSONArray statuses = new JSONArray();
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.optJSONObject(i);
                if (item != null) {
                    Json.add(statuses, statusOne(item));
                }
            }
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.media_cache_status.v1");
            Json.put(out, "items", statuses);
            Json.put(out, "count", statuses.length());
            return out;
        }
        return statusOne(args);
    }

    public JSONObject ensure(JSONObject args) throws CommandException {
        String mediaId = requireMediaId(args);
        String url = args.optString("url", "").trim();
        if (url.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "media.cache.ensure requires url");
        }
        String expectedSha = args.optString("sha256", "").trim().toLowerCase(Locale.US);
        String mimeType = args.optString("mime_type", "application/octet-stream").trim();
        File target = cacheFileFor(mediaId, mimeType, url);
        JSONObject before = describe(mediaId, target, expectedSha, false);
        if (before.optBoolean("cache_hit", false)) {
            Json.put(before, "schema", "pucky.media_cache_ensure.v1");
            Json.put(before, "source", "cache");
            Json.put(before, "downloaded", false);
            return before;
        }

        long maxBytes = clampMaxBytes(args.optLong("max_bytes", DEFAULT_MAX_BYTES));
        File dir = target.getParentFile();
        if (dir == null || (!dir.exists() && !dir.mkdirs())) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to create media cache directory");
        }
        File temp = new File(dir, target.getName() + ".tmp");
        String token = settings.getPuckyApiToken().trim();
        Request.Builder builder = new Request.Builder()
                .url(url)
                .header("User-Agent", "PuckyAPK/0.2 media-cache");
        boolean attachAuth = shouldAttachAuthorization(url) && !token.isEmpty();
        if (attachAuth) {
            builder.header("Authorization", "Bearer " + token);
        }
        try (Response response = client.newCall(builder.build()).execute()) {
            if (!response.isSuccessful()) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "Media cache download failed with HTTP " + response.code());
            }
            ResponseBody body = response.body();
            if (body == null) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Media cache response body was empty");
            }
            long contentLength = body.contentLength();
            if (contentLength > maxBytes) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "Media cache item exceeds max_bytes: " + contentLength + " > " + maxBytes);
            }
            long written = 0;
            byte[] buffer = new byte[8192];
            try (FileOutputStream output = new FileOutputStream(temp)) {
                java.io.InputStream input = body.byteStream();
                int read;
                while ((read = input.read(buffer)) != -1) {
                    written += read;
                    if (written > maxBytes) {
                        throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                                "Media cache download exceeded max_bytes while streaming");
                    }
                    output.write(buffer, 0, read);
                }
            }
            if (!expectedSha.isEmpty()) {
                String actualSha = sha256(temp);
                if (!expectedSha.equals(actualSha)) {
                    //noinspection ResultOfMethodCallIgnored
                    temp.delete();
                    throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                            "Media cache sha256 mismatch: " + actualSha);
                }
            }
            if (target.exists() && !target.delete()) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to replace stale media cache item");
            }
            if (!temp.renameTo(target)) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to commit media cache item");
            }
            JSONObject out = describe(mediaId, target, expectedSha, true);
            Json.put(out, "schema", "pucky.media_cache_ensure.v1");
            Json.put(out, "source", "download");
            Json.put(out, "downloaded", true);
            Json.put(out, "http_status", response.code());
            Json.put(out, "authorization_attached", attachAuth);
            return out;
        } catch (CommandException exc) {
            //noinspection ResultOfMethodCallIgnored
            temp.delete();
            throw exc;
        } catch (Exception exc) {
            //noinspection ResultOfMethodCallIgnored
            temp.delete();
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
    }

    private JSONObject statusOne(JSONObject args) throws CommandException {
        String mediaId = requireMediaId(args);
        String mimeType = args.optString("mime_type", "application/octet-stream").trim();
        String url = args.optString("url", "").trim();
        String expectedSha = args.optString("sha256", "").trim().toLowerCase(Locale.US);
        return describe(mediaId, cacheFileFor(mediaId, mimeType, url), expectedSha, false);
    }

    private JSONObject describe(String mediaId, File file, String expectedSha, boolean checkedAfterWrite)
            throws CommandException {
        boolean exists = file.exists() && file.isFile();
        String actualSha = exists ? sha256(file) : "";
        boolean shaMatch = expectedSha == null || expectedSha.isEmpty() || expectedSha.equals(actualSha);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.media_cache_status.v1");
        Json.put(out, "media_id", mediaId);
        Json.put(out, "device_path", file.getAbsolutePath());
        Json.put(out, "exists", exists);
        Json.put(out, "bytes", exists ? file.length() : 0);
        Json.put(out, "sha256", actualSha);
        Json.put(out, "expected_sha256", expectedSha == null ? "" : expectedSha);
        Json.put(out, "sha_match", shaMatch);
        Json.put(out, "cache_hit", exists && shaMatch);
        Json.put(out, "checked_after_write", checkedAfterWrite);
        if (exists && shaMatch) {
            JSONObject artifactArgs = new JSONObject();
            Json.put(artifactArgs, "path", file.getAbsolutePath());
            JSONObject artifact = new ArtifactController(context).url(artifactArgs);
            Json.put(out, "url", artifact.optString("url", ""));
        }
        return out;
    }

    private File cacheFileFor(String mediaId, String mimeType, String url) {
        String extension = extensionFor(mimeType, url);
        String safe = safeFilename(mediaId);
        return new File(new File(context.getFilesDir(), "media_cache"), safe + extension);
    }

    private static String requireMediaId(JSONObject args) throws CommandException {
        String mediaId = args.optString("media_id", "").trim();
        if (mediaId.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "media.cache command requires media_id");
        }
        return mediaId;
    }

    private static boolean shouldAttachAuthorization(String url) {
        try {
            URI uri = URI.create(String.valueOf(url == null ? "" : url).trim());
            String host = String.valueOf(uri.getHost() == null ? "" : uri.getHost()).toLowerCase(Locale.US);
            return "pucky.fly.dev".equals(host)
                    || "127.0.0.1".equals(host)
                    || "localhost".equals(host)
                    || "10.0.2.2".equals(host);
        } catch (Exception exc) {
            return false;
        }
    }

    private static String safeFilename(String raw) {
        String safe = String.valueOf(raw == null ? "" : raw).trim().replaceAll("[^A-Za-z0-9._-]", "_");
        if (safe.isEmpty() || ".".equals(safe) || "..".equals(safe)) {
            return "media";
        }
        return safe.length() > 96 ? safe.substring(0, 96) : safe;
    }

    private static String extensionFor(String mimeType, String url) {
        String fromUrl = extensionFromName(url);
        if (!fromUrl.isEmpty()) {
            return fromUrl;
        }
        String cleanMime = String.valueOf(mimeType == null ? "" : mimeType).trim().toLowerCase(Locale.US);
        String extension = MimeTypeMap.getSingleton().getExtensionFromMimeType(cleanMime);
        if (extension != null && !extension.trim().isEmpty()) {
            return "." + extension;
        }
        if (cleanMime.equals("audio/mp4")) {
            return ".m4a";
        }
        if (cleanMime.equals("audio/wav") || cleanMime.equals("audio/x-wav")) {
            return ".wav";
        }
        if (cleanMime.equals("audio/mpeg")) {
            return ".mp3";
        }
        return ".bin";
    }

    private static String extensionFromName(String raw) {
        String clean = String.valueOf(raw == null ? "" : raw);
        int query = clean.indexOf('?');
        if (query >= 0) {
            clean = clean.substring(0, query);
        }
        int slash = clean.lastIndexOf('/');
        String name = slash >= 0 ? clean.substring(slash + 1) : clean;
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) {
            return "";
        }
        String ext = name.substring(dot).toLowerCase(Locale.US).replaceAll("[^a-z0-9.]", "");
        return ext.length() > 12 ? "" : ext;
    }

    private long clampMaxBytes(long value) {
        if (value <= 0) {
            return DEFAULT_MAX_BYTES;
        }
        return Math.min(value, HARD_MAX_BYTES);
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
            StringBuilder out = new StringBuilder();
            for (byte bit : digest.digest()) {
                out.append(String.format(Locale.US, "%02x", bit));
            }
            return out.toString();
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, exc.getMessage());
        }
    }
}
