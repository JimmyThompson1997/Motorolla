# Audio Route Detector

## Goal

Expose the current audio input route so the lab can compare phone-mic, Bluetooth, and wired-headset behavior.

Bluetooth and wired microphones are product-critical because they turn the problem into near-field audio without requiring a far-field phone-mic breakthrough.

## Routes

The detector reports one primary route:

- `Phone`
- `Bluetooth`
- `WiredHeadset`
- `Unknown`

It should also expose debug details so engineers can inspect Android's lower-level state.

## Android APIs

Preferred implementation:

- `AudioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)`
- `AudioDeviceInfo.TYPE_BLUETOOTH_SCO`
- `AudioDeviceInfo.TYPE_BLUETOOTH_A2DP` where relevant for output context
- `AudioDeviceInfo.TYPE_WIRED_HEADSET`
- `AudioDeviceInfo.TYPE_USB_HEADSET`
- `AudioDeviceInfo.TYPE_BUILTIN_MIC`

Legacy debug fields may include:

- `isBluetoothScoOn`
- `isWiredHeadsetOn`
- `isMicrophoneMute`

Legacy fields should not be the primary classification mechanism.

## Status Shape

Minimum route status:

- `schema`: `pucky.audio_route_detector.v1`
- `route`
- `has_bluetooth_input`
- `has_wired_input`
- `has_builtin_mic`
- `input_devices`
- `legacy_bluetooth_sco_on`
- `legacy_wired_headset_on`
- `microphone_mute`

Each input device item should include:

- `id`
- `type`
- `type_name`
- `product_name`
- `address` when available
- `is_source`
- `sample_rates` when useful and not too verbose

## Lab Integration

On lab start:

- Snapshot route before grabbing mic.
- Store route in the session.
- Apply `route_required` gating if configured.
- Continue the session even if route changes unless the current engine explicitly requires restart.

Route changes during a session should be recorded as events but should not crash or implicitly start a new session.

## Tests

Unit tests with mocked device lists:

- no input devices -> `Unknown`
- built-in mic -> `Phone`
- Bluetooth SCO input -> `Bluetooth`
- wired headset input -> `WiredHeadset`
- USB headset input -> `WiredHeadset`
- multiple routes prefer Bluetooth over wired over phone, unless product later chooses another precedence

Manual Razr tests:

- no headset
- Bluetooth headset connected
- wired or USB-C headset connected if available
- route change before starting volume-down lab
- route change during volume-down lab
