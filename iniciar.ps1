param([switch]$Produccion)
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand -and [int]((& $nodeCommand.Source --version).TrimStart('v').Split('.')[0]) -ge 24) {
    $nodeExecutable = $nodeCommand.Source
    $nodeFolder = Split-Path -Parent $nodeExecutable
} else {
    $nodeMarker = Join-Path $PSScriptRoot '.tools\node-path.txt'
    if (-not (Test-Path -LiteralPath $nodeMarker)) { & (Join-Path $PSScriptRoot 'scripts\bootstrap.ps1') }
    $nodeFolder = [IO.File]::ReadAllText($nodeMarker).Trim()
    $nodeExecutable = Join-Path $nodeFolder 'node.exe'
    if (-not (Test-Path -LiteralPath $nodeExecutable)) { & (Join-Path $PSScriptRoot 'scripts\bootstrap.ps1'); $nodeFolder = [IO.File]::ReadAllText($nodeMarker).Trim(); $nodeExecutable = Join-Path $nodeFolder 'node.exe' }
}
$env:PATH = "$nodeFolder;$env:PATH"
Push-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'skills\vendor\hyperframes'))) { & $nodeExecutable 'scripts\update-vendor-skills.mjs' }
try {
    if (-not (Test-Path -LiteralPath 'node_modules\vite')) {
        & $nodeExecutable (Join-Path $nodeFolder 'node_modules\npm\bin\npm-cli.js') ci
        if ($LASTEXITCODE -ne 0) { throw 'No se han podido instalar las dependencias.' }
    }
    if ($Produccion) {
        & $nodeExecutable (Join-Path $nodeFolder 'node_modules\npm\bin\npm-cli.js') run build
        if ($LASTEXITCODE -ne 0) { throw 'La compilacion ha fallado.' }
        & $nodeExecutable 'server\index.mjs' --production
    } else {
        & $nodeExecutable 'scripts\dev.mjs'
    }
} finally { Pop-Location }
