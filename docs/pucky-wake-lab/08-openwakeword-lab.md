# openWakeWord Lab

## Goal

Evaluate openWakeWord as an owned, open-source wake-word candidate without shipping production always-on wake word.

In this workstream, openWakeWord runs only inside the volume-down lab or offline fixture tests.

## Non-Goals

V1 does not include:

- background always-on wake word
- user-programmable wake words
- spoken mic-on/mic-off commands
- global wake behavior outside volume-down
- automatic agent activation from phone-mic wake word

## Model Assets

Expected built-in candidate:

- `hey_pucky.onnx`

The model should be loaded from APK assets or test resources depending on phase.

The training pipeline is out of app runtime scope and should be documented separately when real training begins.

## Runtime Behavior

When engine is `frame_bus_wake`:

- frame bus captures audio during volume-down hold
- openWakeWord consumer scores frames/windows
- detections are recorded as telemetry
- no global action is fired
- no agent turn is started

Session fields:

- `wake_model`
- `wake_runtime`
- `wake_threshold`
- `wake_adaptive_threshold`
- `wake_score_max`
- `wake_detection_count`
- `wake_first_detection_ms`
- `wake_last_detection_ms`
- `wake_latency_from_phrase_end_ms` when fixture ground truth is known

## Thresholding

Initial thresholds should be conservative and configurable.

Threshold output is lab telemetry until fixture corpus exists. Do not use threshold changes to enable production wake behavior.

## Tests

Unit tests:

- missing model reports unavailable state
- model loads from assets/test resources
- scoring path does not crash on silence
- detection result is recorded in session summary

Fixture tests:

- positive "Hey Pucky" fixtures produce detections
- negative ambient fixtures report false accepts
- similar phrase fixtures report false accepts separately
- latency from known phrase end is measured

Manual Razr tests:

- hold volume down and say "Hey Pucky"
- hold volume down and say similar phrases
- hold volume down near TV/music
- inspect wake score summary

## Promotion Rule

openWakeWord cannot leave the lab until:

- corpus exists
- FAR/FRR reports are stable
- battery/perf reports exist
- PM explicitly accepts quality bars
- a separate production wake-word PRD is approved
