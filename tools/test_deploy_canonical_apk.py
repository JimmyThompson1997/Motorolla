from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]


def test_canonical_deploy_can_import_turn_provisioning_without_secret_logging() -> None:
    script = (ROOT / "tools" / "deploy-canonical-apk.ps1").read_text(encoding="utf-8")

    assert "[string]$ProvisionToken" in script
    assert "[string]$ProvisionTurnUrl" in script
    assert "[string]$ProvisionReplyMode" in script
    assert 'schema = "pucky.provisioning.v1"' in script
    assert '$provisioning["token"] = $ProvisionToken' in script
    assert '$provisioning["pucky_turn_url"] = $ProvisionTurnUrl' in script
    assert '$provisioning["pucky_turn_reply_mode"] = $ProvisionReplyMode' in script
    assert "provisioning_json_base64" in script
    assert "--ez connect true" in script
    assert "pucky_turn_provisioning.json" not in script
    assert "without printing token values" in script
    assert "$env:PUCKY_DEVICE_TOKEN" in script
    assert "$env:PUCKY_API_TOKEN" in script
    assert "Write-Host $ProvisionToken" not in script


def test_canonical_deploy_fails_when_adb_install_fails_even_if_old_package_matches(tmp_path) -> None:
    shell = _powershell()
    repo = _prepare_canonical_repo(tmp_path)
    adb = _fake_adb(tmp_path, install_success=False)
    result = _run_deploy(shell, repo, adb)

    assert result.returncode != 0
    assert "APK install failed" in (result.stdout + result.stderr)


def test_canonical_deploy_removes_local_provisioning_file_after_import(tmp_path) -> None:
    shell = _powershell()
    repo = _prepare_canonical_repo(tmp_path)
    adb = _fake_adb(tmp_path, install_success=True)
    host_file = Path(tempfile.gettempdir()) / "pucky_turn_provisioning.json"
    host_file.unlink(missing_ok=True)

    result = _run_deploy(shell, repo, adb, "-ProvisionToken", "secret-test-token")

    assert result.returncode == 0, result.stdout + result.stderr
    assert not host_file.exists()


def _powershell() -> str:
    shell = shutil.which("pwsh") or shutil.which("powershell")
    if not shell:
        pytest.skip("PowerShell is required for deploy-script tests")
    return shell


def _prepare_canonical_repo(tmp_path: Path) -> Path:
    origin = tmp_path / "origin.git"
    repo = tmp_path / "repo"
    subprocess.run(["git", "init", "--bare", str(origin)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    subprocess.run(["git", "init", "-b", "master", str(repo)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    subprocess.run(["git", "config", "user.email", "pucky-tests@example.com"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Pucky Tests"], cwd=repo, check=True)

    (repo / "tools").mkdir(parents=True)
    shutil.copy2(ROOT / "tools" / "deploy-canonical-apk.ps1", repo / "tools" / "deploy-canonical-apk.ps1")
    (repo / "pucky-apk" / "app" / "build" / "outputs" / "apk" / "debug").mkdir(parents=True)
    (repo / "pucky-apk" / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk").write_bytes(b"apk")
    (repo / "pucky-apk" / "app").mkdir(parents=True, exist_ok=True)
    (repo / "pucky-apk" / "app" / "build.gradle").write_text(
        'android { defaultConfig { versionCode 123 versionName "1.2.3" } }\n',
        encoding="utf-8",
    )

    subprocess.run(["git", "add", "."], cwd=repo, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    subprocess.run(["git", "commit", "-m", "fixture"], cwd=repo, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    subprocess.run(["git", "remote", "add", "origin", str(origin)], cwd=repo, check=True)
    subprocess.run(["git", "push", "-u", "origin", "master"], cwd=repo, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return repo


def _fake_adb(tmp_path: Path, *, install_success: bool) -> Path:
    adb = tmp_path / "adb.cmd"
    install = "echo Success& exit /b 0" if install_success else "echo Failure [INSTALL_FAILED_TEST]& exit /b 1"
    adb.write_text(
        "\n".join(
            [
                "@echo off",
                "echo %* | findstr /C:\"install -r\" >nul && (" + install + ")",
                "echo %* | findstr /C:\"dumpsys package\" >nul && (echo versionCode=123& echo versionName=1.2.3-debug& exit /b 0)",
                "exit /b 0",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return adb


def _run_deploy(shell: str, repo: Path, adb: Path, *extra_args: str) -> subprocess.CompletedProcess[str]:
    gradle = repo.parent / "gradle.cmd"
    gradle.write_text("@echo off\nexit /b 0\n", encoding="utf-8")
    java_home = repo.parent / "jdk"
    android_home = repo.parent / "android"
    java_home.mkdir(exist_ok=True)
    android_home.mkdir(exist_ok=True)
    return subprocess.run(
        [
            shell,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(repo / "tools" / "deploy-canonical-apk.ps1"),
            "-Serial",
            "test-serial",
            "-AdbPath",
            str(adb),
            "-GradlePath",
            str(gradle),
            "-JavaHome",
            str(java_home),
            "-AndroidHome",
            str(android_home),
            "-CanonicalRepoRoot",
            str(repo),
            "-SkipBuild",
            *extra_args,
        ],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=30,
    )
