package com.pucky.device.ui;

import android.content.Context;
import android.net.Uri;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.files.FileDownloadController;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public final class UiBundleController {
    public static final int NATIVE_BRIDGE_VERSION = 1;
    private static final String DIR = "ui_bundles";
    private static final String CURRENT = "current";
    private static final String PREVIOUS = "previous";
    private static final String MANIFEST = "manifest.json";
    private static final String FALLBACK_ASSET_URL = "file:///android_asset/pucky_fallback/index.html";

    private final Context context;

    public UiBundleController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject status() {
        File current = currentDir();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.ui_bundle_status.v1");
        Json.put(out, "native_bridge_version", NATIVE_BRIDGE_VERSION);
        Json.put(out, "installed", isInstalled());
        Json.put(out, "entrypoint_url", entrypointUrl());
        Json.put(out, "fallback_asset_url", FALLBACK_ASSET_URL);
        if (isInstalled()) {
            try {
                JSONObject manifest = readManifest(current);
                Json.put(out, "ui_version", manifest.optString("ui_version", ""));
                Json.put(out, "created_at", manifest.optString("created_at", ""));
                Json.put(out, "entrypoint", manifest.optString("entrypoint", "index.html"));
                Json.put(out, "bundle_dir", current.getAbsolutePath());
                Json.put(out, "source_commit_full", manifest.optString("source_commit_full", ""));
                Json.put(out, "source_commit_short", manifest.optString("source_commit_short", ""));
                Json.put(out, "source_branch", manifest.optString("source_branch", ""));
                Json.put(out, "source_dirty", manifest.optBoolean("source_dirty", true));
            } catch (Exception exc) {
                Json.put(out, "manifest_error", exc.getMessage());
            }
        }
        return out;
    }

    public JSONObject refresh(JSONObject args) throws CommandException {
        String url = args.optString("url", "").trim();
        if (url.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "ui.bundle.refresh requires url");
        }
        JSONObject downloadArgs = new JSONObject();
        Json.put(downloadArgs, "url", url);
        Json.put(downloadArgs, "filename", args.optString("filename", "pucky-ui-bundle.zip"));
        Json.put(downloadArgs, "max_bytes", args.optLong("max_bytes", 10L * 1024L * 1024L));
        JSONObject download = new FileDownloadController(context).download(downloadArgs);
        JSONObject installArgs = new JSONObject();
        Json.put(installArgs, "path", download.optString("path", download.optString("device_path", "")));
        if (args.has("expected_sha256")) {
            Json.put(installArgs, "expected_sha256", args.optString("expected_sha256"));
        }
        JSONObject installed = installDownloaded(installArgs);
        Json.put(installed, "download", download);
        return installed;
    }

    public JSONObject installDownloaded(JSONObject args) throws CommandException {
        File zip = resolveAppOwnedPath(args.optString("path", args.optString("device_path", args.optString("artifact_path", ""))));
        String expectedSha = args.optString("expected_sha256", "").trim().toLowerCase(Locale.US);
        if (!expectedSha.isEmpty()) {
            String actualSha = sha256(zip);
            if (!expectedSha.equals(actualSha)) {
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "UI bundle sha256 mismatch: " + actualSha);
            }
        }
        File root = rootDir();
        if (!root.exists() && !root.mkdirs()) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to create UI bundle root");
        }
        File staging = new File(root, "staging-" + System.currentTimeMillis());
        unzip(zip, staging);
        try {
            JSONObject manifest = validateBundle(staging);
            promote(staging);
            JSONObject out = status();
            Json.put(out, "schema", "pucky.ui_bundle_install.v1");
            Json.put(out, "installed", true);
            Json.put(out, "source_path", zip.getAbsolutePath());
            Json.put(out, "ui_version", manifest.optString("ui_version", ""));
            return out;
        } catch (CommandException exc) {
            deleteRecursive(staging);
            throw exc;
        }
    }

    public boolean isInstalled() {
        File entrypoint = entrypointFile();
        return entrypoint != null && entrypoint.exists() && entrypoint.isFile();
    }

    public String entrypointUrl() {
        File entrypoint = entrypointFile();
        if (entrypoint == null || !entrypoint.exists()) {
            return FALLBACK_ASSET_URL;
        }
        return Uri.fromFile(entrypoint).toString();
    }

    private File entrypointFile() {
        File current = currentDir();
        if (!current.exists()) {
            return null;
        }
        try {
            JSONObject manifest = readManifest(current);
            String entrypoint = manifest.optString("entrypoint", "index.html");
            return safeChild(current, entrypoint);
        } catch (Exception ignored) {
            return new File(current, "index.html");
        }
    }

    private JSONObject validateBundle(File dir) throws CommandException {
        try {
            JSONObject manifest = readManifest(dir);
            if (!"pucky.ui_bundle.v1".equals(manifest.optString("schema", ""))) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "UI bundle manifest schema is invalid");
            }
            if (manifest.optInt("min_native_bridge_version", 1) > NATIVE_BRIDGE_VERSION) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE,
                        "UI bundle requires newer native bridge");
            }
            File entrypoint = safeChild(dir, manifest.optString("entrypoint", "index.html"));
            if (!entrypoint.exists() || !entrypoint.isFile()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "UI bundle entrypoint is missing");
            }
            JSONObject files = manifest.optJSONObject("files");
            if (files == null || files.length() == 0) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "UI bundle manifest has no files");
            }
            Iterator<String> keys = files.keys();
            while (keys.hasNext()) {
                String relative = keys.next();
                JSONObject expected = files.optJSONObject(relative);
                File file = safeChild(dir, relative);
                if (expected == null || !file.exists() || !file.isFile()) {
                    throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                            "UI bundle file missing: " + relative);
                }
                String hash = expected.optString("sha256", "");
                if (!hash.isEmpty() && !hash.equalsIgnoreCase(sha256(file))) {
                    throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                            "UI bundle file hash mismatch: " + relative);
                }
            }
            return manifest;
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to validate UI bundle: " + exc.getMessage());
        }
    }

    private void promote(File staging) throws CommandException {
        File root = rootDir();
        File current = currentDir();
        File previous = new File(root, PREVIOUS);
        deleteRecursive(previous);
        if (current.exists() && !current.renameTo(previous)) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to backup current UI bundle");
        }
        if (!staging.renameTo(current)) {
            if (previous.exists()) {
                //noinspection ResultOfMethodCallIgnored
                previous.renameTo(current);
            }
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to promote UI bundle");
        }
    }

    private void unzip(File zip, File outputDir) throws CommandException {
        try (ZipInputStream input = new ZipInputStream(new FileInputStream(zip))) {
            ZipEntry entry;
            byte[] buffer = new byte[8192];
            while ((entry = input.getNextEntry()) != null) {
                File target = safeChild(outputDir, entry.getName());
                if (entry.isDirectory()) {
                    if (!target.exists() && !target.mkdirs()) {
                        throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to create " + target);
                    }
                    continue;
                }
                File parent = target.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to create " + parent);
                }
                try (FileOutputStream output = new FileOutputStream(target)) {
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        output.write(buffer, 0, read);
                    }
                }
            }
        } catch (CommandException exc) {
            deleteRecursive(outputDir);
            throw exc;
        } catch (Exception exc) {
            deleteRecursive(outputDir);
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to unzip UI bundle: " + exc.getMessage());
        }
    }

    private JSONObject readManifest(File dir) throws Exception {
        File manifest = new File(dir, MANIFEST);
        byte[] data = readAll(manifest);
        return new JSONObject(new String(data, StandardCharsets.UTF_8));
    }

    private File resolveAppOwnedPath(String path) throws CommandException {
        if (path == null || path.trim().isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "UI bundle path is required");
        }
        try {
            File file = new File(path).getCanonicalFile();
            if (!isWithin(file, context.getFilesDir())
                    && !isWithin(file, context.getCacheDir())
                    && !isWithin(file, context.getExternalFilesDir(null))) {
                throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "UI bundle path is outside app-owned storage");
            }
            if (!file.exists() || !file.isFile()) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "UI bundle file not found");
            }
            return file;
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, exc.getMessage());
        }
    }

    private File safeChild(File root, String relative) throws Exception {
        File rootFile = root.getCanonicalFile();
        File target = new File(rootFile, relative).getCanonicalFile();
        if (!isWithin(target, rootFile)) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "UI bundle path traversal rejected");
        }
        return target;
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
            StringBuilder out = new StringBuilder();
            for (byte bit : digest.digest()) {
                out.append(String.format(Locale.US, "%02x", bit));
            }
            return out.toString();
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, exc.getMessage());
        }
    }

    private byte[] readAll(File file) throws Exception {
        byte[] data = new byte[(int) file.length()];
        try (FileInputStream input = new FileInputStream(file)) {
            int offset = 0;
            while (offset < data.length) {
                int read = input.read(data, offset, data.length - offset);
                if (read < 0) {
                    break;
                }
                offset += read;
            }
        }
        return data;
    }

    private File rootDir() {
        return new File(context.getFilesDir(), DIR);
    }

    private File currentDir() {
        return new File(rootDir(), CURRENT);
    }

    private void deleteRecursive(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
