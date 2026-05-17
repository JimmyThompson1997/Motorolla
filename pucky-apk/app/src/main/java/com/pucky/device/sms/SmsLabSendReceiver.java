package com.pucky.device.sms;

import android.Manifest;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.telephony.SmsManager;
import android.util.Log;

public final class SmsLabSendReceiver extends BroadcastReceiver {
    public static final String ACTION_SEND = "com.pucky.device.sms.SMS_LAB_SEND";
    public static final String EXTRA_TO = "to";
    public static final String EXTRA_BODY = "body";

    private static final String TAG = "PuckySmsLab";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        if (!ACTION_SEND.equals(action)) {
            Log.w(TAG, "send ignored action=" + action);
            return;
        }
        if (context.checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "send blocked missing SEND_SMS permission");
            return;
        }

        String to = clean(intent.getStringExtra(EXTRA_TO));
        String body = clean(intent.getStringExtra(EXTRA_BODY));
        if (to.isEmpty() || body.isEmpty()) {
            Log.w(TAG, "send blocked missing to/body");
            return;
        }

        String requestId = String.valueOf(System.currentTimeMillis());
        PendingIntent sentIntent = resultIntent(
                context,
                SmsLabResultReceiver.ACTION_SENT,
                requestId,
                to,
                11);
        PendingIntent deliveredIntent = resultIntent(
                context,
                SmsLabResultReceiver.ACTION_DELIVERED,
                requestId,
                to,
                12);

        try {
            SmsManager.getDefault().sendTextMessage(to, null, body, sentIntent, deliveredIntent);
            Log.i(TAG, "send queued request_id=" + requestId
                    + " to=" + maskNumber(to)
                    + " body_chars=" + body.length());
        } catch (RuntimeException exc) {
            Log.w(TAG, "send failed request_id=" + requestId + " error=" + exc.getMessage(), exc);
        }
    }

    private static PendingIntent resultIntent(
            Context context,
            String action,
            String requestId,
            String to,
            int requestCodeOffset) {
        Intent result = new Intent(context, SmsLabResultReceiver.class)
                .setAction(action)
                .putExtra(SmsLabResultReceiver.EXTRA_REQUEST_ID, requestId)
                .putExtra(SmsLabResultReceiver.EXTRA_TO, to);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        int requestCode = requestId.hashCode() + requestCodeOffset;
        return PendingIntent.getBroadcast(context, requestCode, result, flags);
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    private static String maskNumber(String value) {
        if (value == null || value.length() <= 4) {
            return "****";
        }
        return "***" + value.substring(value.length() - 4);
    }
}
