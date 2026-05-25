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
                succeeded("Hey Pucky", new String[] {"Hey Pucky"}, 0.92f));

        assertTrue(decision.accepted);
        assertEquals("hey pucky", decision.matchedPhrase);
        assertEquals(WakeConfirmationDecision.STATUS_ACCEPTED, decision.confirmationStatus);
        assertEquals(WakeConfirmationDecision.REASON_ACCEPTED, decision.reason);
    }

    @Test
    public void unmatchedPhraseReturnsConfirmationNoMatch() {
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(
                succeeded("Pocket", new String[] {"Pocket"}, 0.92f));

        assertEquals(WakeConfirmationDecision.STATUS_REJECTED, decision.confirmationStatus);
        assertEquals(WakeConfirmationDecision.REASON_CONFIRMATION_NO_MATCH, decision.reason);
    }

    @Test
    public void lowConfidenceSingleWordWakeAliasIsStillAccepted() {
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(
                succeeded("Pocky", new String[] {"Pocky"}, 0.22f));

        assertTrue(decision.accepted);
        assertEquals("pocky", decision.matchedPhrase);
        assertEquals(WakeConfirmationDecision.STATUS_ACCEPTED, decision.confirmationStatus);
        assertEquals(WakeConfirmationDecision.REASON_ACCEPTED, decision.reason);
    }

    @Test
    public void alternativeMatchAcceptsEvenWhenPrimaryTranscriptMisses() {
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(
                succeeded("Cheap Android devices.", new String[] {"Cheap Android devices.", "Hey Pucky"}, 0.18f));

        assertTrue(decision.accepted);
        assertEquals("hey pucky", decision.matchedPhrase);
    }

    @Test
    public void recognizerErrorMapsToConfirmationError() {
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(
                OnDeviceInjectedAudioRecognizer.RecognitionOutcome.failed("recognizer_7", "boom"));

        assertEquals(WakeConfirmationDecision.STATUS_ERROR, decision.confirmationStatus);
        assertEquals(WakeConfirmationDecision.REASON_CONFIRMATION_ERROR, decision.reason);
    }

    @Test
    public void observedHeyPuckingMangleMapsBackIntoWakeFamily() {
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(
                succeeded("Hey Pucking!", new String[] {"Hey Pucking!", "Hey Pucky"}, 0.0f));

        assertTrue(decision.accepted);
        assertEquals("hey pucky", decision.matchedPhrase);
    }

    @Test
    public void parkingRemainsRejectedEvenWhenItLooksClose() {
        WakeConfirmationDecision decision = WakeConfirmationDecision.decide(
                succeeded("Parking.", new String[] {"Parking.", "Parking"}, 0.0f));

        assertEquals(WakeConfirmationDecision.STATUS_REJECTED, decision.confirmationStatus);
        assertEquals(WakeConfirmationDecision.REASON_CONFIRMATION_NO_MATCH, decision.reason);
    }

    private static OnDeviceInjectedAudioRecognizer.RecognitionOutcome succeeded(
            String transcript,
            String[] alternativesInput,
            float confidence) {
        JSONArray alternatives = new JSONArray();
        if (alternativesInput != null) {
            for (String alternative : alternativesInput) {
                if (alternative != null) {
                    Json.add(alternatives, alternative);
                }
            }
        }
        JSONArray confidences = new JSONArray();
        Json.add(confidences, confidence);
        return OnDeviceInjectedAudioRecognizer.RecognitionOutcome.manual(transcript, alternatives, confidences);
    }
}
