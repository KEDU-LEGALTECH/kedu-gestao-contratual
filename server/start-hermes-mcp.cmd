@echo off
setlocal
cd /d "%~dp0.."
set "PROJECT_PYTHON=%CD%\data\ocr-venv\Scripts\python.exe"
if exist "%PROJECT_PYTHON%" (
  "%PROJECT_PYTHON%" server\hermes_document_mcp.py
) else (
  py -3 server\hermes_document_mcp.py
)
