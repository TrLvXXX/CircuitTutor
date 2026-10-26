@echo off
setlocal
cd /d "%~dp0"

rem =============================================================
rem  CircuitTutor frontend launcher
rem  Usually started by ..\start.cmd; can also be double-clicked.
rem =============================================================

if not exist "%~dp0node_modules" (
  echo [ERROR] node_modules not found. Run "npm install" in this folder first.
  pause
  exit /b 1
)

echo ============================================================
echo   CircuitTutor Frontend
echo   URL   : http://localhost:5173
echo   Close this window to stop the dev server.
echo ============================================================
echo.

call npm.cmd run dev

if errorlevel 1 (
  echo.
  echo [ERROR] Frontend dev server exited with an error.
  pause
)