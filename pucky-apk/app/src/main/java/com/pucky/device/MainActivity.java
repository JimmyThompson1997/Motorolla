package com.pucky.device;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import com.pucky.device.assistant.PuckyAssistantController;
import com.pucky.device.buttons.ButtonController;
import com.pucky.device.command.CommandException;
import com.pucky.device.livekit.LiveKitController;
import com.pucky.device.player.PlayerController;
import com.pucky.device.service.PuckyForegroundService;
import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.tunnel.TunnelController;
import com.pucky.device.ui.ReplyCard;
import com.pucky.device.ui.ReplyCardStore;
import com.pucky.device.util.Json;
import com.pucky.device.wake.WakeWordController;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final String TAG = "PuckyMainActivity";
    public static final String EXTRA_WAKE_SCREEN = "pucky_wake_screen";
    private static final int REQUEST_ALL_PERMISSIONS = 1001;
    private static final int REQUEST_ASSISTANT_SETUP_PERMISSIONS = 4206;
    private static final int ASSISTANT_SETUP_NOTIFICATION_ID = 4207;
    private static final String ASSISTANT_SETUP_CHANNEL_ID = "pucky_assistant_setup";

    private static final int BACKGROUND = Color.rgb(2, 6, 10);
    private static final int CARD = Color.rgb(8, 17, 28);
    private static final int CARD_SOFT = Color.rgb(11, 24, 40);
    private static final int TEXT = Color.rgb(245, 249, 255);
    private static final int MUTED = Color.rgb(179, 201, 224);
    private static final int BLUE = Color.rgb(58, 132, 255);

    private SettingsStore settingsStore;
    private ReplyCardStore replyCardStore;
    private ButtonController buttonController;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private LinearLayout cardList;
    private TextView emptyView;
    private boolean stateReceiverRegistered;
    private boolean screenReceiverRegistered;
    private boolean pendingAssistantSetupAfterPermission;
    private long wakeScreenUntilMs;

    private final BroadcastReceiver stateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            renderCurrent();
        }
    };

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent == null ? "" : intent.getAction();
            if (Intent.ACTION_SCREEN_ON.equals(action) || Intent.ACTION_SCREEN_OFF.equals(action)) {
                mainHandler.post(MainActivity.this::renderCurrent);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PuckyApplication app = (PuckyApplication) getApplication();
        settingsStore = app.settingsStore();
        replyCardStore = new ReplyCardStore(this);
        buttonController = new ButtonController(this);
        configureApplianceWindow();
        setContentView(buildHomeView());
        applySystemUiForMode();
        renderCurrent();
        handleLaunchIntent(getIntent());
        requestNeededPermissions();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        configureApplianceWindow();
        showHomeScreen();
        handleLaunchIntent(intent);
        if (intent != null && "com.pucky.device.action.REQUEST_PERMISSIONS".equals(intent.getAction())) {
            requestNeededPermissions();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        configureApplianceWindow();
        if (!stateReceiverRegistered) {
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(stateReceiver, new IntentFilter(PuckyState.ACTION_CHANGED), RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(stateReceiver, new IntentFilter(PuckyState.ACTION_CHANGED));
            }
            stateReceiverRegistered = true;
        }
        if (!screenReceiverRegistered) {
            IntentFilter screenFilter = new IntentFilter();
            screenFilter.addAction(Intent.ACTION_SCREEN_ON);
            screenFilter.addAction(Intent.ACTION_SCREEN_OFF);
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(screenReceiver, screenFilter, RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(screenReceiver, screenFilter);
            }
            screenReceiverRegistered = true;
        }
        applySystemUiForMode();
        ensureAutoConnectService();
        WakeWordController.shared(this).start(new JSONObject());
        renderCurrent();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applySystemUiForMode();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (stateReceiverRegistered) {
            unregisterReceiver(stateReceiver);
            stateReceiverRegistered = false;
        }
        if (screenReceiverRegistered) {
            unregisterReceiver(screenReceiver);
            screenReceiverRegistered = false;
        }
    }

    @Override
    protected void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (buttonController != null) {
            boolean handled = false;
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                handled = buttonController.handleKeyDown(event.getKeyCode(), event);
            } else if (event.getAction() == KeyEvent.ACTION_UP) {
                handled = buttonController.handleKeyUp(event.getKeyCode(), event);
            }
            if (handled) {
                renderCurrent();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_ASSISTANT_SETUP_PERMISSIONS && pendingAssistantSetupAfterPermission) {
            pendingAssistantSetupAfterPermission = false;
            mainHandler.post(this::continueAssistantSetupFlow);
        }
    }

    private void requestNeededPermissions() {
        List<String> missing = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        addMissingPermission(missing, Manifest.permission.READ_SMS);
        addMissingPermission(missing, Manifest.permission.SEND_SMS);
        addMissingPermission(missing, Manifest.permission.RECEIVE_SMS);
        addMissingPermission(missing, Manifest.permission.CALL_PHONE);
        addMissingPermission(missing, Manifest.permission.ANSWER_PHONE_CALLS);
        addMissingPermission(missing, Manifest.permission.READ_PHONE_STATE);
        addMissingPermission(missing, Manifest.permission.READ_CALL_LOG);
        addMissingPermission(missing, Manifest.permission.WRITE_CALL_LOG);
        addMissingPermission(missing, Manifest.permission.READ_CONTACTS);
        addMissingPermission(missing, Manifest.permission.WRITE_CONTACTS);
        addMissingPermission(missing, Manifest.permission.GET_ACCOUNTS);
        addMissingPermission(missing, Manifest.permission.READ_CALENDAR);
        addMissingPermission(missing, Manifest.permission.WRITE_CALENDAR);
        if (Build.VERSION.SDK_INT >= 33) {
            addMissingPermission(missing, Manifest.permission.READ_MEDIA_IMAGES);
            addMissingPermission(missing, Manifest.permission.READ_MEDIA_VIDEO);
            addMissingPermission(missing, Manifest.permission.READ_MEDIA_AUDIO);
        } else {
            addMissingPermission(missing, Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        addMissingPermission(missing, Manifest.permission.CAMERA);
        addMissingPermission(missing, Manifest.permission.RECORD_AUDIO);
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
            missing.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (!missing.isEmpty()) {
            requestPermissions(missing.toArray(new String[0]), REQUEST_ALL_PERMISSIONS);
        }
    }

    private void addMissingPermission(List<String> missing, String permission) {
        if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
            missing.add(permission);
        }
    }

    private void configureApplianceWindow() {
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        boolean wakeScreen = shouldWakeScreenForThisResume();
        if (wakeScreen) {
            mainHandler.postDelayed(this::configureApplianceWindow, 3_100L);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(wakeScreen);
            setTurnScreenOn(wakeScreen);
            if (wakeScreen) {
                KeyguardManager keyguardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
                if (keyguardManager != null) {
                    keyguardManager.requestDismissKeyguard(this, null);
                }
            }
        } else if (wakeScreen) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            getWindow().setAttributes(params);
        }
    }

    private boolean consumeWakeScreenRequest() {
        Intent intent = getIntent();
        if (intent == null || !intent.getBooleanExtra(EXTRA_WAKE_SCREEN, false)) {
            return false;
        }
        intent.removeExtra(EXTRA_WAKE_SCREEN);
        return true;
    }

    private boolean shouldWakeScreenForThisResume() {
        if (consumeWakeScreenRequest()) {
            wakeScreenUntilMs = SystemClock.elapsedRealtime() + 3_000L;
            return true;
        }
        return SystemClock.elapsedRealtime() < wakeScreenUntilMs;
    }

    private void applySystemUiForMode() {
        Window window = getWindow();
        View decorView = window.getDecorView();
        decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = decorView.getWindowInsetsController();
            if (controller != null) {
                controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
            }
            window.setDecorFitsSystemWindows(true);
        }
    }

    private View buildHomeView() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        root.setPadding(dp(14), dp(16), dp(14), dp(18));

        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setGravity(Gravity.CENTER_HORIZONTAL);
        root.addView(shell, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(8), 0, dp(8), dp(10));
        shell.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        ImageView mail = new ImageView(this);
        mail.setImageResource(R.drawable.pucky_ic_mailbox);
        mail.setColorFilter(TEXT);
        LinearLayout.LayoutParams mailParams = new LinearLayout.LayoutParams(dp(30), dp(30));
        mailParams.setMargins(0, 0, dp(10), 0);
        header.addView(mail, mailParams);

        TextView title = new TextView(this);
        title.setText("Pucky");
        title.setTextColor(TEXT);
        title.setTextSize(24);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        header.addView(title);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        shell.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(content, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        emptyView = new TextView(this);
        emptyView.setText("No replies yet.\nPucky will place agent replies here.");
        emptyView.setTextColor(MUTED);
        emptyView.setTextSize(18);
        emptyView.setGravity(Gravity.CENTER);
        emptyView.setPadding(dp(18), dp(50), dp(18), dp(50));
        emptyView.setBackground(roundRect(CARD, Color.rgb(32, 55, 78), dp(24)));
        content.addView(emptyView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        cardList = new LinearLayout(this);
        cardList.setOrientation(LinearLayout.VERTICAL);
        content.addView(cardList, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        return root;
    }

    private void showHomeScreen() {
        if (cardList == null) {
            setContentView(buildHomeView());
        }
        renderCurrent();
    }

    private void renderCurrent() {
        renderHome();
    }

    private void renderHome() {
        if (cardList == null || replyCardStore == null) {
            return;
        }
        List<ReplyCard> cards = replyCardStore.cards();
        cardList.removeAllViews();
        emptyView.setVisibility(cards.isEmpty() ? View.VISIBLE : View.GONE);
        for (ReplyCard card : cards) {
            cardList.addView(cardView(card));
        }
    }

    private View cardView(ReplyCard card) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(12), dp(12), dp(10), dp(12));
        row.setMinimumHeight(dp(96));
        row.setBackground(roundRect(CARD, Color.rgb(33, 52, 72), dp(18)));

        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        rowParams.setMargins(0, 0, 0, dp(10));
        row.setLayoutParams(rowParams);

        int accent = parseColor(card.accent(), BLUE);
        row.addView(identityMark(card, accent), new LinearLayout.LayoutParams(dp(64), dp(56)));

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(12), 0, dp(8), 0);
        row.addView(body, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        TextView title = new TextView(this);
        title.setText(card.title());
        title.setTextColor(TEXT);
        title.setTextSize(17);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setSingleLine(true);
        body.addView(title);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        if (card.hasAudio()) {
            ImageButton play = iconActionButton(android.R.drawable.ic_btn_speak_now);
            play.setOnClickListener(view -> playReplyAudio(card));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(48), dp(40));
            params.setMargins(0, 0, dp(8), 0);
            actions.addView(play, params);
        }
        if (card.hasHtml()) {
            Button open = chevronButton();
            open.setTextSize(20);
            open.setOnClickListener(view -> openRichReply(card));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(42), dp(40));
            actions.addView(open, params);
        }
        row.addView(actions, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        return row;
    }

    private View identityMark(ReplyCard card, int accent) {
        FrameLayout mark = new FrameLayout(this);

        ImageView icon = new ImageView(this);
        icon.setImageResource(drawableForIcon(card.icon()));
        icon.setColorFilter(TEXT);
        icon.setPadding(dp(10), dp(10), dp(10), dp(10));
        icon.setBackground(roundRect(CARD_SOFT, Color.rgb(40, 58, 78), dp(14)));
        FrameLayout.LayoutParams iconParams = new FrameLayout.LayoutParams(dp(46), dp(46), Gravity.START | Gravity.CENTER_VERTICAL);
        mark.addView(icon, iconParams);

        if (!card.emoji().isEmpty()) {
            TextView emoji = new TextView(this);
            emoji.setText(card.emoji());
            emoji.setTextSize(18);
            emoji.setGravity(Gravity.CENTER);
            emoji.setBackground(roundRect(Color.rgb(2, 6, 10), accent, dp(13)));
            FrameLayout.LayoutParams emojiParams = new FrameLayout.LayoutParams(dp(28), dp(28), Gravity.END | Gravity.BOTTOM);
            mark.addView(emoji, emojiParams);
        }
        return mark;
    }

    private Button actionButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(TEXT);
        button.setTextSize(13);
        button.setAllCaps(false);
        button.setPadding(0, 0, 0, 0);
        button.setBackground(roundRect(CARD_SOFT, BLUE, dp(16)));
        return button;
    }

    private ImageButton iconActionButton(int drawableRes) {
        ImageButton button = new ImageButton(this);
        button.setImageResource(drawableRes);
        button.setColorFilter(TEXT);
        button.setScaleType(ImageView.ScaleType.CENTER);
        button.setPadding(dp(9), dp(9), dp(9), dp(9));
        button.setBackground(roundRect(CARD_SOFT, BLUE, dp(16)));
        return button;
    }

    private Button chevronButton() {
        Button button = actionButton(">");
        button.setTextColor(TEXT);
        button.setBackground(roundRectNoStroke(Color.TRANSPARENT, dp(16)));
        return button;
    }

    private void playReplyAudio(ReplyCard card) {
        JSONObject args = new JSONObject();
        Json.put(args, "path", card.audioPath());
        Json.put(args, "title", card.title());
        Json.put(args, "source", "reply_card");
        try {
            PlayerController.shared(this).play(args);
            PuckyState.get().setLifecycleEvent("reply_card.audio_play");
        } catch (CommandException exc) {
            Log.w(TAG, "Unable to play reply audio", exc);
            PuckyState.get().setLastError("Reply audio failed: " + exc.getMessage());
            PuckyState.get().broadcast(this);
        }
    }

    private void openRichReply(ReplyCard card) {
        Intent intent = new Intent(this, RichReplyActivity.class)
                .putExtra(RichReplyActivity.EXTRA_HTML_PATH, card.htmlPath())
                .putExtra(RichReplyActivity.EXTRA_TITLE, card.title());
        startActivity(intent);
    }

    private int drawableForIcon(String icon) {
        String normalized = icon == null ? "" : icon.trim().toLowerCase();
        if ("clock".equals(normalized) || "time".equals(normalized) || "timer".equals(normalized)) {
            return R.drawable.pucky_ic_clock;
        }
        if ("bolt".equals(normalized) || "lightning".equals(normalized) || "energy".equals(normalized)) {
            return R.drawable.pucky_ic_bolt;
        }
        return R.drawable.pucky_ic_mailbox;
    }

    private int parseColor(String raw, int fallback) {
        if (raw == null || raw.trim().isEmpty()) {
            return fallback;
        }
        try {
            return Color.parseColor(raw.trim());
        } catch (IllegalArgumentException ignored) {
            return fallback;
        }
    }

    private GradientDrawable roundRect(int fill, int stroke, int radiusPx) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(radiusPx);
        drawable.setStroke(1, stroke);
        return drawable;
    }

    private GradientDrawable roundRectNoStroke(int fill, int radiusPx) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(radiusPx);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void handleLaunchIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        String provisioningJson = provisioningJsonFromIntent(intent);
        if (provisioningJson != null) {
            try {
                JSONObject input = new JSONObject(provisioningJson);
                settingsStore.importProvisioningJson(input.toString());
                JSONObject tunnel = input.optJSONObject("tunnel");
                if (tunnel != null) {
                    TunnelController.shared(this, settingsStore).configure(tunnel);
                    if (tunnel.optBoolean("enabled", false) || tunnel.optBoolean("start", false)) {
                        PuckyForegroundService.start(this, false);
                    }
                }
                Log.i(TAG, "Imported provisioning_json");
                PuckyState.get().setLifecycleEvent("provisioning.imported");
                syncProvisioningState();
            } catch (Exception e) {
                Log.e(TAG, "Invalid provisioning_json", e);
                PuckyState.get().setLastError("Invalid provisioning JSON: " + e.getMessage());
            }
        }
        if (intent.hasExtra("broker_url")) {
            String brokerUrl = intent.getStringExtra("broker_url");
            String deviceId = intent.getStringExtra("device_id");
            String token = intent.getStringExtra("token");
            Log.i(TAG, "Saving launch broker_url=" + brokerUrl
                    + " device_id=" + deviceId
                    + " connect=" + intent.getBooleanExtra("connect", false));
            settingsStore.save(
                    deviceId == null ? settingsStore.getDeviceId() : deviceId,
                    brokerUrl == null ? settingsStore.getBrokerUrl() : brokerUrl,
                    token == null ? settingsStore.getToken() : token);
            syncProvisioningState();
        }
        if (intent.getBooleanExtra("connect", false)) {
            PuckyForegroundService.start(this, true);
        }
        if (shouldStartAssistantSetup(intent)) {
            startAssistantSetupFlow();
        }
    }

    private String provisioningJsonFromIntent(Intent intent) {
        if (intent == null) {
            return null;
        }
        if (intent.hasExtra("provisioning_json_base64")) {
            String encoded = intent.getStringExtra("provisioning_json_base64");
            if (encoded == null || encoded.trim().isEmpty()) {
                return "{}";
            }
            byte[] decoded = Base64.decode(encoded, Base64.DEFAULT);
            return new String(decoded, StandardCharsets.UTF_8);
        }
        if (intent.hasExtra("provisioning_json")) {
            String raw = intent.getStringExtra("provisioning_json");
            return raw == null ? "{}" : raw;
        }
        if (intent.hasExtra("provisioning_file")) {
            return provisioningJsonFromFile(intent.getStringExtra("provisioning_file"));
        }
        return null;
    }

    private String provisioningJsonFromFile(String fileName) {
        if (fileName == null || fileName.trim().isEmpty()) {
            return "{}";
        }
        String safeName = new File(fileName).getName();
        try (FileInputStream input = openFileInput(safeName);
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                output.write(buffer, 0, read);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception exc) {
            throw new IllegalArgumentException("Unable to read provisioning_file " + safeName
                    + ": " + exc.getMessage(), exc);
        }
    }

    private void ensureAutoConnectService() {
        if (settingsStore != null && settingsStore.isAutoConnectEnabled()) {
            PuckyForegroundService.start(this, true);
        }
    }

    private void syncProvisioningState() {
        PuckyState.get().setDeviceId(settingsStore.getDeviceId());
        PuckyState.get().setBrokerUrl(settingsStore.getBrokerUrl());
        renderCurrent();
    }

    private boolean shouldStartAssistantSetup(Intent intent) {
        return intent != null
                && (intent.getBooleanExtra("assistant_setup", false)
                || "com.pucky.device.action.ASSISTANT_SETUP".equals(intent.getAction()));
    }

    private void startAssistantSetupFlow() {
        List<String> missing = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.RECORD_AUDIO);
        }
        if (!missing.isEmpty()) {
            pendingAssistantSetupAfterPermission = true;
            requestPermissions(
                    missing.toArray(new String[0]),
                    REQUEST_ASSISTANT_SETUP_PERMISSIONS);
            return;
        }
        continueAssistantSetupFlow();
    }

    private void continueAssistantSetupFlow() {
        showAssistantSetupNotification();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R
                || (getDisplay() != null && getDisplay().getDisplayId() == 0)) {
            PuckyAssistantController.openAssistantSetup(this);
        }
    }

    private void showAssistantSetupNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                    ASSISTANT_SETUP_CHANNEL_ID,
                    "Pucky setup",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.enableVibration(true);
            manager.createNotificationChannel(channel);
        }

        Intent settingsIntent = new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (settingsIntent.resolveActivity(getPackageManager()) == null) {
            settingsIntent = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent openSettings = PendingIntent.getActivity(
                this,
                ASSISTANT_SETUP_NOTIFICATION_ID,
                settingsIntent,
                pendingFlags);

        String detail = "Open Android Settings and choose Pucky as your digital assistant app.";
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, ASSISTANT_SETUP_CHANNEL_ID)
                : new Notification.Builder(this);
        builder.setContentTitle("Set Pucky as assistant")
                .setContentText("Tap to choose Pucky in Android Settings.")
                .setStyle(new Notification.BigTextStyle().bigText(detail))
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(openSettings)
                .setAutoCancel(true)
                .setOnlyAlertOnce(false);
        if (Build.VERSION.SDK_INT < 26) {
            builder.setPriority(Notification.PRIORITY_HIGH);
        }
        manager.notify(ASSISTANT_SETUP_NOTIFICATION_ID, builder.build());
    }
}
