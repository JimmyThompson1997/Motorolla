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
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.text.TextUtils;
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
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
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
import com.pucky.device.ui.InteractivePanelController;
import com.pucky.device.ui.ReplyCard;
import com.pucky.device.ui.ReplyCardStore;
import com.pucky.device.ui.WaveformView;
import com.pucky.device.util.Json;
import com.pucky.device.wake.WakeWordController;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

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
    private static final int COVER_FEED_BOTTOM_SAFE_PADDING_DP = 104;

    private SettingsStore settingsStore;
    private ReplyCardStore replyCardStore;
    private ButtonController buttonController;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private FrameLayout rootView;
    private FrameLayout detailPanelLayer;
    private FrameLayout audioSheetLayer;
    private LinearLayout cardList;
    private TextView emptyView;
    private FrameLayout speedPickerOverlay;
    private View feedBottomSafeSpacer;
    private boolean stateReceiverRegistered;
    private boolean screenReceiverRegistered;
    private boolean pendingAssistantSetupAfterPermission;
    private static String activeAudioPath = "";
    private static final Map<String, Integer> savedAudioPositions = new HashMap<>();
    private static final Map<String, Integer> savedAudioDurations = new HashMap<>();
    private static final Map<String, Float> cardPlaybackSpeeds = new HashMap<>();
    private static float globalPlaybackSpeed = 1.0f;
    private boolean trackingAudioSeek;
    private boolean speedPickerOpen;
    private boolean audioSheetOpen;
    private ReplyCard audioSheetCard;
    private long wakeScreenUntilMs;

    private final Runnable playerTick = new Runnable() {
        @Override
        public void run() {
            if (!activeAudioPath.isEmpty()) {
                if (!trackingAudioSeek) {
                    renderCurrent();
                }
                schedulePlayerTick();
            }
        }
    };

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
        if (!activeAudioPath.isEmpty()) {
            schedulePlayerTick();
        }
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
        mainHandler.removeCallbacks(playerTick);
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
    public void onBackPressed() {
        if (speedPickerOpen) {
            closeSpeedPicker();
            return;
        }
        if (audioSheetOpen) {
            dismissAudioSheet();
            return;
        }
        if (detailPanelLayer != null && detailPanelLayer.getVisibility() == View.VISIBLE) {
            dismissDetailPanel();
            return;
        }
        super.onBackPressed();
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
        rootView = root;
        root.setBackgroundColor(BACKGROUND);
        root.setClickable(true);
        root.setOnClickListener(view -> closeSpeedPicker());

        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setGravity(Gravity.CENTER_HORIZONTAL);
        shell.setPadding(dp(14), dp(16), dp(14), dp(18));
        root.addView(shell, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        detailPanelLayer = new FrameLayout(this);
        detailPanelLayer.setVisibility(View.GONE);
        root.addView(detailPanelLayer, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        audioSheetLayer = new FrameLayout(this);
        audioSheetLayer.setVisibility(View.GONE);
        root.addView(audioSheetLayer, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        speedPickerOverlay = new FrameLayout(this);
        speedPickerOverlay.setVisibility(View.GONE);
        speedPickerOverlay.setClickable(true);
        speedPickerOverlay.setOnClickListener(view -> closeSpeedPicker());
        root.addView(speedPickerOverlay, new FrameLayout.LayoutParams(
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
        mail.setImageResource(android.R.drawable.ic_dialog_email);
        mail.setColorFilter(TEXT);
        LinearLayout.LayoutParams mailParams = new LinearLayout.LayoutParams(dp(30), dp(30));
        header.addView(mail, mailParams);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        scroll.setOverScrollMode(View.OVER_SCROLL_NEVER);
        applyFeedScrollSafePadding(scroll, 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            scroll.setOnApplyWindowInsetsListener((view, insets) -> {
                int navInset = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
                applyFeedScrollSafePadding(scroll, navInset);
                return insets;
            });
        }
        shell.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f));

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setClickable(true);
        content.setOnClickListener(view -> closeSpeedPicker());
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
        cardList.setClickable(true);
        cardList.setOnClickListener(view -> closeSpeedPicker());
        content.addView(cardList, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        feedBottomSafeSpacer = new View(this);
        feedBottomSafeSpacer.setContentDescription("cover_feed_bottom_safe_spacer");
        content.addView(feedBottomSafeSpacer, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(COVER_FEED_BOTTOM_SAFE_PADDING_DP)));
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
        renderAudioSheet();
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
        renderSpeedPickerOverlay();
    }

    private View cardView(ReplyCard card) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(12), dp(8), dp(10), dp(8));
        row.setMinimumHeight(dp(84));
        row.setBackground(roundRect(CARD, Color.rgb(33, 52, 72), dp(18)));

        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        rowParams.setMargins(0, 0, 0, dp(10));
        row.setLayoutParams(rowParams);

        row.addView(card.hasAudio() ? audioIdentityButton(card) : identityMark(card),
                new LinearLayout.LayoutParams(dp(44), dp(52)));

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

        if (isPlayingAudioCard(card)) {
            body.addView(audioWaveformLine(card));
        } else if (!card.summary().isEmpty()) {
            TextView preview = new TextView(this);
            preview.setText(card.summary());
            preview.setTextColor(TEXT);
            preview.setTextSize(12);
            preview.setMaxLines(2);
            preview.setEllipsize(TextUtils.TruncateAt.END);
            LinearLayout.LayoutParams previewParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT);
            previewParams.setMargins(0, dp(3), 0, 0);
            body.addView(preview, previewParams);
        }

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER);
        if (card.hasTranscript()) {
            ImageButton transcript = iconActionButton(R.drawable.pucky_ic_transcript);
            transcript.setOnClickListener(view -> {
                speedPickerOpen = false;
                showTranscript(card);
            });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(48), dp(40));
            params.setMargins(0, 0, dp(8), 0);
            actions.addView(transcript, params);
        }
        if (card.hasHtml()) {
            ImageButton open = iconActionButton(R.drawable.pucky_ic_attachment);
            open.setOnClickListener(view -> {
                speedPickerOpen = false;
                openRichReply(card);
            });
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(48), dp(40));
            actions.addView(open, params);
        }
        row.addView(actions, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        return row;
    }

    private View identityMark(ReplyCard card) {
        ImageView icon = new ImageView(this);
        icon.setImageResource(drawableForIcon(card.icon()));
        icon.setColorFilter(TEXT);
        icon.setPadding(dp(4), dp(4), dp(4), dp(4));
        return icon;
    }

    private ImageButton audioIdentityButton(ReplyCard card) {
        ImageButton button = new ImageButton(this);
        button.setImageResource(drawableForIcon(card.icon()));
        button.setColorFilter(TEXT);
        button.setScaleType(ImageView.ScaleType.CENTER);
        button.setPadding(dp(4), dp(4), dp(4), dp(4));
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setContentDescription("audio_toggle_" + card.title());
        button.setOnClickListener(view -> {
            closeSpeedPicker();
            toggleReplyAudio(card);
        });
        return button;
    }

    private View audioWaveformLine(ReplyCard card) {
        WaveformView waveform = new WaveformView(this);
        waveform.setAccentColor(parseColor(card.accent(), BLUE));
        waveform.setPlaying(true);
        waveform.setContentDescription("audio_waveform_" + card.title());
        waveform.setPadding(0, dp(3), 0, 0);
        waveform.setOnClickListener(view -> showAudioSheet(card));
        return waveform;
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

    private void renderAudioSheet() {
        if (audioSheetLayer == null) {
            return;
        }
        audioSheetLayer.removeAllViews();
        if (!audioSheetOpen || audioSheetCard == null) {
            audioSheetLayer.setVisibility(View.GONE);
            return;
        }
        audioSheetLayer.setVisibility(View.VISIBLE);
        audioSheetLayer.addView(audioSheetView(audioSheetCard), new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private View audioSheetView(ReplyCard card) {
        LinearLayout sheet = new LinearLayout(this);
        sheet.setOrientation(LinearLayout.VERTICAL);
        sheet.setPadding(dp(20), dp(36), dp(20), dp(28));
        sheet.setBackgroundColor(BACKGROUND);
        sheet.setClickable(true);
        sheet.setContentDescription("audio_sheet");
        InteractivePanelController.installDownSwipeDismiss(sheet, sheet, this::dismissAudioSheet);

        TextView title = new TextView(this);
        title.setText(card.title());
        title.setTextColor(TEXT);
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);
        sheet.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        if (!card.summary().isEmpty()) {
            TextView summary = new TextView(this);
            summary.setText(card.summary());
            summary.setTextColor(MUTED);
            summary.setTextSize(13);
            summary.setMaxLines(2);
            summary.setEllipsize(TextUtils.TruncateAt.END);
            LinearLayout.LayoutParams summaryParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT);
            summaryParams.setMargins(0, dp(6), 0, 0);
            sheet.addView(summary, summaryParams);
        }

        WaveformView waveform = new WaveformView(this);
        waveform.setAccentColor(parseColor(card.accent(), BLUE));
        waveform.setPlaying(PlayerController.shared(this).state().optBoolean("is_playing", false));
        LinearLayout.LayoutParams waveParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(104));
        waveParams.setMargins(0, dp(28), 0, dp(20));
        sheet.addView(waveform, waveParams);

        sheet.addView(audioSheetControls(), new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        return sheet;
    }

    private View audioSheetControls() {
        JSONObject state = PlayerController.shared(this).state();
        int positionMs = Math.max(0, state.optInt("position_ms", 0));
        int durationMs = Math.max(0, state.optInt("duration_ms", 0));
        int max = Math.max(1, durationMs);

        LinearLayout stack = new LinearLayout(this);
        stack.setOrientation(LinearLayout.VERTICAL);
        stack.setGravity(Gravity.CENTER_VERTICAL);
        stack.setClickable(true);
        stack.setOnClickListener(view -> {
            if (speedPickerOpen) {
                closeSpeedPicker();
            }
        });

        SeekBar progress = new SeekBar(this);
        progress.setMax(max);
        progress.setProgress(Math.min(positionMs, max));
        progress.setContentDescription("audio_scrubber");
        progress.setPadding(0, 0, 0, 0);
        progress.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progressValue, boolean fromUser) {
                if (fromUser) {
                    trackingAudioSeek = true;
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar seekBar) {
                trackingAudioSeek = true;
            }

            @Override
            public void onStopTrackingTouch(SeekBar seekBar) {
                seekToPosition(seekBar.getProgress());
                trackingAudioSeek = false;
            }
        });
        stack.addView(progress, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(36)));

        TextView time = new TextView(this);
        time.setText(formatTime(positionMs) + " / " + formatTime(durationMs));
        time.setTextColor(TEXT);
        time.setTextSize(11);
        time.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams timeParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        timeParams.setMargins(0, dp(2), 0, dp(16));
        stack.addView(time, timeParams);

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        controls.setClickable(true);
        controls.setOnClickListener(view -> {
            if (speedPickerOpen) {
                closeSpeedPicker();
            }
        });

        Button back = audioNudgeButton("\u21ba15");
        back.setContentDescription("audio_rewind_15");
        back.setOnClickListener(view -> seekRelative(-15_000));
        controls.addView(back, new LinearLayout.LayoutParams(dp(54), dp(44)));

        Button playPause = audioNudgeButton(state.optBoolean("is_playing", false) ? "\u275a\u275a" : "\u25b6");
        playPause.setTextSize(18);
        playPause.setContentDescription("audio_play_pause");
        playPause.setOnClickListener(view -> toggleActiveAudio());
        LinearLayout.LayoutParams playParams = new LinearLayout.LayoutParams(dp(64), dp(48));
        playParams.setMargins(dp(10), 0, dp(10), 0);
        controls.addView(playPause, playParams);

        Button forward = audioNudgeButton("30\u21bb");
        forward.setContentDescription("audio_forward_30");
        forward.setOnClickListener(view -> seekRelative(30_000));
        controls.addView(forward, new LinearLayout.LayoutParams(dp(54), dp(44)));

        Button speed = audioNudgeButton(speedLabel(playbackSpeedForActiveCard()));
        speed.setContentDescription("audio_speed");
        speed.setOnClickListener(view -> toggleSpeedPicker());
        LinearLayout.LayoutParams speedParams = new LinearLayout.LayoutParams(dp(62), dp(44));
        speedParams.setMargins(dp(14), 0, 0, 0);
        controls.addView(speed, speedParams);
        stack.addView(controls, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        return stack;
    }

    private void showAudioSheet(ReplyCard card) {
        if (!card.hasAudio()) {
            return;
        }
        closeSpeedPicker();
        audioSheetCard = card;
        audioSheetOpen = true;
        renderAudioSheet();
        if (audioSheetLayer != null && audioSheetLayer.getChildCount() > 0) {
            InteractivePanelController.slideUp(audioSheetLayer.getChildAt(0));
        }
    }

    private void dismissAudioSheet() {
        audioSheetOpen = false;
        audioSheetCard = null;
        closeSpeedPicker();
        renderAudioSheet();
    }

    private Button audioNudgeButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(TEXT);
        button.setTextSize(11);
        button.setAllCaps(false);
        button.setPadding(0, 0, 0, 0);
        button.setBackground(roundRectNoStroke(CARD_SOFT, dp(14)));
        return button;
    }

    private void renderSpeedPickerOverlay() {
        if (speedPickerOverlay == null) {
            return;
        }
        speedPickerOverlay.removeAllViews();
        if (!speedPickerOpen) {
            speedPickerOverlay.setVisibility(View.GONE);
            speedPickerOverlay.setBackgroundColor(Color.TRANSPARENT);
            return;
        }

        speedPickerOverlay.setVisibility(View.VISIBLE);
        speedPickerOverlay.setBackgroundColor(Color.argb(92, 0, 0, 0));
        speedPickerOverlay.addView(speedPickerPanel(), speedPickerPanelParams());
    }

    private LinearLayout speedPickerPanel() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        row.setPadding(dp(10), dp(10), dp(10), dp(10));
        row.setClickable(true);
        row.setOnClickListener(view -> {
            // Consume panel taps so only outside taps dismiss the overlay.
        });
        row.setBackground(roundRectNoStroke(CARD, dp(24)));
        float[] choices = {0.75f, 1.0f, 1.25f, 1.5f, 2.0f, 2.5f, 3.0f};
        float activeSpeed = playbackSpeedForActiveCard();
        for (float choice : choices) {
            Button button = audioNudgeButton(speedLabel(choice));
            if (Math.abs(choice - activeSpeed) < 0.01f) {
                button.setBackground(roundRectNoStroke(BLUE, dp(18)));
            }
            button.setOnClickListener(view -> setPlaybackSpeed(choice));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(42), 1f);
            params.setMargins(dp(3), 0, dp(3), 0);
            row.addView(button, params);
        }
        return row;
    }

    private FrameLayout.LayoutParams speedPickerPanelParams() {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        params.setMargins(dp(18), 0, dp(18), dp(28));
        return params;
    }

    private void toggleReplyAudio(ReplyCard card) {
        PlayerController player = PlayerController.shared(this);
        JSONObject state = player.state();
        boolean sameCard = card.audioPath().equals(activeAudioPath);
        if (sameCard && state.optBoolean("is_playing", false)) {
            pauseActiveAudio();
            return;
        }
        if (!activeAudioPath.isEmpty() && !sameCard) {
            pauseActiveAudio();
        }

        JSONObject args = new JSONObject();
        Json.put(args, "path", card.audioPath());
        Json.put(args, "title", card.title());
        Json.put(args, "source", "reply_card");
        Json.put(args, "speed", playbackSpeedForCard(card.audioPath()));
        int startAtMs = savedAudioPositions.containsKey(card.audioPath())
                ? savedAudioPositions.get(card.audioPath())
                : state.optInt("position_ms", 0);
        int savedDurationMs = savedAudioDurations.containsKey(card.audioPath())
                ? savedAudioDurations.get(card.audioPath())
                : 0;
        if (!sameCard) {
            startAtMs = savedAudioPositions.containsKey(card.audioPath())
                    ? savedAudioPositions.get(card.audioPath())
                    : 0;
        }
        if (savedDurationMs > 0 && startAtMs >= savedDurationMs - 250) {
            startAtMs = 0;
        }
        Json.put(args, "start_at_ms", startAtMs);
        try {
            JSONObject played = player.play(args);
            savedAudioDurations.put(card.audioPath(), Math.max(0, played.optInt("duration_ms", 0)));
            activeAudioPath = card.audioPath();
            applyPlaybackSpeed(playbackSpeedForCard(card.audioPath()));
            PuckyState.get().setLifecycleEvent("reply_card.audio_play");
            renderCurrent();
            schedulePlayerTick();
        } catch (CommandException exc) {
            Log.w(TAG, "Unable to play reply audio", exc);
            PuckyState.get().setLastError("Reply audio failed: " + exc.getMessage());
            PuckyState.get().broadcast(this);
        }
    }

    private void pauseActiveAudio() {
        if (activeAudioPath.isEmpty()) {
            return;
        }
        PlayerController player = PlayerController.shared(this);
        JSONObject state = player.state();
        if (state.optBoolean("loaded", false)) {
            savedAudioPositions.put(activeAudioPath, Math.max(0, state.optInt("position_ms", 0)));
            savedAudioDurations.put(activeAudioPath, Math.max(0, state.optInt("duration_ms", 0)));
        }
        if (!state.optBoolean("is_playing", false)) {
            renderCurrent();
            return;
        }
        try {
            player.pause(new JSONObject());
            JSONObject paused = player.state();
            savedAudioPositions.put(activeAudioPath, Math.max(0, paused.optInt("position_ms", 0)));
            savedAudioDurations.put(activeAudioPath, Math.max(0, paused.optInt("duration_ms", 0)));
            PuckyState.get().setLifecycleEvent("reply_card.audio_pause");
            renderCurrent();
        } catch (CommandException exc) {
            Log.w(TAG, "Unable to pause reply audio", exc);
            PuckyState.get().setLastError("Reply audio pause failed: " + exc.getMessage());
            PuckyState.get().broadcast(this);
        }
    }

    private void toggleActiveAudio() {
        if (activeAudioPath.isEmpty()) {
            return;
        }
        PlayerController player = PlayerController.shared(this);
        JSONObject state = player.state();
        if (state.optBoolean("is_playing", false)) {
            pauseActiveAudio();
            return;
        }
        try {
            int positionMs = Math.max(0, state.optInt("position_ms", 0));
            int durationMs = Math.max(0, state.optInt("duration_ms", 0));
            if (durationMs > 0 && positionMs >= durationMs - 250) {
                JSONObject seek = new JSONObject();
                Json.put(seek, "position_ms", 0);
                player.seek(seek);
                savedAudioPositions.put(activeAudioPath, 0);
            }
            JSONObject played = player.play(new JSONObject());
            savedAudioDurations.put(activeAudioPath, Math.max(0, played.optInt("duration_ms", 0)));
            applyPlaybackSpeed(playbackSpeedForActiveCard());
            renderCurrent();
            schedulePlayerTick();
        } catch (CommandException exc) {
            Log.w(TAG, "Unable to toggle active reply audio", exc);
            PuckyState.get().setLastError("Reply audio toggle failed: " + exc.getMessage());
            PuckyState.get().broadcast(this);
        }
    }

    private void seekRelative(int deltaMs) {
        JSONObject state = PlayerController.shared(this).state();
        int positionMs = Math.max(0, state.optInt("position_ms", 0));
        int durationMs = Math.max(0, state.optInt("duration_ms", 0));
        int targetMs = Math.max(0, positionMs + deltaMs);
        if (durationMs > 0) {
            targetMs = Math.min(targetMs, durationMs);
        }
        seekToPosition(targetMs);
    }

    private void seekToPosition(int positionMs) {
        JSONObject args = new JSONObject();
        int bounded = Math.max(0, positionMs);
        Json.put(args, "position_ms", bounded);
        try {
            PlayerController.shared(this).seek(args);
            if (!activeAudioPath.isEmpty()) {
                savedAudioPositions.put(activeAudioPath, bounded);
                JSONObject state = PlayerController.shared(this).state();
                savedAudioDurations.put(activeAudioPath, Math.max(0, state.optInt("duration_ms", 0)));
            }
            renderCurrent();
            schedulePlayerTick();
        } catch (CommandException exc) {
            Log.w(TAG, "Unable to seek reply audio", exc);
            PuckyState.get().setLastError("Reply audio seek failed: " + exc.getMessage());
            PuckyState.get().broadcast(this);
        }
    }

    private void toggleSpeedPicker() {
        speedPickerOpen = !speedPickerOpen;
        renderCurrent();
    }

    private void closeSpeedPicker() {
        if (!speedPickerOpen) {
            return;
        }
        speedPickerOpen = false;
        renderCurrent();
    }

    private void setPlaybackSpeed(float speed) {
        globalPlaybackSpeed = Math.max(0.75f, Math.min(3.0f, speed));
        if (!activeAudioPath.isEmpty()) {
            cardPlaybackSpeeds.put(activeAudioPath, globalPlaybackSpeed);
        }
        applyPlaybackSpeed(globalPlaybackSpeed);
        speedPickerOpen = false;
        renderCurrent();
    }

    private void applyPlaybackSpeed(float speed) {
        JSONObject args = new JSONObject();
        Json.put(args, "speed", speed);
        try {
            PlayerController.shared(this).speed(args);
        } catch (CommandException exc) {
            Log.w(TAG, "Unable to set reply audio speed", exc);
            PuckyState.get().setLastError("Reply audio speed failed: " + exc.getMessage());
            PuckyState.get().broadcast(this);
        }
    }

    private float playbackSpeedForActiveCard() {
        return activeAudioPath.isEmpty() ? globalPlaybackSpeed : playbackSpeedForCard(activeAudioPath);
    }

    private float playbackSpeedForCard(String audioPath) {
        if (audioPath != null && cardPlaybackSpeeds.containsKey(audioPath)) {
            return cardPlaybackSpeeds.get(audioPath);
        }
        return globalPlaybackSpeed;
    }

    private String speedLabel(float speed) {
        if (Math.abs(speed - Math.round(speed)) < 0.01f) {
            return String.format(Locale.US, "%dx", Math.round(speed));
        }
        return String.format(Locale.US, "%.2fx", speed).replaceAll("0x$", "x");
    }

    private boolean isActiveAudioCard(ReplyCard card) {
        return card.hasAudio() && card.audioPath().equals(activeAudioPath);
    }

    private boolean isPlayingAudioCard(ReplyCard card) {
        return isActiveAudioCard(card)
                && PlayerController.shared(this).state().optBoolean("is_playing", false);
    }

    private void schedulePlayerTick() {
        mainHandler.removeCallbacks(playerTick);
        mainHandler.postDelayed(playerTick, 1_000L);
    }

    private String formatTime(int ms) {
        int totalSeconds = Math.max(0, ms / 1000);
        int minutes = totalSeconds / 60;
        int seconds = totalSeconds % 60;
        return String.format(Locale.US, "%d:%02d", minutes, seconds);
    }

    private void showTranscript(ReplyCard card) {
        closeSpeedPicker();
        showDetailPanel(buildTranscriptPanel(card));
    }

    private void openRichReply(ReplyCard card) {
        closeSpeedPicker();
        showDetailPanel(buildWebPanel(card));
    }

    private void showDetailPanel(View panel) {
        if (detailPanelLayer == null) {
            return;
        }
        detailPanelLayer.removeAllViews();
        detailPanelLayer.setVisibility(View.VISIBLE);
        detailPanelLayer.addView(panel, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        InteractivePanelController.slideInFromRight(panel);
    }

    private void dismissDetailPanel() {
        if (detailPanelLayer == null) {
            return;
        }
        detailPanelLayer.removeAllViews();
        detailPanelLayer.setVisibility(View.GONE);
    }

    private View buildWebPanel(ReplyCard card) {
        FrameLayout panel = new FrameLayout(this);
        panel.setBackgroundColor(BACKGROUND);
        panel.setContentDescription("web_detail_panel");

        File html = resolveAppOwnedPath(card.htmlPath(), "Reply HTML");
        WebView webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        webView.setClipToPadding(true);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        webView.setContentDescription("web_detail_content");
        applyWebViewSafePadding(webView, 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            webView.setOnApplyWindowInsetsListener((view, insets) -> {
                int navInset = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
                applyWebViewSafePadding(webView, navInset);
                return insets;
            });
        }
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
        webParams.bottomMargin = dp(58);
        panel.addView(webView, webParams);
        InteractivePanelController.installRightSwipeDismiss(webView, panel, this::dismissDetailPanel);
        webView.loadUrl(Uri.fromFile(html).toString());
        return panel;
    }

    private View buildTranscriptPanel(ReplyCard card) {
        FrameLayout panel = new FrameLayout(this);
        panel.setBackgroundColor(BACKGROUND);
        panel.setContentDescription("transcript_detail_panel");

        ScrollView scroll = new ScrollView(this);
        scroll.setClipToPadding(false);
        scroll.setPadding(0, 0, 0, dp(88));
        scroll.setOverScrollMode(ScrollView.OVER_SCROLL_NEVER);
        scroll.setContentDescription("transcript_detail_content");
        InteractivePanelController.installRightSwipeDismiss(scroll, panel, this::dismissDetailPanel);

        LinearLayout thread = new LinearLayout(this);
        thread.setOrientation(LinearLayout.VERTICAL);
        thread.setPadding(dp(14), dp(18), dp(14), dp(24));
        scroll.addView(thread, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        thread.addView(dayDivider("Today"));
        for (Message message : messagesForCard(card)) {
            thread.addView(messageRow(message));
        }

        panel.addView(scroll, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        return panel;
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
        bubble.setBackground(roundRect(user ? Color.rgb(16, 54, 96) : CARD, Color.rgb(33, 52, 72), dp(18)));

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
            return BitmapFactory.decodeFile(resolveAppOwnedPath(raw, "Transcript image").getAbsolutePath());
        } catch (Exception ignored) {
            return null;
        }
    }

    private List<Message> messagesForCard(ReplyCard card) {
        List<Message> out = messagesFromJson(card.transcriptMessages());
        if (!out.isEmpty()) {
            return out;
        }
        String raw = card.transcript();
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

    private File resolveAppOwnedPath(String raw, String label) {
        if (raw == null || raw.trim().isEmpty()) {
            throw new IllegalArgumentException("Missing " + label + " path");
        }
        try {
            File file = new File(raw).getCanonicalFile();
            if (!isWithin(file, getFilesDir())
                    && !isWithin(file, getCacheDir())
                    && !isWithin(file, getExternalFilesDir(null))) {
                throw new IllegalArgumentException(label + " path is outside app-owned storage");
            }
            if (!file.exists() || !file.isFile()) {
                throw new IllegalArgumentException(label + " file not found");
            }
            return file;
        } catch (IllegalArgumentException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new IllegalArgumentException("Unable to open " + label + ": " + exc.getMessage(), exc);
        }
    }

    private static boolean isWithin(File file, File root) throws Exception {
        if (root == null) {
            return false;
        }
        String filePath = file.getCanonicalPath();
        String rootPath = root.getCanonicalPath();
        return filePath.equals(rootPath) || filePath.startsWith(rootPath + File.separator);
    }

    private void applyWebViewSafePadding(WebView webView, int bottomInsetPx) {
        int bottomPadding = Math.max(dp(88), bottomInsetPx + dp(28));
        webView.setPadding(0, 0, 0, bottomPadding);
    }

    private int drawableForIcon(String icon) {
        String normalized = icon == null ? "" : icon.trim().toLowerCase();
        if ("clock".equals(normalized) || "time".equals(normalized) || "timer".equals(normalized)) {
            return R.drawable.pucky_ic_clock;
        }
        if ("bolt".equals(normalized) || "lightning".equals(normalized) || "energy".equals(normalized)) {
            return R.drawable.pucky_ic_bolt;
        }
        if ("calendar".equals(normalized) || "meeting".equals(normalized) || "agenda".equals(normalized)) {
            return R.drawable.pucky_ic_calendar;
        }
        if ("moon".equals(normalized) || "night".equals(normalized) || "bedtime".equals(normalized)) {
            return R.drawable.pucky_ic_moon;
        }
        return android.R.drawable.ic_dialog_email;
    }

    private void applyFeedScrollSafePadding(ScrollView scroll, int bottomInsetPx) {
        int bottomPadding = Math.max(dp(COVER_FEED_BOTTOM_SAFE_PADDING_DP), bottomInsetPx + dp(36));
        scroll.setPadding(0, 0, 0, bottomPadding);
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
