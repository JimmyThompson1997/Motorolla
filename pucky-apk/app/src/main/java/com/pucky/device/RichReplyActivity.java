package com.pucky.device;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.view.ViewGroup;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

import com.pucky.device.ui.DetailSurfaceController;

import java.io.File;

public final class RichReplyActivity extends Activity {
    public static final String EXTRA_HTML_PATH = "pucky_reply_html_path";
    public static final String EXTRA_TITLE = "pucky_reply_title";

    private static final int BACKGROUND = Color.rgb(2, 6, 10);
    private static final int WEB_DETAIL_BOTTOM_SAFE_PADDING_DP = 88;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildView());
    }

    private FrameLayout buildView() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);

        File html = resolveHtmlPath(getIntent().getStringExtra(EXTRA_HTML_PATH));

        WebView webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        webView.setClipToPadding(false);
        DetailSurfaceController.installEdgeSwipeDismiss(this, webView);
        applyWebViewSafePadding(webView, 0);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            webView.setOnApplyWindowInsetsListener((view, insets) -> {
                int navInset = insets.getInsets(WindowInsets.Type.navigationBars()).bottom;
                applyWebViewSafePadding(webView, navInset);
                return insets;
            });
        }
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
        root.addView(webView, webParams);
        webView.loadUrl(Uri.fromFile(html).toString());
        return root;
    }

    private File resolveHtmlPath(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            throw new IllegalArgumentException("Missing reply HTML path");
        }
        try {
            File file = new File(raw).getCanonicalFile();
            if (!isWithin(file, getFilesDir())
                    && !isWithin(file, getCacheDir())
                    && !isWithin(file, getExternalFilesDir(null))) {
                throw new IllegalArgumentException("Reply HTML path is outside app-owned storage");
            }
            if (!file.exists() || !file.isFile()) {
                throw new IllegalArgumentException("Reply HTML file not found");
            }
            return file;
        } catch (IllegalArgumentException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new IllegalArgumentException("Unable to open reply HTML: " + exc.getMessage(), exc);
        }
    }

    private static boolean isWithin(File file, File root) throws Exception {
        if (root == null) {
            return false;
        }
        String filePath = file.getCanonicalPath();
        String rootPath = root.getCanonicalPath();
        return filePath.equals(rootPath) || filePath.startsWith(rootPath + File.separator);
    }

    private void applyWebViewSafePadding(WebView webView, int bottomInsetPx) {
        int bottomPadding = Math.max(dp(WEB_DETAIL_BOTTOM_SAFE_PADDING_DP), bottomInsetPx + dp(28));
        webView.setPadding(0, 0, 0, bottomPadding);
    }

    @Override
    public void finish() {
        super.finish();
        DetailSurfaceController.applyCloseTransition(this);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
