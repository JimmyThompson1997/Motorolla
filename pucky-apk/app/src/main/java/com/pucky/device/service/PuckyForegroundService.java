package com.pucky.device.service;

import android.app.ActivityManager;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.ActivityOptions;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.Gravity;
import android.util.Log;
import android.view.Display;
import android.view.View;
import android.view.WindowManager;

import java.util.List;

import com.pucky.device.PuckyApplication;
import com.pucky.device.MainActivity;
import com.pucky.device.adb.RemoteAdbController;
import com.pucky.device.audio.AudioController;
import com.pucky.device.artifacts.ArtifactController;
import com.pucky.device.battery.BatteryProvider;
import com.pucky.device.buttons.ButtonController;
import com.pucky.device.broker.BrokerControlClient;
import com.pucky.device.camera.CameraController;
import com.pucky.device.capabilities.CapabilityReporter;
import com.pucky.device.capabilities.PermissionReporter;
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
import com.pucky.device.sensors.CoverGestureController;
import com.pucky.device.sensors.SensorController;
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
import com.pucky.device.updates.AppUpdateController;
import com.pucky.device.voice.VoiceCaptureController;
import com.pucky.device.wake.WakeWordController;

public final class PuckyForegroundService extends Service {
    private static final String TAG = "PuckyForegroundService";

    public static final String EXTRA_ACTION = "action";
    public static final String ACTION_START = "start";
    public static final String ACTION_CONNECT = "connect";
    public static final String ACTION_DISCONNECT = "disconnect";
    public static final String ACTION_STOP = "stop";
    public static final String ACTION_COVER_GESTURE_CONFIG = "cover_gesture_config";
    public static final String ACTION_COVER_GESTURE_SLEEP = "com.pucky.device.action.COVER_GESTURE_SLEEP";
    public static final String EXTRA_COVER_GESTURE_ENABLED = "cover_gesture_enabled";

    private static final int NOTIFICATION_ID = 41001;
    private static final int COVER_RESTORE_REQUEST_CODE = 41003;
    private static final int SERVICE_RESTART_REQUEST_CODE = 41004;
    private static final String CHANNEL_ID = "pucky_service";
    private static final long WATCHDOG_INITIAL_DELAY_MS = 30_000L;
    private static final long WATCHDOG_INTERVAL_MS = 120_000L;
    private static final long SELF_RESTART_DELAY_MS = 15_000L;
    private static final long KEEPALIVE_RESTART_DELAY_MS = 180_000L;
    private static final long COVER_RESTORE_DELAY_MS = 900L;
    private static final long COVER_RESTORE_DEBOUNCE_MS = 2_500L;
    private static final int RAZR_COVER_DISPLAY_ID = 1;

    private BrokerControlClient brokerClient;
    private TunnelController tunnelController;
    private ConnectivityManager.NetworkCallback networkCallback;
    private DisplayManager.DisplayListener coverDisplayListener;
    private Handler coverRestoreHandler;
    private Runnable pendingCoverRestore;
    private Handler watchdogHandler;
    private Runnable watchdogTask;
    private boolean manualStopRequested;
    private long lastCoverRestoreAtMs;
    private WindowManager coverSentinelWindowManager;
    private View coverSentinelView;
    private CoverGestureController coverGestureController;

    public static void start(Context context, boolean connect) {
        Intent intent = new Intent(context, PuckyForegroundService.class)
                .putExtra(EXTRA_ACTION, connect ? ACTION_CONNECT : ACTION_START);
        if (Build.VERSION.SDK_INT >= 26) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void disconnect(Context context) {
        Intent intent = new Intent(context, PuckyForegroundService.class)
                .putExtra(EXTRA_ACTION, ACTION_DISCONNECT);
        context.startService(intent);
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, PuckyForegroundService.class)
                .putExtra(EXTRA_ACTION, ACTION_STOP);
        context.startService(intent);
    }

    public static void configureCoverGesture(Context context, boolean enabled) {
        Intent intent = new Intent(context, PuckyForegroundService.class)
                .putExtra(EXTRA_ACTION, ACTION_COVER_GESTURE_CONFIG)
                .putExtra(EXTRA_COVER_GESTURE_ENABLED, enabled);
        if (Build.VERSION.SDK_INT >= 26) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        SettingsStore settings = ((PuckyApplication) getApplication()).settingsStore();
        tunnelController = TunnelController.shared(this, settings);
        PuckyState.get().setServiceRunning(true);
        PuckyState.get().setPolicy(settings.isAutoConnectEnabled(), settings.isAutostartEnabled());
        PuckyState.get().setLifecycleEvent("service.started");
        PuckyState.get().setConnectionState("service_running");
        PuckyState.get().broadcast(this);
        createChannel();
        startAsForegroundService();
        registerNetworkCallback();
        registerCoverDisplayListener();
        ensureCoverVisibilitySentinel("service_started");
        coverGestureController = new CoverGestureController(this, new CoverGestureController.Callback() {
            @Override
            public boolean isCoverDisplayAvailable() {
                return findCoverDisplayId() >= 0;
            }

            @Override
            public void onCoverGestureSleep(long durationMs) {
                handleCoverGestureSleep(durationMs);
            }

            @Override
            public void onCoverGestureWake(long durationMs) {
                handleCoverGestureWake(durationMs);
            }
        });
        coverGestureController.startIfEnabled();
        if (coverGestureController.isSleeping()) {
            removeCoverVisibilitySentinel();
        }
        startReconnectWatchdog();
        scheduleServiceRestart("service_keepalive_started", KEEPALIVE_RESTART_DELAY_MS);
        WakeWordController.shared(this).start(new org.json.JSONObject());
        ensureTunnelStarted("service_started");
        scheduleCoverRestore("service_started");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getStringExtra(EXTRA_ACTION);
        Log.i(TAG, "onStartCommand action=" + action);
        SettingsStore settings = ((PuckyApplication) getApplication()).settingsStore();
        PuckyState.get().setPolicy(settings.isAutoConnectEnabled(), settings.isAutostartEnabled());
        if (ACTION_STOP.equals(action)) {
            manualStopRequested = true;
            settings.setAutoConnectEnabled(false);
            PuckyState.get().setPolicy(settings.isAutoConnectEnabled(), settings.isAutostartEnabled());
            PuckyState.get().setLifecycleEvent("service.stop_requested");
            cancelServiceRestart();
            stopTunnel("service_stop");
            disconnectBroker();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_COVER_GESTURE_CONFIG.equals(action)) {
            boolean enabled = intent != null
                    && intent.getBooleanExtra(EXTRA_COVER_GESTURE_ENABLED, false);
            if (coverGestureController != null) {
                coverGestureController.setEnabled(enabled);
            }
            PuckyState.get().setLifecycleEvent("cover.gesture." + (enabled ? "enabled" : "disabled"));
            PuckyState.get().broadcast(this);
            return START_STICKY;
        }
        if (ACTION_DISCONNECT.equals(action)) {
            settings.setAutoConnectEnabled(false);
            PuckyState.get().setPolicy(settings.isAutoConnectEnabled(), settings.isAutostartEnabled());
            PuckyState.get().setLifecycleEvent("broker.manual_disconnect");
            disconnectBroker();
            return START_STICKY;
        }
        if (ACTION_CONNECT.equals(action)) {
            settings.setAutoConnectEnabled(true);
            settings.setAutostartEnabled(true);
            PuckyState.get().setPolicy(settings.isAutoConnectEnabled(), settings.isAutostartEnabled());
            PuckyState.get().setLifecycleEvent("broker.manual_connect");
            ensureTunnelStarted("connect_action");
            ensureBrokerConnected();
            scheduleCoverRestore("connect_action");
        } else if (settings.isAutoConnectEnabled()) {
            PuckyState.get().setLifecycleEvent("broker.auto_connect");
            ensureTunnelStarted("autoconnect_action");
            ensureBrokerConnected();
            scheduleCoverRestore("autoconnect_action");
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopReconnectWatchdog();
        if (coverGestureController != null) {
            coverGestureController.stop();
            coverGestureController = null;
        }
        unregisterCoverDisplayListener();
        WakeWordController.shared(this).stop(new org.json.JSONObject());
        stopTunnel("service_destroy");
        disconnectBroker();
        removeCoverVisibilitySentinel();
        unregisterNetworkCallback();
        PuckyState.get().setServiceRunning(false);
        PuckyState.get().setLifecycleEvent(manualStopRequested ? "service.stopped_manual" : "service.destroyed");
        PuckyState.get().setConnectionState(manualStopRequested ? "service_stopped" : "service_destroyed");
        PuckyState.get().broadcast(this);
        SettingsStore settings = ((PuckyApplication) getApplication()).settingsStore();
        if (!manualStopRequested && shouldKeepServiceRunning(settings)) {
            scheduleServiceRestart("service_destroyed", SELF_RESTART_DELAY_MS);
        } else {
            cancelServiceRestart();
        }
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        SettingsStore settings = ((PuckyApplication) getApplication()).settingsStore();
        PuckyState.get().setLifecycleEvent("service.task_removed");
        PuckyState.get().broadcast(this);
        if (!manualStopRequested && shouldKeepServiceRunning(settings)) {
            start(this, settings.isAutoConnectEnabled());
            scheduleCoverRestore("task_removed");
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private synchronized void connectBroker() {
        disconnectBroker();
        PuckyApplication app = (PuckyApplication) getApplication();
        SettingsStore settings = app.settingsStore();
        Log.i(TAG, "connectBroker url=" + settings.getBrokerUrl()
                + " device_id=" + settings.getDeviceId());
        CommandLogStore logStore = app.commandLogStore();
        PermissionReporter permissionReporter = new PermissionReporter(this, settings);
        CapabilityReporter capabilityReporter = new CapabilityReporter(this, settings, permissionReporter);
        NativeCommandExecutor executor = new NativeCommandExecutor(
                new StatusProvider(this, settings),
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
                capabilityReporter,
                permissionReporter,
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
                new ButtonController(this),
                VoiceCaptureController.shared(this),
                NativeSpeechController.shared(this),
                WakeWordController.shared(this),
                new AppUpdateController(this),
                LiveKitController.shared(this, settings),
                TunnelController.shared(this, settings),
                new RemoteAdbController(this, settings, TunnelController.shared(this, settings)),
                new AndroidSubstrateController(this));
        CommandRouter router = new CommandRouter(executor);
        brokerClient = new BrokerControlClient(this, settings, router, logStore);
        brokerClient.connect();
    }

    private synchronized void ensureBrokerConnected() {
        if (brokerClient != null) {
            Log.i(TAG, "broker client already exists; ensuring connection");
            brokerClient.ensureConnection();
            return;
        }
        connectBroker();
    }

    private synchronized void disconnectBroker() {
        if (brokerClient != null) {
            brokerClient.disconnect("local_disconnect");
            brokerClient = null;
        }
    }

    private void registerNetworkCallback() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null || networkCallback != null) {
            return;
        }
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                PuckyState.get().setLifecycleEvent("network.available");
                PuckyState.get().broadcast(PuckyForegroundService.this);
                ensureTunnelStarted("network_available");
                maybeAutoConnect("network_available");
            }

            @Override
            public void onLost(Network network) {
                PuckyState.get().setLifecycleEvent("network.lost");
                PuckyState.get().setConnectionState("network_lost");
                PuckyState.get().broadcast(PuckyForegroundService.this);
            }

            @Override
            public void onCapabilitiesChanged(Network network, NetworkCapabilities networkCapabilities) {
                PuckyState.get().setLifecycleEvent("network.changed");
                PuckyState.get().broadcast(PuckyForegroundService.this);
            }
        };
        manager.registerDefaultNetworkCallback(networkCallback);
    }

    private void unregisterNetworkCallback() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null || networkCallback == null) {
            return;
        }
        try {
            manager.unregisterNetworkCallback(networkCallback);
        } catch (RuntimeException ignored) {
            // Callback may already be unregistered during service teardown.
        }
        networkCallback = null;
    }

    private void registerCoverDisplayListener() {
        DisplayManager manager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        if (manager == null || coverDisplayListener != null) {
            return;
        }
        coverRestoreHandler = new Handler(Looper.getMainLooper());
        coverDisplayListener = new DisplayManager.DisplayListener() {
            @Override
            public void onDisplayAdded(int displayId) {
                if (displayId != Display.DEFAULT_DISPLAY) {
                    scheduleCoverRestore("display_added_" + displayId);
                }
            }

            @Override
            public void onDisplayChanged(int displayId) {
                if (displayId != Display.DEFAULT_DISPLAY) {
                    scheduleCoverRestore("display_changed_" + displayId);
                }
            }

            @Override
            public void onDisplayRemoved(int displayId) {
                if (displayId != Display.DEFAULT_DISPLAY) {
                    PuckyState.get().setLifecycleEvent("cover.display_removed_" + displayId);
                    PuckyState.get().broadcast(PuckyForegroundService.this);
                }
            }
        };
        manager.registerDisplayListener(coverDisplayListener, coverRestoreHandler);
    }

    private void unregisterCoverDisplayListener() {
        DisplayManager manager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        if (manager != null && coverDisplayListener != null) {
            try {
                manager.unregisterDisplayListener(coverDisplayListener);
            } catch (RuntimeException ignored) {
                // Display listener may already be gone during process teardown.
            }
        }
        if (coverRestoreHandler != null) {
            if (pendingCoverRestore != null) {
                coverRestoreHandler.removeCallbacks(pendingCoverRestore);
            }
        }
        pendingCoverRestore = null;
        coverDisplayListener = null;
        coverRestoreHandler = null;
    }

    private void startAsForegroundService() {
        Notification foregroundNotification = notification("Pucky service running");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                    NOTIFICATION_ID,
                    foregroundNotification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, foregroundNotification);
        }
    }

    private void maybeAutoConnect(String reason) {
        SettingsStore settings = ((PuckyApplication) getApplication()).settingsStore();
        PuckyState.get().setPolicy(settings.isAutoConnectEnabled(), settings.isAutostartEnabled());
        if (!settings.isAutoConnectEnabled()) {
            return;
        }
        Log.i(TAG, "auto-connect after " + reason);
        ensureTunnelStarted("broker_" + reason);
        ensureBrokerConnected();
        scheduleCoverRestore("autoconnect_" + reason);
    }

    private void ensureTunnelStarted(String reason) {
        if (tunnelController == null) {
            SettingsStore settings = ((PuckyApplication) getApplication()).settingsStore();
            tunnelController = TunnelController.shared(this, settings);
        }
        Log.i(TAG, "ensureTunnelStarted reason=" + reason);
        tunnelController.ensureStartedIfEnabled(reason);
    }

    private void stopTunnel(String reason) {
        if (tunnelController == null) {
            return;
        }
        org.json.JSONObject args = new org.json.JSONObject();
        com.pucky.device.util.Json.put(args, "reason", reason);
        tunnelController.stop(args);
    }

    private void scheduleCoverRestore(String reason) {
        scheduleCoverRestore(reason, COVER_RESTORE_DELAY_MS);
    }

    private void scheduleCoverRestore(String reason, long delayMs) {
        if (manualStopRequested) {
            return;
        }
        if (coverRestoreHandler == null) {
            coverRestoreHandler = new Handler(Looper.getMainLooper());
        }
        if (pendingCoverRestore != null) {
            coverRestoreHandler.removeCallbacks(pendingCoverRestore);
        }
        pendingCoverRestore = () -> maybeRestoreCoverActivity(reason);
        coverRestoreHandler.postDelayed(pendingCoverRestore, Math.max(0L, delayMs));
    }

    private void maybeRestoreCoverActivity(String reason) {
        if (coverGestureController != null && coverGestureController.isSleeping()) {
            Log.i(TAG, "cover restore skipped; gesture sleep active reason=" + reason);
            return;
        }
        int displayId = findCoverDisplayId();
        if (displayId < 0) {
            Log.i(TAG, "cover restore skipped; no non-default display reason=" + reason);
            return;
        }
        ensureCoverVisibilitySentinel("restore_" + reason, displayId);
        long now = SystemClock.elapsedRealtime();
        long elapsed = now - lastCoverRestoreAtMs;
        if (elapsed < COVER_RESTORE_DEBOUNCE_MS) {
            if (shouldRetryDebouncedRestore(reason)) {
                long retryDelayMs = COVER_RESTORE_DEBOUNCE_MS - elapsed + 150L;
                Log.i(TAG, "cover restore debounced reason=" + reason
                        + " retry_ms=" + retryDelayMs);
                scheduleCoverRestore(reason + "_debounce_retry", retryDelayMs);
            } else {
                Log.i(TAG, "cover restore debounced reason=" + reason
                        + " retry=false");
            }
            return;
        }
        lastCoverRestoreAtMs = now;
        try {
            PuckyApplication app = (PuckyApplication) getApplication();
            SettingsStore settings = app.settingsStore();
            Intent intent = new Intent(Intent.ACTION_MAIN)
                    .addCategory("android.intent.category.SECONDARY_HOME")
                    .setClass(this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_SINGLE_TOP
                            | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    .putExtra("broker_url", settings.getBrokerUrl())
                    .putExtra("device_id", settings.getDeviceId())
                    .putExtra("token", settings.getToken())
                    .putExtra("connect", settings.isAutoConnectEnabled());
            Bundle options = coverLaunchOptions(displayId, true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
                }
                PendingIntent pendingIntent = PendingIntent.getActivity(
                        this,
                        COVER_RESTORE_REQUEST_CODE,
                        intent,
                        pendingFlags);
                pendingIntent.send(this, 0, null, null, null, null, options);
                Log.i(TAG, "cover restore pending intent sent display=" + displayId
                        + " reason=" + reason);
            } else {
                startActivity(intent, options);
            }
            if (coverRestoreHandler != null) {
                coverRestoreHandler.postDelayed(
                        () -> moveExistingPuckyTaskToFront("post_start_" + reason, displayId),
                        350L);
            }
            PuckyState.get().setLifecycleEvent("cover.restored." + reason + ".display_" + displayId);
            PuckyState.get().broadcast(this);
            Log.i(TAG, "cover restore launched display=" + displayId + " reason=" + reason);
        } catch (Exception exc) {
            Log.w(TAG, "cover restore failed reason=" + reason, exc);
            PuckyState.get().setLifecycleEvent("cover.restore_failed");
            PuckyState.get().setLastError(exc.getClass().getSimpleName() + ": " + exc.getMessage());
            PuckyState.get().broadcast(this);
        }
    }

    private static Bundle coverLaunchOptions(int displayId, boolean forPendingIntent) {
        ActivityOptions options = ActivityOptions.makeBasic()
                .setLaunchDisplayId(displayId);
        if (forPendingIntent && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            options.setPendingIntentBackgroundActivityLaunchAllowed(true);
            options.setPendingIntentBackgroundActivityStartMode(
                    ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
        }
        return options.toBundle();
    }

    private static boolean shouldRetryDebouncedRestore(String reason) {
        if (reason == null || reason.endsWith("_debounce_retry")) {
            return false;
        }
        return reason.startsWith("display_")
                || reason.startsWith("task_removed")
                || reason.startsWith("service_started")
                || reason.startsWith("autoconnect_");
    }

    private void ensureCoverVisibilitySentinel(String reason) {
        int displayId = findCoverDisplayId();
        if (displayId >= 0) {
            ensureCoverVisibilitySentinel(reason, displayId);
        }
    }

    private void ensureCoverVisibilitySentinel(String reason, int displayId) {
        if (coverSentinelView != null) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Log.i(TAG, "cover sentinel skipped; overlay permission missing reason=" + reason);
            return;
        }
        DisplayManager displayManager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        Display display = displayManager == null ? null : displayManager.getDisplay(displayId);
        if (!isCoverDisplay(display)) {
            Log.i(TAG, "cover sentinel skipped; no cover display reason=" + reason
                    + " display=" + displayId);
            return;
        }
        try {
            Context displayContext = createDisplayContext(display);
            WindowManager windowManager = (WindowManager) displayContext.getSystemService(
                    Context.WINDOW_SERVICE);
            if (windowManager == null) {
                Log.i(TAG, "cover sentinel skipped; no window manager reason=" + reason);
                return;
            }
            View sentinel = new View(displayContext);
            sentinel.setBackgroundColor(0x01000000);
            WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                    1,
                    1,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    PixelFormat.TRANSLUCENT);
            params.gravity = Gravity.TOP | Gravity.LEFT;
            params.x = 0;
            params.y = 0;
            params.alpha = 0.05f;
            params.setTitle("PuckyCoverSentinel");
            windowManager.addView(sentinel, params);
            coverSentinelWindowManager = windowManager;
            coverSentinelView = sentinel;
            Log.i(TAG, "cover sentinel added display=" + displayId + " reason=" + reason);
        } catch (Exception exc) {
            Log.w(TAG, "cover sentinel failed reason=" + reason, exc);
        }
    }

    private void removeCoverVisibilitySentinel() {
        if (coverSentinelWindowManager == null || coverSentinelView == null) {
            coverSentinelWindowManager = null;
            coverSentinelView = null;
            return;
        }
        try {
            coverSentinelWindowManager.removeView(coverSentinelView);
        } catch (RuntimeException ignored) {
            // The system can detach the overlay during display teardown.
        }
        coverSentinelWindowManager = null;
        coverSentinelView = null;
    }

    private boolean moveExistingPuckyTaskToFront(String reason, int targetDisplayId) {
        try {
            ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (manager == null) {
                return false;
            }
            List<ActivityManager.AppTask> tasks = manager.getAppTasks();
            ComponentName main = new ComponentName(this, MainActivity.class);
            for (ActivityManager.AppTask task : tasks) {
                ActivityManager.RecentTaskInfo info = task.getTaskInfo();
                ComponentName base = info == null || info.baseIntent == null
                        ? null
                        : info.baseIntent.getComponent();
                ComponentName top = info == null ? null : info.topActivity;
                if (main.equals(base) || main.equals(top)) {
                    task.moveToFront();
                    PuckyState.get().setLifecycleEvent("cover.task_fronted." + reason);
                    PuckyState.get().broadcast(this);
                    Log.i(TAG, "cover restore moved existing task front target_display="
                            + targetDisplayId + " reason=" + reason);
                    return true;
                }
            }
        } catch (Exception exc) {
            Log.w(TAG, "cover task move failed reason=" + reason, exc);
            PuckyState.get().setLifecycleEvent("cover.task_front_failed");
            PuckyState.get().setLastError(exc.getClass().getSimpleName() + ": " + exc.getMessage());
            PuckyState.get().broadcast(this);
        }
        return false;
    }

    private int findCoverDisplayId() {
        DisplayManager manager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        if (manager == null) {
            return -1;
        }
        Display preferred = manager.getDisplay(RAZR_COVER_DISPLAY_ID);
        if (isCoverDisplay(preferred)) {
            logCoverDisplayCandidate("preferred", preferred);
            return preferred.getDisplayId();
        }
        Display[] displays = manager.getDisplays();
        for (Display display : displays) {
            if (isCoverDisplay(display)) {
                logCoverDisplayCandidate("listed", display);
                return display.getDisplayId();
            }
        }
        return -1;
    }

    private void logCoverDisplayCandidate(String source, Display display) {
        Log.i(TAG, "cover display selected source=" + source
                + " id=" + display.getDisplayId()
                + " state=" + displayStateName(display.getState())
                + " name=" + display.getName());
    }

    private static boolean isCoverDisplay(Display display) {
        return display != null
                && display.getDisplayId() != Display.DEFAULT_DISPLAY;
    }

    private static String displayStateName(int state) {
        switch (state) {
            case Display.STATE_OFF:
                return "OFF";
            case Display.STATE_ON:
                return "ON";
            case Display.STATE_DOZE:
                return "DOZE";
            case Display.STATE_DOZE_SUSPEND:
                return "DOZE_SUSPEND";
            case Display.STATE_VR:
                return "VR";
            case Display.STATE_ON_SUSPEND:
                return "ON_SUSPEND";
            default:
                return String.valueOf(state);
        }
    }

    private void handleCoverGestureSleep(long durationMs) {
        Handler handler = coverRestoreHandler;
        if (handler == null) {
            handler = new Handler(Looper.getMainLooper());
            coverRestoreHandler = handler;
        }
        handler.post(() -> {
            if (pendingCoverRestore != null && coverRestoreHandler != null) {
                coverRestoreHandler.removeCallbacks(pendingCoverRestore);
                pendingCoverRestore = null;
            }
            removeCoverVisibilitySentinel();
            Intent intent = new Intent(ACTION_COVER_GESTURE_SLEEP).setPackage(getPackageName());
            sendBroadcast(intent);
            PuckyState.get().setLifecycleEvent("cover.gesture.sleep." + durationMs + "ms");
            PuckyState.get().broadcast(this);
            Log.i(TAG, "cover gesture sleep duration_ms=" + durationMs);
        });
    }

    private void handleCoverGestureWake(long durationMs) {
        Handler handler = coverRestoreHandler;
        if (handler == null) {
            handler = new Handler(Looper.getMainLooper());
            coverRestoreHandler = handler;
        }
        handler.post(() -> {
            PuckyState.get().setLifecycleEvent("cover.gesture.wake." + durationMs + "ms");
            PuckyState.get().broadcast(this);
            scheduleCoverRestore("cover_gesture_wake", 0L);
            Log.i(TAG, "cover gesture wake duration_ms=" + durationMs);
        });
    }

    private void startReconnectWatchdog() {
        if (watchdogHandler != null) {
            return;
        }
        watchdogHandler = new Handler(Looper.getMainLooper());
        watchdogTask = new Runnable() {
            @Override
            public void run() {
                maybeAutoConnect("watchdog");
                scheduleServiceRestart("service_keepalive_watchdog", KEEPALIVE_RESTART_DELAY_MS);
                scheduleReconnectWatchdog(WATCHDOG_INTERVAL_MS);
            }
        };
        scheduleReconnectWatchdog(WATCHDOG_INITIAL_DELAY_MS);
    }

    private void scheduleReconnectWatchdog(long delayMs) {
        if (watchdogHandler == null || watchdogTask == null) {
            return;
        }
        watchdogHandler.removeCallbacks(watchdogTask);
        watchdogHandler.postDelayed(watchdogTask, delayMs);
    }

    private void stopReconnectWatchdog() {
        if (watchdogHandler != null && watchdogTask != null) {
            watchdogHandler.removeCallbacks(watchdogTask);
        }
        watchdogTask = null;
        watchdogHandler = null;
    }

    private void scheduleServiceRestart(String reason, long delayMs) {
        SettingsStore settings = ((PuckyApplication) getApplication()).settingsStore();
        if (!shouldKeepServiceRunning(settings)) {
            return;
        }
        AlarmManager alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return;
        }
        PendingIntent pendingIntent = serviceRestartIntent(reason);
        long triggerAtMs = SystemClock.elapsedRealtime() + Math.max(1_000L, delayMs);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setAndAllowWhileIdle(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    triggerAtMs,
                    pendingIntent);
        } else {
            alarmManager.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAtMs, pendingIntent);
        }
        Log.i(TAG, "service restart alarm scheduled reason=" + reason
                + " delay_ms=" + delayMs);
    }

    private void cancelServiceRestart() {
        AlarmManager alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return;
        }
        alarmManager.cancel(serviceRestartIntent("cancel"));
        Log.i(TAG, "service restart alarm canceled");
    }

    private PendingIntent serviceRestartIntent(String reason) {
        Intent intent = new Intent(this, PuckyBootReceiver.class)
                .setAction(PuckyBootReceiver.ACTION_RESTART_SERVICE)
                .putExtra("reason", reason == null ? "unknown" : reason);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(this, SERVICE_RESTART_REQUEST_CODE, intent, flags);
    }

    private static boolean shouldKeepServiceRunning(SettingsStore settings) {
        return settings.isAutostartEnabled()
                && (settings.isAutoConnectEnabled() || settings.isTunnelEnabled());
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Pucky service",
                NotificationManager.IMPORTANCE_LOW);
        channel.setSound(null, null);
        channel.enableVibration(false);
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.cancel(41002);
        manager.createNotificationChannel(channel);
        manager.deleteNotificationChannel("pucky_restore");
    }

    private Notification notification(String text) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        Intent openIntent = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent openPucky = PendingIntent.getActivity(this, 0, openIntent, pendingFlags);
        return builder
                .setContentTitle("Pucky")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentIntent(openPucky)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();
    }

}
