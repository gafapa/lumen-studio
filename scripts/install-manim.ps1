# Instala Manim Community para Lumen en .tools/manim-lib usando el Python portable (sin tocar las dependencias de Kokoro).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.tools\python\python.exe'
if (-not (Test-Path $python)) { throw 'Falta el Python portable: ejecuta antes scripts\bootstrap.ps1.' }
& $python -m pip install setuptools wheel
& $python -m pip install --target (Join-Path $root '.tools\manim-lib') --prefer-binary 'manim==0.21.0'
if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar Manim.' }
Write-Host 'Manim instalado en .tools\manim-lib.'
