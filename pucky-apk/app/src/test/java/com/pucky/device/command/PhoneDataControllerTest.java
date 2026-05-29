package com.pucky.device.command;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class PhoneDataControllerTest {
    @Test
    public void normalizesSmsRows() throws Exception {
        JSONArray rows = new JSONArray();
        rows.put(new JSONObject()
                .put("_id", 11)
                .put("thread_id", 7)
                .put("address", "+1 (407) 496-9882")
                .put("date", 123456789L)
                .put("type", 2)
                .put("read", 1)
                .put("seen", 0)
                .put("status", 64)
                .put("creator", "com.pucky")
                .put("body", "hello"));

        JSONArray normalized = PhoneDataController.normalizeSmsRows(rows);
        JSONObject first = normalized.getJSONObject(0);

        assertEquals("11", first.getString("message_id"));
        assertEquals("7", first.getString("thread_id"));
        assertEquals("+1 (407) 496-9882", first.getString("address"));
        assertEquals(123456789L, first.getLong("timestamp_ms"));
        assertEquals("outbound", first.getString("direction"));
        assertTrue(first.getBoolean("read"));
        assertEquals("64", first.getString("status"));
        assertEquals("hello", first.getString("body"));
    }

    @Test
    public void filtersSmsRowsByNormalizedAddress() throws Exception {
        JSONArray rows = new JSONArray();
        rows.put(new JSONObject().put("address", "+14074969882").put("body", "match one"));
        rows.put(new JSONObject().put("address", "407-496-9882").put("body", "match two"));
        rows.put(new JSONObject().put("address", "5551234567").put("body", "miss"));

        JSONArray filtered = PhoneDataController.filterSmsRowsByAddress(rows, "+1 (407) 496-9882", 10);

        assertEquals(2, filtered.length());
        assertEquals("match one", filtered.getJSONObject(0).getString("body"));
        assertEquals("match two", filtered.getJSONObject(1).getString("body"));
        assertEquals("+14074969882", PhoneDataController.normalizeDigits("+1 (407) 496-9882"));
    }

    @Test
    public void normalizesCallRows() throws Exception {
        JSONArray rows = new JSONArray();
        rows.put(new JSONObject()
                .put("_id", 5)
                .put("number", "+14074969882")
                .put("formatted_number", "(407) 496-9882")
                .put("date", 42L)
                .put("type", 4)
                .put("duration", 17L)
                .put("new", 1)
                .put("is_read", 0)
                .put("name", "Jimmy")
                .put("voicemail_uri", "content://voicemail/5")
                .put("transcription", "test mail"));

        JSONArray normalized = PhoneDataController.normalizeCallRows(rows);
        JSONObject first = normalized.getJSONObject(0);

        assertEquals("5", first.getString("call_id"));
        assertEquals("voicemail", first.getString("type"));
        assertEquals(17L, first.getLong("duration_s"));
        assertTrue(first.getBoolean("new"));
        assertEquals("Jimmy", first.getString("name"));
        assertEquals("content://voicemail/5", first.getString("voicemail_uri"));
    }

    @Test
    public void sourceWiresPhoneCommandsAndCapabilities() throws Exception {
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String service = read("src/main/java/com/pucky/device/service/PuckyForegroundService.java");
        String capability = read("src/main/java/com/pucky/device/capabilities/CapabilityReporter.java");
        String permission = read("src/main/java/com/pucky/device/capabilities/PermissionReporter.java");

        assertTrue(executor.contains("\"phone.telephony.status\""));
        assertTrue(executor.contains("\"phone.sms.list\""));
        assertTrue(executor.contains("\"phone.sms.get_thread\""));
        assertTrue(executor.contains("\"phone.sms.send\""));
        assertTrue(executor.contains("\"phone.calls.list\""));
        assertTrue(executor.contains("\"phone.calls.place\""));
        assertTrue(executor.contains("\"phone.calls.hangup\""));
        assertTrue(executor.contains("\"phone.contacts.search\""));
        assertTrue(executor.contains("\"phone.contacts.get\""));
        assertTrue(executor.contains("\"phone.contacts.create\""));
        assertTrue(executor.contains("\"phone.contacts.replace\""));
        assertTrue(executor.contains("\"phone.contacts.delete\""));
        assertTrue(executor.contains("\"phone.voicemail.list\""));
        assertTrue(executor.contains("\"phone.blocked_numbers.list\""));
        assertTrue(executor.contains("\"phone.blocked_numbers.add\""));
        assertTrue(executor.contains("\"phone.blocked_numbers.remove\""));
        assertTrue(executor.contains("return phoneDataController.telephonyStatus()"));
        assertTrue(executor.contains("return phoneDataController.smsList(command.args())"));
        assertTrue(executor.contains("return phoneDataController.callsPlace(command.args())"));
        assertTrue(executor.contains("return phoneDataController.contactsReplace(command.args())"));
        assertTrue(executor.contains("return phoneDataController.blockedNumbersRemove(command.args())"));

        assertTrue(service.contains("AndroidSubstrateController substrateController = new AndroidSubstrateController(this);"));
        assertTrue(service.contains("new PhoneDataController(this, settings, substrateController)"));

        assertTrue(capability.contains("phone.telephony.status"));
        assertTrue(capability.contains("phone.sms.list/phone.sms.get_thread/phone.sms.send"));
        assertTrue(capability.contains("phone.calls.list/phone.calls.place/phone.calls.hangup"));
        assertTrue(capability.contains("phone.contacts.search/phone.contacts.get/phone.contacts.create/phone.contacts.replace/phone.contacts.delete"));
        assertTrue(capability.contains("phone.voicemail.list"));
        assertTrue(capability.contains("phone.blocked_numbers.list/phone.blocked_numbers.add/phone.blocked_numbers.remove"));

        assertTrue(permission.contains("phone.sms.list"));
        assertTrue(permission.contains("phone.sms.send"));
        assertTrue(permission.contains("phone.calls.place"));
        assertTrue(permission.contains("phone.calls.hangup"));
        assertTrue(permission.contains("phone.telephony.status"));
        assertTrue(permission.contains("phone.calls.list"));
        assertTrue(permission.contains("phone.contacts.search"));
        assertTrue(permission.contains("phone.contacts.create"));
        assertTrue(permission.contains("phone.voicemail.list"));
        assertTrue(permission.contains("phone.blocked_numbers.list"));
        assertTrue(permission.contains("phone.blocked_numbers.remove"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8).replace("\r\n", "\n");
    }
}
