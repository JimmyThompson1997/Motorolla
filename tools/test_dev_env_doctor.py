from __future__ import annotations

from pathlib import Path

from tools import dev_env_doctor as doctor


def seed_repo(root: Path) -> tuple[Path, Path]:
    (root / "Brewfile").write_text("formula \"python@3.12\"\n", encoding="utf-8")
    wrapper = root / "pucky-apk" / "gradlew"
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    gradle_wrapper = root / "pucky-apk" / "gradle" / "wrapper"
    gradle_wrapper.mkdir(parents=True)
    (gradle_wrapper / "gradle-wrapper.jar").write_bytes(b"jar")
    (gradle_wrapper / "gradle-wrapper.properties").write_text("distributionUrl=https://example.invalid/gradle.zip\n", encoding="utf-8")
    (root / "tools" / "bootstrap_mac_dev.sh").parent.mkdir(parents=True, exist_ok=True)
    (root / "tools" / "bootstrap_mac_dev.sh").write_text("#!/usr/bin/env bash\n", encoding="utf-8")
    (root / "pucky-apk" / "puckyctl").mkdir(parents=True, exist_ok=True)
    (root / "pucky-apk" / "puckyctl" / "puckyctl.py").write_text("print('ok')\n", encoding="utf-8")
    (root / "pucky-apk" / "fake-broker").mkdir(parents=True, exist_ok=True)
    (root / "pucky-apk" / "fake-broker" / "package.json").write_text('{"name":"fake-broker"}\n', encoding="utf-8")

    android_home = root / "android-sdk"
    (android_home / "platform-tools").mkdir(parents=True)
    (android_home / "platforms" / "android-35").mkdir(parents=True)
    (android_home / "build-tools" / "35.0.0").mkdir(parents=True)
    (android_home / "emulator").mkdir(parents=True)
    (android_home / "cmdline-tools" / "latest" / "bin").mkdir(parents=True)
    (android_home / "system-images" / "android-35" / "google_apis" / "arm64-v8a").mkdir(parents=True)
    return wrapper, android_home


def test_gather_report_happy_path(tmp_path: Path, monkeypatch) -> None:
    wrapper, android_home = seed_repo(tmp_path)
    brew = tmp_path / "bin" / "brew"
    python312 = tmp_path / "bin" / "python3.12"
    node = tmp_path / "bin" / "node"
    npm = tmp_path / "bin" / "npm"
    ffmpeg = tmp_path / "bin" / "ffmpeg"
    java_home = tmp_path / "jdk-17"
    java_bin = java_home / "bin"
    java_bin.mkdir(parents=True)
    for path in (
        brew,
        python312,
        node,
        npm,
        ffmpeg,
        java_bin / "java",
        android_home / "platform-tools" / "adb",
        android_home / "emulator" / "emulator",
        android_home / "cmdline-tools" / "latest" / "bin" / "avdmanager",
        android_home / "cmdline-tools" / "latest" / "bin" / "sdkmanager",
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")

    monkeypatch.setattr(doctor.dev_env_support, "host_system", lambda: "Darwin")
    monkeypatch.setattr(doctor.dev_env_support, "host_machine", lambda: "arm64")
    monkeypatch.setattr(doctor.dev_env_support, "brew_path", lambda environment=None: brew)
    monkeypatch.setattr(doctor.dev_env_support, "default_python312", lambda environment=None: python312)
    monkeypatch.setattr(doctor.dev_env_support, "default_node", lambda environment=None: node)
    monkeypatch.setattr(doctor.dev_env_support, "default_npm", lambda environment=None: npm)
    monkeypatch.setattr(doctor.dev_env_support, "default_ffmpeg", lambda environment=None: ffmpeg)
    monkeypatch.setattr(doctor.dev_env_support, "default_java_home", lambda environment=None, system=None: java_home)
    monkeypatch.setattr(doctor.dev_env_support, "default_gradle", lambda root, environment=None, system=None: wrapper)
    monkeypatch.setattr(doctor.dev_env_support, "default_android_home", lambda environment=None, system=None: android_home)
    monkeypatch.setattr(doctor.dev_env_support, "default_adb", lambda environment=None, system=None: android_home / "platform-tools" / "adb")
    monkeypatch.setattr(doctor.dev_env_support, "default_emulator", lambda environment=None, system=None: android_home / "emulator" / "emulator")
    monkeypatch.setattr(doctor.dev_env_support, "default_avdmanager", lambda environment=None, system=None: android_home / "cmdline-tools" / "latest" / "bin" / "avdmanager")
    monkeypatch.setattr(doctor.dev_env_support, "default_sdkmanager", lambda environment=None, system=None: android_home / "cmdline-tools" / "latest" / "bin" / "sdkmanager")
    monkeypatch.setattr(
        doctor,
        "_command_version",
        lambda command, timeout=10: (
            True,
            {
                str(python312): "Python 3.12.9",
                str(node): "v20.20.2",
                str(npm): "10.8.2",
                str(ffmpeg): "ffmpeg version 8.1.1",
                str(java_bin / "java"): 'openjdk version "17.0.19"',
                str(android_home / "platform-tools" / "adb"): "Android Debug Bridge version 1.0.41",
            }.get(str(command[0]), "ok"),
        ),
    )
    monkeypatch.setattr(doctor, "emulator_suite_report", lambda: {"ok": True, "checks": [{"ok": True}, {"ok": True}]})

    report = doctor.gather_report(root=tmp_path, include_emulator=True)

    assert report["ok"] is True
    by_name = {item["name"]: item for item in report["checks"]}
    assert by_name["python_3_12"]["ok"] is True
    assert by_name["android_sdk_packages"]["ok"] is True
    assert by_name["emulator_suite_doctor"]["ok"] is True


def test_gather_report_flags_missing_android_packages(tmp_path: Path, monkeypatch) -> None:
    wrapper, android_home = seed_repo(tmp_path)
    shutil_build_tools = android_home / "build-tools"
    for child in list(shutil_build_tools.iterdir()):
        if child.is_dir():
            for grandchild in child.iterdir():
                if grandchild.is_file():
                    grandchild.unlink()
            child.rmdir()

    monkeypatch.setattr(doctor.dev_env_support, "host_system", lambda: "Darwin")
    monkeypatch.setattr(doctor.dev_env_support, "host_machine", lambda: "arm64")
    monkeypatch.setattr(doctor.dev_env_support, "brew_path", lambda environment=None: tmp_path / "bin" / "brew")
    monkeypatch.setattr(doctor.dev_env_support, "default_python312", lambda environment=None: None)
    monkeypatch.setattr(doctor.dev_env_support, "which_path", lambda name, environment=None: None)
    monkeypatch.setattr(doctor.dev_env_support, "default_java_home", lambda environment=None, system=None: tmp_path / "jdk-17")
    monkeypatch.setattr(doctor.dev_env_support, "default_gradle", lambda root, environment=None, system=None: wrapper)
    monkeypatch.setattr(doctor.dev_env_support, "default_android_home", lambda environment=None, system=None: android_home)
    monkeypatch.setattr(doctor.dev_env_support, "default_adb", lambda environment=None, system=None: android_home / "platform-tools" / "adb")
    monkeypatch.setattr(doctor.dev_env_support, "default_emulator", lambda environment=None, system=None: android_home / "emulator" / "emulator")
    monkeypatch.setattr(doctor.dev_env_support, "default_avdmanager", lambda environment=None, system=None: android_home / "cmdline-tools" / "latest" / "bin" / "avdmanager")
    monkeypatch.setattr(doctor.dev_env_support, "default_sdkmanager", lambda environment=None, system=None: android_home / "cmdline-tools" / "latest" / "bin" / "sdkmanager")

    report = doctor.gather_report(root=tmp_path)

    by_name = {item["name"]: item for item in report["checks"]}
    assert by_name["android_sdk_packages"]["ok"] is False
    assert "build-tools" in by_name["android_sdk_packages"]["detail"]


def test_gather_report_allows_local_toolchain_without_brew(tmp_path: Path, monkeypatch) -> None:
    wrapper, android_home = seed_repo(tmp_path)
    local_root = tmp_path / ".local" / "pucky-dev"
    node = local_root / "bin" / "node"
    npm = local_root / "bin" / "npm"
    ffmpeg = local_root / "bin" / "ffmpeg"
    python312 = local_root / "bin" / "python3.12"
    java_home = local_root / "jdk-17"
    (java_home / "bin").mkdir(parents=True)
    for path in (
        node,
        npm,
        ffmpeg,
        python312,
        java_home / "bin" / "java",
        android_home / "platform-tools" / "adb",
        android_home / "emulator" / "emulator",
        android_home / "cmdline-tools" / "latest" / "bin" / "avdmanager",
        android_home / "cmdline-tools" / "latest" / "bin" / "sdkmanager",
    ):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")

    monkeypatch.setattr(doctor.dev_env_support, "host_system", lambda: "Darwin")
    monkeypatch.setattr(doctor.dev_env_support, "host_machine", lambda: "arm64")
    monkeypatch.setattr(doctor.dev_env_support, "brew_path", lambda environment=None: None)
    monkeypatch.setattr(doctor.dev_env_support, "local_dev_root", lambda environment=None, home=None: local_root)
    monkeypatch.setattr(doctor.dev_env_support, "default_python312", lambda environment=None: python312)
    monkeypatch.setattr(doctor.dev_env_support, "default_node", lambda environment=None: node)
    monkeypatch.setattr(doctor.dev_env_support, "default_npm", lambda environment=None: npm)
    monkeypatch.setattr(doctor.dev_env_support, "default_ffmpeg", lambda environment=None: ffmpeg)
    monkeypatch.setattr(doctor.dev_env_support, "default_java_home", lambda environment=None, system=None: java_home)
    monkeypatch.setattr(doctor.dev_env_support, "default_gradle", lambda root, environment=None, system=None: wrapper)
    monkeypatch.setattr(doctor.dev_env_support, "default_android_home", lambda environment=None, system=None: android_home)
    monkeypatch.setattr(doctor.dev_env_support, "default_adb", lambda environment=None, system=None: android_home / "platform-tools" / "adb")
    monkeypatch.setattr(doctor.dev_env_support, "default_emulator", lambda environment=None, system=None: android_home / "emulator" / "emulator")
    monkeypatch.setattr(doctor.dev_env_support, "default_avdmanager", lambda environment=None, system=None: android_home / "cmdline-tools" / "latest" / "bin" / "avdmanager")
    monkeypatch.setattr(doctor.dev_env_support, "default_sdkmanager", lambda environment=None, system=None: android_home / "cmdline-tools" / "latest" / "bin" / "sdkmanager")
    monkeypatch.setattr(
        doctor,
        "_command_version",
        lambda command, timeout=10: (
            True,
            {
                str(python312): "Python 3.12.13",
                str(node): "v20.20.2",
                str(npm): "10.8.2",
                str(ffmpeg): "ffmpeg version 8.1.1",
                str(java_home / "bin" / "java"): 'openjdk version "17.0.19"',
                str(android_home / "platform-tools" / "adb"): "Android Debug Bridge version 1.0.41",
            }.get(str(command[0]), "ok"),
        ),
    )

    report = doctor.gather_report(root=tmp_path)

    by_name = {item["name"]: item for item in report["checks"]}
    assert by_name["homebrew"]["ok"] is True
    assert "local toolchain" in by_name["homebrew"]["detail"]
