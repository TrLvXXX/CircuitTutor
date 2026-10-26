@echo off
setlocal enabledelayedexpansion
title CircuitTutor Launcher

rem =============================================================
rem  CircuitTutor one-click launcher (Windows)
rem  Starts backend (uvicorn:8000) and frontend (Vite:5173).
rem  On first run it creates backend\.venv and installs dependencies.
rem  Keep this file ASCII-only: mixing chcp 65001 with UTF-8 text
rem  makes cmd.exe mis-parse lines and execute fragments as commands.
rem =============================================================

set "BACKEND_PORT=8000"
set "FRONTEND_PORT=5173"
set "API_BASE=http://127.0.0.1:%BACKEND_PORT%"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND_DIR=%ROOT%\backend"
set "FRONTEND_DIR=%ROOT%\frontend"
set "VENV_DIR=%BACKEND_DIR%\.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
set "NPM_CACHE=%ROOT%\.npm-cache"

echo ============================================================
echo   CircuitTutor Launcher
echo ============================================================
echo.

if not exist "%BACKEND_DIR%\app\main.py" (
  echo [ERROR] backend\app\main.py not found.
  echo         Keep this script in the project root, next to ^"backend^" and ^"frontend^".
  pause
  exit /b 1
)
if not exist "%FRONTEND_DIR%\package.json" (
  echo [ERROR] frontend\package.json not found.
  echo         Keep this script in the project root, next to ^"backend^" and ^"frontend^".
  pause
  exit /b 1
)

rem -------------------------------------------------------------
rem  Step 1 - locate a usable Python 3.10+
rem  Order: CIRCUIT_TUTOR_PYTHON env var, backend\.venv, py launcher,
rem         python/python3 on PATH, common install folders.
rem  Broken or fake interpreters (Microsoft Store aliases return 9009)
rem  are skipped automatically by the probe subroutine.
rem -------------------------------------------------------------
set "PY_EXE="

if defined CIRCUIT_TUTOR_PYTHON call :probe_path "%CIRCUIT_TUTOR_PYTHON%"
if defined PY_EXE goto :python_found

if exist "%VENV_PY%" call :probe_path "%VENV_PY%"
if defined PY_EXE goto :python_found

call :probe_cmd py -3
if not defined PY_EXE call :probe_cmd python
if not defined PY_EXE call :probe_cmd python3

if not defined PY_EXE (
  for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if not defined PY_EXE call :probe_path "%%~D\python.exe"
  )
)
if not defined PY_EXE (
  for /d %%D in ("%ProgramFiles%\Python3*" "C:\Python3*") do (
    if not defined PY_EXE call :probe_path "%%~D\python.exe"
  )
)

if not defined PY_EXE (
  echo [ERROR] No usable Python 3.10+ found.
  echo         Fix it in one of these ways:
  echo           1. Install Python 3.10+ and tick "Add python.exe to PATH"
  echo              https://www.python.org/downloads/
  echo           2. If Python is installed elsewhere, set the path first:
  echo              set CIRCUIT_TUTOR_PYTHON=D:\Python312\python.exe
  echo              start.cmd
  pause
  exit /b 1
)

:python_found
echo [1/4] Python: %PY_EXE%

rem -------------------------------------------------------------
rem  Step 2 - backend virtualenv + dependencies
rem -------------------------------------------------------------
if not exist "%VENV_PY%" (
  echo       Creating virtualenv at backend\.venv ...
  "%PY_EXE%" -m venv "%VENV_DIR%"
  if not exist "%VENV_PY%" (
    echo [ERROR] Failed to create the virtualenv.
    echo         Reinstall Python with the "pip" and "venv" components enabled.
    pause
    exit /b 1
  )
)
set "PY_EXE=%VENV_PY%"

"%PY_EXE%" -c "import fastapi, uvicorn, numpy, sympy" >nul 2>&1
if !errorlevel! neq 0 (
  echo       Installing backend dependencies ^(first run, needs internet^) ...
  "%PY_EXE%" -m pip install --upgrade pip --quiet
  "%PY_EXE%" -m pip install -r "%BACKEND_DIR%\requirements.txt"
  if !errorlevel! neq 0 (
    echo [ERROR] Failed to install backend dependencies.
    echo         Retry manually:
    echo           "%PY_EXE%" -m pip install -r "%BACKEND_DIR%\requirements.txt"
    echo         Slow network? Use a mirror:
    echo           "%PY_EXE%" -m pip install -r "%BACKEND_DIR%\requirements.txt" -i https://pypi.tuna.tsinghua.edu.cn/simple
    pause
    exit /b 1
  )
) else (
  echo       Backend dependencies already installed.
)

rem -------------------------------------------------------------
rem  Step 3 - frontend dependencies
rem -------------------------------------------------------------
if not exist "%FRONTEND_DIR%\node_modules" (
  where npm >nul 2>&1
  if !errorlevel! neq 0 (
    echo [ERROR] Node.js / npm not found.
    echo         Install Node.js 20 LTS or newer: https://nodejs.org/
    pause
    exit /b 1
  )
  echo [2/4] Installing frontend dependencies ^(first run, needs internet^) ...
  pushd "%FRONTEND_DIR%"
  call npm.cmd install --no-fund --no-audit --cache "%NPM_CACHE%"
  popd
  if not exist "%FRONTEND_DIR%\node_modules" (
    echo [ERROR] Failed to install frontend dependencies.
    echo         Retry manually: cd frontend ^&^& npm install
    pause
    exit /b 1
  )
) else (
  echo [2/4] Frontend dependencies already installed.
)

rem -------------------------------------------------------------
rem  Step 4 - free-port check
rem -------------------------------------------------------------
for %%P in (%BACKEND_PORT% %FRONTEND_PORT%) do (
  set "PORT_BUSY="
  netstat -ano | findstr /r /c:":%%P .*LISTENING" >nul 2>&1
  if !errorlevel! equ 0 set "PORT_BUSY=1"
  if defined PORT_BUSY (
    echo [ERROR] Port %%P is already in use. Close that program and retry.
    echo         Find it with: netstat -ano ^| findstr :%%P
    pause
    exit /b 1
  )
)

rem -------------------------------------------------------------
rem  Step 5 - start backend in its own window
rem -------------------------------------------------------------
echo [3/4] Starting backend at %API_BASE% ...
set "CT_PYTHON=%PY_EXE%"
set "CT_BACKEND_PORT=%BACKEND_PORT%"
start "CircuitTutor Backend (uvicorn:%BACKEND_PORT%)" /D "%BACKEND_DIR%" cmd /k run.cmd

echo       Waiting for backend health check ...
set "BACKEND_READY="
for /l %%i in (1,1,90) do (
  if not defined BACKEND_READY (
    curl -s -f -o nul --max-time 2 "%API_BASE%/health" >nul 2>&1
    if !errorlevel! equ 0 (
      set "BACKEND_READY=1"
    ) else (
      ping -n 2 127.0.0.1 >nul
    )
  )
)

if defined BACKEND_READY (
  echo       Backend ready: %API_BASE%/health
) else (
  echo       [WARN] Backend not ready after 90s. Check the backend window log.
)
echo.

rem -------------------------------------------------------------
rem  Step 6 - start frontend in its own window
rem -------------------------------------------------------------
echo [4/4] Starting frontend at http://localhost:%FRONTEND_PORT% ...
start "CircuitTutor Frontend (Vite:%FRONTEND_PORT%)" /D "%FRONTEND_DIR%" cmd /k run.cmd

ping -n 6 127.0.0.1 >nul
start "" "http://localhost:%FRONTEND_PORT%"

echo.
echo ============================================================
echo   Ready
echo     Frontend : http://localhost:%FRONTEND_PORT%
echo     API docs : %API_BASE%/docs
echo   Close the two service windows to stop them.
echo ============================================================
echo.
pause
endlocal
exit /b 0

rem =============================================================
rem  Subroutines that pick a usable Python 3.10+ interpreter.
rem  A candidate is accepted only if it really runs Python 3.10+,
rem  which filters out Microsoft Store aliases (error 9009) and
rem  broken py launchers.
rem =============================================================
:probe_path
rem  %1 = full path to python.exe (may contain spaces, always quoted)
if not defined PY_EXE (
  "%~1" -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
  if !errorlevel! equ 0 set "PY_EXE=%~1"
)
exit /b 0

:probe_cmd
rem  %1 = command name, %2 = optional extra argument (e.g. py -3)
if not defined PY_EXE (
  %~1 %~2 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
  if !errorlevel! equ 0 (
    if "%~2"=="" (
      set "PY_EXE=%~1"
    ) else (
      set "PY_EXE=%~1 %~2"
    )
  )
)
exit /b 0