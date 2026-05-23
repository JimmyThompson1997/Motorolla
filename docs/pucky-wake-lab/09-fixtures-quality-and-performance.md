# Fixtures, Quality, And Performance

## Goal

Create a repeatable measurement system before treating wake-word or VAD quality as production-ready.

For early lab phases, metrics are reported but not hard-blocking. They become gates only after the fixture corpus is real and PM accepts the quality bars.

## Fixture Layout

Recommended repo layout:

- `pucky-apk/app/src/test/resources/audio-fixtures/smoke/`
- `pucky-apk/app/src/test/resources/audio-fixtures/speech/`
- `pucky-apk/app/src/test/resources/audio-fixtures/silence/`
- `pucky-apk/app/src/test/resources/audio-fixtures/noise/`
- `pucky-apk/app/src/test/resources/audio-fixtures/wake-positive/`
- `pucky-apk/app/src/test/resources/audio-fixtures/wake-negative/`
- `pucky-apk/app/src/test/resources/audio-fixtures/similar-phrases/`

Tiny smoke fixtures can live in git. Large corpora should use Git LFS or an external artifact bucket with a documented fetch script.

## Fixture Manifest

Each fixture directory should include a manifest:

- `filename`
- `sample_rate_hz`
- `channels`
- `duration_ms`
- `speaker_id` when known
- `environment`
- `route`
- `contains_speech`
- `contains_wake_phrase`
- `wake_phrase_start_ms`
- `wake_phrase_end_ms`
- `speech_segments`

## Metrics

VAD metrics:

- speech detection accuracy
- silence rejection rate
- candidate endpoint accuracy
- inference time p50/p95/p99

Wake metrics:

- false accept rate
- false reject rate
- detection latency
- score distribution
- threshold sensitivity

Frame bus metrics:

- frames read
- frames dropped
- max frame gap
- consumer delivery latency

Device metrics:

- CPU timing per inference
- service memory estimate
- battery estimate from manual/instrumented sessions

## Initial Quality Targets

Initial targets are report-only:

- VAD speech detection: target greater than 95 percent on labeled fixture set
- VAD endpoint within +/- 200ms: target greater than 85 percent
- wake false accepts: report by environment, do not block until corpus is approved
- wake false rejects: report by route and environment, do not block until corpus is approved
- frame drops: zero in smoke tests, reported in longer tests

## Reports

Each run should emit JSON:

- `schema`: `pucky.audio_lab_report.v1`
- `generated_at`
- `git_commit`
- `device` when applicable
- `fixture_set`
- `engine`
- `metrics`
- `failures`
- `warnings`

Reports should be easy to attach to PRs and manual test notes.

## Performance Runs

Do not make 4-hour battery tests ordinary PR gates.

Suggested cadence:

- PR/unit gate: source tests, unit tests, tiny fixture smoke tests
- Nightly or manual lab gate: larger fixture set
- Device lab gate: Razr capture/perf session
- Product promotion gate: corpus-backed FAR/FRR and battery report
