package com.pucky.device.ui;

import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.net.URI;

public final class PuckyWebBridgePolicy {
    private static final long DEFAULT_TTL_MS = 30000L;
    private static final long MAX_TTL_MS = 120000L;
    private static final long DEFAULT_SHELL_TIMEOUT_MS = 10000L;
    private static final long MAX_SHELL_TIMEOUT_MS = 120000L;

    private PuckyWebBridgePolicy() {
    }

    public static boolean isTrustedUrl(String url, String configuredBaseUrl) {
        if (url == null || url.trim().isEmpty()) {
            return false;
        }
        URI uri = parse(url);
        if (uri == null) {
            return false;
        }
        String scheme = lower(uri.getScheme());
        String host = lower(uri.getHost());
        int port = uri.getPort();
        String path = uri.getPath() == null ? "" : uri.getPath();
        if ("http".equals(scheme)
                && (isLoopback(host))
                && (port == 8788 || port == -1)
                && isPuckyPortalPath(path)) {
            return true;
        }
        if (configuredBaseUrl == null || configuredBaseUrl.trim().isEmpty()) {
            return false;
        }
        URI configured = parse(configuredBaseUrl);
        if (configured == null) {
            return false;
        }
        return "https".equals(scheme)
                && host.equals(lower(configured.getHost()))
                && isPuckyPortalPath(path);
    }

    public static long boundedTtlMs(long requested) {
        if (requested <= 0L) {
            return DEFAULT_TTL_MS;
        }
        return Math.max(1000L, Math.min(MAX_TTL_MS, requested));
    }

    public static void boundShellArgs(JSONObject args) {
        if (args == null) {
            return;
        }
        long timeout = args.optLong("timeout_ms", DEFAULT_SHELL_TIMEOUT_MS);
        long bounded = Math.max(1000L, Math.min(MAX_SHELL_TIMEOUT_MS, timeout));
        Json.put(args, "timeout_ms", bounded);
    }

    private static boolean isPuckyPortalPath(String path) {
        return "/pucky-home".equals(path)
                || path.startsWith("/pucky-ui/")
                || "/pucky/events".equals(path);
    }

    private static boolean isLoopback(String host) {
        return "127.0.0.1".equals(host) || "::1".equals(host) || "localhost".equals(host);
    }

    private static String lower(String value) {
        return value == null ? "" : value.trim().toLowerCase();
    }

    private static URI parse(String value) {
        try {
            return URI.create(value.trim());
        } catch (Exception ignored) {
            return null;
        }
    }
}
