# Lab State Machine

## States

The volume-down lab has an explicit session state machine:

- `Idle`: no active lab session.
- `Starting`: command accepted, setup in progress.
- `Recording`: mic or direct recognizer is active.
- `Stopping`: release received, cleanup/finalization in progress.
- `Recognizing`: transcript or metric finalization in progress.
- `Speaking`: local TTS playback is active.
- `Completed`: session ended successfully.
- `Failed`: session ended with a recorded error.

The controller's top-level status should show `Idle` whenever no session is active, even if the last session completed or failed.

## Start Rules

On `speech.echo.lab.start`:

- If disabled, return a failed session with `error_code=lab_disabled`.
- If another lab session is active, return `already_active` and do not create a second mic user.
- If route requirements are not satisfied, return a failed session with route details.
- If mic permission is missing, return a failed session with `error_code=permission_missing`.
- Otherwise create a session and transition to `Starting`.

## Stop Rules

On `speech.echo.lab.stop`:

- If no session is active, return `no_active_session`.
- If session is `Starting`, cancel startup and record `stopped_before_ready`.
- If session is `Recording`, transition to `Stopping`.
- Cleanup must run even if recognizer, AudioRecord, VAD, wake model, or TTS throws.

Release is the most important lifecycle event. A release must always attempt to stop microphone use.

## Error Rules

Any recoverable error should:

- Write an error code.
- Write a human-readable error message.
- Mark whether the error came from app code, Android audio, Android STT, TTS, VAD, wake model, or route gating.
- Release mic resources.
- Persist the session.
- Return status to `Idle`.

Crashes from lab code are unacceptable because the lab is optional.

## Session Schema

Every session should include:

- `schema`: `pucky.speech_echo_lab_session.v1`
- `session_id`
- `state`
- `mode`
- `engine`
- `route`
- `started_at`
- `started_elapsed_ms`
- `ready_at`
- `release_at`
- `completed_at`
- `duration_ms`
- `error_code`
- `error_message`

Audio fields when frame bus is used:

- `sample_rate_hz`
- `channel_count`
- `encoding`
- `frame_size_samples`
- `frames_read`
- `frames_delivered`
- `frames_dropped`
- `max_frame_gap_ms`
- `preroll_ms`

STT/TTS fields when direct echo is used:

- `recognizer_mode`
- `language`
- `formatting_mode`
- `final_transcript`
- `alternatives`
- `confidence_scores`
- `tts_voice`
- `tts_started_at`

Optional metrics:

- `noise_floor_dbfs`
- `vad_summary`
- `wake_summary`
- `debug_audio_artifact`

## Transition Table

Allowed transitions:

- `Idle -> Starting`
- `Starting -> Recording`
- `Starting -> Failed`
- `Starting -> Idle` after cancellation
- `Recording -> Stopping`
- `Stopping -> Recognizing`
- `Stopping -> Completed`
- `Stopping -> Failed`
- `Recognizing -> Speaking`
- `Recognizing -> Completed`
- `Recognizing -> Failed`
- `Speaking -> Completed`
- `Completed -> Idle`
- `Failed -> Idle`

Unexpected transitions should be rejected in tests, not silently ignored.
