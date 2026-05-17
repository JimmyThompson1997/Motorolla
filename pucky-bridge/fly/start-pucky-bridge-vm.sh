#!/bin/sh
set -eu

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  android-tools-adb \
  ca-certificates \
  iproute2 \
  jq \
  openssh-server \
  procps \
  python3
rm -rf /var/lib/apt/lists/*

if ! id -u pucky >/dev/null 2>&1; then
  useradd -m -s /bin/sh pucky
fi

passwd -d pucky >/dev/null

if ! id -u pucky-adb >/dev/null 2>&1; then
  useradd -m -s /bin/sh pucky-adb
fi

passwd -d pucky-adb >/dev/null

install -d -m 700 -o pucky -g pucky /home/pucky/.ssh
printf '%s' "$FLY_AUTHORIZED_KEYS_B64" | base64 -d >/home/pucky/.ssh/authorized_keys
printf '%s' "$TERMUX_CLIENT_KEY_B64" | base64 -d >/home/pucky/.ssh/termux_client_ed25519
chown -R pucky:pucky /home/pucky/.ssh
chmod 600 /home/pucky/.ssh/authorized_keys /home/pucky/.ssh/termux_client_ed25519

install -d -m 700 -o pucky-adb -g pucky-adb /home/pucky-adb/.ssh
if [ -n "${PUCKY_ADB_AUTHORIZED_KEYS_B64:-}" ]; then
  printf '%s' "$PUCKY_ADB_AUTHORIZED_KEYS_B64" | base64 -d >/home/pucky-adb/.ssh/authorized_keys
else
  : >/home/pucky-adb/.ssh/authorized_keys
fi
chown -R pucky-adb:pucky-adb /home/pucky-adb/.ssh
chmod 600 /home/pucky-adb/.ssh/authorized_keys

printf '%s' "$PUCKYCTL_B64" | base64 -d >/usr/local/bin/puckyctl
chmod 755 /usr/local/bin/puckyctl
printf '%s' "$PUCKY_BROKER_B64" | base64 -d >/usr/local/bin/pucky-broker
chmod 755 /usr/local/bin/pucky-broker

mkdir -p /run/sshd
install -d -m 700 /data/pucky/ssh
if [ ! -f /data/pucky/ssh/ssh_host_ed25519_key ]; then
  ssh-keygen -q -t ed25519 -N '' -f /data/pucky/ssh/ssh_host_ed25519_key
fi
if [ ! -f /data/pucky/ssh/ssh_host_rsa_key ]; then
  ssh-keygen -q -t rsa -b 3072 -N '' -f /data/pucky/ssh/ssh_host_rsa_key
fi

cat >/etc/ssh/sshd_config <<'EOF'
Port 22
ListenAddress 0.0.0.0
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

su -s /bin/sh pucky -c 'HOME=/home/pucky PUCKY_TERMUX_KEY=/home/pucky/.ssh/termux_client_ed25519 PUCKY_BROKER_HOST=127.0.0.1 PUCKY_BROKER_PORT=18080 nohup /usr/local/bin/pucky-broker >/home/pucky/pucky-broker.log 2>&1 &'

mkdir -p /data/pucky/log
cat >/usr/local/bin/pucky-adb-watchdog <<'EOF'
#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import time

port = os.environ.get("PUCKY_REMOTE_ADB_PORT", "15555")
target = f"127.0.0.1:{port}"
status_path = os.environ.get("PUCKY_ADB_WATCHDOG_STATUS", "/data/pucky/adb-watchdog-status.json")
log_path = os.environ.get("PUCKY_ADB_WATCHDOG_LOG", "/data/pucky/log/adb-watchdog.log")
interval = float(os.environ.get("PUCKY_ADB_RECONNECT_INTERVAL_SEC", "10"))
os.makedirs(os.path.dirname(status_path), exist_ok=True)
os.makedirs(os.path.dirname(log_path), exist_ok=True)

def run(cmd, timeout=8):
    if cmd and cmd[0] == "adb" and shutil.which("adb") is None:
        return "adb: missing"
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout)
        return proc.stdout.strip()
    except Exception as exc:
        return f"{exc.__class__.__name__}: {exc}"

def adb_state(devices_output):
    for line in devices_output.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == target:
            return parts[1]
    return ""

def classify(raw_state):
    if raw_state in ("device", "offline", "unauthorized"):
        return raw_state
    return "missing"

def probe_adb():
    devices_output = run(["adb", "devices"])
    raw_state = adb_state(devices_output)
    return classify(raw_state), raw_state, devices_output

while True:
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    start_output = run(["adb", "start-server"])
    connect_output = run(["adb", "connect", target])
    state, state_value, devices_output = probe_adb()
    recovery_output = ""
    if state == "offline":
        disconnect_output = run(["adb", "disconnect", target])
        time.sleep(0.5)
        reconnect_output = run(["adb", "connect", target])
        recovery_output = f"disconnect={disconnect_output}; reconnect={reconnect_output}"
        state, state_value, devices_output = probe_adb()
    model = ""
    if state == "device":
        model = run(["adb", "-s", target, "shell", "getprop", "ro.product.model"]).splitlines()[0].strip()
    payload = {
        "schema": "pucky.adb_watchdog_status.v1",
        "timestamp": timestamp,
        "state": state,
        "target": target,
        "adb_state": state,
        "raw_adb_state": state_value,
        "start_output": start_output,
        "connect_output": connect_output,
        "recovery_output": recovery_output,
        "devices_output": devices_output,
        "model": model,
    }
    tmp_path = status_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"), sort_keys=True)
        handle.write("\n")
    os.replace(tmp_path, status_path)
    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(f"{timestamp} state={state} raw={state_value} target={target} model={model} connect={connect_output} recovery={recovery_output}\n")
    time.sleep(interval)
EOF
chmod +x /usr/local/bin/pucky-adb-watchdog
nohup /usr/local/bin/pucky-adb-watchdog >/data/pucky/log/adb-watchdog.nohup 2>&1 &

exec /usr/sbin/sshd -D -e
