from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable, Optional


ROOT = Path(__file__).resolve().parents[1]
WINDOWS_ANDROID_TOOLS = Path(r"C:\Users\jimmy\Desktop\Android\tools")
BREW_PREFIXES = (Path("/opt/homebrew"), Path("/usr/local"))
CODEX_RUNTIME_ROOT = Path.home() / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies"
ANDROID_API_LEVEL = 35
BUILD_TOOLS_MAJOR = "35"


def host_system() -> str:
    return platform.system()


def host_machine() -> str:
    return platform.machine().lower()


def is_macos(system: Optional[str] = None) -> bool:
    return (system or host_system()) == "Darwin"


def is_windows(system: Optional[str] = None) -> bool:
    return (system or host_system()) == "Windows"


def executable_name(base: str, *, system: Optional[str] = None) -> str:
    return base + ".bat" if is_windows(system) and base in {"avdmanager", "sdkmanager"} else base + ".exe" if is_windows(system) else base


def first_existing(candidates: Iterable[Path]) -> Optional[Path]:
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def first_candidate(candidates: Iterable[Path]) -> Optional[Path]:
    for candidate in candidates:
        return candidate
    return None


def path_from_env(name: str, *, environment: Optional[dict[str, str]] = None) -> Optional[Path]:
    env = environment or os.environ
    value = str(env.get(name, "") or "").strip()
    return Path(value) if value else None


def which_path(name: str, *, environment: Optional[dict[str, str]] = None) -> Optional[Path]:
    value = shutil.which(name, path=(environment or os.environ).get("PATH"))
    return Path(value) if value else None


def brew_path(*, environment: Optional[dict[str, str]] = None) -> Optional[Path]:
    env = environment or os.environ
    value = shutil.which("brew", path=env.get("PATH"))
    return Path(value) if value else None


def brew_prefix(formula: str, *, environment: Optional[dict[str, str]] = None) -> Optional[Path]:
    brew = brew_path(environment=environment)
    if brew is None:
        return None
    try:
        result = subprocess.run(
            [str(brew), "--prefix", formula],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
            env=environment,
        )
    except Exception:
        return None
    value = result.stdout.strip()
    return Path(value) if value else None


def local_dev_root(*, environment: Optional[dict[str, str]] = None, home: Optional[Path] = None) -> Path:
    env = environment or os.environ
    explicit = path_from_env("PUCKY_LOCAL_DEV_ROOT", environment=env)
    if explicit is not None:
        return explicit
    home_dir = home or Path.home()
    return home_dir / ".local" / "pucky-dev"


def codex_runtime_python(*, home: Optional[Path] = None) -> Optional[Path]:
    root = (home or Path.home()) / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies"
    candidate = root / "python" / "bin" / "python3"
    return candidate if candidate.exists() else None


def codex_runtime_node(*, home: Optional[Path] = None) -> Optional[Path]:
    root = (home or Path.home()) / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies"
    candidate = root / "node" / "bin" / "node"
    return candidate if candidate.exists() else None


def local_bin(name: str, *, environment: Optional[dict[str, str]] = None, home: Optional[Path] = None) -> Path:
    return local_dev_root(environment=environment, home=home) / "bin" / name


def gradle_wrapper_path(root: Path = ROOT, *, system: Optional[str] = None) -> Path:
    wrapper_name = "gradlew.bat" if is_windows(system) else "gradlew"
    return root / "pucky-apk" / wrapper_name


def android_sdk_root_candidates(
    *,
    environment: Optional[dict[str, str]] = None,
    system: Optional[str] = None,
    home: Optional[Path] = None,
) -> list[Path]:
    env = environment or os.environ
    platform_name = system or host_system()
    home_dir = home or Path.home()
    candidates: list[Path] = []
    for key in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        path = path_from_env(key, environment=env)
        if path is not None:
            candidates.append(path)
    adb = which_path("adb", environment=env)
    if adb is not None and adb.parent.name == "platform-tools":
        candidates.append(adb.parent.parent)
    if platform_name == "Darwin":
        candidates.append(local_dev_root(environment=env, home=home_dir) / "android-sdk")
        candidates.append(home_dir / "Library" / "Android" / "sdk")
        for prefix in BREW_PREFIXES:
            candidates.append(prefix / "share" / "android-commandlinetools")
    elif platform_name == "Windows":
        candidates.append(WINDOWS_ANDROID_TOOLS / "android-sdk")
    else:
        candidates.append(home_dir / "Android" / "Sdk")
    return _dedupe_paths(candidates)


def default_android_home(
    *,
    environment: Optional[dict[str, str]] = None,
    system: Optional[str] = None,
    home: Optional[Path] = None,
) -> Path:
    candidates = android_sdk_root_candidates(environment=environment, system=system, home=home)
    return first_existing(candidates) or candidates[0]


def default_java_home(
    *,
    environment: Optional[dict[str, str]] = None,
    system: Optional[str] = None,
) -> Path:
    env = environment or os.environ
    platform_name = system or host_system()
    explicit = path_from_env("JAVA_HOME", environment=env)
    if explicit is not None:
        return explicit
    candidates: list[Path] = []
    if platform_name == "Darwin":
        detected = macos_java_home(environment=env)
        if detected is not None:
            candidates.append(detected)
        candidates.append(local_dev_root(environment=env) / "jdk-17" / "Contents" / "Home")
        for prefix in BREW_PREFIXES:
            candidates.append(prefix / "opt" / "openjdk@17" / "libexec" / "openjdk.jdk" / "Contents" / "Home")
        brew_prefix_path = brew_prefix("openjdk@17", environment=env)
        if brew_prefix_path is not None:
            candidates.insert(0, brew_prefix_path / "libexec" / "openjdk.jdk" / "Contents" / "Home")
    elif platform_name == "Windows":
        candidates.append(WINDOWS_ANDROID_TOOLS / "jdk-17")
    else:
        candidates.append(Path("/usr/lib/jvm/java-17-openjdk"))
        candidates.append(Path("/usr/lib/jvm/java-17-openjdk-amd64"))
    return first_existing(candidates) or first_candidate(candidates) or Path("java-home-missing")


def default_gradle(
    root: Path = ROOT,
    *,
    environment: Optional[dict[str, str]] = None,
    system: Optional[str] = None,
) -> Path:
    wrapper = gradle_wrapper_path(root, system=system)
    if wrapper.exists():
        return wrapper
    env = environment or os.environ
    explicit = path_from_env("GRADLE_BIN", environment=env)
    if explicit is not None:
        return explicit
    found = which_path("gradle", environment=env)
    if found is not None:
        return found
    if is_windows(system):
        return WINDOWS_ANDROID_TOOLS / "gradle-8.10.2" / "bin" / "gradle.bat"
    return Path("gradle")


def default_adb(
    *,
    environment: Optional[dict[str, str]] = None,
    system: Optional[str] = None,
    home: Optional[Path] = None,
) -> Path:
    env = environment or os.environ
    found = which_path("adb", environment=env)
    if found is not None:
        return found
    android_home = default_android_home(environment=env, system=system, home=home)
    name = executable_name("adb", system=system)
    return android_home / "platform-tools" / name


def default_emulator(
    *,
    environment: Optional[dict[str, str]] = None,
    system: Optional[str] = None,
    home: Optional[Path] = None,
) -> Path:
    env = environment or os.environ
    found = which_path("emulator", environment=env)
    if found is not None:
        return found
    android_home = default_android_home(environment=env, system=system, home=home)
    name = executable_name("emulator", system=system)
    return android_home / "emulator" / name


def default_avdmanager(
    *,
    environment: Optional[dict[str, str]] = None,
    system: Optional[str] = None,
    home: Optional[Path] = None,
) -> Path:
    env = environment or os.environ
    found = which_path("avdmanager", environment=env)
    if found is not None:
        return found
    android_home = default_android_home(environment=env, system=system, home=home)
    name = executable_name("avdmanager", system=system)
    for relative in (
        Path("cmdline-tools") / "latest" / "bin" / name,
        Path("cmdline-tools") / "bin" / name,
        Path("tools") / "bin" / name,
    ):
        candidate = android_home / relative
        if candidate.exists():
            return candidate
    return android_home / "cmdline-tools" / "latest" / "bin" / name


def default_sdkmanager(
    *,
    environment: Optional[dict[str, str]] = None,
    system: Optional[str] = None,
    home: Optional[Path] = None,
) -> Path:
    env = environment or os.environ
    found = which_path("sdkmanager", environment=env)
    if found is not None:
        return found
    android_home = default_android_home(environment=env, system=system, home=home)
    name = executable_name("sdkmanager", system=system)
    for relative in (
        Path("cmdline-tools") / "latest" / "bin" / name,
        Path("cmdline-tools") / "bin" / name,
        Path("tools") / "bin" / name,
    ):
        candidate = android_home / relative
        if candidate.exists():
            return candidate
    return android_home / "cmdline-tools" / "latest" / "bin" / name


def default_python312(*, environment: Optional[dict[str, str]] = None) -> Optional[Path]:
    env = environment or os.environ
    if sys.version_info >= (3, 12):
        return Path(os.path.realpath(os.sys.executable))
    local_python = local_bin("python3.12", environment=env)
    if local_python.exists():
        return local_python
    codex_python = codex_runtime_python()
    if codex_python is not None:
        return codex_python
    found = which_path("python3.12", environment=env)
    if found is not None:
        return found
    prefix = brew_prefix("python@3.12", environment=env)
    if prefix is not None:
        candidate = prefix / "bin" / "python3.12"
        if candidate.exists():
            return candidate
    return None


def default_node(*, environment: Optional[dict[str, str]] = None) -> Optional[Path]:
    env = environment or os.environ
    local_node = local_bin("node", environment=env)
    if local_node.exists():
        return local_node
    found = which_path("node", environment=env)
    if found is not None:
        return found
    return codex_runtime_node()


def default_npm(*, environment: Optional[dict[str, str]] = None) -> Optional[Path]:
    env = environment or os.environ
    local_npm = local_bin("npm", environment=env)
    if local_npm.exists():
        return local_npm
    return which_path("npm", environment=env)


def default_ffmpeg(*, environment: Optional[dict[str, str]] = None) -> Optional[Path]:
    env = environment or os.environ
    local_ffmpeg = local_bin("ffmpeg", environment=env)
    if local_ffmpeg.exists():
        return local_ffmpeg
    return which_path("ffmpeg", environment=env)


def default_flyctl(
    *,
    environment: Optional[dict[str, str]] = None,
    home: Optional[Path] = None,
) -> Optional[Path]:
    env = environment or os.environ
    explicit = path_from_env("FLYCTL_BIN", environment=env)
    if explicit is not None and explicit.exists():
        return explicit
    local_flyctl = local_bin("flyctl", environment=env, home=home)
    if local_flyctl.exists():
        return local_flyctl
    found = which_path("flyctl", environment=env)
    if found is not None:
        return found
    home_dir = home or Path.home()
    install_root = path_from_env("FLYCTL_INSTALL", environment=env) or (home_dir / ".fly")
    candidate = install_root / "bin" / "flyctl"
    if candidate.exists():
        return candidate
    prefix = brew_prefix("flyctl", environment=env)
    if prefix is not None:
        brewed = prefix / "bin" / "flyctl"
        if brewed.exists():
            return brewed
    return None


def default_system_image(*, system: Optional[str] = None, machine: Optional[str] = None) -> str:
    platform_name = system or host_system()
    architecture = (machine or host_machine()).lower()
    if platform_name == "Darwin" and architecture == "arm64":
        return f"system-images;android-{ANDROID_API_LEVEL};google_apis;arm64-v8a"
    return f"system-images;android-{ANDROID_API_LEVEL};google_apis;x86_64"


def macos_java_home(*, environment: Optional[dict[str, str]] = None) -> Optional[Path]:
    if not is_macos():
        return None
    java_home = Path("/usr/libexec/java_home")
    if not java_home.exists():
        return None
    try:
        result = subprocess.run(
            [str(java_home), "-v", "17"],
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
            env=environment,
        )
    except Exception:
        return None
    value = result.stdout.strip()
    return Path(value) if value else None


def _dedupe_paths(paths: Iterable[Path]) -> list[Path]:
    unique: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique
