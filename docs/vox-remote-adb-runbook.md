# Vox Remote ADB Runbook

This is the current secure development path for controlling the Motorola Razr 2024 from the Vox VM without keeping USB attached.

## Steady State

- Phone package: `com.pucky.device.debug`
- Device id: `pucky-4c45e18d69d42890`
- Vox app: `jt-project-vox-codex`
- Phone opens an outbound SSH/TLS tunnel to `jt-project-vox-codex.fly.dev:2222`
- VM receives a loopback-only ADB listener at `127.0.0.1:15555`
- VM command:

```bash
adb connect 127.0.0.1:15555
adb devices -l
adb -s 127.0.0.1:15555 shell getprop ro.product.model
```

Expected device:

```text
127.0.0.1:15555 device product:aito_g_sysu model:motorola_razr_2024 device:aito
```

## Local USB Rebootstrap

Use this if the tunnel disappears, the phone reboots, or `adb connect 127.0.0.1:15555` fails from Vox.

```powershell
C:\Users\jimmy\Desktop\Motorolla\tools\install-and-provision-apk-tunnel.ps1 `
  -AdbPath C:\Users\jimmy\Desktop\Android\tools\platform-tools\adb.exe `
  -VmHost jt-project-vox-codex.fly.dev `
  -VmPort 2222 `
  -UseTlsSni `
  -TlsServerName jt-project-vox-codex.fly.dev `
  -PrivateKeyPath C:\Users\jimmy\Desktop\Motorolla\.secrets\pucky-adb\pucky_adb_ecdsa `
  -KnownHostsPath C:\Users\jimmy\Desktop\Motorolla\.secrets\pucky-adb\project_vox_known_hosts `
  -BrokerUrl wss://jt-project-vox-codex.fly.dev/v1/devices/pucky-4c45e18d69d42890/connect `
  -DeviceId pucky-4c45e18d69d42890 `
  -Token dev-token
```

Then force connect/autostart:

```powershell
C:\Users\jimmy\Desktop\Android\tools\platform-tools\adb.exe shell am start `
  -n com.pucky.device.debug/com.pucky.device.MainActivity `
  --es broker_url wss://jt-project-vox-codex.fly.dev/v1/devices/pucky-4c45e18d69d42890/connect `
  --es device_id pucky-4c45e18d69d42890 `
  --es token dev-token `
  --ez connect true
```

## Vox Verification

Run from the laptop through Fly:

```powershell
flyctl ssh console -a jt-project-vox-codex --command "sh -lc 'adb connect 127.0.0.1:15555 || true; adb devices -l; adb -s 127.0.0.1:15555 shell getprop ro.product.model'"
```

Run through the Pucky broker:

```powershell
puckyctl --broker https://jt-project-vox-codex.fly.dev --device pucky-4c45e18d69d42890 command tunnel.status --wait
puckyctl --broker https://jt-project-vox-codex.fly.dev --device pucky-4c45e18d69d42890 command service.status --wait
```

## Security Notes

- The reverse ADB listener is VM-loopback only: `127.0.0.1:15555`.
- The phone initiates the outbound tunnel; no public ADB port is exposed.
- Vox SSH accepts the dedicated `pucky-adb` key only.
- APK provisioning pins `project_vox_known_hosts`.
- `adb tcpip 5555` is powerful development mode. If the phone fully reboots, expect to rebootstrap with USB or manual Wireless Debugging.

## Why It Can Disappear

Known causes:

- Phone reboot disables or interrupts ADB TCP.
- Pucky service is killed before autostart reconnects.
- Network changes drop the SSH tunnel; the APK should reconnect, but the VM may need `adb connect 127.0.0.1:15555` again.
- Reinstalling the APK restarts the service and briefly closes the tunnel.
