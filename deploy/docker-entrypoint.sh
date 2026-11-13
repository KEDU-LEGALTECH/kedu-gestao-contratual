#!/bin/sh
# Prepares the PaddleOCR models on first start, inside the persistent data volume.
# The same setup as server/ocr/setup.ps1: models are checked with a test inference before
# data/ocr-runtime.json is marked ready. If it fails, the server still starts and reads with Tesseract.
set -eu
runtime=${KEDU_OCR_RUNTIME:-/app/data/ocr-runtime.json}
if [ "${OCR_ENGINE:-}" != "legacy" ] && ! grep -q '"ready": true' "$runtime" 2>/dev/null; then
  echo "Preparando modelos do PaddleOCR (somente na primeira inicialização)..."
  if ! /opt/ocr-venv/bin/python -u /app/server/ocr/worker.py --setup; then
    echo "AVISO: PaddleOCR não foi preparado. O servidor continua com Tesseract; confira a rede de saída e reinicie para tentar de novo." >&2
  fi
fi
exec "$@"
