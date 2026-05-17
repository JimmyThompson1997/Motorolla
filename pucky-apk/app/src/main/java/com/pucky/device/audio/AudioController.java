package com.pucky.device.audio;

import android.content.Context;
import android.media.AudioManager;
import android.media.ToneGenerator;

import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class AudioController {
    private final Context context;

    public AudioController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject tone(JSONObject args) {
        int durationMs = Math.max(50, Math.min(1000, args.optInt("duration_ms", 200)));
        int volume = Math.max(1, Math.min(100, args.optInt("volume", 35)));
        int tone = args.optInt("tone", ToneGenerator.TONE_PROP_BEEP);
        ToneGenerator generator = new ToneGenerator(AudioManager.STREAM_MUSIC, volume);
        generator.startTone(tone, durationMs);
        new Thread(() -> {
            try {
                Thread.sleep(durationMs + 100L);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            generator.release();
        }, "pucky-tone-release").start();
        JSONObject out = new JSONObject();
        Json.put(out, "played", true);
        Json.put(out, "duration_ms", durationMs);
        Json.put(out, "volume", volume);
        Json.put(out, "stream", "music");
        return out;
    }

    public JSONObject route() {
        AudioManager manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        JSONObject out = new JSONObject();
        Json.put(out, "available", manager != null);
        if (manager == null) {
            return out;
        }
        Json.put(out, "mode", manager.getMode());
        Json.put(out, "music_volume", manager.getStreamVolume(AudioManager.STREAM_MUSIC));
        Json.put(out, "music_max_volume", manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        Json.put(out, "speakerphone_on", manager.isSpeakerphoneOn());
        Json.put(out, "bluetooth_sco_on", manager.isBluetoothScoOn());
        Json.put(out, "wired_headset_on_legacy", manager.isWiredHeadsetOn());
        Json.put(out, "microphone_mute", manager.isMicrophoneMute());
        return out;
    }

    public JSONObject setVolume(JSONObject args) {
        AudioManager manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_volume_set.v1");
        Json.put(out, "available", manager != null);
        Json.put(out, "stream", "music");
        if (manager == null) {
            return out;
        }
        int max = manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int before = manager.getStreamVolume(AudioManager.STREAM_MUSIC);
        if (!args.has("level") && !args.has("percent")) {
            Json.put(out, "before", before);
            Json.put(out, "after", before);
            Json.put(out, "max", max);
            Json.put(out, "changed", false);
            return out;
        }
        int requested;
        if (args.has("level")) {
            requested = args.optInt("level", before);
        } else {
            int percent = Math.max(0, Math.min(100, args.optInt("percent", 50)));
            requested = Math.round((percent / 100.0f) * max);
        }
        int level = Math.max(0, Math.min(max, requested));
        manager.setStreamVolume(AudioManager.STREAM_MUSIC, level, 0);
        Json.put(out, "before", before);
        Json.put(out, "after", manager.getStreamVolume(AudioManager.STREAM_MUSIC));
        Json.put(out, "max", max);
        Json.put(out, "changed", before != manager.getStreamVolume(AudioManager.STREAM_MUSIC));
        return out;
    }
}
