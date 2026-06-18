from __future__ import annotations

from pathlib import Path

from tools import dev_env_support


def test_default_system_image_prefers_arm64_on_apple_silicon() -> None:
    assert dev_env_support.default_system_image(system="Darwin", machine="arm64").endswith("arm64-v8a")
    assert dev_env_support.default_system_image(system="Darwin", machine="x86_64").endswith("x86_64")
    assert dev_env_support.default_system_image(system="Windows", machine="AMD64").endswith("x86_64")


def test_default_gradle_prefers_repo_wrapper(tmp_path: Path) -> None:
    wrapper = tmp_path / "pucky-apk" / "gradlew"
    wrapper.parent.mkdir(parents=True)
    wrapper.write_text("#!/usr/bin/env bash\n", encoding="utf-8")

    resolved = dev_env_support.default_gradle(tmp_path, system="Darwin")

    assert resolved == wrapper


def test_default_android_home_prefers_env_override(tmp_path: Path) -> None:
    android_home = tmp_path / "AndroidSdk"
    resolved = dev_env_support.default_android_home(
        environment={"ANDROID_HOME": str(android_home)},
        system="Darwin",
        home=tmp_path,
    )

    assert resolved == android_home


def test_default_python312_can_fall_back_to_codex_runtime(tmp_path: Path, monkeypatch) -> None:
    codex_python = tmp_path / ".cache" / "codex-runtimes" / "codex-primary-runtime" / "dependencies" / "python" / "bin" / "python3"
    codex_python.parent.mkdir(parents=True)
    codex_python.write_text("", encoding="utf-8")

    monkeypatch.setattr(dev_env_support.sys, "version_info", (3, 9, 0))
    monkeypatch.setattr(dev_env_support, "which_path", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(dev_env_support, "brew_prefix", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(dev_env_support.Path, "home", lambda: tmp_path)

    assert dev_env_support.default_python312() == codex_python
