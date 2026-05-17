package com.pucky.device.broker;

import android.content.Context;
import android.util.Log;

import com.pucky.device.net.Ipv4FirstDns;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;

import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class BrokerEventPoster {
    private static final String TAG = "PuckyEventPoster";
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final SettingsStore settings;
    private final OkHttpClient client = new OkHttpClient.Builder()
            .dns(Ipv4FirstDns.INSTANCE)
            .build();

    public BrokerEventPoster(Context context) {
        this.settings = new SettingsStore(context.getApplicationContext());
    }

    public void postAsync(JSONObject event) {
        JSONObject copy;
        try {
            copy = new JSONObject(event.toString());
        } catch (JSONException exc) {
            Log.w(TAG, "event copy failed error=" + exc.getMessage());
            return;
        }
        new Thread(() -> {
            try {
                JSONObject result = post(copy);
                Log.i(TAG, "event post ok=" + result.optBoolean("ok", false)
                        + " status=" + result.optInt("http_status", 0)
                        + " type=" + copy.optString("type"));
            } catch (Exception exc) {
                Log.w(TAG, "event post failed type=" + copy.optString("type")
                        + " error=" + exc.getClass().getSimpleName() + ": " + exc.getMessage());
            }
        }, "pucky-event-post").start();
    }

    public JSONObject post(JSONObject event) throws IOException {
        HttpUrl url = eventUrl();
        Request request = new Request.Builder()
                .url(url)
                .header("Authorization", "Bearer " + settings.getToken())
                .post(RequestBody.create(event.toString(), JSON))
                .build();
        try (Response response = client.newCall(request).execute()) {
            JSONObject out = new JSONObject();
            Json.put(out, "ok", response.isSuccessful());
            Json.put(out, "http_status", response.code());
            Json.put(out, "url", url.toString());
            return out;
        }
    }

    private HttpUrl eventUrl() {
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
                .addPathSegment("events")
                .build();
    }
}
