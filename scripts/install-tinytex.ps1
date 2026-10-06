# Instala TinyTeX (LaTeX mínimo) en .tools/tinytex con los paquetes que necesita Manim para MathTex y Tex.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root '.tools'
$target = Join-Path $tools 'tinytex'
$version = 'v2026.10'
$installer = Join-Path $tools "TinyTeX-1-windows-$version.exe"
if (-not (Test-Path $installer)) {
  Write-Host "Descargando TinyTeX $version..."
  Invoke-WebRequest "https://github.com/rstudio/tinytex-releases/releases/download/$version/TinyTeX-1-windows-$version.exe" -OutFile $installer -UseBasicParsing
}
if (-not (Test-Path (Join-Path $target 'bin'))) {
  Write-Host 'Descomprimiendo...'
  New-Item -ItemType Directory -Force $target | Out-Null
  & $installer -y "-o$target" | Out-Null
  # El autoextraíble crea una subcarpeta TinyTeX: se sube un nivel.
  $inner = Join-Path $target 'TinyTeX'
  if (Test-Path $inner) { Get-ChildItem $inner | Move-Item -Destination $target -Force; Remove-Item $inner -Recurse -Force }
}
$bin = Get-ChildItem (Join-Path $target 'bin') -Directory | Select-Object -First 1
$tlmgr = Join-Path $bin.FullName 'tlmgr.bat'
Write-Host 'Instalando paquetes para Manim...'
& $tlmgr install standalone preview doublestroke relsize fundus-calligra wasysym physics dvisvgm rsfs wasy cm-super jknapltx everysel setspace tipa mathastext ragged2e microtype babel-english xcolor amsfonts
if ($LASTEXITCODE -ne 0) { throw 'tlmgr no pudo instalar los paquetes.' }
Write-Host "TinyTeX instalado en $target"
