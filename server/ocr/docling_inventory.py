"""Inventory native PDF pages from a snapshot. Never reads GLPI reference values."""
import json
from pathlib import Path
import sqlite3
import sys
import pypdfium2

database, selection, output = sys.argv[1:]
connection = sqlite3.connect(Path(database).as_uri() + '?mode=ro', uri=True)
results = []
for entry in json.loads(Path(selection).read_text(encoding='utf-8')):
    row = connection.execute('SELECT bytes FROM processing_files WHERE id=?', (entry['id'],)).fetchone()
    record = {'id': entry['id'], 'pages': []}
    try:
        doc = pypdfium2.PdfDocument(row[0])
        try:
            if len(doc) > 200:
                raise ValueError('PDF excede 200 páginas')
            for page_no in range(len(doc)):
                page = doc[page_no]
                try:
                    text_page = page.get_textpage()
                    try:
                        text = text_page.get_text_range()
                    finally:
                        text_page.close()
                finally:
                    page.close()
                record['pages'].append({'page': page_no + 1, 'text': text[:100000]})
        finally:
            doc.close()
    except Exception as exc:
        record['error'] = type(exc).__name__ + ': ' + str(exc)[:200]
    results.append(record)
connection.close()
Path(output).write_text(json.dumps(results, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'files': len(results), 'nativePages': sum(sum(len(p['text'].strip()) >= 20 for p in r['pages']) for r in results)}))
