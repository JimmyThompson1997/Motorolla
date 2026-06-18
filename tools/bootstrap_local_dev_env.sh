#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_ROOT="${PUCKY_LOCAL_DEV_ROOT:-$HOME/.local/pucky-dev}"
BIN_DIR="$LOCAL_ROOT/bin"
ANDROID_HOME_DEFAULT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$LOCAL_ROOT/android-sdk}}"
ANDROID_HOME="$ANDROID_HOME_DEFAULT"
JDK_HOME="$LOCAL_ROOT/jdk-17/Contents/Home"
TMP_DIR="$ROOT/.tmp/bootstrap-local-dev"
NODE_INDEX_URL="https://nodejs.org/dist/latest-v20.x"
ANDROID_CMDLINE_TOOLS_URL="https://dl.google.com/android/repository/commandlinetools-mac-14742923_latest.zip"
JDK_URL="https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jdk/hotspot/normal/eclipse"
FFMPEG_URL_X64="https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
FFPROBE_URL_X64="https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip"
FFMPEG_URL_ARM64="https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/snapshot/ffmpeg.zip"
FFPROBE_URL_ARM64="https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/snapshot/ffprobe.zip"
CODEX_RUNTIME_ROOT="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
CODEX_PYTHON="$CODEX_RUNTIME_ROOT/python/bin/python3"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "tools/bootstrap_local_dev_env.sh is for macOS hosts."
  exit 1
fi

FFMPEG_URL="$FFMPEG_URL_X64"
FFPROBE_URL="$FFPROBE_URL_X64"
if [[ "$(uname -m)" == "arm64" ]]; then
  FFMPEG_URL="$FFMPEG_URL_ARM64"
  FFPROBE_URL="$FFPROBE_URL_ARM64"
fi

if [[ ! -x "$CODEX_PYTHON" ]]; then
  echo "Expected bundled Codex Python at $CODEX_PYTHON"
  exit 1
fi

mkdir -p "$BIN_DIR" "$ANDROID_HOME" "$TMP_DIR"

download() {
  local url="$1"
  local out="$2"
  curl -fsSL "$url" -o "$out"
}

if [[ ! -x "$BIN_DIR/node" || ! -x "$BIN_DIR/npm" ]]; then
  NODE_ARCHIVE_NAME="$(curl -fsSL "$NODE_INDEX_URL/SHASUMS256.txt" | awk '/darwin-arm64\.tar\.xz$/ {print $2; exit}')"
  if [[ -z "$NODE_ARCHIVE_NAME" ]]; then
    echo "Could not resolve latest Node 20 archive from $NODE_INDEX_URL"
    exit 1
  fi
  NODE_ARCHIVE="$TMP_DIR/$NODE_ARCHIVE_NAME"
  NODE_EXTRACT_DIR="$TMP_DIR/node-dist"
  rm -rf "$NODE_EXTRACT_DIR"
  download "$NODE_INDEX_URL/$NODE_ARCHIVE_NAME" "$NODE_ARCHIVE"
  tar -xJf "$NODE_ARCHIVE" -C "$TMP_DIR"
  NODE_ROOT="$(find "$TMP_DIR" -maxdepth 1 -type d -name 'node-v20*' | head -n 1)"
  if [[ -z "$NODE_ROOT" ]]; then
    echo "Failed to unpack Node distribution"
    exit 1
  fi
  ln -sf "$NODE_ROOT/bin/node" "$BIN_DIR/node"
  ln -sf "$NODE_ROOT/bin/npm" "$BIN_DIR/npm"
  ln -sf "$NODE_ROOT/bin/npx" "$BIN_DIR/npx"
fi

ln -sf "$CODEX_RUNTIME_ROOT/python/bin/python3.12" "$BIN_DIR/python3.12"
ln -sf "$CODEX_RUNTIME_ROOT/python/bin/python3" "$BIN_DIR/python3"
ln -sf "$CODEX_RUNTIME_ROOT/python/bin/pip3.12" "$BIN_DIR/pip3.12"

if [[ ! -x "$JDK_HOME/bin/java" ]]; then
  JDK_ARCHIVE="$TMP_DIR/temurin17.tar.gz"
  rm -rf "$LOCAL_ROOT/jdk-17"
  download "$JDK_URL" "$JDK_ARCHIVE"
  tar -xzf "$JDK_ARCHIVE" -C "$LOCAL_ROOT"
  JDK_BUNDLE="$(find "$LOCAL_ROOT" -maxdepth 1 -type d -name 'jdk-17*' | head -n 1)"
  if [[ -z "$JDK_BUNDLE" ]]; then
    echo "Failed to unpack Temurin 17"
    exit 1
  fi
  mv "$JDK_BUNDLE" "$LOCAL_ROOT/jdk-17"
fi

if [[ ! -x "$BIN_DIR/ffmpeg" ]]; then
  FFMPEG_ARCHIVE="$TMP_DIR/ffmpeg.zip"
  FFMPEG_EXTRACT="$TMP_DIR/ffmpeg"
  rm -rf "$FFMPEG_EXTRACT"
  mkdir -p "$FFMPEG_EXTRACT"
  download "$FFMPEG_URL" "$FFMPEG_ARCHIVE"
  unzip -q "$FFMPEG_ARCHIVE" -d "$FFMPEG_EXTRACT"
  ln -sf "$FFMPEG_EXTRACT/ffmpeg" "$BIN_DIR/ffmpeg"
fi

if [[ ! -x "$BIN_DIR/ffprobe" ]]; then
  FFPROBE_ARCHIVE="$TMP_DIR/ffprobe.zip"
  FFPROBE_EXTRACT="$TMP_DIR/ffprobe"
  rm -rf "$FFPROBE_EXTRACT"
  mkdir -p "$FFPROBE_EXTRACT"
  download "$FFPROBE_URL" "$FFPROBE_ARCHIVE"
  unzip -q "$FFPROBE_ARCHIVE" -d "$FFPROBE_EXTRACT"
  ln -sf "$FFPROBE_EXTRACT/ffprobe" "$BIN_DIR/ffprobe"
fi

if [[ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]]; then
  ANDROID_ARCHIVE="$TMP_DIR/commandlinetools.zip"
  ANDROID_EXTRACT="$TMP_DIR/android-cmdline-tools"
  rm -rf "$ANDROID_EXTRACT" "$ANDROID_HOME/cmdline-tools/latest"
  mkdir -p "$ANDROID_EXTRACT" "$ANDROID_HOME/cmdline-tools"
  download "$ANDROID_CMDLINE_TOOLS_URL" "$ANDROID_ARCHIVE"
  unzip -q "$ANDROID_ARCHIVE" -d "$ANDROID_EXTRACT"
  mv "$ANDROID_EXTRACT/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi

export JAVA_HOME="$JDK_HOME"
export ANDROID_HOME="$ANDROID_HOME"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$BIN_DIR:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$PATH"

SYSTEM_IMAGE="system-images;android-35;google_apis;x86_64"
if [[ "$(uname -m)" == "arm64" ]]; then
  SYSTEM_IMAGE="system-images;android-35;google_apis;arm64-v8a"
fi

yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0" \
  "emulator" \
  "$SYSTEM_IMAGE"

mkdir -p "$ROOT/.tmp"
ENV_FILE="$ROOT/.tmp/pucky-local-dev-env.sh"
cat >"$ENV_FILE" <<EOF
export PUCKY_LOCAL_DEV_ROOT="$LOCAL_ROOT"
export JAVA_HOME="$JAVA_HOME"
export ANDROID_HOME="$ANDROID_HOME"
export ANDROID_SDK_ROOT="$ANDROID_SDK_ROOT"
export PATH="$BIN_DIR:$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:\$PATH"
EOF

"$BIN_DIR/python3.12" "$ROOT/tools/dev_env_doctor.py" --include-emulator --json >"$ROOT/.tmp/pucky-local-dev-doctor.json"
"$BIN_DIR/python3.12" "$ROOT/tools/dev_env_doctor.py" --include-emulator

echo
echo "Local bootstrap complete."
echo "Environment exports written to $ENV_FILE"
echo "Doctor report written to $ROOT/.tmp/pucky-local-dev-doctor.json"
echo "In a new shell, run:"
echo "  source \"$ENV_FILE\""
