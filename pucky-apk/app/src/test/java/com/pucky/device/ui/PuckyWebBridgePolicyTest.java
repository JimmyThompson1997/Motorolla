package com.pucky.device.ui;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

public final class PuckyWebBridgePolicyTest {
    @Test
    public void trustsAdbReverseLoopbackPortal() {
        assertTrue(PuckyWebBridgePolicy.isTrustedUrl(
                "http://127.0.0.1:8788/pucky-home?device_id=pucky-test",
                "https://jt-project-vox-codex.fly.dev"));
    }

    @Test
    public void rejectsUntrustedWebOrigins() {
        assertFalse(PuckyWebBridgePolicy.isTrustedUrl(
                "https://example.com/pucky-home",
                "https://jt-project-vox-codex.fly.dev"));
    }

    @Test
    public void trustsConfiguredHttpsOrigin() {
        assertTrue(PuckyWebBridgePolicy.isTrustedUrl(
                "https://jt-project-vox-codex.fly.dev/pucky-ui/assets/pucky-cover.js",
                "https://jt-project-vox-codex.fly.dev"));
    }

    @Test
    public void boundsTtlAndShellTimeouts() throws Exception {
        assertEquals(30000L, PuckyWebBridgePolicy.boundedTtlMs(0L));
        assertEquals(120000L, PuckyWebBridgePolicy.boundedTtlMs(999999L));
        JSONObject args = new JSONObject();
        args.put("timeout_ms", 999999);
        PuckyWebBridgePolicy.boundShellArgs(args);
        assertEquals(120000L, args.getLong("timeout_ms"));
    }
}
