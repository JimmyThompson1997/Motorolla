package com.pucky.device.intents;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.Settings;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

public final class IntentController {
    private final Context context;

    public IntentController(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject settingsOpen(JSONObject args) throws CommandException {
        String target = args.optString("target", "settings");
        Intent intent = settingsIntent(target);
        launch(intent, args.optBoolean("require_resolvable", false));
        JSONObject out = new JSONObject();
        Json.put(out, "launched", true);
        Json.put(out, "target", target);
        Json.put(out, "action", intent.getAction());
        Json.put(out, "user_mediated", true);
        return out;
    }

    public JSONObject browserOpen(JSONObject args) throws CommandException {
        String url = args.optString("url", args.optString("uri", ""));
        if (url.trim().isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "browser.open requires url");
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        launch(intent, args.optBoolean("require_resolvable", true));
        JSONObject out = new JSONObject();
        Json.put(out, "launched", true);
        Json.put(out, "uri", url);
        Json.put(out, "user_mediated", true);
        return out;
    }

    public JSONObject shareText(JSONObject args) throws CommandException {
        String text = args.optString("text", "");
        if (text.trim().isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "share.text requires text");
        }
        Intent send = new Intent(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, text);
        String title = args.optString("title", "Share with");
        Intent chooser = Intent.createChooser(send, title);
        launch(chooser, false);
        JSONObject out = new JSONObject();
        Json.put(out, "launched", true);
        Json.put(out, "title", title);
        Json.put(out, "user_mediated", true);
        return out;
    }

    public JSONObject clockAlarmIntent(JSONObject args) throws CommandException {
        int hour = args.optInt("hour", -1);
        int minutes = args.optInt("minutes", -1);
        if (hour < 0 || hour > 23 || minutes < 0 || minutes > 59) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "alarm.intent.set requires hour 0-23 and minutes 0-59");
        }
        Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM)
                .putExtra(AlarmClock.EXTRA_HOUR, hour)
                .putExtra(AlarmClock.EXTRA_MINUTES, minutes)
                .putExtra(AlarmClock.EXTRA_MESSAGE, args.optString("message", "Pucky alarm"))
                .putExtra(AlarmClock.EXTRA_VIBRATE, args.optBoolean("vibrate", false))
                .putExtra(AlarmClock.EXTRA_SKIP_UI, args.optBoolean("skip_ui", false));
        JSONArray days = args.optJSONArray("days");
        if (days != null && days.length() > 0) {
            java.util.ArrayList<Integer> alarmDays = new java.util.ArrayList<>();
            for (int i = 0; i < days.length(); i++) {
                alarmDays.add(days.optInt(i));
            }
            intent.putIntegerArrayListExtra(AlarmClock.EXTRA_DAYS, alarmDays);
        }
        launch(intent, args.optBoolean("require_resolvable", true));
        JSONObject out = new JSONObject();
        Json.put(out, "launched", true);
        Json.put(out, "action", AlarmClock.ACTION_SET_ALARM);
        Json.put(out, "skip_ui", args.optBoolean("skip_ui", false));
        Json.put(out, "user_mediated", !args.optBoolean("skip_ui", false));
        return out;
    }

    public JSONObject calendarInsertIntent(JSONObject args) throws CommandException {
        String title = args.optString("title", "");
        if (title.trim().isEmpty()) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND, "calendar.intent.insert requires title");
        }
        Intent intent = new Intent(Intent.ACTION_INSERT)
                .setData(CalendarContract.Events.CONTENT_URI)
                .putExtra(CalendarContract.Events.TITLE, title)
                .putExtra(CalendarContract.Events.DESCRIPTION, args.optString("description", ""))
                .putExtra(CalendarContract.Events.EVENT_LOCATION, args.optString("location", ""));
        if (args.has("begin_ms")) {
            intent.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, args.optLong("begin_ms"));
        }
        if (args.has("end_ms")) {
            intent.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, args.optLong("end_ms"));
        }
        launch(intent, args.optBoolean("require_resolvable", true));
        JSONObject out = new JSONObject();
        Json.put(out, "launched", true);
        Json.put(out, "action", Intent.ACTION_INSERT);
        Json.put(out, "user_mediated", true);
        return out;
    }

    public JSONObject dialIntent(JSONObject args) throws CommandException {
        String number = args.optString("number", "");
        Intent intent = new Intent(Intent.ACTION_DIAL);
        if (!number.trim().isEmpty()) {
            intent.setData(Uri.parse("tel:" + Uri.encode(number)));
        }
        launch(intent, args.optBoolean("require_resolvable", true));
        JSONObject out = new JSONObject();
        Json.put(out, "launched", true);
        Json.put(out, "user_mediated", true);
        return out;
    }

    private Intent settingsIntent(String target) {
        String normalized = target == null ? "" : target.trim().toLowerCase();
        Intent intent;
        switch (normalized) {
            case "wifi":
                intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
                break;
            case "internet_panel":
                intent = new Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY);
                break;
            case "bluetooth":
                intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
                break;
            case "location":
                intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                break;
            case "home":
                intent = new Intent(Settings.ACTION_HOME_SETTINGS);
                break;
            case "assistant":
            case "voice":
            case "voice_input":
                intent = new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS);
                break;
            case "app_details":
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + context.getPackageName()));
                break;
            case "notification_app":
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
                break;
            case "battery_optimization":
                intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                break;
            case "accessibility":
                intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                break;
            case "data_usage":
                intent = new Intent(Settings.ACTION_DATA_USAGE_SETTINGS);
                break;
            case "date":
                intent = new Intent(Settings.ACTION_DATE_SETTINGS);
                break;
            case "display":
                intent = new Intent(Settings.ACTION_DISPLAY_SETTINGS);
                break;
            case "sound":
                intent = new Intent(Settings.ACTION_SOUND_SETTINGS);
                break;
            case "security":
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
                break;
            case "developer_options":
                intent = new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS);
                break;
            default:
                intent = new Intent(Settings.ACTION_SETTINGS);
                break;
        }
        return intent;
    }

    private void launch(Intent intent, boolean requireResolvable) throws CommandException {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (requireResolvable && intent.resolveActivity(context.getPackageManager()) == null) {
            throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE, "No activity can handle " + intent.getAction());
        }
        context.startActivity(intent);
    }
}
