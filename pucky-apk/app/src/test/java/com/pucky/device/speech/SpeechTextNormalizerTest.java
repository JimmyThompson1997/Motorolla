package com.pucky.device.speech;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class SpeechTextNormalizerTest {
    @Test
    public void normalizeLowercasesStripsPunctuationAndCollapsesWhitespace() {
        assertEquals("hey pucky", SpeechTextNormalizer.normalize(" HEY,   Pucky! "));
        assertEquals("microphone off hand", SpeechTextNormalizer.normalize("Microphone off hand?"));
        assertEquals("flash light", SpeechTextNormalizer.normalize("Flash...light"));
    }

    @Test
    public void normalizeReturnsEmptyForNullOrOnlySymbols() {
        assertEquals("", SpeechTextNormalizer.normalize(null));
        assertEquals("", SpeechTextNormalizer.normalize("!!!"));
    }
}
