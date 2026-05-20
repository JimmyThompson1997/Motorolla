#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/data/home/codex}"
export CODEX_HOME="${CODEX_HOME:-/data/home/codex}"
mkdir -p "$HOME" "$CODEX_HOME"

cd "$(dirname "$0")/.."
exec python3 -m pucky_vm
