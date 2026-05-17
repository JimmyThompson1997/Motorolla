package com.pucky.device.storage;

import com.pucky.device.util.Json;

import android.content.Context;
import android.os.StatFs;

import org.json.JSONObject;

import java.io.File;

public final class StorageProvider {
    private final Context context;

    public StorageProvider(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject read() {
        JSONObject out = new JSONObject();
        Json.put(out, "files_dir", stats(context.getFilesDir()));
        Json.put(out, "cache_dir", stats(context.getCacheDir()));
        return out;
    }

    private static JSONObject stats(File dir) {
        JSONObject out = new JSONObject();
        if (dir == null) {
            Json.put(out, "available", false);
            return out;
        }
        StatFs statFs = new StatFs(dir.getAbsolutePath());
        Json.put(out, "available", true);
        Json.put(out, "path", dir.getAbsolutePath());
        Json.put(out, "free_bytes", statFs.getAvailableBytes());
        Json.put(out, "total_bytes", statFs.getTotalBytes());
        return out;
    }
}

