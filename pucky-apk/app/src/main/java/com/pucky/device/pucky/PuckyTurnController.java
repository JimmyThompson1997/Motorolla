package com.pucky.device.pucky;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.net.Ipv4FirstDns;
import com.pucky.device.player.PlayerController;
import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.speech.RecipeDevicePrimitiveExecutor;
import com.pucky.device.util.Json;

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
    private static final int HAPTIC_AMPLITUDE = 220;
    private static final MediaType AUDIO_WAV = MediaType.get("audio/wav");
    private static PuckyTurnController shared;

    private final Context context;
    private final SettingsStore settings;
    private final SharedPreferences prefs;
    private final OkHttpClient http = new OkHttpClient.Builder().dns(Ipv4FirstDns.INSTANCE).build();
    private final Object pollLock = new Object();
    private volatile String activePollTurnId = "";
    private volatile boolean pollActive = false;
    private volatile String acceptedChimedTurnId = "";

    public static synchronized PuckyTurnController shared(Context context) {
        if (shared == null) {
            shared = new PuckyTurnController(context.getApplicationContext());
        }
        return shared;
    }

    public PuckyTurnController(Context context) {
        this.context = context.getApplicationContext();
        this.settings = new SettingsStore(this.context);
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public JSONObject status() {
        JSONObject voice = WalkieAudioCaptureController.shared(context).status();
        JSONObject last = lastStatus();
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
        return out;
    }

    public JSONObject settingsGet() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_settings.v1");
        Json.put(out, "reply_mode", settings.getPuckyTurnReplyMode());
        Json.put(out, "spoken_reply_enabled", settings.isPuckyTurnSpokenReplyEnabled());
        JSONArray modes = new JSONArray();
        Json.add(modes, SettingsStore.PUCKY_TURN_REPLY_CARD_ONLY);
        Json.add(modes, SettingsStore.PUCKY_TURN_REPLY_CARD_AND_SPOKEN);
        Json.put(out, "modes", modes);
        return out;
    }

    public JSONObject settingsSet(JSONObject args) {
        String mode = args.optString("reply_mode", args.optString("mode", SettingsStore.PUCKY_TURN_REPLY_CARD_ONLY));
        settings.setPuckyTurnReplyMode(mode);
        return settingsGet();
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

    public JSONObject start(JSONObject args) throws CommandException {
        String clientTurnId = generateClientTurnId();
        String localSessionId = clientTurnId;
        final boolean feedback = args.optBoolean("feedback", true);
        JSONObject startArgs = new JSONObject();
        Json.put(startArgs, "format", "wav");
        Json.put(startArgs, "session_id", localSessionId);
        Json.put(startArgs, "turn_id", clientTurnId);
        Json.put(startArgs, "max_duration_ms", args.optInt("max_duration_ms", 60000));
        Json.put(startArgs, "sample_tag", "pucky_turn");
        Json.put(startArgs, "feedback", false);
        JSONObject out = WalkieAudioCaptureController.shared(context).start(startArgs, speechGateStatus -> {
            JSONObject status = new JSONObject();
            Json.put(status, "schema", "pucky.turn_status_item.v1");
            Json.put(status, "state", "recording");
            Json.put(status, "phase", "speech_detected");
            Json.put(status, "local_session_id", localSessionId);
            Json.put(status, "turn_id", clientTurnId);
            Json.put(status, "speech_gate", speechGateStatus);
            Json.put(status, "speech_detected", true);
            markStatus("recording", status, null);
        });
        if (feedback) {
            playRecordingStartHaptic();
        }
        Json.put(out, "turn_id", clientTurnId);
        Json.put(out, "local_session_id", localSessionId);
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
            Json.put(uploading, "phase", "upload_started");
            markStatus("uploading", uploading, null);
            submitAsync(localSessionId, clientTurnId, audioBytes);
        } catch (CommandException exc) {
            JSONObject failed = baseStatus(fallbackLocalSessionId, finalizeStartedMs, 0);
            Json.put(failed, "turn_id", clientTurnId);
            Json.put(failed, "speech_gate", speechGate);
            Json.put(failed, "speech_detected", true);
            markStatus("failed", failed, exc.getMessage());
        } catch (Exception exc) {
            JSONObject failed = baseStatus(fallbackLocalSessionId, finalizeStartedMs, 0);
            Json.put(failed, "turn_id", clientTurnId);
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
                    Json.put(status, "accepted_chime", playAcceptedChimeOnce(clientTurnId, "http_response_success"));
                    try {
                        PuckyTurnResponse parsed = PuckyTurnResponse.fromJson(responseText);
                        JSONObject card = PuckyFeedController.shared(context).upsertTurnResponse(localSessionId, parsed);
                        String sessionId = card.optString("session_id", "");
                        String turnId = parsed.turnId().isEmpty() ? sessionId : parsed.turnId();
                        Json.put(status, "session_id", sessionId);
                        Json.put(status, "turn_id", turnId);
                        Json.put(status, "card_id", card.optString("card_id", parsed.cardId()));
                        Json.put(status, "reply_audio_path", card.optString("audio_path", ""));
                        Json.put(status, "reply_text_chars", parsed.text().length());
                        Json.put(status, "reply_audio_bytes", parsed.audioBytes().length);
                        Json.put(status, "reply_card_saved", true);
                        Json.put(status, "reply_mode", replyModeAtUpload);
                        Json.put(status, "spoken_reply_enabled", spokenReplyEnabledAtUpload);
                        Json.put(status, "has_html", parsed.hasHtml());
                        Json.put(status, "server_telemetry", parsed.telemetry());
                        Json.put(status, "latency_server_total_ms", parsed.telemetry().optInt("total_ms", -1));
                        stopTurnStatusPoll(clientTurnId);
                        if (spokenReplyEnabledAtUpload) {
                            if (parsed.hasAudio()) {
                                JSONObject playerState = playReply(card);
                                Json.put(status, "player_state", playerState);
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
        if (remoteStage.equals(status.optString("remote_stage", ""))) {
            return;
        }
        Json.put(status, "turn_id", clientTurnId);
        Json.put(status, "remote_stage", remoteStage);
        Json.put(status, "server_turn_status", remote);
        Json.put(status, "codex_running", "codex_running".equals(remoteStage));
        if (isAcceptedRemoteStage(remoteStage)) {
            Json.put(status, "accepted_chime", playAcceptedChimeOnce(clientTurnId, remoteStage));
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
            Json.put(record, "created_at", updatedAt);
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
        copyIfPresent(record, detail, "http_status");
        copyIfPresent(record, detail, "reply_text_chars");
        copyIfPresent(record, detail, "reply_audio_bytes");
        copyIfPresent(record, detail, "reply_audio_path");
        copyIfPresent(record, detail, "local_classifier_status");
        copyIfPresent(record, detail, "local_classifier_transcript");
        copyIfPresent(record, detail, "local_recipe_matched");
        copyIfPresent(record, detail, "local_recipe_id");
        copyIfPresent(record, detail, "keyword_action_status");
        copyIfPresent(record, detail, "pucky_clipboard_entry_id");
        copyIfPresent(record, detail, "latency_total_ms");
        copyIfPresent(record, detail, "latency_server_total_ms");
        copyIfPresent(record, detail, "accepted_chime");
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
        copyIfPresent(event, detail, "remote_stage");
        copyIfPresent(event, detail, "error");
        copyIfPresent(event, detail, "http_status");
        copyIfPresent(event, detail, "accepted_chime");
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

    private JSONObject playAcceptedChimeOnce(String turnId, String trigger) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_accepted_chime.v1");
        Json.put(out, "turn_id", turnId);
        Json.put(out, "trigger", trigger);
        if (turnId == null || turnId.trim().isEmpty()) {
            Json.put(out, "played", false);
            Json.put(out, "reason", "missing_turn_id");
            return out;
        }
        synchronized (pollLock) {
            if (turnId.equals(acceptedChimedTurnId)) {
                Json.put(out, "played", false);
                Json.put(out, "reason", "already_played");
                return out;
            }
            acceptedChimedTurnId = turnId;
        }
        JSONObject chime = playAcceptedChime(trigger);
        Json.put(out, "played", chime.optBoolean("played", false));
        Json.put(out, "reason", chime.optString("reason", ""));
        copyIfPresent(out, chime, "asset_name");
        copyIfPresent(out, chime, "asset_path");
        copyIfPresent(out, chime, "fallback_used");
        copyIfPresent(out, chime, "player");
        copyIfPresent(out, chime, "tone");
        copyIfPresent(out, chime, "duration_ms");
        return out;
    }

    private JSONObject playAcceptedChime(String trigger) {
        JSONObject out = new RecipeDevicePrimitiveExecutor(context)
                .playSuccessChime("pucky.turn_accepted_chime_playback.v1");
        Json.put(out, "trigger", trigger);
        return out;
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
