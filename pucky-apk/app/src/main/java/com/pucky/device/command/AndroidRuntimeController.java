package com.pucky.device.command;

import com.pucky.device.notifications.NotificationController;
import com.pucky.device.substrate.AndroidSubstrateController;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;
import java.util.TimeZone;

public final class AndroidRuntimeController {
    private static final int HIGH_LIMIT_FUSE = 5000;

    private final AndroidSubstrateController substrateController;
    private final PhoneDataController phoneDataController;
    private final NotificationController notificationController;

    public AndroidRuntimeController(
            AndroidSubstrateController substrateController,
            PhoneDataController phoneDataController,
            NotificationController notificationController) {
        this.substrateController = substrateController;
        this.phoneDataController = phoneDataController;
        this.notificationController = notificationController;
    }

    public JSONObject execute(String command, JSONObject inputArgs) throws CommandException {
        JSONObject args = inputArgs == null ? new JSONObject() : inputArgs;
        switch (command) {
            case "android.catalog":
                return substrateOp(args, "catalog");
            case "android.content.query":
                return substrateOp(args, "content.query");
            case "android.content.insert":
                return substrateOp(args, "content.insert");
            case "android.content.update":
                return substrateOp(args, "content.update");
            case "android.content.delete":
                return substrateOp(args, "content.delete");
            case "android.content.call":
                return substrateOp(args, "content.call");
            case "android.content.get_type":
                return substrateOp(args, "content.get_type");
            case "android.intent.start":
                return substrateOp(args, "intent.start");
            case "android.manager.call":
                return substrateOp(args, "manager.call");
            case "android.permission.status":
                return substrateOp(args, "permission.status");
            case "android.permission.request":
                return substrateOp(args, "permission.request");
            case "android.sms.list":
                return phoneDataController.smsList(requireLimit(args, command));
            case "android.sms.thread":
                return phoneDataController.smsGetThread(requireLimit(args, command));
            case "android.sms.send":
                return phoneDataController.smsSend(args);
            case "android.calls.list":
                return phoneDataController.callsList(requireLimit(args, command));
            case "android.calls.state":
                return phoneDataController.callsState(args);
            case "android.calls.place":
                return phoneDataController.callsPlace(args);
            case "android.calls.answer":
                return phoneDataController.callsAnswer(args);
            case "android.calls.hangup":
                return phoneDataController.callsHangup(args);
            case "android.contacts.search":
                return phoneDataController.contactsSearch(requireLimit(args, command));
            case "android.contacts.get":
                return phoneDataController.contactsGet(args);
            case "android.contacts.create":
                return phoneDataController.contactsCreate(args);
            case "android.contacts.replace":
                return phoneDataController.contactsReplace(args);
            case "android.contacts.delete":
                return phoneDataController.contactsDelete(args);
            case "android.contacts.photo.get":
                return phoneDataController.contactsPhotoGet(args);
            case "android.contacts.photo.put":
                return phoneDataController.contactsPhotoPut(args);
            case "android.voicemail.list":
                return phoneDataController.voicemailList(requireLimit(args, command));
            case "android.blocked_numbers.list":
                return phoneDataController.blockedNumbersList(requireLimit(args, command));
            case "android.blocked_numbers.add":
                return phoneDataController.blockedNumbersAdd(args);
            case "android.blocked_numbers.remove":
                return phoneDataController.blockedNumbersRemove(args);
            case "android.calendar.list":
                return calendarList(requireLimit(args, command));
            case "android.calendar.get":
                return calendarGet(args);
            case "android.calendar.create":
                return calendarCreate(args);
            case "android.calendar.update":
                return calendarUpdate(args);
            case "android.calendar.delete":
                return calendarDelete(args);
            case "android.clock.alarm.set":
                return intentAction(args, "alarm.set");
            case "android.clock.timer.set":
                return intentAction(args, "timer.set");
            case "android.clock.alarms.show":
                return intentAction(args, "alarms.show");
            case "android.settings.get":
                return settingsGet(args);
            case "android.settings.put":
                return settingsPut(args);
            case "android.settings.open":
                return intentAction(args, "settings.open");
            case "android.media.images.list":
                return mediaList(requireLimit(args, command), "content://media/external/images/media");
            case "android.media.video.list":
                return mediaList(requireLimit(args, command), "content://media/external/video/media");
            case "android.media.audio.list":
                return mediaList(requireLimit(args, command), "content://media/external/audio/media");
            case "android.downloads.list":
                return downloadsList(requireLimit(args, command));
            case "android.downloads.get":
                return downloadsGet(args);
            case "android.user_dictionary.list":
                return userDictionaryList(requireLimit(args, command));
            case "android.user_dictionary.add":
                return userDictionaryAdd(args);
            case "android.user_dictionary.delete":
                return userDictionaryDelete(args);
            case "android.notifications.listener.status":
                return notificationController.listenerStatus(args);
            case "android.notifications.listener.messages":
                return notificationController.listenerMessages(requireLimit(args, command));
            default:
                throw new CommandException(
                        CommandErrorCodes.COMMAND_NOT_ALLOWED,
                        "Unsupported Android runtime command: " + command);
        }
    }

    private JSONObject calendarList(JSONObject args) throws CommandException {
        String kind = args.optString("kind", "events").trim().toLowerCase(Locale.US);
        if ("calendars".equals(kind)) {
            return query(
                    "content://com.android.calendar/calendars",
                    array("_id", "name", "calendar_displayName", "account_name", "account_type", "ownerAccount", "visible"),
                    null,
                    null,
                    "_id ASC",
                    args.optInt("limit", HIGH_LIMIT_FUSE));
        }
        return query(
                "content://com.android.calendar/events",
                array("_id", "calendar_id", "title", "dtstart", "dtend", "eventLocation", "description", "deleted"),
                null,
                null,
                "dtstart DESC, _id DESC",
                args.optInt("limit", HIGH_LIMIT_FUSE));
    }

    private JSONObject calendarGet(JSONObject args) throws CommandException {
        long eventId = requiredLong(args, "event_id");
        return query(
                "content://com.android.calendar/events",
                array("_id", "calendar_id", "title", "dtstart", "dtend", "eventLocation", "description", "deleted"),
                "_id = ?",
                array(String.valueOf(eventId)),
                "_id ASC",
                1);
    }

    private JSONObject calendarCreate(JSONObject args) throws CommandException {
        JSONObject payload = new JSONObject();
        Json.put(payload, "uri", "content://com.android.calendar/events");
        Json.put(payload, "values", calendarValues(args, true));
        return substrateOp(payload, "content.insert");
    }

    private JSONObject calendarUpdate(JSONObject args) throws CommandException {
        long eventId = requiredLong(args, "event_id");
        JSONObject payload = new JSONObject();
        Json.put(payload, "uri", "content://com.android.calendar/events");
        Json.put(payload, "values", calendarValues(args, false));
        Json.put(payload, "where", "_id = ?");
        Json.put(payload, "where_args", array(String.valueOf(eventId)));
        return substrateOp(payload, "content.update");
    }

    private JSONObject calendarDelete(JSONObject args) throws CommandException {
        long eventId = requiredLong(args, "event_id");
        JSONObject payload = new JSONObject();
        Json.put(payload, "uri", "content://com.android.calendar/events");
        Json.put(payload, "where", "_id = ?");
        Json.put(payload, "where_args", array(String.valueOf(eventId)));
        return substrateOp(payload, "content.delete");
    }

    private JSONObject settingsGet(JSONObject args) throws CommandException {
        String namespace = settingsNamespace(args);
        String name = args.optString("name", "").trim();
        JSONObject query = new JSONObject();
        Json.put(query, "uri", "content://settings/" + namespace);
        Json.put(query, "projection", array("name", "value"));
        Json.put(query, "sort", "name ASC");
        if (!name.isEmpty()) {
            Json.put(query, "where", "name = ?");
            Json.put(query, "where_args", array(name));
            Json.put(query, "limit", 1);
        } else {
            Json.put(query, "limit", requireLimit(args, "android.settings.get").optInt("limit", HIGH_LIMIT_FUSE));
        }
        return substrateOp(query, "content.query");
    }

    private JSONObject settingsPut(JSONObject args) throws CommandException {
        String namespace = settingsNamespace(args);
        String name = requiredString(args, "name");
        String value = requiredString(args, "value");
        JSONObject values = new JSONObject();
        Json.put(values, "value", value);
        JSONObject payload = new JSONObject();
        Json.put(payload, "uri", "content://settings/" + namespace);
        Json.put(payload, "values", values);
        Json.put(payload, "where", "name = ?");
        Json.put(payload, "where_args", array(name));
        return substrateOp(payload, "content.update");
    }

    private JSONObject mediaList(JSONObject args, String uri) throws CommandException {
        return query(
                uri,
                array("_id", "_display_name", "date_added", "date_modified", "mime_type", "_size"),
                null,
                null,
                "date_added DESC, _id DESC",
                args.optInt("limit", HIGH_LIMIT_FUSE));
    }

    private JSONObject downloadsList(JSONObject args) throws CommandException {
        return query(
                "content://downloads/my_downloads",
                array("_id", "title", "description", "uri", "status", "lastmod", "total_bytes"),
                null,
                null,
                "lastmod DESC, _id DESC",
                args.optInt("limit", HIGH_LIMIT_FUSE));
    }

    private JSONObject downloadsGet(JSONObject args) throws CommandException {
        long downloadId = requiredLong(args, "download_id");
        return query(
                "content://downloads/my_downloads",
                array("_id", "title", "description", "uri", "status", "lastmod", "total_bytes"),
                "_id = ?",
                array(String.valueOf(downloadId)),
                "_id ASC",
                1);
    }

    private JSONObject userDictionaryList(JSONObject args) throws CommandException {
        return query(
                "content://user_dictionary/words",
                array("_id", "word", "frequency", "locale"),
                null,
                null,
                "word ASC, _id ASC",
                args.optInt("limit", HIGH_LIMIT_FUSE));
    }

    private JSONObject userDictionaryAdd(JSONObject args) throws CommandException {
        String word = requiredString(args, "word");
        JSONObject values = new JSONObject();
        Json.put(values, "word", word);
        Json.put(values, "frequency", Math.max(1, Math.min(255, args.optInt("frequency", 128))));
        if (args.has("locale")) {
            Json.put(values, "locale", args.opt("locale"));
        }
        JSONObject payload = new JSONObject();
        Json.put(payload, "uri", "content://user_dictionary/words");
        Json.put(payload, "values", values);
        JSONObject raw = substrateOp(payload, "content.insert");
        if (raw.isNull("inserted_uri")) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "User dictionary insert returned no URI");
        }
        return raw;
    }

    private JSONObject userDictionaryDelete(JSONObject args) throws CommandException {
        JSONObject payload = new JSONObject();
        Json.put(payload, "uri", "content://user_dictionary/words");
        if (args.has("word")) {
            Json.put(payload, "where", "word = ?");
            Json.put(payload, "where_args", array(args.optString("word", "")));
        } else {
            long id = requiredLong(args, "word_id");
            Json.put(payload, "where", "_id = ?");
            Json.put(payload, "where_args", array(String.valueOf(id)));
        }
        return substrateOp(payload, "content.delete");
    }

    private JSONObject query(
            String uri,
            JSONArray projection,
            String where,
            JSONArray whereArgs,
            String sort,
            int limit) throws CommandException {
        JSONObject payload = new JSONObject();
        Json.put(payload, "uri", uri);
        Json.put(payload, "projection", projection);
        Json.put(payload, "sort", sort);
        Json.put(payload, "limit", Math.max(1, Math.min(HIGH_LIMIT_FUSE, limit)));
        if (where != null && !where.trim().isEmpty()) {
            Json.put(payload, "where", where);
        }
        if (whereArgs != null && whereArgs.length() > 0) {
            Json.put(payload, "where_args", whereArgs);
        }
        return substrateOp(payload, "content.query");
    }

    private JSONObject intentAction(JSONObject args, String action) throws CommandException {
        JSONObject payload = copy(args);
        Json.put(payload, "action", action);
        return substrateOp(payload, "intent.start");
    }

    private JSONObject substrateOp(JSONObject args, String op) throws CommandException {
        JSONObject payload = copy(args);
        Json.put(payload, "op", op);
        return substrateController.execute(payload);
    }

    private JSONObject requireLimit(JSONObject args, String command) throws CommandException {
        if (!args.has("limit")) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, command + " requires explicit limit");
        }
        int limit = args.optInt("limit", -1);
        if (limit <= 0) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, command + " requires limit > 0");
        }
        JSONObject out = copy(args);
        Json.put(out, "limit", Math.min(limit, HIGH_LIMIT_FUSE));
        return out;
    }

    private JSONObject calendarValues(JSONObject args, boolean create) throws CommandException {
        JSONObject values = args.optJSONObject("values");
        if (values != null) {
            return copy(values);
        }
        JSONObject out = new JSONObject();
        if (create || args.has("calendar_id")) {
            Json.put(out, "calendar_id", requiredLong(args, "calendar_id"));
        }
        if (create || args.has("title")) {
            Json.put(out, "title", requiredString(args, "title"));
        }
        if (create || args.has("dtstart")) {
            Json.put(out, "dtstart", requiredLong(args, "dtstart"));
        }
        if (create || args.has("dtend")) {
            Json.put(out, "dtend", requiredLong(args, "dtend"));
        }
        if (args.has("location")) {
            Json.put(out, "eventLocation", args.optString("location", ""));
        }
        if (args.has("description")) {
            Json.put(out, "description", args.optString("description", ""));
        }
        if (create || args.has("timezone")) {
            Json.put(out, "eventTimezone", args.optString("timezone", TimeZone.getDefault().getID()));
        }
        if (out.length() == 0) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "android.calendar.update requires values or fields to update");
        }
        return out;
    }

    private String settingsNamespace(JSONObject args) throws CommandException {
        String namespace = args.optString("namespace", "system").trim().toLowerCase(Locale.US);
        if ("system".equals(namespace) || "secure".equals(namespace) || "global".equals(namespace)) {
            return namespace;
        }
        throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "settings namespace must be system, secure, or global");
    }

    private long requiredLong(JSONObject args, String key) throws CommandException {
        String value = requiredString(args, key);
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Invalid long for " + key + ": " + value);
        }
    }

    private String requiredString(JSONObject args, String key) throws CommandException {
        String value = args.optString(key, "").trim();
        if (value.isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Missing required field: " + key);
        }
        return value;
    }

    private JSONObject copy(JSONObject args) throws CommandException {
        if (args == null) {
            return new JSONObject();
        }
        try {
            return new JSONObject(args.toString());
        } catch (JSONException e) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Invalid JSON args");
        }
    }

    private static JSONArray array(String... values) {
        JSONArray out = new JSONArray();
        for (String value : values) {
            Json.add(out, value);
        }
        return out;
    }
}
