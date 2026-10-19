"""Adapt the supplied Canva PDF into flow-based Word, without rewriting clauses.
Run with the bundled Python. Source PDF is deliberately not bundled in the repository.
"""
import sys, re, json, hashlib
from pathlib import Path
from docx import Document
from docx.shared import Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_ALIGN_PARAGRAPH
from zipfile import ZipFile, ZIP_DEFLATED

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'data/canva-conversion/deps'))
import pymupdf as fitz
source=Path(sys.argv[1])
target=root/'templates/official/aditivo-vigencia-v1.docx'
target.parent.mkdir(parents=True,exist_ok=True)
page=fitz.open(source)[0]
blocks=page.get_text('blocks',sort=True)
def between(low,high):return ' '.join(b[4].strip().replace('\n',' ') for b in blocks if low <= b[1] < high)
parts={
 'title':between(65,110).replace('(DIGITAR O Nº ORDINAL DO ADITIVO)','{ordinalAditivo}'),
 'contractor':between(180,240), 'contracted':between(285,330),
 'change':between(345,420).replace('[DATA DE ASSINATURA DO CONTRATO MATRIZ]','{dataAssinaturaMatrizExtenso}'),
 'term':between(460,490).replace('XX de MÊS de ANO','{inicioExtenso}').replace('DIA de MÊS de ANO','{fimExtenso}').replace('QUANTIDADE DE MESES (POR EXTENSO)','{duracaoMeses} ({duracaoExtenso})'),
 'unchanged':between(515,565),'electronic':between(575,605),'recognition':between(615,695),
}
mapping={'RAZÃO SOCIAL':'razaoSocial','NOME FANTASIA':'nomeFantasia','CNPJ':'cnpj','RUA':'rua','Nº':'numero','BAIRRO':'bairro','CIDADE':'cidade','ESTADO':'estado','CEP':'cep','NOME REPRESENTANTE':'representanteNome','CPF REPRESENTANTE':'representanteCpf'}
for original,key in mapping.items():parts['contractor']=parts['contractor'].replace('{{'+original+'}}','{'+key+'}')
assert '{{' not in parts['contractor']
doc=Document()
section=doc.sections[0]
section.page_width=Pt(595.28);section.page_height=Pt(841.89)
section.top_margin=Pt(25);section.bottom_margin=Pt(25)
section.left_margin=Pt(34);section.right_margin=Pt(34)
normal=doc.styles['Normal'];normal.font.name='Arial';normal.font.size=Pt(9.5);normal.font.color.rgb=RGBColor.from_string('24385F')
normal.paragraph_format.space_after=Pt(7);normal.paragraph_format.line_spacing=1.05
slots=[]
def text(p,value,bold=False,size=None,color=None):
 for chunk in re.split(r'(\{[A-Za-z]+\})',value):
  if not chunk:continue
  if re.fullmatch(r'\{[A-Za-z]+\}',chunk):
   key=chunk[1:-1];slots.append(key)
   control=OxmlElement('w:sdt');props=OxmlElement('w:sdtPr');tag=OxmlElement('w:tag');tag.set(qn('w:val'),'kedu:'+key);props.append(tag)
   lock=OxmlElement('w:lock');lock.set(qn('w:val'),'sdtLocked');props.append(lock);control.append(props)
   content=OxmlElement('w:sdtContent');r=OxmlElement('w:r');rp=OxmlElement('w:rPr')
   b=OxmlElement('w:b');rp.append(b);r.append(rp);t=OxmlElement('w:t');t.text=chunk;r.append(t);content.append(r);control.append(content);p._p.append(control)
  else:
   r=p.add_run(chunk);r.bold=bold
   if size:r.font.size=Pt(size)
   if color:r.font.color.rgb=RGBColor.from_string(color)
 return p
def para(value,bold=False,size=None):return text(doc.add_paragraph(),value,bold,size)
def box(label,value):
 table=doc.add_table(rows=2,cols=1);table.autofit=False;table.columns[0].width=Pt(527)
 for i,fill in ((0,'203256'),(1,'F1F7FC')):
  cell=table.cell(i,0);shd=OxmlElement('w:shd');shd.set(qn('w:fill'),fill);cell._tc.get_or_add_tcPr().append(shd)
  margins=OxmlElement('w:tcMar')
  for edge in ['top','left','bottom','right']:
   el=OxmlElement('w:'+edge);el.set(qn('w:w'),'110');el.set(qn('w:type'),'dxa');margins.append(el)
  cell._tc.get_or_add_tcPr().append(margins)
 text(table.cell(0,0).paragraphs[0],label,True,10,'FFFFFF')
 text(table.cell(1,0).paragraphs[0],value)
 gap=doc.add_paragraph();gap.paragraph_format.space_after=Pt(1);gap.paragraph_format.space_before=Pt(0);gap.paragraph_format.line_spacing=Pt(2);gap.add_run().font.size=Pt(2)

logo=para('kedu›',True,28);logo.paragraph_format.space_after=Pt(5)
notice=para('{avisoHomologacao}');notice.paragraph_format.space_after=Pt(5)
para(parts['title'],True,11).alignment=WD_ALIGN_PARAGRAPH.CENTER
para('SÍNTESE DO ADITIVO',True,10)
box('Contratante',parts['contractor'])
box('Contratado',parts['contracted'])
para(parts['change'])
box('Vigência Contratual',parts['term'])
for key in ['unchanged','electronic','recognition']:para(parts[key])
para('Fortaleza,CE, {dataFormalizacaoExtenso}.')
sign=doc.add_table(rows=1,cols=2)
for i,label in enumerate(['Instituição de ensino','kedu Serviços e Soluções Educacionais e Financeiras LTDA']):
 p=sign.cell(0,i).paragraphs[0];p.paragraph_format.space_before=Pt(9);text(p,label,True,9)
para('@keduoficial          kedu.com.br',False,9)
doc.core_properties.title='Aditivo de alteração de vigência contratual Kedu'
doc.core_properties.subject='Adaptação do Canva para automação — pendente de homologação jurídica'
doc.save(target)
manifest={'profile':'kedu-vigencia-v1','sourceUrl':'https://canva.link/v9tvnzxi10iv7e3','sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'slots':slots,'formatAdaptation':'Tabelas e texto fluido substituem caixas posicionadas; cláusulas preservadas, incluindo grafia da fonte.'}
with ZipFile(target) as z:entries={n:z.read(n) for n in z.namelist()}
entries['customXml/kedu-template.json']=json.dumps(manifest,ensure_ascii=False).encode()
with ZipFile(target,'w',ZIP_DEFLATED) as z:
 for name,data in entries.items():z.writestr(name,data)
(target.parent/'vigencia-provenance.json').write_text(json.dumps({**manifest,'templateSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'fixedSourceParagraphs':parts},ensure_ascii=False,indent=2),encoding='utf-8')
print('Created',target,'Slots:',len(slots))
