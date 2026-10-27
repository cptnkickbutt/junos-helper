param(
    [switch]$IncludeSavedDevices
)

$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot
$python = Join-Path $projectDir ".venv\Scripts\python.exe"
$vendorDatabase = Join-Path $projectDir ".venv\cache\mac-vendors.txt"
$localPycs = Join-Path $projectDir "build\JunosHelper\localpycs"

if (-not (Test-Path -LiteralPath $python)) {
    throw "The project virtual environment was not found. Create .venv and install requirements-build.txt first."
}

if (-not (Test-Path -LiteralPath $vendorDatabase)) {
    throw "The MAC vendor database was not found. Install requirements.txt in .venv before building."
}

if (Test-Path -LiteralPath $localPycs) {
    $localPycsItem = Get-Item -LiteralPath $localPycs -Force
    $localPycsItem.Attributes = $localPycsItem.Attributes -band (-bnot [IO.FileAttributes]::ReadOnly)
    Remove-Item -LiteralPath $localPycs -Recurse -Force
}

$pyInstallerArgs = @(
    "-m", "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onefile",
    "--name", "JunosHelper",
    "--version-file", "$(Join-Path $projectDir 'version_info.txt')",
    "--add-data", "$(Join-Path $projectDir 'index.html');.",
    "--add-data", "$(Join-Path $projectDir 'styles.css');.",
    "--add-data", "$(Join-Path $projectDir 'script.js');.",
    "--add-data", "$(Join-Path $projectDir 'live-watch.js');.",
    "--add-data", "$vendorDatabase;."
)

if ($IncludeSavedDevices) {
    $savedEnvironment = Join-Path $projectDir ".env"
    if (-not (Test-Path -LiteralPath $savedEnvironment)) {
        throw "-IncludeSavedDevices was requested, but .env does not exist."
    }
    Write-Warning "Embedding .env makes its plaintext credentials extractable by anyone who receives the executable."
    $pyInstallerArgs += @("--add-data", "$savedEnvironment;.")
}

$pyInstallerArgs += (Join-Path $projectDir "app.py")
& $python @pyInstallerArgs

if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE."
}

Write-Host "Built: $(Join-Path $projectDir 'dist\JunosHelper.exe')"
