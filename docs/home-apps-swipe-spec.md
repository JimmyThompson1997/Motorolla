# Home Apps Swipe Spec

## Goal

Add a home-screen app drawer to the Pucky cover UI. From the home state, the user swipes up inside the safe rectangle and lands in an apps experience. The first apps are:

- Settings
- Threads

This should be implemented in the HTML portal path, not as a native Android fallback screen.

## Current Shape

The foreground Android app already hosts the cover UI as a WebView:

- `MainActivity` loads `http://127.0.0.1:8788/pucky-home`.
- The portal receives `pucky.cover_state.v1` via `window.PuckyInitialState`, `window.PuckyCover.applyState(...)`, `/pucky-ui/state`, and `/pucky-ui/live`.
- The current state includes `mode`, `theme`, `safe_rect`, `livekit`, `turn`, `threads`, `current_thread_id`, `threads_error`, and `inbox`.
- The safe rectangle is already explicit: `width_px: 992`, `top_px: 50`, `bottom_px: 102`.
- The current portal already renders `home`, `threads`, `inbox`, `thinking`, `listening`, `finalizing`, and `speaking`.
- The current Java side has older native `MODE_APPS` and `MODE_THREADS` surfaces, but those should be treated as historical/reference code only for this work.

## Can The Foreground App Do This?

Yes, with one important boundary.

If Pucky is the foreground cover activity/WebView, a swipe up inside the WebView content is ours to handle in HTML/JS. This is exactly the right place for a home-to-apps gesture.

If Motorola's launcher, Chrome, or another app is actually foregrounded, a normal APK cannot globally intercept the system home swipe or the launcher app drawer gesture. That would require being the selected cover home/secondary-home experience, a system launcher, accessibility-like mediation, device-owner privileges, or OEM hooks. For our plan, the requirement is therefore: Pucky must be the foreground cover home experience, and the gesture is a portal gesture inside Pucky's WebView.

## Product Behavior

Home:

- Shows the existing "Hey Pucky..." prompt and Threads icon.
- A short upward swipe anywhere in the safe card opens Apps.
- Tapping the Threads icon still opens Threads directly.

Apps:

- Keeps the same safe-card proportions.
- Shows a compact icon grid, not text-heavy tiles.
- Each app has one icon and one one-word label beneath it.
- First row:
  - Settings
  - Threads
- The app drawer can grow later with more app descriptors.
- A downward swipe or Home button returns to home.
- No native fallback grid. If the portal is broken, the feature is broken. That keeps the implementation honest.

Settings app:

- Starts as an in-portal settings surface.
- Shows high-signal device controls and links:
  - Theme: light/dark
  - Device/app status
  - Android app details via `settings.open` target `app_details`
  - Android home settings via `settings.open` target `home`
  - Network/Bluetooth/Display shortcuts via existing `settings.open` targets
  - Reload UI via `PuckyAndroid.reloadUi()`
- If we need editable broker/device settings later, add a dedicated bridge command instead of using shell commands from the UI.

Threads app:

- Reuses the existing portal `threads` mode and `renderThreads()`.
- The app tile sets `mode: "threads"`, posts a UI event, and calls `refreshVmState()`.

## Data Model

Add app metadata to portal JS first:

```js
const HOME_APPS = [
  {
    id: "settings",
    title: "Settings",
    subtitle: "Device and display",
    icon: "settings",
    mode: "settings"
  },
  {
    id: "threads",
    title: "Threads",
    subtitle: "Project Vox",
    icon: "threads",
    mode: "threads"
  }
];
```

Then support these portal-local modes:

- `home`
- `apps`
- `settings`
- `threads`
- existing voice modes

The Android `pucky.cover_state.v1` schema does not need to change for v1. `apps` and `settings` can be portal-local UI modes, merged the same way `threads` is protected from native state overwrites today. If Android should deep-link these modes later, add `apps` and `settings` to the native `cover_mode` allowlist and include them in the bridge state.

## Gesture Handling

Implement a small pointer gesture recognizer in `pucky-cover.js`:

- Listen on `.safe-card`.
- Start only from `mode === "home"` unless a mode opts in.
- Track `pointerdown`, `pointermove`, `pointerup`, and `pointercancel`.
- Open Apps when:
  - vertical delta is less than or equal to `-70px`
  - absolute horizontal delta is less than `90px`
  - duration is under `650ms`
  - target is not an interactive element
- Add a small drag affordance during movement using CSS transform/opacity, but do not block scroll in `threads` or transcript views.
- In Apps/Settings, allow downward swipe to return home.

Use `touch-action: none` only on the home safe card or a dedicated gesture layer. Do not apply it globally, because Threads needs normal scroll.

## Portal Implementation Points

`pucky-cover.css`:

- Add app drawer styles:
  - `.home-grabber`
  - `.apps-grid`
  - `.app-tile`
  - `.app-icon`
  - `.settings-list`
  - `.settings-row`
- Keep dimensions derived from `--safe-width`, `--safe-top`, and `--safe-bottom`.
- Keep text inside the safe card and avoid nested cards.
- Use the existing dark/light variables.

`pucky-cover.js`:

- Add `apps` and `settings` render branches.
- Add `renderApps()` and `renderSettings()`.
- Add `openMode(mode, source)` helper so clicks and gestures share behavior.
- Add gesture recognizer.
- Preserve the existing native/VM merge behavior:
  - Native `home` updates should not collapse `apps`, `settings`, `threads`, or `inbox` unless voice mode takes over.
  - Voice modes still override manual surfaces while active.

Bridge calls:

- Settings app details: `execute("settings.open", { target: "app_details" })`
- Home settings: `execute("settings.open", { target: "home" })`
- Wi-Fi/network panel: `execute("settings.open", { target: "internet_panel" })`
- Bluetooth: `execute("settings.open", { target: "bluetooth" })`
- Display: `execute("settings.open", { target: "display" })`
- UI reload: `PuckyAndroid.reloadUi()`

## Android Implementation Points

Minimal v1:

- No Android change is required for the app drawer if it is portal-local.
- Keep `MainActivity` as the foreground WebView host.
- Keep `PuckyAndroid.execute(...)`, `getState()`, and `reloadUi()` as the bridge.

Optional polish later:

- Add `MODE_SETTINGS`.
- Add `settings` and `apps` to `isKnownCoverMode(...)`.
- Include `apps/settings` in `isManualCoverSurface(...)` if native deep links need to preserve them.
- Update `launcherCapability()` because the manifest currently declares `SECONDARY_HOME`; do not claim full `HOME` unless the manifest actually adds it.

## Acceptance Criteria

- From `home`, a swipe up opens `apps`.
- Tapping Settings opens the in-portal Settings app.
- Tapping Threads opens the existing Threads app.
- Down swipe or Home returns to `home`.
- Voice state transitions still override the drawer.
- Threads list still scrolls normally.
- Light and dark themes both fit inside the safe rectangle.
- No native Java app-grid fallback is used as part of the feature.
