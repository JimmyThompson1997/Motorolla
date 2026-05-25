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
}
