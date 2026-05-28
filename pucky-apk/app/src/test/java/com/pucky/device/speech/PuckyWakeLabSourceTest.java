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
    public void wakeWordControllerOwnsLiveSttSentinel() throws Exception {
        String source = read("src/main/java/com/pucky/device/wake/WakeWordController.java");
        String recognizer = read("src/main/java/com/pucky/device/wake/AndroidWakeRecognizer.java");
        String fakeRecognizer = read("src/main/java/com/pucky/device/wake/FakeWakeRecognizer.java");
        String matcher = read("src/main/java/com/pucky/device/wake/WakeTranscriptMatcher.java");
        String restartPolicy = read("src/main/java/com/pucky/device/wake/WakeRestartPolicy.java");
        String service = read("src/main/java/com/pucky/device/service/PuckyForegroundService.java");
        String family = read("src/main/java/com/pucky/device/wake/WakePhraseFamily.java");

        assertTrue(source.contains("ENGINE_ANDROID_STT_SENTINEL = \"android_stt_sentinel\""));
        assertTrue(source.contains("MODE_ANDROID_STT_WAKE = \"android_stt_wake\""));
        assertTrue(source.contains("new AndroidWakeRecognizer.Factory(context)"));
        assertTrue(source.contains("SpeechRecognizer.isRecognitionAvailable(context)"));
        assertTrue(source.contains("KEY_TRANSCRIPT_HISTORY_JSON"));
        assertTrue(source.contains("KEY_DEBUG_RECOGNIZER_MODE"));
        assertTrue(source.contains("\"debug_recognizer_mode\""));
        assertTrue(source.contains("transcript_history"));
        assertTrue(source.contains("wake.simulate requires transcript or alternatives"));
        assertTrue(source.contains("wake.simulate event must be partial, final, or error"));
        assertTrue(source.contains("playWakeListeningChime(\"pucky.wake_stt_sentinel_match_chime.v1\")"));
        assertTrue(source.contains("Json.put(out, \"proof_indicator\""));
        assertTrue(source.contains("new FakeWakeRecognizer.Factory().create()"));
        assertTrue(source.contains("LATCHED_WAKE_DEBOUNCE_MS = 250L"));
        assertTrue(source.contains("buildWakeTurnStartArgsLocked("));
        assertTrue(source.contains("PuckyTurnController.shared(context).start(action.startTurnArgs)"));
        assertTrue(source.contains("Json.put(out, \"last_handoff_result\""));
        assertFalse(source.contains("AudioFrameBus"));
        assertFalse(source.contains("SileroVadEngine"));
        assertFalse(source.contains("OnDeviceInjectedAudioRecognizer"));
        assertFalse(source.contains("WakeCandidateEndpointPolicy"));
        assertFalse(source.contains("fixtureRun("));
        assertFalse(source.contains("SpeechRecognizer.createOnDeviceSpeechRecognizer(context)"));
        assertTrue(recognizer.contains("SpeechRecognizer.createSpeechRecognizer(context)"));
        assertTrue(recognizer.contains("RecognizerIntent.EXTRA_PARTIAL_RESULTS"));
        assertTrue(recognizer.contains("RecognizerIntent.EXTRA_PREFER_OFFLINE"));
        assertTrue(fakeRecognizer.contains("target.onReady()"));
        assertTrue(fakeRecognizer.contains("target.onStopped()"));
        assertTrue(matcher.contains("matchPartial"));
        assertTrue(matcher.contains("matchFinal"));
        assertTrue(restartPolicy.contains("MAX_ERROR_DELAY_MS = 2000L"));
        assertTrue(service.contains("WakeWordController.shared(this).onServiceStarted()"));
        assertTrue(service.contains("WakeWordController.shared(this).onServiceStopped()"));
        assertTrue(family.contains("ID = \"hey_pucky\""));
        assertTrue(family.contains("\"hey pucky\""));
        assertTrue(family.contains("\"pucky\""));
        assertTrue(family.contains("\"hey pocky\""));
        assertTrue(family.contains("\"hey pookie\""));
        assertTrue(family.contains("\"hey bucky\""));
        assertTrue(family.contains("\"hey pupp\""));
        assertTrue(family.contains("\"hey pucking\""));
        assertTrue(family.contains("\"pooking\""));
        assertTrue(family.contains("\"pokey\""));
        assertFalse(source.contains("LiveKitController"));
    }

    @Test
    public void speechEchoLabIsNowReservedShellOnly() throws Exception {
        String source = read("src/main/java/com/pucky/device/speech/SpeechEchoLabController.java");

        assertTrue(source.contains("\"reserved\", true"));
        assertTrue(source.contains("\"inactive\", true"));
        assertTrue(source.contains("\"button_surface\", \"reserved\""));
        assertTrue(source.contains("\"product_path\", \"volume_up_walkie_release_keyword_intercept\""));
        assertTrue(source.contains("Volume-down walkie lab is reserved"));
        assertFalse(source.contains("pucky_speech_echo_lab"));
        assertFalse(source.contains("recipe_bundle_json"));
        assertFalse(source.contains("recipesSync("));
        assertFalse(source.contains("recipesList("));
        assertFalse(source.contains("recipesTest("));
        assertFalse(source.contains("configGet("));
        assertFalse(source.contains("configSet("));
        assertFalse(source.contains("LiveKit"));
    }

    @Test
    public void recipeControllerOwnsStoredBundleAndLegacyMigration() throws Exception {
        String controller = read("src/main/java/com/pucky/device/speech/PuckyRecipeController.java");
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String capability = read("src/main/java/com/pucky/device/capabilities/CapabilityReporter.java");

        assertTrue(controller.contains("PREFS = \"pucky_recipes\""));
        assertTrue(controller.contains("LEGACY_PREFS = \"pucky_speech_echo_lab\""));
        assertTrue(controller.contains("KEY_MIGRATED_FROM"));
        assertTrue(controller.contains("KEY_MIGRATED_AT"));
        assertTrue(controller.contains("planMigration("));
        assertTrue(controller.contains("legacyPrefs.edit().clear().commit()"));
        assertTrue(controller.contains("SpeechRecipeRegistry.PREF_RECIPE_BUNDLE"));
        assertTrue(controller.contains("clipboardController.append"));
        assertTrue(executor.contains("return puckyRecipeController.sync(command.args())"));
        assertTrue(executor.contains("return puckyRecipeController.list()"));
        assertTrue(executor.contains("return puckyRecipeController.test(command.args())"));
        assertTrue(executor.contains("return puckyRecipeController.clear()"));
        assertTrue(executor.contains("return puckyRecipeController.schema()"));
        assertTrue(executor.contains("return puckyRecipeController.devicePrimitivesList()"));
        assertFalse(executor.contains(removedWakeDebugCommand()));
        assertFalse(executor.contains("return speechEchoLabController.recipesSync(command.args())"));
        assertFalse(executor.contains("\"speech.echo.lab.config.get\""));
        assertFalse(executor.contains("\"speech.echo.lab.config.set\""));
        assertFalse(executor.contains("\"wake.fixture.run\""));
        assertTrue(capability.contains("cap(\"pucky.recipes\""));
        assertTrue(capability.contains("wake.status/wake.config.set/wake.start/wake.stop/wake.simulate"));
        assertTrue(capability.contains("hands accepted wake into a real auto-ended Pucky turn"));
        assertFalse(capability.contains("wake.fixture.run"));
        assertFalse(capability.contains(removedWakeDebugCommand()));
        assertFalse(capability.contains("speech.echo.lab.config.get"));
    }

    @Test
    public void noProductionCodeStillReferencesKeywordActionsJson() throws Exception {
        try (Stream<Path> paths = Files.walk(Path.of("src/main/java"))) {
            paths.filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".java"))
                    .forEach(path -> {
                        try {
                            String source = read(path.toString());
                            assertFalse(path + " must not reference keyword_actions_json",
                                    source.contains("keyword_actions_json"));
                        } catch (Exception exc) {
                            throw new AssertionError(exc);
                        }
                    });
        }
    }

    @Test
    public void recipeRegistryIsTheOnlyActiveKeywordSource() throws Exception {
        String recipes = read("src/main/java/com/pucky/device/speech/SpeechRecipeRegistry.java");
        String normalizer = read("src/main/java/com/pucky/device/speech/SpeechTextNormalizer.java");
        String interceptor = read("src/main/java/com/pucky/device/speech/PuckyTurnKeywordInterceptor.java");
        String fallbackAsset = read("src/main/assets/pucky_recipes_fallback.json");

        assertTrue(recipes.contains("pucky.recipe_bundle.v1"));
        assertTrue(recipes.contains("pucky_recipes_fallback.json"));
        assertTrue(recipes.contains("SpeechTextNormalizer.normalize("));
        assertFalse(recipes.contains("SpeechKeywordMatcher.normalize("));
        assertFalse(fallbackAsset.contains("\"hey_pucky\""));
        assertFalse(fallbackAsset.contains("\"mic_on\""));
        assertFalse(fallbackAsset.contains("\"mic_off\""));
        assertTrue(interceptor.contains("PuckyRecipeController.shared(context).storedRecipeBundleRaw()"));
        assertFalse(Files.exists(Path.of("src/main/java/com/pucky/device/speech/SpeechKeywordMatcher.java")));
        assertTrue(normalizer.contains("replaceAll(\"[^a-z0-9\\\\s]\", \" \")"));
    }

    @Test
    public void programmableActionsStayAllowlistedAndVmOwned() throws Exception {
        String recipes = read("src/main/java/com/pucky/device/speech/SpeechRecipeRegistry.java");
        String recipeSteps = read("src/main/java/com/pucky/device/speech/RecipeStepExecutor.java");
        String executor = read("src/main/java/com/pucky/device/speech/RecipeDevicePrimitiveExecutor.java");
        String clipboard = read("src/main/java/com/pucky/device/clipboard/PuckyClipboardController.java");
        String broker = read("../fly-broker/pucky_fly_broker.py");

        assertTrue(executor.contains("COMMAND_TORCH_SET = \"torch.set\""));
        assertTrue(executor.contains("COMMAND_PHOTO_CAPTURE = \"photo.capture\""));
        assertTrue(executor.contains("COMMAND_LOCATION_PIN = \"location.pin\""));
        assertTrue(executor.contains("COMMAND_SCREENSHOT_CAPTURE = \"screenshot.capture\""));
        assertTrue(executor.contains("COMMAND_VIDEO_CAPTURE_START = \"video.capture.start\""));
        assertTrue(executor.contains("COMMAND_VIDEO_CAPTURE_STOP = \"video.capture.stop\""));
        assertTrue(executor.contains("COMMAND_NOTIFY_SHOW = \"notify.show\""));
        assertFalse(executor.contains("LiveKit"));
        assertFalse(executor.contains("pucky.turn"));
        assertFalse(executor.contains("shell.exec"));
        assertTrue(recipes.contains("vm_event"));
        assertFalse(recipes.contains("legacy_keyword"));
        assertFalse(recipes.contains("keyword_actions_json"));
        assertFalse(recipes.contains("shell.exec"));
        assertTrue(recipeSteps.contains("pucky.keyword_triggered.v1"));
        assertTrue(recipeSteps.contains("vm_event.post"));
        assertTrue(recipeSteps.contains("BrokerEventPoster"));
        assertFalse(recipeSteps.contains("LiveKit"));
        assertTrue(clipboard.contains("android_system_clipboard\", false"));
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

    private static String removedWakeDebugCommand() {
        return "wake.debug." + "confirm" + "_artifact";
    }
}
