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
        assertTrue(source.contains("\"pucky.turn.settings.get\""));
        assertTrue(source.contains("\"pucky.turn.settings.set\""));
        assertTrue(source.contains("\"pucky.turn.history\""));
        assertTrue(source.contains("\"pucky.turn.read\""));
        assertTrue(source.contains("return puckyTurnController.status()"));
        assertTrue(source.contains("return puckyTurnController.start(command.args())"));
        assertTrue(source.contains("return puckyTurnController.stop(command.args())"));
        assertTrue(source.contains("return puckyTurnController.settingsGet()"));
        assertTrue(source.contains("return puckyTurnController.settingsSet(command.args())"));
        assertTrue(source.contains("return puckyTurnController.history(command.args())"));
        assertTrue(source.contains("return puckyTurnController.read(command.args())"));
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
        assertTrue(source.contains("\"pucky.recipes.sync\""));
        assertTrue(source.contains("\"pucky.recipes.list\""));
        assertTrue(source.contains("\"pucky.recipes.test\""));
        assertTrue(source.contains("\"pucky.recipes.clear\""));
        assertTrue(source.contains("\"pucky.recipes.schema\""));
        assertTrue(source.contains("\"device.primitives.list\""));
        assertFalse(source.contains("\"speech.echo.lab.keyword."));
        assertTrue(source.contains("return speechEchoLabController.status()"));
        assertTrue(source.contains("return speechEchoLabController.start(command.args())"));
        assertTrue(source.contains("return speechEchoLabController.stop(command.args())"));
        assertTrue(source.contains("return speechEchoLabController.configGet()"));
        assertTrue(source.contains("return speechEchoLabController.configSet(command.args())"));
        assertTrue(source.contains("return speechEchoLabController.recipesSync(command.args())"));
        assertTrue(source.contains("return speechEchoLabController.recipesList()"));
        assertTrue(source.contains("return speechEchoLabController.recipesTest(command.args())"));
        assertTrue(source.contains("return speechEchoLabController.recipesClear()"));
        assertTrue(source.contains("return speechEchoLabController.recipesSchema()"));
        assertTrue(source.contains("return speechEchoLabController.devicePrimitivesList()"));
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

        assertTrue(source.contains("WalkieAudioCaptureController.shared(context).start(startArgs"));
        assertTrue(source.contains("String clientTurnId = generateClientTurnId()"));
        assertFalse(source.contains("SpeechGate gate = new SpeechGate"));
        assertFalse(source.contains("startSpeechGatePoll(localSessionId, clientTurnId, gate)"));
        assertTrue(source.contains("Json.put(startArgs, \"format\", \"wav\")"));
        assertTrue(source.contains("Json.put(startArgs, \"feedback\", false)"));
        assertTrue(source.contains("MediaType.get(\"audio/wav\")"));
        assertTrue(source.contains(".header(\"Authorization\", \"Bearer \" + settings.getPuckyTurnAuthToken())"));
        assertTrue(source.contains(".header(\"X-Pucky-Turn-Id\", clientTurnId)"));
        assertTrue(source.contains(".header(\"X-Pucky-Reply-Mode\", settings.getPuckyTurnReplyMode())"));
        assertTrue(source.contains("submitAsync(localSessionId, clientTurnId, audioBytes)"));
        assertTrue(source.contains("Json.put(out, \"turn_id\", clientTurnId)"));
        assertTrue(source.contains("Json.put(out, \"vad_engine\""));
        assertTrue(source.contains("Json.put(out, \"vad_available\""));
        assertTrue(source.contains("new File(context.getFilesDir(), \"pucky_replies\""));
        assertTrue(source.contains("Json.put(card, \"session_id\", sessionId)"));
        assertTrue(source.contains("new ReplyCardStore(context).prepend(card)"));
        assertTrue(source.contains("Json.put(args, \"source\", \"pucky.turn\")"));
        assertTrue(source.contains("PlayerController.shared(context).play(args)"));
        assertTrue(source.contains("if (settings.isPuckyTurnSpokenReplyEnabled())"));
        assertTrue(source.contains("markStatus(\"speaking\", status, null)"));
        assertTrue(source.contains("markStatus(\"completed\", status, null)"));
        assertTrue(source.contains("Json.put(status, \"reply_mode\", settings.getPuckyTurnReplyMode())"));
        assertTrue(source.contains("Json.put(status, \"spoken_reply_enabled\", settings.isPuckyTurnSpokenReplyEnabled())"));
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
        assertTrue(source.contains("\"pucky_turn_reply_mode\""));
        assertTrue(source.contains("PUCKY_TURN_REPLY_CARD_ONLY"));
        assertTrue(source.contains("PUCKY_TURN_REPLY_CARD_AND_SPOKEN"));
        assertTrue(source.contains("public String getPuckyTurnReplyMode()"));
        assertTrue(source.contains("public boolean isPuckyTurnSpokenReplyEnabled()"));
        assertTrue(source.contains("public void setPuckyTurnReplyMode(String mode)"));
        assertTrue(source.contains("public String getPuckyTurnAuthToken()"));
        assertTrue(source.contains("String brokerToken = getToken();"));
        assertTrue(source.contains("return getPuckyTurnAuthToken();"));
    }

    @Test
    public void statusExposesWalkieIndicatorsWithoutTokenValues() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");
        String capture = read("src/main/java/com/pucky/device/pucky/WalkieAudioCaptureController.java");

        assertTrue(source.contains("Json.put(out, \"player_state\", player)"));
        assertTrue(source.contains("Json.put(out, \"indicator\", indicator)"));
        assertTrue(source.contains("Json.put(out, \"visual_state\", indicator.optString(\"visual_state\", \"idle\"))"));
        assertTrue(source.contains("Json.put(out, \"speech_gate\", gate == null ? JSONObject.NULL : gate)"));
        assertTrue(source.contains("Json.put(out, \"vad_engine\", indicator.optString(\"vad_engine\", \"\"))"));
        assertTrue(source.contains("Json.put(out, \"vad_available\", indicator.optBoolean(\"vad_available\", false))"));
        assertTrue(source.contains("Json.put(out, \"vad_probability\", indicator.optDouble(\"vad_probability\", 0.0))"));
        assertTrue(source.contains("Json.put(out, \"speech_frames\", indicator.optInt(\"speech_frames\", 0))"));
        assertTrue(source.contains("Json.put(out, \"speech_detected\", indicator.optBoolean(\"speech_detected\", false))"));
        assertTrue(source.contains("Json.put(out, \"peak_amplitude\", indicator.optInt(\"peak_amplitude\", 0))"));
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
        assertTrue(source.contains("Json.put(out, \"active\", micOn || uploading || codexRunning || speaking)"));
        assertFalse(source.contains("micOn || uploading || codexRunning || speaking || failed"));
        assertTrue(source.contains("if (\"failed\".equals(state)) return \"idle\""));
        assertFalse(source.contains("if (failed) {\n            state = \"failed\";"));
        assertTrue(source.contains("if (\"recording\".equals(state) && isPostReleaseState(lastStatus().optString(\"state\", \"\")))"));
        assertTrue(source.contains("private static boolean isPostReleaseState(String state)"));
        assertTrue(capture.contains("new AudioFrameBus(context)"));
        assertTrue(capture.contains("new PcmCaptureConsumer"));
        assertTrue(capture.contains("new WalkieSpeechGate"));
        assertTrue(capture.contains("\"audio/wav\""));
        assertFalse(capture.contains("MediaRecorder"));
        assertFalse(source.contains("getMaxAmplitude()"));
        assertTrue(capture.contains("public synchronized JSONObject discard(JSONObject args)"));
        assertTrue(capture.contains("Json.put(out, \"speech_gate\", active == null ? JSONObject.NULL : active.gate.statusJson())"));
        assertTrue(capture.contains("Json.put(out, \"mic_on\", active != null)"));
        assertFalse(source.contains("Json.put(out, \"token\""));
    }

    @Test
    public void silentWalkieReleaseDiscardsCaptureWithoutUpload() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");
        String stopBody = between(source, "public JSONObject stop(JSONObject args)", "private void finishStopAndUpload");

        assertTrue(source.contains("if (!speechDetected)"));
        assertTrue(source.contains("WalkieAudioCaptureController.shared(context).discard(stopArgs)"));
        assertTrue(source.contains("markStatus(\"discarded_silence\", out, null)"));
        assertTrue(stopBody.contains("if (feedback) {\n            playRecordingStopHaptic();\n        }\n        if (!speechDetected)"));
        assertFalse(source.contains("submitAsync(localSessionId, clientTurnId, audioBytes);") && !source.contains("if (!speechDetected)"));
    }

    @Test
    public void localWalkieStartAndStopDoNotRequireUploadConfiguration() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");

        String startBody = between(source, "public JSONObject start(JSONObject args)", "public JSONObject stop(JSONObject args)");
        String stopBody = between(source, "public JSONObject stop(JSONObject args)", "private void finishStopAndUpload");

        assertFalse(startBody.contains("requireConfigured("));
        assertFalse(stopBody.contains("requireConfigured("));
        assertFalse(startBody.contains("requireUploadConfigured("));
        assertFalse(stopBody.contains("requireUploadConfigured("));
        assertTrue(startBody.contains("WalkieAudioCaptureController.shared(context).start(startArgs"));
        assertTrue(stopBody.contains("WalkieAudioCaptureController.shared(context).discard(stopArgs)"));
        assertTrue(stopBody.contains("finishStopAndUpload(localSessionId, clientTurnId, reason, finalSpeechGate)"));
    }

    @Test
    public void speechPositiveReleaseCleansUpBeforeBlockingUnconfiguredUpload() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");
        String finishBody = between(source, "private void finishStopAndUpload", "private void submitAsync");

        assertTrue(source.contains("Json.put(out, \"upload_configured\", isUploadConfigured())"));
        assertTrue(source.contains("private boolean isUploadConfigured()"));
        assertTrue(finishBody.contains("WalkieAudioCaptureController.shared(context).stop(stopArgs)"));
        assertTrue(finishBody.contains("if (!isUploadConfigured())"));
        assertTrue(finishBody.contains("Json.put(blocked, \"state\", \"upload_blocked\")"));
        assertTrue(finishBody.contains("Json.put(blocked, \"phase\", \"upload_not_configured\")"));
        assertTrue(finishBody.contains("Json.put(blocked, \"upload_configured\", false)"));
        assertTrue(finishBody.contains("deleteQuietly(audio)"));
        assertTrue(finishBody.contains("markStatus(\"upload_blocked\", blocked, null)"));
        assertTrue(source.contains("|| \"upload_blocked\".equals(state)"));
        assertFalse(finishBody.contains("markStatus(\"failed\", detail, \"not_configured\")"));
    }

    @Test
    public void walkieFeedbackIsTiedToHoldReleaseAndRemoteAcceptedStates() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");
        String capture = read("src/main/java/com/pucky/device/pucky/WalkieAudioCaptureController.java");
        String startBody = between(source, "public JSONObject start(JSONObject args)", "public JSONObject stop(JSONObject args)");
        String stopBody = between(source, "public JSONObject stop(JSONObject args)", "private void finishStopAndUpload");
        String finishBody = between(source, "private void finishStopAndUpload", "private void submitAsync");
        String remoteStatusBody = between(source, "private void applyRemoteTurnStatus", "private String turnStatusUrl");
        String responseBody = between(source, "public void onResponse(Call call, Response response)", "private void startTurnStatusPoll");

        assertTrue(source.contains("import android.os.VibrationEffect;"));
        assertTrue(source.contains("import android.os.Vibrator;"));
        assertTrue(source.contains("import com.pucky.device.speech.RecipeDevicePrimitiveExecutor;"));
        assertTrue(source.contains("RECORDING_START_HAPTIC_MS"));
        assertTrue(source.contains("RECORDING_STOP_HAPTIC_MS"));
        assertTrue(source.contains("private volatile String acceptedChimedTurnId"));
        assertTrue(source.contains("playRecordingStartHaptic()"));
        assertTrue(source.contains("playRecordingStopHaptic()"));
        assertTrue(source.contains("playAcceptedChimeOnce(clientTurnId, remoteStage)"));
        assertTrue(source.contains(".playSuccessChime(\"pucky.turn_accepted_chime_playback.v1\")"));
        assertFalse(source.contains("ToneGenerator.TONE_PROP_PROMPT"));
        assertTrue(responseBody.contains("playAcceptedChimeOnce(clientTurnId, \"http_response_success\")"));
        assertTrue(source.contains("Json.put(status, \"accepted_chime\""));
        assertTrue(source.contains("copyIfPresent(record, detail, \"accepted_chime\")"));
        assertTrue(source.contains("copyIfPresent(event, detail, \"accepted_chime\")"));

        assertTrue(startBody.contains("final boolean feedback = args.optBoolean(\"feedback\", true)"));
        assertTrue(startBody.contains("Json.put(startArgs, \"feedback\", false)"));
        assertFalse(startBody.contains("Json.put(startArgs, \"feedback\", args.optBoolean(\"feedback\", true))"));
        assertTrue(startBody.contains("WalkieAudioCaptureController.shared(context).start(startArgs"));
        assertTrue(startBody.contains("if (feedback) {\n            playRecordingStartHaptic();\n        }"));
        assertTrue(startBody.indexOf("WalkieAudioCaptureController.shared(context).start(startArgs") < startBody.indexOf("playRecordingStartHaptic()"));
        assertFalse(startBody.contains("speechGateStatus -> {\n            if (feedback)"));
        assertTrue(stopBody.contains("if (feedback) {\n            playRecordingStopHaptic();\n        }\n        if (!speechDetected)"));
        assertTrue(stopBody.indexOf("playRecordingStopHaptic()") < stopBody.indexOf("if (!speechDetected)"));
        assertFalse(finishBody.contains("playRecordingStopHaptic()"));
        assertFalse(finishBody.substring(finishBody.indexOf("if (!isUploadConfigured())")).contains("playAcceptedChimeOnce"));
        assertTrue(remoteStatusBody.contains("if (isAcceptedRemoteStage(remoteStage))"));
        assertTrue(remoteStatusBody.contains("Json.put(status, \"accepted_chime\", playAcceptedChimeOnce(clientTurnId, remoteStage))"));
        assertTrue(source.contains("private static boolean isAcceptedRemoteStage(String stage)"));
        assertTrue(source.contains("private JSONObject playAcceptedChimeOnce(String turnId, String trigger)"));
        assertTrue(capture.contains("if (capture.feedback)"));
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
    public void turnSettingsAndHistoryAreDurableNativeContracts() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");

        assertTrue(source.contains("private static final String HISTORY = \"history_json\""));
        assertTrue(source.contains("private static final int MAX_HISTORY_ITEMS"));
        assertTrue(source.contains("public JSONObject settingsGet()"));
        assertTrue(source.contains("public JSONObject settingsSet(JSONObject args)"));
        assertTrue(source.contains("public JSONObject history(JSONObject args)"));
        assertTrue(source.contains("public JSONObject read(JSONObject args)"));
        assertTrue(source.contains("upsertTurnHistory(state, out)"));
        assertTrue(source.contains("\"pucky.turn_settings.v1\""));
        assertTrue(source.contains("\"pucky.turn_history.v1\""));
        assertTrue(source.contains("\"pucky.turn_history_read.v1\""));
        assertTrue(source.contains("Json.put(record, \"speech_gate\""));
        assertTrue(source.contains("Json.put(record, \"server_telemetry\""));
        assertTrue(source.contains("Json.put(record, \"events\""));
        assertFalse(source.contains("Json.put(record, \"transcript\""));
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
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8).replace("\r\n", "\n");
    }

    private static String between(String source, String start, String end) {
        int startIndex = source.indexOf(start);
        int endIndex = source.indexOf(end, startIndex + Math.max(0, start.length()));
        assertTrue("missing start marker: " + start, startIndex >= 0);
        assertTrue("missing end marker: " + end, endIndex > startIndex);
        return source.substring(startIndex, endIndex);
    }
}
