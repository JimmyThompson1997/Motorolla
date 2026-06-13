package com.pucky.device.notifications;

import android.Manifest;
import android.app.Notification;
import android.app.Notification.Action;
import android.app.Notification.Builder;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import com.pucky.device.CoverHomeActivity;
import com.pucky.device.MainActivity;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.phone.PhoneHubActivity;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

public final class NotificationController {
    private static final int DEFAULT_NOTIFICATION_ID = 41002;

    private final Context context;
    private final NotificationCompanionCueController companionCueController;
    private final NotificationPolicyController policyController;

    public NotificationController(Context context) {
        this.context = context.getApplicationContext();
        this.companionCueController = new NotificationCompanionCueController(this.context);
        this.policyController = new NotificationPolicyController(this.context);
    }

    public JSONObject show(JSONObject args) throws CommandException {
        return show("", args);
    }

    public JSONObject show(String commandId, JSONObject args) throws CommandException {
        ensureNotificationPermission();
        NotificationPayloadNormalizer.NormalizedPayload payload =
                NotificationPayloadNormalizer.normalize(commandId, args);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "NotificationManager unavailable");
        }
        DynamicNotificationChannelRegistry.ChannelResult channelResult =
                new DynamicNotificationChannelRegistry(context, manager).ensure(payload);
        int notificationId = notificationId(payload.raw);
        String effectiveSurfaceMode = payload.surfaceMode;
        String degradedTo = "";
        JSONArray warnings = new JSONArray();
        appendWarnings(warnings, channelResult.warnings);

        Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, channelResult.channelId)
                : new Notification.Builder(context);
        builder.setContentTitle(payload.title)
                .setContentText(payload.text)
                .setContentIntent(contentIntent(notificationId, "main"))
                .setSmallIcon(android.R.drawable.stat_notify_more)
                .setAutoCancel(payload.autoCancel)
                .setOngoing(payload.ongoing)
                .setOnlyAlertOnce(payload.onlyAlertOnce)
                .setLocalOnly(payload.localOnly)
                .setCategory(categoryValue(payload.category));
        if (payload.whenMs > 0L) {
            builder.setWhen(payload.whenMs);
            builder.setShowWhen(true);
        }
        if (payload.useChronometer) {
            builder.setUsesChronometer(true);
            if (Build.VERSION.SDK_INT >= 24) {
                builder.setChronometerCountDown(payload.countdownChronometer);
            }
        }
        if (!payload.bigText.isEmpty()) {
            builder.setStyle(new Notification.BigTextStyle().bigText(payload.bigText));
        }
        if (!payload.groupKey.isEmpty()) {
            builder.setGroup(payload.groupKey);
            builder.setGroupSummary(payload.groupSummary);
            if (Build.VERSION.SDK_INT >= 26) {
                builder.setGroupAlertBehavior(groupAlertBehavior(payload.groupAlertBehavior));
            }
        }
        if (Build.VERSION.SDK_INT >= 26 && payload.timeoutMs > 0L) {
            builder.setTimeoutAfter(payload.timeoutMs);
        }
        if (Build.VERSION.SDK_INT < 26) {
            builder.setPriority(priorityFor(payload.importance, payload.surfaceMode));
            int defaults = 0;
            if (!payload.silent && (payload.defaultSound || !payload.soundUri.isEmpty())) {
                defaults |= Notification.DEFAULT_SOUND;
            }
            if (payload.vibrationPatternMs.length > 0) {
                defaults |= Notification.DEFAULT_VIBRATE;
                builder.setVibrate(payload.vibrationPatternMs);
            }
            if (defaults != 0) {
                builder.setDefaults(defaults);
            }
        }

        for (NotificationPayloadNormalizer.ActionSpec action : payload.actions) {
            builder.addAction(buildAction(notificationId, payload, action));
        }

        if ("full_screen".equals(payload.surfaceMode)) {
            if (policyController.canUseFullScreenIntent(manager)) {
                builder.setFullScreenIntent(contentIntent(notificationId + 7000, payload.fullScreenActivity), true);
            } else {
                degradedTo = "heads_up";
                effectiveSurfaceMode = "heads_up";
                Json.add(warnings, "full_screen_permission_missing");
            }
        }

        Notification notification = builder.build();
        if (payload.noClear) {
            notification.flags |= Notification.FLAG_NO_CLEAR;
        }
        manager.notify(notificationId, notification);
        if (payload.manualTone.enabled || payload.manualHaptic.enabled) {
            companionCueController.play(notificationId, payload.manualTone, payload.manualHaptic, payload.repeatUntilCancelled);
        }

        JSONObject out = new JSONObject();
        Json.put(out, "shown", true);
        Json.put(out, "id", notificationId);
        Json.put(out, "notification_key", payload.id.isEmpty() ? JSONObject.NULL : payload.id);
        Json.put(out, "command_id", payload.commandId.isEmpty() ? JSONObject.NULL : payload.commandId);
        Json.put(out, "channel", channelResult.channelId);
        Json.put(out, "requested_surface_mode", payload.surfaceMode);
        Json.put(out, "effective_surface_mode", effectiveSurfaceMode);
        Json.put(out, "degraded_to", degradedTo.isEmpty() ? JSONObject.NULL : degradedTo);
        Json.put(out, "category", payload.category);
        Json.put(out, "importance", payload.importance);
        Json.put(out, "sound", !payload.silent && (payload.defaultSound || !payload.soundUri.isEmpty()));
        Json.put(out, "vibration", payload.vibrationPatternMs.length > 0);
        Json.put(out, "manual_tone", payload.manualTone.enabled);
        Json.put(out, "manual_haptic", payload.manualHaptic.enabled);
        Json.put(out, "repeat_until_cancelled", payload.repeatUntilCancelled);
        Json.put(out, "channel_result", channelResult.toJson());
        Json.put(out, "warnings", warnings);
        return out;
    }

    public JSONObject ask(String commandId, JSONObject args) throws CommandException {
        JSONObject payload = NotificationPayloadNormalizer.askPayload(commandId, args);
        Json.put(payload, "_legacy_ask", true);
        return show(commandId, payload);
    }

    public JSONObject cancel(JSONObject args) throws CommandException {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "NotificationManager unavailable");
        }
        int notificationId = notificationId(args);
        companionCueController.cancel(notificationId);
        manager.cancel(notificationId);
        JSONObject out = new JSONObject();
        Json.put(out, "cancel_requested", true);
        Json.put(out, "id", notificationId);
        return out;
    }

    public JSONObject active(JSONObject args) throws CommandException {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
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
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && manager != null) {
            for (android.app.NotificationChannel channel : manager.getNotificationChannels()) {
                JSONObject item = new JSONObject();
                Json.put(item, "id", channel.getId());
                Json.put(item, "name", String.valueOf(channel.getName()));
                Json.put(item, "importance", channel.getImportance());
                Json.put(item, "sound", channel.getSound() == null ? JSONObject.NULL : channel.getSound().toString());
                Json.put(item, "vibration", channel.shouldVibrate());
                Json.put(item, "bypass_dnd", channel.canBypassDnd());
                Json.add(channels, item);
            }
        }
        Json.put(out, "available", Build.VERSION.SDK_INT >= 26);
        Json.put(out, "channels", channels);
        return out;
    }

    public JSONObject policyStatus(JSONObject args) {
        return policyController.status();
    }

    public JSONObject policyOpenSettings(JSONObject args) throws CommandException {
        return policyController.openSettings(args == null ? new JSONObject() : args);
    }

    public JSONObject listenerStatus(JSONObject args) {
        return PuckyNotificationLedger.status(context);
    }

    public JSONObject listenerMessages(JSONObject args) throws CommandException {
        return PuckyNotificationLedger.messages(context, args == null ? new JSONObject() : args);
    }

    private void ensureNotificationPermission() throws CommandException {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            throw new CommandException(CommandErrorCodes.PERMISSION_MISSING, "POST_NOTIFICATIONS is not granted");
        }
    }

    private Action buildAction(
            int notificationId,
            NotificationPayloadNormalizer.NormalizedPayload payload,
            NotificationPayloadNormalizer.ActionSpec action) {
        Intent intent = new Intent(context, NotificationReplyReceiver.class)
                .putExtra(NotificationReplyReceiver.EXTRA_COMMAND_ID, payload.commandId)
                .putExtra(NotificationReplyReceiver.EXTRA_PROMPT_ID, action.promptId)
                .putExtra(NotificationReplyReceiver.EXTRA_NOTIFICATION_ID, notificationId)
                .putExtra(NotificationReplyReceiver.EXTRA_NOTIFICATION_KEY, payload.id)
                .putExtra(NotificationReplyReceiver.EXTRA_ACTION_ID, action.id)
                .putExtra(NotificationReplyReceiver.EXTRA_ACTION_KIND, action.kind)
                .putExtra(NotificationReplyReceiver.EXTRA_LEGACY_ASK, payload.raw.optBoolean("_legacy_ask", false));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        if ("reply".equals(action.kind)) {
            intent.setAction(NotificationReplyReceiver.ACTION_REPLY);
            PendingIntent replyPendingIntent = PendingIntent.getBroadcast(context, notificationId + action.id.hashCode(), intent, flags);
            RemoteInput remoteInput = new RemoteInput.Builder(NotificationReplyReceiver.KEY_TEXT_REPLY)
                    .setLabel(action.replyLabel)
                    .build();
            return new Notification.Action.Builder(
                    android.R.drawable.ic_menu_send,
                    action.title,
                    replyPendingIntent)
                    .addRemoteInput(remoteInput)
                    .setAllowGeneratedReplies(false)
                    .build();
        }
        intent.setAction(NotificationReplyReceiver.ACTION_CALLBACK);
        PendingIntent callbackPendingIntent = PendingIntent.getBroadcast(context, notificationId + action.id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Action.Builder(
                android.R.drawable.ic_menu_view,
                action.title,
                callbackPendingIntent)
                .build();
    }

    private PendingIntent contentIntent(int requestCode, String activityKey) throws CommandException {
        Intent intent;
        switch (String.valueOf(activityKey == null ? "" : activityKey).trim().toLowerCase(Locale.US)) {
            case "":
            case "main":
            case "settings":
                intent = new Intent(context, MainActivity.class);
                break;
            case "cover_home":
            case "home":
                intent = new Intent(context, CoverHomeActivity.class);
                break;
            case "phone_hub":
            case "phone":
                intent = new Intent(context, PhoneHubActivity.class);
                break;
            default:
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Unsupported full_screen_activity: " + activityKey);
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private int notificationId(JSONObject args) {
        if (args.has("numeric_id")) {
            return Math.max(1, args.optInt("numeric_id", DEFAULT_NOTIFICATION_ID));
        }
        String id = args.optString("id", "");
        if (id.trim().isEmpty()) {
            return DEFAULT_NOTIFICATION_ID;
        }
        int hash = id.hashCode();
        if (hash == Integer.MIN_VALUE) {
            return DEFAULT_NOTIFICATION_ID;
        }
        return Math.max(1, Math.abs(hash));
    }

    private static int priorityFor(int importance, String surfaceMode) {
        if ("full_screen".equals(surfaceMode)) {
            return Notification.PRIORITY_MAX;
        }
        if (importance >= 4) {
            return Notification.PRIORITY_HIGH;
        }
        if (importance >= 3) {
            return Notification.PRIORITY_DEFAULT;
        }
        if (importance >= 2) {
            return Notification.PRIORITY_LOW;
        }
        return Notification.PRIORITY_MIN;
    }

    private static int groupAlertBehavior(String value) {
        if ("summary".equals(value)) {
            return Notification.GROUP_ALERT_SUMMARY;
        }
        if ("children".equals(value)) {
            return Notification.GROUP_ALERT_CHILDREN;
        }
        return Notification.GROUP_ALERT_ALL;
    }

    private static String categoryValue(String category) {
        switch (String.valueOf(category).trim().toLowerCase(Locale.US)) {
            case "reminder":
                return Notification.CATEGORY_REMINDER;
            case "alarm":
                return Notification.CATEGORY_ALARM;
            case "call":
                return Notification.CATEGORY_CALL;
            case "message":
                return Notification.CATEGORY_MESSAGE;
            case "event":
                return Notification.CATEGORY_EVENT;
            case "service":
                return Notification.CATEGORY_SERVICE;
            case "status":
            default:
                return Notification.CATEGORY_STATUS;
        }
    }

    private static void appendWarnings(JSONArray target, JSONArray source) {
        if (target == null || source == null) {
            return;
        }
        for (int index = 0; index < source.length(); index++) {
            Json.add(target, source.opt(index));
        }
    }
}
