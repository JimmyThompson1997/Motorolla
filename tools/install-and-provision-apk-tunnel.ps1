param(
    [string]$AdbPath = "$env:LOCALAPPDATA\Android\platform-tools\adb.exe",
    [string]$Serial,
    [string]$ApkPath = "$PSScriptRoot\..\pucky-apk\app\build\outputs\apk\debug\app-debug.apk",
    [Parameter(Mandatory = $true)]
    [string]$VmHost,
    [string]$VmUser = "pucky-adb",
    [int]$VmPort = 22,
    [string]$RemoteBindAddress = "127.0.0.1",
    [int]$RemoteAdbPort = 15555,
    [string]$PhoneAdbHost = "127.0.0.1",
    [int]$PhoneAdbPort = 5555,
    [switch]$UseTlsSni,
    [string]$TlsServerName,
    [Parameter(Mandatory = $true)]
    [string]$PrivateKeyPath,
    [string]$KnownHostsPath,
    [switch]$InsecureNoStrictHostKeyChecking,
    [string]$BrokerUrl,
    [string]$DeviceId,
    [string]$Token,
    [switch]$SkipInstall,
    [switch]$SkipTcpip,
    [switch]$NoStartTunnel,
    [string]$PackageName = "com.pucky.device.debug",
    [string]$ActivityName = "com.pucky.device.MainActivity"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-ExistingFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if (-not $resolved) {
        throw "$Label does not exist: $Path"
    }
    return $resolved.Path
}

function ConvertTo-JsonLiteral {
    param([AllowNull()][string]$Value)
    if ($null -eq $Value) {
        return "null"
    }
    $escaped = $Value.Replace("\", "\\").
        Replace("""", "\""").
        Replace("`r", "\r").
        Replace("`n", "\n").
        Replace("`t", "\t")
    return """$escaped"""
}

$adb = Resolve-ExistingFile -Path $AdbPath -Label "adb"
$privateKey = Resolve-ExistingFile -Path $PrivateKeyPath -Label "Private key"
if (-not $SkipInstall) {
    $apk = Resolve-ExistingFile -Path $ApkPath -Label "APK"
}
if (-not $InsecureNoStrictHostKeyChecking -and [string]::IsNullOrWhiteSpace($KnownHostsPath)) {
    throw "KnownHostsPath is required unless -InsecureNoStrictHostKeyChecking is set."
}
if (-not [string]::IsNullOrWhiteSpace($KnownHostsPath)) {
    $knownHosts = Resolve-ExistingFile -Path $KnownHostsPath -Label "known_hosts"
}

$serialArgs = @()
if (-not [string]::IsNullOrWhiteSpace($Serial)) {
    $serialArgs = @("-s", $Serial)
}

& $adb @serialArgs get-state | Out-Null

if (-not $SkipInstall) {
    Write-Host "Installing APK: $apk"
    & $adb @serialArgs install -r $apk
}

if (-not $SkipTcpip) {
    Write-Host "Enabling ADB TCP mode on phone port $PhoneAdbPort"
    & $adb @serialArgs tcpip $PhoneAdbPort
}

$privateKeyText = Get-Content -LiteralPath $privateKey -Raw
$tunnelParts = @(
    '"enabled":true',
    '"host":' + (ConvertTo-JsonLiteral $VmHost),
    '"user":' + (ConvertTo-JsonLiteral $VmUser),
    '"port":' + $VmPort,
    '"remote_bind_address":' + (ConvertTo-JsonLiteral $RemoteBindAddress),
    '"remote_adb_port":' + $RemoteAdbPort,
    '"phone_adb_host":' + (ConvertTo-JsonLiteral $PhoneAdbHost),
    '"phone_adb_port":' + $PhoneAdbPort,
    '"tls_enabled":' + $UseTlsSni.IsPresent.ToString().ToLowerInvariant(),
    '"strict_host_key_checking":' + (-not $InsecureNoStrictHostKeyChecking.IsPresent).ToString().ToLowerInvariant(),
    '"private_key":' + (ConvertTo-JsonLiteral $privateKeyText),
    '"start":' + (-not $NoStartTunnel.IsPresent).ToString().ToLowerInvariant()
)
if (-not [string]::IsNullOrWhiteSpace($TlsServerName)) {
    $tunnelParts += '"tls_server_name":' + (ConvertTo-JsonLiteral $TlsServerName)
}
if (-not [string]::IsNullOrWhiteSpace($KnownHostsPath)) {
    $knownHostsText = Get-Content -LiteralPath $knownHosts -Raw
    $tunnelParts += '"known_hosts":' + (ConvertTo-JsonLiteral $knownHostsText)
}

$provisioningParts = @(
    '"schema":"pucky.provisioning.v1"',
    '"tunnel":{' + ($tunnelParts -join ",") + '}'
)
if (-not [string]::IsNullOrWhiteSpace($BrokerUrl)) {
    $provisioningParts += '"broker_url":' + (ConvertTo-JsonLiteral $BrokerUrl)
}
if (-not [string]::IsNullOrWhiteSpace($DeviceId)) {
    $provisioningParts += '"device_id":' + (ConvertTo-JsonLiteral $DeviceId)
}
if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $provisioningParts += '"token":' + (ConvertTo-JsonLiteral $Token)
}

$json = "{" + ($provisioningParts -join ",") + "}"
$jsonBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
$component = "$PackageName/$ActivityName"

Write-Host "Injecting provisioning into $component"
& $adb @serialArgs shell "am start -n $component --es provisioning_json_base64 $jsonBase64 --ez connect false"

Write-Host ""
Write-Host "Provisioning sent. On the VM, after the tunnel connects, run:"
Write-Host "  adb connect 127.0.0.1:$RemoteAdbPort"
Write-Host ""
Write-Host "Check app-side tunnel status through the Pucky command bus with tunnel.status."
