$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = Join-Path $workspaceRoot '.tools'
New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
$releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
$release = $releases | Where-Object { $_.lts -and $_.version.StartsWith('v24.') } | Select-Object -First 1
if (-not $release) { throw 'No se encuentra Node 24 LTS.' }
$archiveName = "node-$($release.version)-win-x64.zip"
$archivePath = Join-Path $toolsRoot $archiveName
$baseUrl = "https://nodejs.org/dist/$($release.version)"
Write-Host "Preparando Node $($release.version) dentro del proyecto..."
Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/$archiveName" -OutFile $archivePath
$checksums = (Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/SHASUMS256.txt").Content
$checksumLine = $checksums -split "`n" | Where-Object { $_.Trim().EndsWith("  $archiveName") } | Select-Object -First 1
$expected = ($checksumLine.Trim() -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if (-not $expected -or $actual -ne $expected) { throw 'La comprobacion SHA256 de Node ha fallado.' }
Expand-Archive -LiteralPath $archivePath -DestinationPath $toolsRoot -Force
$nodeFolder = Join-Path $toolsRoot "node-$($release.version)-win-x64"
[IO.File]::WriteAllText((Join-Path $toolsRoot 'node-path.txt'), $nodeFolder)
Write-Host 'Node preparado sin cambiar la configuracion del sistema.'
