package com.pucky.device.calls;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.telecom.TelecomManager;
import android.util.Log;

public final class CallLabStartReceiver extends BroadcastReceiver {
    public static final String ACTION_START = "com.pucky.device.calls.CALL_LAB_START";
    public static final String EXTRA_NUMBER = "number";

    private static final String TAG = "PuckyCallLab";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        if (!ACTION_START.equals(action)) {
            Log.w(TAG, "call ignored action=" + action);
            return;
        }
        if (context.checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "call blocked missing CALL_PHONE permission");
            return;
        }

        String number = cleanNumber(intent.getStringExtra(EXTRA_NUMBER));
        if (number.isEmpty()) {
            Log.w(TAG, "call blocked missing number");
            return;
        }
        if (isEmergencyNumber(number)) {
            Log.w(TAG, "call blocked emergency-like number");
            return;
        }

        TelecomManager telecomManager = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
        if (telecomManager == null) {
            Log.w(TAG, "call blocked TelecomManager unavailable");
            return;
        }

        String requestId = String.valueOf(System.currentTimeMillis());
        try {
            telecomManager.placeCall(Uri.fromParts("tel", number, null), new Bundle());
            Log.i(TAG, "call requested request_id=" + requestId + " number=" + maskNumber(number));
        } catch (RuntimeException exc) {
            Log.w(TAG, "call failed request_id=" + requestId + " error=" + exc.getMessage(), exc);
        }
    }

    private static String cleanNumber(String value) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
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

    private static boolean isEmergencyNumber(String value) {
        String digits = value == null ? "" : value.replace("+", "");
        return "911".equals(digits) || "112".equals(digits);
    }

    private static String maskNumber(String value) {
        if (value == null || value.length() <= 4) {
            return "****";
        }
        return "***" + value.substring(value.length() - 4);
    }
}
