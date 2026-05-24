from __future__ import annotations

from pathlib import Path


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
    assert "run-as $PackageName cp $deviceProvisioningFile files/$appProvisioningFile" in script
    assert "--es provisioning_file $appProvisioningFile --ez connect false" in script
    assert "without printing token values" in script
    assert "Write-Host $ProvisionToken" not in script
