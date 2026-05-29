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
import android.util.Log;
import android.view.Display;

import java.util.List;

import com.pucky.device.CoverHomeActivity;
import com.pucky.device.PuckyApplication;
import com.pucky.device.MainActivity;
import com.pucky.device.audio.AudioController;
import com.pucky.device.artifacts.ArtifactController;
import com.pucky.device.battery.BatteryProvider;
import com.pucky.device.buttons.ButtonController;
import com.pucky.device.broker.BrokerControlClient;
import com.pucky.device.camera.CameraController;
import com.pucky.device.capabilities.CapabilityReporter;
import com.pucky.device.capabilities.PermissionReporter;
import com.pucky.device.clipboard.PuckyClipboardController;
import com.pucky.device.command.CommandRouter;
import com.pucky.device.command.NativeCommandExecutor;
import com.pucky.device.command.PhoneDataController;
import com.pucky.device.files.FileDownloadController;
import com.pucky.device.intents.IntentController;
import com.pucky.device.location.LocationController;
import com.pucky.device.media.MediaControlController;
import com.pucky.device.media.MediaExportController;
import com.pucky.device.network.NetworkProvider;
import com.pucky.device.notes.NoteController;
import com.pucky.device.notifications.NotificationController;
import com.pucky.device.player.PlayerController;
import com.pucky.device.pucky.PuckyTurnController;
import com.pucky.device.sensors.CoverDisplayGestureController;
import com.pucky.device.sensors.SensorController;
import com.pucky.device.speech.NativeSpeechController;
import com.pucky.device.speech.PuckyRecipeController;
import com.pucky.device.speech.SpeechEchoController;
import com.pucky.device.speech.SpeechEchoLabController;
import com.pucky.device.state.PuckyState;
import com.pucky.device.status.StatusProvider;
import com.pucky.device.storage.CommandLogStore;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.storage.StorageProvider;
import com.pucky.device.substrate.AndroidSubstrateController;
import com.pucky.device.system.ShellController;
import com.pucky.device.system.SystemController;
import com.pucky.device.timers.TimerController;
import com.pucky.device.ui.PuckyUiController;
import com.pucky.device.ui.UiBundleController;
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

    private static final int NOTIFICATION_ID = 41001;
    private static final int COVER_RESTORE_REQUEST_CODE = 41003;
    private static final int SERVICE_RESTART_REQUEST_CODE = 41004;
    private static final String CHANNEL_ID = "pucky_service";
    private static final long WATCHDOG_INITIAL_DELAY_MS = 30_000L;
    private static final long WATCHDOG_INTERVAL_MS = 120_000L;
    private static final long SELF_RESTART_DELAY_MS = 15_000L;
    private static final long KEEPALIVE_RESTART_DELAY_MS = 180_000L;
    private static final long COVER_WAKE_RESTORE_DELAY_MS = 250L;
    private static final int RAZR_COVER_DISPLAY_ID = 1;

    private BrokerControlClient brokerClient;
    private ConnectivityManager.NetworkCallback networkCallback;
    private DisplayManager.DisplayListener coverDisplayListener;
    private Handler coverRestoreHandler;
    private Runnable pendingCoverRestore;
    private Handler watchdogHandler;
    private Runnable watchdogTask;
    private boolean manualStopRequested;
    private int lastCoverDisplayState = Display.STATE_UNKNOWN;
    private CoverDisplayGestureController coverDisplayGestureController;

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

    @Override
    public void onCreate() {
        super.onCreate();
        SettingsStore settings = ((PuckyApplication) getApplication()).settingsStore();
        PuckyState.get().setServiceRunning(true);
        PuckyState.get().setPolicy(settings.isAutoConnectEnabled(), settings.isAutostartEnabled());
        PuckyState.get().setLifecycleEvent("service.started");
        PuckyState.get().setConnectionState("service_running");
        PuckyState.get().broadcast(this);
        createChannel();
        startAsForegroundService();
        registerNetworkCallback();
        registerCoverDisplayListener();
        coverDisplayGestureController = CoverDisplayGestureController.shared(this);
        coverDisplayGestureController.start();
        startReconnectWatchdog();
        scheduleServiceRestart("service_keepalive_started", KEEPALIVE_RESTART_DELAY_MS);
        WakeWordController.shared(this).onServiceStarted();
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
            disconnectBroker();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
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
            ensureBrokerConnected();
        } else if (settings.isAutoConnectEnabled()) {
            PuckyState.get().setLifecycleEvent("broker.auto_connect");
            ensureBrokerConnected();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopReconnectWatchdog();
        if (coverDisplayGestureController != null) {
            coverDisplayGestureController.stop();
            coverDisplayGestureController = null;
        }
        unregisterCoverDisplayListener();
        WakeWordController.shared(this).onServiceStopped();
        disconnectBroker();
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
        AndroidSubstrateController substrateController = new AndroidSubstrateController(this);
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
                new UiBundleController(this),
                settings,
                new SystemController(this),
                new IntentController(this),
                new NoteController(this),
                new ArtifactController(this),
                PuckyClipboardController.shared(this),
                new LocationController(this),
                new FileDownloadController(this),
                new MediaControlController(this),
                new MediaExportController(this),
                PlayerController.shared(this),
                new ButtonController(this),
                VoiceCaptureController.shared(this),
                NativeSpeechController.shared(this),
                SpeechEchoController.shared(this),
                SpeechEchoLabController.shared(this),
                PuckyRecipeController.shared(this),
                WakeWordController.shared(this),
                new AppUpdateController(this),
                substrateController,
                new PhoneDataController(this, settings, substrateController),
                PuckyTurnController.shared(this));
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
                    handleCoverDisplayChanged(displayId, "display_added_" + displayId);
                }
            }

            @Override
            public void onDisplayChanged(int displayId) {
                if (displayId != Display.DEFAULT_DISPLAY) {
                    handleCoverDisplayChanged(displayId, "display_changed_" + displayId);
                }
            }

            @Override
            public void onDisplayRemoved(int displayId) {
                if (displayId != Display.DEFAULT_DISPLAY) {
                    lastCoverDisplayState = Display.STATE_UNKNOWN;
                    PuckyState.get().setLifecycleEvent("cover.display_removed_" + displayId);
                    PuckyState.get().broadcast(PuckyForegroundService.this);
                }
            }
        };
        manager.registerDisplayListener(coverDisplayListener, coverRestoreHandler);
        int displayId = findCoverDisplayId();
        lastCoverDisplayState = displayId < 0 ? Display.STATE_UNKNOWN : readDisplayState(displayId);
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
        ensureBrokerConnected();
    }

    private void handleCoverDisplayChanged(int displayId, String reason) {
        DisplayManager manager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        Display display = manager == null ? null : manager.getDisplay(displayId);
        if (!isCoverDisplay(display)) {
            return;
        }
        int previous = lastCoverDisplayState;
        int current = display.getState();
        lastCoverDisplayState = current;
        if (current == Display.STATE_ON && previous != Display.STATE_ON) {
            scheduleCoverWakeRestore(reason, COVER_WAKE_RESTORE_DELAY_MS);
            return;
        }
        Log.i(TAG, "cover restore skipped state transition reason=" + reason
                + " previous=" + displayStateName(previous)
                + " current=" + displayStateName(current));
    }

    private void scheduleCoverWakeRestore(String reason, long delayMs) {
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
        int displayId = findCoverDisplayId();
        if (displayId < 0) {
            Log.i(TAG, "cover restore skipped; no non-default display reason=" + reason);
            return;
        }
        int state = readDisplayState(displayId);
        if (state != Display.STATE_ON) {
            Log.i(TAG, "cover restore skipped; display not on reason=" + reason
                    + " state=" + displayStateName(state));
            return;
        }
        try {
            PuckyApplication app = (PuckyApplication) getApplication();
            SettingsStore settings = app.settingsStore();
            Intent intent = new Intent(Intent.ACTION_MAIN)
                    .addCategory("android.intent.category.SECONDARY_HOME")
                    .setClass(this, CoverHomeActivity.class)
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

    private boolean moveExistingPuckyTaskToFront(String reason, int targetDisplayId) {
        try {
            ActivityManager manager = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (manager == null) {
                return false;
            }
            List<ActivityManager.AppTask> tasks = manager.getAppTasks();
            ComponentName coverHome = new ComponentName(this, CoverHomeActivity.class);
            for (ActivityManager.AppTask task : tasks) {
                ActivityManager.RecentTaskInfo info = task.getTaskInfo();
                ComponentName base = info == null || info.baseIntent == null
                        ? null
                        : info.baseIntent.getComponent();
                ComponentName top = info == null ? null : info.topActivity;
                if (!coverHome.equals(base) && !coverHome.equals(top)) {
                    continue;
                }
                if (!isValidCoverHomeTask(info, targetDisplayId)) {
                    Log.i(TAG, "cover restore skipped non-cover task base=" + base
                            + " top=" + top
                            + " task_display=" + taskDisplayId(info)
                            + " target_display=" + targetDisplayId
                            + " reason=" + reason);
                    continue;
                }
                task.moveToFront();
                PuckyState.get().setLifecycleEvent("cover.task_fronted." + reason);
                PuckyState.get().broadcast(this);
                Log.i(TAG, "cover restore moved existing cover task front target_display="
                        + targetDisplayId + " reason=" + reason);
                return true;
            }
        } catch (Exception exc) {
            Log.w(TAG, "cover task move failed reason=" + reason, exc);
            PuckyState.get().setLifecycleEvent("cover.task_front_failed");
            PuckyState.get().setLastError(exc.getClass().getSimpleName() + ": " + exc.getMessage());
            PuckyState.get().broadcast(this);
        }
        return false;
    }

    private static boolean isValidCoverHomeTask(
            ActivityManager.RecentTaskInfo info,
            int targetDisplayId) {
        if (info == null || info.baseIntent == null) {
            return false;
        }
        int taskDisplayId = taskDisplayId(info);
        if (taskDisplayId >= 0 && taskDisplayId != targetDisplayId) {
            return false;
        }
        if (info.baseIntent.hasCategory(Intent.CATEGORY_LAUNCHER)) {
            return false;
        }
        return info.baseIntent.hasCategory("android.intent.category.SECONDARY_HOME");
    }

    private static int taskDisplayId(ActivityManager.RecentTaskInfo info) {
        if (info == null) {
            return -1;
        }
        try {
            Object value = info.getClass().getField("displayId").get(info);
            return value instanceof Integer ? (Integer) value : -1;
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            return -1;
        }
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

    private int readDisplayState(int displayId) {
        DisplayManager manager = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
        Display display = manager == null ? null : manager.getDisplay(displayId);
        return display == null ? Display.STATE_UNKNOWN : display.getState();
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
        return settings.isAutostartEnabled() && settings.isAutoConnectEnabled();
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
