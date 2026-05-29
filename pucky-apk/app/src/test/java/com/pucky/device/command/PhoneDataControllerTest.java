package com.pucky.device.command;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
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
    public void mergesNotificationRepliesIntoSmsThreadsWithoutDuplicates() throws Exception {
        JSONArray provider = new JSONArray();
        provider.put(new JSONObject()
                .put("_id", 101)
                .put("thread_id", 1)
                .put("address", "+14074969882")
                .put("date", 1000L)
                .put("type", 2)
                .put("body", "hey there"));

        JSONArray notifications = new JSONArray();
        notifications.put(new JSONObject()
                .put("message_id", "2001")
                .put("thread_id", "notify:+14074969882")
                .put("address", "407-496-9882")
                .put("timestamp_ms", 2000L)
                .put("direction", "inbound")
                .put("body", "normal human reply")
                .put("source", "notification_listener")
                .put("source_package", "com.google.android.apps.messaging"));
        notifications.put(new JSONObject()
                .put("message_id", "2002")
                .put("thread_id", "notify:+14074969882")
                .put("address", "+1 (407) 496-9882")
                .put("timestamp_ms", 2005L)
                .put("direction", "inbound")
                .put("body", "normal human reply")
                .put("source", "notification_listener")
                .put("source_package", "com.google.android.apps.messaging"));

        JSONArray merged = PhoneDataController.mergeSmsRows(provider, notifications, 10);

        assertEquals(2, merged.length());
        assertEquals("notification_listener", merged.getJSONObject(0).getString("source"));
        assertEquals("normal human reply", merged.getJSONObject(0).getString("body"));
        assertEquals("sms_provider", merged.getJSONObject(1).getString("source"));
        assertEquals("hey there", merged.getJSONObject(1).getString("body"));
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
    public void helperMappingsHandleDirectionsCallTypesAndPhoneEquivalence() {
        assertEquals("inbound", PhoneDataController.smsDirectionForType(1));
        assertEquals("outbound", PhoneDataController.smsDirectionForType(2));
        assertEquals("draft", PhoneDataController.smsDirectionForType(3));
        assertEquals("unknown", PhoneDataController.smsDirectionForType(99));

        assertEquals("incoming", PhoneDataController.callTypeFor(1));
        assertEquals("outgoing", PhoneDataController.callTypeFor(2));
        assertEquals("missed", PhoneDataController.callTypeFor(3));
        assertEquals("voicemail", PhoneDataController.callTypeFor(4));
        assertEquals("blocked", PhoneDataController.callTypeFor(6));
        assertEquals("answered_externally", PhoneDataController.callTypeFor(7));
        assertEquals("unknown", PhoneDataController.callTypeFor(99));

        String userNumber = PhoneDataController.normalizeDigits("+1 (407) 496-9882");
        String localFormat = PhoneDataController.normalizeDigits("407-496-9882");
        String differentNumber = PhoneDataController.normalizeDigits("555-123-4567");

        assertEquals("+14074969882", userNumber);
        assertEquals("4074969882", localFormat);
        assertTrue(PhoneDataController.numbersEquivalent(userNumber, localFormat));
        assertFalse(PhoneDataController.numbersEquivalent(localFormat, differentNumber));
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
        assertTrue(executor.contains("\"phone.calls.state\""));
        assertTrue(executor.contains("\"phone.calls.place\""));
        assertTrue(executor.contains("\"phone.calls.answer\""));
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
        assertTrue(executor.contains("\"notify.listener.status\""));
        assertTrue(executor.contains("\"notify.listener.messages\""));
        assertTrue(executor.contains("return phoneDataController.telephonyStatus()"));
        assertTrue(executor.contains("return phoneDataController.smsList(command.args())"));
        assertTrue(executor.contains("return phoneDataController.callsState(command.args())"));
        assertTrue(executor.contains("return phoneDataController.callsPlace(command.args())"));
        assertTrue(executor.contains("return phoneDataController.callsAnswer(command.args())"));
        assertTrue(executor.contains("return phoneDataController.contactsReplace(command.args())"));
        assertTrue(executor.contains("return phoneDataController.blockedNumbersRemove(command.args())"));
        assertTrue(executor.contains("return notificationController.listenerStatus(command.args())"));
        assertTrue(executor.contains("return notificationController.listenerMessages(command.args())"));

        assertTrue(service.contains("AndroidSubstrateController substrateController = new AndroidSubstrateController(this);"));
        assertTrue(service.contains("new PhoneDataController(this, settings, substrateController)"));

        assertTrue(capability.contains("phone.telephony.status"));
        assertTrue(capability.contains("phone.sms.list/phone.sms.get_thread/phone.sms.send"));
        assertTrue(capability.contains("phone.calls.list/phone.calls.state/phone.calls.place/phone.calls.answer/phone.calls.hangup"));
        assertTrue(capability.contains("phone.contacts.search/phone.contacts.get/phone.contacts.create/phone.contacts.replace/phone.contacts.delete"));
        assertTrue(capability.contains("phone.voicemail.list"));
        assertTrue(capability.contains("phone.blocked_numbers.list/phone.blocked_numbers.add/phone.blocked_numbers.remove"));
        assertTrue(capability.contains("notify.listener.status/notify.listener.messages"));
        assertTrue(capability.contains("normal inbound replies"));

        assertTrue(permission.contains("phone.sms.list"));
        assertTrue(permission.contains("phone.sms.send"));
        assertTrue(permission.contains("phone.calls.place"));
        assertTrue(permission.contains("phone.calls.answer"));
        assertTrue(permission.contains("phone.calls.hangup"));
        assertTrue(permission.contains("phone.calls.state"));
        assertTrue(permission.contains("phone.telephony.status"));
        assertTrue(permission.contains("phone.calls.list"));
        assertTrue(permission.contains("phone.contacts.search"));
        assertTrue(permission.contains("phone.contacts.create"));
        assertTrue(permission.contains("phone.voicemail.list"));
        assertTrue(permission.contains("phone.blocked_numbers.list"));
        assertTrue(permission.contains("phone.blocked_numbers.remove"));
    }

    @Test
    public void sourceCapturesFailureAndReadinessPaths() throws Exception {
        String controller = read("src/main/java/com/pucky/device/command/PhoneDataController.java");
        String substrate = read("src/main/java/com/pucky/device/substrate/AndroidSubstrateController.java");

        assertTrue(controller.contains("pucky.phone_telephony_status.v1"));
        assertTrue(controller.contains("Json.put(out, \"roles\", permissions.optJSONObject(\"roles\"))"));
        assertTrue(controller.contains("Json.put(out, \"readiness\", readinessSummary(catalog.optJSONArray(\"surfaces\")))"));
        assertTrue(controller.contains("Json.put(out, \"notification_listener\", PuckyNotificationLedger.status(context))"));
        assertTrue(controller.contains("phone.sms.send requires to and body"));
        assertTrue(controller.contains("phone.calls.place requires number"));
        assertTrue(controller.contains("pucky.phone_calls_state.v1"));
        assertTrue(controller.contains("pucky.phone_call_answer.v1"));
        assertTrue(controller.contains("include_notifications"));
        assertTrue(controller.contains("normalizeSmsRows(PuckyNotificationLedger.smsRows("));
        assertTrue(controller.contains("normalizeSmsRows(PuckyNotificationLedger.smsRowsForAddress("));
        assertTrue(controller.contains("mergeSmsRows(providerRows, notificationRows"));
        assertTrue(controller.contains("notification_listener"));
        assertTrue(controller.contains("phone.contacts.create requires display_name"));
        assertTrue(controller.contains("phone.contacts.replace requires display_name"));
        assertTrue(controller.contains("Missing required field: "));
        assertTrue(controller.contains("Invalid long for "));
        assertTrue(controller.contains("before_timestamp_ms"));
        assertTrue(controller.contains("before_id"));
        assertTrue(controller.contains("historyQueryArgs("));
        assertTrue(controller.contains("requireSurfaceReady(catalog, \"voicemail\")"));
        assertTrue(controller.contains("requireSurfaceReady(catalog, \"blocked_numbers\")"));
        assertTrue(controller.contains("Role required for surface: "));
        assertTrue(controller.contains("Surface not ready: "));
        assertTrue(controller.contains("content://com.android.blockednumber/blocked"));
        assertTrue(controller.contains("com.android.voicemail.permission.READ_VOICEMAIL"));
        assertTrue(controller.contains("android.permission.READ_BLOCKED_NUMBERS"));
        assertTrue(controller.contains("android.permission.WRITE_BLOCKED_NUMBERS"));
        assertTrue(controller.contains("ContactsContract.CommonDataKinds.Email.CONTENT_URI"));
        assertTrue(controller.contains("ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER"));

        assertTrue(substrate.contains("send_sms requires to and body"));
        assertTrue(substrate.contains("place_call requires number"));
        assertTrue(substrate.contains("Emergency-like numbers are blocked"));
        assertTrue(substrate.contains("answer_ringing"));
        assertTrue(substrate.contains("call_state"));
    }

    @Test
    public void manifestAndCallSourcesExposeDialerQualification() throws Exception {
        String manifest = read("src/main/AndroidManifest.xml");
        String dialer = read("src/main/java/com/pucky/device/calls/PuckyDialerActivity.java");
        String inCall = read("src/main/java/com/pucky/device/calls/PuckyInCallService.java");
        String store = read("src/main/java/com/pucky/device/calls/PuckyCallStateStore.java");
        String notifications = read("src/main/java/com/pucky/device/notifications/PuckyNotificationListenerService.java");
        String ledger = read("src/main/java/com/pucky/device/notifications/PuckyNotificationLedger.java");

        assertTrue(manifest.contains("com.pucky.device.calls.PuckyDialerActivity") || manifest.contains(".calls.PuckyDialerActivity"));
        assertTrue(manifest.contains("android.intent.action.DIAL"));
        assertTrue(manifest.split("android.intent.action.DIAL", -1).length >= 3);
        assertTrue(manifest.contains("android:scheme=\"tel\""));
        assertTrue(manifest.contains("android.permission.BIND_INCALL_SERVICE"));
        assertTrue(manifest.contains("android.telecom.InCallService"));
        assertTrue(manifest.contains("android.telecom.IN_CALL_SERVICE_UI"));
        assertTrue(manifest.contains("android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"));
        assertTrue(manifest.contains("android.service.notification.NotificationListenerService"));

        assertTrue(dialer.contains("setTitle(\"Pucky Dialer\")"));
        assertTrue(dialer.contains("telecom.placeCall(Uri.fromParts(\"tel\", number, null), new Bundle())"));
        assertTrue(dialer.contains("PuckyCallStateStore.answerRinging(this)"));

        assertTrue(inCall.contains("extends InCallService"));
        assertTrue(inCall.contains("PuckyCallStateStore.onCallAdded(this, call)"));
        assertTrue(inCall.contains("PuckyCallStateStore.onBringToForeground(this, showDialpad)"));

        assertTrue(store.contains("call.answer(VideoProfile.STATE_AUDIO_ONLY)"));
        assertTrue(store.contains("\"overall_state\""));
        assertTrue(store.contains("\"default_dialer_held\""));

        assertTrue(notifications.contains("extends NotificationListenerService"));
        assertTrue(notifications.contains("PuckyNotificationLedger.onNotificationPosted(this, notification)"));

        assertTrue(ledger.contains("pucky.notification_listener_status.v1"));
        assertTrue(ledger.contains("pucky.notification_listener_messages.v1"));
        assertTrue(ledger.contains("com.google.android.apps.messaging"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8).replace("\r\n", "\n");
    }
}
