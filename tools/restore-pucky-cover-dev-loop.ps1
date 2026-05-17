param(
  [string]$AdbPath = "C:\Users\jimmy\Desktop\Android\tools\android-sdk\platform-tools\adb.exe",
  [string]$Serial = "ZY22JZ26LK",
  [int]$Port = 8788,
  [string]$Package = "com.pucky.device.debug",
  [string]$Activity = "com.pucky.device.MainActivity",
  [int]$Display = 1,
  [string]$ScreenshotDisplayId = "4627039422300187651",
  [switch]$NoRestart,
  [string]$EvidenceDir = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $AdbPath)) {
  throw "ADB not found at $AdbPath"
}

$homeUrl = "http://127.0.0.1:$Port/pucky-home"
$version = "<unknown>"
try {
  $homeResponse = Invoke-WebRequest -UseBasicParsing -Uri $homeUrl -TimeoutSec 10
  $match = [regex]::Match($homeResponse.Content, "authoritative-live-[0-9]+|cover-apps-[0-9]+")
  if ($match.Success) {
    $version = $match.Value
  }
  Write-Host "Local Pucky UI OK: $homeUrl ($version)"
} catch {
  throw "Local Pucky UI is not reachable at $homeUrl. Start Project Vox before restoring the phone bridge. $($_.Exception.Message)"
}

Write-Host "Restoring ADB reverse tcp:$Port -> tcp:$Port for $Serial"
& $AdbPath -s $Serial reverse "tcp:$Port" "tcp:$Port" | Out-Host
$reverseList = & $AdbPath -s $Serial reverse --list
$reverseList | Out-Host
if ($reverseList -notmatch "tcp:$Port\s+tcp:$Port") {
  throw "ADB reverse did not appear in adb reverse --list"
}

if (-not $NoRestart) {
  Write-Host "Restarting $Package on display $Display"
  & $AdbPath -s $Serial shell am force-stop $Package | Out-Host
  Start-Sleep -Milliseconds 700
  & $AdbPath -s $Serial shell am start --display $Display `
    -a android.intent.action.MAIN `
    -c android.intent.category.SECONDARY_HOME `
    -n "$Package/$Activity" | Out-Host
  Start-Sleep -Seconds 3
}

if ($EvidenceDir -ne "") {
  New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
  $screenshotPath = Join-Path $EvidenceDir "pucky-cover-after-dev-loop-restore.png"
  & $AdbPath -s $Serial shell screencap -p -d $ScreenshotDisplayId /sdcard/pucky-cover-after-dev-loop-restore.png | Out-Host
  & $AdbPath -s $Serial pull /sdcard/pucky-cover-after-dev-loop-restore.png $screenshotPath | Out-Host
  Write-Host "Screenshot: $screenshotPath"
}

Write-Host "Pucky cover dev loop restored ($version)."
