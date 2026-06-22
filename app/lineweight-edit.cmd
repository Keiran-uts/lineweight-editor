@echo off
REM One-click launcher for the LineWeight Editor.
REM Starts the local bridge + UI and opens the app in your browser.
cd /d "%~dp0"
if not exist "node_modules" (
  echo Installing dependencies the first time...
  call npm install
)
call npm start
