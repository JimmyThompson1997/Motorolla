# Audio Frame Bus And Pre-Roll

## Goal

Add a lab-only PCM frame capture system that can feed metrics consumers without interfering with production audio.

This phase is for controlled measurement. It is not a replacement for volume-up capture or direct Android STT.

## Capture Settings

Use `AudioRecord` with:

- Source: `MediaRecorder.AudioSource.VOICE_RECOGNITION`
- Sample rate: 16000 Hz
- Channels: mono
- Encoding: PCM 16-bit
- Frame duration: 30ms
- Frame size: 480 samples

If `VOICE_RECOGNITION` fails to initialize, record a clear error. Do not silently switch source unless config explicitly allows it.

## Producer Rules

The frame bus has one producer:

- Owns `AudioRecord`
- Runs on a dedicated thread
- Reads PCM frames
- Timestamps frames with monotonic time
- Delivers frames to registered consumers
- Tracks frame gaps and dropped frames
- Releases `AudioRecord` on stop

The producer must remain simple. It should not run VAD, wake-word inference, file I/O, or network operations inline.

## Consumer Rules

Consumers implement a small contract:

```kotlin
interface AudioFrameConsumer {
    fun onFrame(frame: ShortArray, timestampNanos: Long)
    fun onStop(reason: String)
}
```

Consumers must not block the producer. If a consumer is slow, the bus records a dropped delivery for that consumer and continues.

V1 consumers:

- `PreRollBuffer`
- `TelemetryConsumer`
- `SileroVadConsumer`
- `OpenWakeWordConsumer`

## Pre-Roll Buffer

The pre-roll buffer stores the last 1.5 seconds of audio:

- 16000 samples/sec
- 1 channel
- 16-bit PCM
- 24000 samples
- about 48KB raw PCM

Rules:

- Snapshot is immutable.
- Writes overwrite oldest frames.
- Snapshot can be taken while recording.
- Snapshot includes timestamp metadata for first and last frame.

## Explicit Non-Goal

Do not inject frame-bus PCM into Android `SpeechRecognizer` in this phase.

The previous injected PCM path was unreliable on the Razr. Android direct STT remains the reliable baseline.

## Tests

Unit tests:

- frame size is 480 samples
- monotonic timestamps
- all registered consumers receive frames
- slow consumer does not block fast consumer
- throwing consumer is isolated
- stop releases producer resources
- pre-roll stores exactly 1.5 seconds
- pre-roll snapshot is immutable

Instrumented Razr test:

- capture 5 seconds
- assert no frame gap above 50ms in normal conditions
- assert stop releases mic
- assert status returns to idle
