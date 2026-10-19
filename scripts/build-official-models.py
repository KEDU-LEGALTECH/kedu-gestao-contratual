"""Adapt the eight supplied Canva PDFs into flowing Word templates for automation.

No legal prose is generated or rewritten: every word comes from the supplied PDF.
Only the placeholders of the Canva model are replaced by locked Word content controls
(tag "kedu:<campo>") and positioned boxes become shaded paragraphs/tables, which the
application's safe reader accepts. Visual homologation remains mandatory.

Usage (from the project root, with the local conversion dependencies):
  python -I scripts/build-official-models.py   (requer python-docx 1.2 e PyMuPDF)
Sources: data/canva-conversion/qa/<Nome>.pdf and sources.json (not versioned).
"""
import sys, re, json, hashlib
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
try:
    import pymupdf as fitz, docx  # noqa: F401
except ImportError:  # local conversion bundle (Python 3.12)
    sys.path.insert(0, str(root / 'data/canva-conversion/deps'))
    import pymupdf as fitz  # noqa: E402
from docx import Document  # noqa: E402
from docx.shared import Pt, RGBColor  # noqa: E402
from docx.oxml import OxmlElement  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH  # noqa: E402

QA = root / 'data/canva-conversion/qa'
OUT = root / 'templates/official'
TEXT, BAR, BOX = '24385F', '203256', 'F1F7FC'

# Canva placeholder -> application field. Longer labels first so that, e.g.,
# "TAXA POR EXTENSO" is never consumed by "TAXA".
PLACEHOLDERS = {
    'RAZÃO SOCIAL': 'razaoSocial', 'NOME FANTASIA': 'nomeFantasia', 'CNPJ': 'cnpj', 'RUA': 'rua',
    'Nº': 'numero', 'BAIRRO': 'bairro', 'CIDADE': 'cidade', 'ESTADO': 'estado', 'CEP': 'cep',
    'NOME REPRESENTANTE': 'representanteNome', 'CPF REPRESENTANTE': 'representanteCpf',
    'TAXA POR EXTENSO': 'taxaExtenso', 'TAXA': 'remuneracao', 'BANCO': 'banco', 'AGENCIA': 'agencia',
    'C.C.': 'conta', 'TITULAR': 'titularConta', 'CNPJ/CPF CONTA': 'documentoTitular', 'PIX': 'pix',
    'CASHBACK': 'cashbackValor', 'ALUNOS': 'alunos', 'INCORPORA MATRÍCULA': 'incorporaMatricula',
    'FATURAMENTO POR EXTENSO': 'valorExtenso', 'FATURAMENTO': 'valor',
    'MESES POR EXTENSO': 'duracaoExtenso', 'MESES': 'duracaoMeses',
    'Nº DE PARCELAS POR EXTENSO': 'parcelasExtenso', 'Nº DE PARCELAS': 'parcelas',
    'DIA DO PRIMEIRO REPASSE POR EXTENSO': 'diaRepasseExtenso', 'DIA DO PRIMEIRO REPASSE': 'diaRepasse',
    'PORCENTAGEM DO PRIMEIRO REPASSE POR EXTENSO': 'repasseExtenso',
    'PORCENTAGEM DO PRIMEIRO REPASSE': 'repasse',  # a trailing "%" is absorbed (see convert)
    'MÊS INICIO DE VIGENCIA': 'inicioMes', 'ANO INICIO DE VIGENCIA': 'inicioAno',
    'MÊS FIM DE VIGENCIA': 'fimMes', 'ANO FIM DE VIGENCIA': 'fimAno',
}
COMMON = [
    (r'\(DIGITAR O Nº ORDINAL DO ADITIVO\)', '{ordinalAditivo}'),
    (r'\[DATA DE ASSINATURA DO CONTRATO MATRIZ\s*\]', '{dataAssinaturaMatrizExtenso}'),
    (r'dia de mês de ano\.', '{dataFormalizacaoExtenso}.'),
    # Free-day term wording (vigência addendum and Garantia Prevista).
    (r'XX de MÊS de ANO', '{inicioExtenso}'), (r'DIA de MÊS de ANO', '{fimExtenso}'),
    (r'QUANTIDADE DE MESES \(POR EXTENSO\)', '{duracaoMeses} ({duracaoExtenso})'),
]
SPECIFIC = {
    'Aditivo_Cashback': [(r'(CashBack:\s*)x+', r'\1{cashbackValor}')],
    # "TITULAR DA CONTA" must be resolved before the shorter "CONTA" label.
    'Aditivo_Conta_Bancaria': [
        (r'TITULAR DA CONTA:\s*X+', 'TITULAR DA CONTA: {titularConta}'), (r'BANCO:\s*X+', 'BANCO: {banco}'),
        (r'AGÊNCIA:\s*X+', 'AGÊNCIA: {agencia}'), (r'(?<!DA )CONTA:\s*X+', 'CONTA: {conta}'),
        (r'CNPJ/CPF:\s*X+', 'CNPJ/CPF: {documentoTitular}')],
    'Aditivo_Data_Percentual_Repasse': [
        (r'XX \(QUANTIDADE POR EXTENSO\)', '{parcelas} ({parcelasExtenso})'),
        (r'XX% \(PORCENTAGEM POR EXTENSO\)(.*?)XX \(DIA POR EXTENSO\)(.*?)XX% \(PORCENTAGEM POR EXTENSO\)(.*?)XX \(DIA POR EXTENSO\)',
         r'{repasse} ({repasseExtenso})\1{diaRepasse} ({diaRepasseExtenso})\2{repasseSegundo} ({repasseSegundoExtenso})\3{diaSegundoRepasse} ({diaSegundoRepasseExtenso})')],
    'Contrato_Garantia_Prevista': [
        (r'\(Percentual conforme tabela enviada\)%', '{garantia}'),
        (r'XX% \(PORCENTAGEM POR EXTENSO\)', '{percentualRestante} ({restanteExtenso})')],
}
SUBTYPES = {'Aditivo_Vigencia': 'Vigência', 'Aditivo_Cashback': 'Cashback', 'Aditivo_Conta_Bancaria': 'Conta bancária',
            'Aditivo_Taxa_Remuneracao': 'Taxa de remuneração', 'Aditivo_Data_Percentual_Repasse': 'Percentual/data de repasse'}
TITLES = {'Aditivo_Vigencia': 'Aditivo de alteração de vigência', 'Aditivo_Cashback': 'Aditivo de alteração de cashback',
          'Aditivo_Conta_Bancaria': 'Aditivo de alteração de conta bancária',
          'Aditivo_Taxa_Remuneracao': 'Aditivo de alteração da taxa de remuneração',
          'Aditivo_Data_Percentual_Repasse': 'Aditivo de alteração de data e percentual de repasse',
          'Contrato_Garantia_Completa': 'Contrato — Garantia Completa', 'Contrato_Garantia_Conjunta': 'Contrato — Garantia Conjunta',
          'Contrato_Garantia_Prevista': 'Contrato — Garantia Prevista'}


def sub(text, bolds, pattern, repl):
    """re.sub that keeps a parallel per-character bold list aligned."""
    out, flags, last = [], [], 0
    for m in re.finditer(pattern, text):
        out.append(text[last:m.start()]); flags.extend(bolds[last:m.start()])
        new = m.expand(repl); out.append(new); flags.extend([bolds[m.start()] if m.start() < len(bolds) else False] * len(new))
        last = m.end()
    out.append(text[last:]); flags.extend(bolds[last:])
    return ''.join(out), flags


def convert(name, text, bolds):
    text, bolds = sub(text, bolds, r'\s+', ' ')
    for pattern, repl in COMMON + SPECIFIC.get(name, []):
        text, bolds = sub(text, bolds, pattern, repl)
    # Contracts print "{{PORCENTAGEM ...}}%"; the field value already carries the sign (e.g. 92,30%).
    text, bolds = sub(text, bolds, r'(\{\{\s*PORCENTAGEM DO PRIMEIRO REPASSE\s*\}\})%', r'\1')
    for label in sorted(PLACEHOLDERS, key=len, reverse=True):
        text, bolds = sub(text, bolds, r'\{\{\s*' + re.escape(label) + r'\s*\}\}', '{' + PLACEHOLDERS[label] + '}')
    lead = len(text) - len(text.lstrip())
    stripped = text.strip()
    return stripped, bolds[lead:lead + len(stripped)]


def is_bold(span):
    return bool(span['flags'] & 16) or bool(re.search(r'Bold|Black|Heavy', span['font']))


def page_lines(page):
    lines = []
    # Canva list bullets are tiny vector dots, not characters.
    dots = [d['rect'] for d in page.get_drawings() if d['rect'].width < 4 and d['rect'].height < 4]
    for block in page.get_text('dict', sort=True)['blocks']:
        if block['type'] != 0:
            continue
        for line in block['lines']:
            spans = [s for s in line['spans'] if s['text']]
            if not spans or not ''.join(s['text'] for s in spans).strip():
                continue
            x0, y0, x1, _ = line['bbox']
            if y0 > page.rect.height - 40:  # graphic footer and page number
                continue
            color = spans[0]['color']
            lines.append({'x0': x0, 'y0': y0, 'x1': x1, 'size': spans[0]['size'],
                          'title': 'Condensed' in spans[0]['font'] or spans[0]['size'] >= 13,
                          'label': color in (0xffffff, 0xfffcfa) and spans[0]['size'] >= 7.9,
                          'bullet': any(x0 - 14 < d.x0 < x0 and y0 - 2 < d.y0 < line['bbox'][3] for d in dots),
                          'spans': [(s['text'], is_bold(s)) for s in spans]})
    return lines


def hard_break(prev, right_edge):
    """A line ending well before the margin with closing punctuation is an explicit break."""
    text = ''.join(t for t, _ in prev['spans']).rstrip()
    gap = right_edge - prev['x1']
    return (gap > 45 and re.search(r'[.;:!?)\]]$', text) is not None) or gap > 0.45 * (right_edge - prev['x0'])


def paragraphs_from(lines, right_edge):
    """Group visual lines into paragraphs. A short line (hard break) or a larger gap ends a paragraph."""
    items, current, prev = [], None, None
    # Lines whose tops differ by a few points belong to the same visual row
    # (e.g. a bold clause number printed beside the first line of its text).
    ordered, row, start = [], -1, None
    for line in sorted(lines, key=lambda l: l['y0']):
        if start is None or line['y0'] - start > 3.5:
            row, start = row + 1, line['y0']
        ordered.append((row, line['x0'], line))
    lines = [l for _, _, l in sorted(ordered, key=lambda t: (t[0], t[1]))]
    i = 0
    while i < len(lines):
        line = lines[i]
        text = ''.join(t for t, _ in line['spans']).strip()
        number = re.fullmatch(r'\d{1,2}(?:\.\d{1,2}){1,3}\.?', text)
        if number and line['x0'] < 70:
            # Clause number printed in its own column; the text starts on the same baseline.
            current = {'spans': [], 'number': text, 'indent': True}
            items.append(current); prev = None; i += 1; continue
        field_line = re.match(r'[A-Za-zÀ-ú/. ]{2,30}:\s*(\{\{|X{2,}|x{3,})', text)
        new = (prev is None or field_line or line.get('bullet') or line['y0'] - prev['y0'] > prev['size'] * 1.9
               or hard_break(prev, right_edge) or abs(line['x0'] - prev['x0']) > 12)
        if current is not None and current.get('number') is not None and not current['spans']:
            new = False
        if new:
            current = {'spans': [], 'number': None, 'bullet': line.get('bullet', False),
                       'indent': line['x0'] > (min(l['x0'] for l in lines) + 8)}
            items.append(current)
        elif current['spans']:
            current['spans'].append((' ', current['spans'][-1][1]))
        current['spans'].extend(line['spans'])
        prev = line; i += 1
    return [p for p in items if p['spans'] or p['number']]


class Builder:
    def __init__(self, name):
        self.name, self.slots, self.source_text = name, [], []
        self.doc = Document()
        s = self.doc.sections[0]
        s.page_width, s.page_height = Pt(595.28), Pt(841.89)
        s.top_margin = s.bottom_margin = Pt(28); s.left_margin = s.right_margin = Pt(34)
        normal = self.doc.styles['Normal']
        normal.font.name = 'Arial'; normal.font.size = Pt(8.5); normal.font.color.rgb = RGBColor.from_string(TEXT)
        normal.paragraph_format.space_after = Pt(5); normal.paragraph_format.line_spacing = 1.08

    def fill(self, paragraph, spans):
        raw = ''.join(t for t, _ in spans)
        bolds = [b for t, b in spans for _ in t]
        self.source_text.append(re.sub(r'\s+', ' ', raw).strip())
        text, bolds = convert(self.name, raw, bolds)
        unresolved = re.findall(r'\{\{[^}]*\}\}|\bX{2,}\b|\bx{3,}\b|\[(?:DATA|DIGITAR)[^\]]*\]', text)
        if unresolved:
            raise ValueError((self.name, 'Placeholder sem mapeamento', unresolved, text))
        pos = 0
        for part in re.split(r'(\{[A-Za-z]+\})', text):
            if not part:
                continue
            flags = (bolds[pos:pos + len(part)] + [False] * len(part))[:len(part)]
            pos += len(part)
            if re.fullmatch(r'\{[A-Za-z]+\}', part):
                self.control(paragraph, part[1:-1], flags[0])
                continue
            # Literal text keeps the source's bold changes as separate runs.
            start = 0
            for i in range(1, len(part) + 1):
                if i == len(part) or flags[i] != flags[start]:
                    paragraph.add_run(part[start:i]).bold = flags[start]
                    start = i
        return paragraph

    def control(self, paragraph, key, bold):
        self.slots.append(key)
        sdt = OxmlElement('w:sdt'); pr = OxmlElement('w:sdtPr'); tag = OxmlElement('w:tag')
        tag.set(qn('w:val'), 'kedu:' + key); pr.append(tag)
        lock = OxmlElement('w:lock'); lock.set(qn('w:val'), 'sdtLocked'); pr.append(lock); sdt.append(pr)
        content = OxmlElement('w:sdtContent'); run = OxmlElement('w:r')
        if bold:
            rpr = OxmlElement('w:rPr'); rpr.append(OxmlElement('w:b')); run.append(rpr)
        t = OxmlElement('w:t'); t.set(qn('xml:space'), 'preserve'); t.text = '{' + key + '}'
        run.append(t); content.append(run); sdt.append(content); paragraph._p.append(sdt)

    @staticmethod
    def shade(paragraph, fill, padding=3):
        # Same-coloured borders give the shaded paragraph inner padding, like the Canva boxes.
        ppr = paragraph._p.get_or_add_pPr(); borders = OxmlElement('w:pBdr')
        for edge in ('top', 'left', 'bottom', 'right'):
            el = OxmlElement('w:' + edge); el.set(qn('w:val'), 'single'); el.set(qn('w:sz'), '4')
            el.set(qn('w:space'), str(padding)); el.set(qn('w:color'), fill); borders.append(el)
        ppr.append(borders)
        shd = OxmlElement('w:shd')
        shd.set(qn('w:val'), 'clear'); shd.set(qn('w:color'), 'auto'); shd.set(qn('w:fill'), fill); ppr.append(shd)

    def label(self, container, spans):
        p = container.add_paragraph(); p.paragraph_format.space_before = Pt(8); p.paragraph_format.space_after = Pt(4)
        self.fill(p, [(t.strip() if i == 0 else t, False) for i, (t, _) in enumerate(spans)])
        for r in p.runs:
            r.font.color.rgb = RGBColor.from_string('FFFFFF'); r.font.size = Pt(9.5)
        self.shade(p, BAR)
        return p

    def body(self, container, items, boxed=True):
        for index, item in enumerate(items):
            p = container.add_paragraph()
            if boxed:
                self.shade(p, BOX)
                p.paragraph_format.space_after = Pt(8 if index == len(items) - 1 else 2)
            if item['number']:
                p.paragraph_format.left_indent = Pt(26); p.paragraph_format.first_line_indent = Pt(-26)
                lead = p.add_run(item['number'] + '\t'); lead.bold = True
                self.source_text.append(item['number'])
            elif item.get('bullet'):
                p.paragraph_format.left_indent = Pt(18); p.paragraph_format.first_line_indent = Pt(-9)
                p.add_run('•\t')
            elif item['indent'] and boxed:
                p.paragraph_format.left_indent = Pt(10)
            self.fill(p, item['spans'])

    def notice(self):
        p = self.doc.add_paragraph(); p.paragraph_format.space_after = Pt(4)
        self.control(p, 'avisoHomologacao', True)
        for r in p._p.iter(qn('w:r')):
            rpr = r.find(qn('w:rPr'))
            color = OxmlElement('w:color'); color.set(qn('w:val'), 'B42318'); rpr.append(color)

    def page(self, page, first):
        lines = page_lines(page)
        width = page.rect.width
        right_edge = max((l['x1'] for l in lines if not l['label']), default=width - 40)
        if first:
            logo = self.doc.add_paragraph(); run = logo.add_run('kedu›'); run.bold = True; run.font.size = Pt(22)
            run.font.color.rgb = RGBColor.from_string('5B9BD5'); logo.paragraph_format.space_after = Pt(2)
            self.notice()
        titles = [l for l in lines if l['title']]
        if titles:
            p = self.doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            self.fill(p, [s for i, l in enumerate(titles) for s in ([(' ', True)] if i else []) + l['spans']])
            for r in p.runs:
                r.font.size = Pt(11)
        rest = [l for l in lines if not l['title']]
        labels = sorted([l for l in rest if l['label']], key=lambda l: (round(l['y0']), l['x0']))
        place = [l['y0'] for l in rest if not l['label'] and ''.join(t for t, _ in l['spans']).startswith('Fortaleza,')]
        body_labels = [l for l in labels if not (place and l['y0'] > place[0])]
        signature_labels = [l for l in labels if place and l['y0'] > place[0]]
        split = min((l['x0'] for l in body_labels if l['x0'] > width * 0.45), default=width) - 10
        column = lambda item: 1 if item['x0'] >= split else 0
        first_label = min((l['y0'] for l in labels), default=10_000)
        self.loose([l for l in rest if not l['label'] and l['y0'] < first_label], right_edge)

        def end_of(label, limit=10_000):
            later = [m['y0'] for m in body_labels if m['y0'] > label['y0'] + 3 and column(m) == column(label)]
            return min(later + [limit])

        # Boxes are grouped in vertical bands; a band has two columns when boxes sit side by side.
        bands, pending = [], list(body_labels)
        while pending:
            band = [pending.pop(0)]
            bottom = end_of(band[0])
            changed = True
            while changed:
                changed = False
                for m in list(pending):
                    if m['y0'] < bottom - 3:
                        band.append(m); pending.remove(m); bottom = max(bottom, end_of(m)); changed = True
            bands.append(band)
        stop = signature_labels[0]['y0'] if signature_labels else 10_000
        for index, band in enumerate(bands):
            band_end = bands[index + 1][0]['y0'] if index + 1 < len(bands) else stop
            free = [l for l in rest if not l['label'] and band[0]['y0'] < l['y0'] < band_end]
            if len({column(l) for l in band}) == 1:
                label = band[0]
                content, after = self.split_box(free, right_edge)
                self.label(self.doc, label['spans'])
                self.body(self.doc, paragraphs_from(content, right_edge))
                self.loose(after, right_edge)
                continue
            table = self.doc.add_table(rows=1, cols=2); table.autofit = True
            for side, cell in enumerate(table.rows[0].cells):
                cell._tc.remove(cell.paragraphs[0]._p)
                for label in sorted([l for l in band if column(l) == side], key=lambda l: l['y0']):
                    bottom = min(end_of(label), band_end)
                    lines = [l for l in free if column(l) == side and label['y0'] < l['y0'] < bottom]
                    edge = max((l['x1'] for l in lines), default=right_edge)
                    self.label(cell, label['spans'])
                    self.body(cell, paragraphs_from(lines, edge))
        if signature_labels:
            for label in sorted(signature_labels, key=lambda l: (l['y0'], l['x0'])):
                # Signature bars of the Canva model: kept as signature lines with the same captions.
                line = self.doc.add_paragraph(); line.paragraph_format.space_before = Pt(22)
                line.paragraph_format.space_after = Pt(0); line.add_run('_' * 52)
                self.fill(self.doc.add_paragraph(), [(t.strip(), True) for t, _ in label['spans']])
            self.loose([l for l in rest if not l['label'] and l['y0'] > signature_labels[0]['y0']], right_edge)

    def split_box(self, region, right_edge):
        """Box content is the first paragraph group under the label; later groups are free text."""
        if not region:
            return [], []
        ordered = sorted(region, key=lambda l: l['y0'])
        box, cut = [ordered[0]], None
        for prev, line in zip(ordered, ordered[1:]):
            if line['y0'] - prev['y0'] > prev['size'] * 2.6:
                cut = line['y0']; break
            box.append(line)
        if cut is None:
            return ordered, []
        return box, [l for l in ordered if l['y0'] >= cut]

    def loose(self, lines, right_edge):
        for item in paragraphs_from(lines, right_edge):
            text = ''.join(t for t, _ in item['spans'])
            p = self.doc.add_paragraph()
            if item['number']:
                p.paragraph_format.left_indent = Pt(26); p.paragraph_format.first_line_indent = Pt(-26)
                p.add_run(item['number'] + '\t').bold = True; self.source_text.append(item['number'])
            if re.match(r'S[ÍI]NTESE DO', text):
                p.paragraph_format.space_before = Pt(4)
            self.fill(p, item['spans'])

    def finish(self):
        p = self.doc.add_paragraph(); p.paragraph_format.space_before = Pt(10)
        run = p.add_run('kedu›     @keduoficial     kedu.com.br'); run.font.size = Pt(8)
        self.shade(p, BAR); run.font.color.rgb = RGBColor.from_string('FFFFFF')


def build(source):
    name = source['name']
    pdf_path = QA / (name + '.pdf')
    pdf = fitz.open(pdf_path)
    builder = Builder(name)
    for number, page in enumerate(pdf):
        builder.page(page, number == 0)
    builder.finish()
    doc = builder.doc
    doc.core_properties.title = TITLES[name]
    doc.core_properties.subject = 'Adaptação do modelo Canva para automação — pendente de homologação jurídica'
    target = OUT / (name + '.docx')
    doc.save(target)
    profile = 'canva-' + name.lower()
    manifest = {'profile': profile, 'sourceUrl': source['url'],
                'sourceSha256': hashlib.sha256(pdf_path.read_bytes()).hexdigest(), 'slots': builder.slots,
                'formatAdaptation': 'Caixas posicionadas convertidas em parágrafos sombreados e tabelas; texto da fonte '
                                    'preservado, inclusive grafia. Logotipo, ícones, rodapé gráfico e numeração de páginas '
                                    'não são reproduzidos. Homologação visual e jurídica obrigatória.'}
    with ZipFile(target) as z:
        entries = {n: z.read(n) for n in z.namelist()}
    entries['customXml/kedu-template.json'] = json.dumps(manifest, ensure_ascii=False).encode()
    with ZipFile(target, 'w', ZIP_DEFLATED) as z:
        for n, data in entries.items():
            z.writestr(n, data)
    # Every visual line of the PDF (except the graphic footer) must reach the template exactly once.
    from collections import Counter
    words = lambda texts: Counter(w for t in texts for w in re.findall(r'\w+', t))
    expected = words(''.join(t for t, _ in l['spans']) for page in pdf for l in page_lines(page))
    if expected != words(builder.source_text):
        raise ValueError((name, 'Texto divergente da fonte', expected - words(builder.source_text), words(builder.source_text) - expected))
    return {'id': profile, 'name': TITLES[name], 'file': target.name,
            'type': 'Aditivo' if name in SUBTYPES else 'Contrato de garantia', 'subtype': SUBTYPES.get(name, ''),
            'modality': name.replace('Contrato_', '').replace('_', ' ') if name.startswith('Contrato_') else '',
            **manifest, 'templateSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
            'sourceParagraphs': builder.source_text, 'sourceWordCount': sum(expected.values())}


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    sources = json.loads((QA / 'sources.json').read_text(encoding='utf-8'))
    catalog = []
    for source in sources:
        entry = build(source)
        catalog.append({k: v for k, v in entry.items() if k != 'sourceParagraphs'})
        (OUT / 'provenance').mkdir(exist_ok=True)
        (OUT / 'provenance' / (source['name'] + '.json')).write_text(
            json.dumps(entry, ensure_ascii=False, indent=2), encoding='utf-8')
        print(source['name'], 'campos:', len(entry['slots']))
    (OUT / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
