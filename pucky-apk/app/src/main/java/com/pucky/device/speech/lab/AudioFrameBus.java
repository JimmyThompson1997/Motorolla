package com.pucky.device.speech.lab;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;

import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public final class AudioFrameBus {
    public static final int SAMPLE_RATE = 16_000;
    public static final int FRAME_MS = 30;
    public static final int FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS / 1_000;
    public static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    public static final int ENCODING = AudioFormat.ENCODING_PCM_16BIT;
    public static final int AUDIO_SOURCE = MediaRecorder.AudioSource.VOICE_RECOGNITION;

    private final Context context;
    private final List<ConsumerSlot> consumers = new ArrayList<>();

    private AudioRecord record;
    private Thread captureThread;
    private volatile boolean running;
    private long startedElapsedMs;
    private long stoppedElapsedMs;
    private long framesRead;
    private long readErrors;
    private String startError = "";
    private String startedAt = "";
    private String stoppedAt = "";

    public AudioFrameBus(Context context) {
        this.context = context.getApplicationContext();
    }

    public synchronized void addConsumer(AudioFrameConsumer consumer) {
        if (running) {
            throw new IllegalStateException("Cannot add consumers after AudioFrameBus starts");
        }
        consumers.add(new ConsumerSlot(consumer));
    }

    @SuppressLint("MissingPermission")
    public synchronized JSONObject start() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_frame_bus_start.v1");
        if (running) {
            Json.put(out, "result", "already_running");
            Json.put(out, "state", "running");
            return out;
        }
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            startError = "RECORD_AUDIO permission is required";
            Json.put(out, "result", "failed");
            Json.put(out, "error", startError);
            return out;
        }
        try {
            int minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, ENCODING);
            int bufferBytes = Math.max(minBuffer, FRAME_SAMPLES * 2 * 8);
            record = new AudioRecord(AUDIO_SOURCE, SAMPLE_RATE, CHANNEL_CONFIG, ENCODING, bufferBytes);
            if (record.getState() != AudioRecord.STATE_INITIALIZED) {
                releaseRecord();
                startError = "AudioRecord failed to initialize";
                Json.put(out, "result", "failed");
                Json.put(out, "error", startError);
                return out;
            }
            framesRead = 0L;
            readErrors = 0L;
            stoppedElapsedMs = 0L;
            startError = "";
            startedAt = Instant.now().toString();
            startedElapsedMs = SystemClock.elapsedRealtime();
            running = true;
            record.startRecording();
            captureThread = new Thread(this::captureLoop, "pucky-audio-frame-bus");
            captureThread.start();
            Json.put(out, "result", "started");
            Json.put(out, "state", "running");
            Json.put(out, "settings", settingsJson());
            return out;
        } catch (RuntimeException exc) {
            running = false;
            releaseRecord();
            startError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
            Json.put(out, "result", "failed");
            Json.put(out, "error", startError);
            return out;
        }
    }

    public synchronized JSONObject stop() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_frame_bus_stop.v1");
        if (!running && record == null) {
            Json.put(out, "result", "not_running");
            Json.put(out, "snapshot", snapshot());
            return out;
        }
        running = false;
        AudioRecord local = record;
        if (local != null) {
            try {
                local.stop();
            } catch (RuntimeException ignored) {
            }
        }
        Thread localThread = captureThread;
        if (localThread != null) {
            try {
                localThread.join(800L);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
            }
        }
        releaseRecord();
        stoppedAt = Instant.now().toString();
        stoppedElapsedMs = SystemClock.elapsedRealtime();
        for (ConsumerSlot slot : consumers) {
            slot.shutdown();
        }
        Json.put(out, "result", "stopped");
        Json.put(out, "snapshot", snapshot());
        return out;
    }

    public synchronized JSONObject snapshot() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.audio_frame_bus_status.v1");
        Json.put(out, "running", running);
        Json.put(out, "settings", settingsJson());
        Json.put(out, "started_at", startedAt.isEmpty() ? JSONObject.NULL : startedAt);
        Json.put(out, "stopped_at", stoppedAt.isEmpty() ? JSONObject.NULL : stoppedAt);
        Json.put(out, "duration_ms", durationMs());
        Json.put(out, "frames_read", framesRead);
        Json.put(out, "read_errors", readErrors);
        Json.put(out, "start_error", startError.isEmpty() ? JSONObject.NULL : startError);
        JSONArray consumerReports = new JSONArray();
        for (ConsumerSlot slot : consumers) {
            Json.add(consumerReports, slot.snapshot());
        }
        Json.put(out, "consumers", consumerReports);
        return out;
    }

    private void captureLoop() {
        short[] buffer = new short[FRAME_SAMPLES];
        while (running) {
            AudioRecord local = record;
            if (local == null) {
                break;
            }
            int read;
            try {
                read = local.read(buffer, 0, buffer.length, AudioRecord.READ_BLOCKING);
            } catch (RuntimeException exc) {
                readErrors += 1;
                continue;
            }
            if (read <= 0) {
                readErrors += 1;
                continue;
            }
            short[] frame = new short[read];
            System.arraycopy(buffer, 0, frame, 0, read);
            long timestamp = System.nanoTime();
            framesRead += 1;
            for (ConsumerSlot slot : consumers) {
                slot.offer(frame, timestamp);
            }
        }
    }

    private synchronized void releaseRecord() {
        if (record != null) {
            try {
                record.release();
            } catch (RuntimeException ignored) {
            }
            record = null;
        }
        captureThread = null;
    }

    private long durationMs() {
        if (startedElapsedMs <= 0L) {
            return 0L;
        }
        long end = running ? SystemClock.elapsedRealtime() : stoppedElapsedMs;
        return Math.max(0L, end - startedElapsedMs);
    }

    private static JSONObject settingsJson() {
        JSONObject out = new JSONObject();
        Json.put(out, "audio_source", "VOICE_RECOGNITION");
        Json.put(out, "sample_rate", SAMPLE_RATE);
        Json.put(out, "channels", 1);
        Json.put(out, "encoding", "PCM_16BIT");
        Json.put(out, "frame_ms", FRAME_MS);
        Json.put(out, "frame_samples", FRAME_SAMPLES);
        return out;
    }

    private static final class ConsumerSlot {
        private final AudioFrameConsumer consumer;
        private final ExecutorService executor;
        private final AtomicBoolean busy = new AtomicBoolean(false);
        private long delivered;
        private long dropped;
        private String lastError = "";

        ConsumerSlot(AudioFrameConsumer consumer) {
            this.consumer = consumer;
            this.executor = Executors.newSingleThreadExecutor(r -> new Thread(r, "pucky-audio-consumer-" + consumer.name()));
        }

        void offer(short[] frame, long timestampNanos) {
            if (!busy.compareAndSet(false, true)) {
                dropped += 1;
                return;
            }
            short[] copy = new short[frame.length];
            System.arraycopy(frame, 0, copy, 0, frame.length);
            executor.execute(() -> {
                try {
                    consumer.onFrame(copy, timestampNanos);
                    delivered += 1;
                } catch (RuntimeException exc) {
                    lastError = exc.getClass().getSimpleName() + ": " + exc.getMessage();
                } finally {
                    busy.set(false);
                }
            });
        }

        JSONObject snapshot() {
            JSONObject out = new JSONObject();
            Json.put(out, "name", consumer.name());
            Json.put(out, "delivered", delivered);
            Json.put(out, "dropped", dropped);
            Json.put(out, "busy", busy.get());
            Json.put(out, "last_error", lastError.isEmpty() ? JSONObject.NULL : lastError);
            Json.put(out, "report", consumer.snapshot());
            return out;
        }

        void shutdown() {
            executor.shutdownNow();
        }
    }
}
