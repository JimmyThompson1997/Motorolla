package com.pucky.device.ui;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class PuckyWebResourceClientTest {
    @Test
    public void hostedUiRetryOnlyTargetsCanonicalHostedVmUrls() {
        assertTrue(PuckyWebResourceClient.isHostedUiUrl("https://pucky.fly.dev/ui/pucky/latest/?reset_nav=1"));
        assertTrue(PuckyWebResourceClient.isHostedUiUrl("https://pucky.fly.dev/ui/pucky/latest/index.html?theme=light"));
        assertFalse(PuckyWebResourceClient.isHostedUiUrl("chrome-error://chromewebdata/"));
        assertFalse(PuckyWebResourceClient.isHostedUiUrl("https://example.com/ui/pucky/latest/"));
    }

    @Test
    public void hostedUiRetryBudgetIsBoundedAndBackedOff() {
        assertTrue(PuckyWebResourceClient.shouldRetryHostedUiUrl(
                "https://pucky.fly.dev/ui/pucky/latest/?reset_nav=1",
                0));
        assertFalse(PuckyWebResourceClient.shouldRetryHostedUiUrl(
                "https://pucky.fly.dev/ui/pucky/latest/?reset_nav=1",
                6));
        assertEquals(1500L, PuckyWebResourceClient.hostedUiReloadDelayMs(1));
        assertEquals(4500L, PuckyWebResourceClient.hostedUiReloadDelayMs(3));
    }
}
