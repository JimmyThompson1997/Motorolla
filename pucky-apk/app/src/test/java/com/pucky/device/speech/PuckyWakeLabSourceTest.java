package com.pucky.device.speech;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

public final class PuckyWakeLabSourceTest {
    @Test
    public void productionBuildHasNoPicovoicePorcupineDependencyOrImports() throws Exception {
        String build = read("build.gradle");
        assertFalse(build.contains("ai.picovoice"));
        assertFalse(build.contains("porcupine-android"));

        try (Stream<Path> paths = Files.walk(Path.of("src/main/java"))) {
            paths.filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".java"))
                    .forEach(path -> {
                        try {
                            String source = read(path.toString());
                            assertFalse(path + " imports Picovoice", source.contains("ai.picovoice"));
                            assertFalse(path + " references PorcupineManager", source.contains("PorcupineManager"));
                        } catch (Exception exc) {
                            throw new AssertionError(exc);
                        }
                    });
        }
    }

    @Test
    public void wakeWordControllerIsDisabledCompatibilityStub() throws Exception {
        String source = read("src/main/java/com/pucky/device/wake/WakeWordController.java");

        assertTrue(source.contains("engine\", \"none\""));
        assertTrue(source.contains("enabled\", false"));
        assertTrue(source.contains("running\", false"));
        assertTrue(source.contains("configured\", false"));
        assertTrue(source.contains("porcupine_removed_license_risk"));
        assertTrue(source.contains("volume_down_lab_openwakeword_experiment"));
        assertFalse(source.contains("NotificationController"));
        assertFalse(source.contains("Vibrator"));
        assertFalse(source.contains("LiveKitController"));
    }

    @Test
    public void speechEchoLabCodeDoesNotReferenceLiveKit() throws Exception {
        assertNoLiveKit(Path.of("src/main/java/com/pucky/device/speech/SpeechEchoLabController.java"));
        try (Stream<Path> paths = Files.walk(Path.of("src/main/java/com/pucky/device/speech/lab"))) {
            paths.filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".java"))
                    .forEach(path -> {
                        try {
                            assertNoLiveKit(path);
                        } catch (Exception exc) {
                            throw new AssertionError(exc);
                        }
                    });
        }
    }

    @Test
    public void labControllerKeepsDirectEchoDefaultAndFrameBusEnginesSeparate() throws Exception {
        String source = read("src/main/java/com/pucky/device/speech/SpeechEchoLabController.java");

        assertTrue(source.contains("ENGINE_ANDROID_DIRECT_ECHO = \"android_direct_echo\""));
        assertTrue(source.contains("ENGINE_ANDROID_CAPTURED_AUDIO_ECHO = \"android_captured_audio_echo\""));
        assertTrue(source.contains("ENGINE_FRAME_BUS_METRICS = \"frame_bus_metrics\""));
        assertTrue(source.contains("ENGINE_FRAME_BUS_VAD = \"frame_bus_vad\""));
        assertTrue(source.contains("ENGINE_FRAME_BUS_WAKE = \"frame_bus_wake\""));
        assertTrue(source.contains("SpeechEchoController.shared(this.context)"));
        assertTrue(source.contains("new AudioFrameBus(context)"));
        assertTrue(source.contains("new PcmCaptureConsumer()"));
        assertTrue(source.contains("new SileroVadConsumer(context)"));
        assertTrue(source.contains("new OpenWakeWordConsumer(context)"));
        assertTrue(source.contains("raw_audio_saved\", false"));
        assertTrue(source.contains("broker_delivery_status\", \"disabled_lab_local\""));
        assertTrue(source.contains("agent_runtime\", \"none\""));
    }

    @Test
    public void labControllerSyncsAsyncDirectEchoFinalStateIntoLabSession() throws Exception {
        String source = read("src/main/java/com/pucky/device/speech/SpeechEchoLabController.java");

        assertTrue(source.contains("syncDirectEchoCompletions()"));
        assertTrue(source.contains("scheduleDirectEchoSync()"));
        assertTrue(source.contains("postDelayed"));
        assertTrue(source.contains("direct_echo_session_id"));
        assertTrue(source.contains("direct_echo_final_synced"));
        assertTrue(source.contains("\"final_transcript\""));
        assertTrue(source.contains("\"state\", \"Completed\""));
        assertTrue(source.contains("\"state\", \"Failed\""));
    }

    @Test
    public void capturedAudioEchoUsesButtonBoundedAudioSourceAndAndroidTts() throws Exception {
        String source = read("src/main/java/com/pucky/device/speech/SpeechEchoLabController.java");
        String bus = read("src/main/java/com/pucky/device/speech/lab/AudioFrameBus.java");

        assertTrue(source.contains("ENGINE_ANDROID_CAPTURED_AUDIO_ECHO"));
        assertTrue(source.contains("endpointing\", \"button_release_only\""));
        assertTrue(source.contains("RecognizerIntent.EXTRA_AUDIO_SOURCE"));
        assertTrue(source.contains("RecognizerIntent.EXTRA_SEGMENTED_SESSION"));
        assertTrue(source.contains("RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE"));
        assertTrue(source.contains("TextToSpeech.QUEUE_FLUSH"));
        assertTrue(source.contains("buzzOneShot(RELEASE_HAPTIC_MS"));
        assertTrue(source.contains("final_transcript"));
        assertTrue(bus.contains("addSynchronousConsumer"));
    }

    @Test
    public void routeDetectorUsesModernInputDevicesWithLegacyDebugOnly() throws Exception {
        String detector = read("src/main/java/com/pucky/device/audio/AudioRouteDetector.java");
        String controller = read("src/main/java/com/pucky/device/audio/AudioController.java");

        assertTrue(detector.contains("AudioManager.GET_DEVICES_INPUTS"));
        assertTrue(detector.contains("Route.Bluetooth"));
        assertTrue(detector.contains("Route.WiredHeadset"));
        assertTrue(detector.contains("Route.Phone"));
        assertTrue(detector.contains("bluetooth_sco_on_legacy"));
        assertTrue(detector.contains("wired_headset_on_legacy"));
        assertTrue(controller.contains("new AudioRouteDetector(context).snapshot()"));
    }

    @Test
    public void docsPacketExistsForEveryLabSection() {
        String[] docs = new String[] {
                "00-index.md",
                "01-current-codebase-baseline.md",
                "02-volume-down-lab-contract.md",
                "03-legacy-porcupine-removal.md",
                "04-lab-state-machine.md",
                "05-audio-route-detector.md",
                "06-audio-frame-bus-and-preroll.md",
                "07-vad-noise-and-endpoint-metrics.md",
                "08-openwakeword-lab.md",
                "09-fixtures-quality-and-performance.md",
                "10-test-plan-and-phase-gates.md",
                "11-rollout-and-acceptance.md"
        };
        for (String doc : docs) {
            assertTrue(doc + " exists", Files.exists(Path.of("../docs/pucky-wake-lab", doc))
                    || Files.exists(Path.of("..", "..", "docs/pucky-wake-lab", doc))
                    || Files.exists(Path.of("docs/pucky-wake-lab", doc)));
        }
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }

    private static void assertNoLiveKit(Path path) throws Exception {
        String source = read(path.toString());
        assertFalse(path + " must not import LiveKit", source.contains("com.pucky.device.livekit"));
        assertFalse(path + " must not mention LiveKit", source.contains("LiveKit"));
    }
}
