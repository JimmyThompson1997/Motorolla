package com.pucky.device.ui;

import static org.junit.Assert.assertEquals;

import java.lang.reflect.Method;

import org.junit.Test;

public final class UiSurfaceControllerTest {
    @Test
    public void sourceKindTreatsResetNavCurrentBundleAsBundleCurrent() throws Exception {
        Method sourceKind = UiSurfaceController.class.getDeclaredMethod(
                "sourceKind",
                String.class,
                String.class,
                String.class,
                String.class);
        sourceKind.setAccessible(true);

        String entrypoint = "file:///data/user/0/com.pucky.device.debug/files/ui_bundles/current/index.html";
        String activeUrl = entrypoint + "?reset_nav=1";
        String kind = (String) sourceKind.invoke(null, activeUrl, "", entrypoint, "");

        assertEquals("bundle_current", kind);
    }

    @Test
    public void sourceKindTreatsFallbackAssetWithQueryAsFallbackAsset() throws Exception {
        Method sourceKind = UiSurfaceController.class.getDeclaredMethod(
                "sourceKind",
                String.class,
                String.class,
                String.class,
                String.class);
        sourceKind.setAccessible(true);

        String fallback = "file:///android_asset/pucky_fallback/index.html";
        String activeUrl = fallback + "?reset_nav=1";
        String kind = (String) sourceKind.invoke(null, activeUrl, "", "", fallback);

        assertEquals("fallback_asset", kind);
    }
}
