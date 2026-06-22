#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
export HOME="${HOME:-/data/home/codex}"
export CODEX_HOME="${CODEX_HOME:-/data/home/codex}"

RUNTIME_ROOT="/data/pucky-runtime"
BIN_DIR="$RUNTIME_ROOT/bin"
NODE_ROOT="$RUNTIME_ROOT/node"
NODE_SHASUMS_URL="https://nodejs.org/dist/latest-v20.x/SHASUMS256.txt"
NPM_GLOBAL_PREFIX="$CODEX_HOME/npm-global"

mkdir -p "$HOME" "$CODEX_HOME" "$BIN_DIR" "$NPM_GLOBAL_PREFIX"
export PATH="$BIN_DIR:$NPM_GLOBAL_PREFIX/bin:$PATH"

require_cmd() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Pucky VM requires '$name' on the base image."
    exit 1
  fi
}

resolve_node_archive_name() {
  local node_arch=""
  case "$(uname -m)" in
    x86_64|amd64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *)
      echo "Unsupported Fly runtime architecture: $(uname -m)"
      exit 1
      ;;
  esac
  curl -fsSL "$NODE_SHASUMS_URL" | awk "/linux-${node_arch}\\.tar\\.xz$/ {print \$2; exit}"
}

ensure_node_runtime() {
  if [[ -x "$BIN_DIR/node" && -x "$BIN_DIR/npm" && -x "$BIN_DIR/npx" ]]; then
    echo "Pucky Fly start: using cached Node runtime from $NODE_ROOT/current"
    return
  fi

  require_cmd curl
  require_cmd tar

  local archive_name=""
  archive_name="$(resolve_node_archive_name)"
  if [[ -z "$archive_name" ]]; then
    echo "Could not resolve latest Node 20 archive from $NODE_SHASUMS_URL"
    exit 1
  fi

  local tmp_dir="/tmp/pucky-node-bootstrap"
  local archive_path="$tmp_dir/$archive_name"
  rm -rf "$tmp_dir" "$NODE_ROOT"
  mkdir -p "$tmp_dir" "$NODE_ROOT"

  echo "Pucky Fly start: downloading Node runtime archive $archive_name"
  curl -fsSL "https://nodejs.org/dist/latest-v20.x/$archive_name" -o "$archive_path"
  tar -xJf "$archive_path" -C "$tmp_dir"

  local extracted_root=""
  extracted_root="$(find "$tmp_dir" -maxdepth 1 -type d -name 'node-v20*' | head -n 1)"
  if [[ -z "$extracted_root" ]]; then
    echo "Failed to unpack Node distribution"
    exit 1
  fi

  mv "$extracted_root" "$NODE_ROOT/current"
  ln -sf "$NODE_ROOT/current/bin/node" "$BIN_DIR/node"
  ln -sf "$NODE_ROOT/current/bin/npm" "$BIN_DIR/npm"
  ln -sf "$NODE_ROOT/current/bin/npx" "$BIN_DIR/npx"
}

ensure_codex_runtime() {
  if command -v codex >/dev/null 2>&1; then
    echo "Pucky Fly start: using cached Codex runtime"
    return
  fi
  echo "Pucky Fly start: installing Codex runtime into $NPM_GLOBAL_PREFIX"
  npm install -g @openai/codex --prefix "$NPM_GLOBAL_PREFIX"
}

require_cmd python3
ensure_node_runtime
ensure_codex_runtime

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
