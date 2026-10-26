@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title CircuitTutor 一键启动

rem =============================================================
rem  CircuitTutor 一键启动脚本
rem  作用：自动启动后端求解服务(uvicorn:8000) 与 前端开发服务器(Vite:5173)
rem  用法：双击本文件即可；关闭弹出的服务窗口即停止对应服务
rem =============================================================

rem —— 路径配置（按本机实际环境修改） ——
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BACKEND_DIR=%ROOT%\backend"
set "FRONTEND_DIR=%ROOT%\frontend"
set "PY_EXE=D:\tools\python3.14.4\python.exe"
set "BACKEND_PORT=8000"
set "FRONTEND_PORT=5173"
set "API_BASE=http://127.0.0.1:%BACKEND_PORT%"

echo ============================================================
echo   CircuitTutor 一键启动
echo ============================================================
echo.

rem —— 1. 检查 Python 运行时 ——
if not exist "%PY_EXE%" (
  echo [错误] 未找到 Python 运行时：%PY_EXE%
  echo        请修改本脚本顶部的 PY_EXE 变量指向正确的 python.exe
  pause
  exit /b 1
)

rem —— 2. 检查前端依赖 ——
if not exist "%FRONTEND_DIR%\node_modules" (
  echo [错误] 未找到前端依赖 node_modules
  echo        请先在 frontend 目录执行：npm.cmd install --cache "%%TEMP%%\npm-cache"
  pause
  exit /b 1
)

rem —— 3. 启动后端（新窗口，独立进程） ——
echo [1/3] 启动后端求解服务 %API_BASE% ...
start "CircuitTutor 后端 (uvicorn:%BACKEND_PORT%)" /D "%BACKEND_DIR%" cmd /k "chcp 65001 >nul && "%PY_EXE%" -m uvicorn app.main:app --host 127.0.0.1 --port %BACKEND_PORT%"

rem —— 4. 等待后端就绪（最多约 30 秒） ——
echo [2/3] 等待后端就绪 ...
set "BACKEND_READY="
for /l %%i in (1,1,30) do (
  if not defined BACKEND_READY (
    powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri '%API_BASE%/health' -UseBasicParsing -TimeoutSec 2) | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
    if !errorlevel! equ 0 (
      set "BACKEND_READY=1"
    ) else (
      timeout /t 1 /nobreak >nul
    )
  )
)

if defined BACKEND_READY (
  echo       后端已就绪：%API_BASE%/health
) else (
  echo       [警告] 后端 30 秒内未就绪，请查看后端窗口的日志
)
echo.

rem —— 5. 启动前端（新窗口，独立进程） ——
echo [3/3] 启动前端开发服务器 http://localhost:%FRONTEND_PORT% ...
start "CircuitTutor 前端 (Vite:%FRONTEND_PORT%)" /D "%FRONTEND_DIR%" cmd /k "chcp 65001 >nul && npm.cmd run dev"

rem —— 6. 延迟后打开浏览器 ——
timeout /t 3 /nobreak >nul
start "" "http://localhost:%FRONTEND_PORT%"

echo.
echo ============================================================
echo   启动完成
echo     - 前端界面：http://localhost:%FRONTEND_PORT%
echo     - 后端接口：%API_BASE%/docs
echo   关闭弹出的两个服务窗口即可停止相应服务。
echo ============================================================
echo.
pause
endlocal