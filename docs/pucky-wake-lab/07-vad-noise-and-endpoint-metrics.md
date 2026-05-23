# VAD, Noise, And Endpoint Metrics

## Goal

Add Silero VAD as a lab-only measurement layer.

VAD is not allowed to control volume-down recording in v1. The user controls duration by holding and releasing the button. VAD observes and reports.

## Model

Target model:

- Silero VAD
- 16kHz variant
- ONNX format
- ONNX Runtime Mobile

The exact model file and ORT package should be captured in this doc once selected. The implementation should fail clearly if assets are missing.

## Metrics

For each lab session with VAD enabled, record:

- `vad_model`
- `vad_runtime`
- `vad_frame_count`
- `vad_speech_frame_count`
- `vad_max_probability`
- `vad_mean_probability`
- `vad_first_speech_at_ms`
- `vad_last_speech_at_ms`
- `candidate_speech_start_ms`
- `candidate_speech_end_ms`
- `candidate_endpoint_reason`
- `noise_floor_dbfs`
- `noise_floor_window_ms`

## Endpoint Rules

VAD may compute candidate endpoint events:

- speech starts when probability crosses the configured speech threshold
- speech ends when speech probability remains below threshold for the configured silence window
- default silence window for reporting: 800ms

But VAD must not call stop while the user is still holding volume down.

The session should record what VAD would have done so PM/engineering can tune endpoint behavior later.

## Adaptive Thresholds

Adaptive thresholds are report-only in this phase.

Record:

- measured noise floor
- static threshold
- adaptive threshold
- clamp range
- threshold function version

Default suggested clamp:

- min: 0.4
- max: 0.8

Do not use adaptive thresholds to alter behavior until fixture reports prove value.

## Tests

Unit tests:

- missing model returns unavailable state
- valid model loads
- synthetic silence stays below threshold
- synthetic speech-like fixture crosses threshold
- candidate start is emitted after speech begins
- candidate end is emitted after the silence window
- threshold function is monotonic
- threshold is clamped

Fixture tests:

- speech fixtures produce high probability
- silence fixtures produce low probability
- noise fixtures produce reported noise floor
- TV/music fixtures are measured for false speech tendency

Manual Razr test:

- hold volume down and speak
- hold volume down silently
- hold volume down near music/TV
- inspect VAD summary in last session
