@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 goto failed
where node.exe >nul 2>&1
if errorlevel 1 goto missing
node scripts\start-local.mjs
if errorlevel 1 goto failed
exit /b 0
:missing
echo Node.js was not found. Install Node.js LTS ^(npm is included^):
echo https://nodejs.org/en/download
:failed
echo.
pause
exit /b 1
