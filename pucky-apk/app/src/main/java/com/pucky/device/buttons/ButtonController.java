package com.pucky.device.buttons;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;

import com.pucky.device.audio.AudioController;
import com.pucky.device.broker.BrokerEventPoster;
import com.pucky.device.camera.CameraController;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.livekit.LiveKitController;
import com.pucky.device.media.MediaControlController;
import com.pucky.device.player.PlayerController;
import com.pucky.device.service.PuckyForegroundService;
import com.pucky.device.speech.NativeSpeechController;
import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.ui.PuckyUiController;
import com.pucky.device.util.Json;
import com.pucky.device.voice.VoiceCaptureController;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.Locale;

public final class ButtonController {
    private static final String PREFS = "pucky_buttons";
    private static final String CONFIG = "config_json";
    private static final String EVENTS = "events_json";
    private static final int KEY_VOLUME_UP = KeyEvent.KEYCODE_VOLUME_UP;
    private static final int KEY_VOLUME_DOWN = KeyEvent.KEYCODE_VOLUME_DOWN;
    private static final int MAX_EVENTS = 100;
    private static final int CONFIG_VERSION = 16;
    private static final int DEFAULT_LONG_PRESS_MS = 250;

    private final Context context;
    private final SharedPreferences prefs;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private boolean volumeUpDown;
    private boolean volumeDownDown;
    private boolean volumeUpLongSent;
    private boolean volumeDownLongSent;
    private boolean chordSent;
    private int volumeUpSequence;
    private int volumeDownSequence;
    private Runnable volumeUpHoldRunnable;
    private Runnable volumeDownHoldRunnable;
    private long lastVolumeUpTapMs;
    private long lastVolumeDownTapMs;

    public ButtonController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public synchronized boolean handleKeyDown(int keyCode, KeyEvent event) {
        if (!isVolumeKey(keyCode)) {
            return false;
        }
        JSONObject config = configJson();
        if (!config.optBoolean("enabled", true)) {
            return false;
        }
        if (keyCode == KEY_VOLUME_UP) {
            if (!volumeUpDown) {
                scheduleHoldTimer(KEY_VOLUME_UP, "volume_up_hold", config);
            }
            volumeUpDown = true;
        } else {
            if (!volumeDownDown) {
                scheduleHoldTimer(KEY_VOLUME_DOWN, "volume_down_hold", config);
            }
            volumeDownDown = true;
        }
        if (volumeUpDown && volumeDownDown && !chordSent && isMappedActiveGesture("volume_both_press", config)) {
            chordSent = true;
            volumeUpLongSent = true;
            volumeDownLongSent = true;
            cancelHoldTimer(KEY_VOLUME_UP);
            cancelHoldTimer(KEY_VOLUME_DOWN);
            emitGesture("volume_both_press", keyCode, event, "foreground_activity");
            return true;
        }
        if ((keyCode == KEY_VOLUME_UP && volumeUpLongSent)
                || (keyCode == KEY_VOLUME_DOWN && volumeDownLongSent)) {
            return true;
        }
        if (event.getRepeatCount() > 0 && isMappedActiveGesture(holdGestureForKey(keyCode), config)) {
            return sendHoldIfNeeded(keyCode, event, "foreground_activity_repeat");
        }
        return shouldConsumeVolumeKey(keyCode, config);
    }

    public synchronized boolean handleKeyUp(int keyCode, KeyEvent event) {
        if (!isVolumeKey(keyCode)) {
            return false;
        }
        JSONObject config = configJson();
        if (!config.optBoolean("enabled", true)) {
            return false;
        }
        boolean wasLong = keyCode == KEY_VOLUME_UP ? volumeUpLongSent : volumeDownLongSent;
        boolean wasChord = chordSent;
        if (keyCode == KEY_VOLUME_UP) {
            cancelHoldTimer(KEY_VOLUME_UP);
            volumeUpDown = false;
            volumeUpLongSent = false;
        } else {
            cancelHoldTimer(KEY_VOLUME_DOWN);
            volumeDownDown = false;
            volumeDownLongSent = false;
        }
        if (!volumeUpDown && !volumeDownDown) {
            chordSent = false;
        }
        if (keyCode == KEY_VOLUME_UP && wasLong && !wasChord
                && isMappedActiveGesture("volume_up_hold_release", config)) {
            emitGesture("volume_up_hold_release", keyCode, event, "foreground_activity");
            return true;
        }
        if (!wasLong && !wasChord) {
            handleTap(keyCode, event, clamp(config.optInt("double_press_ms", 450), 150, 1500));
            return shouldConsumeVolumeKey(keyCode, config);
        }
        return wasLong || wasChord || shouldConsumeVolumeKey(keyCode, config);
    }

    private void scheduleHoldTimer(int keyCode, String gesture, JSONObject config) {
        if (!isMappedActiveGesture(gesture, config)) {
            return;
        }
        cancelHoldTimer(keyCode);
        int delayMs = clamp(config.optInt("long_press_ms", DEFAULT_LONG_PRESS_MS), 250, 1200);
        final int sequence;
        if (keyCode == KEY_VOLUME_UP) {
            sequence = ++volumeUpSequence;
        } else {
            sequence = ++volumeDownSequence;
        }
        Runnable runnable = () -> {
            synchronized (ButtonController.this) {
                if (keyCode == KEY_VOLUME_UP) {
                    if (!volumeUpDown || volumeUpLongSent || sequence != volumeUpSequence) {
                        return;
                    }
                } else if (!volumeDownDown || volumeDownLongSent || sequence != volumeDownSequence) {
                    return;
                }
                sendHoldIfNeeded(keyCode, null, "foreground_activity_timer");
            }
        };
        if (keyCode == KEY_VOLUME_UP) {
            volumeUpHoldRunnable = runnable;
        } else {
            volumeDownHoldRunnable = runnable;
        }
        mainHandler.postDelayed(runnable, delayMs);
    }

    private void cancelHoldTimer(int keyCode) {
        if (keyCode == KEY_VOLUME_UP) {
            volumeUpSequence++;
            if (volumeUpHoldRunnable != null) {
                mainHandler.removeCallbacks(volumeUpHoldRunnable);
                volumeUpHoldRunnable = null;
            }
        } else if (keyCode == KEY_VOLUME_DOWN) {
            volumeDownSequence++;
            if (volumeDownHoldRunnable != null) {
                mainHandler.removeCallbacks(volumeDownHoldRunnable);
                volumeDownHoldRunnable = null;
            }
        }
    }

    private boolean sendHoldIfNeeded(int keyCode, KeyEvent event, String source) {
        JSONObject config = configJson();
        if (keyCode == KEY_VOLUME_UP && !volumeUpLongSent && isMappedActiveGesture("volume_up_hold", config)) {
            volumeUpLongSent = true;
            cancelHoldTimer(KEY_VOLUME_UP);
            emitGesture("volume_up_hold", keyCode, event, source);
            return true;
        } else if (keyCode == KEY_VOLUME_DOWN && !volumeDownLongSent && isMappedActiveGesture("volume_down_hold", config)) {
            volumeDownLongSent = true;
            cancelHoldTimer(KEY_VOLUME_DOWN);
            emitGesture("volume_down_hold", keyCode, event, source);
            return true;
        }
        return false;
    }

    public JSONObject state() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.button_state.v1");
        Json.put(out, "foreground_only", true);
        Json.put(out, "volume_up_down", volumeUpDown);
        Json.put(out, "volume_down_down", volumeDownDown);
        Json.put(out, "chord_active", chordSent);
        Json.put(out, "config", configJson());
        JSONArray events = eventsJson();
        Json.put(out, "last_event", events.length() == 0 ? JSONObject.NULL : events.optJSONObject(events.length() - 1));
        Json.put(out, "event_count", events.length());
        return out;
    }

    public JSONObject configGet() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.button_config.v1");
        Json.put(out, "config", configJson());
        return out;
    }

    public JSONObject configSet(JSONObject args) throws CommandException {
        JSONObject config = configJson();
        if (args.has("enabled")) {
            Json.put(config, "enabled", args.optBoolean("enabled", true));
        }
        if (args.has("double_press_ms")) {
            Json.put(config, "double_press_ms", clamp(args.optInt("double_press_ms", 450), 150, 1500));
        }
        if (args.has("long_press_repeat_count")) {
            Json.put(config, "long_press_repeat_count", clamp(args.optInt("long_press_repeat_count", 1), 1, 10));
        }
        JSONObject mappings = args.optJSONObject("mappings");
        if (mappings != null) {
            JSONObject current = config.optJSONObject("mappings");
            if (current == null) {
                current = defaultMappings();
            }
            JSONArray names = mappings.names();
            if (names != null) {
                for (int i = 0; i < names.length(); i++) {
                    String gesture = names.optString(i);
                    if (!isKnownGesture(gesture)) {
                        throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Unknown button gesture: " + gesture);
                    }
                    String action = mappings.optString(gesture, "event_only");
                    validateAction(action);
                    Json.put(current, gesture, action);
                }
            }
            Json.put(config, "mappings", current);
        }
        prefs.edit().putString(CONFIG, config.toString()).commit();
        JSONObject out = configGet();
        Json.put(out, "saved", true);
        return out;
    }

    public JSONObject configReset() {
        JSONObject config = defaultConfig();
        prefs.edit().putString(CONFIG, config.toString()).commit();
        JSONObject out = configGet();
        Json.put(out, "reset", true);
        return out;
    }

    public JSONObject eventsList(JSONObject args) {
        int limit = Math.max(1, Math.min(MAX_EVENTS, args.optInt("limit", 20)));
        JSONArray all = eventsJson();
        JSONArray sliced = new JSONArray();
        int start = Math.max(0, all.length() - limit);
        for (int i = start; i < all.length(); i++) {
            Json.add(sliced, all.opt(i));
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.button_events.v1");
        Json.put(out, "events", sliced);
        Json.put(out, "count", sliced.length());
        Json.put(out, "total_count", all.length());
        return out;
    }

    public JSONObject eventsClear() {
        prefs.edit().putString(EVENTS, "[]").commit();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.button_events_clear.v1");
        Json.put(out, "cleared", true);
        return out;
    }

    public JSONObject simulate(JSONObject args) throws CommandException {
        String gesture = args.optString("gesture", "").trim();
        if (!isKnownGesture(gesture)) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Unknown button gesture: " + gesture);
        }
        JSONObject event = emitGesture(gesture, 0, null, "simulated_command");
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.button_simulate.v1");
        Json.put(out, "event", event);
        return out;
    }

    private void handleTap(int keyCode, KeyEvent event, long doublePressMs) {
        long now = System.currentTimeMillis();
        if (keyCode == KEY_VOLUME_UP) {
            JSONObject mappings = configJson().optJSONObject("mappings");
            boolean doubleMapped = mappings != null
                    && isActivePhysicalAction(mappings.optString("volume_up_double", "none"));
            if (doubleMapped && lastVolumeUpTapMs > 0 && now - lastVolumeUpTapMs <= doublePressMs) {
                lastVolumeUpTapMs = 0;
                emitGesture("volume_up_double", keyCode, event, "foreground_activity");
            } else {
                lastVolumeUpTapMs = now;
                emitGesture("volume_up_press", keyCode, event, "foreground_activity");
            }
        } else {
            if (lastVolumeDownTapMs > 0 && now - lastVolumeDownTapMs <= doublePressMs) {
                lastVolumeDownTapMs = 0;
                emitGesture("volume_down_double", keyCode, event, "foreground_activity");
            } else {
                lastVolumeDownTapMs = now;
                emitGesture("volume_down_press", keyCode, event, "foreground_activity");
            }
        }
    }

    private JSONObject emitGesture(String gesture, int keyCode, KeyEvent keyEvent, String source) {
        JSONObject config = configJson();
        JSONObject mappings = config.optJSONObject("mappings");
        String action = mappings == null ? "event_only" : mappings.optString(gesture, "event_only");
        JSONObject actionResult = executeAction(action);
        JSONObject event = new JSONObject();
        Json.put(event, "id", "btn_" + Long.toHexString(System.currentTimeMillis()));
        Json.put(event, "schema", "pucky.button_event.v1");
        Json.put(event, "timestamp", Instant.now().toString());
        Json.put(event, "gesture", gesture);
        Json.put(event, "key_code", keyCode == 0 ? JSONObject.NULL : keyCode);
        Json.put(event, "repeat_count", keyEvent == null ? JSONObject.NULL : keyEvent.getRepeatCount());
        Json.put(event, "source", source);
        Json.put(event, "foreground_only", true);
        Json.put(event, "mapped_action", action);
        Json.put(event, "action_result", actionResult);
        appendEvent(event);
        postPttGestureToBroker(gesture, action, actionResult, source);
        PuckyState.get().setLifecycleEvent("button." + gesture + "." + actionResult.optString("status", "ok"));
        PuckyState.get().broadcast(context);
        return event;
    }

    private void postPttGestureToBroker(String gesture, String action, JSONObject actionResult, String source) {
        if (!"volume_up_hold".equals(gesture) && !"volume_up_hold_release".equals(gesture)) {
            return;
        }
        if (!"livekit.ptt.start".equals(action) && !"livekit.ptt.stop".equals(action)) {
            return;
        }
        try {
            SettingsStore settings = new SettingsStore(context);
            JSONObject livekit = liveKitController().status();
            JSONObject result = actionResult.optJSONObject("result");
            JSONObject event = new JSONObject();
            Json.put(event, "schema", "pucky.device_event.v1");
            Json.put(event, "event_id", "evt_" + Long.toHexString(System.currentTimeMillis()));
            Json.put(event, "device_id", settings.getDeviceId());
            Json.put(event, "timestamp", Instant.now().toString());
            Json.put(event, "type", "volume_up_hold".equals(gesture) ? "ptt.started" : "ptt.released");
            Json.put(event, "gesture", gesture);
            Json.put(event, "source", source);
            Json.put(event, "foreground_only", true);
            Json.put(event, "mapped_action", action);
            if (result != null) {
                String turnId = result.optString("ptt_turn_id", "").trim();
                if (!turnId.isEmpty()) {
                    Json.put(event, "ptt_turn_id", turnId);
                }
            }
            Json.put(event, "livekit_state", livekit.optString("state", ""));
            Json.put(event, "mic_enabled", livekit.optBoolean("mic_enabled", false));
            String room = livekit.optString("room", "").trim();
            if (!room.isEmpty()) {
                Json.put(event, "livekit_room", room);
            }
            new BrokerEventPoster(context).postAsync(event);
        } catch (Exception ignored) {
            // Button handling must remain reliable even if the broker is unavailable.
        }
    }

    private JSONObject executeAction(String action) {
        JSONObject out = new JSONObject();
        Json.put(out, "action", action);
        try {
            switch (action) {
                case "none":
                case "pass_through":
                case "event_only":
                    Json.put(out, "status", "logged");
                    break;
                case "audio.tone":
                    JSONObject toneArgs = new JSONObject();
                    Json.put(toneArgs, "duration_ms", 120);
                    Json.put(toneArgs, "volume", 35);
                    Json.put(toneArgs, "tone", ToneGenerator.TONE_PROP_ACK);
                    Json.put(out, "result", new AudioController(context).tone(toneArgs));
                    Json.put(out, "status", "completed");
                    break;
                case "torch.pulse":
                    JSONObject torchArgs = new JSONObject();
                    Json.put(torchArgs, "enabled", true);
                    Json.put(torchArgs, "auto_off_ms", 600);
                    Json.put(out, "result", new CameraController(context).setTorch(torchArgs));
                    Json.put(out, "status", "completed");
                    break;
                case "media.key.play_pause":
                    JSONObject playPauseArgs = new JSONObject();
                    Json.put(playPauseArgs, "action", "play_pause");
                    Json.put(out, "result", new MediaControlController(context).key(playPauseArgs));
                    Json.put(out, "status", "completed");
                    break;
                case "media.key.pause":
                    JSONObject pauseArgs = new JSONObject();
                    Json.put(pauseArgs, "action", "pause");
                    Json.put(out, "result", new MediaControlController(context).key(pauseArgs));
                    Json.put(out, "status", "completed");
                    break;
                case "reply.pause":
                    Json.put(out, "result", pauseReply());
                    Json.put(out, "status", "completed");
                    break;
                case "reply.pause_toggle":
                    Json.put(out, "result", pauseToggleReply());
                    Json.put(out, "status", "completed");
                    break;
                case "vox.reply.pause_toggle":
                    Json.put(out, "result", postVoxReplyPauseToggle());
                    Json.put(out, "status", "queued");
                    break;
                case "volume.adjust.up":
                    Json.put(out, "result", adjustPuckyAwareVolume(AudioManager.ADJUST_RAISE));
                    Json.put(out, "status", "completed");
                    break;
                case "volume.adjust.down":
                    Json.put(out, "result", adjustPuckyAwareVolume(AudioManager.ADJUST_LOWER));
                    Json.put(out, "status", "completed");
                    break;
                case "reply.interrupt":
                    Json.put(out, "result", interruptReply());
                    Json.put(out, "status", "completed");
                    break;
                case "ui.dashboard.show":
                    Json.put(out, "result", new PuckyUiController(context).showDashboard(new JSONObject()));
                    Json.put(out, "status", "completed");
                    break;
                case "service.connect":
                    PuckyForegroundService.start(context, true);
                    Json.put(out, "status", "completed");
                    Json.put(out, "result", "connect_requested");
                    break;
                case "voice.listen.start":
                    Json.put(out, "result", voiceListenPlaceholder("start_requested"));
                    Json.put(out, "status", "placeholder");
                    break;
                case "voice.listen.stop_submit":
                    Json.put(out, "result", voiceListenPlaceholder("stop_submit_requested"));
                    Json.put(out, "status", "placeholder");
                    break;
                case "voice.capture.start":
                    Json.put(out, "result", VoiceCaptureController.shared(context).start(new JSONObject()));
                    Json.put(out, "status", "completed");
                    break;
                case "voice.capture.stop":
                    Json.put(out, "result", VoiceCaptureController.shared(context).stop(reasonArgs("button_release")));
                    Json.put(out, "status", "completed");
                    break;
                case "speech.native.start":
                    Json.put(out, "result", NativeSpeechController.shared(context).start(new JSONObject()));
                    Json.put(out, "status", "completed");
                    break;
                case "speech.native.stop":
                    Json.put(out, "result", NativeSpeechController.shared(context).stop(reasonArgs("button_release")));
                    Json.put(out, "status", "completed");
                    break;
                case "livekit.connect":
                    Json.put(out, "result", liveKitController().connect(new JSONObject()));
                    Json.put(out, "status", "completed");
                    break;
                case "livekit.mic.on":
                    Json.put(out, "result", liveKitController().setMic(liveKitMicArgs(true, "volume_up_hold")));
                    Json.put(out, "status", "completed");
                    break;
                case "livekit.mic.off":
                    Json.put(out, "result", liveKitController().setMic(liveKitMicArgs(false, "volume_up_hold_release")));
                    Json.put(out, "status", "completed");
                    break;
                case "livekit.ptt.start":
                    Json.put(out, "result", liveKitController().pttStart(new JSONObject()));
                    Json.put(out, "status", "completed");
                    break;
                case "livekit.ptt.stop":
                    Json.put(out, "result", liveKitController().pttStop(new JSONObject()));
                    Json.put(out, "status", "completed");
                    break;
                case "voice.ptt.start":
                    Json.put(out, "result", voiceListenPlaceholder("start_requested"));
                    Json.put(out, "status", "placeholder");
                    break;
                case "voice.ptt.stop":
                    Json.put(out, "result", voiceListenPlaceholder("stop_requested"));
                    Json.put(out, "status", "placeholder");
                    break;
                case "emergency.stop":
                    Json.put(out, "status", "placeholder");
                    Json.put(out, "note", "Action name reserved for future LiveKit/emergency wiring.");
                    break;
                default:
                    Json.put(out, "status", "unsupported");
                    Json.put(out, "error", "Unknown action: " + action);
            }
        } catch (Exception exc) {
            Json.put(out, "status", "failed");
            Json.put(out, "error", exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
        return out;
    }

    private JSONObject configJson() {
        String raw = prefs.getString(CONFIG, "");
        if (raw != null && !raw.trim().isEmpty()) {
            try {
                JSONObject parsed = new JSONObject(raw);
                JSONObject normalized = normalizeConfig(parsed);
                if (!normalized.toString().equals(raw)) {
                    prefs.edit().putString(CONFIG, normalized.toString()).commit();
                }
                return normalized;
            } catch (Exception ignored) {
                // Fall back to default below.
            }
        }
        JSONObject config = defaultConfig();
        prefs.edit().putString(CONFIG, config.toString()).commit();
        return config;
    }

    private JSONObject defaultConfig() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.button_config.v1");
        Json.put(out, "config_version", CONFIG_VERSION);
        Json.put(out, "enabled", true);
        Json.put(out, "foreground_only", true);
        Json.put(out, "double_press_ms", 450);
        Json.put(out, "long_press_ms", DEFAULT_LONG_PRESS_MS);
        Json.put(out, "long_press_repeat_count", 1);
        Json.put(out, "policy", "android_volume_synthetic_show_ui_hold_ptt_v16");
        Json.put(out, "mappings", defaultMappings());
        return out;
    }

    private JSONObject defaultMappings() {
        JSONObject mappings = new JSONObject();
        Json.put(mappings, "volume_up_press", "volume.adjust.up");
        Json.put(mappings, "volume_up_hold", "livekit.ptt.start");
        Json.put(mappings, "volume_up_hold_release", "livekit.ptt.stop");
        Json.put(mappings, "volume_down_press", "volume.adjust.down");
        Json.put(mappings, "volume_down_hold", "vox.reply.pause_toggle");
        Json.put(mappings, "volume_up_double", "none");
        Json.put(mappings, "volume_down_double", "none");
        Json.put(mappings, "volume_both_press", "none");
        return mappings;
    }

    private JSONObject normalizeConfig(JSONObject raw) {
        if (raw.optInt("config_version", 1) < CONFIG_VERSION) {
            JSONObject migrated = defaultConfig();
            Json.put(migrated, "enabled", raw.optBoolean("enabled", true));
            Json.put(migrated, "double_press_ms", clamp(raw.optInt("double_press_ms", 450), 150, 1500));
            Json.put(migrated, "long_press_ms", DEFAULT_LONG_PRESS_MS);
            Json.put(migrated, "long_press_repeat_count", clamp(raw.optInt("long_press_repeat_count", 1), 1, 10));
            return migrated;
        }
        JSONObject mappings = raw.optJSONObject("mappings");
        JSONObject defaults = defaultMappings();
        if (mappings == null) {
            Json.put(raw, "mappings", defaults);
            return raw;
        }
        JSONArray names = defaults.names();
        if (names != null) {
            for (int i = 0; i < names.length(); i++) {
                String name = names.optString(i);
                if (!mappings.has(name)) {
                    Json.put(mappings, name, defaults.optString(name, "none"));
                }
            }
        }
        Json.put(raw, "config_version", CONFIG_VERSION);
        Json.put(raw, "long_press_ms", clamp(raw.optInt("long_press_ms", DEFAULT_LONG_PRESS_MS), 250, 1200));
        Json.put(raw, "policy", raw.optString("policy", "android_volume_synthetic_show_ui_hold_ptt_v16"));
        Json.put(raw, "mappings", mappings);
        return raw;
    }

    private JSONArray eventsJson() {
        String raw = prefs.getString(EVENTS, "[]");
        try {
            return new JSONArray(raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private void appendEvent(JSONObject event) {
        JSONArray existing = eventsJson();
        JSONArray next = new JSONArray();
        int start = Math.max(0, existing.length() - (MAX_EVENTS - 1));
        for (int i = start; i < existing.length(); i++) {
            Json.add(next, existing.opt(i));
        }
        Json.add(next, event);
        prefs.edit().putString(EVENTS, next.toString()).commit();
    }

    private boolean isVolumeKey(int keyCode) {
        return keyCode == KEY_VOLUME_UP || keyCode == KEY_VOLUME_DOWN;
    }

    private String holdGestureForKey(int keyCode) {
        return keyCode == KEY_VOLUME_UP ? "volume_up_hold" : "volume_down_hold";
    }

    private String pressGestureForKey(int keyCode) {
        return keyCode == KEY_VOLUME_UP ? "volume_up_press" : "volume_down_press";
    }

    private boolean shouldConsumeVolumeKey(int keyCode, JSONObject config) {
        return isMappedActiveGesture(holdGestureForKey(keyCode), config)
                || isMappedActiveGesture(pressGestureForKey(keyCode), config)
                || isMappedActiveGesture(doubleGestureForKey(keyCode), config);
    }

    private String doubleGestureForKey(int keyCode) {
        return keyCode == KEY_VOLUME_UP ? "volume_up_double" : "volume_down_double";
    }

    private boolean isMappedActiveGesture(String gesture, JSONObject config) {
        JSONObject mappings = config.optJSONObject("mappings");
        if (mappings == null) {
            mappings = defaultMappings();
        }
        return isActivePhysicalAction(mappings.optString(gesture, "none"));
    }

    private boolean isActivePhysicalAction(String action) {
        return action != null
                && !action.trim().isEmpty()
                && !"none".equals(action)
                && !"pass_through".equals(action);
    }

    private boolean isKnownGesture(String gesture) {
        switch (gesture) {
            case "volume_up_press":
            case "volume_up_hold":
            case "volume_up_hold_release":
            case "volume_down_hold":
            case "volume_down_press":
            case "volume_up_double":
            case "volume_down_double":
            case "volume_both_press":
                return true;
            default:
                return false;
        }
    }

    private void validateAction(String action) throws CommandException {
        switch (action) {
            case "none":
            case "pass_through":
            case "event_only":
            case "audio.tone":
            case "torch.pulse":
            case "media.key.play_pause":
            case "media.key.pause":
            case "reply.pause":
            case "reply.pause_toggle":
            case "vox.reply.pause_toggle":
            case "reply.interrupt":
            case "volume.adjust.up":
            case "volume.adjust.down":
            case "ui.dashboard.show":
            case "service.connect":
            case "voice.listen.start":
            case "voice.listen.stop_submit":
            case "voice.capture.start":
            case "voice.capture.stop":
            case "speech.native.start":
            case "speech.native.stop":
            case "livekit.connect":
            case "livekit.mic.on":
            case "livekit.mic.off":
            case "livekit.ptt.start":
            case "livekit.ptt.stop":
            case "voice.ptt.start":
            case "voice.ptt.stop":
            case "emergency.stop":
                return;
            default:
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "Unsupported button action: " + action.toLowerCase(Locale.US));
        }
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private JSONObject voiceListenPlaceholder(String event) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.voice_listen_button.v1");
        Json.put(out, "event", event);
        Json.put(out, "implemented", false);
        Json.put(out, "note", "Reserved for LiveKit/native microphone turn wiring.");
        return out;
    }

    private JSONObject reasonArgs(String reason) {
        JSONObject out = new JSONObject();
        Json.put(out, "reason", reason);
        return out;
    }

    private LiveKitController liveKitController() {
        return LiveKitController.shared(context, new SettingsStore(context));
    }

    private JSONObject liveKitMicArgs(boolean enabled, String reason) {
        JSONObject out = new JSONObject();
        Json.put(out, "enabled", enabled);
        Json.put(out, "reason", reason);
        return out;
    }

    private JSONObject postVoxReplyPauseToggle() {
        SettingsStore settings = new SettingsStore(context);
        JSONObject livekit = liveKitController().status();
        JSONObject event = new JSONObject();
        Json.put(event, "schema", "pucky.device_event.v1");
        Json.put(event, "event_id", "evt_" + Long.toHexString(System.currentTimeMillis()));
        Json.put(event, "device_id", settings.getDeviceId());
        Json.put(event, "timestamp", Instant.now().toString());
        Json.put(event, "type", "reply.pause_toggle");
        Json.put(event, "gesture", "volume_down_hold");
        Json.put(event, "source", "foreground_activity");
        Json.put(event, "foreground_only", true);
        String livekitState = livekit.optString("state", "");
        String livekitRoom = livekit.optString("room", "");
        Json.put(event, "livekit_state", livekitState);
        if (isLiveKitActiveState(livekitState) && !livekitRoom.trim().isEmpty()) {
            Json.put(event, "livekit_room", livekitRoom);
        }
        Json.put(event, "mic_enabled", livekit.optBoolean("mic_enabled", false));
        new BrokerEventPoster(context).postAsync(event);

        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.vox_reply_pause_toggle.v1");
        Json.put(out, "event", event);
        Json.put(out, "delivery", "queued_async_http");
        return out;
    }

    private static boolean isLiveKitActiveState(String state) {
        return "connected".equals(state)
                || "connected_talking".equals(state)
                || "connected_muted".equals(state)
                || "reconnecting".equals(state);
    }

    private JSONObject pauseReply() throws CommandException {
        PlayerController player = PlayerController.shared(context);
        JSONObject before = player.state();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.reply_pause.v1");
        Json.put(out, "before", before);
        if (!before.optBoolean("loaded", false)) {
            Json.put(out, "result", "no_active_reply");
            return out;
        }
        if (!before.optBoolean("is_playing", false)) {
            Json.put(out, "result", "already_not_playing");
            return out;
        }
        JSONObject after = player.pause(new JSONObject());
        Json.put(out, "result", "paused");
        Json.put(out, "after", after);
        return out;
    }

    private JSONObject pauseToggleReply() throws CommandException {
        PlayerController player = PlayerController.shared(context);
        JSONObject before = player.state();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.reply_pause_toggle.v1");
        Json.put(out, "before", before);
        if (!before.optBoolean("loaded", false)) {
            Json.put(out, "result", "no_active_reply");
            return out;
        }
        JSONObject after;
        if (before.optBoolean("is_playing", false)) {
            after = player.pause(new JSONObject());
            Json.put(out, "result", "paused");
        } else {
            after = player.play(new JSONObject());
            Json.put(out, "result", "resumed");
        }
        Json.put(out, "after", after);
        return out;
    }

    private JSONObject interruptReply() throws CommandException {
        PlayerController player = PlayerController.shared(context);
        JSONObject before = player.state();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.reply_interrupt.v1");
        Json.put(out, "before", before);
        if (!before.optBoolean("loaded", false)) {
            Json.put(out, "result", "no_active_reply");
            return out;
        }
        if (!before.optBoolean("is_playing", false)) {
            Json.put(out, "result", "already_not_playing");
            return out;
        }
        JSONObject after = player.stop(new JSONObject());
        Json.put(out, "result", "interrupted");
        Json.put(out, "after", after);
        return out;
    }

    private JSONObject adjustPuckyAwareVolume(int direction) {
        AudioManager manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.volume_adjust.v1");
        Json.put(out, "available", manager != null);
        Json.put(out, "direction", direction == AudioManager.ADJUST_RAISE ? "up" : "down");
        if (manager == null) {
            return out;
        }
        JSONObject livekit = liveKitController().status();
        boolean liveKitActive = isLiveKitActiveState(livekit.optString("state", ""));
        int stream = liveKitActive ? AudioManager.STREAM_VOICE_CALL : AudioManager.STREAM_MUSIC;
        Json.put(out, "stream", liveKitActive ? "voice_call" : "music");
        Json.put(out, "livekit_state", livekit.optString("state", "unknown"));
        int before = manager.getStreamVolume(stream);
        manager.adjustStreamVolume(
                stream,
                direction,
                AudioManager.FLAG_SHOW_UI);
        Json.put(out, "before", before);
        int after = manager.getStreamVolume(stream);
        int max = manager.getStreamMaxVolume(stream);
        Json.put(out, "after", after);
        Json.put(out, "max", max);
        if (liveKitActive) {
            try {
                JSONObject currentGain = liveKitController().outputGain(new JSONObject());
                double beforeGain = currentGain.optDouble("gain", 0.75);
                double gainStep = 0.08;
                double nextGain = beforeGain + (direction == AudioManager.ADJUST_RAISE ? gainStep : -gainStep);
                JSONObject gainArgs = new JSONObject();
                Json.put(gainArgs, "gain", Math.max(0.0, Math.min(1.0, nextGain)));
                Json.put(out, "livekit_output_before", currentGain);
                Json.put(out, "livekit_output", liveKitController().outputGain(gainArgs));
            } catch (Exception exc) {
                Json.put(out, "livekit_output_error",
                        exc.getClass().getSimpleName() + ": " + exc.getMessage());
            }
        }
        return out;
    }
}
