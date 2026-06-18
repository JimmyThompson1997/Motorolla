# Pucky VM Voice Service

Dead-simple v0 service:

- `GET /healthz`
- `POST /api/turn` with raw audio bytes
- Deepgram Nova-3 STT without keyterms
- Codex app-server text turn, one new thread per request
- DeepInfra Kokoro TTS

Optional TTS environment knobs:

- `PUCKY_TTS_VOICE` defaults to `af_heart`
- `PUCKY_TTS_FORMAT` defaults to `wav`
- `PUCKY_TTS_SPEED` defaults to `1.0`

Each successful turn writes one structured JSON log line with stage timings for
STT, Codex, and TTS. The log includes character counts and byte counts, but not
secrets or the full transcript.

Run locally:

```powershell
python -m pucky_vm
```

Run on a direct Fly VM from the repo root:

```bash
./pucky_vm/bootstrap_fly_vm.sh
./pucky_vm/run_service.sh
```

Use `./pucky_vm/fly_start.sh` as the Fly Machine command after the files are
uploaded to `/data/pucky-src`; it idempotently checks runtime dependencies and
then starts the service.

Call locally:

```powershell
$headers = @{
  Authorization = "Bearer $env:PUCKY_API_TOKEN"
  "Content-Type" = "audio/wav"
}
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/api/turn -Headers $headers -InFile .\sample.wav
```

Or use the smoke client:

```powershell
python -m pucky_vm.smoke_turn .\sample.wav --out .\reply.wav
```

The response intentionally omits the transcript:

```json
{
  "session_id": "pucky_...",
  "text": "Sure, I can help with that.",
  "audio_mime_type": "audio/wav",
  "audio_base64": "...",
  "card": {
    "title": "Short title",
    "icon": "clock"
  }
}
```

## Hosted User Surface and Optional Cache

The VM hosts the canonical user surface at `/ui/pucky/latest/`. For startup
resilience, the APK may also keep an app-owned copy of the latest UI bundle
in local storage.

Build a local bundle for low-level debugging only:

```powershell
python -m pucky_vm.ui_bundle --out .tmp\pucky_ui_bundle --version local-dev
```

If `--version` and `PUCKY_UI_VERSION` are omitted, the bundle version defaults
to `git-<short-sha>` when the source tree has git metadata, or to the contents
of `pucky_vm/.pucky_ui_version` for archive-based VM deploys.

For the live repo-backed Fly VM, leave `PUCKY_UI_VERSION` unset so
`ui_version` tracks the current checkout SHA. Reserve the override for
archive-based or deliberately pinned bundle deploys.

Serve the latest source/bundle from the VM service:

- `GET /ui/pucky/latest/`
- `GET /ui/pucky/latest/manifest.json`
- `GET /ui/pucky/latest/bundle.zip`
- `GET /ui/pucky/fixtures/reply_cards.json`

Official HTML refresh flow is:

`GitHub master -> VM sync helper -> manifest verification -> emulator refresh/verify -> phone refresh/verify`

Sync the VM source checkout and verify the served manifest first:

```powershell
python .\tools\sync_pucky_vm_official.py --app pucky
```

Use the official helper from the canonical deploy repo for bundle refreshes:

```powershell
python .\tools\refresh_pucky_html_official.py --target emulator --device-id <emulator-device-id>
python .\tools\refresh_pucky_html_official.py --target phone --device-id <phone-device-id> --emulator-evidence .tmp\pucky-html-refresh\<evidence>.json
```

Deploy cover fixture cards through the same official gate:

```powershell
python -m pucky_vm.tools.deploy_cover_fixture --target emulator --device-id <emulator-device-id>
python -m pucky_vm.tools.deploy_cover_fixture --target phone --device-id <phone-device-id> --emulator-evidence .tmp\pucky-html-refresh\<evidence>.json
```

The official helpers refuse to run unless the source is clean pushed `master`,
the VM manifest matches that exact commit, and phone refreshes have matching
emulator evidence for the same `ui_version`. Local bundle builds and local
cache pushes are not official deploy state. Do not seed fixture state with
direct `adb push`, `run-as`, or SharedPreferences edits.

The device refresh helper also force-stops and relaunches the app, then
verifies `ui.surface.get` before screenshots or route-specific checks should be
trusted. Installed bundle identity alone is not enough proof if the WebView is
still holding an older in-memory page.
