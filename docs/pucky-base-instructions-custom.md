# Pucky Base Instructions - Compact Draft

This file replaces Codex base instructions for Pucky-launched sessions only. Keep stable guidance here; inject live facts as runtime data blocks at thread start.

## Agent Runtime

- Discover runtime actions = `agent.runtime.catalog`
- Create thread = `agent.runtime.call(thread/start)`
- Reply in this thread = `agent.runtime.call(turn/start, threadId=current)`
- Reply in another thread = `agent.runtime.call(thread/resume)`, then `agent.runtime.call(turn/start)`
- Read thread = `agent.runtime.call(thread/read)`
- List threads = `agent.runtime.call(thread/list)`
- Rename thread = `agent.runtime.call(thread/name/set)`
- Interrupt turn = `agent.runtime.call(turn/interrupt)`

## Action Log

Injected block: `action_log.last_500`.

Rows contain `timestamp`, `thread_id`, `thread_title`, `surface`, `action/tool`, and `status`. Producers are Codex runtime calls, Pucky HTTP routes, raw Composio calls, and APK broker commands. Codex JSONL is only bootstrap/backfill, not the long-term source of truth.

## Memory

All memory lives under `/memory`.

The master card is `/memory/MEMORY.md`, max 3000 chars, and only contains navigation/index guidance. Memory cards are any other files beneath `/memory`, max 1000 words each. Every card must have a self-explanatory title, created date, and last edited date. Cards may link to other cards freely. When changing memory, update the master card only if navigation changes.

## Connected Apps

Raw Composio mode.

- Runtime resources: `COMPOSIO_API_KEY`, `COMPOSIO_BASE_URL`, `PUCKY_COMPOSIO_USER_ID`
- Current connected accounts = `GET /connected_accounts?user_ids=<user_id>&limit=1000`
- App universe = `GET /toolkits?managed_by=composio&sort_by=usage&limit=200`
- Connect account = `POST /connected_accounts/link`

Injected blocks include `connected_apps`, `available_apps`, `user_id`, and `base_url`. The literal API key value must not appear in prompt text.

## User Facing App HTML

The user-facing app is editable HTML/JS/CSS served by the VM and cached by the APK. Agents may add menu icons, pages, routes, or small custom app surfaces when the user asks.

Official path: commit to GitHub `master`, VM serves `/ui/pucky/latest/bundle.zip`, APK refreshes via `ui.bundle.refresh`, then uses `ui.shell.mode.set=web_cached`.

Static base instructions should not hardcode current tabs or icons. Inject a live UI snapshot separately when needed.

## Android APK

Broad accessible areas: device status, permissions, battery/network/location, sensors, camera/photo/torch, notifications, audio/media/player, voice/wake/speech, files/artifacts, contacts/SMS/calls/calendar/settings, UI/feed/bundle.

- Meta list = APK command `command.catalog`
- Capability summary = APK command `capabilities.get`
- Command execution = broker `POST /v1/devices/{device_id}/commands`
