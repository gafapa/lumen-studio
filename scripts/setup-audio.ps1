$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$taskToolsRoot=if($env:LUMEN_TOOLS_DIR){$env:LUMEN_TOOLS_DIR}else{Join-Path (Split-Path -Parent $PSScriptRoot) '.tools'}
$audioFolder=Join-Path $taskToolsRoot 'audio'
New-Item -ItemType Directory -Path $audioFolder -Force | Out-Null
foreach($packageName in @('naudio.core','naudio.wasapi')) {
    $url='https://api.nuget.org/v3-flatcontainer/'+$packageName+'/2.2.1/'+$packageName+'.2.2.1.nupkg'
    $registration=Invoke-RestMethod ('https://api.nuget.org/v3/registration5-gz-semver2/'+$packageName+'/2.2.1.json')
    $expected=(Invoke-RestMethod $registration.catalogEntry).packageHash
    $archive=Join-Path $audioFolder ($packageName+'.zip')
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archive
    $bytes=[IO.File]::ReadAllBytes($archive)
    $hash=[Security.Cryptography.SHA512]::Create().ComputeHash($bytes)
    if([Convert]::ToBase64String($hash) -ne $expected){throw 'NAudio no supera SHA-512.'}
    Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $audioFolder $packageName) -Force
}
'Captura WASAPI instalada localmente.'
