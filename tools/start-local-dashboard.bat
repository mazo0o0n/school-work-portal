@echo off
setlocal

cd /d "%~dp0.."

start "School Portal Local Server" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%CD%'; node local-server.cjs"

timeout /t 2 /nobreak >nul

start "" "%~dp0project-dashboard.html"

endlocal
exit /b 0
