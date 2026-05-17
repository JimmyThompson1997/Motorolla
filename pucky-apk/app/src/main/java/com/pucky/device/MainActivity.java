package com.pucky.device;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.Display;
import android.view.HapticFeedbackConstants;
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

import com.pucky.device.adb.RemoteAdbController;
import com.pucky.device.artifacts.ArtifactController;
import com.pucky.device.assistant.PuckyAssistantController;
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
import com.pucky.device.substrate.AndroidSubstrateController;
import com.pucky.device.system.ShellController;
import com.pucky.device.system.SystemController;
import com.pucky.device.timers.TimerController;
import com.pucky.device.tunnel.TunnelController;
import com.pucky.device.ui.PuckyUiController;
import com.pucky.device.ui.PuckyWebBridgePolicy;
import com.pucky.device.updates.AppUpdateController;
import com.pucky.device.util.Json;
import com.pucky.device.voice.VoiceCaptureController;
import com.pucky.device.wake.WakeWordController;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class MainActivity extends Activity {
    private static final String TAG = "PuckyMainActivity";
    private static final String HOME_PORTAL_PATH = "/pucky-home";
    private static final String COVER_PREFS = "pucky_cover_ui";
    private static final String PREF_LIGHT_MODE = "light_mode";
    private static final int COVER_SAFE_RECT_WIDTH_PX = 992;
    private static final int COVER_SAFE_RECT_BOTTOM_PX = 102;
    private static final int REQUEST_ALL_PERMISSIONS = 1001;
    private static final int REQUEST_ASSISTANT_SETUP_PERMISSIONS = 4206;
    private static final int ASSISTANT_SETUP_NOTIFICATION_ID = 4207;
    private static final String ASSISTANT_SETUP_CHANNEL_ID = "pucky_assistant_setup";

    private TextView stateText;
    private TextView statusText;
    private TextView buttonText;
    private WebView homeWebView;
    private EditText deviceIdInput;
    private EditText brokerUrlInput;
    private EditText tokenInput;
    private SettingsStore settingsStore;
    private ButtonController buttonController;
    private CommandRouter bridgeCommandRouter;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean adminMode;
    private boolean homePortalLoadStarted;
    private boolean homePortalPageFinished;
    private boolean homePortalErrorVisible;
    private String lastHomePortalUrl = "";
    private boolean coverLightMode;
    private boolean screenReceiverRegistered;
    private boolean coverGestureReceiverRegistered;
    private boolean assistantSetupMode;
    private boolean pendingAssistantSetupAfterPermission;

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

    private final BroadcastReceiver coverGestureReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent == null ? "" : intent.getAction();
            if (PuckyForegroundService.ACTION_COVER_GESTURE_SLEEP.equals(action)) {
                mainHandler.post(MainActivity.this::hideCoverHomeForGestureSleep);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PuckyApplication app = (PuckyApplication) getApplication();
        settingsStore = app.settingsStore();
        buttonController = new ButtonController(this);
        configureApplianceWindow();
        assistantSetupMode = shouldStartInAssistantSetup(getIntent());
        adminMode = shouldStartInAdmin(getIntent());
        setContentView(assistantSetupMode ? buildAssistantSetupView() : adminMode ? buildAdminView() : buildHomeView());
        applySystemUiForMode();
        renderCurrent();
        handleLaunchIntent(getIntent());
        if (!assistantSetupMode) {
            requestNeededPermissions();
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
            requestPermissions(missing.toArray(new String[0]), REQUEST_ALL_PERMISSIONS);
        }
    }

    private void addMissingPermission(List<String> missing, String permission) {
        if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
            missing.add(permission);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (assistantSetupMode && !shouldStartInAssistantSetup(intent) && !shouldStartInAdmin(intent)) {
            Log.i(TAG, "ignoring non-setup launch while assistant setup is active");
            return;
        }
        if (shouldStartInAssistantSetup(intent)) {
            showAssistantSetupScreen();
        } else if (shouldStartInAdmin(intent)) {
            showAdminScreen();
        } else {
            showHomeScreen();
        }
        handleLaunchIntent(intent);
        if (intent != null && "com.pucky.device.action.REQUEST_PERMISSIONS".equals(intent.getAction())) {
            requestNeededPermissions();
        }
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
        IntentFilter coverGestureFilter = new IntentFilter(PuckyForegroundService.ACTION_COVER_GESTURE_SLEEP);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(coverGestureReceiver, coverGestureFilter, RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(coverGestureReceiver, coverGestureFilter);
        }
        coverGestureReceiverRegistered = true;
        applySystemUiForMode();
        if (!assistantSetupMode) {
            ensureAutoConnectService();
            WakeWordController.shared(this).start(new JSONObject());
        }
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
        unregisterReceiver(stateReceiver);
        if (screenReceiverRegistered) {
            unregisterReceiver(screenReceiver);
            screenReceiverRegistered = false;
        }
        if (coverGestureReceiverRegistered) {
            unregisterReceiver(coverGestureReceiver);
            coverGestureReceiverRegistered = false;
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

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_ASSISTANT_SETUP_PERMISSIONS && pendingAssistantSetupAfterPermission) {
            pendingAssistantSetupAfterPermission = false;
            mainHandler.post(this::continueAssistantSetupFlow);
        }
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

    private void hideCoverHomeForGestureSleep() {
        if (adminMode || assistantSetupMode) {
            return;
        }
        Display display = getDisplay();
        if (display == null || display.getDisplayId() == Display.DEFAULT_DISPLAY) {
            return;
        }
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        moveTaskToBack(true);
        Log.i(TAG, "cover home moved to back for gesture sleep");
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
        int backgroundColor = coverLightMode ? Color.rgb(247, 251, 255) : Color.rgb(2, 6, 10);
        root.setBackgroundColor(backgroundColor);

        homeWebView = new WebView(this);
        homeWebView.setBackgroundColor(backgroundColor);
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
                    mainHandler.post(() -> {
                        homePortalErrorVisible = true;
                        homePortalPageFinished = false;
                        homeWebView = null;
                        setContentView(buildPortalErrorView(failingUrl, description));
                    });
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

    private void loadHomePortal() {
        if (homeWebView == null) {
            return;
        }
        homePortalLoadStarted = true;
        homePortalErrorVisible = false;
        Log.i(TAG, "Loading Pucky portal width=" + homeWebView.getWidth()
                + " height=" + homeWebView.getHeight());
        String url = homePortalUrl();
        Log.i(TAG, "Opening Pucky portal url=" + url);
        homeWebView.loadUrl(url);
    }

    private String homePortalUrl() {
        String deviceId = settingsStore == null ? "" : settingsStore.getDeviceId();
        String base = projectVoxBaseUrl();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        String token = settingsStore == null ? "" : settingsStore.getToken();
        return base + HOME_PORTAL_PATH
                + "?device_id=" + Uri.encode(deviceId == null ? "" : deviceId)
                + "&token=" + Uri.encode(token == null ? "" : token);
    }

    private JSONObject buildNativeContext() {
        JSONObject liveKit = LiveKitController.shared(this, settingsStore).status();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.native_context.v1");
        Json.put(out, "device_id", settingsStore == null ? "" : settingsStore.getDeviceId());
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
        return out;
    }

    private ScrollView buildAdminView() {
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

        LinearLayout assistantActions = row();
        Button assistant = button("Assistant");
        assistant.setOnClickListener(v -> PuckyAssistantController.openAssistantSetup(this));
        assistantActions.addView(assistant, weightedButtonParams());
        Button voiceSettings = button("Voice settings");
        voiceSettings.setOnClickListener(v -> openVoiceSettings());
        assistantActions.addView(voiceSettings, weightedButtonParams());
        root.addView(assistantActions);

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

    private View buildAssistantSetupView() {
        resetCoverRefs();
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(48, 48, 48, 48);
        root.setBackgroundColor(Color.rgb(2, 6, 10));

        TextView prompt = new TextView(this);
        prompt.setText("Set Pucky as assistant?");
        prompt.setTextColor(Color.WHITE);
        prompt.setTextSize(30);
        prompt.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams promptParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
        promptParams.setMargins(0, 0, 0, 28);
        root.addView(prompt, promptParams);

        LinearLayout choices = new LinearLayout(this);
        choices.setOrientation(LinearLayout.HORIZONTAL);
        choices.setGravity(Gravity.CENTER);

        Button yes = approvalChoiceButton("Yes", true);
        yes.setOnClickListener(v -> {
            v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
            startAssistantSetupFlow();
        });
        choices.addView(yes, choiceButtonParams(0, 10));

        Button no = approvalChoiceButton("No", false);
        no.setOnClickListener(v -> {
            v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
            showHomeScreen();
        });
        choices.addView(no, choiceButtonParams(10, 0));

        root.addView(choices, fullWidthBlockParams());
        return root;
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

    private Button approvalChoiceButton(String text, boolean primary) {
        Button button = button(text);
        button.setAllCaps(false);
        button.setTextSize(24);
        button.setTextColor(primary ? Color.rgb(8, 13, 20) : Color.WHITE);
        button.setMinHeight(96);
        button.setPadding(16, 0, 16, 0);
        button.setBackground(approvalChoiceButtonBackground(primary));
        return button;
    }

    private LinearLayout.LayoutParams choiceButtonParams(int leftMargin, int rightMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                0,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                1f);
        params.setMargins(leftMargin, 0, rightMargin, 0);
        return params;
    }

    private GradientDrawable approvalChoiceButtonBackground(boolean primary) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(primary ? Color.rgb(238, 244, 250) : Color.rgb(17, 28, 39));
        drawable.setCornerRadius(34);
        drawable.setStroke(2, primary ? Color.rgb(255, 255, 255) : Color.rgb(82, 101, 120));
        return drawable;
    }

    private void showHomeScreen() {
        assistantSetupMode = false;
        if (!adminMode) {
            applySystemUiForMode();
            if (homeWebView == null || homePortalErrorVisible) {
                setContentView(buildHomeView());
            }
            renderHome();
            return;
        }
        adminMode = false;
        setContentView(buildHomeView());
        applySystemUiForMode();
        renderHome();
    }

    private void showAdminScreen() {
        assistantSetupMode = false;
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

    private void showAssistantSetupScreen() {
        assistantSetupMode = true;
        adminMode = false;
        Log.i(TAG, "showing assistant setup screen");
        setContentView(buildAssistantSetupView());
        applySystemUiForMode();
    }

    private boolean shouldStartInAdmin(Intent intent) {
        return intent != null
                && intent.getBooleanExtra("admin", false);
    }

    private boolean shouldStartInAssistantSetup(Intent intent) {
        if (intent == null) {
            return false;
        }
        return intent.getBooleanExtra("assistant_setup", false)
                || "com.pucky.device.action.ASSISTANT_SETUP".equals(intent.getAction());
    }

    private void renderCurrent() {
        if (assistantSetupMode) {
            return;
        }
        if (adminMode) {
            renderState();
        } else {
            renderHome();
        }
    }

    private void renderHome() {
        // The cover experience is rendered by the portal loaded in the WebView.
    }

    private void resetCoverRefs() {
        homeWebView = null;
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
                TunnelController.shared(this, settingsStore),
                new RemoteAdbController(this, settingsStore, TunnelController.shared(this, settingsStore)),
                new AndroidSubstrateController(this));
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
            return buildNativeContext().toString();
        }

        @JavascriptInterface
        public String getNativeContext() {
            return buildNativeContext().toString();
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
                + "\nAssistant: " + assistantSummary()
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
        if (shouldStartInAssistantSetup(intent)) {
            showAssistantSetupScreen();
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
        if (intent != null && intent.getBooleanExtra("connect", false) && !shouldStartInAssistantSetup(intent)) {
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

    private String assistantSummary() {
        JSONObject status = PuckyAssistantController.status(this);
        if (status.optBoolean("configured", false)) {
            return "Pucky default";
        }
        Object assistant = status.opt("assistant");
        String current = assistant == null || assistant == JSONObject.NULL ? "none" : assistant.toString();
        if (current.contains("googlequicksearchbox")) {
            return "Google/Gemini default";
        }
        return "not default (" + current + ")";
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

    private void openVoiceSettings() {
        Intent intent = new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS);
        if (intent.resolveActivity(getPackageManager()) == null) {
            intent = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
        }
        startActivity(intent);
    }
}
