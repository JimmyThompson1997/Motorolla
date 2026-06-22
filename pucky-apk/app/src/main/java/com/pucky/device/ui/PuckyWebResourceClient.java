package com.pucky.device.ui;

import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.pucky.device.artifacts.ArtifactController;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Set;

public final class PuckyWebResourceClient extends WebViewClient {
    private static final String TAG = "PuckyWebResource";
    private static final String TRUSTED_HOST = "pucky.local";
    private static final String HOSTED_UI_HOST = "pucky.fly.dev";
    private static final String HOSTED_UI_PATH_PREFIX = "/ui/pucky/latest";
    private static final int MAX_HOSTED_UI_RELOAD_ATTEMPTS = 6;
    private static final long HOSTED_UI_RELOAD_DELAY_MS = 1500L;

    private final Context context;
    private final UiBundleController uiBundles;
    private final UiSurfaceController uiSurface;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final HashMap<String, Integer> hostedUiReloadAttempts = new HashMap<>();
    private final Set<String> scheduledHostedUiReloads = new HashSet<>();

    public PuckyWebResourceClient(Context context, UiBundleController uiBundles, UiSurfaceController uiSurface) {
        this.context = context.getApplicationContext();
        this.uiBundles = uiBundles;
        this.uiSurface = uiSurface;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (request == null || request.getUrl() == null) {
            return super.shouldInterceptRequest(view, request);
        }
        Uri uri = request.getUrl();
        if (!"https".equalsIgnoreCase(uri.getScheme())
                || !TRUSTED_HOST.equalsIgnoreCase(uri.getHost())
                || !"/artifact".equals(uri.getPath())) {
            return super.shouldInterceptRequest(view, request);
        }
        try {
            return new ArtifactController(context).webResponse(
                    uri.getQueryParameter("path"),
                    request.getRequestHeaders());
        } catch (Exception exc) {
            Log.w(TAG, "Unable to serve artifact URL", exc);
            byte[] body = "Artifact not found".getBytes(StandardCharsets.UTF_8);
            HashMap<String, String> headers = new HashMap<>();
            headers.put("Content-Length", Integer.toString(body.length));
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    headers, new ByteArrayInputStream(body));
        }
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        scheduleHostedUiReload(view, request, "main frame error");
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        super.onReceivedHttpError(view, request, errorResponse);
        if (errorResponse != null && errorResponse.getStatusCode() >= 400) {
            scheduleHostedUiReload(view, request, "http " + errorResponse.getStatusCode());
        }
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        if (isHostedUiUrl(url) && !isChromeErrorUrl(url)) {
            hostedUiReloadAttempts.clear();
            scheduledHostedUiReloads.clear();
        }
        if (uiSurface != null && uiBundles != null) {
            uiSurface.recordLoaded(url, uiBundles);
        }
    }

    static boolean shouldRetryHostedUiUrl(String url, int attempt) {
        return attempt < MAX_HOSTED_UI_RELOAD_ATTEMPTS && isHostedUiUrl(url);
    }

    static long hostedUiReloadDelayMs(int attempt) {
        return HOSTED_UI_RELOAD_DELAY_MS * Math.max(1, attempt);
    }

    static boolean isHostedUiUrl(String url) {
        String raw = url == null ? "" : url.trim();
        if (raw.isEmpty()) {
            return false;
        }
        try {
            URI uri = URI.create(raw);
            return "https".equalsIgnoreCase(uri.getScheme())
                    && HOSTED_UI_HOST.equalsIgnoreCase(uri.getHost())
                    && uri.getPath() != null
                    && uri.getPath().startsWith(HOSTED_UI_PATH_PREFIX);
        } catch (IllegalArgumentException exc) {
            return false;
        }
    }

    private static boolean isChromeErrorUrl(String url) {
        return url != null && url.startsWith("chrome-error://");
    }

    private void scheduleHostedUiReload(WebView view, WebResourceRequest request, String reason) {
        if (view == null || request == null || !request.isForMainFrame() || request.getUrl() == null) {
            return;
        }
        String failingUrl = request.getUrl().toString();
        int attempt = hostedUiReloadAttempts.getOrDefault(failingUrl, 0);
        if (!shouldRetryHostedUiUrl(failingUrl, attempt) || scheduledHostedUiReloads.contains(failingUrl)) {
            return;
        }
        int nextAttempt = attempt + 1;
        hostedUiReloadAttempts.put(failingUrl, nextAttempt);
        scheduledHostedUiReloads.add(failingUrl);
        long delayMs = hostedUiReloadDelayMs(nextAttempt);
        Log.w(TAG, "Retrying hosted UI after " + reason + " attempt=" + nextAttempt + " url=" + failingUrl);
        mainHandler.postDelayed(() -> {
            scheduledHostedUiReloads.remove(failingUrl);
            String currentUrl = view.getUrl();
            if (currentUrl != null && !currentUrl.isEmpty() && !isChromeErrorUrl(currentUrl) && !currentUrl.equals(failingUrl)) {
                return;
            }
            view.post(() -> view.loadUrl(failingUrl));
        }, delayMs);
    }
}
