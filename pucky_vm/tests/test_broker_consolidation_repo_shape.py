from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read_text(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


def test_remote_adb_tunnel_artifacts_are_removed():
    deleted_paths = [
        "docs/usb-bootstrap-reverse-tunnel.md",
        "docs/vox-remote-adb-runbook.md",
        "tools/bootstrap-android-adb-reverse-tunnel.ps1",
        "tools/install-and-provision-apk-tunnel.ps1",
        "tools/new-pucky-adb-tunnel-key.ps1",
        "pucky-apk/fly-broker/deploy-pucky-broker.ps1",
        "pucky-bridge/README.md",
        "pucky-bridge/fly/pucky-broker",
        "pucky-bridge/fly/puckyctl",
        "pucky-bridge/fly/start-pucky-bridge-vm.sh",
        "pucky-bridge/termux/pucky-command",
        "pucky-bridge/termux/pucky-status",
        "pucky-bridge/termux/pucky-tls-proxy",
        "pucky-bridge/termux/pucky-tunnel",
    ]
    for relative_path in deleted_paths:
        assert not (ROOT / relative_path).exists(), relative_path


def test_current_docs_describe_consolidated_pucky_service():
    readme = read_text("README.md")
    install = read_text("docs/fresh-user-install-end-state.md")
    requirements = read_text("docs/vm-installation-package-requirements.md")

    for text in (readme, install, requirements):
        assert "pucky-bridge-dev-jt323" not in text
        assert "outbound SSH reverse tunnel" not in text

    assert "wss://pucky.fly.dev/v1/devices/" in readme
    assert "pucky.fly.dev" in install
    assert "/ui/pucky/latest/" in requirements
