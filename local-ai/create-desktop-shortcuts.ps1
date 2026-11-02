#Requires -Version 5.1
<#
    Creates two desktop shortcuts:
      "Local AI Assistant"       -> start-local-ai.bat
      "Stop Local AI Assistant"  -> stop-local-ai.bat

    Re-running this overwrites the shortcuts; it touches nothing else.
    Remove them by deleting the .lnk files from the desktop.
#>
[CmdletBinding()]
param(
    [string]$DesktopPath = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$shell = New-Object -ComObject WScript.Shell

$shortcuts = @(
    @{ Name = 'Local AI Assistant';      Target = 'start-local-ai.bat'; Icon = 'imageres.dll,166'; Desc = 'Start the local chatbot and open it in the browser' },
    @{ Name = 'Stop Local AI Assistant'; Target = 'stop-local-ai.bat';  Icon = 'imageres.dll,100'; Desc = 'Stop the local chatbot (keeps all chats and models)' }
)

foreach ($s in $shortcuts) {
    $target = Join-Path $scriptDir $s.Target
    if (-not (Test-Path $target)) { throw "Missing $target" }

    $linkPath = Join-Path $DesktopPath ($s.Name + '.lnk')
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath       = $target
    $link.WorkingDirectory = $scriptDir
    $link.Description      = $s.Desc
    $link.IconLocation     = Join-Path $env:SystemRoot ('System32\' + $s.Icon)
    $link.WindowStyle      = 7   # start minimised; the browser is what you want to see
    $link.Save()

    Write-Host "Created: $linkPath" -ForegroundColor Green
}
