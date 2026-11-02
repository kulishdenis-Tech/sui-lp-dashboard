@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo  SUI Dashboard 2.0.0
echo  Корінь: "%~dp0"
echo.

where powershell >nul 2>&1
if errorlevel 1 (
  echo  ERROR: PowerShell не знайдено в PATH.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-SUIdashboard.ps1" -Root "%~dp0"
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  echo  Запуск зупинився з кодом %ERR%.
  echo  Логи: "%~dp0_local\logs"
  echo.
  pause
  exit /b %ERR%
)

endlocal
exit /b 0
