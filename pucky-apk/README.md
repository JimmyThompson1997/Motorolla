# Pucky APK

Native Android bridgehead for the Pucky Device plan.

This first implementation intentionally replaces Termux for APK acceptance. ADB is used only to build, install,
launch, capture logs, and forward local broker traffic during development.

## Current command surface

- `ping`
- `status.get`
- `capabilities.get`
- `permissions.get`
- `battery.get`
- `network.get`
- `location.get`
- `location.watch`
- `sensor.list`
- `sensor.sample`
- `camera.info`
- `torch.set`
- `photo.capture`
- `storage.get`
- `log.tail`
- `notify.show`
- `notify.ask`
- `audio.tone`
- `audio.volume.set`
- `voice.capture.status`
- `voice.capture.start`
- `voice.capture.stop`
- `voice.capture.last`
- `voice.capture.list`
- `voice.capture.delete`
- `speech.native.status`
- `speech.native.start`
- `speech.native.stop`
- `speech.native.last`
- `speech.native.list`
- `speech.native.delete`
- `timer.set`
- `timer.cancel`
- `ui.state.get`
- `ui.dashboard.show`
- `launcher.capability.get`
- `runtime.stats`
- `system.memory.get`
- `system.thermal.get`
- `compute.benchmark`
- `artifact.list`
- `artifact.hash`
- `artifact.read_base64`
- `artifact.delete`
- `notify.cancel`
- `notify.list_active`
- `notify.channels.get`
- `audio.route.get`
- `media.state.get`
- `media.key`
- `media.open_uri`
- `file.download`
- `file.put_base64`
- `settings.open`
- `settings.panel`
- `browser.open`
- `share.text`
- `alarm.intent.set`
- `calendar.intent.insert`
- `phone.intent.dial`
- `note.create_local`
- `note.list_local`
- `note.delete_local`
- `player.asset.prepare`
- `player.load`
- `player.play`
- `player.pause`
- `player.stop`
- `player.seek`
- `player.state`
- `player.queue.set`
- `player.queue.next`
- `player.queue.previous`
- `player.bookmark.save`
- `player.bookmark.list`
- `button.state`
- `button.config.get`
- `button.config.set`
- `button.config.reset`
- `button.events.list`
- `button.events.clear`
- `button.simulate`

`notify.ask` uses Android's native notification direct-reply surface (`RemoteInput`) and posts replies back
to the broker reply inbox. `location.get` and `location.watch` use Android `LocationManager`; they do not
depend on Google Play services. Long-running location traces should remain explicit user-approved tests.

`file.download` downloads HTTP/HTTPS URLs into Pucky app-owned storage and returns artifact metadata.
`media.key` is a best-effort Android media-key dispatch path for play/pause/next/previous; it cannot guarantee
that a third-party podcast or music app acted unless that app has an active media session. `media.open_uri`
uses Android's normal user-mediated `ACTION_VIEW` handling for media/podcast URLs.

Microphone file capture is implemented with Android `MediaRecorder` and app-owned `.m4a` artifacts.
Android native speech recognition is implemented with `SpeechRecognizer` as an experimental live-text path;
it keeps a local transcript history and posts successful transcripts to the broker reply inbox when connected.
LiveKit/WebRTC realtime audio, boot persistence hardening, and Device Owner mode remain later milestones.

## Foreground button policy

Button capture currently works while the Pucky Activity is foregrounded and the keyguard is dismissed.
The default policy is deliberately narrow:

- volume-up single press: normal Android media volume up
- volume-up hold: `speech.native.start`
- volume-up hold release: `speech.native.stop`
- volume-down press/hold/double: `none`, so Android can keep normal volume behavior

The hold/release actions are currently wired to Android native transcription for push-to-talk testing.
The older `voice.capture.*` file-capture endpoints remain available for acoustic diagnostics before the later
LiveKit/WebRTC turn-taking implementation.

## Future assistant role note

Long-press power is implemented through Android's default-assistant integration, not a raw power-key
interceptor. A normal foreground APK cannot reliably capture the power button because Android reserves it for
system power, emergency, and assistant behavior. Pucky registers a `VoiceInteractionService` so it can be
selected instead of Gemini where Motorola exposes the standard assistant gesture.

The first behavior is deliberately tiny: when Android invokes Pucky's `VoiceInteractionSession`, Pucky starts
the foreground service and toggles the LiveKit PTT line. If no Pucky mic line is active, the gesture starts
an open mic turn with a haptic tick. If a Pucky mic line is active, the same gesture stops it with a haptic
tick. Motorola owns the actual hold duration through Settings > Gestures > Power key / Press and hold.

The user-facing setup surface is a yes/no flow launched with `--ez assistant_setup true`. Yes asks the user to set
Pucky as the default assistant, requests microphone/notification permission only if missing, and posts a normal Android
notification that opens the default-assistant Settings page so the user can choose Pucky instead of Gemini.

## Phase 3 puckyctl

The VM-side agent should use `puckyctl` instead of hand-posting HTTP JSON.

Local wrapper:

```powershell
.\tools\puckyctl.ps1 --json health
```

Direct Python entry point:

```powershell
python -B .\puckyctl\puckyctl.py --json health
```

Inside the Fly machine, the deploy helper installs the same CLI at:

```text
/usr/local/bin/puckyctl
```

Quiet test:

```powershell
.\tools\puckyctl.ps1 --json test quiet
```

Physical tests require explicit allow flags, for example:

```powershell
.\tools\puckyctl.ps1 --json test physical --allow notification
```

Reply/location validation:

```powershell
python .\tools\phase5_reply_location_runner.py
```

The runner sends a direct-reply notification, waits for a human reply from Android's notification shade,
then runs `location.get` and a short `location.watch` trace through the Fly-hosted `puckyctl`.

Phase 6 platform expansion validation:

```powershell
python .\tools\phase6_platform_expansion_runner.py --broker https://pucky-bridge-dev-jt323.fly.dev
```

The Phase 6 runner proves app-owned URL download, artifact lifecycle, media state, best-effort media-key
dispatch, and user-mediated media URI launch.

Voice capture validation:

```powershell
python .\tools\phase11_voice_capture_runner.py --broker https://pucky-bridge-dev-jt323.fly.dev --allow-audio
```

The Phase 11 runner proves `voice.capture.*`, the foreground Volume Up hold/release mapping, artifact metadata,
and a repeatable command/button capture path. `--allow-audio` permits short tone playback during acoustic tests.

Acoustic loop validation:

```powershell
python .\tools\phase12_acoustic_loop_runner.py --broker https://pucky-bridge-dev-jt323.fly.dev
```

The Phase 12 runner loads `.env`, generates an ElevenLabs TTS fixture, pushes it to the phone through
`file.put_base64`, plays it with the native player, records it with `voice.capture.*`, reads the capture back
with `artifact.read_base64`, and transcribes it with ElevenLabs STT. This is the pre-LiveKit audio gate.

## Local build

```powershell
$env:JAVA_HOME='C:\Users\jimmy\Desktop\Android\tools\jdk-17'
$env:ANDROID_HOME='C:\Users\jimmy\Desktop\Android\tools\android-sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
C:\Users\jimmy\Desktop\Android\tools\gradle-8.10.2\bin\gradle.bat test assembleDebug
```

## Local fake broker

```powershell
cd C:\Users\jimmy\Desktop\Android\pucky-apk\fake-broker
npm install
npm start
```

Use ADB reverse so the phone can connect to the laptop broker:

```powershell
C:\Users\jimmy\Desktop\Android\tools\android-sdk\platform-tools\adb.exe reverse tcp:8787 tcp:8787
```

## Fly broker test path

The working Fly route is not `flyctl ssh console -C`. On Windows, that path had quoting/path issues for a foreground Python broker.

Use `fly-broker/deploy-pucky-broker.ps1` to put `fly-broker/pucky_fly_broker.py` on the single small machine as a machine file, then expose external `443` to internal `8080` with `tls,http` handlers during active tests.

This path does not require Docker Desktop, a Dockerfile, or a local image build. It uses a stock Python runtime image plus direct file injection through the Machines API.

Current tested Fly resources:

```text
app: pucky-bridge-dev-jt323
machine: d8d2264ae93558
volume: vol_vp2z7g6q6qwoqjj4
mount: /data
sqlite: /data/pucky/broker.sqlite3
```

The old no-volume machine `2872e70b6d6e98` was destroyed because Fly would not attach a volume through machine update.

Test URL:

```text
wss://pucky-bridge-dev-jt323.fly.dev/v1/devices/pucky-6ee8e85c12910b5c/connect
```

After any test, remove the public service mapping and stop the machine unless the device is intentionally being kept online.

The deploy helper currently targets the reusable small development machine:

```text
app: pucky-bridge-dev-jt323
machine: d8d2264ae93558
volume: vol_vp2z7g6q6qwoqjj4
size: shared-cpu-1x:256MB
restart policy: no
```
