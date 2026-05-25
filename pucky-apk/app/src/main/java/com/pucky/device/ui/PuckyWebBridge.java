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
import com.pucky.device.location.LocationController;
import com.pucky.device.player.PlayerController;
import com.pucky.device.pucky.PuckyFeedController;
import com.pucky.device.pucky.PuckyTurnController;
import com.pucky.device.storage.SettingsStore;
import com.pucky.device.util.Json;
import com.pucky.device.wake.WakeWordController;

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
                return PuckyFeedController.shared(context).snapshot();
            case "pucky.feed.sync":
                return PuckyFeedController.shared(context).sync(args);
            case "pucky.feed.action":
                return PuckyFeedController.shared(context).action(args);
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
            case "pucky.turn.status":
                return PuckyTurnController.shared(context).status();
            case "pucky.turn.settings.get":
                return PuckyTurnController.shared(context).settingsGet();
            case "pucky.turn.settings.set":
                return PuckyTurnController.shared(context).settingsSet(args);
            case "pucky.turn.arrival_cue.test":
                return PuckyTurnController.shared(context).arrivalCueTest(args);
            case "pucky.turn.sent_cue.test":
                return PuckyTurnController.shared(context).sentCueTest(args);
            case "pucky.turn.received_cue.test":
                return PuckyTurnController.shared(context).receivedCueTest(args);
            case "pucky.turn.chime.test":
                return PuckyTurnController.shared(context).chimeTest(args);
            case "pucky.turn.history":
                return PuckyTurnController.shared(context).history(args);
            case "pucky.turn.read":
                return PuckyTurnController.shared(context).read(args);
            case "wake.status":
                return WakeWordController.shared(context).status();
            case "wake.config.set":
                return WakeWordController.shared(context).configSet(args);
            case "wake.start":
                return WakeWordController.shared(context).start(args);
            case "wake.stop":
                return WakeWordController.shared(context).stop(args);
            case "wake.simulate":
                return WakeWordController.shared(context).simulate(args);
            case "location.tracker.status":
                return new LocationController(context).trackerStatus();
            case "location.tracker.start":
                return new LocationController(context).trackerStart(args);
            case "location.tracker.stop":
                return new LocationController(context).trackerStop(args);
            case "location.tracker.query":
                return new LocationController(context).trackerQuery(args);
            case "location.tracker.clear":
                return new LocationController(context).trackerClear(args);
            case "location.tracker.export":
                return new LocationController(context).trackerExport(args);
            case "file.download":
                return new FileDownloadController(context).download(args);
            case "artifact.read_base64":
                return new ArtifactController(context).readBase64(args);
            case "artifact.url":
                return new ArtifactController(context).url(args);
            case "ui.bundle.status":
                return uiBundles.status();
            case "ui.bundle.install_downloaded":
                return uiBundles.installDownloaded(args);
            case "ui.bundle.refresh":
                return uiBundles.refresh(args);
            case "ui.surface.get":
                return new UiSurfaceController(context).status(uiBundles);
            case "ui.shell.mode.get":
                return shellMode();
            case "ui.shell.mode.set":
                settings.setUiShellMode(args.optString("mode", "web_cached"));
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
