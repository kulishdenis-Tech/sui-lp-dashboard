@echo off
setlocal
cd /d "C:\Users\kulis\Desktop\SUI Dashboard\sui-lp-tracker"

echo [1/4] Git commit...
git -c user.email=kulishdenis@gmail.com -c user.name=Denys add api\_lib\proxyHosts.ts src\utils\externalFetchUrl.ts src\utils\suiRpcUrl.ts src\services\balanceService.ts
git -c user.email=kulishdenis@gmail.com -c user.name=Denys commit -m "fix: proxy SUI RPC in prod to prevent Chrome extension fetch interception"

echo [2/4] Git push...
git push

echo [3/4] Deploying to Vercel (this may take 1-2 minutes)...
if "%VERCEL_TOKEN%"=="" (
    echo Set VERCEL_TOKEN in the environment. Do not store it in this file.
    exit /b 1
)

REM Try vercel from npm global first, then fallback to full path
where vercel >nul 2>&1
if %ERRORLEVEL% == 0 (
    vercel --prod --yes --scope kulishdenis-techs-projects
) else (
    echo vercel not in PATH, trying npm global path...
    "%APPDATA%\npm\vercel.cmd" --prod --yes --scope kulishdenis-techs-projects
)

echo.
echo [4/4] Done! Check output above for any errors.
echo If "Ready" appeared above, deployment succeeded.
pause
