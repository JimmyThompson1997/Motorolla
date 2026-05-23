package com.pucky.device.ui;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.pucky.device.artifacts.ArtifactController;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;

public final class PuckyWebResourceClient extends WebViewClient {
    private static final String TAG = "PuckyWebResource";
    private static final String TRUSTED_HOST = "pucky.local";

    private final Context context;

    public PuckyWebResourceClient(Context context) {
        this.context = context.getApplicationContext();
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
}
