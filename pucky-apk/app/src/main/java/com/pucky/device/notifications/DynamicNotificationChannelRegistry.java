package com.pucky.device.notifications;

import android.app.NotificationChannel;
import android.app.NotificationChannelGroup;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

public final class DynamicNotificationChannelRegistry {
    private static final String CHANNEL_PREFIX = "pucky_notify_";

    private final Context context;
    private final NotificationManager manager;

    public DynamicNotificationChannelRegistry(Context context, NotificationManager manager) {
        this.context = context.getApplicationContext();
        this.manager = manager;
    }

    public ChannelResult ensure(NotificationPayloadNormalizer.NormalizedPayload payload) {
        if (Build.VERSION.SDK_INT < 26 || manager == null) {
            return ChannelResult.preO(payload);
        }
        String channelId = payload.channel.requestedId == null || payload.channel.requestedId.trim().isEmpty()
                ? CHANNEL_PREFIX + payload.channel.profileKey
                : payload.channel.requestedId.trim();
        String channelName = payload.channel.requestedName == null || payload.channel.requestedName.trim().isEmpty()
                ? "Pucky notifications"
                : payload.channel.requestedName.trim();
        if (!payload.channel.requestedGroupId.trim().isEmpty()) {
            NotificationChannelGroup group = new NotificationChannelGroup(
                    payload.channel.requestedGroupId,
                    payload.channel.requestedGroupName == null || payload.channel.requestedGroupName.trim().isEmpty()
                            ? "Pucky"
                            : payload.channel.requestedGroupName.trim());
            manager.createNotificationChannelGroup(group);
        }
        NotificationChannel channel = new NotificationChannel(channelId, channelName, payload.importance);
        channel.setDescription("Pucky raw notification payload channel");
        if (!payload.channel.requestedGroupId.trim().isEmpty()) {
            channel.setGroup(payload.channel.requestedGroupId.trim());
        }
        channel.setShowBadge(!payload.localOnly);
        if (payload.silent) {
            channel.setSound(null, null);
            channel.enableVibration(false);
        } else {
            Uri sound = null;
            if (payload.soundUri != null && !payload.soundUri.trim().isEmpty()) {
                sound = Uri.parse(payload.soundUri.trim());
            } else if (payload.defaultSound) {
                sound = Settings.System.DEFAULT_NOTIFICATION_URI;
            }
            if (sound != null) {
                channel.setSound(sound, new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
            } else {
                channel.setSound(null, null);
            }
            if (payload.vibrationPatternMs.length > 0) {
                channel.enableVibration(true);
                channel.setVibrationPattern(payload.vibrationPatternMs);
            } else {
                channel.enableVibration(false);
            }
        }
        boolean requestedBypassDnd = payload.bypassDndIfAllowed;
        boolean policyGranted = manager.isNotificationPolicyAccessGranted();
        if (requestedBypassDnd && policyGranted) {
            channel.setBypassDnd(true);
        }
        manager.createNotificationChannel(channel);
        NotificationChannel effective = manager.getNotificationChannel(channelId);
        return ChannelResult.from(channelId, payload, effective, requestedBypassDnd, policyGranted);
    }

    public static final class ChannelResult {
        public final boolean available;
        public final String channelId;
        public final String profileKey;
        public final boolean policyAccessGranted;
        public final JSONArray warnings;
        public final JSONObject requested;
        public final JSONObject effective;

        private ChannelResult(
                boolean available,
                String channelId,
                String profileKey,
                boolean policyAccessGranted,
                JSONArray warnings,
                JSONObject requested,
                JSONObject effective) {
            this.available = available;
            this.channelId = channelId;
            this.profileKey = profileKey;
            this.policyAccessGranted = policyAccessGranted;
            this.warnings = warnings;
            this.requested = requested;
            this.effective = effective;
        }

        public static ChannelResult preO(NotificationPayloadNormalizer.NormalizedPayload payload) {
            JSONArray warnings = new JSONArray();
            Json.add(warnings, "notification_channels_unavailable_pre_api_26");
            return new ChannelResult(false, "", payload.channel.profileKey, false, warnings, new JSONObject(), new JSONObject());
        }

        public static ChannelResult from(
                String channelId,
                NotificationPayloadNormalizer.NormalizedPayload payload,
                NotificationChannel effectiveChannel,
                boolean requestedBypassDnd,
                boolean policyGranted) {
            JSONArray warnings = new JSONArray();
            JSONObject requested = new JSONObject();
            Json.put(requested, "id", channelId);
            Json.put(requested, "importance", payload.importance);
            Json.put(requested, "default_sound", payload.defaultSound);
            Json.put(requested, "sound_uri", payload.soundUri == null || payload.soundUri.trim().isEmpty() ? JSONObject.NULL : payload.soundUri);
            Json.put(requested, "vibration", payload.vibrationPatternMs.length > 0);
            Json.put(requested, "vibration_pattern_ms", arrayOf(payload.vibrationPatternMs));
            Json.put(requested, "bypass_dnd", requestedBypassDnd);

            JSONObject effective = new JSONObject();
            if (effectiveChannel != null) {
                Json.put(effective, "id", effectiveChannel.getId());
                Json.put(effective, "name", String.valueOf(effectiveChannel.getName()));
                Json.put(effective, "importance", effectiveChannel.getImportance());
                Json.put(effective, "sound_uri",
                        effectiveChannel.getSound() == null ? JSONObject.NULL : effectiveChannel.getSound().toString());
                Json.put(effective, "vibration", effectiveChannel.shouldVibrate());
                Json.put(effective, "vibration_pattern_ms", arrayOf(effectiveChannel.getVibrationPattern()));
                Json.put(effective, "bypass_dnd", effectiveChannel.canBypassDnd());
                if (effectiveChannel.getImportance() != payload.importance) {
                    Json.add(warnings, "effective_importance_differs");
                }
                boolean requestedVibration = payload.vibrationPatternMs.length > 0;
                if (effectiveChannel.shouldVibrate() != requestedVibration) {
                    Json.add(warnings, "effective_vibration_differs");
                }
                String requestedSound = payload.soundUri == null || payload.soundUri.trim().isEmpty()
                        ? (payload.defaultSound ? "__default__" : "")
                        : payload.soundUri.trim();
                String effectiveSound = effectiveChannel.getSound() == null ? "" : effectiveChannel.getSound().toString();
                if (!requestedSound.isEmpty()) {
                    if ("__default__".equals(requestedSound)) {
                        if (effectiveSound.isEmpty()) {
                            Json.add(warnings, "effective_sound_missing");
                        }
                    } else if (!requestedSound.equals(effectiveSound)) {
                        Json.add(warnings, "effective_sound_differs");
                    }
                }
                if (requestedBypassDnd && !policyGranted) {
                    Json.add(warnings, "dnd_bypass_permission_missing");
                } else if (requestedBypassDnd && !effectiveChannel.canBypassDnd()) {
                    Json.add(warnings, "effective_bypass_dnd_differs");
                }
            }
            return new ChannelResult(true, channelId, payload.channel.profileKey, policyGranted, warnings, requested, effective);
        }

        public JSONObject toJson() {
            JSONObject out = new JSONObject();
            Json.put(out, "available", available);
            Json.put(out, "id", channelId);
            Json.put(out, "profile_key", profileKey);
            Json.put(out, "policy_access_granted", policyAccessGranted);
            Json.put(out, "warnings", warnings);
            Json.put(out, "requested", requested);
            Json.put(out, "effective", effective);
            return out;
        }

        private static JSONArray arrayOf(long[] values) {
            JSONArray out = new JSONArray();
            if (values == null) {
                return out;
            }
            for (long value : values) {
                Json.add(out, value);
            }
            return out;
        }
    }
}
