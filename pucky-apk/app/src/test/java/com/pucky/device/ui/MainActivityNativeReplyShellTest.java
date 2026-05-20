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
                "addJavascriptInterface",
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
        assertTrue("MainActivity should map clock and bolt icons to APK-owned drawables",
                source.contains("pucky_ic_clock") && source.contains("pucky_ic_bolt"));
        assertTrue("MainActivity should expose transcript and web-page action icons",
                source.contains("pucky_ic_transcript") && source.contains("pucky_ic_eye"));
        assertTrue("MainActivity should render the in-card audio player line",
                source.contains("audioPlayerLine()"));
        assertTrue("MainActivity should route transcripts to the native chat activity",
                source.contains("TranscriptActivity.class"));
        assertTrue("MainActivity should pause active audio before opening detail views",
                source.contains("pauseActiveAudio()"));
        assertTrue("Reply previews should allow two lines with ellipsis",
                source.contains("setMaxLines(2)") && source.contains("TextUtils.TruncateAt.END"));
        assertFalse("Reply tags should not be rendered in the feed",
                source.contains("card.tag()"));
        assertFalse("Reply emoji badges should not be rendered in the feed",
                source.contains("card.emoji()"));
    }

    @Test
    public void richReplyViewerIsLocalAndHasNoNativeBridge() throws Exception {
        String source = read("src/main/java/com/pucky/device/RichReplyActivity.java");

        assertTrue("Rich replies should use a WebView detail viewer",
                source.contains("new WebView"));
        assertTrue("Rich replies should allow normal page JavaScript",
                source.contains("setJavaScriptEnabled(true)"));
        assertFalse("Rich replies must not receive native bridge powers",
                source.contains("addJavascriptInterface"));
    }

    @Test
    public void manifestKeepsRichReplyActivityPrivate() throws Exception {
        String manifest = read("src/main/AndroidManifest.xml");

        assertTrue("RichReplyActivity must be declared",
                manifest.contains("android:name=\".RichReplyActivity\""));
        assertTrue("RichReplyActivity must not be exported",
                manifest.contains("android:name=\".RichReplyActivity\"")
                        && manifest.contains("android:exported=\"false\""));
        assertTrue("TranscriptActivity must be declared private",
                manifest.contains("android:name=\".TranscriptActivity\"")
                        && manifest.contains("android:exported=\"false\""));
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
    }

    private static String read(String path) throws Exception {
        return new String(Files.readAllBytes(Path.of(path)), StandardCharsets.UTF_8);
    }
}
