@echo off
setlocal
set "HERMES_HOME=%~dp0data\hermes-local-profile"
set "HERMES_PYTHON=%USERPROFILE%\AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\hermes\installs\fa1ef5dda278ba54\environments\7a843ffbcd8940aa9d3cb1b9a29ba6fd\venv\Scripts\python.exe"
if not exist "%HERMES_PYTHON%" (
  echo Nao foi encontrada a instalacao do Hermes neste computador.
  pause
  exit /b 1
)
cd /d "%~dp0"
if "%~1"=="" (
  "%HERMES_PYTHON%" "%~dp0scripts\hermes-documents.py" chat --cli
) else (
  "%HERMES_PYTHON%" "%~dp0scripts\hermes-documents.py" %*
)
if errorlevel 1 (
  echo.
  echo O Hermes encerrou com erro. Confira a mensagem acima.
  pause
  exit /b 1
)
