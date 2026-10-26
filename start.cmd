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
set "FRONTEND_DIST=%FRONTEND_DIR%\dist"
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
rem  Order: CIRCUIT_TUTOR_PYTHON env var, backend\.venv, py -3,
rem         python/python3 on PATH, paths reported by "py -0p",
rem         registry installs, common install folders, manual input.
rem  Every candidate is executed first, so broken registrations
rem  (py pointing at a moved install) and Microsoft Store aliases
rem  (error 9009) are skipped instead of aborting the launcher.
rem -------------------------------------------------------------
set "PY_EXE="

if defined CIRCUIT_TUTOR_PYTHON call :probe_path "%CIRCUIT_TUTOR_PYTHON%"
if defined PY_EXE goto :python_found

if exist "%VENV_PY%" call :probe_path "%VENV_PY%"
if defined PY_EXE goto :python_found

call :probe_cmd py -3
if not defined PY_EXE call :probe_cmd python
if not defined PY_EXE call :probe_cmd python3

rem -- ask the launcher where it thinks Python lives, then verify each path --
if not defined PY_EXE call :probe_py_list

rem -- registry: HKCU and HKLM, both 32/64-bit views --
if not defined PY_EXE call :probe_registry HKCU\Software\Python\PythonCore
if not defined PY_EXE call :probe_registry HKLM\Software\Python\PythonCore
if not defined PY_EXE call :probe_registry HKLM\Software\WOW6432Node\Python\PythonCore

rem -- common install locations, including non-standard drives --
if not defined PY_EXE (
  for /d %%D in (
    "%LOCALAPPDATA%\Programs\Python\Python3*"
    "%ProgramFiles%\Python3*"
    "%ProgramFiles(x86)%\Python3*"
    "C:\Python3*"
    "D:\Python3*"
    "D:\tools\python3*"
    "D:\tools\Python3*"
    "E:\Python3*"
  ) do (
    if not defined PY_EXE call :probe_path "%%~D\python.exe"
  )
)

rem -- last resort: let the user paste a path --
if not defined PY_EXE call :ask_python

if not defined PY_EXE (
  echo.
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
echo [1/3] Python: %PY_EXE%

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
rem  Step 3 - check the prebuilt frontend
rem  The Vite build output ships with the repository, so no Node.js
rem  and no npm install are needed to just run the app.
rem -------------------------------------------------------------
if not exist "%FRONTEND_DIST%\index.html" (
  echo [2/3] Frontend build missing, trying to build it ...
  where npm >nul 2>&1
  if !errorlevel! equ 0 (
    pushd "%FRONTEND_DIR%"
    if not exist "node_modules" call npm.cmd install --no-fund --no-audit --cache "%NPM_CACHE%"
    call npm.cmd run build
    popd
  )
  if not exist "%FRONTEND_DIST%\index.html" (
    echo [ERROR] frontend\dist\index.html not found and could not be built.
    echo         Do one of these:
    echo           1. Install Node.js 20 LTS ^(https://nodejs.org/^) and run build_frontend.cmd
    echo           2. Copy a prebuilt "dist" folder into frontend\dist
    pause
    exit /b 1
  )
) else (
  echo [2/3] Frontend build found.
)

rem -------------------------------------------------------------
rem  Step 4 - free-port check
rem -------------------------------------------------------------
netstat -ano | findstr /r /c:":%BACKEND_PORT% .*LISTENING" >nul 2>&1
if !errorlevel! equ 0 (
  echo [ERROR] Port %BACKEND_PORT% is already in use. Close that program and retry.
  echo         Find it with: netstat -ano ^| findstr :%BACKEND_PORT%
  pause
  exit /b 1
)

rem -------------------------------------------------------------
rem  Step 5 - start backend (also serves the frontend) in its own window
rem -------------------------------------------------------------
echo [3/3] Starting CircuitTutor at %API_BASE% ...
set "CT_PYTHON=%PY_EXE%"
set "CT_BACKEND_PORT=%BACKEND_PORT%"
start "CircuitTutor (uvicorn:%BACKEND_PORT%)" /D "%BACKEND_DIR%" cmd /k run.cmd

echo       Waiting for health check ...
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
  echo       Ready: %API_BASE%/health
) else (
  echo       [WARN] Not ready after 90s. Check the CircuitTutor window log.
)
echo.

start "" "%API_BASE%"

echo ============================================================
echo   CircuitTutor is running
echo     App      : %API_BASE%
echo     API docs : %API_BASE%/docs
echo   Close the CircuitTutor window to stop it.
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
:probe_py_list
rem  Parse "py -0p" output, e.g. " -V:3.14 *  D:\Python314\python.exe".
rem  The launcher keeps stale registrations after an install is moved,
rem  so every reported path still has to pass the probe.
if not defined PY_EXE (
  for /f "tokens=1,*" %%A in ('py -0p 2^>nul') do (
    if not defined PY_EXE call :probe_path "%%B"
  )
)
exit /b 0

:probe_registry
rem  %1 = registry key holding PythonCore\<version>\InstallPath
rem  Value may be e.g. "D:\Python314\" or the unexpanded installer MSI form.
if not defined PY_EXE (
  for /f "tokens=2,*" %%A in ('reg query "%~1" /s /v ExecutablePath 2^>nul') do (
    if not defined PY_EXE call :probe_path "%%B"
  )
)
exit /b 0

:ask_python
rem  Interactive fallback: accept a path or a command, or an empty line to skip.
echo.
echo No Python 3.10+ found automatically.
echo Paste the full path to python.exe, or the folder containing it,
echo or press Enter to see the manual instructions.
set "PY_INPUT="
set /p "PY_INPUT=Python path: "
if defined PY_INPUT (
  set "PY_INPUT=!PY_INPUT:"=!"
  if exist "!PY_INPUT!\python.exe" (
    call :probe_path "!PY_INPUT!\python.exe"
  ) else (
    call :probe_path "!PY_INPUT!"
  )
  if not defined PY_EXE (
    echo   That path is not a working Python 3.10+ interpreter.
  )
)
exit /b 0