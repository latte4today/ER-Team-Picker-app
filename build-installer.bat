@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
call npm run package-win
if errorlevel 1 exit /b 1
call npm run installer-win
