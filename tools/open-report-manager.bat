@echo off
setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the local report manager.
  pause
  exit /b 1
)

cd /d "%~dp0.."
start "Report Manager Server" /min cmd /c node "%~dp0report-manager-server.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4174"

endlocal
