package com.pucky.device.pucky;

import android.content.Context;
import android.os.Build;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import com.pucky.device.BuildConfig;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.speech.OnDeviceInjectedAudioRecognizer;
import com.pucky.device.speech.lab.AudioFrameBus;
import com.pucky.device.speech.lab.PcmCaptureConsumer;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.time.Instant;
import java.util.Locale;

public final class WalkieAudioCaptureController {
    private static final String TAG = "WalkieAudioCapture";
    private static final String READY_HAPTIC_MS = "ready_haptic_ms";
    private static final int DEFAULT_READY_HAPTIC_MS = 55;
    private static final int HAPTIC_AMPLITUDE = 220;
    private static final int DEFAULT_MAX_DURATION_MS = 60_000;
    private static final int HARD_MAX_DURATION_MS = 120_000;
    private static final int DEFAULT_SPEECH_START_TIMEOUT_MS = 3_000;
    private static final String CAPTURE_SOURCE_MIC = "mic";
    private static final String CAPTURE_SOURCE_FIXTURE = "fixture";
    private static final double DEBUG_FIXTURE_SPEECH_THRESHOLD = 0.05;

    private static WalkieAudioCaptureController shared;

    public interface Listener extends WalkieSpeechGate.Listener {
        default void onSpeechStartTimeout(JSONObject status) {
        }

        default void onCaptureShouldStop(JSONObject status, String reason) {
        }
    }

    private final Context context;
    private ActiveCapture active;

    private static final class ActiveCapture {
        String sessionId;
        String turnId;
        String triggerSource;
        String wakePhraseFamily;
        String wakePhraseDetected;
        String captureSource;
        String fixtureName;
        String debugFixtureTranscript;
        int fixtureStartDelayMs;
        File file;
        String startedAt;
        long startedElapsedMs;
        int maxDurationMs;
        int speechStartTimeoutMs;
        int trailingSilenceMs;
        int minSpeechMs;
        boolean feedback;
        boolean autoEndpoint;
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
        Json.put(out, "schema", "pucky.walkie_audio_capture_status.v2");
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

    public synchronized JSONObject start(JSONObject args, Listener listener) throws CommandException {
        if (active != null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.walkie_audio_capture_start.v2");
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
        String captureSource = normalizeCaptureSource(args.optString("capture_source", CAPTURE_SOURCE_MIC));
        if (!CAPTURE_SOURCE_MIC.equals(captureSource) && !BuildConfig.DEBUG) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Fixture capture source is debug-only");
        }
        ActiveCapture capture = new ActiveCapture();
        capture.sessionId = sessionId;
        capture.turnId = turnId;
        capture.triggerSource = args.optString("trigger_source", args.optString("source", "volume_up_hold"));
        capture.wakePhraseFamily = args.optString("wake_phrase_family", "");
        capture.wakePhraseDetected = args.optString("wake_phrase_detected", "");
        capture.captureSource = captureSource;
        capture.fixtureName = safeFixtureName(args.optString("fixture_name", ""));
        capture.debugFixtureTranscript = BuildConfig.DEBUG ? args.optString("debug_fixture_transcript", "") : "";
        capture.file = uniqueFile(dir, sessionId + ".wav");
        capture.startedAt = Instant.now().toString();
        capture.startedElapsedMs = SystemClock.elapsedRealtime();
        capture.maxDurationMs = clamp(args.optInt("max_duration_ms", DEFAULT_MAX_DURATION_MS), 1_000, HARD_MAX_DURATION_MS);
        capture.fixtureStartDelayMs = BuildConfig.DEBUG && CAPTURE_SOURCE_FIXTURE.equals(capture.captureSource)
                ? clamp(args.optInt("fixture_start_delay_ms", 0), 0, capture.maxDurationMs)
                : 0;
        capture.feedback = args.optBoolean("feedback", true);
        capture.autoEndpoint = args.optBoolean("auto_endpoint", false);
        capture.speechStartTimeoutMs = capture.autoEndpoint
                ? clamp(args.optInt("speech_start_timeout_ms", DEFAULT_SPEECH_START_TIMEOUT_MS), 250, capture.maxDurationMs)
                : 0;
        capture.trailingSilenceMs = capture.autoEndpoint
                ? clamp(args.optInt("trailing_silence_ms", WalkieSpeechGate.DEFAULT_TRAILING_SILENCE_MS), 90, 10_000)
                : 0;
        capture.minSpeechMs = capture.autoEndpoint
                ? clamp(args.optInt("min_speech_ms", WalkieSpeechGate.DEFAULT_MIN_SPEECH_MS), 0, capture.maxDurationMs)
                : 0;
        double speechThreshold = BuildConfig.DEBUG && CAPTURE_SOURCE_FIXTURE.equals(capture.captureSource)
                ? DEBUG_FIXTURE_SPEECH_THRESHOLD
                : WalkieSpeechGate.DEFAULT_SPEECH_THRESHOLD;
        int maxSamples = AudioFrameBus.SAMPLE_RATE * Math.max(1, (capture.maxDurationMs + 999) / 1_000);
        capture.pcm = new PcmCaptureConsumer(maxSamples);
        capture.gate = new WalkieSpeechGate(
                capture.startedElapsedMs,
                new SileroVadEngine(context),
                SystemClock::elapsedRealtime,
                new WalkieSpeechGate.Listener() {
                    @Override
                    public void onSpeechDetected(JSONObject status) {
                        if (listener != null) {
                            listener.onSpeechDetected(status);
                        }
                    }

                    @Override
                    public void onSpeechEnded(JSONObject status) {
                        if (listener != null && capture.autoEndpoint) {
                            listener.onCaptureShouldStop(captureStatusJson(capture), "trailing_silence");
                        }
                    }
                },
                capture.trailingSilenceMs,
                capture.minSpeechMs,
                speechThreshold);

        JSONObject transportStart = new JSONObject();
        if (CAPTURE_SOURCE_MIC.equals(capture.captureSource)) {
            capture.bus = new AudioFrameBus(context);
            capture.bus.addSynchronousConsumer(capture.pcm);
            capture.bus.addConsumer(capture.gate);
            active = capture;
            transportStart = capture.bus.start();
            if (!"started".equals(transportStart.optString("result")) && !"already_running".equals(transportStart.optString("result"))) {
                active = null;
                throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                        "Unable to start walkie audio capture: " + transportStart.optString("error", "audio_frame_bus_failed"));
            }
        } else {
            if (capture.fixtureName.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "fixture_name is required when capture_source=fixture");
            }
            short[] fixtureSamples = loadFixtureSamples(capture.fixtureName);
            active = capture;
            startFixtureFeed(capture, fixtureSamples);
            Json.put(transportStart, "schema", "pucky.walkie_fixture_capture_start.v1");
            Json.put(transportStart, "result", "started");
            Json.put(transportStart, "state", "running");
            Json.put(transportStart, "capture_source", capture.captureSource);
            Json.put(transportStart, "fixture_name", capture.fixtureName);
        }

        if (capture.feedback) {
            buzzOneShot(args.optInt(READY_HAPTIC_MS, DEFAULT_READY_HAPTIC_MS), HAPTIC_AMPLITUDE);
        }
        if (capture.autoEndpoint && capture.speechStartTimeoutMs > 0) {
            scheduleSpeechStartTimeout(sessionId, capture, listener);
        }
        scheduleMaxDuration(sessionId, capture, listener);

        JSONObject out = activeJson(capture);
        Json.put(out, "schema", "pucky.walkie_audio_capture_start.v2");
        Json.put(out, "state", activeState(capture));
        Json.put(out, "result", "started");
        Json.put(out, "speech_gate", capture.gate.statusJson());
        Json.put(out, "vad_engine", capture.gate.statusJson().optString("vad_engine", ""));
        Json.put(out, "vad_available", capture.gate.statusJson().optBoolean("vad_available", false));
        Json.put(out, "audio_frame_bus", transportStart);
        return out;
    }

    public synchronized JSONObject stop(JSONObject args) throws CommandException {
        if (active == null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.walkie_audio_capture_stop.v2");
            Json.put(out, "state", "idle");
            Json.put(out, "result", "no_active_capture");
            return out;
        }
        ActiveCapture capture = active;
        active = null;
        JSONObject transportStop = stopCaptureSource(capture);
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
        Json.put(out, "schema", "pucky.walkie_audio_capture_stop.v2");
        Json.put(out, "state", "completed");
        Json.put(out, "result", "completed");
        Json.put(out, "capture", completed);
        Json.put(out, "artifact", completed.optJSONObject("artifact"));
        Json.put(out, "session_id", capture.sessionId);
        Json.put(out, "turn_id", capture.turnId);
        Json.put(out, "duration_ms", durationMs);
        Json.put(out, "bytes", capture.file.length());
        Json.put(out, "speech_gate", capture.gate.statusJson());
        Json.put(out, "audio_frame_bus", transportStop);
        return out;
    }

    public synchronized JSONObject discard(JSONObject args) {
        if (active == null) {
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.walkie_audio_capture_discard.v2");
            Json.put(out, "state", "idle");
            Json.put(out, "result", "no_active_capture");
            return out;
        }
        ActiveCapture capture = active;
        active = null;
        JSONObject transportStop = stopCaptureSource(capture);
        boolean deleted = deleteQuietly(capture.file);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.walkie_audio_capture_discard.v2");
        Json.put(out, "state", "discarded");
        Json.put(out, "result", "discarded");
        Json.put(out, "reason", args.optString("reason", "silence"));
        Json.put(out, "session_id", capture.sessionId);
        Json.put(out, "turn_id", capture.turnId);
        Json.put(out, "deleted_file", deleted);
        Json.put(out, "capture", activeJson(capture));
        Json.put(out, "speech_gate", capture.gate.statusJson());
        Json.put(out, "audio_frame_bus", transportStop);
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
        Json.put(out, "audio_source", CAPTURE_SOURCE_FIXTURE.equals(capture.captureSource) ? "fixture" : "voice_recognition");
        Json.put(out, "trigger_source", capture.triggerSource);
        Json.put(out, "auto_endpoint", capture.autoEndpoint);
        Json.put(out, "speech_start_timeout_ms", capture.speechStartTimeoutMs);
        Json.put(out, "trailing_silence_ms", capture.trailingSilenceMs);
        Json.put(out, "min_speech_ms", capture.minSpeechMs);
        Json.put(out, "capture_source", capture.captureSource);
        Json.put(out, "fixture_name", capture.fixtureName);
        Json.put(out, "fixture_start_delay_ms", capture.fixtureStartDelayMs);
        if (!capture.debugFixtureTranscript.isEmpty()) {
            Json.put(out, "debug_fixture_transcript", capture.debugFixtureTranscript);
        }
        if (!capture.wakePhraseFamily.isEmpty()) {
            Json.put(out, "wake_phrase_family", capture.wakePhraseFamily);
        }
        if (!capture.wakePhraseDetected.isEmpty()) {
            Json.put(out, "wake_phrase_detected", capture.wakePhraseDetected);
        }
        Json.put(out, "sample_rate", AudioFrameBus.SAMPLE_RATE);
        Json.put(out, "channels", 1);
        Json.put(out, "encoding", "PCM_16BIT");
        Json.put(out, "max_duration_ms", capture.maxDurationMs);
        return out;
    }

    private static JSONObject captureJson(ActiveCapture capture, long durationMs, String reason) {
        JSONObject out = activeJson(capture);
        Json.put(out, "schema", "pucky.walkie_audio_capture.v2");
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

    private JSONObject captureStatusJson(ActiveCapture capture) {
        JSONObject out = activeJson(capture);
        Json.put(out, "schema", "pucky.walkie_audio_capture_status_item.v1");
        Json.put(out, "state", activeState(capture));
        Json.put(out, "speech_gate", capture.gate.statusJson());
        Json.put(out, "elapsed_ms", Math.max(0L, SystemClock.elapsedRealtime() - capture.startedElapsedMs));
        return out;
    }

    private void scheduleSpeechStartTimeout(String sessionId, ActiveCapture capture, Listener listener) {
        Thread worker = new Thread(() -> {
            try {
                Thread.sleep(capture.speechStartTimeoutMs);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
                return;
            }
            synchronized (WalkieAudioCaptureController.this) {
                if (active == null || active != capture || !sessionId.equals(active.sessionId) || active.gate.speechDetected()) {
                    return;
                }
            }
            if (listener != null) {
                listener.onSpeechStartTimeout(captureStatusJson(capture));
            }
        }, "pucky-walkie-speech-start-timeout");
        worker.setDaemon(true);
        worker.start();
    }

    private void scheduleMaxDuration(String sessionId, ActiveCapture capture, Listener listener) {
        Thread worker = new Thread(() -> {
            try {
                Thread.sleep(capture.maxDurationMs + 250L);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
                return;
            }
            synchronized (WalkieAudioCaptureController.this) {
                if (active == null || active != capture || !sessionId.equals(active.sessionId)) {
                    return;
                }
            }
            if (capture.autoEndpoint) {
                if (listener != null) {
                    listener.onCaptureShouldStop(captureStatusJson(capture), "max_duration");
                }
                return;
            }
            synchronized (WalkieAudioCaptureController.this) {
                if (active == capture) {
                    discard(reasonArgs("max_duration"));
                }
            }
        }, "pucky-walkie-capture-max-duration");
        worker.setDaemon(true);
        worker.start();
    }

    private void startFixtureFeed(ActiveCapture capture, short[] samples) {
        Thread worker = new Thread(() -> {
            long timestampNanos = System.nanoTime();
            long frameSleepMs = AudioFrameBus.FRAME_MS;
            int frameSamples = AudioFrameBus.FRAME_SAMPLES;
            try {
                if (capture.fixtureStartDelayMs > 0) {
                    sleepQuietly(capture.fixtureStartDelayMs);
                }
                feedSamples(capture, samples, timestampNanos, frameSamples, frameSleepMs);
                if (capture.autoEndpoint) {
                    int silenceFrames = Math.max(1,
                            (int) Math.ceil(Math.max(capture.trailingSilenceMs, AudioFrameBus.FRAME_MS) / (double) AudioFrameBus.FRAME_MS));
                    short[] silence = new short[frameSamples];
                    for (int i = 0; i < silenceFrames; i++) {
                        timestampNanos = timestampNanos + (AudioFrameBus.FRAME_MS * 1_000_000L);
                        if (!deliverFixtureFrame(capture, silence, timestampNanos)) {
                            return;
                        }
                        sleepQuietly(frameSleepMs);
                    }
                }
            } catch (RuntimeException exc) {
                Log.w(TAG, "Fixture feed failed: " + exc.getMessage());
            }
        }, "pucky-walkie-fixture-feed");
        worker.setDaemon(true);
        worker.start();
    }

    private void feedSamples(ActiveCapture capture, short[] samples, long timestampNanos, int frameSamples, long frameSleepMs) {
        int offset = 0;
        while (offset < samples.length) {
            int count = Math.min(frameSamples, samples.length - offset);
            short[] frame = new short[count];
            System.arraycopy(samples, offset, frame, 0, count);
            if (!deliverFixtureFrame(capture, frame, timestampNanos)) {
                return;
            }
            offset += count;
            timestampNanos += AudioFrameBus.FRAME_MS * 1_000_000L;
            sleepQuietly(frameSleepMs);
        }
    }

    private boolean deliverFixtureFrame(ActiveCapture capture, short[] frame, long timestampNanos) {
        synchronized (this) {
            if (active == null || active != capture) {
                return false;
            }
        }
        capture.pcm.onFrame(frame, timestampNanos);
        capture.gate.onFrame(frame, timestampNanos);
        return true;
    }

    private JSONObject stopCaptureSource(ActiveCapture capture) {
        if (capture.bus != null) {
            return capture.bus.stop().optJSONObject("snapshot");
        }
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_frame_bus_snapshot.v1");
        Json.put(out, "state", "stopped");
        Json.put(out, "capture_source", capture.captureSource);
        Json.put(out, "fixture_name", capture.fixtureName);
        Json.put(out, "running", false);
        return out;
    }

    private short[] loadFixtureSamples(String fixtureName) throws CommandException {
        File file = resolveFixtureFile(fixtureName);
        if (!file.exists() || !file.isFile()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Missing fixture WAV: " + fixtureName);
        }
        try {
            return OnDeviceInjectedAudioRecognizer.readPcm16MonoWav(readAllBytes(file));
        } catch (Exception exc) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED,
                    "Unable to read fixture WAV: " + exc.getMessage());
        }
    }

    private File resolveFixtureFile(String fixtureName) {
        String clean = safeFixtureName(fixtureName);
        File[] roots = new File[] {
                context.getExternalFilesDir(null),
                context.getFilesDir(),
        };
        for (File root : roots) {
            if (root == null) {
                continue;
            }
            File dir = new File(root, "turn-fixtures");
            File direct = new File(dir, clean);
            if (direct.exists()) {
                return direct;
            }
            if (!clean.toLowerCase(Locale.US).endsWith(".wav")) {
                File wav = new File(dir, clean + ".wav");
                if (wav.exists()) {
                    return wav;
                }
            }
        }
        File fallbackRoot = context.getExternalFilesDir(null);
        if (fallbackRoot == null) {
            fallbackRoot = context.getFilesDir();
        }
        File fallbackDir = new File(fallbackRoot, "turn-fixtures");
        if (!clean.toLowerCase(Locale.US).endsWith(".wav")) {
            return new File(fallbackDir, clean + ".wav");
        }
        return new File(fallbackDir, clean);
    }

    private static byte[] readAllBytes(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static String normalizeCaptureSource(String raw) {
        String value = raw == null ? "" : raw.trim().toLowerCase(Locale.US);
        if (CAPTURE_SOURCE_FIXTURE.equals(value)) {
            return CAPTURE_SOURCE_FIXTURE;
        }
        return CAPTURE_SOURCE_MIC;
    }

    private static String safeFixtureName(String raw) {
        String clean = raw == null ? "" : raw.trim().replaceAll("[^A-Za-z0-9._-]", "_");
        return clean.length() > 128 ? clean.substring(0, 128) : clean;
    }

    private static void sleepQuietly(long millis) {
        try {
            Thread.sleep(Math.max(0L, millis));
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
        }
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
