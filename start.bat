
@echo off
echo Starting ÐÇÃß...
echo.

echo [1/2] Starting Vite dev server...
start "Vite" cmd /c "cd /d "%~dp0" && npm run dev"

echo [2/2] Waiting for dev server...
timeout /t 5 /nobreak >nul

echo [3/3] Starting Tauri app...
start "Tauri" cmd /c "cd /d "%~dp0" && npx tauri dev"

echo.
echo ÐÇÃß is running! Close this window anytime.


