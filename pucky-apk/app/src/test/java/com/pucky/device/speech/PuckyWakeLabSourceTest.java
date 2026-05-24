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
        assertTrue(source.contains("USAGE_MEDIA"));
        assertFalse(source.contains("USAGE_ASSISTANCE_ACCESSIBILITY"));
        assertTrue(source.contains("waiting_for_tts"));
        assertTrue(source.contains("ready_after_first_audio_frame"));
        assertTrue(source.contains("recognizer_leading_padding_ms"));
        assertFalse(source.contains("RecognizerIntent.EXTRA_ENABLE_LANGUAGE_DETECTION"));
        assertTrue(source.contains("recipeMatch(text)"));
        assertTrue(source.contains("RecipeDevicePrimitiveExecutor"));
        assertTrue(source.contains("keyword_lab_enabled"));
        assertTrue(source.contains("keyword_match_strategy"));
        assertTrue(source.contains("exact_utterance"));
        assertTrue(source.contains("keyword_reply_tts_replaces_echo"));
        assertTrue(source.contains("keyword_action_confirms_with_local_chime"));
        assertTrue(source.contains("skipped_keyword_action_chime"));
        assertTrue(source.contains("shouldSkipSuccessTts"));
        assertTrue(source.contains("keyword_success_chime"));
        assertTrue(source.contains("pucky.keyword_success_chime.v1"));
        assertTrue(source.contains("pucky.keyword_action_failure_chime.v1"));
        assertTrue(source.contains("skipped_keyword_action_pending"));
        assertTrue(source.contains("PuckyClipboardController.entryFromLabSession(active)"));
        assertTrue(source.contains("pucky_clipboard_saved"));
        assertTrue(source.contains("keyword_action_status"));
        assertTrue(source.contains("keyword_action_result"));
        assertTrue(source.contains("keyword_action_failure_chime"));
        assertTrue(source.contains("action_failure_chime"));
        assertTrue(source.contains("keyword_action_pending"));
        assertTrue(source.contains("keyword_action_error_message"));
        assertTrue(source.contains("buzzOneShot(RELEASE_HAPTIC_MS"));
        assertTrue(source.contains("final_transcript"));
        assertTrue(bus.contains("addSynchronousConsumer"));
    }

    @Test
    public void programmableKeywordActionsAreLabScopedAndAllowlisted() throws Exception {
        String controller = read("src/main/java/com/pucky/device/speech/SpeechEchoLabController.java");
        String executor = read("src/main/java/com/pucky/device/speech/RecipeDevicePrimitiveExecutor.java");
        String recipes = read("src/main/java/com/pucky/device/speech/SpeechRecipeRegistry.java");
        String recipeSteps = read("src/main/java/com/pucky/device/speech/RecipeStepExecutor.java");
        String clipboard = read("src/main/java/com/pucky/device/clipboard/PuckyClipboardController.java");

        assertTrue(controller.contains("recipesList()"));
        assertTrue(controller.contains("recipesSync(JSONObject args)"));
        assertTrue(controller.contains("recipesTest(JSONObject args)"));
        assertTrue(controller.contains("clipboardController.append"));
        assertFalse(controller.contains("speech.echo.lab.keyword."));
        assertFalse(Files.exists(Path.of("src/main/java/com/pucky/device/speech/SpeechKeywordRegistry.java")));
        assertFalse(Files.exists(Path.of("src/main/java/com/pucky/device/speech/SpeechKeywordActionExecutor.java")));
        assertTrue(executor.contains("COMMAND_TORCH_SET = \"torch.set\""));
        assertTrue(executor.contains("actionArgsObject"));
        assertTrue(executor.contains("DEFAULT_TORCH_AUTO_OFF_MS = 600"));
        assertTrue(executor.contains("MIN_TORCH_AUTO_OFF_MS = 100"));
        assertTrue(executor.contains("MAX_TORCH_AUTO_OFF_MS = 1500"));
        assertTrue(executor.contains("COMMAND_PHOTO_CAPTURE = \"photo.capture\""));
        assertTrue(executor.contains("DEFAULT_PHOTO_MAX_WIDTH = 1280"));
        assertTrue(executor.contains("COMMAND_LOCATION_PIN = \"location.pin\""));
        assertTrue(executor.contains("DEFAULT_LOCATION_TIMEOUT_MS = 60000L"));
        assertTrue(executor.contains("DEFAULT_LOCATION_MAX_CACHE_AGE_MS = 30000L"));
        assertTrue(executor.contains("COMMAND_SCREENSHOT_CAPTURE = \"screenshot.capture\""));
        assertTrue(executor.contains("COMMAND_VIDEO_CAPTURE_START = \"video.capture.start\""));
        assertTrue(executor.contains("COMMAND_VIDEO_CAPTURE_STOP = \"video.capture.stop\""));
        assertTrue(executor.contains("cameraController.capture"));
        assertTrue(executor.contains("locationController"));
        assertTrue(executor.contains("screenshotController"));
        assertTrue(executor.contains("playSuccessChime"));
        assertTrue(executor.contains("playFailureChime"));
        assertTrue(executor.contains("Soft.ogg"));
        assertTrue(executor.contains("LowBattery.ogg"));
        assertTrue(executor.contains("MediaPlayer"));
        assertTrue(executor.contains("\"suppress_chime\", true"));
        assertTrue(executor.contains("TONE_PROP_NACK"));
        assertTrue(executor.contains("videoCaptureController"));
        assertTrue(executor.contains("new CameraController(this.context)"));
        assertTrue(recipes.contains("pucky.recipe_bundle.v1"));
        assertTrue(recipes.contains("PREF_RECIPE_BUNDLE"));
        assertTrue(recipes.contains("pucky_recipes_fallback.json"));
        assertTrue(recipes.contains("vm_event"));
        assertFalse(recipes.contains("legacy_keyword"));
        assertFalse(recipes.contains("keyword_actions_json"));
        assertTrue(recipeSteps.contains("pucky.keyword_triggered.v1"));
        assertTrue(recipeSteps.contains("BrokerEventPoster"));
        assertTrue(recipeSteps.contains("devicePrimitives"));
        assertTrue(recipeSteps.contains("vm_event.post"));
        assertTrue(recipeSteps.contains("RecipeDevicePrimitiveExecutor"));
        assertTrue(clipboard.contains("android_system_clipboard\", false"));
        assertTrue(clipboard.contains("MAX_ENTRIES = 250"));
        assertTrue(clipboard.contains("RETENTION_MS = 30L * 24L * 60L * 60L * 1000L"));
        assertFalse(executor.contains("LiveKit"));
        assertFalse(executor.contains("pucky.turn"));
        assertFalse(executor.contains("shell.exec"));
        assertFalse(recipes.contains("shell.exec"));
        assertFalse(recipeSteps.contains("LiveKit"));
    }

    @Test
    public void recipeCommandsAreAllowlistedAndDocumented() throws Exception {
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String capability = read("src/main/java/com/pucky/device/capabilities/CapabilityReporter.java");
        String broker = read("../fly-broker/pucky_fly_broker.py");

        assertTrue(executor.contains("\"pucky.recipes.sync\""));
        assertTrue(executor.contains("\"pucky.recipes.list\""));
        assertTrue(executor.contains("\"pucky.recipes.test\""));
        assertTrue(executor.contains("\"pucky.recipes.clear\""));
        assertTrue(executor.contains("\"pucky.recipes.schema\""));
        assertTrue(executor.contains("\"device.primitives.list\""));
        assertFalse(executor.contains("\"speech.echo.lab.keyword."));
        assertTrue(capability.contains("VM-owned recipes"));
        assertTrue(broker.contains("pucky.keyword_triggered.v1"));
        assertTrue(broker.contains("DEVICE_ID_MISMATCH"));
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
                "11-rollout-and-acceptance.md",
                "12-vm-owned-recipes.md",
                "13-keyword-manual-test-spec.md"
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
