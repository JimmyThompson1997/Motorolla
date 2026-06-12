package com.pucky.device.phone;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.pucky.device.accessibility.AccessibilitySurfacePolicy;
import com.pucky.device.command.CommandException;

import org.junit.Test;

public final class PhoneRoleStateTest {
    @Test
    public void dialerRoleClassifiesHeld() {
        assertEquals("held", PhoneRoleState.classify(true, true, true, true));
    }

    @Test
    public void dialerRoleClassifiesNotEligibleWhenManifestPiecesAreMissing() {
        assertEquals("not_eligible", PhoneRoleState.classify(true, false, true, false));
        assertEquals("not_eligible", PhoneRoleState.classify(true, true, false, false));
        assertFalse(PhoneRoleState.isEligible(true, false, true));
    }

    @Test
    public void dialerRoleClassifiesEligibleNotHeld() {
        assertEquals("eligible_not_held", PhoneRoleState.classify(true, true, true, false));
        assertTrue(PhoneRoleState.isEligible(true, true, true));
    }

    @Test
    public void curatedAccessibilityAllowsExpectedPackagesOnly() {
        assertTrue(AccessibilitySurfacePolicy.isCuratedPackageAllowed("com.android.settings", "com.pucky.device"));
        assertTrue(AccessibilitySurfacePolicy.isCuratedPackageAllowed("com.google.android.dialer", "com.pucky.device"));
        assertTrue(AccessibilitySurfacePolicy.isCuratedPackageAllowed("com.pucky.device", "com.pucky.device"));
        assertFalse(AccessibilitySurfacePolicy.isCuratedPackageAllowed("com.random.thirdparty", "com.pucky.device"));
    }

    @Test
    public void labAccessibilityRejectsWhenDisabled() {
        try {
            AccessibilitySurfacePolicy.requireLabEnabled(false);
        } catch (CommandException exc) {
            assertEquals("COMMAND_NOT_ALLOWED", exc.code());
            return;
        }
        throw new AssertionError("Expected requireLabEnabled(false) to reject");
    }
}
