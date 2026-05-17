param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PuckyctlArgs
)

$ErrorActionPreference = "Stop"
$ScriptPath = Join-Path (Split-Path $PSScriptRoot -Parent) "puckyctl\puckyctl.py"

if (-not (Test-Path -LiteralPath $ScriptPath)) {
    throw "puckyctl.py not found: $ScriptPath"
}

python $ScriptPath @PuckyctlArgs
