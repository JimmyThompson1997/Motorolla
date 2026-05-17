package com.pucky.device.media;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.MimeTypeMap;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.util.Locale;

public final class MediaExportController {
    private static final String EXPORT_DIR = "Pucky";

    private final Context context;

    public MediaExportController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject exportAudio(JSONObject args) throws CommandException {
        File source = resolveAppOwnedPath(args.optString("path", args.optString("device_path", "")));
        String displayName = safeFilename(args.optString("display_name", source.getName()));
        String title = args.optString("title", displayName);
        String mimeType = args.optString("mime_type", guessMime(source));

        ContentResolver resolver = context.getContentResolver();
        Uri collection = audioCollection();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Audio.Media.DISPLAY_NAME, displayName);
        values.put(MediaStore.Audio.Media.TITLE, title);
        values.put(MediaStore.Audio.Media.MIME_TYPE, mimeType);
        if (Build.VERSION.SDK_INT >= 29) {
            values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC + "/" + EXPORT_DIR);
            values.put(MediaStore.Audio.Media.IS_PENDING, 1);
        }

        Uri uri = resolver.insert(collection, values);
        if (uri == null) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "MediaStore insert returned null");
        }
        try {
            try (FileInputStream input = new FileInputStream(source);
                 OutputStream output = resolver.openOutputStream(uri)) {
                if (output == null) {
                    throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "MediaStore output stream unavailable");
                }
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
            }
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues publish = new ContentValues();
                publish.put(MediaStore.Audio.Media.IS_PENDING, 0);
                resolver.update(uri, publish, null, null);
            }
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.media_export_audio.v1");
            Json.put(out, "exported", true);
            Json.put(out, "content_uri", uri.toString());
            Json.put(out, "display_name", displayName);
            Json.put(out, "title", title);
            Json.put(out, "mime_type", mimeType);
            Json.put(out, "source_path", source.getAbsolutePath());
            Json.put(out, "bytes", source.length());
            Json.put(out, "relative_path", Build.VERSION.SDK_INT >= 29 ? Environment.DIRECTORY_MUSIC + "/" + EXPORT_DIR : JSONObject.NULL);
            return out;
        } catch (CommandException exc) {
            resolver.delete(uri, null, null);
            throw exc;
        } catch (Exception exc) {
            resolver.delete(uri, null, null);
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to export media: " + exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
    }

    public JSONObject list(JSONObject args) {
        int limit = Math.max(1, Math.min(200, args.optInt("limit", 50)));
        JSONArray items = new JSONArray();
        String[] projection = Build.VERSION.SDK_INT >= 29
                ? new String[]{
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.DATE_ADDED,
                MediaStore.Audio.Media.RELATIVE_PATH}
                : new String[]{
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.DATE_ADDED};
        String selection = Build.VERSION.SDK_INT >= 29
                ? MediaStore.Audio.Media.RELATIVE_PATH + "=?"
                : MediaStore.Audio.Media.DISPLAY_NAME + " LIKE ?";
        String[] selectionArgs = Build.VERSION.SDK_INT >= 29
                ? new String[]{Environment.DIRECTORY_MUSIC + "/" + EXPORT_DIR + "/"}
                : new String[]{"pucky-%"};

        try (Cursor cursor = context.getContentResolver().query(
                audioCollection(),
                projection,
                selection,
                selectionArgs,
                MediaStore.Audio.Media.DATE_ADDED + " DESC")) {
            if (cursor != null) {
                while (cursor.moveToNext() && items.length() < limit) {
                    long id = cursor.getLong(0);
                    JSONObject item = new JSONObject();
                    Json.put(item, "id", id);
                    Json.put(item, "content_uri", ContentUris.withAppendedId(audioCollection(), id).toString());
                    Json.put(item, "display_name", cursor.getString(1));
                    Json.put(item, "title", cursor.getString(2));
                    Json.put(item, "mime_type", cursor.getString(3));
                    Json.put(item, "bytes", cursor.getLong(4));
                    Json.put(item, "date_added", cursor.getLong(5));
                    if (Build.VERSION.SDK_INT >= 29) {
                        Json.put(item, "relative_path", cursor.getString(6));
                    }
                    Json.add(items, item);
                }
            }
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.media_exports.v1");
        Json.put(out, "items", items);
        Json.put(out, "count", items.length());
        Json.put(out, "scope", Build.VERSION.SDK_INT >= 29 ? Environment.DIRECTORY_MUSIC + "/" + EXPORT_DIR : "display_name:pucky-*");
        return out;
    }

    public JSONObject delete(JSONObject args) throws CommandException {
        String raw = args.optString("content_uri", args.optString("uri", "")).trim();
        if (raw.isEmpty() && args.has("id")) {
            raw = ContentUris.withAppendedId(audioCollection(), args.optLong("id")).toString();
        }
        if (raw.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "media.export.delete requires content_uri or id");
        }
        Uri uri = Uri.parse(raw);
        if (!"content".equals(uri.getScheme())) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "media export URI must be content://");
        }
        int deleted = context.getContentResolver().delete(uri, null, null);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.media_export_delete.v1");
        Json.put(out, "content_uri", uri.toString());
        Json.put(out, "deleted", deleted);
        return out;
    }

    private Uri audioCollection() {
        if (Build.VERSION.SDK_INT >= 29) {
            return MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        }
        return MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
    }

    private File resolveAppOwnedPath(String path) throws CommandException {
        if (path == null || path.trim().isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "media export path is required");
        }
        try {
            File file = new File(path).getCanonicalFile();
            if (!isWithin(file, context.getFilesDir())
                    && !isWithin(file, context.getCacheDir())
                    && !isWithin(file, context.getExternalFilesDir(null))) {
                throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "Path is outside app-owned storage");
            }
            if (!file.exists() || !file.isFile()) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Media artifact file not found");
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

    private String guessMime(File file) {
        String name = file.getName();
        int dot = name.lastIndexOf('.');
        if (dot <= 0 || dot == name.length() - 1) {
            return "audio/mpeg";
        }
        String extension = name.substring(dot + 1).toLowerCase(Locale.US);
        String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
        return type == null ? "audio/mpeg" : type;
    }

    private String safeFilename(String raw) {
        String name = raw == null || raw.trim().isEmpty() ? "pucky-audio.mp3" : raw.trim();
        name = name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (name.equals(".") || name.equals("..")) {
            return "pucky-audio.mp3";
        }
        return name.length() > 100 ? name.substring(0, 100) : name;
    }
}
