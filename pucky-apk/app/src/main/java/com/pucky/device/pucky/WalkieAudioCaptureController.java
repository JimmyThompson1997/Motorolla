package com.pucky.device.pucky;

import android.content.Context;
import android.os.Build;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.speech.lab.AudioFrameBus;
import com.pucky.device.speech.lab.PcmCaptureConsumer;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.time.Instant;
import java.util.Locale;

public final class WalkieAudioCaptureController {
    private static final String READY_HAPTIC_MS = "ready_haptic_ms";
    private static final int DEFAULT_READY_HAPTIC_MS = 55;
    private static final int HAPTIC_AMPLITUDE = 220;
    private static final int DEFAULT_MAX_DURATION_MS = 60_000;
    private static final int HARD_MAX_DURATION_MS = 120_000;

    private static WalkieAudioCaptureController shared;

    private final Context context;
    private ActiveCapture active;

    private static final class ActiveCapture {
        String sessionId;
        String turnId;
        File file;
        String startedAt;
        long startedElapsedMs;
        int maxDurationMs;
        boolean feedback;
        AudioFrameBus bus;
        PcmCaptureConsumer pcm;
        WalkieSpeechGate gate;
    }

    public static synchronized WalkieAudioCaptureController shared(Context context) {
        if (shared == null) {
            shared = new WalkieAudioCaptureController(context.getApplicationContext());
        }
        return shared;
    }

    public WalkieAudioCaptureController(Context context) {
        this.context = context.getApplicationContext();
    }

    public synchronized JSONObject status() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.walkie_audio_capture_status.v1");
        Json.put(out, "state", active == null ? "idle" : activeState(active));
        Json.put(out, "active_session", active == null ? JSONObject.NULL : activeJson(active));
        Json.put(out, "permission", JSONObject.NULL);
        Json.put(out, "mic_on", active != null);
        Json.put(out, "speech_gate", active == null ? JSONObject.NULL : active.gate.statusJson());
        Json.put(out, "hearing", active != null && active.gate.speechDetected());
        Json.put(out, "elapsed_ms", active == null ? 0L : Math.max(0L, SystemClock.elapsedRealtime() - active.startedElapsedMs));
        Json.put(out, "amplitude", active == null ? 0 : active.gate.statusJson().optInt("peak_amplitude", 0));
        return out;
    }

    public synchronized JSONObject start(JSONObject args, WalkieSpeechGate.Listener listener) throws CommandException {
        if (active != null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.walkie_audio_capture_start.v1");
            Json.put(out, "state", activeState(active));
            Json.put(out, "result", "already_recording");
            Json.put(out, "active_session", activeJson(active));
            Json.put(out, "speech_gate", active.gate.statusJson());
            return out;
        }
        String format = args.optString("format", "wav").trim().toLowerCase(Locale.US);
        if (!format.isEmpty() && !"wav".equals(format)) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Only wav walkie capture is supported");
        }
        File dir = new File(context.getFilesDir(), "walkie");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Unable to create walkie directory");
        }
        String sessionId = safeSessionId(args.optString("session_id", ""));
        String turnId = safeSessionId(args.optString("turn_id", sessionId));
        ActiveCapture capture = new ActiveCapture();
        capture.sessionId = sessionId;
        capture.turnId = turnId;
        capture.file = uniqueFile(dir, sessionId + ".wav");
        capture.startedAt = Instant.now().toString();
        capture.startedElapsedMs = SystemClock.elapsedRealtime();
        capture.maxDurationMs = clamp(args.optInt("max_duration_ms", DEFAULT_MAX_DURATION_MS), 1_000, HARD_MAX_DURATION_MS);
        capture.feedback = args.optBoolean("feedback", true);
        capture.bus = new AudioFrameBus(context);
        int maxSamples = AudioFrameBus.SAMPLE_RATE * Math.max(1, (capture.maxDurationMs + 999) / 1_000);
        capture.pcm = new PcmCaptureConsumer(maxSamples);
        capture.gate = new WalkieSpeechGate(capture.startedElapsedMs, new SileroVadEngine(context),
                SystemClock::elapsedRealtime, listener);
        capture.bus.addSynchronousConsumer(capture.pcm);
        capture.bus.addConsumer(capture.gate);
        active = capture;
        JSONObject start = capture.bus.start();
        if (!"started".equals(start.optString("result")) && !"already_running".equals(start.optString("result"))) {
            active = null;
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to start walkie audio capture: " + start.optString("error", "audio_frame_bus_failed"));
        }
        if (capture.feedback) {
            buzzOneShot(args.optInt(READY_HAPTIC_MS, DEFAULT_READY_HAPTIC_MS), HAPTIC_AMPLITUDE);
        }
        scheduleAutoDiscard(sessionId, capture.maxDurationMs);

        JSONObject out = activeJson(capture);
        Json.put(out, "schema", "pucky.walkie_audio_capture_start.v1");
        Json.put(out, "state", activeState(capture));
        Json.put(out, "result", "started");
        Json.put(out, "speech_gate", capture.gate.statusJson());
        Json.put(out, "vad_engine", capture.gate.statusJson().optString("vad_engine", ""));
        Json.put(out, "vad_available", capture.gate.statusJson().optBoolean("vad_available", false));
        return out;
    }

    public synchronized JSONObject stop(JSONObject args) throws CommandException {
        if (active == null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.walkie_audio_capture_stop.v1");
            Json.put(out, "state", "idle");
            Json.put(out, "result", "no_active_capture");
            return out;
        }
        ActiveCapture capture = active;
        active = null;
        JSONObject busStop = capture.bus.stop();
        short[] samples = capture.pcm.snapshotSamples();
        if (samples.length <= 0) {
            deleteQuietly(capture.file);
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, "Walkie capture had no PCM samples");
        }
        try {
            writeWav(capture.file, samples, AudioFrameBus.SAMPLE_RATE);
        } catch (Exception exc) {
            deleteQuietly(capture.file);
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to write walkie WAV: " + exc.getMessage());
        }
        long durationMs = Math.max(0L, SystemClock.elapsedRealtime() - capture.startedElapsedMs);
        JSONObject completed = captureJson(capture, durationMs, args.optString("reason", "button_release"));
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.walkie_audio_capture_stop.v1");
        Json.put(out, "state", "completed");
        Json.put(out, "result", "completed");
        Json.put(out, "capture", completed);
        Json.put(out, "artifact", completed.optJSONObject("artifact"));
        Json.put(out, "session_id", capture.sessionId);
        Json.put(out, "turn_id", capture.turnId);
        Json.put(out, "duration_ms", durationMs);
        Json.put(out, "bytes", capture.file.length());
        Json.put(out, "speech_gate", capture.gate.statusJson());
        Json.put(out, "audio_frame_bus", busStop.optJSONObject("snapshot"));
        return out;
    }

    public synchronized JSONObject discard(JSONObject args) {
        if (active == null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.walkie_audio_capture_discard.v1");
            Json.put(out, "state", "idle");
            Json.put(out, "result", "no_active_capture");
            return out;
        }
        ActiveCapture capture = active;
        active = null;
        JSONObject busStop = capture.bus.stop();
        boolean deleted = deleteQuietly(capture.file);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.walkie_audio_capture_discard.v1");
        Json.put(out, "state", "discarded");
        Json.put(out, "result", "discarded");
        Json.put(out, "reason", args.optString("reason", "silence"));
        Json.put(out, "session_id", capture.sessionId);
        Json.put(out, "turn_id", capture.turnId);
        Json.put(out, "deleted_file", deleted);
        Json.put(out, "capture", activeJson(capture));
        Json.put(out, "speech_gate", capture.gate.statusJson());
        Json.put(out, "audio_frame_bus", busStop.optJSONObject("snapshot"));
        return out;
    }

    private static String activeState(ActiveCapture capture) {
        return capture.gate.speechDetected() ? "recording" : "armed";
    }

    private static JSONObject activeJson(ActiveCapture capture) {
        JSONObject out = new JSONObject();
        Json.put(out, "session_id", capture.sessionId);
        Json.put(out, "turn_id", capture.turnId);
        Json.put(out, "started_at", capture.startedAt);
        Json.put(out, "path", capture.file.getAbsolutePath());
        Json.put(out, "device_path", capture.file.getAbsolutePath());
        Json.put(out, "filename", capture.file.getName());
        Json.put(out, "mime_type", "audio/wav");
        Json.put(out, "audio_source", "voice_recognition");
        Json.put(out, "sample_rate", AudioFrameBus.SAMPLE_RATE);
        Json.put(out, "channels", 1);
        Json.put(out, "encoding", "PCM_16BIT");
        Json.put(out, "max_duration_ms", capture.maxDurationMs);
        return out;
    }

    private static JSONObject captureJson(ActiveCapture capture, long durationMs, String reason) {
        JSONObject out = activeJson(capture);
        Json.put(out, "schema", "pucky.walkie_audio_capture.v1");
        Json.put(out, "state", "completed");
        Json.put(out, "completed_at", Instant.now().toString());
        Json.put(out, "duration_ms", durationMs);
        Json.put(out, "bytes", capture.file.length());
        Json.put(out, "reason", reason);
        Json.put(out, "artifact", artifactJson(capture.file));
        return out;
    }

    private static JSONObject artifactJson(File file) {
        JSONObject artifact = new JSONObject();
        Json.put(artifact, "artifact_id", "art_" + Integer.toHexString(file.getAbsolutePath().hashCode()));
        Json.put(artifact, "kind", "walkie_capture");
        Json.put(artifact, "device_path", file.getAbsolutePath());
        Json.put(artifact, "path", file.getAbsolutePath());
        Json.put(artifact, "filename", file.getName());
        Json.put(artifact, "bytes", file.length());
        Json.put(artifact, "last_modified_ms", file.lastModified());
        Json.put(artifact, "mime_type", "audio/wav");
        return artifact;
    }

    private void scheduleAutoDiscard(String sessionId, int maxDurationMs) {
        Thread worker = new Thread(() -> {
            try {
                Thread.sleep(maxDurationMs + 250L);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
                return;
            }
            synchronized (WalkieAudioCaptureController.this) {
                if (active == null || !sessionId.equals(active.sessionId)) {
                    return;
                }
                discard(reasonArgs("max_duration"));
            }
        }, "pucky-walkie-capture-autodiscard");
        worker.setDaemon(true);
        worker.start();
    }

    private static JSONObject reasonArgs(String reason) {
        JSONObject out = new JSONObject();
        Json.put(out, "reason", reason);
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

    private static void writeWav(File file, short[] samples, int sampleRate) throws Exception {
        int dataBytes = samples.length * 2;
        try (FileOutputStream output = new FileOutputStream(file)) {
            writeAscii(output, "RIFF");
            writeIntLe(output, 36 + dataBytes);
            writeAscii(output, "WAVE");
            writeAscii(output, "fmt ");
            writeIntLe(output, 16);
            writeShortLe(output, 1);
            writeShortLe(output, 1);
            writeIntLe(output, sampleRate);
            writeIntLe(output, sampleRate * 2);
            writeShortLe(output, 2);
            writeShortLe(output, 16);
            writeAscii(output, "data");
            writeIntLe(output, dataBytes);
            for (short sample : samples) {
                writeShortLe(output, sample);
            }
        }
    }

    private static void writeAscii(FileOutputStream output, String value) throws Exception {
        output.write(value.getBytes(java.nio.charset.StandardCharsets.US_ASCII));
    }

    private static void writeIntLe(FileOutputStream output, int value) throws Exception {
        output.write(value & 0xff);
        output.write((value >> 8) & 0xff);
        output.write((value >> 16) & 0xff);
        output.write((value >> 24) & 0xff);
    }

    private static void writeShortLe(FileOutputStream output, int value) throws Exception {
        output.write(value & 0xff);
        output.write((value >> 8) & 0xff);
    }

    private static boolean deleteQuietly(File file) {
        try {
            return file.exists() && file.delete();
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static File uniqueFile(File dir, String name) {
        File file = new File(dir, name);
        if (!file.exists()) {
            return file;
        }
        String base = name;
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            base = name.substring(0, dot);
            ext = name.substring(dot);
        }
        for (int i = 1; i < 1000; i++) {
            File candidate = new File(dir, base + "_" + i + ext);
            if (!candidate.exists()) {
                return candidate;
            }
        }
        return new File(dir, base + "_" + System.currentTimeMillis() + ext);
    }

    private static String safeSessionId(String raw) {
        String value = raw == null || raw.trim().isEmpty() ? "walkie_" + Long.toHexString(System.currentTimeMillis()) : raw.trim();
        value = value.replaceAll("[^A-Za-z0-9._-]", "_");
        return value.length() > 96 ? value.substring(0, 96) : value;
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}
