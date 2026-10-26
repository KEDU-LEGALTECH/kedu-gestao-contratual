param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$OcrRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$OcrVersion = & $Python -c "import sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor))"
if($LASTEXITCODE -ne 0 -or $OcrVersion -notmatch '^3\.(9|10|11|12|13)$'){throw 'Use Python 3.9 a 3.13 de 64 bits, preferencialmente 3.12. Informe o caminho com -Python.'}
Push-Location $OcrRoot
try {
 & $Python -m venv data/ocr-venv
 if($LASTEXITCODE -ne 0){throw 'Falha ao criar ambiente isolado.'}
 $OcrPython=Join-Path $OcrRoot 'data\ocr-venv\Scripts\python.exe'
 & $OcrPython -m pip install -r server/ocr/requirements.txt
 if($LASTEXITCODE -ne 0){throw 'Falha na instalação das dependências de OCR.'}
 & $OcrPython server/ocr/worker.py --setup
 if($LASTEXITCODE -ne 0){throw 'Falha na preparação dos modelos. O leitor anterior continua disponível.'}
} finally {Pop-Location}
