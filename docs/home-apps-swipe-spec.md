# Home And Apps Swipe Spec

## Goal

Keep the cover display intentionally small: one home screen, plus the swipe-up app drawer/app feed. Voice, PTT, LiveKit, and VM turn events must keep working as backend behavior, but they must not drive visual cover modes.

This repo hosts the Android WebView shell. The actual `/pucky-home` portal HTML/JS is served by Project Vox outside this repository, so this spec defines the contract that external portal should implement.

## Kept Surfaces

- `home`: the existing "Hey Pucky..." home screen.
- `apps`: the swipe-up app drawer/app feed.
- `threads`: allowed as an app destination.
- `inbox`: allowed as an app destination.

Android still accepts these modes through `cover_mode` launch extras and returns them from `PuckyAndroid.getState()`.

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

The portal receives `pucky.cover_state.v1` through:

- `window.PuckyInitialState`
- `window.PuckyCover.applyState(...)`
- `/pucky-ui/state`
- `/pucky-ui/live`

The stripped state contains:

- `mode`: one of `home`, `apps`, `threads`, or `inbox`.
- `theme`: `light` or `dark`.
- `safe_rect`: the Razr cover-safe dimensions.
- `livekit`: connection/debug status only.
- `turn`: always idle and transcript-free.
- `threads`, `current_thread_id`, and `inbox`: empty placeholders for portal compatibility.

Android no longer sends `call_visual`, no longer derives `mode` from LiveKit/PTT events, and no longer scans LiveKit event history to infer a cover-screen turn.

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
- Keep the safe-rectangle layout and theme variables.
- Keep app navigation local and explicit.
- Keep normal scroll behavior in app surfaces that need it.

## Acceptance Criteria

- From `home`, swipe up opens `apps`.
- From `apps`, swipe down returns to `home`.
- Launching with `cover_mode=home|apps|threads|inbox` works.
- Launching with `cover_mode=listening|finalizing|thinking|speaking` is ignored.
- PTT start/stop and VM `cover.event` activity do not change the displayed cover mode.
- `PuckyAndroid.getState()` never emits voice modes or `call_visual`.
- The portal can be rebuilt later from the home/apps contract without inheriting the old voice visual state machine.
