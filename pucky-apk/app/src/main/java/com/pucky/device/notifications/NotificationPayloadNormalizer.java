package com.pucky.device.notifications;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public final class NotificationPayloadNormalizer {
    private static final long[] DEFAULT_NOTIFICATION_VIBRATION_MS = new long[] {0L, 120L, 80L, 180L};
    private static final long[] DEFAULT_MANUAL_HAPTIC_PATTERN_MS = new long[] {0L, 120L, 80L, 240L};

    private NotificationPayloadNormalizer() {
    }

    public static NormalizedPayload normalize(String commandId, JSONObject raw) throws CommandException {
        JSONObject args = cloneObject(raw, true);
        boolean silent = args.optBoolean("silent", false);
        boolean audibleCompat = args.optBoolean("audible", false) && !silent;
        JSONObject surface = optObject(args, "surface");

        String surfaceMode = requiredEnum(
                firstNonEmpty(surface.optString("mode", ""), args.optString("surface_mode", "")),
                "shade",
                "surface.mode",
                "shade", "heads_up", "full_screen");
        int importance = parseImportance(args.opt("importance"), surfaceMode, audibleCompat);
        String category = firstNonEmpty(args.optString("category", ""), "status").toLowerCase(Locale.US);
        boolean defaultSound = !silent && (args.has("default_sound") ? args.optBoolean("default_sound", false) : audibleCompat);
        String soundUri = silent ? "" : args.optString("sound_uri", "").trim();
        long[] vibrationPattern = silent
                ? new long[0]
                : parseLongArray(args.opt("vibration_pattern_ms"), "vibration_pattern_ms", audibleCompat ? DEFAULT_NOTIFICATION_VIBRATION_MS : new long[0]);
        int[] vibrationAmplitudes = parseAmplitudeArray(args.opt("vibration_amplitudes"), vibrationPattern);
        CueSpec manualTone = parseToneCue(args.opt("manual_tone"));
        CueSpec manualHaptic = parseHapticCue(args.opt("manual_haptic"));
        boolean repeatUntilCancelled = args.optBoolean("repeat_until_cancelled", false);
        List<ActionSpec> actions = parseActions(commandId, args.opt("actions"));

        String title = firstNonEmpty(args.optString("title", ""), "Pucky");
        String text = firstNonEmpty(args.optString("text", ""), "Pucky notification");
        String bigText = args.optString("big_text", "").trim();
        boolean autoCancel = args.has("auto_cancel") ? args.optBoolean("auto_cancel", true) : true;
        boolean ongoing = args.optBoolean("ongoing", false);
        boolean onlyAlertOnce = args.has("only_alert_once")
                ? args.optBoolean("only_alert_once", false)
                : !(audibleCompat || defaultSound || vibrationPattern.length > 0 || manualTone.enabled || manualHaptic.enabled);
        boolean noClear = args.optBoolean("no_clear", false);
        boolean localOnly = args.optBoolean("local_only", false);
        long timeoutMs = Math.max(0L, args.optLong("timeout_ms", 0L));
        String groupKey = args.optString("group_key", "").trim();
        boolean groupSummary = args.optBoolean("group_summary", false);
        String groupAlertBehavior = requiredEnum(
                args.optString("group_alert_behavior", ""),
                "all",
                "group_alert_behavior",
                "all", "summary", "children");
        long whenMs = Math.max(0L, args.optLong("when_ms", 0L));
        boolean useChronometer = args.optBoolean("chronometer", false);
        boolean countdownChronometer = args.optBoolean("countdown", false);
        boolean bypassDndIfAllowed = args.optBoolean("bypass_dnd_if_allowed", false);
        String fullScreenActivity = args.optString("full_screen_activity", "").trim();
        if ("full_screen".equals(surfaceMode) && fullScreenActivity.isEmpty()) {
            throw new CommandException(
                    CommandErrorCodes.MALFORMED_COMMAND,
                    "notify.show full_screen surface requires full_screen_activity");
        }

        String channelName = args.optString("channel_name", "").trim();
        String channelGroupId = args.optString("channel_group_id", "").trim();
        String channelGroupName = args.optString("channel_group_name", "").trim();
        String requestedChannelId = firstNonEmpty(args.optString("channel_id", ""), args.optString("channel", ""));
        String profileKey = channelProfileKey(
                importance,
                category,
                silent,
                defaultSound,
                soundUri,
                vibrationPattern,
                vibrationAmplitudes,
                bypassDndIfAllowed);
        ChannelSpec channel = new ChannelSpec(
                requestedChannelId,
                firstNonEmpty(channelName, defaultChannelName(category, importance)),
                channelGroupId,
                channelGroupName,
                profileKey);

        return new NormalizedPayload(
                firstNonEmpty(args.optString("id", ""), ""),
                commandId == null ? "" : commandId,
                title,
                text,
                bigText,
                surfaceMode,
                importance,
                category,
                autoCancel,
                ongoing,
                onlyAlertOnce,
                noClear,
                localOnly,
                timeoutMs,
                groupKey,
                groupSummary,
                groupAlertBehavior,
                whenMs,
                useChronometer,
                countdownChronometer,
                silent,
                defaultSound,
                soundUri,
                vibrationPattern,
                vibrationAmplitudes,
                manualTone,
                manualHaptic,
                repeatUntilCancelled,
                actions,
                channel,
                bypassDndIfAllowed,
                fullScreenActivity,
                args);
    }

    public static JSONObject askPayload(String commandId, JSONObject raw) {
        JSONObject payload = cloneObjectRelaxed(raw);
        JSONArray actions = new JSONArray();
        JSONObject reply = new JSONObject();
        Json.put(reply, "id", firstNonEmpty(payload.optString("action_id", ""), "reply"));
        Json.put(reply, "title", firstNonEmpty(payload.optString("action_title", ""), "Reply"));
        Json.put(reply, "kind", "reply");
        Json.put(reply, "reply_label", firstNonEmpty(payload.optString("reply_label", ""), "Reply"));
        actions.put(reply);
        Json.put(payload, "actions", actions);
        Json.put(payload, "prompt_id", firstNonEmpty(payload.optString("prompt_id", ""), firstNonEmpty(commandId, "reply")));
        if (!payload.has("ongoing")) {
            Json.put(payload, "ongoing", true);
        }
        if (!payload.has("auto_cancel")) {
            Json.put(payload, "auto_cancel", false);
        }
        return payload;
    }

    private static JSONObject cloneObject(JSONObject raw, boolean strict) throws CommandException {
        if (raw == null) {
            return new JSONObject();
        }
        try {
            return new JSONObject(raw.toString());
        } catch (Exception exc) {
            if (strict) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "notify payload could not be cloned");
            }
            return new JSONObject();
        }
    }

    private static JSONObject cloneObjectRelaxed(JSONObject raw) {
        if (raw == null) {
            return new JSONObject();
        }
        try {
            return new JSONObject(raw.toString());
        } catch (Exception ignored) {
            return new JSONObject();
        }
    }

    private static JSONObject optObject(JSONObject args, String key) {
        Object value = args.opt(key);
        return value instanceof JSONObject ? (JSONObject) value : new JSONObject();
    }

    private static String requiredEnum(String raw, String fallback, String label, String... allowed) throws CommandException {
        String value = firstNonEmpty(raw, fallback).trim().toLowerCase(Locale.US);
        for (String item : allowed) {
            if (item.equals(value)) {
                return value;
            }
        }
        throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "Unsupported " + label + ": " + raw);
    }

    private static int parseImportance(Object raw, String surfaceMode, boolean audibleCompat) throws CommandException {
        if (raw instanceof Number) {
            return clampImportance(((Number) raw).intValue());
        }
        String fallback = ("full_screen".equals(surfaceMode) || "heads_up".equals(surfaceMode) || audibleCompat) ? "high" : "low";
        String value = requiredEnum(String.valueOf(raw == null ? "" : raw), fallback, "importance", "none", "min", "low", "default", "high");
        switch (value) {
            case "none":
                return 0;
            case "min":
                return 1;
            case "low":
                return 2;
            case "default":
                return 3;
            case "high":
            default:
                return 4;
        }
    }

    private static int clampImportance(int value) {
        return Math.max(0, Math.min(4, value));
    }

    private static long[] parseLongArray(Object raw, String label, long[] fallback) throws CommandException {
        if (!(raw instanceof JSONArray)) {
            return Arrays.copyOf(fallback, fallback.length);
        }
        JSONArray array = (JSONArray) raw;
        if (array.length() > 32) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, label + " supports at most 32 values");
        }
        long[] out = new long[array.length()];
        for (int index = 0; index < array.length(); index++) {
            long value = array.optLong(index, -1L);
            if (value < 0L) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, label + " contains negative value");
            }
            out[index] = value;
        }
        return out;
    }

    private static int[] parseAmplitudeArray(Object raw, long[] pattern) throws CommandException {
        if (!(raw instanceof JSONArray)) {
            return new int[0];
        }
        JSONArray array = (JSONArray) raw;
        if (array.length() != pattern.length) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "vibration_amplitudes must match vibration_pattern_ms length");
        }
        int[] out = new int[array.length()];
        for (int index = 0; index < array.length(); index++) {
            int value = array.optInt(index, -2);
            if (value < -1 || value > 255) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "vibration_amplitudes values must be between -1 and 255");
            }
            out[index] = value;
        }
        return out;
    }

    private static CueSpec parseToneCue(Object raw) throws CommandException {
        if (raw == null || raw == JSONObject.NULL) {
            return CueSpec.disabled();
        }
        if (raw instanceof Boolean) {
            return ((Boolean) raw) ? CueSpec.defaultTone() : CueSpec.disabled();
        }
        if (!(raw instanceof JSONObject)) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "manual_tone must be a boolean or object");
        }
        JSONObject object = (JSONObject) raw;
        boolean enabled = object.has("enabled") ? object.optBoolean("enabled", true) : true;
        if (!enabled) {
            return CueSpec.disabled();
        }
        return CueSpec.tone(
                Math.max(50, Math.min(5000, object.optInt("duration_ms", 1200))),
                Math.max(1, Math.min(100, object.optInt("volume", 70))),
                object.has("tone") ? object.optInt("tone", -1) : -1,
                Math.max(0, Math.min(25, object.optInt("repeat_count", 0))),
                Math.max(0, Math.min(10000, object.optInt("repeat_gap_ms", 800))));
    }

    private static CueSpec parseHapticCue(Object raw) throws CommandException {
        if (raw == null || raw == JSONObject.NULL) {
            return CueSpec.disabled();
        }
        if (raw instanceof Boolean) {
            return ((Boolean) raw)
                    ? CueSpec.haptic(DEFAULT_MANUAL_HAPTIC_PATTERN_MS, new int[0], 180, 220, 0, 800)
                    : CueSpec.disabled();
        }
        if (!(raw instanceof JSONObject)) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "manual_haptic must be a boolean or object");
        }
        JSONObject object = (JSONObject) raw;
        boolean enabled = object.has("enabled") ? object.optBoolean("enabled", true) : true;
        if (!enabled) {
            return CueSpec.disabled();
        }
        long[] pattern = parseLongArray(object.opt("pattern_ms"), "manual_haptic.pattern_ms", DEFAULT_MANUAL_HAPTIC_PATTERN_MS);
        int[] amplitudes = parseAmplitudeArray(object.opt("amplitudes"), pattern);
        return CueSpec.haptic(
                pattern,
                amplitudes,
                Math.max(1, Math.min(5000, object.optInt("duration_ms", 180))),
                Math.max(1, Math.min(255, object.optInt("amplitude", 220))),
                Math.max(0, Math.min(25, object.optInt("repeat_count", 0))),
                Math.max(0, Math.min(10000, object.optInt("repeat_gap_ms", 800))));
    }

    private static List<ActionSpec> parseActions(String commandId, Object raw) throws CommandException {
        List<ActionSpec> actions = new ArrayList<>();
        if (raw == null || raw == JSONObject.NULL) {
            return actions;
        }
        if (!(raw instanceof JSONArray)) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "actions must be an array");
        }
        JSONArray array = (JSONArray) raw;
        if (array.length() > 3) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "actions supports at most 3 buttons");
        }
        int replyCount = 0;
        for (int index = 0; index < array.length(); index++) {
            Object value = array.opt(index);
            if (!(value instanceof JSONObject)) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "action at index " + index + " must be an object");
            }
            JSONObject object = (JSONObject) value;
            String kind = requiredEnum(
                    firstNonEmpty(object.optString("kind", ""), object.optString("type", "")),
                    "button",
                    "action.kind",
                    "button", "reply");
            if ("reply".equals(kind)) {
                replyCount += 1;
            }
            if (replyCount > 1) {
                throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "actions supports at most one reply action");
            }
            String actionId = firstNonEmpty(object.optString("id", ""), "action_" + index);
            String title = firstNonEmpty(object.optString("title", ""), "Action");
            String replyLabel = firstNonEmpty(object.optString("reply_label", ""), "Reply");
            actions.add(new ActionSpec(
                    actionId,
                    title,
                    kind,
                    replyLabel,
                    firstNonEmpty(object.optString("prompt_id", ""), firstNonEmpty(commandId, actionId))));
        }
        return actions;
    }

    private static String channelProfileKey(
            int importance,
            String category,
            boolean silent,
            boolean defaultSound,
            String soundUri,
            long[] vibrationPattern,
            int[] vibrationAmplitudes,
            boolean bypassDnd) {
        String payload = importance + "|" + category + "|" + silent + "|" + defaultSound + "|"
                + soundUri + "|" + Arrays.toString(vibrationPattern) + "|" + Arrays.toString(vibrationAmplitudes)
                + "|" + bypassDnd;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(payload.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder();
            for (byte value : bytes) {
                out.append(String.format(Locale.US, "%02x", value));
                if (out.length() >= 12) {
                    break;
                }
            }
            return out.toString();
        } catch (Exception ignored) {
            return Integer.toHexString(payload.hashCode()).replace("-", "a");
        }
    }

    private static String defaultChannelName(String category, int importance) {
        String categoryLabel = firstNonEmpty(category, "status").replace('_', ' ');
        if (importance >= 4) {
            return "Pucky urgent " + categoryLabel;
        }
        if (importance >= 3) {
            return "Pucky " + categoryLabel;
        }
        return "Pucky quiet " + categoryLabel;
    }

    private static String firstNonEmpty(String primary, String fallback) {
        String value = primary == null ? "" : primary.trim();
        return value.isEmpty() ? fallback : value;
    }

    public static final class NormalizedPayload {
        public final String id;
        public final String commandId;
        public final String title;
        public final String text;
        public final String bigText;
        public final String surfaceMode;
        public final int importance;
        public final String category;
        public final boolean autoCancel;
        public final boolean ongoing;
        public final boolean onlyAlertOnce;
        public final boolean noClear;
        public final boolean localOnly;
        public final long timeoutMs;
        public final String groupKey;
        public final boolean groupSummary;
        public final String groupAlertBehavior;
        public final long whenMs;
        public final boolean useChronometer;
        public final boolean countdownChronometer;
        public final boolean silent;
        public final boolean defaultSound;
        public final String soundUri;
        public final long[] vibrationPatternMs;
        public final int[] vibrationAmplitudes;
        public final CueSpec manualTone;
        public final CueSpec manualHaptic;
        public final boolean repeatUntilCancelled;
        public final List<ActionSpec> actions;
        public final ChannelSpec channel;
        public final boolean bypassDndIfAllowed;
        public final String fullScreenActivity;
        public final JSONObject raw;

        private NormalizedPayload(
                String id,
                String commandId,
                String title,
                String text,
                String bigText,
                String surfaceMode,
                int importance,
                String category,
                boolean autoCancel,
                boolean ongoing,
                boolean onlyAlertOnce,
                boolean noClear,
                boolean localOnly,
                long timeoutMs,
                String groupKey,
                boolean groupSummary,
                String groupAlertBehavior,
                long whenMs,
                boolean useChronometer,
                boolean countdownChronometer,
                boolean silent,
                boolean defaultSound,
                String soundUri,
                long[] vibrationPatternMs,
                int[] vibrationAmplitudes,
                CueSpec manualTone,
                CueSpec manualHaptic,
                boolean repeatUntilCancelled,
                List<ActionSpec> actions,
                ChannelSpec channel,
                boolean bypassDndIfAllowed,
                String fullScreenActivity,
                JSONObject raw) {
            this.id = id;
            this.commandId = commandId;
            this.title = title;
            this.text = text;
            this.bigText = bigText;
            this.surfaceMode = surfaceMode;
            this.importance = importance;
            this.category = category;
            this.autoCancel = autoCancel;
            this.ongoing = ongoing;
            this.onlyAlertOnce = onlyAlertOnce;
            this.noClear = noClear;
            this.localOnly = localOnly;
            this.timeoutMs = timeoutMs;
            this.groupKey = groupKey;
            this.groupSummary = groupSummary;
            this.groupAlertBehavior = groupAlertBehavior;
            this.whenMs = whenMs;
            this.useChronometer = useChronometer;
            this.countdownChronometer = countdownChronometer;
            this.silent = silent;
            this.defaultSound = defaultSound;
            this.soundUri = soundUri;
            this.vibrationPatternMs = Arrays.copyOf(vibrationPatternMs, vibrationPatternMs.length);
            this.vibrationAmplitudes = Arrays.copyOf(vibrationAmplitudes, vibrationAmplitudes.length);
            this.manualTone = manualTone;
            this.manualHaptic = manualHaptic;
            this.repeatUntilCancelled = repeatUntilCancelled;
            this.actions = actions;
            this.channel = channel;
            this.bypassDndIfAllowed = bypassDndIfAllowed;
            this.fullScreenActivity = fullScreenActivity;
            this.raw = raw;
        }
    }

    public static final class ActionSpec {
        public final String id;
        public final String title;
        public final String kind;
        public final String replyLabel;
        public final String promptId;

        private ActionSpec(String id, String title, String kind, String replyLabel, String promptId) {
            this.id = id;
            this.title = title;
            this.kind = kind;
            this.replyLabel = replyLabel;
            this.promptId = promptId;
        }
    }

    public static final class CueSpec {
        public final boolean enabled;
        public final long[] patternMs;
        public final int[] amplitudes;
        public final int durationMs;
        public final int amplitude;
        public final int volume;
        public final int tone;
        public final int repeatCount;
        public final int repeatGapMs;

        private CueSpec(
                boolean enabled,
                long[] patternMs,
                int[] amplitudes,
                int durationMs,
                int amplitude,
                int volume,
                int tone,
                int repeatCount,
                int repeatGapMs) {
            this.enabled = enabled;
            this.patternMs = Arrays.copyOf(patternMs, patternMs.length);
            this.amplitudes = Arrays.copyOf(amplitudes, amplitudes.length);
            this.durationMs = durationMs;
            this.amplitude = amplitude;
            this.volume = volume;
            this.tone = tone;
            this.repeatCount = repeatCount;
            this.repeatGapMs = repeatGapMs;
        }

        public static CueSpec disabled() {
            return new CueSpec(false, new long[0], new int[0], 0, 0, 0, -1, 0, 0);
        }

        public static CueSpec defaultTone() {
            return tone(1200, 70, -1, 0, 800);
        }

        public static CueSpec tone(int durationMs, int volume, int tone, int repeatCount, int repeatGapMs) {
            return new CueSpec(true, new long[0], new int[0], durationMs, 0, volume, tone, repeatCount, repeatGapMs);
        }

        public static CueSpec haptic(
                long[] patternMs,
                int[] amplitudes,
                int durationMs,
                int amplitude,
                int repeatCount,
                int repeatGapMs) {
            return new CueSpec(true, patternMs, amplitudes, durationMs, amplitude, 0, -1, repeatCount, repeatGapMs);
        }
    }

    public static final class ChannelSpec {
        public final String requestedId;
        public final String requestedName;
        public final String requestedGroupId;
        public final String requestedGroupName;
        public final String profileKey;

        private ChannelSpec(
                String requestedId,
                String requestedName,
                String requestedGroupId,
                String requestedGroupName,
                String profileKey) {
            this.requestedId = requestedId;
            this.requestedName = requestedName;
            this.requestedGroupId = requestedGroupId;
            this.requestedGroupName = requestedGroupName;
            this.profileKey = profileKey;
        }
    }
}
