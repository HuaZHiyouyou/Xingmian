@echo off
title xingmian Launcher
echo ============================================
echo          xingmian Launcher
echo ============================================
echo.

REM --- check Node.js ---
call node --version > tmpchk1.tmp 2>&1
set /p NODE_VER=< tmpchk1.tmp
del /q tmpchk1.tmp 2>&1

if "%NODE_VER%"=="" goto err_npm
echo [OK] %NODE_VER%
goto chk_rust

:err_npm
echo [ERR] Node.js not found, install from https://nodejs.org/
pause
exit /b 1

:chk_rust

call rustc --version > tmpchk2.tmp 2>&1
set /p RUST_VER=< tmpchk2.tmp
del /q tmpchk2.tmp 2>&1

if "%RUST_VER%"=="" goto warn_rust
echo [OK] %RUST_VER%
goto chk_deps

:warn_rust
echo [WARN] Rust not found, install from https://rustup.rs/

:chk_deps

if exist "node_modules\.package-lock.json" goto deps_ok
echo.
echo [1/3] First-time npm install...
call npm install
if %ERRORLEVEL% NEQ 0 goto err_npm2
echo [OK] npm dependencies installed
goto deps_ok

:err_npm2
echo [ERR] npm install failed
pause
exit /b 1

:deps_ok
echo [OK] node_modules ready

if not exist "src-tauri\target\debug\app.exe" goto need_rust
echo [OK] Rust already compiled
goto launch

:need_rust
echo.
echo [2/3] First-time Rust compilation (about 3-5 min)...
pushd src-tauri
call cargo build
popd
if %ERRORLEVEL% NEQ 0 goto err_rust
echo [OK] Rust compilation done
goto launch

:err_rust
echo [ERR] Rust compilation failed
pause
exit /b 1

:launch

echo.
echo [3/3] Starting xingmian...
echo.
echo   WebView2 will be downloaded on first run
echo   The app window will open automatically
echo.

call npx tauri dev

echo.
echo xingmian exited.
pause
