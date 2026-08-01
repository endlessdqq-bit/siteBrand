@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   Zapusk vitriny magazina...
echo   Otkroyte v brauzere adres:  localhost:3000
echo   Chtoby ostanovit server - zakroyte eto okno.
echo.
node server.js
pause
