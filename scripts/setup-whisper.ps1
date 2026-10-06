$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$workspace=Split-Path -Parent $PSScriptRoot
$taskToolsRoot=if($env:LUMEN_TOOLS_DIR){$env:LUMEN_TOOLS_DIR}else{Join-Path $workspace '.tools'}
$toolsFolder=Join-Path $taskToolsRoot 'whisper'
New-Item -ItemType Directory -Path $toolsFolder -Force | Out-Null
function Download-Verified($url,$destination,$expected) {
    if((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expected){return}
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile ($destination+'.download')
    if((Get-FileHash -LiteralPath ($destination+'.download') -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'La descarga no supera SHA-256.'}
    Move-Item -LiteralPath ($destination+'.download') -Destination $destination -Force
}
Download-Verified 'https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip' (Join-Path $toolsFolder 'binaries.zip') 'f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c'
Expand-Archive -LiteralPath (Join-Path $toolsFolder 'binaries.zip') -DestinationPath $toolsFolder -Force
Download-Verified 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin' (Join-Path $toolsFolder 'ggml-tiny.bin') 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21'
$whisperCli=Get-ChildItem -LiteralPath $toolsFolder -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
if(-not $whisperCli){throw 'No se ha encontrado whisper-cli.exe.'}
[IO.File]::WriteAllText((Join-Path $toolsFolder 'cli-path.txt'),$whisperCli.FullName)
'Whisper local instalado y verificado. No requiere una API de pago.'
