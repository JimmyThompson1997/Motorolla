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
    public void foregroundServiceKeepsCoverRestoreListenerActive() throws Exception {
        String source = new String(
                Files.readAllBytes(Path.of("src/main/java/com/pucky/device/service/PuckyForegroundService.java")),
                StandardCharsets.UTF_8);

        assertTrue("Foreground service should listen for cover display lifecycle changes",
                source.contains("registerCoverDisplayListener();"));
        assertTrue("Foreground service should attempt one cover restore when it starts",
                source.contains("scheduleCoverRestore(\"service_started\");"));
    }
}
