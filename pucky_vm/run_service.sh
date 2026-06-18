#!/usr/bin/env bash
set -euo pipefail

export HOME="${HOME:-/data/home/codex}"
export CODEX_HOME="${CODEX_HOME:-/data/home/codex}"
mkdir -p "$HOME" "$CODEX_HOME"

PYTHON_BIN="${PUCKY_PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  if command -v python3.12 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3.12)"
  elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="$(command -v python3)"
  else
    echo "Pucky VM requires python3.12 or python3 on PATH."
    exit 1
  fi
fi

if ! "$PYTHON_BIN" - <<'PY'
import sys
raise SystemExit(0 if sys.version_info >= (3, 12) else 1)
PY
then
  echo "Pucky VM requires Python 3.12+. Found: $("$PYTHON_BIN" --version 2>&1)"
  exit 1
fi

cd "$(dirname "$0")/.."
exec "$PYTHON_BIN" -m pucky_vm
