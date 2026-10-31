@echo off
setlocal
cd /d "%~dp0"
node bin\kanmod.js %*
if errorlevel 1 (
  echo.
  echo kanmod 启动失败。请确认已安装 Node.js 20.11 或更高版本。
  pause
)
