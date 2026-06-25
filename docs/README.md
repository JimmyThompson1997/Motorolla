# Docs

This folder is the retained documentation set. Treat this file as the top-level map.

## Ownership

- `pucky_vm/`: VM service, hosted UI source, UI bundle generation, and VM tests.
- `pucky-apk/`: Android APK runtime, Gradle build, and `puckyctl`.
- `tools/proofs/`: proof implementations only.
- `tools/tests/`: tool and proof tests only.
- `tools/`: thin public facade for stable entrypoints such as deploy helpers and legacy proof wrappers.

## Canonical Commands

- Fast test: `python -m tools.dev test-fast`
- Full test: `python -m tools.dev test-full`
- Notes flash browser proof (local): `python -m tools.dev proof-local-notes-flash-browser`
- Notes flash browser proof (live): `python -m tools.dev proof-live-notes-flash-browser`
- Contacts search browser proof (local): `python -m tools.dev proof-local-contacts-search-browser`
- Contacts search browser proof (live): `python -m tools.dev proof-live-contacts-search-browser`
- Contacts classic-detail edit browser proof (local): `python -m tools.dev proof-local-contact-detail-classic-edit-browser`
- Contacts classic-detail edit browser proof (live): `python -m tools.dev proof-live-contact-detail-classic-edit-browser`
- Contacts classic-detail edit emulator proof (live): `python -m tools.dev proof-live-contact-detail-classic-edit-emulator`
- Local proof: `python -m tools.dev proof-local-web`
- Live proof: `python -m tools.dev proof-live-web`
- Deploy VM: `python -m tools.dev deploy-vm`
- Deploy APK: `python -m tools.dev deploy-apk`
- Refresh generated links catalog: `python -m tools.dev refresh-links-catalog`

## Safe Change Rules

- New proof implementations belong under `tools/proofs/` only.
- New tool tests belong under `tools/tests/` only.
- Top-level `tools/` files should be wrappers or public command entrypoints, not duplicated proof logic.
- VM or hosted UI changes should run the fast and full suites before merge.
- Behavior-adjacent VM or hosted UI changes should also run local proof, then live deploy proof if runtime behavior may have changed.

## Retained Project Docs

- `fresh-user-install-end-state.md`: current install, pairing, and runtime shape.
- `vm-installation-package-requirements.md`: VM deployment and runtime checklist.
- `pucky-base-instructions-custom.md`: base instruction template used for Pucky-launched Codex sessions.
- `pucky-meeting-developer-instructions.txt`: meeting-specific developer instruction file loaded by the VM.
- `mac-dev-setup.md`: local macOS setup and emulator bootstrap notes.
- `pucky-emulator-lab.md`: emulator workflow reference.
- `pucky-wake-lab/`: scoped wake and recipe design notes.
- `notes/`: targeted operator and implementation notes that are still intentionally kept.
