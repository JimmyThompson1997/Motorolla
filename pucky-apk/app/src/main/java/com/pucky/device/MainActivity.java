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
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

import com.pucky.device.assistant.PuckyAssistantController;
import com.pucky.device.buttons.ButtonController;
import com.pucky.device.player.PlayerController;
import com.pucky.device.service.PuckyForegroundService;
import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.tunnel.TunnelController;
import com.pucky.device.ui.PuckyWebBridge;
import com.pucky.device.ui.ReplyCardStore;
import com.pucky.device.ui.UiBundleController;
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

    private SettingsStore settingsStore;
    private ReplyCardStore replyCardStore;
    private UiBundleController uiBundleController;
    private ButtonController buttonController;
    private WebView webShell;
    private PuckyWebBridge webBridge;
    private boolean stateReceiverRegistered;
    private boolean screenReceiverRegistered;
    private boolean pendingAssistantSetupAfterPermission;
    private long wakeScreenUntilMs;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private final BroadcastReceiver stateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            emitWebPlayerState();
        }
    };

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent == null ? "" : intent.getAction();
            if (Intent.ACTION_SCREEN_ON.equals(action) || Intent.ACTION_SCREEN_OFF.equals(action)) {
                mainHandler.post(MainActivity.this::emitWebPlayerState);
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        PuckyApplication app = (PuckyApplication) getApplication();
        settingsStore = app.settingsStore();
        settingsStore.setUiShellMode("web_cached");
        replyCardStore = new ReplyCardStore(this);
        uiBundleController = new UiBundleController(this);
        buttonController = new ButtonController(this);
        configureApplianceWindow();
        setContentView(buildWebShellView());
        applySystemUiForMode();
        handleLaunchIntent(getIntent());
        requestNeededPermissions();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        configureApplianceWindow();
        handleLaunchIntent(intent);
        showHomeScreen();
        if (intent != null && "com.pucky.device.action.REQUEST_PERMISSIONS".equals(intent.getAction())) {
            requestNeededPermissions();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        configureApplianceWindow();
        registerStateReceivers();
        applySystemUiForMode();
        ensureAutoConnectService();
        WakeWordController.shared(this).start(new JSONObject());
        emitWebPlayerState();
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
        unregisterStateReceivers();
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
                emitWebPlayerState();
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onBackPressed() {
        if (webShell != null && webShell.canGoBack()) {
            webShell.goBack();
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

    private void registerStateReceivers() {
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
    }

    private void unregisterStateReceivers() {
        if (stateReceiverRegistered) {
            unregisterReceiver(stateReceiver);
            stateReceiverRegistered = false;
        }
        if (screenReceiverRegistered) {
            unregisterReceiver(screenReceiver);
            screenReceiverRegistered = false;
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

    private View buildWebShellView() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);

        webShell = new WebView(this);
        webShell.setBackgroundColor(BACKGROUND);
        webShell.setOverScrollMode(View.OVER_SCROLL_NEVER);
        configureWebShellSettings(webShell);
        webBridge = new PuckyWebBridge(this, webShell, replyCardStore, uiBundleController, settingsStore);
        webShell.addJavascriptInterface(webBridge, "PuckyAndroid");
        root.addView(webShell, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        loadWebShell();
        return root;
    }

    private void configureWebShellSettings(WebView webView) {
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
    }

    private void loadWebShell() {
        if (webShell != null && uiBundleController != null) {
            webShell.loadUrl(uiBundleController.entrypointUrl());
        }
    }

    private void showHomeScreen() {
        settingsStore.setUiShellMode("web_cached");
        if (webShell == null) {
            setContentView(buildWebShellView());
        } else {
            loadWebShell();
        }
        emitWebPlayerState();
    }

    private void emitWebPlayerState() {
        if (webBridge != null) {
            webBridge.emit("player.state", PlayerController.shared(this).state());
        }
    }

    private void handleLaunchIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        boolean uiSurfaceChanged = false;
        if (intent.hasExtra("ui_bundle_path")) {
            String bundlePath = intent.getStringExtra("ui_bundle_path");
            try {
                JSONObject args = new JSONObject();
                Json.put(args, "path", bundlePath);
                JSONObject result = uiBundleController.installDownloaded(args);
                Log.i(TAG, "Installed UI bundle from launch extra: "
                        + result.optString("ui_version", ""));
                uiSurfaceChanged = true;
            } catch (Exception exc) {
                Log.e(TAG, "Unable to install launch UI bundle", exc);
                PuckyState.get().setLastError("Unable to install UI bundle: " + exc.getMessage());
            }
        }
        if (intent.hasExtra("ui_shell_mode")) {
            settingsStore.setUiShellMode(intent.getStringExtra("ui_shell_mode"));
            Log.i(TAG, "Set UI shell mode from launch extra: " + settingsStore.getUiShellMode());
            uiSurfaceChanged = true;
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
        if (uiSurfaceChanged) {
            showHomeScreen();
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
        emitWebPlayerState();
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
