param([string]$Python = '')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Set-Location -LiteralPath $projectRoot
if (-not $Python) {
    $ocrRuntime = Join-Path $projectRoot 'data/ocr-runtime.json'
    if (-not (Test-Path -LiteralPath $ocrRuntime)) { throw 'Informe -Python com o executável de Python 3.12.' }
    $Python = (Get-Content -LiteralPath $ocrRuntime -Raw | ConvertFrom-Json).python
}
$venv = Join-Path $projectRoot 'data/docling-venv'
$readerPython = Join-Path $venv 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $readerPython)) {
    & $Python -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível criar o ambiente isolado.' }
}
& $readerPython -m pip install --no-compile --disable-pip-version-check -r (Join-Path $PSScriptRoot 'requirements-docling.txt')
if ($LASTEXITCODE -ne 0) { throw 'A instalação do Docling não terminou.' }
& $readerPython (Join-Path $PSScriptRoot 'docling_setup.py')
if ($LASTEXITCODE -ne 0) { throw 'A preparação dos modelos não terminou.' }
Write-Output 'Docling preparado para piloto local. A leitura automática permanece desativada.'
