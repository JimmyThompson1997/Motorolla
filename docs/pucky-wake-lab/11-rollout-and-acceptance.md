# Rollout And Acceptance

## Rollout Philosophy

The lab should be useful before it is production-ready.

Each phase should create a safer, more observable volume-down experiment without requiring the entire wake-word platform to be complete.

## Phase-Level Rollout

Phase 0 and Phase 1:

- Safe to ship as cleanup.
- Main user-facing change: Porcupine wake word no longer pretends to be configured.

Phase 2:

- Volume-down becomes lab-owned.
- Default engine remains direct Android echo, so user-visible behavior stays useful.

Phase 3:

- Route status becomes visible.
- Product can start testing Bluetooth/wired headset quality.

Phase 4:

- Frame bus becomes available for metrics.
- No product behavior should depend on it yet.

Phase 5 and Phase 6:

- VAD and openWakeWord become measurable.
- Still lab-only.

Phase 7 and Phase 8:

- PM and engineering review reports.
- Promotion decisions are made explicitly.

## V1 Acceptance Criteria

V1 of this workstream is accepted when:

- Porcupine is removed from production build/source.
- Wake commands return stable disabled status.
- Volume-down maps to lab start/stop.
- Lab default engine remains usable on the Razr.
- Lab sessions record structured telemetry.
- Audio route appears in lab status/session.
- Volume-up walkie behavior is unchanged.
- Power-hold LiveKit behavior is unchanged.
- Lab code has no LiveKit dependency.
- Raw audio is not stored unless debug saving is explicitly enabled.
- Unit/source tests pass.
- Manual Razr smoke test passes.

## Not Required For V1 Acceptance

These are not required to accept the lab workstream:

- Production always-on wake word
- PM-approved FAR/FRR bars
- full fixture corpus
- Silero production endpointing
- openWakeWord production activation
- streaming PCM upload
- replacement of Android direct STT/TTS
- deletion of LiveKit
- user-programmable wake words
- keyword macro routing

## Manual Razr Smoke Test

Run after each implementation phase:

1. Install APK.
2. Start foreground service.
3. Hold volume down.
4. Confirm expected lab feedback.
5. Release volume down.
6. Inspect `speech.echo.lab.last`.
7. Confirm no raw audio artifact unless debug saving was enabled.
8. Run volume-up walkie.
9. Confirm reply card still appears.
10. Trigger power-hold path if available and confirm unchanged behavior.
11. Confirm `wake.status` reports Porcupine-disabled state.

## Future Production Wake PRD Trigger

A separate production wake PRD can start only after:

- openWakeWord model assets are selected
- fixture corpus exists
- battery/perf report exists
- route strategy is agreed
- phone-mic wake quality is measured
- Bluetooth/wired behavior is measured
- privacy policy for wake telemetry is approved
- PM accepts FAR/FRR targets

Until then, wake-word work remains a lab experiment behind volume-down.
