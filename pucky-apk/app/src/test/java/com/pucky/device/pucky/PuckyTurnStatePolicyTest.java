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
    public void freshCodexRunningDoesNotExpire() throws Exception {
        long now = 1_799_999L;
        JSONObject status = new JSONObject()
                .put("state", "codex_running")
                .put("updated_at", "1970-01-01T00:20:00Z");

        assertFalse(PuckyTurnController.shouldExpireStaleCodexRunning(status, new JSONObject(), now));
    }

    @Test
    public void staleCodexRunningWithoutLocalWorkExpires() throws Exception {
        long now = 1_800_001L;
        JSONObject status = new JSONObject()
                .put("state", "codex_running")
                .put("updated_at", "1970-01-01T00:20:00Z");

        assertTrue(PuckyTurnController.shouldExpireStaleCodexRunning(status, new JSONObject(), now));
        assertEquals(600_001L, PuckyTurnController.staleCodexRunningAgeMs(status, now));
    }

    @Test
    public void activeLocalWorkKeepsCodexRunningFromExpiring() throws Exception {
        long now = 1_800_001L;
        JSONObject status = new JSONObject()
                .put("state", "codex_running")
                .put("updated_at", "1970-01-01T00:20:00Z")
                .put("stt_running", true);
        JSONObject voice = new JSONObject()
                .put("state", "recording")
                .put("mic_on", true);

        assertFalse(PuckyTurnController.shouldExpireStaleCodexRunning(status, voice, now));
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

    @Test
    public void staleReplyRecoverySettlesAfterPersistedCompletedTimeout() throws Exception {
        long now = 10_000L;
        JSONObject status = new JSONObject()
                .put("state", "tts_running")
                .put("remote_stage", "completed")
                .put("reply_recovery_pending", true)
                .put("response_transport_error", "SocketTimeoutException: timeout")
                .put("response_transport_error_at", "1970-01-01T00:00:04Z")
                .put("server_turn_status", new JSONObject()
                        .put("stage", "completed")
                        .put("feed_persisted", true));

        assertTrue(PuckyTurnController.shouldSettleStaleReplyRecovery(status, new JSONObject(), new JSONObject(), now));
        assertEquals(6_000L, PuckyTurnController.staleReplyRecoveryAgeMs(status, now));
    }

    @Test
    public void freshReplyRecoveryDoesNotSettleBeforeGraceWindow() throws Exception {
        long now = 8_500L;
        JSONObject status = new JSONObject()
                .put("state", "tts_running")
                .put("remote_stage", "completed")
                .put("reply_recovery_pending", true)
                .put("response_transport_error", "SocketTimeoutException: timeout")
                .put("response_transport_error_at", "1970-01-01T00:00:04Z")
                .put("server_turn_status", new JSONObject()
                        .put("stage", "completed")
                        .put("feed_persisted", true));

        assertFalse(PuckyTurnController.shouldSettleStaleReplyRecovery(status, new JSONObject(), new JSONObject(), now));
    }

    @Test
    public void activePlaybackKeepsReplyRecoveryVisible() throws Exception {
        long now = 10_000L;
        JSONObject status = new JSONObject()
                .put("state", "tts_running")
                .put("remote_stage", "completed")
                .put("reply_recovery_pending", true)
                .put("response_transport_error", "SocketTimeoutException: timeout")
                .put("response_transport_error_at", "1970-01-01T00:00:04Z")
                .put("server_turn_status", new JSONObject()
                        .put("stage", "completed")
                        .put("feed_persisted", true));
        JSONObject player = new JSONObject()
                .put("is_playing", true)
                .put("source", "pucky.turn");

        assertFalse(PuckyTurnController.shouldSettleStaleReplyRecovery(status, new JSONObject(), player, now));
    }
}
