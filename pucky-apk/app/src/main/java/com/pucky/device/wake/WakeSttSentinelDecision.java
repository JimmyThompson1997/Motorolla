package com.pucky.device.wake;

import org.json.JSONArray;

final class WakeSttSentinelDecision {
    final boolean accepted;
    final String matchedPhrase;
    final String transcript;
    final boolean partial;

    private WakeSttSentinelDecision(boolean accepted, String matchedPhrase, String transcript, boolean partial) {
        this.accepted = accepted;
        this.matchedPhrase = matchedPhrase == null ? "" : matchedPhrase;
        this.transcript = transcript == null ? "" : transcript;
        this.partial = partial;
    }

    static WakeSttSentinelDecision decide(JSONArray alternatives, boolean partial) {
        if (alternatives == null) {
            return rejected(partial);
        }
        for (int index = 0; index < alternatives.length(); index += 1) {
            String transcript = alternatives.optString(index, "");
            String matched = WakePhraseFamily.matchedPhrase(transcript);
            if (matched.isEmpty()) {
                continue;
            }
            if (partial && WakePhraseFamily.isSingleWordVariant(transcript)) {
                continue;
            }
            return new WakeSttSentinelDecision(true, matched, transcript, partial);
        }
        return rejected(partial);
    }

    private static WakeSttSentinelDecision rejected(boolean partial) {
        return new WakeSttSentinelDecision(false, "", "", partial);
    }
}
