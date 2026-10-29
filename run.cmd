@echo off
setlocal enabledelayedexpansion
title CircuitTutor

rem =============================================================
rem  CircuitTutor launcher (portable, Windows)
rem
rem  Single entry point for a fresh clone:
rem    1. read .env if present (optional)
rem    2. locate a working Python 3.10+
rem    3. create backend\.venv and install backend\requirements.txt
rem    4. serve frontend\dist and the API on one port, open browser
rem
rem  Keep this file ASCII-only. Mixing chcp 65001 with UTF-8 text
rem  makes cmd.exe mis-parse lines and run fragments as commands.
rem  Do not save it with a UTF-8 BOM either, that breaks @echo off.
rem =============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND_DIR=%ROOT%\backend"
set "FRONTEND_DIST=%ROOT%\frontend\dist"
set "VENV_DIR=%BACKEND_DIR%\.venv"
set "VENV_PY=%VENV_DIR%\Scripts\python.exe"
set "REQ_FILE=%BACKEND_DIR%\requirements.txt"
set "ENV_FILE=%ROOT%\.env"
set "DEPS_STAMP=%VENV_DIR%\.deps-ok"

rem -- defaults, overridden by .env --
set "CT_PORT=8000"
set "CT_PYTHON="
set "CT_PIP_INDEX="

echo ============================================================
echo   CircuitTutor Launcher
echo ============================================================
echo.

if not exist "%BACKEND_DIR%\app\main.py" (
  echo [ERROR] backend\app\main.py not found.
  echo         Run this script from inside a complete copy of the repo.
  pause
  exit /b 1
)
if not exist "%FRONTEND_DIST%\index.html" (
  echo [ERROR] frontend\dist\index.html not found.
  echo         The prebuilt UI is part of the repository, so this copy
  echo         is incomplete. Download the repo again ^(Code - Download
  echo         ZIP, or "git clone"^) instead of copying only some files.
  echo         Developers only: run build_frontend.cmd ^(needs Node.js^).
  pause
  exit /b 1
)

if exist "%ENV_FILE%" (
  call :load_env "%ENV_FILE%"
  echo       Config: .env loaded
) else (
  echo       Config: .env not found, using defaults
)

rem -------------------------------------------------------------
rem  Step 1 - locate a usable Python 3.10+
rem  Order: .env CT_PYTHON, backend\.venv, py -3, python/python3 on
rem         PATH, paths reported by "py -0p", registry installs,
rem         common install folders, manual input.
rem  Every candidate is executed first, so broken registrations and
rem  Microsoft Store aliases ^(error 9009^) are skipped instead of
rem  aborting the launcher.
rem -------------------------------------------------------------
set "PY_EXE="

if defined CT_PYTHON call :probe_path "%CT_PYTHON%"
if defined PY_EXE goto :python_found

if exist "%VENV_PY%" call :probe_path "%VENV_PY%"
if defined PY_EXE goto :python_found

call :probe_cmd py -3
if not defined PY_EXE call :probe_cmd python
if not defined PY_EXE call :probe_cmd python3
if not defined PY_EXE call :probe_py_list

if not defined PY_EXE call :probe_registry HKCU\Software\Python\PythonCore
if not defined PY_EXE call :probe_registry HKLM\Software\Python\PythonCore
if not defined PY_EXE call :probe_registry HKLM\Software\WOW6432Node\Python\PythonCore

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

if not defined PY_EXE call :ask_python

if not defined PY_EXE (
  echo.
  echo [ERROR] No usable Python 3.10+ found.
  echo         Fix it in one of these ways:
  echo           1. Install Python 3.10+ and tick "Add python.exe to PATH"
  echo              https://www.python.org/downloads/
  echo           2. If Python lives elsewhere, create .env next to this
  echo              script containing:
  echo                CT_PYTHON=D:\Python312\python.exe
  pause
  exit /b 1
)

:python_found
rem  Version and real executable are written to a temp file and read back,
rem  because "for /f" cannot capture quoted commands whose output contains
rem  spaces without nested-quote problems.
set "PY_INFO_FILE=%TEMP%\circuittutor-pyinfo.txt"
"%PY_EXE%" -c "import sys;open(sys.argv[1],'w').write(sys.version.split()[0]+chr(10)+sys.executable)" "%PY_INFO_FILE%" >nul 2>&1
set "PY_VER="
set "PY_REAL="
set /a PY_LINE=0
for /f "usebackq delims=" %%V in ("%PY_INFO_FILE%") do (
  set /a PY_LINE+=1
  if !PY_LINE! equ 1 set "PY_VER=%%V"
  if !PY_LINE! equ 2 set "PY_REAL=%%V"
)
del "%PY_INFO_FILE%" 2>nul
echo [1/4] Python found
echo       Version : %PY_VER%
echo       Path    : %PY_REAL%

rem -------------------------------------------------------------
rem  Step 2 - backend virtualenv and dependencies
rem  The dependency check is keyed on a hash of requirements.txt, so
rem  editing requirements re-installs automatically while a warm
rem  environment starts with no network access at all.
rem -------------------------------------------------------------
if /i "%PY_EXE%"=="%VENV_PY%" goto :venv_ready
if exist "%VENV_PY%" goto :venv_ready

echo [2/4] Creating virtualenv at backend\.venv ...
"%PY_EXE%" -m venv "%VENV_DIR%"
if not exist "%VENV_PY%" (
  echo [ERROR] Failed to create the virtualenv.
  echo         Reinstall Python with the "pip" and "venv" components enabled.
  pause
  exit /b 1
)
"%VENV_PY%" -c "import sys" >nul 2>&1
if !errorlevel! neq 0 (
  echo [ERROR] The virtualenv was created but its python.exe does not work.
  echo         This usually means the base interpreter is a Microsoft Store
  echo         alias or a moved install. Set the real path in .env:
  echo           CT_PYTHON=C:\Python312\python.exe
  rmdir /s /q "%VENV_DIR%" 2>nul
  pause
  exit /b 1
)

:venv_ready
set "PY_EXE=%VENV_PY%"

rem  Compare the stamp with requirements.txt inside Python. Parsing its
rem  output with "for /f" would need nested quotes, which cmd mangles.
"%PY_EXE%" -c "import hashlib,os,sys;h=hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest();p=sys.argv[2];sys.exit(0 if os.path.isfile(p) and open(p).read().strip()==h else 1)" "%REQ_FILE%" "%DEPS_STAMP%" >nul 2>&1
if !errorlevel! equ 0 (
  echo [2/4] Backend dependencies already installed.
  goto :deps_done
)

rem  Tsinghua mirror is the default: the official PyPI CDN is often
rem  unreachable or very slow from mainland China, and the first run
rem  has to fetch ~30 MB. Set CT_PIP_INDEX in .env to use another one.
set "PIP_INDEX=%CT_PIP_INDEX%"
if not defined PIP_INDEX set "PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple"

echo [2/4] Installing backend dependencies ^(needs internet^) ...
echo       Index   : %PIP_INDEX%
set "PIP_OK="
"%PY_EXE%" -m pip install -r "%REQ_FILE%" -i "%PIP_INDEX%" --disable-pip-version-check
if !errorlevel! equ 0 set "PIP_OK=1"

if not defined PIP_OK (
  echo.
  echo       Install failed. Retrying with the official PyPI ...
  "%PY_EXE%" -m pip install -r "%REQ_FILE%" --disable-pip-version-check
  if !errorlevel! equ 0 set "PIP_OK=1"
)

if not defined PIP_OK (
  echo.
  echo [ERROR] Could not install backend dependencies.
  echo         Retry manually, then run this script again:
  echo           "%PY_EXE%" -m pip install -r "%REQ_FILE%" -i %PIP_INDEX%
  echo         If this mirror is blocked, pick another one in .env:
  echo           CT_PIP_INDEX=https://mirrors.aliyun.com/pypi/simple/
  echo         No internet at all? This build cannot start without the
  echo         packages listed in backend\requirements.txt.
  pause
  exit /b 1
)

"%PY_EXE%" -c "import hashlib,sys;open(sys.argv[2],'w').write(hashlib.sha256(open(sys.argv[1],'rb').read()).hexdigest())" "%REQ_FILE%" "%DEPS_STAMP%" >nul 2>&1

:deps_done
echo [3/4] Frontend build ready.

rem -------------------------------------------------------------
rem  Step 3 - port check
rem  The UI and the API share one port, so a busy port is fatal.
rem  It is never switched silently: .env CT_PORT is the only knob.
rem -------------------------------------------------------------
netstat -ano | findstr /r /c:":%CT_PORT% .*LISTENING" >nul 2>&1
if !errorlevel! equ 0 (
  echo.
  echo [ERROR] Port %CT_PORT% is already in use.
  echo         Either close the program using it, or pick another port
  echo         by creating .env next to this script with:
  echo           CT_PORT=8080
  pause
  exit /b 1
)

rem -------------------------------------------------------------
rem  Step 4 - start backend (it also serves frontend\dist)
rem -------------------------------------------------------------
echo [4/4] Starting CircuitTutor at http://127.0.0.1:%CT_PORT% ...
set "CT_PYTHON=%PY_EXE%"
set "CT_BACKEND_PORT=%CT_PORT%"
start "CircuitTutor (uvicorn:%CT_PORT%)" /D "%BACKEND_DIR%" cmd /k run.cmd

echo       Waiting for health check ...
set "BACKEND_READY="
for /l %%i in (1,1,90) do (
  if not defined BACKEND_READY (
    curl -s -f -o nul --max-time 2 "http://127.0.0.1:%CT_PORT%/health" >nul 2>&1
    if !errorlevel! equ 0 (
      set "BACKEND_READY=1"
    ) else (
      ping -n 2 127.0.0.1 >nul
    )
  )
)

if defined BACKEND_READY (
  echo       Ready: http://127.0.0.1:%CT_PORT%/health
  start "" "http://127.0.0.1:%CT_PORT%"
) else (
  echo       [WARN] Not ready after 90s. Check the CircuitTutor window log.
)
echo.
echo ============================================================
echo   CircuitTutor is running
echo     App      : http://127.0.0.1:%CT_PORT%
echo     API docs : http://127.0.0.1:%CT_PORT%/docs
echo   Close the CircuitTutor window to stop it.
echo ============================================================
echo.
pause
endlocal
exit /b 0

rem =============================================================
rem  Subroutines - configuration
rem =============================================================

:load_env
rem  %1 = path to .env. Only simple "KEY=VALUE" lines are parsed; blank
rem  lines and lines starting with # are skipped by "for /f" itself.
rem  Everything stays in this one loop: passing an empty value through
rem  "call :sub "KEY" """ would abort the surrounding parser.
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%~1") do (
  set "_k=%%A"
  set "_v=%%B"
  if defined _k (
    if "!_k:~-1!"==" " set "_k=!_k:~0,-1!"
    for /f "tokens=* delims= " %%T in ("!_v!") do set "_v=%%T"
    if "!_v:~-1!"==" " set "_v=!_v:~0,-1!"
    if /i "!_k!"=="CT_PORT" set "CT_PORT=!_v!"
    if /i "!_k!"=="CT_PYTHON" set "CT_PYTHON=!_v!"
    if /i "!_k!"=="CT_PIP_INDEX" set "CT_PIP_INDEX=!_v!"
  )
)
set "_k="
set "_v="
exit /b 0

rem =============================================================
rem  Subroutines - Python discovery
rem  A candidate is accepted only if it really runs Python 3.10+,
rem  which filters out Microsoft Store aliases (error 9009) and
rem  broken py launchers that stay registered after a move.
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
rem  Resolve sys.executable so we store the real python.exe path, not
rem  a bare command name: venv records the base interpreter path and a
rem  PATH alias would make that path invalid.
if not defined PY_EXE (
  %~1 %~2 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
  if !errorlevel! equ 0 (
    for /f "delims=" %%P in ('%~1 %~2 -c "import sys; print(sys.executable)" 2^>nul') do (
      set "PY_EXE=%%P"
    )
  )
)
exit /b 0

:probe_py_list
rem  Parse "py -0p" output, e.g. " -V:3.14 *  D:\Python314\python.exe".
if not defined PY_EXE (
  for /f "tokens=1,*" %%A in ('py -0p 2^>nul') do (
    if not defined PY_EXE call :probe_path "%%B"
  )
)
exit /b 0

:probe_registry
rem  %1 = registry key holding PythonCore\<version>\InstallPath
if not defined PY_EXE (
  for /f "tokens=2,*" %%A in ('reg query "%~1" /s /v ExecutablePath 2^>nul') do (
    if not defined PY_EXE call :probe_path "%%B"
  )
)
exit /b 0

:ask_python
rem  Interactive fallback: accept a path or a command, empty line to skip.
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