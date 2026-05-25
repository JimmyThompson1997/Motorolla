package com.pucky.device.wake;

import com.pucky.device.speech.OnDeviceInjectedAudioRecognizer;

import org.json.JSONArray;

final class WakeConfirmationDecision {
    static final String STATUS_NOT_RUN = "not_run";
    static final String STATUS_PENDING = "pending";
    static final String STATUS_ACCEPTED = "accepted";
    static final String STATUS_REJECTED = "rejected";
    static final String STATUS_ERROR = "error";

    static final String REASON_NO_CANDIDATE_DETECTED = "no_candidate_detected";
    static final String REASON_CONFIRMATION_NO_MATCH = "confirmation_no_match";
    static final String REASON_CONFIRMATION_ERROR = "confirmation_error";
    static final String REASON_ACCEPTED = "accepted";

    final boolean accepted;
    final String matchedPhrase;
    final String confirmationStatus;
    final String reason;

    private WakeConfirmationDecision(boolean accepted, String matchedPhrase, String confirmationStatus, String reason) {
        this.accepted = accepted;
        this.matchedPhrase = matchedPhrase == null ? "" : matchedPhrase;
        this.confirmationStatus = confirmationStatus;
        this.reason = reason;
    }

    static WakeConfirmationDecision decide(OnDeviceInjectedAudioRecognizer.RecognitionOutcome outcome) {
        if (outcome == null || !outcome.succeeded) {
            return new WakeConfirmationDecision(false, "", STATUS_ERROR, REASON_CONFIRMATION_ERROR);
        }
        String matchedPhrase = firstMatchedPhrase(outcome);
        if (matchedPhrase.isEmpty()) {
            return new WakeConfirmationDecision(false, "", STATUS_REJECTED, REASON_CONFIRMATION_NO_MATCH);
        }
        return new WakeConfirmationDecision(true, matchedPhrase, STATUS_ACCEPTED, REASON_ACCEPTED);
    }

    private static String firstMatchedPhrase(OnDeviceInjectedAudioRecognizer.RecognitionOutcome outcome) {
        String matchedPhrase = WakePhraseFamily.matchedPhrase(outcome.transcript);
        if (!matchedPhrase.isEmpty()) {
            return matchedPhrase;
        }
        JSONArray alternatives = outcome.alternatives;
        if (alternatives == null) {
            return "";
        }
        for (int index = 0; index < alternatives.length(); index += 1) {
            String alternative = alternatives.optString(index, "");
            matchedPhrase = WakePhraseFamily.matchedPhrase(alternative);
            if (!matchedPhrase.isEmpty()) {
                return matchedPhrase;
            }
        }
        return "";
    }
}
