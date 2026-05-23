package com.pucky.device.pucky;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Pattern;

public final class PuckyTurnSourceTest {
    @Test
    public void buttonDefaultsRouteVolumeUpToTurnAndVolumeDownToLab() throws Exception {
        String source = read("src/main/java/com/pucky/device/buttons/ButtonController.java");

        assertTrue(source.contains("CONFIG_VERSION = 22"));
        assertTrue(source.contains("DEFAULT_LONG_PRESS_MS = 200"));
        assertTrue(source.contains("clamp(config.optInt(\"long_press_ms\", DEFAULT_LONG_PRESS_MS), 200, 1200)"));
        assertTrue(source.contains("\"android_volume_pucky_speech_echo_lab_v22\""));
        assertTrue(source.contains("Json.put(mappings, \"volume_up_hold\", \"pucky.turn.start\")"));
        assertTrue(source.contains("Json.put(mappings, \"volume_up_hold_release\", \"pucky.turn.stop\")"));
        assertTrue(source.contains("Json.put(mappings, \"volume_down_hold\", \"speech.echo.lab.start\")"));
        assertTrue(source.contains("Json.put(mappings, \"volume_down_hold_release\", \"speech.echo.lab.stop\")"));
        assertTrue(source.contains("PuckyTurnController.shared(context).start(new JSONObject())"));
        assertTrue(source.contains("PuckyTurnController.shared(context).stop(reasonArgs(\"button_release\"))"));
        assertTrue(source.contains("SpeechEchoLabController.shared(context).start(new JSONObject())"));
        assertTrue(source.contains("SpeechEchoLabController.shared(context).stop(reasonArgs(\"button_release\"))"));
        assertTrue(source.contains("SpeechEchoController.shared(context).start(new JSONObject())"));
        assertTrue(source.contains("SpeechEchoController.shared(context).stop(reasonArgs(\"button_release\"))"));
        assertFalse(source.contains("Json.put(mappings, \"volume_up_hold\", \"livekit.ptt.start\")"));
        assertFalse(source.contains("LiveKitController"));
        assertFalse(source.contains("livekit."));
    }

    @Test
    public void apkBuildAndRuntimeCommandPathDoNotExposeLiveKit() throws Exception {
        String build = read("build.gradle");
        assertFalse(build.contains("org.jetbrains.kotlin.android"));
        assertFalse(build.contains("io.livekit"));
        assertFalse(build.contains("kotlinx-coroutines"));
        assertFalse(Files.exists(Path.of("src/main/java/com/pucky/device/livekit/LiveKitController.kt")));

        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String service = read("src/main/java/com/pucky/device/service/PuckyForegroundService.java");
        String status = read("src/main/java/com/pucky/device/status/StatusProvider.java");
        String assistant = read("src/main/java/com/pucky/device/assistant/PuckyAssistantController.java");
        String speech = read("src/main/java/com/pucky/device/speech/NativeSpeechController.java");
        assertFalse(executor.contains("com.pucky.device.livekit"));
        assertFalse(executor.contains("LiveKitController"));
        assertFalse(executor.contains("livekit."));
        assertFalse(service.contains("LiveKitController"));
        assertFalse(status.contains("LiveKitController"));
        assertFalse(assistant.contains("LiveKitController"));
        assertFalse(speech.contains("LiveKitController"));
    }

    @Test
    public void volumeDownEchoUsesDirectOnDeviceSpeechRecognizer() throws Exception {
        String echo = read("src/main/java/com/pucky/device/speech/SpeechEchoController.java");
        String capture = read("src/main/java/com/pucky/device/voice/VoiceCaptureController.java");

        assertTrue(echo.contains("SpeechRecognizer.createOnDeviceSpeechRecognizer(context)"));
        assertTrue(echo.contains("recognizer.stopListening()"));
        assertFalse(echo.contains("import android.media.AudioRecord;"));
        assertFalse(echo.contains("RecognizerIntent.EXTRA_AUDIO_SOURCE"));
        assertFalse(echo.contains("RecognizerIntent.EXTRA_SEGMENTED_SESSION"));
        assertFalse(echo.contains("raw_audio_container\", \"wav\""));
        assertFalse(capture.contains("import android.media.MediaPlayer;"));
        assertFalse(capture.contains("playCapturePlayback"));
    }

    @Test
    public void nativeCommandExecutorAllowlistsPuckyTurnCommands() throws Exception {
        String source = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String service = read("src/main/java/com/pucky/device/service/PuckyForegroundService.java");

        assertTrue(source.contains("\"pucky.turn.status\""));
        assertTrue(source.contains("\"pucky.turn.start\""));
        assertTrue(source.contains("\"pucky.turn.stop\""));
        assertTrue(source.contains("return puckyTurnController.status()"));
        assertTrue(source.contains("return puckyTurnController.start(command.args())"));
        assertTrue(source.contains("return puckyTurnController.stop(command.args())"));
        assertTrue(service.contains("PuckyTurnController.shared(this)"));
    }

    @Test
    public void nativeCommandExecutorAllowlistsSpeechEchoLabCommands() throws Exception {
        String source = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String service = read("src/main/java/com/pucky/device/service/PuckyForegroundService.java");

        assertTrue(source.contains("\"speech.echo.lab.status\""));
        assertTrue(source.contains("\"speech.echo.lab.start\""));
        assertTrue(source.contains("\"speech.echo.lab.stop\""));
        assertTrue(source.contains("\"speech.echo.lab.last\""));
        assertTrue(source.contains("\"speech.echo.lab.list\""));
        assertTrue(source.contains("\"speech.echo.lab.config.get\""));
        assertTrue(source.contains("\"speech.echo.lab.config.set\""));
        assertTrue(source.contains("\"speech.echo.lab.keyword.list\""));
        assertTrue(source.contains("\"speech.echo.lab.keyword.set\""));
        assertTrue(source.contains("\"speech.echo.lab.keyword.delete\""));
        assertTrue(source.contains("\"speech.echo.lab.keyword.clear\""));
        assertTrue(source.contains("\"speech.echo.lab.keyword.test\""));
        assertTrue(source.contains("\"speech.echo.lab.keyword.schema\""));
        assertTrue(source.contains("return speechEchoLabController.status()"));
        assertTrue(source.contains("return speechEchoLabController.start(command.args())"));
        assertTrue(source.contains("return speechEchoLabController.stop(command.args())"));
        assertTrue(source.contains("return speechEchoLabController.configGet()"));
        assertTrue(source.contains("return speechEchoLabController.configSet(command.args())"));
        assertTrue(source.contains("return speechEchoLabController.keywordList()"));
        assertTrue(source.contains("return speechEchoLabController.keywordSet(command.args())"));
        assertTrue(source.contains("return speechEchoLabController.keywordDelete(command.args())"));
        assertTrue(source.contains("return speechEchoLabController.keywordClear()"));
        assertTrue(source.contains("return speechEchoLabController.keywordTest(command.args())"));
        assertTrue(source.contains("return speechEchoLabController.keywordSchema()"));
        assertTrue(service.contains("SpeechEchoLabController.shared(this)"));
    }

    @Test
    public void nativeCommandExecutorAllowlistsPuckyClipboardCommands() throws Exception {
        String source = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String service = read("src/main/java/com/pucky/device/service/PuckyForegroundService.java");

        assertTrue(source.contains("\"pucky.clipboard.list\""));
        assertTrue(source.contains("\"pucky.clipboard.last\""));
        assertTrue(source.contains("\"pucky.clipboard.read\""));
        assertTrue(source.contains("\"pucky.clipboard.delete\""));
        assertTrue(source.contains("\"pucky.clipboard.clear\""));
        assertTrue(source.contains("return puckyClipboardController.list(command.args())"));
        assertTrue(source.contains("return puckyClipboardController.last()"));
        assertTrue(source.contains("return puckyClipboardController.read(command.args())"));
        assertTrue(source.contains("return puckyClipboardController.delete(command.args())"));
        assertTrue(source.contains("return puckyClipboardController.clear()"));
        assertTrue(service.contains("PuckyClipboardController.shared(this)"));
    }

    @Test
    public void controllerPostsRawAudioAndCreatesOneFeedCard() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");
        String store = read("src/main/java/com/pucky/device/ui/ReplyCardStore.java");

        assertTrue(source.contains("VoiceCaptureController.shared(context).start(startArgs)"));
        assertTrue(source.contains("String clientTurnId = generateClientTurnId()"));
        assertTrue(source.contains("SpeechGate gate = new SpeechGate"));
        assertTrue(source.contains("startSpeechGatePoll(localSessionId, clientTurnId, gate)"));
        assertTrue(source.contains("Json.put(startArgs, \"format\", \"m4a\")"));
        assertTrue(source.contains("Json.put(startArgs, \"feedback\", args.optBoolean(\"feedback\", true))"));
        assertTrue(source.contains("MediaType.get(\"audio/mp4\")"));
        assertTrue(source.contains(".header(\"Authorization\", \"Bearer \" + settings.getPuckyTurnAuthToken())"));
        assertTrue(source.contains(".header(\"X-Pucky-Turn-Id\", clientTurnId)"));
        assertTrue(source.contains("submitAsync(localSessionId, clientTurnId, audioBytes)"));
        assertTrue(source.contains("Json.put(out, \"turn_id\", clientTurnId)"));
        assertTrue(source.contains("new File(context.getFilesDir(), \"pucky_replies\""));
        assertTrue(source.contains("Json.put(card, \"session_id\", sessionId)"));
        assertTrue(source.contains("new ReplyCardStore(context).prepend(card)"));
        assertTrue(source.contains("Json.put(args, \"source\", \"pucky.turn\")"));
        assertTrue(source.contains("PlayerController.shared(context).play(args)"));
        assertTrue(source.contains("markStatus(\"speaking\", status, null)"));
        assertTrue(source.contains("Json.put(status, \"server_telemetry\", parsed.telemetry())"));
        assertTrue(store.contains("public JSONObject prepend(JSONObject cardJson)"));
        assertTrue(store.contains("cards.add(card);"));
        assertTrue(store.contains("cards.addAll(cards());"));
        assertFalse(Pattern.compile("Log\\.[^;]*getPuckyTurnAuthToken", Pattern.DOTALL).matcher(source).find());
    }

    @Test
    public void settingsCanProvisionPuckyTurnEndpointWithoutHardcodingSecret() throws Exception {
        String source = read("src/main/java/com/pucky/device/storage/SettingsStore.java");

        assertTrue(source.contains("\"pucky_turn_url\""));
        assertTrue(source.contains("\"pucky_api_token\""));
        assertTrue(source.contains("https://pucky.fly.dev/api/turn"));
        assertTrue(source.contains("putString(editor, input, \"pucky_api_token\""));
        assertTrue(source.contains("public String getPuckyTurnAuthToken()"));
        assertTrue(source.contains("String brokerToken = getToken();"));
        assertTrue(source.contains("return getPuckyTurnAuthToken();"));
    }

    @Test
    public void statusExposesWalkieIndicatorsWithoutTokenValues() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");
        String capture = read("src/main/java/com/pucky/device/voice/VoiceCaptureController.java");

        assertTrue(source.contains("Json.put(out, \"player_state\", player)"));
        assertTrue(source.contains("Json.put(out, \"indicator\", indicator)"));
        assertTrue(source.contains("Json.put(out, \"visual_state\", indicator.optString(\"visual_state\", \"idle\"))"));
        assertTrue(source.contains("Json.put(out, \"speech_gate\", gate == null ? JSONObject.NULL : gate)"));
        assertTrue(source.contains("Json.put(out, \"speech_detected\", indicator.optBoolean(\"speech_detected\", false))"));
        assertTrue(source.contains("Json.put(out, \"peak_amplitude\", indicator.optInt(\"peak_amplitude\", 0))"));
        assertTrue(source.contains("Json.put(out, \"samples_over_threshold\", indicator.optInt(\"samples_over_threshold\", 0))"));
        assertTrue(source.contains("Json.put(out, \"mic_on\", indicator.optBoolean(\"mic_on\", false))"));
        assertTrue(source.contains("Json.put(out, \"hearing\", indicator.optBoolean(\"hearing\", false))"));
        assertTrue(source.contains("Json.put(out, \"uploading\", indicator.optBoolean(\"uploading\", false))"));
        assertTrue(source.contains("Json.put(out, \"codex_running\", indicator.optBoolean(\"codex_running\", false))"));
        assertTrue(source.contains("Json.put(out, \"speaking\", indicator.optBoolean(\"speaking\", false))"));
        assertTrue(source.contains("Json.put(out, \"failed\", indicator.optBoolean(\"failed\", false))"));
        assertTrue(source.contains("\"pucky.turn_indicator.v1\""));
        assertTrue(source.contains("\"armed\""));
        assertTrue(source.contains("\"discarded_silence\""));
        assertTrue(source.contains("visualStateFor(state"));
        assertTrue(source.contains("boolean codexRunning"));
        assertTrue(source.contains("Json.put(out, \"codex_running\", codexRunning)"));
        assertTrue(source.contains("micOn || uploading || codexRunning || speaking || failed"));
        assertTrue(capture.contains("VOICE_CAPTURE_AMPLITUDE_THRESHOLD"));
        assertTrue(capture.contains("recorder.getMaxAmplitude()"));
        assertTrue(capture.contains("public synchronized int sampleAmplitude()"));
        assertTrue(capture.contains("public synchronized JSONObject discard(JSONObject args)"));
        assertTrue(capture.contains("Json.put(out, \"amplitude\", amplitude)"));
        assertTrue(capture.contains("Json.put(out, \"hearing\", active != null && amplitude >= VOICE_CAPTURE_AMPLITUDE_THRESHOLD)"));
        assertFalse(source.contains("Json.put(out, \"token\""));
    }

    @Test
    public void silentWalkieReleaseDiscardsCaptureWithoutUpload() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");

        assertTrue(source.contains("if (!speechDetected)"));
        assertTrue(source.contains("VoiceCaptureController.shared(context).discard(stopArgs)"));
        assertTrue(source.contains("markStatus(\"discarded_silence\", out, null)"));
        assertFalse(source.contains("submitAsync(localSessionId, clientTurnId, audioBytes);") && !source.contains("if (!speechDetected)"));
    }

    @Test
    public void controllerPollsRemoteTurnStatusWhileUploadIsInFlight() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");

        assertTrue(source.contains("startTurnStatusPoll(clientTurnId)"));
        assertTrue(source.contains("stopTurnStatusPoll(clientTurnId)"));
        assertTrue(source.contains("pollTurnStatus(clientTurnId)"));
        assertTrue(source.contains("turnStatusUrl(clientTurnId)"));
        assertTrue(source.contains("\"/api/turn/status\""));
        assertTrue(source.contains("\"?turn_id=\""));
        assertTrue(source.contains("markStatus(\"codex_running\""));
        assertTrue(source.contains("isRemoteTerminalStage"));
        assertTrue(source.contains("remote_stage"));
    }

    @Test
    public void playerCompletionBroadcastsStateForTurnIndicatorRefresh() throws Exception {
        String source = read("src/main/java/com/pucky/device/player/PlayerController.java");

        assertTrue(source.contains("import com.pucky.device.state.PuckyState;"));
        assertTrue(source.contains("broadcastPlayerCompletion()"));
        assertTrue(source.contains("PuckyState.get().setLifecycleEvent(\"player.completed\")"));
        assertTrue(source.contains("PuckyState.get().broadcast(context)"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }
}
