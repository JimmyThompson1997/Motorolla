package com.pucky.device.notifications;

import android.content.Context;

import com.pucky.device.net.Ipv4FirstDns;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.io.IOException;
import java.time.Instant;
import java.util.UUID;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class BrokerReplyPoster {
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final SettingsStore settings;
    private final OkHttpClient client = new OkHttpClient.Builder()
            .dns(Ipv4FirstDns.INSTANCE)
            .build();

    public BrokerReplyPoster(Context context) {
        this.settings = new SettingsStore(context.getApplicationContext());
    }

    public JSONObject post(String commandId, String promptId, String text) throws IOException {
        JSONObject body = new JSONObject();
        Json.put(body, "schema", "pucky.reply.v1");
        Json.put(body, "reply_id", "reply_" + UUID.randomUUID());
        Json.put(body, "command_id", commandId == null ? JSONObject.NULL : commandId);
        Json.put(body, "prompt_id", promptId == null ? JSONObject.NULL : promptId);
        Json.put(body, "text", text == null ? "" : text);
        Json.put(body, "received_at", Instant.now().toString());
        HttpUrl url = replyUrl();
        Request request = new Request.Builder()
                .url(url)
                .header("Authorization", "Bearer " + settings.getToken())
                .post(RequestBody.create(body.toString(), JSON))
                .build();
        try (Response response = client.newCall(request).execute()) {
            JSONObject out = new JSONObject();
            Json.put(out, "ok", response.isSuccessful());
            Json.put(out, "http_status", response.code());
            Json.put(out, "url", url.toString());
            return out;
        }
    }

    private HttpUrl replyUrl() {
        String raw = settings.getBrokerUrl();
        if (raw.startsWith("wss://")) {
            raw = "https://" + raw.substring("wss://".length());
        } else if (raw.startsWith("ws://")) {
            raw = "http://" + raw.substring("ws://".length());
        }
        HttpUrl broker = HttpUrl.parse(raw);
        if (broker == null) {
            throw new IllegalStateException("Invalid broker URL");
        }
        return new HttpUrl.Builder()
                .scheme(broker.scheme())
                .host(broker.host())
                .port(broker.port())
                .addPathSegment("v1")
                .addPathSegment("devices")
                .addPathSegment(settings.getDeviceId())
                .addPathSegment("replies")
                .build();
    }
}
