package com.pucky.device.phone;

public final class PhoneRoleState {
    private PhoneRoleState() {
    }

    public static boolean isEligible(boolean roleAvailable, boolean handlesDialIntent, boolean hasInCallService) {
        return roleAvailable && handlesDialIntent && hasInCallService;
    }

    public static String classify(boolean roleAvailable, boolean handlesDialIntent, boolean hasInCallService, boolean roleHeld) {
        if (roleHeld) {
            return "held";
        }
        if (!roleAvailable) {
            return "not_available";
        }
        if (!handlesDialIntent || !hasInCallService) {
            return "not_eligible";
        }
        return "eligible_not_held";
    }
}
