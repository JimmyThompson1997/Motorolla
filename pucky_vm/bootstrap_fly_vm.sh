#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl ffmpeg git nodejs npm python3
npm install -g @openai/codex
mkdir -p /data/home/codex /data/pucky-src
