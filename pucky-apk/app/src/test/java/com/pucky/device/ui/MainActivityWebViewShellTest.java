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
        assertTrue("MainActivity should load the hosted VM HTML entrypoint",
                source.contains("HOSTED_UI_URL = \"https://pucky.fly.dev/ui/pucky/latest/index.html\"")
                        && source.contains("String url = hostedUiUrl();")
                        && source.contains("uiSurfaceController.recordRequested(url, uiBundleController);")
                        && source.contains("webShell.loadUrl(url)"));
        assertFalse("MainActivity should not load the local bundle as the normal UI entrypoint",
                source.contains("String url = uiBundleController.entrypointUrl();"));
        assertFalse("MainActivity should not emit native feed snapshots into the hosted UI",
                source.contains("emitWebFeedUpdated")
                        || source.contains("PuckyFeedController.shared(this).syncAsync(\"activity_resume\")"));

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
                bridge.contains("case \"ui.default_audio_speed.get\"")
                        && bridge.contains("case \"ui.default_audio_speed.set\"")
                        && bridge.contains("case \"browser.open\"")
                        && bridge.contains("case \"player.asset.prepare\"")
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
                        && bridge.contains("case \"voice.thread_scope.get\"")
                        && bridge.contains("case \"voice.thread_scope.set\"")
                        && bridge.contains("case \"voice.thread_scope.clear\"")
                        && bridge.contains("case \"wake.status\"")
                        && bridge.contains("case \"wake.start\"")
                        && bridge.contains("case \"wake.stop\"")
                        && bridge.contains("case \"location.tracker.status\"")
                        && bridge.contains("case \"location.tracker.start\"")
                        && bridge.contains("case \"location.tracker.stop\"")
                        && bridge.contains("case \"location.tracker.query\"")
                        && bridge.contains("case \"phone.role.status\"")
                        && bridge.contains("case \"phone.role.request_setup\"")
                        && bridge.contains("case \"phone.role.open_default_apps_settings\"")
                        && bridge.contains("case \"artifact.url\"")
                        && bridge.contains("case \"media.cache.status\"")
                        && bridge.contains("case \"media.cache.ensure\"")
                        && bridge.contains("case \"meeting.recording.resolve_audio_link\"")
                        && bridge.contains("case \"ui.bundle.status\"")
                        && bridge.contains("case \"ui.surface.get\"")
                        && bridge.contains("Command is not exposed to HTML UI"));
        assertFalse("HTML bridge should not expose local feed/reply-card UI commands",
                bridge.contains("case \"ui.reply_cards.get\"")
                        || bridge.contains("case \"pucky.feed.cache.get\"")
                        || bridge.contains("case \"pucky.feed.sync\"")
                        || bridge.contains("case \"pucky.feed.action\""));
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
        assertTrue(bridge.contains("case \"voice.thread_scope.get\":"));
        assertTrue(bridge.contains("return VoiceThreadScopeController.shared(context).get();"));
        assertTrue(bridge.contains("case \"voice.thread_scope.set\":"));
        assertTrue(bridge.contains("return VoiceThreadScopeController.shared(context).set(args);"));
        assertTrue(bridge.contains("case \"voice.thread_scope.clear\":"));
        assertTrue(bridge.contains("return VoiceThreadScopeController.shared(context).clear(args);"));
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
    public void nativeShellModeAlsoPersistsDefaultTilePlaybackSpeed() throws Exception {
        String settings = read("src/main/java/com/pucky/device/storage/SettingsStore.java");
        String bridge = read("src/main/java/com/pucky/device/ui/PuckyWebBridge.java");

        assertTrue(settings.contains("DEFAULT_TILE_AUDIO_SPEED"));
        assertTrue(settings.contains("getDefaultTileAudioSpeed()"));
        assertTrue(settings.contains("setDefaultTileAudioSpeed(float speed)"));
        assertTrue(bridge.contains("case \"ui.default_audio_speed.get\":"));
        assertTrue(bridge.contains("case \"ui.default_audio_speed.set\":"));
        assertTrue(bridge.contains("settings.setDefaultTileAudioSpeed"));
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
        assertTrue("Media cache commands should be exposed to both HTML and command broker",
                executor.contains("\"media.cache.status\"")
                        && executor.contains("\"media.cache.ensure\"")
                        && executor.contains("new MediaCacheController(settingsStore.context(), settingsStore).status(command.args())")
                        && executor.contains("new MediaCacheController(settingsStore.context(), settingsStore).ensure(command.args())"));
        assertTrue("Meeting HTML audio rewrite should have a native local-audio bridge",
                client.contains("TRUSTED_HOST = \"pucky.local\"")
                        && executor.contains("\"meeting.recording.resolve_audio_link\"")
                        && read("src/main/java/com/pucky/device/ui/PuckyWebBridge.java").contains("case \"meeting.recording.resolve_audio_link\":"));
        assertTrue("HTML bridge should expose phone role controls for the hosted settings surface",
                read("src/main/java/com/pucky/device/ui/PuckyWebBridge.java").contains("return PhoneRoleController.status(context);")
                        && read("src/main/java/com/pucky/device/ui/PuckyWebBridge.java").contains("return PhoneRoleController.requestSetup(")
                        && read("src/main/java/com/pucky/device/ui/PuckyWebBridge.java").contains("return PhoneRoleController.openDefaultAppsSettings(context);"));
    }

    @Test
    public void uiSurfaceControllerTracksBundleProvenance() throws Exception {
        String activity = read("src/main/java/com/pucky/device/MainActivity.java");
        String client = read("src/main/java/com/pucky/device/ui/PuckyWebResourceClient.java");
        String surface = read("src/main/java/com/pucky/device/ui/UiSurfaceController.java");
        String automation = read("src/main/java/com/pucky/device/ui/UiAutomationController.java");

        assertTrue(activity.contains("new UiSurfaceController(this)"));
        assertTrue(activity.contains("UiAutomationController.attach(webShell);"));
        assertTrue(activity.contains("UiAutomationController.detach(webShell);"));
        assertTrue(activity.contains("uiSurfaceController.recordRequested(url, uiBundleController);"));
        assertTrue(client.contains("public void onPageFinished(WebView view, String url)"));
        assertTrue(client.contains("uiSurface.recordLoaded(url, uiBundles);"));
        assertTrue(surface.contains("\"pucky.ui_surface.v1\""));
        assertTrue(surface.contains("\"bundle_current\""));
        assertTrue(surface.contains("\"hosted_vm\""));
        assertTrue(surface.contains("\"fallback_asset\""));
        assertTrue(surface.contains("\"legacy_placeholder\""));
        assertTrue(surface.contains("\"live_ui_version\""));
        assertTrue(surface.contains("\"bundle_ui_version\""));
        assertTrue(surface.contains("\"route\""));
        assertTrue(surface.contains("\"detail\""));
        assertTrue(surface.contains("\"thread_scope\""));
        assertTrue(surface.contains("\"voice_status\""));
        assertTrue(surface.contains("\"visible_cards\""));
        assertTrue(surface.contains("UiAutomationController.describe()"));
        assertTrue(automation.contains("evaluateJavascript"));
        assertTrue(automation.contains("window.PuckyUiDebug&&window.PuckyUiDebug.describe"));
        assertTrue(automation.contains("window.PuckyUiDebug&&window.PuckyUiDebug.dispatch"));
    }

    @Test
    public void nativeShellModeIsCollapsedToHostedWeb() throws Exception {
        String settings = read("src/main/java/com/pucky/device/storage/SettingsStore.java");
        String executor = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String bridge = read("src/main/java/com/pucky/device/ui/PuckyWebBridge.java");

        assertTrue("SettingsStore should report hosted WebView mode as the only shell mode",
                settings.contains("return \"web_hosted\";")
                        && settings.contains("return false;")
                        && settings.contains("putString(UI_SHELL_MODE, \"web_hosted\")"));
        assertTrue("Native command and HTML bridge shell mode setters should both normalize to hosted WebView",
                executor.contains("optString(\"mode\", \"web_hosted\")")
                        && bridge.contains("optString(\"mode\", \"web_hosted\")"));
        assertFalse("SettingsStore should not normalize any request back to native",
                settings.contains("? \"web_hosted\" : \"native\""));
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
        assertFalse("ui_shell_mode is collapsed to hosted web and should not reload the UI by itself",
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
                        && app.contains("detail.querySelector(\".light-back-button, .detail-back\")")
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
    public void replyCardCommandsAreNotPartOfTheVisibleUiBridge() throws Exception {
        String source = read("src/main/java/com/pucky/device/command/NativeCommandExecutor.java");
        String uiController = read("src/main/java/com/pucky/device/ui/PuckyUiController.java");
        String intentController = read("src/main/java/com/pucky/device/intents/IntentController.java");

        assertFalse(source.contains("\"ui.reply_cards.set\""));
        assertFalse(source.contains("\"ui.reply_cards.merge\""));
        assertFalse(source.contains("\"ui.reply_cards.get\""));
        assertFalse(source.contains("\"ui.reply_cards.clear\""));
        assertFalse(source.contains("\"pucky.feed.cache.get\""));
        assertFalse(source.contains("\"pucky.feed.sync\""));
        assertFalse(source.contains("\"pucky.feed.action\""));
        assertFalse(source.contains("uiController.replyCardsSet"));
        assertFalse(source.contains("uiController.replyCardsMerge"));
        assertFalse(source.contains("uiController.replyCardsGet"));
        assertFalse(source.contains("uiController.replyCardsClear"));
        assertFalse(uiController.contains("import com.pucky.device.pucky.PuckyFeedController;"));
        assertFalse(uiController.contains("replyCardsSet"));
        assertFalse(uiController.contains("replyCardsMerge"));
        assertFalse(uiController.contains("replyCardsGet"));
        assertFalse(uiController.contains("replyCardsClear"));
        assertTrue(source.contains("\"ui.bundle.status\""));
        assertTrue(source.contains("\"ui.bundle.install_downloaded\""));
        assertTrue(source.contains("\"ui.bundle.refresh\""));
        assertTrue(source.contains("\"ui.surface.get\""));
        assertTrue(source.contains("\"ui.debug.goto_home\""));
        assertTrue(source.contains("\"ui.debug.back\""));
        assertTrue(source.contains("\"ui.debug.focus_card\""));
        assertTrue(source.contains("\"ui.debug.clear_focus\""));
        assertTrue(source.contains("\"ui.debug.refresh_cards\""));
        assertTrue(source.contains("\"ui.debug.open_card_action\""));
        assertTrue(source.contains("\"voice.thread_scope.get\""));
        assertTrue(source.contains("\"voice.thread_scope.set\""));
        assertTrue(source.contains("\"voice.thread_scope.clear\""));
        assertTrue(source.contains("\"ui.shell.mode.get\""));
        assertTrue(source.contains("\"ui.shell.mode.set\""));
        assertTrue(source.contains("uiController.surfaceGet(uiBundleController)"));
        assertTrue(source.contains("uiController.voiceThreadScopeGet()"));
        assertTrue(source.contains("uiController.voiceThreadScopeSet(command.args())"));
        assertTrue(source.contains("uiController.voiceThreadScopeClear(command.args())"));
        assertTrue(source.contains("uiController.debugGotoHome(command.args())"));
        assertTrue(source.contains("uiController.debugBack(command.args())"));
        assertTrue(source.contains("uiController.debugFocusCard(command.args())"));
        assertTrue(source.contains("uiController.debugClearFocus(command.args())"));
        assertTrue(source.contains("uiController.debugRefreshCards(command.args())"));
        assertTrue(source.contains("uiController.debugOpenCardAction(command.args())"));
        assertTrue(source.contains("uiBundleController.status()"));
        assertTrue(source.contains("uiBundleController.installDownloaded"));
        assertTrue(source.contains("uiBundleController.refresh"));
        assertTrue(source.contains("settings.getConfiguredPuckyApiToken()"));
        assertTrue(source.contains("Json.put(out, \"api_token\", apiToken);"));
        assertTrue(source.contains("Json.put(out, \"has_api_token\", !apiToken.trim().isEmpty());"));
        assertTrue(source.contains("settingsStore.setUiShellMode"));
        assertTrue(intentController.contains("Intent.CATEGORY_BROWSABLE"));
        assertTrue(intentController.contains("args.optBoolean(\"require_resolvable\", false)"));
        assertTrue(uiController.contains("public JSONObject surfaceGet(UiBundleController bundles)"));
        assertTrue(uiController.contains("public JSONObject voiceThreadScopeGet()"));
        assertTrue(uiController.contains("public JSONObject voiceThreadScopeSet(JSONObject args)"));
        assertTrue(uiController.contains("public JSONObject voiceThreadScopeClear(JSONObject args)"));
        assertTrue(uiController.contains("public JSONObject debugGotoHome(JSONObject args)"));
        assertTrue(uiController.contains("public JSONObject debugBack(JSONObject args)"));
        assertTrue(uiController.contains("public JSONObject debugFocusCard(JSONObject args)"));
        assertTrue(uiController.contains("public JSONObject debugClearFocus(JSONObject args)"));
        assertTrue(uiController.contains("public JSONObject debugRefreshCards(JSONObject args)"));
        assertTrue(uiController.contains("public JSONObject debugOpenCardAction(JSONObject args)"));
        assertTrue(read("src/main/java/com/pucky/device/ui/UiSurfaceController.java").contains("\"focused_card\""));
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

    @Test
    public void hostedHtmlUiWebViewSupportsRealFileChooserForComposerAttachments() throws Exception {
        String activity = read("src/main/java/com/pucky/device/MainActivity.java");

        assertTrue(activity.contains("webShell.setWebChromeClient("));
        assertTrue(activity.contains("onShowFileChooser("));
        assertTrue(activity.contains("pendingWebFileChooserCallback"));
        assertTrue(activity.contains("REQUEST_WEB_FILE_CHOOSER"));
        assertTrue(activity.contains("Intent.EXTRA_ALLOW_MULTIPLE"));
        assertTrue(activity.contains("startActivityForResult("));
        assertTrue(activity.contains("onActivityResult("));
        assertTrue(activity.contains("WebChromeClient.FileChooserParams.parseResult("));
        assertTrue(activity.contains("callback.onReceiveValue(results);")
                || activity.contains("pendingWebFileChooserCallback.onReceiveValue(results);"));
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
