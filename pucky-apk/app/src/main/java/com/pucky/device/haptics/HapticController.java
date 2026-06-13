package com.pucky.device.haptics;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.pucky.device.notifications.NotificationPayloadNormalizer;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

public final class HapticController {
    private final Context context;

    public HapticController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject vibrate(JSONObject args) {
        long[] pattern = parsePattern(args.optJSONArray("pattern_ms"));
        int[] amplitudes = parseAmplitudes(args.optJSONArray("amplitudes"), pattern.length);
        int repeatCount = Math.max(0, Math.min(25, args.optInt("repeat_count", 0)));
        int repeatGapMs = Math.max(0, Math.min(10000, args.optInt("repeat_gap_ms", 800)));
        int durationMs = Math.max(1, Math.min(5000, args.optInt("duration_ms", 180)));
        int amplitude = Math.max(1, Math.min(255, args.optInt("amplitude", 220)));
        NotificationPayloadNormalizer.CueSpec cue = pattern.length > 0
                ? NotificationPayloadNormalizer.CueSpec.haptic(pattern, amplitudes, durationMs, amplitude, repeatCount, repeatGapMs)
                : NotificationPayloadNormalizer.CueSpec.haptic(new long[0], new int[0], durationMs, amplitude, repeatCount, repeatGapMs);
        playCue(context, cue);
        JSONObject out = new JSONObject();
        Json.put(out, "played", true);
        Json.put(out, "duration_ms", durationMs);
        Json.put(out, "pattern_ms", arrayOf(pattern));
        Json.put(out, "amplitudes", arrayOf(amplitudes));
        Json.put(out, "repeat_count", repeatCount);
        Json.put(out, "repeat_gap_ms", repeatGapMs);
        Json.put(out, "has_amplitude_control", hasAmplitudeControl(context));
        return out;
    }

    public static void playCue(Context context, NotificationPayloadNormalizer.CueSpec cue) {
        if (cue == null || !cue.enabled) {
            return;
        }
        Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) {
            return;
        }
        Runnable pulse = () -> vibrateOnce(vibrator, cue);
        pulse.run();
        if (cue.repeatCount <= 0) {
            return;
        }
        new Thread(() -> {
            for (int index = 0; index < cue.repeatCount; index++) {
                try {
                    Thread.sleep(totalDuration(cue) + cue.repeatGapMs);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                    return;
                }
                pulse.run();
            }
        }, "pucky-haptic-repeat").start();
    }

    public static boolean hasAmplitudeControl(Context context) {
        Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        return vibrator != null && Build.VERSION.SDK_INT >= 26 && vibrator.hasAmplitudeControl();
    }

    private static void vibrateOnce(Vibrator vibrator, NotificationPayloadNormalizer.CueSpec cue) {
        if (cue.patternMs.length > 0) {
            if (Build.VERSION.SDK_INT >= 26) {
                if (cue.amplitudes.length == cue.patternMs.length && cue.amplitudes.length > 0) {
                    vibrator.vibrate(VibrationEffect.createWaveform(cue.patternMs, cue.amplitudes, -1));
                } else {
                    vibrator.vibrate(VibrationEffect.createWaveform(cue.patternMs, -1));
                }
            } else {
                vibrator.vibrate(cue.patternMs, -1);
            }
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            vibrator.vibrate(VibrationEffect.createOneShot(cue.durationMs, cue.amplitude));
        } else {
            vibrator.vibrate(cue.durationMs);
        }
    }

    private static long totalDuration(NotificationPayloadNormalizer.CueSpec cue) {
        if (cue.patternMs.length == 0) {
            return cue.durationMs;
        }
        long total = 0L;
        for (long part : cue.patternMs) {
            total += Math.max(0L, part);
        }
        return Math.max(1L, total);
    }

    private static long[] parsePattern(JSONArray array) {
        if (array == null || array.length() == 0) {
            return new long[0];
        }
        long[] out = new long[array.length()];
        for (int index = 0; index < array.length(); index++) {
            out[index] = Math.max(0L, array.optLong(index, 0L));
        }
        return out;
    }

    private static int[] parseAmplitudes(JSONArray array, int expectedLength) {
        if (array == null || array.length() == 0 || array.length() != expectedLength) {
            return new int[0];
        }
        int[] out = new int[array.length()];
        for (int index = 0; index < array.length(); index++) {
            out[index] = Math.max(-1, Math.min(255, array.optInt(index, -1)));
        }
        return out;
    }

    private static JSONArray arrayOf(long[] values) {
        JSONArray out = new JSONArray();
        for (long value : values) {
            Json.add(out, value);
        }
        return out;
    }

    private static JSONArray arrayOf(int[] values) {
        JSONArray out = new JSONArray();
        for (int value : values) {
            Json.add(out, value);
        }
        return out;
    }
}
