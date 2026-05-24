# Pucky Emulator Lab

This lab gives coding agents a safe, repeatable Android emulator lane for Pucky work. It is intentionally separate from the physical Razr deployment path.

## Safety Rules

- The harness only targets `emulator-*` serials.
- It refuses physical serials before building ADB commands.
- It does not call the physical phone deployment scripts.
- Dirty/local APKs are allowed here only because they install to emulator slots.
- Live `com.pucky.device.debug` phone deployment still requires clean pushed `master` and `git-<sha>` bundle naming.

Generated state lives under `.tmp/pucky-emulator*`.

## Slot Model

Each slot has its own AVD name, emulator port, fake broker port, UI server port, device id, run directory, and evidence directory.

Slot 1:

- AVD: `pucky_webview_api35_01`
- Serial: `emulator-5554`
- Broker: `18081`
- UI server: `18181`
- Device id: `pucky-emulator-slot-01`

Slot 2 uses `emulator-5556`, broker `18082`, and UI server `18182`.

## Workflow

```powershell
cd C:\Users\jimmy\Desktop\Motorolla-master-ui
python tools\pucky_emulator_suite.py doctor
python tools\pucky_emulator_suite.py create --slot 1
python tools\pucky_emulator_suite.py start --slot 1
python tools\pucky_emulator_suite.py provision --slot 1
python tools\pucky_emulator_suite.py seed-ui --slot 1
python tools\pucky_emulator_suite.py smoke --slot 1
```

Use dry-run mode to inspect plans without starting processes or installing anything:

```powershell
python tools\pucky_emulator_suite.py create --slot 1 --dry-run
python tools\pucky_emulator_suite.py provision --slot 1 --dry-run
python tools\pucky_emulator_suite.py seed-ui --slot 1 --dry-run
python tools\pucky_emulator_suite.py smoke --slot 1 --dry-run
```

Stop a slot:

```powershell
python tools\pucky_emulator_suite.py stop --slot 1
```

Clean slot-owned generated files:

```powershell
python tools\pucky_emulator_suite.py clean --slot 1
```

## What Provision Does

`provision` starts the fake broker, builds the debug APK unless `--skip-build` is passed, installs only to the emulator serial, sets a square cover-style screen size, reverses the broker port, launches `CoverHomeActivity`, and waits for the app to appear online in the fake broker.

## What Seed UI Does

`seed-ui` builds a cached HTML bundle, serves it over a slot-local HTTP server, reverses that port into the emulator, then uses `puckyctl` command-bus calls:

- `ui.bundle.refresh`
- `ui.reply_cards.set`

It does not use `adb push`, `run-as`, shared preferences, or app-private storage writes.

## Evidence

The smoke path writes evidence under:

```text
.tmp/pucky-emulator-runs/<run-id>/evidence
```

Typical files include broker logs, emulator logs, `seed-ui.json`, `smoke.json`, and `home-feed.png`.

## Limits

The emulator lab is for parallel agent confidence around APK startup, broker connection, cached HTML, command bus, cards, and screenshots. The physical Razr remains final acceptance for Moto cover-display behavior, wake/display policy, hardware buttons, sensors, and real audio routing.
