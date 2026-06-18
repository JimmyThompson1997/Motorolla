#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "tools/bootstrap_mac_dev.sh is for macOS hosts."
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it first from https://brew.sh/ and rerun this script."
  exit 1
fi

brew bundle --file "$ROOT/Brewfile"

BREW_PREFIX="$(brew --prefix)"
PYTHON_BIN="$(brew --prefix python@3.12)/bin/python3.12"
NODE_BIN="$(brew --prefix node@20)/bin/node"
NPM_BIN="$(brew --prefix node@20)/bin/npm"
JAVA_HOME_DEFAULT="${JAVA_HOME:-}"
if [[ -z "$JAVA_HOME_DEFAULT" ]]; then
  if JAVA_HOME_CANDIDATE="$(/usr/libexec/java_home -v 17 2>/dev/null)"; then
    JAVA_HOME_DEFAULT="$JAVA_HOME_CANDIDATE"
  else
    JAVA_HOME_DEFAULT="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
  fi
fi

ANDROID_HOME_DEFAULT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
mkdir -p "$ANDROID_HOME_DEFAULT"

export JAVA_HOME="$JAVA_HOME_DEFAULT"
export ANDROID_HOME="$ANDROID_HOME_DEFAULT"
export ANDROID_SDK_ROOT="$ANDROID_HOME_DEFAULT"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

SDKMANAGER=""
for candidate in \
  "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
  "$BREW_PREFIX/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager" \
  "$(command -v sdkmanager 2>/dev/null || true)"
do
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    SDKMANAGER="$candidate"
    break
  fi
done

if [[ -z "$SDKMANAGER" ]]; then
  echo "Could not find sdkmanager after Homebrew install."
  echo "Expected one of:"
  echo "  $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  echo "  $BREW_PREFIX/share/android-commandlinetools/cmdline-tools/latest/bin/sdkmanager"
  exit 1
fi

SYSTEM_IMAGE="system-images;android-35;google_apis;x86_64"
if [[ "$(uname -m)" == "arm64" ]]; then
  SYSTEM_IMAGE="system-images;android-35;google_apis;arm64-v8a"
fi

yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" \
  "platform-tools" \
  "platforms;android-35" \
  "build-tools;35.0.0" \
  "emulator" \
  "$SYSTEM_IMAGE"

mkdir -p "$ROOT/.tmp"
ENV_FILE="$ROOT/.tmp/pucky-mac-dev-env.sh"
cat >"$ENV_FILE" <<EOF
export JAVA_HOME="$JAVA_HOME"
export ANDROID_HOME="$ANDROID_HOME"
export ANDROID_SDK_ROOT="$ANDROID_SDK_ROOT"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:\$PATH"
alias pucky-python="$PYTHON_BIN"
alias pucky-node="$NODE_BIN"
alias pucky-npm="$NPM_BIN"
EOF

"$PYTHON_BIN" "$ROOT/tools/dev_env_doctor.py" --include-emulator --json >"$ROOT/.tmp/pucky-mac-dev-doctor.json"
"$PYTHON_BIN" "$ROOT/tools/dev_env_doctor.py" --include-emulator

echo
echo "Bootstrap complete."
echo "Environment exports written to $ENV_FILE"
echo "Doctor report written to $ROOT/.tmp/pucky-mac-dev-doctor.json"
echo "In a new shell, run:"
echo "  source \"$ENV_FILE\""
