package com.pucky.device.sms;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.SmsManager;
import android.util.Log;

public final class SmsLabResultReceiver extends BroadcastReceiver {
    public static final String ACTION_SENT = "com.pucky.device.sms.SMS_LAB_SENT";
    public static final String ACTION_DELIVERED = "com.pucky.device.sms.SMS_LAB_DELIVERED";
    public static final String EXTRA_REQUEST_ID = "request_id";
    public static final String EXTRA_TO = "to";

    private static final String TAG = "PuckySmsLab";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        int resultCode = getResultCode();
        String requestId = intent == null ? "" : intent.getStringExtra(EXTRA_REQUEST_ID);
        String to = intent == null ? "" : intent.getStringExtra(EXTRA_TO);
        Log.i(TAG, "result action=" + action
                + " request_id=" + requestId
                + " to=" + maskNumber(to)
                + " result=" + resultLabel(resultCode));
    }

    private static String resultLabel(int resultCode) {
        if (resultCode == Activity.RESULT_OK) {
            return "OK";
        }
        switch (resultCode) {
            case SmsManager.RESULT_ERROR_GENERIC_FAILURE:
                return "GENERIC_FAILURE";
            case SmsManager.RESULT_ERROR_NO_SERVICE:
                return "NO_SERVICE";
            case SmsManager.RESULT_ERROR_NULL_PDU:
                return "NULL_PDU";
            case SmsManager.RESULT_ERROR_RADIO_OFF:
                return "RADIO_OFF";
            default:
                return String.valueOf(resultCode);
        }
    }

    private static String maskNumber(String value) {
        if (value == null || value.length() <= 4) {
            return "****";
        }
        return "***" + value.substring(value.length() - 4);
    }
}
