param(
    [string]$AdbPath = "$env:LOCALAPPDATA\Android\platform-tools\adb.exe",
    [string]$Serial = "",
    [Parameter(Mandatory = $true)]
    [string]$VmHost,
    [string]$VmUser = "pucky-adb",
    [int]$VmPort = 22,
    [int]$RemoteAdbPort = 15555,
    [int]$PhoneAdbPort = 5555,
    [Parameter(Mandatory = $true)]
    [string]$AndroidSshClientPath,
    [Parameter(Mandatory = $true)]
    [string]$PrivateKeyPath,
    [switch]$NoStrictHostKeyChecking,
    [switch]$SkipTcpip,
    [switch]$StopExisting
)

$ErrorActionPreference = "Stop"

function Invoke-Adb {
    param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $Args)
    if ($Serial.Trim()) {
        & $AdbPath -s $Serial @Args
    } else {
        & $AdbPath @Args
    }
}

if (!(Test-Path -LiteralPath $AdbPath)) {
    throw "adb not found at $AdbPath"
}
if (!(Test-Path -LiteralPath $AndroidSshClientPath)) {
    throw "Android SSH client not found at $AndroidSshClientPath"
}
if (!(Test-Path -LiteralPath $PrivateKeyPath)) {
    throw "Private key not found at $PrivateKeyPath"
}

$remoteBind = "127.0.0.1:$RemoteAdbPort"
$localTarget = "127.0.0.1:$PhoneAdbPort"
$remoteDir = "/data/local/tmp/pucky-tunnel"
$remoteClient = "$remoteDir/pucky-ssh"
$remoteKey = "$remoteDir/pucky_vm_key"
$remoteLog = "$remoteDir/pucky-tunnel.log"
$remotePid = "$remoteDir/pucky-tunnel.pid"

Write-Host "Checking ADB device..."
Invoke-Adb devices -l

Write-Host "Preparing phone tunnel directory..."
Invoke-Adb shell "mkdir -p $remoteDir && chmod 700 $remoteDir"

Write-Host "Pushing tunnel client and key..."
Invoke-Adb push $AndroidSshClientPath $remoteClient
Invoke-Adb push $PrivateKeyPath $remoteKey
Invoke-Adb shell "chmod 700 $remoteClient && chmod 600 $remoteKey"

if ($StopExisting) {
    Write-Host "Stopping any previous pucky tunnel process..."
    Invoke-Adb shell "if [ -f $remotePid ]; then kill `$(cat $remotePid) 2>/dev/null || true; rm -f $remotePid; fi"
}

if (!$SkipTcpip) {
    Write-Host "Enabling ADB TCP on phone port $PhoneAdbPort..."
    Invoke-Adb tcpip $PhoneAdbPort
    Start-Sleep -Seconds 2
}

$sshOptions = @(
    "-N",
    "-i", $remoteKey,
    "-p", "$VmPort",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    "-R", "${remoteBind}:${localTarget}",
    "$VmUser@$VmHost"
)

if ($NoStrictHostKeyChecking) {
    $sshOptions = @(
        "-N",
        "-i", $remoteKey,
        "-p", "$VmPort",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "-o", "LogLevel=ERROR",
        "-o", "ServerAliveInterval=30",
        "-o", "ServerAliveCountMax=3",
        "-o", "ExitOnForwardFailure=yes",
        "-R", "${remoteBind}:${localTarget}",
        "$VmUser@$VmHost"
    )
}

$quotedArgs = ($sshOptions | ForEach-Object { "'" + ($_ -replace "'", "'\''") + "'" }) -join " "
$startCommand = "cd $remoteDir; nohup $remoteClient $quotedArgs > $remoteLog 2>&1 & echo `$! > $remotePid; sleep 1; cat $remotePid"

Write-Host "Starting reverse tunnel phone -> VM..."
Invoke-Adb shell $startCommand

Write-Host ""
Write-Host "Tunnel requested:"
Write-Host "  VM 127.0.0.1:$RemoteAdbPort -> phone 127.0.0.1:$PhoneAdbPort"
Write-Host ""
Write-Host "On the VM, run:"
Write-Host "  adb connect 127.0.0.1:$RemoteAdbPort"
Write-Host ""
Write-Host "To inspect phone-side tunnel log:"
Write-Host "  adb shell cat $remoteLog"

