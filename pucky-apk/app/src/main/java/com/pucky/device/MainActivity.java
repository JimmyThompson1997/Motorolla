package com.pucky.device;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
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
import android.widget.FrameLayout;
import android.widget.Toast;

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
import com.pucky.device.host.NativeHostController;
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
    private static final int REQUEST_ALL_PERMISSIONS = 1001;
    private static final int REQUEST_ASSISTANT_SETUP_PERMISSIONS = 4206;
    private static final int REQUEST_ASSISTANT_ROLE = 4208;
    private static final int ASSISTANT_SETUP_NOTIFICATION_ID = 4207;
    private static final String ASSISTANT_SETUP_CHANNEL_ID = "pucky_assistant_setup";
    private static final String PORTAL_SCREEN_HOME = "home";
    private static final String PORTAL_SCREEN_ADMIN = "admin";
    private static final String PORTAL_SCREEN_ASSISTANT_SETUP = "assistant_setup";
    private static final String OFFLINE_PORTAL_URL = "file:///android_asset/pucky-offline.html";

    private WebView homeWebView;
    private SettingsStore settingsStore;
    private ButtonController buttonController;
    private CommandRouter bridgeCommandRouter;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private boolean homePortalLoadStarted;
    private boolean homePortalPageFinished;
    private boolean homePortalErrorVisible;
    private String lastHomePortalUrl = "";
    private String portalScreen = PORTAL_SCREEN_HOME;
    private boolean pendingAssistantSetupAfterPermission;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PuckyApplication app = (PuckyApplication) getApplication();
        settingsStore = app.settingsStore();
        buttonController = new ButtonController(this);
        configureApplianceWindow();
        portalScreen = portalScreenFromIntent(getIntent());
        setContentView(buildHomeView());
        applySystemUiForMode();
        handleLaunchIntent(getIntent());
        if (!isAssistantSetupPortal()) {
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
        if (shouldStartInAssistantSetup(intent)) {
            showAssistantSetupScreen();
        } else if (shouldStartInAdmin(intent)) {
            showAdminScreen();
        } else if (shouldStartInHome(intent)) {
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
        applySystemUiForMode();
        if (!isAssistantSetupPortal()) {
            ensureAutoConnectService();
            WakeWordController.shared(this).start(new JSONObject());
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
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (buttonController != null) {
            boolean handled = false;
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                handled = buttonController.handleKeyDown(event.getKeyCode(), event);
            } else if (event.getAction() == KeyEvent.ACTION_UP) {
                handled = buttonController.handleKeyUp(event.getKeyCode(), event);
            }
            if (handled) {
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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQUEST_ASSISTANT_ROLE) {
            Log.i(TAG, "assistant role request result=" + resultCode
                    + " status=" + PuckyAssistantController.status(this));
            showAssistantSetupNotification();
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            getWindow().setAttributes(params);
        }
    }

    private void applySystemUiForMode() {
        applyPortalEdgeToEdge();
    }

    private void schedulePortalEdgeToEdge() {
        mainHandler.postDelayed(() -> {
            if (PORTAL_SCREEN_HOME.equals(portalScreen) && homePortalPageFinished) {
                applySystemUiForMode();
            }
        }, 500);
    }

    private void applyPortalEdgeToEdge() {
        Window window = getWindow();
        View decorView = window.getDecorView();
        decorView.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = decorView.getWindowInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
            window.setDecorFitsSystemWindows(false);
        }
    }

    private View buildHomeView() {
        resetCoverRefs();
        lastHomePortalUrl = "";
        homePortalLoadStarted = false;
        homePortalPageFinished = false;

        FrameLayout root = new FrameLayout(this);
        root.setFitsSystemWindows(false);
        int backgroundColor = Color.rgb(2, 6, 10);
        root.setBackgroundColor(backgroundColor);

        homeWebView = new WebView(this);
        homeWebView.setFitsSystemWindows(false);
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
        settings.setAllowFileAccess(true);
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
                schedulePortalEdgeToEdge();
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
                        loadOfflinePortal(failingUrl, description);
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

    private void loadOfflinePortal(String failingUrl, String description) {
        if (homeWebView == null) {
            return;
        }
        String url = OFFLINE_PORTAL_URL
                + "?failed_url=" + Uri.encode(failingUrl == null ? homePortalUrl() : failingUrl)
                + "&error=" + Uri.encode(description == null ? "unknown" : description);
        lastHomePortalUrl = url;
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
                + "&token=" + Uri.encode(token == null ? "" : token)
                + "&screen=" + Uri.encode(portalScreen == null ? PORTAL_SCREEN_HOME : portalScreen);
    }

    private JSONObject buildNativeContext() {
        JSONObject liveKit = LiveKitController.shared(this, settingsStore).status();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.native_context.v1");
        Json.put(out, "device_id", settingsStore == null ? "" : settingsStore.getDeviceId());
        Json.put(out, "theme", "dark");

        JSONObject live = new JSONObject();
        Json.put(live, "state", liveKit.optString("state", "unknown"));
        Json.put(live, "connected", liveKit.optBoolean("connected", false));
        Json.put(live, "mic_enabled", liveKit.optBoolean("mic_enabled", false));
        Json.put(live, "room", liveKit.opt("room"));
        Json.put(live, "remote_audio_gain", liveKit.opt("remote_audio_gain"));
        Json.put(out, "livekit", live);
        return out;
    }

    private void showHomeScreen() {
        showPortalScreen(PORTAL_SCREEN_HOME);
    }

    private void showAdminScreen() {
        showPortalScreen(PORTAL_SCREEN_ADMIN);
    }

    private void showAssistantSetupScreen() {
        showPortalScreen(PORTAL_SCREEN_ASSISTANT_SETUP);
    }

    private void showPortalScreen(String screen) {
        portalScreen = knownPortalScreen(screen) ? screen : PORTAL_SCREEN_HOME;
        applySystemUiForMode();
        if (homeWebView == null || homePortalErrorVisible) {
            setContentView(buildHomeView());
        } else {
            loadHomePortal();
        }
    }

    private boolean shouldStartInAdmin(Intent intent) {
        return intent != null
                && intent.getBooleanExtra("admin", false);
    }

    private boolean shouldStartInHome(Intent intent) {
        if (intent == null) {
            return false;
        }
        if (intent.getBooleanExtra("home", false)) {
            return true;
        }
        boolean launcherIntent = Intent.ACTION_MAIN.equals(intent.getAction())
                && intent.hasCategory(Intent.CATEGORY_LAUNCHER);
        if (!launcherIntent) {
            return false;
        }
        return !intent.hasExtra("broker_url")
                && !intent.hasExtra("device_id")
                && !intent.hasExtra("token")
                && !intent.hasExtra("provisioning_json")
                && !intent.hasExtra("provisioning_json_base64")
                && !intent.getBooleanExtra("connect", false);
    }

    private boolean shouldStartInAssistantSetup(Intent intent) {
        if (intent == null) {
            return false;
        }
        return intent.getBooleanExtra("assistant_setup", false)
                || "com.pucky.device.action.ASSISTANT_SETUP".equals(intent.getAction());
    }

    private String portalScreenFromIntent(Intent intent) {
        if (shouldStartInAssistantSetup(intent)) {
            return PORTAL_SCREEN_ASSISTANT_SETUP;
        }
        if (shouldStartInAdmin(intent)) {
            return PORTAL_SCREEN_ADMIN;
        }
        return PORTAL_SCREEN_HOME;
    }

    private boolean knownPortalScreen(String screen) {
        return PORTAL_SCREEN_HOME.equals(screen)
                || PORTAL_SCREEN_ADMIN.equals(screen)
                || PORTAL_SCREEN_ASSISTANT_SETUP.equals(screen);
    }

    private boolean isAssistantSetupPortal() {
        return PORTAL_SCREEN_ASSISTANT_SETUP.equals(portalScreen);
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
                new NativeHostController(this),
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
            Log.i(TAG, "native.bridge.execute type=" + type
                    + " status=" + handled.status()
                    + " duration_ms=" + (System.currentTimeMillis() - started));
            return out.toString();
        } catch (Exception exc) {
            Log.w(TAG, "native.bridge.execute failed", exc);
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

    private JSONObject bridgeOk(String schema) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", schema);
        Json.put(out, "ok", true);
        return out;
    }

    private JSONObject untrustedBridgeResult() {
        return bridgeError(
                "UNTRUSTED_ORIGIN",
                "Pucky bridge origin is not trusted",
                System.currentTimeMillis());
    }

    private JSONObject buildAdminStatus() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.native_admin_status.v1");
        Json.put(out, "state", PuckyState.get().snapshotJson());
        JSONObject settings = new JSONObject();
        Json.put(settings, "device_id", settingsStore == null ? "" : settingsStore.getDeviceId());
        Json.put(settings, "broker_url", settingsStore == null ? "" : settingsStore.getBrokerUrl());
        Json.put(settings, "broker_url_compact", settingsStore == null ? "" : compactBroker(settingsStore.getBrokerUrl()));
        Json.put(settings, "token", settingsStore == null ? "" : settingsStore.getToken());
        Json.put(out, "settings", settings);
        JSONObject summary = new JSONObject();
        Json.put(summary, "livekit", liveKitSummary());
        Json.put(summary, "assistant", assistantSummary());
        Json.put(summary, "battery", batterySummary());
        Json.put(summary, "network", networkSummary());
        Json.put(summary, "warnings", warningsSummary());
        Json.put(summary, "button", buttonSummary());
        Json.put(out, "summary", summary);
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
        public String getAdminStatus() {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            return buildAdminStatus().toString();
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
        public String showPortalScreen(String screen) {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            mainHandler.post(() -> MainActivity.this.showPortalScreen(screen));
            return bridgeOk("pucky.bridge_show_portal_screen_result.v1").toString();
        }

        @JavascriptInterface
        public String requestPermissions() {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            mainHandler.post(MainActivity.this::requestNeededPermissions);
            return bridgeOk("pucky.bridge_permission_request_result.v1").toString();
        }

        @JavascriptInterface
        public String startAssistantSetup() {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            mainHandler.post(MainActivity.this::startAssistantSetupFlow);
            return bridgeOk("pucky.bridge_assistant_setup_result.v1").toString();
        }

        @JavascriptInterface
        public String openHomeSettings() {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            mainHandler.post(MainActivity.this::openHomeSettings);
            return bridgeOk("pucky.bridge_settings_result.v1").toString();
        }

        @JavascriptInterface
        public String openAppSettings() {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            mainHandler.post(MainActivity.this::openAppSettings);
            return bridgeOk("pucky.bridge_settings_result.v1").toString();
        }

        @JavascriptInterface
        public String openVoiceSettings() {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            mainHandler.post(MainActivity.this::openVoiceSettings);
            return bridgeOk("pucky.bridge_settings_result.v1").toString();
        }

        @JavascriptInterface
        public String openAssistantSettings() {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            mainHandler.post(() -> PuckyAssistantController.openAssistantSetup(MainActivity.this));
            return bridgeOk("pucky.bridge_settings_result.v1").toString();
        }

        @JavascriptInterface
        public String startService(boolean connect) {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            mainHandler.post(() -> PuckyForegroundService.start(MainActivity.this, connect));
            return bridgeOk("pucky.bridge_service_result.v1").toString();
        }

        @JavascriptInterface
        public String stopService() {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            mainHandler.post(() -> PuckyForegroundService.stop(MainActivity.this));
            return bridgeOk("pucky.bridge_service_result.v1").toString();
        }

        @JavascriptInterface
        public String disconnectService() {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            mainHandler.post(() -> PuckyForegroundService.disconnect(MainActivity.this));
            return bridgeOk("pucky.bridge_service_result.v1").toString();
        }

        @JavascriptInterface
        public String saveProvisioning(String deviceId, String brokerUrl, String token) {
            if (!isTrustedBridgeCaller()) {
                return untrustedBridgeResult().toString();
            }
            mainHandler.post(() -> {
                settingsStore.save(
                        deviceId == null ? "" : deviceId.trim(),
                        brokerUrl == null ? "" : brokerUrl.trim(),
                        token == null ? "" : token.trim());
                syncProvisioningFields();
                Toast.makeText(MainActivity.this, "Saved", Toast.LENGTH_SHORT).show();
            });
            return bridgeOk("pucky.bridge_provisioning_result.v1").toString();
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
            if (PuckyAssistantController.requestAssistantRole(this, REQUEST_ASSISTANT_ROLE)) {
                return;
            }
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
