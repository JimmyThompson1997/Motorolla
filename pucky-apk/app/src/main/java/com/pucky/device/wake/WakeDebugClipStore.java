package com.pucky.device.wake;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

final class WakeDebugClipStore {
    static final String RELATIVE_PATH = "wake-debug/last_candidate.wav";
    static final int SAMPLE_RATE = 16_000;

    private final File filesDir;

    WakeDebugClipStore(File filesDir) {
        this.filesDir = filesDir;
    }

    File targetFile() {
        return new File(filesDir, RELATIVE_PATH);
    }

    String currentPathIfExists() {
        File target = targetFile();
        return target.exists() ? target.getAbsolutePath() : "";
    }

    String save(short[] samples) throws IOException {
        File target = targetFile();
        File parent = target.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Failed to create wake debug directory");
        }
        writeWav(target, samples == null ? new short[0] : samples, SAMPLE_RATE);
        return target.getAbsolutePath();
    }

    boolean clear() {
        File target = targetFile();
        boolean deleted = !target.exists() || target.delete();
        File parent = target.getParentFile();
        if (parent != null && parent.exists()) {
            File[] children = parent.listFiles();
            if (children != null && children.length == 0) {
                // best-effort cleanup; the directory is purely for this one file
                parent.delete();
            }
        }
        return deleted;
    }

    static int durationMs(short[] samples) {
        if (samples == null || samples.length == 0) {
            return 0;
        }
        return (int) Math.round(samples.length * 1000.0 / SAMPLE_RATE);
    }

    private static void writeWav(File file, short[] samples, int sampleRate) throws IOException {
        int dataBytes = samples.length * 2;
        try (FileOutputStream output = new FileOutputStream(file, false)) {
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

    private static void writeAscii(FileOutputStream output, String value) throws IOException {
        output.write(value.getBytes(StandardCharsets.US_ASCII));
    }

    private static void writeIntLe(FileOutputStream output, int value) throws IOException {
        output.write(value & 0xff);
        output.write((value >> 8) & 0xff);
        output.write((value >> 16) & 0xff);
        output.write((value >> 24) & 0xff);
    }

    private static void writeShortLe(FileOutputStream output, int value) throws IOException {
        output.write(value & 0xff);
        output.write((value >> 8) & 0xff);
    }
}
