# VM Installation Package Requirements

This is the VM-side checklist for the Pucky device network. It includes the old Termux bridge requirements and the new APK-managed reverse SSH / remote ADB path.

The goal of this note is dependency inventory, not naming. When a dependency is named here, it is so the VM install package can be rebuilt, audited, and secured without relying on memory.

## Package Groups

The install package has three separate layers:

- VM runtime: packages, users, SSHD policy, broker, persistence, and ADB client identity on the VM.
- APK tunnel client: the Android app code that opens the outbound tunnel and forwards phone-local ADB to the VM.
- Development/bootstrap tooling: laptop or CI tools used to build the APK, provision secrets, and perform the first USB bootstrap.

## Base VM Runtime

Required packages:

- `openssh-server`: accepts phone-originated reverse SSH tunnels.
- `android-tools-adb`: lets the VM run `adb connect 127.0.0.1:<port>` after the phone exposes ADB through the tunnel.
- `python3`: runs the existing local broker prototype.
- `ca-certificates`: basic TLS trust.
- `iproute2`, `procps`, `jq`: diagnostics and status tooling.

Existing local binaries/scripts:

- `/usr/local/bin/pucky-broker`: VM-local broker from `pucky-bridge/fly/pucky-broker` or the newer `pucky-apk/fly-broker/pucky_fly_broker.py` path.
- `/usr/local/bin/puckyctl`: VM-local CLI for broker commands and health checks.
- optional persistent data volume at `/data/pucky` for broker SQLite/state when using the newer Fly broker.

Optional but useful VM diagnostics:

- `netstat` or `ss`: verify loopback listeners such as `127.0.0.1:15555`.
- `ps`/`pgrep`: verify `sshd`, broker, and `adb` server processes.
- `curl`/`wget`: health checks against local broker endpoints when present.

## SSH Users

Use separate users for separate tunnel powers.

### `pucky`

Old bridge user for the Termux prototype.

- Accepts the old phone/Termux SSH key.
- Allows remote forwarding only.
- Expected remote listen: `127.0.0.1:18022`.
- Target on phone/Termux side: `127.0.0.1:8022`.
- Used by old `pucky-bridge/termux/pucky-tunnel`.

### `pucky-adb`

New APK-managed remote ADB tunnel user.

- Accepts only the APK/device tunnel key.
- Allows remote forwarding only.
- Expected remote listen: `127.0.0.1:15555`.
- Target on Android side: `127.0.0.1:5555`.
- Used by the APK `TunnelController`.

The `pucky-adb` user should not reuse a personal SSH key. It should receive a dedicated key generated for this VM/device pairing and rotated whenever a pairing is reset.

## SSHD Policy

The VM should keep reverse tunnel ports loopback-only:

```text
HostKey /data/pucky/ssh/ssh_host_ed25519_key
HostKey /data/pucky/ssh/ssh_host_rsa_key
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
GatewayPorts no
AllowTcpForwarding no
AllowAgentForwarding no
X11Forwarding no

Match User pucky
  AllowTcpForwarding remote
  PermitListen 127.0.0.1:18022
  PermitTTY no
  ForceCommand /bin/false

Match User pucky-adb
  AllowTcpForwarding remote
  PermitListen 127.0.0.1:15555
  PermitTTY no
  ForceCommand /bin/false
```

`GatewayPorts no` is the important safety rail: even when the phone asks for a reverse tunnel, the VM-side listening port stays on VM loopback instead of the public internet.

## VM Secrets / Install Inputs

Old prototype inputs:

- `FLY_AUTHORIZED_KEYS_B64`: authorized keys for the old `pucky` SSH bridge user.
- `TERMUX_CLIENT_KEY_B64`: private key the VM-side broker used to dial back through the old Termux tunnel.
- `PUCKYCTL_B64`: encoded VM CLI.
- `PUCKY_BROKER_B64`: encoded old VM broker.

New APK/ADB tunnel inputs:

- `PUCKY_ADB_AUTHORIZED_KEYS_B64`: public key authorized for the new `pucky-adb` tunnel user.
- optional `PUCKY_ADB_CLIENT_KEY_B64` and `PUCKY_ADB_CLIENT_PUB_B64`: VM-side ADB client identity. In development this can be the laptop's already-authorized ADB key; in production prefer a VM/session key with one visible user approval.
- VM host name reachable from the Android device.
- VM SSH host key / `known_hosts` line delivered to the APK provisioning flow.
- Device-side private key delivered through one-time provisioning, not checked into git.
- VM-side ADB client key restored to `/root/.android/adbkey` at boot, or a user-mediated ADB authorization prompt.
- Remote ADB bind port, default `15555`.
- Phone ADB target, default `127.0.0.1:5555`.

New app/broker pairing inputs:

- short-lived one-time pairing token
- broker URL
- device id
- optional post-install app link or USB-injected provisioning payload

APK tunnel client dependency:

- `com.github.mwiede:jsch:2.28.2`: Java SSH client used by the APK to open the outbound reverse SSH session.
- APK-side TLS/SNI adapter: required for Fly shared IPv4 because Fly exposes the VM SSH service through TLS/SNI on external port `2222`.
- APK app-private secret storage: stores `files/tunnel/id_pucky_tunnel` and `files/tunnel/known_hosts`; these are provisioned per VM/device pairing and should not be checked into git.

Development/bootstrap tooling:

- JDK 17.
- Android SDK / platform tools, especially `adb`.
- Gradle 8.10.x or a checked-in Gradle wrapper.
- Debug-only `run-as` provisioning path for development builds.
- Production provisioning path still needed: app link, one-time token, bundled session package, or another non-debug channel for tunnel key/config delivery.

## Bootstrap Flow

Development flow:

1. Build/install the APK.
2. Enable phone ADB TCP once with USB: `adb tcpip 5555`.
3. Inject provisioning with `tools/install-and-provision-apk-tunnel.ps1`.
4. APK opens SSH to the VM as `pucky-adb`.
5. VM runs `adb connect 127.0.0.1:15555`.

Nontechnical future flow:

1. User opens a VM-specific install page.
2. VM generates a one-time pairing token and a device tunnel key.
3. User installs the APK/session package.
4. User taps `Open Pucky and Pair`.
5. APK receives broker/tunnel config and opens the tunnel.
6. Full ADB still needs USB bootstrap or Android Wireless Debugging once on stock Android.

## Current Script Coverage

- `pucky-bridge/fly/start-pucky-bridge-vm.sh` now installs the base VM packages, creates `pucky` and `pucky-adb`, and writes SSHD policy for both the old Termux tunnel and new APK ADB tunnel.
- `pucky-apk/fly-broker/deploy-pucky-broker.ps1` now has an `-EnableSshTunnel` mode for the current Alpine Fly machine. It installs OpenSSH/ADB tools at boot, persists SSH host keys under `/data/pucky/ssh`, creates `pucky` and `pucky-adb`, restores the VM ADB client key from `/data/pucky/adb` when present, exposes raw TCP SSH on the configured external port, and exposes TLS/SNI-wrapped SSH on port `2222` by default.
- `tools/new-pucky-adb-tunnel-key.ps1` generates the dedicated `pucky-adb` SSH keypair and prints the `PUCKY_ADB_AUTHORIZED_KEYS_B64` value for the VM.
- `tools/install-and-provision-apk-tunnel.ps1` handles the laptop-to-phone side: install APK, enable ADB TCP, inject tunnel provisioning, and print the VM `adb connect` command.

## Live Dev Validation

Current development proof on May 16, 2026:

- Phone package: `com.pucky.device.debug`.
- Phone serial: `ZY22JZ26LK`.
- VM app: `pucky-bridge-dev-jt323`.
- APK opens a TLS/SNI SSH session to `pucky-bridge-dev-jt323.fly.dev:2222` as `pucky-adb`.
- VM loopback listener appears at `127.0.0.1:15555`.
- VM command `adb connect 127.0.0.1:15555` returns an authorized `motorola_razr_2024` device.
- The VM is currently using the laptop's already-authorized ADB key as a development shortcut. Production should use a VM/session ADB key with explicit user approval or a deliberately user-mediated equivalent.

## Still Needed For A Real VM Test

- Pick the actual VM hostname.
- Generate a dedicated `pucky-adb` SSH keypair with `tools/new-pucky-adb-tunnel-key.ps1`.
- Add the public key to `PUCKY_ADB_AUTHORIZED_KEYS_B64` on the VM.
- Capture the VM SSH host key into a `known_hosts` file.
- Run the laptop provisioning script against the attached Razr.
- On the VM, run `adb connect 127.0.0.1:15555` and verify `adb devices -l`.

## Fly-Specific Notes

The current reusable Fly machine is:

```text
app: pucky-bridge-dev-jt323
machine: d8d2264ae93558
image: library/python:3.12-alpine
volume: vol_vp2z7g6q6qwoqjj4 mounted at /data
```

The app currently has a dedicated public IPv6 address and shared public IPv4. The Razr/laptop Starbucks network currently lacks usable global IPv6, and Fly shared IPv4 closes raw SSH before an SSH banner. The free path is therefore TLS/SNI-wrapped SSH:

```text
APK JSch
  -> TLS with SNI pucky-bridge-dev-jt323.fly.dev on port 2222
  -> Fly TLS service
  -> VM sshd internal port 22
  -> reverse SSH bind 127.0.0.1:15555
```

The APK has a `TlsSniProxy` adapter for this. A dedicated IPv4 would make raw SSH simpler, but it is not required for the current free route.
