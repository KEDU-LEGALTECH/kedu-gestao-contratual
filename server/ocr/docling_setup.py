"""Fetch only the official layout/table models. No document is read during setup."""
import json
import os
from pathlib import Path
import sys
from importlib.metadata import version

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'data' / 'docling-models'
os.environ['HF_HOME'] = str(CACHE / 'hf')
os.environ['OMP_NUM_THREADS'] = '2'
os.environ['MKL_NUM_THREADS'] = '2'
CACHE.mkdir(parents=True, exist_ok=True)

from docling.datamodel.pipeline_options import LayoutObjectDetectionOptions
from docling.models.utils.hf_model_download import download_hf_model
from docling.models.stages.table_structure.table_structure_model import TableStructureModel

spec = LayoutObjectDetectionOptions().model_spec
print('Baixando modelo oficial de layout...', flush=True)
download_hf_model(repo_id=spec.repo_id, revision=spec.revision, local_dir=CACHE / spec.repo_id.replace('/', '--'), progress=True)
print('Baixando modelo oficial de tabelas...', flush=True)
TableStructureModel.download_models(local_dir=CACHE / TableStructureModel._model_repo_folder, progress=True)
runtime = {'ready': True, 'python': sys.executable, 'models': str(CACHE), 'version': version('docling'), 'ocr': False, 'automaticEnabled': False}
(ROOT / 'data' / 'docling-runtime.json').write_text(json.dumps(runtime), encoding='utf-8')
print(json.dumps({'ready': True, 'version': runtime['version'], 'automaticEnabled': False}), flush=True)
