#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl ffmpeg git nodejs npm python3
npm install -g @openai/codex
mkdir -p /data/home/codex /data/pucky-src

if ! python3 - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 12) else 1)
PY
then
  echo "Pucky VM requires Python 3.12+ after bootstrap. Found: $(python3 --version 2>&1)"
  exit 1
fi
