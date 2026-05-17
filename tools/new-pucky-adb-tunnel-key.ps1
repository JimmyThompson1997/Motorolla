param(
    [string]$OutputDir = "$PSScriptRoot\..\.secrets\pucky-adb",
    [string]$KeyName = "pucky_adb_rsa",
    [ValidateSet("ecdsa", "rsa", "ed25519")]
    [string]$KeyType = "ecdsa",
    [int]$RsaBits = 3072,
    [string]$VmHost,
    [int]$VmPort = 22,
    [switch]$Overwrite
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$sshKeygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue
if (-not $sshKeygen) {
    throw "ssh-keygen was not found on PATH. Install Windows OpenSSH Client or run this on the VM."
}

$resolvedOutputDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDir)
New-Item -ItemType Directory -Force -Path $resolvedOutputDir | Out-Null

$privateKey = Join-Path $resolvedOutputDir $KeyName
$publicKey = "$privateKey.pub"
$knownHosts = Join-Path $resolvedOutputDir "known_hosts"

if ((Test-Path -LiteralPath $privateKey) -and -not $Overwrite) {
    throw "Key already exists: $privateKey. Pass -Overwrite to replace it."
}
if ($Overwrite) {
    Remove-Item -LiteralPath $privateKey, $publicKey -Force -ErrorAction SilentlyContinue
}

$comment = "pucky-adb-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssZ'))"
if ($KeyType -eq "ecdsa") {
    $sshKeygenArgs = @("-q", "-t", "ecdsa", "-b", "256", "-m", "PEM", "-f", $privateKey, "-N", '""', "-C", $comment)
} elseif ($KeyType -eq "rsa") {
    $sshKeygenArgs = @("-q", "-t", "rsa", "-b", $RsaBits, "-m", "PEM", "-f", $privateKey, "-N", '""', "-C", $comment)
} else {
    $sshKeygenArgs = @("-q", "-t", "ed25519", "-f", $privateKey, "-N", '""', "-C", $comment)
}
& $sshKeygen.Source @sshKeygenArgs | Out-Host

$publicKeyText = Get-Content -LiteralPath $publicKey -Raw
$publicKeyB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($publicKeyText))

Write-Host ""
Write-Host "Private key for phone provisioning:"
Write-Host "  $privateKey"
Write-Host ""
Write-Host "Set this VM secret/env var for the pucky-adb user:"
Write-Host "  PUCKY_ADB_AUTHORIZED_KEYS_B64=$publicKeyB64"

if (-not [string]::IsNullOrWhiteSpace($VmHost)) {
    $sshKeyscan = Get-Command ssh-keyscan -ErrorAction SilentlyContinue
    if (-not $sshKeyscan) {
        Write-Warning "ssh-keyscan was not found on PATH; skipping known_hosts capture."
    } else {
        & $sshKeyscan.Source -p $VmPort $VmHost 2>$null | Set-Content -LiteralPath $knownHosts -NoNewline
        Write-Host ""
        Write-Host "Known hosts for APK provisioning:"
        Write-Host "  $knownHosts"
    }
}
