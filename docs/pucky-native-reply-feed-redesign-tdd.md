# Pucky Native Reply Feed Redesign TDD

## Goal

Make the cover-screen reply feed feel like a small native inbox: scrollable, calm by default, and able to open transcript, web, and audio detail surfaces without crowding each card.

The feed is owned by the APK. The runtime supplies card data, local audio paths, local HTML paths, and transcript messages through `ui.reply_cards.set`.

## Current Fix List

1. Feed scrollability
2. Slide-in detail surfaces for web replies and transcripts
3. Swipe-right return from detail surfaces
4. Full-canvas web and transcript layouts with no ugly permanent back button
5. Revised compact audio behavior on feed cards
6. Full-screen audio controls modal

## 1. Feed Scrollability

Problem:

The reply feed currently appears non-scrollable when four cards are present on the Razr cover display. The fourth card can be partially hidden behind the Android navigation bar, and the user cannot reliably scroll to inspect additional replies.

Expected behavior:

- The reply card list must scroll vertically when content exceeds the visible cover height.
- The bottom-most card must be reachable above the Android navigation bar.
- The header/mail icon may remain visually fixed only if it does not block scrolling.
- Scroll behavior must work with touch input on display `1`, not just in code inspection.
- Tapping card controls must not accidentally start a scroll gesture.

TDD checks:

- Add a shell/unit source test asserting `MainActivity` keeps reply cards inside a `ScrollView` or equivalent scroll container.
- Add a source test asserting the feed has bottom padding or clipping protection for the Android navigation bar.
- Add a source test asserting rich reply WebView content has its own bottom safe padding.
- Add an on-device smoke test with at least four cards: swipe up on the feed, screenshot, verify lower cards are reachable.
- Add a regression note: if active audio expands a card, scrolling must still reach all cards.

## 2. Slide-In Detail Surfaces

Problem:

The current eye/web detail uses a floating back button. It works, but it is visually clunky on the cover screen. Transcript mode still uses a full top bar, which costs even more vertical space.

Expected behavior:

- Tapping the eye icon opens the rich reply as a detail surface that slides in from the right.
- Tapping the transcript icon opens the transcript as a detail surface that also slides in from the right.
- Returning to the feed should feel like sliding/swiping the detail surface away, not launching a separate heavy screen.
- The transition should preserve the mental model: feed is behind, detail comes in from the right.

TDD checks:

- Source test asserts web and transcript launches use a shared detail transition helper or both call `overridePendingTransition`.
- Source test asserts both detail Activities define matching enter/exit animations.
- Manual/on-device test: tap eye, observe right-to-left entrance; return, observe left-to-right exit.
- Manual/on-device test: tap transcript, observe same motion language.

## 3. Swipe-Right Return

Problem:

The user should not need a visible back button if the detail surface has a natural gesture exit.

Expected behavior:

- Swiping right from the left edge of a web detail returns to the feed.
- Swiping right from the left edge of a transcript detail returns to the feed.
- Web pages must still allow normal vertical scrolling, tapping, and JavaScript interaction.
- Swipe-back should be edge-biased for web details so it does not steal normal page gestures.

TDD checks:

- Source test asserts both detail Activities install a swipe-right gesture detector.
- Source test asserts the web swipe detector uses an edge threshold.
- On-device test: open web detail, swipe right from left edge, feed returns.
- On-device test: vertical scroll/tap inside web content still works.
- On-device test: open transcript, swipe right from left edge, feed returns.

## 4. Full-Canvas Detail Layouts

Current state:

- Rich web replies already use `MATCH_PARENT` for the `WebView` with no top margin.
- Transcript replies still reserve a native `58dp` top bar and put the scroll area below it.

Expected behavior:

- Web detail remains full-canvas.
- Transcript detail should become full-canvas too.
- If a fallback back affordance is kept during development, it should be temporary and visually unobtrusive.
- The permanent native top bar should be removed from transcript mode once swipe-right return is reliable.

TDD checks:

- Source test asserts `RichReplyActivity` has no reserved `webParams.topMargin`.
- Source test asserts `TranscriptActivity` no longer uses a permanent top margin for a top bar.
- Screenshot test/manual check: transcript messages can occupy the top of the cover canvas.
- Screenshot test/manual check: web content can occupy the full cover canvas.

## 5. Compact Feed Audio Behavior

Problem:

The current feed audio player exposes scrubber, speed, and skip buttons directly inside the card. It is functional, but it makes the feed feel like a control panel instead of an inbox.

Expected behavior:

- The left identity icon becomes the default play/pause control when the card has audio.
- The icon should keep the same white silhouette style unless we later add a subtle active state.
- Tapping the card body should not be overloaded with multiple modes.
- While audio is playing, the card body should show a compact waveform/visualizer instead of full podcast controls.
- The visualizer is display-only at first, unless tapped to open the full audio modal.

TDD checks:

- Source test asserts audio cards attach play/pause handling to the identity icon.
- Source test asserts compact feed audio does not render speed buttons or skip buttons in the card body.
- Source test asserts active audio cards render a compact visualizer view.
- On-device test: tap identity icon to play, tap again to pause.
- On-device test: playing one card pauses any previously playing card and preserves position.

## 6. Full-Screen Audio Controls Modal

Problem:

Podcast-style controls are still useful, but they should live in a deliberate audio control surface rather than in every card.

Expected behavior:

- Tapping the active card visualizer opens a full-screen or near-full-screen audio modal.
- The modal contains classic controls: play/pause, scrubber, current time, total duration, skip back 15, skip forward 30, and speed selection.
- Speed selection can continue to use the bottom-sheet/popup pattern.
- The current global default playback speed remains the baseline.
- The data structure should keep allowing per-card playback speed later.
- Closing the modal returns to the feed without stopping audio.

TDD checks:

- Source test asserts full controls live in an audio modal/sheet class or method, not the feed card body.
- Source test asserts speed data remains keyed by card/audio identity and falls back to a global speed.
- On-device test: play audio, open modal, scrub, change speed, close modal, audio continues.
- On-device test: open another card or detail surface, previous audio pauses and saved position remains.

## Review Questions

- Should swipe-right return be edge-only for both transcript and web, or only web?
- Should the audio visualizer be purely decorative at first, or should it show rough progress?
- Should feed header/mail icon stay fixed, or should it scroll away with cards to save space?
- Should we make card height denser before or after the scrollability fix?

## First Implementation Slice

Do the smallest useful slice first:

1. Fix feed scrollability and bottom navigation clearance.
2. Add four-card on-device smoke coverage.
3. Only then move to slide-in/swipe-right detail transitions.
