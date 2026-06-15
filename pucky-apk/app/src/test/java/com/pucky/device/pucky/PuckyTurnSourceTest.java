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
    public void buttonDefaultsRouteVolumeUpToTurnAndVolumeDownToMeetingToggle() throws Exception {
        String source = read("src/main/java/com/pucky/device/buttons/ButtonController.java");

        assertTrue(source.contains("CONFIG_VERSION = 23"));
        assertTrue(source.contains("DEFAULT_LONG_PRESS_MS = 200"));
        assertTrue(source.contains("VOLUME_DOWN_MEETING_HOLD_MS = 2_000"));
        assertTrue(source.contains("clamp(config.optInt(\"long_press_ms\", DEFAULT_LONG_PRESS_MS), 200, 1200)"));
        assertTrue(source.contains("\"android_volume_meeting_toggle_v23\""));
        assertTrue(source.contains("Json.put(mappings, \"volume_up_hold\", \"pucky.turn.start\")"));
        assertTrue(source.contains("Json.put(mappings, \"volume_up_hold_release\", \"pucky.turn.stop\")"));
        assertTrue(source.contains("Json.put(mappings, \"volume_down_hold\", \"meeting.recording.toggle\")"));
        assertTrue(source.contains("Json.put(mappings, \"volume_down_hold_release\", \"none\")"));
        assertTrue(source.contains("PuckyTurnController.shared(context).start(new JSONObject())"));
        assertTrue(source.contains("PuckyTurnController.shared(context).stop(reasonArgs(\"button_release\"))"));
        assertTrue(source.contains("MeetingRecordingController.shared(context).toggleFromHover(\"volume_down_hold\")"));
        assertTrue(source.contains("\"volume_down_hold\".equals(gesture) && \"meeting.recording.toggle\".equals(action)"));
        assertFalse(source.contains("Json.put(mappings, \"volume_down_hold\", \"speech.echo.lab.start\")"));
        assertFalse(source.contains("Json.put(mappings, \"volume_down_hold_release\", \"speech.echo.lab.stop\")"));
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
        assertTrue(source.contains("\"pucky.turn.arrival_cue.test\""));
        assertTrue(source.contains("\"pucky.turn.sent_cue.test\""));
        assertTrue(source.contains("\"pucky.turn.received_cue.test\""));
        assertTrue(source.contains("\"pucky.turn.chime.test\""));
        assertTrue(source.contains("\"pucky.turn.history\""));
        assertTrue(source.contains("\"pucky.turn.read\""));
        assertTrue(source.contains("\"pucky.turn.debug.inject_history\""));
        assertTrue(source.contains("\"pucky.turn.debug.response_fault\""));
        assertTrue(source.contains("return puckyTurnController.status()"));
        assertTrue(source.contains("return puckyTurnController.start(command.args())"));
        assertTrue(source.contains("return puckyTurnController.stop(command.args())"));
        assertTrue(source.contains("return puckyTurnController.settingsGet()"));
        assertTrue(source.contains("return puckyTurnController.settingsSet(command.args())"));
        assertTrue(source.contains("return puckyTurnController.arrivalCueTest(command.args())"));
        assertTrue(source.contains("return puckyTurnController.sentCueTest(command.args())"));
        assertTrue(source.contains("return puckyTurnController.receivedCueTest(command.args())"));
        assertTrue(source.contains("return puckyTurnController.chimeTest(command.args())"));
        assertTrue(source.contains("return puckyTurnController.history(command.args())"));
        assertTrue(source.contains("return puckyTurnController.read(command.args())"));
        assertTrue(source.contains("return puckyTurnController.debugInjectHistory(command.args())"));
        assertTrue(source.contains("return puckyTurnController.debugResponseFault(command.args())"));
        assertTrue(service.contains("PuckyTurnController.shared(this)"));
    }

    @Test
    public void turnControllerAndFeedControllerSupportPendingOutboundCards() throws Exception {
        String turn = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");
        String feed = read("src/main/java/com/pucky/device/pucky/PuckyFeedController.java");

        assertTrue(turn.contains("Json.put(out, \"user_transcript\", last.optString(\"user_transcript\", \"\"))"));
        assertTrue(turn.contains("boolean transcriptChanged = remote.has(\"user_transcript\")"));
        assertTrue(turn.contains("Json.put(status, \"user_transcript\", remote.optString(\"user_transcript\", \"\"))"));
        assertTrue(turn.contains("copyIfPresent(record, detail, \"user_transcript\")"));
        assertTrue(turn.contains("copyIfPresent(event, detail, \"user_transcript\")"));
        assertTrue(turn.contains("copyIfPresent(record, detail, \"archived\")"));
        assertTrue(turn.contains("copyIfPresent(record, detail, \"debug_injected\")"));
        assertTrue(turn.contains("synchronized JSONArray historySnapshotArray()"));
        assertTrue(turn.contains("synchronized boolean archiveHistoryRecord(String turnId, String localSessionId)"));
        assertTrue(turn.contains("public JSONObject debugInjectHistory(JSONObject args) throws CommandException"));
        assertTrue(turn.contains("public JSONObject debugResponseFault(JSONObject args) throws CommandException"));
        assertTrue(turn.contains("boolean clearAll = args.optBoolean(\"clear_all\", false);"));
        assertTrue(turn.contains("int removed = clearAll ? clearTurnHistory() : (clear ? clearDebugInjectedHistory() : 0);"));
        assertTrue(turn.contains("private synchronized int clearTurnHistory()"));
        assertTrue(turn.contains("pucky.turn.debug.inject_history is only available on debug builds"));
        assertTrue(turn.contains("pucky.turn.debug.response_fault is only available on debug builds"));

        assertTrue(feed.contains("return mergedSnapshot();"));
        assertTrue(feed.contains("private JSONObject mergedSnapshot()"));
        assertTrue(feed.contains("private JSONArray synthesizePendingCards(JSONArray persistedCards)"));
        assertTrue(feed.contains("\"Sending your message...\""));
        assertTrue(feed.contains("\"Sent message\""));
        assertTrue(feed.contains("\"pending_outbound\""));
        assertTrue(feed.contains("\"pending_state\""));
        assertTrue(feed.contains("\"pending_label\""));
        assertTrue(feed.contains("\"pending_error\""));
        assertTrue(feed.contains("\"pending_placeholder\""));
        assertTrue(feed.contains("turnController.archiveHistoryRecord("));
        assertTrue(feed.contains("pending outbound cards only support archive"));
        assertTrue(feed.contains("hasMatchingReplyCard(persistedCards, record)"));
        assertTrue(feed.contains("shouldSynthesizePendingCard(state)"));
        assertTrue(feed.contains("pendingLabelFor(state, placeholder)"));
        assertTrue(feed.contains("Json.put(origin, \"thread_id\", threadId);"));
        assertTrue(feed.contains("Json.put(userMessage, \"role\", \"user\");"));
        assertTrue(feed.contains("Json.put(userMessage, \"text\", transcript);"));
        assertTrue(feed.contains("Json.put(card, \"transcript_messages\", transcriptMessages);"));
        assertTrue(feed.contains("merged = collapseCardsByThread(merged);"));
        assertTrue(feed.contains("if (latest.optBoolean(\"pending_outbound\", false) && !older.optBoolean(\"pending_outbound\", false)) {"));
        assertTrue(feed.contains("Json.put(latest, \"origin\", older.opt(\"origin\"));"));
        assertTrue(feed.contains("copyForwardIfMissing(latest, older, \"audio_path\");"));
        assertTrue(feed.contains("copyForwardIfMissing(latest, older, \"audio_playlist_path\");"));
        assertTrue(feed.contains("copyForwardIfMissing(latest, older, \"audio_timestamps\");"));
        assertTrue(feed.contains("private static void copyForwardIfMissing(JSONObject latest, JSONObject older, String field) {"));
        assertTrue(feed.contains("String latestValue = safe(latest.optString(field, \"\"));"));
        assertTrue(feed.contains("String olderValue = safe(older.optString(field, \"\"));"));
        assertTrue(feed.contains("if (latestValue.isEmpty() && !olderValue.isEmpty()) {"));
        assertTrue(feed.contains("Json.put(latest, field, olderValue);"));
        assertTrue(feed.contains("\"uploading\".equals(state)"));
        assertTrue(feed.contains("\"codex_running\".equals(state)"));
        assertTrue(feed.contains("\"upload_blocked\".equals(state)"));
    }

    @Test
    public void turnControllerCarriesWakeTriggerMetadataAndPausesWakeSentinel() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");
        String capture = read("src/main/java/com/pucky/device/pucky/WalkieAudioCaptureController.java");

        assertTrue(source.contains("WakeWordController.shared(context).onTurnStarting(clientTurnId, triggerSource)"));
        assertTrue(source.contains("Json.put(startArgs, \"trigger_source\", triggerSource)"));
        assertTrue(source.contains("Json.put(startArgs, \"auto_endpoint\", autoEndpoint)"));
        assertTrue(source.contains("Json.put(startArgs, \"speech_start_timeout_ms\", speechStartTimeoutMs)"));
        assertTrue(source.contains("Json.put(startArgs, \"trailing_silence_ms\", trailingSilenceMs)"));
        assertTrue(source.contains("Json.put(startArgs, \"min_speech_ms\", minSpeechMs)"));
        assertTrue(source.contains("startAutoEndpointMonitor("));
        assertTrue(source.contains("Json.put(startArgs, \"wake_phrase_family\""));
        assertTrue(source.contains("Json.put(startArgs, \"wake_phrase_detected\""));
        assertTrue(source.contains("WakeWordController.shared(context).onTurnStatusChanged("));
        assertTrue(source.contains("playFailureChime(\"pucky.wake_turn_no_speech_chime.v1\")"));
        assertTrue(source.contains("intercept(audioBytes, localSessionId, clientTurnId, speechGate, capture)"));
        assertTrue(source.contains("copyIfPresent(target, capture, \"capture_source\")"));
        assertTrue(source.contains("copyIfPresent(target, capture, \"fixture_name\")"));
        assertTrue(source.contains("copyIfPresent(startArgs, args, \"debug_fixture_transcript\")"));
        assertTrue(source.contains("copyIfPresent(startArgs, args, \"proof_reply_delay_ms\")"));
        assertTrue(capture.contains("capture.triggerSource"));
        assertTrue(capture.contains("capture.autoEndpoint"));
        assertTrue(capture.contains("capture.captureSource"));
        assertTrue(capture.contains("capture.fixtureStartDelayMs"));
        assertTrue(capture.contains("capture.fixturePath"));
        assertTrue(capture.contains("capture.debugFixtureTranscript"));
        assertTrue(capture.contains("capture.proofReplyDelayMs"));
        assertTrue(capture.contains("capture.fixtureError"));
        assertTrue(capture.contains("capture.fixtureBytes"));
        assertTrue(capture.contains("capture.fixtureSamples"));
        assertTrue(capture.contains("capture.fixtureFramesTarget"));
        assertTrue(capture.contains("capture.fixtureFramesSent"));
        assertTrue(capture.contains("startFixtureFeed(capture)"));
        assertTrue(capture.contains("Json.put(out, \"capture_source\", capture.captureSource)"));
        assertTrue(capture.contains("Json.put(out, \"fixture_path\", capture.fixturePath)"));
        assertTrue(capture.contains("Json.put(out, \"fixture_start_delay_ms\", capture.fixtureStartDelayMs)"));
        assertTrue(capture.contains("Json.put(out, \"fixture_bytes\", capture.fixtureBytes)"));
        assertTrue(capture.contains("Json.put(out, \"fixture_samples\", capture.fixtureSamples)"));
        assertTrue(capture.contains("Json.put(out, \"fixture_frames_target\", capture.fixtureFramesTarget)"));
        assertTrue(capture.contains("Json.put(out, \"fixture_frames_sent\", capture.fixtureFramesSent)"));
        assertTrue(capture.contains("Json.put(out, \"fixture_error\", capture.fixtureError)"));
        assertTrue(capture.contains("Fixture feed ready turn="));
        assertTrue(capture.contains("Fixture feed canceled turn="));
        assertTrue(capture.contains("Fixture feed completed turn="));
        assertTrue(capture.contains("Json.put(out, \"debug_fixture_transcript\", capture.debugFixtureTranscript)"));
        assertTrue(capture.contains("Json.put(out, \"proof_reply_delay_ms\", capture.proofReplyDelayMs)"));
        assertTrue(capture.contains("capture.wakePhraseFamily"));
        assertTrue(capture.contains("capture.wakePhraseDetected"));
        assertTrue(capture.contains("Json.put(out, \"trigger_source\", capture.triggerSource)"));
        assertTrue(source.contains("copyIfPresent(target, capture, \"fixture_start_delay_ms\")"));
        assertTrue(source.contains("copyIfPresent(target, capture, \"debug_fixture_transcript\")"));
        assertTrue(source.contains("copyIfPresent(target, capture, \"proof_reply_delay_ms\")"));
        assertTrue(source.contains(".header(\"X-Pucky-Debug-Fixture-Transcript\", threadScope.optString(\"debug_fixture_transcript\", \"\"))"));
        assertTrue(source.contains(".header(\"X-Pucky-Proof-Reply-Delay-Ms\""));
        assertTrue(source.contains("JSONObject threadScope = voiceThreadScopeSnapshot(triggerSource)"));
        assertTrue(source.contains("applyVoiceThreadScope(startArgs, threadScope)"));
        assertTrue(source.contains("applyVoiceThreadScope(status, threadScope)"));
        assertTrue(source.contains("applyVoiceThreadScope(out, threadScope)"));
        assertTrue(source.contains("if (!\"volume_up_hold\".equals(triggerSource))"));
        assertFalse(source.contains("&& !\"wake_word\".equals(triggerSource)"));
        assertTrue(capture.contains("capture.threadMode"));
        assertTrue(capture.contains("capture.threadId"));
        assertTrue(capture.contains("capture.threadCardId"));
        assertTrue(capture.contains("capture.threadSessionId"));
        assertTrue(capture.contains("capture.threadScopeSource"));
        assertTrue(capture.contains("Json.put(out, \"thread_mode\", capture.threadMode)"));
        assertTrue(capture.contains("Json.put(out, \"thread_id\", capture.threadId)"));
        assertTrue(capture.contains("Json.put(out, \"thread_card_id\", capture.threadCardId)"));
        assertTrue(capture.contains("Json.put(out, \"thread_session_id\", capture.threadSessionId)"));
        assertTrue(capture.contains("Json.put(out, \"thread_scope_source\", capture.threadScopeSource)"));
    }

    @Test
    public void nativeCommandExecutorAllowlistsSpeechEchoLabCommands() throws Exception {
        String source = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String service = read("src/main/java/com/pucky/device/service/PuckyForegroundService.java");
        String lab = read("src/main/java/com/pucky/device/speech/SpeechEchoLabController.java");

        assertTrue(source.contains("\"speech.echo.lab.status\""));
        assertTrue(source.contains("\"speech.echo.lab.start\""));
        assertTrue(source.contains("\"speech.echo.lab.stop\""));
        assertTrue(source.contains("\"speech.echo.lab.last\""));
        assertTrue(source.contains("\"speech.echo.lab.list\""));
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
        assertFalse(source.contains("return speechEchoLabController.configGet()"));
        assertFalse(source.contains("return speechEchoLabController.configSet(command.args())"));
        assertTrue(source.contains("import com.pucky.device.speech.PuckyRecipeController;"));
        assertTrue(source.contains("private final PuckyRecipeController puckyRecipeController;"));
        assertTrue(source.contains("return puckyRecipeController.sync(command.args())"));
        assertTrue(source.contains("return puckyRecipeController.list()"));
        assertTrue(source.contains("return puckyRecipeController.test(command.args())"));
        assertTrue(source.contains("return puckyRecipeController.clear()"));
        assertTrue(source.contains("return puckyRecipeController.schema()"));
        assertTrue(source.contains("return puckyRecipeController.devicePrimitivesList()"));
        assertTrue(service.contains("SpeechEchoLabController.shared(this)"));
        assertTrue(service.contains("PuckyRecipeController.shared(this)"));
        assertTrue(lab.contains("\"result\", \"reserved_noop\""));
        assertTrue(lab.contains("Volume-down walkie lab is reserved"));
        assertTrue(lab.contains("\"product_path\", \"volume_up_walkie_release_keyword_intercept\""));
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
        String feed = read("src/main/java/com/pucky/device/pucky/PuckyFeedController.java");

        assertTrue(source.contains("WalkieAudioCaptureController.shared(context).start(startArgs"));
        assertTrue(source.contains("String clientTurnId = generateClientTurnId()"));
        assertFalse(source.contains("SpeechGate gate = new SpeechGate"));
        assertFalse(source.contains("startSpeechGatePoll(localSessionId, clientTurnId, gate)"));
        assertTrue(source.contains("Json.put(startArgs, \"format\", \"wav\")"));
        assertTrue(source.contains("Json.put(startArgs, \"feedback\", false)"));
        assertTrue(source.contains("MediaType.get(\"audio/wav\")"));
        assertTrue(source.contains(".header(\"Authorization\", \"Bearer \" + settings.getPuckyTurnAuthToken())"));
        assertTrue(source.contains(".header(\"X-Pucky-Turn-Id\", clientTurnId)"));
        assertTrue(source.contains(".header(\"X-Pucky-Reply-Mode\", replyModeAtUpload)"));
        assertTrue(source.contains("PuckyTurnKeywordInterceptor.shared(context)"));
        assertTrue(source.contains("keywordIntercept.optBoolean(\"handled\", false)"));
        assertTrue(source.contains("Json.put(uploading, \"local_keyword_intercept\", keywordIntercept)"));
        assertTrue(source.contains("submitAsync(localSessionId, clientTurnId, audioBytes, capture)"));
        assertTrue(source.contains(".header(\"X-Pucky-Thread-Mode\", threadScope.optString(\"thread_mode\", \"new\"))"));
        assertTrue(source.contains(".header(\"X-Pucky-Thread-Id\", threadScope.optString(\"thread_id\", \"\"))"));
        assertTrue(source.contains(".header(\"X-Pucky-Thread-Scope-Source\", threadScope.optString(\"thread_scope_source\", \"\"))"));
        assertTrue(source.contains(".header(\"X-Pucky-Thread-Card-Id\", threadScope.optString(\"thread_card_id\", \"\"))"));
        assertTrue(source.contains(".header(\"X-Pucky-Codex-Model\", applySessionDefaults ? settings.getPuckyTurnModel() : \"\")"));
        assertTrue(source.contains(".header(\"X-Pucky-Codex-Reasoning-Effort\","));
        assertTrue(source.contains("applySessionDefaults ? settings.getPuckyTurnReasoningEffort() : \"\""));
        assertTrue(source.contains("private static boolean shouldApplySessionDefaults(JSONObject scope)"));
        assertTrue(source.contains("Json.put(out, \"turn_id\", clientTurnId)"));
        assertTrue(source.contains("Json.put(out, \"vad_engine\""));
        assertTrue(source.contains("Json.put(out, \"vad_available\""));
        assertTrue(source.contains("PuckyFeedController.shared(context).upsertTurnResponse(localSessionId, parsed)"));
        assertTrue(feed.contains("public JSONObject upsertTurnResponse(String fallbackSessionId, PuckyTurnResponse response)"));
        assertTrue(feed.contains("Json.put(card, \"card_id\", response.cardId())"));
        assertTrue(feed.contains("JSONObject existing = replyCards.find(response.cardId(), response.sessionId()).optJSONObject(\"card\")"));
        assertTrue(feed.contains("copyForwardIfMissing(card, existing, \"audio_path\")"));
        assertTrue(feed.contains("copyForwardIfMissing(card, existing, \"audio_playlist_path\")"));
        assertTrue(feed.contains("copyForwardIfMissing(card, existing, \"audio_timestamps\")"));
        assertTrue(feed.contains("copyForwardIfMissing(card, existing, \"html_path\")"));
        assertTrue(feed.contains("replyCards.upsert(card)"));
        assertTrue(store.contains("public JSONObject upsert(JSONObject cardJson)"));
        assertTrue(store.contains("public JSONObject merge(JSONArray cardsJson)"));
        assertTrue(source.contains("Json.put(args, \"source\", \"pucky.turn\")"));
        assertTrue(source.contains("PlayerController.shared(context).play(args)"));
        assertTrue(source.contains("Json.put(args, \"speed\", settings.getDefaultTileAudioSpeed())"));
        assertTrue(source.contains("if (spokenReplyEnabledAtUpload)"));
        assertTrue(source.contains("markStatus(\"speaking\", status, null)"));
        assertTrue(source.contains("markStatus(\"completed\", status, null)"));
        assertTrue(source.contains("Json.put(status, \"reply_mode\", replyModeAtUpload)"));
        assertTrue(source.contains("Json.put(status, \"spoken_reply_enabled\", spokenReplyEnabledAtUpload)"));
        assertTrue(source.contains("Json.put(status, \"server_telemetry\", parsed.telemetry())"));
        assertTrue(source.contains("Json.put(out, \"arrival_cue_mode\", settings.getPuckyTurnArrivalCueMode())"));
        assertTrue(source.contains("Json.put(out, \"accepted_chime_enabled\", settings.isPuckyTurnAcceptedChimeEnabled())"));
        assertTrue(source.contains("public JSONObject arrivalCueTest(JSONObject args)"));
        assertTrue(source.contains("public JSONObject sentCueTest(JSONObject args)"));
        assertTrue(source.contains("public JSONObject receivedCueTest(JSONObject args)"));
        assertTrue(source.contains("public JSONObject chimeTest(JSONObject args)"));
        assertTrue(source.contains("return arrivalCueTest(args);"));
        assertTrue(source.contains("playReplyReceivedCue(\"manual_test\")"));
        assertTrue(source.contains(".playTurnSentChime(\"pucky.turn_arrival_cue_playback.v1\")"));
        assertTrue(source.contains(".playTurnReceivedChime(\"pucky.turn_reply_received_cue_playback.v1\")"));
        assertTrue(source.contains("settings.setPuckyTurnArrivalCueMode"));
        assertTrue(source.contains("settings.setPuckyTurnAcceptedChimeEnabled"));
        assertFalse(Pattern.compile("Log\\.[^;]*getPuckyTurnAuthToken", Pattern.DOTALL).matcher(source).find());
    }

    @Test
    public void feedSyncRemainsInternalForTurnRecoveryNotVisibleUi() throws Exception {
        String feed = read("src/main/java/com/pucky/device/pucky/PuckyFeedController.java");
        String ui = read("src/main/java/com/pucky/device/ui/PuckyUiController.java");
        String store = read("src/main/java/com/pucky/device/ui/ReplyCardStore.java");
        String commands = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String caps = read("src/main/java/com/pucky/device/capabilities/CapabilityReporter.java");

        assertTrue(feed.contains("args.optBoolean(\"reset_cursor\", false)"));
        assertTrue(feed.contains("private JSONObject syncInternal(String reason, int limit, boolean emitUpdate, boolean resetCursor, boolean authoritative)"));
        assertTrue(feed.contains("String cursor = (resetCursor || authoritative) ? \"\" : prefs.getString(KEY_CURSOR, \"\")"));
        assertTrue(feed.contains("int pageLimit = (resetCursor || authoritative) ? 200 : 5;"));
        assertTrue(feed.contains("Json.put(out, \"reset_cursor\", resetCursor)"));
        assertFalse(ui.contains("public JSONObject replyCardsMerge(JSONObject args)"));
        assertTrue(store.contains("public JSONObject merge(JSONArray cardsJson)"));
        assertFalse(commands.contains("\"ui.reply_cards.merge\""));
        assertFalse(commands.contains("\"pucky.feed.cache.get\""));
        assertFalse(commands.contains("return uiController.replyCardsMerge(command.args())"));
        assertFalse(caps.contains("ui.reply_cards"));
        assertTrue(caps.contains("ui.web_shell"));
    }

    @Test
    public void feedSyncSupportsAuthoritativeVmReconciliation() throws Exception {
        String feed = read("src/main/java/com/pucky/device/pucky/PuckyFeedController.java");
        String store = read("src/main/java/com/pucky/device/ui/ReplyCardStore.java");
        String card = read("src/main/java/com/pucky/device/ui/ReplyCard.java");

        assertTrue(feed.contains("args.optBoolean(\"authoritative\", false)"));
        assertTrue(feed.contains("syncInternal(reason, limit, emitUpdate, resetCursor, authoritative)"));
        assertTrue(feed.contains("String cursor = (resetCursor || authoritative) ? \"\" : prefs.getString(KEY_CURSOR, \"\")"));
        assertTrue(feed.contains("replyCards.pruneStaleFeedAuthority(authoritativeCards)"));
        assertTrue(feed.contains("if (!authoritative)"));
        assertTrue(feed.contains("PuckyTurnController.shared(context).onReplyRecovered(local, \"feed_sync\")"));
        assertTrue(feed.contains("feed action missing card; refreshing authoritative snapshot"));
        assertTrue(feed.contains("Json.put(out, \"ok\", false)"));
        assertTrue(feed.contains("Json.put(out, \"error\", \"card_not_found\")"));
        assertTrue(feed.contains("Json.put(card, \"feed_authority\", \"vm\")"));
        assertTrue(store.contains("public JSONObject pruneStaleFeedAuthority(JSONArray authoritativeCards)"));
        assertTrue(store.contains("\"vm\".equals(card.feedAuthority())"));
        assertTrue(store.contains("cardId.startsWith(\"pucky_card_\")"));
        assertTrue(store.contains("cardId.startsWith(\"pucky_card_proof_\")"));
        assertTrue(card.contains("private final String feedAuthority;"));
        assertTrue(card.contains("input.optString(\"feed_authority\", \"\")"));
        assertTrue(card.contains("putOptional(out, \"feed_authority\", feedAuthority);"));
    }

    @Test
    public void feedAttachmentLocalizationPreservesHtmlViewerSourcesAndDropsPlaceholders() throws Exception {
        String feed = read("src/main/java/com/pucky/device/pucky/PuckyFeedController.java");

        assertTrue(feed.contains("preserveNestedViewerArtifact(copy)"));
        assertTrue(feed.contains("JSONObject viewer = attachment.optJSONObject(\"viewer\")"));
        assertTrue(feed.contains("viewer.optString(\"artifact\", \"\")"));
        assertTrue(feed.contains("Json.put(attachment, \"html_artifact\", artifactId)"));
        assertTrue(feed.contains("Json.put(copy, \"html_viewer_path\", copy.optString(\"path\", \"\"))"));
        assertTrue(feed.contains("return hasOpenableAttachmentSource(copy) ? copy : null;"));
        assertTrue(feed.contains("hasMeaningfulAttachmentText(attachment.optString(\"text\", \"\"))"));
        assertTrue(feed.contains("speaker-separated transcript with timestamps"));
        assertTrue(feed.contains("lower.startsWith(\"playback url:\")"));
        assertTrue(feed.contains("resolveMeetingLocalAudio(copy)"));
        assertTrue(feed.contains("MeetingRecordingController.shared(context).resolveAudioLink(args)"));
        assertTrue(feed.contains("Json.put(attachment, \"device_path\", resolvedPath)"));
        assertTrue(feed.contains("Json.put(attachment, \"audio_url\", resolvedUrl)"));
        assertTrue(feed.contains("Json.put(attachment, \"audio_rename_error\", exc.getMessage())"));
    }

    @Test
    public void settingsCanProvisionPuckyTurnEndpointWithoutHardcodingSecret() throws Exception {
        String source = read("src/main/java/com/pucky/device/storage/SettingsStore.java");

        assertTrue(source.contains("\"pucky_turn_url\""));
        assertTrue(source.contains("\"pucky_api_token\""));
        assertTrue(source.contains("https://pucky.fly.dev/api/turn"));
        assertTrue(source.contains("putString(editor, input, \"pucky_api_token\""));
        assertTrue(source.contains("\"pucky_turn_reply_mode\""));
        assertTrue(source.contains("\"pucky_turn_model\""));
        assertTrue(source.contains("\"pucky_turn_reasoning_effort\""));
        assertTrue(source.contains("\"pucky_turn_arrival_cue_mode\""));
        assertTrue(source.contains("\"pucky_turn_accepted_chime_enabled\""));
        assertTrue(source.contains("PUCKY_TURN_REPLY_CARD_ONLY"));
        assertTrue(source.contains("PUCKY_TURN_REPLY_CARD_AND_SPOKEN"));
        assertTrue(source.contains("PUCKY_TURN_ARRIVAL_CUE_HAPTIC_AND_CHIME"));
        assertTrue(source.contains("PUCKY_TURN_MODEL_GPT_5_4"));
        assertTrue(source.contains("PUCKY_TURN_MODEL_GPT_5_4_MINI"));
        assertTrue(source.contains("PUCKY_TURN_MODEL_GPT_5_4_NANO"));
        assertTrue(source.contains("PUCKY_TURN_REASONING_XHIGH"));
        assertTrue(source.contains("public String getPuckyTurnReplyMode()"));
        assertTrue(source.contains("public String getPuckyTurnModel()"));
        assertTrue(source.contains("public void setPuckyTurnModel(String model)"));
        assertTrue(source.contains("public String getPuckyTurnReasoningEffort()"));
        assertTrue(source.contains("public void setPuckyTurnReasoningEffort(String reasoningEffort)"));
        assertTrue(source.contains("public String getPuckyTurnArrivalCueMode()"));
        assertTrue(source.contains("public boolean isPuckyTurnSpokenReplyEnabled()"));
        assertTrue(source.contains("public boolean isPuckyTurnAcceptedChimeEnabled()"));
        assertTrue(source.contains("public void setPuckyTurnArrivalCueMode(String mode)"));
        assertTrue(source.contains("public void setPuckyTurnAcceptedChimeEnabled(boolean enabled)"));
        assertTrue(source.contains("public void setPuckyTurnReplyMode(String mode)"));
        assertTrue(source.contains("public String getPuckyTurnAuthToken()"));
        assertTrue(source.contains("String brokerToken = getToken();"));
        assertTrue(source.contains("return getPuckyTurnAuthToken();"));
        assertTrue(source.contains("return \"dev-token\".equals(clean) ? \"\" : clean;"));
        assertTrue(source.contains("DEFAULT_TILE_AUDIO_SPEED"));
        assertTrue(source.contains("getDefaultTileAudioSpeed()"));
        assertTrue(source.contains("setDefaultTileAudioSpeed(float speed)"));
        assertTrue(source.contains("normalizePuckyTurnModel"));
        assertTrue(source.contains("normalizePuckyTurnReasoningEffort"));
        assertFalse(source.contains("prefs.getString(TOKEN, \"dev-token\")"));
        assertFalse(source.contains("nonEmpty(token, \"dev-token\")"));
    }

    @Test
    public void playerConsumesOptionalStartSpeedForFreshPlayback() throws Exception {
        String player = read("src/main/java/com/pucky/device/player/PlayerController.java");

        assertTrue(player.contains("args.optDouble(\"speed\", args.optDouble(\"rate\", playbackSpeed))"));
        assertTrue(player.contains("Double.isNaN(rawSpeed)"));
        assertTrue(player.contains("playbackSpeed = (float) Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, rawSpeed))"));
        assertTrue(player.contains("player.start()"));
        assertTrue(player.contains("applyPlaybackSpeedForCurrentState()"));
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
        assertTrue(finishBody.contains("PuckyTurnKeywordInterceptor.shared(context)"));
        assertTrue(finishBody.contains("if (keywordIntercept.optBoolean(\"handled\", false))"));
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
        assertTrue(source.contains("playArrivalCueOnce(clientTurnId, remoteStage)"));
        assertTrue(source.contains(".playTurnSentChime(\"pucky.turn_arrival_cue_playback.v1\")"));
        assertFalse(source.contains("ToneGenerator.TONE_PROP_PROMPT"));
        assertTrue(responseBody.contains("playArrivalCueOnce(clientTurnId, \"http_response_success\")"));
        assertTrue(responseBody.contains("playReplyReceivedCueOnce(turnId, \"reply_saved\")")
                || responseBody.contains("suppressedReplyReceivedCue(turnId, \"spoken_reply_enabled\")"));
        assertTrue(source.contains("Json.put(status, \"arrival_cue\""));
        assertTrue(source.contains("Json.put(status, \"sent_cue\""));
        assertTrue(source.contains("Json.put(status, \"accepted_chime\""));
        assertTrue(source.contains("Json.put(status, \"reply_received_cue\""));
        assertTrue(source.contains("copyIfPresent(record, detail, \"arrival_cue\")"));
        assertTrue(source.contains("copyIfPresent(record, detail, \"accepted_chime\")"));
        assertTrue(source.contains("copyIfPresent(record, detail, \"reply_received_cue\")"));
        assertTrue(source.contains("copyIfPresent(event, detail, \"arrival_cue\")"));
        assertTrue(source.contains("copyIfPresent(event, detail, \"accepted_chime\")"));
        assertTrue(source.contains("copyIfPresent(event, detail, \"reply_received_cue\")"));

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
        assertFalse(finishBody.substring(finishBody.indexOf("if (!isUploadConfigured())")).contains("playArrivalCueOnce"));
        assertTrue(remoteStatusBody.contains("if (isAcceptedRemoteStage(remoteStage))"));
        assertTrue(remoteStatusBody.contains("JSONObject arrivalCue = playArrivalCueOnce(clientTurnId, remoteStage);"));
        assertTrue(remoteStatusBody.contains("Json.put(status, \"sent_cue\", arrivalCue)"));
        assertTrue(remoteStatusBody.contains("Json.put(status, \"arrival_cue\", arrivalCue)"));
        assertTrue(remoteStatusBody.contains("Json.put(status, \"accepted_chime\", arrivalCue)"));
        assertTrue(source.contains("static boolean isAcceptedRemoteStage(String stage)"));
        assertTrue(source.contains("private JSONObject playArrivalCueOnce(String turnId, String trigger)"));
        assertTrue(source.contains("private JSONObject playReplyReceivedCueOnce(String turnId, String trigger)"));
        assertTrue(source.contains("private JSONObject playReplyReceivedCue(String trigger)"));
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
        assertTrue(source.contains("if (!isPollingTurn(clientTurnId))"));
        assertTrue(source.contains("Ignoring stale turn status poll"));
        assertTrue(source.contains("Ignoring stale remote stage"));
    }

    @Test
    public void controllerRecoversStuckThinkingStateFromLocalReplyProof() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");
        String feed = read("src/main/java/com/pucky/device/pucky/PuckyFeedController.java");

        assertTrue(source.contains("private final ReplyCardStore replyCards;"));
        assertTrue(source.contains("JSONObject last = maybeExpireStaleCodexRunning("));
        assertTrue(source.contains("maybeRecoverLastStatus(lastStatus(), \"status_lookup\")"));
        assertTrue(source.contains("public void onReplyRecovered(JSONObject card, String recoverySource)"));
        assertTrue(source.contains("PuckyFeedController.shared(context).syncAsync(\"accepted_transport_failure\")"));
        assertTrue(source.contains("PuckyFeedController.shared(context).syncAsync(\"remote_completed\")"));
        assertTrue(source.contains("private final HashSet<String> remoteAcceptedTurnIds = new HashSet<>()"));
        assertTrue(source.contains("private void noteRemoteAccepted(String clientTurnId)"));
        assertTrue(source.contains("private boolean hasRemoteAccepted(String clientTurnId)"));
        assertTrue(source.contains("private void clearRemoteAccepted(String clientTurnId)"));
        assertTrue(source.contains("static boolean shouldRetainPendingAfterLocalTransportFailure(JSONObject status)"));
        assertTrue(source.contains("static String preservedPendingStateAfterLocalTransportFailure(JSONObject status)"));
        assertTrue(source.contains("if (hasRemoteAccepted(clientTurnId)) {\n            Json.put(status, \"remote_accepted\", true);\n        }"));
        assertTrue(source.contains("Json.put(status, \"reply_recovery_pending\", true)"));
        assertTrue(source.contains("Json.put(status, \"response_transport_error\""));
        assertTrue(source.contains("Json.put(status, \"response_transport_error_at\""));
        assertTrue(source.contains("Json.put(status, \"remote_accepted\", true)"));
        assertTrue(source.contains("clearRemoteAccepted(clientTurnId);"));
        assertTrue(source.contains("Json.put(recovered, \"reply_card_saved\", true)"));
        assertTrue(source.contains("Json.put(recovered, \"recovery_source\", recoverySource)"));
        assertTrue(source.contains("clearTransportRecoveryFields(recovered);"));
        assertTrue(source.contains("recovered.remove(\"remote_stage\")"));
        assertTrue(source.contains("recovered.remove(\"server_turn_status\")"));
        assertTrue(source.contains("markStatus(nextState, recovered, null)"));
        assertTrue(source.contains("private static boolean shouldAttemptReplyRecovery(JSONObject status)"));
        assertTrue(source.contains("private static boolean isLocallyRecovered(JSONObject status)"));
        assertTrue(source.contains("STALE_CODEX_RUNNING_TIMEOUT_MS = 10L * 60L * 1000L"));
        assertTrue(source.contains("STALE_REPLY_RECOVERY_TIMEOUT_MS = 5_000L"));
        assertTrue(source.contains("private JSONObject maybeExpireStaleCodexRunning"));
        assertTrue(source.contains("private JSONObject maybeSettleStaleReplyRecovery"));
        assertTrue(source.contains("static boolean shouldExpireStaleCodexRunning"));
        assertTrue(source.contains("static long staleCodexRunningAgeMs"));
        assertTrue(source.contains("static boolean shouldSettleStaleReplyRecovery"));
        assertTrue(source.contains("static long staleReplyRecoveryAgeMs"));
        assertTrue(source.contains("Json.put(settled, \"reply_recovery_settled\", true)"));
        assertTrue(source.contains("Json.put(settled, \"reply_recovery_settled_age_ms\", ageMs)"));
        assertTrue(source.contains("markStatus(\"completed\", settled, null)"));
        assertTrue(source.contains("Json.put(out, \"stale_codex_running_expired\""));
        assertTrue(source.contains("Json.put(out, \"stale_codex_running_age_ms\""));
        assertTrue(source.contains("replyCards.snapshot().optJSONArray(\"cards\")"));
        assertTrue(feed.contains("PuckyTurnController.shared(context).onReplyRecovered(local, \"feed_sync\")"));
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
        assertTrue(source.contains("copyIfPresent(record, detail, \"card_id\")"));
        assertTrue(source.contains("copyIfPresent(record, detail, \"reply_card_saved\")"));
        assertTrue(source.contains("copyIfPresent(record, detail, \"phase\")"));
        assertTrue(source.contains("copyIfPresent(record, detail, \"recovery_source\")"));
        assertTrue(source.contains("copyIfPresent(record, detail, \"reply_recovery_pending\")"));
        assertTrue(source.contains("copyIfPresent(record, detail, \"response_transport_error\")"));
        assertTrue(source.contains("copyIfPresent(record, detail, \"response_transport_error_at\")"));
        assertTrue(source.contains("copyIfPresent(record, detail, \"remote_accepted\")"));
        assertTrue(source.contains("removeIfMissing(record, detail, \"phase\")"));
        assertTrue(source.contains("removeIfMissing(record, detail, \"reply_recovery_pending\")"));
        assertTrue(source.contains("removeIfMissing(record, detail, \"response_transport_error\")"));
        assertTrue(source.contains("removeIfMissing(record, detail, \"response_transport_error_at\")"));
        assertTrue(source.contains("removeIfMissing(record, detail, \"remote_accepted\")"));
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
