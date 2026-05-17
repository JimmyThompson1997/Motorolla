package com.pucky.device.timers;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

public final class TimerReceiver extends BroadcastReceiver {
    public static final String ACTION_TIMER_FIRED = "com.pucky.device.TIMER_FIRED";
    public static final String EXTRA_ID = "id";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";

    private static final String CHANNEL_ID = "pucky_timers";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Build.VERSION.SDK_INT >= 33
                && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        createChannel(context);
        String id = intent == null ? "timer" : intent.getStringExtra(EXTRA_ID);
        String title = intent == null ? "Pucky timer" : intent.getStringExtra(EXTRA_TITLE);
        String text = intent == null ? "Timer done" : intent.getStringExtra(EXTRA_TEXT);
        if (title == null || title.trim().isEmpty()) {
            title = "Pucky timer";
        }
        if (text == null || text.trim().isEmpty()) {
            text = "Timer done";
        }
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);
        Notification notification = builder
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_notify_more)
                .setAutoCancel(true)
                .build();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(notificationId(id), notification);
        }
    }

    private void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Pucky timers",
                NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null);
        channel.enableVibration(false);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private int notificationId(String id) {
        return id == null ? 41003 : 41003 ^ id.hashCode();
    }
}
