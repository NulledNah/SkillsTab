@echo off
setlocal
echo.
echo  SkillsTab - installazione
echo  Chiudi OpenCode. Questo installer attende la chiusura, applica la patch
echo  e riapre l'app automaticamente.
echo.
:wait
tasklist /FI "IMAGENAME eq OpenCode.exe" /NH 2>nul | find /I "OpenCode.exe" >nul
if not errorlevel 1 (
  timeout /t 2 /nobreak >nul
  goto wait
)
node "%~dp0apply.js" install
if errorlevel 1 (
  echo.
  echo Installazione fallita.
  pause
  exit /b 1
)
start "" "%LOCALAPPDATA%\Programs\@opencode-aidesktop\OpenCode.exe"
endlocal
