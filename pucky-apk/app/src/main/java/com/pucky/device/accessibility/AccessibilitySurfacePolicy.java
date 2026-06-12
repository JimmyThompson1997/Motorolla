package com.pucky.device.accessibility;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;

public final class AccessibilitySurfacePolicy {
    private static final String[] CURATED_PREFIXES = new String[] {
            "com.android.settings",
            "com.android.chrome",
            "com.google.android.apps.chrome",
            "com.android.browser",
            "org.mozilla.firefox",
            "com.google.android.calendar",
            "com.android.calendar",
            "com.google.android.dialer",
            "com.android.dialer",
            "com.motorola.dialer",
            "com.android.systemui"
    };

    private AccessibilitySurfacePolicy() {
    }

    public static boolean isCuratedPackageAllowed(String packageName, String selfPackageName) {
        String normalized = packageName == null ? "" : packageName.trim().toLowerCase();
        if (normalized.isEmpty()) {
            return false;
        }
        if (selfPackageName != null && normalized.equals(selfPackageName.trim().toLowerCase())) {
            return true;
        }
        for (String prefix : CURATED_PREFIXES) {
            if (normalized.equals(prefix) || normalized.startsWith(prefix + ".")) {
                return true;
            }
        }
        return false;
    }

    public static void requireLabEnabled(boolean enabled) throws CommandException {
        if (!enabled) {
            throw new CommandException(
                    CommandErrorCodes.COMMAND_NOT_ALLOWED,
                    "ui.a11y.lab is disabled in Pucky settings");
        }
    }
}
