# Project Pucky-Wake Lab

## Purpose

Project Pucky-Wake Lab is a gated technical plan for exploring a custom on-device audio pipeline without destabilizing the rest of the APK.

The lab is deliberately scoped to the **volume-down hold/release** gesture. Volume-up walkie, the existing Pucky turn upload, power-hold LiveKit behavior, reply cards, and the current agent runtime contract are outside this workstream.

The core idea is to use volume-down as the experimental playground for:

- Audio route detection
- `AudioRecord` frame capture
- Pre-roll buffering
- Silero VAD metrics
- openWakeWord experiments
- Quality and latency reporting

## Current V1 Framing

V1 is not an always-on wake-word launch. V1 is a safe lab surface.

The lab succeeds when a developer can hold volume down, run a controlled local audio experiment, inspect structured session telemetry, and compare experimental components against the current working Android STT/TTS baseline.

Production wake word remains a future promotion decision. Nothing in this work should accidentally turn on global phone-mic wake behavior.

## Hard Boundaries

- Volume-down may change as phases land.
- Volume-up walkie must not regress.
- Power-hold LiveKit behavior must not regress.
- LiveKit can remain in the repo for legacy behavior, but volume-down lab code must not depend on it.
- Porcupine must be removed from production due licensing and AccessKey risk.
- Raw audio must not be stored unless an explicit debug setting enables it.

## Documentation Map

- [01 Current Codebase Baseline](01-current-codebase-baseline.md)
- [02 Volume-Down Lab Contract](02-volume-down-lab-contract.md)
- [03 Legacy Porcupine Removal](03-legacy-porcupine-removal.md)
- [04 Lab State Machine](04-lab-state-machine.md)
- [05 Audio Route Detector](05-audio-route-detector.md)
- [06 Audio Frame Bus And Pre-Roll](06-audio-frame-bus-and-preroll.md)
- [07 VAD, Noise, And Endpoint Metrics](07-vad-noise-and-endpoint-metrics.md)
- [08 openWakeWord Lab](08-openwakeword-lab.md)
- [09 Fixtures, Quality, And Performance](09-fixtures-quality-and-performance.md)
- [10 Test Plan And Phase Gates](10-test-plan-and-phase-gates.md)
- [11 Rollout And Acceptance](11-rollout-and-acceptance.md)

## Glossary

- **Direct echo**: The current reliable volume-down diagnostic path using Android `SpeechRecognizer.createOnDeviceSpeechRecognizer` and Android `TextToSpeech`.
- **Lab**: The isolated volume-down experimental pipeline.
- **Frame bus**: A lab-only `AudioRecord` producer that emits fixed-size PCM frames to consumers.
- **Consumer**: A non-blocking analysis component such as pre-roll, VAD, wake-word scoring, or telemetry.
- **Promotion gate**: A later explicit decision to move a lab capability into production behavior.
