#Requires -Version 5.1
<#
    Starts the local AI assistant:
      1. verifies Docker Desktop is up (and tries to launch it if it is not),
      2. starts the existing "Olama" container if it is stopped,
      3. starts the Open WebUI container with its persistent configuration,
      4. waits for the interface to answer, then opens it in the browser.

    The Ollama container is never created, recreated or deleted here, and no
    data is ever removed.
#>
[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [int]$TimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$scriptDir       = Split-Path -Parent $MyInvocation.MyCommand.Definition
$composeFile     = Join-Path $scriptDir 'docker-compose.yml'
$envFile         = Join-Path $scriptDir '.env'
$ollamaContainer = 'Olama'

function Write-Step { param($m) Write-Host "==> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "    $m" -ForegroundColor Green }
function Write-Warn { param($m) Write-Host "    $m" -ForegroundColor Yellow }

function Fail {
    param($Message, $Hint)
    Write-Host ''
    Write-Host "ERROR: $Message" -ForegroundColor Red
    if ($Hint) { Write-Host "       $Hint" -ForegroundColor Yellow }
    Write-Host ''
    if ($Host.Name -eq 'ConsoleHost') { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}

# --- settings from .env (falls back to the compose defaults) ---------------
$settings = @{ OPEN_WEBUI_PORT = '8080'; WEBUI_BIND_ADDRESS = '127.0.0.1'; WEBUI_CONTAINER_NAME = 'open-webui' }
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$') {
            $settings[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
        }
    }
}
$port    = $settings['OPEN_WEBUI_PORT']
$webui   = $settings['WEBUI_CONTAINER_NAME']
$baseUrl = "http://localhost:$port"

Write-Host ''
Write-Host ' Local AI assistant (Open WebUI + Ollama)' -ForegroundColor White
Write-Host ' ----------------------------------------' -ForegroundColor DarkGray

# --- 1. Docker ------------------------------------------------------------
Write-Step 'Checking Docker Desktop'
docker version --format '{{.Server.Version}}' > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    $dd = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dd) {
        Write-Warn 'Docker is not responding yet - starting Docker Desktop...'
        Start-Process $dd | Out-Null
        $deadline = (Get-Date).AddSeconds(180)
        do {
            Start-Sleep -Seconds 5
            docker version --format '{{.Server.Version}}' > $null 2>&1
        } while ($LASTEXITCODE -ne 0 -and (Get-Date) -lt $deadline)
    }
    if ($LASTEXITCODE -ne 0) {
        Fail 'Docker Desktop is not available.' 'Start Docker Desktop manually, wait for the whale icon to stop animating, then run this again.'
    }
}
Write-Ok 'Docker engine is running.'

# --- 2 & 3. Ollama --------------------------------------------------------
Write-Step "Checking the '$ollamaContainer' container"
docker container inspect $ollamaContainer > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Fail "The container '$ollamaContainer' does not exist." "This launcher never creates it. Check 'docker ps -a' - the name is case sensitive."
}

$running = (docker inspect -f '{{.State.Running}}' $ollamaContainer).Trim()
if ($running -ne 'true') {
    Write-Warn 'Container is stopped - starting it (models and settings are preserved).'
    docker start $ollamaContainer > $null
    if ($LASTEXITCODE -ne 0) { Fail "Could not start '$ollamaContainer'." "Run 'docker start $ollamaContainer' to see the reason." }
}

$deadline = (Get-Date).AddSeconds(90)
$ollamaUp = $false
do {
    try {
        $tags = Invoke-RestMethod 'http://localhost:11434/api/tags' -TimeoutSec 5
        $ollamaUp = $true
    } catch { Start-Sleep -Seconds 2 }
} while (-not $ollamaUp -and (Get-Date) -lt $deadline)

if (-not $ollamaUp) {
    Fail 'Ollama is not answering on port 11434.' "Check 'docker logs $ollamaContainer'."
}
Write-Ok ("Ollama is up with {0} model(s): {1}" -f $tags.models.Count, (($tags.models | ForEach-Object { $_.name }) -join ', '))

# --- 4. Open WebUI --------------------------------------------------------
Write-Step 'Starting the chat interface'
docker compose -f $composeFile --env-file $envFile up -d
if ($LASTEXITCODE -ne 0) {
    Fail 'The interface container failed to start.' "If the port is taken, change OPEN_WEBUI_PORT in $envFile."
}

# --- 5. Wait for it to answer --------------------------------------------
Write-Step "Waiting for $baseUrl"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$ready = $false
do {
    try {
        $r = Invoke-WebRequest "$baseUrl/health" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) { $ready = $true }
    } catch {
        $state = (docker inspect -f '{{.State.Status}}' $webui 2>$null)
        if ($state -eq 'exited') {
            Write-Host ''
            docker logs --tail 30 $webui
            Fail 'The interface container exited.' 'The last log lines are above.'
        }
        Start-Sleep -Seconds 3
    }
} while (-not $ready -and (Get-Date) -lt $deadline)

if (-not $ready) {
    Fail "The interface did not respond within $TimeoutSeconds seconds." "Check 'docker logs $webui'. The first start after an upgrade can be slow."
}
Write-Ok 'Interface is ready.'

# --- 5b. Warm the default model ------------------------------------------
# A model that is not resident costs ~33s to load from disk on the first
# message. Start that load now, detached, so it happens while the browser is
# still opening instead of while you are waiting for a reply.
$preload = $settings['PRELOAD_MODEL']
if ($preload) {
    $preloadScript = Join-Path $scriptDir 'preload-model.ps1'
    if (Test-Path $preloadScript) {
        Write-Step "Preloading $preload"
        Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', $preloadScript,
            '-Model', $preload
        ) | Out-Null
        Write-Ok 'Loading in the background - your first message will not wait for disk.'
    }
}

# --- 6. Browser -----------------------------------------------------------
if (-not $NoBrowser) {
    Write-Step "Opening $baseUrl"
    Start-Process $baseUrl
}

Write-Host ''
Write-Host " Ready: $baseUrl" -ForegroundColor Green
Write-Host " Stop it later with stop-local-ai.bat (nothing is deleted)." -ForegroundColor DarkGray
Write-Host ''
Start-Sleep -Seconds 3
