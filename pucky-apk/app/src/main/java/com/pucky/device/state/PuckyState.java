package com.pucky.device.state;

import android.content.Context;
import android.content.Intent;

import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.time.Instant;

public final class PuckyState {
    public static final String ACTION_CHANGED = "com.pucky.device.STATE_CHANGED";
    private static final PuckyState INSTANCE = new PuckyState();

    private String deviceId = "unknown";
    private String brokerUrl = "";
    private String connectionState = "idle";
    private String lastHeartbeat = "never";
    private String lastCommandId = "none";
    private String lastCommandStatus = "none";
    private String lastError = "none";
    private boolean serviceRunning;
    private boolean autoConnectEnabled;
    private boolean autostartEnabled;
    private String lastLifecycleEvent = "none";
    private String serviceStartedAt = "never";
    private String tunnelState = "idle";
    private String tunnelLastError = "none";

    private PuckyState() {
    }

    public static PuckyState get() {
        return INSTANCE;
    }

    public synchronized void setDeviceId(String deviceId) {
        this.deviceId = nonEmpty(deviceId, "unknown");
    }

    public synchronized void setBrokerUrl(String brokerUrl) {
        this.brokerUrl = nonEmpty(brokerUrl, "");
    }

    public synchronized void setServiceRunning(boolean serviceRunning) {
        this.serviceRunning = serviceRunning;
        if (serviceRunning) {
            this.serviceStartedAt = Instant.now().toString();
        }
    }

    public synchronized void setPolicy(boolean autoConnectEnabled, boolean autostartEnabled) {
        this.autoConnectEnabled = autoConnectEnabled;
        this.autostartEnabled = autostartEnabled;
    }

    public synchronized void setLifecycleEvent(String event) {
        this.lastLifecycleEvent = nonEmpty(event, "unknown") + "@" + Instant.now().toString();
    }

    public synchronized void setConnectionState(String connectionState) {
        this.connectionState = nonEmpty(connectionState, "unknown");
    }

    public synchronized void markHeartbeat() {
        this.lastHeartbeat = Instant.now().toString();
    }

    public synchronized void setLastCommand(String commandId, String status) {
        this.lastCommandId = nonEmpty(commandId, "unknown");
        this.lastCommandStatus = nonEmpty(status, "unknown");
    }

    public synchronized void setLastError(String lastError) {
        this.lastError = nonEmpty(lastError, "none");
    }

    public synchronized void setTunnelState(String tunnelState, String tunnelLastError) {
        this.tunnelState = nonEmpty(tunnelState, "unknown");
        this.tunnelLastError = nonEmpty(tunnelLastError, "none");
    }

    public synchronized String dashboardText() {
        return "Service: " + (serviceRunning ? "running" : "stopped")
                + "\nConnection: " + connectionState
                + "\nDevice ID: " + deviceId
                + "\nBroker: " + brokerUrl
                + "\nLast heartbeat: " + lastHeartbeat
                + "\nLast command: " + lastCommandId
                + "\nLast command status: " + lastCommandStatus
                + "\nLast error: " + lastError
                + "\nAuto-connect: " + autoConnectEnabled
                + "\nAutostart: " + autostartEnabled
                + "\nTunnel: " + tunnelState
                + "\nTunnel error: " + tunnelLastError
                + "\nLast lifecycle: " + lastLifecycleEvent;
    }

    public synchronized JSONObject snapshotJson() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.ui_state.v1");
        Json.put(out, "service_running", serviceRunning);
        Json.put(out, "connection_state", connectionState);
        Json.put(out, "device_id", deviceId);
        Json.put(out, "broker_url", brokerUrl);
        Json.put(out, "last_heartbeat", lastHeartbeat);
        Json.put(out, "last_command_id", lastCommandId);
        Json.put(out, "last_command_status", lastCommandStatus);
        Json.put(out, "last_error", lastError);
        Json.put(out, "auto_connect_enabled", autoConnectEnabled);
        Json.put(out, "autostart_enabled", autostartEnabled);
        Json.put(out, "tunnel_state", tunnelState);
        Json.put(out, "tunnel_last_error", tunnelLastError);
        Json.put(out, "last_lifecycle_event", lastLifecycleEvent);
        Json.put(out, "service_started_at", serviceStartedAt);
        Json.put(out, "dashboard_text", dashboardText());
        return out;
    }

    public synchronized void broadcast(Context context) {
        context.sendBroadcast(new Intent(ACTION_CHANGED).setPackage(context.getPackageName()));
    }

    private static String nonEmpty(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value;
    }
}
