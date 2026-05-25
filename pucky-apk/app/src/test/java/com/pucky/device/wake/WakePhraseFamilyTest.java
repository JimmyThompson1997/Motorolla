package com.pucky.device.wake;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class WakePhraseFamilyTest {
    @Test
    public void acceptedWakeVariantsMatchNormalizedFamily() {
        assertEquals("hey pucky", WakePhraseFamily.matchedPhrase("Hey Pucky"));
        assertEquals("hey puppy", WakePhraseFamily.matchedPhrase("Hey puppy"));
        assertEquals("hey lucky", WakePhraseFamily.matchedPhrase("hey lucky"));
        assertEquals("hey pocky", WakePhraseFamily.matchedPhrase("Hey Pocky!"));
        assertEquals("hey pookie", WakePhraseFamily.matchedPhrase("Hey Pookie"));
        assertEquals("hey bucky", WakePhraseFamily.matchedPhrase("Hey Bucky"));
        assertEquals("hey pucky", WakePhraseFamily.matchedPhrase("Hey Pupp"));
        assertEquals("hey pucky", WakePhraseFamily.matchedPhrase("Hey Pucking!"));
        assertEquals("pucky", WakePhraseFamily.matchedPhrase("Pucking."));
        assertEquals("pookie", WakePhraseFamily.matchedPhrase("Pooking."));
        assertEquals("pokey", WakePhraseFamily.matchedPhrase("Pokey"));
        assertEquals("packy", WakePhraseFamily.matchedPhrase("Packy"));
        assertEquals("pucky", WakePhraseFamily.matchedPhrase("Pucky"));
        assertTrue(WakePhraseFamily.isSingleWordVariant("Pucky"));
        assertFalse(WakePhraseFamily.isSingleWordVariant("Hey Pucky"));
    }

    @Test
    public void unrelatedPhrasesDoNotMatchWakeFamily() {
        assertTrue(WakePhraseFamily.matchedPhrase("what time is it").isEmpty());
        assertTrue(WakePhraseFamily.matchedPhrase("turn the flashlight on").isEmpty());
        assertTrue(WakePhraseFamily.matchedPhrase("take a photo").isEmpty());
        assertTrue(WakePhraseFamily.matchedPhrase("Parking").isEmpty());
    }

    @Test
    public void proofLabAcceptsWakePrefixPhrases() {
        assertEquals("pucky", WakePhraseFamily.matchedPhrasePrefix("Pucky test 123"));
        assertEquals("hey pucky", WakePhraseFamily.matchedPhrasePrefix("Hey Pucky what is this"));
        assertEquals("hey bucky", WakePhraseFamily.matchedPhrasePrefix("Hey Bucky can you hear me"));
        assertEquals("hey pucky", WakePhraseFamily.matchedPhrasePrefix("Hey Pupp test"));
    }

    @Test
    public void proofLabKeepsRiskyNearMissesRejected() {
        assertTrue(WakePhraseFamily.matchedPhrasePrefix("Parking lot").isEmpty());
        assertTrue(WakePhraseFamily.matchedPhrasePrefix("Puppet show").isEmpty());
        assertTrue(WakePhraseFamily.matchedPhrasePrefix("Can you hear me").isEmpty());
        assertTrue(WakePhraseFamily.matchedPhrasePrefix("Lucky day").isEmpty());
    }
}
