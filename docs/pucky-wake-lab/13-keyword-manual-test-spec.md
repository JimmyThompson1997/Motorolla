# Keyword Manual Test Spec

## Purpose

This document defines the manual and broker-driven proof pass for the volume-down keyword recipe layer.

The goal is to prove three things separately:

- Active phrases match exactly after normalization.
- Longer natural-language sentences do not accidentally trigger keyword actions.
- Device actions create durable Pucky Clipboard entries and expected Android artifacts.

This spec is lab-only. It does not change volume-up walkie, power-hold behavior, LiveKit, or global wake-word behavior.

## Preconditions

- Physical Razr is connected over USB and visible to ADB.
- Local broker is running and the APK is online.
- `adb reverse tcp:8787 tcp:8787` is active when testing against a local broker.
- Pucky app is foregrounded when testing physical volume-down capture.
- Pucky AccessibilityService is enabled before screenshot success tests.
- The screen to screenshot is awake. If no display is on, screenshot should fail clearly with `NO_DISPLAY_ON`.

## Identity Checks

Before testing, capture:

- Device serial and model from `adb devices -l`.
- Installed APK identity from `status.get`.
- Broker health from `/health`.
- Active recipes from `pucky.recipes.list`.
- Supported primitives from `device.primitives.list`.

The test report should include APK `versionCode`, `versionName`, `git_branch`, `git_commit`, and `git_dirty`.

## Active Keyword Coverage

Run `pucky.recipes.test` with `execute=false` for every active phrase from `pucky.recipes.list`.

Expected built-in phrases:

- `hey pucky`
- `hey puppy`
- `hey lucky`
- `hay pucky`
- `hey pocky`
- `hey packy`
- `pucky`
- `puppy`
- `pocky`
- `packy`
- `mic on`
- `mike on`
- `microphone on`
- `mic off`
- `mike off`
- `microphone off`

Expected action phrases:

- `flashlight`
- `flash light`
- `photo`
- `take photo`
- `take picture`
- `picture`
- `pin location`
- `save location`
- `location`
- `screenshot`
- `screen shot`
- `capture screen`
- `take screenshot`
- `video on`
- `start video`
- `record video`
- `video off`
- `stop video`

Pass condition: every phrase returns `matched=true`, the expected `recipe_id`, and `match_strategy=exact_utterance`.

## Negative Exact-Match Tests

Run `pucky.recipes.test` with `execute=true` for phrases that contain a keyword but are not exact commands.

Required negative probes:

- `hey pucky please`
- `microphone off hand`
- `turn flashlight on`
- `take screenshot please`
- `please pin location`
- `record video now`
- `video off please`
- `record audio`

Pass condition: every probe returns `matched=false` and `execution_status=skipped_no_match`. No device action should run and no artifact should be created.

## Device Action Tests

Use `pucky.recipes.test` with `execute=true`.

### Flashlight

Run:

- `flashlight`
- `flash light`

Pass condition:

- `execution_status=succeeded`
- primary command is `torch.set`
- result includes `enabled=true`
- result includes a bounded `auto_off_ms`
- Pucky Clipboard entry is appended

### Photo

Run:

- `photo`
- `take photo`
- `take picture`
- `picture`

Pass condition:

- `execution_status=succeeded`
- primary command is `photo.capture`
- artifact kind is `photo`
- private file exists under app-private `Pictures`
- public image is published under `DCIM/Pucky`
- MediaStore URI is present
- image byte count is nonzero

### Location

Run:

- `pin location`
- `save location`
- `location`

Pass condition:

- `execution_status=succeeded` when either a fresh or stale location sample is available
- result includes `schema=pucky.location.v1`
- result includes `fresh`, `stale`, `timeout_ms`, and `sample`
- sample includes provider, latitude, longitude, timestamp, and accuracy when available
- Pucky Clipboard entry is appended

If no fresh fix is found inside 4000 ms, stale fallback is acceptable only when the entry clearly marks `fresh=false` and `stale=true`.

### Screenshot

Run first with accessibility disabled or no awake screen to prove the failure path.

Expected failure cases:

- Accessibility disabled: `PERMISSION_MISSING`
- No display on: `NO_DISPLAY_ON` with message `Failed. Phone screen is off.`

Then enable Pucky AccessibilityService and wake the active screen.

Run:

- `screenshot`
- `screen shot`
- `capture screen`
- `take screenshot`

Pass condition:

- `execution_status=succeeded`
- primary command is `screenshot.capture`
- artifact kind is `screenshot`
- private file exists under app-private `Pictures`
- public image is published under `DCIM/Pucky`
- selected display is the currently on display
- image byte count is nonzero

### Video

Run paired start/stop sequences:

- `video on`, wait about 2 seconds, `video off`
- `start video`, wait about 2 seconds, `stop video`
- `record video`, wait about 2 seconds, `video off`

Then run:

- `stop video` while inactive

Pass condition:

- start commands return `execution_status=succeeded`
- stop commands return `execution_status=succeeded`
- final video artifact kind is `video`
- private file exists under app-private `Movies`
- public video is published under `Movies/Pucky`
- MediaStore URI is present
- file byte count is nonzero
- inactive stop returns a clean no-active-video result rather than crashing

## Clipboard Checks

After action tests, run `pucky.clipboard.list`.

Pass condition:

- Clipboard count increases by the number of executed action recipes.
- Each entry has `source=volume_down_lab`.
- Each entry has `raw_transcript`, `normalized_transcript`, `keyword_id`, `keyword_phrase`, `match_strategy`, `action_command`, and action result.
- Artifact-producing actions include artifact references.
- `android_system_clipboard=false`.

Known telemetry issue to watch:

- Some recipe-test Clipboard entries currently preserve top-level `action_status=planned` even when nested `action_result.status=succeeded` or `failed`.
- The nested execution result is the current source of truth.
- This should be cleaned up so top-level `action_status` mirrors final execution status.

## Media Artifact Checks

Diff these folders before and after action tests:

- `/sdcard/DCIM/Pucky`
- `/sdcard/Movies/Pucky`
- `/sdcard/Android/data/com.pucky.device.debug/files/Pictures`
- `/sdcard/Android/data/com.pucky.device.debug/files/Movies`

Pull representative artifacts to the laptop for visual inspection:

- latest photo
- latest screenshot
- latest video

Pass condition:

- Public photo and screenshot files are visible under `DCIM/Pucky`.
- Public video files are visible under `Movies/Pucky`.
- Private artifacts are also present in app-private media folders.

## Physical Volume-Down Manual Smoke

The broker-driven test validates matching and action execution directly. It does not exercise microphone capture or Android STT.

For end-to-end physical smoke, use the phone:

1. Hold volume down.
2. Wait for ready haptic.
3. Speak exactly one keyword phrase.
4. Release volume down.
5. Confirm Android STT transcript matched exact keyword.
6. Confirm action, chime, TTS, Clipboard entry, and artifact behavior.

Run at least one physical smoke for:

- `flashlight`
- `photo`
- `pin location`
- `screenshot`
- `video on` followed by `video off`

## Audio Note

There is no current `record audio` keyword recipe. `record audio` should remain a negative exact-match test until an explicit audio primitive is added.

Volume-down keyword recognition still depends on the Android STT/TTS audio path during physical manual smoke. Broker-driven `pucky.recipes.test` intentionally bypasses microphone audio to make action behavior deterministic.
