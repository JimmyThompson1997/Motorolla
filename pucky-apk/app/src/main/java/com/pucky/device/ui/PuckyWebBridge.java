package com.pucky.device.ui;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.pucky.device.artifacts.ArtifactController;
import com.pucky.device.command.CommandErrorCodes;
import com.pucky.device.command.CommandException;
import com.pucky.device.files.FileDownloadController;
import com.pucky.device.player.PlayerController;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;

import org.json.JSONObject;

import java.lang.ref.WeakReference;

public final class PuckyWebBridge {
    private final Context context;
    private final WeakReference<WebView> webView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ReplyCardStore replyCards;
    private final UiBundleController uiBundles;
    private final SettingsStore settings;

    public PuckyWebBridge(Context context, WebView webView, ReplyCardStore replyCards,
            UiBundleController uiBundles, SettingsStore settings) {
        this.context = context.getApplicationContext();
        this.webView = new WeakReference<>(webView);
        this.replyCards = replyCards;
        this.uiBundles = uiBundles;
        this.settings = settings;
    }

    @JavascriptInterface
    public void postMessage(String raw) {
        new Thread(() -> handle(raw), "pucky-web-bridge").start();
    }

    public void emit(String name, JSONObject payload) {
        WebView target = webView.get();
        if (target == null) {
            return;
        }
        String script = "window.Pucky&&window.Pucky.__event&&window.Pucky.__event("
                + JSONObject.quote(name) + "," + payload.toString() + ");";
        mainHandler.post(() -> target.evaluateJavascript(script, null));
    }

    private void handle(String raw) {
        String id = "";
        try {
            JSONObject message = new JSONObject(raw == null ? "{}" : raw);
            id = message.optString("id", "");
            String command = message.optString("command", "");
            JSONObject args = message.optJSONObject("args");
            if (args == null) {
                args = new JSONObject();
            }
            resolve(id, execute(command, args));
        } catch (Exception exc) {
            reject(id, exc);
        }
    }

    private JSONObject execute(String command, JSONObject args) throws CommandException {
        PlayerController player = PlayerController.shared(context);
        switch (command) {
            case "ui.reply_cards.get":
                return replyCards.snapshot();
            case "player.state":
                return player.state();
            case "player.load":
                return player.load(args);
            case "player.play":
                return player.play(args);
            case "player.pause":
                return player.pause(args);
            case "player.seek":
                return player.seek(args);
            case "player.speed":
                return player.speed(args);
            case "player.queue.set":
                return player.queueSet(args);
            case "player.queue.next":
                return player.queueNext(args);
            case "player.queue.previous":
                return player.queuePrevious(args);
            case "file.download":
                return new FileDownloadController(context).download(args);
            case "artifact.read_base64":
                return new ArtifactController(context).readBase64(args);
            case "ui.bundle.status":
                return uiBundles.status();
            case "ui.bundle.install_downloaded":
                return uiBundles.installDownloaded(args);
            case "ui.bundle.refresh":
                return uiBundles.refresh(args);
            case "ui.shell.mode.get":
                return shellMode();
            case "ui.shell.mode.set":
                settings.setUiShellMode(args.optString("mode", "native"));
                return shellMode();
            default:
                throw new CommandException(CommandErrorCodes.CAPABILITY_UNAVAILABLE,
                        "Command is not exposed to HTML UI: " + command);
        }
    }

    private JSONObject shellMode() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.ui_shell_mode.v1");
        Json.put(out, "mode", settings.getUiShellMode());
        Json.put(out, "web_cached", settings.isWebCachedUiEnabled());
        return out;
    }

    private void resolve(String id, JSONObject result) {
        JSONObject payload = new JSONObject();
        Json.put(payload, "ok", true);
        Json.put(payload, "result", result);
        callback(id, payload);
    }

    private void reject(String id, Exception exc) {
        JSONObject payload = new JSONObject();
        Json.put(payload, "ok", false);
        Json.put(payload, "error", exc.getMessage() == null ? exc.getClass().getSimpleName() : exc.getMessage());
        Json.put(payload, "error_type", exc.getClass().getSimpleName());
        callback(id, payload);
    }

    private void callback(String id, JSONObject payload) {
        WebView target = webView.get();
        if (target == null || id == null || id.isEmpty()) {
            return;
        }
        String script = "window.Pucky&&window.Pucky.__resolve&&window.Pucky.__resolve("
                + JSONObject.quote(id) + "," + payload.toString() + ");";
        mainHandler.post(() -> target.evaluateJavascript(script, null));
    }
}
