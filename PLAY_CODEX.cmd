@echo off
setlocal
title Hyptile - Codex candidate
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\codex-launch.ps1" -Mode Solo %*
if errorlevel 1 (
    echo.
    echo The Codex candidate could not start. See the message above.
    pause
    exit /b 1
)
endlocal
