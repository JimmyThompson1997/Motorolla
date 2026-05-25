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
                        && source.contains("webShell.setWebViewClient(new PuckyWebResourceClient(this, uiBundleController, uiSurfaceController))")
                        && count(source, "new WebView") == 1);
        assertTrue("MainActivity should always load the cached or bundled HTML entrypoint",
                source.contains("String url = uiBundleController.entrypointUrl();")
                        && source.contains("uiSurfaceController.recordRequested(url, uiBundleController);")
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
                        && bridge.contains("case \"pucky.turn.arrival_cue.test\"")
                        && bridge.contains("case \"pucky.turn.sent_cue.test\"")
                        && bridge.contains("case \"pucky.turn.received_cue.test\"")
                        && bridge.contains("case \"pucky.turn.chime.test\"")
                        && bridge.contains("case \"wake.status\"")
                        && bridge.contains("case \"wake.start\"")
                        && bridge.contains("case \"wake.stop\"")
                        && bridge.contains("case \"location.tracker.status\"")
                        && bridge.contains("case \"location.tracker.start\"")
                        && bridge.contains("case \"location.tracker.stop\"")
                        && bridge.contains("case \"location.tracker.query\"")
                        && bridge.contains("case \"artifact.url\"")
                        && bridge.contains("case \"ui.bundle.status\"")
                        && bridge.contains("case \"ui.surface.get\"")
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
        assertTrue("UI bundle status should expose installed source provenance",
                bundles.contains("source_commit_full")
                        && bundles.contains("source_commit_short")
                        && bundles.contains("source_branch")
                        && bundles.contains("source_dirty"));
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
        assertTrue(bridge.contains("case \"pucky.turn.arrival_cue.test\":"));
        assertTrue(bridge.contains("case \"pucky.turn.sent_cue.test\":"));
        assertTrue(bridge.contains("case \"pucky.turn.received_cue.test\":"));
        assertTrue(bridge.contains("return PuckyTurnController.shared(context).arrivalCueTest(args);"));
        assertTrue(bridge.contains("return PuckyTurnController.shared(context).sentCueTest(args);"));
        assertTrue(bridge.contains("return PuckyTurnController.shared(context).receivedCueTest(args);"));
        assertTrue(bridge.contains("case \"pucky.turn.chime.test\":"));
        assertTrue(bridge.contains("return PuckyTurnController.shared(context).chimeTest(args);"));
        assertTrue(bridge.contains("case \"wake.status\":"));
        assertTrue(bridge.contains("case \"wake.start\":"));
        assertTrue(bridge.contains("case \"wake.stop\":"));
        assertTrue(bridge.contains("case \"ui.surface.get\":"));
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
    public void uiSurfaceControllerTracksBundleProvenance() throws Exception {
        String activity = read("src/main/java/com/pucky/device/MainActivity.java");
        String client = read("src/main/java/com/pucky/device/ui/PuckyWebResourceClient.java");
        String surface = read("src/main/java/com/pucky/device/ui/UiSurfaceController.java");

        assertTrue(activity.contains("new UiSurfaceController(this)"));
        assertTrue(activity.contains("uiSurfaceController.recordRequested(url, uiBundleController);"));
        assertTrue(client.contains("public void onPageFinished(WebView view, String url)"));
        assertTrue(client.contains("uiSurface.recordLoaded(url, uiBundles);"));
        assertTrue(surface.contains("\"pucky.ui_surface.v1\""));
        assertTrue(surface.contains("\"bundle_current\""));
        assertTrue(surface.contains("\"fallback_asset\""));
        assertTrue(surface.contains("\"legacy_placeholder\""));
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
        String uiController = read("src/main/java/com/pucky/device/ui/PuckyUiController.java");

        assertTrue(source.contains("\"ui.reply_cards.set\""));
        assertTrue(source.contains("\"ui.reply_cards.get\""));
        assertTrue(source.contains("\"ui.reply_cards.clear\""));
        assertTrue(source.contains("uiController.replyCardsSet"));
        assertTrue(source.contains("uiController.replyCardsGet"));
        assertTrue(source.contains("uiController.replyCardsClear"));
        assertTrue(uiController.contains("import com.pucky.device.pucky.PuckyFeedController;"));
        assertTrue(uiController.contains("return PuckyFeedController.shared(context).snapshot();"));
        assertTrue(source.contains("\"ui.bundle.status\""));
        assertTrue(source.contains("\"ui.bundle.install_downloaded\""));
        assertTrue(source.contains("\"ui.bundle.refresh\""));
        assertTrue(source.contains("\"ui.surface.get\""));
        assertTrue(source.contains("\"ui.shell.mode.get\""));
        assertTrue(source.contains("\"ui.shell.mode.set\""));
        assertTrue(source.contains("uiBundleController.status()"));
        assertTrue(source.contains("uiBundleController.installDownloaded"));
        assertTrue(source.contains("uiBundleController.refresh"));
        assertTrue(source.contains("settingsStore.setUiShellMode"));
    }

    @Test
    public void remoteAdbTunnelSurfaceIsRemovedAndBrokerDefaultsToPucky() throws Exception {
        String settings = read("src/main/java/com/pucky/device/storage/SettingsStore.java");
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String service = read("src/main/java/com/pucky/device/service/PuckyForegroundService.java");
        String status = read("src/main/java/com/pucky/device/status/StatusProvider.java");
        String capabilities = read("src/main/java/com/pucky/device/capabilities/CapabilityReporter.java");
        String manifest = read("src/main/AndroidManifest.xml");

        assertTrue("Broker default should point at the consolidated pucky service",
                settings.contains("wss://pucky.fly.dev/v1/devices/"));
        assertTrue("SettingsStore should only keep legacy remote ADB cleanup metadata",
                settings.contains("LEGACY_REMOTE_ADB_KEYS")
                        && settings.contains("LEGACY_REMOTE_ADB_PREFIXES")
                        && settings.contains("\"remote_adb_\"")
                        && settings.contains("\"tunnel_\""));
        assertFalse("SettingsStore should not keep tunnel provisioning fields alive",
                settings.contains("\"tunnel\""));
        assertFalse("Executor should not expose retired tunnel or remote ADB commands",
                executor.contains("\"tunnel.status\"")
                        || executor.contains("\"tunnel.config.set\"")
                        || executor.contains("\"tunnel.start\"")
                        || executor.contains("\"tunnel.stop\"")
                        || executor.contains("\"adb.remote.status\"")
                        || executor.contains("\"adb.remote.reconnect\"")
                        || executor.contains("\"adb.wifi.enable\""));
        assertFalse("Foreground service should not instantiate tunnel or remote ADB controllers",
                service.contains("TunnelController")
                        || service.contains("RemoteAdbController")
                        || service.contains("ensureTunnelStarted")
                        || service.contains("stopTunnel()"));
        assertFalse("Status and capability reports should not mention tunnel state",
                status.contains("\"tunnel\"")
                        || capabilities.contains("ssh.reverse_tunnel")
                        || capabilities.contains("adb.remote")
                        || capabilities.contains("adb.wifi_lifeline"));
        assertFalse("Manifest should not request WRITE_SECURE_SETTINGS for the removed tunnel lane",
                manifest.contains("WRITE_SECURE_SETTINGS"));
        assertFalse("RemoteAdbController source should be deleted",
                Files.exists(Path.of("src/main/java/com/pucky/device/adb/RemoteAdbController.java")));
        assertFalse("TunnelController source should be deleted",
                Files.exists(Path.of("src/main/java/com/pucky/device/tunnel/TunnelController.java")));
        assertFalse("TlsSniProxy source should be deleted",
                Files.exists(Path.of("src/main/java/com/pucky/device/tunnel/TlsSniProxy.java")));
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
