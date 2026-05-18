package com.pucky.device.service;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

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
import com.pucky.device.command.CommandRouter;
import com.pucky.device.command.NativeCommandExecutor;
import com.pucky.device.files.FileDownloadController;
import com.pucky.device.host.NativeHostController;
import com.pucky.device.intents.IntentController;
import com.pucky.device.location.LocationController;
import com.pucky.device.livekit.LiveKitController;
import com.pucky.device.media.MediaControlController;
import com.pucky.device.media.MediaExportController;
import com.pucky.device.network.NetworkProvider;
import com.pucky.device.notes.NoteController;
import com.pucky.device.notifications.NotificationController;
import com.pucky.device.player.PlayerController;
import com.pucky.device.sensors.CoverWaveController;
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
    private static final String CHANNEL_ID = "pucky_service";
    private static final long WATCHDOG_INITIAL_DELAY_MS = 30_000L;
    private static final long WATCHDOG_INTERVAL_MS = 120_000L;

    private BrokerControlClient brokerClient;
    private TunnelController tunnelController;
    private CoverDisplayPresenter coverDisplayPresenter;
    private CoverWaveController coverWaveController;
    private final CoverWaveController.Callbacks coverWaveCallbacks =
            reason -> {
                if (coverDisplayPresenter != null) {
                    coverDisplayPresenter.armOnce("cover_wave_" + reason);
                }
            };
    private ConnectivityManager.NetworkCallback networkCallback;
    private Handler watchdogHandler;
    private Runnable watchdogTask;
    private boolean manualStopRequested;

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
        tunnelController = TunnelController.shared(this, settings);
        PuckyState.get().setServiceRunning(true);
        PuckyState.get().setPolicy(settings.isAutoConnectEnabled(), settings.isAutostartEnabled());
        PuckyState.get().setLifecycleEvent("service.started");
        PuckyState.get().setConnectionState("service_running");
        PuckyState.get().broadcast(this);
        createChannel();
        startAsForegroundService();
        coverDisplayPresenter = new CoverDisplayPresenter(this);
        coverDisplayPresenter.armOnce("service_started");
        coverWaveController = CoverWaveController.shared(this);
        coverWaveController.setCallbacks(coverWaveCallbacks);
        coverWaveController.start();
        registerNetworkCallback();
        startReconnectWatchdog();
        WakeWordController.shared(this).start(new org.json.JSONObject());
        ensureTunnelStarted("service_started");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getStringExtra(EXTRA_ACTION);
        Log.i(TAG, "onStartCommand action=" + action);
        if (coverDisplayPresenter != null) {
            coverDisplayPresenter.armOnce("start_command_" + action);
        }
        SettingsStore settings = ((PuckyApplication) getApplication()).settingsStore();
        PuckyState.get().setPolicy(settings.isAutoConnectEnabled(), settings.isAutostartEnabled());
        if (ACTION_STOP.equals(action)) {
            manualStopRequested = true;
            settings.setAutoConnectEnabled(false);
            PuckyState.get().setPolicy(settings.isAutoConnectEnabled(), settings.isAutostartEnabled());
            PuckyState.get().setLifecycleEvent("service.stop_requested");
            stopTunnel("service_stop");
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
            ensureTunnelStarted("connect_action");
            ensureBrokerConnected();
        } else if (settings.isAutoConnectEnabled()) {
            PuckyState.get().setLifecycleEvent("broker.auto_connect");
            ensureTunnelStarted("autoconnect_action");
            ensureBrokerConnected();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopReconnectWatchdog();
        if (coverDisplayPresenter != null) {
            coverDisplayPresenter.shutdown("service_destroy");
            coverDisplayPresenter = null;
        }
        if (coverWaveController != null) {
            coverWaveController.clearCallbacks(coverWaveCallbacks);
            coverWaveController.stop();
            coverWaveController = null;
        }
        WakeWordController.shared(this).stop(new org.json.JSONObject());
        stopTunnel("service_destroy");
        disconnectBroker();
        unregisterNetworkCallback();
        PuckyState.get().setServiceRunning(false);
        PuckyState.get().setLifecycleEvent(manualStopRequested ? "service.stopped_manual" : "service.destroyed");
        PuckyState.get().setConnectionState(manualStopRequested ? "service_stopped" : "service_destroyed");
        PuckyState.get().broadcast(this);
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        SettingsStore settings = ((PuckyApplication) getApplication()).settingsStore();
        PuckyState.get().setLifecycleEvent("service.task_removed");
        PuckyState.get().broadcast(this);
        if (!manualStopRequested && settings.isAutoConnectEnabled()) {
            start(this, true);
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
                new ButtonController(this),
                VoiceCaptureController.shared(this),
                NativeSpeechController.shared(this),
                CoverWaveController.shared(this),
                WakeWordController.shared(this),
                new AppUpdateController(this),
                LiveKitController.shared(this, settings),
                TunnelController.shared(this, settings),
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

    private void startReconnectWatchdog() {
        if (watchdogHandler != null) {
            return;
        }
        watchdogHandler = new Handler(Looper.getMainLooper());
        watchdogTask = new Runnable() {
            @Override
            public void run() {
                maybeAutoConnect("watchdog");
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
