# Video Attachment Player Upgrade Plan

## Summary

Pucky currently has a small set of HTML/WebView media primitives: chat media rail, image gallery, rich HTML iframe, document preview/fallback, audio player, and a simple custom video viewer. That is the right architecture shape, but the video primitive is underbuilt: it wastes space on duplicate title/subtitle text, has no scrubber, no draggable timeline, and relies on a base64/data URL path that is acceptable for tiny clips but not robust for larger videos.

For this pass, keep the video player custom and lightweight rather than adopting a full media library. Native HTML `<video>` plus a compact Pucky control plane is the simplest correct v1 for the cover WebView.

## Key Changes

- Keep the shared Pucky shell header as the video title and remove the large duplicate metadata block below the video.
- Add a compact video control plane with elapsed time, draggable timeline, scrubber dot, duration/remaining time, and play/pause state.
- Let tapping the video or central play button toggle play/pause; let dragging the timeline seek and update `video.currentTime`.
- Prefer `artifact.url` for video sources when available so WebView can stream from cached local artifacts instead of always forcing base64.
- Keep base64/data URL as a bounded fallback for small clips only.
- Add at least one second real video-format fixture when available, ideally WebM; if no converter/fixture exists, prove MP4 first and record the limitation.
- Unsupported video-like attachments should show a clean unavailable state, not a broken black pane.

## TDD Plan

- Assert `showVideoAttachment(...)` no longer appends the large visible `attachmentMeta(...)` block beneath the player.
- Assert video detail DOM includes `.video-timeline`, `.video-progress`, `.video-scrubber`, elapsed label, duration label, and play/pause control.
- Assert `loadedmetadata`, `timeupdate`, `seeked`, `play`, `pause`, and `ended` refresh the timeline UI.
- Assert scrub math maps pointer x-position to clamped `currentTime` and updates progress fill plus scrubber dot.
- Assert standalone video opens through the shared side-detail shell and audio remains on its current audio-player path.
- Assert video source resolution prefers `artifact.url` unless forced to fallback and does not unnecessarily base64-load large videos.

## Real Device Acceptance

- Deploy from clean pushed `master` only, using the cached HTML bundle unless a native bridge change is required.
- Open the current `video_4.mp4` attachment on the cover display and capture screenshots for paused, playing, mid-playback, scrubbed-to-middle, and ended/replay states.
- Drag the timeline to about 50 percent, verify timestamp changes, and verify the visible frame jumps.
- Drag near the end, verify completion state and replay behavior.
- Test a second real video type if available; otherwise explicitly report MP4-only proof.
- Test an unsupported video file and verify a clean error state.
- Capture logcat filtered for `Pucky`, `chromium`, and `AndroidRuntime`; do not call success if WebView reports decode/source errors.

## Assumptions

- Do not add Video.js or Plyr in this pass; consider them later only if we need captions, playlists, streaming formats, or complex controls.
- Consider PDF.js later for PDFs because Android WebView does not render PDFs natively.
- The Pucky shell continues to own navigation, header, back behavior, and voice dot; generated artifacts and media viewers should not recreate that chrome.
