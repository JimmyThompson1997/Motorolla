package com.pucky.device.tunnel;

import android.content.Context;
import android.util.Log;

import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

public final class TunnelController {
    private static final String TAG = "PuckyTunnel";
    private static final String SCHEMA_STATUS = "pucky.tunnel_status.v1";
    private static volatile TunnelController instance;

    private final Context context;
    private final SettingsStore settingsStore;
    private final Object lock = new Object();

    private Session session;
    private Thread worker;
    private boolean stopRequested = true;
    private String state = "idle";
    private String lastError = "none";
    private String lastStartReason = "none";
    private String connectedAt = "never";
    private int assignedRemoteAdbPort = -1;

    private TunnelController(Context context, SettingsStore settingsStore) {
        this.context = context.getApplicationContext();
        this.settingsStore = settingsStore;
    }

    public static TunnelController shared(Context context, SettingsStore settingsStore) {
        TunnelController current = instance;
        if (current != null) {
            return current;
        }
        synchronized (TunnelController.class) {
            if (instance == null) {
                instance = new TunnelController(context, settingsStore);
            }
            return instance;
        }
    }

    public JSONObject configure(JSONObject args) {
        applyConfigArgs(args == null ? new JSONObject() : args);
        if (args != null && args.optBoolean("restart", false)) {
            stopInternal("config_restart");
            startInternal(args.optString("reason", "config_restart"));
        } else if (args != null && args.optBoolean("start", false)) {
            startInternal(args.optString("reason", "config_start"));
        }
        JSONObject out = status();
        Json.put(out, "schema", "pucky.tunnel_config_result.v1");
        return out;
    }

    public JSONObject start(JSONObject args) {
        JSONObject safeArgs = args == null ? new JSONObject() : args;
        applyConfigArgs(safeArgs);
        startInternal(safeArgs.optString("reason", "command_start"));
        return status();
    }

    public JSONObject stop(JSONObject args) {
        String reason = args == null ? "command_stop" : args.optString("reason", "command_stop");
        stopInternal(reason);
        return status();
    }

    public void ensureStartedIfEnabled(String reason) {
        if (!settingsStore.isTunnelEnabled()) {
            Log.i(TAG, "Tunnel autostart disabled reason=" + reason);
            return;
        }
        Log.i(TAG, "Tunnel autostart requested reason=" + reason
                + " host=" + settingsStore.getTunnelHost()
                + " port=" + settingsStore.getTunnelPort()
                + " tls=" + settingsStore.isTunnelTlsEnabled());
        try {
            startInternal(reason);
        } catch (RuntimeException exc) {
            Log.w(TAG, "Tunnel autostart skipped", exc);
            setState("autostart_failed", exc.getMessage());
        }
    }

    public JSONObject status() {
        JSONObject out = new JSONObject();
        synchronized (lock) {
            boolean connected = session != null && session.isConnected();
            boolean threadAlive = worker != null && worker.isAlive();
            Json.put(out, "schema", SCHEMA_STATUS);
            Json.put(out, "state", connected ? "connected" : state);
            Json.put(out, "enabled", settingsStore.isTunnelEnabled());
            Json.put(out, "configured", settingsStore.hasTunnelConfig());
            Json.put(out, "connected", connected);
            Json.put(out, "worker_alive", threadAlive);
            Json.put(out, "last_error", lastError);
            Json.put(out, "last_start_reason", lastStartReason);
            Json.put(out, "connected_at", connectedAt);
            Json.put(out, "has_private_key", privateKeyFile().exists());
            Json.put(out, "has_known_hosts", knownHostsFile().exists());
            Json.put(out, "assigned_remote_adb_port", assignedRemoteAdbPort < 0
                    ? JSONObject.NULL
                    : assignedRemoteAdbPort);
            Json.put(out, "assigned_vm_adb_port", assignedRemoteAdbPort < 0
                    ? JSONObject.NULL
                    : assignedRemoteAdbPort);
            Json.put(out, "settings", settingsStore.tunnelSettingsJson());
            Json.put(out, "vm_adb_connect", assignedRemoteAdbPort < 0
                    ? JSONObject.NULL
                    : "adb connect 127.0.0.1:" + assignedRemoteAdbPort);
        }
        return out;
    }

    private void applyConfigArgs(JSONObject args) {
        if (args == null) {
            return;
        }
        settingsStore.saveTunnelSettings(args);
        if (args.optBoolean("clear_private_key", false)) {
            deleteQuietly(privateKeyFile());
        }
        if (args.optBoolean("clear_known_hosts", false)) {
            deleteQuietly(knownHostsFile());
        }
        writeSecretIfPresent(args, "private_key", privateKeyFile());
        writeSecretIfPresent(args, "known_hosts", knownHostsFile());
    }

    private void startInternal(String reason) {
        if (!settingsStore.isTunnelEnabled()) {
            throw new IllegalStateException("Tunnel is disabled. Set enabled=true before starting.");
        }
        if (!settingsStore.hasTunnelConfig()) {
            throw new IllegalStateException("Tunnel host/user are not configured.");
        }
        if (!privateKeyFile().exists()) {
            throw new IllegalStateException("Tunnel private key is missing.");
        }
        synchronized (lock) {
            if (session != null && session.isConnected()) {
                return;
            }
            if (worker != null && worker.isAlive()) {
                return;
            }
            stopRequested = false;
            lastStartReason = reason == null || reason.trim().isEmpty() ? "unknown" : reason.trim();
            lastError = "none";
            assignedRemoteAdbPort = -1;
            state = "starting";
            publishState();
            worker = new Thread(() -> runConnectLoop(lastStartReason), "PuckyTunnel");
            worker.setDaemon(true);
            worker.start();
        }
    }

    private void stopInternal(String reason) {
        synchronized (lock) {
            stopRequested = true;
            state = reason == null || reason.trim().isEmpty() ? "stopping" : "stopping_" + reason.trim();
            publishState();
            if (session != null) {
                try {
                    session.disconnect();
                } catch (RuntimeException ignored) {
                    // Session may already be down.
                }
                session = null;
            }
            assignedRemoteAdbPort = -1;
            state = "stopped";
            publishState();
        }
    }

    private void runConnectLoop(String reason) {
        while (!shouldStop()) {
            try {
                connectOnce(reason);
                waitWhileConnected();
            } catch (Exception exc) {
                Log.w(TAG, "Tunnel connection failed", exc);
                setState("connect_failed", exc.getClass().getSimpleName() + ": " + exc.getMessage());
            } finally {
                disconnectSession();
            }
            if (shouldStop() || !settingsStore.isTunnelEnabled()) {
                break;
            }
            sleep(settingsStore.getTunnelReconnectDelayMs());
        }
        synchronized (lock) {
            if (Thread.currentThread() == worker) {
                worker = null;
            }
            if (!stopRequested && "connected".equals(state)) {
                state = "disconnected";
                publishState();
            }
        }
    }

    private void connectOnce(String reason) throws Exception {
        setState("connecting", "none");
        JSch jsch = new JSch();
        if (knownHostsFile().exists()) {
            jsch.setKnownHosts(knownHostsFile().getAbsolutePath());
        }
        jsch.addIdentity(privateKeyFile().getAbsolutePath());

        Session nextSession = jsch.getSession(
                settingsStore.getTunnelUser(),
                settingsStore.getTunnelHost(),
                settingsStore.getTunnelPort());
        nextSession.setConfig("PreferredAuthentications", "publickey");
        nextSession.setConfig("StrictHostKeyChecking",
                settingsStore.isTunnelStrictHostKeyChecking() ? "yes" : "no");
        nextSession.setServerAliveInterval(30000);
        nextSession.setServerAliveCountMax(3);
        if (settingsStore.isTunnelTlsEnabled()) {
            nextSession.setProxy(new TlsSniProxy(settingsStore.getTunnelTlsServerName()));
        }
        nextSession.connect(settingsStore.getTunnelConnectTimeoutMs());
        int remotePort = settingsStore.getTunnelRemoteAdbPort();
        nextSession.setPortForwardingR(
                settingsStore.getTunnelRemoteBindAddress(),
                remotePort,
                settingsStore.getTunnelPhoneAdbHost(),
                settingsStore.getTunnelPhoneAdbPort());

        synchronized (lock) {
            session = nextSession;
            assignedRemoteAdbPort = remotePort;
            connectedAt = Instant.now().toString();
            state = "connected";
            lastError = "none";
            lastStartReason = reason;
            publishState();
        }
        Log.i(TAG, "Tunnel connected remote_port=" + remotePort
                + " host=" + settingsStore.getTunnelHost()
                + " reason=" + reason);
    }

    private void waitWhileConnected() {
        while (!shouldStop()) {
            Session active;
            synchronized (lock) {
                active = session;
            }
            if (active == null || !active.isConnected()) {
                setState("disconnected", "none");
                return;
            }
            sleep(5000);
        }
    }

    private boolean shouldStop() {
        synchronized (lock) {
            return stopRequested;
        }
    }

    private void disconnectSession() {
        synchronized (lock) {
            if (session != null) {
                try {
                    session.disconnect();
                } catch (RuntimeException ignored) {
                    // Best effort teardown.
                }
                session = null;
            }
            assignedRemoteAdbPort = -1;
            if (!stopRequested && settingsStore.isTunnelEnabled()) {
                state = "reconnecting";
            }
            publishState();
        }
    }

    private void setState(String nextState, String error) {
        synchronized (lock) {
            state = nextState == null || nextState.trim().isEmpty() ? "unknown" : nextState.trim();
            lastError = error == null || error.trim().isEmpty() ? "none" : error.trim();
            publishState();
        }
    }

    private void publishState() {
        PuckyState.get().setTunnelState(state, lastError);
    }

    private File tunnelDir() {
        File dir = new File(context.getFilesDir(), "tunnel");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Failed to create tunnel directory: " + dir);
        }
        return dir;
    }

    private File privateKeyFile() {
        return new File(tunnelDir(), "id_pucky_tunnel");
    }

    private File knownHostsFile() {
        return new File(tunnelDir(), "known_hosts");
    }

    private void writeSecretIfPresent(JSONObject args, String key, File target) {
        if (!args.has(key)) {
            return;
        }
        String value = args.optString(key, "");
        if (value.trim().isEmpty()) {
            deleteQuietly(target);
            return;
        }
        try (FileOutputStream out = new FileOutputStream(target, false)) {
            out.write(value.getBytes(StandardCharsets.UTF_8));
            if (!value.endsWith("\n")) {
                out.write('\n');
            }
        } catch (Exception exc) {
            throw new IllegalStateException("Failed to write " + key + ": " + exc.getMessage(), exc);
        }
        target.setReadable(false, false);
        target.setWritable(false, false);
        target.setExecutable(false, false);
        target.setReadable(true, true);
        target.setWritable(true, true);
    }

    private static void deleteQuietly(File file) {
        if (file.exists() && !file.delete()) {
            Log.w(TAG, "Failed to delete " + file);
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
        }
    }
}
