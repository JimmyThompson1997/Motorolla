package com.pucky.device;

import android.app.Application;

import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.CommandLogStore;
import com.pucky.device.storage.SettingsStore;

public final class PuckyApplication extends Application {
    private SettingsStore settingsStore;
    private CommandLogStore commandLogStore;

    @Override
    public void onCreate() {
        super.onCreate();
        settingsStore = new SettingsStore(this);
        commandLogStore = new CommandLogStore(this);
        PuckyState.get().setDeviceId(settingsStore.getDeviceId());
        PuckyState.get().setBrokerUrl(settingsStore.getBrokerUrl());
        PuckyState.get().setPolicy(settingsStore.isAutoConnectEnabled(), settingsStore.isAutostartEnabled());
    }

    public SettingsStore settingsStore() {
        return settingsStore;
    }

    public CommandLogStore commandLogStore() {
        return commandLogStore;
    }
}
