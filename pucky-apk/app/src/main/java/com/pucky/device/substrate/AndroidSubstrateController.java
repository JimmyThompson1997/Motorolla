package com.pucky.device.substrate;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.app.role.RoleManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.Settings;
import android.provider.Telephony;
import android.telecom.TelecomManager;
import android.telephony.SmsManager;

import com.pucky.device.MainActivity;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.sms.SmsLabResultReceiver;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class AndroidSubstrateController {
    private static final int DEFAULT_LIMIT = 50;
    private static final int MAX_LIMIT = 200;
    private static final int MAX_JSON_CHARS = 256 * 1024;
    private static final String VOICEMAIL_READ = "com.android.voicemail.permission.READ_VOICEMAIL";
    private static final String VOICEMAIL_WRITE = "com.android.voicemail.permission.ADD_VOICEMAIL";

    private final Context context;
    private final ContentResolver resolver;

    public AndroidSubstrateController(Context context) {
        this.context = context.getApplicationContext();
        this.resolver = this.context.getContentResolver();
    }

    public JSONObject execute(JSONObject args) throws CommandException {
        String op = args.optString("op", "catalog").trim().toLowerCase(Locale.US);
        try {
            switch (op) {
                case "catalog":
                    return catalog();
                case "content.query":
                    return query(args);
                case "content.insert":
                    return insert(args);
                case "content.update":
                    return update(args);
                case "content.delete":
                    return delete(args);
                case "content.call":
                    return call(args);
                case "content.get_type":
                    return getType(args);
                case "intent.start":
                    return startIntent(args);
                case "manager.call":
                    return managerCall(args);
                case "permission.status":
                    return permissionStatus(args);
                case "permission.request":
                    return permissionRequest(args);
                default:
                    throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Unsupported android.substrate op: " + op);
            }
        } catch (CommandException e) {
            throw e;
        } catch (SecurityException e) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, androidError(e));
        } catch (Exception e) {
            throw new CommandException(CommandErrorCodes.EXECUTION_FAILED, androidError(e));
        }
    }

    private JSONObject catalog() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.android_substrate_catalog.v1");
        Json.put(out, "generated_at", Instant.now().toString());
        Json.put(out, "package_name", context.getPackageName());
        Json.put(out, "android_sdk", Build.VERSION.SDK_INT);
        Json.put(out, "surfaces", surfaces());
        Json.put(out, "permissions", allPermissionStates());
        Json.put(out, "roles", roleStates());
        Json.put(out, "ops", array(
                "catalog",
                "content.query",
                "content.insert",
                "content.update",
                "content.delete",
                "content.call",
                "content.get_type",
                "intent.start",
                "manager.call",
                "permission.status",
                "permission.request"));
        return out;
    }

    private JSONArray surfaces() {
        JSONArray out = new JSONArray();
        Json.add(out, surface(
                "sms",
                "content+manager",
                array("content://sms", "content://mms", "content://mms-sms", "content://sms-changes"),
                array("content.query", "content.insert", "content.update", "content.delete", "manager.call:send_sms"),
                permissions(Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS),
                "android.app.role.SMS",
                queryExample("content://sms", array("_id", "thread_id", "address", "date", "type", "read", "seen", "status", "creator", "body"), "date DESC")));
        Json.add(out, surface(
                "calls",
                "content+manager",
                array("content://call_log/calls"),
                array("content.query", "content.insert", "content.update", "content.delete", "manager.call:place_call", "manager.call:hangup_active"),
                permissions(Manifest.permission.READ_CALL_LOG, Manifest.permission.WRITE_CALL_LOG, Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE, Manifest.permission.ANSWER_PHONE_CALLS),
                "android.app.role.DIALER",
                queryExample("content://call_log/calls", array("_id", "number", "date", "type", "duration", "new", "is_read", "name", "voicemail_uri", "transcription"), "date DESC")));
        Json.add(out, surface(
                "voicemail",
                "content",
                array("content://com.android.voicemail", "content://call_log/calls"),
                array("content.query", "content.insert", "content.update", "content.delete"),
                permissions(VOICEMAIL_READ, VOICEMAIL_WRITE, Manifest.permission.READ_CALL_LOG),
                "android.app.role.DIALER",
                queryExample("content://call_log/calls", array("_id", "number", "date", "type", "duration", "voicemail_uri", "transcription"), "date DESC")));
        Json.add(out, surface(
                "contacts",
                "content",
                array("content://com.android.contacts", "content://contacts", "content://com.android.contacts/data", "content://com.android.contacts/data/phones"),
                array("content.query", "content.insert", "content.update", "content.delete"),
                permissions(Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS, Manifest.permission.GET_ACCOUNTS),
                "",
                queryExample("content://com.android.contacts/data/phones", array("contact_id", "raw_contact_id", "display_name", "data1", "data2"), "display_name ASC")));
        Json.add(out, surface(
                "calendar",
                "content+intent",
                array("content://com.android.calendar/calendars", "content://com.android.calendar/events", "content://com.android.calendar/instances", "content://com.android.calendar/reminders", "content://com.android.calendar/attendees"),
                array("content.query", "content.insert", "content.update", "content.delete", "intent.start:calendar.insert"),
                permissions(Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR),
                "",
                queryExample("content://com.android.calendar/events", array("_id", "calendar_id", "title", "dtstart", "dtend", "eventLocation", "deleted"), "dtstart DESC")));
        Json.add(out, surface(
                "clock",
                "intent",
                array("intent:alarm.set", "intent:timer.set", "intent:alarms.show"),
                array("intent.start:alarm.set", "intent.start:timer.set", "intent.start:alarms.show"),
                permissions("com.android.alarm.permission.SET_ALARM"),
                "",
                actionExample("intent.start", "alarm.set")));
        Json.add(out, surface(
                "settings",
                "content+intent",
                array("content://settings/system", "content://settings/secure", "content://settings/global", "intent:settings.open"),
                array("content.query", "content.update", "intent.start:settings.open"),
                permissions(Manifest.permission.WRITE_SETTINGS),
                "",
                queryExample("content://settings/system", array("name", "value"), "name ASC")));
        Json.add(out, surface(
                "media",
                "content",
                array("content://media/external/images/media", "content://media/external/video/media", "content://media/external/audio/media", "content://media/external/downloads", "content://media_legacy"),
                array("content.query", "content.insert", "content.update", "content.delete"),
                mediaPermissions(),
                "",
                queryExample("content://media/external/images/media", array("_id", "_display_name", "date_added", "mime_type", "_size"), "date_added DESC")));
        Json.add(out, surface(
                "downloads",
                "content",
                array("content://downloads/my_downloads", "content://downloads/public_downloads", "content://downloads/all_downloads"),
                array("content.query", "content.insert", "content.update", "content.delete"),
                mediaPermissions(),
                "",
                queryExample("content://downloads/my_downloads", array("_id", "title", "description", "uri", "status", "lastmod"), "lastmod DESC")));
        Json.add(out, surface(
                "blocked_numbers",
                "content",
                array("content://com.android.blockednumber/blocked"),
                array("content.query", "content.insert", "content.update", "content.delete"),
                permissions("android.permission.READ_BLOCKED_NUMBERS", "android.permission.WRITE_BLOCKED_NUMBERS"),
                "android.app.role.DIALER",
                queryExample("content://com.android.blockednumber/blocked", array("_id", "original_number", "e164_number"), "_id DESC")));
        Json.add(out, surface(
                "user_dictionary",
                "content",
                array("content://user_dictionary/words"),
                array("content.query", "content.insert", "content.update", "content.delete"),
                permissions("android.permission.READ_USER_DICTIONARY", "android.permission.WRITE_USER_DICTIONARY"),
                "",
                queryExample("content://user_dictionary/words", array("_id", "word", "frequency", "locale"), "word ASC")));
        Json.add(out, surface(
                "notifications",
                "service",
                array("NotificationListenerService"),
                array("future:notification.listener"),
                permissions(),
                "",
                note("Notification listener is not a database; add as a future opt-in substrate surface.")));
        Json.add(out, surface(
                "email",
                "external_api",
                array("gmail/oauth", "imap/oauth", "notification.listener"),
                array("future:oauth", "future:notification.listener"),
                permissions(),
                "",
                note("Email is not a reliable Android OS master provider; use app APIs or notification listener.")));
        return out;
    }

    private JSONObject surface(
            String id,
            String kind,
            JSONArray endpoints,
            JSONArray ops,
            JSONArray requiredPermissions,
            String roleRequired,
            JSONObject first) {
        boolean supported = false;
        for (int i = 0; i < endpoints.length(); i++) {
            String endpoint = endpoints.optString(i, "");
            if (endpoint.startsWith("content://")) {
                supported = supported || isProviderAvailable(endpoint);
            } else if (endpoint.startsWith("intent:")) {
                supported = true;
            } else if (!endpoint.trim().isEmpty()) {
                supported = true;
            }
        }
        String readiness = readiness(supported, requiredPermissions, roleRequired);
        JSONObject out = new JSONObject();
        Json.put(out, "surface_id", id);
        Json.put(out, "kind", kind);
        Json.put(out, "uri_or_action", endpoints);
        Json.put(out, "ops_supported", ops);
        Json.put(out, "required_permissions", requiredPermissions);
        Json.put(out, "current_permission_state", permissionState(requiredPermissions));
        Json.put(out, "role_required", roleRequired == null || roleRequired.isEmpty() ? JSONObject.NULL : roleRequired);
        Json.put(out, "role_state", roleRequired == null || roleRequired.isEmpty() ? JSONObject.NULL : roleState(roleRequired));
        Json.put(out, "readiness", readiness);
        Json.put(out, "first", first);
        return out;
    }

    private String readiness(boolean supported, JSONArray permissions, String roleRequired) {
        if (!supported) {
            return "unsupported";
        }
        if (!missingPermissions(permissions).isEmpty()) {
            return "permission_needed";
        }
        if (roleRequired != null && !roleRequired.trim().isEmpty() && !holdsRole(roleRequired)) {
            return "role_needed";
        }
        return "ready";
    }

    private JSONObject query(JSONObject args) throws Exception {
        Uri uri = checkedUri(args);
        JSONArray projectionJson = args.optJSONArray("projection");
        String[] projection = projectionJson == null ? null : toStringArray(projectionJson);
        String where = optNonEmpty(args, "where");
        String[] whereArgs = args.optJSONArray("where_args") == null ? null : toStringArray(args.optJSONArray("where_args"));
        String sort = optNonEmpty(args, "sort");
        int requestedLimit = args.optInt("limit", DEFAULT_LIMIT);
        int limit = Math.max(1, Math.min(MAX_LIMIT, requestedLimit <= 0 ? DEFAULT_LIMIT : requestedLimit));

        Bundle queryArgs = new Bundle();
        if (!where.isEmpty()) {
            queryArgs.putString("android:query-arg-sql-selection", where);
        }
        if (whereArgs != null) {
            queryArgs.putStringArray("android:query-arg-sql-selection-args", whereArgs);
        }
        if (!sort.isEmpty()) {
            queryArgs.putString("android:query-arg-sql-sort-order", sort);
        }
        queryArgs.putInt("android:query-arg-limit", limit);

        JSONArray rows = new JSONArray();
        JSONArray columns = new JSONArray();
        boolean truncated = false;
        int scanned = 0;
        try (Cursor cursor = resolver.query(uri, projection, queryArgs, null)) {
            if (cursor != null) {
                String[] names = cursor.getColumnNames();
                for (String name : names) {
                    Json.add(columns, name);
                }
                while (cursor.moveToNext()) {
                    scanned++;
                    if (rows.length() >= limit || rows.toString().length() >= MAX_JSON_CHARS) {
                        truncated = true;
                        break;
                    }
                    JSONObject row = new JSONObject();
                    for (int i = 0; i < names.length; i++) {
                        Json.put(row, names[i], cursorValue(cursor, i));
                    }
                    Json.add(rows, row);
                }
                truncated = truncated || cursor.moveToNext();
            }
        }

        JSONObject out = baseResult("content.query", uri.toString());
        Json.put(out, "columns", columns);
        Json.put(out, "rows", rows);
        Json.put(out, "row_count", rows.length());
        Json.put(out, "scanned_count", scanned);
        Json.put(out, "limit", limit);
        Json.put(out, "truncated", truncated);
        return out;
    }

    private JSONObject insert(JSONObject args) throws Exception {
        Uri uri = checkedUri(args);
        ContentValues values = contentValues(args.optJSONObject("values"));
        Uri inserted = resolver.insert(uri, values);
        JSONObject out = baseResult("content.insert", uri.toString());
        Json.put(out, "inserted_uri", inserted == null ? JSONObject.NULL : inserted.toString());
        return out;
    }

    private JSONObject update(JSONObject args) throws Exception {
        Uri uri = checkedUri(args);
        ContentValues values = contentValues(args.optJSONObject("values"));
        int count = resolver.update(uri, values, optNonEmpty(args, "where"), args.optJSONArray("where_args") == null ? null : toStringArray(args.optJSONArray("where_args")));
        JSONObject out = baseResult("content.update", uri.toString());
        Json.put(out, "updated_count", count);
        return out;
    }

    private JSONObject delete(JSONObject args) throws Exception {
        Uri uri = checkedUri(args);
        int count = resolver.delete(uri, optNonEmpty(args, "where"), args.optJSONArray("where_args") == null ? null : toStringArray(args.optJSONArray("where_args")));
        JSONObject out = baseResult("content.delete", uri.toString());
        Json.put(out, "deleted_count", count);
        return out;
    }

    private JSONObject call(JSONObject args) throws Exception {
        Uri uri = checkedUri(args);
        String method = args.optString("method", "").trim();
        if (method.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "content.call requires args.method");
        }
        Bundle bundle = resolver.call(uri, method, args.optString("arg", null), toBundle(args.optJSONObject("extras")));
        JSONObject out = baseResult("content.call", uri.toString());
        Json.put(out, "method", method);
        Json.put(out, "result", bundle == null ? JSONObject.NULL : bundleToJson(bundle));
        return out;
    }

    private JSONObject getType(JSONObject args) throws Exception {
        Uri uri = checkedUri(args);
        JSONObject out = baseResult("content.get_type", uri.toString());
        Json.put(out, "type", resolver.getType(uri));
        return out;
    }

    private JSONObject startIntent(JSONObject args) throws CommandException {
        String action = args.optString("action", args.optString("intent", "")).trim().toLowerCase(Locale.US);
        Intent intent;
        switch (action) {
            case "alarm.set":
                intent = new Intent(AlarmClock.ACTION_SET_ALARM)
                        .putExtra(AlarmClock.EXTRA_HOUR, args.optInt("hour", 9))
                        .putExtra(AlarmClock.EXTRA_MINUTES, args.optInt("minutes", 0))
                        .putExtra(AlarmClock.EXTRA_MESSAGE, args.optString("message", "Pucky alarm"))
                        .putExtra(AlarmClock.EXTRA_SKIP_UI, args.optBoolean("skip_ui", false));
                break;
            case "timer.set":
                intent = new Intent(AlarmClock.ACTION_SET_TIMER)
                        .putExtra(AlarmClock.EXTRA_LENGTH, args.optInt("seconds", 60))
                        .putExtra(AlarmClock.EXTRA_MESSAGE, args.optString("message", "Pucky timer"))
                        .putExtra(AlarmClock.EXTRA_SKIP_UI, args.optBoolean("skip_ui", false));
                break;
            case "alarms.show":
                intent = new Intent(AlarmClock.ACTION_SHOW_ALARMS);
                break;
            case "calendar.insert":
                intent = new Intent(Intent.ACTION_INSERT)
                        .setData(CalendarContract.Events.CONTENT_URI)
                        .putExtra(CalendarContract.Events.TITLE, args.optString("title", "Pucky event"));
                if (args.has("begin_ms")) {
                    intent.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, args.optLong("begin_ms"));
                }
                if (args.has("end_ms")) {
                    intent.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, args.optLong("end_ms"));
                }
                if (args.has("description")) {
                    intent.putExtra(CalendarContract.Events.DESCRIPTION, args.optString("description"));
                }
                if (args.has("location")) {
                    intent.putExtra(CalendarContract.Events.EVENT_LOCATION, args.optString("location"));
                }
                break;
            case "settings.open":
                intent = new Intent(Settings.ACTION_SETTINGS);
                break;
            case "settings.app":
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + context.getPackageName()));
                break;
            case "share.text":
                intent = new Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_TEXT, args.optString("text", ""));
                intent = Intent.createChooser(intent, args.optString("title", "Share with"));
                break;
            default:
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Unsupported intent.start action: " + action);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        JSONObject out = baseResult("intent.start", action);
        Json.put(out, "launched", true);
        return out;
    }

    private JSONObject managerCall(JSONObject args) throws Exception {
        String action = args.optString("action", "").trim().toLowerCase(Locale.US);
        switch (action) {
            case "send_sms":
                return sendSms(args);
            case "place_call":
                return placeCall(args);
            case "hangup_active":
                return hangupActive();
            default:
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Unsupported manager.call action: " + action);
        }
    }

    private JSONObject sendSms(JSONObject args) throws CommandException {
        requirePermission(Manifest.permission.SEND_SMS);
        String to = args.optString("to", "").trim();
        String body = args.optString("body", "").trim();
        if (to.isEmpty() || body.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "send_sms requires to and body");
        }
        String requestId = String.valueOf(System.currentTimeMillis());
        PendingIntent sent = smsResultIntent(SmsLabResultReceiver.ACTION_SENT, requestId, to, 21);
        PendingIntent delivered = smsResultIntent(SmsLabResultReceiver.ACTION_DELIVERED, requestId, to, 22);
        SmsManager.getDefault().sendTextMessage(to, null, body, sent, delivered);
        JSONObject out = baseResult("manager.call", "send_sms");
        Json.put(out, "queued", true);
        Json.put(out, "request_id", requestId);
        Json.put(out, "to", maskNumber(to));
        Json.put(out, "body_chars", body.length());
        return out;
    }

    private PendingIntent smsResultIntent(String action, String requestId, String to, int offset) {
        Intent intent = new Intent(context, SmsLabResultReceiver.class)
                .setAction(action)
                .putExtra(SmsLabResultReceiver.EXTRA_REQUEST_ID, requestId)
                .putExtra(SmsLabResultReceiver.EXTRA_TO, to);
        return PendingIntent.getBroadcast(
                context,
                requestId.hashCode() + offset,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private JSONObject placeCall(JSONObject args) throws CommandException {
        requirePermission(Manifest.permission.CALL_PHONE);
        String number = cleanNumber(args.optString("number", ""));
        if (number.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "place_call requires number");
        }
        if ("911".equals(number.replace("+", "")) || "112".equals(number.replace("+", ""))) {
            throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED, "Emergency-like numbers are blocked");
        }
        TelecomManager telecom = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
        if (telecom == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "TelecomManager unavailable");
        }
        telecom.placeCall(Uri.fromParts("tel", number, null), new Bundle());
        JSONObject out = baseResult("manager.call", "place_call");
        Json.put(out, "requested", true);
        Json.put(out, "number", maskNumber(number));
        return out;
    }

    @SuppressWarnings("deprecation")
    private JSONObject hangupActive() throws CommandException {
        requirePermission(Manifest.permission.ANSWER_PHONE_CALLS);
        TelecomManager telecom = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
        if (telecom == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "TelecomManager unavailable");
        }
        boolean ended = telecom.endCall();
        JSONObject out = baseResult("manager.call", "hangup_active");
        Json.put(out, "ended", ended);
        return out;
    }

    private JSONObject permissionStatus(JSONObject args) {
        JSONArray names = args.optJSONArray("permissions");
        if (names == null || names.length() == 0) {
            names = allDeclaredPermissions();
        }
        JSONObject out = baseResult("permission.status", "permissions");
        Json.put(out, "permissions", permissionState(names));
        Json.put(out, "roles", roleStates());
        return out;
    }

    private JSONObject permissionRequest(JSONObject args) {
        Intent intent = new Intent(context, MainActivity.class)
                .setAction("com.pucky.device.action.REQUEST_PERMISSIONS")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
        JSONObject out = baseResult("permission.request", "runtime");
        Json.put(out, "launched", true);
        Json.put(out, "note", "MainActivity will request all missing runtime permissions it declares.");
        return out;
    }

    private Uri checkedUri(JSONObject args) throws CommandException {
        String raw = args.optString("uri", "").trim();
        if (raw.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "content op requires args.uri");
        }
        Uri uri = Uri.parse(raw);
        if (!"content".equals(uri.getScheme())) {
            throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED, "Only content:// URIs are allowed");
        }
        if (!isAllowedContentUri(raw)) {
            throw new CommandException(CommandErrorCodes.COMMAND_NOT_ALLOWED, "URI is not in the Android substrate allowlist: " + raw);
        }
        return uri;
    }

    private boolean isAllowedContentUri(String raw) {
        String normalized = raw.toLowerCase(Locale.US);
        String[] allowed = new String[] {
                "content://sms",
                "content://mms",
                "content://mms-sms",
                "content://sms-changes",
                "content://telephony",
                "content://call_log",
                "content://com.android.voicemail",
                "content://com.android.contacts",
                "content://contacts",
                "content://com.android.calendar",
                "content://settings",
                "content://media",
                "content://media_legacy",
                "content://downloads",
                "content://com.android.blockednumber",
                "content://user_dictionary"
        };
        for (String prefix : allowed) {
            if (normalized.equals(prefix) || normalized.startsWith(prefix + "/")) {
                return true;
            }
        }
        return false;
    }

    private boolean isProviderAvailable(String rawUri) {
        Uri uri = Uri.parse(rawUri);
        if (uri.getAuthority() == null) {
            return false;
        }
        return context.getPackageManager().resolveContentProvider(uri.getAuthority(), 0) != null;
    }

    private JSONObject baseResult(String op, String target) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.android_substrate_result.v1");
        Json.put(out, "op", op);
        Json.put(out, "target", target);
        Json.put(out, "generated_at", Instant.now().toString());
        return out;
    }

    private ContentValues contentValues(JSONObject json) throws CommandException {
        if (json == null) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "content mutation requires args.values");
        }
        ContentValues values = new ContentValues();
        JSONArray names = json.names();
        if (names == null) {
            return values;
        }
        for (int i = 0; i < names.length(); i++) {
            String key = names.optString(i, "");
            Object value = json.opt(key);
            if (value == null || value == JSONObject.NULL) {
                values.putNull(key);
            } else if (value instanceof Boolean) {
                values.put(key, (Boolean) value);
            } else if (value instanceof Integer) {
                values.put(key, (Integer) value);
            } else if (value instanceof Long) {
                values.put(key, (Long) value);
            } else if (value instanceof Number) {
                values.put(key, ((Number) value).doubleValue());
            } else {
                values.put(key, String.valueOf(value));
            }
        }
        return values;
    }

    private Object cursorValue(Cursor cursor, int index) {
        switch (cursor.getType(index)) {
            case Cursor.FIELD_TYPE_NULL:
                return JSONObject.NULL;
            case Cursor.FIELD_TYPE_INTEGER:
                return cursor.getLong(index);
            case Cursor.FIELD_TYPE_FLOAT:
                return cursor.getDouble(index);
            case Cursor.FIELD_TYPE_BLOB:
                byte[] blob = cursor.getBlob(index);
                return blob == null ? JSONObject.NULL : "[blob " + blob.length + " bytes]";
            case Cursor.FIELD_TYPE_STRING:
            default:
                return cursor.getString(index);
        }
    }

    private JSONArray permissionState(JSONArray permissions) {
        JSONArray out = new JSONArray();
        for (int i = 0; i < permissions.length(); i++) {
            String name = permissions.optString(i, "");
            JSONObject item = new JSONObject();
            Json.put(item, "name", name);
            Json.put(item, "granted", hasPermission(name));
            Json.put(item, "declared", isDeclared(name));
            Json.put(item, "runtime_requestable", isLikelyRuntimePermission(name));
            Json.add(out, item);
        }
        return out;
    }

    private List<String> missingPermissions(JSONArray permissions) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < permissions.length(); i++) {
            String permission = permissions.optString(i, "");
            if (!permission.trim().isEmpty() && !hasPermission(permission)) {
                out.add(permission);
            }
        }
        return out;
    }

    private JSONArray allPermissionStates() {
        return permissionState(allDeclaredPermissions());
    }

    private JSONArray allDeclaredPermissions() {
        Set<String> names = new HashSet<>();
        addAll(names, Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS,
                Manifest.permission.READ_CALL_LOG, Manifest.permission.WRITE_CALL_LOG, Manifest.permission.CALL_PHONE,
                Manifest.permission.READ_PHONE_STATE, Manifest.permission.ANSWER_PHONE_CALLS,
                Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS, Manifest.permission.GET_ACCOUNTS,
                Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR,
                VOICEMAIL_READ, VOICEMAIL_WRITE,
                "android.permission.READ_BLOCKED_NUMBERS", "android.permission.WRITE_BLOCKED_NUMBERS",
                "android.permission.READ_USER_DICTIONARY", "android.permission.WRITE_USER_DICTIONARY");
        if (Build.VERSION.SDK_INT >= 33) {
            addAll(names, Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_AUDIO);
        }
        JSONArray out = new JSONArray();
        for (String name : names) {
            Json.add(out, name);
        }
        return out;
    }

    private void addAll(Set<String> out, String... names) {
        for (String name : names) {
            out.add(name);
        }
    }

    private boolean hasPermission(String name) {
        if (name == null || name.trim().isEmpty()) {
            return true;
        }
        if (Manifest.permission.WRITE_SETTINGS.equals(name)) {
            return Settings.System.canWrite(context);
        }
        return context.checkSelfPermission(name) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean isDeclared(String permission) {
        try {
            String[] permissions = context.getPackageManager()
                    .getPackageInfo(context.getPackageName(), PackageManager.GET_PERMISSIONS)
                    .requestedPermissions;
            if (permissions == null) {
                return false;
            }
            for (String item : permissions) {
                if (permission.equals(item)) {
                    return true;
                }
            }
        } catch (PackageManager.NameNotFoundException ignored) {
        }
        return false;
    }

    private boolean isLikelyRuntimePermission(String permission) {
        if (Manifest.permission.WRITE_SETTINGS.equals(permission)) {
            return false;
        }
        if ("android.permission.READ_BLOCKED_NUMBERS".equals(permission)
                || "android.permission.WRITE_BLOCKED_NUMBERS".equals(permission)) {
            return false;
        }
        return permission != null
                && (permission.startsWith("android.permission.READ_")
                || permission.startsWith("android.permission.WRITE_")
                || permission.startsWith("android.permission.SEND_")
                || permission.startsWith("android.permission.RECEIVE_")
                || Manifest.permission.CALL_PHONE.equals(permission)
                || Manifest.permission.GET_ACCOUNTS.equals(permission)
                || Manifest.permission.ANSWER_PHONE_CALLS.equals(permission)
                || VOICEMAIL_READ.equals(permission)
                || VOICEMAIL_WRITE.equals(permission));
    }

    private void requirePermission(String permission) throws CommandException {
        if (!hasPermission(permission)) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "Missing permission: " + permission);
        }
    }

    private JSONObject roleStates() {
        JSONObject out = new JSONObject();
        Json.put(out, "android.app.role.SMS", roleState("android.app.role.SMS"));
        Json.put(out, "android.app.role.DIALER", roleState("android.app.role.DIALER"));
        return out;
    }

    private JSONObject roleState(String role) {
        JSONObject out = new JSONObject();
        Json.put(out, "name", role);
        Json.put(out, "available", isRoleAvailable(role));
        Json.put(out, "held", holdsRole(role));
        Json.put(out, "holders", roleHolders(role));
        return out;
    }

    private boolean isRoleAvailable(String role) {
        if (Build.VERSION.SDK_INT < 29) {
            return false;
        }
        RoleManager manager = (RoleManager) context.getSystemService(Context.ROLE_SERVICE);
        return manager != null && manager.isRoleAvailable(role);
    }

    private boolean holdsRole(String role) {
        if (Build.VERSION.SDK_INT < 29) {
            return false;
        }
        RoleManager manager = (RoleManager) context.getSystemService(Context.ROLE_SERVICE);
        return manager != null && manager.isRoleHeld(role);
    }

    private JSONArray roleHolders(String role) {
        JSONArray out = new JSONArray();
        if ("android.app.role.SMS".equals(role)) {
            String holder = Telephony.Sms.getDefaultSmsPackage(context);
            if (holder != null && !holder.trim().isEmpty()) {
                Json.add(out, holder);
            }
            return out;
        }
        if ("android.app.role.DIALER".equals(role)) {
            TelecomManager telecom = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
            String holder = telecom == null ? "" : telecom.getDefaultDialerPackage();
            if (holder != null && !holder.trim().isEmpty()) {
                Json.add(out, holder);
            }
        }
        return out;
    }

    private JSONObject queryExample(String uri, JSONArray projection, String sort) {
        JSONObject out = new JSONObject();
        Json.put(out, "op", "content.query");
        Json.put(out, "uri", uri);
        Json.put(out, "projection", projection);
        Json.put(out, "sort", sort);
        Json.put(out, "limit", DEFAULT_LIMIT);
        return out;
    }

    private JSONObject actionExample(String op, String action) {
        JSONObject out = new JSONObject();
        Json.put(out, "op", op);
        Json.put(out, "action", action);
        return out;
    }

    private JSONObject note(String value) {
        JSONObject out = new JSONObject();
        Json.put(out, "note", value);
        return out;
    }

    private JSONArray permissions(String... names) {
        JSONArray out = new JSONArray();
        for (String name : names) {
            if (name != null && !name.trim().isEmpty()) {
                Json.add(out, name);
            }
        }
        return out;
    }

    private JSONArray mediaPermissions() {
        if (Build.VERSION.SDK_INT >= 33) {
            return permissions(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_AUDIO);
        }
        return permissions(Manifest.permission.READ_EXTERNAL_STORAGE);
    }

    private JSONArray array(String... values) {
        JSONArray out = new JSONArray();
        for (String value : values) {
            Json.add(out, value);
        }
        return out;
    }

    private String[] toStringArray(JSONArray array) {
        String[] out = new String[array.length()];
        for (int i = 0; i < array.length(); i++) {
            out[i] = array.optString(i, "");
        }
        return out;
    }

    private String optNonEmpty(JSONObject object, String key) {
        String value = object.optString(key, "");
        return value == null ? "" : value.trim();
    }

    private Bundle toBundle(JSONObject json) {
        Bundle out = new Bundle();
        if (json == null) {
            return out;
        }
        JSONArray names = json.names();
        if (names == null) {
            return out;
        }
        for (int i = 0; i < names.length(); i++) {
            String key = names.optString(i, "");
            Object value = json.opt(key);
            if (value instanceof Boolean) {
                out.putBoolean(key, (Boolean) value);
            } else if (value instanceof Integer) {
                out.putInt(key, (Integer) value);
            } else if (value instanceof Long) {
                out.putLong(key, (Long) value);
            } else if (value instanceof Number) {
                out.putDouble(key, ((Number) value).doubleValue());
            } else if (value instanceof JSONArray) {
                out.putStringArray(key, toStringArray((JSONArray) value));
            } else if (value != null && value != JSONObject.NULL) {
                out.putString(key, String.valueOf(value));
            }
        }
        return out;
    }

    private JSONObject bundleToJson(Bundle bundle) {
        JSONObject out = new JSONObject();
        for (String key : bundle.keySet()) {
            Object value = bundle.get(key);
            if (value instanceof Bundle) {
                Json.put(out, key, bundleToJson((Bundle) value));
            } else if (value instanceof String[]) {
                JSONArray array = new JSONArray();
                for (String item : (String[]) value) {
                    Json.add(array, item);
                }
                Json.put(out, key, array);
            } else {
                Json.put(out, key, value == null ? JSONObject.NULL : value);
            }
        }
        return out;
    }

    private String cleanNumber(String value) {
        String trimmed = value == null ? "" : value.trim();
        StringBuilder out = new StringBuilder(trimmed.length());
        for (int i = 0; i < trimmed.length(); i++) {
            char ch = trimmed.charAt(i);
            if ((ch >= '0' && ch <= '9') || (ch == '+' && out.length() == 0)) {
                out.append(ch);
            } else if (ch == ' ' || ch == '-' || ch == '(' || ch == ')') {
                continue;
            } else {
                return "";
            }
        }
        return out.toString();
    }

    private String maskNumber(String value) {
        if (value == null || value.length() <= 4) {
            return "****";
        }
        return "***" + value.substring(value.length() - 4);
    }

    private String androidError(Exception e) {
        return e.getClass().getSimpleName() + ": " + (e.getMessage() == null ? "" : e.getMessage());
    }
}
