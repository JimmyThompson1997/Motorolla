package com.pucky.device.notifications;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

public final class PuckyNotificationListenerService extends NotificationListenerService {
    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        PuckyNotificationLedger.onListenerConnected(this, getActiveNotifications());
    }

    @Override
    public void onListenerDisconnected() {
        PuckyNotificationLedger.onListenerDisconnected(this);
        super.onListenerDisconnected();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification notification) {
        super.onNotificationPosted(notification);
        PuckyNotificationLedger.onNotificationPosted(this, notification);
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification notification) {
        super.onNotificationRemoved(notification);
        PuckyNotificationLedger.onNotificationRemoved(this, notification);
    }
}
