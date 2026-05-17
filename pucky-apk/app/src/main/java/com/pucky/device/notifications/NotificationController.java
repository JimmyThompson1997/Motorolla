package com.pucky.device.notifications;

import com.pucky.device.util.Json;

import android.Manifest;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;

import org.json.JSONArray;
import org.json.JSONObject;

public final class NotificationController {
    private static final String CHANNEL_ID = "pucky_commands";
    private static final String AUDIBLE_CHANNEL_ID = "pucky_commands_audible_v1";
    private static final int NOTIFICATION_ID = 41002;

    private final Context context;

    public NotificationController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject show(JSONObject args) throws CommandException {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "POST_NOTIFICATIONS is not granted");
        }
        createChannel();
        int notificationId = notificationId(args);
        boolean audible = args.optBoolean("audible", false) && !args.optBoolean("silent", false);
        String defaultChannel = audible ? AUDIBLE_CHANNEL_ID : CHANNEL_ID;
        String channelId = args.optString("channel_id", args.optString("channel", defaultChannel));
        ensureChannel(
                channelId,
                args.optString("channel_name", audible ? "Pucky audible commands" : "Pucky commands"),
                audible);
        String title = args.optString("title", "Pucky");
        String text = args.optString("text", "Pucky notification");
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, channelId)
                : new Notification.Builder(context);
        builder
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_notify_more)
                .setAutoCancel(args.optBoolean("auto_cancel", true))
                .setOngoing(args.optBoolean("ongoing", false))
                .setOnlyAlertOnce(args.optBoolean("only_alert_once", !audible));
        if (audible) {
            builder.setDefaults(Notification.DEFAULT_SOUND);
            if (Build.VERSION.SDK_INT < 26) {
                builder.setPriority(Notification.PRIORITY_HIGH);
            }
        }
        if (Build.VERSION.SDK_INT >= 26) {
            builder.setTimeoutAfter(Math.max(0, args.optLong("timeout_ms", 0)));
        }
        String bigText = args.optString("big_text", "");
        if (!bigText.trim().isEmpty()) {
            builder.setStyle(new Notification.BigTextStyle().bigText(bigText));
        }
        Notification notification = builder.build();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "NotificationManager unavailable");
        }
        manager.notify(notificationId, notification);
        JSONObject out = new JSONObject();
        Json.put(out, "shown", true);
        Json.put(out, "id", notificationId);
        Json.put(out, "channel", channelId);
        Json.put(out, "sound", audible);
        Json.put(out, "vibration", false);
        return out;
    }

    public JSONObject ask(String commandId, JSONObject args) throws CommandException {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "POST_NOTIFICATIONS is not granted");
        }
        createChannel();
        int notificationId = notificationId(args);
        boolean audible = args.optBoolean("audible", false) && !args.optBoolean("silent", false);
        String channelId = args.optString("channel_id", args.optString("channel", audible ? AUDIBLE_CHANNEL_ID : CHANNEL_ID));
        ensureChannel(
                channelId,
                args.optString("channel_name", audible ? "Pucky audible asks" : "Pucky asks"),
                audible);
        String title = args.optString("title", "Pucky");
        String text = args.optString("text", "Reply to Pucky");
        String promptId = args.optString("prompt_id", commandId);
        Intent replyIntent = new Intent(context, NotificationReplyReceiver.class)
                .setAction(NotificationReplyReceiver.ACTION_REPLY)
                .putExtra(NotificationReplyReceiver.EXTRA_COMMAND_ID, commandId)
                .putExtra(NotificationReplyReceiver.EXTRA_PROMPT_ID, promptId)
                .putExtra(NotificationReplyReceiver.EXTRA_NOTIFICATION_ID, notificationId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        PendingIntent replyPendingIntent = PendingIntent.getBroadcast(
                context,
                notificationId,
                replyIntent,
                flags);
        RemoteInput remoteInput = new RemoteInput.Builder(NotificationReplyReceiver.KEY_TEXT_REPLY)
                .setLabel(args.optString("reply_label", "Reply"))
                .build();
        Notification.Action replyAction = new Notification.Action.Builder(
                android.R.drawable.ic_menu_send,
                args.optString("action_title", "Reply"),
                replyPendingIntent)
                .addRemoteInput(remoteInput)
                .setAllowGeneratedReplies(false)
                .build();
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, channelId)
                : new Notification.Builder(context);
        builder
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_notify_more)
                .setAutoCancel(false)
                .setOngoing(args.optBoolean("ongoing", false))
                .setOnlyAlertOnce(args.optBoolean("only_alert_once", !audible))
                .addAction(replyAction);
        if (audible) {
            builder.setDefaults(Notification.DEFAULT_SOUND);
            if (Build.VERSION.SDK_INT < 26) {
                builder.setPriority(Notification.PRIORITY_HIGH);
            }
        }
        String bigText = args.optString("big_text", "");
        if (!bigText.trim().isEmpty()) {
            builder.setStyle(new Notification.BigTextStyle().bigText(bigText));
        }
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "NotificationManager unavailable");
        }
        manager.notify(notificationId, builder.build());
        JSONObject out = new JSONObject();
        Json.put(out, "shown", true);
        Json.put(out, "reply_enabled", true);
        Json.put(out, "id", notificationId);
        Json.put(out, "channel", channelId);
        Json.put(out, "prompt_id", promptId);
        Json.put(out, "command_id", commandId);
        Json.put(out, "sound", audible);
        return out;
    }

    public JSONObject cancel(JSONObject args) throws CommandException {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "NotificationManager unavailable");
        }
        int notificationId = notificationId(args);
        manager.cancel(notificationId);
        JSONObject out = new JSONObject();
        Json.put(out, "cancel_requested", true);
        Json.put(out, "id", notificationId);
        return out;
    }

    public JSONObject active(JSONObject args) throws CommandException {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "NotificationManager unavailable");
        }
        JSONArray active = new JSONArray();
        if (Build.VERSION.SDK_INT >= 23) {
            for (StatusBarNotification notification : manager.getActiveNotifications()) {
                JSONObject item = new JSONObject();
                Json.put(item, "id", notification.getId());
                Json.put(item, "tag", notification.getTag() == null ? JSONObject.NULL : notification.getTag());
                Json.put(item, "package", notification.getPackageName());
                Json.put(item, "post_time", notification.getPostTime());
                Json.add(active, item);
            }
        }
        JSONObject out = new JSONObject();
        Json.put(out, "available", Build.VERSION.SDK_INT >= 23);
        Json.put(out, "active", active);
        return out;
    }

    public JSONObject channels(JSONObject args) {
        JSONObject out = new JSONObject();
        JSONArray channels = new JSONArray();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            for (NotificationChannel channel : manager.getNotificationChannels()) {
                JSONObject item = new JSONObject();
                Json.put(item, "id", channel.getId());
                Json.put(item, "name", String.valueOf(channel.getName()));
                Json.put(item, "importance", channel.getImportance());
                Json.put(item, "sound", channel.getSound() == null ? JSONObject.NULL : channel.getSound().toString());
                Json.put(item, "vibration", channel.shouldVibrate());
                Json.add(channels, item);
            }
        }
        Json.put(out, "available", Build.VERSION.SDK_INT >= 26);
        Json.put(out, "channels", channels);
        return out;
    }

    private void createChannel() {
        ensureChannel(CHANNEL_ID, "Pucky commands", false);
        ensureChannel(AUDIBLE_CHANNEL_ID, "Pucky audible commands", true);
    }

    private void ensureChannel(String id, String name, boolean audible) {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                id == null || id.trim().isEmpty() ? CHANNEL_ID : id,
                name == null || name.trim().isEmpty() ? "Pucky commands" : name,
                audible ? NotificationManager.IMPORTANCE_HIGH : NotificationManager.IMPORTANCE_LOW);
        if (!audible) {
            channel.setSound(null, null);
        }
        channel.enableVibration(false);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }

    private int notificationId(JSONObject args) {
        if (args.has("numeric_id")) {
            return args.optInt("numeric_id", NOTIFICATION_ID);
        }
        String id = args.optString("id", "");
        if (id.trim().isEmpty()) {
            return NOTIFICATION_ID;
        }
        return id.hashCode();
    }
}

