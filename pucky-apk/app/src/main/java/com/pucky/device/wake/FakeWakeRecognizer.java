package com.pucky.device.wake;

import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.atomic.AtomicBoolean;

final class FakeWakeRecognizer implements WakeRecognizer {
    static final class Factory implements WakeRecognizerFactory {
        @Override
        public WakeRecognizer create() {
            return new FakeWakeRecognizer();
        }
    }

    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean stopped = new AtomicBoolean(false);

    private Callback callback;

    @Override
    public void start(Callback callback) {
        if (callback == null) {
            throw new IllegalArgumentException("WakeRecognizer callback is required");
        }
        this.callback = callback;
        main.post(() -> {
            Callback target = this.callback;
            if (target == null || stopped.get()) {
                notifyStoppedOnce();
                return;
            }
            target.onReady();
        });
    }

    @Override
    public void stop() {
        if (!stopped.compareAndSet(false, true)) {
            return;
        }
        main.post(this::notifyStopped);
    }

    private void notifyStoppedOnce() {
        if (stopped.compareAndSet(false, true)) {
            notifyStopped();
        }
    }

    private void notifyStopped() {
        Callback target = callback;
        if (target != null) {
            target.onStopped();
        }
    }
}
