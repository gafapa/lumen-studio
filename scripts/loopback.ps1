param([Parameter(Mandatory=$true)][string]$Output,[Parameter(Mandatory=$true)][string]$StopFile,[int]$Seconds=300)
$ErrorActionPreference='Stop'
$audioFolder=if($env:LUMEN_TOOLS_DIR){Join-Path $env:LUMEN_TOOLS_DIR 'audio'}else{Join-Path (Split-Path -Parent $PSScriptRoot) '.tools\audio'}
$core=Join-Path $audioFolder 'naudio.core\lib\netstandard2.0\NAudio.Core.dll'
$wasapi=Join-Path $audioFolder 'naudio.wasapi\lib\netstandard2.0\NAudio.Wasapi.dll'
if(-not (Test-Path -LiteralPath $wasapi)){throw 'Instala captura de audio desde Conexiones.'}
[Reflection.Assembly]::LoadFrom($core) | Out-Null
[Reflection.Assembly]::LoadFrom($wasapi) | Out-Null
$standard=Get-ChildItem -LiteralPath (Join-Path $env:WINDIR 'Microsoft.NET\assembly\GAC_MSIL\netstandard') -Recurse -Filter 'netstandard.dll' | Select-Object -First 1
$framework=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$references=@($core,$wasapi,$standard.FullName,(Join-Path $framework 'System.dll'),(Join-Path $framework 'System.Core.dll'))
Add-Type -ReferencedAssemblies $references -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Threading;
using NAudio.Wave;
public class LumenLoopback : IDisposable {
    WasapiLoopbackCapture capture;
    WaveFileWriter writer;
    Stopwatch timer=new Stopwatch();
    ManualResetEvent stopped=new ManualResetEvent(false);
    object gate=new object();
    byte[] zero=new byte[65536];
    public string StartedAt;
    void Pad(double seconds) {
        long desired=(long)(seconds*capture.WaveFormat.AverageBytesPerSecond);
        desired-=desired%capture.WaveFormat.BlockAlign;
        while(writer.Length<desired){int size=(int)Math.Min(zero.Length,desired-writer.Length);writer.Write(zero,0,size);}
    }
    public LumenLoopback(string output) {
        capture=new WasapiLoopbackCapture();
        writer=new WaveFileWriter(output,capture.WaveFormat);
        capture.DataAvailable+=(sender,args)=>{lock(gate){Pad(Math.Max(0,timer.Elapsed.TotalSeconds-(double)args.BytesRecorded/capture.WaveFormat.AverageBytesPerSecond));writer.Write(args.Buffer,0,args.BytesRecorded);}};
        capture.RecordingStopped+=(sender,args)=>stopped.Set();
        StartedAt=DateTime.UtcNow.ToString("o");timer.Start();capture.StartRecording();
    }
    public void Dispose(){capture.StopRecording();stopped.WaitOne(5000);lock(gate){Pad(timer.Elapsed.TotalSeconds);writer.Dispose();}capture.Dispose();stopped.Dispose();}
}
'@
$recording=New-Object LumenLoopback($Output)
try {
    @{ready=$true;startedAt=$recording.StartedAt} | ConvertTo-Json -Compress
    $deadline=[DateTime]::UtcNow.AddSeconds($Seconds)
    while(-not (Test-Path -LiteralPath $StopFile) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 75}
}finally{$recording.Dispose()}
