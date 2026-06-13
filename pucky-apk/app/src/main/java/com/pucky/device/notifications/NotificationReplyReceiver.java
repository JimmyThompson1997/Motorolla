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

import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class NotificationReplyReceiver extends BroadcastReceiver {
    private static final String TAG = "PuckyReplyReceiver";

    public static final String ACTION_REPLY = "com.pucky.device.notifications.REPLY";
    public static final String ACTION_CALLBACK = "com.pucky.device.notifications.CALLBACK";
    public static final String KEY_TEXT_REPLY = "pucky_text_reply";
    public static final String EXTRA_COMMAND_ID = "command_id";
    public static final String EXTRA_PROMPT_ID = "prompt_id";
    public static final String EXTRA_NOTIFICATION_ID = "notification_id";
    public static final String EXTRA_NOTIFICATION_KEY = "notification_key";
    public static final String EXTRA_ACTION_ID = "action_id";
    public static final String EXTRA_ACTION_KIND = "action_kind";
    public static final String EXTRA_LEGACY_ASK = "legacy_ask";

    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) {
            return;
        }
        String action = String.valueOf(intent.getAction());
        if (!ACTION_REPLY.equals(action) && !ACTION_CALLBACK.equals(action)) {
            return;
        }
        PendingResult pendingResult = goAsync();
        Context appContext = context.getApplicationContext();
        String commandId = intent.getStringExtra(EXTRA_COMMAND_ID);
        String promptId = intent.getStringExtra(EXTRA_PROMPT_ID);
        String notificationKey = intent.getStringExtra(EXTRA_NOTIFICATION_KEY);
        String actionId = intent.getStringExtra(EXTRA_ACTION_ID);
        String actionKind = intent.getStringExtra(EXTRA_ACTION_KIND);
        int notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 41002);
        String replyText = ACTION_REPLY.equals(action) ? replyText(intent) : "";
        boolean legacyAsk = intent.getBooleanExtra(EXTRA_LEGACY_ASK, false);
        Log.i(TAG, "notification callback action=" + action
                + " command_id=" + commandId
                + " action_id=" + actionId
                + " reply_len=" + replyText.length());
        EXECUTOR.execute(() -> {
            JSONObject log = new JSONObject();
            Json.put(log, "schema", "pucky.notification_callback.v1");
            Json.put(log, "event_id", "notify_" + UUID.randomUUID());
            Json.put(log, "command_id", commandId == null ? JSONObject.NULL : commandId);
            Json.put(log, "prompt_id", promptId == null ? JSONObject.NULL : promptId);
            Json.put(log, "notification_id", notificationId);
            Json.put(log, "notification_key", notificationKey == null ? JSONObject.NULL : notificationKey);
            Json.put(log, "action_id", actionId == null ? JSONObject.NULL : actionId);
            Json.put(log, "action_kind", actionKind == null ? JSONObject.NULL : actionKind);
            Json.put(log, "reply_text", replyText.isEmpty() ? JSONObject.NULL : replyText);
            try {
                BrokerReplyPoster poster = new BrokerReplyPoster(appContext);
                JSONObject postResult = legacyAsk && ACTION_REPLY.equals(action)
                        ? poster.post(commandId, promptId, replyText)
                        : poster.postEvent(log);
                Json.put(log, "post_result", postResult);
                Log.i(TAG, "callback post ok=" + postResult.optBoolean("ok", false)
                        + " status=" + postResult.optInt("http_status", 0));
            } catch (Exception e) {
                JSONObject error = new JSONObject();
                Json.put(error, "type", e.getClass().getSimpleName());
                Json.put(error, "message", e.getMessage() == null ? "" : e.getMessage());
                Json.put(log, "post_error", error);
                Log.w(TAG, "callback post failed " + e.getClass().getSimpleName() + ": " + e.getMessage());
            }
            try {
                CommandLogStore store = ((PuckyApplication) appContext).commandLogStore();
                store.append(commandId, ACTION_REPLY.equals(action) ? "notify.reply" : "notify.callback", "received", log);
            } catch (Exception ignored) {
            }
            NotificationManager manager = (NotificationManager) appContext.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null && ACTION_REPLY.equals(action)) {
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
