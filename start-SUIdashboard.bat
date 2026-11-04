@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo.
echo SUI Dashboard 2.0.20
echo Root: "%CD%"
echo.
where powershell >nul 2>&1
if errorlevel 1 (
  echo ERROR: PowerShell was not found in PATH.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-SUIdashboard.ps1"
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  echo Startup stopped with code %ERR%.
  echo Logs: "%~dp0_local\logs"
  pause
  exit /b %ERR%
)
endlocal
exit /b 0