package com.pucky.device.ui;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.Test;

public final class MainActivityWebShellTest {
    @Test
    public void mainActivityDoesNotRenderNativeCoverScreens() throws Exception {
        String source = new String(
                Files.readAllBytes(Path.of("src/main/java/com/pucky/device/MainActivity.java")),
                StandardCharsets.UTF_8);

        String[] forbidden = {
                "import android.widget.Button;",
                "import android.widget.EditText;",
                "import android.widget.LinearLayout;",
                "import android.widget.ScrollView;",
                "import android.widget.TextView;",
                "import android.widget.Toast;",
                "buildAdminView(",
                "buildAssistantSetupView(",
                "buildPortalErrorView(",
                "showAdminScreen(",
                "showAssistantSetupScreen(",
                "Pucky UI failed to load",
                "Remote cover UI is unavailable"
        };
        for (String needle : forbidden) {
            assertFalse("MainActivity should remain a WebView shell without " + needle,
                    source.contains(needle));
        }
    }

    @Test
    public void foregroundServiceDoesNotAddCoverOverlaySentinel() throws Exception {
        String source = new String(
                Files.readAllBytes(Path.of("src/main/java/com/pucky/device/service/PuckyForegroundService.java")),
                StandardCharsets.UTF_8);

        String[] forbidden = {
                "TYPE_APPLICATION_OVERLAY",
                "PuckyCoverSentinel",
                "ensureCoverVisibilitySentinel",
                "removeCoverVisibilitySentinel"
        };
        for (String needle : forbidden) {
            assertFalse("Foreground service should not draw cover overlay sentinel " + needle,
                    source.contains(needle));
        }
    }

    @Test
    public void foregroundServiceOnlyRestoresCoverAfterWakeTransition() throws Exception {
        String source = new String(
                Files.readAllBytes(Path.of("src/main/java/com/pucky/device/service/PuckyForegroundService.java")),
                StandardCharsets.UTF_8);

        assertTrue("Foreground service should listen for cover display lifecycle changes",
                source.contains("registerCoverDisplayListener();"));
        assertTrue("Foreground service should route cover display changes through a transition gate",
                source.contains("handleCoverDisplayChanged(displayId"));
        assertFalse("Foreground service should not restore Pucky just because the service started",
                source.contains("scheduleCoverRestore(\"service_started\")"));
        assertFalse("Foreground service should not restore Pucky just because the broker connected",
                source.contains("scheduleCoverRestore(\"connect_action\")"));
    }

    @Test
    public void mainActivityOnlyWakesScreenForExplicitWakeIntent() throws Exception {
        String source = new String(
                Files.readAllBytes(Path.of("src/main/java/com/pucky/device/MainActivity.java")),
                StandardCharsets.UTF_8);

        assertTrue("MainActivity should expose an explicit wake-screen launch extra",
                source.contains("EXTRA_WAKE_SCREEN"));
        assertTrue("MainActivity should consume the explicit wake request",
                source.contains("consumeWakeScreenRequest()"));
        assertFalse("MainActivity should not unconditionally keep the cover display awake",
                source.contains("addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)"));
        assertFalse("MainActivity should not unconditionally request turn-screen-on",
                source.contains("setTurnScreenOn(true)"));
    }
}
