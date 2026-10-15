@echo off
setlocal
title Hyptile - Codex local multiplayer
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\codex-launch.ps1" -Mode Multiplayer %*
if errorlevel 1 (
    echo.
    echo The Codex local multiplayer session could not start. See the message above.
    pause
    exit /b 1
)
endlocal
