package com.pucky.device.media;

import android.content.Context;
import android.content.Intent;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.net.Uri;
import android.view.KeyEvent;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

public final class MediaControlController {
    private final Context context;

    public MediaControlController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject state() {
        AudioManager manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.media_state.v1");
        Json.put(out, "available", manager != null);
        if (manager == null) {
            return out;
        }
        Json.put(out, "music_active", manager.isMusicActive());
        Json.put(out, "mode", manager.getMode());
        Json.put(out, "music_volume", manager.getStreamVolume(AudioManager.STREAM_MUSIC));
        Json.put(out, "music_max_volume", manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        Json.put(out, "speakerphone_on", manager.isSpeakerphoneOn());
        Json.put(out, "bluetooth_sco_on", manager.isBluetoothScoOn());
        Json.put(out, "wired_headset_on_legacy", manager.isWiredHeadsetOn());
        Json.put(out, "microphone_mute", manager.isMicrophoneMute());
        Json.put(out, "output_devices", outputDevices(manager));
        Json.put(out, "third_party_session_inventory", "not_available_without_notification_listener_or_session_token");
        return out;
    }

    public JSONObject key(JSONObject args) throws CommandException {
        String action = args.optString("action", "play_pause").trim().toLowerCase();
        int keyCode = keyCode(action);
        AudioManager manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "AudioManager unavailable");
        }
        long now = System.currentTimeMillis();
        KeyEvent down = new KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0);
        KeyEvent up = new KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0);
        manager.dispatchMediaKeyEvent(down);
        manager.dispatchMediaKeyEvent(up);

        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.media_key.v1");
        Json.put(out, "dispatched", true);
        Json.put(out, "action", action);
        Json.put(out, "key_code", keyCode);
        Json.put(out, "best_effort", true);
        Json.put(out, "note", "Dispatch success does not prove a third-party media app acted.");
        Json.put(out, "state_after", state());
        return out;
    }

    public JSONObject openUri(JSONObject args) throws CommandException {
        String uri = args.optString("uri", args.optString("url", "")).trim();
        if (uri.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "media.open_uri requires uri or url");
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
        String mimeType = args.optString("mime_type", "").trim();
        if (!mimeType.isEmpty()) {
            intent.setDataAndType(Uri.parse(uri), mimeType);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (args.optBoolean("require_resolvable", false)
                && intent.resolveActivity(context.getPackageManager()) == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No activity can handle media URI");
        }
        context.startActivity(intent);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.media_open_uri.v1");
        Json.put(out, "launched", true);
        Json.put(out, "uri", uri);
        Json.put(out, "mime_type", mimeType.isEmpty() ? JSONObject.NULL : mimeType);
        Json.put(out, "user_mediated", true);
        return out;
    }

    private int keyCode(String action) throws CommandException {
        switch (action) {
            case "play_pause":
            case "toggle":
                return KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
            case "play":
                return KeyEvent.KEYCODE_MEDIA_PLAY;
            case "pause":
                return KeyEvent.KEYCODE_MEDIA_PAUSE;
            case "next":
                return KeyEvent.KEYCODE_MEDIA_NEXT;
            case "previous":
            case "prev":
                return KeyEvent.KEYCODE_MEDIA_PREVIOUS;
            case "stop":
                return KeyEvent.KEYCODE_MEDIA_STOP;
            default:
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "Unsupported media key action: " + action);
        }
    }

    private JSONArray outputDevices(AudioManager manager) {
        JSONArray out = new JSONArray();
        AudioDeviceInfo[] devices = manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        for (AudioDeviceInfo device : devices) {
            JSONObject item = new JSONObject();
            Json.put(item, "id", device.getId());
            Json.put(item, "type", device.getType());
            Json.put(item, "product_name", device.getProductName() == null ? JSONObject.NULL : device.getProductName().toString());
            Json.put(item, "is_sink", device.isSink());
            Json.add(out, item);
        }
        return out;
    }
}
