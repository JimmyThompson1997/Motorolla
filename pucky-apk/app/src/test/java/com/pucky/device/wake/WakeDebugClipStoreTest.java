package com.pucky.device.wake;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.pucky.device.speech.OnDeviceInjectedAudioRecognizer;

import org.junit.Test;

import java.nio.file.Files;
import java.nio.file.Path;

public final class WakeDebugClipStoreTest {
    @Test
    public void saveWritesOneCandidateClipAndOverwriteReusesSamePath() throws Exception {
        Path tempDir = Files.createTempDirectory("wake-debug-store");
        WakeDebugClipStore store = new WakeDebugClipStore(tempDir.toFile());

        short[] first = new short[] {1, 2, 3, 4};
        String firstPath = store.save(first);
        byte[] firstBytes = Files.readAllBytes(Path.of(firstPath));
        assertEquals(Path.of(tempDir.toString(), WakeDebugClipStore.RELATIVE_PATH), Path.of(firstPath));
        assertArrayEquals(first, OnDeviceInjectedAudioRecognizer.readPcm16MonoWav(firstBytes));

        short[] second = new short[] {9, 8, 7, 6, 5, 4, 3, 2};
        String secondPath = store.save(second);
        byte[] secondBytes = Files.readAllBytes(Path.of(secondPath));
        assertEquals(firstPath, secondPath);
        assertArrayEquals(second, OnDeviceInjectedAudioRecognizer.readPcm16MonoWav(secondBytes));
        assertTrue(secondBytes.length > firstBytes.length);
    }

    @Test
    public void clearRemovesSavedClip() throws Exception {
        Path tempDir = Files.createTempDirectory("wake-debug-store-clear");
        WakeDebugClipStore store = new WakeDebugClipStore(tempDir.toFile());
        String savedPath = store.save(new short[] {1, 2, 3, 4});

        assertTrue(Files.exists(Path.of(savedPath)));
        assertTrue(store.clear());
        assertFalse(Files.exists(Path.of(savedPath)));
        assertTrue(store.currentPathIfExists().isEmpty());
    }

    @Test
    public void durationUsesWakeSampleRate() {
        assertEquals(0, WakeDebugClipStore.durationMs(new short[0]));
        assertEquals(1000, WakeDebugClipStore.durationMs(new short[WakeDebugClipStore.SAMPLE_RATE]));
    }
}
