param(
    [string]$Serial = "ZY22JZ26LK",
    [string]$AdbPath = "C:\Users\jimmy\Desktop\Android\tools\android-sdk\platform-tools\adb.exe",
    [string]$GradlePath = "C:\Users\jimmy\Desktop\Android\tools\gradle-8.10.2\bin\gradle.bat",
    [string]$JavaHome = "C:\Users\jimmy\Desktop\Android\tools\jdk-17",
    [string]$AndroidHome = "C:\Users\jimmy\Desktop\Android\tools\android-sdk",
    [string]$ApkProjectDir = "$PSScriptRoot\..\pucky-apk",
    [string]$PackageName = "com.pucky.device.debug",
    [string]$CanonicalRepoRoot = "C:\Users\jimmy\Desktop\Motorolla",
    [string]$ExpectedBranch = "codex/slim-webview-cover-ui",
    [int]$ExpectedVersionCode = -1,
    [string]$ExpectedVersionName = "",
    [switch]$AllowDirty,
    [switch]$AllowUnpushed,
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

function Normalize-PathForCompare {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path).TrimEnd("\").ToLowerInvariant()
}

$repoRoot = Resolve-ExistingPath -Path (Join-Path $PSScriptRoot "..") -Label "Motorolla repo root"
$canonicalProject = Resolve-ExistingPath -Path (Join-Path $repoRoot "pucky-apk") -Label "canonical APK project"
$requestedProject = Resolve-ExistingPath -Path $ApkProjectDir -Label "APK project"
$expectedRepoRoot = Resolve-ExistingPath -Path $CanonicalRepoRoot -Label "canonical repo root"

if ($requestedProject -ne $canonicalProject) {
    throw "Refusing non-canonical APK project: $requestedProject. Use $canonicalProject."
}
if ((Normalize-PathForCompare $repoRoot) -ne (Normalize-PathForCompare $expectedRepoRoot)) {
    throw "Refusing non-canonical repo root: $repoRoot. Use $expectedRepoRoot."
}
if ($requestedProject -like "*\Desktop\Android\pucky-apk*") {
    throw "Refusing deprecated Android APK tree: $requestedProject"
}

function Invoke-Git {
    param([Parameter(Mandatory = $true)][string[]]$GitArgs)
    $output = & git -C $repoRoot @GitArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "git $($GitArgs -join ' ') failed:`n$($output -join "`n")"
    }
    return @($output)
}

function Require-CleanCanonicalGit {
    $branch = ((Invoke-Git @("branch", "--show-current")) -join "").Trim()
    $head = ((Invoke-Git @("rev-parse", "HEAD")) -join "").Trim()
    $upstream = ((Invoke-Git @("rev-parse", "@{u}")) -join "").Trim()
    $status = @(Invoke-Git @("status", "--porcelain"))
    if ($branch -ne $ExpectedBranch) {
        throw "Refusing branch '$branch'. Expected canonical live branch '$ExpectedBranch'."
    }
    if ($status.Count -gt 0 -and -not $AllowDirty) {
        throw "Refusing dirty canonical worktree. Commit/stash first or rerun with -AllowDirty:`n$($status -join "`n")"
    }
    if ($head -ne $upstream -and -not $AllowUnpushed) {
        throw "Refusing unpushed canonical HEAD. local=$head upstream=$upstream. Push first or rerun with -AllowUnpushed."
    }
    return @{
        Branch = $branch
        Head = $head
        Upstream = $upstream
        Dirty = $status.Count -gt 0
    }
}

function Require-GradleVersion {
    $gradleFile = Join-Path $canonicalProject "app\build.gradle"
    $text = Get-Content -LiteralPath $gradleFile -Raw
    $codeMatch = [regex]::Match($text, "versionCode\s+(\d+)")
    $nameMatch = [regex]::Match($text, "versionName\s+`"([^`"]+)`"")
    if (-not $codeMatch.Success -or -not $nameMatch.Success) {
        throw "Could not parse versionCode/versionName from $gradleFile"
    }
    $actualCode = [int]$codeMatch.Groups[1].Value
    $actualName = "$($nameMatch.Groups[1].Value)-debug"
    if ($script:ExpectedVersionCode -lt 0) {
        $script:ExpectedVersionCode = $actualCode
    }
    if ([string]::IsNullOrWhiteSpace($script:ExpectedVersionName)) {
        $script:ExpectedVersionName = $actualName
    }
    if ($actualCode -ne $script:ExpectedVersionCode) {
        throw "Gradle versionCode=$actualCode does not match expected $($script:ExpectedVersionCode)"
    }
    if ($actualName -ne $script:ExpectedVersionName) {
        throw "Gradle debug versionName=$actualName does not match expected $($script:ExpectedVersionName)"
    }
}

$adb = Resolve-ExistingPath -Path $AdbPath -Label "adb"
$gradle = Resolve-ExistingPath -Path $GradlePath -Label "Gradle"
$java = Resolve-ExistingPath -Path $JavaHome -Label "JAVA_HOME"
$android = Resolve-ExistingPath -Path $AndroidHome -Label "ANDROID_HOME"
$apk = Join-Path $canonicalProject "app\build\outputs\apk\debug\app-debug.apk"
$gitState = Require-CleanCanonicalGit
Require-GradleVersion

Write-Host "Canonical repo: $repoRoot"
Write-Host "APK project:    $canonicalProject"
Write-Host "Branch:         $($gitState.Branch)"
Write-Host "HEAD:           $($gitState.Head)"
Write-Host "Upstream:       $($gitState.Upstream)"
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
