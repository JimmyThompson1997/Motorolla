package com.pucky.device.wake;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.pucky.device.speech.OnDeviceInjectedAudioRecognizer;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.junit.Test;

public final class WakeConfirmationDecisionTest {
    @Test
    public void acceptedPhraseReturnsAcceptedDecision() {
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(
                succeeded("Hey Pucky", "Hey Pucky", 0.92f),
                0.60);

        assertTrue(decision.accepted);
        assertEquals("hey pucky", decision.matchedPhrase);
        assertEquals(WakeConfirmationDecision.STATUS_ACCEPTED, decision.confirmationStatus);
        assertEquals(WakeConfirmationDecision.REASON_ACCEPTED, decision.reason);
    }

    @Test
    public void unmatchedPhraseReturnsConfirmationNoMatch() {
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(
                succeeded("Pocket", "Pocket", 0.92f),
                0.60);

        assertEquals(WakeConfirmationDecision.STATUS_REJECTED, decision.confirmationStatus);
        assertEquals(WakeConfirmationDecision.REASON_CONFIRMATION_NO_MATCH, decision.reason);
    }

    @Test
    public void lowConfidenceSingleWordIsRejected() {
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(
                succeeded("Pocky", "Pocky", 0.22f),
                0.60);

        assertEquals(WakeConfirmationDecision.STATUS_REJECTED, decision.confirmationStatus);
        assertEquals(WakeConfirmationDecision.REASON_SINGLE_WORD_CONFIDENCE_TOO_LOW, decision.reason);
    }

    @Test
    public void recognizerErrorMapsToConfirmationError() {
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(
                OnDeviceInjectedAudioRecognizer.RecognitionOutcome.failed("recognizer_7", "boom"),
                0.60);

        assertEquals(WakeConfirmationDecision.STATUS_ERROR, decision.confirmationStatus);
        assertEquals(WakeConfirmationDecision.REASON_CONFIRMATION_ERROR, decision.reason);
    }

    private static OnDeviceInjectedAudioRecognizer.RecognitionOutcome succeeded(
            String transcript,
            String alternative,
            float confidence) {
        JSONArray alternatives = new JSONArray();
        Json.add(alternatives, transcript);
        if (alternative != null && !alternative.equals(transcript)) {
            Json.add(alternatives, alternative);
        }
        JSONArray confidences = new JSONArray();
        Json.add(confidences, confidence);
        return OnDeviceInjectedAudioRecognizer.RecognitionOutcome.manual(transcript, alternatives, confidences);
    }
}
