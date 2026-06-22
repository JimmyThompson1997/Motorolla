from __future__ import annotations

from pathlib import Path

from tools import dev as tools_dev


def test_proof_env_loads_repo_dotenv_without_overwriting_existing_process_env(monkeypatch, tmp_path: Path) -> None:
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    (repo_root / ".env").write_text(
        "PUCKY_API_TOKEN=dotenv-api-token\nPUCKY_OPERATOR_TOKEN=dotenv-operator-token\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(tools_dev, "ROOT", repo_root)
    monkeypatch.setattr(tools_dev, "ensure_cover_playwright_shims", lambda: None)
    monkeypatch.delenv("PUCKY_API_TOKEN", raising=False)
    monkeypatch.setenv("PUCKY_OPERATOR_TOKEN", "shell-operator-token")

    env = tools_dev.proof_env()

    assert env["PUCKY_API_TOKEN"] == "dotenv-api-token"
    assert env["PUCKY_OPERATOR_TOKEN"] == "shell-operator-token"


def test_build_task_command_deploy_vm_uses_canonical_root_and_explicit_flyctl(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(tools_dev, "ROOT", tmp_path)
    monkeypatch.setattr(tools_dev, "require_binary", lambda name: f"/mock/bin/{name}")

    command = tools_dev.build_task_command("deploy-vm")

    assert command[:4] == [tools_dev.PYTHON, "tools/sync_pucky_vm_official.py", "--app", "pucky"]
    assert "--canonical-root" in command
    assert str(tmp_path) in command
    assert "--flyctl" in command
    assert "/mock/bin/flyctl" in command


def test_release_hosted_web_task_is_registered_and_wires_release_lane() -> None:
    source = Path(tools_dev.__file__).read_text(encoding="utf-8")

    assert '"release-hosted-web": "Run the hosted-web release lane: parser checks, targeted pytest, VM sync deploy, manifest verification, and live proof."' in source
    assert "HOSTED_RELEASE_TEST_PATHS = [" in source
    assert "HOSTED_RELEASE_NODE_CHECKS = [" in source
    assert "HOSTED_RELEASE_PROOF_SCRIPTS = [" in source
    assert '"tools/proofs/cover/cover_live_user_session_playwright.mjs"' in source
    assert "def run_release_hosted_web(extra_args: list[str]) -> int:" in source
    assert "verify_live_manifest_matches_head()" in source
    assert "return run_node_proofs(node_binary, scripts, env=proof_env())" in source
    assert 'if args.task == "release-hosted-web":' in source


def test_desktop_audio_proof_tasks_are_registered_and_dispatched() -> None:
    source = Path(tools_dev.__file__).read_text(encoding="utf-8")

    assert '"proof-local-desktop-audio": "Run the local desktop audio capture/upload proof with the Swift probe."' in source
    assert '"proof-live-desktop-audio": "Run the live desktop audio capture/upload proof against the hosted VM."' in source
    assert "def run_desktop_audio_proof(target: str, extra_args: list[str]) -> int:" in source
    assert 'if args.task == "proof-local-desktop-audio":' in source
    assert 'if args.task == "proof-live-desktop-audio":' in source
    assert '"desktop_audio_probe/proofs/desktop_audio_probe_proof.py"' in source
