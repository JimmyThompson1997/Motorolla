package com.pucky.device.adb;

import android.content.Context;

import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.tunnel.TunnelController;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.time.Instant;

public final class RemoteAdbController {
    private static final String SCHEMA_STATUS = "pucky.adb_remote_status.v1";
    private static final int DEFAULT_RECONNECT_WAIT_MS = 20000;
    private static final int DEFAULT_RECONNECT_POLL_MS = 1000;
    private static volatile String lastReconnectAttemptAt = "never";
    private static volatile String lastReconnectReason = "none";

    private final SettingsStore settingsStore;
    private final TunnelController tunnelController;

    public RemoteAdbController(Context context, SettingsStore settingsStore, TunnelController tunnelController) {
        this.settingsStore = settingsStore;
        this.tunnelController = tunnelController;
    }

    public JSONObject status(JSONObject args) {
        JSONObject safeArgs = args == null ? new JSONObject() : args;
        JSONObject service = PuckyState.get().snapshotJson();
        JSONObject tunnel = tunnelController.status();

        JSONObject out = new JSONObject();
        Json.put(out, "schema", SCHEMA_STATUS);
        Json.put(out, "checked_at", Instant.now().toString());
        Json.put(out, "verdict", verdict(service, tunnel));
        Json.put(out, "adb_transport", settingsStore.getAdbTransport());
        Json.put(out, "phone_adb_host", settingsStore.getTunnelPhoneAdbHost());
        Json.put(out, "phone_adb_port", settingsStore.getTunnelPhoneAdbPort());
        Json.put(out, "vm_adb_host", "127.0.0.1");
        Json.put(out, "vm_adb_port", settingsStore.getTunnelVmAdbPort());
        Json.put(out, "vm_adb_connect", "adb connect 127.0.0.1:" + settingsStore.getTunnelVmAdbPort());
        Json.put(out, "service", service);
        Json.put(out, "tunnel", tunnel);
        Json.put(out, "phone_socket_probe", skippedProbe());
        Json.put(out, "last_reconnect_attempt_at", lastReconnectAttemptAt);
        Json.put(out, "last_reconnect_reason", lastReconnectReason);
        Json.put(out, "notes", notes(tunnel));
        return out;
    }

    public JSONObject reconnect(JSONObject args) {
        JSONObject safeArgs = args == null ? new JSONObject() : args;
        lastReconnectAttemptAt = Instant.now().toString();
        lastReconnectReason = safeArgs.optString("reason", "adb_remote_reconnect");

        JSONObject stopArgs = new JSONObject();
        Json.put(stopArgs, "reason", lastReconnectReason + "_stop");
        tunnelController.stop(stopArgs);
        long stopWaitStarted = System.currentTimeMillis();
        long stopWaitMs = Math.max(0, Math.min(15000,
                safeArgs.optInt("stop_wait_ms", 5000)));
        long stopPollMs = Math.max(100, Math.min(1000,
                safeArgs.optInt("stop_poll_ms", 250)));
        while (tunnelController.status().optBoolean("worker_alive", false)
                && System.currentTimeMillis() - stopWaitStarted < stopWaitMs) {
            sleep(stopPollMs);
        }
        sleep(Math.max(0, Math.min(5000, safeArgs.optInt("settle_ms", 250))));

        JSONObject startArgs = new JSONObject();
        Json.put(startArgs, "reason", lastReconnectReason + "_start");
        tunnelController.start(startArgs);
        sleep(Math.max(0, Math.min(5000, safeArgs.optInt("post_start_probe_delay_ms", 1000))));

        long started = System.currentTimeMillis();
        long maxWaitMs = Math.max(0, Math.min(60000,
                safeArgs.optInt("reconnect_wait_ms", DEFAULT_RECONNECT_WAIT_MS)));
        long pollMs = Math.max(250, Math.min(5000,
                safeArgs.optInt("reconnect_poll_ms", DEFAULT_RECONNECT_POLL_MS)));
        JSONObject out = status(safeArgs);
        while ("waiting".equals(out.optString("verdict"))
                && System.currentTimeMillis() - started < maxWaitMs) {
            sleep(pollMs);
            out = status(safeArgs);
        }
        Json.put(out, "reconnect_requested", true);
        Json.put(out, "stop_waited_ms", System.currentTimeMillis() - stopWaitStarted);
        Json.put(out, "reconnect_waited_ms", System.currentTimeMillis() - started);
        return out;
    }

    private JSONObject skippedProbe() {
        JSONObject out = new JSONObject();
        Json.put(out, "ok", JSONObject.NULL);
        Json.put(out, "state", "not_probed");
        Json.put(out, "reason", "Raw TCP probes create stale offline ADB transports; use VM adb connect as the proof.");
        return out;
    }

    private String verdict(JSONObject service, JSONObject tunnel) {
        if (!service.optBoolean("service_running", false)) {
            return "waiting";
        }
        if (!tunnel.optBoolean("configured", false)) {
            return "misconfigured";
        }
        if (tunnel.optBoolean("connected", false)) {
            return "connected";
        }
        return "waiting";
    }

    private String notes(JSONObject tunnel) {
        if (!tunnel.optBoolean("configured", false)) {
            return "Pucky tunnel is missing host/user/key configuration.";
        }
        if (!tunnel.optBoolean("connected", false)) {
            return "Pucky is waiting for the reverse SSH tunnel to reconnect.";
        }
        return "Pucky tunnel is connected. Verify ADB from the VM with adb connect 127.0.0.1:"
                + settingsStore.getTunnelVmAdbPort() + ".";
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
        }
    }
}
