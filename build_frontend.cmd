@echo off
setlocal
title CircuitTutor - build frontend

rem =============================================================
rem  Rebuild frontend\dist after editing frontend sources.
rem  run.cmd serves that folder through the backend, so the
rem  build output has to be refreshed whenever the UI changes.
rem  Requires Node.js 20 LTS+.
rem =============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "FRONTEND_DIR=%ROOT%\frontend"
set "NPM_CACHE=%ROOT%\.npm-cache"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js / npm not found.
  echo         Install Node.js 20 LTS or newer: https://nodejs.org/
  pause
  exit /b 1
)

pushd "%FRONTEND_DIR%"
if not exist "node_modules" (
  echo [1/2] Installing frontend dependencies ...
  call npm.cmd install --no-fund --no-audit --cache "%NPM_CACHE%"
  if errorlevel 1 (
    popd
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo [1/2] Frontend dependencies already installed.
)

echo [2/2] Building frontend ...
call npm.cmd run build
set "BUILD_EXIT=%errorlevel%"
popd

if not "%BUILD_EXIT%"=="0" (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

if not exist "%ROOT%\frontend\dist\index.html" (
  echo [ERROR] Build finished but frontend\dist\index.html is missing.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Frontend built into frontend\dist
echo   Run run.cmd to serve it at http://127.0.0.1:8000
echo ============================================================
echo.
pause
endlocal
exit /b 0