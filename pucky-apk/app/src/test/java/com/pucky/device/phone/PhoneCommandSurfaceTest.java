package com.pucky.device.phone;

import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.Test;

public final class PhoneCommandSurfaceTest {
    @Test
    public void commandCatalogIncludesPhoneRoleHistoryAndAccessibilityFamilies() throws Exception {
        String source = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");

        assertTrue(source.contains("\"phone.role.status\""));
        assertTrue(source.contains("\"phone.role.request_setup\""));
        assertTrue(source.contains("\"phone.role.open_default_apps_settings\""));
        assertTrue(source.contains("\"phone.calls.decline\""));
        assertTrue(source.contains("\"phone.history.list\""));
        assertTrue(source.contains("\"ui.a11y.status\""));
        assertTrue(source.contains("\"ui.a11y.snapshot\""));
        assertTrue(source.contains("\"ui.a11y.wait_for\""));
        assertTrue(source.contains("\"ui.a11y.action\""));
        assertTrue(source.contains("\"ui.a11y.type\""));
        assertTrue(source.contains("\"ui.a11y.global_action\""));
        assertTrue(source.contains("\"ui.a11y.lab.status\""));
        assertTrue(source.contains("\"ui.a11y.lab.snapshot\""));
        assertTrue(source.contains("\"ui.a11y.lab.action\""));
        assertTrue(source.contains("\"ui.a11y.lab.gesture\""));
        assertTrue(source.contains("\"ui.a11y.lab.type\""));
    }

    @Test
    public void manifestAndAccessibilityServiceAdvertiseSurface() throws Exception {
        String manifest = read("src/main/AndroidManifest.xml");
        String accessibilityXml = read("src/main/res/xml/pucky_accessibility_service.xml");
        String strings = read("src/main/res/values/strings.xml");

        assertTrue(manifest.contains("android:name=\".phone.PhoneHubActivity\""));
        assertTrue(manifest.contains("android:name=\".phone.PhoneRoleSetupActivity\""));
        assertTrue(accessibilityXml.contains("android:canPerformGestures=\"true\""));
        assertTrue(accessibilityXml.contains("android:canRetrieveWindowContent=\"true\""));
        assertTrue(accessibilityXml.contains("flagRetrieveInteractiveWindows"));
        assertTrue(strings.contains("Pucky control surface"));
    }

    @Test
    public void settingsAndCapabilityReportsExposeLabGateAndNewSurfaces() throws Exception {
        String settings = read("src/main/java/com/pucky/device/storage/SettingsStore.java");
        String capabilities = read("src/main/java/com/pucky/device/capabilities/CapabilityReporter.java");
        String permissions = read("src/main/java/com/pucky/device/capabilities/PermissionReporter.java");
        String accessibility = read("src/main/java/com/pucky/device/accessibility/PuckyAccessibilityController.java");

        assertTrue(settings.contains("ACCESSIBILITY_LAB_ENABLED"));
        assertTrue(settings.contains("isAccessibilityLabEnabled()"));
        assertTrue(settings.contains("setAccessibilityLabEnabled(boolean enabled)"));
        assertTrue(capabilities.contains("\"control_surfaces\""));
        assertTrue(capabilities.contains("\"phone.role\""));
        assertTrue(capabilities.contains("\"phone.history\""));
        assertTrue(capabilities.contains("\"ui.a11y.stable\""));
        assertTrue(capabilities.contains("\"ui.a11y.lab\""));
        assertTrue(permissions.contains("\"phone.calls.decline\""));
        assertTrue(permissions.contains("\"phone.history.list\""));
        assertTrue(accessibility.contains("AccessibilitySurfacePolicy.requireLabEnabled(settingsStore.isAccessibilityLabEnabled())"));
    }

    @Test
    public void foregroundServiceWiresAccessibilityController() throws Exception {
        String source = read("src/main/java/com/pucky/device/service/PuckyForegroundService.java");
        assertTrue(source.contains("new PuckyAccessibilityController(this, settings)"));
    }

    @Test
    public void phoneRoleSurfaceExposesReversibleDialerManagementCopy() throws Exception {
        String controller = read("src/main/java/com/pucky/device/phone/PhoneRoleController.java");
        String hub = read("src/main/java/com/pucky/device/phone/PhoneHubActivity.java");

        assertTrue(controller.contains("default_dialer_label"));
        assertTrue(controller.contains("stock_incall_ui_replaced_when_held"));
        assertTrue(controller.contains("openDefaultAppsSettings(Context context)"));
        assertTrue(hub.contains("Enable Pucky dialer mode"));
        assertTrue(hub.contains("Restore stock phone app"));
        assertTrue(hub.contains("stock incoming-call UX may be replaced"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }
}
