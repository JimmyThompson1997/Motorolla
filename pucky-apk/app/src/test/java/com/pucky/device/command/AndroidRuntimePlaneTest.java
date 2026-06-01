package com.pucky.device.command;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class AndroidRuntimePlaneTest {
    private static final String[] ANDROID_COMMANDS = new String[] {
            "android.catalog",
            "android.intent.start",
            "android.manager.call",
            "android.permission.status",
            "android.permission.request",
            "android.sms.list",
            "android.sms.thread",
            "android.sms.send",
            "android.calls.list",
            "android.calls.state",
            "android.calls.place",
            "android.calls.answer",
            "android.calls.hangup",
            "android.contacts.search",
            "android.contacts.get",
            "android.contacts.create",
            "android.contacts.replace",
            "android.contacts.delete",
            "android.contacts.photo.get",
            "android.contacts.photo.put",
            "android.voicemail.list",
            "android.blocked_numbers.list",
            "android.blocked_numbers.add",
            "android.blocked_numbers.remove",
            "android.calendar.list",
            "android.calendar.get",
            "android.calendar.create",
            "android.calendar.update",
            "android.calendar.delete",
            "android.clock.alarm.set",
            "android.clock.timer.set",
            "android.clock.alarms.show",
            "android.settings.get",
            "android.settings.put",
            "android.settings.open",
            "android.media.images.list",
            "android.media.video.list",
            "android.media.audio.list",
            "android.downloads.list",
            "android.downloads.get",
            "android.user_dictionary.list",
            "android.user_dictionary.add",
            "android.user_dictionary.delete",
            "android.notifications.listener.status",
            "android.notifications.listener.messages"
    };

    @Test
    public void catalogAndExecutorExposeAndroidRuntimePlane() throws Exception {
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String runtime = read("src/main/java/com/pucky/device/command/AndroidRuntimeController.java");

        for (String command : ANDROID_COMMANDS) {
            assertTrue("catalog missing " + command, executor.contains("\"" + command + "\""));
            assertTrue("runtime dispatch missing " + command, runtime.contains("case \"" + command + "\""));
        }

        assertTrue(executor.contains("type.startsWith(\"android.\") && !\"android.substrate\".equals(type)"));
        assertTrue(executor.contains("return androidRuntimeController.execute(type, command.args())"));
        assertTrue(executor.contains("\"android.substrate\""));
        assertTrue(executor.contains("return androidSubstrateController.execute(command.args())"));
    }

    @Test
    public void commandCatalogInventoryIsExactAndUnduplicated() throws Exception {
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        List<String> commands = commandNames(executor);

        assertEquals(242, commands.size());
        assertEquals(commands.size(), new HashSet<>(commands).size());
        assertFalse(commands.contains("shell.exec"));
        assertFalse(commands.contains("android.content.query"));
        assertFalse(commands.contains("android.content.insert"));
        assertFalse(commands.contains("android.content.update"));
        assertFalse(commands.contains("android.content.delete"));
        assertFalse(commands.contains("android.content.call"));
        assertFalse(commands.contains("android.content.get_type"));
        assertTrue(commands.contains("ui.debug.goto_home"));
        assertTrue(commands.contains("ui.debug.back"));
        assertTrue(commands.contains("ui.debug.focus_card"));
        assertTrue(commands.contains("ui.debug.clear_focus"));
        assertTrue(commands.contains("ui.debug.refresh_cards"));
        assertTrue(commands.contains("ui.debug.open_card_action"));
        assertTrue(commands.contains("meeting.hover.status"));
        assertTrue(commands.contains("meeting.hover.config.set"));
        assertTrue(commands.contains("android.substrate"));
    }

    @Test
    public void runtimeAliasesUseExistingThinControllers() throws Exception {
        String runtime = read("src/main/java/com/pucky/device/command/AndroidRuntimeController.java");
        String phone = read("src/main/java/com/pucky/device/command/PhoneDataController.java");
        String ledger = read("src/main/java/com/pucky/device/notifications/PuckyNotificationLedger.java");

        assertTrue(runtime.contains("return substrateOp(args, \"intent.start\")"));
        assertTrue(runtime.contains("return substrateOp(args, \"manager.call\")"));
        assertTrue(runtime.contains("return substrateController.executeTrusted(payload)"));
        assertTrue(runtime.contains("return phoneDataController.smsList(requireLimit(args, command))"));
        assertTrue(runtime.contains("return phoneDataController.callsAnswer(args)"));
        assertTrue(runtime.contains("return phoneDataController.contactsPhotoGet(args)"));
        assertTrue(runtime.contains("return notificationController.listenerMessages(requireLimit(args, command))"));
        assertTrue(runtime.contains("User dictionary insert returned no URI"));

        assertTrue(runtime.contains("HIGH_LIMIT_FUSE = 5000"));
        assertTrue(runtime.contains("requires explicit limit"));
        assertTrue(phone.contains("DEFAULT_LIMIT = 5000"));
        assertTrue(phone.contains("MAX_LIMIT = 5000"));
        assertTrue(phone.contains("contactPhotoDataBytes(contactId)"));
        assertTrue(phone.contains("Contact photo write did not persist"));
        assertTrue(phone.contains("\"bytes_readback\""));
        assertTrue(phone.contains("ContactsContract.Data.IS_SUPER_PRIMARY"));
        assertTrue(ledger.contains("DEFAULT_LIMIT = 5000"));
        assertTrue(ledger.contains("MAX_RECENT_MESSAGES = 5000"));
    }

    @Test
    public void androidSubstrateDropsEmailPlaceholder() throws Exception {
        String substrate = read("src/main/java/com/pucky/device/substrate/AndroidSubstrateController.java");
        int surfacesStart = substrate.indexOf("private JSONArray surfaces()");
        int surfacesEnd = substrate.indexOf("private JSONObject surface(", surfacesStart);
        String surfaces = substrate.substring(surfacesStart, surfacesEnd);

        assertFalse(surfaces.contains("\"email\""));
        assertFalse(surfaces.contains("gmail/oauth"));
        assertFalse(surfaces.contains("imap/oauth"));
        assertTrue(surfaces.contains("\"notifications\""));
        assertTrue(surfaces.contains("\"calendar\""));
        assertTrue(surfaces.contains("\"blocked_numbers\""));
    }

    @Test
    public void rawContentProviderCommandsStayInternalToNamedControllers() throws Exception {
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String runtime = read("src/main/java/com/pucky/device/command/AndroidRuntimeController.java");
        String substrate = read("src/main/java/com/pucky/device/substrate/AndroidSubstrateController.java");

        assertFalse(executor.contains("\"android.content.query\""));
        assertFalse(runtime.contains("case \"android.content.query\""));
        assertTrue(substrate.contains("public JSONObject executeTrusted(JSONObject args)"));
        assertTrue(substrate.contains("Raw content-provider op is not exposed"));
        assertTrue(runtime.contains("return substrateController.executeTrusted(payload)"));
    }

    @Test
    public void capabilitiesAndPermissionsPreferAndroidNamespace() throws Exception {
        String capability = read("src/main/java/com/pucky/device/capabilities/CapabilityReporter.java");
        String permission = read("src/main/java/com/pucky/device/capabilities/PermissionReporter.java");

        assertTrue(capability.contains("android.runtime_plane"));
        assertTrue(capability.contains("android.native_families"));
        assertTrue(capability.contains("android.sms.*"));
        assertTrue(capability.contains("android.contacts.photo.get/android.contacts.photo.put"));
        assertTrue(capability.contains("Existing phone.*, notify.listener.*, and intent convenience commands remain aliases"));

        assertTrue(permission.contains("android.sms.list"));
        assertTrue(permission.contains("android.calls.answer"));
        assertTrue(permission.contains("android.contacts.photo.put"));
        assertTrue(permission.contains("android.calendar.create"));
        assertTrue(permission.contains("android.media.images.list"));
        assertTrue(permission.contains("android.user_dictionary.add"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8).replace("\r\n", "\n");
    }

    private static List<String> commandNames(String executor) {
        int start = executor.indexOf("private static final String[] COMMANDS = new String[] {");
        int end = executor.indexOf("\n    };", start);
        String block = executor.substring(start, end);
        Matcher matcher = Pattern.compile("\"([^\"]+)\"").matcher(block);
        List<String> commands = new ArrayList<>();
        while (matcher.find()) {
            commands.add(matcher.group(1));
        }
        return commands;
    }
}
