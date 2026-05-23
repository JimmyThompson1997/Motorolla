# Test Plan And Phase Gates

## Phase 0: Baseline And Safety Rails

Tests:

- volume-up hold maps to `pucky.turn.start`
- volume-up release maps to `pucky.turn.stop`
- volume-down hold currently maps to echo or lab start, depending on phase
- volume-down release currently maps to echo or lab stop, depending on phase
- direct echo uses `SpeechRecognizer.createOnDeviceSpeechRecognizer`
- direct echo calls `recognizer.stopListening()` on release
- direct echo does not call broker or LiveKit

Gate:

- Existing volume-up and direct echo behavior is documented before changes.

## Phase 1: Porcupine Removal

Tests:

- build file has no `ai.picovoice` dependency
- production source has no `ai.picovoice` imports
- foreground service does not start wake word on create
- wake commands return disabled status
- no AccessKey/model is required at startup

Gate:

- APK builds and starts without Porcupine.
- LiveKit power-hold behavior is unchanged.

## Phase 2: Volume-Down Lab Controller

Tests:

- new `speech.echo.lab.*` commands are allowlisted
- volume-down maps to lab start/stop
- lab default engine is `android_direct_echo`
- active session rejects overlapping start
- stop with no active session returns `no_active_session`
- lab session persists last/list status
- lab controller has no LiveKit reference

Gate:

- Holding/releasing volume down still produces useful local behavior.

## Phase 3: Audio Route Detector

Tests:

- mocked built-in mic is classified as `Phone`
- mocked Bluetooth input is classified as `Bluetooth`
- mocked wired/USB headset is classified as `WiredHeadset`
- missing/ambiguous devices produce `Unknown`
- route status appears in lab status and session

Gate:

- Manual Razr route checks pass for available hardware.

## Phase 4: AudioFrameBus And Pre-Roll

Tests:

- `AudioRecord` settings are 16kHz mono PCM16
- frame size is 480 samples
- multiple consumers receive frames
- slow consumer does not block producer
- throwing consumer does not kill bus
- stop releases mic resource
- pre-roll snapshot is exactly 1.5s
- pre-roll snapshot is immutable

Gate:

- 5-second instrumented Razr capture has monotonic timestamps and clean stop.

## Phase 5: Silero VAD Metrics

Tests:

- missing model reports unavailable
- valid model loads
- silence fixture reports low probability
- speech fixture reports high probability
- candidate endpoint timing is reported
- VAD never stops recording while button is held

Gate:

- VAD summary appears in lab session without changing user-controlled duration.

## Phase 6: openWakeWord Lab Metrics

Tests:

- missing model reports unavailable
- model loads when asset exists
- positive fixture reports wake score/detection
- negative fixture reports false accepts
- detection latency is reported when ground truth exists
- wake scoring does not start global agent behavior

Gate:

- openWakeWord can be evaluated from lab sessions or fixtures only.

## Phase 7: Quality Reports

Tests:

- fixture runner emits `pucky.audio_lab_report.v1`
- report includes VAD metrics
- report includes wake metrics when model exists
- report includes frame drops and latency
- report includes warnings for incomplete corpus

Gate:

- Metrics are visible enough for PM/engineering to decide promotion readiness.

## Phase 8: Promotion Gate

Tests:

- production wake behavior remains off
- lab feature flags are explicit
- no raw audio is logged by default
- volume-up walkie remains green
- power-hold legacy path remains green

Gate:

- Any always-on wake-word production work requires a separate PRD and branch.
