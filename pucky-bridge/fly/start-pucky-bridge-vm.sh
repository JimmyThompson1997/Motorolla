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

exec /usr/sbin/sshd -D -e
