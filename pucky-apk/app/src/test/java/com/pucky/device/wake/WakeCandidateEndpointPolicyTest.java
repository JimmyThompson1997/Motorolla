package com.pucky.device.wake;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class WakeCandidateEndpointPolicyTest {
    @Test
    public void shortWakePhraseEndsOnLowTrailingSilence() {
        int speech = WakeCandidateEndpointPolicy.samplesForMs(WakeCandidateEndpointPolicy.MIN_SPEECH_MS);
        int trailing = WakeCandidateEndpointPolicy.samplesForMs(WakeCandidateEndpointPolicy.TRAILING_SILENCE_MS);

        assertEquals(WakeCandidateEndpointPolicy.FINISH_TRAILING_SILENCE,
                WakeCandidateEndpointPolicy.finishReason(speech + trailing, speech, trailing));
    }

    @Test
    public void silenceOrTooShortSpeechDoesNotFinalizeAsWakePhrase() {
        assertEquals("", WakeCandidateEndpointPolicy.finishReason(
                WakeCandidateEndpointPolicy.samplesForMs(400),
                0,
                WakeCandidateEndpointPolicy.samplesForMs(400)));

        assertEquals(WakeCandidateEndpointPolicy.FINISH_TOO_SHORT,
                WakeCandidateEndpointPolicy.finishReason(
                        WakeCandidateEndpointPolicy.samplesForMs(WakeCandidateEndpointPolicy.MAX_CANDIDATE_MS),
                        WakeCandidateEndpointPolicy.samplesForMs(50),
                        WakeCandidateEndpointPolicy.samplesForMs(1700)));
    }

    @Test
    public void overlongCandidateFinalizesAtHardLimit() {
        assertEquals(WakeCandidateEndpointPolicy.FINISH_MAX_DURATION,
                WakeCandidateEndpointPolicy.finishReason(
                        WakeCandidateEndpointPolicy.samplesForMs(WakeCandidateEndpointPolicy.MAX_CANDIDATE_MS),
                        WakeCandidateEndpointPolicy.samplesForMs(500),
                        WakeCandidateEndpointPolicy.samplesForMs(200)));
    }
}
