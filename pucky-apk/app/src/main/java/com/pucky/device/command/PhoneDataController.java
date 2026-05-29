package com.pucky.device.command;

import android.Manifest;
import android.content.ContentProviderOperation;
import android.content.ContentProviderResult;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import com.pucky.device.status.AppIdentity;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.substrate.AndroidSubstrateController;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;

public final class PhoneDataController {
    private static final String VOICEMAIL_READ = "com.android.voicemail.permission.READ_VOICEMAIL";
    private static final String READ_BLOCKED_NUMBERS = "android.permission.READ_BLOCKED_NUMBERS";
    private static final String WRITE_BLOCKED_NUMBERS = "android.permission.WRITE_BLOCKED_NUMBERS";
    private static final int DEFAULT_LIMIT = 25;
    private static final int MAX_LIMIT = 200;

    private final Context context;
    private final SettingsStore settingsStore;
    private final AndroidSubstrateController substrateController;
    private final ContentResolver resolver;

    private interface JsonOp {
        JSONObject run() throws Exception;
    }

    public PhoneDataController(Context context, SettingsStore settingsStore, AndroidSubstrateController substrateController) {
        this.context = context.getApplicationContext();
        this.settingsStore = settingsStore;
        this.substrateController = substrateController;
        this.resolver = this.context.getContentResolver();
    }

    public JSONObject telephonyStatus() throws CommandException {
        return safe(() -> {
            JSONObject catalog = substrate(new JSONObject().put("op", "catalog"));
            JSONObject permissions = substrate(new JSONObject().put("op", "permission.status"));
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_telephony_status.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "device_id", settingsStore.getDeviceId());
            Json.put(out, "broker_url", settingsStore.getBrokerUrl());
            Json.put(out, "apk_identity", AppIdentity.json(context));
            Json.put(out, "permissions", permissions.optJSONArray("permissions"));
            Json.put(out, "roles", permissions.optJSONObject("roles"));
            Json.put(out, "surfaces", catalog.optJSONArray("surfaces"));
            Json.put(out, "readiness", readinessSummary(catalog.optJSONArray("surfaces")));
            return out;
        });
    }

    public JSONObject smsList(JSONObject args) throws CommandException {
        return safe(() -> {
            int limit = boundedLimit(args);
            JSONObject result = substrate(historyQueryArgs(
                    "content://sms",
                    array("_id", "thread_id", "address", "date", "type", "read", "seen", "status", "creator", "body"),
                    null,
                    null,
                    "date DESC, _id DESC",
                    limit,
                    args));
            JSONArray rows = normalizeSmsRows(result.optJSONArray("rows"));
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_sms_list.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "rows", rows);
            Json.put(out, "count", rows.length());
            Json.put(out, "truncated", result.optBoolean("truncated", false));
            return out;
        });
    }

    public JSONObject smsGetThread(JSONObject args) throws CommandException {
        return safe(() -> {
            int limit = boundedLimit(args);
            String threadId = trimmed(args, "thread_id");
            String address = trimmed(args, "address");
            if (threadId.isEmpty() && address.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "phone.sms.get_thread requires thread_id or address");
            }

            JSONArray threadWhereArgs = threadId.isEmpty() ? null : array(threadId);
            int scanLimit = address.isEmpty()
                    ? Math.min(MAX_LIMIT, Math.max(limit, 50))
                    : Math.min(MAX_LIMIT, Math.max(limit * 8, 50));
            JSONObject query = historyQueryArgs(
                    "content://sms",
                    array("_id", "thread_id", "address", "date", "type", "read", "seen", "status", "creator", "body"),
                    threadId.isEmpty() ? null : "thread_id = ?",
                    threadWhereArgs,
                    "date DESC, _id DESC",
                    scanLimit,
                    args);
            JSONArray rows = normalizeSmsRows(substrate(query).optJSONArray("rows"));
            if (!address.isEmpty()) {
                rows = filterSmsRowsByAddress(rows, address, limit);
            } else if (rows.length() > limit) {
                rows = firstN(rows, limit);
            }

            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_sms_thread.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "thread_id", threadId.isEmpty() ? JSONObject.NULL : threadId);
            Json.put(out, "address", address.isEmpty() ? JSONObject.NULL : address);
            Json.put(out, "rows", rows);
            Json.put(out, "count", rows.length());
            return out;
        });
    }

    public JSONObject smsSend(JSONObject args) throws CommandException {
        return safe(() -> {
            String to = trimmed(args, "to");
            String body = args.optString("body", "");
            if (to.isEmpty() || body.trim().isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "phone.sms.send requires to and body");
            }
            JSONObject payload = new JSONObject();
            Json.put(payload, "op", "manager.call");
            Json.put(payload, "action", "send_sms");
            Json.put(payload, "to", to);
            Json.put(payload, "body", body);
            JSONObject raw = substrate(payload);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_sms_send.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "request_id", raw.optString("request_id", ""));
            Json.put(out, "queued", raw.optBoolean("queued", false));
            Json.put(out, "to", raw.opt("to"));
            Json.put(out, "body_chars", raw.optInt("body_chars", body.length()));
            return out;
        });
    }

    public JSONObject callsList(JSONObject args) throws CommandException {
        return safe(() -> {
            int limit = boundedLimit(args);
            JSONObject result = substrate(historyQueryArgs(
                    "content://call_log/calls",
                    array("_id", "number", "formatted_number", "date", "type", "duration", "new", "is_read", "name", "voicemail_uri", "transcription"),
                    null,
                    null,
                    "date DESC, _id DESC",
                    limit,
                    args));
            JSONArray rows = normalizeCallRows(result.optJSONArray("rows"));
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_calls_list.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "rows", rows);
            Json.put(out, "count", rows.length());
            Json.put(out, "truncated", result.optBoolean("truncated", false));
            return out;
        });
    }

    public JSONObject callsState(JSONObject args) throws CommandException {
        return safe(() -> {
            JSONObject payload = new JSONObject();
            Json.put(payload, "op", "manager.call");
            Json.put(payload, "action", "call_state");
            JSONObject raw = substrate(payload);
            JSONObject state = raw.optJSONObject("state");
            if (state == null) {
                state = new JSONObject();
            }
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_calls_state.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "overall_state", state.optString("overall_state", "idle"));
            Json.put(out, "has_ringing_call", state.optBoolean("has_ringing_call", false));
            Json.put(out, "has_ongoing_call", state.optBoolean("has_ongoing_call", false));
            Json.put(out, "tracked_call_count", state.optInt("tracked_call_count", 0));
            Json.put(out, "calls", state.optJSONArray("calls"));
            Json.put(out, "default_dialer_package", state.optString("default_dialer_package", ""));
            Json.put(out, "default_dialer_held", state.optBoolean("default_dialer_held", false));
            Json.put(out, "system_in_call", state.optBoolean("system_in_call", false));
            Json.put(out, "system_in_managed_call", state.optBoolean("system_in_managed_call", false));
            return out;
        });
    }

    public JSONObject callsPlace(JSONObject args) throws CommandException {
        return safe(() -> {
            String number = trimmed(args, "number");
            if (number.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "phone.calls.place requires number");
            }
            JSONObject payload = new JSONObject();
            Json.put(payload, "op", "manager.call");
            Json.put(payload, "action", "place_call");
            Json.put(payload, "number", number);
            JSONObject raw = substrate(payload);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_call_place.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "requested", raw.optBoolean("requested", false));
            Json.put(out, "number", raw.opt("number"));
            return out;
        });
    }

    public JSONObject callsAnswer(JSONObject args) throws CommandException {
        return safe(() -> {
            JSONObject payload = new JSONObject();
            Json.put(payload, "op", "manager.call");
            Json.put(payload, "action", "answer_ringing");
            JSONObject raw = substrate(payload);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_call_answer.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "answered", raw.optBoolean("answered", false));
            Json.put(out, "call_key", raw.opt("call_key"));
            Json.put(out, "state", raw.opt("state"));
            Json.put(out, "reason", raw.opt("reason"));
            Json.put(out, "number", raw.opt("number"));
            return out;
        });
    }

    public JSONObject callsHangup(JSONObject args) throws CommandException {
        return safe(() -> {
            JSONObject payload = new JSONObject();
            Json.put(payload, "op", "manager.call");
            Json.put(payload, "action", "hangup_active");
            JSONObject raw = substrate(payload);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_call_hangup.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "ended", raw.optBoolean("ended", false));
            return out;
        });
    }

    public JSONObject contactsSearch(JSONObject args) throws CommandException {
        return safe(() -> {
            requirePermission(Manifest.permission.READ_CONTACTS);
            String query = args.optString("query", "").trim();
            int limit = boundedLimit(args);
            LinkedHashSet<Long> contactIds = new LinkedHashSet<>();
            if (query.isEmpty()) {
                collectContactIds(
                        ContactsContract.Contacts.CONTENT_URI,
                        new String[] { ContactsContract.Contacts._ID },
                        null,
                        null,
                        ContactsContract.Contacts.DISPLAY_NAME_PRIMARY + " COLLATE NOCASE ASC",
                        contactIds,
                        limit);
            } else {
                String like = "%" + query + "%";
                collectContactIds(
                        ContactsContract.Contacts.CONTENT_URI,
                        new String[] { ContactsContract.Contacts._ID },
                        ContactsContract.Contacts.DISPLAY_NAME_PRIMARY + " LIKE ? OR " + ContactsContract.Contacts.DISPLAY_NAME + " LIKE ?",
                        new String[] { like, like },
                        ContactsContract.Contacts.DISPLAY_NAME_PRIMARY + " COLLATE NOCASE ASC",
                        contactIds,
                        limit);
                String digits = normalizeDigits(query);
                if (!digits.isEmpty()) {
                    String digitsLike = "%" + digits + "%";
                    collectContactIds(
                            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                            new String[] { ContactsContract.CommonDataKinds.Phone.CONTACT_ID },
                            ContactsContract.CommonDataKinds.Phone.NUMBER + " LIKE ? OR "
                                    + ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER + " LIKE ?",
                            new String[] { digitsLike, digitsLike },
                            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY + " COLLATE NOCASE ASC",
                            contactIds,
                            limit);
                }
                collectContactIds(
                        ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                        new String[] { ContactsContract.CommonDataKinds.Email.CONTACT_ID },
                        ContactsContract.CommonDataKinds.Email.ADDRESS + " LIKE ?",
                        new String[] { like },
                        ContactsContract.CommonDataKinds.Email.ADDRESS + " COLLATE NOCASE ASC",
                        contactIds,
                        limit);
            }

            JSONArray matches = new JSONArray();
            for (Long contactId : contactIds) {
                if (matches.length() >= limit) {
                    break;
                }
                JSONObject contact = readContact(contactId);
                if (contact != null) {
                    Json.add(matches, contact);
                }
            }

            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_contacts_search.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "query", query);
            Json.put(out, "matches", matches);
            Json.put(out, "count", matches.length());
            return out;
        });
    }

    public JSONObject contactsGet(JSONObject args) throws CommandException {
        return safe(() -> {
            requirePermission(Manifest.permission.READ_CONTACTS);
            long contactId = requiredLong(args, "contact_id");
            JSONObject contact = readContact(contactId);
            if (contact == null) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Contact not found: " + contactId);
            }
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_contact_get.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "contact", contact);
            return out;
        });
    }

    public JSONObject contactsCreate(JSONObject args) throws CommandException {
        return safe(() -> {
            requirePermission(Manifest.permission.WRITE_CONTACTS);
            String displayName = args.optString("display_name", "").trim();
            if (displayName.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "phone.contacts.create requires display_name");
            }

            ArrayList<ContentProviderOperation> operations = new ArrayList<>();
            operations.add(ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
                    .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, null)
                    .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, null)
                    .build());
            addStructuredNameInsert(operations, 0, displayName);
            addPhoneInserts(operations, 0, args.optJSONArray("phones"));
            addEmailInserts(operations, 0, args.optJSONArray("emails"));

            ContentProviderResult[] results = resolver.applyBatch(ContactsContract.AUTHORITY, operations);
            long rawContactId = idFromUri(results[0].uri);
            long contactId = resolveContactIdForRawContact(rawContactId);
            JSONObject contact = readContact(contactId);

            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_contact_create.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "contact", contact);
            return out;
        });
    }

    public JSONObject contactsReplace(JSONObject args) throws CommandException {
        return safe(() -> {
            requirePermission(Manifest.permission.WRITE_CONTACTS);
            long contactId = requiredLong(args, "contact_id");
            String displayName = args.optString("display_name", "").trim();
            if (displayName.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "phone.contacts.replace requires display_name");
            }
            long rawContactId = firstRawContactId(contactId);
            if (rawContactId <= 0L) {
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Contact not found: " + contactId);
            }

            ArrayList<ContentProviderOperation> operations = new ArrayList<>();
            operations.add(ContentProviderOperation.newDelete(ContactsContract.Data.CONTENT_URI)
                    .withSelection(
                            ContactsContract.Data.RAW_CONTACT_ID + "=? AND "
                                    + ContactsContract.Data.MIMETYPE + " IN (?,?,?)",
                            new String[] {
                                    String.valueOf(rawContactId),
                                    ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE,
                                    ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE,
                                    ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE
                            })
                    .build());
            addStructuredNameInsert(operations, rawContactId, displayName);
            addPhoneInsertsForRawContact(operations, rawContactId, args.optJSONArray("phones"));
            addEmailInsertsForRawContact(operations, rawContactId, args.optJSONArray("emails"));
            resolver.applyBatch(ContactsContract.AUTHORITY, operations);

            JSONObject contact = readContact(contactId);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_contact_replace.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "contact", contact);
            return out;
        });
    }

    public JSONObject contactsDelete(JSONObject args) throws CommandException {
        return safe(() -> {
            requirePermission(Manifest.permission.WRITE_CONTACTS);
            long contactId = requiredLong(args, "contact_id");
            int deleted = resolver.delete(
                    ContactsContract.RawContacts.CONTENT_URI,
                    ContactsContract.RawContacts.CONTACT_ID + "=?",
                    new String[] { String.valueOf(contactId) });
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_contact_delete.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "contact_id", contactId);
            Json.put(out, "deleted", deleted > 0);
            Json.put(out, "raw_contact_rows_deleted", deleted);
            return out;
        });
    }

    public JSONObject voicemailList(JSONObject args) throws CommandException {
        return safe(() -> {
            JSONObject catalog = substrate(new JSONObject().put("op", "catalog"));
            requireSurfaceReady(catalog, "voicemail");
            int limit = boundedLimit(args);
            JSONObject query = queryArgs(
                    "content://call_log/calls",
                    array("_id", "number", "formatted_number", "date", "type", "duration", "new", "is_read", "name", "voicemail_uri", "transcription"),
                    "date DESC",
                    Math.min(MAX_LIMIT, Math.max(limit, 50)));
            JSONArray rawRows = substrate(query).optJSONArray("rows");
            JSONArray calls = normalizeCallRows(rawRows);
            JSONArray rows = new JSONArray();
            for (int i = 0; i < calls.length(); i++) {
                JSONObject row = calls.optJSONObject(i);
                if (row == null) {
                    continue;
                }
                String type = row.optString("type", "");
                String voicemailUri = row.optString("voicemail_uri", "");
                if ("voicemail".equals(type) || !voicemailUri.isEmpty()) {
                    Json.add(rows, row);
                }
                if (rows.length() >= limit) {
                    break;
                }
            }

            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_voicemail_list.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "rows", rows);
            Json.put(out, "count", rows.length());
            return out;
        });
    }

    public JSONObject blockedNumbersList(JSONObject args) throws CommandException {
        return safe(() -> {
            JSONObject catalog = substrate(new JSONObject().put("op", "catalog"));
            requireSurfaceReady(catalog, "blocked_numbers");
            int limit = boundedLimit(args);
            JSONObject result = substrate(queryArgs(
                    "content://com.android.blockednumber/blocked",
                    array("_id", "original_number", "e164_number"),
                    "_id DESC",
                    limit));
            JSONArray rows = new JSONArray();
            JSONArray sourceRows = result.optJSONArray("rows");
            for (int i = 0; i < sourceRows.length(); i++) {
                JSONObject row = sourceRows.optJSONObject(i);
                if (row == null) {
                    continue;
                }
                JSONObject normalized = new JSONObject();
                Json.put(normalized, "blocked_id", stringValue(row, "_id"));
                Json.put(normalized, "original_number", stringValue(row, "original_number"));
                Json.put(normalized, "e164_number", stringValue(row, "e164_number"));
                Json.add(rows, normalized);
            }
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_blocked_numbers_list.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "rows", rows);
            Json.put(out, "count", rows.length());
            return out;
        });
    }

    public JSONObject blockedNumbersAdd(JSONObject args) throws CommandException {
        return safe(() -> {
            JSONObject catalog = substrate(new JSONObject().put("op", "catalog"));
            requireSurfaceReady(catalog, "blocked_numbers");
            String number = trimmed(args, "number");
            if (number.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "phone.blocked_numbers.add requires number");
            }
            String normalized = normalizeDigits(number);
            if (normalized.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "phone.blocked_numbers.add requires a valid number");
            }
            JSONObject insert = new JSONObject();
            Json.put(insert, "op", "content.insert");
            Json.put(insert, "uri", "content://com.android.blockednumber/blocked");
            JSONObject values = new JSONObject();
            Json.put(values, "original_number", normalized);
            Json.put(values, "e164_number", normalized.startsWith("+") ? normalized : JSONObject.NULL);
            Json.put(insert, "values", values);
            JSONObject raw = substrate(insert);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_blocked_number_add.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "number", normalized);
            Json.put(out, "inserted_uri", raw.opt("inserted_uri"));
            return out;
        });
    }

    public JSONObject blockedNumbersRemove(JSONObject args) throws CommandException {
        return safe(() -> {
            JSONObject catalog = substrate(new JSONObject().put("op", "catalog"));
            requireSurfaceReady(catalog, "blocked_numbers");
            String number = trimmed(args, "number");
            if (number.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "phone.blocked_numbers.remove requires number");
            }
            String normalized = normalizeDigits(number);
            if (normalized.isEmpty()) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "phone.blocked_numbers.remove requires a valid number");
            }
            JSONObject del = new JSONObject();
            Json.put(del, "op", "content.delete");
            Json.put(del, "uri", "content://com.android.blockednumber/blocked");
            Json.put(del, "where", "original_number = ? OR e164_number = ?");
            Json.put(del, "where_args", array(normalized, normalized));
            JSONObject raw = substrate(del);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.phone_blocked_number_remove.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "number", normalized);
            Json.put(out, "deleted_count", raw.optInt("deleted_count", 0));
            return out;
        });
    }

    static JSONArray normalizeSmsRows(JSONArray rows) {
        JSONArray out = new JSONArray();
        if (rows == null) {
            return out;
        }
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null) {
                Json.add(out, normalizeSmsRow(row));
            }
        }
        return out;
    }

    static JSONObject normalizeSmsRow(JSONObject row) {
        JSONObject out = new JSONObject();
        Json.put(out, "message_id", stringValue(row, "_id"));
        Json.put(out, "thread_id", stringValue(row, "thread_id"));
        Json.put(out, "address", stringValue(row, "address"));
        Json.put(out, "body", stringValue(row, "body"));
        Json.put(out, "timestamp_ms", longValue(row, "date"));
        Json.put(out, "direction", smsDirectionForType(longValue(row, "type")));
        Json.put(out, "read", boolValue(row, "read"));
        Json.put(out, "seen", boolValue(row, "seen"));
        Json.put(out, "status", stringValue(row, "status"));
        Json.put(out, "creator", stringValue(row, "creator"));
        return out;
    }

    static JSONArray filterSmsRowsByAddress(JSONArray rows, String address, int limit) {
        JSONArray out = new JSONArray();
        String needle = normalizeDigits(address);
        for (int i = 0; i < rows.length(); i++) {
            if (out.length() >= Math.max(1, limit)) {
                break;
            }
            JSONObject row = rows.optJSONObject(i);
            if (row == null) {
                continue;
            }
            String candidate = normalizeDigits(row.optString("address", ""));
            if (!needle.isEmpty() && numbersEquivalent(needle, candidate)) {
                Json.add(out, row);
            }
        }
        return out;
    }

    static String smsDirectionForType(long type) {
        switch ((int) type) {
            case 1:
                return "inbound";
            case 2:
            case 4:
            case 5:
            case 6:
                return "outbound";
            case 3:
                return "draft";
            default:
                return "unknown";
        }
    }

    static JSONArray normalizeCallRows(JSONArray rows) {
        JSONArray out = new JSONArray();
        if (rows == null) {
            return out;
        }
        for (int i = 0; i < rows.length(); i++) {
            JSONObject row = rows.optJSONObject(i);
            if (row != null) {
                Json.add(out, normalizeCallRow(row));
            }
        }
        return out;
    }

    static JSONObject normalizeCallRow(JSONObject row) {
        JSONObject out = new JSONObject();
        Json.put(out, "call_id", stringValue(row, "_id"));
        Json.put(out, "number", stringValue(row, "number"));
        Json.put(out, "formatted_number", stringValue(row, "formatted_number"));
        Json.put(out, "name", stringValue(row, "name"));
        Json.put(out, "timestamp_ms", longValue(row, "date"));
        Json.put(out, "duration_s", longValue(row, "duration"));
        Json.put(out, "type", callTypeFor(longValue(row, "type")));
        Json.put(out, "is_read", boolValue(row, "is_read"));
        Json.put(out, "new", boolValue(row, "new"));
        Json.put(out, "voicemail_uri", stringValue(row, "voicemail_uri"));
        Json.put(out, "transcription", stringValue(row, "transcription"));
        return out;
    }

    static String callTypeFor(long type) {
        switch ((int) type) {
            case 1:
                return "incoming";
            case 2:
                return "outgoing";
            case 3:
                return "missed";
            case 4:
                return "voicemail";
            case 5:
                return "rejected";
            case 6:
                return "blocked";
            case 7:
                return "answered_externally";
            default:
                return "unknown";
        }
    }

    static String normalizeDigits(String value) {
        String input = value == null ? "" : value.trim();
        StringBuilder out = new StringBuilder(input.length());
        for (int i = 0; i < input.length(); i++) {
            char ch = input.charAt(i);
            if (ch >= '0' && ch <= '9') {
                out.append(ch);
            } else if (ch == '+' && out.length() == 0) {
                out.append(ch);
            }
        }
        return out.toString();
    }

    static boolean numbersEquivalent(String left, String right) {
        if (left == null || right == null) {
            return false;
        }
        if (left.equals(right)) {
            return true;
        }
        String leftDigits = left.startsWith("+") ? left.substring(1) : left;
        String rightDigits = right.startsWith("+") ? right.substring(1) : right;
        if (leftDigits.equals(rightDigits)) {
            return true;
        }
        if (leftDigits.length() >= 10 && rightDigits.length() >= 10) {
            String leftTail = leftDigits.substring(leftDigits.length() - 10);
            String rightTail = rightDigits.substring(rightDigits.length() - 10);
            return leftTail.equals(rightTail);
        }
        return false;
    }

    private JSONObject safe(JsonOp op) throws CommandException {
        try {
            return op.run();
        } catch (CommandException e) {
            throw e;
        } catch (SecurityException e) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, androidError(e));
        } catch (Exception e) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, androidError(e));
        }
    }

    private JSONObject substrate(JSONObject args) throws CommandException {
        return substrateController.execute(args);
    }

    private JSONObject queryArgs(String uri, JSONArray projection, String sort, int limit) {
        return queryArgs(uri, projection, null, null, sort, limit);
    }

    private JSONObject queryArgs(String uri, JSONArray projection, String where, JSONArray whereArgs, String sort, int limit) {
        JSONObject out = new JSONObject();
        Json.put(out, "op", "content.query");
        Json.put(out, "uri", uri);
        Json.put(out, "projection", projection);
        if (where != null && !where.trim().isEmpty()) {
            Json.put(out, "where", where);
        }
        if (whereArgs != null && whereArgs.length() > 0) {
            Json.put(out, "where_args", whereArgs);
        }
        Json.put(out, "sort", sort);
        Json.put(out, "limit", Math.max(1, Math.min(MAX_LIMIT, limit)));
        return out;
    }

    private JSONObject historyQueryArgs(
            String uri,
            JSONArray projection,
            String baseWhere,
            JSONArray baseWhereArgs,
            String sort,
            int limit,
            JSONObject args) throws CommandException {
        StringBuilder where = new StringBuilder();
        JSONArray whereArgs = new JSONArray();
        appendWhereClause(where, whereArgs, baseWhere, baseWhereArgs);

        long beforeTimestampMs = optionalLong(args, "before_timestamp_ms");
        long beforeId = optionalLong(args, "before_id");
        if (beforeTimestampMs > 0L && beforeId > 0L) {
            appendWhereClause(
                    where,
                    whereArgs,
                    "(date < ? OR (date = ? AND _id < ?))",
                    array(String.valueOf(beforeTimestampMs), String.valueOf(beforeTimestampMs), String.valueOf(beforeId)));
        } else if (beforeTimestampMs > 0L) {
            appendWhereClause(where, whereArgs, "date < ?", array(String.valueOf(beforeTimestampMs)));
        } else if (beforeId > 0L) {
            appendWhereClause(where, whereArgs, "_id < ?", array(String.valueOf(beforeId)));
        }
        return queryArgs(uri, projection, where.length() == 0 ? null : where.toString(), whereArgs, sort, limit);
    }

    private void appendWhereClause(StringBuilder where, JSONArray whereArgs, String clause, JSONArray clauseArgs) {
        if (clause == null || clause.trim().isEmpty()) {
            return;
        }
        if (where.length() > 0) {
            where.append(" AND ");
        }
        where.append('(').append(clause).append(')');
        if (clauseArgs != null) {
            for (int i = 0; i < clauseArgs.length(); i++) {
                Json.add(whereArgs, clauseArgs.optString(i, ""));
            }
        }
    }

    private JSONArray readinessSummary(JSONArray surfaces) {
        JSONArray out = new JSONArray();
        if (surfaces == null) {
            return out;
        }
        for (int i = 0; i < surfaces.length(); i++) {
            JSONObject surface = surfaces.optJSONObject(i);
            if (surface == null) {
                continue;
            }
            JSONObject item = new JSONObject();
            Json.put(item, "surface_id", surface.optString("surface_id", ""));
            Json.put(item, "readiness", surface.optString("readiness", "unknown"));
            Json.put(item, "required_permissions", surface.optJSONArray("required_permissions"));
            Json.put(item, "current_permission_state", surface.optJSONArray("current_permission_state"));
            Json.put(item, "role_required", surface.opt("role_required"));
            Json.put(item, "role_state", surface.opt("role_state"));
            Json.add(out, item);
        }
        return out;
    }

    private void requireSurfaceReady(JSONObject catalog, String surfaceId) throws CommandException {
        JSONObject surface = findSurface(catalog.optJSONArray("surfaces"), surfaceId);
        if (surface == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Android substrate surface unavailable: " + surfaceId);
        }
        String readiness = surface.optString("readiness", "unknown");
        if ("ready".equals(readiness)) {
            return;
        }
        if ("permission_needed".equals(readiness)) {
            JSONArray states = surface.optJSONArray("current_permission_state");
            for (int i = 0; i < states.length(); i++) {
                JSONObject state = states.optJSONObject(i);
                if (state != null && !state.optBoolean("granted", false)) {
                    throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "Missing permission: " + state.optString("name", ""));
                }
            }
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "Permission required for surface: " + surfaceId);
        }
        if ("role_needed".equals(readiness)) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Role required for surface: " + surfaceId);
        }
        throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "Surface not ready: " + surfaceId + " (" + readiness + ")");
    }

    private JSONObject findSurface(JSONArray surfaces, String surfaceId) {
        if (surfaces == null) {
            return null;
        }
        for (int i = 0; i < surfaces.length(); i++) {
            JSONObject surface = surfaces.optJSONObject(i);
            if (surface != null && surfaceId.equals(surface.optString("surface_id", ""))) {
                return surface;
            }
        }
        return null;
    }

    private void requirePermission(String permission) throws CommandException {
        if (context.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "Missing permission: " + permission);
        }
    }

    private JSONObject readContact(long contactId) {
        try (Cursor cursor = resolver.query(
                ContactsContract.Contacts.CONTENT_URI,
                new String[] {
                        ContactsContract.Contacts._ID,
                        ContactsContract.Contacts.LOOKUP_KEY,
                        ContactsContract.Contacts.DISPLAY_NAME_PRIMARY,
                        ContactsContract.Contacts.STARRED,
                        ContactsContract.Contacts.SEND_TO_VOICEMAIL,
                        ContactsContract.Contacts.CUSTOM_RINGTONE
                },
                ContactsContract.Contacts._ID + "=?",
                new String[] { String.valueOf(contactId) },
                null)) {
            if (cursor == null || !cursor.moveToFirst()) {
                return null;
            }
            JSONObject contact = new JSONObject();
            Json.put(contact, "contact_id", cursor.getLong(0));
            Json.put(contact, "lookup_key", nullToEmpty(cursor.getString(1)));
            Json.put(contact, "display_name", nullToEmpty(cursor.getString(2)));
            Json.put(contact, "starred", cursor.getInt(3) != 0);
            Json.put(contact, "send_to_voicemail", cursor.getInt(4) != 0);
            Json.put(contact, "custom_ringtone", cursor.isNull(5) ? JSONObject.NULL : cursor.getString(5));
            Json.put(contact, "phones", phonesForContact(contactId));
            Json.put(contact, "emails", emailsForContact(contactId));
            return contact;
        }
    }

    private JSONArray phonesForContact(long contactId) {
        JSONArray out = new JSONArray();
        try (Cursor cursor = resolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                new String[] {
                        ContactsContract.CommonDataKinds.Phone.NUMBER,
                        ContactsContract.CommonDataKinds.Phone.NORMALIZED_NUMBER,
                        ContactsContract.CommonDataKinds.Phone.TYPE,
                        ContactsContract.CommonDataKinds.Phone.LABEL
                },
                ContactsContract.CommonDataKinds.Phone.CONTACT_ID + "=?",
                new String[] { String.valueOf(contactId) },
                ContactsContract.CommonDataKinds.Phone.IS_PRIMARY + " DESC, "
                        + ContactsContract.CommonDataKinds.Phone._ID + " ASC")) {
            if (cursor == null) {
                return out;
            }
            while (cursor.moveToNext()) {
                JSONObject phone = new JSONObject();
                Json.put(phone, "number", nullToEmpty(cursor.getString(0)));
                Json.put(phone, "normalized_number", cursor.isNull(1) ? JSONObject.NULL : cursor.getString(1));
                Json.put(phone, "type", cursor.getInt(2));
                Json.put(phone, "label", cursor.isNull(3) ? JSONObject.NULL : cursor.getString(3));
                Json.add(out, phone);
            }
        }
        return out;
    }

    private JSONArray emailsForContact(long contactId) {
        JSONArray out = new JSONArray();
        try (Cursor cursor = resolver.query(
                ContactsContract.CommonDataKinds.Email.CONTENT_URI,
                new String[] {
                        ContactsContract.CommonDataKinds.Email.ADDRESS,
                        ContactsContract.CommonDataKinds.Email.TYPE,
                        ContactsContract.CommonDataKinds.Email.LABEL
                },
                ContactsContract.CommonDataKinds.Email.CONTACT_ID + "=?",
                new String[] { String.valueOf(contactId) },
                ContactsContract.CommonDataKinds.Email.IS_PRIMARY + " DESC, "
                        + ContactsContract.CommonDataKinds.Email._ID + " ASC")) {
            if (cursor == null) {
                return out;
            }
            while (cursor.moveToNext()) {
                JSONObject email = new JSONObject();
                Json.put(email, "address", nullToEmpty(cursor.getString(0)));
                Json.put(email, "type", cursor.getInt(1));
                Json.put(email, "label", cursor.isNull(2) ? JSONObject.NULL : cursor.getString(2));
                Json.add(out, email);
            }
        }
        return out;
    }

    private void collectContactIds(
            Uri uri,
            String[] projection,
            String selection,
            String[] selectionArgs,
            String sortOrder,
            LinkedHashSet<Long> out,
            int limit) {
        try (Cursor cursor = resolver.query(uri, projection, selection, selectionArgs, sortOrder)) {
            if (cursor == null) {
                return;
            }
            while (cursor.moveToNext() && out.size() < limit) {
                out.add(cursor.getLong(0));
            }
        }
    }

    private void addStructuredNameInsert(ArrayList<ContentProviderOperation> operations, int rawContactBackRef, String displayName) {
        operations.add(ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, rawContactBackRef)
                .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE)
                .withValue(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME, displayName)
                .build());
    }

    private void addStructuredNameInsert(ArrayList<ContentProviderOperation> operations, long rawContactId, String displayName) {
        operations.add(ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
                .withValue(ContactsContract.Data.RAW_CONTACT_ID, rawContactId)
                .withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE)
                .withValue(ContactsContract.CommonDataKinds.StructuredName.DISPLAY_NAME, displayName)
                .build());
    }

    private void addPhoneInserts(ArrayList<ContentProviderOperation> operations, int rawContactBackRef, JSONArray phones) {
        addPhoneInsertsInternal(operations, null, rawContactBackRef, phones);
    }

    private void addPhoneInsertsForRawContact(ArrayList<ContentProviderOperation> operations, long rawContactId, JSONArray phones) {
        addPhoneInsertsInternal(operations, rawContactId, null, phones);
    }

    private void addPhoneInsertsInternal(ArrayList<ContentProviderOperation> operations, Long rawContactId, Integer rawContactBackRef, JSONArray phones) {
        if (phones == null) {
            return;
        }
        for (int i = 0; i < phones.length(); i++) {
            JSONObject phone = phones.optJSONObject(i);
            if (phone == null) {
                continue;
            }
            String number = phone.optString("number", "").trim();
            if (number.isEmpty()) {
                continue;
            }
            ContentProviderOperation.Builder builder = ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI);
            if (rawContactId != null) {
                builder.withValue(ContactsContract.Data.RAW_CONTACT_ID, rawContactId);
            } else {
                builder.withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, rawContactBackRef);
            }
            builder.withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
                    .withValue(ContactsContract.CommonDataKinds.Phone.NUMBER, number)
                    .withValue(ContactsContract.CommonDataKinds.Phone.TYPE,
                            phone.optInt("type", ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE));
            String label = phone.optString("label", "").trim();
            if (!label.isEmpty()) {
                builder.withValue(ContactsContract.CommonDataKinds.Phone.LABEL, label);
            }
            operations.add(builder.build());
        }
    }

    private void addEmailInserts(ArrayList<ContentProviderOperation> operations, int rawContactBackRef, JSONArray emails) {
        addEmailInsertsInternal(operations, null, rawContactBackRef, emails);
    }

    private void addEmailInsertsForRawContact(ArrayList<ContentProviderOperation> operations, long rawContactId, JSONArray emails) {
        addEmailInsertsInternal(operations, rawContactId, null, emails);
    }

    private void addEmailInsertsInternal(ArrayList<ContentProviderOperation> operations, Long rawContactId, Integer rawContactBackRef, JSONArray emails) {
        if (emails == null) {
            return;
        }
        for (int i = 0; i < emails.length(); i++) {
            JSONObject email = emails.optJSONObject(i);
            if (email == null) {
                continue;
            }
            String address = email.optString("address", "").trim();
            if (address.isEmpty()) {
                continue;
            }
            ContentProviderOperation.Builder builder = ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI);
            if (rawContactId != null) {
                builder.withValue(ContactsContract.Data.RAW_CONTACT_ID, rawContactId);
            } else {
                builder.withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, rawContactBackRef);
            }
            builder.withValue(ContactsContract.Data.MIMETYPE, ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE)
                    .withValue(ContactsContract.CommonDataKinds.Email.ADDRESS, address)
                    .withValue(ContactsContract.CommonDataKinds.Email.TYPE,
                            email.optInt("type", ContactsContract.CommonDataKinds.Email.TYPE_OTHER));
            String label = email.optString("label", "").trim();
            if (!label.isEmpty()) {
                builder.withValue(ContactsContract.CommonDataKinds.Email.LABEL, label);
            }
            operations.add(builder.build());
        }
    }

    private long resolveContactIdForRawContact(long rawContactId) {
        try (Cursor cursor = resolver.query(
                ContactsContract.RawContacts.CONTENT_URI,
                new String[] { ContactsContract.RawContacts.CONTACT_ID },
                ContactsContract.RawContacts._ID + "=?",
                new String[] { String.valueOf(rawContactId) },
                null)) {
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getLong(0);
            }
        }
        return -1L;
    }

    private long firstRawContactId(long contactId) {
        try (Cursor cursor = resolver.query(
                ContactsContract.RawContacts.CONTENT_URI,
                new String[] { ContactsContract.RawContacts._ID },
                ContactsContract.RawContacts.CONTACT_ID + "=? AND " + ContactsContract.RawContacts.DELETED + "=0",
                new String[] { String.valueOf(contactId) },
                ContactsContract.RawContacts._ID + " ASC")) {
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getLong(0);
            }
        }
        return -1L;
    }

    private long requiredLong(JSONObject args, String key) throws CommandException {
        String value = trimmed(args, key);
        if (value.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Missing required field: " + key);
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Invalid long for " + key + ": " + value);
        }
    }

    private long optionalLong(JSONObject args, String key) throws CommandException {
        String value = trimmed(args, key);
        if (value.isEmpty()) {
            return 0L;
        }
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Invalid long for " + key + ": " + value);
        }
    }

    private int boundedLimit(JSONObject args) {
        return Math.max(1, Math.min(MAX_LIMIT, args.optInt("limit", DEFAULT_LIMIT)));
    }

    private JSONArray firstN(JSONArray rows, int limit) {
        JSONArray out = new JSONArray();
        for (int i = 0; i < rows.length() && out.length() < limit; i++) {
            Json.add(out, rows.optJSONObject(i));
        }
        return out;
    }

    private static JSONArray array(String... values) {
        JSONArray out = new JSONArray();
        for (String value : values) {
            Json.add(out, value);
        }
        return out;
    }

    private static String trimmed(JSONObject args, String key) {
        return args == null ? "" : args.optString(key, "").trim();
    }

    private static String stringValue(JSONObject row, String key) {
        Object value = row.opt(key);
        return value == null || value == JSONObject.NULL ? "" : String.valueOf(value);
    }

    private static long longValue(JSONObject row, String key) {
        Object value = row.opt(key);
        if (value instanceof Number) {
            return ((Number) value).longValue();
        }
        if (value instanceof String) {
            try {
                return Long.parseLong((String) value);
            } catch (NumberFormatException ignored) {
                return 0L;
            }
        }
        return 0L;
    }

    private static boolean boolValue(JSONObject row, String key) {
        Object value = row.opt(key);
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        if (value instanceof Number) {
            return ((Number) value).intValue() != 0;
        }
        if (value instanceof String) {
            String text = ((String) value).trim().toLowerCase(Locale.US);
            return "1".equals(text) || "true".equals(text) || "yes".equals(text);
        }
        return false;
    }

    private static long idFromUri(Uri uri) {
        if (uri == null) {
            return -1L;
        }
        try {
            return Long.parseLong(uri.getLastPathSegment());
        } catch (NumberFormatException e) {
            return -1L;
        }
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private static String androidError(Exception e) {
        return e.getClass().getSimpleName() + ": " + (e.getMessage() == null ? "" : e.getMessage());
    }
}
