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

## Cached HTML UI bundle

The VM can also ship the cover UI as a versioned HTML bundle. The APK installs
only verified bundles into app-owned storage and loads the WebView from that
cached copy, so the feed can still open offline.

Build a local bundle:

```powershell
python -m pucky_vm.ui_bundle --out .tmp\pucky_ui_bundle --version local-dev
```

If `--version` and `PUCKY_UI_VERSION` are omitted, the bundle version defaults
to `git-<short-sha>` when the source tree has git metadata.

Serve the latest source/bundle from the VM service:

- `GET /ui/pucky/latest/`
- `GET /ui/pucky/latest/manifest.json`
- `GET /ui/pucky/latest/bundle.zip`
- `GET /ui/pucky/fixtures/reply_cards.json`

Deploy cover fixture cards through the normal command path:

```powershell
python -m pucky_vm.tools.deploy_cover_fixture
```

The deploy helper refuses to run from a dirty git workspace. It refreshes the
cached HTML bundle, downloads committed fixture artifacts through
`file.download`, writes cards with returned app-owned paths through
`ui.reply_cards.set`, and records evidence under `.tmp/`. Do not seed fixture
state with direct `adb push`, `run-as`, or SharedPreferences edits.
