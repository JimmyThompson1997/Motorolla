package com.pucky.device.calls;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.telecom.Call;
import android.telecom.TelecomManager;
import android.telecom.VideoProfile;

import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class PuckyCallStateStore {
    public static final String EXTRA_SHOW_CALL_UI = "pucky_show_call_ui";
    public static final String EXTRA_SHOW_DIALPAD = "pucky_show_dialpad";

    private static final Object LOCK = new Object();
    private static final Map<Call, TrackedCall> CALLS = new IdentityHashMap<>();

    private static final class TrackedCall {
        final String callKey;
        final Call call;
        final Call.Callback callback;
        int state;
        String number;
        String displayName;
        boolean canAnswer;
        boolean canDisconnect;

        TrackedCall(String callKey, Call call, Call.Callback callback) {
            this.callKey = callKey;
            this.call = call;
            this.callback = callback;
            this.state = Call.STATE_NEW;
            this.number = "";
            this.displayName = "";
            this.canAnswer = false;
            this.canDisconnect = false;
        }
    }

    private PuckyCallStateStore() {
    }

    public static void onCallAdded(Context context, Call call) {
        if (call == null) {
            return;
        }
        synchronized (LOCK) {
            if (CALLS.containsKey(call)) {
                updateTrackedLocked(CALLS.get(call));
            } else {
                String callKey = Integer.toHexString(System.identityHashCode(call));
                Call.Callback callback = new Call.Callback() {
                    @Override
                    public void onStateChanged(Call changedCall, int state) {
                        onCallChanged(changedCall);
                    }

                    @Override
                    public void onDetailsChanged(Call changedCall, Call.Details details) {
                        onCallChanged(changedCall);
                    }

                    @Override
                    public void onCallDestroyed(Call changedCall) {
                        onCallRemoved(changedCall);
                    }
                };
                TrackedCall tracked = new TrackedCall(callKey, call, callback);
                call.registerCallback(callback);
                CALLS.put(call, tracked);
                updateTrackedLocked(tracked);
            }
        }
        showUi(context, false);
    }

    public static void onCallRemoved(Call call) {
        if (call == null) {
            return;
        }
        synchronized (LOCK) {
            TrackedCall tracked = CALLS.remove(call);
            if (tracked != null) {
                try {
                    call.unregisterCallback(tracked.callback);
                } catch (RuntimeException ignored) {
                }
            }
        }
    }

    public static void onCallChanged(Call call) {
        if (call == null) {
            return;
        }
        synchronized (LOCK) {
            TrackedCall tracked = CALLS.get(call);
            if (tracked != null) {
                updateTrackedLocked(tracked);
            }
        }
    }

    public static void onBringToForeground(Context context, boolean showDialpad) {
        showUi(context, showDialpad);
    }

    public static JSONObject snapshot(Context context) {
        JSONObject out = new JSONObject();
        JSONArray calls = new JSONArray();
        boolean hasRinging = false;
        boolean hasOngoing = false;
        synchronized (LOCK) {
            for (TrackedCall tracked : orderedCallsLocked()) {
                Json.add(calls, callJson(tracked));
                hasRinging = hasRinging || isRingingState(tracked.state);
                hasOngoing = hasOngoing || isOngoingState(tracked.state);
            }
        }
        TelecomManager telecom = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
        String defaultDialer = telecom == null ? "" : nullToEmpty(telecom.getDefaultDialerPackage());
        Json.put(out, "overall_state", hasRinging ? "ringing" : hasOngoing ? "active" : "idle");
        Json.put(out, "has_ringing_call", hasRinging);
        Json.put(out, "has_ongoing_call", hasOngoing);
        Json.put(out, "tracked_call_count", calls.length());
        Json.put(out, "calls", calls);
        Json.put(out, "default_dialer_package", defaultDialer);
        Json.put(out, "default_dialer_held", context.getPackageName().equals(defaultDialer));
        Json.put(out, "system_in_call", telecom != null && telecom.isInCall());
        Json.put(out, "system_in_managed_call", telecom != null && telecom.isInManagedCall());
        return out;
    }

    public static JSONObject answerRinging(Context context) {
        JSONObject out = new JSONObject();
        synchronized (LOCK) {
            for (TrackedCall tracked : orderedCallsLocked()) {
                if (isRingingState(tracked.state)) {
                    tracked.call.answer(VideoProfile.STATE_AUDIO_ONLY);
                    Json.put(out, "answered", true);
                    Json.put(out, "call_key", tracked.callKey);
                    Json.put(out, "state", stateName(tracked.state));
                    Json.put(out, "number", maskNumber(tracked.number));
                    return out;
                }
            }
        }
        Json.put(out, "answered", false);
        Json.put(out, "reason", "no_ringing_call");
        return out;
    }

    public static void showUi(Context context, boolean showDialpad) {
        Intent intent = new Intent(context, PuckyDialerActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(EXTRA_SHOW_CALL_UI, true)
                .putExtra(EXTRA_SHOW_DIALPAD, showDialpad);
        context.startActivity(intent);
    }

    private static List<TrackedCall> orderedCallsLocked() {
        return new ArrayList<>(CALLS.values());
    }

    private static void updateTrackedLocked(TrackedCall tracked) {
        tracked.state = tracked.call.getState();
        Call.Details details = tracked.call.getDetails();
        Uri handle = details == null ? null : details.getHandle();
        tracked.number = handle == null ? "" : cleanNumber(handle.getSchemeSpecificPart());
        tracked.displayName = details == null ? "" : nullToEmpty(details.getCallerDisplayName());
        tracked.canAnswer = isRingingState(tracked.state);
        tracked.canDisconnect = tracked.state != Call.STATE_DISCONNECTED && tracked.state != Call.STATE_DISCONNECTING;
    }

    private static JSONObject callJson(TrackedCall tracked) {
        JSONObject out = new JSONObject();
        Json.put(out, "call_key", tracked.callKey);
        Json.put(out, "state", stateName(tracked.state));
        Json.put(out, "number", tracked.number);
        Json.put(out, "display_name", tracked.displayName);
        Json.put(out, "can_answer", tracked.canAnswer);
        Json.put(out, "can_disconnect", tracked.canDisconnect);
        return out;
    }

    private static boolean isRingingState(int state) {
        return state == Call.STATE_RINGING || state == Call.STATE_SIMULATED_RINGING;
    }

    private static boolean isOngoingState(int state) {
        return isRingingState(state)
                || state == Call.STATE_ACTIVE
                || state == Call.STATE_DIALING
                || state == Call.STATE_CONNECTING
                || state == Call.STATE_HOLDING
                || state == Call.STATE_PULLING_CALL
                || state == Call.STATE_AUDIO_PROCESSING;
    }

    private static String stateName(int state) {
        switch (state) {
            case Call.STATE_NEW:
                return "new";
            case Call.STATE_DIALING:
                return "dialing";
            case Call.STATE_RINGING:
                return "ringing";
            case Call.STATE_ACTIVE:
                return "active";
            case Call.STATE_HOLDING:
                return "holding";
            case Call.STATE_DISCONNECTED:
                return "disconnected";
            case Call.STATE_DISCONNECTING:
                return "disconnecting";
            case Call.STATE_SELECT_PHONE_ACCOUNT:
                return "select_phone_account";
            case Call.STATE_CONNECTING:
                return "connecting";
            case Call.STATE_PULLING_CALL:
                return "pulling_call";
            case Call.STATE_AUDIO_PROCESSING:
                return "audio_processing";
            case Call.STATE_SIMULATED_RINGING:
                return "simulated_ringing";
            default:
                return "unknown";
        }
    }

    private static String cleanNumber(String value) {
        String trimmed = value == null ? "" : value.trim();
        StringBuilder out = new StringBuilder(trimmed.length());
        for (int i = 0; i < trimmed.length(); i++) {
            char ch = trimmed.charAt(i);
            if ((ch >= '0' && ch <= '9') || (ch == '+' && out.length() == 0)) {
                out.append(ch);
            } else if (ch == ' ' || ch == '-' || ch == '(' || ch == ')') {
                continue;
            }
        }
        return out.toString();
    }

    private static String nullToEmpty(CharSequence value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static String maskNumber(String value) {
        if (value == null || value.length() <= 4) {
            return "****";
        }
        return "***" + value.substring(value.length() - 4);
    }
}
