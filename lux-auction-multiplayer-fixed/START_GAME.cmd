@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js chua duoc cai dat. Hay cai Node.js 20 tro len roi thu lai.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Dang cai dat cac thanh phan can thiet. Qua trinh nay co the mat vai phut...
  call npm.cmd install
  if errorlevel 1 (
    echo Cai dat that bai. Vui long kiem tra ket noi mang va thu lai.
    pause
    exit /b 1
  )
)

echo Dang chuan bi game. Trinh duyet se chi mo khi game da san sang...
call npm.cmd run build
if errorlevel 1 (
  echo Build game that bai. Hay chup phan loi phia tren neu can ho tro.
  pause
  exit /b 1
)

start "Game readiness check" /min powershell.exe -NoProfile -Command "$health='http://127.0.0.1:3000/api/health'; for ($i=0; $i -lt 120; $i++) { try { $response=Invoke-RestMethod -Uri $health -TimeoutSec 1; if ($response.ok -eq $true) { Start-Process 'http://127.0.0.1:3000'; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 }; exit 1"

echo Giu cua so nay mo trong khi choi. Nhan Ctrl+C de dung game.
call npm.cmd start

echo.
echo Game da dung hoac gap loi. Hay chup phan loi phia tren neu can ho tro.
pause
