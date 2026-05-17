param(
    [string]$AdbPath = "$env:LOCALAPPDATA\Android\platform-tools\adb.exe",
    [string]$Serial,
    [string]$ApkPath = "$PSScriptRoot\..\pucky-apk\app\build\outputs\apk\debug\app-debug.apk",
    [string]$VmHost = "jt-project-vox-codex.fly.dev",
    [string]$VmUser = "pucky-adb",
    [int]$VmPort = 2222,
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
    Write-Host "Waiting for the phone to return after adbd restarts"
    Start-Sleep -Seconds 2
    & $adb @serialArgs wait-for-device
}

$privateKeyText = [System.IO.File]::ReadAllText($privateKey)
$tunnel = [ordered]@{
    enabled = $true
    host = $VmHost
    user = $VmUser
    port = $VmPort
    remote_bind_address = $RemoteBindAddress
    remote_adb_port = $RemoteAdbPort
    phone_adb_host = $PhoneAdbHost
    phone_adb_port = $PhoneAdbPort
    tls_enabled = $UseTlsSni.IsPresent
    strict_host_key_checking = -not $InsecureNoStrictHostKeyChecking.IsPresent
    private_key = $privateKeyText
    start = -not $NoStartTunnel.IsPresent
}
if (-not [string]::IsNullOrWhiteSpace($TlsServerName)) {
    $tunnel["tls_server_name"] = $TlsServerName
}
if (-not [string]::IsNullOrWhiteSpace($KnownHostsPath)) {
    $knownHostsText = [System.IO.File]::ReadAllText($knownHosts)
    $tunnel["known_hosts"] = $knownHostsText
}

$provisioning = [ordered]@{
    schema = "pucky.provisioning.v1"
    tunnel = $tunnel
}
if (-not [string]::IsNullOrWhiteSpace($BrokerUrl)) {
    $provisioning["broker_url"] = $BrokerUrl
}
if (-not [string]::IsNullOrWhiteSpace($DeviceId)) {
    $provisioning["device_id"] = $DeviceId
}
if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $provisioning["token"] = $Token
}

$json = $provisioning | ConvertTo-Json -Depth 6 -Compress
$component = "$PackageName/$ActivityName"
$localProvisioningFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "pucky_provisioning.json")
$deviceProvisioningFile = "/data/local/tmp/pucky_provisioning.json"
$appProvisioningFile = "pucky_provisioning.json"
[System.IO.File]::WriteAllText($localProvisioningFile, $json, [Text.Encoding]::UTF8)

Write-Host "Pushing provisioning into app-private storage"
& $adb @serialArgs push $localProvisioningFile $deviceProvisioningFile | Out-Null
& $adb @serialArgs shell "run-as $PackageName cp $deviceProvisioningFile files/$appProvisioningFile"
& $adb @serialArgs shell "rm -f $deviceProvisioningFile"

Write-Host "Injecting provisioning into $component"
& $adb @serialArgs shell "am start -n $component --es provisioning_file $appProvisioningFile --ez connect false"

Write-Host ""
Write-Host "Provisioning sent. On the VM, after the tunnel connects, run:"
Write-Host "  adb connect 127.0.0.1:$RemoteAdbPort"
Write-Host ""
Write-Host "Check app-side tunnel status through the Pucky command bus with tunnel.status."
