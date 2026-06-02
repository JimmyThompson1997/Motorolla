package com.pucky.device.meeting;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.util.Base64;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.net.Ipv4FirstDns;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;
import com.pucky.device.voice.VoiceCaptureController;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.file.Files;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.UUID;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class MeetingRecordingController {
    private static final String PREFS = "pucky_meeting_recordings";
    private static final String MEETINGS = "meetings_json";
    private static final String ACTIVE_MEETING_ID = "active_meeting_id";
    private static final String ACTIVE_VOICE_SESSION_ID = "active_voice_session_id";
    private static final int MAX_MEETINGS = 100;
    private static final int DEFAULT_MAX_DURATION_MS = 90 * 60 * 1000;
    private static final int HOVER_START_CHIME_MS = 160;
    private static final int HOVER_STOP_CHIME_MS = 210;
    private static final int HOVER_CHIME_VOLUME = 70;
    private static final DateTimeFormatter ID_TIME =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss").withZone(ZoneOffset.UTC);
    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");
    private static MeetingRecordingController shared;

    private final Context context;
    private final SharedPreferences prefs;
    private final SettingsStore settings;
    private final OkHttpClient http = new OkHttpClient.Builder().dns(Ipv4FirstDns.INSTANCE).build();
    private String activeMeetingId = "";
    private String activeVoiceSessionId = "";

    private MeetingRecordingController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.settings = new SettingsStore(this.context);
    }

    public static synchronized MeetingRecordingController shared(Context context) {
        if (shared == null) {
            shared = new MeetingRecordingController(context.getApplicationContext());
        }
        return shared;
    }

    public synchronized JSONObject status() {
        restoreActiveFromVoiceCaptureLocked();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.meeting_recording_status.v1");
        Json.put(out, "state", activeMeetingId.isEmpty() ? "idle" : "recording");
        Json.put(out, "active_meeting_id", activeMeetingId.isEmpty() ? JSONObject.NULL : activeMeetingId);
        Json.put(out, "voice_capture", VoiceCaptureController.shared(context).status());
        Json.put(out, "meetings", meetingsJson());
        return out;
    }

    public synchronized JSONObject start(JSONObject args) throws CommandException {
        restoreActiveFromVoiceCaptureLocked();
        if (!activeMeetingId.isEmpty()) {
            JSONObject out = status();
            Json.put(out, "result", "already_recording");
            return out;
        }
        String meetingId = args.optString("meeting_id", "").trim();
        if (meetingId.isEmpty()) {
            meetingId = newMeetingId(args.optString("device_id", settings.getDeviceId()));
        }
        JSONObject startArgs = new JSONObject();
        Json.put(startArgs, "session_id", meetingId);
        Json.put(startArgs, "format", "m4a");
        Json.put(startArgs, "audio_source", args.optString("audio_source", "voice_recognition"));
        Json.put(startArgs, "max_duration_ms", args.optInt("max_duration_ms", DEFAULT_MAX_DURATION_MS));
        Json.put(startArgs, "sample_tag", "meeting_recording");
        Json.put(startArgs, "feedback", args.optBoolean("feedback", true));
        JSONObject started = VoiceCaptureController.shared(context).start(startArgs);
        activeMeetingId = meetingId;
        JSONObject activeSession = started.optJSONObject("active_session");
        if (activeSession == null) {
            activeSession = started;
        }
        activeVoiceSessionId = activeSession == null ? "" : activeSession.optString("session_id", "");
        persistActiveIds();
        JSONObject record = meetingRecordFromCapture(meetingId, activeSession, "recording");
        appendMeeting(record);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.meeting_recording_start.v1");
        Json.put(out, "state", "recording");
        Json.put(out, "meeting_id", meetingId);
        Json.put(out, "recording", record);
        Json.put(out, "voice_capture", started);
        return out;
    }

    public synchronized JSONObject stop(JSONObject args) throws CommandException {
        restoreActiveFromVoiceCaptureLocked();
        if (activeMeetingId.isEmpty()) {
            JSONObject out = status();
            Json.put(out, "result", "no_active_recording");
            return out;
        }
        String meetingId = activeMeetingId;
        String voiceSessionId = activeVoiceSessionId.isEmpty() ? meetingId : activeVoiceSessionId;
        JSONObject stopArgs = new JSONObject();
        Json.put(stopArgs, "session_id", voiceSessionId);
        Json.put(stopArgs, "reason", args.optString("reason", "meeting_recording_stop"));
        Json.put(stopArgs, "feedback", args.optBoolean("feedback", true));
        JSONObject stopped = VoiceCaptureController.shared(context).stop(stopArgs);
        activeMeetingId = "";
        activeVoiceSessionId = "";
        clearActiveIds();
        JSONObject capture = stopped.optJSONObject("capture");
        JSONObject record = meetingRecordFromCapture(meetingId, capture, "completed");
        JSONObject upload = initialUploadState();
        Json.put(record, "upload_status", upload.optString("state", "failed"));
        Json.put(record, "upload", upload);
        appendMeeting(record);
        startUpload(record, capture);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.meeting_recording_stop.v1");
        Json.put(out, "state", "completed");
        Json.put(out, "meeting_id", meetingId);
        Json.put(out, "recording", record);
        Json.put(out, "voice_capture", stopped);
        Json.put(out, "upload", upload);
        return out;
    }

    private void startUpload(JSONObject record, JSONObject capture) {
        if (!isConfigured()) {
            return;
        }
        JSONObject recordCopy;
        JSONObject captureCopy;
        try {
            recordCopy = new JSONObject(record.toString());
            captureCopy = capture == null ? null : new JSONObject(capture.toString());
        } catch (Exception ignored) {
            return;
        }
        new Thread(() -> {
            try {
                JSONObject upload = uploadCompletedMeeting(recordCopy, captureCopy);
                Json.put(recordCopy, "upload_status", upload.optString("state", "failed"));
                Json.put(recordCopy, "upload", upload);
            } catch (CommandException exc) {
                Json.put(recordCopy, "upload_status", "failed");
                JSONObject upload = new JSONObject();
                Json.put(upload, "schema", "pucky.meeting_upload.v1");
                Json.put(upload, "state", "failed");
                Json.put(upload, "error", exc.getMessage());
                Json.put(recordCopy, "upload", upload);
            }
            appendMeeting(recordCopy);
        }, "pucky-meeting-upload-" + record.optString("meeting_id", "unknown")).start();
    }

    private JSONObject initialUploadState() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.meeting_upload.v1");
        Json.put(out, "state", isConfigured() ? "uploading" : "skipped_not_configured");
        return out;
    }

    public synchronized JSONObject triggerHover(JSONObject args) throws CommandException {
        JSONObject result = toggleFromHover(args.optString("reason", "manual_hover_trigger"));
        Json.put(result, "triggered", true);
        return result;
    }

    public synchronized JSONObject toggleFromHover(String reason) throws CommandException {
        restoreActiveFromVoiceCaptureLocked();
        boolean starting = activeMeetingId.isEmpty();
        JSONObject args = new JSONObject();
        Json.put(args, "reason", reason);
        JSONObject result = starting ? start(args) : stop(args);
        JSONObject chime = playMeetingHoverChime(starting);
        Json.put(result, "hover_chime", chime);
        copyChimeField(result, chime, "chime_attempted");
        copyChimeField(result, chime, "chime_played");
        copyChimeField(result, chime, "chime_tone");
        copyChimeField(result, chime, "chime_duration_ms");
        return result;
    }

    private JSONObject playMeetingHoverChime(boolean starting) {
        int tone = starting ? ToneGenerator.TONE_PROP_ACK : ToneGenerator.TONE_PROP_BEEP2;
        int durationMs = starting ? HOVER_START_CHIME_MS : HOVER_STOP_CHIME_MS;
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.meeting_hover_chime.v1");
        Json.put(out, "chime_attempted", true);
        Json.put(out, "chime_played", false);
        Json.put(out, "chime_tone", starting ? "TONE_PROP_ACK" : "TONE_PROP_BEEP2");
        Json.put(out, "chime_duration_ms", durationMs);
        Json.put(out, "stream", "music");
        try {
            ToneGenerator generator = new ToneGenerator(AudioManager.STREAM_MUSIC, HOVER_CHIME_VOLUME);
            generator.startTone(tone, durationMs);
            Json.put(out, "chime_played", true);
            new Thread(() -> {
                try {
                    Thread.sleep(durationMs + 120L);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                generator.release();
            }, "pucky-meeting-hover-chime").start();
        } catch (RuntimeException exc) {
            Json.put(out, "chime_error", exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }
        return out;
    }

    private static void copyChimeField(JSONObject target, JSONObject source, String key) {
        if (source != null && source.has(key)) {
            Json.put(target, key, source.opt(key));
        }
    }

    private void persistActiveIds() {
        prefs.edit()
                .putString(ACTIVE_MEETING_ID, activeMeetingId)
                .putString(ACTIVE_VOICE_SESSION_ID, activeVoiceSessionId)
                .commit();
    }

    private void clearActiveIds() {
        prefs.edit()
                .remove(ACTIVE_MEETING_ID)
                .remove(ACTIVE_VOICE_SESSION_ID)
                .commit();
    }

    private void restoreActiveFromVoiceCaptureLocked() {
        if (!activeMeetingId.isEmpty()) {
            return;
        }
        JSONObject voice = VoiceCaptureController.shared(context).status();
        JSONObject activeSession = voice.optJSONObject("active_session");
        if (activeSession == null || !"meeting_recording".equals(activeSession.optString("sample_tag", ""))) {
            return;
        }
        String storedMeetingId = prefs.getString(ACTIVE_MEETING_ID, "").trim();
        String voiceSessionId = activeSession.optString("session_id", prefs.getString(ACTIVE_VOICE_SESSION_ID, "")).trim();
        String meetingId = storedMeetingId.isEmpty() ? meetingIdFromVoiceSession(voiceSessionId) : storedMeetingId;
        if (meetingId.isEmpty()) {
            return;
        }
        activeMeetingId = meetingId;
        activeVoiceSessionId = voiceSessionId;
        persistActiveIds();
    }

    private static String meetingIdFromVoiceSession(String voiceSessionId) {
        String value = String.valueOf(voiceSessionId == null ? "" : voiceSessionId).trim();
        return value.startsWith("vc_") ? value.substring(3) : value;
    }

    private String newMeetingId(String rawDeviceId) {
        // Stable file id shape: meeting-YYYYMMDD-HHMMSS-device-id-or-device-shortid.
        String safeDeviceId = safeDeviceId(rawDeviceId);
        String shortId = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        return "meeting-" + ID_TIME.format(Instant.now()) + "-" + safeDeviceId + "-" + shortId;
    }

    private static String safeDeviceId(String raw) {
        String clean = String.valueOf(raw == null ? "" : raw).trim().toLowerCase(Locale.US)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        return clean.isEmpty() ? "device" : clean;
    }

    private JSONObject meetingRecordFromCapture(String meetingId, JSONObject capture, String state) {
        JSONObject source = capture == null ? new JSONObject() : capture;
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.meeting_recording.v1");
        Json.put(out, "meeting_id", meetingId);
        Json.put(out, "started_at", source.optString("started_at", Instant.now().toString()));
        Json.put(out, "stopped_at", source.optString("completed_at", ""));
        Json.put(out, "duration_ms", source.optLong("duration_ms", 0L));
        Json.put(out, "device_id", settings.getDeviceId());
        Json.put(out, "device_path", source.optString("device_path", source.optString("path", "")));
        Json.put(out, "mime_type", source.optString("mime_type", "audio/mp4"));
        Json.put(out, "bytes", source.optLong("bytes", 0L));
        Json.put(out, "state", state);
        Json.put(out, "upload_status", "pending");
        return out;
    }

    private JSONObject uploadCompletedMeeting(JSONObject record, JSONObject capture) throws CommandException {
        File file = new File(record.optString("device_path", ""));
        if (!file.exists() || file.length() <= 0) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "meeting recording file is missing or empty");
        }
        if (!isConfigured()) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.meeting_upload.v1");
            Json.put(out, "state", "skipped_not_configured");
            return out;
        }
        try {
            byte[] audio = Files.readAllBytes(file.toPath());
            JSONObject payload = new JSONObject();
            Json.put(payload, "meeting_id", record.optString("meeting_id"));
            Json.put(payload, "started_at", record.optString("started_at"));
            Json.put(payload, "stopped_at", record.optString("stopped_at"));
            Json.put(payload, "duration_ms", record.optLong("duration_ms"));
            Json.put(payload, "device_id", record.optString("device_id"));
            Json.put(payload, "device_path", record.optString("device_path"));
            Json.put(payload, "mime_type", record.optString("mime_type", "audio/mp4"));
            Json.put(payload, "bytes", audio.length);
            Json.put(payload, "audio_base64", Base64.encodeToString(audio, Base64.NO_WRAP));
            Json.put(payload, "voice_capture", capture == null ? JSONObject.NULL : capture);
            Request request = new Request.Builder()
                    .url(meetingsUrl())
                    .header("Authorization", "Bearer " + settings.getPuckyTurnAuthToken())
                    .post(RequestBody.create(payload.toString(), JSON_MEDIA_TYPE))
                    .build();
            try (Response response = http.newCall(request).execute()) {
                String body = response.body() == null ? "" : response.body().string();
                if (!response.isSuccessful()) {
                    throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                            "meeting upload failed with http_" + response.code() + ": " + body);
                }
                return new JSONObject(body);
            }
        } catch (CommandException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to upload meeting recording: " + exc.getMessage());
        }
    }

    private boolean isConfigured() {
        return !settings.getPuckyTurnUrl().trim().isEmpty() && !settings.getPuckyTurnAuthToken().trim().isEmpty();
    }

    private String meetingsUrl() {
        String base = settings.getPuckyTurnUrl().trim();
        if (base.endsWith("/api/turn")) {
            return base.substring(0, base.length() - "/api/turn".length()) + "/api/meetings";
        }
        return base.replaceAll("/+$", "") + "/api/meetings";
    }

    private JSONArray meetingsJson() {
        try {
            return new JSONArray(prefs.getString(MEETINGS, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private void appendMeeting(JSONObject record) {
        JSONArray all = meetingsJson();
        JSONArray kept = new JSONArray();
        String meetingId = record.optString("meeting_id");
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && !meetingId.equals(item.optString("meeting_id"))) {
                Json.add(kept, item);
            }
        }
        Json.add(kept, record);
        JSONArray trimmed = new JSONArray();
        int start = Math.max(0, kept.length() - MAX_MEETINGS);
        for (int i = start; i < kept.length(); i++) {
            Json.add(trimmed, kept.optJSONObject(i));
        }
        prefs.edit().putString(MEETINGS, trimmed.toString()).commit();
    }
}
