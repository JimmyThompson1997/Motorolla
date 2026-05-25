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
    static final String REASON_SINGLE_WORD_CONFIDENCE_TOO_LOW = "single_word_confidence_too_low";
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

    static WakeConfirmationDecision decide(OnDeviceInjectedAudioRecognizer.RecognitionOutcome outcome,
                                           double singleWordConfidenceThreshold) {
        if (outcome == null || !outcome.succeeded) {
            return new WakeConfirmationDecision(false, "", STATUS_ERROR, REASON_CONFIRMATION_ERROR);
        }
        String matchedPhrase = WakePhraseFamily.matchedPhrase(outcome.transcript);
        if (matchedPhrase.isEmpty()) {
            return new WakeConfirmationDecision(false, "", STATUS_REJECTED, REASON_CONFIRMATION_NO_MATCH);
        }
        if (WakePhraseFamily.isSingleWordVariant(matchedPhrase)) {
            double topConfidence = topConfidence(outcome.confidences);
            if (topConfidence >= 0.0 && topConfidence < singleWordConfidenceThreshold) {
                return new WakeConfirmationDecision(false, matchedPhrase, STATUS_REJECTED,
                        REASON_SINGLE_WORD_CONFIDENCE_TOO_LOW);
            }
        }
        return new WakeConfirmationDecision(true, matchedPhrase, STATUS_ACCEPTED, REASON_ACCEPTED);
    }

    static double topConfidence(JSONArray confidences) {
        if (confidences == null || confidences.length() == 0) {
            return -1.0;
        }
        Object first = confidences.opt(0);
        if (!(first instanceof Number)) {
            return -1.0;
        }
        return ((Number) first).doubleValue();
    }
}
