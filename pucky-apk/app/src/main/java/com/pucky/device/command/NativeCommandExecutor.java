package com.pucky.device.command;

import com.pucky.device.util.Json;

import com.pucky.device.adb.RemoteAdbController;
import com.pucky.device.audio.AudioController;
import com.pucky.device.artifacts.ArtifactController;
import com.pucky.device.battery.BatteryProvider;
import com.pucky.device.buttons.ButtonController;
import com.pucky.device.camera.CameraController;
import com.pucky.device.capabilities.CapabilityReporter;
import com.pucky.device.capabilities.PermissionReporter;
import com.pucky.device.files.FileDownloadController;
import com.pucky.device.intents.IntentController;
import com.pucky.device.location.LocationController;
import com.pucky.device.livekit.LiveKitController;
import com.pucky.device.media.MediaControlController;
import com.pucky.device.media.MediaExportController;
import com.pucky.device.network.NetworkProvider;
import com.pucky.device.notes.NoteController;
import com.pucky.device.notifications.NotificationController;
import com.pucky.device.player.PlayerController;
import com.pucky.device.sensors.SensorController;
import com.pucky.device.speech.NativeSpeechController;
import com.pucky.device.status.StatusProvider;
import com.pucky.device.storage.CommandLogStore;
import com.pucky.device.storage.StorageProvider;
import com.pucky.device.substrate.AndroidSubstrateController;
import com.pucky.device.system.ShellController;
import com.pucky.device.system.SystemController;
import com.pucky.device.timers.TimerController;
import com.pucky.device.tunnel.TunnelController;
import com.pucky.device.ui.PuckyUiController;
import com.pucky.device.updates.AppUpdateController;
import com.pucky.device.voice.VoiceCaptureController;
import com.pucky.device.wake.WakeWordController;

import org.json.JSONArray;
import org.json.JSONObject;

public final class NativeCommandExecutor implements CommandExecutor {
    private static final String[] COMMANDS = new String[] {
            "ping", "command.catalog", "status.get", "capabilities.get", "permissions.get",
            "battery.get", "network.get", "location.get", "location.watch", "file.download",
            "file.put_base64", "app.update.install_downloaded", "sensor.list", "sensor.sample", "sensor.watch",
            "camera.info", "torch.set", "photo.capture", "timer.set", "timer.cancel",
            "storage.get", "runtime.stats", "system.memory.get", "system.thermal.get",
            "service.status", "power.policy.get", "compute.benchmark", "shell.exec",
            "artifact.list", "artifact.hash", "artifact.read_base64", "artifact.delete",
            "log.tail", "notify.show", "notify.ask", "notify.cancel", "notify.list_active",
            "notify.channels.get", "audio.tone", "audio.route.get", "audio.volume.set",
            "media.state.get", "media.key", "media.open_uri", "media.export.audio",
            "media.export.list", "media.export.delete", "player.asset.prepare", "player.load",
            "player.play", "player.pause", "player.stop", "player.seek", "player.state",
            "player.speed", "player.queue.set", "player.queue.next", "player.queue.previous",
            "player.bookmark.save", "player.bookmark.list", "button.state",
            "button.config.get", "button.config.set", "button.config.reset",
            "button.events.list", "button.events.clear", "button.simulate",
            "voice.capture.status", "voice.capture.start", "voice.capture.stop",
            "voice.capture.last", "voice.capture.list", "voice.capture.delete",
            "wake.status", "wake.config.set", "wake.start", "wake.stop", "wake.simulate",
            "speech.native.status", "speech.native.start", "speech.native.stop",
            "speech.native.last", "speech.native.list", "speech.native.delete",
            "livekit.status", "livekit.session.request", "livekit.connect",
            "livekit.disconnect", "livekit.mic.set", "livekit.ptt.start",
            "livekit.ptt.stop", "livekit.events.list", "livekit.events.clear",
            "livekit.output.gain", "tunnel.status", "tunnel.config.set", "tunnel.start",
            "tunnel.stop", "adb.remote.status", "adb.remote.reconnect",
            "adb.wifi.status", "adb.wifi.enable", "adb.wifi.disable",
            "cover.wave.status", "cover.wave.config.set", "cover.wave.trigger",
            "cover.display_gesture.status", "cover.display_gesture.set",
            "cover.display_gesture.trigger",
            "cover.event", "settings.open", "settings.panel", "browser.open",
            "share.text", "alarm.intent.set", "calendar.intent.insert", "phone.intent.dial",
            "note.create_local", "note.list_local", "note.delete_local", "ui.state.get",
            "ui.dashboard.show", "launcher.capability.get", "android.substrate"
    };

    private final StatusProvider statusProvider;
    private final BatteryProvider batteryProvider;
    private final NetworkProvider networkProvider;
    private final SensorController sensorController;
    private final StorageProvider storageProvider;
    private final NotificationController notificationController;
    private final AudioController audioController;
    private final ShellController shellController;
    private final CameraController cameraController;
    private final TimerController timerController;
    private final CommandLogStore commandLogStore;
    private final CapabilityReporter capabilityReporter;
    private final PermissionReporter permissionReporter;
    private final PuckyUiController uiController;
    private final SystemController systemController;
    private final IntentController intentController;
    private final NoteController noteController;
    private final ArtifactController artifactController;
    private final LocationController locationController;
    private final FileDownloadController fileDownloadController;
    private final MediaControlController mediaControlController;
    private final MediaExportController mediaExportController;
    private final PlayerController playerController;
    private final ButtonController buttonController;
    private final VoiceCaptureController voiceCaptureController;
    private final NativeSpeechController nativeSpeechController;
    private final WakeWordController wakeWordController;
    private final AppUpdateController appUpdateController;
    private final LiveKitController liveKitController;
    private final TunnelController tunnelController;
    private final RemoteAdbController remoteAdbController;
    private final AndroidSubstrateController androidSubstrateController;

    public NativeCommandExecutor(
            StatusProvider statusProvider,
            BatteryProvider batteryProvider,
            NetworkProvider networkProvider,
            SensorController sensorController,
            StorageProvider storageProvider,
            NotificationController notificationController,
            AudioController audioController,
            ShellController shellController,
            CameraController cameraController,
            TimerController timerController,
            CommandLogStore commandLogStore,
            CapabilityReporter capabilityReporter,
            PermissionReporter permissionReporter,
            PuckyUiController uiController,
            SystemController systemController,
            IntentController intentController,
            NoteController noteController,
            ArtifactController artifactController,
            LocationController locationController,
            FileDownloadController fileDownloadController,
            MediaControlController mediaControlController,
            MediaExportController mediaExportController,
            PlayerController playerController,
            ButtonController buttonController,
            VoiceCaptureController voiceCaptureController,
            NativeSpeechController nativeSpeechController,
            WakeWordController wakeWordController,
            AppUpdateController appUpdateController,
            LiveKitController liveKitController,
            TunnelController tunnelController,
            RemoteAdbController remoteAdbController,
            AndroidSubstrateController androidSubstrateController) {
        this.statusProvider = statusProvider;
        this.batteryProvider = batteryProvider;
        this.networkProvider = networkProvider;
        this.sensorController = sensorController;
        this.storageProvider = storageProvider;
        this.notificationController = notificationController;
        this.audioController = audioController;
        this.shellController = shellController;
        this.cameraController = cameraController;
        this.timerController = timerController;
        this.commandLogStore = commandLogStore;
        this.capabilityReporter = capabilityReporter;
        this.permissionReporter = permissionReporter;
        this.uiController = uiController;
        this.systemController = systemController;
        this.intentController = intentController;
        this.noteController = noteController;
        this.artifactController = artifactController;
        this.locationController = locationController;
        this.fileDownloadController = fileDownloadController;
        this.mediaControlController = mediaControlController;
        this.mediaExportController = mediaExportController;
        this.playerController = playerController;
        this.buttonController = buttonController;
        this.voiceCaptureController = voiceCaptureController;
        this.nativeSpeechController = nativeSpeechController;
        this.wakeWordController = wakeWordController;
        this.appUpdateController = appUpdateController;
        this.liveKitController = liveKitController;
        this.tunnelController = tunnelController;
        this.remoteAdbController = remoteAdbController;
        this.androidSubstrateController = androidSubstrateController;
    }

    @Override
    public JSONObject execute(CommandEnvelope command) throws CommandException {
        switch (command.type()) {
            case "ping":
                return ping(command.args());
            case "command.catalog":
                return commandCatalog();
            case "status.get":
                return statusProvider.read();
            case "capabilities.get":
                return capabilityReporter.read();
            case "permissions.get":
                return permissionReporter.read();
            case "battery.get":
                return batteryProvider.read();
            case "network.get":
                return networkProvider.read();
            case "location.get":
                return locationController.get(command.args());
            case "location.watch":
                return locationController.watch(command.args());
            case "file.download":
                return fileDownloadController.download(command.args());
            case "file.put_base64":
                return fileDownloadController.putBase64(command.args());
            case "app.update.install_downloaded":
                return appUpdateController.installDownloaded(command.args());
            case "sensor.list":
                return sensorController.list();
            case "sensor.sample":
                return sensorController.sample(command.args());
            case "sensor.watch":
                return sensorController.watch(command.args());
            case "camera.info":
                return cameraController.info();
            case "torch.set":
                return cameraController.setTorch(command.args());
            case "photo.capture":
                return cameraController.capture(command.args());
            case "timer.set":
                return timerController.set(command.args());
            case "timer.cancel":
                return timerController.cancel(command.args());
            case "storage.get":
                return storageProvider.read();
            case "runtime.stats":
                return systemController.runtimeStats();
            case "system.memory.get":
                return systemController.memory();
            case "system.thermal.get":
                return systemController.thermal();
            case "service.status":
                return systemController.serviceStatus();
            case "power.policy.get":
                return systemController.powerPolicy();
            case "compute.benchmark":
                return systemController.benchmark(command.args());
            case "shell.exec":
                return shellController.exec(command.args());
            case "artifact.list":
                return artifactController.list(command.args());
            case "artifact.hash":
                return artifactController.hash(command.args());
            case "artifact.read_base64":
                return artifactController.readBase64(command.args());
            case "artifact.delete":
                return artifactController.delete(command.args());
            case "log.tail":
                return logTail(command.args());
            case "notify.show":
                return notificationController.show(command.args());
            case "notify.ask":
                return notificationController.ask(command.id(), command.args());
            case "notify.cancel":
                return notificationController.cancel(command.args());
            case "notify.list_active":
                return notificationController.active(command.args());
            case "notify.channels.get":
                return notificationController.channels(command.args());
            case "audio.tone":
                return audioController.tone(command.args());
            case "audio.route.get":
                return audioController.route();
            case "audio.volume.set":
                return audioController.setVolume(command.args());
            case "media.state.get":
                return mediaControlController.state();
            case "media.key":
                return mediaControlController.key(command.args());
            case "media.open_uri":
                return mediaControlController.openUri(command.args());
            case "media.export.audio":
                return mediaExportController.exportAudio(command.args());
            case "media.export.list":
                return mediaExportController.list(command.args());
            case "media.export.delete":
                return mediaExportController.delete(command.args());
            case "player.asset.prepare":
                return playerController.assetPrepare(command.args());
            case "player.load":
                return playerController.load(command.args());
            case "player.play":
                return playerController.play(command.args());
            case "player.pause":
                return playerController.pause(command.args());
            case "player.stop":
                return playerController.stop(command.args());
            case "player.seek":
                return playerController.seek(command.args());
            case "player.speed":
                return playerController.speed(command.args());
            case "player.state":
                return playerController.state();
            case "player.queue.set":
                return playerController.queueSet(command.args());
            case "player.queue.next":
                return playerController.queueNext(command.args());
            case "player.queue.previous":
                return playerController.queuePrevious(command.args());
            case "player.bookmark.save":
                return playerController.bookmarkSave(command.args());
            case "player.bookmark.list":
                return playerController.bookmarkList(command.args());
            case "button.state":
                return buttonController.state();
            case "button.config.get":
                return buttonController.configGet();
            case "button.config.set":
                return buttonController.configSet(command.args());
            case "button.config.reset":
                return buttonController.configReset();
            case "button.events.list":
                return buttonController.eventsList(command.args());
            case "button.events.clear":
                return buttonController.eventsClear();
            case "button.simulate":
                return buttonController.simulate(command.args());
            case "voice.capture.status":
                return voiceCaptureController.status();
            case "voice.capture.start":
                return voiceCaptureController.start(command.args());
            case "voice.capture.stop":
                return voiceCaptureController.stop(command.args());
            case "voice.capture.last":
                return voiceCaptureController.last(command.args());
            case "voice.capture.list":
                return voiceCaptureController.list(command.args());
            case "voice.capture.delete":
                return voiceCaptureController.delete(command.args());
            case "wake.status":
                return wakeWordController.status();
            case "wake.config.set":
                return wakeWordController.configSet(command.args());
            case "wake.start":
                return wakeWordController.start(command.args());
            case "wake.stop":
                return wakeWordController.stop(command.args());
            case "wake.simulate":
                return wakeWordController.simulate(command.args());
            case "speech.native.status":
                return nativeSpeechController.status();
            case "speech.native.start":
                return nativeSpeechController.start(command.args());
            case "speech.native.stop":
                return nativeSpeechController.stop(command.args());
            case "speech.native.last":
                return nativeSpeechController.last(command.args());
            case "speech.native.list":
                return nativeSpeechController.list(command.args());
            case "speech.native.delete":
                return nativeSpeechController.delete(command.args());
            case "livekit.status":
                return liveKitController.status();
            case "livekit.session.request":
                return liveKitController.requestSession(command.args());
            case "livekit.connect":
                return liveKitController.connect(command.args());
            case "livekit.disconnect":
                return liveKitController.disconnect(command.args());
            case "livekit.mic.set":
                return liveKitController.setMic(command.args());
            case "livekit.ptt.start":
                return liveKitController.pttStart(command.args());
            case "livekit.ptt.stop":
                return liveKitController.pttStop(command.args());
            case "livekit.events.list":
                return liveKitController.eventsList(command.args());
            case "livekit.events.clear":
                return liveKitController.eventsClear();
            case "livekit.output.gain":
                return liveKitController.outputGain(command.args());
            case "tunnel.status":
                return tunnelController.status();
            case "tunnel.config.set":
                return tunnelController.configure(command.args());
            case "tunnel.start":
                return tunnelController.start(command.args());
            case "tunnel.stop":
                return tunnelController.stop(command.args());
            case "adb.remote.status":
                return remoteAdbController.status(command.args());
            case "adb.remote.reconnect":
                return remoteAdbController.reconnect(command.args());
            case "adb.wifi.status":
                return remoteAdbController.wifiStatus(command.args());
            case "adb.wifi.enable":
                return remoteAdbController.wifiEnable(command.args());
            case "adb.wifi.disable":
                return remoteAdbController.wifiDisable(command.args());
            case "cover.wave.status":
            case "cover.display_gesture.status":
                return systemController.coverDisplayGestureStatus();
            case "cover.wave.config.set":
            case "cover.display_gesture.set":
                return systemController.coverDisplayGestureSet(command.args());
            case "cover.wave.trigger":
            case "cover.display_gesture.trigger":
                return systemController.coverDisplayGestureTrigger(command.args());
            case "cover.event":
                return liveKitController.coverEvent(command.args());
            case "settings.open":
            case "settings.panel":
                return intentController.settingsOpen(command.args());
            case "browser.open":
                return intentController.browserOpen(command.args());
            case "share.text":
                return intentController.shareText(command.args());
            case "alarm.intent.set":
                return intentController.clockAlarmIntent(command.args());
            case "calendar.intent.insert":
                return intentController.calendarInsertIntent(command.args());
            case "phone.intent.dial":
                return intentController.dialIntent(command.args());
            case "note.create_local":
                return noteController.create(command.args());
            case "note.list_local":
                return noteController.list(command.args());
            case "note.delete_local":
                return noteController.delete(command.args());
            case "ui.state.get":
                return uiController.state();
            case "ui.dashboard.show":
                return uiController.showDashboard(command.args());
            case "launcher.capability.get":
                return uiController.launcherCapability();
            case "android.substrate":
                return androidSubstrateController.execute(command.args());
            default:
                throw new CommandException(
                        CommandErrorCodes.COMMAND_NOT_ALLOWED,
                        "Command type is not allowlisted on this build: " + command.type());
        }
    }

    private JSONObject ping(JSONObject args) {
        JSONObject out = new JSONObject();
        Json.put(out, "ok", true);
        Json.put(out, "echo", args);
        return out;
    }

    private JSONObject commandCatalog() {
        JSONObject out = new JSONObject();
        JSONArray commands = new JSONArray();
        for (String command : COMMANDS) {
            Json.add(commands, command);
        }
        Json.put(out, "schema", "pucky.command_catalog.v1");
        Json.put(out, "endpoint", "pucky.command.v1");
        Json.put(out, "commands", commands);
        Json.put(out, "raw_shell", "shell.exec");
        return out;
    }

    private JSONObject logTail(JSONObject args) {
        int limit = Math.max(1, Math.min(50, args.optInt("limit", 10)));
        JSONObject out = new JSONObject();
        Json.put(out, "entries", commandLogStore.tailJson(limit));
        return out;
    }
}

