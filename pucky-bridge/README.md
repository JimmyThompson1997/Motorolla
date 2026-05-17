# Pucky Bootstrap Bridge

This is the minimal bridge layer between the Fly VM and the Android Termux endpoint.

## Design

- `termux/pucky-status`: silent status collector that emits JSON.
- `termux/pucky-command`: Termux-side allowlist command dispatcher with command IDs and JSONL logging.
- `termux/pucky-tunnel`: phone-side reverse SSH tunnel supervisor.
- `termux/pucky-tls-proxy`: small Python TLS proxy for SSH `ProxyCommand` when Fly shared IPv4 needs TLS/SNI routing.
- `fly/pucky-broker`: VM-side local HTTP broker that owns command execution, history, tunnel checks, and registry updates.
- `fly/puckyctl`: VM-side CLI that talks to `pucky-broker` instead of invoking phone SSH directly.
- `fly/start-pucky-bridge-vm.sh`: Fly machine startup script for the prototype VM.

The bridge deliberately avoids raw public ADB and avoids public phone SSH exposure. The phone initiates an outbound SSH session to Fly, and Fly can only reach Termux through a loopback-only reverse port.

When the phone lacks IPv6 and Fly only has shared IPv4, the tunnel can run over Fly's TLS/SNI routing:

```sh
FLY_HOST=pucky-bridge-dev-jt323.fly.dev
FLY_PORT=443
FLY_PROXY_COMMAND="$HOME/bin/pucky-tls-proxy %h %p %h"
```

This keeps the single-machine prototype reachable over shared IPv4 without buying a dedicated IPv4 address.

## Quiet-Safe Commands

These commands do not intentionally trigger sound, vibration, notifications, torch, camera, mic, or video:

- `status`
- `battery`
- `sensors-list`
- `network`
- `storage`
- `ping`

VM-local commands:

- `health`
- `devices`
- `tunnel-check`
- `history`
- `show <command-id>`
- `registry`

Camera, torch, notification, vibration, microphone, and speaker actions remain out of this initial allowlist.

## Prototype Constraints

- Termux startup is manual until Termux:Boot or the native APK replaces it.
- The Fly VM should be stopped after test sessions.
- SSH keys are acceptable for prototype testing, but should be rotated before any long-lived deployment.

## State Files

On Termux:

- `~/.local/state/pucky/commands.jsonl`

On Fly:

- `~/.local/state/pucky/command-history.jsonl`
- `~/.config/pucky/device-registry.json`

## Broker API

The broker listens on `127.0.0.1:18080` inside Fly.

- `GET /health`
- `GET /tunnel-check`
- `GET /devices`
- `GET /registry`
- `GET /history?limit=N`
- `GET /commands/<id>`
- `POST /commands`
