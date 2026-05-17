package com.pucky.device.notifications;

import android.app.NotificationManager;
import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import com.pucky.device.PuckyApplication;
import com.pucky.device.storage.CommandLogStore;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class NotificationReplyReceiver extends BroadcastReceiver {
    private static final String TAG = "PuckyReplyReceiver";

    public static final String ACTION_REPLY = "com.pucky.device.notifications.REPLY";
    public static final String KEY_TEXT_REPLY = "pucky_text_reply";
    public static final String EXTRA_COMMAND_ID = "command_id";
    public static final String EXTRA_PROMPT_ID = "prompt_id";
    public static final String EXTRA_NOTIFICATION_ID = "notification_id";

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_REPLY.equals(intent.getAction())) {
            return;
        }
        PendingResult pendingResult = goAsync();
        Context appContext = context.getApplicationContext();
        String commandId = intent.getStringExtra(EXTRA_COMMAND_ID);
        String promptId = intent.getStringExtra(EXTRA_PROMPT_ID);
        int notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 41002);
        String replyText = replyText(intent);
        Log.i(TAG, "reply received command_id=" + commandId
                + " prompt_id=" + promptId
                + " text_len=" + replyText.length());
        EXECUTOR.execute(() -> {
            JSONObject log = new JSONObject();
            Json.put(log, "schema", "pucky.notification_reply.v1");
            Json.put(log, "command_id", commandId == null ? JSONObject.NULL : commandId);
            Json.put(log, "prompt_id", promptId == null ? JSONObject.NULL : promptId);
            Json.put(log, "text", replyText);
            try {
                JSONObject postResult = new BrokerReplyPoster(appContext).post(commandId, promptId, replyText);
                Json.put(log, "post_result", postResult);
                Log.i(TAG, "reply post ok=" + postResult.optBoolean("ok", false)
                        + " status=" + postResult.optInt("http_status", 0));
            } catch (Exception e) {
                JSONObject error = new JSONObject();
                Json.put(error, "type", e.getClass().getSimpleName());
                Json.put(error, "message", e.getMessage() == null ? "" : e.getMessage());
                Json.put(log, "post_error", error);
                Log.w(TAG, "reply post failed " + e.getClass().getSimpleName() + ": " + e.getMessage());
            }
            try {
                CommandLogStore store = ((PuckyApplication) appContext).commandLogStore();
                store.append(commandId, "notify.reply", "received", log);
            } catch (Exception ignored) {
            }
            NotificationManager manager = (NotificationManager) appContext.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancel(notificationId);
            }
            pendingResult.finish();
        });
    }

    private static String replyText(Intent intent) {
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        if (results == null) {
            return intent.getStringExtra(KEY_TEXT_REPLY) == null ? "" : intent.getStringExtra(KEY_TEXT_REPLY);
        }
        CharSequence value = results.getCharSequence(KEY_TEXT_REPLY);
        return value == null ? "" : value.toString();
    }
}
