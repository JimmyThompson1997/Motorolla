# Vox Remote ADB Runbook

This is the current development path for controlling the Motorola Razr 2024 from the Vox VM without keeping USB attached.

The v0 route is classic ADB TCP owned by the main Pucky APK:

```text
Fly VM adb 127.0.0.1:15555
  -> Pucky outbound SSH/TLS reverse tunnel
  -> phone 127.0.0.1:5555
```

There is no Keeper app, Wireless Debugging pairing flow, device owner mode, or root path in this version.

## Steady State

- Phone package: `com.pucky.device.debug`
- Vox app: `jt-project-vox-codex`
- Phone opens an outbound SSH/TLS tunnel to `jt-project-vox-codex.fly.dev:2222`
- VM receives a loopback-only ADB listener at `127.0.0.1:15555`
- Phone-side ADB target is classic TCP at `127.0.0.1:5555`
- VM should use `/data/android-sdk/platform-tools/adb`; the deploy script symlinks this to `/usr/local/bin/adb`.

VM command:

```bash
adb connect 127.0.0.1:15555
adb devices -l
adb -s 127.0.0.1:15555 shell getprop ro.product.model
```

Expected device:

```text
127.0.0.1:15555 device product:aito_g_sysu model:motorola_razr_2024 device:aito
```

## Local USB Bootstrap

Use this after a fresh install, after some phone reboots, or whenever the VM can no longer attach to `127.0.0.1:15555`.

```powershell
C:\Users\jimmy\Desktop\Motorolla\tools\install-and-provision-apk-tunnel.ps1 `
  -AdbPath C:\Users\jimmy\Desktop\Android\tools\platform-tools\adb.exe `
  -UseTlsSni `
  -TlsServerName jt-project-vox-codex.fly.dev `
  -PrivateKeyPath C:\Users\jimmy\Desktop\Motorolla\.secrets\pucky-adb\pucky_adb_ecdsa `
  -KnownHostsPath C:\Users\jimmy\Desktop\Motorolla\.secrets\pucky-adb\project_vox_known_hosts `
  -BrokerUrl wss://jt-project-vox-codex.fly.dev/v1/devices/pucky-4c45e18d69d42890/connect `
  -DeviceId pucky-4c45e18d69d42890 `
  -Token dev-token
```

The script installs the main Pucky APK, runs `adb tcpip 5555`, provisions the tunnel config, and starts the Pucky foreground service.

## VM Verification

Run from the laptop through Fly:

```powershell
flyctl ssh console -a jt-project-vox-codex -C "sh -lc 'adb disconnect 127.0.0.1:15555 || true; adb connect 127.0.0.1:15555; adb devices -l; adb -s 127.0.0.1:15555 shell getprop ro.product.model'"
```

Remote control smoke tests:

```bash
adb -s 127.0.0.1:15555 shell wm size
adb -s 127.0.0.1:15555 shell input tap 500 500
adb -s 127.0.0.1:15555 shell input swipe 500 1600 500 400
adb -s 127.0.0.1:15555 exec-out screencap -p > /tmp/pucky-screen.png
```

Optional broker-side status:

```powershell
puckyctl --broker https://jt-project-vox-codex.fly.dev --device pucky-4c45e18d69d42890 command adb.remote.status --wait
puckyctl --broker https://jt-project-vox-codex.fly.dev --device pucky-4c45e18d69d42890 command adb.remote.reconnect --wait
puckyctl --broker https://jt-project-vox-codex.fly.dev --device pucky-4c45e18d69d42890 command tunnel.status --wait
```

`adb.remote.status` intentionally does not open a raw socket to the phone's local ADB port. Raw socket probes create stale `offline` ADB transports inside `adbd`; the real proof is always the VM-side `adb connect`.

## Restart Proof

- Stop or force-stop Pucky: VM ADB should drop, because Pucky owns the tunnel.
- Relaunch Pucky: VM ADB should return after `adb connect 127.0.0.1:15555`.
- Reinstall Pucky: the tunnel may drop during install, then return once the service restarts.
- Reboot the phone: Pucky should start again, but Android may reset `adb tcpip 5555`. If VM ADB does not return, run the USB bootstrap again.

## Security Notes

- The VM ADB listener is loopback only: `127.0.0.1:15555`.
- The phone initiates the outbound tunnel; no public ADB port is exposed.
- Vox SSH accepts the dedicated `pucky-adb` key only.
- APK provisioning pins `project_vox_known_hosts`.
- A normal APK cannot silently enable Android debugging transports after reboot, so classic ADB TCP may still need one USB rebootstrap.
