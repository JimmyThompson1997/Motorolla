package com.pucky.device.timers;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONObject;

public final class TimerController {
    private final Context context;

    public TimerController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject set(JSONObject args) throws CommandException {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "AlarmManager unavailable");
        }
        String id = args.optString("id", "timer_" + System.currentTimeMillis());
        long delayMs = args.has("delay_ms")
                ? args.optLong("delay_ms")
                : Math.round(args.optDouble("seconds", 60.0) * 1000.0);
        delayMs = Math.max(1000, Math.min(24L * 60L * 60L * 1000L, delayMs));
        String title = args.optString("title", "Pucky timer");
        String text = args.optString("text", "Timer done");
        long triggerElapsed = SystemClock.elapsedRealtime() + delayMs;

        Intent intent = new Intent(context, TimerReceiver.class)
                .setAction(TimerReceiver.ACTION_TIMER_FIRED)
                .putExtra(TimerReceiver.EXTRA_ID, id)
                .putExtra(TimerReceiver.EXTRA_TITLE, title)
                .putExtra(TimerReceiver.EXTRA_TEXT, text);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCode(id),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerElapsed, pendingIntent);

        JSONObject out = new JSONObject();
        Json.put(out, "scheduled", true);
        Json.put(out, "id", id);
        Json.put(out, "delay_ms", delayMs);
        Json.put(out, "trigger_elapsed_ms", triggerElapsed);
        Json.put(out, "durable_while_app_stopped", true);
        Json.put(out, "survives_reboot", false);
        Json.put(out, "sound", false);
        Json.put(out, "vibration", false);
        return out;
    }

    public JSONObject cancel(JSONObject args) throws CommandException {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "AlarmManager unavailable");
        }
        String id = args.optString("id", "");
        if (id.trim().isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "timer.cancel requires id");
        }
        Intent intent = new Intent(context, TimerReceiver.class).setAction(TimerReceiver.ACTION_TIMER_FIRED);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCode(id),
                intent,
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        boolean existed = pendingIntent != null;
        if (pendingIntent != null) {
            manager.cancel(pendingIntent);
            pendingIntent.cancel();
        }
        JSONObject out = new JSONObject();
        Json.put(out, "cancelled", existed);
        Json.put(out, "id", id);
        return out;
    }

    private int requestCode(String id) {
        return id == null ? 0 : id.hashCode();
    }
}
