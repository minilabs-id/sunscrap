@echo off
rem ============================================================
rem  sunscrap — Jalankan lewat runtime Electron (bertanda tangan)
rem  Alasan: .exe hasil packaging kita belum ditandatangani sehingga
rem  Smart App Control / antivirus memblokirnya. Biner electron.exe
rem  adalah rilisan resmi Electron yang SUDAH ditandatangani, jadi SAC
rem  mengizinkannya. Ini solusi lokal tanpa menonaktifkan SAC.
rem ============================================================
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo [gagal] node_modules\electron tidak ditemukan. Jalankan dulu:
  echo         npm install
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0