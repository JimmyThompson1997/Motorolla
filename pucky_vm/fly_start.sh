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

cd /data/pucky-src
if git_sha="$(git rev-parse --short HEAD 2>/dev/null)"; then
  export PUCKY_UI_VERSION="git-${git_sha}"
fi
exec bash ./pucky_vm/run_service.sh
