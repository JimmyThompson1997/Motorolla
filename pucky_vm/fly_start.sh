#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if ! command -v python3 >/dev/null 2>&1 || \
   ! command -v node >/dev/null 2>&1 || \
   ! command -v npm >/dev/null 2>&1 || \
   ! command -v ffmpeg >/dev/null 2>&1; then
  apt-get update
  apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    git \
    nodejs \
    npm \
    python3
fi

if ! command -v codex >/dev/null 2>&1; then
  npm install -g @openai/codex
fi

mkdir -p /data/home/codex

if ! python3 - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 12) else 1)
PY
then
  echo "Pucky VM requires Python 3.12+ before startup. Found: $(python3 --version 2>&1)"
  exit 1
fi

cd /data/pucky-src
# Leave PUCKY_UI_VERSION unset for repo-backed Fly runs so the manifest version
# follows the current checkout SHA instead of a stale process-level override.
exec bash ./pucky_vm/run_service.sh
