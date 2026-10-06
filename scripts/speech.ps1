$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
Add-Type -ReferencedAssemblies System.Speech -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Speech.Synthesis;
public class LumenWord { public string text; public double start; public int position; public int length; }
public class LumenSpeech {
  public static List<LumenWord> Speak(SpeechSynthesizer voice, string text) {
    var words = new List<LumenWord>();
    voice.SpeakProgress += (sender, args) => words.Add(new LumenWord {text=args.Text,start=args.AudioPosition.TotalSeconds,position=args.CharacterPosition,length=args.CharacterCount});
    voice.Speak(text);
    return words;
  }
}
'@
$synthesizer = [Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $voice = $synthesizer.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name.StartsWith('es') } | Select-Object -First 1
    if (-not $voice) { throw 'No hay una voz en espanol instalada en Windows.' }
    $voiceName = $voice.VoiceInfo.Name
    if ($request.voice) { $voiceName = [string]$request.voice }
    $synthesizer.SelectVoice($voiceName)
    $synthesizer.Rate = 0
    $synthesizer.SetOutputToWaveFile($request.output)
    $words = [LumenSpeech]::Speak($synthesizer, [string]$request.text)
    @{voice=$voiceName;ok=$true;words=@($words)} | ConvertTo-Json -Depth 5 -Compress
} finally { $synthesizer.Dispose() }
