@echo off
setlocal
cd /d "%~dp0"
set "DOCUMENT_PATH=%~1"
if not defined DOCUMENT_PATH set /p "DOCUMENT_PATH=Cole o caminho da imagem do projeto e pressione Enter: "
set "DOCUMENT_PATH=%DOCUMENT_PATH:"=%"
call node_modules\.bin\tsx.cmd server\read-local-image.ts "%DOCUMENT_PATH%"
echo.
pause
