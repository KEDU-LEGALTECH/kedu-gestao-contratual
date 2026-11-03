"""One local PDF page; no URLs, OCR, remote services or expected GLPI values."""
import base64
import contextlib
import io
import json
import os
import sys
import threading
import time
from pathlib import Path

os.environ['OMP_NUM_THREADS'] = '2'
os.environ['MKL_NUM_THREADS'] = '2'
WIRE = sys.stdout
sys.stdin.reconfigure(encoding='utf-8')
WIRE.reconfigure(encoding='utf-8')
CONVERTER = None

if os.name == 'nt':
    # The Windows venv launcher creates a child interpreter. Follow the launcher
    # so a Node timeout also terminates this interpreter, not only its parent.
    import ctypes
    kernel = ctypes.windll.kernel32
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint]
    parent = kernel.OpenProcess(0x00100000, False, os.getppid())
    if parent:
        def parent_watchdog():
            kernel.WaitForSingleObject(parent, 0xFFFFFFFF)
            os._exit(0)
        threading.Thread(target=parent_watchdog, daemon=True).start()


def memory_watchdog():
    if os.name != 'nt':
        return
    import ctypes
    class Memory(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in ['total_phys', 'avail_phys', 'total_page', 'avail_page', 'total_virtual', 'avail_virtual', 'avail_extended']]
    while True:
        status = Memory()
        status.length = ctypes.sizeof(status)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)) and status.avail_phys < 512 * 1024**2:
            os._exit(75)
        time.sleep(.25)


def table_rows(item, document):
    """Preserve native cells when a complex/merged table cannot become a DataFrame."""
    try:
        table = item.export_to_dataframe(doc=document)
        header = [str(v).strip() for v in table.columns]
        rows = [list(row) for row in table.itertuples(index=False, name=None)]
        if any(v and not v.isdigit() for v in header):
            rows.insert(0, header)
        return [[str(value).strip() for value in row] for row in rows]
    except (ValueError, IndexError, KeyError):
        groups = {}
        for cell in getattr(getattr(item, 'data', None), 'table_cells', []):
            if isinstance(getattr(cell, 'text', None), str):
                groups.setdefault(cell.start_row_offset_idx, []).append((cell.start_col_offset_idx, cell.text.strip()))
        return [[value for _, value in sorted(groups[row])] for row in sorted(groups)]


def convert(payload):
    global CONVERTER
    page = payload['page']
    if not isinstance(page, int) or not 1 <= page <= 200:
        raise ValueError('Página inválida')
    pdf = base64.b64decode(payload['bytes'], validate=True)
    if not pdf.startswith(b'%PDF-') or len(pdf) > 20 * 1024**2:
        raise ValueError('PDF inválido')
    # Avoid loading layout models for an image-only page: the existing OCR is
    # the appropriate reader, and no text can be recovered by this native pilot.
    import pypdfium2
    native = pypdfium2.PdfDocument(pdf)
    try:
        if page > len(native):
            return {'text': '', 'items': [], 'nativeText': True}
        native_page = native[page - 1]
        try:
            text_page = native_page.get_textpage()
            try:
                native_text = text_page.get_text_range()
            finally:
                text_page.close()
        finally:
            native_page.close()
        if len(native_text.strip()) < 20:
            return {'text': '', 'items': [], 'nativeText': True}
    finally:
        native.close()
    from docling.datamodel.base_models import InputFormat, DocumentStream
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.datamodel.accelerator_options import AcceleratorOptions, AcceleratorDevice
    from docling.document_converter import DocumentConverter, PdfFormatOption
    options = PdfPipelineOptions(artifacts_path=Path(os.environ['DOCLING_MODELS']))
    options.do_ocr = False
    options.do_table_structure = True
    options.enable_remote_services = False
    options.generate_page_images = False
    options.generate_picture_images = False
    for key in ['do_picture_classification', 'do_picture_description', 'do_code_enrichment', 'do_formula_enrichment']:
        if hasattr(options, key):
            setattr(options, key, False)
    options.document_timeout = 60
    options.accelerator_options = AcceleratorOptions(num_threads=2, device=AcceleratorDevice.CPU)
    for key in ['layout_batch_size', 'table_batch_size', 'queue_max_size']:
        if hasattr(options, key):
            setattr(options, key, 1)
    if CONVERTER is None:
        CONVERTER = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
    converter = CONVERTER
    result = converter.convert(DocumentStream(name='documento.pdf', stream=io.BytesIO(pdf)), page_range=(page, page), max_file_size=20 * 1024**2)
    if str(result.status.value) != 'success':
        raise ValueError('Leitura incompleta do Docling')
    document = result.document
    lines, items = [], []
    for item, _level in document.iterate_items():
        provenance = getattr(item, 'prov', [])
        if not any(p.page_no == page for p in provenance):
            continue
        if getattr(item, 'label', None) and str(item.label.value) == 'table':
            # Preserve every row and column. A label/value pair remains adjacent.
            for row in table_rows(item, document):
                cells = [str(v).strip() for v in row]
                text = (cells[0].rstrip(':') + ': ' + cells[1]) if len(cells) == 2 else ' | '.join(cells)
                lines.append(text)
                items.append({'text': text, 'page': page})
        elif hasattr(item, 'text') and item.text.strip():
            lines.append(item.text.strip())
            items.append({'text': item.text.strip(), 'page': page})
    return {'text': '\n'.join(lines)[:500000], 'items': items[:10000], 'nativeText': True}


if __name__ == '__main__':
    threading.Thread(target=memory_watchdog, daemon=True).start()
    requests = sys.stdin if '--persistent' in sys.argv else [sys.stdin.read(30_000_000)]
    for request in requests:
        try:
            if len(request) > 30_000_000:
                raise ValueError('Entrada excedeu o limite')
            payload = json.loads(request)
            with contextlib.redirect_stdout(sys.stderr):
                response = convert(payload)
        except Exception as exc:
            response = {'error': 'Docling não concluiu a página: ' + type(exc).__name__, 'detail': str(exc)[:500]}
        try:
            import psutil
            memory = psutil.Process().memory_info()
            response['peakMemoryMB'] = round(getattr(memory, 'peak_wset', memory.rss) / 1024**2)
        except Exception:
            pass
        WIRE.write(json.dumps(response, ensure_ascii=False) + '\n')
        WIRE.flush()
