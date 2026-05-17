package com.pucky.device.network;

import com.pucky.device.util.Json;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import org.json.JSONArray;
import org.json.JSONObject;

public final class NetworkProvider {
    private final Context context;

    public NetworkProvider(Context context) {
        this.context = context.getApplicationContext();
    }

    public JSONObject read() {
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        JSONObject out = new JSONObject();
        if (manager == null) {
            Json.put(out, "available", false);
            return out;
        }
        Network network = manager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
        Json.put(out, "available", network != null);
        Json.put(out, "validated", capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
        Json.put(out, "internet", capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));
        Json.put(out, "metered", manager.isActiveNetworkMetered());
        JSONArray transports = new JSONArray();
        if (capabilities != null) {
            addTransport(capabilities, transports, NetworkCapabilities.TRANSPORT_WIFI, "wifi");
            addTransport(capabilities, transports, NetworkCapabilities.TRANSPORT_CELLULAR, "cellular");
            addTransport(capabilities, transports, NetworkCapabilities.TRANSPORT_ETHERNET, "ethernet");
            addTransport(capabilities, transports, NetworkCapabilities.TRANSPORT_VPN, "vpn");
        }
        Json.put(out, "transports", transports);
        return out;
    }

    private static void addTransport(NetworkCapabilities capabilities, JSONArray out, int transport, String name) {
        if (capabilities.hasTransport(transport)) {
            Json.add(out, name);
        }
    }
}

