# Desktop Audio Probe

Headless macOS desktop/laptop audio capture spike for Pucky. This is intentionally separate from Electron and Android/APK code.

## Modes

- `fixture`: generate a deterministic WAV tone and upload it. No macOS permissions required.
- `mic`: record microphone audio with AVFoundation and upload it. Requires microphone permission for the terminal/app running the CLI.
- `system`: record system audio with ScreenCaptureKit and upload it. Requires macOS screen/system-audio capture permission.
- `dual`: record mic and system tracks into one bundle.

## Local Proof

```bash
python3 desktop_audio_probe/proofs/desktop_audio_probe_proof.py --target local --mode fixture
```

The proof starts a local Pucky VM handler, runs the Swift CLI, uploads the track, completes the bundle, verifies bytes/sha256 from authenticated metadata, and confirms unauthenticated metadata access returns `401`.

## Live Proof

```bash
PUCKY_API_TOKEN=... python3 desktop_audio_probe/proofs/desktop_audio_probe_proof.py \
  --target live \
  --base-url https://pucky.fly.dev \
  --mode fixture
```

Real mic/system proofs use the same command with `--mode mic`, `--mode system`, or `--mode dual`.
