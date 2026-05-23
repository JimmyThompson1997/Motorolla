# Current Codebase Baseline

## Android Project Facts

The current APK is a single-module Android project:

- Module: `pucky-apk/app`
- `minSdk`: 26
- `targetSdk`: 35
- `compileSdk`: 35
- Language shape: mostly Java, with Kotlin currently used for LiveKit.
- Architecture style: manual controllers and shared singletons, not Hilt/Koin/Room.
- Async style: Android callbacks, `Handler`, raw `Thread`, OkHttp callbacks, and some Kotlin coroutines in the LiveKit controller.
- Test shape: JUnit/source-style tests. There is not yet a full audio fixture or instrumented audio performance harness.

## Current Button Paths

Current default button mappings are:

- Volume-up hold: `pucky.turn.start`
- Volume-up hold release: `pucky.turn.stop`
- Volume-down hold: `speech.echo.lab.start`
- Volume-down hold release: `speech.echo.lab.stop`

The volume-up path is the current walkie-to-agent path. It records with `MediaRecorder`, stores an `.m4a`, uploads it to the configured Pucky turn endpoint, and writes the response into the reply-card feed.

The volume-down path is now the local lab entrypoint. Its default engine is `android_direct_echo`, which delegates to the stable direct Android echo path: direct on-device STT on hold, stop on release, accepted chime, and Android TTS playback of the final transcript.

## Current Audio Implementations

### Voice Capture

`VoiceCaptureController` owns raw app-private voice capture. It uses:

- `MediaRecorder`
- `.m4a`
- AAC
- app-owned files under `files/voice`

It has a minimum finalize guard to avoid broken/empty recordings from too-short captures.

### Pucky Turn

`PuckyTurnController` wraps voice capture and upload:

- Starts `VoiceCaptureController`
- Stops capture on release
- Reads the `.m4a`
- Uploads to `pucky_turn_url`
- Persists response audio/HTML/text into reply-card storage

This is not part of the volume-down lab and must not be changed by lab phases.

### Speech Echo

`SpeechEchoController` is the working local baseline:

- Uses `SpeechRecognizer.createOnDeviceSpeechRecognizer`
- Calls `recognizer.stopListening()` on button release
- Uses Android `TextToSpeech`
- Does not call the broker
- Does not call the agent runtime
- Does not store raw audio

This direct Android path is the reliability baseline for all future experiments.

## Important Finding From Recent Debugging

The previous injected-audio experiment recorded PCM with `AudioRecord`, saved a WAV, and tried to feed that stream into Android STT with `RecognizerIntent.EXTRA_AUDIO_SOURCE`.

That path failed unreliably on the Razr. The mic stopped and WAV files were created, but Android recognition returned no match or failed to complete cleanly.

Conclusion: do not assume Android STT can be reliably driven by injected PCM on this device. Any `AudioRecord` lab work must run in parallel to, not as an immediate replacement for, the direct Android recognizer baseline.

## Current Wake Word State

Porcupine/Picovoice wake-word wiring has been removed from production:

- Dependency: removed from `pucky-apk/app/build.gradle`
- Controller: `WakeWordController` remains as a disabled compatibility stub
- Foreground service can still call wake start/stop, but those calls are harmless no-ops

Wake commands report `engine: none`, `enabled: false`, and `reason: porcupine_removed_license_risk`. Future openWakeWord work is lab-only until a separate production wake-word PRD graduates it.

## Current LiveKit State

LiveKit remains in the repo and is used by legacy paths, including assistant/power-hold behavior.

For this lab:

- Do not delete LiveKit.
- Do not refactor power-hold.
- Do not add new LiveKit usage.
- Add tests proving volume-down lab code does not reference LiveKit.
