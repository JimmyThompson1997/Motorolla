package com.pucky.device.updates;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.util.Locale;

public final class AppUpdateController {
    private static final long DEFAULT_MAX_BYTES = 100L * 1024L * 1024L;

    private final Context context;

    public AppUpdateController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject installDownloaded(JSONObject args) throws CommandException {
        File apk = resolveAppOwnedPath(args.optString("path", ""));
        if (!apk.getName().toLowerCase(Locale.US).endsWith(".apk")) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "path must point to an .apk file");
        }
        long maxBytes = args.optLong("max_bytes", DEFAULT_MAX_BYTES);
        if (apk.length() > maxBytes) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "APK exceeds max_bytes: " + apk.length() + " > " + maxBytes);
        }

        boolean canRequestInstalls = Build.VERSION.SDK_INT < 26
                || context.getPackageManager().canRequestPackageInstalls();
        if (!canRequestInstalls) {
            boolean settingsLaunched = maybeOpenUnknownSourcesSettings(args);
            JSONObject out = baseResult(apk);
            Json.put(out, "install_requested", false);
            Json.put(out, "permission_required", true);
            Json.put(out, "settings_launched", settingsLaunched);
            Json.put(out, "message", "Enable install unknown apps for Pucky, then rerun install.");
            return out;
        }

        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        int sessionId;
        PackageInstaller.Session session = null;
        try {
            sessionId = installer.createSession(params);
            session = installer.openSession(sessionId);
            try (FileInputStream input = new FileInputStream(apk);
                    OutputStream output = session.openWrite(apk.getName(), 0, apk.length())) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
                session.fsync(output);
            }

            Intent callback = new Intent(context, AppUpdateResultReceiver.class)
                    .setAction(AppUpdateResultReceiver.ACTION_INSTALL_RESULT)
                    .putExtra("source_path", apk.getAbsolutePath())
                    .putExtra("session_id", sessionId);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    context,
                    sessionId,
                    callback,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            session.commit(pendingIntent.getIntentSender());
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    exc.getClass().getSimpleName() + ": " + exc.getMessage());
        } finally {
            if (session != null) {
                session.close();
            }
        }

        JSONObject out = baseResult(apk);
        Json.put(out, "install_requested", true);
        Json.put(out, "permission_required", false);
        Json.put(out, "session_id", sessionId);
        Json.put(out, "user_confirmation_required", true);
        return out;
    }

    private JSONObject baseResult(File apk) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.app_update_install.v1");
        Json.put(out, "path", apk.getAbsolutePath());
        Json.put(out, "filename", apk.getName());
        Json.put(out, "bytes", apk.length());
        Json.put(out, "package_name", context.getPackageName());
        return out;
    }

    private boolean maybeOpenUnknownSourcesSettings(JSONObject args) {
        if (!args.optBoolean("open_settings_if_needed", true) || Build.VERSION.SDK_INT < 26) {
            return false;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                .setData(Uri.parse("package:" + context.getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        return true;
    }

    private File resolveAppOwnedPath(String path) throws CommandException {
        if (path == null || path.trim().isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "path is required");
        }
        try {
            File file = new File(path).getCanonicalFile();
            if (!isWithin(file, context.getFilesDir())
                    && !isWithin(file, context.getCacheDir())
                    && !isWithin(file, context.getExternalFilesDir(null))) {
                throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "Path is outside app-owned storage");
            }
            if (!file.exists() || !file.isFile()) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "APK file not found");
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
}
