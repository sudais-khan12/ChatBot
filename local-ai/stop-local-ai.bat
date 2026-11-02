@echo off
REM Stops the chat interface. Nothing is deleted.
REM Pass --with-ollama to stop the Ollama container as well.
title Stop local AI assistant
set "ARGS="
if /I "%~1"=="--with-ollama" set "ARGS=-StopOllama"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-local-ai.ps1" %ARGS%
if errorlevel 1 pause
