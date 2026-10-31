@echo off
setlocal
cd /d "%~dp0"
node bin\kanmod.js %*
if errorlevel 1 (
  echo.
  echo kanmod failed to start. Install Node.js 20.11 or newer.
  pause
)
