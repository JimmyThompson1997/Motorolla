# Mac Dev Setup

This repo now has a first-class macOS bootstrap path for the Pucky VM, APK,
and emulator tooling.

## Quickstart

From the repo root:

```bash
./tools/bootstrap_mac_dev.sh
```

If Homebrew or `sudo` is unavailable, use the user-local bootstrap instead:

```bash
./tools/bootstrap_local_dev_env.sh
source .tmp/pucky-local-dev-env.sh
```

That script installs or wires up:

- Homebrew bundle dependencies from `Brewfile`
- Python 3.12
- Node 20
- OpenJDK 17
- FFmpeg
- Android command-line tools
- Android platform-tools
- Android API 35 platform, build-tools, emulator, and system image
- Gradle wrapper prerequisites for `pucky-apk/gradlew`

At the end it writes:

- `.tmp/pucky-mac-dev-env.sh`
- `.tmp/pucky-mac-dev-doctor.json`

The local fallback writes:

- `.tmp/pucky-local-dev-env.sh`
- `.tmp/pucky-local-dev-doctor.json`

Use the env file in a new shell if needed:

```bash
source .tmp/pucky-mac-dev-env.sh
```

For the user-local bootstrap:

```bash
source .tmp/pucky-local-dev-env.sh
```

## Doctor

Run the doctor anytime you want a quick health check:

```bash
python3 tools/dev_env_doctor.py
python3 tools/dev_env_doctor.py --json
python3 tools/dev_env_doctor.py --include-emulator
```

The doctor checks the local Python, Node, Java, Gradle wrapper, Android SDK,
ADB, emulator tools, expected SDK packages, `puckyctl`, and the fake broker
workspace.

The local bootstrap installs its toolchain under `~/.local/pucky-dev`, and the
doctor recognizes that layout without requiring Homebrew on `PATH`.

## Common Next Steps

APK build:

```bash
cd pucky-apk
./gradlew test assembleDebug
```

VM service:

```bash
python3.12 -m pucky_vm
```

Emulator lab:

```bash
python3 tools/pucky_emulator_suite.py doctor
python3 tools/pucky_emulator_suite.py create --slot 1
python3 tools/pucky_emulator_suite.py start --slot 1
python3 tools/pucky_emulator_suite.py provision --slot 1
python3 tools/pucky_emulator_suite.py smoke --slot 1
```

## Notes

- The VM shell scripts now require Python 3.12 or newer.
- On Apple Silicon, the bootstrap installs the `arm64-v8a` Android 35 system
  image by default.
- On Intel macOS, the bootstrap falls back to the `x86_64` Android 35 system
  image.
