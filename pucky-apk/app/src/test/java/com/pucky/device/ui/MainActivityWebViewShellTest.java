package com.pucky.device.ui;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.Test;

public final class MainActivityWebViewShellTest {
    @Test
    public void mainActivityOnlyBuildsWebViewVisibleUi() throws Exception {
        String source = read("src/main/java/com/pucky/device/MainActivity.java");

        assertTrue("MainActivity should keep explicit wake-screen behavior",
                source.contains("EXTRA_WAKE_SCREEN"));
        assertTrue("MainActivity should build exactly one WebView shell",
                source.contains("private View buildWebShellView()")
                        && source.contains("webShell.addJavascriptInterface(webBridge, \"PuckyAndroid\")")
                        && source.contains("webShell.setWebViewClient(new PuckyWebResourceClient(this))")
                        && count(source, "new WebView") == 1);
        assertTrue("MainActivity should always load the cached or bundled HTML entrypoint",
                source.contains("String url = uiBundleController.entrypointUrl();")
                        && source.contains("webShell.loadUrl(url)"));

        String[] forbidden = {
                "buildHomeView",
                "renderHome",
                "cardView(",
                "identityMark(",
                "audioIdentityButton(",
                "audioWaveformLine(",
                "showAudioSheet",
                "buildTranscriptPanel",
                "buildWebPanel",
                "showDetailPanel",
                "dismissDetailPanel",
                "COVER_FEED_BOTTOM_SAFE_PADDING_DP",
                "android.R.drawable.ic_dialog_email",
                "pucky_ic_",
                "WaveformView",
                "InteractivePanelController",
                "setAudioSessionId"
        };
        for (String needle : forbidden) {
            assertFalse("MainActivity should not contain old Java UI code: " + needle,
                    source.contains(needle));
        }
    }

    @Test
    public void javaOnlyKeepsNativeCapabilityBridgeAndFallbackHtml() throws Exception {
        String bridge = read("src/main/java/com/pucky/device/ui/PuckyWebBridge.java");
        String bundles = read("src/main/java/com/pucky/device/ui/UiBundleController.java");
        String fallback = read("src/main/assets/pucky_fallback/index.html");
        String player = read("src/main/java/com/pucky/device/player/PlayerController.java");

        assertTrue("HTML bridge should expose one Promise-style postMessage entrypoint",
                bridge.contains("@JavascriptInterface")
                        && bridge.contains("public void postMessage(String raw)")
                        && bridge.contains("window.Pucky&&window.Pucky.__resolve"));
        assertTrue("HTML bridge should allow explicit UI/player/file commands",
                bridge.contains("case \"ui.reply_cards.get\"")
                        && bridge.contains("case \"player.play\"")
                        && bridge.contains("case \"player.pause\"")
                        && bridge.contains("case \"player.seek\"")
                        && bridge.contains("case \"player.queue.set\"")
                        && bridge.contains("case \"pucky.turn.status\"")
                        && bridge.contains("case \"pucky.turn.settings.get\"")
                        && bridge.contains("case \"pucky.turn.settings.set\"")
                        && bridge.contains("case \"artifact.url\"")
                        && bridge.contains("case \"ui.bundle.status\"")
                        && bridge.contains("Command is not exposed to HTML UI"));
        assertFalse("HTML bridge should not expose raw shell execution",
                bridge.contains("shell.exec"));
        assertTrue("UI bundles should verify schema, entrypoint, bridge version, and file hashes",
                bundles.contains("pucky.ui_bundle.v1")
                        && bundles.contains("min_native_bridge_version")
                        && bundles.contains("sha256(file)")
                        && bundles.contains("UI bundle path traversal rejected"));
        assertTrue("UI bundles should atomically keep previous/current directories and fallback shell",
                bundles.contains("\"staging-\"")
                        && bundles.contains("renameTo(previous)")
                        && bundles.contains("renameTo(current)")
                        && bundles.contains("file:///android_asset/pucky_fallback/index.html"));
        assertTrue("Fallback asset should be bundled HTML, not Java UI",
                fallback.contains("Pucky is reconnecting")
                        && fallback.contains("cached HTML UI bundle"));
        assertTrue("Player queue should accept an allowed M3U playlist for audiobook cards",
                player.contains("playlist_path")
                        && player.contains("queueItemsFromPlaylist")
                        && player.contains("#EXTINF:")
                        && player.contains("Playlist must be an .m3u file"));
    }

    @Test
    public void webViewBridgeEmitsPuckyTurnStatusForCoverIndicators() throws Exception {
        String bridge = read("src/main/java/com/pucky/device/ui/PuckyWebBridge.java");
        String activity = read("src/main/java/com/pucky/device/MainActivity.java");

        assertTrue(bridge.contains("import com.pucky.device.pucky.PuckyTurnController;"));
        assertTrue(bridge.contains("case \"pucky.turn.status\":"));
        assertTrue(bridge.contains("return PuckyTurnController.shared(context).status();"));
        assertTrue(bridge.contains("case \"pucky.turn.settings.get\":"));
        assertTrue(bridge.contains("return PuckyTurnController.shared(context).settingsGet();"));
        assertTrue(bridge.contains("case \"pucky.turn.settings.set\":"));
        assertTrue(bridge.contains("return PuckyTurnController.shared(context).settingsSet(args);"));
        assertTrue(activity.contains("private void emitWebTurnStatus()"));
        assertTrue(activity.contains("webBridge.emit(\"pucky.turn.status\", PuckyTurnController.shared(this).status())"));
        assertTrue(activity.contains("emitWebPlayerState();\n            emitWebTurnStatus();")
                || activity.contains("emitWebPlayerState();\r\n            emitWebTurnStatus();"));
        assertTrue(activity.contains("emitWebPlayerState();\n        emitWebTurnStatus();")
                || activity.contains("emitWebPlayerState();\r\n        emitWebTurnStatus();"));
    }

    @Test
    public void webViewServesAppOwnedArtifactsAsLocalUrls() throws Exception {
        String client = read("src/main/java/com/pucky/device/ui/PuckyWebResourceClient.java");
        String artifacts = read("src/main/java/com/pucky/device/artifacts/ArtifactController.java");
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");

        assertTrue("WebView client should intercept only the trusted local artifact host",
                client.contains("TRUSTED_HOST = \"pucky.local\"")
                        && client.contains("shouldInterceptRequest")
                        && client.contains("\"/artifact\"")
                        && client.contains("request.getRequestHeaders()")
                        && client.contains("new ArtifactController(context).webResponse"));
        assertTrue("Artifact URLs should stream app-owned files with range support for media playback",
                artifacts.contains("pucky.artifact_url.v1")
                        && artifacts.contains("https")
                        && artifacts.contains("pucky.local")
                        && artifacts.contains("appendQueryParameter(\"path\"")
                        && artifacts.contains("Accept-Ranges")
                        && artifacts.contains("Content-Range")
                        && artifacts.contains("206, \"Partial Content\"")
                        && artifacts.contains("return \"video/mp4\";")
                        && artifacts.contains("return \"application/pdf\";")
                        && artifacts.contains("return \"application/vnd.openxmlformats-officedocument.wordprocessingml.document\";"));
        assertTrue("Native command executor should expose artifact.url for device testing too",
                executor.contains("\"artifact.url\"")
                        && executor.contains("return artifactController.url(command.args())"));
    }

    @Test
    public void nativeShellModeIsCollapsedToWebCached() throws Exception {
        String settings = read("src/main/java/com/pucky/device/storage/SettingsStore.java");
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String bridge = read("src/main/java/com/pucky/device/ui/PuckyWebBridge.java");

        assertTrue("SettingsStore should report WebView mode as the only shell mode",
                settings.contains("return \"web_cached\";")
                        && settings.contains("return true;")
                        && settings.contains("putString(UI_SHELL_MODE, \"web_cached\")"));
        assertTrue("Native command and HTML bridge shell mode setters should both normalize to WebView",
                executor.contains("optString(\"mode\", \"web_cached\")")
                        && bridge.contains("optString(\"mode\", \"web_cached\")"));
        assertFalse("SettingsStore should not normalize any request back to native",
                settings.contains("? \"web_cached\" : \"native\""));
    }

    @Test
    public void wakeNewIntentDoesNotForceWebViewBackHome() throws Exception {
        String source = read("src/main/java/com/pucky/device/MainActivity.java");

        assertFalse("onNewIntent should preserve the current WebView screen for wake-only intents",
                source.contains("handleLaunchIntent(intent);\n        showHomeScreen();"));
        assertTrue("Explicit show_home should remain the intentional reset path",
                source.contains("boolean showHomeRequested = intent.getBooleanExtra(\"show_home\", false);")
                        && source.contains("if (uiSurfaceChanged || showHomeRequested)")
                        && source.contains("showHomeScreen(showHomeRequested)")
                        && source.contains("loadWebShell(boolean resetNavigation)")
                        && source.contains("reset_nav=1"));
        assertFalse("ui_shell_mode is collapsed to web_cached and should not reload the UI by itself",
                source.contains("Set UI shell mode from launch extra: \" + settingsStore.getUiShellMode());\n            uiSurfaceChanged = true;"));
        assertTrue("UI bundle installs should still refresh the WebView surface",
                source.contains("if (intent.hasExtra(\"ui_bundle_path\"))")
                        && source.contains("uiSurfaceChanged = true;"));
    }

    @Test
    public void androidBackDelegatesToHtmlShellBeforeLeavingActivity() throws Exception {
        String source = read("src/main/java/com/pucky/device/MainActivity.java");
        String app = read("../../pucky_vm/ui_src/app.js");

        assertTrue("System back should ask the HTML shell to close active panels first",
                source.contains("window.PuckyHandleAndroidBack&&window.PuckyHandleAndroidBack()")
                        && source.contains("continueUnhandledBack()"));
        assertTrue("Unhandled back should keep the old WebView-history fallback",
                source.contains("private void continueUnhandledBack()")
                        && source.contains("webShell.canGoBack()")
                        && source.contains("webShell.goBack()")
                        && source.contains("super.onBackPressed()"));
        assertTrue("HTML shell should expose an Android back handler",
                app.contains("function handleAndroidBack()")
                        && app.contains("window.PuckyHandleAndroidBack = handleAndroidBack")
                        && app.contains("detail.querySelector(\".detail-back\")")
                        && app.contains("back.click()"));
    }

    @Test
    public void retiredJavaUiAssetsAreDeleted() {
        String[] retired = {
                "src/main/java/com/pucky/device/ui/WaveformView.java",
                "src/main/java/com/pucky/device/ui/InteractivePanelController.java",
                "src/main/res/drawable/pucky_ic_attachment.xml",
                "src/main/res/drawable/pucky_ic_bolt.xml",
                "src/main/res/drawable/pucky_ic_book.xml",
                "src/main/res/drawable/pucky_ic_calendar.xml",
                "src/main/res/drawable/pucky_ic_clock.xml",
                "src/main/res/drawable/pucky_ic_forward_30.xml",
                "src/main/res/drawable/pucky_ic_moon.xml",
                "src/main/res/drawable/pucky_ic_replay_15.xml",
                "src/main/res/drawable/pucky_ic_transcript.xml"
        };
        for (String path : retired) {
            assertFalse("Retired Java UI artifact should be deleted: " + path,
                    Files.exists(Path.of(path)));
        }
    }

    @Test
    public void manifestRetiresSeparateReplyActivities() throws Exception {
        String manifest = read("src/main/AndroidManifest.xml");

        assertFalse("RichReplyActivity should be retired",
                manifest.contains("android:name=\".RichReplyActivity\""));
        assertFalse("TranscriptActivity should be retired",
                manifest.contains("android:name=\".TranscriptActivity\""));
        assertFalse("RichReplyActivity source should be removed",
                Files.exists(Path.of("src/main/java/com/pucky/device/RichReplyActivity.java")));
        assertFalse("TranscriptActivity source should be removed",
                Files.exists(Path.of("src/main/java/com/pucky/device/TranscriptActivity.java")));
    }

    @Test
    public void replyCardCommandsAreAllowlistedAndRouted() throws Exception {
        String source = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");

        assertTrue(source.contains("\"ui.reply_cards.set\""));
        assertTrue(source.contains("\"ui.reply_cards.get\""));
        assertTrue(source.contains("\"ui.reply_cards.clear\""));
        assertTrue(source.contains("uiController.replyCardsSet"));
        assertTrue(source.contains("uiController.replyCardsGet"));
        assertTrue(source.contains("uiController.replyCardsClear"));
        assertTrue(source.contains("\"ui.bundle.status\""));
        assertTrue(source.contains("\"ui.bundle.install_downloaded\""));
        assertTrue(source.contains("\"ui.bundle.refresh\""));
        assertTrue(source.contains("\"ui.shell.mode.get\""));
        assertTrue(source.contains("\"ui.shell.mode.set\""));
        assertTrue(source.contains("uiBundleController.status()"));
        assertTrue(source.contains("uiBundleController.installDownloaded"));
        assertTrue(source.contains("uiBundleController.refresh"));
        assertTrue(source.contains("settingsStore.setUiShellMode"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }

    private static int count(String source, String needle) {
        int total = 0;
        int index = 0;
        while ((index = source.indexOf(needle, index)) >= 0) {
            total++;
            index += needle.length();
        }
        return total;
    }
}
