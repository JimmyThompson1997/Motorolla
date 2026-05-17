package com.pucky.device;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.StyleSpan;
import android.text.style.TypefaceSpan;
import android.text.style.UnderlineSpan;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import com.pucky.device.broker.BrokerEventPoster;
import com.pucky.device.artifacts.ArtifactController;
import com.pucky.device.audio.AudioController;
import com.pucky.device.battery.BatteryProvider;
import com.pucky.device.buttons.ButtonController;
import com.pucky.device.camera.CameraController;
import com.pucky.device.capabilities.PermissionReporter;
import com.pucky.device.capabilities.CapabilityReporter;
import com.pucky.device.command.CommandHandlingResult;
import com.pucky.device.command.CommandRouter;
import com.pucky.device.command.NativeCommandExecutor;
import com.pucky.device.files.FileDownloadController;
import com.pucky.device.intents.IntentController;
import com.pucky.device.location.LocationController;
import com.pucky.device.livekit.LiveKitController;
import com.pucky.device.media.MediaControlController;
import com.pucky.device.media.MediaExportController;
import com.pucky.device.network.NetworkProvider;
import com.pucky.device.notes.NoteController;
import com.pucky.device.notifications.NotificationController;
import com.pucky.device.player.PlayerController;
import com.pucky.device.sensors.SensorController;
import com.pucky.device.service.PuckyForegroundService;
import com.pucky.device.speech.NativeSpeechController;
import com.pucky.device.state.PuckyState;
import com.pucky.device.status.StatusProvider;
import com.pucky.device.storage.CommandLogStore;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.storage.StorageProvider;
import com.pucky.device.system.ShellController;
import com.pucky.device.system.SystemController;
import com.pucky.device.timers.TimerController;
import com.pucky.device.tunnel.TunnelController;
import com.pucky.device.ui.PuckyHomeState;
import com.pucky.device.ui.PuckyUiController;
import com.pucky.device.ui.PuckyWebBridgePolicy;
import com.pucky.device.updates.AppUpdateController;
import com.pucky.device.util.Json;
import com.pucky.device.voice.VoiceCaptureController;
import com.pucky.device.wake.WakeWordController;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class MainActivity extends Activity {
    private static final String TAG = "PuckyMainActivity";
    private static final String HOME_PORTAL_URL = "http://127.0.0.1:8788/pucky-home";
    private static final String COVER_PREFS = "pucky_cover_ui";
    private static final String PREF_LIGHT_MODE = "light_mode";
    private static final String MODE_HOME = "home";
    private static final String MODE_APPS = "apps";
    private static final String MODE_THREADS = "threads";
    private static final String MODE_INBOX = "inbox";
    private static final String MODE_LISTENING = "listening";
    private static final String MODE_SPEAKING = "speaking";
    private static final String MODE_THINKING = "thinking";
    private static final String MODE_FINALIZING = "finalizing";
    private static final int CAMERA_SAFE_WIDTH_PX = 330;
    private static final int COVER_BOTTOM_SAFE_PX = 126;
    private static final int COVER_BOTTOM_BAR_HEIGHT_PX = 70;
    private static final int HOME_SAFE_CONTENT_WIDTH_PX = 720;
    private static final int COVER_BOTTOM_CONTROL_WIDTH_PX = 520;
    private static final int COVER_SAFE_RECT_WIDTH_PX = 992;
    private static final int COVER_SAFE_RECT_TOP_PX = 32;
    private static final int COVER_SAFE_RECT_BOTTOM_PX = 102;
    private static final int COVER_SAFE_RECT_HEIGHT_PX = 710;
    private static final long COVER_EVENT_START_GRACE_MS = 3000L;
    private static final long COVER_NO_SPEECH_TIMEOUT_MS = 20000L;
    private static final long SPEAKING_STATE_WORD_MS = 340L;
    private static final long SPEAKING_STATE_TAIL_MS = 2200L;
    private static final long SPEAKING_FINISHED_HOLD_MS = 15000L;

    private TextView stateText;
    private TextView statusText;
    private TextView buttonText;
    private WebView homeWebView;
    private PuckyMascotView homeMascotView;
    private TextView homeEmojiText;
    private TextView homeLabelText;
    private TextView homeSubtitleText;
    private LinearLayout coverHeader;
    private TextView coverStatusText;
    private TextView coverTranscriptText;
    private ScrollView coverTranscriptScroll;
    private FrameLayout coverSurface;
    private LinearLayout coverBottomBar;
    private ThinkingPulseView thinkingPulseView;
    private TextView notesSummaryText;
    private LinearLayout notesPanel;
    private LinearLayout notesList;
    private EditText threadNameInput;
    private EditText modelInput;
    private EditText reasoningInput;
    private EditText serviceTierInput;
    private EditText deviceIdInput;
    private EditText brokerUrlInput;
    private EditText tokenInput;
    private SettingsStore settingsStore;
    private PuckyHomeState homeState;
    private ButtonController buttonController;
    private CommandRouter bridgeCommandRouter;
    private OkHttpClient httpClient;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private long coverEventFloorAtMs = System.currentTimeMillis() - COVER_EVENT_START_GRACE_MS;
    private boolean adminMode;
    private boolean homePortalLoadStarted;
    private boolean homePortalPageFinished;
    private String lastHomePortalUrl = "";
    private boolean notesVisible;
    private boolean coverLightMode;
    private String coverSurfaceMode = MODE_HOME;
    private String coverAccentMode = MODE_HOME;
    private String lastRenderedCoverMode = "";
    private String lastRenderedTranscriptText = "";
    private String lastPushedCoverStateJson = "";
    private String lastTranscriptText = "";
    private String lastTranscriptSpeaker = "";
    private long lastTranscriptChangedAtMs;
    private long lastPttStartAtMs;
    private long lastPttStopAtMs;
    private long lastAgentTranscriptAtMs;
    private long lastUserTranscriptAtMs;
    private long lastVoxTurnStartedAtMs;
    private long lastAssistantReplyStartedAtMs;
    private long lastAssistantReplyFinishedAtMs;
    private long lastAssistantReplyVisibleUntilMs;
    private long lastCoverTranscriptAtMs;
    private long lastDisconnectAtMs;
    private long lastSilentCloseAtMs;
    private Runnable coverTicker;
    private boolean screenReceiverRegistered;

    private final PuckyHomeState.Listener homeStateListener = () -> mainHandler.post(this::renderHome);

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
                mainHandler.post(() -> handleCoverScreenVisibilityChanged(action));
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PuckyApplication app = (PuckyApplication) getApplication();
        settingsStore = app.settingsStore();
        homeState = app.homeState();
        buttonController = new ButtonController(this);
        httpClient = new OkHttpClient();
        configureApplianceWindow();
        adminMode = shouldStartInAdmin(getIntent());
        setContentView(adminMode ? buildAdminView() : buildHomeView());
        applySystemUiForMode();
        renderCurrent();
        handleLaunchIntent(getIntent());
        requestNeededPermissions();
    }

    private void requestNeededPermissions() {
        List<String> missing = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.CAMERA);
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.RECORD_AUDIO);
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
            missing.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (!missing.isEmpty()) {
            requestPermissions(missing.toArray(new String[0]), 1001);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (shouldStartInAdmin(intent)) {
            showAdminScreen();
        } else {
            showHomeScreen();
        }
        handleLaunchIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        configureApplianceWindow();
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(stateReceiver, new IntentFilter(PuckyState.ACTION_CHANGED), RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(stateReceiver, new IntentFilter(PuckyState.ACTION_CHANGED));
        }
        IntentFilter screenFilter = new IntentFilter();
        screenFilter.addAction(Intent.ACTION_SCREEN_ON);
        screenFilter.addAction(Intent.ACTION_SCREEN_OFF);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenReceiver, screenFilter, RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(screenReceiver, screenFilter);
        }
        screenReceiverRegistered = true;
        homeState.addListener(homeStateListener);
        applySystemUiForMode();
        ensureAutoConnectService();
        WakeWordController.shared(this).start(new JSONObject());
        if (!adminMode && isVoiceVisualMode(coverSurfaceMode) && shouldResetCoverOnResume()) {
            resetCoverVisualHome("activity_resume");
        } else {
            renderCurrent();
        }
        startCoverTicker();
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
        stopCoverTicker();
        homeState.removeListener(homeStateListener);
        unregisterReceiver(stateReceiver);
        if (screenReceiverRegistered) {
            unregisterReceiver(screenReceiver);
            screenReceiverRegistered = false;
        }
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
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        return super.onKeyUp(keyCode, event);
    }

    private void configureApplianceWindow() {
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager keyguardManager = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (keyguardManager != null) {
                keyguardManager.requestDismissKeyguard(this, null);
            }
        } else {
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

    private void applySystemUiForMode() {
        exitHomeImmersiveMode();
    }

    private void scheduleHomeImmersiveMode() {
        mainHandler.postDelayed(() -> {
            if (!adminMode && homePortalPageFinished) {
                applySystemUiForMode();
            }
        }, 500);
    }

    private void exitHomeImmersiveMode() {
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
        resetCoverRefs();
        coverLightMode = getSharedPreferences(COVER_PREFS, MODE_PRIVATE)
                .getBoolean(PREF_LIGHT_MODE, false);
        lastRenderedCoverMode = "";
        lastRenderedTranscriptText = "";
        lastPushedCoverStateJson = "";
        lastHomePortalUrl = "";
        homePortalLoadStarted = false;
        homePortalPageFinished = false;
        statusText = null;
        stateText = null;
        buttonText = null;
        deviceIdInput = null;
        brokerUrlInput = null;
        tokenInput = null;

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(coverColor("background"));

        homeWebView = new WebView(this);
        homeWebView.setBackgroundColor(coverColor("background"));
        homeWebView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        homeWebView.setVerticalScrollBarEnabled(false);
        homeWebView.setHorizontalScrollBarEnabled(false);
        homeWebView.setLongClickable(true);
        homeWebView.setOnLongClickListener(v -> {
            showAdminScreen();
            return true;
        });
        WebSettings settings = homeWebView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        homeWebView.addJavascriptInterface(new PuckyAndroidBridge(), "PuckyAndroid");
        homeWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                homePortalPageFinished = true;
                lastHomePortalUrl = url == null ? "" : url;
                Log.i(TAG, "Pucky portal loaded url=" + url);
                pushCoverStateToWebView(true);
                scheduleHomeImmersiveMode();
            }

            @Override
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error) {
                if (request == null || request.isForMainFrame()) {
                    String failingUrl = request == null || request.getUrl() == null
                            ? homePortalUrl()
                            : request.getUrl().toString();
                    String description = error == null || error.getDescription() == null
                            ? "unknown load error"
                            : error.getDescription().toString();
                    Log.w(TAG, "Pucky portal load failed url=" + failingUrl + " error=" + description);
                    mainHandler.post(() -> setContentView(buildPortalErrorView(failingUrl, description)));
                }
            }
        });
        root.addView(homeWebView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        homeWebView.post(this::loadHomePortal);
        return root;
    }

    private View buildPortalErrorView(String failingUrl, String description) {
        resetCoverRefs();
        homePortalLoadStarted = false;
        homePortalPageFinished = false;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(46, 46, 46, 46);
        root.setBackgroundColor(Color.rgb(2, 6, 10));

        TextView title = new TextView(this);
        title.setText("Pucky UI failed to load");
        title.setTextColor(Color.rgb(255, 120, 120));
        title.setTextSize(22);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        root.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView body = new TextView(this);
        body.setText("Remote cover UI is unavailable.\n\n"
                + "URL: " + (failingUrl == null ? homePortalUrl() : failingUrl) + "\n"
                + "Error: " + (description == null ? "unknown" : description) + "\n\n"
                + "Restore the VM server and ADB reverse, then reopen Pucky.");
        body.setTextColor(Color.rgb(229, 237, 247));
        body.setTextSize(14);
        body.setLineSpacing(4f, 1.0f);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, 22, 0, 0);
        root.addView(body, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        return root;
    }

    private View buildLegacyHomeView() {
        homeWebView = null;
        homeMascotView = null;
        homeEmojiText = null;
        homeLabelText = null;
        homeSubtitleText = null;
        coverHeader = null;
        coverStatusText = null;
        coverTranscriptText = null;
        notesSummaryText = null;
        notesPanel = null;
        notesList = null;
        threadNameInput = null;
        modelInput = null;
        reasoningInput = null;
        serviceTierInput = null;
        homePortalLoadStarted = false;
        homePortalPageFinished = true;
        statusText = null;
        stateText = null;
        buttonText = null;
        deviceIdInput = null;
        brokerUrlInput = null;
        tokenInput = null;

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(9, 12, 18));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        scroll.setPadding(0, 0, 0, 0);

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setGravity(Gravity.CENTER_HORIZONTAL);
        body.setPadding(28, 14, 28, 24);
        scroll.addView(body, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        homeMascotView = new PuckyMascotView(this);
        LinearLayout.LayoutParams mascotParams = new LinearLayout.LayoutParams(70, 70);
        mascotParams.setMargins(0, 0, 0, 8);
        body.addView(homeMascotView, mascotParams);

        homeEmojiText = new TextView(this);
        homeEmojiText.setGravity(Gravity.CENTER);
        homeEmojiText.setTextSize(0);
        homeEmojiText.setIncludeFontPadding(false);
        homeEmojiText.setTextColor(Color.rgb(239, 245, 248));
        homeEmojiText.setVisibility(View.GONE);
        body.addView(homeEmojiText, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        homeLabelText = new TextView(this);
        homeLabelText.setGravity(Gravity.CENTER);
        homeLabelText.setTextSize(34);
        homeLabelText.setTypeface(Typeface.DEFAULT_BOLD);
        homeLabelText.setIncludeFontPadding(false);
        homeLabelText.setTextColor(Color.rgb(239, 245, 248));
        homeLabelText.setVisibility(View.VISIBLE);
        body.addView(homeLabelText, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        homeSubtitleText = new TextView(this);
        homeSubtitleText.setGravity(Gravity.CENTER);
        homeSubtitleText.setTextSize(15);
        homeSubtitleText.setTextColor(Color.rgb(178, 194, 211));
        homeSubtitleText.setPadding(0, 6, 0, 0);
        homeSubtitleText.setVisibility(View.VISIBLE);
        body.addView(homeSubtitleText, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        coverStatusText = new TextView(this);
        coverStatusText.setTextSize(12);
        coverStatusText.setTextColor(Color.rgb(124, 241, 207));
        coverStatusText.setGravity(Gravity.CENTER);
        coverStatusText.setPadding(0, 6, 0, 6);
        body.addView(coverStatusText, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout voiceRow = new LinearLayout(this);
        voiceRow.setOrientation(LinearLayout.HORIZONTAL);
        voiceRow.setGravity(Gravity.CENTER);
        Button mic = coverButton("Tap mic");
        mic.setTextSize(16);
        mic.setHeight(82);
        mic.setOnClickListener(v -> startPuckyMic());
        Button end = coverButton("End");
        end.setTextSize(16);
        end.setHeight(82);
        end.setOnClickListener(v -> stopPuckyMic());
        voiceRow.addView(mic, weightedButtonParams());
        voiceRow.addView(end, weightedButtonParams());
        body.addView(voiceRow, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout shortcuts = new LinearLayout(this);
        shortcuts.setOrientation(LinearLayout.HORIZONTAL);
        shortcuts.setGravity(Gravity.CENTER);
        shortcuts.setPadding(0, 2, 0, 4);
        addHomeShortcut(shortcuts, "Camera", () -> launchPackageOrSettings("com.motorola.camera3"));
        addHomeShortcut(shortcuts, "Text", () -> launchPackageOrSettings("com.google.android.apps.messaging"));
        addHomeShortcut(shortcuts, "Phone", () -> launchPackageOrSettings("com.android.dialer"));
        body.addView(shortcuts, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        coverTranscriptText = new TextView(this);
        coverTranscriptText.setTextSize(14);
        coverTranscriptText.setTextColor(Color.rgb(229, 237, 247));
        coverTranscriptText.setLineSpacing(2f, 1.0f);
        coverTranscriptText.setPadding(16, 12, 16, 12);
        coverTranscriptText.setText("Tap mic or hold volume up.\nProject Vox + ElevenLabs Scribe.");
        coverTranscriptText.setBackground(coverPanelBackground());
        LinearLayout.LayoutParams transcriptParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        transcriptParams.setMargins(0, 4, 0, 0);
        body.addView(coverTranscriptText, transcriptParams);

        notesPanel = new LinearLayout(this);
        notesPanel.setOrientation(LinearLayout.VERTICAL);
        notesPanel.setVisibility(View.GONE);
        notesPanel.setPadding(18, 16, 18, 16);
        notesPanel.setBackground(coverPanelBackground());

        TextView notesTitle = new TextView(this);
        notesTitle.setText("Threads");
        notesTitle.setTextSize(16);
        notesTitle.setTypeface(Typeface.DEFAULT_BOLD);
        notesTitle.setTextColor(Color.WHITE);
        notesPanel.addView(notesTitle);

        notesSummaryText = new TextView(this);
        notesSummaryText.setText("Tap refresh to load Project Vox threads.");
        notesSummaryText.setTextSize(11);
        notesSummaryText.setTextColor(Color.rgb(178, 194, 211));
        notesSummaryText.setPadding(0, 2, 0, 4);
        notesPanel.addView(notesSummaryText);

        notesList = new LinearLayout(this);
        notesList.setOrientation(LinearLayout.VERTICAL);
        ScrollView notesScroll = new ScrollView(this);
        notesScroll.addView(notesList, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        notesPanel.addView(notesScroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                76));

        threadNameInput = coverInput("New thread name");
        modelInput = coverInput("Model");
        modelInput.setText("gpt-5.4");
        reasoningInput = coverInput("Reasoning");
        reasoningInput.setText("medium");
        serviceTierInput = coverInput("Service tier");
        serviceTierInput.setText("fast");
        notesPanel.addView(threadNameInput, coverBlockParams());
        LinearLayout threadOptions = row();
        threadOptions.addView(modelInput, weightedButtonParams());
        threadOptions.addView(reasoningInput, weightedButtonParams());
        threadOptions.addView(serviceTierInput, weightedButtonParams());
        notesPanel.addView(threadOptions);

        LinearLayout notesActions = row();
        TextView refresh = coverAction("Refresh");
        refresh.setOnClickListener(v -> refreshThreads());
        TextView create = coverAction("New");
        create.setOnClickListener(v -> createThread());
        notesActions.addView(refresh, weightedButtonParams());
        notesActions.addView(create, weightedButtonParams());
        notesPanel.addView(notesActions);

        root.addView(scroll, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        FrameLayout.LayoutParams notesParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                384,
                Gravity.TOP);
        notesParams.setMargins(34, 86, 34, 0);
        root.addView(notesPanel, notesParams);

        Button settings = button("\u2699");
        settings.setContentDescription("Settings");
        settings.setMinWidth(0);
        settings.setMinHeight(0);
        settings.setMinimumWidth(0);
        settings.setMinimumHeight(0);
        settings.setPadding(0, 0, 0, 0);
        settings.setTextSize(28);
        settings.setTextColor(Color.WHITE);
        settings.setBackground(darkButtonBackground());
        settings.setOnClickListener(v -> showAdminScreen());
        FrameLayout.LayoutParams settingsParams = new FrameLayout.LayoutParams(
                64,
                64,
                Gravity.TOP | Gravity.LEFT);
        settingsParams.setMargins(20, 20, 0, 0);
        root.addView(settings, settingsParams);

        Button notes = coverButton("NOTE");
        notes.setContentDescription("Threads");
        notes.setTextSize(12);
        notes.setMinWidth(0);
        notes.setMinHeight(0);
        notes.setMinimumWidth(0);
        notes.setMinimumHeight(0);
        notes.setPadding(0, 0, 0, 0);
        notes.setOnClickListener(v -> toggleNotesPanel());
        FrameLayout.LayoutParams notesIconParams = new FrameLayout.LayoutParams(
                86,
                64,
                Gravity.TOP | Gravity.RIGHT);
        notesIconParams.setMargins(0, 20, 20, 0);
        root.addView(notes, notesIconParams);
        return root;
    }

    private void addHomeShortcut(LinearLayout parent, String label, Runnable action) {
        Button button = coverButton(label);
        button.setTextSize(12);
        button.setHeight(58);
        button.setOnClickListener(v -> action.run());
        parent.addView(button, weightedButtonParams());
    }

    private Button coverButton(String text) {
        Button button = button(text);
        button.setTextColor(Color.rgb(238, 245, 250));
        button.setTextSize(14);
        button.setGravity(Gravity.CENTER);
        button.setIncludeFontPadding(false);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setHeight(56);
        button.setPadding(10, 8, 10, 8);
        button.setBackground(darkButtonBackground());
        return button;
    }

    private TextView coverAction(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.rgb(238, 245, 250));
        view.setTextSize(13);
        view.setGravity(Gravity.CENTER);
        view.setIncludeFontPadding(false);
        view.setClickable(true);
        view.setFocusable(true);
        view.setPadding(10, 0, 10, 0);
        view.setBackground(darkButtonBackground());
        view.setHeight(44);
        return view;
    }

    private EditText coverInput(String hint) {
        EditText input = input(hint, "");
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.rgb(143, 158, 176));
        input.setTextSize(12);
        input.setSingleLine(true);
        input.setMinHeight(0);
        input.setMinimumHeight(0);
        input.setHeight(56);
        input.setPadding(10, 0, 10, 0);
        input.setBackground(coverPanelBackground());
        return input;
    }

    private GradientDrawable coverPanelBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(Color.rgb(22, 28, 39));
        drawable.setCornerRadius(22);
        drawable.setStroke(1, Color.rgb(52, 64, 82));
        return drawable;
    }

    private void launchPackageOrSettings(String packageName) {
        Intent intent = getPackageManager().getLaunchIntentForPackage(packageName);
        if (intent == null && packageName.contains("camera")) {
            intent = new Intent("android.media.action.STILL_IMAGE_CAMERA");
        } else if (intent == null && packageName.contains("messaging")) {
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse("sms:"));
        } else if (intent == null && packageName.contains("dialer")) {
            intent = new Intent(Intent.ACTION_DIAL);
        }
        if (intent == null || intent.resolveActivity(getPackageManager()) == null) {
            Toast.makeText(this, "App not available on this display", Toast.LENGTH_SHORT).show();
            return;
        }
        startActivity(intent);
    }

    private void startPuckyMic() {
        setCoverStatus("");
        new Thread(() -> {
            try {
                LiveKitController controller = LiveKitController.shared(this, settingsStore);
                controller.eventsClear();
                JSONObject result = controller.pttStart(new JSONObject());
                mainHandler.post(() -> {
                    setCoverStatus("");
                    long now = System.currentTimeMillis();
                    lastPttStartAtMs = now;
                    lastPttStopAtMs = 0L;
                    clearCoverTurnTranscript(now);
                    coverSurfaceMode = MODE_LISTENING;
                    renderHome();
                    Log.i(TAG, "pttStart result=" + result);
                });
            } catch (Exception e) {
                mainHandler.post(() -> {
                    setCoverStatus("LiveKit start failed");
                    setCoverTranscript(e.getMessage());
                    Toast.makeText(this, "LiveKit start failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        }, "pucky-mic-start").start();
    }

    private void stopPuckyMic() {
        setCoverStatus("");
        new Thread(() -> {
            try {
                LiveKitController controller = LiveKitController.shared(this, settingsStore);
                JSONObject result = controller.pttStop(new JSONObject());
                JSONObject disconnectArgs = new JSONObject();
                Json.put(disconnectArgs, "reason", "cover_end_button");
                JSONObject disconnectResult = controller.disconnect(disconnectArgs);
                mainHandler.post(() -> {
                    setCoverStatus("");
                    lastTranscriptText = "";
                    lastTranscriptSpeaker = "";
                    long now = System.currentTimeMillis();
                    lastDisconnectAtMs = now;
                    lastPttStartAtMs = 0L;
                    lastPttStopAtMs = 0L;
                    lastAgentTranscriptAtMs = 0L;
                    lastUserTranscriptAtMs = 0L;
                    lastVoxTurnStartedAtMs = 0L;
                    lastAssistantReplyStartedAtMs = 0L;
                    lastAssistantReplyFinishedAtMs = 0L;
                    lastAssistantReplyVisibleUntilMs = 0L;
                    lastCoverTranscriptAtMs = 0L;
                    coverSurfaceMode = MODE_HOME;
                    renderHome();
                    Log.i(TAG, "pttStop result=" + result + " disconnect=" + disconnectResult);
                });
            } catch (Exception e) {
                mainHandler.post(() -> {
                    setCoverStatus("LiveKit end failed");
                    setCoverTranscript(e.getMessage());
                });
            }
        }, "pucky-mic-stop").start();
    }

    private void toggleNotesPanel() {
        notesVisible = !notesVisible;
        if (notesPanel != null) {
            notesPanel.setVisibility(notesVisible ? View.VISIBLE : View.GONE);
        }
        if (notesVisible) {
            refreshThreads();
        }
    }

    private void refreshThreads() {
        if (notesSummaryText != null) {
            notesSummaryText.setText("Loading Project Vox threads...");
        }
        Request request = new Request.Builder()
                .url(projectVoxBaseUrl() + "/api/runtime/state")
                .get()
                .build();
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                mainHandler.post(() -> {
                    if (notesSummaryText != null) {
                        notesSummaryText.setText("Thread load failed: " + e.getMessage());
                    }
                });
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                String body = response.body() == null ? "{}" : response.body().string();
                mainHandler.post(() -> {
                    try {
                        if (!response.isSuccessful()) {
                            throw new JSONException("HTTP " + response.code());
                        }
                        renderThreads(new JSONObject(body));
                    } catch (Exception e) {
                        if (notesSummaryText != null) {
                            notesSummaryText.setText("Thread parse failed: " + e.getMessage());
                        }
                    }
                });
            }
        });
    }

    private void createThread() {
        JSONObject body = new JSONObject();
        try {
            String name = textOf(threadNameInput);
            Json.put(body, "name", name.isEmpty() ? "Pucky cover" : name);
            putIfPresent(body, "model", textOf(modelInput));
            putIfPresent(body, "reasoning_effort", textOf(reasoningInput));
            putIfPresent(body, "service_tier", textOf(serviceTierInput));
        } catch (Exception ignored) {
        }
        postJson("/api/runtime/threads/new", body, "Creating thread...");
    }

    private void openThread(String threadId) {
        JSONObject body = new JSONObject();
        Json.put(body, "thread_id", threadId);
        postJson("/api/runtime/threads/open", body, "Opening thread...");
    }

    private void postJson(String path, JSONObject body, String loadingText) {
        if (notesSummaryText != null) {
            notesSummaryText.setText(loadingText);
        }
        Request request = new Request.Builder()
                .url(projectVoxBaseUrl() + path)
                .post(RequestBody.create(body.toString(), MediaType.parse("application/json")))
                .build();
        httpClient.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                mainHandler.post(() -> {
                    if (notesSummaryText != null) {
                        notesSummaryText.setText("Project Vox request failed: " + e.getMessage());
                    }
                });
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                String text = response.body() == null ? "" : response.body().string();
                mainHandler.post(() -> {
                    if (!response.isSuccessful()) {
                        if (notesSummaryText != null) {
                            notesSummaryText.setText("Project Vox error " + response.code() + ": " + text);
                        }
                        return;
                    }
                    refreshThreads();
                });
            }
        });
    }

    private void renderThreads(JSONObject payload) {
        if (notesList == null || notesSummaryText == null) {
            return;
        }
        notesList.removeAllViews();
        JSONObject harness = payload.optJSONObject("harness");
        JSONObject runtimeState = payload.optJSONObject("runtime_state");
        JSONArray threads = harness == null ? null : harness.optJSONArray("active_threads");
        String currentThreadId = harness == null ? "" : harness.optString("current_thread_id", "");
        if (currentThreadId.isEmpty() && runtimeState != null) {
            currentThreadId = runtimeState.optString("current_thread_id", "");
        }
        if (threads == null) {
            threads = runtimeState == null ? null : runtimeState.optJSONArray("threads");
        }
        if (threads == null || threads.length() == 0) {
            notesSummaryText.setText("No Project Vox threads found.");
            return;
        }
        notesSummaryText.setText("Select an active thread, or create a new one.");
        int shown = 0;
        for (int i = 0; i < threads.length() && shown < 8; i++) {
            JSONObject thread = threads.optJSONObject(i);
            if (thread == null) {
                continue;
            }
            if (thread.optBoolean("archived", false)) {
                continue;
            }
            String title = thread.optString("title", thread.optString("name", "Untitled"));
            String threadId = thread.optString("thread_id", thread.optString("id", ""));
            boolean current = thread.optBoolean("current_thread", false)
                    || (!threadId.isEmpty() && threadId.equals(currentThreadId));
            Button button = coverButton((current ? "* " : "") + title);
            button.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
            button.setOnClickListener(v -> openThread(threadId));
            notesList.addView(button, coverBlockParams());
            shown++;
        }
        if (shown == 0) {
            notesSummaryText.setText("No active Project Vox threads found.");
        }
    }

    private String projectVoxBaseUrl() {
        String broker = settingsStore == null ? "" : settingsStore.getBrokerUrl();
        if (broker == null || broker.trim().isEmpty() || broker.contains("127.0.0.1")) {
            return "https://jt-project-vox-codex.fly.dev";
        }
        String base = broker.trim()
                .replaceFirst("^wss://", "https://")
                .replaceFirst("^ws://", "http://");
        int pathStart = base.indexOf("/v1/");
        if (pathStart > 0) {
            base = base.substring(0, pathStart);
        }
        return base;
    }

    private static void putIfPresent(JSONObject object, String key, String value) {
        if (value != null && !value.trim().isEmpty()) {
            Json.put(object, key, value.trim());
        }
    }

    private static String textOf(EditText input) {
        return input == null || input.getText() == null ? "" : input.getText().toString().trim();
    }

    private void setCoverStatus(String text) {
        if (coverStatusText != null) {
            String value = text == null ? "" : text.trim();
            coverStatusText.setText(value);
            coverStatusText.setVisibility(value.isEmpty() ? View.GONE : View.VISIBLE);
        }
    }

    private void setCoverTranscript(String text) {
        if (coverTranscriptText != null) {
            coverTranscriptText.setText(text == null ? "" : text);
            if (coverTranscriptScroll != null) {
                coverTranscriptScroll.post(() -> coverTranscriptScroll.fullScroll(View.FOCUS_DOWN));
            }
        }
    }

    private void loadHomePortal() {
        if (homeWebView == null) {
            return;
        }
        homePortalLoadStarted = true;
        Log.i(TAG, "Loading Pucky portal width=" + homeWebView.getWidth()
                + " height=" + homeWebView.getHeight());
        String url = homePortalUrl();
        Log.i(TAG, "Opening Pucky portal url=" + url);
        homeWebView.loadUrl(url);
    }

    private String homePortalUrl() {
        String deviceId = settingsStore == null ? "" : settingsStore.getDeviceId();
        return HOME_PORTAL_URL + "?device_id=" + Uri.encode(deviceId == null ? "" : deviceId);
    }

    private void pushCoverStateToWebView(boolean force) {
        if (homeWebView == null) {
            return;
        }
        JSONObject state = buildCoverState();
        String json = state.toString();
        if (!force && json.equals(lastPushedCoverStateJson)) {
            return;
        }
        lastPushedCoverStateJson = json;
        if (!homePortalPageFinished) {
            return;
        }
        homeWebView.evaluateJavascript(
                "window.PuckyCover&&window.PuckyCover.applyState(" + json + ")",
                null);
    }

    private JSONObject buildCoverState() {
        JSONObject liveKit = LiveKitController.shared(this, settingsStore).status();
        refreshLatestTranscript(liveKit);
        String mode = coverModeFor(liveKit);
        coverAccentMode = mode;
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.cover_state.v1");
        Json.put(out, "device_id", settingsStore == null ? "" : settingsStore.getDeviceId());
        Json.put(out, "mode", mode);
        Json.put(out, "theme", coverLightMode ? "light" : "dark");

        JSONObject safe = new JSONObject();
        Json.put(safe, "width_px", COVER_SAFE_RECT_WIDTH_PX);
        Json.put(safe, "top_px", 50);
        Json.put(safe, "bottom_px", COVER_SAFE_RECT_BOTTOM_PX);
        Json.put(out, "safe_rect", safe);

        JSONObject live = new JSONObject();
        Json.put(live, "state", liveKit.optString("state", "unknown"));
        Json.put(live, "connected", liveKit.optBoolean("connected", false));
        Json.put(live, "mic_enabled", liveKit.optBoolean("mic_enabled", false));
        Json.put(live, "room", liveKit.opt("room"));
        Json.put(live, "remote_audio_gain", liveKit.opt("remote_audio_gain"));
        Json.put(out, "livekit", live);

        JSONObject turn = new JSONObject();
        Json.put(turn, "id", JSONObject.NULL);
        Json.put(turn, "phase", phaseForMode(mode));
        Json.put(turn, "speaker", lastTranscriptSpeaker.isEmpty() ? JSONObject.NULL : lastTranscriptSpeaker);
        Json.put(turn, "user_transcript", "user".equals(lastTranscriptSpeaker) ? lastTranscriptText : "");
        Json.put(turn, "assistant_transcript", "agent".equals(lastTranscriptSpeaker) ? lastTranscriptText : "");
        Json.put(turn, "accepted_at", instantOrNull(lastVoxTurnStartedAtMs));
        Json.put(turn, "reply_started_at", instantOrNull(lastAssistantReplyStartedAtMs));
        Json.put(turn, "reply_finished_at", instantOrNull(lastAssistantReplyFinishedAtMs));
        Json.put(out, "turn", turn);

        Json.put(out, "threads", new JSONArray());
        Json.put(out, "current_thread_id", JSONObject.NULL);
        Json.put(out, "inbox", new JSONArray());
        return out;
    }

    private String phaseForMode(String mode) {
        if (MODE_LISTENING.equals(mode)) {
            return "listening";
        }
        if (MODE_FINALIZING.equals(mode)) {
            return "finalizing";
        }
        if (MODE_THINKING.equals(mode)) {
            return "thinking";
        }
        if (MODE_SPEAKING.equals(mode)) {
            return "speaking";
        }
        return "idle";
    }

    private Object instantOrNull(long epochMs) {
        return epochMs > 0L ? Instant.ofEpochMilli(epochMs).toString() : JSONObject.NULL;
    }

    private ScrollView buildAdminView() {
        homeMascotView = null;
        homeEmojiText = null;
        homeLabelText = null;
        homeSubtitleText = null;
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(Color.rgb(247, 248, 250));
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(20, 20, 20, 28);
        scrollView.addView(root, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));

        TextView title = new TextView(this);
        title.setText("Pucky");
        title.setTextSize(28);
        title.setTextColor(Color.rgb(28, 31, 36));
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.START);
        root.addView(title);

        statusText = new TextView(this);
        statusText.setTextSize(15);
        statusText.setTextColor(Color.rgb(67, 75, 86));
        statusText.setPadding(0, 4, 0, 14);
        root.addView(statusText);

        LinearLayout primaryActions = row();
        Button connect = button("Connect");
        connect.setOnClickListener(v -> PuckyForegroundService.start(this, true));
        primaryActions.addView(connect, weightedButtonParams());
        Button stop = button("Stop");
        stop.setOnClickListener(v -> PuckyForegroundService.stop(this));
        primaryActions.addView(stop, weightedButtonParams());
        root.addView(primaryActions);

        root.addView(sectionTitle("Status"));
        stateText = new TextView(this);
        stateText.setTextSize(14);
        stateText.setTextColor(Color.rgb(39, 45, 53));
        stateText.setPadding(16, 12, 16, 12);
        stateText.setBackground(panelBackground());
        root.addView(stateText, fullWidthBlockParams());

        buttonText = new TextView(this);
        buttonText.setTextSize(14);
        buttonText.setTextColor(Color.rgb(39, 45, 53));
        buttonText.setPadding(16, 12, 16, 12);
        buttonText.setBackground(panelBackground());
        root.addView(buttonText, fullWidthBlockParams());

        root.addView(sectionTitle("Controls"));
        LinearLayout serviceActions = row();
        Button start = button("Start");
        start.setOnClickListener(v -> PuckyForegroundService.start(this, false));
        serviceActions.addView(start, weightedButtonParams());
        Button disconnect = button("Disconnect");
        disconnect.setOnClickListener(v -> PuckyForegroundService.disconnect(this));
        serviceActions.addView(disconnect, weightedButtonParams());
        root.addView(serviceActions);

        LinearLayout setupActions = row();
        Button requestPermissions = button("Permissions");
        requestPermissions.setOnClickListener(v -> requestNeededPermissions());
        setupActions.addView(requestPermissions, weightedButtonParams());
        Button homeSettings = button("Home");
        homeSettings.setOnClickListener(v -> openHomeSettings());
        setupActions.addView(homeSettings, weightedButtonParams());
        root.addView(setupActions);

        LinearLayout appActions = row();
        Button appSettings = button("App settings");
        appSettings.setOnClickListener(v -> openAppSettings());
        appActions.addView(appSettings, weightedButtonParams());
        Button refresh = button("Refresh");
        refresh.setOnClickListener(v -> renderState());
        appActions.addView(refresh, weightedButtonParams());
        root.addView(appActions);

        root.addView(sectionTitle("Provisioning"));

        deviceIdInput = input("Device ID", settingsStore.getDeviceId());
        root.addView(label("Device ID"));
        root.addView(deviceIdInput);

        brokerUrlInput = input("Broker URL", settingsStore.getBrokerUrl());
        root.addView(label("Broker URL"));
        root.addView(brokerUrlInput);

        tokenInput = input("Dev token", settingsStore.getToken());
        root.addView(label("Dev token"));
        root.addView(tokenInput);

        Button save = button("Save Provisioning");
        save.setOnClickListener(v -> {
            settingsStore.save(
                    deviceIdInput.getText().toString().trim(),
                    brokerUrlInput.getText().toString().trim(),
                    tokenInput.getText().toString().trim());
            PuckyState.get().setDeviceId(settingsStore.getDeviceId());
            PuckyState.get().setBrokerUrl(settingsStore.getBrokerUrl());
            renderState();
            Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
        });
        root.addView(save, fullWidthBlockParams());

        return scrollView;
    }

    private TextView label(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.rgb(86, 96, 111));
        view.setTextSize(13);
        view.setPadding(0, 8, 0, 0);
        return view;
    }

    private EditText input(String hint, String value) {
        EditText editText = new EditText(this);
        editText.setSingleLine(true);
        editText.setHint(hint);
        editText.setText(value);
        return editText;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(14);
        return button;
    }

    private TextView sectionTitle(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(15);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setTextColor(Color.rgb(28, 31, 36));
        view.setPadding(0, 18, 0, 8);
        return view;
    }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        return row;
    }

    private LinearLayout.LayoutParams weightedButtonParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        params.setMargins(4, 4, 4, 4);
        return params;
    }

    private LinearLayout.LayoutParams fullWidthBlockParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 4, 0, 8);
        return params;
    }

    private LinearLayout.LayoutParams coverBlockParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 2, 0, 4);
        return params;
    }

    private GradientDrawable panelBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(Color.WHITE);
        drawable.setCornerRadius(10);
        drawable.setStroke(1, Color.rgb(223, 227, 232));
        return drawable;
    }

    private GradientDrawable darkButtonBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(Color.rgb(35, 42, 54));
        drawable.setCornerRadius(10);
        drawable.setStroke(1, Color.rgb(70, 82, 98));
        return drawable;
    }

    private void showHomeScreen() {
        if (!adminMode) {
            applySystemUiForMode();
            renderHome();
            return;
        }
        adminMode = false;
        setContentView(buildHomeView());
        applySystemUiForMode();
        renderHome();
    }

    private void showAdminScreen() {
        if (adminMode) {
            exitHomeImmersiveMode();
            renderState();
            return;
        }
        adminMode = true;
        exitHomeImmersiveMode();
        setContentView(buildAdminView());
        exitHomeImmersiveMode();
        renderState();
    }

    private boolean shouldStartInAdmin(Intent intent) {
        return intent != null
                && intent.getBooleanExtra("admin", false);
    }

    private void renderCurrent() {
        if (adminMode) {
            renderState();
        } else {
            renderHome();
        }
    }

    private void renderHome() {
        if (homeWebView != null) {
            pushCoverStateToWebView(false);
            return;
        }
        if (homeLabelText == null || homeSubtitleText == null) {
            return;
        }
        if (coverSurface != null) {
            renderCoverHome();
            return;
        }
        JSONObject state = homeState.snapshot();
        JSONObject screen = state.optJSONObject("screen");
        if (screen == null) {
            homeLabelText.setText(PuckyHomeState.DEFAULT_LABEL);
            homeSubtitleText.setText(PuckyHomeState.DEFAULT_SUBTITLE);
            setCoverStatus(liveKitSummary());
            return;
        }
        homeLabelText.setText(screen.optString("label", PuckyHomeState.DEFAULT_LABEL));
        homeSubtitleText.setText(screen.optString("subtitle", PuckyHomeState.DEFAULT_SUBTITLE));
        setCoverStatus(liveKitSummary());
    }

    private void resetCoverRefs() {
        homeWebView = null;
        homeMascotView = null;
        homeEmojiText = null;
        homeLabelText = null;
        homeSubtitleText = null;
        coverStatusText = null;
        coverTranscriptText = null;
        coverTranscriptScroll = null;
        coverSurface = null;
        coverBottomBar = null;
        thinkingPulseView = null;
        notesSummaryText = null;
        notesPanel = null;
        notesList = null;
        threadNameInput = null;
        modelInput = null;
        reasoningInput = null;
        serviceTierInput = null;
    }

    private void renderCoverHome() {
        JSONObject liveKit = LiveKitController.shared(this, settingsStore).status();
        refreshLatestTranscript(liveKit);
        String mode = coverModeFor(liveKit);
        coverAccentMode = mode;
        boolean voiceMode = MODE_LISTENING.equals(mode)
                || MODE_SPEAKING.equals(mode)
                || MODE_THINKING.equals(mode)
                || MODE_FINALIZING.equals(mode);
        if (coverHeader != null) {
            coverHeader.setVisibility(View.GONE);
        }
        if (coverStatusText != null) {
            coverStatusText.setVisibility(View.GONE);
        }
        applyCoverTextColors(mode);
        homeLabelText.setText(titleForMode(mode));
        String subtitle = subtitleForMode(mode, liveKit);
        homeSubtitleText.setText(subtitle);
        homeSubtitleText.setVisibility(subtitle.isEmpty() ? View.GONE : View.VISIBLE);
        setCoverStatus(statusForMode(mode, liveKit));
        boolean transcriptChanged = !lastTranscriptText.equals(lastRenderedTranscriptText);
        if (mode.equals(lastRenderedCoverMode)
                && !transcriptChanged
                && !MODE_THINKING.equals(mode)
                && !MODE_FINALIZING.equals(mode)) {
            return;
        }
        lastRenderedCoverMode = mode;
        lastRenderedTranscriptText = lastTranscriptText;
        coverSurface.removeAllViews();
        coverSurface.setOnClickListener(null);
        coverSurface.setClickable(false);
        thinkingPulseView = null;
        if (MODE_LISTENING.equals(mode)) {
            renderTranscriptSurface(false);
        } else if (MODE_FINALIZING.equals(mode)) {
            renderTranscriptSurface(false);
        } else if (MODE_SPEAKING.equals(mode)) {
            renderTranscriptSurface(true);
        } else if (MODE_THINKING.equals(mode)) {
            renderThinkingSurface();
        } else if (MODE_APPS.equals(mode)) {
            renderAppsSurface();
        } else if (MODE_THREADS.equals(mode)) {
            renderThreadsSurface();
        } else if (MODE_INBOX.equals(mode)) {
            renderInboxSurface();
        } else {
            renderIdleSurface(liveKit);
        }
        renderCoverBottomBar(mode, voiceMode);
    }

    private String coverModeFor(JSONObject liveKit) {
        String state = liveKit.optString("state", "disconnected");
        boolean connected = liveKit.optBoolean("connected", false);
        boolean mic = liveKit.optBoolean("mic_enabled", false);
        boolean micOpen = mic || "connected_talking".equals(state);
        String activePttTurnId = liveKit.optString("active_ptt_turn_id", "");
        if ("null".equalsIgnoreCase(activePttTurnId)) {
            activePttTurnId = "";
        }
        inferPttStopFromMutedStatus(state, micOpen, activePttTurnId);
        boolean pttTurnOpen = (lastPttStartAtMs > 0L && lastPttStartAtMs > lastPttStopAtMs)
                || !activePttTurnId.isBlank()
                || (micOpen && lastPttStartAtMs > 0L && lastPttStartAtMs > lastPttStopAtMs);
        long latestTurnAtMs = Math.max(
                Math.max(lastPttStartAtMs, lastPttStopAtMs),
                Math.max(lastAgentTranscriptAtMs, lastUserTranscriptAtMs));
        boolean hasCurrentTurn = latestTurnAtMs > lastDisconnectAtMs;
        boolean userSpeechCaptured = lastUserTranscriptAtMs >= lastPttStartAtMs
                && lastUserTranscriptAtMs > lastDisconnectAtMs
                && lastUserTranscriptAtMs > 0L;
        boolean agentReplyVisible = "agent".equals(lastTranscriptSpeaker)
                && !lastTranscriptText.trim().isEmpty()
                && lastAgentTranscriptAtMs >= lastPttStopAtMs
                && lastAgentTranscriptAtMs > lastPttStartAtMs;
        long latestAssistantStartAtMs = Math.max(lastAgentTranscriptAtMs, lastAssistantReplyStartedAtMs);
        boolean assistantStillSpeaking = isAssistantSpeechActive(latestAssistantStartAtMs);
        boolean assistantReplyHeld = isAssistantReplyHeld();
        if (shouldCloseSilentListening(liveKit, userSpeechCaptured)) {
            closeSilentListening();
            return MODE_HOME;
        }
        if (pttTurnOpen) {
            return MODE_LISTENING;
        }
        if (isManualCoverSurface(coverSurfaceMode) && !assistantStillSpeaking) {
            return coverSurfaceMode;
        }
        if (assistantStillSpeaking
                || assistantReplyHeld
                || (agentReplyVisible
                    && MODE_SPEAKING.equals(coverSurfaceMode)
                    && lastCoverTranscriptAtMs <= 0L)) {
            return MODE_SPEAKING;
        }
        boolean userTurnStillOpen = hasCurrentTurn
                && micOpen
                && lastPttStartAtMs > lastPttStopAtMs
                && lastAgentTranscriptAtMs <= lastPttStartAtMs;
        if (userTurnStillOpen) {
            return MODE_LISTENING;
        }
        boolean voxAcceptedTurn = lastVoxTurnStartedAtMs > lastPttStopAtMs
                && lastVoxTurnStartedAtMs > lastDisconnectAtMs;
        if (voxAcceptedTurn && lastAssistantReplyStartedAtMs <= lastVoxTurnStartedAtMs) {
            return MODE_THINKING;
        }
        boolean silentTurnStopped = hasCurrentTurn
                && lastPttStopAtMs >= lastPttStartAtMs
                && lastPttStopAtMs > 0L
                && !userSpeechCaptured
                && lastAgentTranscriptAtMs < lastPttStopAtMs;
        if (silentTurnStopped) {
            return MODE_HOME;
        }
        boolean finalizingTurn = hasCurrentTurn
                && connected
                && userSpeechCaptured
                && lastPttStopAtMs >= lastPttStartAtMs
                && lastPttStopAtMs > 0L
                && lastVoxTurnStartedAtMs < lastPttStopAtMs
                && lastAgentTranscriptAtMs < lastPttStopAtMs;
        if (finalizingTurn) {
            return MODE_FINALIZING;
        }
        if ((connected || "reconnecting".equals(state)) && hasCurrentTurn) {
            if ("agent".equals(lastTranscriptSpeaker)
                    && !lastTranscriptText.trim().isEmpty()
                    && lastCoverTranscriptAtMs <= 0L) {
                return MODE_SPEAKING;
            }
            if (userSpeechCaptured && voxAcceptedTurn) {
                return MODE_THINKING;
            }
        }
        if ("disconnected".equals(state) || "failed".equals(state)) {
            return isVoiceVisualMode(coverSurfaceMode) ? MODE_HOME : coverSurfaceMode;
        }
        return coverSurfaceMode;
    }

    private boolean isManualCoverSurface(String mode) {
        return MODE_APPS.equals(mode)
                || MODE_THREADS.equals(mode)
                || MODE_INBOX.equals(mode);
    }

    private boolean isAssistantSpeechActive(long latestAssistantStartAtMs) {
        if (latestAssistantStartAtMs <= 0L || lastAssistantReplyFinishedAtMs >= latestAssistantStartAtMs) {
            return false;
        }
        long elapsed = Math.max(0L, System.currentTimeMillis() - latestAssistantStartAtMs);
        long estimatedMs = estimatedSpeechStateDurationMs(lastTranscriptText);
        if (elapsed <= estimatedMs) {
            return true;
        }
        lastAssistantReplyFinishedAtMs = latestAssistantStartAtMs;
        return false;
    }

    private long estimatedSpeechStateDurationMs(String text) {
        String clean = text == null ? "" : text.trim();
        if (clean.isEmpty()) {
            return 6000L;
        }
        int words = clean.split("\\s+").length;
        return Math.max(5000L, words * SPEAKING_STATE_WORD_MS + SPEAKING_STATE_TAIL_MS);
    }

    private boolean isAssistantReplyHeld() {
        return lastAssistantReplyVisibleUntilMs > System.currentTimeMillis()
                && "agent".equals(lastTranscriptSpeaker)
                && !lastTranscriptText.trim().isEmpty();
    }

    private boolean shouldCloseSilentListening(JSONObject liveKit, boolean userSpeechCaptured) {
        boolean mic = liveKit.optBoolean("mic_enabled", false)
                || "connected_talking".equals(liveKit.optString("state", ""));
        if (!mic || userSpeechCaptured || lastPttStartAtMs <= lastPttStopAtMs || lastPttStartAtMs <= 0L) {
            return false;
        }
        long now = System.currentTimeMillis();
        return lastSilentCloseAtMs < lastPttStartAtMs
                && now - lastPttStartAtMs >= COVER_NO_SPEECH_TIMEOUT_MS;
    }

    private void closeSilentListening() {
        long now = System.currentTimeMillis();
        lastSilentCloseAtMs = now;
        lastPttStopAtMs = now;
        lastTranscriptText = "";
        lastTranscriptSpeaker = "";
        coverSurfaceMode = MODE_HOME;
        new Thread(() -> {
            try {
                JSONObject result = LiveKitController.shared(this, settingsStore).pttStop(new JSONObject());
                Log.i(TAG, "silent pttStop result=" + result);
            } catch (Exception exc) {
                Log.w(TAG, "silent pttStop failed", exc);
            }
        }, "pucky-silent-listening-close").start();
    }

    private void inferPttStopFromMutedStatus(String liveKitState, boolean micOpen, String activePttTurnId) {
        if (micOpen
                || activePttTurnId == null
                || !activePttTurnId.isBlank()
                || lastPttStartAtMs <= 0L
                || lastPttStartAtMs < lastPttStopAtMs
                || "reconnecting".equals(liveKitState)) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastPttStartAtMs < 2500L) {
            return;
        }
        lastPttStopAtMs = now;
    }

    private String titleForMode(String mode) {
        switch (mode) {
            case MODE_LISTENING:
                return "Listening";
            case MODE_SPEAKING:
                return "Speaking";
            case MODE_THINKING:
                return "Thinking...";
            case MODE_FINALIZING:
                return "";
            case MODE_APPS:
                return "APPS";
            case MODE_THREADS:
                return "THREADS";
            case MODE_INBOX:
                return "INBOX";
            default:
                return "P U C K Y";
        }
    }

    private String subtitleForMode(String mode, JSONObject liveKit) {
        switch (mode) {
            case MODE_LISTENING:
                return "";
            case MODE_SPEAKING:
                return "";
            case MODE_THINKING:
                return "";
            case MODE_APPS:
            case MODE_THREADS:
            case MODE_INBOX:
                return "";
            default:
                return "";
        }
    }

    private String statusForMode(String mode, JSONObject liveKit) {
        String state = liveKit.optString("state", "disconnected");
        String mic = liveKit.optBoolean("mic_enabled", false) ? "mic on" : "mic muted";
        if (MODE_LISTENING.equals(mode)) {
            return "";
        }
        if (MODE_SPEAKING.equals(mode)) {
            return "";
        }
        if (MODE_THINKING.equals(mode)) {
            return "";
        }
        if (MODE_FINALIZING.equals(mode)) {
            return "";
        }
        return "";
    }

    private void applyCoverTextColors(String mode) {
        if (homeLabelText != null) {
            homeLabelText.setLetterSpacing(MODE_HOME.equals(mode) ? 0.22f : 0.05f);
            homeLabelText.setTextColor(MODE_HOME.equals(mode) ? coverColor("primary") : coverColor("accent"));
        }
        if (homeSubtitleText != null) {
            homeSubtitleText.setTextColor(MODE_HOME.equals(mode) ? coverColor("accent") : coverColor("secondary"));
        }
        if (coverStatusText != null) {
            coverStatusText.setTextColor(coverColor("accent"));
        }
        if (homeMascotView != null) {
            homeMascotView.invalidate();
        }
    }

    private void renderIdleSurface(JSONObject liveKit) {
        FrameLayout stage = coverStage(coverSurface);
        stage.setClickable(true);
        stage.setFocusable(true);
        stage.setOnLongClickListener(v -> {
            toggleCoverTheme();
            return true;
        });

        ThinkingPulseView halo = new ThinkingPulseView(this);
        stage.addView(halo, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout center = new LinearLayout(this);
        center.setOrientation(LinearLayout.VERTICAL);
        center.setGravity(Gravity.CENTER);
        center.setClickable(true);
        center.setFocusable(true);
        center.setOnLongClickListener(v -> {
            toggleCoverTheme();
            return true;
        });
        TextView prompt = coverText("Hey Pucky...", 24, false, "primary");
        prompt.setGravity(Gravity.CENTER);
        prompt.setTextColor(Color.WHITE);
        prompt.setIncludeFontPadding(false);
        center.addView(prompt, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        FrameLayout.LayoutParams centerParams = new FrameLayout.LayoutParams(
                HOME_SAFE_CONTENT_WIDTH_PX,
                110,
                Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        centerParams.setMargins(0, 365, 0, 0);
        stage.addView(center, centerParams);

        IconButtonView threads = new IconButtonView(this, "threads", false);
        threads.setOnClickListener(v -> showCoverMode(MODE_THREADS));
        FrameLayout.LayoutParams threadsParams = new FrameLayout.LayoutParams(58, 58, Gravity.TOP | Gravity.RIGHT);
        threadsParams.setMargins(0, 24, 28, 0);
        stage.addView(threads, threadsParams);
    }

    private View homeAppShortcut(String title, String icon, Runnable action) {
        HomeShortcutView tile = new HomeShortcutView(this, title, icon);
        tile.setOnClickListener(v -> action.run());
        return tile;
    }

    private LinearLayout.LayoutParams shortcutParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(110, 92);
        params.setMargins(4, 0, 4, 0);
        return params;
    }

    private void renderTranscriptSurface(boolean speaking) {
        boolean finalizing = MODE_FINALIZING.equals(coverAccentMode);
        FrameLayout stage = coverStage(coverSurface);
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        stage.addView(panel, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        if (finalizing) {
            stage.addView(new FinalizingBorderPulseView(this), new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
        }
        if (speaking) {
            TextView label = coverText("Speaking", 17, true, "accent");
            label.setGravity(Gravity.CENTER);
            label.setIncludeFontPadding(false);
            LinearLayout.LayoutParams labelParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    42);
            labelParams.setMargins(0, 20, 0, 0);
            panel.addView(label, labelParams);
        } else {
            RecordingDotView dot = new RecordingDotView(this);
            LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    54);
            dotParams.setMargins(0, 18, 0, 0);
            panel.addView(dot, dotParams);
        }

        coverTranscriptScroll = new ScrollView(this);
        coverTranscriptScroll.setFillViewport(true);
        coverTranscriptText = coverText("", 22, false, "primary");
        coverTranscriptText.setGravity(Gravity.LEFT | Gravity.TOP);
        coverTranscriptText.setLineSpacing(6f, 1.04f);
        coverTranscriptText.setPadding(34, 6, 34, 34);
        String text = lastTranscriptText.trim();
        coverTranscriptText.setText(speaking ? renderCoverMarkdown(text) : text);
        coverTranscriptScroll.addView(coverTranscriptText, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT));
        panel.addView(coverTranscriptScroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f));
        coverTranscriptScroll.post(() -> {
            if (coverTranscriptText != null && coverTranscriptScroll != null
                    && coverTranscriptText.getBottom() > coverTranscriptScroll.getHeight()) {
                coverTranscriptScroll.fullScroll(View.FOCUS_DOWN);
            }
        });
    }

    private void renderThinkingSurface() {
        FrameLayout stage = coverStage(coverSurface);
        thinkingPulseView = new ThinkingPulseView(this);
        FrameLayout.LayoutParams pulseParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
        pulseParams.setMargins(0, 58, 0, 0);
        stage.addView(thinkingPulseView, pulseParams);

        TextView label = coverText("Thinking...", 17, true, "accent");
        label.setGravity(Gravity.CENTER);
        label.setIncludeFontPadding(true);
        FrameLayout.LayoutParams labelParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                58,
                Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        labelParams.setMargins(0, 18, 0, 0);
        stage.addView(label, labelParams);
    }

    private void renderAppsSurface() {
        FrameLayout stage = coverStage(coverSurface);
        stage.setPadding(24, 28, 24, 24);
        LinearLayout grid = new LinearLayout(this);
        grid.setOrientation(LinearLayout.VERTICAL);
        grid.setPadding(0, 12, 0, 0);
        stage.addView(grid, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        LinearLayout rowOne = row();
        LinearLayout rowTwo = row();
        rowOne.addView(appTile("Camera", "cam", () -> launchPackageOrSettings("com.motorola.camera3")), weightedButtonParams());
        rowOne.addView(appTile("Text", "sms", () -> launchPackageOrSettings("com.google.android.apps.messaging")), weightedButtonParams());
        rowTwo.addView(appTile("Phone", "call", () -> launchPackageOrSettings("com.android.dialer")), weightedButtonParams());
        rowTwo.addView(appTile("Inbox", "queue", () -> showCoverMode(MODE_INBOX)), weightedButtonParams());
        grid.addView(rowOne, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                118));
        grid.addView(rowTwo, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                118));
    }

    private TextView appTile(String title, String subtitle, Runnable action) {
        TextView tile = coverActionLabel(title + "\n" + subtitle, false);
        tile.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
        tile.setTextSize(12);
        tile.setLineSpacing(2f, 0.98f);
        tile.setPadding(22, 0, 12, 0);
        tile.setOnClickListener(v -> action.run());
        return tile;
    }

    private void renderThreadsSurface() {
        FrameLayout stage = coverStage(coverSurface);
        stage.setPadding(24, 28, 24, 24);
        notesList = new LinearLayout(this);
        notesList.setOrientation(LinearLayout.VERTICAL);
        notesList.setPadding(0, 8, 0, 0);
        notesSummaryText = coverText("Loading Project Vox threads...", 14, false, "secondary");
        notesSummaryText.setPadding(4, 0, 4, 10);
        LinearLayout outer = new LinearLayout(this);
        outer.setOrientation(LinearLayout.VERTICAL);
        outer.addView(notesSummaryText);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(notesList);
        outer.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f));
        stage.addView(outer, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        refreshThreads();
    }

    private void renderInboxSurface() {
        FrameLayout stage = coverStage(coverSurface);
        stage.setPadding(24, 28, 24, 24);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(0, 8, 0, 0);
        stage.addView(list, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        addInboxRow(list, "Review APK QA report", true);
        addInboxRow(list, "Reply to Jimmy text", false);
        addInboxRow(list, "Run device command check", false);
    }

    private void addInboxRow(LinearLayout list, String title, boolean active) {
        TextView row = coverActionLabel(title, active);
        row.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
        row.setTextSize(13);
        row.setPadding(22, 0, 12, 0);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                62);
        params.setMargins(0, 6, 0, 8);
        list.addView(row, params);
    }

    private LinearLayout coverPanel(FrameLayout parent, boolean compact) {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setBackground(coverPanelBackground(coverLightMode, true));
        FrameLayout.LayoutParams params = compact
                ? new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT,
                        Gravity.TOP | Gravity.CENTER_HORIZONTAL)
                : coverSafeRectLayoutParams();
        if (compact) {
            params.setMargins(0, 22, 0, 0);
        }
        parent.addView(panel, params);
        return panel;
    }

    private FrameLayout coverStage(FrameLayout parent) {
        FrameLayout stage = new FrameLayout(this);
        stage.setBackground(coverPanelBackground(coverLightMode, true));
        parent.addView(stage, coverSafeRectLayoutParams());
        return stage;
    }

    private FrameLayout.LayoutParams coverSafeRectLayoutParams() {
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                COVER_SAFE_RECT_WIDTH_PX,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        params.setMargins(0, COVER_SAFE_RECT_TOP_PX, 0, COVER_SAFE_RECT_BOTTOM_PX);
        return params;
    }

    private void renderCoverBottomBar(String mode, boolean voiceMode) {
        if (coverBottomBar == null) {
            return;
        }
        coverBottomBar.removeAllViews();
        coverBottomBar.setVisibility(View.VISIBLE);
        ViewGroup.LayoutParams rawParams = coverBottomBar.getLayoutParams();
        if (rawParams instanceof FrameLayout.LayoutParams) {
            FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) rawParams;
            params.width = COVER_BOTTOM_CONTROL_WIDTH_PX;
            params.height = COVER_BOTTOM_BAR_HEIGHT_PX;
            params.gravity = bottomControlsGravity() | Gravity.BOTTOM;
            applyBottomSafeMargins(params);
            coverBottomBar.setLayoutParams(params);
        }
        if (MODE_LISTENING.equals(mode)
                || MODE_SPEAKING.equals(mode)
                || MODE_THINKING.equals(mode)
                || MODE_FINALIZING.equals(mode)) {
            coverBottomBar.setVisibility(View.GONE);
            return;
        }
        if (MODE_THREADS.equals(mode)) {
            addBottomButton("New", true, this::createThread);
            addBottomButton("Refresh", false, this::refreshThreads);
            addBottomButton("Home", false, () -> showCoverMode(MODE_HOME));
            return;
        }
        if (MODE_APPS.equals(mode)) {
            addBottomButton("Home", false, () -> showCoverMode(MODE_HOME));
            addBottomButton("Mic", true, this::startPuckyMic);
            addBottomButton("Threads", false, () -> showCoverMode(MODE_THREADS));
            return;
        }
        if (MODE_INBOX.equals(mode)) {
            addBottomButton("Dictate", true, this::startPuckyMic);
            addBottomButton("Threads", false, () -> showCoverMode(MODE_THREADS));
            addBottomButton("Home", false, () -> showCoverMode(MODE_HOME));
            return;
        }
        if (MODE_HOME.equals(mode)) {
            coverBottomBar.setVisibility(View.GONE);
            return;
        }
        addBottomButton("Mic", true, this::startPuckyMic);
        addBottomButton("Apps", false, () -> showCoverMode(MODE_APPS));
        addBottomButton("Threads", false, () -> showCoverMode(MODE_THREADS));
    }

    private void addBottomIconButton(String icon, boolean active, Runnable action) {
        IconButtonView button = new IconButtonView(this, icon, active);
        button.setOnClickListener(v -> action.run());
        coverBottomBar.addView(button, iconButtonParams());
    }

    private LinearLayout.LayoutParams iconButtonParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(64, 64);
        params.setMargins(10, 0, 10, 0);
        return params;
    }

    private void addBottomButton(String label, boolean active, Runnable action) {
        TextView button = coverActionLabel(label, active);
        button.setOnClickListener(v -> action.run());
        coverBottomBar.addView(button, textButtonParams());
    }

    private LinearLayout.LayoutParams textButtonParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(150, 56);
        params.setMargins(5, 0, 5, 0);
        return params;
    }

    private int bottomControlsGravity() {
        return Gravity.CENTER_HORIZONTAL;
    }

    private void applyBottomSafeMargins(FrameLayout.LayoutParams params) {
        params.setMargins(32, 0, 32, 124);
    }

    private void showCoverMode(String mode) {
        coverSurfaceMode = mode;
        lastRenderedCoverMode = "";
        renderHome();
    }

    private void toggleCoverTheme() {
        coverLightMode = !coverLightMode;
        getSharedPreferences(COVER_PREFS, MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_LIGHT_MODE, coverLightMode)
                .apply();
        setContentView(buildHomeView());
        applySystemUiForMode();
    }

    private TextView coverText(String text, int sp, boolean bold, String role) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(sp);
        view.setTextColor(coverColor(role));
        view.setGravity(Gravity.LEFT);
        view.setIncludeFontPadding(true);
        if (bold) {
            view.setTypeface(Typeface.DEFAULT_BOLD);
        }
        return view;
    }

    private CharSequence renderCoverMarkdown(String source) {
        String text = normalizeMarkdownBlocks(source == null ? "" : source);
        SpannableStringBuilder out = new SpannableStringBuilder();
        int i = 0;
        while (i < text.length()) {
            if (text.startsWith("**", i)) {
                int end = text.indexOf("**", i + 2);
                if (end > i + 2) {
                    int start = out.length();
                    out.append(text, i + 2, end);
                    out.setSpan(new StyleSpan(Typeface.BOLD), start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    i = end + 2;
                    continue;
                }
            }
            if (text.charAt(i) == '`') {
                int end = text.indexOf('`', i + 1);
                if (end > i + 1) {
                    int start = out.length();
                    out.append(text, i + 1, end);
                    out.setSpan(new TypefaceSpan("monospace"), start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    i = end + 1;
                    continue;
                }
            }
            if (text.charAt(i) == '[') {
                int labelEnd = text.indexOf("](", i);
                int urlEnd = labelEnd < 0 ? -1 : text.indexOf(')', labelEnd + 2);
                if (labelEnd > i + 1 && urlEnd > labelEnd + 2) {
                    int start = out.length();
                    out.append(text, i + 1, labelEnd);
                    out.setSpan(new UnderlineSpan(), start, out.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    i = urlEnd + 1;
                    continue;
                }
            }
            out.append(text.charAt(i));
            i++;
        }
        return out;
    }

    private String normalizeMarkdownBlocks(String source) {
        String[] lines = source.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1);
        StringBuilder out = new StringBuilder(source.length());
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String trimmed = line.trim();
            int leading = line.length() - line.stripLeading().length();
            String prefix = leading > 0 ? line.substring(0, leading) : "";
            if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                out.append(prefix).append("• ").append(trimmed.substring(2));
            } else if (trimmed.startsWith("#")) {
                out.append(prefix).append(trimmed.replaceFirst("^#+\\s*", ""));
            } else {
                out.append(line);
            }
            if (i < lines.length - 1) {
                out.append('\n');
            }
        }
        return out.toString();
    }

    private Button coverChip(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextSize(12);
        button.setTextColor(coverColor("primary"));
        button.setGravity(Gravity.CENTER);
        button.setPadding(0, 0, 0, 0);
        button.setMinWidth(0);
        button.setMinHeight(0);
        button.setMinimumWidth(0);
        button.setMinimumHeight(0);
        button.setBackground(coverButtonBackground(false));
        return button;
    }

    private TextView coverActionLabel(String text, boolean active) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setGravity(Gravity.CENTER);
        view.setTextSize(13);
        view.setTypeface(Typeface.DEFAULT_BOLD);
        view.setIncludeFontPadding(false);
        view.setClickable(true);
        view.setFocusable(true);
        view.setTextColor(active ? Color.WHITE : coverColor("primary"));
        view.setBackground(active ? coverActiveBackground() : coverButtonBackground(false));
        return view;
    }

    private GradientDrawable coverPanelBackground(boolean light, boolean active) {
        GradientDrawable drawable = new GradientDrawable();
        int color;
        if (active && (MODE_THINKING.equals(coverAccentMode) || MODE_HOME.equals(coverAccentMode))) {
            color = Color.rgb(2, 6, 10);
        } else {
            color = light
                    ? (active ? Color.rgb(238, 246, 255) : Color.argb(218, 250, 252, 255))
                    : (active ? Color.rgb(10, 26, 42) : Color.argb(205, 9, 17, 26));
        }
        drawable.setColor(color);
        drawable.setCornerRadius(18);
        int strokeColor = active && MODE_HOME.equals(coverAccentMode)
                ? Color.rgb(2, 6, 10)
                : (active ? coverColor("accent") : coverColor("outline"));
        drawable.setStroke(2, strokeColor);
        return drawable;
    }

    private GradientDrawable coverButtonBackground(boolean active) {
        return active ? coverActiveBackground() : coverPanelBackground(coverLightMode, false);
    }

    private GradientDrawable coverActiveBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(coverColor("accent"));
        drawable.setCornerRadius(18);
        drawable.setStroke(2, coverLightMode ? Color.rgb(137, 184, 255) : Color.rgb(126, 190, 255));
        return drawable;
    }

    private int coverColor(String role) {
        boolean light = coverLightMode;
        switch (role) {
            case "background":
                return light ? Color.rgb(247, 251, 255) : Color.rgb(2, 6, 10);
            case "surface":
                return light ? Color.rgb(250, 252, 255) : Color.rgb(8, 16, 25);
            case "primary":
                return light ? Color.rgb(9, 18, 32) : Color.rgb(245, 249, 255);
            case "secondary":
                return light ? Color.rgb(77, 100, 130) : Color.rgb(179, 201, 224);
            case "accent":
                return coverAccentColor(light);
            case "outline":
                return light ? Color.rgb(214, 226, 242) : Color.rgb(36, 55, 78);
            default:
                return light ? Color.rgb(18, 32, 51) : Color.rgb(239, 247, 255);
        }
    }

    private int coverAccentColor(boolean light) {
        switch (coverAccentMode) {
            case MODE_LISTENING:
            case MODE_FINALIZING:
                return light ? Color.rgb(205, 35, 35) : Color.rgb(230, 32, 32);
            case MODE_THINKING:
                return Color.rgb(215, 114, 7);
            case MODE_SPEAKING:
                return light ? Color.rgb(34, 111, 232) : Color.rgb(88, 178, 255);
            default:
                return light ? Color.rgb(34, 111, 232) : Color.rgb(88, 178, 255);
        }
    }

    private void refreshLatestTranscript(JSONObject liveKit) {
        try {
            JSONObject args = new JSONObject();
            Json.put(args, "limit", 120);
            JSONArray events = LiveKitController.shared(this, settingsStore)
                    .eventsList(args)
                    .optJSONArray("events");
            if (events == null) {
                return;
            }
            long scannedPttStartAtMs = 0L;
            long scannedPttStopAtMs = 0L;
            long scannedDisconnectAtMs = 0L;
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.optJSONObject(i);
                if (event == null) {
                    continue;
                }
                String eventName = event.optString("event", "");
                long eventAtMs = eventTimeMs(event, i);
                if (eventAtMs < coverEventFloorAtMs) {
                    continue;
                }
                if ("ptt_start_requested".equals(eventName)
                        || "ptt_turn_started".equals(eventName)
                        || isPttMicEvent(event, "mic_enabled")) {
                    scannedPttStartAtMs = Math.max(scannedPttStartAtMs, eventAtMs);
                } else if ("ptt_stop_requested".equals(eventName)
                        || "ptt_turn_stopped".equals(eventName)
                        || isPttMicEvent(event, "mic_disabled")) {
                    scannedPttStopAtMs = Math.max(scannedPttStopAtMs, eventAtMs);
                } else if ("disconnected".equals(eventName) || "sdk_disconnected".equals(eventName)) {
                    scannedDisconnectAtMs = Math.max(scannedDisconnectAtMs, eventAtMs);
                } else if ("cover_event".equals(eventName)) {
                    applyCoverEvent(event, eventAtMs);
                }
            }
            if (scannedDisconnectAtMs > lastDisconnectAtMs) {
                lastDisconnectAtMs = scannedDisconnectAtMs;
            }
            if (scannedPttStartAtMs > lastPttStartAtMs) {
                lastPttStartAtMs = scannedPttStartAtMs;
                clearCoverTurnTranscript(scannedPttStartAtMs);
                coverSurfaceMode = MODE_LISTENING;
            }
            if (scannedPttStopAtMs > lastPttStopAtMs) {
                lastPttStopAtMs = scannedPttStopAtMs;
            }
            boolean micOpen = liveKit.optBoolean("mic_enabled", false)
                    || "connected_talking".equals(liveKit.optString("state", ""));
            if (micOpen && lastPttStartAtMs >= lastPttStopAtMs) {
                if (!"user".equals(lastTranscriptSpeaker) || lastAgentTranscriptAtMs > lastPttStartAtMs) {
                    clearCoverTurnTranscript(lastPttStartAtMs > 0L
                            ? lastPttStartAtMs
                            : System.currentTimeMillis());
                }
                coverSurfaceMode = MODE_LISTENING;
            }

            long transcriptFloorAtMs = Math.max(Math.max(lastDisconnectAtMs, lastPttStartAtMs), coverEventFloorAtMs);
            String newestText = "";
            String newestSpeaker = "";
            long newestTranscriptAtMs = 0L;
            long newestAgentAtMs = lastAgentTranscriptAtMs;
            long newestUserAtMs = lastUserTranscriptAtMs;
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.optJSONObject(i);
                if (event == null || !"transcription_received".equals(event.optString("event", ""))) {
                    continue;
                }
                long eventAtMs = eventTimeMs(event, i);
                if (eventAtMs < transcriptFloorAtMs) {
                    continue;
                }
                JSONObject detail = event.optJSONObject("detail");
                JSONArray segments = detail == null ? null : detail.optJSONArray("segments");
                if (segments == null || segments.length() == 0) {
                    continue;
                }
                for (int j = segments.length() - 1; j >= 0; j--) {
                    JSONObject segment = segments.optJSONObject(j);
                    String text = segment == null ? "" : segment.optString("text", "").trim();
                    if (text.isEmpty()) {
                        continue;
                    }
                    String speaker = speakerForTranscript(detail.optString("participant", ""), liveKit);
                    if ("agent".equals(speaker) && !shouldAcceptAgentTranscriptForCover(eventAtMs)) {
                        continue;
                    }
                    if ("agent".equals(speaker)) {
                        newestAgentAtMs = Math.max(newestAgentAtMs, eventAtMs);
                    } else {
                        newestUserAtMs = Math.max(newestUserAtMs, eventAtMs);
                    }
                    if ("user".equals(speaker)
                            && lastVoxTurnStartedAtMs > 0L
                            && eventAtMs >= lastVoxTurnStartedAtMs) {
                        break;
                    }
                    if (eventAtMs >= newestTranscriptAtMs) {
                        newestTranscriptAtMs = eventAtMs;
                        newestText = text;
                        newestSpeaker = speaker;
                    }
                    break;
                }
            }
            lastAgentTranscriptAtMs = newestAgentAtMs;
            lastUserTranscriptAtMs = newestUserAtMs;
            boolean coverAgentTextAuthoritative = lastCoverTranscriptAtMs > 0L
                    && "agent".equals(lastTranscriptSpeaker);
            if (!newestText.isEmpty()
                    && newestTranscriptAtMs >= lastCoverTranscriptAtMs
                    && (!coverAgentTextAuthoritative || !"agent".equals(newestSpeaker))
                    && (!newestText.equals(lastTranscriptText) || !newestSpeaker.equals(lastTranscriptSpeaker))) {
                lastTranscriptText = newestText;
                lastTranscriptSpeaker = newestSpeaker;
                lastTranscriptChangedAtMs = System.currentTimeMillis();
            } else if (lastPttStartAtMs > lastTranscriptChangedAtMs && lastPttStartAtMs >= lastPttStopAtMs) {
                lastTranscriptText = "";
                lastTranscriptSpeaker = "user";
                lastTranscriptChangedAtMs = lastPttStartAtMs;
            }
        } catch (Exception exc) {
            Log.w(TAG, "transcript refresh failed", exc);
        }
    }

    private boolean isPttMicEvent(JSONObject event, String expectedName) {
        if (!expectedName.equals(event.optString("event", ""))) {
            return false;
        }
        JSONObject detail = event.optJSONObject("detail");
        String reason = detail == null ? "" : detail.optString("reason", "");
        return reason.startsWith("ptt_") || reason.contains("volume_up_hold");
    }

    private void applyCoverEvent(JSONObject event, long eventAtMs) {
        JSONObject detail = event.optJSONObject("detail");
        if (detail == null) {
            return;
        }
        String coverEvent = detail.optString("event", detail.optString("type", ""));
        if (coverEvent.isEmpty()) {
            return;
        }
        if ("codex_turn_started".equals(coverEvent)
                || "turn_accepted".equals(coverEvent)
                || "turn_started".equals(coverEvent)) {
            if (eventAtMs > lastVoxTurnStartedAtMs) {
                lastVoxTurnStartedAtMs = eventAtMs;
                coverSurfaceMode = MODE_THINKING;
            }
            return;
        }
        if ("assistant_reply_started".equals(coverEvent)
                || "assistant_reply_text".equals(coverEvent)
                || "assistant_reply_delta".equals(coverEvent)) {
            String text = detail.optString("text", "").trim();
            if (!text.isEmpty()
                    && (eventAtMs > lastAssistantReplyStartedAtMs || !text.equals(lastTranscriptText))) {
                lastTranscriptText = text;
                lastTranscriptSpeaker = "agent";
                lastTranscriptChangedAtMs = System.currentTimeMillis();
                lastCoverTranscriptAtMs = eventAtMs;
            }
            lastAssistantReplyStartedAtMs = Math.max(lastAssistantReplyStartedAtMs, eventAtMs);
            lastAssistantReplyFinishedAtMs = 0L;
            lastAssistantReplyVisibleUntilMs = Math.max(
                    lastAssistantReplyVisibleUntilMs,
                    System.currentTimeMillis() + estimatedSpeechStateDurationMs(lastTranscriptText));
            lastAgentTranscriptAtMs = Math.max(lastAgentTranscriptAtMs, eventAtMs);
            coverSurfaceMode = MODE_SPEAKING;
            return;
        }
        if ("assistant_reply_finished".equals(coverEvent)
                || "assistant_speech_finished".equals(coverEvent)) {
            lastAssistantReplyFinishedAtMs = Math.max(lastAssistantReplyFinishedAtMs, eventAtMs);
            if ("agent".equals(lastTranscriptSpeaker) && !lastTranscriptText.trim().isEmpty()) {
                lastAssistantReplyVisibleUntilMs = Math.max(
                        lastAssistantReplyVisibleUntilMs,
                        System.currentTimeMillis() + SPEAKING_FINISHED_HOLD_MS);
                coverSurfaceMode = MODE_SPEAKING;
            }
        }
    }

    private void resetCoverVisualHome(String reason) {
        lastTranscriptText = "";
        lastTranscriptSpeaker = "";
        lastRenderedCoverMode = "";
        lastRenderedTranscriptText = "";
        lastPttStartAtMs = 0L;
        lastPttStopAtMs = 0L;
        lastAgentTranscriptAtMs = 0L;
        lastUserTranscriptAtMs = 0L;
        lastVoxTurnStartedAtMs = 0L;
        lastAssistantReplyStartedAtMs = 0L;
        lastAssistantReplyFinishedAtMs = 0L;
        lastAssistantReplyVisibleUntilMs = 0L;
        lastCoverTranscriptAtMs = 0L;
        coverEventFloorAtMs = System.currentTimeMillis();
        coverSurfaceMode = MODE_HOME;
        Log.i(TAG, "cover visual reset home reason=" + reason);
        renderCurrent();
    }

    private void handleCoverScreenVisibilityChanged(String reason) {
        JSONObject liveKit = LiveKitController.shared(this, settingsStore).status();
        refreshLatestTranscript(liveKit);
        if (shouldPreserveCoverVisual(liveKit)
                || (isVoiceVisualMode(coverSurfaceMode) && hasVmDrivenCoverTurn())) {
            renderCurrent();
            return;
        }
        resetCoverVisualHome(reason);
    }

    private void clearCoverTurnTranscript(long startedAtMs) {
        lastTranscriptText = "";
        lastTranscriptSpeaker = "user";
        lastTranscriptChangedAtMs = startedAtMs;
        lastRenderedTranscriptText = "__pucky_clear__";
        lastAgentTranscriptAtMs = 0L;
        lastUserTranscriptAtMs = 0L;
        lastVoxTurnStartedAtMs = 0L;
        lastAssistantReplyStartedAtMs = 0L;
        lastAssistantReplyFinishedAtMs = 0L;
        lastAssistantReplyVisibleUntilMs = 0L;
        lastCoverTranscriptAtMs = 0L;
    }

    private boolean shouldResetCoverOnResume() {
        if (MODE_HOME.equals(coverSurfaceMode)) {
            return false;
        }
        if (isVoiceVisualMode(coverSurfaceMode) && hasVmDrivenCoverTurn()) {
            return false;
        }
        JSONObject liveKit = LiveKitController.shared(this, settingsStore).status();
        refreshLatestTranscript(liveKit);
        if (MODE_THINKING.equals(coverSurfaceMode) && hasPendingAcceptedCoverTurn()) {
            return false;
        }
        if (MODE_FINALIZING.equals(coverSurfaceMode) && hasRecentStoppedUserTurn()) {
            return false;
        }
        if (MODE_SPEAKING.equals(coverSurfaceMode) && isAssistantReplyHeld()) {
            return false;
        }
        return !shouldPreserveCoverVisual(liveKit);
    }

    private boolean shouldPreserveCoverVisual(JSONObject liveKit) {
        boolean micOpen = liveKit.optBoolean("mic_enabled", false)
                || "connected_talking".equals(liveKit.optString("state", ""));
        return micOpen
                || hasPendingAcceptedCoverTurn()
                || (MODE_FINALIZING.equals(coverSurfaceMode) && hasRecentStoppedUserTurn())
                || (MODE_SPEAKING.equals(coverSurfaceMode) && isAssistantReplyHeld());
    }

    private boolean hasVmDrivenCoverTurn() {
        return lastVoxTurnStartedAtMs > 0L
                || lastAssistantReplyStartedAtMs > 0L
                || lastCoverTranscriptAtMs > 0L;
    }

    private boolean hasPendingAcceptedCoverTurn() {
        return lastVoxTurnStartedAtMs > 0L
                && lastVoxTurnStartedAtMs > lastDisconnectAtMs
                && lastVoxTurnStartedAtMs >= lastPttStopAtMs
                && lastAssistantReplyStartedAtMs <= lastVoxTurnStartedAtMs
                && lastAssistantReplyFinishedAtMs < lastVoxTurnStartedAtMs;
    }

    private boolean hasRecentStoppedUserTurn() {
        long latestUserTurnAtMs = Math.max(lastPttStopAtMs, lastUserTranscriptAtMs);
        return latestUserTurnAtMs > 0L
                && latestUserTurnAtMs > lastDisconnectAtMs
                && System.currentTimeMillis() - latestUserTurnAtMs < COVER_NO_SPEECH_TIMEOUT_MS;
    }

    private boolean isVoiceVisualMode(String mode) {
        return MODE_LISTENING.equals(mode)
                || MODE_SPEAKING.equals(mode)
                || MODE_THINKING.equals(mode)
                || MODE_FINALIZING.equals(mode);
    }

    private long eventTimeMs(JSONObject event, int fallbackOffset) {
        String timestamp = event.optString("timestamp", "");
        if (!timestamp.isEmpty()) {
            try {
                return Instant.parse(timestamp).toEpochMilli();
            } catch (Exception ignored) {
                // Fall through to a monotonic-ish fallback for malformed local debug events.
            }
        }
        return System.currentTimeMillis() + fallbackOffset;
    }

    private String speakerForTranscript(String participant, JSONObject liveKit) {
        String who = participant == null ? "" : participant.trim().toLowerCase(Locale.US);
        String localIdentity = jsonLower(liveKit, "identity");
        String localName = jsonLower(liveKit, "participant_name");
        if (!who.isEmpty()) {
            if (who.equals(localIdentity) || who.equals(localName)) {
                return "user";
            }
            return "agent";
        }
        return lastPttStartAtMs >= lastPttStopAtMs ? "user" : "agent";
    }

    private boolean shouldAcceptAgentTranscriptForCover(long eventAtMs) {
        if (lastPttStartAtMs <= 0L) {
            return eventAtMs > lastDisconnectAtMs;
        }
        if (eventAtMs < lastPttStartAtMs) {
            return false;
        }
        if (lastAssistantReplyStartedAtMs > lastPttStartAtMs
                && eventAtMs >= lastAssistantReplyStartedAtMs) {
            return true;
        }
        return lastCoverTranscriptAtMs > lastPttStartAtMs
                && eventAtMs >= lastCoverTranscriptAtMs;
    }

    private String jsonLower(JSONObject json, String key) {
        Object value = json == null ? null : json.opt(key);
        if (value == null || value == JSONObject.NULL) {
            return "";
        }
        return String.valueOf(value).trim().toLowerCase(Locale.US);
    }

    private void mutePuckyMic() {
        setCoverStatus("");
        new Thread(() -> {
            try {
                JSONObject result = LiveKitController.shared(this, settingsStore).pttStop(new JSONObject());
                mainHandler.post(() -> {
                    setCoverStatus("");
                    coverSurfaceMode = MODE_HOME;
                    renderHome();
                    Log.i(TAG, "pttStop result=" + result);
                });
            } catch (Exception e) {
                mainHandler.post(() -> {
                    setCoverStatus("LiveKit mute failed");
                    setCoverTranscript(e.getMessage());
                });
            }
        }, "pucky-mic-mute").start();
    }

    private void postPauseToggleEvent() {
        JSONObject livekit = LiveKitController.shared(this, settingsStore).status();
        JSONObject event = new JSONObject();
        Json.put(event, "schema", "pucky.device_event.v1");
        Json.put(event, "event_id", "evt_" + Long.toHexString(System.currentTimeMillis()));
        Json.put(event, "device_id", settingsStore.getDeviceId());
        Json.put(event, "timestamp", Instant.now().toString());
        Json.put(event, "type", "reply.pause_toggle");
        Json.put(event, "gesture", "cover_pause_button");
        Json.put(event, "source", "cover_ui");
        Json.put(event, "livekit_state", livekit.optString("state", ""));
        Json.put(event, "mic_enabled", livekit.optBoolean("mic_enabled", false));
        new BrokerEventPoster(this).postAsync(event);
        setCoverStatus("pause toggle sent");
    }

    private void startCoverTicker() {
        if (coverTicker != null) {
            return;
        }
        coverTicker = new Runnable() {
            @Override
            public void run() {
                if (!adminMode && (coverSurface != null || homeWebView != null)) {
                    renderHome();
                }
                mainHandler.postDelayed(this, 900);
            }
        };
        mainHandler.postDelayed(coverTicker, 900);
    }

    private void stopCoverTicker() {
        if (coverTicker != null) {
            mainHandler.removeCallbacks(coverTicker);
            coverTicker = null;
        }
    }

    private final class IconButtonView extends View {
        private final String icon;
        private final boolean active;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF rect = new RectF();
        private final Path path = new Path();

        private IconButtonView(Context context, String icon, boolean active) {
            super(context);
            this.icon = icon;
            this.active = active;
            setClickable(true);
            setFocusable(true);
            setContentDescription(icon);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float w = getWidth();
            float h = getHeight();
            float cx = w / 2f;
            float cy = h / 2f;
            int accent = coverColor("accent");
            int primary = coverColor("primary");
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(active ? accent : Color.argb(coverLightMode ? 232 : 210,
                    Color.red(coverColor("surface")),
                    Color.green(coverColor("surface")),
                    Color.blue(coverColor("surface"))));
            canvas.drawCircle(cx, cy, Math.min(w, h) * 0.46f, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2.5f);
            paint.setColor(active ? accent : coverColor("outline"));
            canvas.drawCircle(cx, cy, Math.min(w, h) * 0.46f - 1.5f, paint);

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            paint.setStrokeWidth(4.2f);
            paint.setColor(active ? Color.WHITE : primary);
            if ("pause".equals(icon)) {
                paint.setStyle(Paint.Style.FILL);
                rect.set(cx - 12, cy - 16, cx - 5, cy + 16);
                canvas.drawRoundRect(rect, 3, 3, paint);
                rect.set(cx + 5, cy - 16, cx + 12, cy + 16);
                canvas.drawRoundRect(rect, 3, 3, paint);
            } else if ("end".equals(icon)) {
                paint.setColor(active ? Color.WHITE : coverColor("accent"));
                canvas.drawLine(cx - 13, cy - 13, cx + 13, cy + 13, paint);
                canvas.drawLine(cx + 13, cy - 13, cx - 13, cy + 13, paint);
            } else if ("mute".equals(icon)) {
                rect.set(cx - 8, cy - 17, cx + 8, cy + 10);
                canvas.drawRoundRect(rect, 8, 8, paint);
                canvas.drawLine(cx - 18, cy + 2, cx - 18, cy + 20, paint);
                canvas.drawLine(cx - 18, cy + 20, cx + 18, cy + 20, paint);
                canvas.drawLine(cx + 18, cy + 2, cx + 18, cy + 20, paint);
                canvas.drawLine(cx - 19, cy + 21, cx + 19, cy - 21, paint);
            } else if ("threads".equals(icon)) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(3.4f);
                rect.set(cx - 13, cy - 15, cx + 13, cy + 15);
                canvas.drawRoundRect(rect, 5, 5, paint);
                canvas.drawLine(cx - 7, cy - 7, cx + 7, cy - 7, paint);
                canvas.drawLine(cx - 7, cy, cx + 7, cy, paint);
                canvas.drawLine(cx - 7, cy + 7, cx + 3, cy + 7, paint);
            } else {
                canvas.drawCircle(cx, cy, 11, paint);
            }
        }
    }

    private final class FinalizingBorderPulseView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF rect = new RectF();

        private FinalizingBorderPulseView(Context context) {
            super(context);
            setWillNotDraw(false);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            long now = System.currentTimeMillis();
            float phase = (now % 1180L) / 1180f;
            int accent = coverColor("accent");
            int red = Color.red(accent);
            int green = Color.green(accent);
            int blue = Color.blue(accent);
            rect.set(6, 6, getWidth() - 6, getHeight() - 6);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeWidth(4.5f);
            paint.setColor(Color.argb(95, red, green / 2, blue / 2));
            canvas.drawRoundRect(rect, 18, 18, paint);

            float perimeter = (rect.width() + rect.height()) * 2f;
            float dash = Math.max(140f, perimeter * 0.18f);
            paint.setStrokeWidth(6f);
            paint.setColor(Color.argb(170, red, Math.max(10, green / 2), Math.max(10, blue / 2)));
            Path border = new Path();
            border.addRoundRect(rect, 18, 18, Path.Direction.CW);
            paint.setPathEffect(new android.graphics.DashPathEffect(
                    new float[] { dash, Math.max(1f, perimeter - dash) },
                    -phase * perimeter));
            canvas.drawPath(border, paint);
            paint.setPathEffect(null);
            postInvalidateOnAnimation();
        }
    }

    private final class HomeShortcutView extends View {
        private final String label;
        private final String icon;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final RectF rect = new RectF();
        private final Path path = new Path();

        private HomeShortcutView(Context context, String label, String icon) {
            super(context);
            this.label = label;
            this.icon = icon;
            setClickable(true);
            setFocusable(true);
            setContentDescription(label);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float cx = getWidth() / 2f;
            int accent = coverColor("accent");
            int primary = coverColor("primary");
            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(coverLightMode ? 230 : 216,
                    Color.red(coverColor("surface")),
                    Color.green(coverColor("surface")),
                    Color.blue(coverColor("surface"))));
            rect.set(cx - 26, 4, cx + 26, 56);
            canvas.drawRoundRect(rect, 14, 14, paint);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(2f);
            paint.setColor(coverColor("outline"));
            canvas.drawRoundRect(rect, 14, 14, paint);

            paint.setColor(primary);
            paint.setStrokeWidth(3.2f);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            drawShortcutIcon(canvas, cx, 30);

            paint.setStyle(Paint.Style.FILL);
            paint.setTypeface(Typeface.DEFAULT);
            paint.setTextAlign(Paint.Align.CENTER);
            paint.setTextSize(12f);
            paint.setColor(coverColor("secondary"));
            canvas.drawText(label, cx, 82, paint);
            paint.setColor(accent);
        }

        private void drawShortcutIcon(Canvas canvas, float cx, float cy) {
            if ("camera".equals(icon)) {
                rect.set(cx - 15, cy - 8, cx + 15, cy + 12);
                canvas.drawRoundRect(rect, 4, 4, paint);
                paint.setStyle(Paint.Style.FILL);
                canvas.drawCircle(cx, cy + 2, 5, paint);
                paint.setStyle(Paint.Style.STROKE);
                canvas.drawLine(cx - 8, cy - 13, cx + 6, cy - 13, paint);
            } else if ("text".equals(icon)) {
                rect.set(cx - 15, cy - 11, cx + 15, cy + 10);
                canvas.drawRoundRect(rect, 8, 8, paint);
                path.reset();
                path.moveTo(cx - 3, cy + 10);
                path.lineTo(cx - 10, cy + 16);
                path.lineTo(cx - 7, cy + 8);
                canvas.drawPath(path, paint);
                canvas.drawPoint(cx - 6, cy, paint);
                canvas.drawPoint(cx, cy, paint);
                canvas.drawPoint(cx + 6, cy, paint);
            } else if ("phone".equals(icon)) {
                paint.setStyle(Paint.Style.STROKE);
                paint.setStrokeWidth(4f);
                canvas.drawArc(cx - 16, cy - 13, cx + 16, cy + 19, 215, 110, false, paint);
                paint.setStyle(Paint.Style.FILL);
                rect.set(cx - 18, cy + 7, cx - 8, cy + 15);
                canvas.drawRoundRect(rect, 4, 4, paint);
                rect.set(cx + 8, cy + 7, cx + 18, cy + 15);
                canvas.drawRoundRect(rect, 4, 4, paint);
            } else {
                rect.set(cx - 17, cy - 10, cx + 17, cy + 13);
                canvas.drawRoundRect(rect, 3, 3, paint);
                canvas.drawLine(cx - 17, cy - 10, cx, cy + 4, paint);
                canvas.drawLine(cx + 17, cy - 10, cx, cy + 4, paint);
            }
        }
    }

    private final class RecordingDotView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        private RecordingDotView(Context context) {
            super(context);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float cx = getWidth() / 2f;
            float cy = getHeight() / 2f;
            long now = System.currentTimeMillis();
            float wave = (float) ((Math.sin(now / 360.0d) + 1.0d) / 2.0d);
            int red = coverLightMode ? 205 : 230;
            int green = coverLightMode ? 35 : 32;
            int blue = coverLightMode ? 35 : 32;

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(38 + (int) (wave * 34), red, green, blue));
            canvas.drawCircle(cx, cy, 22f + wave * 8f, paint);
            paint.setColor(Color.argb(92, red, green, blue));
            canvas.drawCircle(cx, cy, 13f + wave * 4f, paint);
            paint.setColor(Color.rgb(red, green, blue));
            canvas.drawCircle(cx, cy, 7.5f, paint);
            postInvalidateOnAnimation();
        }
    }

    private final class ThinkingPulseView extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();
        private final RectF rect = new RectF();

        private ThinkingPulseView(Context context) {
            super(context);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float width = getWidth();
            float height = getHeight();
            float cx = width * 0.50f;
            boolean homeMode = MODE_HOME.equals(coverAccentMode);
            float cy = homeMode ? height * 0.40f : height * 0.52f;
            long now = System.currentTimeMillis();
            float wave = (float) ((Math.sin(now / 360.0d) + 1.0d) / 2.0d);
            if (!homeMode) {
                drawThinkingEventHorizon(canvas, cx, cy, wave, now);
                postInvalidateOnAnimation();
                return;
            }
            int red = coverLightMode ? 67 : 48;
            int green = coverLightMode ? 151 : 168;
            int blue = 255;
            int coreAlpha = coverLightMode ? 38 : 62;
            int ringAlpha = coverLightMode ? 86 : 116;
            paint.setStyle(Paint.Style.FILL);
            for (int i = 0; i < 4; i++) {
                float radius = (homeMode ? 54f : 48f) + (i * (homeMode ? 34f : 42f)) + wave * 12f;
                int alpha = Math.max(12, coreAlpha - i * 12);
                paint.setColor(Color.argb(alpha, red, green, blue));
                canvas.drawCircle(cx, cy, radius, paint);
            }
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(homeMode ? 8f : 7f);
            paint.setColor(Color.argb(ringAlpha, red, green, blue));
            canvas.drawCircle(cx, cy, (homeMode ? 82f : 64f) + wave * 7f, paint);
            paint.setStrokeWidth(homeMode ? 18f : 14f);
            paint.setColor(Color.argb(coverLightMode ? 28 : 46, red, green, blue));
            canvas.drawCircle(cx, cy, (homeMode ? 90f : 72f) + wave * 8f, paint);
            postInvalidateOnAnimation();
        }

        private void drawThinkingEventHorizon(Canvas canvas, float cx, float cy, float wave, long now) {
            int accent = coverColor("accent");
            int red = Color.red(accent);
            int green = Color.green(accent);
            int blue = Color.blue(accent);
            float flicker = (float) ((Math.sin(now / 96.0d) + 1.0d) / 2.0d);
            float breath = 1f + wave * 0.035f;
            float beamHalf = Math.min(getWidth() * 0.39f, 390f);

            paint.setStyle(Paint.Style.FILL);
            for (int i = 0; i < 5; i++) {
                float radius = (34f + i * 33f) * breath;
                int alpha = Math.max(6, (coverLightMode ? 34 : 46) - i * 8);
                paint.setColor(Color.argb(alpha, red, green, blue));
                canvas.drawCircle(cx, cy, radius, paint);
            }

            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);

            paint.setStrokeWidth(14f);
            paint.setColor(Color.argb(18 + (int) (wave * 8f), red, green, blue));
            canvas.drawLine(cx - beamHalf, cy, cx + beamHalf, cy, paint);
            paint.setStrokeWidth(7f);
            paint.setColor(Color.argb(42 + (int) (flicker * 22f), red, green, blue));
            canvas.drawLine(cx - beamHalf * 0.92f, cy, cx + beamHalf * 0.92f, cy, paint);
            paint.setStrokeWidth(2.4f);
            paint.setColor(Color.argb(224, red, green, blue));
            canvas.drawLine(cx - beamHalf * 0.84f, cy, cx + beamHalf * 0.84f, cy, paint);
            paint.setStrokeWidth(1.1f);
            paint.setColor(Color.argb(250, Math.min(255, red + 30), Math.min(255, green + 42), Math.min(255, blue + 16)));
            canvas.drawLine(cx - beamHalf * 0.58f, cy, cx + beamHalf * 0.58f, cy, paint);

            paint.setStrokeWidth(2.2f);
            paint.setColor(Color.argb(62, red, green, blue));
            canvas.drawCircle(cx, cy, 104f * breath, paint);
            paint.setStrokeWidth(1.5f);
            paint.setColor(Color.argb(42, red, green, blue));
            canvas.drawCircle(cx, cy, 154f * breath, paint);

            drawBeamFragments(canvas, cx, cy, beamHalf, red, green, blue, wave, flicker);
            drawScanLines(canvas, cx, cy, beamHalf, red, green, blue);

            paint.setStyle(Paint.Style.FILL);
            paint.setColor(Color.argb(82 + (int) (wave * 34f), red, green, blue));
            canvas.drawCircle(cx, cy, 26f + wave * 5f, paint);
            paint.setColor(Color.argb(188 + (int) (flicker * 38f), red, green, blue));
            canvas.drawCircle(cx, cy, 8.5f + wave * 1.5f, paint);
            paint.setColor(Color.argb(255, Math.min(255, red + 44), Math.min(255, green + 54), Math.min(255, blue + 24)));
            canvas.drawCircle(cx, cy, 3.8f, paint);
        }

        private void drawBeamFragments(
                Canvas canvas,
                float cx,
                float cy,
                float beamHalf,
                int red,
                int green,
                int blue,
                float wave,
                float flicker) {
            float[] segments = {
                    -0.95f, -0.80f,
                    -0.70f, -0.63f,
                    -0.47f, -0.31f,
                    -0.18f, -0.11f,
                    0.10f, 0.18f,
                    0.30f, 0.46f,
                    0.61f, 0.70f,
                    0.79f, 0.93f
            };
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.BUTT);
            for (int i = 0; i < segments.length; i += 2) {
                float start = cx + beamHalf * segments[i];
                float end = cx + beamHalf * segments[i + 1];
                float y = cy + (((i / 2) % 3) - 1) * 4f;
                int alpha = 58 + (int) (((i % 4 == 0) ? wave : flicker) * 118f);
                paint.setStrokeWidth((i % 4 == 0) ? 2.7f : 1.8f);
                paint.setColor(Color.argb(alpha, red, green, blue));
                canvas.drawLine(start, y, end, y, paint);
            }
            paint.setStrokeCap(Paint.Cap.ROUND);
        }

        private void drawScanLines(Canvas canvas, float cx, float cy, float beamHalf, int red, int green, int blue) {
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(1f);
            paint.setStrokeCap(Paint.Cap.BUTT);
            paint.setColor(Color.argb(18, red, green, blue));
            for (int i = -8; i <= 8; i++) {
                if (i == 0) {
                    continue;
                }
                float y = cy + i * 8f;
                float length = beamHalf * (0.34f + (8f - Math.abs(i)) * 0.045f);
                canvas.drawLine(cx - length, y, cx + length, y, paint);
            }
            paint.setStrokeCap(Paint.Cap.ROUND);
        }
    }

    private final class PuckyMascotView extends View {
        private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);

        private PuckyMascotView(Context context) {
            super(context);
            fill.setStyle(Paint.Style.FILL);
            stroke.setStyle(Paint.Style.STROKE);
            stroke.setStrokeWidth(4f);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float width = getWidth();
            float height = getHeight();
            float cx = width / 2f;
            float cy = height / 2f;
            float radius = Math.min(width, height) * 0.30f;
            int accent = coverColor("accent");
            fill.setColor(Color.argb(30, Color.red(accent), Color.green(accent), Color.blue(accent)));
            canvas.drawCircle(cx, cy, radius * 1.85f, fill);
            fill.setColor(Color.argb(52, Color.red(accent), Color.green(accent), Color.blue(accent)));
            canvas.drawCircle(cx, cy, radius * 1.28f, fill);
            stroke.setColor(accent);
            canvas.drawCircle(cx, cy, radius, stroke);
        }
    }

    private void applyForegroundBrightness(double value) {
        double clamped = Math.max(0.02d, Math.min(1.0d, value));
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.screenBrightness = (float) clamped;
        getWindow().setAttributes(params);
    }

    private String deviceSpecJson() {
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        JSONObject out = new JSONObject();
        try {
            out.put("schema", "pucky.android_device_spec.v1");
            out.put("manufacturer", Build.MANUFACTURER);
            out.put("model", Build.MODEL);
            out.put("device", Build.DEVICE);
            out.put("sdk_int", Build.VERSION.SDK_INT);
            out.put("package_name", getPackageName());
            out.put("screen_width_px", metrics.widthPixels);
            out.put("screen_height_px", metrics.heightPixels);
            out.put("density", metrics.density);
            out.put("density_dpi", metrics.densityDpi);
        } catch (JSONException e) {
            Log.e(TAG, "Failed to build device spec", e);
        }
        return out.toString();
    }

    private synchronized CommandRouter bridgeCommandRouter() {
        if (bridgeCommandRouter != null) {
            return bridgeCommandRouter;
        }
        CommandLogStore logStore = ((PuckyApplication) getApplication()).commandLogStore();
        PermissionReporter permissions = new PermissionReporter(this, settingsStore);
        CapabilityReporter capabilities = new CapabilityReporter(this, settingsStore, permissions);
        NativeCommandExecutor executor = new NativeCommandExecutor(
                new StatusProvider(this, settingsStore),
                new BatteryProvider(this),
                new NetworkProvider(this),
                new SensorController(this),
                new StorageProvider(this),
                new NotificationController(this),
                new AudioController(this),
                new ShellController(),
                new CameraController(this),
                new TimerController(this),
                logStore,
                capabilities,
                permissions,
                new PuckyUiController(this),
                new SystemController(this),
                new IntentController(this),
                new NoteController(this),
                new ArtifactController(this),
                new LocationController(this),
                new FileDownloadController(this),
                new MediaControlController(this),
                new MediaExportController(this),
                PlayerController.shared(this),
                buttonController == null ? new ButtonController(this) : buttonController,
                VoiceCaptureController.shared(this),
                NativeSpeechController.shared(this),
                WakeWordController.shared(this),
                new AppUpdateController(this),
                LiveKitController.shared(this, settingsStore),
                TunnelController.shared(this, settingsStore));
        bridgeCommandRouter = new CommandRouter(executor);
        return bridgeCommandRouter;
    }

    private boolean isTrustedBridgeCaller() {
        return PuckyWebBridgePolicy.isTrustedUrl(lastHomePortalUrl, projectVoxBaseUrl());
    }

    private String executeBridgeCommand(String raw) {
        long started = System.currentTimeMillis();
        try {
            if (!isTrustedBridgeCaller()) {
                return bridgeError("UNTRUSTED_ORIGIN", "Pucky bridge origin is not trusted", started).toString();
            }
            JSONObject input = new JSONObject(raw == null ? "{}" : raw);
            String type = input.optString("type", "").trim();
            if (type.isEmpty()) {
                return bridgeError("MALFORMED_COMMAND", "Bridge command requires type", started).toString();
            }
            JSONObject args = input.optJSONObject("args");
            if (args == null) {
                args = new JSONObject();
            } else {
                args = new JSONObject(args.toString());
            }
            if ("shell.exec".equals(type)) {
                PuckyWebBridgePolicy.boundShellArgs(args);
            }
            JSONObject command = new JSONObject();
            Json.put(command, "schema", "pucky.command.v1");
            Json.put(command, "id", input.optString("id", "ui_" + Long.toHexString(System.currentTimeMillis())));
            Json.put(command, "type", type);
            Json.put(command, "args", args);
            Json.put(command, "created_at", Instant.now().toString());
            Json.put(command, "ttl_ms", PuckyWebBridgePolicy.boundedTtlMs(input.optLong("ttl_ms", 30000L)));
            CommandHandlingResult handled = bridgeCommandRouter().handle(command.toString());
            JSONObject out = handled.toJson();
            Json.put(out, "schema", "pucky.bridge_execute_result.v1");
            Json.put(out, "duration_ms", System.currentTimeMillis() - started);
            Json.put(out, "trusted_url", lastHomePortalUrl);
            Log.i(TAG, "ui.bridge.execute type=" + type
                    + " status=" + handled.status()
                    + " duration_ms=" + (System.currentTimeMillis() - started));
            return out.toString();
        } catch (Exception exc) {
            Log.w(TAG, "ui.bridge.execute failed", exc);
            return bridgeError("EXECUTION_FAILED", exc.getMessage(), started).toString();
        }
    }

    private JSONObject bridgeError(String code, String message, long started) {
        JSONObject error = new JSONObject();
        Json.put(error, "code", code);
        Json.put(error, "message", message == null ? "" : message);
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.bridge_execute_result.v1");
        Json.put(out, "command_id", "unknown");
        Json.put(out, "type", "unknown");
        Json.put(out, "status", "failed");
        Json.put(out, "ack", JSONObject.NULL);
        Json.put(out, "result", JSONObject.NULL);
        Json.put(out, "error", error);
        Json.put(out, "duration_ms", System.currentTimeMillis() - started);
        Json.put(out, "trusted_url", lastHomePortalUrl);
        return out;
    }

    private final class PuckyAndroidBridge {
        @JavascriptInterface
        public void setBrightness(double value) {
            mainHandler.post(() -> applyForegroundBrightness(value));
        }

        @JavascriptInterface
        public String getDeviceSpec() {
            return deviceSpecJson();
        }

        @JavascriptInterface
        public String getState() {
            return buildCoverState().toString();
        }

        @JavascriptInterface
        public String execute(String commandJson) {
            return executeBridgeCommand(commandJson);
        }

        @JavascriptInterface
        public String reloadUi() {
            mainHandler.post(MainActivity.this::loadHomePortal);
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.bridge_reload_result.v1");
            Json.put(out, "ok", true);
            return out.toString();
        }

        @JavascriptInterface
        public String evalTest(String js) {
            if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) {
                return bridgeError("NOT_AVAILABLE", "evalTest is debug-only", System.currentTimeMillis()).toString();
            }
            if (!isTrustedBridgeCaller()) {
                return bridgeError("UNTRUSTED_ORIGIN", "Pucky bridge origin is not trusted", System.currentTimeMillis()).toString();
            }
            mainHandler.post(() -> {
                if (homeWebView != null) {
                    homeWebView.evaluateJavascript(js == null ? "" : js, null);
                }
            });
            JSONObject out = new JSONObject();
            Json.put(out, "schema", "pucky.bridge_eval_test_result.v1");
            Json.put(out, "ok", true);
            return out.toString();
        }
    }

    private void renderState() {
        if (statusText == null || stateText == null || buttonText == null) {
            return;
        }
        PuckyState snapshot = PuckyState.get();
        JSONObject state = snapshot.snapshotJson();
        String connection = state.optString("connection_state", "unknown");
        String service = state.optBoolean("service_running", false) ? "running" : "stopped";
        statusText.setText("Service " + service + " - " + connection);
        stateText.setText("Device: " + settingsStore.getDeviceId()
                + "\nBroker: " + compactBroker(settingsStore.getBrokerUrl())
                + "\nLiveKit: " + liveKitSummary()
                + "\nBattery: " + batterySummary()
                + "\nNetwork: " + networkSummary()
                + "\nWarnings: " + warningsSummary()
                + "\nLast command: " + state.optString("last_command_id", "none")
                + " / " + state.optString("last_command_status", "none"));
        buttonText.setText("Button: " + buttonSummary()
                + "\nVolume up: press changes volume; hold opens PTT mic; release mutes PTT mic"
                + "\nVolume down: press changes volume; hold pauses/resumes Vox reply audio");
    }

    private String compactBroker(String brokerUrl) {
        if (brokerUrl == null || brokerUrl.length() <= 42) {
            return brokerUrl == null ? "" : brokerUrl;
        }
        return brokerUrl.substring(0, 24) + "..." + brokerUrl.substring(brokerUrl.length() - 14);
    }

    private void handleLaunchIntent(Intent intent) {
        if (intent != null && intent.hasExtra("cover_mode")) {
            String mode = intent.getStringExtra("cover_mode");
            if (isKnownCoverMode(mode)) {
                coverSurfaceMode = mode;
                lastRenderedCoverMode = "";
                renderHome();
            }
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
                syncProvisioningFields();
                Toast.makeText(this, "Provisioning imported", Toast.LENGTH_SHORT).show();
            } catch (JSONException e) {
                Log.e(TAG, "Invalid provisioning_json", e);
                Toast.makeText(this, "Invalid provisioning JSON: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
        if (intent != null && intent.hasExtra("broker_url")) {
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
            syncProvisioningFields();
        }
        if (intent != null && intent.getBooleanExtra("connect", false)) {
            PuckyForegroundService.start(this, true);
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
        return null;
    }

    private boolean isKnownCoverMode(String mode) {
        return MODE_HOME.equals(mode)
                || MODE_APPS.equals(mode)
                || MODE_THREADS.equals(mode)
                || MODE_INBOX.equals(mode)
                || MODE_LISTENING.equals(mode)
                || MODE_SPEAKING.equals(mode)
                || MODE_THINKING.equals(mode)
                || MODE_FINALIZING.equals(mode);
    }

    private void ensureAutoConnectService() {
        if (settingsStore != null && settingsStore.isAutoConnectEnabled()) {
            PuckyForegroundService.start(this, true);
        }
    }

    private void syncProvisioningFields() {
        PuckyState.get().setDeviceId(settingsStore.getDeviceId());
        PuckyState.get().setBrokerUrl(settingsStore.getBrokerUrl());
        if (deviceIdInput != null && brokerUrlInput != null && tokenInput != null) {
            deviceIdInput.setText(settingsStore.getDeviceId());
            brokerUrlInput.setText(settingsStore.getBrokerUrl());
            tokenInput.setText(settingsStore.getToken());
        }
        renderCurrent();
    }

    private String batterySummary() {
        JSONObject battery = new BatteryProvider(this).read();
        if (!battery.optBoolean("available", false)) {
            return "unavailable";
        }
        Object percent = battery.opt("percent");
        String pct = percent == null || percent == JSONObject.NULL ? "unknown" : percent + "%";
        return pct + (battery.optBoolean("charging", false) ? " charging" : " discharging");
    }

    private String networkSummary() {
        JSONObject network = new NetworkProvider(this).read();
        if (!network.optBoolean("available", false)) {
            return "offline";
        }
        JSONArray transports = network.optJSONArray("transports");
        String transportText = transports == null || transports.length() == 0 ? "unknown" : join(transports);
        return transportText
                + (network.optBoolean("validated", false) ? " validated" : " unvalidated")
                + (network.optBoolean("metered", false) ? " metered" : "");
    }

    private String warningsSummary() {
        JSONArray warnings = new PermissionReporter(this, settingsStore).activeWarnings();
        if (warnings.length() == 0) {
            return "none";
        }
        return join(warnings);
    }

    private String buttonSummary() {
        JSONObject state = new ButtonController(this).state();
        JSONObject last = state.optJSONObject("last_event");
        if (last == null) {
            return "ready, no events";
        }
        return last.optString("gesture", "unknown")
                + " -> " + last.optString("mapped_action", "event_only")
                + " @ " + last.optString("timestamp", "unknown");
    }

    private String liveKitSummary() {
        JSONObject status = LiveKitController.shared(this, settingsStore).status();
        String state = status.optString("state", "unknown");
        return state + (status.optBoolean("mic_enabled", false) ? " mic on" : " mic muted");
    }

    private String join(JSONArray values) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < values.length(); i++) {
            if (i > 0) {
                out.append(", ");
            }
            out.append(values.optString(i));
        }
        return out.toString();
    }

    private void openHomeSettings() {
        Intent intent = new Intent(Settings.ACTION_HOME_SETTINGS);
        if (intent.resolveActivity(getPackageManager()) == null) {
            intent = new Intent(Settings.ACTION_SETTINGS);
        }
        startActivity(intent);
    }

    private void openAppSettings() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:" + getPackageName()));
        startActivity(intent);
    }
}
