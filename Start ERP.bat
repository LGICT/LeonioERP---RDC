@echo off
title Leonio ERP - Server (keep this window open)
cd /d "%~dp0"
rem The ERP always runs at http://localhost:8765/ (port 8090 is used by the iVMS-4200 CCTV software).
rem If the ERP is already running, just open it in the browser.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest 'http://localhost:8765/' -UseBasicParsing -TimeoutSec 3; if ($r.Content -match 'Leonio Group ERP') { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel%==0 (
  start "" "http://localhost:8765/"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8765
pause
