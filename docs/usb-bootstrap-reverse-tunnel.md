# USB Bootstrap Reverse Tunnel

This is the development path for getting the Motorola Razr into the VM agent without keeping USB attached.

## What This Does

The laptop uses USB ADB once to start a phone-to-VM reverse tunnel:

```text
VM adb
  -> 127.0.0.1:15555 on the VM
  -> SSH reverse tunnel initiated by the phone
  -> 127.0.0.1:5555 on the phone
  -> Android adbd
```

The phone initiates the outbound SSH connection. This works on coffee-shop Wi-Fi, guest Wi-Fi, CGNAT, and mobile data because the VM does not need to dial into the phone.

## Requirements

- Phone attached by USB for initial bootstrap.
- USB debugging authorized.
- Phone has internet access.
- VM has an SSH server reachable from the phone.
- VM SSH user dedicated to this tunnel, for example `pucky-adb`.
- Private key accepted by the VM for the tunnel user.

The current APK direction uses a pure-Java SSH client inside Pucky, so the preferred flow is to install/update the APK and inject tunnel configuration. The Razr checked in this workspace is `arm64-v8a` and does not ship with a stock `ssh` client, so the older fallback script can still push a temporary native client to:

```text
/data/local/tmp/pucky-tunnel/pucky-ssh
```

## Laptop Bootstrap

From this workspace:

```powershell
.\tools\bootstrap-android-adb-reverse-tunnel.ps1 `
  -VmHost YOUR_VM_HOST `
  -VmUser pucky-adb `
  -AndroidSshClientPath C:\path\to\android-arm64-ssh-client `
  -PrivateKeyPath C:\path\to\pucky_vm_key `
  -NoStrictHostKeyChecking `
  -StopExisting
```

The script:

1. Checks USB ADB.
2. Pushes the tunnel client and SSH private key.
3. Runs `adb tcpip 5555`.
4. Starts a reverse SSH tunnel from the phone to the VM.
5. Prints the VM-side `adb connect` command.

## VM Connect

On the VM:

```bash
adb connect 127.0.0.1:15555
adb devices -l
```

From that point, the VM agent can use ADB as if the phone were local to the VM.

## Security Notes

- The reverse ADB port should bind to `127.0.0.1` on the VM, not a public interface.
- Use a dedicated low-privilege VM user.
- Use key auth only.
- Do not reuse personal SSH keys.
- Rotate the bootstrap key before any long-lived deployment.
- Treat `adb tcpip 5555` as development mode. It is powerful and should be clearly visible/controllable in the later APK service.

## Nontechnical Install Later

For users without USB, the APK can still pair to a VM through a VM-specific download link:

```text
https://<vm>/download/pucky.apk?pair=<short-lived-token>
```

That can establish app-level command/tunnel features automatically, but stock Android still requires USB ADB or manual Wireless Debugging pairing before the VM gets full ADB power.

## APK-Managed Tunnel Commands

After the APK is installed and connected to the broker/local command path, configure the tunnel with:

```json
{
  "type": "tunnel.config.set",
  "args": {
    "enabled": true,
    "host": "YOUR_VM_HOST",
    "user": "pucky-adb",
    "port": 22,
    "remote_bind_address": "127.0.0.1",
    "remote_adb_port": 15555,
    "phone_adb_host": "127.0.0.1",
    "phone_adb_port": 5555,
    "tls_enabled": true,
    "tls_server_name": "YOUR_VM_HOST",
    "strict_host_key_checking": true,
    "known_hosts": "YOUR_VM_HOST ssh-ed25519 ...",
    "private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----\n",
    "start": true
  }
}
```

Then the VM side command remains:

```bash
adb connect 127.0.0.1:15555
```

For the current Fly/shared-IPv4 path, use the TLS/SNI SSH listener instead of raw SSH:

```powershell
.\tools\install-and-provision-apk-tunnel.ps1 `
  -VmHost pucky-bridge-dev-jt323.fly.dev `
  -VmPort 2222 `
  -UseTlsSni `
  -TlsServerName pucky-bridge-dev-jt323.fly.dev `
  -PrivateKeyPath .\.secrets\pucky-adb\pucky_adb_ed25519 `
  -KnownHostsPath .\.secrets\pucky-adb\known_hosts
```
