package com.pucky.device;

import android.app.Application;
import android.util.Log;

import com.pucky.device.local.LocalControlServer;
import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.CommandLogStore;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.ui.PuckyHomeState;

public final class PuckyApplication extends Application {
    private static final String TAG = "PuckyApplication";

    private SettingsStore settingsStore;
    private CommandLogStore commandLogStore;
    private PuckyHomeState homeState;
    private LocalControlServer localControlServer;

    @Override
    public void onCreate() {
        super.onCreate();
        settingsStore = new SettingsStore(this);
        commandLogStore = new CommandLogStore(this);
        homeState = new PuckyHomeState();
        PuckyState.get().setDeviceId(settingsStore.getDeviceId());
        PuckyState.get().setBrokerUrl(settingsStore.getBrokerUrl());
        PuckyState.get().setPolicy(settingsStore.isAutoConnectEnabled(), settingsStore.isAutostartEnabled());
        startLocalControlServer();
    }

    public SettingsStore settingsStore() {
        return settingsStore;
    }

    public CommandLogStore commandLogStore() {
        return commandLogStore;
    }

    public PuckyHomeState homeState() {
        return homeState;
    }

    public LocalControlServer localControlServer() {
        return localControlServer;
    }

    private void startLocalControlServer() {
        localControlServer = new LocalControlServer(homeState);
        try {
            localControlServer.start();
            Log.i(TAG, "Local control server listening on 127.0.0.1:" + localControlServer.port());
        } catch (Exception e) {
            Log.e(TAG, "Failed to start local control server", e);
        }
    }
}
