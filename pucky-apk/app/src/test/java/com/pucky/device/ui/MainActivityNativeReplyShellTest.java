package com.pucky.device.ui;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.Test;

public final class MainActivityNativeReplyShellTest {
    @Test
    public void mainActivityNoLongerLoadsVmPortalHome() throws Exception {
        String source = read("src/main/java/com/pucky/device/MainActivity.java");

        String[] forbidden = {
                "HOME_PORTAL_PATH",
                "/pucky-home",
                "loadHomePortal",
                "PuckyAndroidBridge",
                "PuckyWebBridgePolicy",
                "theme_owner",
                "vm_html"
        };
        for (String needle : forbidden) {
            assertFalse("MainActivity should not contain old portal home code: " + needle,
                    source.contains(needle));
        }
        assertTrue("MainActivity should render native reply cards",
                source.contains("ReplyCardStore"));
        assertTrue("MainActivity should keep explicit wake-screen behavior",
                source.contains("EXTRA_WAKE_SCREEN"));
        assertTrue("MainActivity should render a simple reply identity mark",
                source.contains("identityMark(card)"));
        assertTrue("MainActivity should use the original Android mail header icon",
                source.contains("android.R.drawable.ic_dialog_email"));
        assertTrue("MainActivity should map feed icons to APK-owned drawables",
                source.contains("pucky_ic_clock") && source.contains("pucky_ic_bolt")
                        && source.contains("pucky_ic_calendar") && source.contains("pucky_ic_moon"));
        assertTrue("MainActivity should keep reply cards scrollable above the cover navigation area",
                source.contains("COVER_FEED_BOTTOM_SAFE_PADDING_DP")
                        && source.contains("setClipToPadding(false)")
                        && source.contains("cover_feed_bottom_safe_spacer")
                        && source.contains("applyFeedScrollSafePadding(scroll"));
        assertTrue("MainActivity should expose transcript and attachment action icons",
                source.contains("pucky_ic_transcript") && source.contains("pucky_ic_attachment"));
        assertTrue("MainActivity should render title-preserving in-card waveform audio",
                source.contains("audioWaveformLine(card)") && source.contains("setAudioSessionId"));
        assertTrue("Card waveform should be compact instead of spanning the whole card body",
                source.contains("audio_waveform_row_")
                        && source.contains("row.addView(waveform, new LinearLayout.LayoutParams(0, dp(32), 1f))")
                        && source.contains("row.addView(new View(this), new LinearLayout.LayoutParams(0, dp(32), 1f))"));
        assertTrue("MainActivity should update audio progress without the old one-second full repaint loop",
                source.contains("AUDIO_PROGRESS_TICK_MS = 80L")
                        && source.contains("updateAudioProgressControls(state)")
                        && !source.contains("mainHandler.postDelayed(playerTick, 1_000L)"));
        assertTrue("Audio sheet rendering should preserve the active waveform view unless a rebuild is needed",
                source.contains("audioSheetNeedsRebuild")
                        && source.contains("renderedAudioSheetPath")
                        && source.contains("waveform.setCapturePriority(1)"));
        assertTrue("MainActivity should offer an overlay playback speed picker",
                source.contains("speedPickerOverlay") && source.contains("renderSpeedPickerOverlay()")
                        && source.contains(".speed(args)"));
        assertFalse("Playback speed choices should not be inserted into the audio card body",
                source.contains("stack.addView(speedPicker"));
        assertTrue("MainActivity should keep audio control on the left identity icon",
                source.contains("audioIdentityButton(card)") && source.contains("toggleReplyAudio(card)"));
        assertFalse("Card bodies should no longer cycle play/pause/hide",
                source.contains("setOnClickListener(view -> handleReplyCardTap(card))"));
        assertTrue("MainActivity should route transcripts and HTML into in-activity panels",
                source.contains("buildTranscriptPanel(card)") && source.contains("buildWebPanel(card)"));
        assertFalse("Detail view opens should not pause active audio",
                source.contains("pauseActiveAudio();\n        showDetailPanel"));
        assertTrue("Reply previews should allow two lines with ellipsis",
                source.contains("setMaxLines(2)") && source.contains("TextUtils.TruncateAt.END"));
        assertFalse("Reply tags should not be rendered in the feed",
                source.contains("card.tag()"));
        assertFalse("Reply emoji badges should not be rendered in the feed",
                source.contains("card.emoji()"));
        assertTrue("MainActivity should support the new cached HTML shell as a feature-flagged surface",
                source.contains("buildWebShellView()")
                        && source.contains("UiBundleController")
                        && source.contains("settingsStore.isWebCachedUiEnabled()")
                        && source.contains("webShell.addJavascriptInterface(webBridge, \"PuckyAndroid\")"));
        assertTrue("ADB launch extras should be able to install and switch a cached UI bundle for parity tests",
                source.contains("\"ui_bundle_path\"") && source.contains("\"ui_shell_mode\""));
    }

    @Test
    public void waveformViewUsesAndroidVisualizerWithIdleFallback() throws Exception {
        String source = read("src/main/java/com/pucky/device/ui/WaveformView.java");
        String player = read("src/main/java/com/pucky/device/player/PlayerController.java");

        assertTrue("WaveformView should use Android's audio-session Visualizer",
                source.contains("android.media.audiofx.Visualizer")
                        && source.contains("new Visualizer(audioSessionId)")
                        && source.contains("TARGET_CAPTURE_RATE_MHZ = 30_000")
                        && source.contains("TARGET_CAPTURE_SIZE = 256"));
        assertTrue("WaveformView should use waveform capture rather than FFT for v1",
                source.contains("onWaveFormDataCapture")
                        && source.contains("captureRate, true, false"));
        assertTrue("WaveformView should keep a safe idle fallback if capture fails",
                source.contains("visualizerUnavailable")
                        && source.contains("drawIdleWaveform"));
        assertTrue("WaveformView should render voice-memo style vertical energy ticks, not a continuous graph line",
                source.contains("canvas.drawLine(x, center - halfHeight, x, center + halfHeight, paint)")
                        && source.contains("System.arraycopy(levels, 1, levels, 0, SAMPLE_COUNT - 1)")
                        && !source.contains("android.graphics.Path"));
        assertTrue("WaveformView should gate RMS energy so quiet speech stays near the center line",
                source.contains("adaptiveFloor")
                        && source.contains("adaptivePeak")
                        && source.contains("updateAdaptiveRange(rms)")
                        && source.contains("normalized < 0.18f"));
        assertFalse("WaveformView should not make every capture tall by mixing in raw peak energy",
                source.contains("peak *"));
        assertTrue("WaveformView should preserve session history and avoid multiple views fighting over one Visualizer",
                source.contains("SESSION_LEVEL_HISTORY")
                        && source.contains("activeCaptureOwner")
                        && source.contains("claimCaptureOwnership"));
        assertFalse("Waveform fallback should not fake an oscillating live waveform",
                source.contains("System.currentTimeMillis()"));
        assertTrue("Player state should expose the active audio session id",
                player.contains("\"audio_session_id\"")
                        && player.contains("getAudioSessionId()"));
        assertTrue("Player queue should accept an allowed M3U playlist for audiobook cards",
                player.contains("playlist_path")
                        && player.contains("queueItemsFromPlaylist")
                        && player.contains("#EXTINF:")
                        && player.contains("Playlist must be an .m3u file"));
    }

    @Test
    public void richReplyViewerIsLocalPanelAndOnlyShellHasNativeBridge() throws Exception {
        String source = read("src/main/java/com/pucky/device/MainActivity.java");
        String webPanel = section(source, "private View buildWebPanel", "private View buildTranscriptPanel");

        assertTrue("Rich replies should use a WebView detail viewer",
                source.contains("new WebView"));
        assertTrue("Rich replies should allow normal page JavaScript",
                source.contains("setJavaScriptEnabled(true)"));
        assertTrue("Rich replies should use interactive right-swipe dismiss instead of a visible native back button",
                source.contains("InteractivePanelController.installRightSwipeDismiss(webView"));
        assertFalse("Rich replies should not render the old blue native back button",
                source.contains("back.setText(\"<\")") || source.contains("webParams.topMargin"));
        assertFalse("Rich replies should not reserve a top margin",
                source.contains("webParams.topMargin"));
        assertTrue("Rich replies should keep scrollable page content above the cover navigation area",
                source.contains("applyWebViewSafePadding(webView"));
        assertTrue("Only the cached shell should receive the PuckyAndroid bridge",
                count(source, "addJavascriptInterface") == 1
                        && source.contains("webShell.addJavascriptInterface(webBridge, \"PuckyAndroid\")"));
        assertFalse("Rich reply panels must not receive native bridge powers",
                webPanel.contains("addJavascriptInterface"));
    }

    @Test
    public void detailSurfacesAndAudioSheetDragInteractively() throws Exception {
        String main = read("src/main/java/com/pucky/device/MainActivity.java");
        String controller = read("src/main/java/com/pucky/device/ui/InteractivePanelController.java");

        assertTrue("MainActivity should keep detail panels layered over the feed",
                main.contains("detailPanelLayer") && main.contains("showDetailPanel"));
        assertTrue("MainActivity should slide detail surfaces in from the right",
                main.contains("InteractivePanelController.slideInFromRight(panel)"));
        assertTrue("Transcript detail should install the same right-swipe dismiss behavior",
                main.contains("InteractivePanelController.installRightSwipeDismiss(scroll"));
        assertTrue("Audio should have a full-screen slide-up control sheet",
                main.contains("audioSheetLayer") && main.contains("InteractivePanelController.slideUp")
                        && main.contains("InteractivePanelController.installDownSwipeDismiss"));
        assertTrue("Audio sheet slide-up should be slower and eased separately from quick detail slides",
                controller.contains("SLIDE_UP_ANIMATION_MS = 340L")
                        && controller.contains("DecelerateInterpolator"));
        assertTrue("Swipe dismiss helper should drag the panel with the finger and snap or dismiss",
                controller.contains("setTranslationX(offset)") && controller.contains("setTranslationY(offset)")
                        && controller.contains("snapBack()") && controller.contains("DISMISS_FRACTION"));
        assertFalse("Old activity transition animations should be gone",
                Files.exists(Path.of("src/main/res/anim/pucky_detail_slide_in_right.xml"))
                        || Files.exists(Path.of("src/main/res/anim/pucky_detail_slide_out_right.xml"))
                        || Files.exists(Path.of("src/main/res/anim/pucky_detail_hold.xml")));
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

    @Test
    public void cachedHtmlUiShellHasVerifiedBundleAndBridgeBoundary() throws Exception {
        String bridge = read("src/main/java/com/pucky/device/ui/PuckyWebBridge.java");
        String bundles = read("src/main/java/com/pucky/device/ui/UiBundleController.java");
        String fallback = read("src/main/assets/pucky_fallback/index.html");

        assertTrue("HTML bridge should expose one Promise-style postMessage entrypoint",
                bridge.contains("@JavascriptInterface")
                        && bridge.contains("public void postMessage(String raw)")
                        && bridge.contains("window.Pucky&&window.Pucky.__resolve"));
        assertTrue("HTML bridge should allow only explicit UI/player/file commands",
                bridge.contains("case \"ui.reply_cards.get\"")
                        && bridge.contains("case \"player.play\"")
                        && bridge.contains("case \"player.pause\"")
                        && bridge.contains("case \"player.seek\"")
                        && bridge.contains("case \"player.queue.set\"")
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
        assertTrue("Fallback asset should be a tiny bundled offline shell",
                fallback.contains("Pucky is reconnecting")
                        && fallback.contains("cached HTML UI bundle"));
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }

    private static String section(String source, String startNeedle, String endNeedle) {
        int start = source.indexOf(startNeedle);
        int end = source.indexOf(endNeedle, start + startNeedle.length());
        if (start < 0 || end < 0) {
            return "";
        }
        return source.substring(start, end);
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
