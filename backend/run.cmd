@echo off
setlocal
cd /d "%~dp0"

rem =============================================================
rem  CircuitTutor backend launcher
rem  Usually started by ..\run.cmd (which passes CT_PYTHON / CT_BACKEND_PORT).
rem  Can also be double-clicked on its own.
rem =============================================================

if not defined CT_PYTHON set "CT_PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%CT_PYTHON%" set "CT_PYTHON=python"
if not defined CT_BACKEND_PORT set "CT_BACKEND_PORT=8000"

echo ============================================================
echo   CircuitTutor Backend
echo   API   : http://127.0.0.1:%CT_BACKEND_PORT%
echo   Docs  : http://127.0.0.1:%CT_BACKEND_PORT%/docs
echo   Close this window to stop the backend.
echo ============================================================
echo.

"%CT_PYTHON%" -m uvicorn app.main:app --host 127.0.0.1 --port %CT_BACKEND_PORT%

if errorlevel 1 (
  echo.
  echo [ERROR] Backend exited with an error.
  echo         If the module is missing, install dependencies first:
  echo           "%CT_PYTHON%" -m pip install -r "%~dp0requirements.txt"
  pause
)