@echo off
rem Double-click to start Redis and the storyboard Celery workers, each in its own window,
rem so "Generate All Scenes" runs through Celery. Close both windows to stop them.
rem
rem Redis is looked for in REDIS_DIR (default: the portable build in %LOCALAPPDATA%\Programs\Redis).
rem If Redis is already running it is left alone and only the workers are started.

setlocal
set "BACKEND=%~dp0"
if not defined REDIS_DIR set "REDIS_DIR=%LOCALAPPDATA%\Programs\Redis\Redis-8.10.3-Windows-x64-msys2"
set "PYTHON=%BACKEND%..\.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"

if not exist "%REDIS_DIR%\redis-server.exe" (
    echo Could not find redis-server.exe in:
    echo   %REDIS_DIR%
    echo Set REDIS_DIR to the folder that contains it, then run this again.
    pause
    exit /b 1
)

call :redis_up
if defined REDIS_UP (
    echo Redis is already running.
) else (
    echo Starting Redis...
    rem Full path for the exe (cmd may not search the current folder), but the config by name
    rem only: this Redis build can't read Windows paths, and the window already opens in REDIS_DIR.
    start "Redis" /d "%REDIS_DIR%" cmd /k ""%REDIS_DIR%\redis-server.exe" redis.conf"
    set /a TRIES=0
    goto wait_for_redis
)
goto start_workers

:wait_for_redis
call :redis_up
if defined REDIS_UP goto redis_ready
set /a TRIES+=1
if %TRIES% geq 15 (
    echo Redis did not start within 15 seconds. Check the "Redis" window for the error.
    pause
    exit /b 1
)
rem ping waits about a second; "timeout" fails when there is no console input to read.
ping -n 2 127.0.0.1 >nul
goto wait_for_redis

:redis_ready
echo Redis is running.

:start_workers
echo Starting the storyboard workers...
start "Storyboard workers" /d "%BACKEND%" cmd /k ""%PYTHON%" run_storyboard_workers.py"
echo.
echo Done. Keep the "Redis" and "Storyboard workers" windows open while you generate scenes.
echo The backend switches to Celery within 30 seconds (or right away if you restart it).
ping -n 6 127.0.0.1 >nul
exit /b 0

:redis_up
set "REDIS_UP="
for /f "usebackq delims=" %%R in (`"%REDIS_DIR%\redis-cli.exe" ping 2^>nul`) do (
    if "%%R"=="PONG" set "REDIS_UP=1"
)
exit /b 0
