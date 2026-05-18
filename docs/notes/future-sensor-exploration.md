# Future Sensor Exploration

This note captures the current shortlist of promising sensor and interaction
directions for the Razr/Pucky project. Treat this as a research map, not an
implementation commitment.

## Current Mental Model

Android reports many sensors, but most are virtual, fused, or vendor-specific
views over a smaller set of physical signals. The interesting work is sensor
fusion: combining posture, orientation, proximity, light, motion, audio, camera,
location, and app context into safe, intentional triggers.

On the Razr 2024, do not assume the hand-wave signal is only a classic IR
proximity sensor. Our live Android sensor dump showed several relevant entries:

- `Ultrasound Proximity`
- `stk3bfx_aoa` / `com.motorola.sensor.approach`
- `mot_flip_approach`
- `stk3bfx_ps` / alternate proximity
- `Moto CapSense Ch0-Ch7`
- `palm-gesture`
- `Flip Position`
- `Mot Hall`
- light / ALS sensors
- flip-aligned accel / gyro / gravity sensors

The next sensor work should empirically map these, especially CapSense and the
approach/proximity family.

## Strong Options

- Back tap / knock gestures: promising, cheap, private physical inputs using
  accelerometer and gyro. Start with double-tap and shake, then consider rhythm
  patterns after false positives are understood.
- CapSense / rim holding: likely the most Razr-specific weird goldmine. Map
  Ch0-Ch7 by touching edges, corners, and rim areas while folded and open.
- Fold posture / tent mode: strong context signal for meeting mode, desk
  assistant, transcription, and look-to-talk. Prefer official fold APIs where
  possible, then verify against Motorola vendor sensors.
- Look-to-talk: real but should be gated. Use posture/orientation first, then
  activate CameraX + ML Kit face detection at low frame rate only when the
  phone is in a plausible desk/tent state.
- Wake word: start with a simple on-device "Pucky" wake word. Add "only my
  voice" speaker verification later if the base wake word is stable.
- Location-aware actions: use geofence/context so the same gesture can do
  different things at home, in car, at desk, etc.
- Home automation: prefer webhook or Home Assistant style routing for real
  devices. Direct BLE/GATT is powerful but only clean when a device exposes a
  documented local protocol.

## Lower Priority / Research Later

- Acoustic event detection: useful for clap, knock, snap, whistle, and generic
  speech detection, but not a replacement for wake word or speaker ID.
- Magnet gestures: cool physical-token idea using magnetometer field changes.
  Test carefully because magnets may interfere with compass, Hall, or fold
  behavior.
- Screen-off drawing: appealing but likely OEM/power-policy constrained. A
  black or dim cover activity can capture gestures, but that is not the same as
  true display-off touch capture.
- Ultrasonic sonar: probably park for now. It is DIY signal processing, costs
  mic/speaker/CPU/battery, and does not yet have a clear must-have use case.

## AndroidX / Jetpack / Google Library Resource

AndroidX and Jetpack are an important capability resource for the APK, but not
something to bulk-install. They are Gradle dependencies added per feature. The
right pattern is to add small, specific libraries only when we use them.

Useful candidates:

- CameraX: camera pipeline for look-to-talk and on-device vision experiments.
- ML Kit Face Detection: on-device face presence, head angles, eye-open
  probabilities; useful for look-to-talk.
- WindowManager: fold/posture information for tent, tabletop, half-open, and
  large-screen behavior.
- WorkManager: durable background jobs that respect Android battery rules.
- DataStore: simple local settings storage.
- Room: local SQLite-backed logs, transcripts, patterns, and command history.
- Biometric: fingerprint authentication gate for sensitive agent actions.
- Lifecycle / coroutines integration: keep sensor, camera, and audio work tied
  to app/service lifecycle safely.

Important split:

- Core Android SDK already provides sensors, BLE, Bluetooth GATT, camera2,
  AudioRecord, foreground services, and location primitives.
- AndroidX/Jetpack wraps or improves some platform features, but does not
  unlock raw access to OEM-locked hardware like fingerprint swipe streams or raw
  Hall data.
- Third-party voice SDKs such as Picovoice are separate Gradle dependencies,
  not AndroidX.

## Wake Word Direction

Goal: dead-simple first proof that "Pucky" can wake the agent.

Recommended staged path:

- Stage 1: Porcupine or similar on-device keyword spotter listens for "Pucky"
  in a properly declared foreground microphone service.
- Stage 2: on wake, capture a short command window and route to a trivial
  command handler first.
- Stage 3: add speech-to-intent or transcription only after wake detection is
  stable.
- Stage 4: add speaker verification for "only Jimmy's voice" if false accepts
  or privacy make it worth the complexity.

Safety and Android reality:

- Always-on mic requires `RECORD_AUDIO` and foreground-service handling.
- Android 14+ requires correct foreground service type declarations for
  microphone use.
- Do not combine wake word, speaker ID, command parsing, and cloud action
  routing in one first implementation. Prove one layer at a time.

### Pucky Wake-Word Test Setup

First test target:

- Say "Pucky".
- APK detects the wake word.
- APK buzzes and posts a "Pucky heard" notification.
- No command parsing and no LiveKit voice session yet.

Current APK support:

- `ai.picovoice:porcupine-android` is already a Gradle dependency.
- `WakeWordController` already exposes `wake.status`, `wake.config.set`,
  `wake.start`, `wake.stop`, and `wake.simulate`.
- Detection defaults to `action=notify`, which vibrates and posts a wake
  notification. `action=livekit` is reserved for later.

Required external Picovoice pieces:

- Picovoice `AccessKey` from the user's Picovoice account. Keep this secret and
  do not commit it to git.
- Android custom keyword model for the text `Pucky`, downloaded from Picovoice
  Console as a `.ppn` file.
- Store the model as `app/src/main/assets/pucky_android.ppn` before building the
  APK.

If "Pucky" alone is unreliable, generate a second Android keyword model for
"Hey Pucky" and compare miss/false-positive rates.
