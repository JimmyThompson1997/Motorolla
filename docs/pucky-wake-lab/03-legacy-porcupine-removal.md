# Legacy Porcupine Removal

## Why This Is In Scope

Porcupine is not just another experimental component. It requires Picovoice AccessKey/model configuration and creates licensing risk for paid-product use.

Because this workstream is explicitly moving toward an owned open-source audio lab, Porcupine should be removed from production now rather than left as quiet prototype wiring.

## Required Behavior

After removal:

- The APK must build without `ai.picovoice:porcupine-android`.
- Production source must not import `ai.picovoice.*`.
- Foreground service may keep the existing wake start/stop lifecycle calls, but those calls must be harmless no-ops.
- Wake commands must remain safe to call.
- Wake commands must clearly report disabled status rather than crashing.

## Stub Wake Status

The replacement wake status should return a stable disabled response.

Minimum fields:

- `schema`: `pucky.wake_word_status.v1`
- `engine`: `none`
- `enabled`: `false`
- `running`: `false`
- `configured`: `false`
- `reason`: `porcupine_removed_license_risk`
- `replacement`: `volume_down_lab_openwakeword_experiment`

Command behavior:

- `wake.status`: returns disabled status.
- `wake.config.set`: stores no commercial key, returns disabled status plus ignored fields.
- `wake.start`: returns disabled status.
- `wake.stop`: returns disabled status.
- `wake.simulate`: returns disabled status and does not trigger LiveKit or notifications.

## What Not To Touch

Do not delete LiveKit in this phase.

Do not alter:

- `PuckyAssistantController`
- power-hold assistant behavior
- `LiveKitController`
- `livekit.*` command routing

This phase is about licensing hygiene for Porcupine only.

## Tests

Source tests:

- `BuildConfig_hasNoPicovoiceDependency`
- `ProductionSource_hasNoPicovoiceImports`
- `ForegroundService_wakeLifecycleCallsAreNoOps`
- `WakeCommands_returnDisabledNoLicenseStatus`
- `VolumeDownLab_hasNoPorcupineReference`

Manual check:

- Install APK.
- Start foreground service.
- Confirm there is no Picovoice/Porcupine AccessKey error.
- Call `wake.status`.
- Confirm disabled status.
