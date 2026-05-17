param(
    [string]$Serial = "ZY22JZ26LK",
    [string]$AdbPath = "C:\Users\jimmy\Desktop\Android\tools\android-sdk\platform-tools\adb.exe",
    [string]$GradlePath = "C:\Users\jimmy\Desktop\Android\tools\gradle-8.10.2\bin\gradle.bat",
    [string]$JavaHome = "C:\Users\jimmy\Desktop\Android\tools\jdk-17",
    [string]$AndroidHome = "C:\Users\jimmy\Desktop\Android\tools\android-sdk",
    [string]$ApkProjectDir = "$PSScriptRoot\..\pucky-apk",
    [string]$PackageName = "com.pucky.device.debug",
    [int]$ExpectedVersionCode = 9,
    [string]$ExpectedVersionName = "0.2.8-wireless-access-choice-debug",
    [switch]$SkipBuild,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-ExistingPath {
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

$repoRoot = Resolve-ExistingPath -Path (Join-Path $PSScriptRoot "..") -Label "Motorolla repo root"
$canonicalProject = Resolve-ExistingPath -Path (Join-Path $repoRoot "pucky-apk") -Label "canonical APK project"
$requestedProject = Resolve-ExistingPath -Path $ApkProjectDir -Label "APK project"

if ($requestedProject -ne $canonicalProject) {
    throw "Refusing non-canonical APK project: $requestedProject. Use $canonicalProject."
}
if ($requestedProject -like "*\Desktop\Android\pucky-apk*") {
    throw "Refusing deprecated Android APK tree: $requestedProject"
}

$adb = Resolve-ExistingPath -Path $AdbPath -Label "adb"
$gradle = Resolve-ExistingPath -Path $GradlePath -Label "Gradle"
$java = Resolve-ExistingPath -Path $JavaHome -Label "JAVA_HOME"
$android = Resolve-ExistingPath -Path $AndroidHome -Label "ANDROID_HOME"
$apk = Join-Path $canonicalProject "app\build\outputs\apk\debug\app-debug.apk"

Write-Host "Canonical repo: $repoRoot"
Write-Host "APK project:    $canonicalProject"
Write-Host "ADB:            $adb"
Write-Host "Gradle:         $gradle"
Write-Host "Device serial:  $Serial"
Write-Host "Expected:       versionCode=$ExpectedVersionCode versionName=$ExpectedVersionName"

if ($DryRun) {
    Write-Host "Dry run complete. No build or install performed."
    exit 0
}

$env:JAVA_HOME = $java
$env:ANDROID_HOME = $android

if (-not $SkipBuild) {
    Push-Location $canonicalProject
    try {
        & $gradle ":app:assembleDebug"
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $apk)) {
    throw "APK was not found after build: $apk"
}

& $adb -s $Serial install -r $apk

$package = & $adb -s $Serial shell dumpsys package $PackageName
$packageText = $package -join "`n"
if ($packageText -notmatch "versionCode=$ExpectedVersionCode\b") {
    throw "Installed package did not report expected versionCode=$ExpectedVersionCode"
}
if ($packageText -notmatch [Regex]::Escape("versionName=$ExpectedVersionName")) {
    throw "Installed package did not report expected versionName=$ExpectedVersionName"
}

Write-Host "Canonical APK installed and verified."
