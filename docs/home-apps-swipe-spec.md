# Home And Apps Swipe Spec

## Goal

Keep the cover display intentionally small: one home screen, plus the swipe-up app drawer/app feed. Voice, PTT, LiveKit, and VM turn events must keep working as backend behavior, but they must not drive visual cover modes.

This repo hosts the Android WebView shell. The actual `/pucky-home` portal HTML/JS is served by Project Vox outside this repository, so this spec defines the contract that external portal should implement.

The boundary is strict: Android owns native capabilities and facts only. Project Vox owns every visible product surface, including home, apps, setup, admin, threads, inbox, placeholders, and later rebuilds. The APK may show only platform-owned Android surfaces and a bundled local HTML recovery page if the VM portal cannot load.

## Kept Surfaces

- `home`: the existing "Hey Pucky..." home screen.
- `apps`: the swipe-up app drawer/app feed.
- `threads`: allowed as an app destination.
- `inbox`: allowed as an app destination.
- `admin`: VM-rendered development/provisioning surface.
- `assistant_setup`: VM-rendered assistant setup prompt.

These modes are VM/HTML state. Android must not accept launch extras or native events that directly select them.

## Removed Surfaces

These modes are intentionally no longer emitted by Android cover state:

- `listening`
- `finalizing`
- `thinking`
- `speaking`

The cover UI should delete or ignore any HTML/CSS/JS pages/components dedicated to those voice visuals. If a stale portal still has those render branches, they should be unreachable from native state.

## Current Android Contract

`MainActivity` loads:

```text
http://127.0.0.1:8788/pucky-home
```

The portal receives VM-owned `pucky.cover_state.v1` through Project Vox:

- `window.PuckyInitialState`
- `window.PuckyCover.applyState(...)`
- `/pucky-ui/state`
- `/pucky-ui/live`

That cover state contains:

- `mode`: one of `home`, `apps`, `threads`, or `inbox`.
- `turn`: always idle and transcript-free.
- `threads`, `current_thread_id`, and `inbox`: lightweight app data owned by the VM.

Android exposes native facts to the portal bridge as `pucky.native_context.v1` through:

- `PuckyAndroid.getNativeContext()`
- `PuckyAndroid.getState()` as a backward-compatible alias

The native context contains:

- `device_id`: current paired device id.
- `theme`: native shell light/dark preference.
- `livekit`: connection/debug status only.

The Razr cover-safe dimensions belong to the VM/HTML layer, not Android. The current canonical values are `width_px=992`, `top_px=50`, and `bottom_px=102`, mirrored in the portal defaults and CSS variables.

Android no longer sends `call_visual`, no longer sends cover `mode`, no longer derives `mode` from LiveKit/PTT events, and no longer scans LiveKit event history to infer a cover-screen turn.

## Gesture Behavior

Home:

- Swipe up inside the safe rectangle opens `apps`.
- Tapping app icons can open destinations such as `threads`.
- Voice activity does not interrupt or replace the screen.

Apps:

- Swipe down returns to `home`.
- The app feed can grow later, but it should stay visually lightweight.
- If an app destination is not ready, prefer a simple placeholder over a new state machine.

## Voice Behavior

Push-to-talk and LiveKit remain backend controls:

- Volume-up hold starts LiveKit PTT.
- Volume-up release stops LiveKit PTT.
- Long-press power toggles LiveKit PTT through Android's assistant integration.
- VM `cover.event` commands may still be logged and may still trigger haptics, but they must not change cover UI mode.

The voice agent should be heard, not visualized. The cover screen should stay on the user's chosen surface unless the user explicitly swipes or opens an app.

## Portal Cleanup Checklist

- Delete voice visual pages/components for `listening`, `finalizing`, `thinking`, and `speaking`.
- Delete code that lets VM/LiveKit events override manual `home`, `apps`, `threads`, or `inbox` surfaces.
- Keep one home renderer and one apps/app-feed renderer.
- Keep the safe-rectangle layout and theme variables in VM HTML/CSS.
- Keep app navigation local and explicit.
- Keep normal scroll behavior in app surfaces that need it.
- Treat Android bridge data as native context only. It may update safe area/theme/LiveKit facts, but it may not update cover `mode`.

## Acceptance Criteria

- From `home`, swipe up opens `apps`.
- From `apps`, swipe down returns to `home`.
- Launching with any `cover_mode` extra does not change the cover UI.
- PTT start/stop and VM `cover.event` activity do not change the displayed cover mode.
- `PuckyAndroid.getNativeContext()` emits `pucky.native_context.v1`.
- `PuckyAndroid.getState()` remains only as a compatibility alias for native context.
- Android bridge state never emits cover `mode`, voice modes, `turn`, `threads`, `inbox`, or `call_visual`.
- The portal can be rebuilt later from the home/apps contract without inheriting the old voice visual state machine.
