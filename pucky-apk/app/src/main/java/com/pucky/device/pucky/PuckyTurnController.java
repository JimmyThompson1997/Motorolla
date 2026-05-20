package com.pucky.device.pucky;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.net.Ipv4FirstDns;
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
    private static PuckyTurnController shared;

    private final Context context;
    private final SettingsStore settings;
    private final SharedPreferences prefs;
    private final OkHttpClient http = new OkHttpClient.Builder().dns(Ipv4FirstDns.INSTANCE).build();

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
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_status.v1");
        Json.put(out, "voice_capture", VoiceCaptureController.shared(context).status());
        Json.put(out, "last_status", lastStatus());
        Json.put(out, "configured", !settings.getPuckyApiToken().isEmpty());
        Json.put(out, "url", settings.getPuckyTurnUrl());
        return out;
    }

    public JSONObject start(JSONObject args) throws CommandException {
        requireConfigured();
        JSONObject startArgs = new JSONObject();
        Json.put(startArgs, "format", "m4a");
        Json.put(startArgs, "audio_source", args.optString("audio_source", "mic"));
        Json.put(startArgs, "max_duration_ms", args.optInt("max_duration_ms", 60000));
        Json.put(startArgs, "sample_tag", "pucky_turn");
        JSONObject out = VoiceCaptureController.shared(context).start(startArgs);
        markStatus("recording", out, null);
        return out;
    }

    public JSONObject stop(JSONObject args) throws CommandException {
        requireConfigured();
        JSONObject stopped = VoiceCaptureController.shared(context).stop(reasonArgs(args.optString("reason", "button_release")));
        JSONObject capture = stopped.optJSONObject("capture");
        if (capture == null) {
            markStatus("idle", stopped, "no_capture");
            return stopped;
        }
        File audio = new File(capture.optString("path", ""));
        if (!audio.exists() || !audio.isFile() || audio.length() <= 0) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Pucky turn capture is empty");
        }
        byte[] audioBytes = readAll(audio);
        String localSessionId = capture.optString("session_id", "pucky_" + Long.toHexString(System.currentTimeMillis()));
        submitAsync(localSessionId, audioBytes);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.turn_stop.v1");
        Json.put(out, "state", "uploading");
        Json.put(out, "local_session_id", localSessionId);
        Json.put(out, "request_audio_bytes", audioBytes.length);
        markStatus("uploading", out, null);
        return out;
    }

    private void submitAsync(String localSessionId, byte[] audioBytes) {
        long startedMs = System.currentTimeMillis();
        Request request = new Request.Builder()
                .url(settings.getPuckyTurnUrl())
                .header("Authorization", "Bearer " + settings.getPuckyApiToken())
                .post(RequestBody.create(AUDIO_MP4, audioBytes))
                .build();
        http.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                markStatus("failed", baseStatus(localSessionId, startedMs, audioBytes.length),
                        e.getClass().getSimpleName() + ": " + e.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) {
                try (Response ignored = response) {
                    String responseText = response.body() == null ? "" : response.body().string();
                    JSONObject status = baseStatus(localSessionId, startedMs, audioBytes.length);
                    Json.put(status, "http_status", response.code());
                    if (!response.isSuccessful()) {
                        markStatus("failed", status, "http_" + response.code());
                        return;
                    }
                    try {
                        PuckyTurnResponse parsed = PuckyTurnResponse.fromJson(responseText);
                        JSONObject card = persistReplyCard(localSessionId, parsed);
                        Json.put(status, "state", "completed");
                        Json.put(status, "session_id", card.optString("session_id", ""));
                        Json.put(status, "reply_text_chars", parsed.text().length());
                        Json.put(status, "reply_audio_bytes", parsed.audioBytes().length);
                        Json.put(status, "has_html", parsed.hasHtml());
                        markStatus("completed", status, null);
                    } catch (Exception exc) {
                        markStatus("failed", status, exc.getClass().getSimpleName() + ": " + exc.getMessage());
                    }
                } catch (IOException exc) {
                    markStatus("failed", baseStatus(localSessionId, startedMs, audioBytes.length),
                            "response_read_failed: " + exc.getMessage());
                }
            }
        });
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
        if (settings.getPuckyTurnUrl().isEmpty() || settings.getPuckyApiToken().isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Pucky turn endpoint is not configured");
        }
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
