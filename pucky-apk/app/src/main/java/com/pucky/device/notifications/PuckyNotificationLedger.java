package com.pucky.device.notifications;

import android.app.Notification;
import android.app.Person;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.provider.Settings;
import android.service.notification.StatusBarNotification;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public final class PuckyNotificationLedger {
    private static final Object LOCK = new Object();
    private static final String FILE_NAME = "pucky-notification-listener.json";
    private static final int DEFAULT_LIMIT = 25;
    private static final int MAX_LIMIT = 200;
    private static final int MAX_RECENT_MESSAGES = 400;

    private PuckyNotificationLedger() {
    }

    public static JSONObject status(Context context) {
        synchronized (LOCK) {
            JSONObject root = ensureRoot(readRoot(context));
            JSONArray active = root.optJSONArray("active_notifications");
            JSONArray recent = root.optJSONArray("recent_messages");
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.notification_listener_status.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "component", listenerComponent(context).flattenToShortString());
            Json.put(out, "access_enabled", isAccessEnabled(context));
            Json.put(out, "listener_connected", root.optBoolean("listener_connected", false));
            Json.put(out, "active_conversation_count", active.length());
            Json.put(out, "recent_message_count", recent.length());
            Json.put(out, "packages", packages(active));
            Json.put(out, "updated_at", root.optString("updated_at", ""));
            return out;
        }
    }

    public static JSONObject messages(Context context, JSONObject args) throws CommandException {
        synchronized (LOCK) {
            int limit = boundedLimit(args);
            long beforeTimestampMs = optionalLong(args, "before_timestamp_ms");
            long beforeId = optionalLong(args, "before_id");
            String packageName = trimmed(args, "package");
            String address = trimmed(args, "address");
            String query = trimmed(args, "query").toLowerCase(Locale.US);
            JSONArray rows = filteredRows(
                    ensureRoot(readRoot(context)).optJSONArray("recent_messages"),
                    limit,
                    beforeTimestampMs,
                    beforeId,
                    packageName,
                    address,
                    query);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.notification_listener_messages.v1");
            Json.put(out, "generated_at", Instant.now().toString());
            Json.put(out, "access_enabled", isAccessEnabled(context));
            Json.put(out, "listener_connected", ensureRoot(readRoot(context)).optBoolean("listener_connected", false));
            Json.put(out, "rows", rows);
            Json.put(out, "count", rows.length());
            return out;
        }
    }

    public static JSONArray smsRowsForAddress(
            Context context,
            String address,
            int limit,
            long beforeTimestampMs,
            long beforeId) {
        synchronized (LOCK) {
            return filteredRows(
                    ensureRoot(readRoot(context)).optJSONArray("recent_messages"),
                    limit,
                    beforeTimestampMs,
                    beforeId,
                    "com.google.android.apps.messaging",
                    address,
                    "");
        }
    }

    public static JSONArray smsRows(Context context, int limit, long beforeTimestampMs, long beforeId) {
        synchronized (LOCK) {
            return filteredRows(
                    ensureRoot(readRoot(context)).optJSONArray("recent_messages"),
                    limit,
                    beforeTimestampMs,
                    beforeId,
                    "com.google.android.apps.messaging",
                    "",
                    "");
        }
    }

    public static void onListenerConnected(Context context, StatusBarNotification[] activeNotifications) {
        synchronized (LOCK) {
            JSONObject root = ensureRoot(readRoot(context));
            Json.put(root, "listener_connected", true);
            Json.put(root, "updated_at", Instant.now().toString());
            JSONArray active = new JSONArray();
            if (activeNotifications != null) {
                for (StatusBarNotification notification : activeNotifications) {
                    JSONObject snapshot = parseSnapshot(notification);
                    if (snapshot == null) {
                        continue;
                    }
                    Json.add(active, snapshot);
                    appendMessages(root.optJSONArray("recent_messages"), snapshot.optJSONArray("messages"));
                }
            }
            Json.put(root, "active_notifications", active);
            writeRoot(context, root);
        }
    }

    public static void onListenerDisconnected(Context context) {
        synchronized (LOCK) {
            JSONObject root = ensureRoot(readRoot(context));
            Json.put(root, "listener_connected", false);
            Json.put(root, "updated_at", Instant.now().toString());
            writeRoot(context, root);
        }
    }

    public static void onNotificationPosted(Context context, StatusBarNotification notification) {
        synchronized (LOCK) {
            JSONObject snapshot = parseSnapshot(notification);
            if (snapshot == null) {
                return;
            }
            JSONObject root = ensureRoot(readRoot(context));
            upsertActive(root.optJSONArray("active_notifications"), snapshot);
            appendMessages(root.optJSONArray("recent_messages"), snapshot.optJSONArray("messages"));
            Json.put(root, "updated_at", Instant.now().toString());
            writeRoot(context, root);
        }
    }

    public static void onNotificationRemoved(Context context, StatusBarNotification notification) {
        synchronized (LOCK) {
            JSONObject root = ensureRoot(readRoot(context));
            removeActive(root.optJSONArray("active_notifications"), notification == null ? "" : notification.getKey());
            Json.put(root, "updated_at", Instant.now().toString());
            writeRoot(context, root);
        }
    }

    private static JSONArray filteredRows(
            JSONArray source,
            int limit,
            long beforeTimestampMs,
            long beforeId,
            String packageName,
            String address,
            String query) {
        List<JSONObject> matches = new ArrayList<>();
        String needleAddress = normalizeDigits(address);
        String needlePackage = packageName == null ? "" : packageName.trim();
        String needleQuery = query == null ? "" : query.trim().toLowerCase(Locale.US);
        for (int i = 0; i < source.length(); i++) {
            JSONObject row = source.optJSONObject(i);
            if (row == null) {
                continue;
            }
            long timestamp = longValue(row, "timestamp_ms");
            long messageId = longValue(row, "synthetic_id");
            if (beforeTimestampMs > 0L && timestamp >= beforeTimestampMs) {
                continue;
            }
            if (beforeTimestampMs <= 0L && beforeId > 0L && messageId >= beforeId) {
                continue;
            }
            if (beforeTimestampMs > 0L && beforeId > 0L && timestamp == beforeTimestampMs && messageId >= beforeId) {
                continue;
            }
            if (!needlePackage.isEmpty() && !needlePackage.equals(row.optString("source_package", ""))) {
                continue;
            }
            if (!needleAddress.isEmpty()
                    && !numbersEquivalent(needleAddress, normalizeDigits(row.optString("address", "")))) {
                continue;
            }
            if (!needleQuery.isEmpty()) {
                String haystack = (row.optString("body", "") + "\n"
                        + row.optString("conversation_title", "") + "\n"
                        + row.optString("sender_name", "")).toLowerCase(Locale.US);
                if (!haystack.contains(needleQuery)) {
                    continue;
                }
            }
            matches.add(row);
        }
        matches.sort(Comparator
                .comparingLong((JSONObject row) -> longValue(row, "timestamp_ms"))
                .thenComparingLong(row -> longValue(row, "synthetic_id"))
                .reversed());
        JSONArray out = new JSONArray();
        for (JSONObject row : matches) {
            if (out.length() >= limit) {
                break;
            }
            Json.add(out, row);
        }
        return out;
    }

    private static JSONObject parseSnapshot(StatusBarNotification notification) {
        if (notification == null || notification.getNotification() == null) {
            return null;
        }
        Bundle extras = notification.getNotification().extras;
        if (extras == null) {
            return null;
        }
        JSONArray messages = parseMessages(notification, extras);
        if (messages.length() == 0) {
            return null;
        }
        String title = stringFromCharSequence(extras.getCharSequence(Notification.EXTRA_TITLE));
        String conversationTitle = stringFromCharSequence(extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE));
        String address = firstNonEmpty(
                addressFromText(conversationTitle),
                addressFromText(title),
                messages.optJSONObject(0) == null ? "" : messages.optJSONObject(0).optString("address", ""));
        JSONObject snapshot = new JSONObject();
        Json.put(snapshot, "notification_key", notification.getKey());
        Json.put(snapshot, "source_package", notification.getPackageName());
        Json.put(snapshot, "post_time", notification.getPostTime());
        Json.put(snapshot, "title", title);
        Json.put(snapshot, "conversation_title", conversationTitle);
        Json.put(snapshot, "address", address);
        Json.put(snapshot, "normalized_address", normalizeDigits(address));
        Json.put(snapshot, "messages", messages);
        return snapshot;
    }

    private static JSONArray parseMessages(StatusBarNotification notification, Bundle extras) {
        JSONArray out = new JSONArray();
        Parcelable[] rawMessages = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        if (rawMessages == null || rawMessages.length == 0) {
            return out;
        }
        List<Notification.MessagingStyle.Message> messages =
                Notification.MessagingStyle.Message.getMessagesFromBundleArray(rawMessages);
        if (messages == null || messages.isEmpty()) {
            return out;
        }
        String title = stringFromCharSequence(extras.getCharSequence(Notification.EXTRA_TITLE));
        String conversationTitle = stringFromCharSequence(extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE));
        String fallbackAddress = firstNonEmpty(addressFromText(conversationTitle), addressFromText(title));
        for (int i = 0; i < messages.size(); i++) {
            Notification.MessagingStyle.Message message = messages.get(i);
            CharSequence textValue = message.getText();
            if (textValue == null || textValue.toString().trim().isEmpty()) {
                continue;
            }
            String senderName = senderName(message);
            String senderUri = senderUri(message);
            String rowAddress = firstNonEmpty(
                    addressFromText(senderUri),
                    addressFromText(senderName),
                    fallbackAddress);
            long timestampMs = message.getTimestamp() > 0L ? message.getTimestamp() : notification.getPostTime();
            long syntheticId = syntheticId(notification.getKey(), timestampMs, i, textValue.toString());
            JSONObject row = new JSONObject();
            Json.put(row, "message_id", String.valueOf(syntheticId));
            Json.put(row, "synthetic_id", syntheticId);
            Json.put(row, "thread_id", normalizeDigits(rowAddress).isEmpty()
                    ? "notify:" + Math.abs(notification.getKey().hashCode())
                    : "notify:" + normalizeDigits(rowAddress));
            Json.put(row, "address", rowAddress);
            Json.put(row, "body", textValue.toString());
            Json.put(row, "timestamp_ms", timestampMs);
            Json.put(row, "direction", inferDirection(senderName));
            Json.put(row, "read", false);
            Json.put(row, "seen", true);
            Json.put(row, "status", JSONObject.NULL);
            Json.put(row, "creator", JSONObject.NULL);
            Json.put(row, "source", "notification_listener");
            Json.put(row, "source_package", notification.getPackageName());
            Json.put(row, "conversation_title", firstNonEmpty(conversationTitle, title));
            Json.put(row, "sender_name", senderName.isEmpty() ? JSONObject.NULL : senderName);
            Json.put(row, "sender_uri", senderUri.isEmpty() ? JSONObject.NULL : senderUri);
            Json.put(row, "notification_key", notification.getKey());
            Json.add(out, row);
        }
        return out;
    }

    private static void upsertActive(JSONArray active, JSONObject snapshot) {
        String key = snapshot.optString("notification_key", "");
        for (int i = 0; i < active.length(); i++) {
            JSONObject existing = active.optJSONObject(i);
            if (existing != null && key.equals(existing.optString("notification_key", ""))) {
                try {
                    active.put(i, snapshot);
                } catch (Exception e) {
                    throw new IllegalStateException(e);
                }
                return;
            }
        }
        Json.add(active, snapshot);
    }

    private static void removeActive(JSONArray active, String key) {
        if (key == null || key.trim().isEmpty()) {
            return;
        }
        JSONArray kept = new JSONArray();
        for (int i = 0; i < active.length(); i++) {
            JSONObject existing = active.optJSONObject(i);
            if (existing == null) {
                continue;
            }
            if (!key.equals(existing.optString("notification_key", ""))) {
                Json.add(kept, existing);
            }
        }
        while (active.length() > 0) {
            active.remove(0);
        }
        for (int i = 0; i < kept.length(); i++) {
            Json.add(active, kept.optJSONObject(i));
        }
    }

    private static void appendMessages(JSONArray recentMessages, JSONArray messages) {
        if (messages == null) {
            return;
        }
        Set<String> seen = new LinkedHashSet<>();
        for (int i = 0; i < recentMessages.length(); i++) {
            JSONObject existing = recentMessages.optJSONObject(i);
            if (existing != null) {
                seen.add(eventKey(existing));
            }
        }
        for (int i = 0; i < messages.length(); i++) {
            JSONObject row = messages.optJSONObject(i);
            if (row == null) {
                continue;
            }
            String key = eventKey(row);
            if (seen.add(key)) {
                Json.add(recentMessages, row);
            }
        }
        List<JSONObject> sorted = new ArrayList<>();
        for (int i = 0; i < recentMessages.length(); i++) {
            JSONObject row = recentMessages.optJSONObject(i);
            if (row != null) {
                sorted.add(row);
            }
        }
        sorted.sort(Comparator
                .comparingLong((JSONObject row) -> longValue(row, "timestamp_ms"))
                .thenComparingLong(row -> longValue(row, "synthetic_id"))
                .reversed());
        while (recentMessages.length() > 0) {
            recentMessages.remove(0);
        }
        for (int i = 0; i < sorted.size() && i < MAX_RECENT_MESSAGES; i++) {
            Json.add(recentMessages, sorted.get(i));
        }
    }

    private static String eventKey(JSONObject row) {
        return row.optString("source_package", "") + "|"
                + normalizeDigits(row.optString("address", "")) + "|"
                + longValue(row, "timestamp_ms") + "|"
                + row.optString("body", "");
    }

    private static JSONArray packages(JSONArray active) {
        JSONArray out = new JSONArray();
        Set<String> seen = new LinkedHashSet<>();
        for (int i = 0; i < active.length(); i++) {
            JSONObject row = active.optJSONObject(i);
            if (row == null) {
                continue;
            }
            String packageName = row.optString("source_package", "");
            if (!packageName.isEmpty() && seen.add(packageName)) {
                Json.add(out, packageName);
            }
        }
        return out;
    }

    private static JSONObject ensureRoot(JSONObject root) {
        if (root == null) {
            root = new JSONObject();
        }
        if (root.optJSONArray("active_notifications") == null) {
            Json.put(root, "active_notifications", new JSONArray());
        }
        if (root.optJSONArray("recent_messages") == null) {
            Json.put(root, "recent_messages", new JSONArray());
        }
        if (!root.has("listener_connected")) {
            Json.put(root, "listener_connected", false);
        }
        if (!root.has("updated_at")) {
            Json.put(root, "updated_at", Instant.now().toString());
        }
        return root;
    }

    private static JSONObject readRoot(Context context) {
        File file = file(context);
        if (!file.exists()) {
            return ensureRoot(new JSONObject());
        }
        StringBuilder text = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) {
                text.append(line);
            }
            return ensureRoot(new JSONObject(text.toString()));
        } catch (Exception ignored) {
            return ensureRoot(new JSONObject());
        }
    }

    private static void writeRoot(Context context, JSONObject root) {
        try (FileWriter writer = new FileWriter(file(context), false)) {
            writer.write(root.toString());
        } catch (IOException ignored) {
        }
    }

    private static File file(Context context) {
        return new File(context.getFilesDir(), FILE_NAME);
    }

    private static ComponentName listenerComponent(Context context) {
        return new ComponentName(context, PuckyNotificationListenerService.class);
    }

    private static boolean isAccessEnabled(Context context) {
        String raw = Settings.Secure.getString(context.getContentResolver(), "enabled_notification_listeners");
        if (raw == null || raw.trim().isEmpty()) {
            return false;
        }
        String exact = listenerComponent(context).flattenToString();
        String shortName = listenerComponent(context).flattenToShortString();
        String[] entries = raw.split(":");
        for (String entry : entries) {
            if (exact.equals(entry) || shortName.equals(entry)) {
                return true;
            }
        }
        return false;
    }

    private static int boundedLimit(JSONObject args) {
        return Math.max(1, Math.min(MAX_LIMIT, args == null ? DEFAULT_LIMIT : args.optInt("limit", DEFAULT_LIMIT)));
    }

    private static long optionalLong(JSONObject args, String key) throws CommandException {
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

    private static String trimmed(JSONObject args, String key) {
        return args == null ? "" : args.optString(key, "").trim();
    }

    private static long syntheticId(String key, long timestampMs, int index, String body) {
        long hash = Math.abs((key + "|" + timestampMs + "|" + index + "|" + body).hashCode());
        return timestampMs * 1000L + (hash % 997L);
    }

    private static String inferDirection(String senderName) {
        String normalized = senderName == null ? "" : senderName.trim().toLowerCase(Locale.US);
        if ("you".equals(normalized) || "me".equals(normalized)) {
            return "outbound";
        }
        return "inbound";
    }

    private static String senderName(Notification.MessagingStyle.Message message) {
        if (Build.VERSION.SDK_INT >= 28) {
            Person person = message.getSenderPerson();
            if (person != null && person.getName() != null) {
                return person.getName().toString();
            }
        }
        CharSequence sender = message.getSender();
        return sender == null ? "" : sender.toString();
    }

    private static String senderUri(Notification.MessagingStyle.Message message) {
        if (Build.VERSION.SDK_INT < 28) {
            return "";
        }
        Person person = message.getSenderPerson();
        return person == null || person.getUri() == null ? "" : person.getUri();
    }

    private static String stringFromCharSequence(CharSequence value) {
        return value == null ? "" : value.toString();
    }

    private static String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }
        return "";
    }

    private static String addressFromText(String value) {
        String digits = normalizeDigits(value);
        if (digits.isEmpty()) {
            return "";
        }
        return digits;
    }

    private static String normalizeDigits(String value) {
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

    private static boolean numbersEquivalent(String left, String right) {
        if (left == null || right == null || left.isEmpty() || right.isEmpty()) {
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
            return leftDigits.substring(leftDigits.length() - 10)
                    .equals(rightDigits.substring(rightDigits.length() - 10));
        }
        return false;
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
}
