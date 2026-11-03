"""Export a read-only snapshot of GLPI attachments for local Hermes inspection."""
import json
import re
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = root / "data" / "hermes-documents"
out.mkdir(parents=True, exist_ok=True)
db = sqlite3.connect((root / "data" / "kedu.sqlite").as_uri() + "?mode=ro", uri=True)
index = []
try:
    for file_id, name, content, extracted in db.execute(
        "SELECT id, name, bytes, extracted FROM processing_files"
    ):
        folder = out / re.sub(r"[^a-zA-Z0-9_-]", "_", str(file_id))
        folder.mkdir(exist_ok=True)
        safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name or "documento")
        original = folder / safe_name
        if content:
            original.write_bytes(content)
        try:
            reading = json.loads(extracted or "{}")
        except (ValueError, TypeError):
            reading = {}
        text_path = folder / "texto-extraido.txt"
        text_path.write_text(reading.get("text", "") or "", encoding="utf-8")
        index.append({"id": file_id, "name": name,
                      "original": str(original) if content else None,
                      "text": str(text_path)})
finally:
    db.close()
(out / "indice.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"{len(index)} anexos catalogados em {out}. Banco aberto somente para leitura.")
