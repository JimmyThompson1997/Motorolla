# VM Installation Package Requirements

This is the VM-side checklist for the current Pucky device runtime after the broker consolidation. It reflects the supported shape today: one `pucky` VM service that hosts both broker routes and the canonical hosted UI at `/ui/pucky/latest/`.

## Required Runtime Pieces

- Python 3.12 or compatible runtime for `pucky_vm/server.py`
- persistent storage for the broker database, currently `/data/pucky/broker.sqlite3`
- persistent workspace or deploy directory for the hosted UI source/bundle artifacts
- TLS-terminated public host, currently `pucky.fly.dev`
- operator tooling such as `puckyctl`

## Public Service Shape

The service should expose:

- `GET /healthz`
- `GET /health`
- `POST /api/turn`
- `GET /ui/pucky/latest/`
- `GET /ui/pucky/latest/manifest.json`
- `GET /ui/pucky/latest/bundle.zip`
- broker control-plane routes under `/v1/...`
- device websocket ingress under `/v1/devices/<device_id>/connect`

## Persistent Data

Keep these durable across restarts:

- broker database
- any operator logs or evidence worth retaining
- VM app configuration, including broker/operator tokens, web UI tokens, and bundle version env vars

## Phone-Side Expectations

The Android APK expects provisioning with:

- `device_id`
- `broker_url`
- `pucky_turn_url`
- `token`
- optional `pucky_api_token` (operator/broker token)
- optional `pucky_web_ui_token` (user-surface token)

The phone then:

- connects outbound to the broker websocket
- loads the user surface from `/ui/pucky/latest/bundle.zip` and keeps a local copy for startup resilience
- uses local bundle files for startup resilience and faster initial rendering

## What Is No Longer Required

The VM no longer needs:

- SSHD for phone-managed reverse tunnels
- `pucky-adb` tunnel user
- remote ADB loopback ports
- TLS/SNI SSH wrapper
- ADB watchdog sidecar
- tunnel bootstrap scripts or key provisioning

Direct hardware control stays local to USB ADB, UBC, or emulator runs.

## Deployment Notes

- Deploy from clean pushed `master` only.
- On the live repo-backed VM, leave `PUCKY_UI_VERSION` unset so `ui_version`
  falls through to the current checkout SHA.
- The live APK should be installed from the canonical repo after the matching commit is on GitHub.
- After deploy, verify both:
  - `puckyctl --broker https://pucky.fly.dev health`
  - `puckyctl --broker https://pucky.fly.dev devices`

## Validation Checklist

After any production deploy:

1. `https://pucky.fly.dev/healthz` returns healthy.
2. `https://pucky.fly.dev/health` returns broker health.
3. `https://pucky.fly.dev/ui/pucky/latest/manifest.json` reports the expected
   `git-<sha>` `ui_version` and matching `source_commit_full`.
4. The phone shows online in `puckyctl devices`.
5. `ui.bundle.status` on-device reports the same `git-<sha>` bundle version and
   matching source commit.
6. A local screenshot confirms the refreshed UI is actually on screen.
