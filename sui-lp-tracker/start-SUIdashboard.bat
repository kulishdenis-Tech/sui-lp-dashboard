@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PORT=5180"
set "URL=http://localhost:%PORT%/"
set "AUTO_API=5191"
rem Resolve sibling folder (path may contain spaces)
for %%I in ("%~dp0..\sui-lp-autopilot") do set "AUTO_DIR=%%~fI"

echo.
echo  SUI Dashboard     - %URL%
echo  LP Autopilot API  - http://127.0.0.1:%AUTO_API%/  (proxied as /api/autopilot)
echo.

rem --- Autopilot bot API (5191) only; trading UI lives in tracker 5180 ---
if not exist "%AUTO_DIR%\package.json" (
  echo  WARN: sui-lp-autopilot not found at %AUTO_DIR% - skip bot.
  goto :tracker
)

where npm >nul 2>&1
if errorlevel 1 (
  echo  WARN: npm not in PATH - cannot start autopilot bot.
  goto :tracker
)

rem API / bot on 5191
set "API_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%AUTO_API% .*LISTENING"') do (
  set "API_PID=%%P"
  goto :api_have_pid
)
goto :start_api

:api_have_pid
echo  Autopilot API already listening on %AUTO_API% (PID %API_PID%).
goto :tracker

:start_api
if not exist "%AUTO_DIR%\packages\bot\dist\main.js" (
  echo  Bot dist missing - building autopilot packages...
  pushd "%AUTO_DIR%"
  call npm run build -w @autopilot/engine
  if errorlevel 1 goto :build_fail
  call npm run build -w @autopilot/cetus
  if errorlevel 1 goto :build_fail
  call npm run build -w @autopilot/db
  if errorlevel 1 goto :build_fail
  call npm run build -w @autopilot/bot
  if errorlevel 1 goto :build_fail
  popd
  if not exist "%AUTO_DIR%\packages\bot\dist\main.js" (
    echo  ERROR: build finished but packages\bot\dist\main.js still missing.
    pause
    exit /b 1
  )
)

echo  Starting LP Autopilot API on %AUTO_API%...
start "SUI LP Autopilot API 5191" /D "%AUTO_DIR%" cmd /k npm run bot
echo  Waiting for API %AUTO_API%...
set /a "WAIT=0"
:wait_api
set "API_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%AUTO_API% .*LISTENING"') do set "API_PID=%%P"
if defined API_PID goto :api_ready
set /a "WAIT+=1"
if %WAIT% GEQ 30 goto :api_timeout
ping -n 2 127.0.0.1 >nul
goto :wait_api

:api_ready
echo  API is up - PID %API_PID%
goto :tracker

:api_timeout
echo  WARN: API did not listen on %AUTO_API% within 30s - check the API 5191 window.
goto :tracker

:build_fail
popd
echo  ERROR: autopilot build failed - fix logs, then re-run.
pause
exit /b 1

:tracker
set "PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "PID=%%P"
  goto :have_pid
)
goto :start_dev

:have_pid
powershell -NoProfile -Command "$p=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:PID)).CommandLine; if ($p -and $p -match 'vite') { Write-Host ('Already running - PID '+$env:PID); exit 0 } else { Write-Host ('ERROR: Port '+$env:PORT+' taken by PID '+$env:PID+' - not Vite.'); if ($p) { Write-Host $p }; exit 1 }"
if errorlevel 1 (
  echo  Close that process or change DEV_PORT in vite.config.ts.
  echo.
  pause
  exit /b 1
)
exit /b 0

:start_dev
where npm >nul 2>&1
if errorlevel 1 (
  echo  ERROR: npm not found in PATH.
  pause
  exit /b 1
)

echo  Starting tracker with npm on %PORT%...
call npm run dev
set "ERR=%ERRORLEVEL%"

if not "%ERR%"=="0" (
  echo.
  echo  Dev server exited with code %ERR%.
  pause
  exit /b %ERR%
)
exit /b 0
