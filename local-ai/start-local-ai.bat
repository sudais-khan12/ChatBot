@echo off
REM Double-click launcher for the local AI assistant.
title Local AI assistant
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local-ai.ps1" %*
if errorlevel 1 pause
