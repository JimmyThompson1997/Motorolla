package com.pucky.device.pucky;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

public final class PuckyTurnStatePolicyTest {
    @Test
    public void localFailureBeforeRemoteAcceptanceRemainsTerminal() throws Exception {
        JSONObject status = new JSONObject()
                .put("state", "uploading");

        assertFalse(PuckyTurnController.shouldRetainPendingAfterLocalTransportFailure(status));
    }

    @Test
    public void acceptedUploadReceivedStaysSendingAfterLocalTransportFailure() throws Exception {
        JSONObject status = new JSONObject()
                .put("state", "upload_received")
                .put("remote_stage", "upload_received");

        assertTrue(PuckyTurnController.shouldRetainPendingAfterLocalTransportFailure(status));
        assertEquals("upload_received", PuckyTurnController.preservedPendingStateAfterLocalTransportFailure(status));
    }

    @Test
    public void acceptedSttRunningStaysSendingAfterLocalTransportFailure() throws Exception {
        JSONObject status = new JSONObject()
                .put("state", "stt_running")
                .put("remote_stage", "stt_running");

        assertTrue(PuckyTurnController.shouldRetainPendingAfterLocalTransportFailure(status));
        assertEquals("stt_running", PuckyTurnController.preservedPendingStateAfterLocalTransportFailure(status));
    }

    @Test
    public void acceptedCodexRunningStaysThinkingAfterLocalTransportFailure() throws Exception {
        JSONObject status = new JSONObject()
                .put("state", "codex_running")
                .put("remote_stage", "codex_running")
                .put("user_transcript", "Summarize this");

        assertTrue(PuckyTurnController.shouldRetainPendingAfterLocalTransportFailure(status));
        assertEquals("codex_running", PuckyTurnController.preservedPendingStateAfterLocalTransportFailure(status));
    }

    @Test
    public void acceptedTtsRunningStaysThinkingAfterLocalTransportFailure() throws Exception {
        JSONObject status = new JSONObject()
                .put("state", "tts_running")
                .put("remote_stage", "tts_running")
                .put("user_transcript", "Summarize this");

        assertTrue(PuckyTurnController.shouldRetainPendingAfterLocalTransportFailure(status));
        assertEquals("tts_running", PuckyTurnController.preservedPendingStateAfterLocalTransportFailure(status));
    }

    @Test
    public void remoteAcceptedFallbackWithoutStageUsesTranscriptPresence() throws Exception {
        JSONObject sending = new JSONObject()
                .put("state", "uploading")
                .put("remote_accepted", true);
        JSONObject thinking = new JSONObject()
                .put("state", "uploading")
                .put("remote_accepted", true)
                .put("user_transcript", "Email Sarah");

        assertEquals("upload_received", PuckyTurnController.preservedPendingStateAfterLocalTransportFailure(sending));
        assertEquals("codex_running", PuckyTurnController.preservedPendingStateAfterLocalTransportFailure(thinking));
    }

    @Test
    public void remoteFailedRemainsVisibleFailed() throws Exception {
        JSONObject status = new JSONObject()
                .put("state", "failed")
                .put("remote_stage", "failed")
                .put("remote_accepted", true);

        assertFalse(PuckyTurnController.shouldRetainPendingAfterLocalTransportFailure(status));
    }
}
