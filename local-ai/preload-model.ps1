#Requires -Version 5.1
<#
    Loads a model into Ollama so the first chat message does not pay the
    disk-load cost. Run detached by start-local-ai.ps1; safe to run by hand.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Model,
    [string]$KeepAlive = '30m',
    [string]$OllamaUrl = 'http://localhost:11434'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# An empty prompt tells Ollama to load the model and stop there.
$body = @{ model = $Model; prompt = ''; keep_alive = $KeepAlive } | ConvertTo-Json -Compress

try {
    Invoke-RestMethod "$OllamaUrl/api/generate" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 900 | Out-Null
    Write-Output "Preloaded $Model (resident for $KeepAlive)."
} catch {
    Write-Output "Preload of $Model failed: $($_.Exception.Message)"
    exit 1
}
