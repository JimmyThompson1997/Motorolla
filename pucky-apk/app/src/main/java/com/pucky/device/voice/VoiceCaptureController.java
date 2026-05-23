package com.pucky.device.voice;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.time.Instant;
import java.util.Locale;

public final class VoiceCaptureController {
    private static final String PREFS = "pucky_voice_capture";
    private static final String CAPTURES = "captures_json";
    private static final int MAX_CAPTURES = 100;
    private static final int DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000;
    private static final int HARD_MAX_DURATION_MS = 30 * 60 * 1000;
    private static final int MIN_FINALIZE_DURATION_MS = 250;
    private static final int READY_HAPTIC_MS = 55;
    private static final int RELEASE_HAPTIC_MS = 40;
    private static final int HAPTIC_AMPLITUDE = 220;
    private static final int ERROR_HAPTIC_AMPLITUDE = 255;
    private static final int SAVED_CHIME_VOLUME = 85;
    public static final int VOICE_CAPTURE_AMPLITUDE_THRESHOLD = 1200;

    private static VoiceCaptureController shared;

    private final Context context;
    private final SharedPreferences prefs;

    private MediaRecorder recorder;
    private ActiveCapture active;

    private static final class ActiveCapture {
        String sessionId;
        File file;
        String startedAt;
        long startedElapsedMs;
        int maxDurationMs;
        String sampleTag;
        String audioSource;
        boolean feedback;
    }

    public VoiceCaptureController(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static synchronized VoiceCaptureController shared(Context context) {
        if (shared == null) {
            shared = new VoiceCaptureController(context.getApplicationContext());
        }
        return shared;
    }

    public synchronized JSONObject status() {
        int amplitude = active == null ? 0 : currentAmplitude();
        long elapsedMs = active == null ? 0 : Math.max(0L,
                android.os.SystemClock.elapsedRealtime() - active.startedElapsedMs);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.voice_capture_status.v1");
        Json.put(out, "state", active == null ? "idle" : "recording");
        Json.put(out, "active_session", active == null ? JSONObject.NULL : activeJson(active));
        Json.put(out, "last_completed", latestCompletedValue());
        Json.put(out, "permission", permissionJson());
        Json.put(out, "mic_on", active != null);
        Json.put(out, "amplitude", amplitude);
        Json.put(out, "hearing", active != null && amplitude >= VOICE_CAPTURE_AMPLITUDE_THRESHOLD);
        Json.put(out, "elapsed_ms", elapsedMs);
        return out;
    }

    public synchronized int sampleAmplitude() {
        return active == null ? 0 : currentAmplitude();
    }

    public synchronized JSONObject start(JSONObject args) throws CommandException {
        boolean feedback = args.optBoolean("feedback", false);
        requireRecordPermission();
        if (active != null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.voice_capture_start.v1");
            Json.put(out, "state", "recording");
            Json.put(out, "result", "already_recording");
            Json.put(out, "active_session", activeJson(active));
            return out;
        }
        String format = args.optString("format", "m4a").trim().toLowerCase(Locale.US);
        if (!format.isEmpty() && !"m4a".equals(format)) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Only m4a voice capture is supported");
        }
        String audioSource = args.optString("audio_source", "voice_recognition").trim().toLowerCase(Locale.US);
        int source = audioSource(audioSource);
        int maxDurationMs = clamp(args.optInt("max_duration_ms", DEFAULT_MAX_DURATION_MS),
                1000, HARD_MAX_DURATION_MS);
        File dir = new File(context.getFilesDir(), "voice");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to create voice directory");
        }
        String sessionId = safeSessionId(args.optString("session_id", ""));
        File file = uniqueFile(dir, sessionId + ".m4a");

        MediaRecorder next = new MediaRecorder();
        try {
            next.setAudioSource(source);
            next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            next.setAudioEncodingBitRate(128000);
            next.setAudioSamplingRate(44100);
            next.setOutputFile(file.getAbsolutePath());
            next.prepare();
            next.start();
        } catch (Exception exc) {
            safeRelease(next);
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            if (feedback) {
                buzzError();
            }
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to start voice capture: " + exc.getClass().getSimpleName() + ": " + exc.getMessage());
        }

        ActiveCapture capture = new ActiveCapture();
        capture.sessionId = sessionId;
        capture.file = file;
        capture.startedAt = Instant.now().toString();
        capture.startedElapsedMs = android.os.SystemClock.elapsedRealtime();
        capture.maxDurationMs = maxDurationMs;
        capture.sampleTag = args.optString("sample_tag", "");
        capture.audioSource = audioSource;
        capture.feedback = feedback;
        recorder = next;
        active = capture;
        scheduleAutoStop(sessionId, maxDurationMs);
        if (feedback) {
            buzzOneShot(READY_HAPTIC_MS, HAPTIC_AMPLITUDE);
        }

        JSONObject out = activeJson(capture);
        Json.put(out, "schema", "pucky.voice_capture_start.v1");
        Json.put(out, "state", "recording");
        Json.put(out, "audio_source", audioSource);
        return out;
    }

    public synchronized JSONObject stop(JSONObject args) throws CommandException {
        if (active == null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.voice_capture_stop.v1");
            Json.put(out, "state", "idle");
            Json.put(out, "result", "no_active_capture");
            Json.put(out, "last_completed", latestCompletedValue());
            if (args.optBoolean("feedback", false)) {
                buzzError();
            }
            return out;
        }
        String requested = args.optString("session_id", "").trim();
        if (!requested.isEmpty() && !requested.equals(active.sessionId)) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "Active capture session is " + active.sessionId + ", not " + requested);
        }
        if (active.feedback) {
            buzzOneShot(RELEASE_HAPTIC_MS, HAPTIC_AMPLITUDE);
        }
        return finishActive(args.optString("reason", "command_stop"));
    }

    public synchronized JSONObject discard(JSONObject args) {
        if (active == null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.voice_capture_discard.v1");
            Json.put(out, "state", "idle");
            Json.put(out, "result", "no_active_capture");
            Json.put(out, "last_completed", latestCompletedValue());
            return out;
        }
        ActiveCapture capture = active;
        MediaRecorder current = recorder;
        active = null;
        recorder = null;
        safeRelease(current);
        boolean deleted = capture.file.exists() && capture.file.delete();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.voice_capture_discard.v1");
        Json.put(out, "state", "discarded");
        Json.put(out, "result", "discarded");
        Json.put(out, "reason", args.optString("reason", "silence"));
        Json.put(out, "session_id", capture.sessionId);
        Json.put(out, "deleted_file", deleted);
        Json.put(out, "capture", activeJson(capture));
        return out;
    }

    public synchronized JSONObject last(JSONObject args) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.voice_capture_last.v1");
        Json.put(out, "capture", latestCompletedValue());
        return out;
    }

    public synchronized JSONObject list(JSONObject args) {
        int limit = Math.max(1, Math.min(MAX_CAPTURES, args.optInt("limit", 20)));
        JSONArray all = capturesJson();
        JSONArray sliced = new JSONArray();
        int start = Math.max(0, all.length() - limit);
        for (int i = start; i < all.length(); i++) {
            Json.add(sliced, refreshCapture(all.optJSONObject(i)));
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.voice_capture_list.v1");
        Json.put(out, "captures", sliced);
        Json.put(out, "count", sliced.length());
        Json.put(out, "total_count", all.length());
        return out;
    }

    public synchronized JSONObject delete(JSONObject args) throws CommandException {
        String sessionId = args.optString("session_id", "").trim();
        if (sessionId.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "voice.capture.delete requires session_id");
        }
        boolean deleteFile = args.optBoolean("delete_file", true);
        JSONArray all = capturesJson();
        JSONArray kept = new JSONArray();
        JSONObject removed = null;
        boolean fileDeleted = false;
        for (int i = 0; i < all.length(); i++) {
            JSONObject item = all.optJSONObject(i);
            if (item != null && sessionId.equals(item.optString("session_id"))) {
                removed = item;
                if (deleteFile) {
                    File file = new File(item.optString("path", ""));
                    fileDeleted = file.exists() && file.delete();
                }
            } else if (item != null) {
                Json.add(kept, item);
            }
        }
        prefs.edit().putString(CAPTURES, kept.toString()).commit();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.voice_capture_delete.v1");
        Json.put(out, "session_id", sessionId);
        Json.put(out, "deleted_metadata", removed != null);
        Json.put(out, "deleted_file", fileDeleted);
        Json.put(out, "capture", removed == null ? JSONObject.NULL : removed);
        return out;
    }

    private JSONObject finishActive(String reason) throws CommandException {
        ActiveCapture capture = active;
        MediaRecorder current = recorder;
        active = null;
        recorder = null;
        boolean stopOk = false;
        String stopError = "";
        try {
            waitForMinimumFinalizeDuration(capture);
            current.stop();
            stopOk = true;
        } catch (RuntimeException exc) {
            stopError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
        } finally {
            safeRelease(current);
        }

        long durationMs = Math.max(0, android.os.SystemClock.elapsedRealtime() - capture.startedElapsedMs);
        if (!stopOk) {
            //noinspection ResultOfMethodCallIgnored
            capture.file.delete();
            if (capture.feedback) {
                buzzError();
            }
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to stop voice capture cleanly after " + durationMs + "ms: " + stopError);
        }
        JSONObject completed = completedJson(capture, durationMs, reason);
        appendCapture(completed);
        if (capture.feedback) {
            playSavedChime();
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.voice_capture_stop.v1");
        Json.put(out, "state", "completed");
        Json.put(out, "result", "completed");
        Json.put(out, "capture", completed);
        Json.put(out, "artifact", completed.optJSONObject("artifact"));
        Json.put(out, "session_id", capture.sessionId);
        Json.put(out, "duration_ms", durationMs);
        Json.put(out, "bytes", capture.file.length());
        return out;
    }

    private void waitForMinimumFinalizeDuration(ActiveCapture capture) {
        long elapsedMs = android.os.SystemClock.elapsedRealtime() - capture.startedElapsedMs;
        long remainingMs = MIN_FINALIZE_DURATION_MS - elapsedMs;
        if (remainingMs <= 0) {
            return;
        }
        try {
            Thread.sleep(remainingMs);
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
        }
    }

    private JSONObject completedJson(ActiveCapture capture, long durationMs, String reason) {
        JSONObject out = activeJson(capture);
        Json.put(out, "schema", "pucky.voice_capture.v1");
        Json.put(out, "state", "completed");
        Json.put(out, "completed_at", Instant.now().toString());
        Json.put(out, "duration_ms", durationMs);
        Json.put(out, "bytes", capture.file.length());
        Json.put(out, "reason", reason);
        Json.put(out, "artifact", artifactJson(capture.file));
        return out;
    }

    private JSONObject activeJson(ActiveCapture capture) {
        JSONObject out = new JSONObject();
        Json.put(out, "session_id", capture.sessionId);
        Json.put(out, "started_at", capture.startedAt);
        Json.put(out, "path", capture.file.getAbsolutePath());
        Json.put(out, "device_path", capture.file.getAbsolutePath());
        Json.put(out, "filename", capture.file.getName());
        Json.put(out, "mime_type", "audio/mp4");
        Json.put(out, "audio_source", capture.audioSource == null || capture.audioSource.isEmpty() ? JSONObject.NULL : capture.audioSource);
        Json.put(out, "max_duration_ms", capture.maxDurationMs);
        Json.put(out, "sample_tag", capture.sampleTag == null || capture.sampleTag.isEmpty() ? JSONObject.NULL : capture.sampleTag);
        return out;
    }

    private JSONObject artifactJson(File file) {
        JSONObject artifact = new JSONObject();
        Json.put(artifact, "artifact_id", "art_" + Integer.toHexString(file.getAbsolutePath().hashCode()));
        Json.put(artifact, "kind", "voice_capture");
        Json.put(artifact, "device_path", file.getAbsolutePath());
        Json.put(artifact, "path", file.getAbsolutePath());
        Json.put(artifact, "filename", file.getName());
        Json.put(artifact, "bytes", file.length());
        Json.put(artifact, "last_modified_ms", file.lastModified());
        Json.put(artifact, "mime_type", "audio/mp4");
        return artifact;
    }

    private JSONObject permissionJson() {
        JSONObject out = new JSONObject();
        Json.put(out, "record_audio", hasRecordPermission() ? "granted" : "denied");
        return out;
    }

    private void requireRecordPermission() throws CommandException {
        if (!hasRecordPermission()) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "RECORD_AUDIO permission is required");
        }
    }

    private boolean hasRecordPermission() {
        return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private int audioSource(String value) throws CommandException {
        switch (value) {
            case "":
            case "mic":
                return MediaRecorder.AudioSource.MIC;
            case "voice_recognition":
                return MediaRecorder.AudioSource.VOICE_RECOGNITION;
            case "voice_communication":
                return MediaRecorder.AudioSource.VOICE_COMMUNICATION;
            default:
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Unsupported audio_source: " + value);
        }
    }

    private void scheduleAutoStop(String sessionId, int maxDurationMs) {
        new Thread(() -> {
            try {
                Thread.sleep(maxDurationMs + 250L);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
                return;
            }
            synchronized (VoiceCaptureController.this) {
                if (active == null || !sessionId.equals(active.sessionId)) {
                    return;
                }
                try {
                    finishActive("max_duration");
                } catch (CommandException ignored) {
                    // The next status/list call will show no active capture; failed files are discarded.
                }
            }
        }, "pucky-voice-capture-autostop").start();
    }

    private void buzzOneShot(long millis, int amplitude) {
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(millis, Math.max(1, Math.min(255, amplitude))));
            } else {
                vibrator.vibrate(millis);
            }
        } catch (RuntimeException ignored) {
        }
    }

    private void buzzError() {
        try {
            Vibrator vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) {
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(
                        new long[] {0L, 80L, 80L, 120L},
                        new int[] {0, ERROR_HAPTIC_AMPLITUDE, 0, ERROR_HAPTIC_AMPLITUDE},
                        -1));
            } else {
                vibrator.vibrate(new long[] {0L, 80L, 80L, 120L}, -1);
            }
        } catch (RuntimeException ignored) {
        }
    }

    private void playSavedChime() {
        try {
            ToneGenerator generator = new ToneGenerator(AudioManager.STREAM_MUSIC, SAVED_CHIME_VOLUME);
            generator.startTone(ToneGenerator.TONE_PROP_PROMPT, 150);
            new Thread(() -> {
                try {
                    Thread.sleep(280L);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                generator.release();
            }, "pucky-voice-capture-saved-chime").start();
        } catch (RuntimeException ignored) {
        }
    }

    private int currentAmplitude() {
        try {
            return recorder == null ? 0 : Math.max(0, recorder.getMaxAmplitude());
        } catch (RuntimeException ignored) {
            return 0;
        }
    }

    private JSONArray capturesJson() {
        String raw = prefs.getString(CAPTURES, "[]");
        try {
            return new JSONArray(raw);
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private void appendCapture(JSONObject capture) {
        JSONArray existing = capturesJson();
        JSONArray next = new JSONArray();
        int start = Math.max(0, existing.length() - (MAX_CAPTURES - 1));
        for (int i = start; i < existing.length(); i++) {
            JSONObject item = existing.optJSONObject(i);
            if (item != null) {
                Json.add(next, item);
            }
        }
        Json.add(next, capture);
        prefs.edit().putString(CAPTURES, next.toString()).commit();
    }

    private JSONObject latestCompletedOrNull() {
        JSONArray all = capturesJson();
        if (all.length() == 0) {
            return null;
        }
        return refreshCapture(all.optJSONObject(all.length() - 1));
    }

    private Object latestCompletedValue() {
        JSONObject latest = latestCompletedOrNull();
        return latest == null ? JSONObject.NULL : latest;
    }

    private JSONObject refreshCapture(JSONObject capture) {
        if (capture == null) {
            return new JSONObject();
        }
        File file = new File(capture.optString("path", ""));
        Json.put(capture, "exists", file.exists());
        Json.put(capture, "bytes", file.exists() ? file.length() : 0);
        Json.put(capture, "artifact", file.exists() ? artifactJson(file) : JSONObject.NULL);
        return capture;
    }

    private static void safeRelease(MediaRecorder recorder) {
        try {
            recorder.reset();
        } catch (RuntimeException ignored) {
        }
        try {
            recorder.release();
        } catch (RuntimeException ignored) {
        }
    }

    private String safeSessionId(String raw) {
        String value = raw == null || raw.trim().isEmpty()
                ? "vc_" + Long.toHexString(System.currentTimeMillis())
                : raw.trim();
        value = value.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!value.startsWith("vc_")) {
            value = "vc_" + value;
        }
        return value.length() > 80 ? value.substring(0, 80) : value;
    }

    private File uniqueFile(File dir, String name) {
        File first = new File(dir, name);
        if (!first.exists()) {
            return first;
        }
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; i < 1000; i++) {
            File candidate = new File(dir, base + "-" + i + ext);
            if (!candidate.exists()) {
                return candidate;
            }
        }
        return new File(dir, base + "-" + System.currentTimeMillis() + ext);
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
