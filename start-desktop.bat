@echo off
setlocal

cd /d "%~dp0"

set "APP_EXE="
if exist "release" (
  for /f "usebackq delims=" %%F in (`powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%~dp0release' -Recurse -Filter 'CSV Workspace Editor.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"`) do set "APP_EXE=%%F"
)

if defined APP_EXE (
  start "" "%APP_EXE%"
  exit /b 0
)

echo No packaged desktop exe was found. Starting the local Electron app...
npm run desktop
