package com.pucky.device.adb;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.provider.Settings;
import android.text.TextUtils;

import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.state.PuckyState;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.tunnel.TunnelController;
import com.pucky.device.util.Json;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.FileReader;
import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public final class RemoteAdbController {
    private static final String SCHEMA_STATUS = "pucky.adb_remote_status.v1";
    private static final String SCHEMA_WIFI_STATUS = "pucky.adb_wifi_status.v1";
    private static final String GLOBAL_ADB_ENABLED = "adb_enabled";
    private static final String GLOBAL_ADB_WIFI_ENABLED = "adb_wifi_enabled";
    private static final String GLOBAL_ADB_WIFI_PORT = "adb_wifi_port";
    private static final String GLOBAL_ADB_WIFI_PAIRING_PORT = "adb_wifi_pairing_port";
    private static final String GLOBAL_DEVELOPMENT_SETTINGS_ENABLED = "development_settings_enabled";
    private static final String ADB_TLS_CONNECT_SERVICE = "_adb-tls-connect._tcp.";
    private static final int DEFAULT_RECONNECT_WAIT_MS = 20000;
    private static final int DEFAULT_RECONNECT_POLL_MS = 1000;
    private static final int DEFAULT_WIFI_ENABLE_WAIT_MS = 20000;
    private static final int DEFAULT_WIFI_ENABLE_POLL_MS = 1000;
    private static volatile String lastReconnectAttemptAt = "never";
    private static volatile String lastReconnectReason = "none";

    private final Context context;
    private final SettingsStore settingsStore;
    private final TunnelController tunnelController;

    public RemoteAdbController(Context context, SettingsStore settingsStore, TunnelController tunnelController) {
        this.context = context.getApplicationContext();
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

    public JSONObject wifiStatus(JSONObject args) {
        JSONObject safeArgs = args == null ? new JSONObject() : args;
        PortSnapshot snapshot = readListenPorts();
        MdnsSnapshot mdns = safeArgs.optBoolean("discover_mdns", true)
                ? discoverMdns(Math.max(1000, Math.min(30000, safeArgs.optInt("mdns_wait_ms", 5000))))
                : MdnsSnapshot.skipped();
        JSONObject out = baseWifiStatus(snapshot);
        Json.put(out, "mdns", mdns.toJson());
        int requestedPort = requestedPort(safeArgs);
        Json.put(out, "requested_port", requestedPort > 0 ? requestedPort : JSONObject.NULL);
        Json.put(out, "selected_port_hint", selectPort(safeArgs, new HashSet<>(), snapshot.ports, mdns.connectPort));
        Json.put(out, "notes", "Experimental official Wireless Debugging path. Enabling needs WRITE_SECURE_SETTINGS; VM ADB may still need Android wireless-debugging pairing trust.");
        return out;
    }

    public JSONObject wifiEnable(JSONObject args) throws CommandException {
        JSONObject safeArgs = args == null ? new JSONObject() : args;
        requireWriteSecureSettings();
        PortSnapshot before = readListenPorts();
        String previous = readGlobalString(GLOBAL_ADB_WIFI_ENABLED);
        putGlobalInt(GLOBAL_ADB_WIFI_ENABLED, 1);

        long started = System.currentTimeMillis();
        long waitMs = Math.max(0, Math.min(60000,
                safeArgs.optInt("wait_ms", DEFAULT_WIFI_ENABLE_WAIT_MS)));
        long pollMs = Math.max(250, Math.min(5000,
                safeArgs.optInt("poll_ms", DEFAULT_WIFI_ENABLE_POLL_MS)));
        MdnsSnapshot mdns = MdnsSnapshot.skipped();
        PortSnapshot after = readListenPorts();
        int selectedPort = selectPort(safeArgs, before.ports, after.ports, mdns.connectPort);
        while (System.currentTimeMillis() - started < waitMs
                && (readGlobalInt(GLOBAL_ADB_WIFI_ENABLED, 0) != 1 || selectedPort <= 0)) {
            sleep(pollMs);
            after = readListenPorts();
            if (safeArgs.optBoolean("discover_mdns", true)) {
                mdns = discoverMdns(Math.max(1000, Math.min(10000, safeArgs.optInt("mdns_wait_ms", 3000))));
            }
            selectedPort = selectPort(safeArgs, before.ports, after.ports, mdns.connectPort);
        }

        JSONObject out = baseWifiStatus(after);
        Json.put(out, "mdns", mdns.toJson());
        Json.put(out, "schema", "pucky.adb_wifi_enable_result.v1");
        Json.put(out, "requested_enabled", true);
        Json.put(out, "previous_adb_wifi_enabled", previous == null ? JSONObject.NULL : previous);
        Json.put(out, "waited_ms", System.currentTimeMillis() - started);
        Json.put(out, "new_listen_ports", diffPorts(before.ports, after.ports));
        Json.put(out, "selected_port", selectedPort > 0 ? selectedPort : JSONObject.NULL);
        Json.put(out, "selected_phone_adb_host", safeArgs.optString("phone_adb_host", "127.0.0.1"));
        Json.put(out, "pairing_warning", "If VM adb cannot authenticate to this port, Android Wireless Debugging still needs one-time pairing/trust.");
        if (selectedPort > 0 && safeArgs.optBoolean("update_tunnel", false)) {
            Json.put(out, "tunnel_update", updateTunnelForWifi(safeArgs, selectedPort));
        }
        return out;
    }

    public JSONObject wifiDisable(JSONObject args) throws CommandException {
        JSONObject safeArgs = args == null ? new JSONObject() : args;
        requireWriteSecureSettings();
        String previous = readGlobalString(GLOBAL_ADB_WIFI_ENABLED);
        putGlobalInt(GLOBAL_ADB_WIFI_ENABLED, 0);
        sleep(Math.max(0, Math.min(5000, safeArgs.optInt("settle_ms", 1000))));
        JSONObject out = baseWifiStatus(readListenPorts());
        Json.put(out, "schema", "pucky.adb_wifi_disable_result.v1");
        Json.put(out, "requested_enabled", false);
        Json.put(out, "previous_adb_wifi_enabled", previous == null ? JSONObject.NULL : previous);
        return out;
    }

    private JSONObject baseWifiStatus(PortSnapshot snapshot) {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", SCHEMA_WIFI_STATUS);
        Json.put(out, "checked_at", Instant.now().toString());
        Json.put(out, "write_secure_settings_granted", hasWriteSecureSettings());
        Json.put(out, "settings", globalSettingsJson());
        Json.put(out, "listen_ports", snapshot.entries);
        Json.put(out, "listen_port_errors", snapshot.errors);
        Json.put(out, "candidate_ports", candidatePorts(snapshot.ports));
        Json.put(out, "tunnel", tunnelController.status());
        return out;
    }

    private JSONObject updateTunnelForWifi(JSONObject args, int port) {
        int remotePort = boundedPort(
                args.optInt("remote_adb_port", settingsStore.getTunnelRemoteAdbPort()),
                settingsStore.getTunnelRemoteAdbPort());
        JSONObject tunnelArgs = new JSONObject();
        Json.put(tunnelArgs, "enabled", true);
        Json.put(tunnelArgs, "adb_transport", "wireless_debugging");
        Json.put(tunnelArgs, "phone_adb_host", args.optString("phone_adb_host", "127.0.0.1"));
        Json.put(tunnelArgs, "phone_adb_port", port);
        Json.put(tunnelArgs, "remote_adb_port", remotePort);
        Json.put(tunnelArgs, "vm_adb_port", remotePort);
        Json.put(tunnelArgs, "restart", true);
        Json.put(tunnelArgs, "reason", args.optString("reason", "adb_wifi_enable"));
        return tunnelController.configure(tunnelArgs);
    }

    private JSONObject globalSettingsJson() {
        JSONObject out = new JSONObject();
        putGlobalString(out, GLOBAL_ADB_ENABLED);
        putGlobalString(out, GLOBAL_ADB_WIFI_ENABLED);
        putGlobalString(out, GLOBAL_ADB_WIFI_PORT);
        putGlobalString(out, GLOBAL_ADB_WIFI_PAIRING_PORT);
        putGlobalString(out, GLOBAL_DEVELOPMENT_SETTINGS_ENABLED);
        return out;
    }

    private void putGlobalString(JSONObject out, String key) {
        String value = readGlobalString(key);
        Json.put(out, key, value == null ? JSONObject.NULL : value);
    }

    private void requireWriteSecureSettings() throws CommandException {
        if (!hasWriteSecureSettings()) {
            throw new CommandException(
                    CommandErrorCodes.PERMISSION_MISSING,
                    "Pucky needs one-time ADB grant: pm grant "
                            + context.getPackageName() + " android.permission.WRITE_SECURE_SETTINGS");
        }
    }

    private boolean hasWriteSecureSettings() {
        return context.checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private String readGlobalString(String key) {
        try {
            return Settings.Global.getString(context.getContentResolver(), key);
        } catch (RuntimeException exc) {
            return null;
        }
    }

    private int readGlobalInt(String key, int fallback) {
        String value = readGlobalString(key);
        if (value == null) {
            return fallback;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException exc) {
            return fallback;
        }
    }

    private void putGlobalInt(String key, int value) throws CommandException {
        try {
            boolean ok = Settings.Global.putInt(context.getContentResolver(), key, value);
            if (!ok) {
                throw new CommandException(
                        CommandErrorCodes.EXECUTION_FAILED,
                        "Settings.Global.putInt returned false for " + key);
            }
        } catch (SecurityException exc) {
            throw new CommandException(
                    CommandErrorCodes.PERMISSION_MISSING,
                    "WRITE_SECURE_SETTINGS was not accepted while writing " + key + ": " + exc.getMessage());
        } catch (RuntimeException exc) {
            throw new CommandException(
                    CommandErrorCodes.EXECUTION_FAILED,
                    "Failed writing " + key + ": " + exc.getMessage());
        }
    }

    private PortSnapshot readListenPorts() {
        PortSnapshot snapshot = new PortSnapshot();
        readProcNet("/proc/net/tcp", "tcp4", snapshot);
        readProcNet("/proc/net/tcp6", "tcp6", snapshot);
        return snapshot;
    }

    private void readProcNet(String path, String family, PortSnapshot snapshot) {
        try (BufferedReader reader = new BufferedReader(new FileReader(path))) {
            String line;
            while ((line = reader.readLine()) != null) {
                parseProcNetLine(line, family, snapshot);
            }
        } catch (IOException | RuntimeException exc) {
            JSONObject err = new JSONObject();
            Json.put(err, "path", path);
            Json.put(err, "error", exc.getClass().getSimpleName() + ": " + exc.getMessage());
            Json.add(snapshot.errors, err);
        }
    }

    private void parseProcNetLine(String line, String family, PortSnapshot snapshot) {
        String trimmed = line == null ? "" : line.trim();
        if (trimmed.isEmpty() || trimmed.startsWith("sl")) {
            return;
        }
        String[] parts = trimmed.split("\\s+");
        if (parts.length < 4 || !"0A".equals(parts[3])) {
            return;
        }
        String localAddress = parts[1];
        int colon = localAddress.lastIndexOf(':');
        if (colon < 0 || colon == localAddress.length() - 1) {
            return;
        }
        int port;
        try {
            port = Integer.parseInt(localAddress.substring(colon + 1), 16);
        } catch (NumberFormatException exc) {
            return;
        }
        snapshot.ports.add(port);
        JSONObject entry = new JSONObject();
        Json.put(entry, "family", family);
        Json.put(entry, "port", port);
        Json.put(entry, "local_address_raw", localAddress);
        Json.put(entry, "state", "listen");
        Json.add(snapshot.entries, entry);
    }

    private JSONArray candidatePorts(Set<Integer> ports) {
        JSONArray out = new JSONArray();
        for (int port : sortedPorts(ports)) {
            if (isWifiCandidatePort(port)) {
                Json.add(out, port);
            }
        }
        return out;
    }

    private JSONArray diffPorts(Set<Integer> before, Set<Integer> after) {
        JSONArray out = new JSONArray();
        for (int port : sortedPorts(after)) {
            if (!before.contains(port)) {
                Json.add(out, port);
            }
        }
        return out;
    }

    private int selectPort(JSONObject args, Set<Integer> before, Set<Integer> after, int mdnsPort) {
        int requested = requestedPort(args);
        if (requested > 0) {
            return requested;
        }
        int globalPort = parsePort(readGlobalString(GLOBAL_ADB_WIFI_PORT));
        if (globalPort > 0) {
            return globalPort;
        }
        if (mdnsPort > 0) {
            return mdnsPort;
        }
        for (int port : sortedPorts(after)) {
            if (!before.contains(port) && isWifiCandidatePort(port)) {
                return port;
            }
        }
        for (int port : sortedPorts(after)) {
            if (isWifiCandidatePort(port)) {
                return port;
            }
        }
        return 0;
    }

    private MdnsSnapshot discoverMdns(int timeoutMs) {
        NsdManager nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        if (nsd == null) {
            return MdnsSnapshot.failed("NsdManager unavailable");
        }
        WifiManager.MulticastLock lock = null;
        try {
            WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                lock = wifi.createMulticastLock("PuckyAdbWifiDiscovery");
                lock.setReferenceCounted(false);
                lock.acquire();
            }
        } catch (RuntimeException ignored) {
            lock = null;
        }

        MdnsSnapshot snapshot = new MdnsSnapshot();
        CountDownLatch foundLatch = new CountDownLatch(1);
        final boolean[] discoveryStarted = new boolean[] { false };
        NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                snapshot.error("start_failed", errorCode);
                foundLatch.countDown();
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                snapshot.error("stop_failed", errorCode);
            }

            @Override
            public void onDiscoveryStarted(String serviceType) {
                discoveryStarted[0] = true;
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
            }

            @Override
            public void onServiceFound(NsdServiceInfo serviceInfo) {
                if (serviceInfo == null || !ADB_TLS_CONNECT_SERVICE.equals(serviceInfo.getServiceType())) {
                    return;
                }
                nsd.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                        snapshot.error("resolve_failed", errorCode);
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo resolved) {
                        snapshot.add(resolved);
                        if (snapshot.connectPort > 0) {
                            foundLatch.countDown();
                        }
                    }
                });
            }

            @Override
            public void onServiceLost(NsdServiceInfo serviceInfo) {
            }
        };

        try {
            nsd.discoverServices(ADB_TLS_CONNECT_SERVICE, NsdManager.PROTOCOL_DNS_SD, listener);
            foundLatch.await(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            snapshot.message = "interrupted";
        } catch (RuntimeException exc) {
            snapshot.message = exc.getClass().getSimpleName() + ": " + exc.getMessage();
        } finally {
            if (discoveryStarted[0]) {
                try {
                    nsd.stopServiceDiscovery(listener);
                } catch (RuntimeException ignored) {
                    // Discovery may already have stopped after an error callback.
                }
            }
            if (lock != null && lock.isHeld()) {
                try {
                    lock.release();
                } catch (RuntimeException ignored) {
                    // Best effort.
                }
            }
        }
        return snapshot;
    }

    private int requestedPort(JSONObject args) {
        int port = args.optInt("phone_adb_port", 0);
        if (port <= 0) {
            port = args.optInt("port", 0);
        }
        return boundedPort(port, 0);
    }

    private int parsePort(String value) {
        if (value == null) {
            return 0;
        }
        try {
            return boundedPort(Integer.parseInt(value.trim()), 0);
        } catch (NumberFormatException exc) {
            return 0;
        }
    }

    private int boundedPort(int port, int fallback) {
        return port >= 1 && port <= 65535 ? port : fallback;
    }

    private boolean isWifiCandidatePort(int port) {
        return port > 10000
                && port != 5555
                && port != settingsStore.getTunnelRemoteAdbPort()
                && port != settingsStore.getTunnelPhoneAdbPort();
    }

    private ArrayList<Integer> sortedPorts(Set<Integer> ports) {
        ArrayList<Integer> sorted = new ArrayList<>(ports);
        Collections.sort(sorted);
        return sorted;
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

    private static final class PortSnapshot {
        final Set<Integer> ports = new HashSet<>();
        final JSONArray entries = new JSONArray();
        final JSONArray errors = new JSONArray();
    }

    private static final class MdnsSnapshot {
        int connectPort;
        String message = "ok";
        final JSONArray services = new JSONArray();
        final JSONArray errors = new JSONArray();

        static MdnsSnapshot skipped() {
            MdnsSnapshot snapshot = new MdnsSnapshot();
            snapshot.message = "skipped";
            return snapshot;
        }

        static MdnsSnapshot failed(String message) {
            MdnsSnapshot snapshot = new MdnsSnapshot();
            snapshot.message = message;
            return snapshot;
        }

        synchronized void add(NsdServiceInfo serviceInfo) {
            int port = serviceInfo == null ? 0 : serviceInfo.getPort();
            if (connectPort <= 0 && port > 0) {
                connectPort = port;
            }
            JSONObject service = new JSONObject();
            Json.put(service, "service_name", serviceInfo == null ? JSONObject.NULL : serviceInfo.getServiceName());
            Json.put(service, "service_type", serviceInfo == null ? JSONObject.NULL : serviceInfo.getServiceType());
            Json.put(service, "port", port > 0 ? port : JSONObject.NULL);
            String host = serviceInfo == null || serviceInfo.getHost() == null
                    ? ""
                    : serviceInfo.getHost().getHostAddress();
            Json.put(service, "host", TextUtils.isEmpty(host) ? JSONObject.NULL : host);
            Json.add(services, service);
        }

        synchronized void error(String stage, int code) {
            JSONObject error = new JSONObject();
            Json.put(error, "stage", stage);
            Json.put(error, "code", code);
            Json.add(errors, error);
        }

        synchronized JSONObject toJson() {
            JSONObject out = new JSONObject();
            Json.put(out, "service_type", ADB_TLS_CONNECT_SERVICE);
            Json.put(out, "message", message);
            Json.put(out, "connect_port", connectPort > 0 ? connectPort : JSONObject.NULL);
            Json.put(out, "services", services);
            Json.put(out, "errors", errors);
            return out;
        }
    }
}
