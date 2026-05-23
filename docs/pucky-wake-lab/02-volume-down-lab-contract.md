# Volume-Down Lab Contract

## Goal

Turn volume-down hold/release into the isolated audio experiment surface for Pucky.

This lets engineering explore custom local audio components while protecting the high-value production paths:

- Volume-up walkie
- Pucky turn upload
- Reply cards
- Power-hold LiveKit
- Current runtime/Fly contract

## Gesture Contract

Default target state after Phase 2:

- `volume_down_hold` maps to `speech.echo.lab.start`
- `volume_down_hold_release` maps to `speech.echo.lab.stop`

The lab may expose multiple engines internally, but the physical gesture should always enter through the lab controller.

## Engine Modes

The lab controller should support these modes:

- `android_direct_echo`: the current stable direct Android STT/TTS behavior.
- `frame_bus_metrics`: `AudioRecord` frame capture, route info, pre-roll, and telemetry only.
- `frame_bus_vad`: frame bus plus Silero VAD metrics.
- `frame_bus_wake`: frame bus plus openWakeWord scoring metrics.

`android_direct_echo` is the reliability baseline and fallback. The more experimental engines may fail without breaking other app behavior.

## Public Commands

New command surface:

- `speech.echo.lab.status`
- `speech.echo.lab.start`
- `speech.echo.lab.stop`
- `speech.echo.lab.last`
- `speech.echo.lab.list`
- `speech.echo.lab.config.get`
- `speech.echo.lab.config.set`

Existing stable commands may remain:

- `speech.echo.status`
- `speech.echo.start`
- `speech.echo.stop`
- `speech.echo.last`
- `speech.echo.list`
- `speech.echo.delete`
- `speech.echo.voices`

If the implementation chooses not to add separate `speech.echo.direct.*` commands, `speech.echo.*` should remain the direct echo baseline and `speech.echo.lab.*` should be the experimental surface.

## Config Contract

The lab config should be stored in app-private preferences and exposed through command status.

Required keys:

- `engine`: default `android_direct_echo`
- `save_debug_audio`: default `false`
- `vad_enabled`: derived from engine unless explicitly overridden
- `wake_enabled`: derived from engine unless explicitly overridden
- `route_required`: default `none`

Valid `route_required` values:

- `none`
- `external`
- `Bluetooth`
- `WiredHeadset`
- `Phone`

If route requirement is not satisfied, start should fail with a clear session record and should not grab the mic.

## Non-Interference Rules

The lab must not:

- Modify volume-up mapping.
- Change `PuckyTurnController`.
- Change `VoiceCaptureController` behavior used by volume-up.
- Call LiveKit.
- Start global wake word.
- Upload audio to the agent.
- Store raw audio unless `save_debug_audio=true`.

## Manual QA Contract

Every phase must include a simple manual Razr test:

1. Hold volume down.
2. Observe expected ready feedback.
3. Speak or perform the intended lab input.
4. Release volume down.
5. Confirm cleanup and inspect status/last session.
6. Confirm volume-up walkie still works.
7. Confirm power-hold behavior still behaves as before.
