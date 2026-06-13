package com.pucky.device.notifications;

import android.content.Context;

import com.pucky.device.audio.AudioController;
import com.pucky.device.haptics.HapticController;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public final class NotificationCompanionCueController {
    private static final ScheduledExecutorService EXECUTOR = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "pucky-notification-cues");
        thread.setDaemon(true);
        return thread;
    });

    private static final ConcurrentHashMap<Integer, ScheduledFuture<?>> ACTIVE = new ConcurrentHashMap<>();

    private final Context context;

    public NotificationCompanionCueController(Context context) {
        this.context = context.getApplicationContext();
    }

    public void play(
            int notificationId,
            NotificationPayloadNormalizer.CueSpec tone,
            NotificationPayloadNormalizer.CueSpec haptic,
            boolean repeatUntilCancelled) {
        cancel(notificationId);
        Runnable cue = () -> {
            if (tone != null && tone.enabled) {
                AudioController.playTone(tone.durationMs, tone.volume, tone.tone, tone.repeatCount, tone.repeatGapMs);
            }
            if (haptic != null && haptic.enabled) {
                HapticController.playCue(context, haptic);
            }
        };
        cue.run();
        if (!repeatUntilCancelled) {
            return;
        }
        long everyMs = Math.max(5000L, Math.max(totalDuration(tone), totalDuration(haptic)) + 1200L);
        ScheduledFuture<?> future = EXECUTOR.scheduleWithFixedDelay(cue, everyMs, everyMs, TimeUnit.MILLISECONDS);
        ACTIVE.put(notificationId, future);
    }

    public void cancel(int notificationId) {
        ScheduledFuture<?> future = ACTIVE.remove(notificationId);
        if (future != null) {
            future.cancel(true);
        }
    }

    private static long totalDuration(NotificationPayloadNormalizer.CueSpec cue) {
        if (cue == null || !cue.enabled) {
            return 0L;
        }
        if (cue.patternMs.length == 0) {
            return cue.durationMs + ((long) cue.repeatCount * (cue.durationMs + cue.repeatGapMs));
        }
        long total = 0L;
        for (long part : cue.patternMs) {
            total += Math.max(0L, part);
        }
        return total + ((long) cue.repeatCount * (total + cue.repeatGapMs));
    }
}
