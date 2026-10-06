$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
# Voz local Kokoro-82M para HyperFrames: Python 3.12 portable en .tools/python con kokoro-onnx.
# No modifica el Python del sistema ni el PATH.
$workspace=Split-Path -Parent $PSScriptRoot
$toolsRoot=if($env:LUMEN_TOOLS_DIR){$env:LUMEN_TOOLS_DIR}else{Join-Path $workspace '.tools'}
$pythonFolder=Join-Path $toolsRoot 'python'
New-Item -ItemType Directory -Path $pythonFolder -Force | Out-Null
$zip=Join-Path $toolsRoot 'python-3.12.10-embed-amd64.zip'
$expected='4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
if(-not ((Test-Path -LiteralPath $zip) -and (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expected)){
    Invoke-WebRequest -UseBasicParsing -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile ($zip+'.download')
    if((Get-FileHash -LiteralPath ($zip+'.download') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'La descarga de Python no supera SHA-256.'}
    Move-Item -LiteralPath ($zip+'.download') -Destination $zip -Force
}
$python=Join-Path $pythonFolder 'python.exe'
if(-not (Test-Path -LiteralPath $python)){Expand-Archive -LiteralPath $zip -DestinationPath $pythonFolder -Force}
# El Python embebido ignora site-packages hasta que se habilita "import site".
$pth=Get-ChildItem -LiteralPath $pythonFolder -Filter 'python*._pth' | Select-Object -First 1
if($pth){$content=Get-Content -LiteralPath $pth.FullName;if($content -contains '#import site'){($content -replace '^#import site$','import site') | Set-Content -LiteralPath $pth.FullName -Encoding ascii}}
if(-not (Test-Path -LiteralPath (Join-Path $pythonFolder 'Scripts\pip.exe'))){
    $getPip=Join-Path $toolsRoot 'get-pip.py'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip
    & $python $getPip --no-warn-script-location
    if($LASTEXITCODE -ne 0){throw 'No se ha podido instalar pip.'}
}
& $python -m pip install --disable-pip-version-check --no-warn-script-location 'kokoro-onnx>=0.4,<1' 'soundfile>=0.12'
if($LASTEXITCODE -ne 0){throw 'No se han podido instalar kokoro-onnx y soundfile.'}
& $python -c "import kokoro_onnx, soundfile; print('ok')"
if($LASTEXITCODE -ne 0){throw 'Kokoro no se puede importar.'}
[IO.File]::WriteAllText((Join-Path $pythonFolder 'python-path.txt'),$python)
'Voz Kokoro local preparada. El modelo se descarga la primera vez que se genera una voz.'
