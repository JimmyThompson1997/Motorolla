package com.pucky.device.system;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;
import android.os.PowerManager;
import android.os.SystemClock;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.state.PuckyState;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.security.MessageDigest;
import java.time.Instant;

public final class SystemController {
    private final Context context;

    public SystemController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject runtimeStats() {
        Runtime runtime = Runtime.getRuntime();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.runtime_stats.v1");
        Json.put(out, "timestamp", Instant.now().toString());
        Json.put(out, "available_processors", runtime.availableProcessors());
        Json.put(out, "java_heap_free_bytes", runtime.freeMemory());
        Json.put(out, "java_heap_total_bytes", runtime.totalMemory());
        Json.put(out, "java_heap_max_bytes", runtime.maxMemory());
        Json.put(out, "elapsed_realtime_ms", SystemClock.elapsedRealtime());
        Json.put(out, "uptime_ms", SystemClock.uptimeMillis());
        return out;
    }

    public JSONObject memory() {
        JSONObject out = runtimeStats();
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        Json.put(out, "activity_manager_available", manager != null);
        if (manager != null) {
            ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
            manager.getMemoryInfo(info);
            Json.put(out, "device_avail_mem_bytes", info.availMem);
            Json.put(out, "device_total_mem_bytes", info.totalMem);
            Json.put(out, "device_low_memory", info.lowMemory);
            Json.put(out, "device_threshold_bytes", info.threshold);
            Json.put(out, "app_memory_class_mb", manager.getMemoryClass());
            Json.put(out, "app_large_memory_class_mb", manager.getLargeMemoryClass());
        }
        return out;
    }

    public JSONObject thermal() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.thermal.v1");
        Json.put(out, "available", Build.VERSION.SDK_INT >= 29);
        if (Build.VERSION.SDK_INT >= 29) {
            PowerManager manager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            Json.put(out, "thermal_status", manager == null ? JSONObject.NULL : manager.getCurrentThermalStatus());
        }
        return out;
    }

    public JSONObject serviceStatus() {
        JSONObject out = PuckyState.get().snapshotJson();
        Json.put(out, "schema", "pucky.service_status.v1");
        return out;
    }

    public JSONObject powerPolicy() {
        PowerManager manager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.power_policy.v1");
        Json.put(out, "timestamp", Instant.now().toString());
        Json.put(out, "power_manager_available", manager != null);
        if (manager != null) {
            Json.put(out, "interactive", manager.isInteractive());
            Json.put(out, "power_save_mode", manager.isPowerSaveMode());
            Json.put(out, "device_idle_mode", Build.VERSION.SDK_INT >= 23 && manager.isDeviceIdleMode());
            Json.put(out, "ignoring_battery_optimizations",
                    Build.VERSION.SDK_INT >= 23 && manager.isIgnoringBatteryOptimizations(context.getPackageName()));
        }
        Json.put(out, "service", PuckyState.get().snapshotJson());
        return out;
    }

    public JSONObject benchmark(JSONObject args) throws CommandException {
        int iterations = Math.max(100, Math.min(100000, args.optInt("iterations", 5000)));
        long maxMs = Math.max(25, Math.min(1000, args.optLong("max_ms", 250)));
        long deadline = SystemClock.elapsedRealtime() + maxMs;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] block = "pucky-benchmark".getBytes("UTF-8");
            int completed = 0;
            while (completed < iterations && SystemClock.elapsedRealtime() < deadline) {
                digest.update(block);
                digest.update((byte) completed);
                completed++;
            }
            byte[] hash = digest.digest();
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.compute_benchmark.v1");
            Json.put(out, "requested_iterations", iterations);
            Json.put(out, "completed_iterations", completed);
            Json.put(out, "max_ms", maxMs);
            Json.put(out, "sha256_prefix", hexPrefix(hash, 16));
            Json.put(out, "bounded", true);
            return out;
        } catch (Exception e) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, e.getMessage());
        }
    }

    private static String hexPrefix(byte[] bytes, int chars) {
        StringBuilder builder = new StringBuilder();
        for (byte value : bytes) {
            builder.append(String.format("%02x", value));
            if (builder.length() >= chars) {
                return builder.substring(0, chars);
            }
        }
        return builder.toString();
    }
}
