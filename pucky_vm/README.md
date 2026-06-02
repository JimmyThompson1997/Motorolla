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

Optional Codex app-server routing knobs:

- `CODEX_APP_SERVER_COMMAND` fully overrides the command used to launch `codex app-server`
- `PUCKY_CODEX_PROFILE` appends `--profile`
- `PUCKY_CODEX_MODEL` appends `--model`
- `PUCKY_CODEX_PROVIDER` sets `model_provider` via `-c`
- `PUCKY_CODEX_PROVIDER_BASE_URL` overrides `model_providers.<provider>.base_url`
- `PUCKY_CODEX_PROVIDER_API_KEY` overrides `model_providers.<provider>.api_key`
- `PUCKY_CODEX_PROVIDER_SETTINGS` injects additional provider config as JSON
- `PUCKY_CODEX_APP_SERVER_ARGS` appends raw extra arguments

Example for DeepInfra's OpenAI-compatible lane:

```powershell
$env:PUCKY_CODEX_MODEL = "deepseek-ai/DeepSeek-V4-Pro"
$env:PUCKY_CODEX_PROVIDER = "openai"
$env:PUCKY_CODEX_PROVIDER_BASE_URL = "https://api.deepinfra.com/v1/openai"
$env:PUCKY_CODEX_PROVIDER_API_KEY = $env:DEEPINFRA_API_KEY
```

Local model battery:

```powershell
python -m tools.run_codex_model_battery
```

The battery is local-only. It drives the existing `CodexAppServerClient`
through env vars, writes machine-readable results under `.tmp\`, and does not
touch the VM, emulator, or phone lanes.

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

## Cached HTML UI bundle

The VM can also ship the cover UI as a versioned HTML bundle. The APK installs
only verified bundles into app-owned storage and loads the WebView from that
cached copy, so the feed can still open offline.

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

`GitHub master -> VM pull/build/serve -> emulator refresh/verify -> phone refresh/verify`

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
