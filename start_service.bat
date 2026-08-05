@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_service.ps1"
if errorlevel 1 (
  echo.
  echo Service start failed. Check the project logs directory.
  pause
)
endlocal
