param(
    [string]$App = "pucky-bridge-dev-jt323",
    [string]$MachineId = "d8d2264ae93558",
    [string]$Region = "lax",
    [string]$BrokerPath = (Join-Path $PSScriptRoot "pucky_fly_broker.py"),
    [string]$PuckyctlPath = (Join-Path (Split-Path $PSScriptRoot -Parent) "puckyctl\puckyctl.py"),
    [string]$DeviceToken = "dev-token",
    [string]$OperatorToken = "operator-dev-token",
    [string]$DbPath = "/data/pucky/broker.sqlite3",
    [string]$VolumeId = "vol_vp2z7g6q6qwoqjj4",
    [switch]$EnableSshTunnel,
    [int]$SshPort = 22,
    [int]$SshTlsPort = 2222,
    [string]$PuckyAdbAuthorizedKeysB64 = $env:PUCKY_ADB_AUTHORIZED_KEYS_B64,
    [string]$FlyAuthorizedKeysB64 = $env:FLY_AUTHORIZED_KEYS_B64,
    [switch]$NoPuckyctl,
    [switch]$Expose,
    [switch]$Start,
    [switch]$Create,
    [switch]$Cleanup
)

$ErrorActionPreference = "Stop"

function Get-FlyToken {
    $token = (& flyctl auth token).Trim()
    if ([string]::IsNullOrWhiteSpace($token)) {
        throw "flyctl auth token returned an empty token"
    }
    return $token
}

function Invoke-FlyMachinesApi {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body = $null
    )
    $token = Get-FlyToken
    $headers = @{ Authorization = "Bearer $token" }
    $uri = "https://api.machines.dev/v1$Path"
    if ($null -eq $Body) {
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
    }
    $json = $Body | ConvertTo-Json -Depth 40
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType "application/json" -Body $json
}

function New-BrokerConfig {
    param(
        [string]$BrokerSource,
        [string]$PuckyctlSource = ""
    )
    $brokerSourceBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($BrokerSource))
    $startScriptBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((New-StartScript)))
    $files = @(
        [ordered]@{
            guest_path = "/app/pucky_fly_broker.py"
            raw_value = $brokerSourceBase64
        },
        [ordered]@{
            guest_path = "/app/start-pucky-vm.sh"
            raw_value = $startScriptBase64
        }
    )

    if (-not [string]::IsNullOrWhiteSpace($PuckyctlSource)) {
        $puckyctlSourceBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PuckyctlSource))
        $files += [ordered]@{
            guest_path = "/usr/local/bin/puckyctl"
            raw_value = $puckyctlSourceBase64
        }
    }

    $config = [ordered]@{
        image = "registry-1.docker.io/library/python:3.12-alpine"
        env = [ordered]@{
            PORT = "8080"
            PUCKY_DB_PATH = $DbPath
            PUCKY_DEVICE_TOKEN = $DeviceToken
            PUCKY_OPERATOR_TOKEN = $OperatorToken
            PUCKY_ENABLE_SSH = if ($EnableSshTunnel) { "1" } else { "0" }
        }
        guest = [ordered]@{
            cpu_kind = "shared"
            cpus = 1
            memory_mb = 256
        }
        init = [ordered]@{
            entrypoint = @("sh")
            cmd = @("-c", "chmod +x /app/start-pucky-vm.sh /usr/local/bin/puckyctl 2>/dev/null || true; exec sh /app/start-pucky-vm.sh")
        }
        restart = [ordered]@{
            policy = "no"
        }
        files = $files
    }

    if ($EnableSshTunnel) {
        $config.env.PUCKY_ADB_AUTHORIZED_KEYS_B64 = $PuckyAdbAuthorizedKeysB64
        if (-not [string]::IsNullOrWhiteSpace($FlyAuthorizedKeysB64)) {
            $config.env.FLY_AUTHORIZED_KEYS_B64 = $FlyAuthorizedKeysB64
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($VolumeId)) {
        $config.mounts = @(
            [ordered]@{
                volume = $VolumeId
                path = "/data"
            }
        )
    }

    $services = @()
    if ($Expose -and -not $Cleanup) {
        $services += [ordered]@{
                protocol = "tcp"
                internal_port = 8080
                auto_stop_machines = "off"
                auto_start_machines = $false
                min_machines_running = 0
                ports = @(
                    [ordered]@{
                        port = 443
                        handlers = @("tls", "http")
                    }
                )
            }
    }
    if ($EnableSshTunnel -and -not $Cleanup) {
        $services += [ordered]@{
            protocol = "tcp"
            internal_port = 22
            auto_stop_machines = "off"
            auto_start_machines = $false
            min_machines_running = 0
            ports = @(
                [ordered]@{
                    port = $SshPort
                    handlers = @()
                }
            )
        }
        $services += [ordered]@{
            protocol = "tcp"
            internal_port = 22
            auto_stop_machines = "off"
            auto_start_machines = $false
            min_machines_running = 0
            ports = @(
                [ordered]@{
                    port = $SshTlsPort
                    handlers = @("tls")
                }
            )
        }
    }
    if ($services.Count -gt 0) {
        $config.services = $services
    }

    return $config
}

function New-StartScript {
    @'
#!/bin/sh
set -eu

  if [ "${PUCKY_ENABLE_SSH:-0}" = "1" ]; then
  apk add --no-cache \
    android-tools \
    ca-certificates \
    iproute2 \
    jq \
    openssh-server \
    openssh-client \
    procps

  adduser -D -s /bin/sh pucky 2>/dev/null || true
  adduser -D -s /bin/sh pucky-adb 2>/dev/null || true
  passwd -d pucky >/dev/null 2>&1 || true
  passwd -d pucky-adb >/dev/null 2>&1 || true

  install -d -m 700 -o pucky -g pucky /home/pucky/.ssh
  if [ -n "${FLY_AUTHORIZED_KEYS_B64:-}" ]; then
    printf '%s' "$FLY_AUTHORIZED_KEYS_B64" | base64 -d >/home/pucky/.ssh/authorized_keys
  else
    : >/home/pucky/.ssh/authorized_keys
  fi
  chown -R pucky:pucky /home/pucky/.ssh
  chmod 600 /home/pucky/.ssh/authorized_keys

  install -d -m 700 -o pucky-adb -g pucky-adb /home/pucky-adb/.ssh
  printf '%s' "$PUCKY_ADB_AUTHORIZED_KEYS_B64" | base64 -d >/home/pucky-adb/.ssh/authorized_keys
  chown -R pucky-adb:pucky-adb /home/pucky-adb/.ssh
  chmod 600 /home/pucky-adb/.ssh/authorized_keys

  install -d -m 700 /data/pucky/ssh
  if [ ! -f /data/pucky/ssh/ssh_host_ed25519_key ]; then
    ssh-keygen -q -t ed25519 -N '' -f /data/pucky/ssh/ssh_host_ed25519_key
  fi
  if [ ! -f /data/pucky/ssh/ssh_host_rsa_key ]; then
    ssh-keygen -q -t rsa -b 3072 -N '' -f /data/pucky/ssh/ssh_host_rsa_key
  fi

  mkdir -p /run/sshd
  cat >/etc/ssh/sshd_config <<'EOF'
Port 22
ListenAddress 0.0.0.0
ListenAddress ::
HostKey /data/pucky/ssh/ssh_host_ed25519_key
HostKey /data/pucky/ssh/ssh_host_rsa_key
PermitRootLogin no
PasswordAuthentication no
PermitEmptyPasswords no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
AllowUsers pucky pucky-adb
AllowTcpForwarding no
GatewayPorts no
X11Forwarding no
PermitTunnel no
AllowAgentForwarding no
ClientAliveInterval 60
ClientAliveCountMax 3
LogLevel VERBOSE

Match User pucky
  AllowTcpForwarding remote
  PermitListen 127.0.0.1:18022
  PermitTTY no
  ForceCommand /bin/false
  X11Forwarding no
  AllowAgentForwarding no

Match User pucky-adb
  AllowTcpForwarding remote
  PermitListen 127.0.0.1:15555
  PermitTTY no
  ForceCommand /bin/false
  X11Forwarding no
  AllowAgentForwarding no
EOF

  /usr/sbin/sshd -e
fi

if [ -n "${PUCKY_ADB_CLIENT_KEY_B64:-}" ]; then
  install -d -m 700 /data/pucky/adb
  printf '%s' "$PUCKY_ADB_CLIENT_KEY_B64" | base64 -d >/data/pucky/adb/adbkey
  if [ -n "${PUCKY_ADB_CLIENT_PUB_B64:-}" ]; then
    printf '%s' "$PUCKY_ADB_CLIENT_PUB_B64" | base64 -d >/data/pucky/adb/adbkey.pub
  fi
fi
if [ -f /data/pucky/adb/adbkey ]; then
  install -d -m 700 /root/.android
  cp /data/pucky/adb/adbkey /root/.android/adbkey
  if [ -f /data/pucky/adb/adbkey.pub ]; then
    cp /data/pucky/adb/adbkey.pub /root/.android/adbkey.pub
  fi
  chmod 600 /root/.android/adbkey /data/pucky/adb/adbkey
fi

chmod +x /usr/local/bin/puckyctl 2>/dev/null || true
exec python3 /app/pucky_fly_broker.py
'@
}

if (-not (Test-Path -LiteralPath $BrokerPath)) {
    throw "Broker source not found: $BrokerPath"
}
if ($EnableSshTunnel -and [string]::IsNullOrWhiteSpace($PuckyAdbAuthorizedKeysB64)) {
    throw "EnableSshTunnel requires PuckyAdbAuthorizedKeysB64 or env:PUCKY_ADB_AUTHORIZED_KEYS_B64"
}

$brokerSource = Get-Content -Raw -LiteralPath $BrokerPath
$puckyctlSource = ""
if (-not $NoPuckyctl) {
    if (-not (Test-Path -LiteralPath $PuckyctlPath)) {
        throw "puckyctl source not found: $PuckyctlPath"
    }
    $puckyctlSource = Get-Content -Raw -LiteralPath $PuckyctlPath
}
$config = New-BrokerConfig -BrokerSource $brokerSource -PuckyctlSource $puckyctlSource
$payload = [ordered]@{
    region = $Region
    config = $config
    skip_launch = -not [bool]$Start
}

if ($Create) {
    Write-Host "Creating Fly machine in app $App"
    $machine = Invoke-FlyMachinesApi -Method "POST" -Path "/apps/$App/machines" -Body $payload
    $MachineId = $machine.id
} else {
    if ([string]::IsNullOrWhiteSpace($MachineId)) {
        throw "MachineId is required unless -Create is used"
    }
    $payload.skip_launch = $true
    Write-Host "Updating Fly machine $MachineId in app $App"
    $machine = Invoke-FlyMachinesApi -Method "POST" -Path "/apps/$App/machines/$MachineId" -Body $payload
}

if ($Cleanup) {
    Write-Host "Stopping Fly machine $MachineId"
    & flyctl machine stop $MachineId -a $App | Out-Host
} elseif ($Start -and -not $Create) {
    Write-Host "Starting Fly machine $MachineId"
    & flyctl machine start $MachineId -a $App | Out-Host
}

[ordered]@{
    app = $App
    machine_id = $MachineId
    region = $Region
    exposed = [bool]($Expose -and -not $Cleanup)
    started = [bool]($Start -and -not $Cleanup)
    cleanup = [bool]$Cleanup
    volume_id = $VolumeId
    db_path = $DbPath
    puckyctl = [bool](-not $NoPuckyctl)
    machine_state = $machine.state
} | ConvertTo-Json -Depth 10
