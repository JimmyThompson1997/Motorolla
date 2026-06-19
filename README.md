# Motorola Razr Pucky Workspace

This repo has three active ownership zones:

- `pucky_vm/`: the Fly-hosted VM service and the hosted `/ui/pucky/latest/` web surface.
- `pucky-apk/`: the Android APK runtime and phone-native capabilities.
- `tools/`: developer entrypoints, deploy helpers, proofs, and tool tests.

Live device traffic still flows through `wss://pucky.fly.dev/v1/devices/<device_id>/connect`, while the same VM also serves the hosted `/ui/pucky/latest/` surface.

## Repo Map

- `pucky_vm/` owns server behavior, hosted UI source, bundle generation, and VM-side tests.
- `pucky-apk/` owns device behavior, Gradle builds, and `puckyctl`.
- `tools/proofs/` owns real browser and device proof implementations.
- `tools/tests/` owns tests for tooling and proof contracts.
- `tools/` is the public command facade only. Real proof logic should not live at the top level.
- `docs/README.md` is the agent-facing map for current ownership, commands, and safe-change rules.

## Canonical Dev Commands

Use the Python task runner first:

```bash
python -m tools.dev test-fast
python -m tools.dev test-full
python -m tools.dev proof-local-web
python -m tools.dev proof-live-web
python -m tools.dev deploy-vm
python -m tools.dev deploy-apk
```

Generated inputs:

- `pucky_vm/ui_src/fixtures/links_catalog.json` is refreshed with `python -m tools.dev refresh-links-catalog`.
- `pucky_vm/ui_src/pucky-links-catalog.js` is bundle-generated. Do not hand-edit it.

## Safe Change Rules

- VM or hosted UI changes: run `python -m tools.dev test-fast`, then `python -m tools.dev test-full`.
- Behavior-adjacent VM or hosted UI changes: also run `python -m tools.dev proof-local-web`.
- Live behavior changes: push, deploy with `python -m tools.dev deploy-vm`, then verify the served manifest and real browser session on [pucky.fly.dev](https://pucky.fly.dev).
- APK deploys stay gated through `tools/deploy-canonical-apk.ps1` or `python -m tools.dev deploy-apk`.

See `pucky_vm/README.md` for VM/runtime specifics.
See `docs/README.md` for the full source-of-truth map.
