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
    public void buttonDefaultsRouteVolumeUpToTurnAndVolumeDownToCapture() throws Exception {
        String source = read("src/main/java/com/pucky/device/buttons/ButtonController.java");

        assertTrue(source.contains("\"android_volume_pucky_raw_turn_capture_v19\""));
        assertTrue(source.contains("Json.put(mappings, \"volume_up_hold\", \"pucky.turn.start\")"));
        assertTrue(source.contains("Json.put(mappings, \"volume_up_hold_release\", \"pucky.turn.stop\")"));
        assertTrue(source.contains("Json.put(mappings, \"volume_down_hold\", \"voice.capture.start\")"));
        assertTrue(source.contains("Json.put(mappings, \"volume_down_hold_release\", \"voice.capture.stop\")"));
        assertTrue(source.contains("PuckyTurnController.shared(context).start(new JSONObject())"));
        assertTrue(source.contains("PuckyTurnController.shared(context).stop(reasonArgs(\"button_release\"))"));
        assertTrue(source.contains("VoiceCaptureController.shared(context).start(voiceCaptureButtonArgs())"));
        assertTrue(source.contains("VoiceCaptureController.shared(context).stop(voiceCaptureStopArgs(\"button_release\"))"));
        assertFalse(source.contains("Json.put(mappings, \"volume_up_hold\", \"livekit.ptt.start\")"));
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
    public void controllerPostsRawAudioAndCreatesOneFeedCard() throws Exception {
        String source = read("src/main/java/com/pucky/device/pucky/PuckyTurnController.java");
        String store = read("src/main/java/com/pucky/device/ui/ReplyCardStore.java");

        assertTrue(source.contains("VoiceCaptureController.shared(context).start(startArgs)"));
        assertTrue(source.contains("Json.put(startArgs, \"format\", \"m4a\")"));
        assertTrue(source.contains("MediaType.get(\"audio/mp4\")"));
        assertTrue(source.contains(".header(\"Authorization\", \"Bearer \" + settings.getPuckyApiToken())"));
        assertTrue(source.contains("new File(context.getFilesDir(), \"pucky_replies\""));
        assertTrue(source.contains("Json.put(card, \"session_id\", sessionId)"));
        assertTrue(source.contains("new ReplyCardStore(context).prepend(card)"));
        assertTrue(store.contains("public JSONObject prepend(JSONObject cardJson)"));
        assertTrue(store.contains("cards.add(card);"));
        assertTrue(store.contains("cards.addAll(cards());"));
        assertFalse(Pattern.compile("Log\\.[^;]*getPuckyApiToken", Pattern.DOTALL).matcher(source).find());
    }

    @Test
    public void settingsCanProvisionPuckyTurnEndpointWithoutHardcodingSecret() throws Exception {
        String source = read("src/main/java/com/pucky/device/storage/SettingsStore.java");

        assertTrue(source.contains("\"pucky_turn_url\""));
        assertTrue(source.contains("\"pucky_api_token\""));
        assertTrue(source.contains("https://pucky.fly.dev/api/turn"));
        assertTrue(source.contains("putString(editor, input, \"pucky_api_token\""));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }
}
