package com.pucky.device.pucky;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.net.Ipv4FirstDns;
import com.pucky.device.player.PlayerController;
import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.ui.ReplyCardStore;
import com.pucky.device.util.Json;
import com.pucky.device.voice.VoiceCaptureController;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
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
    private static final MediaType AUDIO_MP4 = MediaType.get("audio/mp4");
    private static final int SPEECH_GATE_THRESHOLD = VoiceCaptureController.VOICE_CAPTURE_AMPLITUDE_THRESHOLD;
    private static final long SPEECH_GATE_POLL_MS = 30L;
    private static final long SPEECH_GATE_STARTUP_GUARD_MS = 25L;
    private static PuckyTurnController shared;

    private final Context context;
    private final SettingsStore settings;
    private final SharedPreferences prefs;
    private final OkHttpClient http = new OkHttpClient.Builder().dns(Ipv4FirstDns.INSTANCE).build();
    private final Object pollLock = new Object();
    private final Object gateLock = new Object();
    private volatile String activePollTurnId = "";
    private volatile boolean pollActive = false;
    private volatile String activeGateTurnId = "";
    private volatile SpeechGate activeSpeechGate;
    private volatile boolean gatePollActive = false;

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
        JSONObject voice = VoiceCaptureController.shared(context).status();
        JSONObject last = lastStatus();
        SpeechGate activeGate = activeSpeechGate;
        if (activeGate != null && last.optString("turn_id", "").equals(activeGateTurnId)) {
            JSONObject liveGate = activeGate.statusJson(android.os.SystemClock.elapsedRealtime());
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
        Json.put(out, "configured", isConfigured());
        Json.put(out, "url", settings.getPuckyTurnUrl());
        Json.put(out, "speech_detected", indicator.optBoolean("speech_detected", false));
        Json.put(out, "peak_amplitude", indicator.optInt("peak_amplitude", 0));
        Json.put(out, "samples_over_threshold", indicator.optInt("samples_over_threshold", 0));
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

    public JSONObject start(JSONObject args) throws CommandException {
        requireConfigured();
        String clientTurnId = generateClientTurnId();
        JSONObject startArgs = new JSONObject();
        Json.put(startArgs, "format", "m4a");
        Json.put(startArgs, "session_id", clientTurnId);
        Json.put(startArgs, "audio_source", args.optString("audio_source", "mic"));
        Json.put(startArgs, "max_duration_ms", args.optInt("max_duration_ms", 60000));
        Json.put(startArgs, "sample_tag", "pucky_turn");
        Json.put(startArgs, "feedback", args.optBoolean("feedback", true));
        JSONObject out = VoiceCaptureController.shared(context).start(startArgs);
        String localSessionId = out.optString("session_id", "vc_" + clientTurnId);
        SpeechGate gate = new SpeechGate(android.os.SystemClock.elapsedRealtime(),
                SPEECH_GATE_THRESHOLD, SPEECH_GATE_STARTUP_GUARD_MS);
        Json.put(out, "turn_id", clientTurnId);
        Json.put(out, "local_session_id", localSessionId);
        Json.put(out, "speech_gate", gate.statusJson(android.os.SystemClock.elapsedRealtime()));
        Json.put(out, "speech_detected", false);
        markStatus("armed", out, null);
        startSpeechGatePoll(localSessionId, clientTurnId, gate);
        return out;
    }

    public JSONObject stop(JSONObject args) throws CommandException {
        requireConfigured();
        JSONObject voice = VoiceCaptureController.shared(context).status();
        JSONObject active = voice.optJSONObject("active_session");
        if (active == null) {
            stopSpeechGatePoll("");
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.turn_stop.v1");
            Json.put(out, "state", "idle");
            Json.put(out, "result", "no_active_capture");
            markStatus("idle", out, "no_capture");
            return out;
        }
        String localSessionId = active.optString("session_id", "pucky_" + Long.toHexString(System.currentTimeMillis()));
        JSONObject last = lastStatus();
        String clientTurnId = activeGateTurnId.isEmpty() ? last.optString("turn_id", generateClientTurnId()) : activeGateTurnId;
        SpeechGate gate = stopSpeechGatePoll(clientTurnId);
        JSONObject speechGate = gate == null ? new JSONObject() : gate.statusJson(android.os.SystemClock.elapsedRealtime());
        boolean speechDetected = gate != null && gate.speechDetected();
        String reason = args.optString("reason", "button_release");
        boolean feedback = args.optBoolean("feedback", true);
        if (!speechDetected) {
            JSONObject stopArgs = reasonArgs(reason);
            Json.put(stopArgs, "feedback", false);
            JSONObject discarded = VoiceCaptureController.shared(context).discard(stopArgs);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.turn_stop.v1");
            Json.put(out, "state", "discarded_silence");
            Json.put(out, "phase", "silence_discarded");
            Json.put(out, "result", "discarded_silence");
            Json.put(out, "local_session_id", localSessionId);
            Json.put(out, "turn_id", clientTurnId);
            Json.put(out, "speech_gate", speechGate);
            Json.put(out, "speech_detected", false);
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
        markStatus("uploading", out, null);
        Thread worker = new Thread(() -> finishStopAndUpload(localSessionId, clientTurnId, reason, feedback, speechGate),
                "PuckyTurnStopUpload");
        worker.setDaemon(true);
        worker.start();
        return out;
    }

    private void finishStopAndUpload(String fallbackLocalSessionId, String clientTurnId, String reason, boolean feedback, JSONObject speechGate) {
        long finalizeStartedMs = System.currentTimeMillis();
        try {
            JSONObject stopArgs = reasonArgs(reason);
            Json.put(stopArgs, "feedback", feedback);
            JSONObject stopped = VoiceCaptureController.shared(context).stop(stopArgs);
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
            Json.put(uploading, "phase", "upload_started");
            Json.put(uploading, "turn_id", clientTurnId);
            Json.put(uploading, "speech_gate", speechGate);
            Json.put(uploading, "speech_detected", true);
            Json.put(uploading, "capture_finalize_ms", Math.max(0L, System.currentTimeMillis() - finalizeStartedMs));
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
        Request request = new Request.Builder()
                .url(settings.getPuckyTurnUrl())
                .header("Authorization", "Bearer " + settings.getPuckyTurnAuthToken())
                .header("X-Pucky-Turn-Id", clientTurnId)
                .post(RequestBody.create(AUDIO_MP4, audioBytes))
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
                    try {
                        PuckyTurnResponse parsed = PuckyTurnResponse.fromJson(responseText);
                        JSONObject card = persistReplyCard(localSessionId, parsed);
                        String sessionId = card.optString("session_id", "");
                        String turnId = parsed.turnId().isEmpty() ? sessionId : parsed.turnId();
                        Json.put(status, "session_id", sessionId);
                        Json.put(status, "turn_id", turnId);
                        Json.put(status, "reply_audio_path", card.optString("audio_path", ""));
                        Json.put(status, "reply_text_chars", parsed.text().length());
                        Json.put(status, "reply_audio_bytes", parsed.audioBytes().length);
                        Json.put(status, "has_html", parsed.hasHtml());
                        Json.put(status, "server_telemetry", parsed.telemetry());
                        Json.put(status, "latency_server_total_ms", parsed.telemetry().optInt("total_ms", -1));
                        JSONObject playerState = playReply(card);
                        Json.put(status, "player_state", playerState);
                        stopTurnStatusPoll(clientTurnId);
                        markStatus("speaking", status, null);
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

    private void startSpeechGatePoll(String localSessionId, String clientTurnId, SpeechGate gate) {
        synchronized (gateLock) {
            activeGateTurnId = clientTurnId;
            activeSpeechGate = gate;
            gatePollActive = true;
        }
        Thread worker = new Thread(() -> {
            while (isSpeechGatePolling(clientTurnId)) {
                int amplitude = VoiceCaptureController.shared(context).sampleAmplitude();
                long now = android.os.SystemClock.elapsedRealtime();
                if (gate.sample(amplitude, now) && isSpeechGatePolling(clientTurnId)) {
                    JSONObject status = new JSONObject();
                    Json.put(status, "schema", "pucky.turn_status_item.v1");
                    Json.put(status, "state", "recording");
                    Json.put(status, "phase", "speech_detected");
                    Json.put(status, "local_session_id", localSessionId);
                    Json.put(status, "turn_id", clientTurnId);
                    Json.put(status, "speech_gate", gate.statusJson(now));
                    Json.put(status, "speech_detected", true);
                    markStatus("recording", status, null);
                }
                try {
                    Thread.sleep(SPEECH_GATE_POLL_MS);
                } catch (InterruptedException exc) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }, "PuckySpeechGatePoll");
        worker.setDaemon(true);
        worker.start();
    }

    private SpeechGate stopSpeechGatePoll(String clientTurnId) {
        synchronized (gateLock) {
            if (clientTurnId == null || clientTurnId.isEmpty() || clientTurnId.equals(activeGateTurnId)) {
                gatePollActive = false;
                activeGateTurnId = "";
                SpeechGate gate = activeSpeechGate;
                activeSpeechGate = null;
                return gate;
            }
            return activeSpeechGate;
        }
    }

    private boolean isSpeechGatePolling(String clientTurnId) {
        synchronized (gateLock) {
            return gatePollActive && clientTurnId.equals(activeGateTurnId);
        }
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

    private JSONObject persistReplyCard(String localSessionId, PuckyTurnResponse response) throws Exception {
        String sessionId = safeName(response.sessionId().isEmpty() ? localSessionId : response.sessionId());
        File dir = new File(context.getFilesDir(), "pucky_replies" + File.separator + sessionId);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("Unable to create reply directory");
        }
        File audio = new File(dir, "reply" + audioExtension(response.audioMimeType()));
        write(audio, response.audioBytes());
        String htmlPath = "";
        if (response.hasHtml()) {
            File html = new File(dir, "reply.html");
            write(html, response.htmlBytes());
            htmlPath = html.getAbsolutePath();
        }
        JSONObject card = new JSONObject();
        Json.put(card, "session_id", sessionId);
        Json.put(card, "title", response.cardTitle());
        Json.put(card, "summary", response.text());
        Json.put(card, "icon", response.cardIcon());
        Json.put(card, "audio_path", audio.getAbsolutePath());
        if (!htmlPath.isEmpty()) {
            Json.put(card, "html_path", htmlPath);
        }
        new ReplyCardStore(context).prepend(card);
        return card;
    }

    private void requireConfigured() throws CommandException {
        if (!isConfigured()) {
            JSONObject detail = new JSONObject();
            Json.put(detail, "schema", "pucky.turn_status_item.v1");
            Json.put(detail, "configured", false);
            Json.put(detail, "url", settings.getPuckyTurnUrl());
            markStatus("failed", detail, "not_configured");
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Pucky turn endpoint is not configured");
        }
    }

    private JSONObject playReply(JSONObject card) throws CommandException {
        JSONObject args = new JSONObject();
        Json.put(args, "path", card.optString("audio_path", ""));
        Json.put(args, "title", card.optString("title", "Pucky reply"));
        Json.put(args, "source", "pucky.turn");
        return PlayerController.shared(context).play(args);
    }

    private boolean isConfigured() {
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
        JSONObject out = detail == null ? new JSONObject() : detail;
        Json.put(out, "state", state);
        Json.put(out, "visual_state", visualStateFor(state));
        Json.put(out, "updated_at", Instant.now().toString());
        if (error != null && !error.trim().isEmpty()) {
            Json.put(out, "error", error);
            Log.w(TAG, "Pucky turn " + state + " " + error);
        }
        prefs.edit().putString(LAST_STATUS, out.toString()).apply();
        PuckyState.get().setLifecycleEvent("pucky.turn." + state);
        PuckyState.get().broadcast(context);
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
        if (failed) {
            state = "failed";
        } else if (speaking) {
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
        Json.put(out, "peak_amplitude", gate == null ? 0 : gate.optInt("peak_amplitude", 0));
        Json.put(out, "samples_over_threshold", gate == null ? 0 : gate.optInt("samples_over_threshold", 0));
        Json.put(out, "gate_latency_ms", gate == null ? -1L : gate.optLong("gate_latency_ms", -1L));
        Json.put(out, "uploading", uploading);
        Json.put(out, "stt_running", sttRunning);
        Json.put(out, "codex_running", codexRunning);
        Json.put(out, "tts_running", ttsRunning);
        Json.put(out, "speaking", speaking);
        Json.put(out, "failed", failed);
        Json.put(out, "active", micOn || uploading || codexRunning || speaking || failed);
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
        if ("failed".equals(state)) return "failed";
        return "idle";
    }

    private static String generateClientTurnId() {
        return "pucky_" + UUID.randomUUID().toString().replace("-", "");
    }

    private static JSONObject reasonArgs(String reason) {
        JSONObject out = new JSONObject();
        Json.put(out, "reason", reason);
        return out;
    }

    private static String audioExtension(String mimeType) {
        String mime = mimeType == null ? "" : mimeType.trim().toLowerCase();
        if ("audio/mpeg".equals(mime)) return ".mp3";
        if ("audio/mp4".equals(mime)) return ".m4a";
        if ("audio/wav".equals(mime) || "audio/x-wav".equals(mime)) return ".wav";
        return ".bin";
    }

    private static String safeName(String raw) {
        String value = raw == null || raw.trim().isEmpty() ? "pucky_" + Long.toHexString(System.currentTimeMillis()) : raw.trim();
        value = value.replaceAll("[^A-Za-z0-9._-]", "_");
        return value.length() > 96 ? value.substring(0, 96) : value;
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

    private static void write(File file, byte[] data) throws IOException {
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(data);
        }
    }
}
