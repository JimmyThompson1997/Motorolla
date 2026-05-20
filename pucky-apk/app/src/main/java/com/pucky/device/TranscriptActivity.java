package com.pucky.device;

import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.pucky.device.ui.DetailSurfaceController;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class TranscriptActivity extends Activity {
    public static final String EXTRA_TITLE = "pucky_transcript_title";
    public static final String EXTRA_TRANSCRIPT = "pucky_transcript_text";
    public static final String EXTRA_MESSAGES_JSON = "pucky_transcript_messages_json";

    private static final int BACKGROUND = Color.rgb(2, 6, 10);
    private static final int CARD = Color.rgb(8, 17, 28);
    private static final int CARD_SOFT = Color.rgb(11, 24, 40);
    private static final int TEXT = Color.rgb(245, 249, 255);
    private static final int MUTED = Color.rgb(179, 201, 224);
    private static final int BLUE = Color.rgb(58, 132, 255);
    private static final int USER_BUBBLE = Color.rgb(16, 54, 96);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildView());
    }

    private FrameLayout buildView() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);

        ScrollView scroll = new ScrollView(this);
        scroll.setClipToPadding(false);
        scroll.setPadding(0, 0, 0, dp(88));
        scroll.setOverScrollMode(ScrollView.OVER_SCROLL_NEVER);
        DetailSurfaceController.installEdgeSwipeDismiss(this, scroll);
        LinearLayout thread = new LinearLayout(this);
        thread.setOrientation(LinearLayout.VERTICAL);
        thread.setPadding(dp(14), dp(18), dp(14), dp(24));
        scroll.addView(thread, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        thread.addView(dayDivider("Today"));
        for (Message message : messages()) {
            thread.addView(messageRow(message));
        }

        FrameLayout.LayoutParams scrollParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
        root.addView(scroll, scrollParams);
        return root;
    }

    private TextView dayDivider(String label) {
        TextView divider = new TextView(this);
        divider.setText(label);
        divider.setTextColor(MUTED);
        divider.setTextSize(11);
        divider.setGravity(Gravity.CENTER);
        divider.setPadding(0, dp(6), 0, dp(12));
        return divider;
    }

    private ViewGroup messageRow(Message message) {
        boolean user = message.isUser();
        LinearLayout row = new LinearLayout(this);
        row.setGravity(user ? Gravity.END : Gravity.START);
        row.setPadding(0, 0, 0, dp(8));

        LinearLayout bubble = new LinearLayout(this);
        bubble.setOrientation(LinearLayout.VERTICAL);
        bubble.setPadding(dp(12), dp(9), dp(12), dp(7));
        bubble.setBackground(roundRect(user ? USER_BUBBLE : CARD, Color.rgb(33, 52, 72), dp(18)));

        if (!message.mediaType.isEmpty()) {
            bubble.addView(mediaView(message));
        }
        if (!message.text.isEmpty()) {
            TextView text = new TextView(this);
            text.setText(message.text);
            text.setTextColor(TEXT);
            text.setTextSize(15);
            text.setLineSpacing(0, 1.04f);
            bubble.addView(text);
        }

        TextView timestamp = new TextView(this);
        timestamp.setText(message.timestamp.isEmpty() ? "now" : message.timestamp);
        timestamp.setTextColor(MUTED);
        timestamp.setTextSize(10);
        timestamp.setGravity(user ? Gravity.END : Gravity.START);
        LinearLayout.LayoutParams timeParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        timeParams.setMargins(0, dp(5), 0, 0);
        bubble.addView(timestamp, timeParams);

        LinearLayout.LayoutParams bubbleParams = new LinearLayout.LayoutParams(
                Math.round(getResources().getDisplayMetrics().widthPixels * 0.76f),
                ViewGroup.LayoutParams.WRAP_CONTENT);
        row.addView(bubble, bubbleParams);
        return row;
    }

    private ViewGroup mediaView(Message message) {
        LinearLayout wrap = new LinearLayout(this);
        wrap.setOrientation(LinearLayout.VERTICAL);
        wrap.setPadding(0, 0, 0, message.text.isEmpty() ? 0 : dp(8));
        if ("image".equals(message.mediaType)) {
            Bitmap bitmap = decodeAppImage(message.mediaPath);
            if (bitmap != null) {
                ImageView image = new ImageView(this);
                image.setImageBitmap(bitmap);
                image.setScaleType(ImageView.ScaleType.CENTER_CROP);
                image.setBackground(roundRect(CARD_SOFT, Color.rgb(33, 52, 72), dp(14)));
                wrap.addView(image, new LinearLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        dp(130)));
                return wrap;
            }
        }

        TextView pill = new TextView(this);
        String label = message.mediaLabel.isEmpty() ? message.mediaType : message.mediaLabel;
        pill.setText(mediaPrefix(message.mediaType) + " " + label);
        pill.setTextColor(TEXT);
        pill.setTextSize(13);
        pill.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        pill.setPadding(dp(10), dp(9), dp(10), dp(9));
        pill.setBackground(roundRect(CARD_SOFT, BLUE, dp(14)));
        wrap.addView(pill, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        return wrap;
    }

    private String mediaPrefix(String mediaType) {
        if ("image".equals(mediaType)) {
            return "Image";
        }
        if ("video".equals(mediaType)) {
            return "Video";
        }
        if ("link".equals(mediaType)) {
            return "Link";
        }
        return "Attachment";
    }

    private Bitmap decodeAppImage(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return null;
        }
        try {
            File file = new File(raw).getCanonicalFile();
            if (!isWithin(file, getFilesDir())
                    && !isWithin(file, getCacheDir())
                    && !isWithin(file, getExternalFilesDir(null))) {
                return null;
            }
            return BitmapFactory.decodeFile(file.getAbsolutePath());
        } catch (Exception ignored) {
            return null;
        }
    }

    private List<Message> messages() {
        List<Message> out = messagesFromJson(getIntent().getStringExtra(EXTRA_MESSAGES_JSON));
        if (!out.isEmpty()) {
            return out;
        }
        String raw = getIntent().getStringExtra(EXTRA_TRANSCRIPT);
        if (raw == null || raw.trim().isEmpty()) {
            out.add(new Message("pucky", "Transcript is not attached yet.", "now", "", "", ""));
            return out;
        }
        for (String line : raw.split("\\r?\\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            String lower = trimmed.toLowerCase(Locale.US);
            String sender = lower.startsWith("you:") || lower.startsWith("user:") ? "user" : "pucky";
            out.add(new Message(sender, trimmed, "now", "", "", ""));
        }
        return out;
    }

    private List<Message> messagesFromJson(String raw) {
        List<Message> out = new ArrayList<>();
        if (raw == null || raw.trim().isEmpty()) {
            return out;
        }
        try {
            JSONArray array = new JSONArray(raw);
            for (int index = 0; index < array.length(); index++) {
                JSONObject item = array.optJSONObject(index);
                if (item == null) {
                    continue;
                }
                out.add(new Message(
                        item.optString("sender", item.optString("role", "pucky")),
                        item.optString("text", ""),
                        item.optString("timestamp", item.optString("time", "")),
                        item.optString("media_type", item.optString("type", "")),
                        item.optString("media_label", item.optString("label", "")),
                        item.optString("media_path", item.optString("path", ""))));
            }
        } catch (Exception ignored) {
            out.clear();
        }
        return out;
    }

    private String title() {
        String raw = getIntent().getStringExtra(EXTRA_TITLE);
        return raw == null || raw.trim().isEmpty() ? "Transcript" : raw;
    }

    private static boolean isWithin(File file, File root) throws Exception {
        if (root == null) {
            return false;
        }
        String filePath = file.getCanonicalPath();
        String rootPath = root.getCanonicalPath();
        return filePath.equals(rootPath) || filePath.startsWith(rootPath + File.separator);
    }

    private GradientDrawable roundRect(int fill, int stroke, int radiusPx) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(radiusPx);
        drawable.setStroke(1, stroke);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void finish() {
        super.finish();
        DetailSurfaceController.applyCloseTransition(this);
    }

    private static final class Message {
        final String sender;
        final String text;
        final String timestamp;
        final String mediaType;
        final String mediaLabel;
        final String mediaPath;

        Message(String sender, String text, String timestamp, String mediaType, String mediaLabel, String mediaPath) {
            this.sender = sender == null ? "" : sender.trim().toLowerCase(Locale.US);
            this.text = text == null ? "" : text.trim();
            this.timestamp = timestamp == null ? "" : timestamp.trim();
            this.mediaType = mediaType == null ? "" : mediaType.trim().toLowerCase(Locale.US);
            this.mediaLabel = mediaLabel == null ? "" : mediaLabel.trim();
            this.mediaPath = mediaPath == null ? "" : mediaPath.trim();
        }

        boolean isUser() {
            return "user".equals(sender) || "you".equals(sender) || "me".equals(sender);
        }
    }
}
