package com.pucky.device.broker;

import com.pucky.device.util.Json;

import android.content.Context;
import android.util.Log;

import com.pucky.device.command.CommandHandlingResult;
import com.pucky.device.command.CommandRouter;
import com.pucky.device.net.Ipv4FirstDns;
import com.pucky.device.state.PuckyState;
import com.pucky.device.status.AppIdentity;
import com.pucky.device.storage.CommandLogStore;
import com.pucky.device.storage.SettingsStore;

import org.json.JSONObject;

import java.time.Instant;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public final class BrokerControlClient {
    private static final String TAG = "PuckyBrokerClient";

    private final Context context;
    private final SettingsStore settings;
    private final CommandRouter router;
    private final CommandLogStore logStore;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
    private final OkHttpClient client;

    private WebSocket webSocket;
    private ScheduledFuture<?> heartbeatTask;
    private ScheduledFuture<?> reconnectTask;
    private int reconnectAttempt;
    private boolean shouldReconnect;
    private boolean closed;
    private boolean connected;
    private boolean opening;

    public BrokerControlClient(Context context, SettingsStore settings, CommandRouter router, CommandLogStore logStore) {
        this.context = context.getApplicationContext();
        this.settings = settings;
        this.router = router;
        this.logStore = logStore;
        this.client = new OkHttpClient.Builder()
                .dns(Ipv4FirstDns.INSTANCE)
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(30, TimeUnit.SECONDS)
                .build();
    }

    public synchronized void connect() {
        shouldReconnect = true;
        closed = false;
        connected = false;
        opening = false;
        reconnectAttempt = 0;
        open();
    }

    public synchronized void ensureConnection() {
        shouldReconnect = true;
        if (closed) {
            closed = false;
        }
        if (connected || opening) {
            return;
        }
        if (reconnectTask != null && !reconnectTask.isDone()) {
            return;
        }
        open();
    }

    public synchronized boolean isConnected() {
        return connected && webSocket != null;
    }

    public synchronized void disconnect(String reason) {
        shouldReconnect = false;
        closed = true;
        connected = false;
        opening = false;
        stopHeartbeat();
        cancelReconnect();
        if (webSocket != null) {
            webSocket.close(1000, reason);
            webSocket = null;
        }
        PuckyState.get().setConnectionState("disconnected");
        PuckyState.get().broadcast(context);
        scheduler.shutdownNow();
    }

    private synchronized void open() {
        if (closed || connected || opening) {
            return;
        }
        String url = settings.getBrokerUrl();
        Log.i(TAG, "open url=" + url);
        PuckyState.get().setBrokerUrl(url);
        PuckyState.get().setConnectionState("connecting");
        PuckyState.get().broadcast(context);
        Request request = new Request.Builder()
                .url(url)
                .header("Authorization", "Bearer " + settings.getToken())
                .build();
        opening = true;
        webSocket = client.newWebSocket(request, new Listener());
    }

    private void send(JSONObject object) {
        WebSocket socket;
        synchronized (this) {
            if (closed) {
                return;
            }
            socket = webSocket;
        }
        if (socket != null) {
            socket.send(object.toString());
        }
    }

    private JSONObject hello() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.hello.v1");
        Json.put(out, "device_id", settings.getDeviceId());
        Json.put(out, "apk_version", AppIdentity.versionName(context));
        Json.put(out, "apk_identity", AppIdentity.json(context));
        Json.put(out, "timestamp", Instant.now().toString());
        return out;
    }

    private JSONObject heartbeat() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.heartbeat.v1");
        Json.put(out, "device_id", settings.getDeviceId());
        Json.put(out, "timestamp", Instant.now().toString());
        return out;
    }

    private void startHeartbeat() {
        if (scheduler.isShutdown()) {
            return;
        }
        stopHeartbeat();
        heartbeatTask = scheduler.scheduleAtFixedRate(() -> {
            send(heartbeat());
            PuckyState.get().markHeartbeat();
            PuckyState.get().broadcast(context);
        }, 0, 30, TimeUnit.SECONDS);
    }

    private void stopHeartbeat() {
        if (heartbeatTask != null) {
            heartbeatTask.cancel(true);
            heartbeatTask = null;
        }
    }

    private void cancelReconnect() {
        if (reconnectTask != null) {
            reconnectTask.cancel(true);
            reconnectTask = null;
        }
    }

    private void scheduleReconnect() {
        if (!shouldReconnect || closed || scheduler.isShutdown()) {
            return;
        }
        if (reconnectTask != null && !reconnectTask.isDone()) {
            return;
        }
        int delay = reconnectAttempt == 0 ? 15 : 120;
        reconnectAttempt++;
        PuckyState.get().setConnectionState("reconnecting_in_" + delay + "s");
        PuckyState.get().broadcast(context);
        reconnectTask = scheduler.schedule(() -> {
            synchronized (BrokerControlClient.this) {
                reconnectTask = null;
            }
            open();
        }, delay, TimeUnit.SECONDS);
    }

    private final class Listener extends WebSocketListener {
        @Override
        public void onOpen(WebSocket socket, Response response) {
            synchronized (BrokerControlClient.this) {
                if (closed) {
                    socket.close(1000, "client_closed");
                    return;
                }
            }
            Log.i(TAG, "websocket open");
            synchronized (BrokerControlClient.this) {
                webSocket = socket;
                connected = true;
                opening = false;
                cancelReconnect();
                reconnectAttempt = 0;
            }
            PuckyState.get().setConnectionState("online");
            PuckyState.get().broadcast(context);
            send(hello());
            startHeartbeat();
        }

        @Override
        public void onMessage(WebSocket socket, String text) {
            synchronized (BrokerControlClient.this) {
                if (closed) {
                    return;
                }
            }
            Log.i(TAG, "websocket message len=" + text.length());
            CommandHandlingResult result = router.handle(text);
            PuckyState.get().setLastCommand(result.commandId(), result.status());
            PuckyState.get().broadcast(context);
            logStore.append(result.commandId(), result.type(), result.status(), result.toJson());
            if (result.ack() != null) {
                send(result.ack());
            }
            if (result.result() != null) {
                send(result.result());
            }
        }

        @Override
        public void onClosed(WebSocket socket, int code, String reason) {
            synchronized (BrokerControlClient.this) {
                if (closed) {
                    return;
                }
            }
            Log.i(TAG, "websocket closed code=" + code + " reason=" + reason);
            stopHeartbeat();
            synchronized (BrokerControlClient.this) {
                if (webSocket == socket) {
                    webSocket = null;
                }
                connected = false;
                opening = false;
            }
            PuckyState.get().setConnectionState("closed_" + code);
            PuckyState.get().broadcast(context);
            scheduleReconnect();
        }

        @Override
        public void onFailure(WebSocket socket, Throwable t, Response response) {
            synchronized (BrokerControlClient.this) {
                if (closed) {
                    return;
                }
            }
            Log.w(TAG, "websocket failure " + t.getClass().getSimpleName() + ": " + t.getMessage());
            stopHeartbeat();
            synchronized (BrokerControlClient.this) {
                if (webSocket == socket) {
                    webSocket = null;
                }
                connected = false;
                opening = false;
            }
            PuckyState.get().setConnectionState("offline");
            PuckyState.get().setLastError(t.getClass().getSimpleName() + ": " + t.getMessage());
            PuckyState.get().broadcast(context);
            scheduleReconnect();
        }
    }
}

