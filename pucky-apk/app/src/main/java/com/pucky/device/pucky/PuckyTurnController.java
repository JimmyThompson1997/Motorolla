package com.pucky.device.pucky;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import com.pucky.device.BuildConfig;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.net.Ipv4FirstDns;
import com.pucky.device.player.PlayerController;
import com.pucky.device.speech.PuckyTurnKeywordInterceptor;
import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.speech.RecipeDevicePrimitiveExecutor;
import com.pucky.device.ui.ReplyCardStore;
import com.pucky.device.util.Json;
import com.pucky.device.wake.WakeWordController;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.time.Instant;
import java.util.UUID;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class PuckyTurnController {
    private static final String TAG = "PuckyTurnController";
    private static final String PREFS = "pucky_turns";
    private static final String LAST_STATUS = "last_status_json";
    private static final String HISTORY = "history_json";
    private static final int MAX_HISTORY_ITEMS = 40;
    private static final int MAX_HISTORY_EVENTS = 40;
    private static final int RECORDING_START_HAPTIC_MS = 45;
    private static final int RECORDING_STOP_HAPTIC_MS = 40;
    private static final int ARRIVAL_CUE_HAPTIC_MS = 32;
    private static final int HAPTIC_AMPLITUDE = 220;
    private static final MediaType AUDIO_WAV = MediaType.get("audio/wav");
    private static PuckyTurnController shared;

    private final Context context;
    private final SettingsStore settings;
    private final ReplyCardStore replyCards;
    private final SharedPreferences prefs;
    private final OkHttpClient http = new OkHttpClient.Builder().dns(Ipv4FirstDns.INSTANCE).build();
    private final Object pollLock = new Object();
    private volatile String activePollTurnId = "";
    private volatile boolean pollActive = false;
    private volatile String acceptedChimedTurnId = "";
    private volatile String replyReceivedCuedTurnId = "";

    public static synchronized PuckyTurnController shared(Context context) {
        if (shared == null) {
            shared = new PuckyTurnController(context.getApplicationContext());
        }
        return shared;
    }

    public PuckyTurnController(Context context) {
        this.context = context.getApplicationContext();
        this.settings = new SettingsStore(this.context);
        this.replyCards = new ReplyCardStore(this.context);
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public JSONObject status() {
        JSONObject voice = WalkieAudioCaptureController.shared(context).status();
        JSONObject last = maybeRecoverLastStatus(lastStatus(), "status_lookup");
        JSONObject liveGate = voice.optJSONObject("speech_gate");
        JSONObject activeSession = voice.optJSONObject("active_session");
        if (liveGate != null && activeSession != null
                && last.optString("turn_id", "").equals(activeSession.optString("turn_id", ""))) {
            Json.put(last, "speech_gate", liveGate);
            Json.put(last, "speech_detected", liveGate.optBoolean("speech_detected", false));
        }
        JSONObject player = PlayerController.shared(context).state();
        JSONObject indicator = indicatorJson(last, voice, player);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_status.v1");
        Json.put(out, "voice_capture", voice);
        Json.put(out, "last_status", last);
        Json.put(out, "player_state", player);
        Json.put(out, "indicator", indicator);
        Json.put(out, "visual_state", indicator.optString("visual_state", "idle"));
        JSONObject gate = indicator.optJSONObject("speech_gate");
        Json.put(out, "speech_gate", gate == null ? JSONObject.NULL : gate);
        Json.put(out, "configured", isUploadConfigured());
        Json.put(out, "upload_configured", isUploadConfigured());
        Json.put(out, "local_capture_ready", true);
        Json.put(out, "url", settings.getPuckyTurnUrl());
        Json.put(out, "reply_mode", settings.getPuckyTurnReplyMode());
        Json.put(out, "spoken_reply_enabled", settings.isPuckyTurnSpokenReplyEnabled());
        Json.put(out, "arrival_cue_mode", settings.getPuckyTurnArrivalCueMode());
        Json.put(out, "accepted_chime_enabled", settings.isPuckyTurnAcceptedChimeEnabled());
        Json.put(out, "vad_engine", indicator.optString("vad_engine", ""));
        Json.put(out, "vad_available", indicator.optBoolean("vad_available", false));
        Json.put(out, "vad_probability", indicator.optDouble("vad_probability", 0.0));
        Json.put(out, "speech_detected", indicator.optBoolean("speech_detected", false));
        Json.put(out, "peak_amplitude", indicator.optInt("peak_amplitude", 0));
        Json.put(out, "speech_frames", indicator.optInt("speech_frames", 0));
        Json.put(out, "mic_on", indicator.optBoolean("mic_on", false));
        Json.put(out, "hearing", indicator.optBoolean("hearing", false));
        Json.put(out, "uploading", indicator.optBoolean("uploading", false));
        Json.put(out, "stt_running", indicator.optBoolean("stt_running", false));
        Json.put(out, "codex_running", indicator.optBoolean("codex_running", false));
        Json.put(out, "tts_running", indicator.optBoolean("tts_running", false));
        Json.put(out, "speaking", indicator.optBoolean("speaking", false));
        Json.put(out, "failed", indicator.optBoolean("failed", false));
        Json.put(out, "remote_stage", indicator.optString("remote_stage", ""));
        Json.put(out, "user_transcript", last.optString("user_transcript", ""));
        return out;
    }

    public JSONObject settingsGet() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_settings.v1");
        Json.put(out, "reply_mode", settings.getPuckyTurnReplyMode());
        Json.put(out, "spoken_reply_enabled", settings.isPuckyTurnSpokenReplyEnabled());
        Json.put(out, "arrival_cue_mode", settings.getPuckyTurnArrivalCueMode());
        Json.put(out, "accepted_chime_enabled", settings.isPuckyTurnAcceptedChimeEnabled());
        JSONArray modes = new JSONArray();
        Json.add(modes, SettingsStore.PUCKY_TURN_REPLY_CARD_ONLY);
        Json.add(modes, SettingsStore.PUCKY_TURN_REPLY_CARD_AND_SPOKEN);
        Json.put(out, "modes", modes);
        JSONArray arrivalCueModes = new JSONArray();
        Json.add(arrivalCueModes, SettingsStore.PUCKY_TURN_ARRIVAL_CUE_NONE);
        Json.add(arrivalCueModes, SettingsStore.PUCKY_TURN_ARRIVAL_CUE_HAPTIC);
        Json.add(arrivalCueModes, SettingsStore.PUCKY_TURN_ARRIVAL_CUE_CHIME);
        Json.add(arrivalCueModes, SettingsStore.PUCKY_TURN_ARRIVAL_CUE_HAPTIC_AND_CHIME);
        Json.put(out, "arrival_cue_modes", arrivalCueModes);
        return out;
    }

    public JSONObject settingsSet(JSONObject args) {
        String mode = args.optString("reply_mode", args.optString("mode", SettingsStore.PUCKY_TURN_REPLY_CARD_ONLY));
        settings.setPuckyTurnReplyMode(mode);
        if (args.has("arrival_cue_mode")) {
            settings.setPuckyTurnArrivalCueMode(args.optString("arrival_cue_mode", SettingsStore.PUCKY_TURN_ARRIVAL_CUE_CHIME));
        } else if (args.has("accepted_chime_enabled")) {
            settings.setPuckyTurnAcceptedChimeEnabled(args.optBoolean("accepted_chime_enabled", true));
        }
        return settingsGet();
    }

    public JSONObject arrivalCueTest(JSONObject args) {
        JSONObject out = playSentCue("manual_test");
        Json.put(out, "turn_id", args.optString("turn_id", "manual_test"));
        Json.put(out, "test", true);
        return out;
    }

    public JSONObject sentCueTest(JSONObject args) {
        return arrivalCueTest(args);
    }

    public JSONObject receivedCueTest(JSONObject args) {
        JSONObject out = playReplyReceivedCue("manual_test");
        Json.put(out, "turn_id", args.optString("turn_id", "manual_test"));
        Json.put(out, "test", true);
        return out;
    }

    public JSONObject chimeTest(JSONObject args) {
        return arrivalCueTest(args);
    }

    public JSONObject history(JSONObject args) {
        int limit = Math.max(1, Math.min(MAX_HISTORY_ITEMS, args.optInt("limit", 20)));
        JSONArray all = turnHistoryArray();
        JSONArray turns = new JSONArray();
        for (int i = 0; i < all.length() && i < limit; i++) {
            JSONObject item = all.optJSONObject(i);
            if (item != null) {
                Json.add(turns, item);
            }
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_history.v1");
        Json.put(out, "count", turns.length());
        Json.put(out, "total", all.length());
        Json.put(out, "turns", turns);
        return out;
    }

    public JSONObject read(JSONObject args) {
        String turnId = args.optString("turn_id", "");
        String localSessionId = args.optString("local_session_id", "");
        JSONObject found = findHistoryRecord(turnHistoryArray(), turnId, localSessionId);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_history_read.v1");
        Json.put(out, "found", found != null);
        Json.put(out, "turn", found == null ? JSONObject.NULL : found);
        return out;
    }

    public JSONObject debugInjectHistory(JSONObject args) throws CommandException {
        if (!BuildConfig.DEBUG) {
            throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED,
                    "pucky.turn.debug.inject_history is only available on debug builds");
        }
        boolean clear = args.optBoolean("clear", false);
        int removed = clear ? clearDebugInjectedHistory() : 0;
        if (!clear || args.has("turn_id") || args.has("local_session_id") || args.has("session_id")) {
            String turnId = args.optString("turn_id", "").trim();
            String localSessionId = args.optString("local_session_id", args.optString("session_id", "")).trim();
            if (turnId.isEmpty() && localSessionId.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                        "pucky.turn.debug.inject_history requires turn_id or local_session_id");
            }
            String state = args.optString("latest_state", args.optString("state", "uploading")).trim();
            if (state.isEmpty()) {
                state = "uploading";
            }
            String updatedAt = args.optString("updated_at", Instant.now().toString());
            JSONObject detail = new JSONObject();
            Json.put(detail, "schema", "pucky.turn_status_item.v1");
            Json.put(detail, "turn_id", turnId);
            Json.put(detail, "local_session_id", localSessionId);
            Json.put(detail, "session_id", localSessionId);
            Json.put(detail, "created_at", args.optString("created_at", updatedAt));
            Json.put(detail, "updated_at", updatedAt);
            Json.put(detail, "visual_state", visualStateFor(state));
            Json.put(detail, "trigger_source", args.optString("trigger_source", "debug_injected"));
            Json.put(detail, "debug_injected", true);
            if (args.has("user_transcript")) {
                Json.put(detail, "user_transcript", args.optString("user_transcript", ""));
            }
            if (args.has("error")) {
                Json.put(detail, "error", args.optString("error", ""));
            }
            if (args.has("archived")) {
                Json.put(detail, "archived", args.optBoolean("archived", false));
            }
            if (args.has("card_id")) {
                Json.put(detail, "card_id", args.optString("card_id", ""));
            }
            if (args.has("reply_card_saved")) {
                Json.put(detail, "reply_card_saved", args.optBoolean("reply_card_saved", false));
            }
            upsertTurnHistory(state, detail);
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_debug_inject_result.v1");
        Json.put(out, "ok", true);
        Json.put(out, "removed", removed);
        Json.put(out, "history", history(new JSONObject()));
        return out;
    }

    public JSONObject start(JSONObject args) throws CommandException {
        String clientTurnId = generateClientTurnId();
        String localSessionId = clientTurnId;
        final boolean feedback = args.optBoolean("feedback", true);
        String triggerSource = args.optString("trigger_source", args.optString("source", "volume_up_hold"));
        JSONObject startArgs = new JSONObject();
        Json.put(startArgs, "format", "wav");
        Json.put(startArgs, "session_id", localSessionId);
        Json.put(startArgs, "turn_id", clientTurnId);
        Json.put(startArgs, "max_duration_ms", args.optInt("max_duration_ms", 60000));
        Json.put(startArgs, "sample_tag", "pucky_turn");
        Json.put(startArgs, "feedback", false);
        Json.put(startArgs, "trigger_source", triggerSource);
        if (args.has("wake_phrase_family")) {
            Json.put(startArgs, "wake_phrase_family", args.optString("wake_phrase_family", ""));
        }
        if (args.has("wake_phrase_detected")) {
            Json.put(startArgs, "wake_phrase_detected", args.optString("wake_phrase_detected", ""));
        }
        WakeWordController.shared(context).onTurnStarting(clientTurnId, triggerSource);
        JSONObject out;
        try {
            out = WalkieAudioCaptureController.shared(context).start(startArgs, speechGateStatus -> {
                JSONObject status = new JSONObject();
                Json.put(status, "schema", "pucky.turn_status_item.v1");
                Json.put(status, "state", "recording");
                Json.put(status, "phase", "speech_detected");
                Json.put(status, "local_session_id", localSessionId);
                Json.put(status, "turn_id", clientTurnId);
                Json.put(status, "trigger_source", triggerSource);
                if (args.has("wake_phrase_family")) {
                    Json.put(status, "wake_phrase_family", args.optString("wake_phrase_family", ""));
                }
                if (args.has("wake_phrase_detected")) {
                    Json.put(status, "wake_phrase_detected", args.optString("wake_phrase_detected", ""));
                }
                Json.put(status, "speech_gate", speechGateStatus);
                Json.put(status, "speech_detected", true);
                markStatus("recording", status, null);
            });
        } catch (CommandException exc) {
            WakeWordController.shared(context).onTurnStatusChanged(clientTurnId, "failed", new JSONObject());
            throw exc;
        }
        if (feedback) {
            playRecordingStartHaptic();
        }
        Json.put(out, "turn_id", clientTurnId);
        Json.put(out, "local_session_id", localSessionId);
        Json.put(out, "trigger_source", triggerSource);
        if (args.has("wake_phrase_family")) {
            Json.put(out, "wake_phrase_family", args.optString("wake_phrase_family", ""));
        }
        if (args.has("wake_phrase_detected")) {
            Json.put(out, "wake_phrase_detected", args.optString("wake_phrase_detected", ""));
        }
        JSONObject gate = out.optJSONObject("speech_gate");
        Json.put(out, "speech_gate", gate == null ? JSONObject.NULL : gate);
        Json.put(out, "speech_detected", false);
        Json.put(out, "vad_engine", gate == null ? "" : gate.optString("vad_engine", ""));
        Json.put(out, "vad_available", gate != null && gate.optBoolean("vad_available", false));
        Json.put(out, "upload_configured", isUploadConfigured());
        Json.put(out, "local_capture_ready", true);
        markStatus("armed", out, null);
        return out;
    }

    public JSONObject stop(JSONObject args) throws CommandException {
        JSONObject voice = WalkieAudioCaptureController.shared(context).status();
        JSONObject active = voice.optJSONObject("active_session");
        if (active == null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.turn_stop.v1");
            Json.put(out, "state", "idle");
            Json.put(out, "result", "no_active_capture");
            markStatus("idle", out, "no_capture");
            return out;
        }
        String localSessionId = active.optString("session_id", "pucky_" + Long.toHexString(System.currentTimeMillis()));
        JSONObject last = lastStatus();
        String clientTurnId = active.optString("turn_id", last.optString("turn_id", generateClientTurnId()));
        String triggerSource = active.optString("trigger_source", last.optString("trigger_source", "volume_up_hold"));
        JSONObject speechGate = voice.optJSONObject("speech_gate");
        if (speechGate == null) {
            speechGate = new JSONObject();
        }
        boolean speechDetected = speechGate.optBoolean("speech_detected", false);
        String reason = args.optString("reason", "button_release");
        boolean feedback = args.optBoolean("feedback", true);
        if (feedback) {
            playRecordingStopHaptic();
        }
        if (!speechDetected) {
            JSONObject stopArgs = reasonArgs(reason);
            Json.put(stopArgs, "feedback", false);
            JSONObject discarded = WalkieAudioCaptureController.shared(context).discard(stopArgs);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.turn_stop.v1");
            Json.put(out, "state", "discarded_silence");
            Json.put(out, "phase", "silence_discarded");
            Json.put(out, "result", "discarded_silence");
            Json.put(out, "local_session_id", localSessionId);
            Json.put(out, "turn_id", clientTurnId);
            Json.put(out, "trigger_source", triggerSource);
            copyCaptureMetadata(out, active);
            Json.put(out, "speech_gate", speechGate);
            Json.put(out, "speech_detected", false);
            Json.put(out, "upload_configured", isUploadConfigured());
            Json.put(out, "local_capture_ready", true);
            Json.put(out, "vad_engine", speechGate.optString("vad_engine", ""));
            Json.put(out, "vad_available", speechGate.optBoolean("vad_available", false));
            Json.put(out, "voice_capture", discarded);
            markStatus("discarded_silence", out, null);
            return out;
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_stop.v1");
        Json.put(out, "state", "uploading");
        Json.put(out, "phase", "capture_finalizing");
        Json.put(out, "local_session_id", localSessionId);
        Json.put(out, "turn_id", clientTurnId);
        Json.put(out, "trigger_source", triggerSource);
        copyCaptureMetadata(out, active);
        Json.put(out, "speech_gate", speechGate);
        Json.put(out, "speech_detected", true);
        Json.put(out, "upload_configured", isUploadConfigured());
        Json.put(out, "local_capture_ready", true);
        Json.put(out, "vad_engine", speechGate.optString("vad_engine", ""));
        Json.put(out, "vad_available", speechGate.optBoolean("vad_available", false));
        markStatus("uploading", out, null);
        final JSONObject finalSpeechGate = speechGate;
        Thread worker = new Thread(() -> finishStopAndUpload(localSessionId, clientTurnId, reason, finalSpeechGate),
                "PuckyTurnStopUpload");
        worker.setDaemon(true);
        worker.start();
        return out;
    }

    private void finishStopAndUpload(String fallbackLocalSessionId, String clientTurnId, String reason, JSONObject speechGate) {
        long finalizeStartedMs = System.currentTimeMillis();
        try {
            JSONObject stopArgs = reasonArgs(reason);
            Json.put(stopArgs, "feedback", false);
            JSONObject stopped = WalkieAudioCaptureController.shared(context).stop(stopArgs);
            JSONObject capture = stopped.optJSONObject("capture");
            if (capture == null) {
                markStatus("idle", stopped, "no_capture");
                return;
            }
            File audio = new File(capture.optString("path", ""));
            if (!audio.exists() || !audio.isFile() || audio.length() <= 0) {
                JSONObject failed = baseStatus(capture.optString("session_id", fallbackLocalSessionId), finalizeStartedMs, 0);
                Json.put(failed, "turn_id", clientTurnId);
                copyCaptureMetadata(failed, capture);
                Json.put(failed, "speech_gate", speechGate);
                Json.put(failed, "speech_detected", true);
                markStatus("failed", failed, "empty_capture");
                return;
            }
            byte[] audioBytes = readAll(audio);
            String localSessionId = capture.optString("session_id", fallbackLocalSessionId);
            JSONObject uploading = baseStatus(localSessionId, finalizeStartedMs, audioBytes.length);
            Json.put(uploading, "state", "uploading");
            Json.put(uploading, "phase", "capture_finalized");
            Json.put(uploading, "turn_id", clientTurnId);
            Json.put(uploading, "speech_gate", speechGate);
            Json.put(uploading, "speech_detected", true);
            Json.put(uploading, "capture_finalize_ms", Math.max(0L, System.currentTimeMillis() - finalizeStartedMs));
            if (!isUploadConfigured()) {
                boolean deleted = deleteQuietly(audio);
                JSONObject blocked = baseStatus(localSessionId, finalizeStartedMs, audioBytes.length);
                Json.put(blocked, "state", "upload_blocked");
                Json.put(blocked, "phase", "upload_not_configured");
                Json.put(blocked, "result", "upload_not_configured");
                Json.put(blocked, "turn_id", clientTurnId);
                copyCaptureMetadata(blocked, capture);
                Json.put(blocked, "speech_gate", speechGate);
                Json.put(blocked, "speech_detected", true);
                Json.put(blocked, "capture_finalize_ms", Math.max(0L, System.currentTimeMillis() - finalizeStartedMs));
                Json.put(blocked, "upload_configured", false);
                Json.put(blocked, "local_capture_ready", true);
                Json.put(blocked, "url", settings.getPuckyTurnUrl());
                Json.put(blocked, "deleted_file", deleted);
                Json.put(blocked, "error", "not_configured");
                markStatus("upload_blocked", blocked, null);
                return;
            }
            Json.put(uploading, "upload_configured", true);
            Json.put(uploading, "local_capture_ready", true);
            copyCaptureMetadata(uploading, capture);
            markStatus("uploading", uploading, null);
            JSONObject keywordIntercept = PuckyTurnKeywordInterceptor.shared(context)
                    .intercept(audioBytes, localSessionId, clientTurnId, speechGate);
            Json.put(uploading, "local_keyword_intercept", keywordIntercept);
            Json.put(uploading, "local_classifier_status", keywordIntercept.optString("classifier_status", ""));
            Json.put(uploading, "local_classifier_transcript", keywordIntercept.optString("final_transcript", ""));
            Json.put(uploading, "local_recipe_matched", keywordIntercept.optBoolean("matched", false));
            Json.put(uploading, "local_recipe_id",
                    keywordIntercept.optJSONObject("match") == null
                            ? JSONObject.NULL
                            : keywordIntercept.optJSONObject("match").optString("id", ""));
            if (keywordIntercept.optBoolean("handled", false)) {
                boolean deleted = deleteQuietly(audio);
                JSONObject handled = baseStatus(localSessionId, finalizeStartedMs, audioBytes.length);
                Json.put(handled, "turn_id", clientTurnId);
                copyCaptureMetadata(handled, capture);
                Json.put(handled, "speech_gate", speechGate);
                Json.put(handled, "speech_detected", true);
                Json.put(handled, "capture_finalize_ms", Math.max(0L, System.currentTimeMillis() - finalizeStartedMs));
                Json.put(handled, "local_keyword_intercept", keywordIntercept);
                Json.put(handled, "local_classifier_status", keywordIntercept.optString("classifier_status", ""));
                Json.put(handled, "local_classifier_transcript", keywordIntercept.optString("final_transcript", ""));
                Json.put(handled, "local_recipe_matched", keywordIntercept.optBoolean("matched", false));
                Json.put(handled, "local_recipe_id",
                        keywordIntercept.optJSONObject("match") == null
                                ? JSONObject.NULL
                                : keywordIntercept.optJSONObject("match").optString("id", ""));
                Json.put(handled, "keyword_action_status", keywordIntercept.optString("execution_status", ""));
                Json.put(handled, "keyword_action_result", keywordIntercept.opt("execution"));
                copyIfPresent(handled, keywordIntercept, "pucky_clipboard_entry_id");
                Json.put(handled, "deleted_file", deleted);
                boolean failed = "failed".equals(keywordIntercept.optString("execution_status", ""))
                        || !"".equals(keywordIntercept.optString("error_code", ""));
                Json.put(handled, "state", failed ? "failed" : "completed");
                Json.put(handled, "phase", failed ? "local_keyword_failed" : "local_keyword_handled");
                if (failed) {
                    String error = keywordIntercept.optString("error_message",
                            keywordIntercept.optString("error_code", "keyword_action_failed"));
                    markStatus("failed", handled, error);
                } else {
                    markStatus("completed", handled, null);
                }
                return;
            }
            Json.put(uploading, "phase", "upload_started");
            markStatus("uploading", uploading, null);
            submitAsync(localSessionId, clientTurnId, audioBytes);
        } catch (CommandException exc) {
            JSONObject failed = baseStatus(fallbackLocalSessionId, finalizeStartedMs, 0);
            Json.put(failed, "turn_id", clientTurnId);
            Json.put(failed, "trigger_source", lastStatus().optString("trigger_source", "volume_up_hold"));
            Json.put(failed, "speech_gate", speechGate);
            Json.put(failed, "speech_detected", true);
            markStatus("failed", failed, exc.getMessage());
        } catch (Exception exc) {
            JSONObject failed = baseStatus(fallbackLocalSessionId, finalizeStartedMs, 0);
            Json.put(failed, "turn_id", clientTurnId);
            Json.put(failed, "trigger_source", lastStatus().optString("trigger_source", "volume_up_hold"));
            Json.put(failed, "speech_gate", speechGate);
            Json.put(failed, "speech_detected", true);
            markStatus("failed", failed, exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
    }

    private void submitAsync(String localSessionId, String clientTurnId, byte[] audioBytes) {
        long startedMs = System.currentTimeMillis();
        final String replyModeAtUpload = settings.getPuckyTurnReplyMode();
        final boolean spokenReplyEnabledAtUpload =
                SettingsStore.PUCKY_TURN_REPLY_CARD_AND_SPOKEN.equals(replyModeAtUpload);
        Request request = new Request.Builder()
                .url(settings.getPuckyTurnUrl())
                .header("Authorization", "Bearer " + settings.getPuckyTurnAuthToken())
                .header("X-Pucky-Turn-Id", clientTurnId)
                .header("X-Pucky-Reply-Mode", replyModeAtUpload)
                .post(RequestBody.create(AUDIO_WAV, audioBytes))
                .build();
        startTurnStatusPoll(clientTurnId);
        http.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                stopTurnStatusPoll(clientTurnId);
                JSONObject failed = baseStatus(localSessionId, startedMs, audioBytes.length);
                Json.put(failed, "turn_id", clientTurnId);
                markStatus("failed", failed,
                        e.getClass().getSimpleName() + ": " + e.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (Response ignored = response) {
                    String responseText = response.body() == null ? "" : response.body().string();
                    JSONObject status = baseStatus(localSessionId, startedMs, audioBytes.length);
                    Json.put(status, "turn_id", clientTurnId);
                    Json.put(status, "http_status", response.code());
                    if (!response.isSuccessful()) {
                        stopTurnStatusPoll(clientTurnId);
                        markStatus("failed", status, "http_" + response.code());
                        return;
                    }
                    JSONObject arrivalCue = playArrivalCueOnce(clientTurnId, "http_response_success");
                    Json.put(status, "sent_cue", arrivalCue);
                    Json.put(status, "arrival_cue", arrivalCue);
                    Json.put(status, "accepted_chime", arrivalCue);
                    mergeArrivalCue(status, arrivalCue);
                    try {
                        PuckyTurnResponse parsed = PuckyTurnResponse.fromJson(responseText);
                        JSONObject card = PuckyFeedController.shared(context).upsertTurnResponse(localSessionId, parsed);
                        String sessionId = card.optString("session_id", "");
                        String turnId = parsed.turnId().isEmpty() ? sessionId : parsed.turnId();
                        boolean suppressReceivedCue = spokenReplyEnabledAtUpload && parsed.hasAudio();
                        JSONObject replyReceivedCue = suppressReceivedCue
                                ? suppressedReplyReceivedCue(turnId, "spoken_reply_enabled")
                                : playReplyReceivedCueOnce(turnId, "reply_saved");
                        Json.put(status, "session_id", sessionId);
                        Json.put(status, "turn_id", turnId);
                        Json.put(status, "card_id", card.optString("card_id", parsed.cardId()));
                        Json.put(status, "reply_audio_path", card.optString("audio_path", ""));
                        Json.put(status, "reply_text_chars", parsed.text().length());
                        Json.put(status, "reply_audio_bytes", parsed.audioBytes().length);
                        Json.put(status, "reply_card_saved", true);
                        Json.put(status, "reply_received_cue", replyReceivedCue);
                        mergeReplyReceivedCue(status, replyReceivedCue);
                        Json.put(status, "reply_mode", replyModeAtUpload);
                        Json.put(status, "arrival_cue_mode", settings.getPuckyTurnArrivalCueMode());
                        Json.put(status, "spoken_reply_enabled", spokenReplyEnabledAtUpload);
                        Json.put(status, "spoken_reply_playback_attempted", spokenReplyEnabledAtUpload);
                        Json.put(status, "spoken_reply_playback_started", false);
                        Json.put(status, "spoken_reply_playback_completed", false);
                        Json.put(status, "has_html", parsed.hasHtml());
                        Json.put(status, "server_telemetry", parsed.telemetry());
                        Json.put(status, "latency_server_total_ms", parsed.telemetry().optInt("total_ms", -1));
                        stopTurnStatusPoll(clientTurnId);
                        if (spokenReplyEnabledAtUpload) {
                            if (parsed.hasAudio()) {
                                JSONObject playerState = playReply(card);
                                Json.put(status, "player_state", playerState);
                                Json.put(status, "spoken_reply_playback_started", playerState.optBoolean("is_playing", false));
                                markStatus("speaking", status, null);
                            } else {
                                markStatus("completed", status, null);
                            }
                        } else {
                            markStatus("completed", status, null);
                        }
                    } catch (Exception exc) {
                        stopTurnStatusPoll(clientTurnId);
                        markStatus("failed", status, exc.getClass().getSimpleName() + ": " + exc.getMessage());
                    }
                } catch (IOException exc) {
                    stopTurnStatusPoll(clientTurnId);
                    JSONObject failed = baseStatus(localSessionId, startedMs, audioBytes.length);
                    Json.put(failed, "turn_id", clientTurnId);
                    markStatus("failed", failed,
                            "response_read_failed: " + exc.getMessage());
                }
            }
        });
    }

    private void startTurnStatusPoll(String clientTurnId) {
        synchronized (pollLock) {
            activePollTurnId = clientTurnId;
            pollActive = true;
        }
        Thread worker = new Thread(() -> {
            long deadlineMs = System.currentTimeMillis() + 120000L;
            while (isPollingTurn(clientTurnId) && System.currentTimeMillis() < deadlineMs) {
                pollTurnStatus(clientTurnId);
                if (isRemoteTerminalStage(lastStatus().optString("remote_stage", ""))) {
                    stopTurnStatusPoll(clientTurnId);
                    return;
                }
                try {
                    Thread.sleep(350L);
                } catch (InterruptedException exc) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
            stopTurnStatusPoll(clientTurnId);
        }, "PuckyTurnStatusPoll");
        worker.setDaemon(true);
        worker.start();
    }

    private void stopTurnStatusPoll(String clientTurnId) {
        synchronized (pollLock) {
            if (clientTurnId == null || clientTurnId.isEmpty() || clientTurnId.equals(activePollTurnId)) {
                pollActive = false;
                activePollTurnId = "";
            }
        }
    }

    private boolean isPollingTurn(String clientTurnId) {
        synchronized (pollLock) {
            return pollActive && clientTurnId.equals(activePollTurnId);
        }
    }

    private void pollTurnStatus(String clientTurnId) {
        Request request = new Request.Builder()
                .url(turnStatusUrl(clientTurnId))
                .header("Authorization", "Bearer " + settings.getPuckyTurnAuthToken())
                .get()
                .build();
        try (Response response = http.newCall(request).execute()) {
            if (!response.isSuccessful() || response.body() == null) {
                return;
            }
            JSONObject remote = new JSONObject(response.body().string());
            if (!isPollingTurn(clientTurnId)) {
                Log.d(TAG, "Ignoring stale turn status poll for " + clientTurnId);
                return;
            }
            applyRemoteTurnStatus(clientTurnId, remote);
        } catch (Exception exc) {
            Log.d(TAG, "turn status poll skipped: " + exc.getMessage());
        }
    }

    private void applyRemoteTurnStatus(String clientTurnId, JSONObject remote) {
        String remoteStage = remote.optString("stage", "");
        if (remoteStage.isEmpty() || "completed".equals(remoteStage)) {
            return;
        }
        JSONObject status = lastStatus();
        if (isLocallyRecovered(status)) {
            Log.d(TAG, "Ignoring stale remote stage " + remoteStage + " for recovered turn " + clientTurnId);
            return;
        }
        String remoteTranscript = remote.optString("user_transcript", "").trim();
        boolean transcriptChanged = remote.has("user_transcript")
                && !remoteTranscript.equals(status.optString("user_transcript", "").trim());
        if (remoteStage.equals(status.optString("remote_stage", "")) && !transcriptChanged) {
            return;
        }
        Json.put(status, "turn_id", clientTurnId);
        Json.put(status, "remote_stage", remoteStage);
        Json.put(status, "server_turn_status", remote);
        if (remote.has("user_transcript")) {
            Json.put(status, "user_transcript", remote.optString("user_transcript", ""));
        }
        Json.put(status, "codex_running", "codex_running".equals(remoteStage));
        if (isAcceptedRemoteStage(remoteStage)) {
            JSONObject arrivalCue = playArrivalCueOnce(clientTurnId, remoteStage);
            Json.put(status, "sent_cue", arrivalCue);
            Json.put(status, "arrival_cue", arrivalCue);
            Json.put(status, "accepted_chime", arrivalCue);
            mergeArrivalCue(status, arrivalCue);
        }
        if ("failed".equals(remoteStage)) {
            markStatus("failed", status, remote.optString("error_type", "remote_failed"));
            return;
        }
        if ("codex_running".equals(remoteStage)) {
            markStatus("codex_running", status, null);
            return;
        }
        if ("stt_running".equals(remoteStage) || "tts_running".equals(remoteStage) || "upload_received".equals(remoteStage)) {
            markStatus(remoteStage, status, null);
        }
    }

    public void onReplyRecovered(JSONObject card, String recoverySource) {
        maybeRecoverTurnFromCard(lastStatus(), card, recoverySource);
    }

    private String turnStatusUrl(String clientTurnId) {
        String raw = settings.getPuckyTurnUrl();
        int queryIndex = raw.indexOf('?');
        String base = queryIndex >= 0 ? raw.substring(0, queryIndex) : raw;
        if (base.endsWith("/api/turn")) {
            base = base.substring(0, base.length() - "/api/turn".length()) + "/api/turn/status";
        } else if (base.endsWith("/turn")) {
            base = base.substring(0, base.length() - "/turn".length()) + "/turn/status";
        } else {
            base = base.replaceAll("/+$", "") + "/status";
        }
        return base + "?turn_id=" + clientTurnId;
    }

    private static boolean isRemoteTerminalStage(String stage) {
        return "completed".equals(stage) || "failed".equals(stage);
    }

    private static boolean isAcceptedRemoteStage(String stage) {
        return "upload_received".equals(stage)
                || "stt_running".equals(stage)
                || "codex_running".equals(stage)
                || "tts_running".equals(stage);
    }

    private JSONObject playReply(JSONObject card) throws CommandException {
        JSONObject args = new JSONObject();
        Json.put(args, "path", card.optString("audio_path", ""));
        Json.put(args, "title", card.optString("title", "Pucky reply"));
        Json.put(args, "source", "pucky.turn");
        return PlayerController.shared(context).play(args);
    }

    private boolean isUploadConfigured() {
        return !settings.getPuckyTurnUrl().isEmpty() && !settings.getPuckyTurnAuthToken().isEmpty();
    }

    private JSONObject baseStatus(String localSessionId, long startedMs, int audioBytes) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_status_item.v1");
        Json.put(out, "local_session_id", localSessionId);
        Json.put(out, "request_audio_bytes", audioBytes);
        Json.put(out, "latency_total_ms", Math.max(0L, System.currentTimeMillis() - startedMs));
        return out;
    }

    private void markStatus(String state, JSONObject detail, String error) {
        if ("recording".equals(state) && isPostReleaseState(lastStatus().optString("state", ""))) {
            return;
        }
        JSONObject out = detail == null ? new JSONObject() : detail;
        Json.put(out, "state", state);
        Json.put(out, "visual_state", visualStateFor(state));
        Json.put(out, "updated_at", Instant.now().toString());
        if (error != null && !error.trim().isEmpty()) {
            Json.put(out, "error", error);
            Log.w(TAG, "Pucky turn " + state + " " + error);
        }
        upsertTurnHistory(state, out);
        prefs.edit().putString(LAST_STATUS, out.toString()).apply();
        WakeWordController.shared(context).onTurnStatusChanged(
                out.optString("turn_id", ""),
                state,
                out);
        PuckyState.get().setLifecycleEvent("pucky.turn." + state);
        PuckyState.get().broadcast(context);
    }

    private static boolean isPostReleaseState(String state) {
        return "discarded_silence".equals(state)
                || "uploading".equals(state)
                || "upload_received".equals(state)
                || "stt_running".equals(state)
                || "codex_running".equals(state)
                || "tts_running".equals(state)
                || "speaking".equals(state)
                || "completed".equals(state)
                || "upload_blocked".equals(state)
                || "failed".equals(state);
    }

    private synchronized void upsertTurnHistory(String state, JSONObject detail) {
        if (detail == null) {
            return;
        }
        String turnId = detail.optString("turn_id", "");
        String localSessionId = detail.optString("local_session_id", detail.optString("session_id", ""));
        if (turnId.trim().isEmpty() && localSessionId.trim().isEmpty()) {
            return;
        }
        String updatedAt = detail.optString("updated_at", Instant.now().toString());
        JSONArray history = turnHistoryArray();
        int existingIndex = findHistoryRecordIndex(history, turnId, localSessionId);
        JSONObject record = existingIndex >= 0 ? history.optJSONObject(existingIndex) : null;
        if (record == null) {
            record = new JSONObject();
            Json.put(record, "schema", "pucky.turn_history_item.v1");
            Json.put(record, "created_at", detail.optString("created_at", updatedAt));
            Json.put(record, "events", new JSONArray());
        }
        if (!turnId.trim().isEmpty()) {
            Json.put(record, "turn_id", turnId);
        }
        if (!localSessionId.trim().isEmpty()) {
            Json.put(record, "local_session_id", localSessionId);
        }
        Json.put(record, "updated_at", updatedAt);
        Json.put(record, "latest_state", state);
        Json.put(record, "latest_visual_state", detail.optString("visual_state", visualStateFor(state)));
        Json.put(record, "speech_detected", detail.optBoolean("speech_detected", record.optBoolean("speech_detected", false)));
        JSONObject gate = detail.optJSONObject("speech_gate");
        if (gate != null) {
            Json.put(record, "speech_gate", gate);
            Json.put(record, "vad_engine", gate.optString("vad_engine", record.optString("vad_engine", "")));
            Json.put(record, "vad_available", gate.optBoolean("vad_available", record.optBoolean("vad_available", false)));
            Json.put(record, "vad_probability", gate.optDouble("vad_probability", record.optDouble("vad_probability", 0.0)));
            Json.put(record, "max_vad_probability", gate.optDouble("max_vad_probability", record.optDouble("max_vad_probability", 0.0)));
            Json.put(record, "peak_amplitude", gate.optInt("peak_amplitude", record.optInt("peak_amplitude", 0)));
            Json.put(record, "speech_frames", gate.optInt("speech_frames", record.optInt("speech_frames", 0)));
            Json.put(record, "gate_latency_ms", gate.optLong("gate_latency_ms", record.optLong("gate_latency_ms", -1L)));
        }
        copyIfPresent(record, detail, "request_audio_bytes");
        copyIfPresent(record, detail, "trigger_source");
        copyIfPresent(record, detail, "user_transcript");
        copyIfPresent(record, detail, "wake_phrase_family");
        copyIfPresent(record, detail, "wake_phrase_detected");
        copyIfPresent(record, detail, "http_status");
        copyIfPresent(record, detail, "card_id");
        copyIfPresent(record, detail, "reply_card_saved");
        copyIfPresent(record, detail, "reply_text_chars");
        copyIfPresent(record, detail, "reply_audio_bytes");
        copyIfPresent(record, detail, "reply_audio_path");
        copyIfPresent(record, detail, "recovery_source");
        copyIfPresent(record, detail, "local_classifier_status");
        copyIfPresent(record, detail, "local_classifier_transcript");
        copyIfPresent(record, detail, "local_recipe_matched");
        copyIfPresent(record, detail, "local_recipe_id");
        copyIfPresent(record, detail, "keyword_action_status");
        copyIfPresent(record, detail, "pucky_clipboard_entry_id");
        copyIfPresent(record, detail, "latency_total_ms");
        copyIfPresent(record, detail, "latency_server_total_ms");
        copyIfPresent(record, detail, "sent_cue");
        copyIfPresent(record, detail, "arrival_cue_mode");
        copyIfPresent(record, detail, "arrival_cue");
        copyIfPresent(record, detail, "arrival_cue_attempted");
        copyIfPresent(record, detail, "arrival_cue_suppressed");
        copyIfPresent(record, detail, "arrival_cue_result");
        copyIfPresent(record, detail, "accepted_chime");
        copyIfPresent(record, detail, "reply_received_cue");
        copyIfPresent(record, detail, "reply_received_cue_attempted");
        copyIfPresent(record, detail, "reply_received_cue_suppressed");
        copyIfPresent(record, detail, "reply_received_cue_played");
        copyIfPresent(record, detail, "reply_received_cue_result");
        copyIfPresent(record, detail, "reply_received_cue_asset_name");
        copyIfPresent(record, detail, "reply_received_cue_asset_path");
        copyIfPresent(record, detail, "reply_received_cue_fallback_used");
        copyIfPresent(record, detail, "spoken_reply_playback_attempted");
        copyIfPresent(record, detail, "spoken_reply_playback_started");
        copyIfPresent(record, detail, "spoken_reply_playback_completed");
        copyIfPresent(record, detail, "archived");
        copyIfPresent(record, detail, "debug_injected");
        if (detail.has("server_telemetry")) {
            Json.put(record, "server_telemetry", detail.opt("server_telemetry"));
        }
        copyIfPresent(record, detail, "error");
        Json.put(record, "playback_mode", detail.optString("reply_mode", settings.getPuckyTurnReplyMode()));
        Json.put(record, "spoken_reply_enabled", detail.optBoolean("spoken_reply_enabled", settings.isPuckyTurnSpokenReplyEnabled()));

        JSONArray events = record.optJSONArray("events");
        if (events == null) {
            events = new JSONArray();
        }
        JSONObject event = new JSONObject();
        Json.put(event, "state", state);
        Json.put(event, "visual_state", detail.optString("visual_state", visualStateFor(state)));
        Json.put(event, "updated_at", updatedAt);
        copyIfPresent(event, detail, "phase");
        copyIfPresent(event, detail, "trigger_source");
        copyIfPresent(event, detail, "user_transcript");
        copyIfPresent(event, detail, "remote_stage");
        copyIfPresent(event, detail, "card_id");
        copyIfPresent(event, detail, "reply_card_saved");
        copyIfPresent(event, detail, "recovery_source");
        copyIfPresent(event, detail, "error");
        copyIfPresent(event, detail, "http_status");
        copyIfPresent(event, detail, "sent_cue");
        copyIfPresent(event, detail, "arrival_cue");
        copyIfPresent(event, detail, "accepted_chime");
        copyIfPresent(event, detail, "reply_received_cue");
        copyIfPresent(event, detail, "reply_received_cue_attempted");
        copyIfPresent(event, detail, "reply_received_cue_suppressed");
        copyIfPresent(event, detail, "reply_received_cue_played");
        copyIfPresent(event, detail, "reply_received_cue_result");
        copyIfPresent(event, detail, "spoken_reply_playback_attempted");
        copyIfPresent(event, detail, "spoken_reply_playback_started");
        copyIfPresent(event, detail, "spoken_reply_playback_completed");
        JSONObject eventGate = detail.optJSONObject("speech_gate");
        if (eventGate != null) {
            Json.put(event, "vad_probability", eventGate.optDouble("vad_probability", 0.0));
            Json.put(event, "speech_frames", eventGate.optInt("speech_frames", 0));
            Json.put(event, "gate_latency_ms", eventGate.optLong("gate_latency_ms", -1L));
        }
        Json.add(events, event);
        Json.put(record, "events", trimEvents(events));

        JSONArray next = new JSONArray();
        Json.add(next, record);
        for (int i = 0; i < history.length() && next.length() < MAX_HISTORY_ITEMS; i++) {
            if (i != existingIndex) {
                JSONObject item = history.optJSONObject(i);
                if (item != null) {
                    Json.add(next, item);
                }
            }
        }
        prefs.edit().putString(HISTORY, next.toString()).commit();
    }

    synchronized JSONArray historySnapshotArray() {
        return turnHistoryArray();
    }

    synchronized boolean archiveHistoryRecord(String turnId, String localSessionId) {
        JSONArray history = turnHistoryArray();
        int index = findHistoryRecordIndex(history, turnId, localSessionId);
        if (index < 0) {
            return false;
        }
        JSONObject record = history.optJSONObject(index);
        if (record == null) {
            return false;
        }
        Json.put(record, "archived", true);
        Json.put(record, "updated_at", Instant.now().toString());
        prefs.edit().putString(HISTORY, history.toString()).commit();
        return true;
    }

    private synchronized int clearDebugInjectedHistory() {
        JSONArray history = turnHistoryArray();
        JSONArray next = new JSONArray();
        int removed = 0;
        for (int i = 0; i < history.length(); i++) {
            JSONObject item = history.optJSONObject(i);
            if (item == null) {
                continue;
            }
            if (item.optBoolean("debug_injected", false)) {
                removed++;
                continue;
            }
            Json.add(next, item);
        }
        prefs.edit().putString(HISTORY, next.toString()).commit();
        JSONObject last = lastStatus();
        if (last.optBoolean("debug_injected", false)) {
            prefs.edit().remove(LAST_STATUS).apply();
        }
        return removed;
    }

    private JSONArray turnHistoryArray() {
        try {
            return new JSONArray(prefs.getString(HISTORY, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private static JSONObject findHistoryRecord(JSONArray history, String turnId, String localSessionId) {
        int index = findHistoryRecordIndex(history, turnId, localSessionId);
        return index < 0 ? null : history.optJSONObject(index);
    }

    private static int findHistoryRecordIndex(JSONArray history, String turnId, String localSessionId) {
        String cleanTurnId = turnId == null ? "" : turnId.trim();
        String cleanLocalSessionId = localSessionId == null ? "" : localSessionId.trim();
        for (int i = 0; i < history.length(); i++) {
            JSONObject item = history.optJSONObject(i);
            if (item == null) {
                continue;
            }
            if (!cleanTurnId.isEmpty() && cleanTurnId.equals(item.optString("turn_id", ""))) {
                return i;
            }
            if (!cleanLocalSessionId.isEmpty() && cleanLocalSessionId.equals(item.optString("local_session_id", ""))) {
                return i;
            }
        }
        return -1;
    }

    private static JSONArray trimEvents(JSONArray events) {
        JSONArray out = new JSONArray();
        int start = Math.max(0, events.length() - MAX_HISTORY_EVENTS);
        for (int i = start; i < events.length(); i++) {
            Object item = events.opt(i);
            if (item != null) {
                Json.add(out, item);
            }
        }
        return out;
    }

    private static void copyIfPresent(JSONObject target, JSONObject source, String key) {
        if (source.has(key)) {
            Json.put(target, key, source.opt(key));
        }
    }

    private JSONObject lastStatus() {
        try {
            return new JSONObject(prefs.getString(LAST_STATUS, "{}"));
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private JSONObject maybeRecoverLastStatus(JSONObject last, String recoverySource) {
        if (!shouldAttemptReplyRecovery(last)) {
            return last;
        }
        JSONObject card = findRecoveredReplyCard(last);
        if (card == null) {
            return last;
        }
        JSONObject recovered = maybeRecoverTurnFromCard(last, card, recoverySource);
        return recovered == null ? last : recovered;
    }

    private JSONObject maybeRecoverTurnFromCard(JSONObject currentStatus, JSONObject card, String recoverySource) {
        if (card == null) {
            return null;
        }
        JSONObject status = currentStatus == null ? new JSONObject() : currentStatus;
        String turnId = card.optString("turn_id", "").trim();
        String sessionId = card.optString("session_id", "").trim();
        String lastTurnId = status.optString("turn_id", "").trim();
        String lastSessionId = status.optString("local_session_id", status.optString("session_id", "")).trim();
        boolean turnMatches = !turnId.isEmpty() && turnId.equals(lastTurnId);
        boolean sessionMatches = !sessionId.isEmpty() && sessionId.equals(lastSessionId);
        if (!turnMatches && !sessionMatches) {
            return null;
        }
        if (isLocallyRecovered(status) && !shouldAttemptReplyRecovery(status)) {
            return status;
        }
        String pollTurnId = turnId.isEmpty() ? lastTurnId : turnId;
        stopTurnStatusPoll(pollTurnId);
        JSONObject recovered;
        try {
            recovered = new JSONObject(status.toString());
        } catch (Exception ignored) {
            recovered = new JSONObject();
        }
        if (!turnId.isEmpty()) {
            Json.put(recovered, "turn_id", turnId);
        }
        if (!sessionId.isEmpty()) {
            Json.put(recovered, "local_session_id", sessionId);
        }
        Json.put(recovered, "card_id", card.optString("card_id", ""));
        Json.put(recovered, "reply_card_saved", true);
        String audioPath = card.optString("audio_path", "").trim();
        if (!audioPath.isEmpty()) {
            Json.put(recovered, "reply_audio_path", audioPath);
        }
        Json.put(recovered, "phase", "reply_recovered");
        Json.put(recovered, "recovery_source", recoverySource);
        Json.put(recovered, "uploading", false);
        Json.put(recovered, "stt_running", false);
        Json.put(recovered, "codex_running", false);
        Json.put(recovered, "tts_running", false);
        Json.put(recovered, "failed", false);
        recovered.remove("error");
        recovered.remove("remote_stage");
        recovered.remove("server_turn_status");
        String nextState = isRecoveredReplyPlaying(card) ? "speaking" : "completed";
        Json.put(recovered, "speaking", "speaking".equals(nextState));
        Log.d(TAG, "Recovered turn " + (turnId.isEmpty() ? lastTurnId : turnId)
                + " from " + recoverySource + "; clearing stale thinking state");
        markStatus(nextState, recovered, null);
        return lastStatus();
    }

    private JSONObject findRecoveredReplyCard(JSONObject status) {
        if (status == null) {
            return null;
        }
        String turnId = status.optString("turn_id", "").trim();
        String sessionId = status.optString("local_session_id", status.optString("session_id", "")).trim();
        JSONArray cards = replyCards.snapshot().optJSONArray("cards");
        if (cards == null) {
            return null;
        }
        for (int i = 0; i < cards.length(); i++) {
            JSONObject card = cards.optJSONObject(i);
            if (card == null) {
                continue;
            }
            if (!turnId.isEmpty() && turnId.equals(card.optString("turn_id", "").trim())) {
                return card;
            }
            if (!sessionId.isEmpty() && sessionId.equals(card.optString("session_id", "").trim())) {
                return card;
            }
        }
        return null;
    }

    private boolean isRecoveredReplyPlaying(JSONObject card) {
        if (card == null) {
            return false;
        }
        JSONObject player = PlayerController.shared(context).state();
        if (!"pucky.turn".equals(player.optString("source", "")) || !player.optBoolean("is_playing", false)) {
            return false;
        }
        String cardPath = card.optString("audio_path", "").trim();
        String playerPath = player.optString("path", "").trim();
        return !cardPath.isEmpty() && cardPath.equals(playerPath);
    }

    private static boolean shouldAttemptReplyRecovery(JSONObject status) {
        if (status == null) {
            return false;
        }
        if (isLocallyRecovered(status)) {
            return status.optBoolean("uploading", false)
                    || status.optBoolean("stt_running", false)
                    || status.optBoolean("codex_running", false)
                    || status.optBoolean("tts_running", false)
                    || !status.optString("remote_stage", "").trim().isEmpty()
                    || "thinking".equals(status.optString("visual_state", "").trim());
        }
        String state = status.optString("state", "");
        return "uploading".equals(state)
                || "stt_running".equals(state)
                || "codex_running".equals(state)
                || "tts_running".equals(state)
                || "failed".equals(state);
    }

    private static boolean isLocallyRecovered(JSONObject status) {
        if (status == null) {
            return false;
        }
        if (status.optBoolean("reply_card_saved", false)) {
            return true;
        }
        return !status.optString("reply_audio_path", "").trim().isEmpty()
                || !status.optString("card_id", "").trim().isEmpty();
    }

    private static JSONObject indicatorJson(JSONObject last, JSONObject voice, JSONObject player) {
        String lastState = last == null ? "" : last.optString("state", "");
        String remoteStage = last == null ? "" : last.optString("remote_stage", "");
        String source = player == null ? "" : player.optString("source", "");
        JSONObject gate = last == null ? null : last.optJSONObject("speech_gate");
        boolean speechDetected = (last != null && last.optBoolean("speech_detected", false))
                || (gate != null && gate.optBoolean("speech_detected", false));
        boolean sttRunning = "stt_running".equals(lastState) || "stt_running".equals(remoteStage);
        boolean codexRunning = "codex_running".equals(lastState) || "codex_running".equals(remoteStage) || (last != null && last.optBoolean("codex_running", false));
        boolean ttsRunning = "tts_running".equals(lastState) || "tts_running".equals(remoteStage);
        boolean uploading = "uploading".equals(lastState) || "upload_received".equals(lastState) || "upload_received".equals(remoteStage) || sttRunning || ttsRunning;
        boolean speaking = "pucky.turn".equals(source) && player != null && player.optBoolean("is_playing", false);
        boolean failed = "failed".equals(lastState);
        boolean postRelease = uploading || sttRunning || codexRunning || ttsRunning || speaking || failed;
        boolean micOn = !postRelease
                && ("armed".equals(lastState) || "recording".equals(lastState))
                && voice != null
                && voice.optBoolean("mic_on", "recording".equals(voice.optString("state", "")));
        boolean hearing = micOn && speechDetected;
        String state = "idle";
        if (speaking) {
            state = "speaking";
        } else if (codexRunning) {
            state = "codex_running";
        } else if (uploading) {
            state = sttRunning ? "stt_running" : (ttsRunning ? "tts_running" : "uploading");
        } else if (micOn && speechDetected) {
            state = "recording";
        } else if (micOn) {
            state = "armed";
        } else if ("discarded_silence".equals(lastState)) {
            state = "discarded_silence";
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_indicator.v1");
        Json.put(out, "state", state);
        Json.put(out, "visual_state", visualStateFor(state));
        Json.put(out, "mic_on", micOn);
        Json.put(out, "hearing", hearing);
        Json.put(out, "speech_detected", speechDetected);
        Json.put(out, "speech_gate", gate == null ? JSONObject.NULL : gate);
        Json.put(out, "vad_engine", gate == null ? "" : gate.optString("vad_engine", ""));
        Json.put(out, "vad_available", gate != null && gate.optBoolean("vad_available", false));
        Json.put(out, "vad_probability", gate == null ? 0.0 : gate.optDouble("vad_probability", 0.0));
        Json.put(out, "max_vad_probability", gate == null ? 0.0 : gate.optDouble("max_vad_probability", 0.0));
        Json.put(out, "speech_frames", gate == null ? 0 : gate.optInt("speech_frames", 0));
        Json.put(out, "peak_amplitude", gate == null ? 0 : gate.optInt("peak_amplitude", 0));
        Json.put(out, "gate_latency_ms", gate == null ? -1L : gate.optLong("gate_latency_ms", -1L));
        Json.put(out, "uploading", uploading);
        Json.put(out, "stt_running", sttRunning);
        Json.put(out, "codex_running", codexRunning);
        Json.put(out, "tts_running", ttsRunning);
        Json.put(out, "speaking", speaking);
        Json.put(out, "failed", failed);
        Json.put(out, "active", micOn || uploading || codexRunning || speaking);
        Json.put(out, "remote_stage", remoteStage);
        Json.put(out, "trigger_source", last == null ? "" : last.optString("trigger_source", ""));
        Json.put(out, "amplitude", voice == null ? 0 : voice.optInt("amplitude", 0));
        Json.put(out, "elapsed_ms", voice == null ? 0 : voice.optLong("elapsed_ms", 0L));
        return out;
    }

    private static String visualStateFor(String state) {
        if ("armed".equals(state)) return "armed";
        if ("recording".equals(state)) return "recording";
        if ("uploading".equals(state) || "upload_received".equals(state)
                || "stt_running".equals(state) || "tts_running".equals(state)) return "uploading";
        if ("codex_running".equals(state)) return "thinking";
        if ("speaking".equals(state)) return "speaking";
        if ("failed".equals(state)) return "idle";
        return "idle";
    }

    private void playRecordingStartHaptic() {
        buzzOneShot(RECORDING_START_HAPTIC_MS, HAPTIC_AMPLITUDE);
    }

    private void playRecordingStopHaptic() {
        buzzOneShot(RECORDING_STOP_HAPTIC_MS, HAPTIC_AMPLITUDE);
    }

    private void playArrivalCueHaptic() {
        buzzOneShot(ARRIVAL_CUE_HAPTIC_MS, HAPTIC_AMPLITUDE);
    }

    private JSONObject playArrivalCueOnce(String turnId, String trigger) {
        JSONObject out = new JSONObject();
        String arrivalCueMode = settings.getPuckyTurnArrivalCueMode();
        Json.put(out, "schema", "pucky.turn_arrival_cue.v1");
        Json.put(out, "turn_id", turnId);
        Json.put(out, "trigger", trigger);
        Json.put(out, "arrival_cue_mode", arrivalCueMode);
        Json.put(out, "arrival_cue_attempted", false);
        Json.put(out, "arrival_cue_suppressed", false);
        Json.put(out, "arrival_cue_result", "");
        Json.put(out, "accepted_chime_enabled", settings.isPuckyTurnAcceptedChimeEnabled());
        Json.put(out, "accepted_chime_attempted", false);
        Json.put(out, "accepted_chime_suppressed", false);
        if (turnId == null || turnId.trim().isEmpty()) {
            Json.put(out, "played", false);
            Json.put(out, "reason", "missing_turn_id");
            Json.put(out, "arrival_cue_result", "missing_turn_id");
            return out;
        }
        synchronized (pollLock) {
            if (turnId.equals(acceptedChimedTurnId)) {
                Json.put(out, "played", false);
                Json.put(out, "reason", "already_played");
                Json.put(out, "arrival_cue_result", "already_played");
                return out;
            }
            acceptedChimedTurnId = turnId;
        }
        JSONObject cue = playSentCue(trigger);
        mergeArrivalCue(out, cue);
        return out;
    }

    private JSONObject playSentCue(String trigger) {
        JSONObject out = new JSONObject();
        String arrivalCueMode = settings.getPuckyTurnArrivalCueMode();
        boolean playHaptic = SettingsStore.PUCKY_TURN_ARRIVAL_CUE_HAPTIC.equals(arrivalCueMode)
                || SettingsStore.PUCKY_TURN_ARRIVAL_CUE_HAPTIC_AND_CHIME.equals(arrivalCueMode);
        boolean playChime = SettingsStore.PUCKY_TURN_ARRIVAL_CUE_CHIME.equals(arrivalCueMode)
                || SettingsStore.PUCKY_TURN_ARRIVAL_CUE_HAPTIC_AND_CHIME.equals(arrivalCueMode);
        Json.put(out, "schema", "pucky.turn_arrival_cue_playback.v1");
        Json.put(out, "trigger", trigger);
        Json.put(out, "arrival_cue_mode", arrivalCueMode);
        Json.put(out, "arrival_cue_attempted", false);
        Json.put(out, "arrival_cue_suppressed", false);
        Json.put(out, "arrival_cue_result", "");
        Json.put(out, "accepted_chime_enabled", settings.isPuckyTurnAcceptedChimeEnabled());
        Json.put(out, "accepted_chime_attempted", false);
        Json.put(out, "accepted_chime_suppressed", false);
        Json.put(out, "haptic_attempted", false);
        Json.put(out, "haptic_played", false);
        Json.put(out, "chime_attempted", false);
        Json.put(out, "chime_played", false);
        if (!playHaptic && !playChime) {
            Json.put(out, "played", false);
            Json.put(out, "reason", "disabled");
            Json.put(out, "arrival_cue_suppressed", true);
            Json.put(out, "arrival_cue_result", "disabled");
            Json.put(out, "accepted_chime_suppressed", true);
            return out;
        }
        Json.put(out, "arrival_cue_attempted", true);
        if (playHaptic) {
            Json.put(out, "haptic_attempted", true);
            playArrivalCueHaptic();
            Json.put(out, "haptic_played", true);
            Json.put(out, "haptic_duration_ms", ARRIVAL_CUE_HAPTIC_MS);
            Json.put(out, "haptic_amplitude", HAPTIC_AMPLITUDE);
        }
        if (playChime) {
            JSONObject playback = new RecipeDevicePrimitiveExecutor(context)
                    .playTurnSentChime("pucky.turn_arrival_cue_playback.v1");
            Json.put(out, "accepted_chime_attempted", true);
            Json.put(out, "chime_attempted", true);
            mergeAcceptedChime(out, playback);
            Json.put(out, "chime_played", playback.optBoolean("played", false));
        }
        Json.put(out, "played", out.optBoolean("haptic_played", false) || out.optBoolean("chime_played", false));
        Json.put(out, "arrival_cue_result", out.optBoolean("played", false) ? "played" : out.optString("reason", ""));
        return out;
    }

    private JSONObject playReplyReceivedCueOnce(String turnId, String trigger) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_reply_received_cue.v1");
        Json.put(out, "turn_id", turnId);
        Json.put(out, "trigger", trigger);
        Json.put(out, "reply_received_cue_attempted", false);
        Json.put(out, "reply_received_cue_suppressed", false);
        Json.put(out, "reply_received_cue_result", "");
        if (turnId == null || turnId.trim().isEmpty()) {
            Json.put(out, "played", false);
            Json.put(out, "reason", "missing_turn_id");
            Json.put(out, "reply_received_cue_result", "missing_turn_id");
            return out;
        }
        synchronized (pollLock) {
            if (turnId.equals(replyReceivedCuedTurnId)) {
                Json.put(out, "played", false);
                Json.put(out, "reason", "already_played");
                Json.put(out, "reply_received_cue_result", "already_played");
                return out;
            }
            replyReceivedCuedTurnId = turnId;
        }
        JSONObject cue = playReplyReceivedCue(trigger);
        mergeReplyReceivedCue(out, cue);
        return out;
    }

    private JSONObject playReplyReceivedCue(String trigger) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_reply_received_cue_playback.v1");
        Json.put(out, "trigger", trigger);
        Json.put(out, "reply_received_cue_attempted", true);
        Json.put(out, "reply_received_cue_suppressed", false);
        Json.put(out, "reply_received_cue_result", "");
        JSONObject playback = new RecipeDevicePrimitiveExecutor(context)
                .playTurnReceivedChime("pucky.turn_reply_received_cue_playback.v1");
        mergeAcceptedChime(out, playback);
        Json.put(out, "played", playback.optBoolean("played", false));
        Json.put(out, "reply_received_cue_played", playback.optBoolean("played", false));
        Json.put(out, "reply_received_cue_result", playback.optBoolean("played", false) ? "played" : playback.optString("reason", ""));
        Json.put(out, "reply_received_cue_asset_name", playback.optString("asset_name", ""));
        Json.put(out, "reply_received_cue_asset_path", playback.optString("asset_path", ""));
        Json.put(out, "reply_received_cue_fallback_used", playback.optBoolean("fallback_used", false));
        return out;
    }

    private JSONObject suppressedReplyReceivedCue(String turnId, String reason) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_reply_received_cue.v1");
        Json.put(out, "turn_id", turnId);
        Json.put(out, "trigger", "reply_saved");
        Json.put(out, "reply_received_cue_attempted", false);
        Json.put(out, "reply_received_cue_suppressed", true);
        Json.put(out, "reply_received_cue_played", false);
        Json.put(out, "reply_received_cue_result", reason);
        Json.put(out, "played", false);
        Json.put(out, "reason", reason);
        Json.put(out, "reply_received_cue_fallback_used", false);
        return out;
    }

    private static void mergeArrivalCue(JSONObject target, JSONObject source) {
        copyIfPresent(target, source, "arrival_cue_mode");
        copyIfPresent(target, source, "arrival_cue_attempted");
        copyIfPresent(target, source, "arrival_cue_suppressed");
        copyIfPresent(target, source, "arrival_cue_result");
        copyIfPresent(target, source, "haptic_attempted");
        copyIfPresent(target, source, "haptic_played");
        copyIfPresent(target, source, "haptic_duration_ms");
        copyIfPresent(target, source, "haptic_amplitude");
        copyIfPresent(target, source, "chime_attempted");
        copyIfPresent(target, source, "chime_played");
        mergeAcceptedChime(target, source);
    }

    private static void mergeReplyReceivedCue(JSONObject target, JSONObject source) {
        copyIfPresent(target, source, "reply_received_cue_attempted");
        copyIfPresent(target, source, "reply_received_cue_suppressed");
        copyIfPresent(target, source, "reply_received_cue_played");
        copyIfPresent(target, source, "reply_received_cue_result");
        copyIfPresent(target, source, "reply_received_cue_asset_name");
        copyIfPresent(target, source, "reply_received_cue_asset_path");
        copyIfPresent(target, source, "reply_received_cue_fallback_used");
        mergeAcceptedChime(target, source);
    }

    private static void mergeAcceptedChime(JSONObject target, JSONObject source) {
        Json.put(target, "played", source.optBoolean("played", false));
        Json.put(target, "reason", source.optString("reason", ""));
        copyIfPresent(target, source, "asset_name");
        copyIfPresent(target, source, "asset_path");
        copyIfPresent(target, source, "fallback_used");
        copyIfPresent(target, source, "player");
        copyIfPresent(target, source, "stream");
        copyIfPresent(target, source, "usage");
        copyIfPresent(target, source, "tone");
        copyIfPresent(target, source, "duration_ms");
        copyIfPresent(target, source, "asset_error");
        copyIfPresent(target, source, "fallback");
        copyIfPresent(target, source, "error");
    }

    private void buzzOneShot(long millis, int amplitude) {
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(Math.max(1L, millis), Math.max(1, Math.min(255, amplitude))));
            } else {
                vibrator.vibrate(Math.max(1L, millis));
            }
        } catch (RuntimeException ignored) {
        }
    }

    private static String generateClientTurnId() {
        return "pucky_" + UUID.randomUUID().toString().replace("-", "");
    }

    private static void copyCaptureMetadata(JSONObject target, JSONObject capture) {
        if (capture == null) {
            return;
        }
        copyIfPresent(target, capture, "trigger_source");
        copyIfPresent(target, capture, "wake_phrase_family");
        copyIfPresent(target, capture, "wake_phrase_detected");
    }

    private static JSONObject reasonArgs(String reason) {
        JSONObject out = new JSONObject();
        Json.put(out, "reason", reason);
        return out;
    }

    private static byte[] readAll(File file) throws CommandException {
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] data = new byte[(int) file.length()];
            int offset = 0;
            while (offset < data.length) {
                int read = input.read(data, offset, data.length - offset);
                if (read < 0) break;
                offset += read;
            }
            return data;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                "Unable to read captured audio: " + exc.getMessage());
        }
    }

    private static boolean deleteQuietly(File file) {
        try {
            return file != null && file.exists() && file.delete();
        } catch (RuntimeException ignored) {
            return false;
        }
    }
}
