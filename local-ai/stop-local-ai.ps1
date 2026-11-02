#Requires -Version 5.1
<#
    Stops the chat interface and leaves everything else alone.

    Ollama is intentionally NOT stopped: other tools on this machine may be
    using it. Pass -StopOllama if you also want the "Olama" container stopped.

    No container is removed and no data is deleted. Chats, settings and
    uploads stay in D:\olama\open-webui; models stay in D:\olama\models.
#>
[CmdletBinding()]
param(
    [switch]$StopOllama
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Definition
$composeFile = Join-Path $scriptDir 'docker-compose.yml'
$envFile     = Join-Path $scriptDir '.env'

function Write-Step { param($m) Write-Host "==> $m" -ForegroundColor Cyan }

Write-Host ''
docker version --format '{{.Server.Version}}' > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Docker is not running - nothing to stop.' -ForegroundColor Yellow
    Start-Sleep -Seconds 2
    exit 0
}

Write-Step 'Stopping the chat interface'
docker compose -f $composeFile --env-file $envFile stop
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Could not stop the interface container.' -ForegroundColor Red
    if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}

if ($StopOllama) {
    Write-Step 'Stopping Ollama'
    docker stop Olama > $null 2>&1
}

Write-Host ''
Write-Host ' Stopped. Chats, settings and models are kept on D:\olama.' -ForegroundColor Green
if (-not $StopOllama) {
    Write-Host ' Ollama is still running (other tools may be using it).' -ForegroundColor DarkGray
    Write-Host ' Use: stop-local-ai.bat --with-ollama   to stop it too.' -ForegroundColor DarkGray
}
Write-Host ''
Start-Sleep -Seconds 3
