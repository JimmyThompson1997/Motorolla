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
import com.pucky.device.intents.IntentController;
import com.pucky.device.location.LocationController;
import com.pucky.device.meeting.MeetingRecordingController;
import com.pucky.device.player.PlayerController;
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
    private final UiBundleController uiBundles;
    private final SettingsStore settings;

    public PuckyWebBridge(Context context, WebView webView,
            UiBundleController uiBundles, SettingsStore settings) {
        this.context = context.getApplicationContext();
        this.webView = new WeakReference<>(webView);
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
            case "ui.default_audio_speed.get":
                return defaultAudioSpeed();
            case "ui.default_audio_speed.set":
                return setDefaultAudioSpeed(args);
            case "pucky.config.get":
                return puckyConfig();
            case "player.state":
                return player.state();
            case "player.asset.prepare":
                return player.assetPrepare(args);
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
            case "meeting.recording.status":
                return MeetingRecordingController.shared(context).status();
            case "meeting.recording.resolve_audio_link":
                return MeetingRecordingController.shared(context).resolveAudioLink(args);
            case "voice.thread_scope.get":
                return VoiceThreadScopeController.shared(context).get();
            case "voice.thread_scope.set":
                return VoiceThreadScopeController.shared(context).set(args);
            case "voice.thread_scope.clear":
                return VoiceThreadScopeController.shared(context).clear(args);
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
            case "browser.open":
                return new IntentController(context).browserOpen(args);
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
                settings.setUiShellMode(args.optString("mode", "web_hosted"));
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

    private JSONObject puckyConfig() {
        String turnUrl = settings.getPuckyTurnUrl();
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.web_config.v1");
        Json.put(out, "api_base_url", apiBaseUrl(turnUrl));
        Json.put(out, "api_token", settings.getPuckyApiToken());
        Json.put(out, "has_api_token", !settings.getPuckyApiToken().trim().isEmpty());
        return out;
    }

    private static String apiBaseUrl(String turnUrl) {
        String base = turnUrl == null ? "" : turnUrl.trim();
        int queryIndex = base.indexOf('?');
        if (queryIndex >= 0) {
            base = base.substring(0, queryIndex);
        }
        if (base.endsWith("/api/turn")) {
            return base.substring(0, base.length() - "/api/turn".length());
        }
        if (base.endsWith("/turn")) {
            return base.substring(0, base.length() - "/turn".length());
        }
        return base.replaceAll("/+$", "");
    }

    private JSONObject defaultAudioSpeed() {
        JSONObject out = new JSONObject();
        Json.put(out, "schema", "pucky.default_audio_speed.v1");
        Json.put(out, "speed", settings.getDefaultTileAudioSpeed());
        return out;
    }

    private JSONObject setDefaultAudioSpeed(JSONObject args) throws CommandException {
        double raw = args.optDouble("speed", args.optDouble("rate", settings.getDefaultTileAudioSpeed()));
        if (Double.isNaN(raw) || Double.isInfinite(raw)) {
            throw new CommandException(CommandErrorCodes.MALFORMED_COMMAND,
                    "ui.default_audio_speed.set requires a finite speed");
        }
        settings.setDefaultTileAudioSpeed((float) raw);
        return defaultAudioSpeed();
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
