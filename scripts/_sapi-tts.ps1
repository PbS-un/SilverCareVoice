param(
  [string]$JsonPath,
  [string]$OutDir
)

# Windows SAPI narration generator (zh-HK preferred, zh-* fallback).
# Output: OutDir/seg-<id>.wav per segment (duration read via ffprobe).
# NOTE: keep this file ASCII-only so Windows PowerShell 5.1 parses it
# regardless of BOM/codepage. Chinese text lives in the JSON input.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$segments = Get-Content -Raw -Encoding UTF8 $JsonPath | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = -2

$zhHkVoice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'zh-HK' } | Select-Object -First 1
if ($zhHkVoice) {
  $synth.SelectVoice($zhHkVoice.VoiceInfo.Name)
  Write-Output ("[sapi] using zh-HK voice: " + $zhHkVoice.VoiceInfo.Name)
} else {
  $zhVoice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1
  if ($zhVoice) {
    $synth.SelectVoice($zhVoice.VoiceInfo.Name)
    Write-Output ("[sapi] zh-HK unavailable, fallback: " + $zhVoice.VoiceInfo.Name)
  }
}

foreach ($seg in $segments) {
  $out = Join-Path $OutDir ("seg-{0}.wav" -f $seg.id)
  $synth.SetOutputToWaveFile($out)
  $synth.Speak([string]$seg.text)
  $synth.SetOutputToNull()
  Write-Output ("[sapi] generated seg-{0}.wav" -f $seg.id)
}

$synth.Dispose()
Write-Output "[sapi] done"
